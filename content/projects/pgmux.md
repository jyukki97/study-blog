---
title: "pgmux"
date: 2026-03-11
draft: false
description: "PostgreSQL 프록시 직접 구현하기 - 커넥션 풀링, R/W 분산, 쿼리 캐싱, TLS, Circuit Breaker, 무중단 리로드, LSN Causal Consistency, AST 파서, 쿼리 방화벽, Audit Logging, Helm Chart, Serverless Data API, OpenTelemetry, fsnotify, Prepared Statement Multiplexing, Query Mirroring, GitHub Actions CI/CD, Multi-Database Routing"
icon: "🗄️"
status: "진행중"
tech: ["Go", "PostgreSQL", "Wire Protocol", "Prometheus", "Redis", "TLS", "Circuit Breaker", "pg_query_go", "AST", "Helm", "Kubernetes", "OpenTelemetry", "fsnotify"]
links:
  - name: "GitHub Repository"
    url: "https://github.com/jyukki97/pgmux"
    icon: "🔗"
  - name: "개발 블로그 시리즈"
    url: "/posts?project=pgmux"
    icon: "📝"
duration: "2026.03.11"
---

# pgmux 프로젝트

> "내 손으로 만드는 데이터베이스 프록시"

애플리케이션과 DB 사이에 위치하여 커넥션 풀링, 읽기/쓰기 자동 분산, 반복 쿼리 캐싱을 수행하는 프록시를 Go로 직접 구현하는 프로젝트입니다.

## 🎯 프로젝트 배경 및 목표

**🔍 기술적 호기심**
- PostgreSQL wire protocol을 직접 다뤄보고 싶다
- 커넥션 풀링, 쿼리 라우팅이 내부적으로 어떻게 동작하는지 이해하고 싶다
- PgBouncer 같은 프록시가 어떤 원리로 만들어지는지 궁금하다

**📚 학습 목표**
- Go 동시성 프로그래밍 (goroutine, channel, sync.Mutex)
- PostgreSQL wire protocol (바이트 레벨 메시지 파싱)
- 커넥션 풀링 설계 (acquire/release, 헬스체크, 타임아웃)
- LRU 캐시 구현 및 테이블 기반 무효화

## 🚀 핵심 구현 기능

### ✅ 구현 완료

**프록시 통합 (Pool + Router + Cache)**
- SCRAM-SHA-256 / MD5 백엔드 인증 직접 구현
- Extended Query Protocol (Parse/Bind/Execute/Sync) 지원
- Prepared Statement reader 라우팅 (Parse 메시지 SQL 추출)
- Reader Pool의 DialFunc으로 PG-aware 커넥션 풀링
- 양방향 auth relay (클라이언트↔백엔드 인증 중계)
- E2E 테스트: Docker PG 클러스터 + lib/pq 드라이버

**Prometheus 메트릭**
- 쿼리 라우팅 카운터/히스토그램 (writer/reader별)
- 캐시 히트/미스/무효화 카운터, 항목 수 게이지
- 커넥션 풀 open/idle/acquire 메트릭
- `/metrics` HTTP 엔드포인트 (Prometheus scrape)

**Transaction Pooling**
- PgBouncer transaction 모드와 동일한 커넥션 다중화
- 쿼리/트랜잭션 단위 Writer 커넥션 Acquire/Release
- `DISCARD ALL`로 세션 상태 완전 초기화
- Extended Query Protocol 트랜잭션 경계 추적

**TLS Termination + Front-end Auth**
- SSLRequest 핸들링 및 TLS 연결 업그레이드 (`crypto/tls`)
- 프록시 자체 MD5 인증 (백엔드 의존 없이 접근 제어)
- YAML 기반 사용자 목록 관리

**Circuit Breaker + Rate Limiting**
- Circuit Breaker: Closed → Open → Half-Open 상태 머신
- Rolling Window 기반 에러율 측정 및 자동 트립
- Token Bucket Rate Limiter (burst 허용 + 평균 rate 제어)
- Writer/Reader 독립 Circuit Breaker

**Zero-Downtime Reload**
- SIGHUP 시그널 + `POST /admin/reload` HTTP API
- Reader Pool 핫스왑 (기존 유지, 추가/삭제)
- RoundRobin Balancer 원자적 백엔드 갱신
- Rate Limiter 동적 재설정

**LSN 기반 Causal Consistency**
- 쓰기 후 Writer의 `pg_current_wal_lsn()` 추적
- Reader별 `pg_last_wal_replay_lsn()` 주기적 폴링
- LSN-aware 로드밸런싱 (복제 완료된 Reader에만 라우팅)
- Prometheus `pgmux_reader_lsn_lag_bytes` 메트릭

**AST 기반 쿼리 파서**
- pg_query_go (PostgreSQL 실제 C 파서 바인딩)
- CTE 내부 write 감지, DDL 20+ 노드 타입 정확 분류
- 파싱 실패 시 문자열 파서 자동 fallback

**쿼리 방화벽 (Query Firewall)**
- AST 분석으로 위험 쿼리 사전 차단
- DELETE/UPDATE without WHERE, DROP TABLE, TRUNCATE 차단
- fail-open 전략 + Prometheus 차단 메트릭

**시맨틱 캐시 키**
- pg_query Parse+Deparse로 구조적 동일 쿼리에 같은 캐시 키 생성
- 공백/대소문자 정규화, 리터럴 값 보존

**Audit Logging & Slow Query Tracker**
- 비동기 채널 기반 감사 로그 (쿼리 경로 비블로킹)
- Slow Query 임계값 초과 시 구조화 로그 + Webhook 알림 (Slack 호환)
- 동일 쿼리 패턴 중복 알림 방지 (rate limiting)

**Serverless Data API**
- `POST /v1/query` — HTTP REST → PG Wire Protocol → JSON 응답
- RowDescription OID 기반 타입 매핑 (int, bool, float, text 등)
- 기존 R/W 라우팅, 캐싱, 방화벽, Rate Limiting 투명 적용
- API Key Bearer 인증

**Helm Chart & Docker**
- Multi-stage Dockerfile (CGO 빌드 지원)
- Helm Chart: Deployment, Service, ConfigMap, HPA, PDB, ServiceMonitor
- Kubernetes 원커맨드 배포

**OpenTelemetry 분산 추적**
- TracerProvider 초기화 (OTLP gRPC / stdout exporter)
- Simple Query / Extended Query 경로 Span 계측
- Data API `traceparent` HTTP 헤더 전파
- `enabled: false` 시 noop (성능 영향 없음)

**설정 파일 자동 리로드 (fsnotify)**
- 부모 디렉토리 감시로 K8s ConfigMap symlink swap 지원
- 1초 디바운싱으로 연속 이벤트 병합
- 기존 SIGHUP 리로드 경로 재사용

**Prepared Statement Multiplexing**
- Parse/Bind 인터셉트 → 파라미터 바인딩된 Simple Query 합성
- 20+ PG 타입별 안전한 SQL 리터럴 직렬화
- SQL Injection 방어 테스트 매트릭스 (NULL byte, 중첩 이스케이핑 등)
- Transaction Pooling + Prepared Statement 동시 사용 가능 (PgBouncer 불가)

**Query Mirroring**
- 프로덕션 쿼리를 Shadow DB에 비동기 미러링 (fire-and-forget)
- 패턴별 P50/P99 레이턴시 비교 + 자동 성능 회귀 감지
- 테이블 필터, read_only/all 모드
- 순환 버퍼 기반 메모리 효율적 통계 수집

**GitHub Actions CI/CD**
- CI: golangci-lint, test (-race), build, benchmark 자동화
- Release: `v*` 태그 push 시 multi-platform Docker 이미지 GHCR 자동 배포
- Dockerfile multi-platform 빌드 (TARGETARCH)

**Multi-Database Routing**
- 단일 프록시 인스턴스에서 여러 PostgreSQL 데이터베이스 동시 프록시
- `StartupMessage.database` 필드로 DB 그룹 자동 분기
- DatabaseGroup: per-DB writer/reader 풀, 밸런서, Circuit Breaker 캡슐화
- 캐시 키에 DB명 FNV-1a XOR 혼합으로 per-DB 캐시 격리
- Data API: `?database=` 쿼리 파라미터 지원
- 기존 single-DB config 완전 하위호환

**Admin API**
- `/admin/health` — DB별 백엔드 헬스 상태 조회
- `/admin/stats` — DB별 풀, 캐시 통계 JSON
- `/admin/config` — 현재 설정 (비밀번호 마스킹)
- `/admin/cache/flush[/{table}]` — 전체/테이블별 캐시 비우기
- `/admin/reload` — 무중단 설정 리로드
- `/admin/mirror/stats` — 쿼리 미러링 통계

**멀티 인스턴스 스케일링**
- Redis Pub/Sub 기반 캐시 무효화 브로드캐스트
- 쓰기 시 로컬 캐시 무효화 + 다른 인스턴스에 publish
- mode: "local" (단일) / "pubsub" (멀티) 설정 가능

**커넥션 풀링**
- min/max 커넥션 수 관리
- idle_timeout, max_lifetime 만료 자동 폐기
- connection_timeout 대기 큐
- 주기적 헬스체크 및 min_connections 보충

**R/W 쿼리 자동 분산**
- SQL 키워드 기반 Read/Write 분류
- 힌트 주석 강제 라우팅 (`/* route:writer */`)
- 트랜잭션 내 모든 쿼리 Writer 고정
- read_after_write_delay 타이머 또는 LSN 기반 Causal Consistency
- Reader 라운드로빈 로드밸런싱 + 장애 자동 감지/복구

**반복 쿼리 캐싱**
- LRU 캐시 (container/list 기반)
- TTL 만료 + max_entries 제한
- max_result_size 초과 시 캐싱 스킵
- 쓰기 시 테이블별 캐시 자동 무효화 (역인덱스)

## 🛠️ 기술 스택

**백엔드**
```
Go                      # 고루틴 기반 동시성
PostgreSQL Wire Protocol # 바이트 레벨 프로토콜 직접 구현
YAML                    # 설정 파일
```

**모니터링**
```
Prometheus              # 메트릭 수집 + /metrics 엔드포인트
```

**테스트 환경**
```
Docker Compose          # PG Primary + Replica 2대
Go testing              # 단위 테스트 + 통합 테스트 + 벤치마크
```

## 🏗️ 시스템 아키텍처

```
┌─────────────────┐
│   Application   │
│  (psql, app)    │
└────────┬────────┘
         │ PG Wire Protocol
         ▼
┌──────────────────────────────────────────┐
│              pgmux                     │
│                                           │
│  ┌───────────┐  ┌──────────────────────┐ │
│  │ TLS Term. │  │  Front-end Auth      │ │
│  │ (SSL/TLS) │  │  (MD5 Challenge)     │ │
│  └─────┬─────┘  └──────────┬───────────┘ │
│        │                    │              │
│  ┌─────▼────────────────────▼───────────┐ │
│  │  Rate Limiter (Token Bucket)         │ │
│  └─────┬────────────────────────────────┘ │
│        │                                   │
│  ┌─────▼─────┐  ┌────────────────┐       │
│  │   Query    │  │  Tx Pooling    │       │
│  │   Parser   │  │  (Acquire/     │       │
│  └─────┬─────┘  │   Release)     │       │
│        │         └────────────────┘       │
│  ┌─────▼────────────────────┐             │
│  │   Router (R/W + Session) │             │
│  └─────┬───────────┬───────┘             │
│        │           │                      │
│  ┌─────▼─────┐ ┌──▼──────────────┐      │
│  │   Cache   │ │  Round Robin     │      │
│  │   (LRU)   │ │  Load Balancer   │      │
│  └───────────┘ └──────────────────┘      │
│        │                                   │
│  ┌─────▼──────────────────────────┐      │
│  │  Circuit Breaker (per backend) │      │
│  └─────┬──────────────┬──────────┘      │
└────────┼──────────────┼──────────────────┘
         │              │
    ┌────▼────┐   ┌────▼────┐
    │ Writer  │   │ Readers │
    │(Primary)│   │(Replica)│
    └─────────┘   └─────────┘
```

## 📊 벤치마크 결과 (Apple M4 Pro)

| 항목 | 성능 | 메모리 |
|------|------|--------|
| Cache Key 생성 | 15 ns/op | 0 alloc |
| Cache Get (Hit) | 36 ns/op | 0 alloc |
| Cache Get (Miss) | 6 ns/op | 0 alloc |
| RoundRobin Next | 1.7 ns/op | 0 alloc |
| Query Classify | 1,222 ns/op | 45 alloc |
| ClassifyAST SELECT | ~7 µs/op | - |
| ClassifyAST Complex JOIN | ~32 µs/op | - |
| SemanticCacheKey | ~2 µs/op | - |
| CheckFirewall | ~5.5 µs/op | - |

## 📝 개발 블로그 시리즈

프로젝트 개발 과정에서 배운 내용을 기록하고 있습니다.

1. [PG Wire Protocol 이해](/posts/2026-03-11-pgmux-1-pg-wire-protocol/)
2. [커넥션 풀링 직접 구현](/posts/2026-03-11-pgmux-2-connection-pooling/)
3. [읽기/쓰기 자동 분산](/posts/2026-03-11-pgmux-3-rw-routing/)
4. [쿼리 캐싱과 무효화](/posts/2026-03-11-pgmux-4-query-caching/)
5. [통합, E2E 테스트, 회고](/posts/2026-03-11-pgmux-5-benchmark-review/)
6. [Prometheus 메트릭, Prepared Statement 라우팅, Admin API](/posts/2026-03-11-pgmux-6-phase7-enhancement/)
7. [QA 버그 수정과 멀티 인스턴스 스케일링](/posts/2026-03-11-pgmux-7-qa-bugfix-scaling/)
8. [보안 취약점 심화 수정](/posts/2026-03-11-pgmux-8-security-hardening/)
9. [Transaction Pooling](/posts/2026-03-11-pgmux-9-transaction-pooling/)
10. [TLS Termination과 프록시 인증](/posts/2026-03-11-pgmux-10-tls-auth/)
11. [Circuit Breaker와 Rate Limiting](/posts/2026-03-11-pgmux-11-circuit-breaker-ratelimit/)
12. [무중단 설정 리로드](/posts/2026-03-11-pgmux-12-zero-downtime-reload/)
13. [LSN 기반 Causal Consistency](/posts/2026-03-11-pgmux-13-lsn-causal-consistency/)
14. [AST 파서와 쿼리 방화벽](/posts/2026-03-11-pgmux-14-ast-parser-firewall/)
15. [보안 QA와 취약점 수정](/posts/2026-03-11-pgmux-15-security-qa-hardening/)
16. [Audit Logging, Helm Chart, Serverless Data API](/posts/2026-03-11-pgmux-16-audit-helm-dataapi/)
17. [Channel Blocking과 Connection Poisoning 버그 수정](/posts/2026-03-11-pgmux-17-channel-blocking-connection-poisoning/)
18. [OpenTelemetry 분산 추적과 설정 자동 리로드](/posts/2026-03-11-pgmux-18-opentelemetry-fsnotify/)
19. [Writer-Only 모드와 진입장벽 낮추기](/posts/2026-03-11-pgmux-19-optional-readers/)
20. [Hot Reload Data Race와 sync.RWMutex](/posts/2026-03-11-pgmux-20-hot-reload-data-race/)
21. [Prepared Statement Multiplexing](/posts/2026-03-12-pgmux-21-prepared-statement-multiplexing/)
22. [COPY 프로토콜 교착과 Map 메모리 누수](/posts/2026-03-12-pgmux-22-copy-deadlock-and-map-leak/)
23. [커넥션 풀 오염과 Panic 격리](/posts/2026-03-12-pgmux-23-pool-poisoning-and-panic-recovery/)
24. [좀비 고루틴과 Dangling Pointer](/posts/2026-03-12-pgmux-24-zombie-goroutine-and-dangling-pointer/)
25. [2,259줄 God Object 해체기](/posts/2026-03-12-pgmux-25-split-server-go/)
26. [Cancel Request, Graceful Shutdown, Data Race](/posts/2026-03-12-pgmux-26-cancel-request-shutdown-data-race/)
27. [QA 2차 — Hot Reload 함정](/posts/2026-03-12-pgmux-27-qa-round2-hot-reload-pitfalls/)
28. [Admin Reload과 Webhook 유실](/posts/2026-03-12-pgmux-28-admin-reload-and-webhook-leak/)
29. [WriteHeader 동결과 테스트 사각지대](/posts/2026-03-12-pgmux-29-writeheader-freeze-and-test-blindspot/)
30. [AST 라우팅 사각지대와 캐시 무효화 실종](/posts/2026-03-12-pgmux-30-qa-round3-routing-cache-parsing/)
31. [캐시 포맷 충돌과 HTTP 서버 수명주기](/posts/2026-03-12-pgmux-31-cache-format-collision-and-http-lifecycle/)
32. [Query Mirroring과 레이턴시 비교](/posts/2026-03-12-pgmux-32-query-mirroring/)
33. [GitHub Actions CI/CD와 Docker 자동 배포](/posts/2026-03-13-pgmux-33-github-actions-cicd/)
34. [Multi-Database Routing](/posts/2026-03-13-pgmux-34-multi-database-routing/)

## 🔗 관련 링크

- **GitHub Repository**: [프로젝트 소스코드](https://github.com/jyukki97/pgmux)
- **개발 블로그**: [개발 블로그 시리즈](/posts?project=pgmux)
