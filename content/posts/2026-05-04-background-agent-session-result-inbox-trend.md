---
title: "2026 개발 트렌드: Background Agent Session, 팀 자동화는 실시간 채팅보다 작업 큐와 결과 인박스로 이동한다"
date: 2026-05-04
draft: false
tags: ["Background Agent", "Async Workflow", "Result Inbox", "Agent Runtime", "Platform Engineering"]
categories: ["Development", "Learning"]
series: "2026 개발 운영 트렌드"
keywords: ["background agent session", "result inbox", "async agent workflow", "persistent agent session", "agent task queue"]
description: "최근 팀 자동화는 한 턴씩 실시간 채팅하는 구조에서 벗어나, 오래 사는 background agent session과 결과 인박스로 이동하고 있습니다. 왜 이 흐름이 강해지는지 운영 기준으로 정리합니다."
lastmod: 2026-05-04
summary: "Background Agent Session 트렌드는 에이전트를 채팅창 안의 즉답 도구가 아니라, 큐에 들어간 일을 장시간 처리하고 결과를 인박스로 돌려주는 작업 단위 런타임으로 다루는 방향입니다. 핵심은 긴 작업의 인터럽트 비용, 인간 승인 대기, 증거 번들, 세션 내구성을 한 번에 다루는 데 있습니다."
key_takeaways:
  - "요즘 팀 자동화의 병목은 답변 생성 속도보다, 오래 걸리는 작업을 끊기지 않게 실행하고 적절한 시점에 사람에게 되돌려주는 흐름에 있다."
  - "background agent session은 persistent context, durable execution, result inbox, human gate를 함께 설계할 때 진짜 가치가 난다."
  - "좋은 팀은 모든 작업을 실시간 채팅에 남겨 두지 않고, 3분 이상 걸리는 일과 승인 대기 일은 큐 기반 비동기 세션으로 분리한다."
operator_checklist:
  - "작업을 인터랙티브, 짧은 비동기, 긴 비동기 세 종류로 분류하고 큐 진입 기준을 문서화한다."
  - "session completion rate, human interruption rate, result delivery latency를 최소 지표로 둔다."
  - "background run이 끝난 뒤 사람에게 돌아오는 결과는 채팅 원문이 아니라 change summary, evidence, next action 중심으로 묶는다."
decision_guide:
  title: "우리 팀이 Background Agent Session을 검토할 만한 신호"
  intro: "이 구조는 모든 조직의 기본값은 아닙니다. 하지만 아래 조건이 겹치면 채팅형 즉답 모델보다 비동기 세션 모델이 더 운영 친화적일 수 있습니다."
  cases:
    - badge: "즉시 검토"
      title: "작업 시간이 길고, 중간에 사람 승인이나 외부 대기가 자주 끼어든다"
      fit: "PR 생성, CI 대기, 데이터 수집, 멀티스텝 리팩터링, 운영 점검 같은 작업이 많은 팀"
      watchouts: "세션 내구성, 재개 전략, 결과 인박스 형식이 없으면 오히려 진행상태가 더 안 보일 수 있다."
      next_step: "3분 이상 걸리는 작업부터 task queue와 completion notification을 분리한다."
    - badge: "부분 도입"
      title: "짧은 질답은 많지만, 실제 가치가 나는 일은 대부분 2개 이상 도구를 거친다"
      fit: "실시간 답변보다 조사, 편집, 검증, 재시도 비중이 높은 팀"
      watchouts: "모든 작업을 비동기로 보내면 체감 응답성이 급격히 떨어질 수 있다."
      next_step: "도구 2개 이상, 예상 3분 이상, 인간 승인 대기 포함 작업만 background 대상으로 제한한다."
    - badge: "보류 가능"
      title: "한 명이 짧은 질문 위주로 쓰고, 결과가 즉시 필요하다"
      fit: "즉답형 검색, 단순 질의응답, 로컬 실험 중심 환경"
      watchouts: "이 경우는 큐와 세션을 추가하는 비용이 이득보다 클 수 있다."
      next_step: "먼저 [Workflow State Contract](/posts/2026-04-27-workflow-state-contract-agent-ops-trend/)과 [Execution Receipt](/posts/2026-04-14-execution-receipt-agent-operations-trend/) 수준의 기본 운영 구조부터 다진다."
learning_refs:
  - title: "Agent Handoff Packet"
    href: "/posts/2026-04-17-agent-handoff-packet-runtime-trend/"
    description: "작업을 대화가 아니라 패킷으로 넘기는 관점이 이 트렌드의 전제입니다."
  - title: "Task Graph Runtime"
    href: "/posts/2026-04-29-task-graph-runtime-agent-ops-trend/"
    description: "여러 작업과 의존성을 큐로 다룰 때 왜 그래프 모델이 필요한지 이어집니다."
  - title: "Outside-the-Sandbox Harness"
    href: "/posts/2026-05-03-harness-outside-sandbox-agent-control-plane-trend/"
    description: "오래 사는 세션을 샌드박스와 분리하는 구조적 이유를 이해하는 데 도움이 됩니다."
faqs:
  - question: "그냥 채팅창에서 계속 이어서 작업하면 안 되나?"
    answer: "짧은 작업은 그게 맞습니다. 하지만 10분 넘는 작업, CI 대기, 외부 승인, 여러 도구 호출이 섞인 작업은 채팅창 하나에 묶어 두면 진행 상태와 책임 경계가 금방 흐려집니다."
  - question: "background로 보내면 사용자 체감이 느려지지 않나?"
    answer: "모든 작업을 보내면 그렇습니다. 그래서 좋은 팀은 인터랙티브와 비동기를 분리하고, acknowledgement는 빠르게 주되 실제 완료는 인박스로 되돌리는 두 단계 UX를 택합니다."
  - question: "이게 단순 작업 큐와 뭐가 다른가?"
    answer: "작업 큐는 일의 순서를 다루고, background agent session은 그 안에서 문맥, 승인, 증거, 재개 상태까지 함께 다룹니다. 즉 큐만으로는 부족하고 세션 수명이 같이 필요합니다."
---

지금까지 많은 팀이 에이전트를 채팅창 안의 똑똑한 자동완성으로 다뤘습니다. 질문을 던지고, 한 턴 안에 답을 받고, 필요하면 한 번 더 수정하는 식입니다. 이 모델은 짧은 질답에는 잘 맞습니다. 그런데 실제 업무를 보면 가치가 큰 일은 점점 다른 모양을 띱니다. 코드베이스를 훑고, 파일을 바꾸고, 테스트를 돌리고, CI를 기다리고, 실패하면 다시 시도하고, 중간에 사람 승인을 받는 식입니다. 이런 작업은 15초짜리 답변보다 **5분, 20분, sometimes 몇 시간짜리 진행 단위**에 가깝습니다.

그래서 최근 흐름은 에이전트를 "실시간 대화 상대"로만 두지 않고, **background agent session**으로 오래 살게 만드는 방향으로 가고 있습니다. 사람은 작업을 던지고, 시스템은 큐에 넣고, 에이전트는 세션을 유지하며 일을 진행하고, 끝나면 결과를 인박스로 돌려줍니다. 저는 이게 단순 UX 취향이 아니라, [Agent Handoff Packet](/posts/2026-04-17-agent-handoff-packet-runtime-trend/), [Workflow State Contract](/posts/2026-04-27-workflow-state-contract-agent-ops-trend/), [Task Graph Runtime](/posts/2026-04-29-task-graph-runtime-agent-ops-trend/), [Outside-the-Sandbox Harness](/posts/2026-05-03-harness-outside-sandbox-agent-control-plane-trend/)가 이어진 다음 단계라고 봅니다.

## 이 글에서 얻는 것

- background agent session이 왜 최근 팀 자동화의 기본 패턴으로 떠오르는지 이해할 수 있습니다.
- 어떤 작업을 실시간 채팅으로 두고, 어떤 작업을 큐 기반 비동기 세션으로 보내야 하는지 기준을 세울 수 있습니다.
- result inbox, completion notification, session durability를 어떤 숫자로 운영하기 시작하면 되는지 감을 잡을 수 있습니다.
- "에이전트가 오래 일하게 한다"는 말이 단순 대기시간 증가가 아니라 책임 분리와 운영 단순화 문제라는 점을 설명할 수 있습니다.

## 핵심 개념/이슈

### 1) 병목이 답변 생성에서 작업 완결로 이동했다

초기 에이전트 도입기에는 모델이 얼마나 잘 답하느냐가 핵심이었습니다. 하지만 실제 팀 사용이 늘어나면 병목이 달라집니다.

- 답은 빨리 나오는데 실제 수정은 여러 파일과 검증이 필요하다.
- CI, 테스트, 배포, 크롤링, 데이터 수집처럼 기다리는 시간이 길다.
- 승인 대기나 외부 시스템 응답 때문에 사람이 채팅창 앞에서 계속 붙어 있기 어렵다.
- 중간 실패 뒤 어디서 다시 이어야 할지 문맥이 자주 끊긴다.

즉 생산성의 병목이 "첫 답이 늦다"에서 "작업이 끝까지 안 닫힌다"로 이동한 것입니다. 이 시점부터는 단일 턴 응답보다 **세션 지속성, 재개 가능성, 완료 알림**이 훨씬 중요해집니다. 배경 세션이 뜨는 이유가 여기 있습니다.

### 2) background session은 채팅을 대체하는 게 아니라 작업 단위를 분리한다

이 구조를 오해하면 "그냥 채팅 대신 큐를 쓰자는 이야기"처럼 들릴 수 있습니다. 하지만 핵심은 더 작고 실무적입니다. **작업 성격에 따라 실행면을 나누는 것**입니다.

- **인터랙티브 작업**: 30초 안에 끝나는 질답, 짧은 수정, 빠른 확인
- **짧은 비동기 작업**: 1~3분, 도구 2개 이상, 결과 확인이 필요한 일
- **긴 비동기 작업**: 3분 이상, 재시도/대기/승인/여러 단계 검증이 섞인 일

좋은 팀은 이 셋을 같은 UX에 우겨 넣지 않습니다. 특히 `예상 실행시간 3분 이상`, `외부 대기 포함`, `중간 실패 시 재개 필요`, `완료 뒤 사람이 다음 결정을 내려야 함` 중 2개 이상이면 background 대상으로 보내는 편이 운영상 훨씬 깔끔합니다.

이 분류가 중요한 이유는, 모든 일을 실시간 채팅으로 남겨 두면 채팅 로그가 곧 작업 상태 저장소가 되기 때문입니다. 그러면 [Workflow State Contract](/posts/2026-04-27-workflow-state-contract-agent-ops-trend/)에서 강조한 명시적 상태 전이가 다시 흐려집니다.

### 3) result inbox가 없으면 background는 곧바로 "사라진 작업"이 된다

비동기 세션을 만들 때 가장 흔한 실패는 큐에 넣는 것까지는 했는데, 완료 결과가 사람에게 잘 돌아오지 않는 경우입니다. 그러면 background는 자동화가 아니라 실종 처리로 느껴집니다.

그래서 background session에는 보통 **result inbox**가 같이 필요합니다. 이 인박스는 단순 알림창이 아니라, 적어도 아래를 담아야 합니다.

- 무엇을 끝냈는가
- 어떤 증거가 붙는가(테스트, 링크, diff, 로그)
- 실패했다면 어디서 막혔는가
- 사람이 지금 결정해야 할 한 가지는 무엇인가

핵심은 원문 대화를 길게 되돌리지 않는 것입니다. 완료 시점에는 사람에게 필요한 정보가 이미 달라집니다. 그래서 [Execution Receipt](/posts/2026-04-14-execution-receipt-agent-operations-trend/)처럼 **작업 결과를 요약 + 증거 + 다음 액션** 형태로 묶는 구조가 중요해집니다.

실무에서 추천할 시작 기준은 이 정도입니다.

- `completion_ack_p95`는 **10초 이하**: 작업 접수 확인은 즉시
- `result_delivery_latency_p95`는 완료 후 **60초 이하**: 끝났는데 알림이 늦으면 체감이 급격히 나빠짐
- `result_without_evidence_rate`는 **5% 이하** 목표: 결과에 근거가 비어 있으면 신뢰가 떨어짐

### 4) 오래 사는 세션이 되면 durable execution과 재개 전략이 본체가 된다

background session의 진짜 어려움은 "백그라운드로 돌린다"가 아닙니다. **중간에 끊겨도 이어져야 한다**는 점입니다. 이 순간부터 세션은 채팅 히스토리가 아니라 실행 상태를 가진 객체가 됩니다.

예를 들어 이런 상황은 흔합니다.

- 테스트 12분 실행 중 프로세스 재시작
- CI 대기 중 플랫폼 배포
- 외부 승인 대기 40분
- 파일 수정은 끝났는데 검증 단계에서만 재시도 필요

이런 흐름에서 세션이 매번 처음부터 다시 시작하면 background의 장점이 거의 사라집니다. 그래서 [Outside-the-Sandbox Harness](/posts/2026-05-03-harness-outside-sandbox-agent-control-plane-trend/)가 말하듯, 세션 제어 평면과 실제 작업 실행 환경을 분리하는 구조가 같이 필요해집니다.

처음부터 거대한 시스템이 필요하진 않지만, 아래 수치는 먼저 고정하는 편이 좋습니다.

- `session_completion_rate` **95% 이상**
- `session_resume_success_rate` **99% 이상**
- `human_interruption_rate` **15% 이하** 목표
- `rework_due_to_lost_context_rate` **5% 이하** 목표
- `completion_notification_miss_rate` **1% 이하** 목표

특히 `human_interruption_rate`는 중요합니다. 사람이 중간에 "지금 뭐 하고 있어?", "다시 처음부터 설명해봐"를 자주 묻게 되면, 세션이 오래 살아도 실제로는 일을 대신 들고 있는 게 아닙니다.

### 5) background session은 멀티에이전트보다 먼저 "작업 경계"를 요구한다

요즘 에이전트 얘기를 하면 자꾸 멀티에이전트가 먼저 나오지만, 저는 그보다 앞선 문제가 있다고 봅니다. **작업 경계가 먼저 안 서면 여러 에이전트를 붙여도 더 어지러워질 뿐**입니다.

background session이 먼저 필요한 이유는 작업을 다음처럼 명시적으로 만들기 때문입니다.

- 입력: 무엇을 해야 하는가
- 제약: 어디까지 건드릴 수 있는가
- 종료 조건: 무엇이 끝나면 완료인가
- 증거: 무엇을 남겨야 하는가
- 사람 게이트: 언제 되돌려야 하는가

이 구조가 잡혀야 [Agent Handoff Packet](/posts/2026-04-17-agent-handoff-packet-runtime-trend/)도 의미가 있고, [Task Graph Runtime](/posts/2026-04-29-task-graph-runtime-agent-ops-trend/)처럼 여러 작업을 의존성 그래프로 나누는 것도 가능합니다. 반대로 이 경계가 없으면 background는 단지 "오래 켜 둔 채팅"이 됩니다.

### 6) 진짜 가치가 큰 곳은 승인 대기와 도구 대기가 섞인 작업이다

이 패턴이 특히 강한 곳은 아래 같은 작업입니다.

- PR 생성 후 테스트와 리뷰 준비까지 이어지는 흐름
- 데이터 추출, 정리, 문서화처럼 읽기-편집-검증이 연속되는 일
- 보안 점검, 운영 점검, 로그 분석처럼 중간에 대기와 재시도가 있는 일
- 크롤링, 리서치, 코드베이스 리팩터링처럼 여러 도구를 순서대로 거치는 일

이런 작업은 사람 입장에서도 "지금 당장 답"보다 "끝나면 근거와 함께 가져와"가 더 자연스럽습니다. 그래서 background session의 가치는 평균 응답시간보다 **인간 주의력 절약**에서 더 크게 납니다. 사람은 ack만 받고 다른 일을 하다가, 진짜 결정이 필요할 때만 다시 돌아오면 되기 때문입니다.

## 실무 적용

### 1) 큐 진입 기준을 먼저 고정하자

저는 아래 네 조건 중 2개 이상이면 background 세션으로 보내는 편이 맞다고 봅니다.

1. 예상 실행시간 **3분 이상**
2. 도구 호출 **2개 이상** 또는 파일 수정 + 검증 포함
3. 외부 대기(CI, 승인, 크롤링, 배포) 포함
4. 완료 후 사람이 판단해야 할 다음 액션이 존재

반대로 30초 안에 끝나는 질문, 한 파일 한 줄 수정, 바로 확인이 필요한 질답은 실시간 채팅이 낫습니다. 핵심은 모든 것을 자동화하지 않는 절제입니다.

### 2) 추천 운영 지표

background session을 시작한다면 아래는 최소로 잡는 편이 좋습니다.

- `queue_wait_p95`: 작업이 실제 시작되기까지의 지연, **60초 이하** 목표
- `session_completion_rate`: 시작한 작업이 완료 상태로 닫히는 비율, **95% 이상**
- `result_delivery_latency_p95`: 완료 후 사람에게 전달되기까지, **60초 이하**
- `human_interruption_rate`: 진행 중 상태 확인을 위해 사람이 끼어든 비율, **15% 이하**
- `retry_per_session_p95`: 세션당 재시도 수, 초기 기준 **3 이하**
- `orphaned_session_count`: 끝났거나 멈췄는데 누구도 모르는 세션 수, 가능하면 **0**

이 숫자가 없으면 background로 돌린 뒤 좋아졌는지 판단하기 어렵습니다.

### 3) 결과 인박스 포맷

결과 인박스는 길수록 좋은 게 아닙니다. 보통 아래 4블록이면 충분합니다.

1. **요약 1~2줄**: 무엇을 끝냈는가
2. **증거**: 테스트 결과, 링크, 변경 파일, 로그
3. **리스크/보류**: 아직 안 닫힌 것
4. **다음 액션 1개**: 사람이 지금 결정할 것

이 포맷은 [Review Ops Unified Human Gate](/posts/2026-04-23-review-ops-unified-human-gate-trend/)와도 잘 연결됩니다. 사람은 모든 과정을 다시 읽고 싶어 하지 않고, **승인 가능한 단위**로 요약된 결과를 원하기 때문입니다.

실제 운영에서는 인박스를 아래처럼 아주 건조하게 고정하는 편이 좋습니다.

```text
[작업 완료] background-agent-session-rollout
- 요약: CI 대기 포함 18분 작업 완료, 승인 필요 항목 1개 남음
- 증거: PR #182, 테스트 48/48 통과, 변경 파일 6개, 실행 로그 링크
- 리스크: staging smoke는 아직 미실행
- 다음 액션: staging 반영 승인 여부 결정
```

포인트는 두 가지입니다. 첫째, 결과 인박스는 **전체 대화 로그를 복붙하는 곳이 아니라 의사결정 압축본**이어야 합니다. 둘째, 사람이 다시 물어볼 질문을 줄여야 합니다. 그래서 `뭘 끝냈는지`, `뭘 믿어도 되는지`, `지금 내가 뭘 결정해야 하는지`가 한 화면 안에 같이 있어야 합니다. 이 구조가 약하면 background 세션이 아무리 잘 돌아도 최종 체감은 "왜 또 내가 다시 읽어야 하지?"로 나빠집니다.

### 4) 실무 시나리오: 코드 수정 요청을 background session으로 바꾸면 무엇이 달라지나

조금 더 현실적인 예로 보겠습니다. 누군가 채팅창에 "로그인 세션 만료 버그를 찾아서 수정하고 테스트까지 해줘"라고 요청했다고 합시다. 이 요청을 순수 실시간 대화로만 처리하면 보통 다음 문제가 같이 나옵니다.

- 에이전트가 리포지터리를 읽는 동안 사람은 진행 상태를 알기 어렵다.
- 테스트가 길어지면 중간에 "아직이야?" 같은 상태 확인 대화가 끼어든다.
- 수정은 끝났는데 PR 링크, 재현 시나리오, 남은 리스크가 한 덩어리로 정리되지 않는다.
- 실패했을 때 어디서 막혔는지보다 대화 로그가 길게 남아 재시도 판단이 늦어진다.

반대로 background session으로 보내면 요청 단위가 아래처럼 분리됩니다.

1. **접수 단계**: 작업 제목, 재현 조건, 성공 기준, 위험 범위를 패킷으로 고정
2. **실행 단계**: 코드 탐색, 수정, 테스트, 재시도를 세션 안에서 유지
3. **대기 단계**: CI·리뷰·승인처럼 사람이 당장 붙어 있지 않아도 되는 시간을 별도 상태로 처리
4. **복귀 단계**: 결과 인박스에 요약, 근거, 미해결 리스크, 다음 액션만 압축해 반환

여기서 중요한 건 "백그라운드로 돌린다"가 아니라 **사람의 주의력을 붙잡아 두는 시간을 잘라내는 것**입니다. 좋은 운영은 에이전트가 오래 일하는 것보다, 사람이 언제 다시 돌아오면 되는지를 분명하게 만드는 쪽에 가깝습니다. 그래서 background session 설계는 기술 선택보다 먼저 `ack SLA`, `중간 블로커 기준`, `완료 인박스 포맷`을 정하는 일로 시작하는 편이 낫습니다.

실제로는 아래 정도만 먼저 고정해도 체감이 꽤 달라집니다.

- 접수 후 **10초 안에** "무엇을 하러 들어갔는지"를 짧게 돌려준다.
- 테스트/CI/승인처럼 **사람이 개입해야만 풀리는 대기**만 중간 알림을 보낸다.
- 완료 메시지에는 반드시 **변경 파일, 검증 결과, 남은 리스크, 다음 액션 1개**를 넣는다.
- 실패 시에는 "안 됨"이 아니라 **막힌 단계와 재개 조건**을 같이 남긴다.

이 정도 기준만 있어도 background session은 막연한 자동화가 아니라, 사람이 믿고 맡길 수 있는 운영 단위로 바뀝니다. 반대로 이 계약 없이 세션만 오래 살리면, 사용자는 결국 진행 상태를 묻기 위해 다시 채팅을 열게 되고, 시스템은 비동기화했지만 업무는 여전히 동기식으로 굴러갑니다.

### 5) 도입 순서

처음부터 완전한 플랫폼을 만들 필요는 없습니다. 보통 아래 순서가 현실적입니다.

1. 긴 작업만 background로 분리
2. completion notification과 result inbox부터 붙임
3. 세션 재개와 상태 저장을 추가
4. 그다음 task dependency와 handoff를 확장

많은 팀이 4번부터 달리고 싶어 하지만, 실제로는 1~3이 먼저 닫혀야 "비동기 작업이 실종되지 않는다"는 신뢰가 생깁니다.

### 6) 도입 초기에 자주 나오는 실패 패턴

이 주제를 실제 팀에 붙일 때는 성공 사례보다 실패 패턴을 먼저 보는 편이 더 도움이 됩니다. 반복해서 나오는 안 좋은 모양은 대체로 비슷합니다.

- **모든 작업을 비동기로 보내는 경우**: 응답성은 떨어지고, 사용자는 어디까지가 바로 답해야 하는 질문인지 감을 잃습니다.
- **큐는 있는데 완료 인박스가 약한 경우**: 작업은 돌았지만 결과가 흩어져서, 결국 사람이 로그와 채팅을 다시 뒤져야 합니다.
- **재개 기준이 없는 경우**: 세션이 한 번 끊기면 동일 작업이 중복 실행되거나, 사람이 다시 설명하는 비용이 커집니다.
- **승인 대기와 실패 상태를 구분하지 않는 경우**: 실제로는 멈춘 게 아니라 사람 결정을 기다리는 작업인데, 운영 대시보드에서는 실패처럼 보여 잘못된 재시도가 늘어납니다.

저는 이 네 가지를 보면 아직 팀이 background session을 "오래 실행되는 채팅" 정도로만 보고 있다고 판단합니다. 반대로 이 문제를 먼저 줄이면, 이후에 [Task Graph Runtime](/posts/2026-04-29-task-graph-runtime-agent-ops-trend/)이나 [Agent Handoff Packet](/posts/2026-04-17-agent-handoff-packet-runtime-trend/) 같은 상위 구조로 넘어갈 때도 훨씬 덜 흔들립니다.

## 트레이드오프/주의점

첫째, **모든 작업을 background로 보내면 체감이 둔해집니다.** 즉답이 필요한 일까지 큐에 넣으면 사용자 경험이 나빠집니다.

둘째, **result inbox가 약하면 작업이 끝나도 안 끝난 것처럼 느껴집니다.** 완료 결과는 도착했는데 증거가 없거나, 무엇을 결정해야 할지 안 보이면 다시 긴 대화를 열게 됩니다.

셋째, **세션 재개가 약하면 잃어버린 문맥 비용이 폭발합니다.** 오래 사는 세션의 장점은 지속성인데, 재개가 안 되면 단점만 남습니다.

넷째, **알림은 많을수록 좋은 게 아닙니다.** 진행률 10%, 20%, 30%처럼 잦은 노티보다, 시작 확인, 의미 있는 중간 블로커, 완료 알림 세 단계가 대체로 낫습니다.

다섯째, **background session은 책임 경계를 더 많이 요구합니다.** 누가 작업을 만들고, 누가 승인하고, 누가 완료 기준을 바꾸는지 모르면 오히려 운영이 복잡해집니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 인터랙티브 작업과 비동기 작업의 경계를 문서화했다.
- [ ] `3분 이상`, `도구 2개 이상`, `외부 대기 포함` 같은 큐 진입 기준이 있다.
- [ ] background 작업은 completion notification과 result inbox를 함께 가진다.
- [ ] result inbox에 요약, 증거, 리스크, 다음 액션이 포함된다.
- [ ] `session_completion_rate`, `human_interruption_rate`, `result_delivery_latency`를 측정한다.
- [ ] 세션 재개 실패 시 어디서부터 다시 이어갈지 기준이 있다.
- [ ] 승인 대기와 작업 대기가 같은 상태로 뭉개지지 않는다.
- [ ] orphaned session을 찾는 루틴이 있다.

### 연습 과제

1. 최근 20개 작업을 골라 `실시간 채팅 유지`, `짧은 비동기`, `긴 비동기`로 분류해 보세요. 생각보다 긴 작업이 많을 가능성이 큽니다.
2. 현재 팀에서 자주 하는 10분 이상 작업 1개를 골라, 접수 확인 메시지와 완료 인박스 포맷을 설계해 보세요.
3. background 세션이 중간에 끊겼다고 가정하고, 어디까지를 저장해야 다시 이어갈 수 있는지 체크포인트를 적어 보세요.
4. 진행률 알림을 언제 보내고 언제 생략할지 규칙을 써 보세요. 알림 과다도 운영 비용입니다.

## 관련 글

- [Execution Receipt](/posts/2026-04-14-execution-receipt-agent-operations-trend/)
- [Agent Handoff Packet](/posts/2026-04-17-agent-handoff-packet-runtime-trend/)
- [Review Ops Unified Human Gate](/posts/2026-04-23-review-ops-unified-human-gate-trend/)
- [Workflow State Contract](/posts/2026-04-27-workflow-state-contract-agent-ops-trend/)
- [Task Graph Runtime](/posts/2026-04-29-task-graph-runtime-agent-ops-trend/)
- [Outside-the-Sandbox Harness](/posts/2026-05-03-harness-outside-sandbox-agent-control-plane-trend/)
- [Durable Execution + Event Orchestration](/posts/2026-03-24-durable-execution-event-orchestration-trend/)
