---
title: "백엔드 커리큘럼 심화: API Key Lifecycle 발급·회전·폐기 플레이북"
date: 2026-06-26
draft: false
topic: "Backend Security"
tags: ["API Key", "Secret Management", "Authorization", "Audit Log", "Backend Security"]
categories: ["Backend Deep Dive"]
description: "API Key를 단순 문자열 토큰이 아니라 발급, 저장, 권한, 사용량 제한, 회전, 폐기, 감사 로그까지 이어지는 운영 자산으로 설계하는 기준을 정리합니다."
module: "backend-security"
study_order: 1244
key_takeaways:
  - "API Key는 원문 문자열이 아니라 key id, principal, scope, policy, 감사 로그가 묶인 운영 자산으로 관리해야 한다."
  - "서버에는 원문 키를 저장하지 않고 prefix lookup과 HMAC 기반 hash 검증으로 유출 피해를 줄인다."
  - "회전과 폐기는 발급 이후 옵션이 아니라 만료, dual key window, revoked key 재사용 감지가 포함된 기본 수명주기다."
operator_checklist:
  - "모든 key에 owner, principal, scope, environment, expires_at, last_used_at을 채운다."
  - "read/write/admin/external-send scope를 분리하고 high-risk scope에는 짧은 만료 또는 추가 승인 경계를 둔다."
  - "revoked key 재사용, 신규 IP/region, key별 QPS 급증을 별도 보안 이벤트로 집계한다."
learning_refs:
  - title: "시크릿 관리 실무"
    href: "/learning/deep-dive/deep-dive-secret-management/"
    description: "비밀을 소스와 이미지에서 분리하고 런타임 주입, 회전, 유출 대응으로 운영하는 기준입니다."
  - title: "Permission Drift와 Access Review"
    href: "/learning/deep-dive/deep-dive-permission-drift-access-review-playbook/"
    description: "발급된 키와 권한이 시간이 지나며 불필요하게 남지 않도록 검토·회수하는 운영 기준입니다."
  - title: "인증/인가 모델"
    href: "/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/"
    description: "API Key의 principal과 scope를 RBAC, ABAC, ReBAC 관점에서 분리해 설계하는 배경입니다."
decision_guide:
  cases:
    - badge: "권장"
      title: "서버 간 통합 또는 파트너 API"
      fit: "사용자 동의보다 서비스/조직 단위 접근과 호출량 제어가 중요한 경우"
      watchouts: "owner, scope, 만료일 없이 발급하면 shadow access가 빠르게 늘어난다."
      next_step: "key id, principal, scope, rate limit, expires_at을 포함한 데이터 모델부터 만든다."
    - badge: "주의"
      title: "사용자별 3rd-party 앱 권한 위임"
      fit: "API Key보다 OAuth2/OIDC consent와 refresh token 관리가 더 자연스러운 경우"
      watchouts: "API Key 하나로 사용자 동의와 세밀한 철회를 대신하면 감사와 회수가 어렵다."
      next_step: "사용자 위임은 OAuth2/OIDC로 두고, 서버 간 자동화에만 API Key를 제한한다."
faqs:
  - question: "API Key 원문을 다시 보여주는 기능이 꼭 필요하지 않나요?"
    answer: "대부분 필요하지 않습니다. 원문은 발급 시 1회만 보여주고, 잃어버렸다면 새 키를 발급해 회전하는 방식이 DB 유출 피해를 줄입니다."
  - question: "모든 API Key를 짧은 만료로 두면 가장 안전한가요?"
    answer: "보안상 유리하지만 운영 장애가 늘 수 있습니다. 읽기 전용 저위험 키와 결제, 삭제, 권한 변경 같은 high-risk scope의 만료 정책을 분리하는 편이 현실적입니다."
---

API Key는 구현이 쉬워 보입니다. 관리자 화면에서 긴 랜덤 문자열을 하나 만들고, 클라이언트가 `Authorization` 헤더나 `X-API-Key` 헤더에 실어 보내면 됩니다. 그래서 많은 서비스가 내부 도구, 파트너 연동, 배치 작업, 서버 간 호출을 빠르게 열 때 API Key부터 붙입니다. 문제는 그 다음입니다. 누가 만든 키인지, 어떤 권한을 가졌는지, 마지막으로 언제 쓰였는지, 유출됐을 때 몇 분 안에 막을 수 있는지, 회전 중에 어떤 클라이언트가 깨지는지 답하지 못하면 API Key는 인증 수단이 아니라 장기 장애 씨앗이 됩니다.

API Key 설계의 핵심은 "키를 안전하게 생성한다"에서 끝나지 않습니다. 실무에서는 키가 만들어진 뒤의 전체 수명주기가 더 중요합니다. 발급 이유, scope, owner, 만료일, rate limit, 마지막 사용 시각, 폐기 상태, 감사 로그가 같이 있어야 운영자가 판단할 수 있습니다. 이 글은 [시크릿 관리](/learning/deep-dive/deep-dive-secret-management/), [인증/인가 모델](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/), [Permission Drift와 Access Review](/learning/deep-dive/deep-dive-permission-drift-access-review-playbook/), [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/), [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)와 이어지는 관점으로 API Key를 운영 가능한 자산으로 다루는 기준을 정리합니다.

## 이 글에서 얻는 것

- API Key를 비밀번호처럼 저장하면 왜 위험한지, 해시 저장과 prefix lookup을 어떻게 나눠야 하는지 이해합니다.
- 발급, scope, 만료, 회전, 폐기, 감사 로그를 하나의 lifecycle로 묶는 기준을 잡을 수 있습니다.
- 파트너 연동이나 내부 서버 간 호출에서 키 유출 피해를 줄이는 rate limit, allowlist, owner 정책을 설계할 수 있습니다.
- "키를 새로 발급했다"가 아니라 "유출돼도 15분 안에 막고, 7일 안에 회전할 수 있다"는 운영 목표를 세울 수 있습니다.

## 핵심 개념/이슈

### 1) API Key는 identity와 permission을 동시에 표현하면 망가지기 쉽다

API Key를 처음 만들 때 흔한 실수는 키 문자열 하나에 너무 많은 의미를 기대하는 것입니다. "이 키를 가진 클라이언트는 A 회사이고, 주문 조회도 가능하고, 정산 다운로드도 가능하고, 운영 중단 시 우회도 가능하다"처럼 쓰면 나중에 분리하기가 어렵습니다.

실무에서는 최소한 아래 개념을 분리합니다.

| 개념 | 예시 | 저장 위치 |
| --- | --- | --- |
| Key material | 실제 비밀 문자열 | 최초 발급 시 1회 노출, 서버에는 해시만 저장 |
| Key id | `ak_live_9f3a...` 같은 식별자 | DB, 로그, 감사 이벤트 |
| Principal | 파트너사, 내부 서비스, 자동화 계정 | 계정/조직/서비스 테이블 |
| Scope | `orders:read`, `settlements:write` | 권한 정책 |
| Policy | rate limit, IP allowlist, 만료, 환경 | key policy 테이블 |

키 자체가 권한 모델이 되면, 권한 변경 때마다 키를 새로 뿌려야 합니다. 반대로 key id와 principal, scope를 분리하면 "같은 파트너의 읽기 권한만 줄이기", "정산 scope만 24시간 중지", "staging 키만 폐기" 같은 운영이 가능합니다.

판단 기준은 간단합니다. 키 하나가 서로 다른 위험도의 작업을 3개 이상 수행한다면 scope를 쪼개는 편이 안전합니다. 특히 읽기, 쓰기, 관리자 작업, 외부 전송은 같은 키에 묶지 않는 것을 기본값으로 둡니다.

### 2) 서버에는 원문 키를 저장하지 않는다

API Key는 사용자가 다시 볼 수 없어도 됩니다. 오히려 다시 볼 수 있으면 위험합니다. 서버 DB에 원문 키를 저장하면 DB read 권한 하나가 모든 파트너 권한으로 바뀝니다. 따라서 원칙은 비밀번호와 비슷합니다.

- 발급 시 원문 키는 1회만 보여준다.
- 서버에는 `key_hash`만 저장한다.
- 조회 성능을 위해 앞부분 prefix를 별도로 저장한다.
- 로그에는 원문이 아니라 `key_id`와 prefix 일부만 남긴다.

예를 들어 키 형식을 `ak_live_<public_prefix>_<secret_random>`로 두면, 서버는 public prefix로 후보를 좁힌 뒤 secret 전체를 HMAC/SHA-256 계열로 비교할 수 있습니다. 여기서 단순 SHA-256보다 서버 측 pepper를 섞은 HMAC이 낫습니다. DB가 유출돼도 오프라인 대입 비용을 높일 수 있기 때문입니다.

권장 기준:

- 랜덤 secret: 최소 128bit 이상, 가능하면 192~256bit
- prefix: 운영자가 식별 가능한 8~12자 수준
- 원문 키 재조회: 금지
- 키 발급 화면 재노출: 금지, 복사 후 닫으면 끝
- 로그/trace/body 저장: 원문 키 자동 마스킹 테스트 필수

이 기준은 [구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/)의 민감정보 마스킹 원칙과 같습니다. "개발자가 조심한다"가 아니라, 테스트와 필터가 원문 노출을 막아야 합니다.

### 3) 만료와 회전은 선택 기능이 아니라 운영 안전장치다

API Key가 한 번 발급된 뒤 2년 동안 살아 있다면 언젠가 유출된다고 보는 편이 현실적입니다. 파트너사의 CI 로그, 노트북, 공유 문서, Postman collection, 외주 개발 환경까지 키가 지나가는 경로는 생각보다 많습니다. 그래서 키는 처음부터 회전 가능해야 합니다.

회전 모델은 보통 두 가지입니다.

1. **Dual key window**
   - 새 키와 이전 키를 일정 기간 함께 허용합니다.
   - 클라이언트가 새 키로 전환한 뒤 이전 키를 폐기합니다.
2. **Versioned key**
   - 같은 logical credential에 여러 version을 둡니다.
   - 현재 활성 version과 이전 version의 사용량을 같이 봅니다.

권장 숫자 기준:

- 일반 파트너 키 만료: 90~180일
- 내부 자동화 키 만료: 30~90일
- high-risk scope 키 만료: 7~30일
- dual key window: 7~14일
- 이전 키 사용량 0건이 24~48시간 유지되면 폐기
- 유출 의심 시 폐기 목표: 15분 이내

만료가 짧을수록 안전하지만 운영 비용도 늘어납니다. 그래서 모든 키를 7일로 줄이는 것보다 scope와 위험도별로 나누는 편이 낫습니다. 결제, 개인정보, 권한 변경, 관리자 API는 짧게 가져가고, 읽기 전용 저위험 키는 더 긴 만료를 둘 수 있습니다.

### 4) 폐기는 삭제가 아니라 상태 전이다

키를 폐기할 때 DB row를 바로 지우면 사고 분석이 어려워집니다. 언제, 누가, 왜 폐기했는지와 폐기 후에도 요청이 들어오는지 봐야 합니다. 그래서 키 상태는 최소 아래처럼 둡니다.

```text
ACTIVE -> ROTATING -> DISABLED -> REVOKED -> ARCHIVED
```

- `ACTIVE`: 정상 사용
- `ROTATING`: 새 키가 발급됐고 이전 키는 제한된 기간 허용
- `DISABLED`: 임시 중지, 복구 가능
- `REVOKED`: 폐기 확정, 복구 불가
- `ARCHIVED`: 보존 기간 이후 조회 전용

폐기 직후 404처럼 보이게 할지, 401/403으로 명확히 돌려줄지도 정해야 합니다. 외부 파트너 API라면 `401 invalid_api_key`가 운영에 도움이 됩니다. 공격 표면을 줄이는 API라면 자세한 이유를 숨기는 편이 낫습니다. 핵심은 상태 전이가 감사 로그로 남고, 폐기된 키의 재사용 시도가 별도 지표로 보이는 것입니다.

### 5) API Key는 rate limit과 감사 로그 없이 운영하면 안 된다

API Key는 인증 수단이면서 과금, abuse 방지, 파트너 SLA의 기준이 됩니다. 따라서 모든 키에는 기본 rate limit과 사용량 지표가 붙어야 합니다.

최소 지표:

- key별 요청 수, 에러율, p95 지연
- endpoint별 호출 분포
- 마지막 사용 시각
- 허용되지 않은 scope 접근 횟수
- IP/ASN 변화
- revoked key 재사용 시도

실무 임계치 예시:

- 평시 대비 key별 QPS 5배 이상 상승: abuse 후보
- 실패율 20% 이상이 10분 지속: 통합 오류 또는 공격 후보
- 미사용 30일 초과 key: 회수 후보
- revoked key 사용 1회 이상: 보안 알림
- 신규 IP/region에서 high-risk scope 호출: step-up 또는 일시 제한

이 지표가 없으면 키 유출과 정상 트래픽 증가를 구분하기 어렵습니다. [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)를 적용할 때도 사용자 단위만 보지 말고 key id와 principal 단위를 같이 봐야 합니다.

## 실무 적용

### 1) 데이터 모델 초안

API Key 테이블은 단순히 `id`, `key`, `created_at`으로 끝내면 안 됩니다. 최소 아래 필드를 권장합니다.

```text
api_keys
- id
- public_prefix
- key_hash
- principal_type
- principal_id
- environment
- status
- scopes
- rate_limit_policy_id
- ip_allowlist_policy_id
- created_by
- created_reason
- expires_at
- last_used_at
- rotating_from_key_id
- revoked_at
- revoked_by
- revoke_reason
```

원문 키는 없습니다. `created_reason`은 생각보다 중요합니다. "파트너 A 정산 자동화", "사내 배치 job-x", "마이그레이션 임시 접근"처럼 이유를 남기면 90일 뒤 회수 판단이 쉬워집니다. 이유 없는 키는 대부분 고아 키가 됩니다.

### 2) 발급 플로우

발급은 관리자 화면 버튼 하나보다 작은 승인 플로우로 다루는 편이 안전합니다.

1. 요청자가 principal과 scope를 선택한다.
2. 시스템이 위험도를 계산한다.
3. high-risk scope면 owner 승인 또는 보안 리뷰를 요구한다.
4. 키를 생성하고 원문을 1회만 보여준다.
5. 감사 로그에 key id, scope, owner, 만료일을 남긴다.
6. 첫 24시간 사용량을 관찰한다.

위험도 기준 예시:

| 위험도 | 조건 | 승인 |
| --- | --- | --- |
| Low | 읽기 전용, public-ish 데이터, 만료 90일 이하 | 팀 owner |
| Medium | 고객 데이터 조회, partner integration, rate limit 상향 | 서비스 owner |
| High | 쓰기, 삭제, 권한 변경, 정산/결제, 만료 30일 초과 | 보안/플랫폼 승인 |

high-risk 키는 발급보다 회수가 더 중요합니다. 발급 시점에 폐기 owner와 만료일이 없으면 승인을 막는 편이 낫습니다.

### 3) 인증 미들웨어 처리 순서

요청 처리 순서는 아래처럼 고정합니다.

1. 헤더에서 키 추출
2. 형식 검증과 prefix 조회
3. HMAC 비교
4. status와 만료 확인
5. principal 상태 확인
6. scope 확인
7. rate limit과 IP allowlist 확인
8. 감사/사용량 이벤트 기록
9. handler 실행

여기서 8번을 handler 뒤로만 미루면 실패한 인증 시도나 scope 위반이 빠질 수 있습니다. 최소한 인증 성공/실패와 거부 이유는 구조화 이벤트로 남겨야 합니다. 단, 원문 키와 민감 payload는 절대 남기지 않습니다.

### 4) 회전 런북

회전은 평시에 연습해야 합니다. 사고 때 처음 하면 파트너 커뮤니케이션과 배포가 같이 꼬입니다.

권장 런북:

1. 새 키 발급, 이전 키는 `ROTATING`
2. 파트너/서비스 owner에게 만료일 공지
3. 이전 키와 새 키의 사용량을 1시간 단위로 비교
4. 이전 키 사용량이 24~48시간 0건이면 `DISABLED`
5. 7일 뒤 `REVOKED`
6. 30~90일 뒤 archive 또는 보존 정책 적용

회전 중 에러율이 1%p 이상 오르거나, 이전 키 사용량이 마감 24시간 전에도 10% 이상 남아 있으면 폐기 일정을 미룹니다. 단, 유출 의심 회전은 예외입니다. 이때는 호환성보다 피해 차단이 먼저라서 즉시 `REVOKED`하고 대체 키를 별도 채널로 전달합니다.

### 5) 운영 대시보드

대시보드는 멋진 그래프보다 회수 판단을 빠르게 만들어야 합니다.

- 만료 14일 이내 key
- 30일 이상 미사용 key
- owner 없는 key
- high-risk scope인데 IP allowlist 없는 key
- revoked key 재사용 시도
- key별 QPS 상위 20개
- key별 실패율 상위 20개
- scope 위반 상위 20개

주간 운영 기준은 "미사용 key 회수율"을 봅니다. 매주 미사용 30일 초과 키의 80% 이상이 owner 확인 또는 폐기 상태로 이동하면 관리가 되고 있는 것입니다. 반대로 key 수만 늘고 회수율이 없으면 API Key는 곧 shadow access가 됩니다.

## 트레이드오프/주의점

첫째, 너무 짧은 만료는 통합 파트너를 피곤하게 만듭니다. 보안만 보고 모든 키를 7일 만료로 만들면 운영팀은 매주 장애 대응을 하게 됩니다. 위험도별 만료와 자동 알림이 현실적인 균형입니다.

둘째, IP allowlist는 만능이 아닙니다. 클라우드 egress IP가 자주 바뀌거나 파트너가 NAT 뒤에 있으면 allowlist 운영이 병목이 됩니다. 하지만 high-risk scope에는 IP, mTLS, 서명 요청, step-up 승인 중 최소 하나의 추가 경계를 두는 편이 안전합니다.

셋째, 키 prefix를 너무 길게 노출하면 식별에는 편하지만 공격자에게 단서가 됩니다. prefix는 운영 식별용이지 인증 요소가 아닙니다. secret 부분의 엔트로피와 해시 비교가 실제 방어선입니다.

넷째, 폐기된 키 row를 바로 삭제하면 사고 분석이 어려워집니다. 개인정보가 아니라 credential metadata라면 보존 기간을 두고 감사 가능성을 확보하는 편이 좋습니다. 다만 owner, IP, 사용량 이벤트가 개인정보와 결합될 수 있으므로 보존 기간과 접근 권한을 명확히 해야 합니다.

다섯째, API Key는 OAuth를 완전히 대체하지 않습니다. 사용자가 직접 권한을 위임하고 철회해야 하는 3rd-party 앱 생태계라면 [OAuth2/OIDC](/learning/deep-dive/deep-dive-oauth2-oidc/)가 맞습니다. API Key는 서버 간 통합과 자동화에 적합하지만, 사용자별 consent와 세밀한 delegated access에는 약합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 원문 API Key를 DB에 저장하지 않고, 해시와 prefix만 저장한다.
- [ ] 모든 key에 owner, principal, scope, environment, 만료일이 있다.
- [ ] read/write/admin/external-send scope가 분리되어 있다.
- [ ] high-risk key는 7~30일 만료 또는 추가 승인 경계를 가진다.
- [ ] 키 회전 시 dual key window와 이전 키 폐기 조건이 숫자로 정해져 있다.
- [ ] revoked key 재사용 시도가 알림으로 올라온다.
- [ ] 30일 이상 미사용 key 회수 프로세스가 있다.
- [ ] 감사 로그에는 key id와 판단 근거만 남고 원문 key는 남지 않는다.

### 연습

1. 현재 서비스의 API Key 또는 내부 토큰 10개를 뽑아 owner, scope, 만료일, 마지막 사용 시각을 표로 정리해 보세요. owner가 없거나 30일 이상 미사용이면 회수 후보입니다.
2. `orders:read`, `orders:write`, `settlements:download`, `admin:user:delete` 네 scope를 기준으로 발급 승인 등급을 나눠 보세요. 각 scope의 만료일과 rate limit도 숫자로 적습니다.
3. "파트너 키 유출 의심" 상황을 가정하고 15분 안에 할 일을 런북으로 작성해 보세요. 즉시 폐기, 대체 키 발급, 파트너 공지, revoked key 재사용 모니터링, 포스트모템 항목이 들어가야 합니다.

## 함께 보면 좋은 글

- [시크릿 관리 실무](/learning/deep-dive/deep-dive-secret-management/)
- [인증/인가 모델: RBAC·ABAC·ReBAC](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/)
- [Permission Drift와 Access Review 플레이북](/learning/deep-dive/deep-dive-permission-drift-access-review-playbook/)
- [Tamper-Evident Audit Log 플레이북](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)
- [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)
- [OAuth2/OIDC 심화](/learning/deep-dive/deep-dive-oauth2-oidc/)
