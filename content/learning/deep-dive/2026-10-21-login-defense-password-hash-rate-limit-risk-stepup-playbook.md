---
title: "백엔드 커리큘럼 심화: 로그인 방어를 Password Hash Cost·Rate Limit·Risk Step-Up으로 분리 설계하는 법"
date: 2026-10-21T10:06:00+09:00
lastmod: 2026-10-21T10:06:00+09:00
draft: false
topic: "Backend Security"
tags: ["Authentication", "Password Hashing", "Argon2id", "Rate Limiting", "Credential Stuffing", "Risk-Based Authentication"]
categories: ["Backend Deep Dive", "Security"]
description: "로그인 엔드포인트를 비밀번호 해시 비용, 다중 기준 throttling, 위험 기반 step-up 인증으로 분리해 credential stuffing과 자원 고갈을 함께 막는 운영 기준을 정리합니다."
module: "backend-security"
study_order: 1260
---

로그인은 대부분의 서비스에서 가장 작은 API처럼 보이지만, 공격자에게는 계정 탈취와 CPU·메모리 고갈을 동시에 시도할 수 있는 입구입니다. 비밀번호를 강한 해시로 저장해도 로그인 요청마다 비싼 검증을 수행하면 bot이 그 비용을 우리 서버에 떠넘길 수 있습니다. 반대로 IP당 요청 수만 낮추면 NAT 환경의 정상 사용자를 막거나, 분산 프록시를 쓰는 credential stuffing을 놓치기 쉽습니다.

따라서 로그인 방어는 하나의 `rateLimit()`이나 계정 잠금 정책으로 끝내기보다, **비밀번호 검증 비용**, **공격 트래픽을 걸러 내는 admission 정책**, **성공 뒤의 위험 평가와 추가 인증**을 서로 다른 계층으로 둬야 합니다. 이 글은 [비밀번호·자격증명 수명주기](/learning/deep-dive/deep-dive-password-credential-lifecycle-playbook/), [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/), [고위험 작업 Step-up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/), [TLS Handshake와 전송 구간 보호](/learning/deep-dive/deep-dive-tls-handshake/)를 로그인 경로에 맞춰 연결합니다.

## 이 글에서 얻는 것

- password hash parameter를 보안 문구가 아니라 서버 용량 예산과 함께 조정하는 방법을 배웁니다.
- 계정·IP·디바이스·ASN 등 서로 다른 key의 제한을 왜 겹쳐야 하는지 이해합니다.
- 실패 응답의 균일성, 지연, 잠금 정책이 account enumeration과 denial of service에 미치는 영향을 구분합니다.
- 위험 신호가 있을 때 무조건 계정을 잠그지 않고 step-up, 알림, 세션 제한을 선택하는 기준을 만듭니다.

## 핵심 개념/이슈

### 1) 로그인 한 번에는 서로 다른 세 가지 비용이 있다

로그인 요청에는 최소 세 경로가 섞입니다. 첫째, 식별자 정규화와 계정 조회입니다. 둘째, 저장한 hash와 제출된 비밀번호를 비교하는 CPU·메모리 비용입니다. 셋째, 성공했을 때 세션·refresh token·감사 로그를 발급하는 상태 변경입니다. 이 세 비용을 같은 미들웨어에서 처리하면 “잘못된 비밀번호” 요청도 정상 로그인과 거의 같은 자원을 쓰고, 공격이 시작됐을 때 어디서 병목이 났는지 알기 어렵습니다.

특히 credential stuffing은 한 계정에 비밀번호를 반복 대입하는 단순 brute force와 다릅니다. 유출된 여러 ID·비밀번호 조합을 넓은 IP 대역에서 한두 번씩 시도합니다. IP당 100회/분 제한은 이 공격에 느슨하고, 계정당 5회 실패 뒤 영구 잠금은 정상 사용자가 공격자 때문에 계정을 못 쓰게 만드는 DoS 도구가 됩니다. 로그인 방어의 우선순위는 **비싼 검증 전에 명백한 악성 트래픽을 줄이고, 정상 사용자의 복구 경로는 남기며, 성공 뒤에도 위험을 다시 판단하는 것**입니다.

### 2) password hash cost는 동시 공격 예산과 함께 정한다

Argon2id, bcrypt, scrypt 같은 password hash는 빠를수록 좋은 함수가 아닙니다. 공격자가 대량 추측할 때 비싸게 만들기 위해 의도적으로 느립니다. 하지만 애플리케이션에선 동시 요청 수에 곱해집니다. 평균 hash 검증이 220ms이고 인증 워커가 안전하게 감당할 수 있는 동시 검증이 40개라면, hash만으로 약 8.8 CPU-seconds/s의 작업이 생깁니다. DB, TLS, audit, GC 여유를 빼지 않은 수치이므로 이를 일반 API pool과 공유하면 쉽게 포화됩니다.

현실적인 출발점은 staging 또는 production과 유사한 인스턴스에서 parameter 후보를 측정하는 것입니다. 예를 들어 Argon2id는 서비스 환경에 따라 memory 64~128 MiB, iteration 2~3, parallelism 1~2를 후보로 두고, **단일 검증 p95가 150~300ms**, 인증 전용 pool의 CPU가 평시 60% 아래라는 조건을 함께 확인할 수 있습니다. 이 값은 복사해 쓸 표준값이 아닙니다. 작은 VM, serverless, memory-constrained pod에서는 같은 memory cost가 OOM을 일으킬 수 있으므로 부하 시험 결과가 우선입니다.

| 관측값 | 위험 신호 | 먼저 할 조치 |
| --- | --- | --- |
| hash verify p95 | 기준선보다 2배 이상 | hash parameter를 즉시 낮추기 전에 bot filter·인증 pool queue를 점검 |
| 인증 worker 대기열 | 30초 이상 지속 증가 | 일반 API와 pool 분리, pre-hash admission 강화 |
| pod memory 또는 GC pause | 80% 이상 지속 또는 OOM 재시작 | memory cost·동시 검증 상한을 함께 낮추고 재측정 |
| 실패 로그인 비율 | 평시보다 3배 이상 | 계정·IP·디바이스 분포와 성공 후 위험 신호를 분리 분석 |

hash 알고리즘을 교체할 때는 모든 사용자를 한 번에 재해시하지 않습니다. 저장 레코드에 `algorithm`, `version`, `params`를 두고, 성공 로그인 때만 현재 권장 parameter로 재해시합니다. 구형 hash를 읽을 수 있는 기간과 종료일을 정하고, 비밀번호 재설정에도 최신 parameter를 사용하세요. 이 방식은 [자격증명 수명주기](/learning/deep-dive/deep-dive-password-credential-lifecycle-playbook/)의 rotation과 migration 원칙을 그대로 따릅니다.

### 3) throttling key는 하나가 아니라 신뢰도가 다른 여러 층이다

IP만 믿으면 회사 NAT나 이동통신망의 정상 사용자를 같이 제한할 수 있고, 계정 ID만 믿으면 존재하지 않는 계정을 무한 생성해 hash 경로를 두드릴 수 있습니다. 그래서 다음처럼 역할이 다른 key를 겹칩니다.

| 계층 | 예시 key | 초기 기준 | 목적 |
| --- | --- | --- | --- |
| edge | IP prefix·ASN·TLS fingerprint | 알려진 악성 신호는 즉시 차단, 미확인 IP는 20~60회/분 | 비싼 경로 진입 전 대량 자동화 완화 |
| identity | 정규화한 account identifier | 동일 계정 실패 5회/15분부터 지연 증가 | 표적 계정 공격 속도 낮춤 |
| device/session | 신뢰도 낮은 device cookie·세션 이력 | 새 디바이스 성공 뒤 고위험 작업 보류 | 탈취 성공 뒤 피해 축소 |
| global | 인증 pool queue·CPU·memory | 동시 hash 40개, queue 100개 같은 hard cap | 서비스 전체 생존 보장 |

숫자는 product risk에 맞춰 바꿔야 하지만, 순서는 바꾸지 않는 편이 좋습니다. 먼저 stateless edge에서 명백한 비정상 요청을 싼 비용으로 걸러 내고, 다음으로 계정별 실패를 천천히 만든 뒤, 마지막으로 인증 자원 전체에 circuit breaker를 둡니다. global cap에 닿았다고 DB connection pool을 더 열거나 hash cost를 0으로 낮추면 공격자는 성공합니다. 이때는 짧은 `429` 또는 재시도 안내를 내고, [Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)처럼 회복 시간을 보호해야 합니다.

### 4) 실패 응답은 같게, 내부 증거는 다르게 남긴다

“존재하지 않는 계정입니다”와 “비밀번호가 틀렸습니다”를 구분하면 account enumeration을 돕습니다. 외부에는 상태 코드, 본문, 응답 시간을 가능한 비슷하게 두고 “로그인 정보를 확인해 주세요” 정도로 응답합니다. 다만 모든 요청에 가짜 hash 계산을 무조건 수행할 필요는 없습니다. 이미 edge rule에서 막힌 요청, 명백히 형식이 깨진 식별자, global admission이 닫힌 상태까지 같은 비싼 처리로 흘려 보내면 방어가 공격 증폭기가 됩니다.

내부에는 account 존재 여부, 실제 hash 검증 여부, limiter hit, 위험 점수, 발급한 세션 ID를 분리된 security event로 남깁니다. 로그에는 비밀번호·reset token·완전한 IP·원문 User-Agent를 넣지 말고, 필요하면 짧은 retention의 pseudonymous identifier나 prefix를 씁니다. 외부 응답의 균일성과 내부 관측 가능성은 충돌하지 않습니다. 전자는 공격자에게 주는 정보를 줄이고, 후자는 운영자가 잘못된 차단과 실제 공격을 구분하게 합니다.

## 실무 적용

### 1) 성공·실패를 한 정책으로 묶지 말고 위험 기반 상태 전이를 만든다

실패 횟수만으로 계정을 잠그는 대신, 아래처럼 결과와 위험 신호를 조합합니다. 위험 신호는 낯선 국가라는 단일 정보보다 새 디바이스, 짧은 시간의 많은 계정 시도, 유출 자격증명 hit, 불가능한 이동, proxy reputation처럼 독립적인 신호의 조합이 낫습니다. 위치·기기 신호는 오탐이 있으므로 증거가 아니라 **추가 확인이 필요한 힌트**로만 취급하세요.

| 상태 | 예시 조건 | 기본 조치 | 사용자 복구 경로 |
| --- | --- | --- | --- |
| 정상 | 성공, 위험 신호 없음 | 표준 세션 발급 | 없음 |
| 주의 | 새 디바이스 + 계정 실패 이력 | 짧은 세션, 민감 변경 step-up | 이메일 또는 authenticator 재확인 |
| 고위험 | 다수 계정 시도 + 비정상 IP 평판 | 세션 발급 보류, MFA 강제 | rate limit 후 안전한 재시도 |
| 보호 모드 | account takeover 징후 또는 global cap | 새 세션·비밀번호 변경 제한, 보안 알림 | 기존 신뢰 세션·지원 복구 절차 |

step-up은 로그인 자체를 영구적으로 막는 잠금보다 사용자 친화적인 경우가 많습니다. 단, 공격자가 탈취한 이메일 세션까지 갖고 있을 수 있는 서비스라면 이메일 링크만으로 위험을 해소했다고 보면 안 됩니다. 결제 수단 변경, MFA 해제, API key 발급처럼 피해가 큰 작업은 [고위험 작업의 Step-up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/)을 별도로 요구하고, step-up 성공도 짧은 시간과 특정 action에만 묶으세요.

### 2) 인증 전용 자원과 정책 변경을 독립적으로 롤아웃한다

로그인 경로는 application worker, DB pool, hash executor, event sink를 별도 metric으로 보이게 해야 합니다. 첫 배포에서는 rule을 바로 차단 모드로 놓지 말고, 7일 정도 observe-only로 hit 수·정상 사용자 추정 비율·지원 문의를 봅니다. 그 뒤 가장 신뢰도 높은 global concurrency cap과 알려진 악성 rule부터 enforce하고, account/device 규칙은 5~10% 트래픽에 canary로 적용합니다.

정책 변경의 rollback도 미리 정합니다. 예를 들어 로그인 성공률이 같은 시간대 기준선보다 2%p 이상 하락하거나 정상 고객의 support ticket이 24시간 내 2배가 되면, 새 fingerprint rule만 해제하고 hash parameter나 전체 MFA 정책을 성급히 되돌리지 않습니다. 정책 ID와 version을 security event에 붙여야 이 판단이 가능합니다.

```text
request
  -> edge deny / coarse limit
  -> account lookup + identity limit
  -> bounded hash executor
  -> password verification
  -> risk evaluation
  -> standard session | restricted session | step-up required
```

이 흐름에서 hash executor가 포화되면 실패 요청을 무한 대기시키지 않습니다. 짧은 timeout 뒤 일반적인 재시도 응답을 주되, 클라이언트가 retry storm을 만들지 않도록 `Retry-After`와 exponential backoff 원칙을 문서화합니다. 인증은 “모든 요청을 끝까지 처리”하는 경로가 아니라, 정상 사용자의 다음 안전한 시도를 보장하는 경로입니다.

## 트레이드오프/주의점

강한 hash parameter와 공격 저항성은 대체 관계가 아닙니다. parameter를 낮춰서 당장의 CPU 경보를 없애면 offline cracking 비용도 낮아집니다. 반대로 parameter를 높인 상태에서 global concurrency를 두지 않으면 공격자가 우리의 메모리를 잠글 수 있습니다. 따라서 우선순위는 **비밀번호를 평문 또는 빠른 hash로 두지 않기 → hash 자원 상한 설정 → 저비용 admission → 위험 기반 추가 인증 → parameter의 주기적 재측정**입니다.

또한 IP, ASN, 기기 정보는 보안 판단에 유용하지만 개인 데이터이기도 합니다. 필요한 신호만 짧게 보관하고, 국가·브라우저 같은 속성 하나로 자동 차단하지 마세요. 차단·보류·step-up의 근거와 만료 시간을 보안 담당자만 재검토할 수 있게 하며, 고객 지원이 계정 소유 확인 없이 limiter를 우회하는 예외 경로를 만들지 않도록 합니다.

마지막으로 MFA가 있다고 password defense를 느슨하게 해도 되지 않습니다. phishing-resistant MFA는 탈취 피해를 줄이지만, 로그인 endpoint의 자원 고갈과 계정 enumeration을 제거하지 않습니다. password, session, recovery, high-risk action을 각기 다른 위협 모델로 다루는 것이 안전합니다.

## 체크리스트 또는 연습

- [ ] 현재 hash algorithm·parameter·레코드 version과, 성공 로그인 시 재해시 경로를 문서화했다.
- [ ] production 유사 환경에서 hash verify p50/p95, 최대 동시 검증, memory/GC 여유를 측정했다.
- [ ] IP만이 아니라 account identifier, device/session, global executor에 각기 다른 제한을 뒀다.
- [ ] 외부 실패 응답은 account 존재 여부를 드러내지 않고, 내부에는 limiter·risk·정책 version 증거를 남긴다.
- [ ] 실패 5회 같은 단일 규칙으로 영구 잠금하지 않고 step-up·알림·복구 절차를 설계했다.
- [ ] 새 차단 rule은 observe-only와 5~10% canary를 거친 뒤 확대하며, 성공률 2%p 하락 같은 rollback 기준이 있다.
- [ ] password·token·원문 식별자와 과도한 fingerprint가 로그·metric·trace에 남지 않는지 점검했다.

연습으로 현재 로그인 시스템에 대해 “동시 hash 검증 40개가 꽉 찼을 때 무엇을 먼저 포기하고 무엇을 계속 보호할 것인가”를 적어 보세요. 정상 사용자의 기존 세션 유지, 비밀번호 변경의 안전한 재시도, 고위험 작업의 추가 인증은 보호하되, 새 세션 발급과 비용 큰 risk enrichment는 잠시 제한할 수 있습니다. 이 우선순위가 코드와 dashboard에 드러나면, 로그인 방어는 단순 실패 횟수 차단에서 서비스 생존성과 계정 보호를 함께 다루는 설계로 바뀝니다.

## 관련 글

- [비밀번호·자격증명 수명주기](/learning/deep-dive/deep-dive-password-credential-lifecycle-playbook/)
- [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)
- [고위험 작업 Step-up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/)
- [TLS Handshake와 전송 구간 보호](/learning/deep-dive/deep-dive-tls-handshake/)
- [API Key 수명주기·회전·폐기](/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/)
