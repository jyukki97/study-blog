---
title: "백엔드 커리큘럼 심화: 애플리케이션 서명 키의 보관·회전·검증 운영 플레이북"
date: 2026-10-27
draft: false
topic: "Backend Security"
tags: ["KMS", "HSM", "Digital Signature", "Key Rotation", "Backend Security"]
categories: ["Backend Deep Dive"]
description: "API 응답, 웹훅, 문서, 토큰을 서명하는 애플리케이션 키를 KMS/HSM 보관, key ID, 이중 검증, 폐기, 관측의 관점에서 운영하는 기준을 정리합니다."
module: "backend-security"
study_order: 1566
---

JWT, 파트너 웹훅, 승인된 문서, 결제 요청은 “누가 어떤 내용을 승인했는가”를 증명해야 합니다. private key 하나를 환경변수에 넣고 `sign()`만 호출하면 끝난다고 생각하기 쉽습니다. 하지만 키가 유출됐을 때 어떤 결과물이 위조되는지, 키를 바꾼 뒤 과거 문서를 얼마나 검증해야 하는지, verifier가 새 `kid`를 모를 때 무엇을 해야 하는지는 코드 한 줄 밖의 운영 문제입니다.

핵심은 **서명 키를 암호 문자열이 아니라 제한된 권한을 가진 운영 자산으로 다루는 것**입니다. 이 글은 [Certificate Lifecycle과 mTLS Rotation](/learning/deep-dive/deep-dive-certificate-lifecycle-rotation-playbook/), [비밀 관리](/learning/deep-dive/deep-dive-secret-management/), [JWKS Key Rotation과 Verifier Cache](/learning/deep-dive/2026-10-13-jwks-key-rotation-verifier-cache-playbook/), [Downscoped Token Exchange](/learning/deep-dive/deep-dive-token-exchange-downscoped-token-playbook/)를 연결합니다.

## 이 글에서 얻는 것

- 인증서, 대칭 비밀, 애플리케이션 서명 키가 각각 무엇을 증명하는지 구분합니다.
- private key를 KMS/HSM 뒤에 두고 서비스가 최소한의 `sign` 권한만 갖게 만듭니다.
- `kid`, 허용 알고리즘, dual verification, 검증 종료일을 포함한 rotation 상태 기계를 설계합니다.
- 키 유출·알고리즘 취약점·검증 키 캐시 불일치에서 중단과 복구의 우선순위를 정합니다.

## 핵심 개념/이슈

### 1) 암호화 키와 서명 키는 보장하는 사실이 다르다

암호화는 내용을 읽지 못하게 만들고, 서명은 특정 키를 가진 주체가 특정 바이트열을 승인했다는 사실을 검증하게 합니다. HMAC처럼 shared secret을 쓰는 방식도 있지만 verifier도 비밀을 알아야 하므로 검증자를 넓게 둘수록 유출 면적이 커집니다. 여러 파트너가 문서·웹훅·token을 확인해야 한다면 보통 비대칭 서명이 운영상 더 낫습니다.

| 목적 | 수단 | verifier가 갖는 것 | 대표 위험 |
| --- | --- | --- | --- |
| 데이터 기밀성 | envelope encryption | 복호화 권한 | 과도한 복호화 권한 |
| 내부 요청 인증 | mTLS, workload identity | CA trust와 policy | 인증과 인가의 혼동 |
| 외부 검증 가능한 승인 | Ed25519/ECDSA/RSA | public key 또는 JWKS | private key 유출 |
| 내부 무결성 확인 | HMAC | shared secret | verifier로의 비밀 확산 |

서명은 “유효한 키로 만들어졌다”는 사실만 보장합니다. 주문 금액, 만료 시간, 대상 고객, audience가 payload에 없거나 verifier가 이를 확인하지 않으면 정상 서명도 재사용 공격에 쓰일 수 있습니다. 검증은 `verify(signature)` 한 줄이 아니라 **서명 대상의 의미와 사용 조건을 다시 확인하는 정책**입니다.

### 2) private key는 파일이 아니라 sign 권한으로 둔다

강한 기본값은 서비스가 private key bytes를 읽지 못하게 하는 것입니다. KMS, cloud key vault, HSM, 또는 중앙 signing service가 키를 보관하고 애플리케이션에는 특정 key ID에 대한 `sign`만 허용합니다. 이 구조는 컨테이너 이미지, heap dump, CI log, 백업 파일에 key material이 섞일 가능성을 줄입니다.

```yaml
signing_policy:
  key_id: payment-receipt-ed25519-2026-10
  purpose: receipt_document
  allowed_callers:
    - workload: payments-api
      environment: production
  allowed_algorithms: [Ed25519]
  maximum_payload_bytes: 16384
  audit_fields: [request_id, document_id, key_id, caller_identity]
```

KMS를 쓴다고 끝나지 않습니다. `payments-api`가 모든 key를 서명할 수 있으면 권한 범위는 여전히 과도합니다. 목적과 caller를 좁히고, 결제 영수증·다운로드 권한·webhook envelope처럼 **나중에 독립 검증해야 하는 경계**에만 서명을 둡니다. signer p99가 80ms인데 요청당 20회 서명한다면 user-facing latency와 비용도 함께 계산해야 합니다.

### 3) `kid`는 키 이름이 아니라 검증 routing 계약이다

서명한 object에는 어떤 public key로 확인할지를 가리키는 `kid`가 필요합니다. 그러나 `kid`만 믿고 URL이나 임의 keyset을 따라가면 공격자가 verifier에게 자기 키를 고르게 할 수 있습니다. `kid`는 trusted issuer의 고정 keyset 안에서만 선택해야 하고 알고리즘도 allowlist와 일치해야 합니다.

```json
{"issuer":"receipt-service","kid":"receipt-ed25519-2026-10","alg":"EdDSA","issued_at":"2026-10-27T01:10:00Z","expires_at":"2026-11-26T01:10:00Z","audience":"partner-a","payload_hash":"sha256:..."}
```

verifier는 canonical serialization hash, issuer·audience, 발급·만료 시각과 허용 clock skew(예: 60초)를 함께 확인합니다. `alg=none`과 예상 밖 알고리즘 전환을 라이브러리 기본값에 맡기지 않습니다. unknown `kid`에 원격 fetch를 반복하지 말고 [verifier cache 정책](/learning/deep-dive/2026-10-13-jwks-key-rotation-verifier-cache-playbook/)처럼 단일 갱신과 짧은 negative cache를 둡니다.

### 4) rotation은 새 키 생성이 아니라 검증 기간의 상태 전이다

서명 키에는 `planned → active_for_signing → verify_only → revoked → destroyed` 상태가 필요합니다. `active_for_signing`은 새 데이터에 쓰는 유일한 키이고, `verify_only`는 과거 결과물을 확인할 때만 남깁니다. 기간은 키 자체가 아니라 **결과물 max validity + verifier cache + 전파 여유**로 계산합니다.

| 대상 | max validity 예시 | old key verify-only | 핵심 관측값 |
| --- | ---: | ---: | --- |
| 단기 다운로드 URL | 15분 | 24시간 내외 | unknown-kid, expiry reject |
| partner webhook | 5분 재전송 | 7~30일 | old/new `kid`, replay reject |
| 발행 영수증 | 180일 이상 | 보존 정책에 맞춤 | historical verify success |
| 서비스 간 assertion | 5분 | 7~14일 | issuer·audience mismatch |

새 키 생성 → public key 배포 → verifier canary → 새 키 서명 전환 → old key 사용량 관찰 → verify-only 종료 순서를 지킵니다. 오래된 client나 문서가 실패할 수 있으므로 실패량·고객 영향·지원 경로를 먼저 분류하고 종료 기준을 문서화합니다.

## 실무 적용

### 1) key inventory와 목적 레지스트리를 먼저 만든다

키 별칭만 모아 두면 누가 어떤 결과물을 신뢰하는지 알 수 없습니다. key registry에는 `key_id`, owner, purpose, algorithm, custody, sign-stop 시각, verify-until, public key 배포 경로, emergency action을 둡니다. `purpose`를 “application-signing”처럼 넓게 적지 마세요. billing receipt, login assertion, partner webhook은 유출 시 피해·유효기간·consumer가 다릅니다. 한 key가 여러 목적에 쓰이면 rotation 중단과 유출 대응의 blast radius도 함께 커집니다.

### 2) 1% canary와 중단 기준으로 정기 회전한다

새 키는 내부 partner 또는 1%에서 시작합니다. 30~60분 동안 `signature_verify_failure_rate`, `unknown_kid_rate`, KMS sign p95, downstream 4xx, old/new `kid` 비율을 봅니다. 정상이면 10% → 50% → 100%로 늘리고, 각 단계는 서비스 p99 retry window보다 길게 관찰합니다.

new-key verifier failure이 baseline보다 0.1%p 이상 오르거나 unknown `kid`가 전체 검증의 0.5%를 넘은 상태가 10분 지속되면 새 키 서명을 멈춥니다. 이 rollback은 **key material 유출이 아닌 호환성 장애**에만 안전합니다. 유출 의심이나 알고리즘 취약점은 old key를 재활성화하면 안 되며, 검증 차단·재발급·영향 대상 무효화가 우선입니다.

### 3) 유출 대응은 정상 rotation과 다른 runbook이다

비정상 caller가 보이거나 CI artifact에 private key가 노출된 의심이 생기면 해당 key ID의 sign 권한을 즉시 차단하고, caller principal의 token·secret을 함께 회전합니다. 이어서 그 key로 서명된 결과물의 유효기간, audience, 재사용 가능성을 inventory에서 확인합니다. 토큰·download grant처럼 즉시 무효화 가능한 결과물은 denylist로 차단하고, 이미 외부에 보관된 영수증 같은 문서는 별도 incident policy로 제한 검증 또는 재발행을 결정합니다.

`verify_only`는 편리하지만 유출 키에는 위험합니다. 공격자가 긴 유효기간 payload를 새로 만들 수 있다면 old public key를 계속 신뢰하는 것 자체가 문제입니다. 정상 rotation의 가용성 규칙과 보안 incident의 차단 규칙을 한 자동화로 섞지 않아야 합니다.

## 트레이드오프/주의점

KMS/HSM은 key export 위험을 낮추지만 network hop, quota, provider 장애를 없애지 않습니다. signer를 request hot path에 넣는다면 timeout·retry·idempotency를 설계해야 합니다. timeout 뒤 KMS가 실제로 서명했는지 알 수 없다면 동일 request ID와 signing intent hash로 결과를 조회하거나, 같은 결과물을 이중 발급해도 되는지 정해야 합니다. [외부 side effect의 commit boundary](/learning/deep-dive/2026-10-26-commit-boundary-external-side-effects-playbook/)와 마찬가지로 “응답을 못 받았으니 재시도”는 중복 사실을 만들 수 있습니다.

임의 `jku`, `x5u`, URL header를 그대로 따르면 verifier가 외부 입력으로 신뢰 경계를 결정하게 됩니다. trusted issuer, allowlisted keyset, pinned algorithm을 기본값으로 두세요. 너무 짧은 rotation 주기도 항상 안전하지 않습니다. 자동화와 verifier 전파가 성숙하지 않았다면 분기 1회 rotation과 월 1회 verify drill부터 성공시키는 편이 낫습니다.

## 체크리스트 또는 연습

- [ ] private key가 설정·이미지·CI artifact·일반 로그에 존재하지 않고, caller는 최소 범위의 sign 권한만 갖는다.
- [ ] 키마다 purpose, owner, algorithm, custody, active/verify-only/revoked 시각, consumer, 비상 runbook이 있다.
- [ ] verifier는 fixed issuer keyset에서만 `kid`를 찾고 algorithm·audience·expiry·canonical payload를 함께 확인한다.
- [ ] 1% canary와 unknown-kid, verifier failure, signer latency의 중단 기준을 둔다.
- [ ] old key verify-only 종료일은 결과물 max validity, cache, 전파 여유를 더해 계산한다.
- [ ] key compromise 시 sign 중단, credential rotation, 결과물 무효화, 재발급 순서가 문서화돼 있다.

연습으로 서명이 필요하다고 생각하는 데이터 하나를 고르세요. 누가 검증하는지, 결과물이 최대 얼마 동안 유효한지, 유출 시 무엇을 즉시 무효화할 수 있는지 네 줄로 적습니다. 답이 없다면 KMS key를 하나 더 만드는 것보다 signing purpose와 verifier contract를 먼저 좁히는 일이 안전합니다.

## 관련 글

- [Certificate Lifecycle과 mTLS Rotation](/learning/deep-dive/deep-dive-certificate-lifecycle-rotation-playbook/)
- [비밀 관리](/learning/deep-dive/deep-dive-secret-management/)
- [JWKS Key Rotation과 Verifier Cache](/learning/deep-dive/2026-10-13-jwks-key-rotation-verifier-cache-playbook/)
- [Downscoped Token Exchange](/learning/deep-dive/deep-dive-token-exchange-downscoped-token-playbook/)
- [Commit Boundary와 External Side Effect](/learning/deep-dive/2026-10-26-commit-boundary-external-side-effects-playbook/)
