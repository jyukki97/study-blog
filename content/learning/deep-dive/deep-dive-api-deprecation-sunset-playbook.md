---
title: "백엔드 커리큘럼 심화: API Deprecation과 Sunset 운영 플레이북"
date: 2026-05-15
draft: false
topic: "Backend API Operations"
tags: ["API Design", "API Versioning", "Deprecation", "Backward Compatibility", "Contract Testing", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "API를 없애거나 바꿀 때 클라이언트 장애를 만들지 않도록 deprecation notice, sunset window, 호환성 게이트, 관측 지표를 숫자 기준으로 운영하는 방법을 정리합니다."
module: "backend-api"
study_order: 1232
key_takeaways:
  - "API deprecation은 코드 삭제가 아니라 사용자와 시스템 계약을 단계적으로 종료하는 운영 절차다."
  - "Sunset window는 트래픽 크기보다 클라이언트 배포 가능성, 계약 책임, 장애 비용을 먼저 보고 정해야 한다."
  - "제거 전에는 client_id 기준 사용량, successor API contract test, 410/allowlist/route-back 롤백 경로를 함께 검증해야 한다."
operator_checklist:
  - "제거 대상 endpoint, owner, replacement, deprecated date, sunset date, removal target을 한 문서에 고정한다."
  - "최근 30일/90일 사용량을 client_id, app_version, partner_id, auth principal 기준으로 확인한다."
  - "응답 헤더와 로그/메트릭으로 실제 호출자에게 deprecation 경고가 도달하는지 검증한다."
  - "대체 API의 contract test 또는 golden response fixture가 known consumer별로 통과하는지 확인한다."
  - "차단은 gateway rule, feature flag, allowlist 중 하나로 단계 제어하고, removal 당일 410 응답률과 support ticket을 모니터링한다."
learning_refs:
  - title: "API 버전 관리"
    href: "/learning/deep-dive/deep-dive-api-versioning/"
    description: "버전 전략과 호환성 정책을 먼저 잡아야 deprecation 범위와 successor API 책임을 정할 수 있습니다."
  - title: "Consumer-Driven Contract Testing"
    href: "/learning/deep-dive/deep-dive-consumer-driven-contract-testing/"
    description: "기존 consumer가 쓰던 의미를 대체 API가 보존하는지 검증하는 기준으로 함께 읽기 좋습니다."
  - title: "Feature Flag"
    href: "/learning/deep-dive/deep-dive-feature-flags/"
    description: "코드 배포와 실제 차단 정책을 분리해 sunset rollout을 단계적으로 제어하는 방법을 연결합니다."
  - title: "배포 런북"
    href: "/learning/deep-dive/deep-dive-deployment-runbook/"
    description: "Removal 당일의 관측, 롤백, 커뮤니케이션 절차를 런북 형태로 고정할 때 참고할 글입니다."
decision_guide:
  cases:
    - badge: "빠른 종료"
      title: "같은 팀이 관리하는 내부 API"
      fit: "consumer와 producer가 같은 릴리스 캘린더를 쓰고, 30일 사용량과 owner가 모두 확인된 경우"
      watchouts: "배치나 테스트 환경 호출이 access log에서 빠지지 않았는지 확인해야 합니다."
      next_step: "1~2주 sunset window와 route-back flag를 두고 shadow reject부터 켭니다."
    - badge: "장기 전환"
      title: "모바일 앱 또는 외부 파트너 API"
      fit: "클라이언트 배포 주기가 느리거나 계약/문서/심사 절차가 필요한 경우"
      watchouts: "트래픽이 낮아도 결제, 정산, 인증 흐름이면 제거 비용이 큽니다."
      next_step: "3~12개월 window, owner별 readiness tracker, 임시 allowlist 정책을 함께 운영합니다."
    - badge: "보류"
      title: "대체 API의 의미가 아직 맞지 않는 경우"
      fit: "successor API가 필드 의미, 정렬, pagination, 시간대, 에러 코드를 완전히 대체하지 못하는 경우"
      watchouts: "버전만 올린 상태에서 제거하면 클라이언트 장애를 API 팀이 만든 셈이 됩니다."
      next_step: "contract fixture와 migration guide를 먼저 보강하고 sunset date 대신 재검토 날짜를 둡니다."
faqs:
  - question: "Deprecated라고 표시했으면 바로 삭제해도 되나요?"
    answer: "아니요. Deprecated는 새 사용을 막는 신호일 뿐이고, 실제 삭제는 사용량 확인, 대체 API 검증, sunset 공지, 롤백 경로가 준비된 뒤 진행해야 합니다."
  - question: "사용량이 거의 0이면 sunset window를 생략해도 되나요?"
    answer: "대부분은 생략하지 않는 편이 안전합니다. 월말 배치, 파트너 연동, 특정 앱 버전처럼 짧은 관측 기간에 보이지 않는 호출이 있을 수 있어 최소 30일/90일 기준으로 확인해야 합니다."
  - question: "404와 410 중 어떤 응답이 더 적절한가요?"
    answer: "의도적으로 종료한 API라면 410 Gone이 더 적절합니다. 클라이언트가 오타나 일시 장애가 아니라 종료된 계약임을 알 수 있고, replacement와 docs를 함께 안내할 수 있습니다."
---

API를 설계할 때는 새 엔드포인트를 만드는 이야기보다 없애는 이야기가 더 어렵습니다. 새 API는 내부 팀이 준비되면 열 수 있지만, 기존 API는 이미 누군가의 배치, 모바일 앱, 파트너 연동, 오래된 백오피스 화면에 박혀 있을 수 있습니다. 그래서 API 제거는 단순한 코드 삭제가 아니라 **사용자와 시스템의 계약을 종료하는 운영 절차**입니다.

백엔드 실무에서 API deprecation은 "문서에 deprecated라고 써두기"로 끝나지 않습니다. 언제부터 경고할지, 어느 클라이언트가 아직 쓰는지, 어떤 버전은 얼마나 더 유지할지, 강제 차단 전에 어떤 지표를 볼지 정해야 합니다. 이 글은 [API 버전 관리](/learning/deep-dive/deep-dive-api-versioning/), [Consumer-Driven Contract Testing](/learning/deep-dive/deep-dive-consumer-driven-contract-testing/), [Feature Flag](/learning/deep-dive/deep-dive-feature-flags/), [배포 런북](/learning/deep-dive/deep-dive-deployment-runbook/)을 API 종료 관점으로 묶어 정리합니다.

## 이 글에서 얻는 것

- API deprecation, sunset, removal을 구분하고 각 단계에서 해야 할 일을 설명할 수 있습니다.
- 사용량·클라이언트 분포·계약 중요도 기준으로 sunset window를 숫자로 잡을 수 있습니다.
- 호환성 레이어, 경고 헤더, 관측 지표, 차단 플래그를 조합해 API 제거 리스크를 낮출 수 있습니다.
- "바로 삭제", "장기 유지", "호환 변환", "새 버전 강제" 중 어떤 선택이 맞는지 의사결정 기준을 세울 수 있습니다.

## 핵심 개념/이슈

### 1) Deprecation은 제거가 아니라 제거 예고다

Deprecation은 "이 API는 앞으로 권장하지 않는다"는 상태입니다. 아직 동작해야 합니다. Sunset은 "이 날짜 이후에는 동작을 보장하지 않는다"는 종료 일정입니다. Removal은 실제 코드와 라우팅을 제거하거나 요청을 차단하는 단계입니다. 이 세 단계를 섞으면 사고가 납니다.

실무에서는 아래처럼 상태를 나눠 두는 편이 안전합니다.

| 상태 | 의미 | 클라이언트 영향 | 운영 액션 |
| --- | --- | --- | --- |
| Active | 정상 지원 | 없음 | 일반 변경 관리 |
| Deprecated | 새 사용 금지, 기존 사용 허용 | 경고 노출 | 문서/헤더/로그 경고, 대체 API 안내 |
| Sunset Scheduled | 종료일 확정 | 이전 계획 필요 | 클라이언트별 사용량 추적, 마이그레이션 캠페인 |
| Restricted | 일부 클라이언트 차단 또는 write 금지 | 기능 제한 | allowlist, feature flag, rate limit 적용 |
| Removed | 더 이상 지원하지 않음 | 실패 응답 | 410 Gone, 문서 제거, 코드 정리 |

중요한 점은 deprecated 상태가 removal의 면죄부가 아니라는 것입니다. 사용자가 아직 남아 있는데 코드만 지우면 API 팀의 정리가 아니라 장애입니다. 특히 모바일 앱, 외부 파트너, 임베디드 장비처럼 배포 주기가 느린 클라이언트는 서버 팀의 릴리스 속도로 움직이지 않습니다.

### 2) 사용량이 0처럼 보여도 실제 0이 아닐 수 있다

API 제거 전 가장 흔한 실수는 access log만 보고 "아무도 안 쓰네"라고 판단하는 것입니다. 로그 샘플링, CDN 캐시, 프록시 경유, 배치 주기, 지역별 트래픽 차이 때문에 실제 사용량이 가려질 수 있습니다. 특히 월 1회 정산 배치나 분기별 리포트 API는 일주일만 보면 0처럼 보입니다.

제거 후보 API는 최소 아래 지표를 함께 봐야 합니다.

- 최근 **30일/90일** 요청 수와 고유 클라이언트 수
- 인증 주체별 사용량: user, service account, partner, mobile app version
- 응답 코드 분포: 2xx, 4xx, 5xx, timeout
- 호출 시간대와 주기: 매일, 매주, 월말, 배치 window
- downstream 영향: DB, 메시지 발행, 외부 API 호출 여부
- 대체 API 사용 전환율

기준은 API 성격에 따라 다르지만, 외부 공개 API는 최소 90일, 내부 서비스 API도 최소 30일은 보는 편이 안전합니다. 요청 수가 낮아도 결제, 권한, 정산, 알림처럼 비즈니스 영향이 큰 API는 단순 트래픽 기준으로 삭제하면 안 됩니다.

### 3) Sunset window는 배포 주기와 계약 책임으로 정한다

모든 API를 1년씩 유지할 필요는 없습니다. 반대로 모든 API를 2주 만에 없앨 수도 없습니다. 핵심은 클라이언트가 실제로 바꿀 수 있는 시간입니다.

초기 기준은 아래처럼 잡을 수 있습니다.

| API 종류 | 권장 sunset window | 이유 |
| --- | --- | --- |
| 같은 저장소 내부 API | 1~2주 | producer/consumer를 한 팀이 조정 가능 |
| 사내 서비스 간 API | 4~8주 | 배포 일정과 회귀 테스트 필요 |
| 웹 프론트엔드 전용 API | 2~4주 | 강제 배포가 비교적 쉬움 |
| 모바일 앱 API | 3~6개월 | 앱 심사, 사용자 업데이트 지연 존재 |
| 외부 파트너 API | 6~12개월 | 계약·문서·파트너 개발 일정 필요 |
| 결제/정산/인증 API | 영향도에 따라 별도 승인 | 장애 비용이 크고 롤백이 어렵다 |

의사결정 우선순위는 **계약 영향 > 클라이언트 배포 가능성 > 트래픽 크기 > 코드 정리 이득** 순서가 좋습니다. 호출량이 작아도 외부 파트너가 쓰고 있으면 긴 window가 필요합니다. 반대로 호출량이 커도 같은 팀이 관리하는 내부 프론트엔드라면 짧게 가져갈 수 있습니다.

### 4) 경고는 문서보다 런타임에서 더 잘 전달된다

문서 업데이트는 필요하지만 충분하지 않습니다. 실제 호출하는 클라이언트가 경고를 받아야 합니다. HTTP API라면 응답 헤더를 적극적으로 쓰는 편이 좋습니다.

예시는 아래와 같습니다.

```http
Deprecation: true
Sunset: Fri, 31 Jul 2026 23:59:59 GMT
Link: </docs/api/v2/orders>; rel="successor-version"
Warning: 299 - "This endpoint will be removed on 2026-07-31. Use /v2/orders."
```

여기에 애플리케이션 로그와 metrics를 붙입니다.

```text
api.deprecated.request.count{endpoint="/v1/orders", client_id="partner-a"}
api.deprecated.unique_clients{endpoint="/v1/orders"}
api.sunset.days_remaining{endpoint="/v1/orders"}
api.successor.adoption_ratio{from="/v1/orders", to="/v2/orders"}
```

경고는 너무 조용해도 문제고 너무 시끄러워도 문제입니다. 운영 로그에 모든 요청마다 error를 남기면 노이즈가 됩니다. 추천은 첫 2주는 info, sunset 30일 전부터 warning, 7일 전부터 클라이언트 owner에게 직접 알림을 보내는 식입니다. API 응답 헤더는 매 요청에 넣되, 서버 로그는 rate limit을 걸어 집계 중심으로 남기는 편이 낫습니다.

### 5) 호환성 레이어는 부채지만, 삭제 사고보다 싸다

새 API와 옛 API의 데이터 모델이 조금 다를 때는 compatibility adapter를 둘 수 있습니다. 예를 들어 `/v1/orders`는 `status: "PAID"`를 반환하고 `/v2/orders`는 `payment.status: "captured"`를 반환한다면, 일정 기간 v1 응답을 v2 모델에서 변환해 줄 수 있습니다.

호환성 레이어를 둘 때의 원칙은 세 가지입니다.

1. **단방향 변환만 허용**: v1을 유지하기 위해 v2 내부 모델을 계속 오염시키지 않는다.
2. **만료일을 코드와 설정에 박는다**: adapter에 owner, removal date, 지표를 둔다.
3. **새 기능은 old API에 추가하지 않는다**: deprecated API는 안정화 상태이지 성장 대상이 아니다.

호환성 레이어는 오래 살수록 부채가 됩니다. 하지만 클라이언트 전환 기간 동안 장애를 막아주는 보험이기도 합니다. [API Composition과 Aggregation](/learning/deep-dive/deep-dive-api-composition-aggregation-playbook/)처럼 여러 downstream을 묶는 API라면 호환성 레이어가 단순 필드 변환보다 복잡해질 수 있으므로, 변환 비용과 유지 기간을 숫자로 관리해야 합니다.

## 실무 적용

### 1) Deprecation RFC를 작게라도 만든다

API 종료는 작은 변경처럼 보여도 영향 범위가 넓습니다. 최소 RFC에는 아래 항목이 있어야 합니다.

```text
Endpoint: DELETE /v1/orders/{id}
Replacement: POST /v2/order-cancellations
Owner: order-platform
Reason: cancellation audit trail and policy validation
Deprecated from: 2026-05-15
Sunset date: 2026-08-31
Removal target: 2026-09-15
Known clients: web-admin, partner-a, settlement-batch
Risk class: medium/high
Rollback: feature flag route-back to legacy handler
Success metric: v1 traffic < 0.1% of order write traffic for 14 consecutive days
```

RFC가 거창할 필요는 없습니다. 핵심은 "왜 없애는가", "누가 쓰는가", "언제 실패하기 시작하는가", "되돌릴 수 있는가"를 한곳에 모으는 것입니다. 이 문서가 있어야 배포 중 문제가 생겨도 판단이 빨라집니다.

### 2) 단계별 롤아웃을 feature flag로 제어한다

API 제거는 코드 배포와 정책 적용을 분리하는 편이 안전합니다. 코드는 미리 배포하고, 실제 차단은 feature flag나 gateway rule로 천천히 켭니다.

권장 순서는 아래입니다.

1. **Observe mode**: 아무 동작도 바꾸지 않고 사용량만 측정한다.
2. **Warn mode**: 응답 헤더와 로그에 deprecation 경고를 넣는다.
3. **Shadow reject**: 차단했을 경우 실패했을 요청을 집계하지만 실제로는 통과시킨다.
4. **Canary restrict**: 내부 클라이언트나 1% 트래픽부터 410/403을 반환한다.
5. **Client allowlist**: 전환 완료 클라이언트는 차단, 미전환 핵심 클라이언트는 임시 허용한다.
6. **Full removal**: 라우팅과 legacy handler를 제거한다.

이 흐름은 [Feature Flag](/learning/deep-dive/deep-dive-feature-flags/)와 [배포 런북](/learning/deep-dive/deep-dive-deployment-runbook/)의 기본 원칙과 같습니다. 위험한 변경은 배포 시점에 한 번에 터뜨리지 않고, 관측 가능한 정책 변경으로 쪼갭니다.

### 3) Contract test로 successor API를 검증한다

기존 API를 없애려면 대체 API가 실제로 같은 업무를 처리할 수 있어야 합니다. 문서상 대체가 아니라 consumer 관점의 대체여야 합니다. 그래서 consumer-driven contract test가 중요합니다.

예를 들어 파트너가 `/v1/invoices`에서 아래 필드를 사용하고 있었다면:

```json
{
  "invoiceId": "inv_123",
  "amount": 12000,
  "currency": "KRW",
  "paidAt": "2026-05-15T10:00:00+09:00"
}
```

`/v2/billing/invoices`가 같은 의미를 제공하는지 contract test로 확인해야 합니다. 필드명이 바뀌어도 괜찮지만 의미가 사라지면 안 됩니다. 특히 금액 단위, 시간대, nullable 정책, 정렬 순서, pagination 방식은 깨지기 쉽습니다.

대체 API 전환 완료 기준은 아래처럼 잡을 수 있습니다.

- 알려진 consumer의 contract test 통과율 **100%**
- v1 대비 v2 응답 의미 차이 documented exception **0~N개** 명시
- 전환 대상 클라이언트의 v2 error rate가 v1 대비 **1.2배 이하**
- 핵심 endpoint의 p95 latency가 v1 대비 **150% 이하** 또는 명시적 예외 승인
- pagination/cursor/정렬 기준 변경 시 샘플 데이터 비교 테스트 통과

Contract test가 없으면 전환은 결국 "문서 보고 바꿔주세요"가 됩니다. 내부 API라도 최소한 golden response fixture를 남겨야 제거 후 회귀를 잡을 수 있습니다.

### 4) 관측 대시보드는 endpoint가 아니라 client 기준으로 본다

API deprecation 대시보드는 endpoint별 요청 수만 보면 부족합니다. 제거 결정은 "누가 아직 남았는가"를 알아야 하기 때문입니다. 최소한 아래 차원이 필요합니다.

- endpoint, method, version
- client_id, app_version, user_agent, partner_id
- auth principal type: user/service/partner
- region, environment
- response code, latency, error class
- replacement endpoint adoption

예를 들어 `/v1/orders` 요청이 하루 10만 건에서 1만 건으로 줄었다고 해도, 남은 1만 건이 특정 대형 파트너 한 곳이면 제거하면 안 됩니다. 반대로 100개 클라이언트가 각각 테스트 환경에서 몇 번 호출하는 수준이면 차단을 앞당길 수 있습니다.

초기 알림 기준은 이렇게 잡을 수 있습니다.

- sunset 60일 전: known client owner에게 전환 일정 요청
- sunset 30일 전: 미전환 client_id가 **5개 이상**이면 리스크 리뷰
- sunset 14일 전: 핵심 client 미전환 시 sunset 연기 또는 allowlist 결정
- sunset 7일 전: deprecated traffic이 전체 endpoint traffic의 **1% 이상**이면 full removal 금지
- removal 당일: 410 응답률, support ticket, error budget burn을 30분 단위로 확인

### 5) 실패 응답도 마이그레이션 도구다

제거 후 404를 반환하면 클라이언트 입장에서는 "경로가 틀렸나? 서버 버그인가?"를 구분하기 어렵습니다. 의도적으로 제거한 API는 410 Gone을 쓰고, 가능한 경우 대체 경로를 함께 알려주는 편이 좋습니다.

```json
{
  "error": "endpoint_sunset",
  "message": "This endpoint was sunset on 2026-08-31.",
  "replacement": "/v2/order-cancellations",
  "docs": "https://example.com/docs/api-migration/orders-v2",
  "requestId": "req_abc123"
}
```

실패 응답에는 requestId가 있어야 지원팀과 API 팀이 같은 요청을 추적할 수 있습니다. 단, 민감한 내부 정책이나 client별 사용량을 응답에 노출하면 안 됩니다. 에러는 친절해야 하지만 과도하게 상세하면 보안 정보가 됩니다.

## 트레이드오프/주의점

### 1) 너무 긴 deprecation은 플랫폼을 늙게 만든다

호환성을 지키는 것은 중요하지만, 영원한 v1 지원은 비용이 큽니다. 오래된 API는 인증 방식, 데이터 모델, 에러 코드, pagination, rate limit 정책이 새 기준과 어긋날 가능성이 높습니다. 신규 기능을 만들 때마다 legacy 분기를 넣으면 개발 속도가 느려지고 테스트 매트릭스가 폭발합니다.

그래서 sunset 없는 deprecation은 피해야 합니다. 정말 종료일을 못 박기 어렵다면 최소한 재검토 날짜를 둡니다. 예를 들어 "2026-08-31 sunset"이 어렵다면 "2026-08-31에 usage와 client readiness로 재승인"처럼 관리해야 합니다. 무기한 deprecated는 사실상 active와 다르지 않습니다.

### 2) 너무 빠른 removal은 신뢰를 깎는다

반대로 빠른 삭제는 팀 신뢰를 크게 해칩니다. API는 사용자의 코드와 연결된 계약입니다. 특히 외부 파트너 API에서 예고 없는 removal이 발생하면 기술 부채 정리보다 관계 비용이 더 큽니다. 내부에서도 플랫폼 팀이 임의로 API를 없앤다는 인식이 생기면, 다음 변경부터 팀들이 비공식 우회로를 만들기 시작합니다.

삭제를 앞당기고 싶다면 세 가지 조건이 필요합니다.

- known client가 모두 전환했거나 owner가 명시적으로 승인했다.
- 30일 이상 deprecated traffic이 실질적으로 0에 가깝다.
- 410/route-back/allowlist 같은 복구 수단이 준비되어 있다.

이 조건 없이 "코드가 복잡해서"만으로 제거하면 운영 리스크가 큽니다.

### 3) 버전만 올리면 문제가 해결되는 것은 아니다

`/v2`를 만들었다고 deprecation이 자동으로 끝나지는 않습니다. v2가 더 느리거나, 필드 의미가 애매하거나, migration guide가 부족하면 클라이언트는 전환하지 않습니다. API 팀이 봐야 할 것은 "새 버전 출시"가 아니라 "업무 흐름 전환 완료"입니다.

특히 아래 변경은 문서만으로는 부족합니다.

- offset pagination에서 cursor pagination으로 변경
- sync API에서 async request-reply로 변경
- enum 값의 의미 변경
- monetary amount 단위 변경
- timezone 기준 변경
- nullable 필드의 required 전환

이런 변경은 샘플 코드, 변환 가이드, contract fixture, staged rollout을 같이 제공해야 합니다.

### 4) Gateway 차단과 애플리케이션 제거는 다른 단계다

API Gateway에서 먼저 차단하면 애플리케이션 코드를 건드리지 않고 removal 효과를 볼 수 있습니다. 하지만 gateway rule만 제거하고 코드가 남아 있으면 테스트 환경이나 내부 경로에서 다시 살아날 수 있습니다. 반대로 애플리케이션 코드를 먼저 지우면 gateway allowlist로 되돌리기 어렵습니다.

추천은 **gateway restrict → 관측 → 애플리케이션 removal → gateway rule cleanup** 순서입니다. 이렇게 하면 차단을 되돌릴 수 있는 기간을 확보하면서도 최종 부채 정리까지 갈 수 있습니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] 제거 대상 API의 owner, replacement, sunset date가 문서화되어 있다.
- [ ] 최근 30일/90일 사용량을 client_id, app_version, partner_id 기준으로 확인했다.
- [ ] 응답 헤더 또는 런타임 경고로 deprecation이 실제 호출자에게 전달된다.
- [ ] 대체 API의 contract test 또는 golden response 비교가 준비되어 있다.
- [ ] sunset 30일 전 미전환 클라이언트 목록과 owner가 확인된다.
- [ ] removal은 feature flag, gateway rule, allowlist 중 하나로 단계 제어 가능하다.
- [ ] 410 Gone 응답에 replacement, docs, requestId가 포함된다.
- [ ] 제거 후 30~60분 동안 error rate, ticket, deprecated traffic을 모니터링한다.
- [ ] legacy handler와 문서, SDK, 샘플 코드까지 정리하는 후속 작업이 잡혀 있다.

### 연습: `/v1/search`를 없애야 한다면

상황을 가정해 봅시다. `/v1/search`는 offset pagination을 쓰고, `/v2/search`는 cursor pagination과 relevance score를 제공합니다. v1은 하루 20만 건 호출되고, 그중 70%는 웹 프론트엔드, 20%는 모바일 앱, 10%는 외부 파트너입니다. 서버 팀은 6주 안에 v1 코드를 지우고 싶어 합니다.

이때 바로 6주 sunset을 잡으면 위험합니다. 웹 프론트엔드는 2~4주 안에 전환할 수 있지만, 모바일 앱과 외부 파트너는 더 길게 봐야 합니다. 합리적인 계획은 아래에 가깝습니다.

1. 오늘부터 deprecation header와 usage dashboard를 켠다.
2. 웹 프론트엔드는 4주 안에 v2 전환을 목표로 한다.
3. 모바일 앱은 최소 3개월 window를 둔다.
4. 외부 파트너는 계약 조건을 확인하고 6개월 또는 별도 allowlist를 검토한다.
5. 서버 코드는 v2 기반 adapter로 v1 응답을 만들어 내부 중복을 줄인다.
6. v1 full removal은 deprecated traffic이 1% 미만이고 known client가 모두 전환된 뒤 실행한다.

핵심은 코드 삭제 일정이 아니라 클라이언트 전환 가능성을 기준으로 계획을 나누는 것입니다. API deprecation을 잘하는 팀은 오래된 코드를 무작정 끌고 가지도, 사용자 계약을 무시하고 지우지도 않습니다. 숫자와 단계로 종료합니다.

## 실전 점검 예시: removal 회의에서 바로 물어볼 질문

API 제거 승인 회의에서는 "코드가 준비됐는가"보다 "실패해도 통제 가능한가"를 먼저 확인해야 합니다. 아래 질문에 답하지 못하면 removal은 아직 이릅니다.

| 질문 | 좋은 답변의 형태 | 부족한 답변의 신호 |
| --- | --- | --- |
| 누가 아직 호출하는가? | client_id, app_version, partner_id별 30일/90일 표 | "로그상 거의 없습니다" |
| 대체 API가 같은 업무를 처리하는가? | consumer별 contract test와 차이 목록 | "문서에 v2 쓰라고 적었습니다" |
| 차단을 되돌릴 수 있는가? | gateway rule off, route-back flag, allowlist 절차 | "코드를 되돌리면 됩니다" |
| 장애를 어떻게 볼 것인가? | 410 rate, deprecated traffic, ticket, error budget burn | "모니터링 보겠습니다" |
| 커뮤니케이션은 끝났는가? | owner별 승인 또는 미전환 예외 승인 | "공지했습니다" |

실무에서는 답변의 구체성이 곧 리스크 수준입니다. 숫자와 owner가 있는 답변은 운영 가능한 계획에 가깝고, 형용사만 있는 답변은 사고 가능성이 높습니다.

### 제거 승인 기준 샘플

다음 기준을 모두 만족하면 full removal 후보로 올릴 수 있습니다.

- Deprecated traffic이 전체 successor 업무 흐름 대비 **1% 미만**이고, 핵심 client 미전환이 없다.
- Known consumer의 contract test 또는 golden response 비교가 **100% 통과**한다.
- 410 Gone 응답에 replacement, docs, requestId가 포함되어 있다.
- Route-back 또는 allowlist가 최소 **24~72시간** 유지 가능하다.
- Removal 당일 30분 단위로 볼 지표와 담당자가 정해져 있다.

반대로 하나라도 불확실하면 removal date를 고집하기보다 restricted 단계에서 더 관측하는 편이 낫습니다. API 종료의 목표는 오래된 코드를 빨리 지우는 것이 아니라, 사용자 계약을 깨지 않고 플랫폼 부채를 줄이는 것입니다.
