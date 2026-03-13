---
title: "Go로 PostgreSQL 프록시 만들기 (33) - GitHub Actions CI/CD와 Docker 자동 배포"
date: 2026-03-13
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "CI/CD", "GitHub Actions", "Docker", "GHCR"]
categories: ["Database"]
description: "golangci-lint, 테스트, 벤치마크를 자동화하는 CI 파이프라인과 태그 push 시 multi-platform Docker 이미지를 GHCR에 자동 배포하는 Release 파이프라인을 구축한다."
---

## 들어가며

pgmux는 32편에 걸쳐 커넥션 풀링, R/W 분산, 캐싱, 방화벽, Prepared Statement Multiplexing, Query Mirroring까지 구현했다. 기능은 PgBouncer를 넘어섰지만, 한 가지 결정적인 문제가 있었다 — **CI가 없다**.

PR을 올려도 자동 검증이 없고, 사용자가 pgmux를 써보려면 Go를 설치하고 직접 빌드해야 한다. 오픈소스에서 GitHub에 들어왔을 때 CI 뱃지가 없고 Docker 이미지가 없으면, 기능이 아무리 좋아도 대부분 그냥 나간다.

이번 글에서는 GitHub Actions 기반 CI/CD 파이프라인 구축 과정을 다룬다.

---

## 구축할 것

두 개의 워크플로우를 만든다:

| 워크플로우 | 트리거 | 하는 일 |
|-----------|--------|---------|
| **CI** | PR / push to main | lint, test, build, benchmark |
| **Release** | `v*` 태그 push | Docker 이미지 빌드 → GHCR 배포 |

---

## CI 워크플로우

### 전체 구조

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read
```

`permissions: contents: read`로 최소 권한만 부여한다. CI에서 코드를 읽기만 하면 되니까.

### Job 1: Lint

```yaml
lint:
  name: Lint
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-go@v5
      with:
        go-version-file: go.mod
    - name: golangci-lint
      uses: golangci/golangci-lint-action@v6
      with:
        version: latest
        install-mode: goinstall
```

여기서 **`install-mode: goinstall`이 핵심**이다. 기본값인 `binary` 모드는 golangci-lint의 미리 빌드된 바이너리를 다운로드하는데, 이 바이너리가 Go 1.24로 빌드되어 있다. pgmux는 Go 1.25를 타겟으로 하므로 버전 충돌이 발생한다:

```
Error: can't load config: the Go language version (go1.24) used to build
golangci-lint is lower than the targeted Go version (1.25.1)
```

`goinstall` 모드는 `go install`로 소스에서 빌드하므로 setup-go에서 설치한 Go 1.25로 컴파일된다. 빌드 시간이 조금 늘어나지만 (캐시 히트 시 무시할 수준), 버전 충돌을 근본적으로 해결한다.

기존 `.golangci.yml`이 그대로 사용된다:

```yaml
linters:
  enable:
    - errcheck
    - govet
    - staticcheck
    - unused
    - ineffassign
    - gosimple
```

### Job 2: Test

```yaml
test:
  name: Test
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-go@v5
      with:
        go-version-file: go.mod
    - name: Run tests
      run: go test ./... -v -count=1 -race -timeout 5m
    - name: Upload coverage
      if: github.event_name == 'push' && github.ref == 'refs/heads/main'
      run: |
        go test ./... -coverprofile=coverage.out -timeout 5m
        go tool cover -func=coverage.out
```

핵심 플래그:
- **`-race`**: Go race detector. 동시성 버그가 많은 프록시 코드에 필수
- **`-count=1`**: 테스트 캐시 비활성화. CI에서는 항상 실제로 실행해야 한다
- **`-timeout 5m`**: 행이 걸린 테스트를 잡기 위한 안전장치

E2E 테스트(`tests/e2e_test.go`)는 프록시와 PG가 실행 중이어야 하지만, 코드에서 연결 실패 시 `t.Skipf()`로 건너뛰도록 되어 있어 CI에서 자연스럽게 스킵된다:

```go
db, err := sql.Open("postgres", proxyDSN)
if err != nil {
    t.Skipf("cannot open proxy connection: %v", err)
}
```

커버리지는 main push 시에만 수집한다. PR마다 수집하면 테스트가 두 번 돌아서 시간 낭비.

### Job 3: Build

```yaml
build:
  name: Build
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-go@v5
      with:
        go-version-file: go.mod
    - name: Build binary
      run: CGO_ENABLED=1 go build -o bin/pgmux ./cmd/pgmux
```

pgmux는 `pg_query_go`(PostgreSQL C 파서의 cgo 바인딩)를 사용하므로 **`CGO_ENABLED=1`이 필수**다. 이 플래그 없이 빌드하면 링크 에러가 발생한다.

### Job 4: Benchmark

```yaml
bench:
  name: Benchmark
  runs-on: ubuntu-latest
  if: github.event_name == 'pull_request'
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-go@v5
      with:
        go-version-file: go.mod
    - name: Run benchmarks
      run: go test ./tests/ -bench=. -benchmem -count=3 -timeout 10m | tee bench.txt
    - name: Upload benchmark results
      uses: actions/upload-artifact@v4
      with:
        name: bench-results
        path: bench.txt
```

PR에서만 실행한다 (`if: github.event_name == 'pull_request'`). main push마다 벤치마크를 돌리면 리소스 낭비다.

`-count=3`으로 3회 반복하여 노이즈를 줄이고, 결과를 아티팩트로 저장하여 나중에 비교할 수 있게 한다.

---

## Release 워크플로우

### 트리거

```yaml
on:
  push:
    tags:
      - "v*"
```

`git tag v1.0.0 && git push --tags`하면 자동으로 실행된다.

### Docker 메타데이터

```yaml
- name: Docker meta
  id: meta
  uses: docker/metadata-action@v5
  with:
    images: ghcr.io/${{ github.repository }}
    tags: |
      type=semver,pattern={{version}}
      type=semver,pattern={{major}}.{{minor}}
      type=semver,pattern={{major}}
      type=sha
```

`v1.2.3` 태그를 push하면 4개의 태그가 자동 생성된다:
- `ghcr.io/jyukki97/pgmux:1.2.3`
- `ghcr.io/jyukki97/pgmux:1.2`
- `ghcr.io/jyukki97/pgmux:1`
- `ghcr.io/jyukki97/pgmux:sha-a1b2c3d`

`latest`는 의도적으로 뺐다. `latest`는 "어떤 버전인지 모르겠지만 최신"이라는 의미라 프로덕션에서 쓰면 위험하다.

### Multi-Platform 빌드

```yaml
- name: Build and push
  uses: docker/build-push-action@v6
  with:
    context: .
    push: true
    tags: ${{ steps.meta.outputs.tags }}
    platforms: linux/amd64,linux/arm64
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

**`linux/amd64,linux/arm64`** — x86 서버와 ARM 서버(AWS Graviton, Apple Silicon) 모두 지원한다.

이를 위해 Dockerfile에도 수정이 필요했다:

```dockerfile
ARG TARGETARCH
RUN CGO_ENABLED=1 GOOS=linux GOARCH=${TARGETARCH} go build -o /pgmux ./cmd/pgmux
```

`TARGETARCH`는 Docker Buildx가 자동으로 주입하는 ARG다. `linux/arm64`로 빌드할 때는 `GOARCH=arm64`가 된다.

**`cache-from/cache-to: type=gha`** — GitHub Actions 캐시를 사용하여 레이어 캐시를 유지한다. 두 번째 빌드부터는 변경된 레이어만 다시 빌드하므로 속도가 크게 향상된다.

---

## Dockerfile 변경점

```diff
- RUN CGO_ENABLED=1 GOOS=linux go build -o /pgmux ./cmd/pgmux
+ ARG TARGETARCH
+ RUN CGO_ENABLED=1 GOOS=linux GOARCH=${TARGETARCH} go build -o /pgmux ./cmd/pgmux
```

단 두 줄. 기존 `docker build`는 `TARGETARCH`가 비어있으면 호스트 아키텍처로 빌드되므로 하위 호환성도 유지된다.

---

## README CI 뱃지

```markdown
# pgmux

[![CI](https://github.com/jyukki97/pgmux/actions/workflows/ci.yml/badge.svg)](https://github.com/jyukki97/pgmux/actions/workflows/ci.yml)
```

이제 README 상단에서 CI 상태를 바로 확인할 수 있다.

---

## 삽질: golangci-lint 버전 충돌

처음에는 단순하게 설정했다:

```yaml
- name: golangci-lint
  uses: golangci/golangci-lint-action@v6
  with:
    version: latest
```

CI가 실패했다:

```
Error: can't load config: the Go language version (go1.24) used to build
golangci-lint is lower than the targeted Go version (1.25.1)
```

golangci-lint v1.64.8의 미리 빌드된 바이너리가 Go 1.24로 컴파일되어 있고, pgmux의 `go.mod`에는 `go 1.25.1`이 명시되어 있어서 발생한 문제다. golangci-lint는 타겟 Go 버전이 자신의 빌드 버전보다 높으면 거부한다.

해결: `install-mode: goinstall`로 소스에서 빌드하면 setup-go에서 설치한 Go 1.25로 컴파일되어 문제가 없다.

---

## 사용법

### CI 자동 실행

PR을 올리거나 main에 push하면 자동으로 4개 job이 실행된다. 별도 설정 불필요.

### Docker 이미지 배포

```bash
# 태그 생성 후 push
git tag v1.0.0
git push --tags

# 이미지 사용
docker pull ghcr.io/jyukki97/pgmux:1.0.0
docker run -v $(pwd)/config.yaml:/config.yaml ghcr.io/jyukki97/pgmux:1.0.0
```

---

## 마치며

CI/CD는 기능이 아니라 인프라다. 코드를 한 줄도 바꾸지 않지만, 프로젝트의 신뢰도를 완전히 바꿔놓는다.

이번 작업에서 기억할 것:
1. **golangci-lint + 최신 Go** — 바이너리 모드는 빌드 Go 버전이 낮을 수 있다. `goinstall`이 안전하다
2. **CGO_ENABLED=1** — cgo 의존성이 있으면 CI에서도 명시해야 한다
3. **TARGETARCH** — multi-platform 빌드 시 Buildx가 주입하는 ARG. Dockerfile에 명시하지 않으면 호스트 아키텍처로만 빌드된다
4. **E2E 테스트 skip** — 외부 의존성이 필요한 테스트는 `t.Skipf()`로 CI에서 자연스럽게 건너뛰게 하라

다음은 경쟁 제품 대비 가장 큰 갭인 Multi-Database Routing을 다룰 예정이다.

---

*전체 코드: [GitHub PR #170](https://github.com/jyukki97/pgmux/pull/170)*
