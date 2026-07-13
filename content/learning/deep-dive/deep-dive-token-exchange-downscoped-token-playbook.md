---
title: "백엔드 커리큘럼 심화: Token Exchange와 Downscoped Token, 서비스 간 권한을 좁혀 넘기는 법"
date: 2026-07-13
draft: false
topic: "Backend Security"
tags: ["OAuth2", "Token Exchange", "JWT", "Authorization", "Zero Trust", "Backend Security"]
categories: ["Backend Deep Dive"]
description: "사용자 토큰이나 넓은 서비스 계정 토큰을 그대로 전달하지 않고, 대상 서비스와 작업 범위에 맞는 짧은 수명의 downscoped token으로 바꾸는 실무 기준을 정리합니다."
summary: "서비스 간 호출에서 중요한 것은 인증 토큰을 전달하는 것이 아니라, 호출 목적에 맞게 audience, scope, TTL, actor를 좁힌 권한 계약을 만드는 것입니다."
module: "backend-security"
study_order: 1460
key_takeaways:
  - "Token Exchange는 사용자 토큰을 그대로 내부 서비스에 넘기는 패턴을 줄이고, 대상 서비스별 최소 권한 토큰을 발급하는 권한 축소 계층이다."
  - "Downscoped token은 audience 1개, 짧은 TTL, 좁은 scope, actor/subject 분리, 감사 가능한 exchange receipt가 핵심이다."
  - "토큰 교환은 보안만이 아니라 latency, cache, revocation, 정책 배포, 장애 fallback까지 포함한 운영 기능으로 설계해야 한다."
operator_checklist:
  - "서비스 간 호출별 audience, resource, scope, TTL, actor, subject claim을 표로 정리한다."
  - "사용자 원본 access token을 downstream에 그대로 전달하는 경로를 inventory로 만든다."
  - "교환 토큰 TTL은 기본 5~15분, 고위험 작업은 1~5분으로 시작하고 refresh token은 발급하지 않는다."
  - "token exchange 실패율, 발급 latency p95, denied scope, audience mismatch, token cache hit ratio를 관측한다."
learning_refs:
  - title: "OAuth2/OIDC 실무"
    href: "/learning/deep-dive/deep-dive-oauth2-oidc/"
    description: "OAuth2 grant, JWT 검증, introspection, OIDC claim 모델을 정리한 기반 글입니다."
  - title: "Spring Security OAuth2/JWT Practical"
    href: "/learning/deep-dive/deep-dive-spring-security-oauth2-jwt-practical/"
    description: "Spring에서 resource server와 JWT 검증을 구현하는 예시입니다."
  - title: "시크릿 관리"
    href: "/learning/deep-dive/deep-dive-secret-management/"
    description: "토큰, signing key, rotation, secret 저장소 운영 기준입니다."
  - title: "API Key Lifecycle"
    href: "/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/"
    description: "키 발급, 범위 제한, 회전, 폐기, abuse 대응을 다루는 플레이북입니다."
decision_guide:
  intro: "Token Exchange는 모든 내부 호출에 무조건 붙이는 장식이 아닙니다. 권한이 넓게 전달되거나, 사용자의 권한과 서비스의 권한을 구분해야 하거나, downstream이 명확한 audience 검증을 해야 할 때 우선 적용합니다."
  cases:
    - badge: "우선 적용"
      title: "사용자 토큰을 여러 내부 서비스에 그대로 전달한다"
      fit: "BFF, API gateway, aggregation service가 사용자 access token을 받아 결제, 파일, 관리자 서비스에 연쇄 호출하는 구조입니다."
      watchouts: "원본 토큰의 scope와 audience가 너무 넓으면 downstream 하나가 탈취돼도 다른 서비스까지 호출될 수 있습니다."
      next_step: "상위 10개 downstream 호출을 골라 audience별 downscoped token으로 바꿀 후보를 표시합니다."
    - badge: "부분 적용"
      title: "서비스 계정 토큰이 너무 넓다"
      fit: "worker나 batch가 하나의 service token으로 read/write/admin 작업을 모두 수행하는 구조입니다."
      watchouts: "토큰을 너무 잘게 쪼개면 정책 관리와 cache invalidation이 복잡해집니다."
      next_step: "write, export, delete, admin scope부터 별도 token exchange 정책으로 분리합니다."
    - badge: "보류 가능"
      title: "내부 단일 서비스와 낮은 위험 read-only 호출만 있다"
      fit: "mTLS와 네트워크 격리가 이미 있고, 호출 대상이 하나이며, 데이터 민감도가 낮은 초기 서비스입니다."
      watchouts: "나중에 downstream이 늘면 원본 토큰 전달 습관이 부채가 됩니다."
      next_step: "지금은 mTLS와 service account owner만 고정하고, 토큰 전달 inventory를 남깁니다."
faqs:
  - question: "Token Exchange를 쓰면 mTLS가 필요 없나요?"
    answer: "아닙니다. mTLS는 호출 주체와 채널을 확인하고, downscoped token은 호출 목적과 권한 범위를 확인합니다. 둘은 대체재가 아니라 서로 다른 경계입니다."
  - question: "JWT를 짧게 만들면 revocation 문제가 사라지나요?"
    answer: "완전히 사라지지 않습니다. TTL을 줄이면 노출 시간을 줄일 수 있지만, 고위험 권한은 introspection, denylist, policy version claim 같은 회수 경로가 필요합니다."
---

서비스가 작을 때는 인증 토큰 전달이 단순해 보입니다. API gateway가 사용자 access token을 받고, 내부 서비스가 그 토큰을 검증한 뒤 필요한 데이터를 조회합니다. 문제는 서비스가 늘어나면서 시작됩니다. 주문 서비스가 결제 서비스와 쿠폰 서비스와 파일 서비스를 호출하고, 관리자 화면이 사용자 토큰으로 export worker를 트리거하고, batch가 하나의 넓은 service token으로 여러 시스템을 건드립니다. 이때 원본 토큰을 그대로 넘기면 "누가 무엇을 위해 호출했는가"가 흐려지고, 토큰 하나가 탈취됐을 때 피해 반경도 커집니다.

Token Exchange와 downscoped token의 목적은 토큰을 더 많이 만드는 것이 아닙니다. **원래 가진 권한을 대상 서비스, 작업, 시간, 사용자 맥락에 맞게 좁혀서 넘기는 것**입니다. 이 글은 [OAuth2/OIDC 실무](/learning/deep-dive/deep-dive-oauth2-oidc/), [Spring Security OAuth2/JWT Practical](/learning/deep-dive/deep-dive-spring-security-oauth2-jwt-practical/), [시크릿 관리](/learning/deep-dive/deep-dive-secret-management/), [API Key Lifecycle](/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/)과 이어서 보면 좋습니다. 핵심은 인증 성공이 아니라, downstream 호출의 권한 계약을 작게 만드는 것입니다.

## 이 글에서 얻는 것

- 사용자 토큰 전달, 서비스 계정 토큰, Token Exchange의 차이를 구분할 수 있습니다.
- `subject`, `actor`, `audience`, `scope`, `resource`, `ttl`을 어떤 기준으로 설계할지 감을 잡을 수 있습니다.
- downscoped token을 도입할 때 생기는 latency, cache, revocation, 장애 fallback 문제를 미리 볼 수 있습니다.
- 서비스 간 권한 전달을 "토큰 문자열"이 아니라 감사 가능한 운영 계약으로 문서화할 수 있습니다.

## 핵심 개념/이슈

### 1) downstream에 원본 토큰을 그대로 넘기면 confused deputy가 생긴다

사용자 access token을 내부 서비스 전체에 그대로 전달하는 구조는 구현이 쉽습니다. 하지만 토큰의 `aud`가 gateway나 public API를 가리키고 있는데 결제 서비스가 그것을 받아들이면, audience 검증이 약해집니다. 또한 원본 토큰에 `profile:read`, `order:write`, `admin:export` 같은 넓은 scope가 섞여 있으면 downstream은 자기에게 필요한 권한보다 더 많은 정보를 보게 됩니다.

서비스 계정 토큰도 비슷합니다. `batch-service`라는 하나의 토큰이 주문 수정, 결제 조회, 파일 export, 관리자 알림까지 모두 할 수 있다면 운영자는 장애 때 "이 호출이 어떤 업무 권한으로 실행됐는가"를 분리하기 어렵습니다. 이 문제는 [Permission Drift와 Access Review](/learning/deep-dive/deep-dive-permission-drift-access-review-playbook/)의 권한 누적 문제와 같습니다. 권한은 처음에는 작아도 예외가 쌓이면 넓어집니다.

Token Exchange는 이 지점에 들어갑니다. 원본 사용자 토큰이나 service credential을 받아, 대상 서비스가 이해할 수 있는 좁은 토큰으로 바꿉니다. 예를 들어 BFF가 `GET /me/orders` 요청을 처리하며 주문 서비스에 호출할 때, 원본 토큰을 그대로 넘기는 대신 `aud=orders-api`, `scope=orders.read`, `sub=user-123`, `act=bff-service`, `ttl=10m` 토큰을 발급받아 전달합니다.

### 2) subject와 actor를 분리해야 감사가 된다

downscoped token에서 가장 자주 빠지는 개념이 `actor`입니다. `subject`는 권한의 대상이 되는 사용자나 계정이고, `actor`는 실제 호출을 수행하는 서비스입니다. 사용자가 웹에서 버튼을 눌러 export를 요청했다면 `sub=user-123`, `act=admin-bff`가 될 수 있습니다. 야간 batch가 시스템 정책에 따라 정산을 조회한다면 `sub` 없이 `act=billing-reconciler`만 둘 수도 있습니다.

이 둘을 섞으면 감사가 흐려집니다. 모든 호출이 사용자 `sub`만 남으면 어떤 서비스가 호출했는지 모릅니다. 반대로 모든 호출이 서비스 계정으로만 보이면 사용자의 위임인지 시스템 자동화인지 구분하지 못합니다. 실무 claim은 아래 정도를 기본값으로 둘 수 있습니다.

```yaml
claims:
  iss: "https://auth.internal.example"
  sub: "user-123"
  act: "order-bff"
  aud: "payment-api"
  scope: ["payment.method.read"]
  resource: "customer:123"
  exp: "now+10m"
  policy_version: "token-exchange-v3"
  exchange_id: "txe_20260713_..."
```

여기서 `exchange_id`는 운영에 중요합니다. downstream 로그, token exchange server 로그, gateway 로그를 하나로 묶어야 나중에 "누가 어떤 원본 권한으로 어떤 좁은 토큰을 받았는가"를 추적할 수 있습니다.

### 3) audience는 하나로 좁히고 scope는 작업 단위로 나눈다

downscoped token의 기본 규칙은 간단합니다. 토큰 하나는 audience 하나를 향해야 합니다. `aud=["orders-api","payment-api","file-api"]`처럼 여러 대상을 한 토큰에 넣으면 다시 넓은 토큰이 됩니다. scope도 서비스가 실제로 요구하는 작업 단위로 줄여야 합니다.

권장 시작 기준:

| 항목 | 출발 기준 |
| --- | --- |
| audience | 토큰 1개당 1개 service 또는 1개 resource server |
| scope 개수 | 일반 요청 1~3개, 5개 초과면 정책 재검토 |
| TTL | 기본 5~15분, 고위험 write/export/delete는 1~5분 |
| refresh token | 내부 downscoped token에는 기본 발급 금지 |
| claims | email, phone, raw role list 같은 개인정보와 고카디널리티 값 최소화 |
| key rotation | `kid` 기반, 신/구 키 동시 검증 기간은 token max TTL 이상 |

scope 이름은 너무 기술적으로 쪼개도 어렵고, 너무 넓어도 위험합니다. `db.read`는 너무 넓고, `select_order_table_by_id`는 너무 구현 종속적입니다. `orders.read`, `orders.cancel`, `files.export.create`, `payment.method.read`처럼 업무 행위와 resource server가 함께 보이는 이름이 운영에서 읽기 쉽습니다.

### 4) revocation은 TTL만으로 해결하지 않는다

짧은 TTL은 강력한 방어선입니다. 하지만 권한 회수가 1분 안에 필요하거나, 관리자 권한 변경처럼 즉시 차단해야 하는 경로라면 TTL만 믿으면 부족합니다. 예를 들어 사용자가 퇴사 처리됐는데 10분짜리 downscoped token이 이미 발급되어 있다면, 그 10분 동안 호출이 가능할 수 있습니다.

회수 요구에 따라 검증 방식을 나눕니다.

| 권한 위험도 | 검증 방식 | 기준 |
| --- | --- | --- |
| 낮음 | JWT 로컬 검증 | TTL 10~15분, scope read-only |
| 중간 | JWT + policy_version claim | 정책 변경 시 새 버전만 허용 |
| 높음 | introspection 또는 denylist 확인 | export, delete, admin, payment write |
| 매우 높음 | 요청별 PDP 확인 | 계정 폐쇄, 권한 상승, 대량 데이터 이동 |

모든 호출에 introspection을 붙이면 지연과 장애 의존성이 커집니다. 반대로 모든 호출을 로컬 JWT 검증으로만 처리하면 회수성이 약합니다. 그래서 위험도별로 나눠야 합니다. [API Key Lifecycle](/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/)에서 키 폐기와 사용량 관측을 같이 보듯, token exchange도 발급과 회수를 한 쌍으로 봐야 합니다.

### 5) token exchange server는 hot path 의존성이 된다

Token Exchange를 도입하면 인증 서버가 더 자주 호출됩니다. BFF가 사용자 요청마다 downstream별 토큰을 새로 받으면 latency와 가용성 문제가 생깁니다. 따라서 발급 정책과 cache 정책을 함께 설계해야 합니다.

권장 지표:

- `token_exchange_latency_p95`: 50ms 이하를 1차 목표로 둔다.
- `token_exchange_error_rate`: 0.1% 초과 시 degraded mode 검토.
- `downscoped_token_cache_hit_ratio`: read-only 고빈도 호출은 80% 이상 목표.
- `audience_mismatch_denied`: 0이 정상, 배포 직후 증가하면 설정 오류 후보.
- `scope_denied_rate`: 기능 오류인지 공격 신호인지 owner가 봐야 한다.

캐시는 조심해야 합니다. cache key에는 `subject`, `actor`, `audience`, `scope set`, `resource`, `policy_version`이 들어가야 합니다. scope 순서가 다르다고 다른 토큰을 만들 필요는 없으므로 정렬된 scope set으로 canonicalization합니다. 단, 고위험 작업 토큰은 cache를 끄거나 TTL의 20~30%만 cache하는 편이 안전합니다.

## 실무 적용

### 1) 원본 토큰 전달 경로부터 inventory로 만든다

처음부터 모든 서비스를 바꾸려 하지 말고, 현재 토큰이 어디로 흐르는지 표로 만듭니다.

| 호출자 | 대상 | 현재 방식 | 위험 | 전환 후보 |
| --- | --- | --- | --- | --- |
| web-bff | orders-api | user access token 전달 | audience 불일치 | `aud=orders-api`, `orders.read` |
| admin-bff | export-worker | admin token 전달 | 대량 데이터 export | `files.export.create`, TTL 3분 |
| billing-job | payment-api | broad service token | write 권한 과다 | `payment.settlement.read` |
| support-tool | user-api | shared API key | 사용자별 감사 약함 | actor + reason claim 추가 |

우선순위는 `대량 데이터`, `결제/정산`, `권한 변경`, `삭제`, `외부 전송` 순서로 잡습니다. read-only 내부 조회보다 되돌리기 어려운 작업부터 좁히는 편이 효과가 큽니다.

### 2) 정책을 코드보다 먼저 쓴다

Token Exchange 정책은 코드 안에 흩어지면 안 됩니다. 최소한 아래처럼 선언형 표나 설정으로 관리합니다.

```yaml
token_exchange_policies:
  - name: order_bff_to_payment_method_read
    actor: order-bff
    source_subject: user
    audience: payment-api
    scopes: ["payment.method.read"]
    resource_pattern: "customer:{customer_id}"
    ttl_seconds: 600
    cache_seconds: 120
    require_reason: false
    revocation_mode: jwt_with_policy_version

  - name: admin_export_create
    actor: admin-bff
    source_subject: admin_user
    audience: export-worker
    scopes: ["files.export.create"]
    ttl_seconds: 180
    cache_seconds: 0
    require_reason: true
    revocation_mode: introspection
```

이 설정은 보안팀만 보는 문서가 아니라 코드 리뷰 대상이어야 합니다. 새 scope가 추가되면 API 변경처럼 리뷰합니다. 특히 `*.write`, `*.delete`, `*.export`, `*.admin`은 owner 승인을 요구하는 식으로 정책을 둡니다.

### 3) downstream은 audience와 scope를 반드시 검증한다

Token Exchange를 붙여도 downstream이 `aud`를 검증하지 않으면 효과가 약합니다. 대상 서비스는 최소 아래를 확인해야 합니다.

1. issuer가 신뢰된 내부 발급자인가
2. signature와 `kid`가 유효한가
3. `exp`, `nbf`, clock skew 허용 범위가 맞는가
4. `aud`가 자기 서비스인가
5. 필요한 scope가 있는가
6. resource claim이 요청 path/body와 일치하는가
7. 고위험 작업이면 policy version 또는 introspection 결과가 유효한가

clock skew 허용은 보통 30~60초에서 시작합니다. 5분 이상으로 넓히면 만료 토큰을 너무 오래 받아들이게 됩니다. 이 부분은 [시계 skew와 시간 의미](/learning/deep-dive/deep-dive-clock-skew-time-semantics-playbook/)와도 연결됩니다.

### 4) 장애 fallback은 "원본 토큰으로 우회"가 아니다

token exchange server가 장애라고 해서 원본 사용자 토큰이나 broad service token으로 우회하면, 장애 순간에 보안 경계가 무너집니다. fallback은 위험도별로 정해야 합니다.

- read-only, 낮은 위험: 짧은 시간 동안 기존 cached token 사용. 최대 cache TTL은 원래 TTL 이하.
- 중간 위험: degraded read만 허용하고 write/export는 차단.
- 높은 위험: fail closed. 관리자에게 명확한 오류와 incident id 제공.
- batch: 새 token 발급이 안 되면 새 작업 시작 금지, 이미 발급된 토큰의 TTL 안에서만 진행.

권장 기준은 `token_exchange_error_rate`가 5분 동안 1%를 넘으면 degraded mode를 켜고, 5%를 넘으면 고위험 scope 발급을 전면 중지하는 것입니다. 이 숫자는 서비스 특성에 맞게 조정하되, "장애니까 넓은 토큰으로 임시 우회"는 break-glass 승인과 감사 로그 없이는 금지하는 편이 안전합니다.

### 5) 로그에는 토큰 원문이 아니라 exchange evidence를 남긴다

토큰 원문은 로그에 남기면 안 됩니다. 대신 아래 필드를 남깁니다.

```json
{
  "exchange_id": "txe_20260713_abc",
  "actor": "order-bff",
  "subject_type": "user",
  "audience": "payment-api",
  "scopes": ["payment.method.read"],
  "resource": "customer:123",
  "policy_version": "token-exchange-v3",
  "ttl_seconds": 600,
  "result": "issued"
}
```

downstream 로그에도 같은 `exchange_id`를 남기면 추적이 쉬워집니다. [구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/)과 [Tamper-evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)의 원칙처럼, 원문 secret이 아니라 검증 가능한 식별자와 정책 버전을 남기는 것이 핵심입니다.

## 트레이드오프/주의점

첫째, token exchange는 latency를 추가합니다. 모든 내부 호출마다 새 토큰을 발급받으면 평균 지연보다 p95/p99가 먼저 나빠질 수 있습니다. read-only 고빈도 호출은 cache를 쓰되, cache key와 TTL을 엄격히 잡아야 합니다.

둘째, 정책이 너무 잘게 쪼개지면 운영자가 이해하지 못합니다. scope가 200개를 넘어가고 owner가 없으면 최소 권한이 아니라 정책 부채가 됩니다. 서비스별 핵심 scope 5~20개 안에서 시작하고, 예외는 review queue로 보내는 편이 현실적입니다.

셋째, JWT self-contained 토큰은 빠르지만 회수가 어렵습니다. 짧은 TTL, policy version, denylist, introspection을 위험도별로 섞어야 합니다. "JWT니까 stateless"라는 말로 회수 요구를 무시하면 보안 사고 때 대응이 늦습니다.

넷째, mTLS와 token exchange를 혼동하면 안 됩니다. mTLS는 호출 서비스가 누구인지와 채널 보안을 확인합니다. downscoped token은 그 서비스가 어떤 사용자 맥락과 어떤 업무 목적을 가지고 호출하는지 확인합니다. 둘 중 하나만으로는 설명력이 부족할 수 있습니다.

다섯째, 내부 시스템이라고 개인정보 claim을 과하게 넣으면 토큰 자체가 민감 데이터 묶음이 됩니다. email, phone, raw role list, 조직 전체 권한 배열은 가능한 한 빼고, 필요한 경우 내부 ID와 policy lookup으로 대체합니다.

## 체크리스트 또는 연습

- [ ] 사용자 access token을 downstream에 그대로 전달하는 API가 목록화되어 있다.
- [ ] audience가 자기 서비스가 아닌 토큰을 resource server가 거절한다.
- [ ] downscoped token TTL, scope 수, cache TTL, revocation mode가 위험도별로 다르다.
- [ ] 고위험 scope에는 reason, ticket, actor, exchange_id가 남는다.
- [ ] token exchange server 장애 시 원본 토큰으로 우회하지 않는 fallback 정책이 있다.
- [ ] 로그에는 token 원문이 아니라 exchange evidence와 policy version만 남는다.
- [ ] `scope_denied_rate`, `audience_mismatch_denied`, `exchange_latency_p95`, `cache_hit_ratio` 대시보드가 있다.

연습은 하나면 충분합니다. 현재 서비스에서 "관리자가 사용자 데이터를 CSV로 export한다"는 흐름을 고르고, 원본 사용자 토큰이 어디까지 이동하는지 그려 보세요. 그다음 `actor`, `subject`, `audience`, `scope`, `resource`, `ttl`, `revocation_mode`, `fallback`을 한 줄씩 채웁니다. `audience`가 2개 이상이거나 TTL이 15분을 넘거나 export scope가 cache된다면, 왜 그래야 하는지 owner가 설명할 수 있어야 합니다.

오늘의 결론은 단순합니다. 서비스 간 인증은 "토큰이 유효한가"에서 끝나지 않습니다. 안전한 백엔드 권한 모델은 **누가, 누구를 대신해, 어떤 대상에게, 어떤 작업을, 얼마 동안 허용받았는가**를 좁고 검증 가능한 형태로 남기는 데서 시작합니다.
