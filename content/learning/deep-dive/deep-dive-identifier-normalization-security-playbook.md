---
title: "백엔드 커리큘럼 심화: 식별자 정규화와 비교 정책, Unicode 입력이 권한 우회가 되지 않게 설계하는 법"
date: 2026-08-21
lastmod: 2026-08-21
draft: false
topic: "Backend Security"
tags: ["Unicode", "Identifier", "Normalization", "Validation", "Authentication", "Authorization", "Backend Security"]
categories: ["Backend Deep Dive", "Security"]
description: "이메일·사용자명·도메인·외부 리소스 ID를 표시 문자열과 보안 식별자로 분리하고, 허용 문자·정규화·중복·감사 기준을 설계하는 실무 플레이북입니다."
module: "security"
study_order: 1231
keywords: ["unicode identifier normalization", "security identifier policy", "username canonicalization", "email normalization", "allowlist comparison"]
---

사용자명, 이메일, 조직 slug, 외부 API의 account ID, 허용할 hostname은 모두 문자열로 보입니다. 그래서 많은 서비스가 입력에서 공백을 제거하고 `lower()`를 적용한 뒤 같은 값인지 비교합니다. 하지만 이 단계는 화면을 보기 좋게 만드는 전처리가 아니라 **인증·권한·중복 방지의 의미를 결정하는 정책**입니다. 보기에 비슷한 Unicode 문자, 정규화 방식 차이, 대소문자 규칙이 다른 외부 시스템, 오래된 데이터의 표현 차이를 한 번에 처리하려 하면 계정 병합, 허용 목록 우회, 감사 기록 불일치가 생길 수 있습니다.

이 글은 [Spring Validation](/learning/deep-dive/deep-dive-spring-validation/), [OAuth2·OIDC](/learning/deep-dive/deep-dive-oauth2-oidc/), [BOLA 방지와 객체 수준 인가](/learning/deep-dive/deep-dive-object-level-authorization-bola-playbook/), [구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/)을 잇는 보안 경계 글입니다. 핵심은 모든 문자열을 똑같이 정규화하는 것이 아니라, **어떤 값이 사람에게 보이는 라벨이고 어떤 값이 보안 결정을 내리는 식별자인지 먼저 분리하는 것**입니다.

## 이 글에서 얻는 것

- 이메일, 사용자명, hostname, 외부 subject처럼 성격이 다른 문자열에 같은 `trim + lower` 규칙을 쓰면 안 되는 이유를 이해합니다.
- 원본값, 표시값, 비교용 canonical 값, 내부 immutable ID를 어떤 책임으로 나눌지 설계할 수 있습니다.
- 입력 허용 문자, Unicode 정규화, unique constraint, 로그 마스킹, 마이그레이션을 숫자와 중단 조건으로 운영할 수 있습니다.
- 로그인·권한·allowlist에서 편의성보다 먼저 확인해야 할 비교 경계를 정할 수 있습니다.

## 핵심 개념/이슈

### 1) 표시 문자열과 보안 식별자는 같은 컬럼이 아니다

`김철수`, `München`, 상품 제목처럼 사람이 읽는 값은 다양한 Unicode 표현과 언어를 허용하는 것이 제품 경험에 맞을 수 있습니다. 반면 로그인 ID, 직원 코드, tenant slug, 내부 리소스 key, redirect hostname은 시스템이 **같다/다르다**를 결정하는 값입니다. 이 두 종류를 하나의 `name` 컬럼에 넣고 같은 비교 함수를 적용하면, UX 요구와 보안 요구가 충돌할 때 어느 쪽도 명확히 지킬 수 없습니다.

권장 모델은 네 층입니다.

| 층 | 예시 | 책임 | 변경 가능 여부 |
| --- | --- | --- | --- |
| 내부 ID | `user_id`, UUIDv7 | 권한 조인·외래키·감사 기준 | 불변 |
| 원본 입력 | 사용자가 제출한 사용자명 | 분쟁 재현·입력 오류 분석 | 접근 통제 하 보존 |
| 표시값 | 프로필에 보이는 이름 | 사용자 경험·국제화 | 정책상 변경 가능 |
| canonical 식별자 | `login_key`, tenant slug | 로그인·중복 판단·허용 목록 | 변경 절차 필요 |

권한 체크는 표시값이나 이메일 문자열로 하지 않고 내부 ID와 membership을 사용합니다. 예를 들어 `/projects/{slug}`는 slug로 프로젝트를 찾은 뒤, 반드시 `project_id`와 요청자의 principal ID로 인가합니다. URL의 문자열이 정규화됐다는 사실만으로 객체 접근이 안전해지지 않습니다. 이 원칙이 [BOLA 방지](/learning/deep-dive/deep-dive-object-level-authorization-bola-playbook/)의 object-level check와 만나는 지점입니다.

### 2) Unicode 정규화는 필요하지만 동등성 정책을 대신하지 않는다

Unicode에는 사람이 보기에는 같은 글자가 여러 code point 조합으로 표현되는 경우가 있습니다. 예를 들어 `é`는 하나의 문자일 수도 있고 `e`와 combining accent의 조합일 수도 있습니다. 비교 전에 NFC 같은 정규화를 적용하면 이런 **정준 동등성(canonical equivalence)** 문제를 줄일 수 있습니다. 그러나 정규화가 "비슷해 보이는 모든 문자"를 같은 계정으로 합쳐 주는 것은 아닙니다.

여기서 흔한 과잉 대응이 NFKC 같은 호환성 정규화를 보안 식별자 전체에 일괄 적용하는 일입니다. 일부 호환 문자를 합치는 것이 유용한 입력도 있지만, 의도하지 않은 서로 다른 값을 충돌시킬 수 있고 외부 IdP·이메일 공급자·도메인 규칙과도 어긋날 수 있습니다. `lower()`를 `casefold()`로 바꾸는 것도 마찬가지입니다. 더 넓은 case folding은 검색 편의에는 쓸 수 있어도, 이미 발급된 login ID의 의미를 자동으로 바꾸는 근거는 아닙니다.

따라서 질문 순서는 다음이 안전합니다.

1. 이 값은 사람이 읽는 라벨인가, 접근 권한을 가르는 key인가?
2. 이 값의 canonical 규칙을 우리 서비스가 소유하는가, 외부 provider가 소유하는가?
3. 한 번 canonicalized한 값이 외부 시스템의 값과 왕복해도 같은 의미를 유지하는가?
4. 충돌이 발견됐을 때 자동 병합 대신 어떤 수동 검토·복구 경로가 있는가?

서비스가 소유하는 slug라면 ASCII 소문자, 숫자, `-`처럼 좁은 allowlist를 정하고 길이를 3~63자로 제한하는 편이 보통 안전합니다. 반대로 OAuth `sub`는 IdP가 발급한 opaque identifier입니다. 이것을 소문자로 바꾸거나 Unicode 정규화하지 말고, issuer와 함께 원문 그대로 저장·비교해야 합니다. [OAuth2·OIDC](/learning/deep-dive/deep-dive-oauth2-oidc/)에서 `iss + sub` 조합을 신원 키로 보는 이유도 여기 있습니다.

### 3) 입력 검증, canonicalization, 인가는 서로 다른 단계다

이 세 단계를 controller의 validator 하나로 끝내면 책임이 섞입니다.

```text
request
  -> syntax validation: 길이, 허용 문자, 빈 값, encoding
  -> canonicalization: 해당 식별자 타입의 명시된 변환만 적용
  -> uniqueness / resolution: canonical key로 내부 ID를 찾음
  -> authorization: principal ID가 그 내부 ID에 접근할 수 있는지 판단
  -> audit: 원본·canonical·결정 결과를 민감도에 맞춰 기록
```

문법 검증은 [Spring Validation](/learning/deep-dive/deep-dive-spring-validation/)처럼 빠르고 일관되게 400 계열 오류로 돌려줄 수 있습니다. 하지만 `@Pattern` 통과는 정책 통과가 아닙니다. 예컨대 hostname은 형식이 맞아도 localhost, link-local, private IP로 해석되거나 allowlist의 registrable domain 밖일 수 있습니다. email은 RFC 형태가 맞아도 로그인용 primary identity인지, 연락용 변경 가능한 주소인지가 별도입니다.

canonicalization은 pure function에 가깝게 유지하고, 입력 타입별로 버전을 둡니다. `slug_policy_v2`, `email_policy_v1`처럼 적용한 정책 버전을 저장하면 나중에 규칙을 바꿀 때 어떤 레코드를 재검토해야 하는지 찾기 쉽습니다. 정책 함수가 DB 조회나 네트워크 호출을 섞기 시작하면 재현성과 테스트가 나빠집니다. 외부 DNS 확인, IdP 조회는 canonicalization 이후의 resolution 단계로 분리합니다.

### 4) 데이터베이스 제약이 최종 중복 방지 장치다

애플리케이션에서 먼저 조회한 뒤 insert하는 방식은 동시 요청 두 개가 같은 canonical ID를 통과시키는 race condition을 만듭니다. canonical column에 unique constraint를 두고, 충돌을 정상적인 비즈니스 결과로 처리해야 합니다. 예시로 tenant slug는 다음처럼 설계할 수 있습니다.

```sql
CREATE TABLE tenant (
  id UUID PRIMARY KEY,
  slug_display VARCHAR(63) NOT NULL,
  slug_canonical VARCHAR(63) NOT NULL,
  slug_policy_version SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (slug_canonical)
);
```

unique violation을 무조건 500으로 처리하지 않습니다. 생성 요청이면 `409 Conflict`와 이미 사용 중이라는 안정적인 error code를 반환하고, retry path에서는 idempotency key와 요청 본문 hash를 함께 확인합니다. 기존 데이터에서 새 규칙의 충돌이 발견되면 자동으로 하나를 rename하지 않습니다. owner, 마지막 로그인, 외부 연동, URL redirect 영향을 확인한 manual-review queue로 보내는 것이 안전합니다.

## 실무 적용

### 1) 식별자 inventory부터 만든다

처음부터 전 테이블을 고치지 말고 로그인, tenant, 권한 allowlist, 외부 연동 ID처럼 영향이 큰 10개를 먼저 분류합니다. 각 항목에는 `owner`, `security role`, `source of truth`, `allowed charset`, `normalization policy`, `comparison method`, `storage`, `migration risk`를 적습니다. 특히 아래는 별도 행으로 분리합니다.

- **내부 principal/tenant/resource ID**: 불변 ID로 인가하고 원문 문자열은 lookup 보조로만 사용
- **로그인 email**: provider 또는 제품 정책을 문서화하고, display email과 verified primary email의 책임을 분리
- **OIDC subject**: `issuer + sub` 원문 비교, 임의 case 변환 금지
- **hostname/IP allowlist**: 문자열 lowercasing보다 URL parse, DNS 재해석, IP range 정책을 우선
- **사용자 표시 이름**: Unicode 허용 범위와 profanity·spoofing 대응은 하되 계정 key로 재사용 금지

우선순위는 **권한 오판 방지 > 기존 계정 충돌 방지 > 감사 재현성 > 검색 편의 > 표시 일관성**입니다. 이 순서가 뒤집히면 보기 좋은 UI를 위해 권한 경계를 느슨하게 만드는 결과가 됩니다.

### 2) 도입은 shadow 관측 후 제한적으로 강제한다

이미 회원이 있는 서비스에서 policy를 바로 바꾸면 로그인 실패나 링크 단절을 만들 수 있습니다. 4단계로 나누는 편이 낫습니다.

1. **관측(1~2주)**: 기존 값에 새 canonical 함수를 계산만 하고 충돌·변환·거부 후보를 기록합니다. 기존 판정은 바꾸지 않습니다.
2. **신규 생성 강제**: 새 계정과 새 slug에만 새 allowlist와 unique constraint를 적용합니다.
3. **고위험 경로 전환**: 권한 allowlist, 관리자 로그인, 외부 callback은 canonical policy version이 확인된 값만 받습니다.
4. **기존 데이터 정리**: 충돌 0건 또는 owner 검토 완료인 묶음부터 작은 batch로 이전합니다. redirect와 rollback 기간을 함께 둡니다.

운영 수치는 서비스 성격에 맞춰 조정하되, 시작 기준은 명확해야 합니다. 새 정책 shadow 기간의 collision candidate가 전체 활성 식별자의 **0.01%**를 넘으면 자동 전환을 멈추고 표본을 분석합니다. 로그인 canonicalization mismatch는 정상 기준 **0건**을 목표로 하며, 5분 내 1건이라도 나타나면 해당 변환을 fail-open으로 확대하지 말고 원인 확인으로 전환합니다. 신규 slug validation reject rate가 배포 전 기준선보다 **0.5%p** 이상 오르면 문구·클라이언트 인코딩·정책 범위를 함께 점검합니다.

### 3) 로그에는 값보다 결정 근거를 남긴다

식별자 문제를 디버깅하려고 전체 이메일, 토큰 subject, hostname을 로그에 남기면 개인정보와 보안 위험이 커집니다. 구조화 로그에는 다음처럼 최소한만 남깁니다.

```json
{
  "event": "identifier_policy_decision",
  "identifier_type": "tenant_slug",
  "policy_version": "slug-v2",
  "decision": "rejected",
  "reason_code": "non_ascii_disallowed",
  "canonical_hash": "sha256:...",
  "request_id": "..."
}
```

원본값이 꼭 필요한 분쟁 조사라면 일반 애플리케이션 로그가 아니라 접근 권한, 보존 기간, 조회 사유가 있는 암호화된 audit store에 둡니다. [구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/)의 원칙처럼 관측성은 많이 남기는 일이 아니라, 사고 때 필요한 질문에 안전하게 답할 수 있게 남기는 일입니다.

## 트레이드오프/주의점

1. **ASCII allowlist는 안전하지만 제품 범위를 좁힙니다.** 사용자 표시 이름까지 ASCII로 제한하면 국제화 사용자를 배제할 수 있습니다. security key와 display value의 책임을 분리하는 이유입니다.
2. **과한 정규화는 다른 사람을 같은 사람으로 만들 수 있습니다.** 호환성 정규화·case folding을 넓게 적용하기 전에는 기존 데이터 collision 보고서와 외부 IdP 왕복 테스트가 필요합니다.
3. **email provider 규칙을 추측하면 안 됩니다.** 점 제거, `+tag` 제거, 대소문자 접기는 provider·조직 정책에 따라 의미가 다릅니다. 자체 계정 병합 규칙으로 일반화하지 않습니다.
4. **로그 해시도 맥락에 따라 식별 가능할 수 있습니다.** 작은 후보 집합의 email·slug는 hash만으로도 추측될 수 있으므로 salt, 접근 제어, 보존 기간을 함께 설계합니다.
5. **규칙 변경은 URL과 외부 계약을 바꿉니다.** slug를 고치면 bookmark, OAuth callback, webhook endpoint, cache key가 함께 영향을 받을 수 있습니다. 이전은 데이터 작업이 아니라 API 변경으로 취급합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 로그인 ID, 표시 이름, 외부 subject, hostname allowlist가 서로 다른 데이터 분류로 문서화돼 있다.
- [ ] 보안 식별자는 원본·display·canonical·내부 ID 중 어떤 값을 비교하는지 코드와 스키마에서 확인할 수 있다.
- [ ] canonical column에 unique constraint가 있고, unique violation을 안정적인 409 또는 idempotent 결과로 처리한다.
- [ ] Unicode 변환·대소문자 규칙·external provider 원문 보존 규칙에 policy version이 있다.
- [ ] 새 정책은 shadow collision 관측과 수동 검토 없이 기존 계정에 일괄 적용하지 않는다.
- [ ] authorization은 canonical 문자열이 아니라 resolve된 내부 ID와 principal 관계를 확인한다.

### 연습 과제

1. 현재 서비스의 문자열 식별자 10개를 골라 display, lookup, authorization, external opaque ID 중 어디에 속하는지 표로 분류해 보세요.
2. tenant slug 하나에 대해 허용 문자, 길이, canonical 함수, unique index, rename redirect, rollback 기간을 1쪽 정책으로 작성해 보세요.
3. Unicode 조합 문자, 대소문자, 공백, confusable 문자, 동일 ID 동시 생성 요청을 포함한 테스트 벡터 15개를 만들고, 기대 결과와 audit reason code를 붙여 보세요.

## 관련 글

- [Spring Validation](/learning/deep-dive/deep-dive-spring-validation/)
- [OAuth2·OIDC](/learning/deep-dive/deep-dive-oauth2-oidc/)
- [BOLA 방지와 객체 수준 인가](/learning/deep-dive/deep-dive-object-level-authorization-bola-playbook/)
- [구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/)
