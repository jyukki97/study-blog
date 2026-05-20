---
title: "2026 개발 트렌드: Policy Exception Ledger, AI 자동화 예외 승인을 만료되는 운영 기록으로 관리하는 팀이 빨라진다"
date: 2026-05-20
draft: false
tags: ["AI Agents", "Governance", "Policy", "Developer Tools", "Platform Engineering", "Risk Management"]
categories: ["Development", "AI", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["policy exception ledger", "AI agent governance", "approval ledger", "agent policy exception", "developer platform governance"]
description: "AI 에이전트와 자동화 도구가 많아질수록 정책 예외 승인을 채팅 합의가 아니라 만료일, 근거, 영향 범위, 재검토 조건을 가진 ledger로 관리해야 하는 이유와 실무 기준을 정리합니다."
lastmod: 2026-05-20
summary: "AI 에이전트 운영에서 예외 승인은 점점 늘어납니다. 문제는 예외 자체가 아니라 누가, 어떤 근거로, 언제까지 허용했는지 사라지는 것입니다. Policy Exception Ledger는 예외를 임시 권한, 승인 증거, 만료 조건, 사후 검토가 붙은 운영 기록으로 다루는 흐름입니다."
key_takeaways:
  - "AI 자동화의 정책 예외는 채팅 승인이나 구두 합의가 아니라 만료되는 ledger 항목으로 남아야 한다."
  - "예외에는 scope, owner, expiry, evidence, compensating control, review trigger가 필요하다."
  - "도입은 모든 정책을 막는 방식보다 shadow mode, 제한된 예외, 자동 만료 순서가 안전하다."
operator_checklist:
  - "예외 생성 시 정책 ID, 영향 범위, 승인자, 만료일, 보완 통제를 필수 필드로 둔다."
  - "만료 7일 전 재검토 알림과 만료 후 자동 차단 또는 축소 동작을 정의한다."
  - "PR 병합, 배포, 외부 전송, 권한 상승 같은 고위험 작업은 예외 ledger 누락 시 승인 대기로 둔다."
decision_guide:
  title: "Policy Exception Ledger를 언제 도입할까"
  intro: "정책을 만들기 시작한 팀은 곧 예외도 만들게 됩니다. 예외가 채팅방에 흩어지는 순간 정책은 운영 기준이 아니라 분위기가 됩니다."
  cases:
    - badge: "즉시 도입"
      title: "AI 에이전트가 배포, PR, 브라우저 작업, 외부 SaaS 조작을 수행하는 팀"
      fit: "정책 예외가 자주 필요하고, 예외가 실제 외부 효과로 이어질 수 있다."
      watchouts: "예외를 영구 권한처럼 남기면 정책보다 예외가 더 강해진다."
      next_step: "정책 ID, scope, expiry, evidence 4개 필드부터 예외 ledger를 만든다."
    - badge: "부분 도입"
      title: "repo-local policy나 review gate를 막 도입한 팀"
      fit: "초기에는 오탐과 누락이 많아 예외가 필요하다."
      watchouts: "예외 사유를 남기지 않으면 어떤 정책을 고쳐야 하는지 모른다."
      next_step: "shadow mode 결과와 승인 예외를 같은 task id로 연결한다."
    - badge: "보류"
      title: "개인 실험처럼 정책 위반이 외부 효과로 이어지지 않는 환경"
      fit: "ledger 운영 비용이 더 클 수 있다."
      watchouts: "팀 단위로 확대되는 순간 과거 예외 습관이 그대로 위험이 된다."
      next_step: "예외가 필요한 작업 유형과 금지 작업 목록만 먼저 적어 둔다."
learning_refs:
  - title: "Review Ops"
    href: "/posts/2026-04-23-review-ops-unified-human-gate-trend/"
    description: "코드 리뷰, AI 승인, 보안 예외를 하나의 운영 인박스로 모으는 흐름입니다."
  - title: "Capability Lease"
    href: "/posts/2026-04-13-capability-lease-expiring-agent-permissions-trend/"
    description: "권한을 영구 역할이 아니라 만료되는 작업 권한으로 다루는 방식입니다."
  - title: "Execution Receipt"
    href: "/posts/2026-04-14-execution-receipt-agent-operations-trend/"
    description: "승인과 실제 실행 효과를 검증 가능한 영수증으로 남기는 패턴입니다."
faqs:
  - question: "예외를 ledger로 남기면 개발 속도가 느려지지 않나요?"
    answer: "처음에는 입력 항목이 늘지만, 반복 질문과 사후 추적 비용이 줄어듭니다. 특히 같은 예외가 반복될 때 정책을 고칠지, 도구를 고칠지 판단할 근거가 생깁니다."
  - question: "모든 정책 위반을 차단해야 하나요?"
    answer: "아닙니다. 초기에는 shadow mode로 관찰하고, 외부 효과나 보안 영향이 큰 항목만 승인형 예외로 올리는 편이 현실적입니다."
  - question: "예외 만료 후에는 자동으로 막아야 하나요?"
    answer: "위험도에 따라 다릅니다. 고위험 권한 상승은 자동 차단이 맞고, 낮은 위험의 문서/테스트 예외는 알림 후 재검토로 충분할 수 있습니다."
---

AI 에이전트와 자동화 도구를 팀에 붙이면 정책이 빠르게 늘어납니다. 어떤 저장소에서는 에이전트가 테스트 없이 PR을 만들면 안 되고, 어떤 작업은 브라우저 쓰기 action 전에 승인이 필요하고, 어떤 외부 API는 allowlist를 지나야 합니다. 문제는 정책을 만드는 순간 예외도 같이 생긴다는 점입니다. "이번 한 번만 배포", "이 SaaS는 오늘만 허용", "테스트가 flaky라서 이 PR만 통과" 같은 예외는 현실적으로 필요합니다.

하지만 예외가 채팅 메시지와 구두 합의에 흩어지면 정책은 금방 약해집니다. 한 달 뒤에는 누가 허용했는지, 언제까지였는지, 어떤 보완 통제가 있었는지, 왜 아직 남아 있는지 알 수 없습니다. 그래서 중요해지는 흐름이 **Policy Exception Ledger**입니다. 정책 예외를 단순 승인 버튼이 아니라 `policy_id`, `scope`, `owner`, `expiry`, `evidence`, `compensating_control`, `review_trigger`를 가진 운영 기록으로 다루는 방식입니다. 이 흐름은 [Review Ops](/posts/2026-04-23-review-ops-unified-human-gate-trend/), [Capability Lease](/posts/2026-04-13-capability-lease-expiring-agent-permissions-trend/), [Execution Receipt](/posts/2026-04-14-execution-receipt-agent-operations-trend/), [Policy Shadow Rollout](/posts/2026-04-19-policy-shadow-rollout-agent-runtime-trend/)과 이어집니다. 좋은 거버넌스는 예외를 없애는 것이 아니라, 예외가 정책을 삼키지 못하게 만료시키는 것입니다.

## 이 글에서 얻는 것

- AI 자동화 환경에서 정책 예외가 왜 빠르게 기술 부채가 되는지 이해할 수 있습니다.
- 예외 승인에 필요한 최소 필드와 만료 조건, 재검토 트리거를 설계할 수 있습니다.
- shadow mode, 승인형 예외, 자동 만료를 어떤 순서로 적용할지 판단할 수 있습니다.
- 개발 속도를 막지 않으면서도 위험한 예외가 영구 권한으로 굳지 않게 운영 기준을 세울 수 있습니다.

## 핵심 개념/이슈

### 1) 정책보다 예외가 더 빨리 늘어난다

정책은 대개 좋은 의도로 시작합니다. 에이전트가 운영 DB에 직접 접근하지 못하게 하고, 외부 전송 전 승인을 요구하고, 대규모 변경에는 테스트 증거를 붙이게 합니다. 하지만 현실의 작업은 늘 예외를 만듭니다. 긴급 장애 대응, flaky test, 미지원 도구, 새로운 SaaS 연동, 마이그레이션 기간처럼 정상 정책을 그대로 적용하기 어려운 상황이 생깁니다.

문제는 예외가 사라지지 않는다는 점입니다. Slack이나 Discord에 "오늘만 허용"이라고 적었지만, 실제 권한은 계속 남아 있을 수 있습니다. PR 코멘트에 "이번만 테스트 생략"이라고 했지만, 다음 PR에서도 같은 말이 반복될 수 있습니다. 에이전트가 egress 차단을 우회하도록 허용했는데, 어떤 도메인까지 허용했는지 기록이 없을 수도 있습니다.

그래서 예외는 아래 질문에 답해야 합니다.

- 어떤 정책을 예외 처리했는가?
- 영향 범위는 repo, service, user, agent, environment 중 어디까지인가?
- 누가 승인했고 누가 소유자인가?
- 언제 자동 만료되는가?
- 예외 기간 동안 어떤 보완 통제가 있는가?
- 예외가 반복되면 정책을 고쳐야 하는가, 작업 방식을 고쳐야 하는가?

이 질문에 답하지 못하면 예외는 임시 조치가 아니라 숨은 기본값이 됩니다.

### 2) Ledger는 승인 기록과 실행 증거를 연결한다

Policy Exception Ledger는 단순 목록이 아닙니다. 예외 승인과 실제 실행 증거를 연결해야 합니다. 예를 들어 에이전트가 외부 SaaS 콘솔에서 설정을 바꿔야 하는데 기본 정책은 브라우저 commit action을 막고 있다고 합시다. 이때 ledger에는 "브라우저 쓰기 허용"이라는 짧은 문장만 남기면 부족합니다.

최소 필드는 아래 정도가 현실적입니다.

```yaml
exception_id: pex_20260520_001
policy_id: browser.commit.requires_approval
scope: repo:billing-service, env:staging, domain:console.vendor.example
requester: agent-run-4821
owner: platform-oncall
approver: security-reviewer-7
expires_at: 2026-05-21T18:00:00+09:00
evidence_required: [screenshot_before, screenshot_after, execution_receipt]
compensating_control: read-only API token, staging only, max 3 commit actions
status: ACTIVE
```

이 구조가 있으면 [Execution Receipt](/posts/2026-04-14-execution-receipt-agent-operations-trend/)와 연결할 수 있습니다. 승인만 있고 실행 증거가 없으면 완료 처리하지 않고, 실행은 됐지만 예외 ledger가 없으면 사후 감사 대상이 됩니다. 예외는 허용의 기록이면서 동시에 책임 경계입니다.

### 3) 예외에는 반드시 만료일이 있어야 한다

가장 위험한 예외는 "일단 열어두자"입니다. 권한과 정책 예외는 시간이 지나면 맥락을 잃습니다. 승인자는 팀을 옮기고, 작업자는 기억하지 못하고, 원래 장애는 해결됐는데 예외만 남습니다. 그래서 예외에는 기본 만료일이 필요합니다.

출발 기준은 아래처럼 잡을 수 있습니다.

| 예외 유형 | 예시 | 기본 만료 |
| --- | --- | ---: |
| flaky test 일시 우회 | 특정 테스트 1개 skip | 24~72시간 |
| 외부 도메인 egress 허용 | 문서/패키지 저장소 접근 | 7~14일 |
| 브라우저 commit action 허용 | staging 콘솔 설정 변경 | 1~3일 |
| 운영 권한 상승 | prod read/write, secret 접근 | 1~8시간 |
| 정책 shadow mode 예외 | 신규 정책 오탐 관찰 | 2~4주 |

만료일은 예외의 위험과 복구 비용으로 정합니다. 운영 쓰기 권한은 짧게, 정책 튜닝을 위한 shadow 예외는 조금 길게 둘 수 있습니다. 중요한 것은 만료 전 재검토 알림과 만료 후 동작입니다. 고위험 예외는 자동 차단, 중위험 예외는 read-only 축소, 저위험 예외는 owner에게 재검토 티켓을 만드는 식으로 나눌 수 있습니다.

### 4) 예외 사유는 정책 개선 데이터다

예외를 부끄러운 우회로만 보면 팀은 기록을 숨깁니다. 반대로 예외를 정책 개선 데이터로 보면 운영 품질이 좋아집니다. 같은 정책이 매주 10번 이상 예외를 만든다면 둘 중 하나입니다. 정책이 너무 엄격하거나, 도구와 워크플로가 정책을 지킬 수 있게 설계되지 않은 것입니다.

그래서 ledger에는 reason code가 필요합니다.

- `POLICY_FALSE_POSITIVE`: 정책이 정상 작업을 잘못 막음
- `TOOLING_GAP`: 정책을 지킬 도구가 없음
- `URGENT_INCIDENT`: 긴급 장애 대응
- `LEGACY_SYSTEM`: 오래된 시스템이 기준을 만족하지 못함
- `BUSINESS_DEADLINE`: 외부 일정으로 임시 허용
- `RISK_ACCEPTED`: 위험을 인지하고 제한적으로 수용

월간 리뷰에서는 예외 개수보다 반복 패턴을 봐야 합니다. 같은 `TOOLING_GAP`이 5회 이상이면 플랫폼 작업 후보입니다. 같은 owner가 만료 연장을 3회 이상 요청하면 임시 예외가 아니라 정식 정책 변경 검토 대상입니다. 고위험 예외가 승인 후 실행 증거를 남기지 않았다면 예외 프로세스 자체를 강화해야 합니다.

### 5) 에이전트 정책은 repo-local 규칙과 중앙 ledger가 같이 필요하다

요즘 팀은 저장소별로 AI 에이전트 작업 규칙을 두기 시작했습니다. 어떤 repo는 생성 코드에 테스트를 요구하고, 어떤 repo는 마이그레이션 파일을 사람이 직접 검토해야 하며, 어떤 repo는 특정 디렉터리 수정을 금지합니다. 이 흐름은 [Repo-local Agent Policy](/posts/2026-05-17-repo-local-agent-policy-trend/)와 맞닿아 있습니다.

하지만 예외 ledger는 repo 안에만 두기 어렵습니다. 예외는 여러 repo, 여러 agent, 여러 SaaS 권한을 가로지를 수 있기 때문입니다. 좋은 구조는 repo-local policy가 "무엇을 막을지" 정의하고, 중앙 ledger가 "언제 누가 왜 예외를 열었는지" 관리하는 방식입니다. agent runtime은 작업 전 policy를 읽고, 위반 시 ledger에 활성 예외가 있는지 확인합니다. 활성 예외가 없으면 승인 대기로 멈춥니다.

## 실무 적용

### 1) 처음부터 모든 정책에 ledger를 붙이지 않는다

도입 순서는 위험도 기준이 좋습니다. 모든 lint 예외, 모든 작은 테스트 예외까지 처음부터 ledger에 넣으면 팀이 지칩니다. 먼저 외부 효과가 있거나 복구가 어려운 예외부터 시작합니다.

우선순위는 아래 순서가 현실적입니다.

1. 운영 환경 권한 상승
2. 외부 메시지·게시·전송
3. 배포·릴리스 차단 정책 우회
4. 브라우저 commit action 허용
5. 네트워크 egress allowlist 예외
6. 테스트·리뷰 증거 누락 예외

이 중 1~4번은 예외 ledger 없이는 실행하지 못하게 하는 편이 안전합니다. 5~6번은 초기에 shadow mode로 관찰하고, 반복되는 항목만 승인형으로 올릴 수 있습니다. [Agent Sandbox Egress Policy](/posts/2026-05-16-agent-sandbox-egress-policy-trend/)처럼 외부 네트워크와 연결되는 정책은 특히 범위와 만료를 좁게 잡아야 합니다.

### 2) 예외 요청 템플릿을 1분 안에 채우게 만든다

템플릿이 길면 사람은 우회합니다. 필수 필드는 짧아야 합니다.

| 필드 | 질문 |
| --- | --- |
| policy_id | 어떤 정책을 예외 처리하는가? |
| scope | 어디까지 허용하는가? repo, env, domain, action |
| reason_code | 왜 필요한가? |
| owner | 누가 만료와 후속 조치를 책임지는가? |
| expires_at | 언제 자동 종료되는가? |
| evidence | 실행 후 무엇을 남겨야 하는가? |
| compensating_control | 대신 어떤 제한을 둘 것인가? |

예외 요청이 1분 안에 작성되지 않는다면 필드가 너무 많거나 정책 ID가 불명확한 것입니다. 반대로 승인자가 판단하기에 정보가 부족하면 scope와 evidence가 빠진 경우가 많습니다. scope는 좁힐수록 승인하기 쉽습니다. "에이전트 외부 네트워크 허용"보다 "staging에서 docs.vendor.example GET만 48시간 허용"이 훨씬 안전합니다.

### 3) 예외를 capability lease와 연결한다

예외가 실제 권한을 열어야 한다면 [Capability Lease](/posts/2026-04-13-capability-lease-expiring-agent-permissions-trend/)와 연결하는 것이 좋습니다. ledger는 승인 기록이고, lease는 런타임이 실제로 검사하는 만료 권한입니다. 둘을 분리하면 "승인됐지만 권한은 안 열림" 또는 "권한은 열렸는데 승인 기록이 없음" 같은 틈이 생깁니다.

운영 기준은 단순하게 둡니다.

- ledger `ACTIVE`일 때만 lease 발급
- lease TTL은 ledger 만료보다 길 수 없음
- scope mismatch가 있으면 실행 차단
- 실행 receipt가 없으면 ledger를 `USED_UNVERIFIED`로 표시
- 만료 후 동일 scope 재요청이 3회 이상이면 정책 리뷰 자동 생성

이 구조는 에이전트에게도 명확합니다. 정책 위반이 발생하면 "무시하고 진행"이 아니라 "예외 ledger가 필요함"으로 상태가 전이됩니다. 사람은 승인하거나 scope를 줄이거나 거절할 수 있습니다.

### 4) 대시보드는 예외 총량보다 만료와 반복을 보여줘야 한다

운영자가 봐야 할 것은 "예외 42개"가 아닙니다. 더 중요한 것은 만료되지 않은 고위험 예외, 반복되는 reason code, owner 없는 예외입니다.

추천 지표는 아래입니다.

- `active_high_risk_exceptions`
- `exceptions_expiring_in_7d`
- `expired_but_still_effective_count`
- `exception_extension_count_by_owner`
- `policy_false_positive_rate`
- `exception_without_receipt_count`
- `repeat_exception_same_scope_30d`

경고 기준도 숫자로 둡니다. 고위험 활성 예외가 0이 아닌 상태로 24시간을 넘기면 플랫폼/보안 리뷰 대상입니다. 만료 후에도 실제 권한이 남은 건수가 1개라도 있으면 P1에 가깝습니다. 같은 scope 예외가 30일 안에 3회 이상 반복되면 임시 예외가 아니라 정책·도구 개선 backlog로 올립니다.


## 운영 시나리오: 예외 요청이 들어왔을 때의 판정 루프

예외 ledger를 실제로 쓰려면 추상 필드보다 판정 루프가 먼저 보여야 합니다. 예를 들어 에이전트가 운영 문서 생성 중 외부 벤더 문서를 가져와야 하는데 기본 sandbox egress 정책이 막고 있다고 합시다. 나쁜 요청은 “인터넷 잠깐 열어 주세요”입니다. 좋은 요청은 “`docs.vendor.example`의 `GET /api/reference/*`를 staging 작업 `task-4821`에서 2시간 동안 허용하고, 다운로드 결과 hash와 실행 receipt를 남기겠습니다”처럼 좁습니다. 같은 예외라도 후자는 승인자가 위험을 읽을 수 있고, 만료 뒤 자동 회수도 가능합니다.

실무 판정은 네 단계로 나누는 편이 안전합니다. 첫째, 정책 위반이 진짜 예외인지 확인합니다. 정책이 오탐인지, 작업 정의가 과도한지, 이미 허용된 표준 경로가 있는지 먼저 봅니다. 둘째, scope를 줄입니다. repo 전체, 모든 브랜치, 모든 도메인, 모든 action 같은 표현이 나오면 승인 전에 env, actor, domain, command, duration 중 최소 두 가지 이상을 좁힙니다. 셋째, 보완 통제를 붙입니다. 읽기 전용 네트워크 허용이면 다운로드 hash와 출처 URL을 남기고, 브라우저 쓰기 action이면 사전 스크린샷과 사후 execution receipt를 남기는 식입니다. 넷째, 만료 이후 학습 루프를 만듭니다. 같은 예외가 반복되면 다음에도 승인할지가 아니라 정책/도구/문서 중 무엇을 고칠지 결정해야 합니다.

간단한 판정표는 아래처럼 운영할 수 있습니다.

| 질문 | 승인 쪽 신호 | 보류/축소 쪽 신호 |
| --- | --- | --- |
| 작업 범위가 좁은가? | 단일 task, 단일 repo, 단일 env로 제한된다. | “전체”, “일단”, “잠깐”처럼 범위가 흐리다. |
| 실패 시 되돌릴 수 있는가? | dry-run, staging, read-only, rollback path가 있다. | 운영 데이터 변경, 결제/권한/삭제처럼 외부 효과가 크다. |
| 증거가 남는가? | receipt, artifact, 로그 hash, 승인자 기록이 연결된다. | 채팅 승인만 있고 실행 결과를 나중에 찾기 어렵다. |
| 만료가 강제되는가? | lease TTL과 ledger expiry가 함께 닫힌다. | calendar reminder만 있고 실제 권한은 계속 남는다. |

이 판정표의 장점은 승인자가 “느낌상 괜찮다”가 아니라 같은 기준으로 대화하게 만든다는 점입니다. 특히 AI 에이전트 작업은 요청 문장이 그럴듯해 보이기 쉽기 때문에, scope와 evidence를 구조화하지 않으면 승인 품질이 사람 컨디션에 크게 흔들립니다. 반대로 템플릿이 너무 무거우면 현장은 우회합니다. 그래서 초기에는 고위험 action에만 강제하고, 낮은 위험의 문서/테스트 예외는 자동 기록으로 시작하는 것이 현실적입니다.

## 트레이드오프/주의점

첫째, ledger가 지나치게 무거우면 사람은 더 비공식적인 경로로 갑니다. 그래서 초기에는 고위험 예외만 강제하고, 낮은 위험의 예외는 자동 기록 또는 shadow mode로 시작하는 편이 낫습니다. 거버넌스의 목적은 사람을 막는 것이 아니라 위험한 임시 허용이 영구화되지 않게 만드는 것입니다.

둘째, 예외 ledger가 있다고 모든 승인이 안전해지는 것은 아닙니다. 승인자가 내용을 보지 않고 클릭하면 형식만 남습니다. 그래서 고위험 예외에는 evidence requirement와 실행 후 receipt 검증이 필요합니다. "승인됨"과 "안전하게 완료됨"은 다른 상태입니다.

셋째, 예외 사유에는 민감한 정보가 들어갈 수 있습니다. 보안 취약점, 고객 영향, 내부 시스템 이름, 공급업체 계약 정보가 포함될 수 있으므로 접근 제어가 필요합니다. ledger 자체도 운영 자산입니다. 공개 PR 코멘트에 모든 예외 세부사항을 남기는 방식은 피하고, 공개 가능한 요약과 내부 상세 기록을 분리하세요.

넷째, 만료 자동 차단은 장애를 만들 수 있습니다. 운영 장애 대응 중 권한이 갑자기 닫히면 복구가 늦어질 수 있습니다. 그래서 고위험 권한은 짧게 열되 만료 전 알림을 강하게 보내고, incident 모드에서는 별도 break-glass 절차를 둡니다. 단, break-glass도 ledger 밖이면 안 됩니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] 정책 위반 발생 시 예외 요청, 거절, scope 축소, 승인 대기 상태가 명확하다.
- [ ] 예외에는 policy id, scope, owner, approver, reason code, expiry가 반드시 들어간다.
- [ ] 고위험 예외는 execution receipt 또는 artifact evidence 없이는 완료 처리되지 않는다.
- [ ] lease나 실제 권한 TTL이 ledger 만료보다 길지 않다.
- [ ] 만료 7일 전 또는 위험도별 사전 알림이 있다.
- [ ] 만료 후에도 권한이 남은 예외를 탐지하는 지표가 있다.
- [ ] 반복 예외를 정책 개선 backlog로 넘기는 기준이 있다.

### 연습

1. 현재 팀의 AI/자동화 정책을 5개 적고, 그중 예외가 가장 자주 생길 정책을 하나 고르세요. 예외가 필요한 이유를 `POLICY_FALSE_POSITIVE`, `TOOLING_GAP`, `URGENT_INCIDENT`, `LEGACY_SYSTEM`, `BUSINESS_DEADLINE`, `RISK_ACCEPTED` 중 하나로 분류해 봅니다.
2. "staging 콘솔에서 설정 저장 버튼을 1회 눌러야 하는 에이전트 작업"에 대한 예외 ledger 항목을 작성해 보세요. scope를 넓게 쓰지 말고 domain, env, action, TTL을 좁게 잡는 것이 목표입니다.
3. 지난 30일의 예외 요청이 있다고 가정하고, 같은 scope가 3회 이상 반복된 항목을 찾아 정책 변경 후보와 도구 개선 후보로 나눠 보세요.
4. 고위험 예외가 만료된 뒤에도 실제 권한이 남아 있는지 확인하는 쿼리나 점검 절차를 설계해 보세요. ledger와 권한 시스템을 대조하는 것이 핵심입니다.

Policy Exception Ledger의 목표는 정책을 엄격하게 보이게 만드는 것이 아닙니다. 현실의 예외를 인정하되, 예외가 누적되어 기본 정책을 무력화하지 않게 하는 것입니다. AI 에이전트가 더 많은 도구와 권한을 다룰수록 팀의 차이는 "얼마나 많은 자동화를 허용했는가"보다 **임시 허용을 얼마나 빨리 회수하고 학습으로 바꾸는가**에서 납니다.
