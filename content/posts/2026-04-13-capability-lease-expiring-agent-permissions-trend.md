---
title: "2026 개발 트렌드: Capability Lease, 에이전트 권한은 고정 역할이 아니라 만료되는 작업 권한으로 이동한다"
date: 2026-04-13
draft: false
tags: ["Capability Lease", "AI Agent", "Security", "Governance", "Platform Engineering", "Approval Workflow"]
categories: ["Development", "Learning"]
series: "2026 에이전트 운영 설계 트렌드"
description: "에이전트 운영이 길어질수록 문제는 모델보다 과권한 세션과 오래 살아남는 승인 상태에서 발생합니다. 최근 팀들이 task-scoped capability lease를 도입하는 이유와 실무 기준을 정리합니다."
key_takeaways:
  - "좋은 권한 모델은 더 많은 allowlist가 아니라, 작업 단위로 발급되고 자동 만료되는 capability lease에 가깝다."
  - "정적 역할 기반 권한만으로는 멀티에이전트, 승인 포함 워크플로, 장시간 세션에서 과권한과 설명 불가능성을 막기 어렵다."
  - "실무 핵심 지표는 자동화율보다 dormant permission minutes, out-of-scope action rate, approval-to-execution p95 같은 운영 숫자다."
---

AI 에이전트를 실제 팀 워크플로에 넣으면 곧 드러나는 문제가 있습니다. 처음에는 "어떤 모델이 더 잘하나"를 보지만, 시간이 지나면 더 위험한 질문이 남습니다. **이 에이전트가 왜 아직도 그 권한을 갖고 있지?**

개발 초기에는 넓은 allowlist와 긴 세션이 편합니다. 그런데 에이전트가 여러 도구를 넘나들고, 사람 승인과 배치 작업이 섞이고, 세션이 하루 이상 이어지기 시작하면 정적 역할만으로는 설명이 안 됩니다. 오전에 승인된 쓰기 권한이 밤까지 살아 있고, 원래 문서 수정용이던 세션이 나중에는 배포 관련 액션까지 시도하는 식입니다. 사고는 대개 여기서 납니다.

그래서 최근 팀들이 보는 방향은 "역할을 더 촘촘히 쪼개자"가 아니라 **작업 단위 capability lease를 발급하고 자동 만료시키자**에 가깝습니다. 저는 이 흐름이 [Tool Permission Manifest + Runtime Attestation](/posts/2026-04-05-tool-permission-manifest-runtime-attestation-trend/)의 다음 단계라고 생각합니다. manifest가 "무엇이 원칙적으로 가능한가"를 정한다면, capability lease는 **이번 작업에서 지금 당장 무엇이 허용되는가**를 제한합니다.

## 이 글에서 얻는 것

- 정적 역할 기반 권한이 장시간 에이전트 운영에서 왜 과권한으로 변하는지 이해할 수 있습니다.
- capability lease를 어떤 필드와 어떤 만료 규칙으로 설계해야 실효성이 있는지 기준을 잡을 수 있습니다.
- 승인, 세션 보안, 실행 추적을 capability lease와 어떻게 연결해야 하는지 운영 숫자 중심으로 정리할 수 있습니다.

## 핵심 개념/이슈

### 1) 정적 역할은 짧은 스크립트에는 맞아도 긴 작업 흐름에는 너무 넓다

전통적인 RBAC는 사람 계정과 서비스 계정에는 잘 맞습니다. 하지만 에이전트 실행은 보통 더 유동적입니다.

- 하나의 요청 안에서 read-only 조사와 write action이 섞입니다.
- 승인 전과 승인 후의 허용 범위가 달라집니다.
- 같은 세션이라도 오전 작업과 오후 작업의 목적이 달라집니다.
- 멀티에이전트 환경에서는 보조 실행자마다 필요한 권한이 다릅니다.

이때 `editor`, `deployer`, `ops-bot` 같은 정적 역할은 너무 넓거나 너무 자주 바뀝니다. 결국 실무 문제는 권한 정의 부족보다 **권한 수명(lifetime)과 작업 문맥(context)이 분리돼 있다는 점**입니다. 이 문제는 [Harness Engineering](/posts/2026-04-09-harness-engineering-agent-runtime-frame-trend/)에서 말한 실행 프레임 고정, [Approval-Driven Auto-Remediation](/posts/2026-03-17-approval-driven-auto-remediation-trend/)에서 말한 승인 경계와 바로 연결됩니다.

### 2) capability lease는 "권한 목록"이 아니라 "만료되는 작업 토큰"에 가깝다

capability lease의 핵심은 단순 allowlist가 아닙니다. 최소한 아래 정보가 같이 있어야 의미가 있습니다.

- `subject`: 어떤 에이전트/세션/하위 실행자가 쓰는가
- `task_id`: 어떤 요청 또는 티켓에 묶인 권한인가
- `allowed_actions`: 허용 툴과 액션 범위
- `resource_scope`: 경로, 저장소, 서비스, 환경 범위
- `expiry`: 몇 분 후 자동 만료되는가
- `approval_ref`: 어떤 승인 또는 정책 판정과 연결되는가
- `max_effect`: 허용 가능한 변경량, 예를 들어 파일 20개 이하, 외부 전송 0회
- `revoke_hook`: 사람이 중간에 즉시 회수할 수 있는가

즉 lease는 "이 세션은 deployer 역할이다"보다 훨씬 좁습니다. 오히려 "이 세션은 30분 동안 특정 저장소의 docs 디렉터리만 수정 가능"처럼 **행동 범위와 시간 범위를 동시에 묶는 계약**에 가깝습니다.

### 3) 왜 지금 이 모델이 중요해졌나: 멀티에이전트와 장시간 세션이 늘었기 때문이다

짧은 단발성 호출만 있을 때는 정적 정책으로도 버틸 수 있습니다. 하지만 최근 운영 패턴은 다릅니다.

- 세션이 스레드나 프로젝트 단위로 오래 유지됩니다.
- 보조 에이전트가 조사, 수정, 검증을 분담합니다.
- 승인 대기 후 다시 이어서 실행되는 흐름이 늘어납니다.
- 결과물은 [Test Evidence Pipeline](/posts/2026-04-10-test-evidence-pipeline-ai-change-review-trend/)이나 [Action Lineage Graph](/posts/2026-04-12-action-lineage-agent-observability-graph-trend/)처럼 구조화된 증거와 함께 남아야 합니다.

이 구조에서는 "한 번 허용한 권한이 언제까지 유효한가"가 훨씬 중요합니다. 승인 순간에는 안전했어도, 2시간 뒤 작업 문맥이 바뀌면 같은 권한은 위험해질 수 있습니다.

### 4) capability lease는 세션 보안과도 붙어야 한다

lease를 발급해도 세션이 탈취되면 문제가 남습니다. 그래서 capability lease는 [Passkey + Device-Bound Session](/posts/2026-04-06-passkey-device-bound-session-architecture-trend/) 같은 세션 무결성 계층과 같이 가야 합니다. 이상적인 구조는 아래에 가깝습니다.

- 사람 승인 또는 정책 판정이 발생한다.
- 해당 세션/기기 문맥에 묶인 lease가 짧게 발급된다.
- 실행 중 증적이 쌓이고, 범위를 벗어나면 즉시 거부된다.
- 시간이 지나거나 handoff가 일어나면 lease는 자동 만료된다.

즉 권한은 "누가 로그인했는가"보다 **지금 이 작업이 여전히 같은 문맥 안에 있는가**를 더 강하게 반영해야 합니다.

### 5) KPI도 자동화율보다 권한 체류 시간을 봐야 한다

성숙한 팀은 "얼마나 많이 자동화했는가" 대신 아래 숫자를 봅니다.

- `dormant_permission_minutes`: 발급됐지만 실제 사용되지 않은 권한의 총 시간
- `out_of_scope_action_rate`: lease 범위를 벗어난 액션 시도 비율
- `approval_to_execution_p95`: 승인 후 실제 실행까지 걸리는 시간
- `expired_lease_reuse_attempts`: 만료 권한 재사용 시도 건수
- `manual_revoke_time`: 사람이 중단 버튼을 눌렀을 때 실제 회수까지 걸리는 시간

이 수치가 중요한 이유는, 긴 수명의 넓은 권한이야말로 사고 표면을 키우기 때문입니다. lease가 잘 설계된 시스템은 과권한 상태가 오래 남아 있지 않습니다.

## 실무 적용

### 1) 최소 capability lease 스키마

처음부터 복잡한 권한 엔진이 필요하지는 않습니다. 아래 정도면 출발점으로 충분합니다.

- `lease_id`
- `subject_id`
- `task_id`
- `allowed_actions[]`
- `resource_scope[]`
- `issued_at`, `expires_at`
- `approval_ref`
- `max_effect`
- `revoked_at`
- `evidence_ref`

핵심은 lease가 정책 파일의 복사본이 아니라, **이번 작업의 실행 계약**이라는 점입니다. 그래서 발급과 사용, 만료와 회수 이벤트가 모두 추적 가능해야 합니다.

### 2) 의사결정 기준(숫자·조건·우선순위)

보통 아래 기준으로 시작하면 현실적입니다.

- read-only 조사 lease: 15~30분
- 로컬 문서/코드 수정 lease: 30~60분
- 운영 환경 변경 lease: 10~15분, 승인 참조 필수
- 외부 전송/권한 변경 lease: 단일 액션 단위, 실행 직후 즉시 만료
- 하위 에이전트 lease: 부모 lease보다 항상 더 좁아야 함

추가 조건 예시는 이렇습니다.

- 동일 lease로 파일 20개 이상 수정 시 재승인 요구
- 승인 후 10분 내 실행되지 않으면 lease 자동 폐기
- 세션 handoff 또는 기기 문맥 변경 감지 시 lease 즉시 무효화
- `out_of_scope_action_rate`가 0.5%를 넘으면 정책보다 프롬프트 수정이 아니라 권한 설계 재검토 우선

우선순위는 **즉시 회수 가능성 > 짧은 만료 시간 > 작업 범위 최소화 > 승인 UX > 구현 편의성** 순이 좋습니다.

### 3) 4주 도입 플랜

**1주차: 정적 권한 인벤토리화**  
현재 에이전트별 허용 도구, 쓰기 범위, 외부 전송 가능 범위를 모두 표로 뽑습니다.

**2주차: 3개 작업 유형만 lease화**  
read-only 조사, 문서 수정, 운영 액션 세 가지만 먼저 task-scoped lease로 분리합니다.

**3주차: 승인/세션 계층 연결**  
승인 이벤트와 lease 발급을 1:1 또는 1:N으로 연결하고, 세션 무결성 검증 실패 시 자동 회수되게 만듭니다.

**4주차: evidence와 lineage 결합**  
lease 발급, 사용, 만료, 회수 이벤트를 evidence bundle과 lineage graph에 연결해 "왜 이 액션이 허용됐는가"를 5분 안에 설명 가능하게 만듭니다.

### 4) 어디부터 효과가 큰가

아래 환경에서는 특히 효과가 큽니다.

**장시간 스레드형 세션이 많은 팀**  
오래 살아 있는 세션은 과권한이 남기 쉽습니다.

**승인 후 실행까지 시간차가 큰 팀**  
승인과 실행 사이가 길수록 정적 권한이 위험해집니다.

**멀티에이전트 분업이 있는 팀**  
보조 에이전트마다 lease를 다르게 줄 수 있어 blast radius를 줄이기 쉽습니다.

**외부 전송과 운영 액션이 섞이는 팀**  
문서 작성과 배포, 알림 발송이 같은 세션에서 일어나면 lease 경계가 특히 중요합니다.

## 트레이드오프/주의점

1) **lease TTL이 너무 짧으면 승인 피로가 커진다**  
   보안은 좋아지지만 실제 작업 흐름이 계속 끊길 수 있습니다.

2) **너무 세밀한 scope는 운영자가 이해하기 어렵다**  
   권한 모델이 정교해도 사람이 검토할 수 없으면 결국 우회가 생깁니다.

3) **회수 경로가 느리면 lease는 이름만 임시권한이다**  
   revoke가 수동 배치 반영이라면 사고 시점에는 이미 늦습니다.

4) **정책 파일만 있고 실행 문맥이 없으면 절반짜리다**  
   lease는 manifest, session binding, evidence, lineage와 같이 움직여야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] read-only, write, 외부 전송, 운영 액션에 서로 다른 lease TTL이 있다.
- [ ] 승인 이벤트와 lease 발급 레코드가 연결된다.
- [ ] 하위 에이전트는 부모보다 좁은 lease만 받는다.
- [ ] handoff, 세션 변경, 기기 문맥 변경 시 lease가 자동 만료된다.
- [ ] dormant permission minutes와 expired reuse attempt를 측정한다.

### 연습 과제

1. 지금 쓰는 에이전트 워크플로 1개를 골라, 정적 역할 대신 task-scoped lease로 바꾸면 TTL과 scope를 어떻게 나눌지 설계해 보세요.  
2. 최근 승인 기반 작업 3건을 돌아보고, 승인 시점과 실제 실행 시점 사이의 간격을 측정해 보세요. 10분 이상 벌어진 작업이 많다면 lease 만료 정책이 필요한 신호일 수 있습니다.  
3. 외부 전송, 파일 수정, 배포 액션을 각각 하나씩 골라 `max_effect`를 숫자로 정의해 보세요. 예를 들면 파일 수정 20개 이하, 배포 대상 1개 환경만 허용 같은 식입니다.

## 관련 글

- [Tool Permission Manifest + Runtime Attestation](/posts/2026-04-05-tool-permission-manifest-runtime-attestation-trend/)
- [Passkey + Device-Bound Session](/posts/2026-04-06-passkey-device-bound-session-architecture-trend/)
- [Harness Engineering](/posts/2026-04-09-harness-engineering-agent-runtime-frame-trend/)
- [Test Evidence Pipeline](/posts/2026-04-10-test-evidence-pipeline-ai-change-review-trend/)
- [Action Lineage Graph](/posts/2026-04-12-action-lineage-agent-observability-graph-trend/)
- [Approval-Driven Auto-Remediation](/posts/2026-03-17-approval-driven-auto-remediation-trend/)
