---
title: "2026 개발 트렌드: HTTP Message Signatures로 API 호출 출처·변조·재전송을 분리해 검증하는 법"
date: 2026-10-11T10:06:00+09:00
lastmod: 2026-10-11T10:06:00+09:00
draft: false
tags: ["HTTP Message Signatures", "API Security", "Webhooks", "OAuth", "Zero Trust", "Backend"]
categories: ["Development", "Security", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["HTTP Message Signatures", "RFC 9421", "API request signing", "replay protection", "webhook security"]
description: "토큰만으로 설명하기 어려운 대리 호출·webhook·agent 호출이 늘면서, HTTP Message Signatures를 출처·무결성·재전송 방지 계약으로 운영하는 기준을 정리합니다."
summary: "서명은 access token을 대체하는 만능 인증이 아니다. 어떤 HTTP 구성요소를 묶을지, key를 어떻게 식별·회전할지, nonce와 만료를 어느 구간에서 검증할지, 프록시를 지나도 어떤 증거를 믿을지를 명시할 때 비로소 호출 출처를 검증하는 운영 계약이 된다."
---

서비스 간 API 호출은 한동안 `Authorization: Bearer ...`로 설명하기 편했습니다. 하지만 webhook 수신, 파트너 연동, edge worker, 백엔드가 대신 실행하는 사용자 요청, AI agent의 도구 호출처럼 호출 주체와 실행 경로가 다양해지면서 토큰 하나만으로는 답하기 어려운 질문이 늘고 있습니다. 이 요청은 **누가 만든 것인가**, 경로·본문·중요 헤더가 중간에 바뀌지 않았는가, 오래된 요청을 다시 보낸 것은 아닌가, key가 폐기된 뒤에도 허용되는가가 그 질문입니다.

HTTP Message Signatures는 HTTP method, target URI, 선택한 header와 본문 digest 같은 구성요소를 서명해 이 질문에 필요한 증거를 전달하는 표준화된 방식입니다. 다만 서명을 붙인다고 자동으로 인증·인가·재전송 방지가 완성되지는 않습니다. 이 글은 [inbound webhook 수신기 설계](/learning/deep-dive/deep-dive-inbound-webhook-receiver-playbook/), [API key 회전·폐기](/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/), [DPoP sender-constrained token](/learning/deep-dive/2026-10-08-dpop-sender-constrained-access-token-playbook/)의 원칙을 연결해, 요청 서명을 production 계약으로 도입할 때의 결정을 정리합니다.

## 이 글에서 얻는 것

- Bearer token, mTLS, DPoP, HTTP Message Signatures가 각각 증명하는 범위를 구분합니다.
- method·URI·digest·시간·nonce 중 무엇을 서명하고 수신 측에서 어떤 순서로 검증할지 설계할 수 있습니다.
- key 식별자, JWKS 또는 key registry, rotation, revocation을 서비스 장애 없이 운영하는 기준을 세웁니다.
- replay cache·clock skew·reverse proxy 때문에 생기는 실패를 관찰하고 점진 배포하는 방법을 배웁니다.

## 핵심 개념/이슈

### 1) 서명은 "누구의 어떤 요청"을 묶는 증거다

Bearer token은 유효한 토큰을 가진 주체가 호출했다는 인증 재료입니다. 그러나 토큰이 로그·브라우저 확장·잘못된 proxy 경로 등에서 유출되면 복사본도 같은 권한으로 동작합니다. mTLS는 연결 상대의 인증에 강하지만, 연결 종료 지점이 여러 개인 환경에서 애플리케이션이 어떤 HTTP 요청이 어떤 key와 연결됐는지 보려면 별도 전달 계약이 필요할 수 있습니다. DPoP는 token을 공개키 증명과 결합해 sender constraint를 강화합니다.

HTTP Message Signatures는 이들을 대체하기보다 **개별 HTTP 메시지의 무결성과 출처 주장을 묶는 층**으로 쓰는 경우가 많습니다. 서명 입력에는 보통 다음을 넣습니다.

```text
@method: POST
@target-uri: https://api.example.com/v1/payouts
content-digest: sha-256=:...:
created: 1791680700
expires: 1791680820
nonce: 6b4f...
keyid: partner-acme-2026-10
alg: ed25519
```

여기서 중요한 것은 algorithm 이름보다 범위입니다. `POST /v1/payouts`를 `POST /v1/refunds`로 바꾸거나, 금액이 담긴 본문을 바꾸거나, 과거의 유효한 요청을 다시 보내면 검증이 실패해야 합니다. 따라서 method와 target URI를 묶고, write 요청에는 본문 전체 또는 표준 `Content-Digest`를 포함하며, 시간과 nonce를 같이 사용합니다. URI의 query, host, port, path normalization 규칙을 송신·수신 양쪽에서 정확히 합의하지 않으면 정상 요청도 계속 실패합니다.

### 2) 검증 성공은 인가 성공이 아니다

유효한 서명은 key holder가 메시지를 만들었다는 주장만 검증합니다. 그 key가 이 고객의 payout을 만들 권한이 있는지, 요청의 `tenant_id`가 key의 tenant와 일치하는지, 금액 한도를 넘는지는 별도의 authorization과 business validation이 판단해야 합니다. 서명 key를 "파트너 전체"에 공유한 채 request의 `partner_id`만 믿으면 tenant 경계가 흔들립니다.

| 계층 | 검증하는 질문 | 실패 시 기본 처리 |
| --- | --- | --- |
| 전송 보안 | 통신 상대와 채널이 보호되는가 | TLS/mTLS 실패면 연결 거부 |
| message signature | 지정된 key가 이 method·URI·digest를 서명했는가 | 401 또는 webhook drop, 원인 코드 기록 |
| replay protection | 시간 창 안의 새 요청인가 | 409/401 또는 idempotent duplicate 처리 |
| authorization | 이 key가 이 tenant·action·resource에 권한이 있는가 | 403, audit event |
| business validation | 금액·상태 전이·중복이 유효한가 | 도메인 오류와 idempotency 결과 반환 |

이 분리는 운영에서도 중요합니다. signature failure가 급증하면 key distribution, proxy canonicalization, clock 문제를 먼저 봅니다. authorization denial이 증가하면 partner 설정 또는 scope 문제를 봅니다. 둘을 같은 401 지표에만 합치면 심각한 replay 공격과 정상 key의 권한 설정 오류를 구분하기 어렵습니다.

### 3) replay 방지는 "짧은 시간"만으로 충분하지 않다

`created`와 `expires`를 넣어 5분보다 오래된 요청을 거부하면, 5분 안에 캡처한 동일 요청의 반복 전송은 막지 못합니다. 고위험 write endpoint에는 nonce 또는 signature identifier를 재사용 불가 키로 저장해야 합니다. 수신자는 `(keyid, nonce)` 혹은 `(keyid, signature hash)`를 TTL cache에 원자적으로 기록하고, 이미 있으면 재전송으로 처리합니다.

시작값으로 `created` 허용 skew는 **±60초**, 최대 validity window는 **2~5분**, nonce cache TTL은 `expires - created + skew`보다 길게, 예를 들어 **10분**으로 둘 수 있습니다. 결제나 권한 변경처럼 재전송 비용이 큰 endpoint는 60초 window와 24시간의 idempotency key ledger를 병행하는 편이 낫습니다. 반대로 대량 telemetry webhook에 무조건 전역 nonce cache를 두면 저장 비용과 hot key가 문제가 됩니다. endpoint 위험도와 retry 계약을 기준으로 다르게 정해야 합니다.

## 실무 적용

### 1) endpoint별 signed-component 계약을 먼저 작성한다

서명 도입에서 가장 흔한 실패는 library의 기본값을 그대로 쓰고, 어떤 필드가 신뢰 경계인지 문서화하지 않는 것입니다. endpoint마다 다음 표처럼 계약을 작성하세요.

| Endpoint class | 반드시 묶을 항목 | 시간·nonce | 추가 조건 |
| --- | --- | --- | --- |
| read API | method, target URI, host | 2분, nonce 선택 | token scope와 cache semantics 확인 |
| write API | method, target URI, content-digest, content-type | 60~300초 + nonce 필수 | idempotency key와 tenant binding 필수 |
| webhook | method, target URI, content-digest, event ID | provider retry window 내 nonce/event dedup | raw body를 검증 전 변환하지 않음 |
| file callback | method, target URI, digest, content-length | 짧은 TTL + nonce | URL redirect, size, media type 별도 검증 |

특히 reverse proxy가 `Host`나 scheme을 바꾸는 구조에서는 내부 요청 URI와 외부에서 서명한 URI가 달라질 수 있습니다. 임의의 `X-Forwarded-Host`를 신뢰해서 맞추면 host injection을 열 수 있습니다. 신뢰하는 ingress가 설정한 forwarded metadata만 받아 canonical external URI를 재구성하고, 그 ingress의 source network와 header overwrite 정책을 운영 문서에 남기세요. API 설명 자체가 drift하지 않도록 [OpenAPI overlays로 API 설명을 통제하는 방법](/posts/2026-10-09-openapi-overlays-api-description-governance-trend/)처럼 signature requirement도 API contract의 일부로 관리하는 편이 좋습니다.

### 2) 검증 파이프라인을 cheap failure부터 구성한다

비싼 공개키 검증과 DB 조회를 모든 공격 요청에 먼저 수행할 필요는 없습니다. 다음 순서는 과부하와 정보 노출을 줄입니다.

1. header 형식, 허용 algorithm, signed component 목록, `created/expires`의 범위를 파싱합니다. 허용하지 않은 algorithm 또는 누락된 content digest는 여기서 거절합니다.
2. 신뢰하는 proxy 정보로 canonical request를 만듭니다. raw body는 digest 검증 전 JSON으로 파싱하거나 재직렬화하지 않습니다.
3. `keyid`로 현재 또는 grace period의 public key를 조회하고, key 상태가 active인지 확인합니다. unknown key의 이유를 외부 응답에 자세히 노출하지 않습니다.
4. 서명과 digest를 검증합니다. 실패율은 keyid의 원문 대신 내부 key class·partner group으로 집계합니다.
5. nonce를 원자적으로 claim하고, 그 뒤에 token scope·tenant·도메인 idempotency를 검증합니다.

key registry가 원격 dependency라면 request path에서 매번 조회하지 마세요. public key/JWKS cache의 TTL을 **5~15분**으로 두고, rotation event 또는 `kid` miss일 때 제한된 refresh를 합니다. 하지만 revoked key를 15분 더 허용해도 되는지 endpoint별 판단이 필요합니다. payout, account deletion 같은 high-risk 경로는 cache TTL을 더 짧게 하거나 revocation push를 요구하고, key registry 장애 시 fail-closed가 원칙입니다. 읽기 전용 저위험 데이터는 명시적 degraded policy를 둘 수 있습니다.

### 3) 도입은 observe → warn → enforce 순으로 제한한다

기존 partner를 한 번에 차단하면 clock이 3분 틀어진 한 공급자 때문에 정상 업무가 멈출 수 있습니다. 다음 단계처럼 signature 결과를 control plane 데이터로 먼저 쌓으세요.

| 단계 | 동작 | 통과 기준 | 중단 기준 |
| --- | --- | --- | --- |
| observe | 서명 없이도 처리, 가능하면 검증 결과만 기록 | canonicalization mismatch 원인 분류 완료 | 실패 원인이 불명확한 비율 0.5% 초과 |
| warn | 새 client에 signature 요구 예고, response header/portal 경고 | 7일간 valid signature 99.9% 이상 | 특정 partner의 401 급증 |
| enforce-canary | partner 또는 tenant 1~5%에 강제 | signature failure 0.1% 미만, replay cache 안정 | high-risk write의 검증 우회 1건 |
| enforce | endpoint class별 전체 적용 | key rotation·장애 drill 통과 | key registry outage 시 정책 불명확 |

이 과정에서는 검증 성공률만 보지 말고 `failure_reason`을 `expired`, `clock_skew`, `unknown_key`, `digest_mismatch`, `canonicalization_mismatch`, `replay`로 분류합니다. `unknown_key`가 늘면 rotation 배포 순서 문제일 수 있고, `digest_mismatch`는 body compression이나 framework middleware가 body를 바꾼 신호일 수 있습니다. error log에 전체 authorization header, raw signature, request body를 남기는 것은 디버깅 편의보다 위험이 큽니다. correlation ID, reason class, key alias, component set, request size 정도로 제한하세요.

## 트레이드오프/주의점

첫째, message signature는 모든 내부 API에 즉시 필요한 기술이 아닙니다. 이미 짧은 수명의 workload identity와 mTLS가 있고 network boundary가 명확한 내부 호출에는 서명 검증이 latency와 key 운영 복잡도만 더할 수 있습니다. 파트너 webhook, 고위험 command API, proxy를 여러 번 지나는 delegated request처럼 "메시지 자체의 출처 증거"가 필요한 곳부터 시작하세요.

둘째, body digest는 무결성을 높이지만 streaming upload와 대형 payload에서 buffering 비용을 만듭니다. 수백 MB 파일을 메모리에 올려 digest를 계산하면 보안 기능이 가용성 문제로 바뀝니다. streaming digest, content-length 상한, 사전 서명된 object upload, 별도 callback 서명 중 어떤 패턴을 쓸지 파일 흐름에 맞춰 결정해야 합니다. [업로드 격리·검사 경계](/learning/deep-dive/deep-dive-object-upload-quarantine-scanning-playbook/)처럼 signature가 악성 파일 검사를 대신하지 않는다는 점도 분명히 하세요.

셋째, clock은 분산 시스템의 숨은 의존성입니다. 지나치게 넓은 skew는 replay 창을 넓히고, 지나치게 좁은 skew는 NTP drift와 queue delay로 정상 요청을 막습니다. clock skew 분포를 먼저 관찰한 뒤 60초에서 시작하고, 비동기 전달의 지연은 message signature validity가 아니라 event ID·idempotency·delivery attempt 정책으로 다루는 편이 안전합니다.

넷째, key rotation은 새 key를 추가하는 일과 이전 key를 제거하는 일이 다릅니다. publish → 소비자 cache refresh → 새 key signing → telemetry 확인 → 이전 key revoke 순서를 갖추지 않으면 정상 traffic을 끊습니다. break-glass key를 평상시 signing key처럼 쓰거나, `keyid`에 고객 이메일·환경 비밀을 넣는 일도 피해야 합니다.

## 체크리스트 또는 연습

### production 도입 체크리스트

- [ ] endpoint별로 method, canonical target URI, 필수 headers, content digest, expiry, nonce 정책을 문서화했다.
- [ ] 서명 검증과 authorization·tenant binding·business idempotency를 별도 단계와 지표로 분리했다.
- [ ] keyid는 활성/유예/폐기 상태를 가진 registry에서 관리하며, rotation 순서와 cache TTL을 시험했다.
- [ ] replay cache의 원자 claim, TTL, 장애 시 fail policy가 endpoint 위험도에 맞는다.
- [ ] proxy가 overwrite한 trusted forwarded header만 canonicalization에 사용한다.
- [ ] observe → warn → enforce canary를 거쳤고, failure reason별 비율과 raw secret 없는 로그를 확인했다.
- [ ] key registry 장애, clock drift, 이전 key 재사용, body mutation을 포함한 failure drill을 수행했다.

### 연습: partner payout webhook 계약 만들기

한 파트너가 `POST /v1/payout-events?region=kr`로 payout event를 보낸다고 가정해 봅시다. `@method`, `@target-uri`, `content-digest`, `content-type`, `created`, `expires`, `nonce` 중 어떤 것을 signed component로 강제할지 적어 보세요. 그 다음 90초 늦게 재시도된 같은 event와, 10초 뒤 nonce만 바꾼 변조 요청을 어떻게 구분할지 설계합니다. event ID가 같으면 도메인 idempotency 결과를 반환하고, nonce가 중복이면 replay로 기록하며, key가 revoked라면 cache miss refresh 후 fail-closed하는 순서를 적을 수 있다면 계약의 핵심은 갖춘 셈입니다.
