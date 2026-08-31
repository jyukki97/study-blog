---
title: "백엔드 커리큘럼 심화: Abuse Prevention, 위험 점수와 점진적 마찰로 정상 사용자를 지키는 법"
date: 2026-08-30
draft: false
topic: "Security & Reliability"
tags: ["Abuse Prevention", "Risk Scoring", "Rate Limiting", "Account Security", "Fraud Prevention", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "로그인 대입, 가입 보너스 악용, 쿠폰 수집, 예약 선점 같은 어뷰징을 IP 차단 하나로 끝내지 않고, 행동 신호·위험 점수·점진적 마찰·재검증으로 운영하는 백엔드 설계 기준을 정리합니다."
module: "backend-security"
study_order: 1468
key_takeaways:
  - "어뷰징 방어의 목표는 모든 의심 요청을 차단하는 것이 아니라, 정상 사용자의 흐름을 지키면서 공격자의 작업 비용을 높이는 것이다."
  - "IP, 계정, 기기, 세션, 행동 속도, 대상 리소스를 함께 보되, 신호 수집 범위와 보존 기간을 최소화해야 한다."
  - "allow·slowdown·challenge·step-up·review·deny를 분리하면 단일 임계값 차단보다 false positive와 운영 부담을 줄일 수 있다."
  - "위험 규칙은 출시로 끝나지 않는다. 차단률, 정상 사용자 이탈, 우회 패턴, 재발률을 보며 shadow mode에서 먼저 보정해야 한다."
operator_checklist:
  - "가입, 로그인, 비밀번호 재설정, 쿠폰 발급, 예약, 결제 시도처럼 금전·권한·희소 자원이 걸린 상위 5개 action에 owner와 abuse 시나리오를 둔다."
  - "IP 단위 제한과 별도로 account·device/session·target resource 단위의 짧은 window 카운터를 기록하고, 원문 식별자는 가능한 한 hash 또는 토큰화한다."
  - "새 rule은 최소 7일 shadow mode에서 allow/deny 가정 결과와 정상 전환율을 비교한 뒤 enforce한다."
  - "challenge 또는 deny가 5분 동안 정상 기준선의 2배가 되면 rule version, 배포 변경, 외부 captcha·identity provider 장애를 함께 확인한다."
learning_refs:
  - title: "API 레이트 리밋과 백프레셔"
    href: "/learning/deep-dive/deep-dive-api-rate-limit-backpressure/"
    description: "요청량을 제한하고 429·retry를 제품 계약으로 만드는 기본기를 다룹니다."
  - title: "Device Session Registry와 강제 로그아웃"
    href: "/learning/deep-dive/deep-dive-device-session-registry-revocation-playbook/"
    description: "세션 단위 위험 신호와 revoke 경로를 설계할 때 연결됩니다."
  - title: "고위험 액션 Step-up Authorization"
    href: "/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/"
    description: "위험이 높을 때 무조건 차단 대신 추가 인증을 요구하는 기준입니다."
  - title: "구조화 로그 설계"
    href: "/learning/deep-dive/deep-dive-structured-logging/"
    description: "판단 결과와 운영 증거를 개인정보 과수집 없이 남기는 방법입니다."
decision_guide:
  title: "어뷰징 방어 강도를 고르는 기준"
  intro: "판단 순서는 공격자 탐지 정확도보다 먼저 자산의 손실 규모, 정상 사용자 중단 비용, 복구 가능성을 보는 것입니다."
  cases:
    - badge: "즉시 차단"
      title: "탈취 의심 세션의 출금·권한 변경·대량 데이터 내보내기"
      fit: "성공 한 번의 피해가 크고 서버 측 검증으로 금지 상태를 확정할 수 있는 action"
      watchouts: "차단 근거와 재인증·support 복구 경로가 없으면 정상 사용자도 계정을 되찾기 어렵다."
      next_step: "세션 revoke, step-up 인증, 감사 이벤트, 사람 검토를 한 트랜잭션 흐름으로 둔다."
    - badge: "점진적 마찰"
      title: "가입·로그인·쿠폰·예약처럼 자동화가 쉽고 정상 트래픽도 많은 action"
      fit: "한 신호만으로 악의를 확정하기 어렵지만 반복 비용을 높일 수 있는 흐름"
      watchouts: "모든 사용자에게 CAPTCHA를 보이면 전환율 저하와 접근성 문제가 먼저 생긴다."
      next_step: "짧은 cooldown, proof/challenge, email·passkey 재확인, 낮은 우선순위 queue를 순서대로 적용한다."
    - badge: "관찰 우선"
      title: "새 기능·새 국가·새 캠페인처럼 정상 분포가 아직 없는 경로"
      fit: "임계값의 근거가 없고 오탐 비용이 높은 초기 출시 구간"
      watchouts: "관찰만 계속하면 실제 손실을 키울 수 있으므로 금전 한도와 emergency kill switch는 먼저 둬야 한다."
      next_step: "shadow score, 수동 표본 검토, 일별 false-positive 추정을 7일 이상 수집한다."
---

가입 보너스를 여러 번 받는 계정, 비밀번호를 수천 번 대입하는 봇, 인기 좌석을 잡아두고 되파는 자동화, 쿠폰을 대량 발급하는 스크립트는 겉으로 보면 모두 "요청이 너무 많다"는 문제처럼 보입니다. 그래서 처음에는 IP rate limit 하나를 두기 쉽습니다. 그러나 회사·학교·이동통신망처럼 여러 정상 사용자가 IP를 공유하는 환경에서는 이 방식이 곧 정상 사용자를 막습니다. 반대로 프록시와 계정 풀을 쓰는 공격자는 IP만 바꿔 제한을 비켜 갑니다.

어뷰징 방어는 차단 기능 하나가 아니라 **제한된 신호로 위험을 추정하고, 피해가 큰 행동에만 마찰을 늘리는 의사결정 시스템**입니다. 좋은 시스템은 공격자를 완벽하게 식별한다고 약속하지 않습니다. 대신 공격이 성공하기까지 필요한 계정·시간·인증·자금을 늘리고, 정상 사용자가 멈췄을 때 되돌릴 경로를 남깁니다. 이 글은 [API 레이트 리밋과 백프레셔](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/), [Device Session Registry와 강제 로그아웃](/learning/deep-dive/deep-dive-device-session-registry-revocation-playbook/), [고위험 액션 Step-up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/), [구조화 로그 설계](/learning/deep-dive/deep-dive-structured-logging/)와 이어집니다.

## 이 글에서 얻는 것

- IP 하나가 아니라 account, session, device, 행동 속도, 대상 리소스를 조합해 보는 이유를 이해합니다.
- `allow → slowdown → challenge → step-up → review → deny`를 action 위험도에 따라 선택할 수 있습니다.
- 위험 점수의 임계값, shadow mode, false positive, fallback을 숫자와 운영 조건으로 설계합니다.
- 개인정보를 과하게 모으지 않으면서도 대응·재현·이의제기에 필요한 증거를 남기는 방법을 얻습니다.

## 핵심 개념/이슈

### 1) 방어 대상은 요청이 아니라 "비정상적으로 싼 성공"이다

동일한 초당 20건이라도 의미가 다릅니다. 검색 자동완성 20건은 사용자 타이핑일 수 있지만, 신규 계정 20개 생성이나 같은 쿠폰의 20회 발급은 경제적 손실을 만들 수 있습니다. 따라서 rate limit의 키를 endpoint와 IP로만 고정하지 말고, **공격자가 얻는 가치와 성공 단위**를 먼저 정의해야 합니다.

| action | 공격자의 이득 | 먼저 볼 키 | 기본 안전장치 |
| --- | --- | --- | --- |
| 로그인 | 계정 탈취 | account + IP prefix + session | 실패 횟수 cooldown, credential stuffing 탐지 |
| 가입·추천 | 보너스·가짜 사용자 | device/session + payment/phone 검증 상태 | 발급 지연, 보상 보류 |
| 쿠폰 발급 | 할인 비용 | account + campaign + device | 1인/1자격 제한, 발급 ledger |
| 예약·재고 선점 | 희소 자원 독점 | account + target resource + 시간창 | 짧은 hold, 결제 전 만료 |
| 비밀번호 재설정 | takeover 준비 | account + channel + recent session | 메일 확인, 최근 위험 신호와 결합 |

여기서 "기기"는 광고 식별자처럼 장기 추적을 위한 값일 필요가 없습니다. 로그인 cookie, 앱 설치 ID, 세션에서 파생한 회전 가능한 pseudonymous key처럼 서비스 목적에 필요한 최소 식별자로 시작하세요. 원문 IP·전화번호·user agent 전체를 무기한 로그에 보관하면 방어 데이터가 또 다른 민감 자산이 됩니다. 원문 접근은 짧게 제한하고, 집계 판단에는 hash, prefix, bucket을 우선 사용합니다.

### 2) 위험 점수는 블랙박스보다 판정 가능한 규칙 묶음으로 시작한다

처음부터 복잡한 ML 모델을 만들 필요는 없습니다. 운영자가 "왜 이 사용자가 challenge를 받았는가"를 설명할 수 있는 규칙 합산이 더 낫습니다. 예를 들어 신규 세션에서 실패한 로그인 8회, 이전에 보지 못한 국가, 30초 안에 서로 다른 5개 계정 시도가 동시에 관측되면 각각의 점수를 더합니다. 단, IP가 새롭다는 이유 하나만으로 금전 action을 거부하는 식의 규칙은 오탐이 큽니다.

```text
risk = velocity(0..30)
     + account_history(0..25)
     + session_integrity(0..20)
     + target_value(0..15)
     + network_anomaly(0..10)
```

점수 항목은 공격을 "증명"하지 않고 행동의 위험을 우선순위화합니다. 특히 `target_value`를 넣어야 합니다. 같은 로그인 이상이라도 프로필 조회와 출금 계좌 변경은 피해가 다르므로, 사용자 전역 점수 하나로 모든 action을 판단하면 안 됩니다. 평가 결과에는 rule version과 개별 항목의 범주만 남기고, 사람이 다시 볼 수 있는 reason code를 만드세요. 예: `LOGIN_VELOCITY_HIGH`, `NEW_SESSION_HIGH_VALUE_ACTION`.

### 3) 단일 차단선 대신 점진적 마찰을 둔다

위험을 0 또는 100으로 단정하면 방어는 단순하지만 제품은 거칠어집니다. 출발점으로는 아래 같은 계단이 실용적입니다. 수치는 서비스의 정상 분포를 본 뒤 바꿔야 하며, 그대로 복사할 정답은 아닙니다.

| 위험 점수 | 기본 반응 | 적용 조건 | 성공 후 처리 |
| ---: | --- | --- | --- |
| 0~29 | allow | 정상 속도·기존 신뢰 세션 | 평상시 audit event |
| 30~49 | slowdown | 짧은 시간창의 반복·새 세션 | 5~30초 delay, 낮은 우선순위 |
| 50~69 | challenge | 자동화 가능성은 높지만 피해 확정 전 | bot challenge 또는 추가 확인 |
| 70~84 | step-up/review | 고가 쿠폰·권한 변경·새 기기 | passkey·메일 재확인, 보상 보류 |
| 85 이상 | deny + investigate | 금지 계정, 토큰 재사용, 확정된 공격 패턴 | 세션 revoke, support·security queue |

`challenge`는 CAPTCHA 하나를 뜻하지 않습니다. 사람이 풀기 어려운 puzzle만 반복하면 접근성, 저사양 기기, 지역 네트워크에서 정상 사용자도 손해를 봅니다. 이미 검증된 email을 재확인하거나, passkey를 요구하거나, 지급을 24시간 보류하거나, 제한된 manual review queue로 보내는 것도 마찰입니다. 피해와 되돌리기 비용이 낮은 구간에서는 요청을 조금 늦추는 것이 차단보다 나을 수 있습니다.

### 4) 수량 제한과 정합성 제한은 다른 문제다

어뷰징 방어를 rate limit에만 맡기면 경합 조건을 놓칩니다. "쿠폰은 계정당 한 번"이라는 규칙은 요청 10개 중 9개를 429로 만드는 것만으로 보장되지 않습니다. 서로 다른 서버가 거의 동시에 허용 결정을 내릴 수 있기 때문입니다. 한 번만 지급되어야 하는 금전·재고·보상은 DB unique constraint, 원자적 update, idempotency key, 발급 ledger처럼 **정합성 경계**에서 다시 막아야 합니다.

예를 들어 보상 지급은 `(account_id, campaign_id)` unique key를 갖는 ledger insert로 시작할 수 있습니다. risk score가 낮아도 insert가 충돌하면 이미 지급 또는 진행 중으로 처리합니다. risk score는 "누구에게 더 많은 검증을 요구할지"를 고르고, 데이터 제약은 "한 번만 일어나야 하는 상태 변경"을 보장합니다. 이 둘을 섞으면 장애 때 정확히 무엇이 실패했는지 알기 어렵습니다.

## 실무 적용

### 1) action별 위험 계약부터 작성한다

새 방어 rule을 늘리기 전에 아래와 같은 action contract를 상위 5개 위험 경로에 만드세요. 문서는 한 페이지여도 충분하지만 owner와 복구 경로가 빠지면 실제 incident에서 쓸 수 없습니다.

```yaml
action: issue_promotion_coupon
asset: "campaign budget and fairness"
normal_volume: "account당 1일 1회"
signal_windows:
  account: "10분 3회"
  session: "1분 5회"
  campaign: "1분 신규 계정 발급률"
responses:
  moderate: "10초 cooldown + challenge"
  high: "issuance hold 24h + review"
  confirmed: "deny + session revoke"
integrity_guard: "unique(account_id, campaign_id)"
owner: "growth-platform"
appeal_path: "support ticket + reason code"
```

우선순위는 **불가역적인 금전·권한 손실 방지 → 정상 사용자의 계정 접근 보호 → 캠페인 공정성 → 운영 편의**입니다. 이 순서가 없으면 쿠폰 중복보다 로그인 false positive를 더 심각하게 다루어야 하는 상황을 놓치기 쉽습니다.

### 2) shadow mode와 rollout gate를 분리한다

새 rule을 바로 deny로 켜지 마세요. 최소 7일 동안 실제로는 허용하되, "이 rule이 있었다면 어떤 반응을 했을지"를 기록합니다. 이 기간에는 challenge 가정 비율, 해당 cohort의 가입·구매 전환율, support contact rate, 확정 abuse 재발률을 함께 봅니다.

초기 rollout의 예시는 다음과 같습니다.

1. **Shadow 7일**: 정상 cohort와 의심 cohort의 분포·reason code를 확인합니다.
2. **5% canary 24시간**: 피해가 낮은 action에서 slowdown만 적용합니다.
3. **25% 확대**: false positive가 기존 대비 +0.2%p 미만이고 support 문의가 기준선 안일 때 challenge를 추가합니다.
4. **100% enforce**: 우회율, conversion, incident volume을 1주 더 보고 85점 이상 deny만 별도 review 합니다.

공격이 진행 중이면 이 순서를 생략할 수 있습니다. 대신 emergency rule에는 만료 시각을 두고, 24시간 안에 owner review를 강제하세요. incident 때 만든 광범위 IP 차단이 영구 정책으로 남는 일이 가장 흔한 운영 부채입니다.

### 3) 관측성은 "몇 건 막았나"보다 오판과 우회를 보여야 한다

차단 수가 늘었다고 방어가 좋아졌다고 말할 수는 없습니다. 임계값을 낮추면 차단 수는 항상 늘기 때문입니다. 아래 지표를 action·rule version·신뢰 cohort별로 나누면 판단이 쉬워집니다.

| 지표 | 질문 | 위험 신호 |
| --- | --- | --- |
| challenge rate | 얼마나 자주 마찰을 주는가 | 정상 기존 사용자에서 급증 |
| challenge pass rate | 사람에게 너무 어려운가 | 정상 cohort에서 급락 |
| false-positive appeal rate | 잘못 막았는가 | 7일 이동 평균의 2배 |
| post-challenge abuse rate | 마찰 뒤에도 성공하는가 | 일정 수준 이상 유지 |
| time-to-containment | 탐지부터 피해 제한까지 걸린 시간 | runbook·owner 부재로 지연 |
| reason-code coverage | 판단을 설명할 수 있는가 | `unknown` 비율 증가 |

구조화 event에는 raw password, 전체 cookie, 민감 challenge 답을 넣지 않습니다. `action`, `outcome`, `risk_bucket`, `reason_codes`, `rule_version`, `privacy_safe_subject_key`, `trace_id` 정도로 시작해도 incident 분석에 충분합니다. 조사 권한이 있는 별도 보안 저장소와 애플리케이션 운영 로그의 보존 기간도 분리하세요.

## 트레이드오프/주의점

어뷰징 방어는 필연적으로 공정성과 마찰 사이의 선택입니다. 새 기기, 해외 출장, 학교·회사 NAT, 보조기기 사용은 모두 공격 신호처럼 보일 수 있습니다. 그래서 신호가 많을수록 더 안전하다고 생각하면 위험합니다. 신호의 품질, 동의·고지, 보존 기간, 이의제기 가능성이 함께 있어야 합니다. 국가·통신사·브라우저 특성을 점수에 넣는다면 특정 집단의 실패율이 높아지지 않는지 cohort별로 검토해야 합니다.

외부 CAPTCHA나 device intelligence 서비스도 의존성입니다. provider timeout을 login 전체 timeout까지 기다리거나, 응답이 없을 때 모든 사용자를 deny하면 방어 서비스 장애가 곧 제품 장애가 됩니다. high-risk action에는 fail-closed가 맞을 수 있지만, 일반 로그인·가입에서는 짧은 timeout 뒤 local cooldown 또는 email verification으로 degraded path를 준비하세요. [외부 API 의존성 격리](/learning/deep-dive/deep-dive-outbound-api-adapter-dependency-isolation-playbook/)처럼 provider 실패의 사용자 영향을 따로 설계하는 이유입니다.

마지막으로 공격자는 규칙에 반응합니다. 성공률이 낮아지면 계정 수를 늘리거나, 더 느리게 요청하거나, 사람이 개입한 트래픽을 섞습니다. 따라서 비밀 rule만 늘리기보다, 희소 자원은 서버 정합성으로 잠그고, 사용자에게는 복구 가능한 마찰을 주고, 운영자에게는 짧은 피드백 루프를 주는 구조가 오래 갑니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 금전·권한·희소 자원이 걸린 상위 5개 action에 abuse contract와 owner가 있다.
- [ ] IP 제한 외에 account, session/device, target resource, 시간창 중 필요한 키를 조합한다.
- [ ] risk score와 DB unique constraint·idempotency·ledger의 역할을 분리했다.
- [ ] `allow`, `slowdown`, `challenge`, `step-up`, `review`, `deny`의 복구 경로가 각각 있다.
- [ ] 새 rule을 shadow mode에서 7일 이상 비교하고 false positive 기준을 확인했다.
- [ ] external challenge provider timeout과 degraded path가 제품 SLO 안에 있다.
- [ ] reason code, rule version, trace ID는 남기되 raw 식별자와 민감 답변은 최소화했다.
- [ ] emergency rule에 만료일과 24시간 이내 review owner를 두었다.

### 연습: 신규 계정 쿠폰 발급 방어 설계하기

신규 가입자에게 1만 원 쿠폰을 주는데, 같은 사람이 계정을 반복 생성해 사용하는 상황을 가정해 봅시다. 먼저 한 IP당 N회 같은 단일 제한을 쓰지 말고 account, 가입 후 경과 시간, session/device의 최근 발급 수, 같은 캠페인의 지급 ledger를 분리해 적습니다. 다음으로 30~49점에는 발급을 10분 지연하고, 50~69점에는 email 재확인 후 지급, 70점 이상에는 24시간 hold와 review로 가는 표를 만드세요. 마지막으로 `(account_id, campaign_id)` unique key로 중복 지급을 막고, shadow 7일 동안 정상 신규 가입자의 쿠폰 수령률이 기준선에서 얼마나 변하는지 측정합니다. 이 세 가지가 분리되어 있어야 방어 rule을 조정해도 보상 정합성이 무너지지 않습니다.

## 관련 글

- [API 레이트 리밋과 백프레셔](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)
- [Device Session Registry와 강제 로그아웃](/learning/deep-dive/deep-dive-device-session-registry-revocation-playbook/)
- [고위험 액션 Step-up Authorization](/learning/deep-dive/deep-dive-step-up-authorization-high-risk-actions-playbook/)
- [구조화 로그 설계](/learning/deep-dive/deep-dive-structured-logging/)
