---
title: "백엔드 커리큘럼 심화: 결정론적 시간 설계 — Clock 주입, UTC 저장, 경계 테스트 플레이북"
date: 2026-11-01T10:06:00+09:00
lastmod: 2026-11-01T10:06:00+09:00
draft: false
topic: "Backend Reliability"
tags: ["Backend", "Time", "Java", "Testing", "UTC", "Reliability"]
categories: ["Backend Deep Dive"]
description: "서버의 현재 시간을 전역 함수로 읽지 않고 Clock·UTC·업무 시간대·경계 테스트로 분리해 마감, 만료, 재시도, 정산 로직을 재현 가능하게 만드는 방법을 정리합니다."
module: "backend-advanced-cs"
study_order: 1469
key_takeaways:
  - "시간은 단순한 문자열이 아니라 이벤트 시각, 처리 시각, 업무 기준일, 시간대라는 서로 다른 계약의 조합이다."
  - "도메인 판단에는 주입 가능한 Clock을 쓰고, 저장에는 Instant(UTC), 표시·마감 계산에는 명시적인 IANA ZoneId를 쓴다."
  - "자정, 월말, DST 전환, 지연 재시도는 별도 테스트 행렬로 다뤄야 하며 happy path의 현재 시간 테스트만으로는 부족하다."
  - "모든 코드에 가상 시간을 넣기보다 금전·권한·만료·스케줄처럼 시간 경계가 결과를 바꾸는 흐름부터 우선 적용한다."
learning_refs:
  - title: "Time Zone과 i18n 처리"
    href: "/learning/deep-dive/deep-dive-timezone-i18n-handling/"
    description: "시간대와 로컬 날짜를 API·표시 계층까지 안전하게 전달하는 기본기를 보강합니다."
  - title: "Clock Skew와 시간 의미론"
    href: "/learning/deep-dive/deep-dive-clock-skew-time-semantics-playbook/"
    description: "분산 환경에서 서로 다른 서버의 시계와 이벤트 시각을 어떻게 해석할지 연결합니다."
  - title: "Business Calendar와 마감 정책"
    href: "/learning/deep-dive/deep-dive-business-calendar-cutoff-policy-playbook/"
    description: "영업일·휴일·마감 시각처럼 도메인 달력이 필요한 경우의 모델을 다룹니다."
  - title: "Scheduler Misfire와 Backfill 제어"
    href: "/learning/deep-dive/deep-dive-scheduler-misfire-backfill-control-playbook/"
    description: "실행 시각과 처리해야 할 논리적 시각을 분리하는 배치 운영 기준입니다."
---

`Instant.now()`나 `new Date()`는 보기에는 무해합니다. 그러나 이 호출이 쿠폰 만료, 정산 마감, 토큰 검증, 예약 취소, 재시도 가능 시각을 결정하기 시작하면 서버의 “지금”은 외부 입력이 됩니다. 테스트는 실행한 순간에만 통과하고, 자정·월말·시간대 전환에서는 재현하기 어려운 버그가 생깁니다.

시간 문제를 피하는 핵심은 모든 값을 복잡한 시간 모델로 바꾸는 일이 아닙니다. **현재 시각을 얻는 일, 저장하는 일, 업무 날짜로 해석하는 일, 테스트에서 시간을 움직이는 일을 분리**하는 것입니다. 이 글은 [시간대 처리](/learning/deep-dive/deep-dive-timezone-i18n-handling/), [clock skew 의미론](/learning/deep-dive/deep-dive-clock-skew-time-semantics-playbook/), [업무 마감 정책](/learning/deep-dive/deep-dive-business-calendar-cutoff-policy-playbook/), [scheduler misfire와 backfill](/learning/deep-dive/deep-dive-scheduler-misfire-backfill-control-playbook/)을 실무 코드로 이어 주는 플레이북입니다.

## 이 글에서 얻는 것

- `Instant`, `LocalDate`, `ZonedDateTime`, DB의 `timestamptz`를 언제 각각 써야 하는지 구분할 수 있습니다.
- Spring/Java 서비스에서 `Clock`을 주입해 만료·마감·재시도 로직을 같은 입력으로 재현하는 방법을 배웁니다.
- 자정, 월말, 시간대 전환, 지연 이벤트를 포함한 최소 시간 테스트 행렬을 만들 수 있습니다.
- 시간 설계를 과하게 일반화하지 않고, 어떤 기능부터 고칠지 위험도 기준으로 우선순위를 정할 수 있습니다.

## 핵심 개념/이슈

### 1) “현재 시간”은 하나가 아니다

주문이 23:59:59에 생성됐고 worker가 00:00:03에 처리했다면 어느 날의 주문일까요? 사용자의 한국 업무일 기준으로는 전날일 수 있지만, DB 서버의 UTC 날짜는 다릅니다. 외부 결제사가 1분 늦게 webhook을 보냈다면 이벤트가 발생한 시각과 시스템이 안 시각도 다릅니다. 이 값을 하나의 `created_at`으로 뭉치면 나중에 재처리와 감사가 서로 다른 답을 냅니다.

| 시간 의미 | 대표 타입/컬럼 | 쓰는 곳 | 혼동했을 때의 문제 |
| --- | --- | --- | --- |
| 사건 발생 시각 | `event_occurred_at: Instant` | webhook, 로그, 원장 | 지연 도착을 현재 사건으로 오해 |
| 시스템 처리 시각 | `processed_at: Instant` | worker, 재시도, 관측 | 처리 지연을 원인 시각으로 착각 |
| 업무 기준일 | `business_date: LocalDate` + `ZoneId` | 마감, 일 정산, 예약 | UTC 자정에 고객의 날짜가 바뀜 |
| 표시 시각 | `ZonedDateTime` | UI, 이메일, 보고서 | 서버 시간대에 따라 화면이 달라짐 |

저장 시각은 가능한 한 `Instant` 또는 PostgreSQL의 `timestamptz`로 둡니다. 반면 “11월 1일 마감”처럼 날짜 자체가 계약인 값은 `LocalDate`만으로도 충분할 수 있습니다. 단, 그 날짜를 계산한 `Asia/Seoul` 같은 IANA 시간대와 cut-off 시각을 정책으로 함께 정해야 합니다. `LocalDateTime`은 시간대가 빠진 벽시계 값이라 외부 API 경계나 영구 저장의 기본값으로 쓰기에는 위험합니다.

### 2) 도메인 코드에서 벽시계를 직접 읽지 않는다

아래 두 구현은 같은 일을 하는 듯 보이지만 테스트 가능성이 다릅니다.

```java
// 피해야 할 형태: 실행한 순간이 곧 입력값이다.
boolean isExpired(Coupon coupon) {
    return coupon.expiresAt().isBefore(Instant.now());
}

// 권장: 시간도 의존성으로 받는다.
@Service
class CouponPolicy {
    private final Clock clock;

    CouponPolicy(Clock clock) {
        this.clock = clock;
    }

    boolean isExpired(Coupon coupon) {
        return !coupon.expiresAt().isAfter(Instant.now(clock));
    }
}
```

운영 프로필에는 `Clock.systemUTC()` 하나를 bean으로 등록하면 됩니다. 테스트에서는 `Clock.fixed(Instant.parse("2026-11-01T14:59:59Z"), ZoneOffset.UTC)`를 넣어 결과를 고정합니다. 여기서 중요한 결정은 만료 조건입니다. `isBefore(now)`는 정확히 만료 시각과 같은 요청을 허용하고, `!isAfter(now)`는 거부합니다. 정책을 코드와 테스트에 한 번만 쓰고, API 문서의 “만료 시각 포함 여부”와 맞춰야 합니다.

시간을 주입한다고 타이머까지 자동으로 가상화되는 것은 아닙니다. `@Scheduled`, queue visibility timeout, DB `now()`, 브라우저 시간은 별도 실행 주체입니다. 도메인 판단은 fixed clock 단위 테스트로, 실제 지연·재시도·락은 짧은 통합 테스트와 운영 지표로 나눠 확인하는 편이 현실적입니다.

### 3) 시간 경계는 정상 흐름보다 먼저 명세한다

시간 버그는 대개 평일 오후 3시 테스트에서 나오지 않습니다. 마감 1초 전후, 2월 말, 서버 재시작 뒤 지연된 이벤트처럼 경계에서만 드러납니다. 다음 기준을 PR의 최소 테스트 행렬로 둘 수 있습니다.

| 조건 | 꼭 확인할 질문 | 권장 판정 |
| --- | --- | --- |
| 마감 직전·정확한 마감·직후 | `<=`인지 `<`인지 | 세 시점 모두 명시적 assertion |
| UTC 날짜와 업무 날짜가 다른 시간 | 어느 기준일로 집계하는가 | `ZoneId` 고정 테스트 |
| 월말·윤년 | 다음 billing period가 존재하는가 | 달력 계산 API 사용, 일 수 하드코딩 금지 |
| DST gap/overlap 대상 지역 | 존재하지 않거나 두 번인 로컬 시각을 어떻게 처리하는가 | 입력 거부 또는 명시적 offset 선택 |
| 늦은 webhook·재시도 | 사건 시각과 처리 시각 중 어느 것을 기준으로 삼는가 | 두 컬럼 보존, 멱등 처리 |

한국 서비스라도 공급자, 파트너, 해외 사용자, 분석 파이프라인이 다른 시간대를 쓸 수 있습니다. “우리 서버는 KST니까 괜찮다”는 해결책이 아닙니다. 서버 환경 변수와 도메인 기준 시간대는 별개의 계약으로 관리해야 합니다.

## 실무 적용

### 1) 시간 의존성을 네 경계로 inventory한다

먼저 repository 전체를 바꾸지 말고 `now()`, `new Date()`, `System.currentTimeMillis()`, DB의 시간 함수 호출을 찾습니다. 다음 중 하나에 해당하면 우선 전환 대상입니다.

1. 결과가 금전·권한·삭제·공개 여부를 바꾼다.
2. 24시간 이내 만료, 예약, 마감처럼 한 시간의 차이가 사용자 결과를 바꾼다.
3. 장애 뒤 재시도·backfill에서 과거 시점을 다시 계산해야 한다.
4. 최근 30일에 시간대·자정 관련 CS나 재현 불가 테스트가 한 번이라도 있었다.

그다음 API controller가 아니라 도메인 service 경계에 `Clock`을 넣습니다. controller에서 받은 `requestedAt`을 무조건 신뢰하지 말고, 감사가 필요한 경우 서버 처리 시각과 요청이 주장한 사건 시각을 분리해 저장합니다. 외부 입력 시각은 미래 허용 범위(예: 5분)와 과거 허용 범위(예: 7일)를 도메인별로 검증해야 합니다.

### 2) UTC 저장과 업무 날짜 projection을 한 흐름으로 만든다

예를 들어 서울 기준 매일 15시에 마감하는 주문이 있다면, 주문 원장에는 `accepted_at timestamptz`를 저장하고 집계용 `business_date`는 명시적으로 계산합니다.

```java
Instant acceptedAt = Instant.now(clock);
ZoneId businessZone = ZoneId.of("Asia/Seoul");
LocalDate businessDate = acceptedAt.atZone(businessZone)
    .minusHours(15)
    .toLocalDate();
```

이 예시는 “15시 이전은 같은 날짜, 15시 이후는 다음 업무일”이라는 정책을 코드로 드러냅니다. 더 복잡한 휴일·영업일 규칙은 산술을 늘리지 말고 [business calendar](/learning/deep-dive/deep-dive-business-calendar-cutoff-policy-playbook/) 서비스로 승격하세요. 집계 query에서 매번 서버의 `timezone` 설정에 기대어 날짜를 만들면 replica, BI, backfill job마다 결과가 달라질 수 있습니다.

### 3) 관측성에는 시각의 역할을 함께 남긴다

장애 조사에서 `timestamp` 하나만 있으면 “언제 발생했는가”와 “언제 처리했는가”를 분리할 수 없습니다. 이벤트 기반 흐름에는 `event_occurred_at`, `received_at`, `processed_at`, `business_date`, `source_timezone`을 필요한 범위에서 기록합니다. 민감 데이터에 원문 시간을 과도하게 쌓을 필요는 없지만, 최소한 지연을 계산할 수 있는 두 시각은 남겨야 합니다.

운영 경보는 평균 지연보다 p95 또는 p99를 우선 봅니다. 예를 들어 webhook의 `received_at - event_occurred_at` p95가 5분을 넘거나, 마감 직후 10분에 전날 기준으로 들어온 주문 비율이 1%를 넘으면 재처리 정책을 점검하는 식입니다. 수치는 서비스 특성에 맞게 조정하되, “새벽에만 어긋난다”는 감각 대신 측정 가능한 기준을 둡니다.

## 트레이드오프/주의점

모든 함수에 `Clock`을 넘기면 코드가 장황해질 수 있습니다. 따라서 화면용 현재 시각, 단순 access log, 일회성 CLI 출력까지 일괄 변환할 필요는 없습니다. 판단 결과를 바꾸거나 재현해야 하는 도메인 경계부터 적용하는 것이 비용 대비 효과가 큽니다.

반대로 DB에서 `now()`를 완전히 금지하는 것도 과합니다. `created_at` 기본값, 원자적 lease 만료, DB 감사 트리거처럼 DB가 권위 있는 시각을 가져야 하는 경우가 있습니다. 이때는 애플리케이션 clock과 DB clock을 섞어 비교하지 말고, 어느 시계가 권위인지 정합니다. 둘의 차이가 1초를 넘으면 경보처럼, 허용 가능한 skew와 처리 규칙을 문서화하세요.

테스트의 fixed clock은 실제 scheduler 장애를 감추기도 합니다. 단위 테스트가 통과해도 queue 지연, NTP 문제, DST 정책, DB 시간대 설정은 통합·운영 단계에서 별도로 검증해야 합니다. 가상 시간은 현실을 대체하는 장치가 아니라, 도메인 규칙을 반복 가능하게 만드는 장치입니다.

## 체크리스트 또는 연습

- [ ] 만료·마감·권한·재시도 판단에서 전역 현재 시간 호출을 `Clock` 또는 명시적 입력으로 바꿨다.
- [ ] 영구 시각은 UTC `Instant`/`timestamptz`로 저장하고, 업무 날짜에는 IANA 시간대를 명시했다.
- [ ] 마감 직전·정확한 마감·직후 세 사례가 테스트에 있다.
- [ ] 월말, 윤년, 대상 지역의 DST gap/overlap 필요 여부를 도메인별로 판정했다.
