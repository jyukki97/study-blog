---
title: "백엔드 커리큘럼 심화: Optimistic Lock, Pessimistic Lock, Atomic Update를 경쟁 비용 기준으로 고르는 법"
date: 2026-05-03
draft: false
topic: "Data Engineering"
tags: ["Optimistic Lock", "Pessimistic Lock", "Atomic Update", "Concurrency Control", "Transaction", "PostgreSQL", "MySQL"]
categories: ["Backend Deep Dive"]
description: "동시성 제어는 락을 세게 거는 문제가 아니라 충돌 비용과 대기 비용을 어디에 둘지 정하는 일입니다. Optimistic Lock, Pessimistic Lock, Atomic Update를 실무 숫자 기준으로 비교합니다."
module: "backend-data-system"
study_order: 1188
---

동시성 제어를 공부할 때 많은 팀이 먼저 묻는 질문은 "낙관적 락이 좋나요, 비관적 락이 좋나요"입니다. 그런데 실무에서 더 중요한 질문은 따로 있습니다. **이 작업의 실패 비용이 큰가, 대기 비용이 큰가, 아니면 한 SQL 문으로 충돌 자체를 닫을 수 있는가**입니다. 같은 재고 차감 문제라도 경쟁 빈도, 초과 판매 비용, API 왕복 구조에 따라 정답이 완전히 달라집니다.

특히 `Optimistic Lock`과 `Pessimistic Lock`만 비교하면 의외로 놓치는 축이 있습니다. 바로 `Atomic Update`입니다. 읽고 판단하고 다시 쓰는 2단계 흐름이 아니라, `UPDATE ... WHERE 조건` 한 번으로 규칙을 밀어 넣을 수 있다면 락 전략 자체가 더 단순해집니다. 그래서 이 글은 [Snapshot Isolation과 Write Skew](/learning/deep-dive/deep-dive-snapshot-isolation-serializable-write-skew-playbook/), [DB Lock Contention 플레이북](/learning/deep-dive/deep-dive-database-locking-contention-playbook/), [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/), [MySQL 트랜잭션 격리 수준과 락](/learning/deep-dive/deep-dive-mysql-isolation-locks/)을 잇는 관점으로, 세 가지 선택지를 **경쟁 비용 기준**으로 정리합니다.

## 이 글에서 얻는 것

- Optimistic Lock, Pessimistic Lock, Atomic Update가 각각 어떤 종류의 충돌에 강한지 구분할 수 있습니다.
- 충돌률, lock wait, retry 성공률, 초과 판매 비용 같은 운영 숫자로 선택 기준을 세울 수 있습니다.
- 단순히 "락을 더 세게 건다"가 아니라, 한 SQL 문으로 닫을 수 있는 문제와 그렇지 않은 문제를 분리할 수 있습니다.
- 재고, 쿠폰, 예약, 상태 전이처럼 자주 나오는 경로에서 어떤 전략을 먼저 검토해야 하는지 우선순위를 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) 세 전략의 차이는 동시성 철학보다 충돌 처리 위치에 있다

세 가지는 모두 "같은 데이터를 동시에 바꾸려는 상황"을 다루지만, 충돌을 처리하는 위치가 다릅니다.

- **Optimistic Lock**: 일단 읽고 작업한 뒤, 커밋 시점에 버전 충돌을 감지합니다.
- **Pessimistic Lock**: 읽는 순간 또는 수정 직전에 잠금을 잡아 다른 작업을 대기시킵니다.
- **Atomic Update**: 애플리케이션 메모리에서 판단하지 않고, SQL 조건문 안에 비즈니스 조건을 넣어 한 번에 갱신합니다.

핵심은 "어느 것이 더 고급인가"가 아니라, **충돌을 재시도로 흡수할지, 대기로 흡수할지, 아예 DB 한 문장으로 축약할지**입니다. 이 차이를 먼저 보면 선택이 훨씬 덜 감정적이 됩니다.

### 2) Optimistic Lock은 충돌이 드문데 사용자 사고 시간이 긴 경로에 잘 맞는다

Optimistic Lock의 가장 큰 장점은 잠금 대기가 거의 없다는 점입니다. 예를 들어 관리자가 주문을 열어 보고 몇 초 뒤 승인 버튼을 누르는 경로처럼, 읽기와 쓰기 사이에 사람 판단이 들어가면 비관적 락은 거의 항상 과합니다. 잠금을 오래 잡고 있으면 다른 요청이 줄줄이 막히기 때문입니다.

이때는 `version` 컬럼이나 `updated_at` 기반 검사를 두고, 충돌 시 "다른 사용자가 먼저 수정했습니다" 또는 짧은 자동 재시도로 처리하는 편이 낫습니다. 보통 아래 조건이면 Optimistic Lock이 출발점으로 꽤 좋습니다.

- 동일 키 충돌률이 **1~2% 이하**
- 충돌 시 재시도 비용이 **100ms~수백 ms 수준**
- 읽기와 쓰기 사이에 사람 확인, 외부 API, 긴 비즈니스 로직이 있다
- 잘못된 중복 반영보다 "수정 실패 후 다시 시도"가 더 싸다

반대로 충돌률이 계속 **5%를 넘고**, 같은 엔티티를 여러 사용자가 동시에 자주 만지며, 실패 시 UX가 크게 흔들리면 Optimistic Lock만으로는 피로가 커집니다. 이때는 전략을 바꾸거나, 최소한 [Timeout/Retry/Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/)와 멱등성 정책을 같이 봐야 합니다.

### 3) Pessimistic Lock은 실패를 줄이지만, 대기와 데드락 비용을 앞으로 당긴다

Pessimistic Lock은 "충돌이 나면 나중에 실패하자"가 아니라 "애초에 한 명씩만 들어오자"에 가깝습니다. `SELECT ... FOR UPDATE`나 유사 잠금으로 먼저 선점하면, 후속 요청은 대기하거나 timeout으로 빠집니다. 초과 판매, 중복 출금, 중복 쿠폰 발급처럼 **한 번 잘못 커밋되면 복구 비용이 큰 경로**에서는 이 접근이 훨씬 단순할 때가 많습니다.

다만 비용도 분명합니다.

- lock wait가 p95, p99 지연시간으로 바로 보입니다.
- 잠금 순서가 어긋나면 데드락 위험이 생깁니다.
- 트랜잭션 안에 외부 API 호출이나 긴 계산이 있으면 잠금 보유 시간이 길어집니다.
- 높은 QPS에서 대기가 재시도와 만나면 큐 적체가 커질 수 있습니다.

실무 출발선으로는 아래 정도가 보수적입니다.

- 동일 키 경합이 초당 **5회 이상** 반복된다
- 잘못 한 번 반영됐을 때 금전 또는 신뢰 비용이 크다
- 잠금 보유 구간을 **50ms 이하**로 유지할 수 있다
- `lock_wait_p95`를 **100ms 이하**로 묶을 자신이 있다

이 조건을 만족하지 못하면 비관적 락은 문제 해결보다 병목 생성 장치가 되기 쉽습니다. 그래서 [DB Lock Contention 플레이북](/learning/deep-dive/deep-dive-database-locking-contention-playbook/)처럼 잠금 범위, 보유 시간, 접근 순서를 같이 설계해야 합니다.

### 4) Atomic Update는 생각보다 많은 문제의 기본값이다

재고 차감, 잔액 감소, 상태 전이, quota 소모처럼 많은 경로는 사실 "먼저 읽고 나중에 쓰는" 애플리케이션 판단이 꼭 필요하지 않습니다. 예를 들어 아래처럼 한 문장으로 닫을 수 있습니다.

```sql
UPDATE inventory
SET stock = stock - 1
WHERE product_id = :id
  AND stock >= 1;
```

영향 받은 행 수가 1이면 성공, 0이면 재고 부족입니다. 이 방식의 장점은 명확합니다.

- round trip이 줄어듭니다.
- 읽은 뒤 다른 요청이 끼어드는 창이 줄어듭니다.
- Optimistic Lock처럼 별도 재조회가 없어도 됩니다.
- Pessimistic Lock처럼 긴 잠금 설계를 직접 들고 가지 않아도 됩니다.

그래서 저는 단일 행 또는 단일 조건으로 표현 가능한 규칙이라면 **Atomic Update를 제일 먼저 검토하는 편**이 맞다고 봅니다. 특히 재고, 포인트 차감, 상태가 `PENDING`일 때만 `PAID`로 바뀌는 전이 같은 경로는 이 방식이 가장 운영 친화적입니다.

물론 한계도 있습니다. 여러 행의 합계나 부재 조건처럼 **집합 불변식**은 SQL 한 문장으로 표현이 까다롭고, 이 경우는 [Snapshot Isolation과 Write Skew](/learning/deep-dive/deep-dive-snapshot-isolation-serializable-write-skew-playbook/)에서 본 것처럼 추가 잠금이나 Serializable, 보조 row 모델링이 필요합니다.

### 5) 전략 선택은 기술 취향이 아니라 불변식 모양에 달려 있다

세 전략을 가장 빨리 가르는 질문은 아래 네 개입니다.

1. 이 규칙은 **한 행**으로 닫히는가, 아니면 **여러 행**을 봐야 하는가
2. 충돌 시 **실패 후 재시도**가 더 싼가, **대기 후 성공 보장**이 더 싼가
3. 잘못 한 번 반영됐을 때 비용이 큰가
4. 트랜잭션이 짧고 예측 가능한가

이 네 질문에 답하면 방향이 꽤 빨리 나옵니다.

- 단일 행 규칙, 짧은 쓰기, 높은 QPS → Atomic Update 우선
- 충돌 드묾, 사람 개입 많음, 재시도 가능 → Optimistic Lock 우선
- 충돌 잦음, 오류 비용 큼, 짧은 임계 구간 → Pessimistic Lock 우선
- 여러 행 불변식 → 별도 aggregate row, 제약조건, Serializable까지 검토

## 실무 적용

### 1) 빠른 선택 매트릭스

| 상황 | 우선 전략 | 이유 | 주의점 |
| --- | --- | --- | --- |
| 재고 1개 차감, 포인트 차감, quota 소모 | Atomic Update | 한 SQL 문으로 규칙 표현 가능 | 영향 행 수 검사 필수 |
| 관리자 수정, 사용자가 긴 시간 편집 후 저장 | Optimistic Lock | 잠금 오래 잡지 않음 | 충돌 메시지/재시도 UX 필요 |
| 쿠폰 선착순, 중복 결제 방지, 강한 선점 필요 | Pessimistic Lock | 사전 차단이 복구보다 쌈 | lock hold time 최소화 |
| 여러 행 합계, 교대표, 좌석 묶음 규칙 | 혼합 전략 | 집합 불변식 | lock row 또는 Serializable 검토 |

중요한 건 한 서비스가 하나의 전략만 쓰지 않아도 된다는 점입니다. 주문 서비스 안에서도 재고는 Atomic Update, 주문 수정은 Optimistic Lock, 정산 마감은 Pessimistic Lock처럼 섞이는 편이 더 현실적입니다.

### 2) 숫자로 보는 의사결정 기준

보통 아래 기준으로 시작하면 실무에서 크게 벗어나지 않습니다.

- `conflict_rate < 2%` 이고 충돌 재시도 성공률이 **80% 이상** → Optimistic Lock 유지 가능
- `conflict_rate >= 5%` 이고 실패 1건의 비용이 큼 → Pessimistic Lock 또는 Atomic Update 검토
- 규칙을 `UPDATE ... WHERE 조건`으로 표현 가능 → 다른 전략보다 Atomic Update 먼저 검토
- `lock_wait_p95 > 100ms` 또는 데드락이 주간 단위로 반복 → 잠금 범위 축소 또는 전략 재설계
- 트랜잭션 안에 외부 API 호출, 파일 I/O, 사용자 입력이 있다 → Pessimistic Lock 기본값 금지에 가깝게 보기
- 초과 판매/중복 승인 사고 비용이 크다 → Optimistic Lock 단독보다 사전 차단 또는 보조 제약조건 우선

우선순위는 대개 이 순서가 안전합니다.

1. 잘못 커밋된 효과를 막는다
2. 한 문장으로 닫을 수 있는 규칙은 최대한 DB로 내린다
3. 그다음 재시도 또는 대기 비용을 비교한다
4. 마지막에 평균 latency를 최적화한다

### 3) 대표 시나리오별 추천 출발점

- **재고 차감**: `UPDATE ... WHERE stock >= n` 형태 Atomic Update, 필요 시 주문 idempotency 추가
- **쿠폰 선착순 발급**: 남은 수량 row를 Atomic Update 또는 짧은 Pessimistic Lock으로 보호
- **관리자 상세 편집 화면**: Optimistic Lock + 충돌 시 diff 안내
- **결제 중복 승인 방지**: 상태 전이 Atomic Update + 외부 결제 호출 전후 멱등 키 고정
- **좌석/병상/당직표 같은 집합 규칙**: aggregate row 잠금 또는 Serializable 제한 적용

여기서 많이 하는 실수가 "모든 경쟁은 락으로 해결" 또는 반대로 "버전 컬럼만 있으면 다 된다"입니다. 실제로는 도메인별로 불변식 모양이 달라서 전략도 달라져야 합니다.

### 4) 운영 지표 최소 세트

세 전략을 썼다면 아래 지표는 최소로 보는 편이 좋습니다.

- `conflict_rate`
- `lock_wait_p95`, `lock_wait_timeout_rate`
- `retry_success_rate`
- `rows_affected_zero_rate` (Atomic Update 실패율)
- `deadlock_count`
- `duplicate_effect_detected`

Atomic Update에서는 `rows_affected_zero_rate` 해석이 특히 중요합니다. 이 수치가 갑자기 오르면 진짜 재고 부족인지, 경쟁이 심해진 것인지, 조건식이 과도한지 구분해야 합니다. Optimistic Lock은 retry 성공률을, Pessimistic Lock은 lock wait와 deadlock을 먼저 봐야 판단이 빨라집니다.

### 5) 2주 도입 플레이북

**1주차**
- 충돌이 잦은 쓰기 경로 5개를 고릅니다.
- 각 경로를 `단일 행 규칙`, `상태 전이`, `집합 불변식`, `사람 개입 긴 편집`으로 분류합니다.
- 현재 충돌률, retry 성공률, lock wait를 측정합니다.

**2주차**
- 단일 행 규칙 1개는 Atomic Update로 바꿔 봅니다.
- 긴 편집 경로 1개는 Optimistic Lock 충돌 UX를 다듬습니다.
- 오류 비용이 큰 경로 1개는 짧은 Pessimistic Lock 또는 제약조건으로 보호합니다.
- 이후 지표를 비교해 어떤 비용이 실제로 줄었는지 확인합니다.

## 트레이드오프/주의점

첫째, **Optimistic Lock은 충돌이 적을 때만 낙관적입니다.** 충돌률이 높아지면 사용자는 저장 실패를 반복해서 보게 되고, 운영자는 재시도 폭증을 보게 됩니다.

둘째, **Pessimistic Lock은 안전해 보여도 긴 트랜잭션과 만나면 바로 병목이 됩니다.** 트랜잭션 안에서 외부 API를 부르거나 여러 테이블을 넓게 잡으면 lock wait가 본체가 됩니다.

셋째, **Atomic Update는 단순하지만, 애플리케이션이 성공/실패 분기를 엄격하게 처리해야 합니다.** 영향 행 수 0을 그냥 일반 오류로 넘기면 재고 부족과 시스템 오류가 섞여 버립니다.

넷째, **집합 불변식은 셋 중 하나만으로 닫히지 않는 경우가 많습니다.** 이때는 제약조건, aggregate row, Serializable, [Advisory Lock](/learning/deep-dive/deep-dive-advisory-locks-coordination-playbook/), [멱등성](/learning/deep-dive/deep-dive-idempotency/)를 조합해야 합니다.

다섯째, **동시성 제어는 DB 안에서 끝나지 않습니다.** API 레벨 중복 요청, 큐 재처리, 외부 결제 재시도까지 연결되므로 [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/)와 [Timeout/Retry/Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/)를 같이 봐야 운영이 닫힙니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 이 규칙이 단일 행 조건으로 닫히는지 먼저 확인했다.
- [ ] 충돌률, lock wait, retry 성공률을 실제 숫자로 측정했다.
- [ ] 사람 개입이 긴 경로에 비관적 락을 무심코 적용하지 않았다.
- [ ] Atomic Update 실패와 시스템 오류를 다른 코드 경로로 처리한다.
- [ ] 초과 판매, 중복 승인 같은 고비용 경로는 사전 차단 전략을 우선 검토했다.
- [ ] 집합 불변식 경로는 제약조건 또는 aggregate row 모델링을 같이 검토했다.

### 연습 과제

1. 현재 서비스의 쓰기 경로 5개를 골라 `단일 행 규칙 / 상태 전이 / 집합 불변식 / 긴 편집`으로 분류해 보세요.
2. 그중 1개는 Atomic Update로 바꿀 수 있는지 SQL 수준에서 다시 써 보세요.
3. 충돌률이 가장 높은 경로 1개를 골라 Optimistic Lock 재시도와 Pessimistic Lock 대기 중 어느 비용이 더 큰지 추정해 보세요.
4. 최근 중복 처리 사고나 초과 판매 사고가 있었다면, 그 경로가 실제로 어떤 전략을 택했어야 했는지 포스트모템 형태로 적어 보세요.

## 관련 글

- [Snapshot Isolation, Serializable, Write Skew 실무 판단 플레이북](/learning/deep-dive/deep-dive-snapshot-isolation-serializable-write-skew-playbook/)
- [DB Lock Contention 대응 플레이북](/learning/deep-dive/deep-dive-database-locking-contention-playbook/)
- [MySQL 트랜잭션 격리 수준과 락](/learning/deep-dive/deep-dive-mysql-isolation-locks/)
- [멱등성 설계와 중복 요청 제어](/learning/deep-dive/deep-dive-idempotency/)
- [Advisory Lock 실무 플레이북](/learning/deep-dive/deep-dive-advisory-locks-coordination-playbook/)
- [백엔드 데이터 시스템 단계](/learning/modules/backend-data-system-phase/)
