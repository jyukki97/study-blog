---
title: "백엔드 커리큘럼 심화: 종단간 Deadline Budget과 Cancellation Propagation 운영 플레이북"
date: 2026-04-01
draft: false
topic: "Architecture"
tags: ["Deadline Budget", "Cancellation", "Timeout", "Tail Latency", "Resilience", "Backend Operations"]
categories: ["Backend Deep Dive"]
description: "클라이언트가 이미 포기한 요청을 백엔드가 계속 처리하는 낭비를 줄이기 위해, 홉별 deadline 배분과 취소 전파를 숫자 기준으로 설계하는 방법을 정리합니다."
module: "resilience-system"
study_order: 1163
---

## 이 글에서 얻는 것

- 타임아웃을 단순 상수로 두는 방식에서 벗어나, **클라이언트→게이트웨이→서비스→DB**로 이어지는 종단간 deadline budget을 설계하는 기준을 잡을 수 있습니다.
- "사용자는 이미 떠났는데 서버는 계속 일하는" 상태를 줄이기 위해, **cancellation propagation(취소 전파)**를 어디까지 강제해야 하는지 판단할 수 있습니다.
- 팀에서 바로 적용할 수 있는 **실무 의사결정 기준(숫자·조건·우선순위)**과 점검 체크리스트를 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) 장애는 느린 응답보다 "낭비되는 작업"에서 커진다

많은 팀이 타임아웃 이슈를 "응답이 늦다" 문제로만 다룹니다. 그런데 운영에서 더 비싼 문제는 따로 있습니다.

1. 클라이언트는 2초에서 포기(HTTP 499/timeout)
2. 서버는 8~15초 동안 DB/외부 API를 계속 호출
3. 워커/커넥션 풀이 의미 없는 요청으로 점유
4. 정상 요청이 대기열에서 밀리며 p95/p99가 급격히 악화

즉 핵심은 단순 지연이 아니라 **불필요한 작업의 잔존 시간**입니다. 이 문제는 [Tail Latency 엔지니어링 플레이북](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/), [Timeout/Retry/Backoff 설계](/learning/deep-dive/deep-dive-timeout-retry-backoff/), [Admission Control & 동시성 제한](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/)과 함께 보면 더 명확해집니다.

### 2) Timeout과 Deadline은 다르다: 절대시간 예산으로 통일해야 한다

- **Timeout**: "지금부터 N초"
- **Deadline**: "절대 시각 T까지"

마이크로서비스 홉이 늘어나는 환경에서는 timeout만으로는 예산 합이 쉽게 무너집니다. 서비스 A가 800ms, B가 800ms, C가 800ms를 각각 갖고 있으면 상위 요청은 이미 2.4초를 넘어설 수 있습니다.

그래서 운영 기준은 timeout 체인이 아니라, **상위 요청의 절대 deadline을 하위 홉에 전달**하는 방식으로 맞춰야 합니다.

- HTTP: `X-Request-Deadline`(epoch ms) 또는 `grpc-timeout` 변환
- gRPC: 클라이언트 deadline을 컨텍스트로 전달
- 내부 비동기 작업: 원요청 deadline이 지나면 enqueue 자체를 차단

핵심은 "각 팀이 알아서 타임아웃"이 아니라, **요청 단위 예산의 일관성**입니다.

### 3) Cancellation Propagation이 빠지면 deadline은 절반짜리다

deadline을 두어도 취소 전파가 없으면 의미가 약합니다. 실제로는 아래 경계에서 누락이 자주 발생합니다.

- API 서버는 취소됐지만 DB 쿼리는 계속 실행
- 상위 서비스는 취소됐지만 하위 RPC는 그대로 진행
- 워커 큐에 이미 들어간 작업이 소비되어 후속 부하를 계속 생성

취소 전파는 "코드 스타일" 문제가 아니라 **자원 보호 정책**입니다. 최소 기준은 아래와 같습니다.

- DB 레이어: 쿼리 타임아웃 + cancel signal 지원 드라이버 사용
- 외부 호출: context cancellation 감지 시 즉시 중단
- 비동기 파이프라인: deadline 초과 메시지는 소비 전 드롭/지연 큐 이동
- 배치/스트림: 사용자 요청 기원 작업은 취소 가능성과 재실행 전략을 분리

### 4) Budget 분해는 균등 분배가 아니라 실패 확률 기반으로 해야 한다

홉별로 똑같이 200ms를 나누면 단순하지만 실제로는 비효율적입니다. I/O 편차가 큰 구간(DB, 외부 결제, 검색)에는 더 넓은 예산이 필요하고, CPU 중심 구간은 상대적으로 짧게 둬야 합니다.

실무에서 많이 쓰는 시작점은 아래입니다.

- 전체 API SLO p95 목표: 1,200ms
- 게이트웨이/인증/직렬화: 150ms
- 핵심 비즈니스 서비스: 300ms
- DB + 캐시 + 외부 API: 650ms
- 여유 버퍼(재시도 방지용): 100ms

이후 2주 단위로 "예산 초과 홉"을 좁히는 방식이 운영 비용 대비 효과가 좋습니다.

## 실무 적용

### 1) 의사결정 기준(숫자·조건·우선순위)

우선순위는 보통 **시스템 생존 > 사용자 체감 지연 > 개별 요청 완결성** 순으로 두는 편이 안전합니다.

권장 기준 예시:

1. **요청 잔존 작업 비율**(client canceled 이후 1초 넘게 실행된 작업 비율) 
   - 5분 이동평균 **3% 초과** 시 P1 개선 항목 등록
2. **deadline 초과 하위 호출 비율** 
   - 서비스별 **1% 초과** 시 해당 구간 타임아웃 재배분
3. **취소 누락 쿼리 비율**(cancel 이후 DB 실행 지속) 
   - **0.5% 초과** 시 드라이버/ORM 설정 점검을 배포 게이트로 승격
4. **보호 모드 진입 조건**
   - CPU 80% 5분 지속 + 잔존 작업 비율 3% 초과 시
   - 신규 비핵심 요청에 대해 강제 짧은 deadline(예: 500ms) 적용

### 2) 구현 원칙: 전파·관측·차단을 한 세트로 묶는다

#### (a) 전파
- ingress에서 요청 시작 시각과 absolute deadline 계산
- 모든 내부 호출에 deadline metadata 주입
- background job enqueue 시 `deadline_at` 필드 저장

#### (b) 관측
- `request_deadline_ms`, `remaining_budget_ms` 로그 필드 고정
- 취소 원인(`client_cancel`, `server_timeout`, `circuit_open`) 태그 분리
- "완료"와 "취소 후 종료"를 서로 다른 성공 기준으로 기록

#### (c) 차단
- `remaining_budget_ms < 0`이면 하위 호출 금지
- `remaining_budget_ms < 100ms`면 DB fan-out 쿼리 대신 degraded path 사용
- 동일 요청 내 재시도는 예산 내에서만 허용(예: 최대 1회)

이 구조는 [SLO/SLI/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/), [알람 전략](/learning/deep-dive/deep-dive-observability-alarms/), [Connection Pool 운영](/learning/deep-dive/deep-dive-connection-pool/)과 붙여야 실제 효과가 납니다.

### 3) 4주 도입 플랜

**1주차: 측정 고정**
- 취소 이후 잔존 작업 비율, 하위 호출 deadline 초과율 대시보드 생성
- 상위 5개 API의 홉 맵 정리

**2주차: 전파 통일**
- HTTP/gRPC 공통 deadline 헤더/컨텍스트 규약 도입
- 신규 API는 deadline 필수 검증(없으면 400 또는 기본값)

**3주차: 취소 강제**
- DB/외부 API 클라이언트에 cancel timeout 강제 설정
- 비동기 큐 소비 시 `deadline_at` 검사 추가

**4주차: 보호 모드 자동화**
- 잔존 작업 비율/CPU 결합 규칙으로 보호 모드 자동 진입
- 주간 리뷰로 budget 재배분

### 4) 간단한 의사코드 예시

```go
func Handle(ctx context.Context, req Request) (Response, error) {
    deadline := extractOrDefaultDeadline(req)
    if time.Until(deadline) <= 0 {
        return ErrTimeoutFast
    }

    ctx, cancel := context.WithDeadline(ctx, deadline)
    defer cancel()

    if remaining(ctx) < 100*time.Millisecond {
        return degradedResponse(), nil
    }

    out, err := callDownstream(ctx, req)
    if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
        return ErrTimeoutMapped
    }
    return out, err
}
```

핵심은 "실패를 피하려는 재시도"보다 "예산 안에서 멈추는 규율"을 우선하는 것입니다.

## 트레이드오프/주의점

1) **deadline을 짧게 잡으면 비용은 줄지만 기능 완결성이 떨어질 수 있다**  
특히 조회 집계, 복합 검색처럼 fan-out이 큰 API에서 사용자 체감 누락이 늘어날 수 있습니다.

2) **취소 전파를 강하게 걸수록 레거시 연동 이슈가 드러난다**  
오래된 드라이버나 외부 API SDK가 cancel을 무시하면, 오히려 오류율이 상승한 것처럼 보일 수 있습니다.

3) **예산 분배를 한번 정하고 고정하면 금방 현실과 어긋난다**  
트래픽 패턴, 릴리즈, 인프라 상태가 변하므로 월 1회 이상 재조정이 필요합니다.

4) **재시도 정책과 deadline 정책이 충돌하기 쉽다**  
재시도 횟수를 늘리면 성공률이 좋아 보이지만, 전체 tail latency와 잔존 작업을 악화시킬 수 있습니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 상위 요청의 absolute deadline이 모든 하위 호출로 전달된다.
- [ ] 취소 이후 1초 이상 실행되는 잔존 작업 비율을 지표로 본다.
- [ ] DB/외부 API/큐 소비자에 cancel 처리 기준이 문서화돼 있다.
- [ ] 남은 예산이 임계치 이하일 때 degraded path가 준비돼 있다.
- [ ] 재시도 정책이 deadline budget을 넘지 않도록 제한돼 있다.

### 연습 과제

1. 최근 14일간 `client_cancel` 로그를 수집해, 취소 후 1초 이상 실행된 작업의 비율을 계산해 보세요.  
2. 핵심 API 1개를 선택해 홉별 예산표(게이트웨이/서비스/DB/외부 API)를 작성하고, 현재 p95와 비교해 과대·과소 구간을 표시해 보세요.  
3. `remaining_budget_ms < 100`일 때 degraded path로 전환하는 기능 플래그를 넣고, 오류율·p95·CPU 변화를 1주간 측정해 보세요.

## 관련 글

- [Tail Latency 엔지니어링 플레이북](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/)
- [Timeout/Retry/Backoff 설계](/learning/deep-dive/deep-dive-timeout-retry-backoff/)
- [Admission Control & 동시성 제한](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/)
- [SLO/SLI/Error Budget 운영](/learning/deep-dive/deep-dive-slo-sli-error-budget/)
- [Connection Pool 튜닝 가이드](/learning/deep-dive/deep-dive-connection-pool/)
