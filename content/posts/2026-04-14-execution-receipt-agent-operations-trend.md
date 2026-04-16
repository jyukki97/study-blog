---
title: "2026 개발 트렌드: Execution Receipt, 에이전트 자동화는 로그가 아니라 검증 가능한 작업 영수증으로 넘어간다"
date: 2026-04-14
draft: false
tags: ["Execution Receipt", "AI Agent", "Evidence", "Governance", "Auditability", "Platform Engineering"]
categories: ["Development", "Learning"]
series: "2026 에이전트 운영 설계 트렌드"
keywords: ["execution receipt", "agent governance", "agent audit trail", "approval evidence", "운영 영수증", "에이전트 실행 증적"]
description: "에이전트가 실제 쓰기 작업과 운영 액션을 수행하기 시작하면서, 단순 로그만으로는 승인, 권한, 실행, 결과를 설명하기 어려워졌습니다. 최근 팀들이 execution receipt 계층을 두는 이유와 실무 기준을 정리합니다."
key_takeaways:
  - "좋은 감사 체계는 로그를 더 많이 남기는 것이 아니라, 각 액션을 intent, approval, capability, evidence와 묶은 execution receipt로 설명 가능하게 만드는 것이다."
  - "receipt는 사후 포렌식 용도만이 아니라 중복 실행 방지, 승인 범위 초과 탐지, handoff 품질 개선까지 직접 영향을 준다."
  - "실무 핵심 지표는 receipt coverage, unverifiable action rate, approval-to-receipt latency, evidence completeness ratio다."
---

AI 에이전트가 초반에는 읽기 중심으로만 움직일 때는 로그와 트레이스로도 어느 정도 운영이 됩니다. 하지만 문서 수정, 코드 변경, 외부 전송, 배포 트리거처럼 실제 효과가 있는 작업이 늘어나면 곧 질문이 바뀝니다. **누가 실행했는가**보다 **왜 이 액션이 허용됐고, 어떤 승인과 어떤 권한으로, 어떤 입력을 기준으로 실행됐는가**를 설명해야 하기 때문입니다.

문제는 기존 로그 체계가 이 질문에 잘 답하지 못한다는 점입니다. 승인 이벤트는 메시징 시스템에 있고, 세션 컨텍스트는 다른 저장소에 있고, 실제 툴 호출은 런타임 로그에 있고, 변경 결과는 Git 또는 파일 시스템에 있고, 나중에 붙인 증거는 또 다른 대시보드에 흩어집니다. 운영자가 사고 후 30분 안에 알고 싶은 것은 "어느 서비스에서 오류가 났나"만이 아닙니다. **이 액션이 원래 의도와 같은 작업이었나, 범위를 넘었나, 같은 실행이 재시도 중복으로 두 번 발생했나**가 더 중요해집니다.

그래서 최근 성숙한 팀들이 도입하는 것이 execution receipt입니다. 저는 이 흐름이 [Tool Permission Manifest + Runtime Attestation](/posts/2026-04-05-tool-permission-manifest-runtime-attestation-trend/)에서 말한 "원칙적 허용 범위", [Action Lineage Graph](/posts/2026-04-12-action-lineage-agent-observability-graph-trend/)에서 말한 "실행 계보", [Capability Lease](/posts/2026-04-13-capability-lease-expiring-agent-permissions-trend/)에서 말한 "작업 단위 임시 권한" 사이의 빈칸을 메우는 계층이라고 봅니다. manifest가 가능 범위를 정하고, lineage가 연결 관계를 보여주고, lease가 현재 작업의 권한을 제한한다면, receipt는 **이번 액션이 실제로 어떻게 수행됐는지 설명 가능한 단위**를 만듭니다. 실무적으로는 [Execution Receipt 운영 플레이북](/learning/deep-dive/deep-dive-execution-receipt-operations-playbook/)처럼 receipt를 어떤 액션부터 붙이고, 어떤 필드부터 강제하고, 어떤 경보를 먼저 올릴지까지 같이 설계해야 효과가 납니다.

## 이 글에서 얻는 것

- 단순 로그와 trace만으로는 왜 에이전트 운영 설명 가능성이 부족한지 구체적으로 이해할 수 있습니다.
- execution receipt에 어떤 필드가 반드시 들어가야 실무에서 감사, 재시도 방지, 승인 검증에 쓸 수 있는지 기준을 잡을 수 있습니다.
- 외부 전송, 코드 수정, 운영 액션을 어떤 순서로 receipt화해야 투자 대비 효과가 큰지 우선순위를 세울 수 있습니다.

## 핵심 개념/이슈

### 1) execution receipt는 로그를 대체하는 것이 아니라 "행동 단위 설명 레코드"를 추가하는 것이다

로그와 trace는 여전히 필요합니다. 문제는 둘 다 이벤트 흐름은 잘 보여주지만, **행동의 의미와 정당성**을 한 번에 설명하지는 못한다는 점입니다.

예를 들어 에이전트가 저장소 파일 12개를 수정했다고 합시다. 기존 로그에는 다음 정보가 흩어져 있을 가능성이 큽니다.

- 사용자가 어떤 요청을 했는지
- 어느 세션에서 작업했는지
- 어떤 도구를 호출했는지
- 어떤 파일이 바뀌었는지
- 테스트가 통과했는지

하지만 운영자가 실제로 필요한 질문은 더 날카롭습니다.

- 이 수정은 승인된 범위 안이었나
- 원래 intent는 문서 수정이었는데 코드 수정까지 번진 것 아닌가
- 같은 액션이 timeout 뒤 재시도로 한 번 더 실행된 것 아닌가
- handoff 뒤 다른 세션이 이어받으면서 권한과 문맥이 바뀌지 않았나

execution receipt는 이런 질문에 답하기 위해, 액션 1개 또는 논리적 작업 1개를 기준으로 intent, approval, lease, tool input, evidence, effect를 묶은 레코드입니다. 즉 "무슨 로그가 있었나"가 아니라 **"이 행동은 어떤 계약 아래 실행됐고 실제로 무엇을 남겼나"**를 보여주는 단위입니다.

### 2) 최소 receipt 스키마는 생각보다 작아도 되지만, 승인과 결과를 반드시 동시에 묶어야 한다

처음부터 거대한 감사 시스템이 필요한 것은 아닙니다. 다만 아래 필드는 있어야 receipt가 실제로 쓸모가 있습니다.

- `receipt_id`
- `intent_id` 또는 `task_id`
- `subject_id`(에이전트/세션/하위 실행자)
- `approval_ref`
- `capability_lease_ref`
- `tool_action`과 주요 입력 digest
- `resource_scope`(저장소, 경로, 서비스, 환경)
- `expected_effect`
- `actual_effect`
- `evidence_refs`(diff, test result, message id, artifact hash)
- `started_at`, `completed_at`
- `outcome`(success, partial, denied, expired)
- `replay_guard_key` 또는 duplicate suppression key

여기서 특히 중요한 것은 `expected_effect`와 `actual_effect`를 분리하는 것입니다. 승인 당시 의도는 "문서 2개 수정"이었는데 결과가 "문서 2개 + 설정 파일 1개 변경"이라면, receipt가 있어야 범위 초과를 기계적으로 잡을 수 있습니다. 이 구조는 [Test Evidence Pipeline](/posts/2026-04-10-test-evidence-pipeline-ai-change-review-trend/)에서 말한 증거 수집과 자연스럽게 이어집니다.

### 3) 왜 지금 중요해졌나: 긴 세션, 멀티에이전트, 승인 지연이 겹치기 때문이다

단발성 챗봇에서는 receipt가 과할 수 있습니다. 하지만 최근 운영 패턴은 다릅니다.

- 세션이 스레드 또는 프로젝트 단위로 오래 유지됩니다.
- 보조 에이전트가 조사, 수정, 검증을 분담합니다.
- 사람 승인 후 실제 실행까지 몇 분에서 몇 시간의 간격이 생깁니다.
- 실행 환경이 sandbox snapshot이나 checkpoint로 이어집니다.

이 구조에서는 "누가 버튼을 눌렀나"보다 **같은 문맥이 계속 유지되고 있었나**가 더 중요합니다. 그래서 [Harness Engineering](/posts/2026-04-09-harness-engineering-agent-runtime-frame-trend/), [Stateful Sandbox Snapshot](/posts/2026-04-11-stateful-sandbox-snapshot-environment-replay-trend/), [Capability Lease](/posts/2026-04-13-capability-lease-expiring-agent-permissions-trend/) 같은 흐름이 함께 나옵니다. execution receipt는 그 사이에서 "이 시점의 실행"을 잘라 기록하는 역할을 합니다.

즉, receipt가 없으면 lineage는 있어도 각 edge의 의미가 흐리고, lease는 있어도 실제 사용 결과가 설명되지 않고, approval은 있어도 실행 결과와 자동으로 연결되지 않습니다.

### 4) receipt의 가치는 감사보다 운영 안정성에서 먼저 드러난다

많은 팀이 receipt를 compliance나 사후 포렌식용으로만 생각합니다. 그런데 실제로 더 큰 가치는 운영 품질에서 나옵니다.

첫째, **중복 실행 방지**가 쉬워집니다. 동일한 `intent_id + resource_scope + replay_guard_key` 조합이 있으면 timeout 뒤 재시도 시 같은 효과를 한 번 더 내지 않게 막을 수 있습니다.

둘째, **handoff 품질이 올라갑니다.** 다른 세션이나 다른 에이전트가 이어받을 때 "이전까지 무엇이 이미 실행됐고 무엇이 아직 계획 단계인지"를 receipt로 구분할 수 있습니다.

셋째, **범위 초과 감지**가 빨라집니다. 원래 허용 범위보다 많은 파일, 더 넓은 경로, 다른 환경에 영향을 주면 receipt 발급 단계에서 바로 경고를 만들 수 있습니다.

넷째, **사람 검토 UX가 좋아집니다.** 리뷰어는 장문의 로그 대신 intent, diff 요약, evidence 링크, lease 범위, 결과를 한 화면에서 볼 수 있습니다.

즉 receipt는 뒤늦게 보는 감사 레코드가 아니라, **실행 중 판단 품질을 높이는 운영 단위**입니다.

### 5) 핵심 KPI도 자동화율보다 "설명 가능 비율"을 봐야 한다

성숙한 팀은 단순 자동화율보다 아래 숫자를 먼저 보기 시작합니다.

- `receipt_coverage`: 효과가 있는 액션 중 receipt가 생성된 비율
- `unverifiable_action_rate`: 결과는 남았는데 approval 또는 evidence 연결이 안 되는 액션 비율
- `approval_to_receipt_p95`: 승인 이후 실제 receipt 완료까지 걸리는 시간
- `evidence_completeness_ratio`: diff, test, artifact hash, message id 등 필수 evidence가 모두 채워진 비율
- `duplicate_execution_rate`: 동일 intent가 중복 실행된 비율

특히 외부 전송, 운영 변경, 데이터 쓰기 같은 고위험 액션은 coverage가 100%에 가까워야 합니다. 여기서 빠진 액션은 단순 누락이 아니라 **설명 불가능한 실행**입니다.

## 실무 적용

### 1) 어디부터 receipt화할까: 위험도와 복구 난이도로 순서를 정하는 편이 맞다

추천 우선순위는 아래입니다.

1. **외부 전송, 운영 액션, 권한 변경**  
   복구가 어렵고 설명 책임이 큽니다. 가장 먼저 100% receipt를 붙여야 합니다.
2. **코드/문서 쓰기 액션**  
   diff와 테스트 evidence가 연결되기 쉬워 효과가 빠르게 보입니다.
3. **DB 쓰기, 배치 트리거, 환경 설정 변경**  
   의도와 결과 차이를 잡는 데 receipt가 강하게 작동합니다.
4. **읽기 전용 조사 액션**  
   나중에 coverage를 넓힐 때 포함하되, 초기에는 과투자할 필요가 없습니다.

초기 설계 우선순위는 보통 **범위 초과 차단 > 중복 실행 방지 > 리뷰 설명 가능성 > 분석 편의성** 순이 안전합니다.

### 2) 권장 운영 기준(숫자·조건·우선순위)

시작값으로는 아래 정도가 현실적입니다.

- 외부 전송, 운영 변경, 권한 변경 액션: **receipt coverage 100%**
- 로컬 파일 수정, 코드 변경 액션: **95% 이상**
- `unverifiable_action_rate`: **0.1% 미만**
- `approval_to_receipt_p95`: **60초 미만**
- `evidence_completeness_ratio`: **95% 이상**
- `duplicate_execution_rate`: **0.5% 미만**
- receipt 생성 오버헤드: 동기 경로 기준 **p95 150ms 이하**, 그 이상이면 비동기 finalize 검토

추가 조건으로는 아래 정도가 유용합니다.

- 파일 수정이 **10개 초과**이거나 환경 영향 범위가 **1개 이상 서비스**로 넓어지면 hierarchical receipt 또는 재승인 요구
- approval 후 **10분 이상** 실행이 지연되면 기존 receipt draft 폐기 후 context 재검증
- lease가 만료되었는데 actual effect가 발생하면 무조건 실패 receipt와 경보 생성

이 숫자는 절대값이 아니라 출발점입니다. 중요한 것은 속도보다 **설명 불가능한 액션을 먼저 없애는 것**입니다.

### 3) receipt 발급 파이프라인 예시

실무에서는 아래 흐름이 가장 단순합니다.

1. 사용자의 요청이나 자동 정책이 `intent`를 만든다.
2. approval과 capability lease가 있으면 intent에 연결한다.
3. 실제 tool action 직전 `receipt draft`를 발급한다.
4. 실행 중 생성된 diff, 로그 요약, 테스트 결과, 메시지 id를 evidence로 수집한다.
5. 실행 완료 시 `actual_effect`를 계산해 draft를 finalize한다.
6. finalized receipt를 lineage graph, 검색 인덱스, 감사 저장소에 동시 반영한다.

이 구조의 장점은 실패도 receipt로 남는다는 점입니다. denied, expired, partial success도 다 기록해야 나중에 왜 중단됐는지 설명할 수 있습니다. 성공만 남기면 운영 데이터가 왜곡됩니다.

### 4) receipt는 어디까지 자동 생성하고, 어디서 사람이 개입해야 할까

현장에서 자주 나오는 오해는 receipt를 전부 사람이 정리해야 한다는 생각입니다. 실제로는 반대로 가는 편이 맞습니다. **draft는 런타임이 자동 생성하고, 사람이 보는 것은 예외와 위험 신호만 남기는 구조**가 운영 비용이 훨씬 낮습니다.

권장 분리는 아래와 같습니다.

- 런타임 자동 생성: receipt_id, tool_action, started_at, completed_at, resource_scope, evidence_refs
- 정책 엔진 자동 평가: approval_ref 연결 여부, lease 만료 여부, expected/actual effect 차이, duplicate suppression hit 여부
- 사람 개입: partial success 원인 분류, 고위험 effect 승인, 롤백 승인, 예외 케이스 라벨링

이렇게 나누면 receipt가 감사 문서가 아니라 **실행 직후 품질 게이트**로 동작합니다. 특히 외부 전송이나 운영 변경에서는 사람이 "로그를 읽고 해석"하기 전에 시스템이 먼저 "설명 불가능한 실행인지"를 판정해 주는 구조가 중요합니다.

간단한 예시는 아래처럼 생각할 수 있습니다.

```yaml
receipt_id: rcpt_20260414_184200_01
intent_id: task_2481
approval_ref: appr_771
capability_lease_ref: lease_msg_send_15m
tool_action: telegram.send
resource_scope:
  - channel: partner-alerts
expected_effect: "장애 공지 1건 발송"
actual_effect: "장애 공지 1건 발송, message_id=91827"
evidence_refs:
  - message_id: 91827
  - template_version: outage_v3
  - approval_snapshot_hash: sha256:...
outcome: success
```

핵심은 스키마가 거창한가가 아니라, **이 액션이 승인 범위 안에서 예측한 효과를 냈는지**를 바로 비교할 수 있느냐입니다.

### 5) 4주 도입 플랜

**1주차: 고위험 액션 인벤토리화**  
외부 전송, 쓰기, 운영 변경, 권한 변경 액션을 분류하고 필수 evidence를 정합니다.

**2주차: 최소 receipt 스키마와 저장소 고정**  
receipt_id, intent_id, approval_ref, lease_ref, actual_effect, evidence_refs만 먼저 붙여도 충분합니다.

**3주차: 실행 경로 연결**  
코드 수정과 외부 전송 두 흐름에 receipt draft/finalize를 붙이고 duplicate suppression key를 도입합니다.

**4주차: 리뷰 화면과 경보 연결**  
unverifiable action, expired lease execution, evidence 누락을 즉시 경고로 올리고 사람이 receipt 기반으로 검토할 수 있게 만듭니다.

## 트레이드오프/주의점

1) **receipt를 자세히 남길수록 비밀값과 개인정보가 섞일 위험이 커집니다.**  
   원문 저장보다 digest, redaction, pointer 방식이 기본이어야 합니다.

2) **모든 액션을 동기식 receipt로 묶으면 경로가 느려질 수 있습니다.**  
   핵심 필드만 동기 반영하고 evidence finalize는 짧은 비동기 후처리로 나누는 편이 낫습니다.

3) **스키마가 너무 일반적이면 사람이 읽어도 아무 의미가 없습니다.**  
   `did something` 같은 outcome은 감사에는 남아도 운영에는 도움이 안 됩니다.

4) **receipt만 있고 lineage, lease, approval이 분리돼 있으면 절반짜리입니다.**  
   receipt는 연결점이지 단독 솔루션이 아닙니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 외부 전송과 운영 변경 액션은 receipt coverage가 100%에 가깝다.
- [ ] receipt에 approval_ref와 capability_lease_ref가 같이 들어간다.
- [ ] expected_effect와 actual_effect를 분리해 기록한다.
- [ ] duplicate suppression key 또는 replay guard가 있다.
- [ ] evidence 누락과 expired lease execution을 별도 경보로 본다.

### 연습 과제

1. 최근 에이전트 작업 3건을 골라 intent, approval, lease, actual effect, evidence를 표로 다시 정리해 보세요. 빠진 연결이 어디인지 바로 보일 가능성이 큽니다.  
2. 외부 전송 액션 하나를 골라 message id, 대상, 승인 ref, 발송 시각, 결과 상태를 묶은 최소 receipt 스키마를 설계해 보세요.  
3. 코드 수정 워크플로 하나에 duplicate suppression key를 넣는다면 어떤 조합이 적절한지 적어 보세요. 보통 `task_id + repo + branch + scope` 정도만으로도 중복 방지 품질이 크게 올라갑니다.

## 관련 글

- [Execution Receipt 운영 플레이북](/learning/deep-dive/deep-dive-execution-receipt-operations-playbook/)
- [Tool Permission Manifest + Runtime Attestation](/posts/2026-04-05-tool-permission-manifest-runtime-attestation-trend/)
- [Harness Engineering](/posts/2026-04-09-harness-engineering-agent-runtime-frame-trend/)
- [Test Evidence Pipeline](/posts/2026-04-10-test-evidence-pipeline-ai-change-review-trend/)
- [Stateful Sandbox Snapshot](/posts/2026-04-11-stateful-sandbox-snapshot-environment-replay-trend/)
- [Action Lineage Graph](/posts/2026-04-12-action-lineage-agent-observability-graph-trend/)
- [Capability Lease](/posts/2026-04-13-capability-lease-expiring-agent-permissions-trend/)
