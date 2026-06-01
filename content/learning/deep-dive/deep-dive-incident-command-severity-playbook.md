---
title: "백엔드 커리큘럼 심화: 인시던트 커맨드와 Severity 운영 플레이북"
date: 2026-05-24
draft: false
topic: "Incident Management"
tags: ["Incident Response", "Severity", "On-call", "Runbook", "SLO", "Observability"]
categories: ["Backend Deep Dive"]
description: "장애 대응을 개인 역량에 맡기지 않고 Severity, Incident Commander, 커뮤니케이션, 완화 우선순위, 사후 회고로 운영하는 기준을 정리합니다."
module: "ops-observability"
study_order: 1241
keywords: ["incident command", "severity", "인시던트 커맨더", "장애 대응", "온콜", "SLO"]
key_takeaways:
  - "인시던트 초반 목표는 완벽한 원인 규명이 아니라 사용자 피해 축소와 비가역 손상 차단이다."
  - "Severity는 감정이나 직급이 아니라 사용자 영향, 데이터 위험, 복구 시간, error budget burn으로 조정한다."
  - "Incident Commander는 직접 모든 로그를 보는 사람이 아니라 역할, 우선순위, 다음 업데이트 시각을 고정하는 사람이다."
operator_checklist:
  - "SEV 선언 시 Impact, Started, IC, Tech Lead, Next update, Current plan을 한 메시지에 적는다."
  - "15분마다 사용자 영향 수치, 진행 액션, Severity 변경 여부, 다음 목표, 외부 공유 필요성을 확인한다."
  - "종료 전 SLI 정상화, backlog/DLQ, 데이터 중복/손상, 임시 완화 owner와 만료 시각을 확인한다."
learning_refs:
  - title: "알람 전략: 에러율/레이턴시/자원지표 설계"
    href: "/learning/deep-dive/deep-dive-observability-alarms/"
    description: "인시던트를 시작할 신호를 어떤 SLI와 알람 기준으로 잡을지 정리합니다."
  - title: "SLO/SLI/Error Budget"
    href: "/learning/deep-dive/deep-dive-slo-sli-error-budget/"
    description: "Severity를 감정이 아니라 error budget burn과 사용자 영향 숫자로 판단하는 기준입니다."
  - title: "배포 런북: 안전한 배포와 롤백"
    href: "/learning/deep-dive/deep-dive-deployment-runbook/"
    description: "장애 중 롤백, 중단, 완화 판단을 실행 가능한 절차로 고정합니다."
decision_guide:
  intro: "장애 초반에는 모든 문제를 한 번에 풀려고 하지 말고, 피해 축소 수단과 데이터 위험을 기준으로 대응 모드를 고릅니다."
  cases:
    - badge: "SEV1 후보"
      title: "데이터 손상, 권한 오염, 중복 결제 가능성이 있다"
      fit: "영향 범위가 작아 보여도 쓰기 차단, 권한 회수, dedupe 검증을 먼저 둡니다."
      watchouts: "단순 롤백만으로 이미 발생한 부작용이 사라진다고 가정하면 안 됩니다."
      next_step: "IC를 지정하고 Technical Lead와 별도로 데이터 보정 owner를 둡니다."
    - badge: "SEV2 후보"
      title: "핵심 API 에러율이나 p99가 SLO를 크게 벗어났다"
      fit: "최근 배포, 외부 의존성, 트래픽 급증을 병렬로 보되 15분 안에 완화 결정을 냅니다."
      watchouts: "원인 후보를 늘리기만 하고 flag off, traffic shift back, rollback을 미루면 MTTR이 길어집니다."
      next_step: "현재 사용자 영향 수치와 가장 빠른 되돌림 수단을 채널 상단에 고정합니다."
    - badge: "SEV3/4"
      title: "사용자 우회가 가능하거나 내부 운영 영향이 중심이다"
      fit: "영업시간 복구 계획, owner, due date를 이슈로 남기고 과도한 page를 피합니다."
      watchouts: "반복되는 SEV3는 알람 피로보다 제품 신뢰도 하락 신호일 수 있습니다."
      next_step: "회고 없이 닫지 말고 알람/문서/테스트 중 하나 이상의 개선 액션을 남깁니다."
faqs:
  - question: "Incident Commander는 가장 senior한 개발자가 맡아야 하나요?"
    answer: "항상 그렇지는 않습니다. IC는 기술 깊이보다 우선순위 조정, 역할 배정, 업데이트 리듬 유지가 중요합니다. 가장 깊이 아는 사람은 Technical Lead로 두는 편이 더 빠를 때가 많습니다."
  - question: "Severity를 높게 선언했다가 나중에 낮추면 과잉 대응인가요?"
    answer: "초반 정보가 부족한 장애에서는 보수적으로 높게 잡고 15분 단위로 하향하는 편이 안전합니다. 결제, 권한, 개인정보, 데이터 손상 가능성이 있으면 특히 과소평가 비용이 더 큽니다."
  - question: "원인을 아직 모르면 고객 공지를 늦춰도 되나요?"
    answer: "원인 추측은 피해야 하지만 영향, 현재 완화 액션, 다음 업데이트 시각은 먼저 공유할 수 있습니다. 침묵이 길어지면 기술 복구와 별개로 신뢰 비용이 커집니다."
---

장애 대응이 어려운 이유는 기술 문제만 풀면 끝나지 않기 때문입니다. DB 락 경합, 배포 회귀, 외부 API 장애, Kafka lag, 캐시 장애처럼 원인은 다양하지만, 실제 현장에서는 더 기본적인 문제가 먼저 터집니다. 누가 지휘하는지 불분명하고, 누가 고객 공지를 쓰는지 모르며, 롤백할지 완화할지 회의가 길어지고, 같은 사람이 로그도 보고 커뮤니케이션도 하고 배포도 만지다가 판단이 흐려집니다.

그래서 일정 규모 이상 백엔드 팀에는 **Incident Command**가 필요합니다. 이는 거창한 조직 체계가 아니라, 장애 순간 역할과 의사결정 순서를 미리 고정하는 운영 방식입니다. [알람 전략](/learning/deep-dive/deep-dive-observability-alarms/)이 "언제 깨울 것인가"를 다루고, [SLO/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/)이 "얼마나 심각한가"를 숫자로 표현한다면, 인시던트 커맨드는 "깨어난 뒤 누가 어떤 순서로 복구할 것인가"를 닫아 주는 실행 체계입니다.

## 이 글에서 얻는 것

- 장애 상황에서 Incident Commander, technical lead, communication owner를 어떻게 나눌지 기준을 잡을 수 있습니다.
- Severity를 감정이 아니라 사용자 영향, 데이터 위험, 복구 시간, error budget burn으로 분류할 수 있습니다.
- 완화, 롤백, 원인 분석, 고객 커뮤니케이션의 우선순위를 숫자와 조건으로 운영할 수 있습니다.
- 사후 회고가 비난 문서가 아니라 다음 장애의 MTTR을 줄이는 학습 루프가 되도록 체크리스트를 만들 수 있습니다.

## 핵심 개념/이슈

### 1) 인시던트는 "원인 분석 회의"가 아니라 "피해 축소 작전"이다

장애 초반에 가장 흔한 실수는 원인을 완벽히 찾으려는 것입니다. 물론 원인은 중요합니다. 하지만 사용자가 이미 결제 실패, 로그인 실패, 주문 지연을 겪고 있다면 첫 목표는 원인 규명이 아니라 피해 축소입니다.

의사결정 우선순위는 아래처럼 잡는 편이 안전합니다.

1. 고객 영향 중단 또는 축소
2. 데이터 손상, 중복 결제, 권한 오염 같은 비가역 피해 차단
3. 복구 경로 확보와 상태 안정화
4. 원인 후보 축소
5. 영구 수정과 회고

즉, 장애 중에는 "왜 깨졌나"보다 "지금 더 나빠지는가"가 먼저입니다. [배포 런북](/learning/deep-dive/deep-dive-deployment-runbook/)에서 말하는 중단/완화/롤백 기준도 같은 이유로 필요합니다. 롤백으로 10분 안에 사용자 영향이 줄어든다면, 근본 원인은 롤백 뒤에 찾아도 됩니다. 반대로 데이터 정합성이 깨지는 상황이면 롤백보다 쓰기 차단이 먼저일 수 있습니다.

### 2) Severity는 큰 소리 낸 사람이 정하는 것이 아니다

Severity는 감정이나 직급이 아니라 영향 범위로 정해야 합니다. 초반에 과소평가하면 대응이 늦고, 과대평가가 반복되면 조직이 알람을 믿지 않습니다. 최소 분류는 아래 4단계면 충분합니다.

| 등급 | 기준 | 초기 대응 목표 |
| --- | --- | --- |
| SEV1 | 핵심 사용자 흐름 대규모 실패, 데이터 손상 가능성, 보안/권한 사고 | 5분 내 지휘자 지정, 15분 내 완화 결정 |
| SEV2 | 주요 기능 장애, 특정 리전/테넌트 영향, error budget 급소진 | 10분 내 owner 지정, 30분 내 완화 또는 롤백 |
| SEV3 | 우회 가능한 기능 장애, 내부 운영 영향, 제한적 고객 영향 | 영업시간 내 복구 계획 |
| SEV4 | 사용자 영향 낮은 결함, 관측/문서/운영 개선 | 일반 이슈로 추적 |

SLO가 있는 서비스라면 숫자 기준도 붙입니다.

- 5xx 비율이 5분 이상 3% 초과: 최소 SEV2 후보
- 핵심 API p99가 SLO 목표의 3배를 10분 이상 초과: SEV2 후보
- 결제/권한/개인정보 정합성 의심: 영향 범위가 작아도 SEV1 후보
- 1시간 burn rate 14.4x 초과: 즉시 page 기준
- 단일 테넌트 영향이라도 매출 상위 10% 고객이면 한 단계 상향

중요한 것은 최초 Severity가 틀릴 수 있다는 점입니다. 그래서 15분마다 "현재 등급 유지/상향/하향"을 명시적으로 확인해야 합니다.

### 3) Incident Commander는 제일 잘 고치는 사람이 아니다

초기 팀에서는 가장 실력 좋은 개발자가 모든 것을 맡습니다. 하지만 규모가 커질수록 이 방식은 위험합니다. 기술적으로 가장 깊이 보는 사람은 로그, 메트릭, 코드, 롤백 경로에 집중해야 합니다. 동시에 커뮤니케이션, 우선순위 조정, 의사결정 기록까지 맡으면 병목이 됩니다.

역할은 최소 3개로 나눕니다.

| 역할 | 책임 | 하지 말아야 할 일 |
| --- | --- | --- |
| Incident Commander | 우선순위, 역할 배정, 의사결정, 타임라인 관리 | 직접 모든 로그를 파고들기 |
| Technical Lead | 원인 후보 분석, 완화/롤백 실행, 검증 | 고객 공지와 이해관계자 조율 |
| Communication Owner | 내부 공유, 고객/CS 업데이트, 상태 문구 정리 | 기술 판단 단독 결정 |

팀이 작으면 한 사람이 두 역할을 겸할 수는 있습니다. 그래도 "지금 나는 어떤 역할로 말하는가"를 분리해야 합니다. Incident Commander의 핵심 질문은 매번 같습니다.

- 지금 사용자가 더 나빠지고 있는가?
- 완화 수단 중 가장 빠르고 되돌릴 수 있는 것은 무엇인가?
- 다음 15분 안에 누가 무엇을 끝내야 하는가?
- 아직 확인되지 않은 가정은 무엇인가?
- 외부 공유가 필요한가?

### 4) 타임라인은 사후 문서가 아니라 실시간 도구다

장애 중에는 기억이 왜곡됩니다. 10분 전에 누가 무엇을 실행했는지, 어떤 알람이 먼저 울렸는지, 롤백 전후 지표가 어떻게 바뀌었는지 나중에 맞추려 하면 시간이 많이 듭니다. 그래서 타임라인은 실시간으로 남겨야 합니다.

최소 형식은 단순해도 됩니다.

```text
10:06 alert: checkout 5xx 4.2%, p99 3.1s
10:08 SEV2 declared, IC=Jin, Tech=Min, Comms=Hana
10:11 candidate: payment-client timeout regression after deploy 2026.05.24.3
10:14 action: rollback checkout-api to 2026.05.24.2
10:19 signal: 5xx down to 0.8%, p99 900ms
10:25 decision: keep incident open 30m, inspect duplicate payment risk
```

여기서 중요한 것은 문장이 예쁜지가 아니라 재구성 가능성입니다. [구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/)과 [관측성 베이스라인](/learning/deep-dive/deep-dive-observability-baseline/)이 서비스 내부의 증거라면, 인시던트 타임라인은 사람과 시스템 액션의 증거입니다.

### 5) 완화와 원인 수정은 분리한다

장애 중에 바로 완벽한 패치를 만들고 싶은 유혹이 큽니다. 하지만 대부분의 SEV1/SEV2에서는 완화가 먼저입니다.

완화 수단의 우선순위는 아래처럼 둡니다.

1. 잘못된 배포 롤백
2. feature flag 또는 kill switch 비활성화
3. 트래픽 제한, brownout, degraded mode
4. 읽기 전용 모드 또는 특정 쓰기 차단
5. hotfix 배포
6. 데이터 복구/보정 작업

hotfix는 다섯 번째입니다. 이유는 간단합니다. 장애 중에는 검증 시간이 짧고, 새 코드는 새로운 회귀를 만들 수 있습니다. 롤백이나 flag off로 사용자 영향이 줄어든다면 그것이 먼저입니다. 단, 데이터 손상이나 보안 사고처럼 롤백만으로 피해가 멈추지 않는 경우에는 쓰기 차단과 권한 회수가 더 우선입니다.

## 실무 적용

### 1) SEV 선언 템플릿을 고정한다

장애 채널에서 처음 선언할 때는 아래 6개를 한 번에 적습니다.

```text
SEV: SEV2
Impact: checkout API 5xx 4%, p99 3s, 한국 리전 일부 사용자
Started: 2026-05-24 10:06 KST
IC: @jin
Tech Lead: @min
Next update: 10:20 KST
Current plan: 최근 배포 rollback 가능성 확인, payment timeout 지표 대조
```

이 형식을 쓰면 이해관계자는 "지금 누구에게 물어봐야 하는지"와 "다음 업데이트가 언제인지"를 압니다. 장애 대응에서 침묵은 불안을 키웁니다. 완벽한 답이 없어도, 다음 업데이트 시각은 지켜야 합니다.

### 2) 15분 단위 운영 루프를 만든다

SEV1/SEV2에서는 15분 루프가 적당합니다. 너무 짧으면 분석이 안 되고, 너무 길면 상태가 흩어집니다.

1. 현재 사용자 영향 수치 확인
2. 진행 중 액션 완료/미완료 확인
3. Severity 유지/상향/하향 결정
4. 다음 15분 목표 1~3개 지정
5. 내부/외부 업데이트 필요 여부 결정

이 루프의 핵심은 병렬 작업을 줄이는 것입니다. 장애 중에는 많은 사람이 동시에 여러 가정을 파고들면서 채널을 어지럽히기 쉽습니다. IC는 최대 2~3개의 작업 흐름만 열어두고, 나머지는 보류해야 합니다.

### 3) 데이터 위험 체크를 별도 단계로 둔다

사용자 요청 실패가 줄어들어도 인시던트가 끝난 것은 아닙니다. 결제, 포인트, 권한, 재고, 메시지 발송처럼 부작용이 남는 시스템은 데이터 위험을 따로 봐야 합니다.

점검 기준은 아래가 출발점입니다.

- 중복 결제/중복 지급 가능성: 0건으로 확인 전까지 종료 금지
- 실패한 주문/예약/정산 이벤트 backlog: 전체 0.1% 초과면 보정 계획 필요
- DLQ 유입이 평소 대비 3배 이상이면 replay 승인 전 원인 확인
- 외부 전송 중복 가능성이 있으면 message id 기준 dedupe 확인
- 권한 변경 장애라면 권한 회수와 감사 로그 검증을 먼저 수행

이 부분은 [Reconciliation Ledger Pipeline](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)과 [Poison Message Quarantine](/learning/deep-dive/deep-dive-poison-message-quarantine-safe-replay-playbook/)을 같이 봐야 합니다. 서비스가 다시 200을 반환해도, 내부 상태가 틀리면 장애는 아직 끝나지 않았습니다.

### 4) 흔한 실패 패턴을 미리 차단한다

인시던트 프로세스를 문서화해도 실제 장애에서는 몇 가지 패턴이 반복됩니다. 이 패턴은 기술 스택과 무관하게 MTTR을 늘리고, 사후 회고를 어렵게 만듭니다.

| 실패 패턴 | 현장 증상 | 차단 방법 |
| --- | --- | --- |
| 지휘자 공백 | 여러 사람이 동시에 로그를 보고, 아무도 다음 업데이트를 약속하지 않음 | 첫 5~10분 안에 임시 IC를 지정하고 나중에 교체 가능하게 둠 |
| 원인 분석 과몰입 | 사용자 영향이 계속되는데 코드 diff와 로그 해석만 길어짐 | "15분 안에 완화 가능 수단"을 별도 트랙으로 운영 |
| 채널 분산 | 장애 채널, DM, 배포 채널에 결정이 흩어짐 | 결정과 타임라인은 한 채널 또는 한 문서에만 canonical로 남김 |
| 데이터 위험 누락 | API 200 회복 후 중복 결제, 누락 이벤트, 권한 오염이 뒤늦게 발견됨 | 종료 조건에 reconciliation, DLQ, audit log 확인을 강제 |
| 임시 완화 방치 | flag off, rate limit, read-only mode가 며칠 뒤에도 남음 | 완화 owner, 만료 시각, 제거 티켓을 인시던트 종료 전에 생성 |

특히 "지휘자 공백"은 가장 싸게 줄일 수 있는 문제입니다. 처음 5분 동안 완벽한 담당자를 찾느라 늦어지는 것보다, 임시 IC가 역할을 나누고 15분 뒤 교체하는 편이 낫습니다. IC 교체도 타임라인에 남기면 혼란이 크지 않습니다.

```text
10:08 SEV2 declared, temporary IC=Jin
10:13 Tech Lead=Min, Comms=Hana assigned
10:22 IC handoff: Jin -> Sora, reason=Jin joins rollback execution
```

이렇게 기록하면 나중에 "누가 결정했는가"보다 "그 시점에 왜 그렇게 판단했는가"를 복원하기 쉬워집니다.

### 5) 종료 기준을 숫자로 말한다

"괜찮아진 것 같다"로 인시던트를 닫으면 재발이 잦습니다. 종료 기준은 선언 기준만큼 구체적이어야 합니다.

권장 종료 기준:

- 핵심 SLI가 30분 이상 정상 범위 유지
- error budget burn rate가 page 기준 아래로 하락
- backlog 또는 DLQ가 정해진 복구 계획 안에 있음
- 데이터 손상/중복 처리 여부를 점검했거나 별도 보정 티켓 생성
- 고객/CS/내부 이해관계자에게 현재 상태와 후속 조치 공유
- 임시 완화가 남아 있으면 owner와 만료 시각 지정

완화 상태로 닫을 수도 있습니다. 다만 "완전히 고침"과 "사용자 영향은 줄였지만 임시 조치가 남음"은 다르게 기록해야 합니다.

### 6) 회고 액션은 시스템 변경으로 끝낸다

좋은 회고는 "다음에는 조심한다"로 끝나지 않습니다. 회고 액션은 가능한 한 시스템 기본값, 자동화, 문서, 테스트, 알람으로 바뀌어야 합니다.

예를 들어 아래처럼 바꾸면 실행 가능성이 올라갑니다.

| 나쁜 액션 | 더 나은 액션 |
| --- | --- |
| 배포 전에 더 주의한다 | checkout API 배포 PR에 p95/p99, 5xx, payment timeout 대시보드 링크를 필수 체크로 추가 |
| 장애 채널에서 빨리 공유한다 | SEV2 선언 후 15분마다 업데이트가 없으면 봇이 IC에게 reminder 전송 |
| 중복 결제를 더 잘 확인한다 | 결제 provider transaction id 기준 reconciliation job을 10분 간격으로 실행하고 누락/중복 알람 생성 |
| 롤백 절차를 숙지한다 | staging에서 월 1회 rollback drill을 돌리고 실행 시간과 실패 원인을 런북에 기록 |

회고 액션은 3개 이내로 줄이는 편이 좋습니다. 장애 하나에서 12개 액션을 만들면 대부분 늦어지고, 다음 장애에서 같은 문제가 반복됩니다. 대신 가장 MTTR을 많이 줄일 1~3개를 골라 owner와 due date를 붙입니다. 30일 뒤에도 닫히지 않은 액션은 별도 부채로 보되, 같은 유형의 장애가 반복되면 Severity 기준이나 알람 기준을 다시 봐야 합니다.

## 트레이드오프/주의점

첫째, Severity를 너무 쉽게 올리면 피로가 생깁니다. 하지만 초반에는 낮게 잡는 것보다 높게 잡고 빠르게 하향하는 편이 안전합니다. 특히 결제, 권한, 개인정보, 데이터 손상 가능성은 영향 범위가 작아 보여도 보수적으로 봐야 합니다.

둘째, Incident Commander가 기술 판단을 완전히 몰라도 된다는 뜻은 아닙니다. 최소한 SLO, 배포 흐름, 주요 의존성, 데이터 위험을 이해해야 좋은 질문을 할 수 있습니다. 다만 직접 모든 명령을 실행하는 역할은 아닙니다.

셋째, 커뮤니케이션을 너무 늦추면 기술 복구가 빨라도 신뢰를 잃습니다. 고객 영향이 명확하면 30분 안에 첫 외부 문안을 준비하는 기준이 좋습니다. 원인이 확정되지 않았으면 원인을 추측하지 말고, 영향과 현재 완화 액션을 말하면 됩니다.

넷째, 회고가 사람 탓으로 흐르면 다음 장애에서 더 적은 정보가 공유됩니다. 회고의 목적은 "누가 실수했나"가 아니라 "어떤 시스템 기본값과 절차가 같은 실수를 가능하게 했나"입니다.

## 체크리스트 또는 연습

### 실무 체크리스트

- [ ] SEV1~SEV4 기준이 사용자 영향, 데이터 위험, SLO 숫자로 정의돼 있다.
- [ ] Incident Commander, Technical Lead, Communication Owner 역할이 문서화돼 있다.
- [ ] SEV1/SEV2 선언 템플릿과 15분 업데이트 규칙이 있다.
- [ ] 롤백, kill switch, brownout, read-only mode 중 최소 2개 완화 수단이 준비돼 있다.
- [ ] 인시던트 종료 기준에 SLI 안정화, backlog, 데이터 위험 점검이 포함돼 있다.
- [ ] 회고 액션은 owner와 due date를 갖고, 30일 안에 완료율을 추적한다.

### 연습 과제

1. 최근 장애 또는 가상의 checkout 장애를 하나 골라 SEV 등급, IC, Tech Lead, Comms Owner를 지정해 보세요.
2. 30분짜리 타임라인을 작성하고, 15분마다 어떤 의사결정을 했어야 하는지 표시해 보세요.
3. 롤백이 불가능한 장애를 가정하고, feature flag, 트래픽 제한, read-only mode 중 어떤 완화를 먼저 쓸지 기준을 정리해 보세요.
4. 회고 액션을 5개 작성하되, "주의한다" 같은 문장을 금지하고 코드/알람/런북/테스트 변경으로만 표현해 보세요.

## 관련 글

- [알람 전략: 에러율/레이턴시/자원지표 설계](/learning/deep-dive/deep-dive-observability-alarms/)
- [SLO/SLI/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/)
- [배포 런북: 안전한 배포와 롤백](/learning/deep-dive/deep-dive-deployment-runbook/)
- [관측성 베이스라인](/learning/deep-dive/deep-dive-observability-baseline/)
- [Reconciliation Ledger Pipeline](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)
