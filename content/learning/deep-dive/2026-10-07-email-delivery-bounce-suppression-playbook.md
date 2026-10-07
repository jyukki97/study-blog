---
title: "백엔드 커리큘럼 심화: 이메일 전달 상태·Bounce·Suppression List, ‘발송 성공’을 신뢰하지 않는 운영 설계"
date: 2026-10-07T10:06:00+09:00
lastmod: 2026-10-07T10:06:00+09:00
draft: false
topic: "Backend Integration"
tags: ["Email Delivery", "Bounce", "Suppression List", "Transactional Email", "Webhook", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "이메일 API의 202 응답과 실제 수신을 구분하고, bounce·complaint·unsubscribe를 상태 전이와 suppression 정책으로 다루는 실무 운영 기준을 정리합니다."
module: "integration-reliability"
study_order: 1258
keywords: ["email delivery lifecycle", "bounce handling", "suppression list", "transactional email", "email webhook"]
---

회원가입 인증, 영수증, 비밀번호 재설정, 장애 알림은 모두 이메일을 사용합니다. 많은 서비스가 provider API에서 `202 Accepted`를 받으면 발송이 끝났다고 처리하지만, 그 시점은 provider가 요청을 **받았다는 뜻**에 가깝습니다. 수신 mailbox까지 도달했는지, 주소가 존재하는지, 사용자가 수신 거부했는지, 같은 알림을 여러 번 보냈는지는 뒤에야 알 수 있습니다.

이 글은 [알림 선호도와 Delivery Pipeline](/learning/deep-dive/deep-dive-notification-preference-delivery-pipeline-playbook/), [Inbound Webhook Receiver](/learning/deep-dive/deep-dive-inbound-webhook-receiver-playbook/), [Webhook Delivery Reliability](/learning/deep-dive/deep-dive-webhook-delivery-reliability-playbook/), [이메일 인증 토큰의 Replay 방지](/learning/deep-dive/deep-dive-email-verification-token-replay-abuse-playbook/)를 연결해, 이메일을 `send()` 호출이 아니라 **의도 생성, provider 인수, 전달 관측, 수신 거부 억제**의 lifecycle로 운영하는 방법을 정리합니다.

## 이 글에서 얻는 것

- API 수락, provider 인수, delivery, bounce, complaint를 서로 다른 상태로 다루는 기준을 배웁니다.
- 마케팅 수신 거부와 보안·계약상 필수 안내를 섞지 않는 recipient 정책을 만듭니다.
- provider webhook의 중복·지연·순서 뒤바뀜에도 알림 상태가 잘못 덮이지 않게 합니다.
- bounce율, 재시도, suppression 보존 기간을 숫자와 위험도로 결정하는 출발점을 얻습니다.

## 핵심 개념/이슈

### 1) “보냈다”는 단일 상태가 아니다

이메일은 여러 시스템을 통과합니다. 애플리케이션이 요청을 만들고, provider가 queue에 넣고, 수신 도메인이 수락하거나 거절하고, 일부는 spam 분류나 수신자 행동으로 이어집니다. 따라서 `sent_at` 하나로 성공을 기록하면 원인을 잃습니다.

| 상태 | 의미 | 다음 행동 |
| --- | --- | --- |
| `QUEUED` | 업무 이벤트를 받아 발송 의도를 저장했다 | worker가 provider 요청 수행 |
| `ACCEPTED` | provider가 message ID와 함께 인수했다 | delivery event 대기 |
| `DELIVERED` | 수신 MTA가 수락했다 | business success로 과장하지 않음 |
| `DEFERRED` | 일시적 거절 또는 provider 재시도 중이다 | 제한된 retry budget 적용 |
| `BOUNCED` | 영구 수신 실패가 확인됐다 | 주소 또는 목적별 suppression 검토 |
| `COMPLAINED` | spam 신고 등 고위험 신호가 왔다 | 즉시 해당 목적의 발송 중지 |
| `SUPPRESSED` | 정책상 더 이상 보내면 안 된다 | 재시도하지 않고 근거를 노출 |

`DELIVERED`도 사용자가 읽었거나 행동했다는 증거가 아닙니다. open tracking은 privacy 설정·이미지 차단·메일 클라이언트의 prefetch에 영향을 받습니다. 제품의 확정 행동은 링크 클릭이나 서비스 내 완료 이벤트로 따로 측정해야 합니다.

### 2) 수신자 동의와 메시지 목적을 먼저 분리한다

수신 거부를 무시할 수 있는 transactional 메일이 있다는 해석은 위험합니다. 비밀번호 재설정, 보안 경고, 법적 고지처럼 서비스 제공에 필요한 메시지와, 추천·캠페인·재방문 유도는 다른 목적입니다. `email` 필드 하나에 `unsubscribed=true`만 두면 이 차이를 표현할 수 없습니다.

```text
recipient_consent
  recipient_id, purpose, channel, status, source, changed_at

email_suppression
  normalized_email, purpose_scope, reason, provider, expires_at, evidence_ref
```

목적은 최소 `security`, `account`, `transactional`, `marketing`처럼 분리합니다. `marketing` 수신 거부는 즉시 존중하고, complaint는 보수적으로 같은 주소의 marketing을 전부 억제합니다. 반면 security 알림을 계속 보내야 하는 상황이라도 영구 bounce 주소에 무한 재시도하면 평판을 해칩니다. 사용자는 product 화면이나 다른 검증 채널에서 주소를 수정할 수 있어야 합니다.

### 3) provider webhook은 현재 상태를 덮는 명령이 아니다

`delivered`, `bounced`, `deferred` 이벤트는 중복되고 늦게 오며 순서가 바뀔 수 있습니다. 그래서 webhook 도착 순서로 `status`를 덮어쓰면 과거의 `delivered`가 나중의 hard bounce를 지워 버릴 수 있습니다. [Inbound Webhook Receiver](/learning/deep-dive/deep-dive-inbound-webhook-receiver-playbook/)와 같이 provider event ID, provider message ID, payload hash, occurred_at을 inbox에 먼저 보존하고, 상태 전이는 규칙으로 결정합니다.

예를 들어 hard bounce와 complaint는 `DELIVERED`보다 우선하는 terminal risk event입니다. 반면 temporary defer는 provider가 나중에 성공시킬 수 있으므로 최대 재시도 시간 안에서는 terminal로 닫지 않습니다. webhook 원문에 본문·수신자 개인정보가 들어갈 수 있으므로, 운영 로그에는 event type·provider message ID·reason category만 남기고 원문은 제한된 접근 경로에 짧게 보관합니다.

## 실무 적용

### 1) 발송 요청은 outbox에서 만들고 하나의 논리적 알림에 멱등 키를 둔다

주문 완료 트랜잭션 안에서 provider API를 직접 호출하면 DB commit 실패와 이메일 전송이 어긋납니다. 업무 이벤트와 `email_intent`를 같은 DB 트랜잭션으로 저장하고, worker가 outbox를 읽어 provider로 보냅니다. 한 주문에 영수증을 하나만 보내야 한다면 멱등 키는 `receipt:{order_id}:v1`처럼 업무 의미를 가져야 합니다. HTTP request ID만으로는 재처리와 수동 재발송을 구분하기 어렵습니다.

```sql
CREATE TABLE email_delivery (
  delivery_id UUID PRIMARY KEY,
  idempotency_key VARCHAR(180) NOT NULL UNIQUE,
  recipient_hash CHAR(64) NOT NULL,
  purpose VARCHAR(30) NOT NULL,
  template_version VARCHAR(50) NOT NULL,
  provider_message_id VARCHAR(180),
  status VARCHAR(20) NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  terminal_reason VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

worker는 실제 provider call 직전에 consent와 suppression을 다시 읽습니다. 큐에 넣은 뒤 사용자가 수신 거부할 수 있기 때문입니다. suppression이면 provider 호출 없이 `SUPPRESSED`로 닫고, 사용자가 왜 받지 못했는지 지원팀이 확인할 수 있도록 목적·이유·시각을 남깁니다.

### 2) retry는 transient failure에만, 시간 예산 안에서 한다

재시도는 신뢰성을 높이지만 영구 오류를 반복하면 IP/domain 평판과 비용을 함께 해칩니다. 초기 기준으로는 connect timeout, 429, 5xx, 일시적 mailbox defer만 재시도 대상으로 두고, 지수 backoff와 jitter를 적용합니다. 예를 들어 1분·5분·30분·2시간처럼 **최대 4회, 총 6시간**을 기본 budget으로 시작할 수 있습니다. password reset처럼 유효기간이 15분인 메시지는 6시간 재시도가 무의미하므로, token 만료보다 짧은 budget을 써야 합니다.

hard bounce, 잘못된 수신자 형식, consent 없음, template validation 실패는 재시도하지 않습니다. provider가 “accepted”를 반환했는데 응답 timeout이 난 경우는 애매합니다. 새 요청을 바로 보내지 말고 idempotency key로 provider 조회가 가능한지 확인하거나, 같은 key를 지원하는 provider API를 사용해야 중복 전송을 줄일 수 있습니다.

### 3) 평판 지표와 사용자 영향 지표를 같이 본다

지표는 provider의 전송량이 아니라 수신자와 도메인이 받는 영향을 보여야 합니다.

| 지표 | 시작 경보 기준 | 조치 |
| --- | --- | --- |
| hard bounce rate | 1% 초과 또는 평소의 2배 | list source·주소 검증·suppression 적용 확인 |
| complaint rate | 0.1% 초과 | 해당 campaign 즉시 중단, 동의 근거 재검토 |
| deferred age p95 | 30분 초과 | provider status·rate limit·domain별 queue 확인 |
| duplicate logical notification | 0건 목표 | idempotency key·timeout recovery 조사 |
| suppression bypass | 0건 목표 | 즉시 send path 차단 및 감사 |

수치는 발송 목적과 도메인에 따라 달라집니다. 중요한 것은 기준선을 정하고 신규 template, recipient import, provider 변경을 canary로 비교하는 일입니다. 큰 campaign는 전체 list에 보내기 전 내부 seed mailbox와 1~5% 표본에서 bounce·unsubscribe·rendering을 확인하세요.

### 4) sender identity와 본문 보안도 전달 계약에 넣는다

SPF, DKIM, DMARC 정렬은 deliverability와 phishing 방어의 기본 경계입니다. 그러나 DNS 레코드를 설정했다고 자동으로 안전해지지는 않습니다. From domain, return-path, provider sending domain, link tracking domain의 owner와 변경 절차를 inventory로 관리하고, DMARC 보고의 급격한 failure를 관측해야 합니다.

이메일 본문에는 access token, 전체 주민번호, 장기 signed URL을 넣지 않습니다. 링크는 단일 사용 또는 짧은 TTL의 server-side token으로 만들고, 비밀번호 재설정처럼 높은 위험의 link는 [토큰 replay 방지](/learning/deep-dive/deep-dive-email-verification-token-replay-abuse-playbook/) 규칙을 적용합니다. 템플릿 preview나 webhook log가 새로운 개인정보 export 경로가 되지 않도록 recipient와 본문을 기본 마스킹하는 것도 필요합니다.

## 트레이드오프/주의점

suppression을 너무 넓게 적용하면 중요한 보안 안내까지 못 보낼 수 있고, 너무 좁게 적용하면 marketing 수신 거부가 새 template에서 우회됩니다. 주소만 기준으로 할지, `purpose`까지 분리할지, complaint는 얼마나 강하게 적용할지를 product·legal·support와 함께 결정해야 합니다. 특히 여러 브랜드와 지역 서비스를 같은 provider 계정에서 쓰면 suppression scope가 예상보다 넓어질 수 있습니다.

delivery event를 신뢰한다고 해서 application 상태를 자동 확정해서도 안 됩니다. 영수증 전달은 확인할 수 있어도, 이메일로 보낸 계약 동의가 법적 동의 완료라는 뜻은 아닙니다. business state는 사용자의 명시 행동이나 별도 서명 증거를 기준으로 전이해야 합니다.

## 체크리스트 또는 연습

- [ ] `QUEUED`, `ACCEPTED`, `DELIVERED`, `DEFERRED`, `BOUNCED`, `COMPLAINED`, `SUPPRESSED`의 의미가 분리돼 있다.
- [ ] 하나의 논리적 알림에 업무 의미가 있는 idempotency key가 있다.
- [ ] 수신 동의와 suppression은 목적별로 조회되며, worker가 send 직전에 재검증한다.
- [ ] webhook event ID와 occurred_at을 보존하고, 이벤트 도착 순서로 현재 상태를 덮어쓰지 않는다.
- [ ] retry 대상·횟수·총 시간 예산이 메시지 유효기간과 맞는다.
- [ ] bounce, complaint, deferred age, duplicate, suppression bypass의 기준선과 경보가 있다.
- [ ] sender domain DNS·템플릿·tracking link의 변경 owner와 rollback이 정해져 있다.

연습으로 최근 이메일 template 하나를 골라 “발송 API가 성공한 뒤” 생길 수 있는 경우를 적어 보세요. provider timeout, hard bounce, complaint, 중복 callback, 사용자의 수신 거부를 각각 넣고, 어떤 상태·재시도·suppression·사용자 안내가 나와야 하는지 표로 완성합니다. 표의 어느 칸에서도 단순한 `sent=true`로 설명이 끝난다면 그 경로는 운영 증거가 부족합니다.

## 관련 글

- [알림 선호도와 Delivery Pipeline](/learning/deep-dive/deep-dive-notification-preference-delivery-pipeline-playbook/)
- [Inbound Webhook Receiver](/learning/deep-dive/deep-dive-inbound-webhook-receiver-playbook/)
- [Webhook Delivery Reliability](/learning/deep-dive/deep-dive-webhook-delivery-reliability-playbook/)
- [이메일 인증 토큰의 Replay 방지](/learning/deep-dive/deep-dive-email-verification-token-replay-abuse-playbook/)
