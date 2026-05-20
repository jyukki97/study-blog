---
title: "2026 개발 트렌드: Workflow State Contract, 잘하는 팀은 에이전트를 자유 프롬프트보다 명시적 상태 전이 위에 올린다"
date: 2026-04-27
draft: false
tags: ["Workflow State Contract", "Statecharts", "AI Agents", "Runtime Governance", "Evaluation", "Determinism"]
categories: ["Development", "Learning"]
series: "2026 개발 운영 트렌드"
keywords: ["workflow state contract", "statechart agent ops", "agent runtime governance", "predictable automation", "deterministic shell"]
description: "모델은 더 강해졌지만 자유형 채팅만으로는 반복 가능한 운영 품질을 만들기 어렵습니다. 최근 팀들이 에이전트 워크플로를 명시적 상태 전이와 증거 게이트로 묶는 이유를 정리합니다."
summary: "Workflow State Contract는 에이전트가 무엇을 말했는지가 아니라 어떤 상태에서 어떤 도구를 쓸 수 있고, 어떤 증거가 있어야 다음 단계로 넘어가는지를 고정하는 운영 구조입니다. 벤치마크 포화, 모델 비결정성, 책임 있는 인간 판단을 함께 다루려는 팀에게 점점 기본 설계가 되고 있습니다."
key_takeaways:
  - "중요한 것은 모델의 결정성 자체보다, 비결정적인 생성 과정을 예측 가능한 상태 전이와 exit rule 안에 가두는 것이다."
  - "벤치마크 점수와 자유형 데모는 운영 품질을 보장하지 않으므로, 프로덕션 영향 작업은 상태 계약, 증거 게이트, 승격 규칙으로 따로 관리해야 한다."
  - "좋은 Workflow State Contract는 사람을 모든 단계에 붙이는 체계가 아니라, 인간이 꼭 소유해야 할 판단 노드만 분명하게 남기는 체계다."
operator_checklist:
  - "프로덕션 영향 워크플로마다 상태, 허용 도구, 필수 증거, timeout, escalation target을 한 표로 문서화한다."
  - "undefined transition, stuck state, approval bypass, manual override 비율을 주간 KPI로 추적한다."
  - "탐색형 작업과 효과 발생형 작업을 같은 자유형 세션 규칙으로 운영하지 않는다."
learning_refs:
  - title: "Execution Receipt"
    href: "/posts/2026-04-14-execution-receipt-agent-operations-trend/"
    description: "상태 전이마다 어떤 증거를 남겨야 하는지 연결됩니다."
  - title: "Escalation Policy Ladder"
    href: "/posts/2026-04-18-escalation-policy-ladder-agent-runtime-trend/"
    description: "상태가 막히거나 리스크가 커질 때 어디로 승격할지 이어집니다."
  - title: "Deterministic Replay + Flight Recorder"
    href: "/posts/2026-03-31-deterministic-replay-flight-recorder-trend/"
    description: "실패 상태를 다시 재현 가능한 운영 구조와 맞닿습니다."
---

요즘 개발 커뮤니티 흐름을 보면 꽤 선명한 신호가 겹칩니다. 한쪽에서는 OpenAI가 **SWE-bench Verified가 더 이상 frontier coding capability를 제대로 재지 못한다**고 말합니다. 다른 쪽에서는 LLM 보조 코딩의 핵심을 "결정성"이 아니라 **예측 가능한 결과를 만드는 검증 흐름**으로 봐야 한다는 글이 나옵니다. 또 다른 쪽에서는 AI를 사고 대신 쓰면 안 되고, 사람이 계속 문제 정의와 판단을 소유해야 한다는 이야기가 반복됩니다. 거기에 statecharts처럼 오래된 형식 기법이 다시 주목받습니다. 이 흐름들을 따로 보면 각각 벤치마크, 철학, 모델 특성, 설계 기법처럼 보이지만, 실제로는 한 방향을 가리킵니다. **자유형 채팅은 좋은 생성 인터페이스일 수 있어도, 반복 가능한 운영 계약은 아니라는 점**입니다.

그래서 최근 성숙한 팀들이 만드는 것이 저는 **Workflow State Contract**라고 봅니다. 이건 에이전트를 상태기계처럼 딱딱하게 만들자는 말이 아닙니다. 대신 프로덕션에 영향이 있는 워크플로에서는 `어떤 상태에서`, `어떤 도구를 쓸 수 있고`, `무슨 증거가 있어야`, `누구에게 승격하며`, `어떤 조건이면 멈추거나 롤백하는지`를 명시적으로 고정하자는 뜻에 가깝습니다. 이 흐름은 [Execution Receipt](/posts/2026-04-14-execution-receipt-agent-operations-trend/), [Escalation Policy Ladder](/posts/2026-04-18-escalation-policy-ladder-agent-runtime-trend/), [Deterministic Replay + Flight Recorder](/posts/2026-03-31-deterministic-replay-flight-recorder-trend/), [Stateful Sandbox Snapshot](/posts/2026-04-11-stateful-sandbox-snapshot-environment-replay-trend/), [Test Evidence Pipeline](/posts/2026-04-10-test-evidence-pipeline-ai-change-review-trend/)과 자연스럽게 이어집니다. 전부 다른 말처럼 들리지만, 결국 공통 질문은 같습니다. **이 실행은 어디까지 허용되고, 어떻게 다음 단계로 넘어가며, 실패했을 때 무엇을 근거로 되돌릴 수 있는가?**

## 이 글에서 얻는 것

- 왜 모델의 비결정성을 없애려 하기보다 상태 전이와 검증 조건을 고정하는 편이 더 실용적인지 설명할 수 있습니다.
- 벤치마크 점수, 데모 성능, 실제 운영 품질이 왜 다른 층위인지 구분할 수 있습니다.
- Workflow State Contract에 어떤 필드를 넣어야 실무에서 throughput과 안전성을 같이 챙길 수 있는지 기준을 잡을 수 있습니다.
- 탐색형 AI 사용과 효과 발생형 운영 워크플로를 왜 다르게 관리해야 하는지 이해할 수 있습니다.

## 핵심 개념/이슈

### 1) 지금 중요한 것은 결정성보다 예측 가능성이다

LLM 보조 코딩과 에이전트 실행에서 같은 입력이 항상 같은 중간 과정을 만들 거라고 기대하는 건 현실적이지 않습니다. 하지만 그게 곧 운영이 불가능하다는 뜻은 아닙니다. 실제로 인간 개발도 완전히 결정적이지 않습니다. 중요한 건 "누가 같은 코드를 썼는가"가 아니라 **결과를 신뢰할 수 있는 경로가 있는가**입니다.

그래서 성숙한 팀은 생성 과정 전체를 통제하려 하기보다, **비결정적인 생성 코어를 예측 가능한 상태 전이 안에 넣습니다.** 예를 들어 초안 생성 단계에서는 자유도가 높아도 괜찮지만, 승인 요청 단계에서는 필수 증거가 없으면 다음 상태로 못 넘어가게 합니다. 이 관점은 [Deterministic Replay + Flight Recorder](/posts/2026-03-31-deterministic-replay-flight-recorder-trend/)가 장애 재현을 다루는 방식과 닮아 있습니다. 모든 실행을 미리 완벽하게 예측하는 대신, 재현과 검증이 가능한 경로를 먼저 설계하는 것입니다.

### 2) 벤치마크 포화는 곧 워크플로 계약의 중요성을 키운다

SWE-bench Verified 논의가 흥미로운 이유는 점수가 의미 없다는 선언이 아니라, **리더보드가 실제 운영 능력을 충분히 대변하지 못한다는 사실이 더 또렷해졌기 때문**입니다. 테스트가 정답을 잘못 거부하거나, 훈련 오염으로 점수가 올라가거나, 문제 서술과 검증이 어긋나면 높은 점수는 멋져 보여도 운영 설계에는 바로 못 씁니다.

이 지점에서 팀이 해야 할 일은 "더 좋은 벤치마크가 나오길 기다리는 것"만이 아닙니다. 각 팀의 실제 작업 분포를 따라가는 **로컬 상태 계약**을 먼저 만들어야 합니다. 예를 들면 문서 수정, 코드 변경, 인프라 변경, 외부 전송, 데이터 수정은 전부 다른 종료 조건을 가져야 합니다. 벤치마크는 capability 힌트일 뿐이고, 실제 운영 품질은 결국 **우리 워크플로에서 상태가 올바르게 전이되는가**로 드러납니다. 이 부분은 [Synthetic Replay + Eval Gate](/posts/2026-04-20-synthetic-replay-eval-gate-trend/)와도 이어집니다. 공개 벤치마크보다 실제 작업 재생이 더 중요해지는 이유가 같습니다.

### 3) statechart 사고방식은 에이전트 운영에서 surprisingly 잘 맞는다

statecharts가 다시 언급되는 이유도 여기에 있습니다. 에이전트 워크플로는 이미 상태기계처럼 움직이고 있는데, 문제는 대부분 **숨겨진 상태로 구현돼 있다**는 점입니다. 예를 들어 한 세션 안에 아래 상태가 뒤섞여 있곤 합니다.

- 요구 해석 중인지
- 조사 완료 상태인지
- 수정 초안이 있는지
- 테스트가 끝났는지
- 승인 대기인지
- 외부 영향 액션이 허용됐는지
- 실패 후 재시도 중인지
- 롤백 가능 상태인지

이걸 자유형 대화에만 묻어 두면 세션은 길어질수록 불안정해집니다. 반대로 상태를 꺼내 문서화하면 얻는 게 많습니다.

- entry 조건이 명확해진다.
- exit rule이 생긴다.
- 허용 툴 범위가 쉬워진다.
- exceptional path를 따로 다룰 수 있다.
- QA, 운영자, 리뷰어가 같은 다이어그램을 볼 수 있다.

즉 statechart를 도입한다는 말은 시각화 욕심이 아니라, **운영자가 세션의 숨은 상태를 더 이상 추측하지 않게 만드는 것**에 가깝습니다.

### 4) 인간은 모든 단계가 아니라 판단 노드를 소유해야 한다

AI를 잘 쓰는 팀과 못 쓰는 팀의 차이는 사람을 빼느냐 넣느냐보다, **사람이 어디를 계속 소유하느냐**에서 갈립니다. AI가 초안, 보일러플레이트, 테스트 스캐폴드, 요약을 처리하게 하는 건 좋습니다. 하지만 문제 정의, 리스크 분류, irreversible action 승인, 외부 영향 판단은 여전히 사람 또는 명시된 책임자가 소유해야 합니다.

이때 Workflow State Contract가 유용한 이유는 사람을 모든 단계에 세우지 않아도 되기 때문입니다. 예를 들어 아래처럼 나눌 수 있습니다.

- `explore` 상태: 자유 탐색, 사람 승인 불필요
- `propose` 상태: 변경 초안 작성, evidence requirement 시작
- `validate` 상태: 테스트·정책·링크 검증 필수
- `approve` 상태: 삭제, 배포, 외부 전송 등 high-risk action만 사람 소유
- `apply` 상태: 허용 범위 안에서만 실행
- `observe` 상태: 결과 관찰, rollback readiness 확인

이 구조는 [Escalation Policy Ladder](/posts/2026-04-18-escalation-policy-ladder-agent-runtime-trend/)와 아주 잘 맞습니다. 사람이 모든 걸 직접 하는 게 아니라, **정말 책임이 필요한 상태 전이만 사람 쪽으로 모으는 것**입니다.

### 5) 상태 계약이 없으면 숨은 실패가 반복된다

현장에서 진짜 위험한 건 한 번의 큰 실수만이 아닙니다. 더 흔한 문제는 아래처럼 반복되는 작은 운영 부채입니다.

- 승인 없이 다음 단계로 넘어가는 bypass
- 이미 실패한 상태에서 같은 전략을 3~4번 재시도
- evidence가 부족한데 apply 단계로 진입
- rollback 경로 없이 외부 효과 발생
- 오래된 context를 들고 계속 실행하는 zombie session
- 조사 상태와 실행 상태가 섞여 blast radius가 커짐

이런 문제는 모델이 더 똑똑해지면 저절로 사라지지 않습니다. 오히려 모델이 강해질수록 freeform 세션이 더 멀리 갈 수 있어, 상태 계약이 없으면 사고 반경이 커질 수 있습니다. 그래서 좋은 팀은 자유도를 줄이는 게 아니라, **효과 발생 구간의 상태 경계만 더 단단하게 만듭니다.**

## 실무 적용

### 1) 최소 Workflow State Contract 스키마

처음부터 거대한 런타임을 만들 필요는 없습니다. 아래 7필드만 있어도 상당히 쓸 만합니다.

| 필드 | 의미 | 예시 |
| --- | --- | --- |
| `state` | 현재 단계 | `explore`, `validate`, `approve`, `apply` |
| `entry_criteria` | 진입 조건 | issue id 존재, 작업 범위 명시, 대상 리소스 확정 |
| `allowed_actions` | 허용 도구/행동 | read only, test only, write allowed, external send blocked |
| `required_evidence` | 다음 단계 전 필수 증거 | diff, test log, link check, rollback plan |
| `exit_rule` | 다음 상태로 넘어가는 조건 | tests pass, evidence completeness 100%, approval ref 존재 |
| `escalation_target` | 막히거나 위험할 때 올릴 곳 | validator, reviewer, owner, specialist runtime |
| `timeout_policy` | 머무를 수 있는 시간 | 10분 무응답 시 stuck, 30분 초과 시 replan |

이 표가 있으면 운영자는 세션 로그 전체를 읽지 않고도 상태를 판단할 수 있습니다. 반대로 이 표가 없으면 모든 문제를 대화 맥락 속에서 재해석해야 합니다.

### 2) 추천 상태 예시: effectful 작업은 최소 6단계로 나누는 편이 안전하다

저는 코드 수정이나 운영 변경처럼 실제 효과가 있는 작업은 아래 정도로 나누는 편을 권합니다.

1. **Intake**: 목표, 범위, 금지사항 고정
2. **Explore**: 읽기·조사·재현, 쓰기 금지
3. **Propose**: 수정안 또는 실행안 작성
4. **Validate**: 테스트, 링크, 정책, blast radius 확인
5. **Approve**: high-risk 작업만 사람 또는 owner 승인
6. **Apply/Observe**: 실행 후 결과 확인, rollback readiness 점검

중요한 건 상태 수가 아니라, `explore`와 `apply`를 같은 규칙으로 두지 않는 것입니다. 많은 사고가 여기서 시작합니다.

### 3) KPI는 자동화율보다 상태 품질을 먼저 봐야 한다

실무에서는 아래 지표를 먼저 잡는 편이 좋습니다.

- `undefined_transition_rate`: 정의되지 않은 상태 이동 비율, 목표 **1% 이하**
- `stuck_state_p95`: 한 상태에 비정상적으로 오래 머무는 시간, 목표 **10분 이하**
- `approval_bypass_rate`: 승인 필요 상태를 건너뛴 비율, 목표 **0건**
- `manual_override_rate`: 사람이 상태를 강제로 바꾼 비율, 목표 **5~15%** 범위에서 관찰
- `evidence_completeness_before_apply`: apply 진입 전 필수 증거 충족률, 목표 **95% 이상**
- `rollback_ready_coverage`: 외부 효과 작업 중 되돌리기 경로가 명시된 비율, 목표 **90% 이상**

여기서 manual override는 무조건 낮을수록 좋은 지표가 아닙니다. 0%면 상태 모델이 현실을 못 따라가고 있다는 뜻일 수 있습니다. 반대로 30%를 넘으면 계약이 느슨하거나 과도하게 복잡한 경우가 많습니다.

### 4) 도입 우선순위는 모든 세션이 아니라 위험한 플로우부터

처음부터 전체 개발 흐름에 state contract를 붙이면 반발이 큽니다. 대신 아래 순서가 현실적입니다.

- 1순위: 외부 전송, 배포, 데이터 수정, 권한 변경
- 2순위: 코드 수정 + 테스트 + PR 생성
- 3순위: 장시간 조사/디버깅 세션
- 4순위: 문서/리서치 같은 low-risk 작업

이렇게 가면 팀은 먼저 **복구 비용이 큰 작업의 예측 가능성**을 올릴 수 있습니다. throughput에 미치는 불만도 적고, 운영 KPI 개선도 빨리 보입니다.

### 5) 2주 파일럿으로 시작하는 방법

**1~2일차**  
가장 위험한 워크플로 1개를 고르고 상태 5~7개로 쪼갭니다.

**3~4일차**  
각 상태별 허용 액션, 필수 증거, timeout, escalation target을 문서화합니다.

**5~7일차**  
실제 5건 정도를 파일럿으로 돌리며 undefined transition과 stuck state를 기록합니다.

**2주차**  
approval bypass, evidence completeness, manual override를 보며 상태 수를 줄이거나 합칩니다.

이 접근이 좋은 이유는 거대한 플랫폼 투자 없이도, "우리 팀에 필요한 최소 계약이 무엇인지"를 빠르게 드러내 주기 때문입니다.

## 트레이드오프/주의점

상태 계약은 분명 오버헤드가 있습니다. low-risk 작업까지 지나치게 상태화하면 속도가 떨어지고, 사람들이 다시 비공식 세션으로 우회할 수 있습니다. 또 상태 정의가 과하면 실제 일보다 문서가 더 커집니다. 그래서 **탐색형 자유 구간**과 **효과 발생형 통제 구간**을 분리하는 게 중요합니다.

또 하나의 주의점은, state contract가 있으면 운영이 완벽해질 거라는 착각입니다. 아닙니다. 계약은 오류를 없애는 도구가 아니라, **오류를 더 빨리 보이게 하고 더 작게 가두는 도구**에 가깝습니다. 결국 [Execution Receipt](/posts/2026-04-14-execution-receipt-agent-operations-trend/), [Test Evidence Pipeline](/posts/2026-04-10-test-evidence-pipeline-ai-change-review-trend/), [Escalation Policy Ladder](/posts/2026-04-18-escalation-policy-ladder-agent-runtime-trend/)처럼 다른 운영 계층과 같이 움직여야 효과가 납니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 프로덕션 영향 워크플로마다 상태, 허용 액션, 필수 증거, timeout이 문서화돼 있다.
- [ ] `explore`와 `apply`가 같은 권한 규칙을 쓰지 않는다.
- [ ] approval bypass와 undefined transition을 별도 KPI로 본다.
- [ ] rollback 경로 없는 작업은 apply 상태 진입을 막는다.
- [ ] 사람은 모든 단계가 아니라 judgment node를 소유한다.

### 연습 과제

1. 현재 팀에서 AI가 관여하는 작업 3개를 적고, 각 작업을 `explore → propose → validate → approve/apply` 상태로 단순화해 보세요. 어디서 권한과 증거 규칙이 섞이는지 빠르게 드러납니다.  
2. 최근 한 번 삐끗했던 자동화나 운영 실수를 골라, 그 사고가 사실은 "잘못된 상태 전이"였는지 다시 적어 보세요. 원인이 모델 품질보다 계약 부재인 경우가 꽤 많습니다.  
3. 승인 필요 작업 하나를 골라 `required_evidence`를 4개 이하로 줄여 보세요. 길고 복잡한 체크리스트보다, apply 전에 꼭 있어야 하는 핵심 증거 3~4개를 고정하는 편이 운영성이 더 좋습니다.

## 출처 링크

### 수집 소스
- https://news.ycombinator.com/
- https://lobste.rs/

### 원문 및 참고
- https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/
- https://statecharts.dev/
- https://blog.vrypan.net/2026/04/23/llm-assisted-coding-is-not-deterministic-does-it-matter/
- https://www.koshyjohn.com/blog/ai-should-elevate-your-thinking-not-replace-it/

## 관련 글

- [Execution Receipt](/posts/2026-04-14-execution-receipt-agent-operations-trend/)
- [Escalation Policy Ladder](/posts/2026-04-18-escalation-policy-ladder-agent-runtime-trend/)
- [Deterministic Replay + Flight Recorder](/posts/2026-03-31-deterministic-replay-flight-recorder-trend/)
- [Stateful Sandbox Snapshot](/posts/2026-04-11-stateful-sandbox-snapshot-environment-replay-trend/)
- [Test Evidence Pipeline](/posts/2026-04-10-test-evidence-pipeline-ai-change-review-trend/)
