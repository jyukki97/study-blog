---
title: "Go로 PostgreSQL 프록시 만들기 (54) - QA 5차: 릴리즈 위생과 CI 안정성"
date: 2026-03-17
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "QA", "Testing", "CI", "Race Condition"]
categories: ["Database"]
project: "pgmux"
description: "QA 4차 수정으로 dataapi.New 시그니처가 바뀌었지만 테스트가 따라가지 못해 컴파일이 깨졌고, watcher 테스트는 time.Sleep 의존으로 race detector에서 간헐 실패했다. 릴리즈 파이프라인을 막는 2건의 테스트 블로커를 수정한다."
---

## 들어가며

QA 4차에서 5건의 버그를 수정했다. 그중 4번 Finding — "Data API defaultDB가 hot-reload 미반영" — 의 수정이 `dataapi.New`의 시그니처를 바꿨다. `string` → `func() string`. 런타임 코드는 잘 동작하지만, 테스트 호출부가 이전 시그니처를 그대로 쓰고 있었다. `go test ./...`가 `internal/dataapi`에서 바로 깨진다.

별도로, Phase 17~18에서 추가한 `FileWatcher`의 `Ready()` 채널이 테스트에 반영되지 않았다. 4개 테스트 모두 `time.Sleep(100ms)`로 watcher 초기화를 기다리는데, `-race` 모드에서 타이밍에 따라 실패한다.

새 기능은 없다. 릴리즈를 막는 테스트 블로커 2건만 수정한다.

| # | 심각도 | 요약 |
|---|--------|------|
| 1 | Blocker | `dataapi.New` 시그니처 변경 후 테스트 호출부 미반영 (컴파일 실패) |
| 2 | Blocker | Watcher 테스트 `time.Sleep` 초기화로 `-race` 플래키 |

---

## 1. dataapi.New 시그니처 불일치

### 문제

QA 4차 Finding 4의 수정은 `dataapi.Server`의 `defaultDB` 필드를 정적 문자열에서 함수 참조로 바꿨다:

```go
// 변경 전
type Server struct {
    defaultDB string
}

// 변경 후
type Server struct {
    defaultDBFn func() string
}
```

`New()` 시그니처도 함께 바뀌었다:

```go
func New(..., defaultDBFn func() string, ...) *Server
```

런타임 호출부(`main.go`)는 `srv.DefaultDBName` (메서드 참조, `func() string` 타입)을 넘기도록 수정했다. 그런데 **테스트 호출부 7곳**이 이전 시그니처를 그대로 쓰고 있었다:

```go
// handler_test.go — proxySrv.DefaultDBName()는 string을 반환
srv := New(..., proxySrv.DefaultDBName(), ...)
//                ^^^^^^^^^^^^^^^^^^^^^^ string, not func() string

// cancel_leak_test.go — 빈 문자열 리터럴
srv := New(..., "", ...)
//              ^^ string, not func() string
```

Go는 `string`과 `func() string`을 타입 불일치로 거부한다. `go build`는 되지만 `go test ./internal/dataapi/`는 컴파일 단계에서 실패한다.

### 이걸 놓친 이유

`go build ./...`는 `_test.go`를 컴파일하지 않는다. CI에서 `go test ./...`를 돌리면 잡히지만, 로컬에서 "빌드 통과" 확인만 하고 넘어갔다. 코드 리뷰에서 시그니처 변경의 영향 범위를 체크했어야 한다.

### 수정

호출 결과(`string`)가 아니라 함수로 감싸서 전달한다:

```go
// handler_test.go — 4곳 수정
srv := New(
    func() *config.Config { return cfg },
    proxySrv.DBGroups,
    func() string { return proxySrv.DefaultDBName() }, // 함수 래퍼
    nilCache,
    nil,
    nilRateLimiter,
    nil,
)
```

```go
// cancel_leak_test.go — 3곳 수정
srv := New(
    func() *config.Config { return cfg },
    nil,
    func() string { return "" }, // 빈 문자열 반환 함수
    nil, nil, nil, nil,
)
```

단순히 타입을 맞추는 것이지만, `func() string`인 이유가 중요하다. 매 요청마다 최신 설정을 반환해야 하니까 함수를 쓴 것이다. 테스트에서는 설정이 변하지 않으므로 고정값 반환 함수면 충분하다.

---

## 2. Watcher 테스트의 time.Sleep 플래키

### 문제

`FileWatcher`에는 `Ready()` 채널이 있다. `Start()`가 디렉토리 감시를 등록한 직후 이 채널을 닫는다:

```go
func (fw *FileWatcher) Start(ctx context.Context) error {
    dir := filepath.Dir(fw.path)
    if err := fw.watcher.Add(dir); err != nil {
        return fmt.Errorf("watch directory %s: %w", dir, err)
    }
    close(fw.readyCh)  // ← 감시 등록 완료 신호
    // event loop 진입...
}

func (fw *FileWatcher) Ready() <-chan struct{} {
    return fw.readyCh
}
```

그런데 테스트 4개가 모두 이 채널을 무시하고 `time.Sleep(100ms)`를 쓰고 있었다:

```go
go func() {
    fw.Start(ctx)
}()

time.Sleep(100 * time.Millisecond)  // watcher 초기화 "기다림"

os.WriteFile(cfgFile, []byte("modified"), 0644)
```

대부분의 환경에서 100ms면 충분하다. 하지만 `-race` 모드는 goroutine 스케줄링에 오버헤드를 준다. 100ms 안에 `Start()`가 `watcher.Add(dir)`까지 도달하지 못할 수 있다. 이 경우:

1. `time.Sleep` 종료
2. 파일 수정 발생
3. **그 후에** `watcher.Add(dir)` 실행 — 이벤트를 놓침
4. 콜백 미호출 → 테스트 실패

`go test -race ./internal/config -run TestFileWatcher_SymlinkSwap -count=5`로 재현했을 때 5회 중 2회 실패했다. CI에서도 같은 환경이라면 **비결정적 실패**가 반복된다.

### 수정

`time.Sleep`을 `<-fw.Ready()`로 교체한다:

```go
go func() {
    fw.Start(ctx)
}()

<-fw.Ready()  // 디렉토리 감시 등록이 완료될 때까지 대기

os.WriteFile(cfgFile, []byte("modified"), 0644)
```

4개 테스트 모두 동일하게 수정했다:

- `TestFileWatcher_Modification`
- `TestFileWatcher_Debounce`
- `TestFileWatcher_SymlinkSwap`
- `TestFileWatcher_Stop`

`Ready()`는 **이벤트 기반 동기화**다. "얼마나 기다려야 하는지"를 추측하지 않고, "준비됐을 때" 진행한다. race detector가 스케줄링을 아무리 지연시켜도, 채널이 닫히기 전까지는 진행하지 않는다.

### 검증

```
$ go test -race ./internal/config/ -run TestFileWatcher -count=5
--- PASS: TestFileWatcher_Modification (1.50s)
--- PASS: TestFileWatcher_Debounce (2.01s)
--- PASS: TestFileWatcher_SymlinkSwap (1.51s)
--- PASS: TestFileWatcher_Stop (1.50s)
(x5, 20/20 PASS)
```

---

## time.Sleep vs 채널 동기화

이번 수정은 코드 한 줄이지만, 테스트에서 반복되는 실수 패턴이다. 정리하면:

| 방식 | 장점 | 단점 |
|------|------|------|
| `time.Sleep(N)` | 간단 | N이 충분한지 보장 불가, race 모드에서 플래키, 불필요하게 느림 |
| `<-readyCh` | 결정적, 최소 대기 | 생산 코드에 동기화 포인트 필요 |
| polling + deadline | 외부 상태 체크 가능 | 복잡, busy wait |

`time.Sleep`이 테스트에서 필요한 경우도 있다 — debounce interval 이후 결과를 확인할 때처럼, 일정 시간이 **실제로 흘러야** 하는 경우. 하지만 **초기화 동기화**에는 절대 쓰면 안 된다. 초기화는 시간이 아니라 상태에 의존하기 때문이다.

이 프로젝트에서는 `Ready()` 채널을 Phase 17~18에서 이미 구현해놨다. 구현한 사람이 테스트에 적용하는 걸 깜빡한 것이다. API를 만들었으면 테스트가 첫 번째 소비자여야 한다.

---

## 마무리

이번 QA 라운드는 짧다. 새 기능도 없고, 런타임 버그도 아니다. 하지만 **릴리즈 파이프라인을 막는** 블로커였다:

1. 테스트 컴파일 실패 → `go test ./...` 불가 → CI 레드
2. race 플래키 → CI 비결정적 실패 → 머지 신뢰도 하락

둘 다 "코드는 맞는데 테스트가 틀린" 케이스다. 시그니처 변경 시 호출부 전수 검사, 동기화 프리미티브가 있으면 테스트에서 먼저 사용 — 이 두 가지가 교훈이다.

다음 글에서는 새 기능이나 성능 주제를 다룰 예정이다.
