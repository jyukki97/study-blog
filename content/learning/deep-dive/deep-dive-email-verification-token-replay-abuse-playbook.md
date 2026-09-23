---
title: "백엔드 커리큘럼 심화: 이메일 인증을 토큰 수명·재발송·재사용 공격까지 포함해 설계하는 법"
date: 2026-09-16
draft: false
topic: "Backend Security"
tags: ["Email Verification", "Token Security", "Account Enumeration", "Idempotency", "Abuse Prevention", "Spring Security"]
categories: ["Backend Deep Dive"]
description: "회원가입 이메일 인증을 단순 링크 발송이 아니라 상태 전이, 토큰 재사용 방지, 링크 스캐너, 계정 열거, 재발송 제한까지 포함한 운영 가능한 백엔드 계약으로 설계합니다."
module: "backend-security"
---

회원가입 뒤 인증 메일을 보내는 일은 겉보기보다 단순해 보인다. 토큰을 만들고 URL에 붙인 뒤, 사용자가 누르면 `verified=true`로 바꾸면 끝이라는 구현이다. 그러나 운영에서는 메일 보안 게이트웨이가 링크를 먼저 열고, 사용자는 재발송 버튼을 여러 번 누르며, 공격자는 존재하는 이메일을 찾으려 하고, 토큰은 proxy·분석 도구·서버 로그에 남을 수 있다. 이 상황에서 이메일 인증은 UI 기능이 아니라 **특정 시점에 그 이메일 수신함을 통제했다는 증거를 상태 전이로 바꾸는 보안 경로**다.

이 글은 [비밀번호·자격증명 수명주기](/learning/deep-dive/deep-dive-password-credential-lifecycle-playbook/), [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/), [점진적 마찰을 이용한 abuse 방지](/learning/deep-dive/deep-dive-abuse-prevention-progressive-friction-playbook/), [구조화 로그 설계](/learning/deep-dive/deep-dive-structured-logging/)를 연결한다. 이메일 인증을 비밀번호 재설정이나 로그인과 같은 등급의 증명으로 과대평가하지 않으면서도, 재시도와 공격을 견디는 검증 흐름을 만드는 것이 목표다.

참고 기준은 OWASP의 [Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)와 [Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)다. 비밀번호 재설정과 이메일 인증의 목적은 다르지만, 짧은 수명의 일회용 토큰, 균일한 응답, 재사용 방지, rate limit이라는 방어 원리는 같다.

## 이 글에서 얻는 것

- 이메일 인증이 증명하는 범위와, 인증 뒤에도 별도로 확인해야 하는 계정 보안 경계를 구분합니다.
- 토큰을 평문으로 저장하지 않고, 만료·소비·재발송을 하나의 상태 전이로 처리하는 방법을 익힙니다.
- 메일 링크 스캐너, 이중 클릭, 병렬 요청, 계정 열거를 정상적인 운영 조건으로 놓고 API를 설계합니다.
- 토큰 TTL, 재발송 간격, 실패율, abuse 알람을 숫자로 정해 출시와 롤백을 판단할 수 있습니다.

## 핵심 개념/이슈

### 1) 이메일 인증은 신원 확인이 아니라 수신함 통제 증명이다

인증 링크를 클릭했다는 사실은 해당 시점에 그 수신함으로 도착한 메일을 읽을 수 있었다는 증거다. 이것은 가입 오타를 줄이고, 비밀번호 재설정·알림·복구 채널을 열어 주며, 일부 저비용 abuse를 막는 데 유용하다. 하지만 사람의 실명, 조직 소속, 장기적인 계정 소유권을 증명하지는 않는다. 공유 메일함, 전달 규칙, 탈취된 수신함, 임시 메일 주소는 여전히 가능하다.

따라서 권한 모델에서 `email_verified`를 곧바로 고위험 작업의 승인 근거로 쓰면 안 된다. 결제수단 변경, 대량 발송, 관리자 권한, 민감 데이터 내보내기에는 최근 로그인, MFA, 재인증, 별도 승인처럼 더 강한 증거가 필요하다. 이메일 인증의 책임은 **연락 가능한 주소를 확보하고 그 주소로 가는 흐름을 신뢰 가능한 상태로 전환하는 것**까지다.

상태는 boolean 하나보다 목적과 시간을 드러내는 편이 좋다. 예를 들면 사용자에는 `PENDING_EMAIL_VERIFICATION`, `ACTIVE`, `SUSPENDED` 같은 계정 상태를 두고, 검증 시도는 별도 테이블에서 관리한다. 이 분리는 "계정이 아직 미인증인가"와 "어떤 토큰이 언제 발급돼 어떻게 끝났는가"를 다른 질문으로 다룬다.

```text
PENDING --(유효한 challenge 소비)--> ACTIVE
PENDING --(재발송)---------------> PENDING + 새 challenge
PENDING --(만료)-----------------> PENDING
ACTIVE  --(이메일 변경)----------> PENDING + 새 주소 challenge
```

이메일 변경은 특히 가입 인증과 다른 사건이다. 기존 주소와 새 주소 중 무엇을 어느 시점에 알릴지, 새 주소 인증 실패 시 기존 로그인 주소를 유지할지, 이미 로그인한 세션을 끊을지 같은 정책을 별도로 정해야 한다.

### 2) 토큰은 비밀번호처럼 저장하지 말고, 일회용 권한으로 다룬다

검증 URL의 토큰은 짧은 시간 동안 계정 상태를 바꿀 수 있는 bearer credential이다. 생성에는 예측 가능한 사용자 ID나 timestamp가 아니라 CSPRNG를 사용하고, 최소 128비트 이상, 실무에서는 256비트 난수를 base64url 또는 hex 형태로 인코딩하는 편이 안전하다. DB에는 원문 토큰을 넣지 말고 `SHA-256(token)` 또는 서버 비밀을 더한 HMAC 결과를 저장한다. DB 읽기 권한이 유출돼도 발급된 링크를 그대로 재사용할 수 없게 하기 위함이다.

다음처럼 challenge의 수명과 용도를 명시한다.

```sql
CREATE TABLE email_verification_challenges (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  token_hash CHAR(64) NOT NULL UNIQUE,
  purpose VARCHAR(32) NOT NULL, -- signup, change_email
  target_email_normalized TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  requested_ip_hash TEXT
);
```

핵심은 `SELECT`로 유효 여부를 확인한 뒤 나중에 업데이트하는 두 단계 구현을 피하는 것이다. 두 브라우저가 거의 동시에 링크를 열면 둘 다 유효하다고 읽을 수 있다. 아래처럼 **소비 조건을 포함한 단일 update**를 실행하고, 사용자 상태 변경과 같은 DB transaction에서 처리한다.

```sql
UPDATE email_verification_challenges
SET consumed_at = now()
WHERE token_hash = :token_hash
  AND purpose = 'signup'
  AND consumed_at IS NULL
  AND invalidated_at IS NULL
  AND expires_at > now()
RETURNING user_id;
```

한 행이 반환된 요청만 `users.email_verified_at`과 계정 상태를 갱신한다. 0행은 이미 소비됨, 만료, 재발송으로 무효화됨, 잘못된 토큰 중 하나다. 외부 응답은 이 사유를 지나치게 세분화하지 않고, 내부 감사 로그에서만 code를 분리한다. 이것이 [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/)의 "같은 효과는 한 번" 원칙을 인증 경로에 적용하는 방법이다.

### 3) GET 링크가 곧바로 소비되면 링크 스캐너가 사용자를 이긴다

기업용 메일 보안 제품, anti-phishing gateway, 미리보기 봇은 사용자보다 먼저 링크를 열 수 있다. 검증 URL의 `GET` 요청에서 곧바로 `consumed_at`을 기록하면, 사용자는 클릭하기도 전에 "이미 사용된 링크"를 보게 된다. 링크를 열었다는 사건과 사용자가 인증을 확정했다는 사건을 분리하는 이유다.

권장 흐름은 다음과 같다.

1. 메일의 `GET /verify-email#token=...`은 확인 화면을 표시한다. fragment는 서버 HTTP 요청과 일반 access log에 실리지 않는다.
2. 화면은 사용자가 누른 뒤 HTTPS `POST /api/email-verifications/confirm`으로 토큰을 전송한다.
3. 서버는 origin/CSRF 정책, token hash, 만료, 미소비 조건을 함께 검증한 뒤 한 번만 소비한다.
4. 완료 화면은 토큰을 URL·referer·analytics event에 다시 넣지 않고, 성공 자체만 표시한다.

fragment 방식은 서버 렌더링만 쓰는 서비스나 mail client 호환성 제약이 있을 수 있다. 그런 경우 path/query token을 쓰더라도 access log redaction, `Referrer-Policy: no-referrer`, 외부 asset을 불러오지 않는 확인 페이지, POST 후 즉시 URL 정리를 최소 기준으로 둔다. 보안 스캐너가 JavaScript와 POST까지 실행할 수 있는 환경이라면 최종 소비 전 사람의 명시적 확인이나 이미 로그인한 세션을 요구하는 방안도 검토한다. UX 한 번의 클릭보다 토큰이 자동 소비되지 않는 것이 우선인 경로가 있다.

### 4) 재발송은 새 토큰 생성이 아니라 abuse 제어 정책이다

"인증 메일 다시 보내기"는 장애 복구 기능이지만, 무제한 발송기·계정 열거기·메일 평판 하락 경로가 될 수도 있다. 재발송에서 답해야 할 질문은 세 가지다. 이전 링크를 계속 허용할지, 몇 번까지 보낼지, 요청자에게 계정 존재 여부를 얼마나 알려 줄지다.

가입 인증처럼 최신 주소와 하나의 활성 challenge만 의미가 있는 흐름에서는 새 challenge를 발급할 때 미소비 이전 challenge를 `invalidated_at`으로 닫는 **latest-only** 정책이 단순하다. 대신 사용자가 여러 메일을 받은 경우를 대비해 "가장 최근 메일만 유효"하다는 메시지를 분명히 보여야 한다. 반대로 메일 지연이 잦고 사용자가 여러 기기에서 가입을 마칠 수 있다면, 같은 목적·주소에 대해 짧게 겹치는 토큰을 허용할 수 있다. 이 경우에도 첫 성공이 모든 형제 challenge를 원자적으로 무효화해야 한다.

초기 운영값은 서비스 특성에 맞춰 조정하되, 아래처럼 보수적으로 시작할 수 있다.

| 항목 | 시작 기준 | 더 강하게 해야 하는 신호 |
| --- | --- | --- |
| 토큰 TTL | 15~30분 | 메일 도착 p95가 TTL의 절반을 넘으면 전달 경로부터 조사 |
| 재발송 cooldown | 동일 계정 60초 | 클릭 자동화·발송 실패 급증 시 5분 이상 단계적 증가 |
| 재발송 상한 | 계정당 1시간 5회, 하루 10회 | IP·ASN·device 단위 집중 요청 |
| 검증 실패 | 토큰별 5회 이하 | 유효하지 않은 토큰 탐색 비율 상승 |
| pending 정리 | 24~72시간 정책화 | 미인증 계정이 abuse/저장비를 유발 |

이 숫자는 제품의 법적 보관 정책이나 SMTP SLA를 대신하지 않는다. 중요한 것은 TTL보다 늦게 도착하는 비율, resend 뒤 성공하는 비율, 목적지 도메인별 bounce/deferral을 분리해 보는 것이다. 모든 실패에 CAPTCHA를 즉시 붙이기보다 [점진적 마찰을 이용한 abuse 방지](/learning/deep-dive/deep-dive-abuse-prevention-progressive-friction-playbook/)처럼 정상 사용자는 통과시키고 반복·고위험 요청에만 제한을 올리는 편이 낫다.

### 5) 계정 열거 방지는 응답 문구가 아니라 관측까지 포함한다

`POST /email-verifications/resend`가 "가입되지 않은 이메일입니다"와 "이미 인증됐습니다"를 구분하면 공격자는 주소 목록을 쉽게 정제할 수 있다. 외부 API는 가능한 한 같은 상태 코드, 비슷한 응답 시간, 같은 문구를 사용한다. 예를 들면 "해당 주소로 진행 가능한 인증 절차가 있으면 안내를 보냈습니다" 정도가 적합하다. 실제로 메일을 보냈는지, rate limit으로 막았는지, 이미 완료됐는지는 로그인된 사용자 화면이나 내부 로그에서만 정확히 보여 준다.

이때 균일 응답이 운영 진단을 지우면 안 된다. 이벤트에는 원문 이메일이나 토큰을 기록하지 않고, `challenge_requested`, `challenge_sent`, `challenge_delivered`, `challenge_confirmed`, `challenge_expired`, `challenge_rejected` 같은 결과와 hash된 사용자/요청 상관키를 남긴다. 최소 대시보드는 다음 지표를 갖춘다.

- 발급 대비 확인 성공률과 발급 후 확인까지의 p50/p95 시간
- 목적지 도메인별 defer/bounce 비율, provider webhook 지연
- `expired`, `already_consumed`, `invalidated`, `unknown_token` 비율
- 계정·IP·ASN별 resend, 실패, challenge 생성 rate
- 인증 성공 직후의 로그인 실패·비밀번호 재설정·이메일 변경 시도

`unknown_token`이 갑자기 늘면 무작위 추측뿐 아니라 오래된 앱 링크, URL 인코딩 버그, 로그/캐시 누출을 함께 점검해야 한다. 원문 토큰을 저장해 조사하려는 유혹은 피한다. [구조화 로그 설계](/learning/deep-dive/deep-dive-structured-logging/)의 원칙대로 충분한 상관관계는 남기되, bearer credential 자체는 telemetry에서 제거해야 한다.

## 실무 적용

### 1) 발급·전송·소비를 하나의 synchronous transaction으로 묶지 않는다

가입 API가 사용자 row를 저장한 뒤 SMTP를 직접 호출하면 메일 provider timeout이 가입 요청의 성공 여부를 애매하게 만든다. 반대로 메일 전송을 먼저 하고 DB 저장이 실패하면 존재하지 않는 계정으로 유효한 링크가 나갈 수 있다. 안전한 기본 구조는 사용자와 challenge를 DB transaction으로 기록하고, 전송할 내용을 outbox에 적재한 뒤 worker가 비동기로 provider에 보내는 방식이다.

이 패턴에서 outbox event에는 원문 토큰을 장기 보관하지 않는 것이 좋다. 암호화된 short-lived payload, provider template 변수 접근 권한, 재생성 가능한 안전한 delivery reference 중 하나를 선택하고 보존 기간을 제한한다. 발급 transaction의 commit 뒤에만 worker가 보낼 수 있어야 하며, worker 재시도는 같은 challenge에 대해 중복 메일을 만드는지, provider idempotency key를 지원하는지 확인한다. 전송 delivery가 늦어도 challenge의 TTL을 연장할지 여부는 자동으로 결정하지 말고, 사용자의 명시적인 재발송 요청과 audit trail을 남겨 결정한다.

### 2) 확인 API의 결과를 제품 상태와 분리해 모델링한다

확인 API가 `200`만 돌려주면 클라이언트와 지원팀이 상태를 해석하기 어렵다. 단, 공격자에게 토큰 상태를 상세히 알려 주지도 않아야 한다. 로그인된 사용자에게만 `VERIFIED`, `EXPIRED_REISSUE_AVAILABLE`, `ALREADY_VERIFIED`처럼 다음 행동이 분명한 결과를 주고, 비로그인 상태에서는 실패 이유를 포괄적인 "링크를 확인하거나 새 메일을 요청하세요"로 합치는 방식이 균형 잡힌다.

계정 상태 전이가 일어난 뒤에는 같은 이메일 인증 이벤트를 여러 번 발행하지 않도록 event idempotency도 필요하다. 마케팅 welcome mail, analytics, 권한 부여 같은 후속 처리는 `email_verified_at`이 새로 설정된 경우에만 발행하고, 이미 인증된 사용자가 링크를 다시 눌렀다고 같은 환영 쿠폰이나 감사 이벤트가 나가지 않게 한다. 인증 토큰의 단일 소비와 도메인 이벤트의 단일 처리 모두 확인해야 한다.

### 3) 2주 canary로 흐름 자체를 검증한다

첫 출시에서는 전체 가입 화면을 바꾸기보다 새 가입의 5~10%만 새 challenge 흐름으로 라우팅하고, 기존 방식과 비교한다. 48시간 안에 토큰 만료율이 기준선보다 2배가 되거나, 확인 성공률이 5%p 이상 떨어지거나, resend p95가 10분을 넘으면 확대를 멈춘다. 이 기준은 provider 장애, template 렌더링 오류, 모바일 deep link 문제를 조기에 분리하기 위한 것이다.

canary 동안 최소한 다음 시나리오를 실제로 실행한다.

1. 한 토큰을 두 브라우저에서 동시에 확정해 정확히 한 번만 상태가 바뀌는지 확인한다.
2. 이전 링크와 최신 링크를 각각 열어 latest-only 정책이 의도대로 보이는지 확인한다.
3. 메일 보안 스캐너와 유사한 `GET`만 발생시킨 뒤 계정이 활성화되지 않는지 확인한다.
4. resend cooldown·시간당 상한·IP 기반 제한이 정상 사용자의 복구를 막지 않는지 확인한다.
5. access log, APM, analytics, support bundle에서 원문 토큰이 검색되지 않는지 확인한다.

## 트레이드오프/주의점

- **짧은 TTL은 탈취 창을 줄이지만 메일 지연과 지원 문의를 늘린다.** TTL을 늘리기 전에 provider별 delivery p95와 사용자 재발송 행동을 확인한다.
- **latest-only는 공격 표면을 줄이지만 오래 도착한 메일을 무용하게 만든다.** 여러 토큰을 허용한다면 첫 성공에서 형제 토큰을 반드시 닫는다.
- **fragment 토큰은 서버 로그 노출을 낮추지만 JavaScript·클라이언트 호환성 의존성을 추가한다.** 서버 렌더링 앱이라면 query 사용 시 redaction과 referer 통제를 더 강하게 해야 한다.
- **균일한 외부 응답은 계정 열거를 어렵게 하지만 고객 지원에는 불편하다.** 정확한 상태는 인증된 세션과 내부 도구에서만 보이도록 경계를 나눈다.
- **이메일 인증 성공은 MFA 대체재가 아니다.** 계정 복구나 고위험 권한 변경에는 더 최근이고 더 강한 증거를 요구한다.

## 체크리스트 또는 연습

### 출시 체크리스트

- [ ] 토큰이 CSPRNG로 생성되고 DB·로그·analytics에 원문으로 남지 않는다.
- [ ] 소비 조건(`미소비`, `미만료`, `미무효화`)과 사용자 활성화가 하나의 transaction에 있다.
- [ ] GET 링크 조회만으로 계정 상태가 바뀌지 않으며, 링크 스캐너 fixture를 통과한다.
- [ ] resend의 cooldown·계정/IP 상한·단계적 friction이 설정돼 있다.
- [ ] 미인증·존재하지 않음·이미 인증됨을 외부 응답에서 구분하지 않는다.
- [ ] raw email·token 없이도 발급, delivery, 확인, 만료, abuse를 측정할 수 있다.
- [ ] 2회 동시 확인, 만료, 재발송, 이메일 변경, provider timeout의 회귀 테스트가 있다.

### 연습

현재 서비스의 가입 인증 흐름 하나를 골라 `발급`, `전송`, `열람`, `확정`, `재발송`, `만료`, `지원 복구`의 일곱 단계로 그려 보자. 각 단계마다 "토큰이 어디에 남는가", "같은 요청이 두 번 오면 무엇이 바뀌는가", "공격자에게 어떤 상태가 드러나는가"를 한 줄씩 적는다. 그 답이 없는 단계부터 상태 모델과 로그 정책을 보완하는 것이 링크 디자인을 먼저 바꾸는 것보다 효과적이다.
