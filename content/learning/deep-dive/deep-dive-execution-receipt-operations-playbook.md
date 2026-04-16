---
title: "백엔드 커리큘럼 심화: Execution Receipt 운영 플레이북 (Approval·Lease·Evidence·Replay Guard)"
date: 2026-04-14
draft: false
topic: "AI Agent Operations"
tags: ["Execution Receipt", "Approval Workflow", "Capability Lease", "Evidence", "Auditability", "Platform Engineering"]
categories: ["Backend Deep Dive"]
description: "에이전트가 외부 전송, 파일 수정, 운영 액션을 수행할 때 execution receipt를 어떤 순서로 설계하고 어떤 숫자로 운영해야 하는지 실무 플레이북 형태로 정리합니다."
module: "agent-operations"
study_order: 1174
keywords: ["execution receipt", "agent receipt", "approval evidence", "capability lease", "replay guard", "에이전트 운영"]
---

에이전트 운영이 읽기 중심일 때는 로그만 잘 남겨도 어느 정도 관리가 됩니다. 하지만 외부 메시지 전송, 코드 수정, 설정 변경, 운영 명령 실행처럼 실제 효과가 생기는 액션이 늘어나면 로그만으로는 부족합니다. 운영자는 곧바로 다른 질문을 하게 됩니다. **이 액션은 왜 허용됐는가, 어떤 승인과 어떤 권한으로 실행됐는가, 원래 의도와 실제 결과가 같았는가, 재시도로 한 번 더 실행된 것은 아닌가** 같은 질문입니다.

이때 필요한 것이 execution receipt입니다. receipt는 단순 로그 이벤트가 아니라, 작업 단위 액션을 설명 가능한 객체로 묶는 기록입니다. 저는 이를 [Execution Receipt 트렌드 글](/posts/2026-04-14-execution-receipt-agent-operations-trend/)의 실무판이라고 보는 편이 맞다고 생각합니다. [Action Lineage Graph](/posts/2026-04-12-action-lineage-agent-observability-graph-trend/)가 전체 실행 연결을 보여주고, [Capability Lease](/posts/2026-04-13-capability-lease-expiring-agent-permissions-trend/)가 현재 권한 범위를 제한한다면, execution receipt는 **이번 액션 하나가 어떤 계약 아래 실행됐고 어떤 증거를 남겼는지**를 닫아 주는 마지막 고리입니다.

## 이 글에서 얻는 것

- execution receipt를 어떤 액션부터 붙여야 투자 대비 효과가 큰지 우선순위를 정할 수 있습니다.
- approval, lease, evidence, replay guard를 한 레코드에 어떻게 묶어야 운영 설명 가능성이 올라가는지 이해할 수 있습니다.
- coverage, unverifiable action rate, approval-to-receipt latency 같은 지표를 어떤 초기 목표값으로 운영할지 바로 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) receipt는 감사 로그가 아니라 실행 계약의 결과 레코드다

실무에서 receipt를 잘못 도입하면 "로그를 더 많이 저장하는 프로젝트"로 끝나기 쉽습니다. 하지만 receipt의 핵심은 보존량이 아닙니다. **액션 하나를 intent, approval, capability, evidence, effect와 함께 설명 가능한 상태로 묶는 것**이 본질입니다.

예를 들어 에이전트가 운영 채널에 공지 메시지를 보냈다면 최소한 아래 질문에 답할 수 있어야 합니다.

- 이 메시지는 누가 요청했는가
- 사람이 승인했다면 어떤 승인 레퍼런스와 연결되는가
- 당시 허용된 capability lease는 무엇이었는가
- 실제 발송 대상과 message id는 무엇인가
- 동일 intent가 재시도로 두 번 발송된 것은 아닌가

즉 receipt는 "이벤트가 있었다"를 넘어서 **행동의 정당성과 결과를 한 번에 설명하는 최소 단위**여야 합니다.

### 2) 최소 필드는 작아도 되지만 approval, lease, actual effect는 반드시 같이 있어야 한다

처음부터 거대한 스키마를 만들 필요는 없습니다. 다만 아래 필드는 거의 빠지면 안 됩니다.

- `receipt_id`
- `intent_id` 또는 `task_id`
- `subject_id` 또는 `session_id`
- `approval_ref`
- `capability_lease_ref`
- `tool_action`
- `resource_scope`
- `expected_effect`
- `actual_effect`
- `evidence_refs`
- `outcome`
- `started_at`, `completed_at`
- `replay_guard_key`

여기서 특히 중요한 것은 `expected_effect`와 `actual_effect`를 분리하는 것입니다. 승인 당시 기대 효과는 "문서 2개 수정"인데 실제 효과가 "문서 2개 수정 + 설정 파일 변경"이라면, receipt가 있어야 범위 초과를 바로 탐지할 수 있습니다. approval과 lease를 따로 저장하는 것만으로는 부족한 이유가 여기에 있습니다. **승인 근거와 실제 결과가 한 곳에서 비교돼야 자동 판정이 가능해집니다.**

### 3) 우선순위는 고위험 쓰기 액션부터 붙이는 편이 가장 안전하다

receipt를 모든 액션에 한꺼번에 붙이려 하면 오래 걸리고, 운영팀 피로만 늘어납니다. 초반 우선순위는 아래처럼 잡는 편이 좋습니다.

1. 외부 전송, 운영 명령, 권한 변경
2. 코드/문서 수정
3. 배치 트리거, 설정 변경, 데이터 쓰기
4. 읽기 전용 조사 액션

이 순서가 좋은 이유는 복구 난이도와 설명 책임이 정확히 이 순서로 커지기 때문입니다. 외부 전송은 취소가 어렵고, 운영 명령은 영향 범위가 넓고, 코드 변경은 diff와 테스트 증거를 붙이기 쉬워서 빠르게 효과를 볼 수 있습니다. 반면 읽기 전용 액션은 나중에 coverage를 넓힐 때 포함해도 됩니다.

### 4) replay guard가 없으면 receipt는 예쁘지만 운영 사고는 계속 난다

많은 팀이 receipt 스키마는 만들지만 재시도 중복을 막는 키를 빼먹습니다. 그러면 감사 설명은 그럴듯해도 운영 사고는 계속 납니다. timeout이나 worker 재시작 뒤 같은 intent가 다시 실행되면, receipt는 두 장 생기고 실제 효과도 두 번 발생할 수 있기 때문입니다.

그래서 `replay_guard_key` 또는 duplicate suppression key를 필수 필드로 두는 편이 좋습니다. 보통 아래 조합이면 출발점으로 충분합니다.

- 외부 전송: `intent_id + destination + template_version`
- 코드 수정: `task_id + repo + branch + scope`
- 운영 명령: `intent_id + service + action + target_env`

중요한 것은 키가 완벽히 보편적일 필요는 없다는 점입니다. 먼저 **같은 효과를 두 번 내면 안 되는 액션**에만 붙여도 사고율이 크게 떨어집니다.

### 5) 좋은 receipt 파이프라인은 draft와 finalize를 분리한다

실행 직전에 receipt draft를 만들고, 실행 후 evidence를 수집해 finalize하는 구조가 가장 단순합니다.

1. intent 생성
2. approval 연결
3. capability lease 발급 또는 참조
4. tool action 직전 receipt draft 생성
5. 실행 결과와 evidence 수집
6. actual effect 계산
7. receipt finalize 및 경보 평가

이 구조의 장점은 실패도 같은 형태로 남길 수 있다는 점입니다. denied, expired, partial success도 모두 receipt로 저장하면 운영 데이터 왜곡이 줄어듭니다. 성공만 남기면 coverage는 높아 보여도 실제 설명 가능성은 낮습니다.

## 실무 적용

### 1) 권장 초기 목표값

처음 운영할 때는 아래 숫자가 무난한 출발점입니다.

- 외부 전송, 운영 변경, 권한 변경: receipt coverage **100%**
- 코드/문서 수정: receipt coverage **95% 이상**
- `unverifiable_action_rate`: **0.1% 미만**
- `approval_to_receipt_p95`: **60초 미만**
- `evidence_completeness_ratio`: **95% 이상**
- `duplicate_execution_rate`: **0.5% 미만**

이 숫자의 핵심은 완벽한 자동화가 아닙니다. **설명 불가능한 실행을 먼저 줄이는 것**이 목표입니다.

### 2) 팀 역할 분리 기준

- 플랫폼 팀: receipt 스키마, 저장소, policy evaluator, replay guard 제공
- 제품/도메인 팀: expected effect 정의, 고위험 액션 분류, evidence 최소 세트 정의
- 운영자/리뷰어: partial success 분류, 롤백 승인, 예외 정책 검토

이 분리가 없으면 플랫폼은 과도하게 추상적인 필드만 만들고, 도메인 팀은 사람이 읽어도 의미 없는 outcome만 남기게 됩니다.

### 3) 실제 점검 체크리스트

- [ ] 외부 전송 액션은 모두 approval_ref와 message id를 같이 남긴다.
- [ ] 코드 수정 액션은 diff hash 또는 commit ref를 evidence로 남긴다.
- [ ] lease 만료 후 발생한 actual effect는 무조건 실패 receipt와 경보로 승격한다.
- [ ] replay guard hit는 success가 아니라 duplicate-skipped 같은 별도 outcome으로 구분한다.
- [ ] expected effect와 actual effect 차이가 있으면 사람이 보게 되는 review queue로 보낸다.

## 트레이드오프/주의점

첫째, evidence를 너무 자세히 저장하면 비밀값이나 개인정보가 섞일 수 있습니다. 원문보다 hash, pointer, redaction을 기본값으로 두는 편이 안전합니다.

둘째, 모든 것을 동기식으로 finalize하면 쓰기 경로가 느려집니다. 핵심 필드만 동기 반영하고, 세부 evidence 보강은 짧은 비동기 후처리로 넘기는 편이 좋습니다.

셋째, 스키마를 너무 일반화하면 사람이 읽어도 의미가 없습니다. `did something` 같은 outcome은 저장 비용만 늘리고 운영 판단에는 거의 도움이 되지 않습니다.

## 관련 글

- [Execution Receipt 트렌드 글](/posts/2026-04-14-execution-receipt-agent-operations-trend/)
- [Action Lineage Graph](/posts/2026-04-12-action-lineage-agent-observability-graph-trend/)
- [Capability Lease](/posts/2026-04-13-capability-lease-expiring-agent-permissions-trend/)
- [Test Evidence Pipeline](/posts/2026-04-10-test-evidence-pipeline-ai-change-review-trend/)
