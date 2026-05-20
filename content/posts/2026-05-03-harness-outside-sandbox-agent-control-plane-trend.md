---
title: "2026 개발 트렌드: Outside-the-Sandbox Harness, 잘하는 팀은 에이전트의 두뇌와 작업장을 분리한다"
date: 2026-05-03
draft: false
tags: ["Agent Harness", "Sandbox", "Control Plane", "AI Coding Agents", "Platform Engineering"]
categories: ["Development", "Learning"]
series: "2026 개발 운영 트렌드"
keywords: ["outside sandbox harness", "agent control plane", "sandbox lifecycle", "durable execution", "agent runtime architecture"]
description: "최근 에이전트 운영 논의는 모델 성능보다 하네스 위치로 이동하고 있습니다. 세션 루프를 샌드박스 밖으로 빼는 구조가 왜 주목받는지 실무 기준으로 정리합니다."
lastmod: 2026-05-03
summary: "Outside-the-Sandbox Harness는 에이전트의 추론 루프와 정책, 메모리, 승인, 자격증명을 작업 샌드박스와 분리하는 운영 구조입니다. 핵심은 샌드박스를 더 약하게 만들고, 세션을 더 오래 살리고, 다중 사용자 환경에서 공유 상태를 로컬 파일 대신 제어 평면으로 올리는 데 있습니다."
key_takeaways:
  - "요즘 에이전트 운영의 핵심 질문은 모델이 어디서 추론하느냐보다, 하네스와 샌드박스가 어디서 분리되느냐에 가깝다."
  - "샌드박스 밖 하네스는 자격증명 분리, 세션 내구성, 멀티유저 공유 상태에서 유리하지만, durable execution과 가상 파일시스템을 직접 설계해야 한다."
  - "좋은 팀은 샌드박스를 더 강하게 만드는 것보다, 샌드박스 안에 들어갈 책임을 줄이는 쪽으로 간다."
operator_checklist:
  - "세션 루프, 승인, 정책, 메모리, 자격증명이 현재 같은 런타임에 붙어 있는지 먼저 분해한다."
  - "샌드박스 밖으로 뺄수록 sandbox resume p95, session rehydrate 성공률, memory consistency 규칙을 먼저 숫자로 고정한다."
  - "bash 같은 우회 경로가 가상화 레이어를 뚫지 않는지 별도 점검한다."
decision_guide:
  title: "우리 팀이 Outside-the-Sandbox Harness를 검토해도 되는 신호"
  intro: "이 구조는 모든 팀의 기본값은 아닙니다. 다만 아래 조건이 겹치기 시작하면 단일 샌드박스 세션보다 분리형 제어 평면이 더 실용적일 수 있습니다."
  cases:
    - badge: "즉시 검토"
      title: "세션이 길고, 같은 조직 안에서 여러 사람이 같은 에이전트를 공유한다"
      fit: "공유 메모리, 장시간 세션, 승인 흐름, 자격증명 분리를 동시에 요구하는 팀"
      watchouts: "durable execution과 shared-state consistency를 직접 풀 준비가 필요하다."
      next_step: "메모리와 승인 기록부터 샌드박스 파일이 아닌 제어 평면 저장소로 올린다."
    - badge: "부분 도입"
      title: "샌드박스 idle 시간이 길고, 대부분의 턴이 실제 명령 실행 없이 끝난다"
      fit: "요약, 대기, CI 확인, 정책 판정 비중이 높아 샌드박스가 항상 켜져 있을 이유가 적은 팀"
      watchouts: "resume latency가 길면 오히려 체감 품질이 나빠질 수 있다."
      next_step: "idle ratio와 sandbox resume p95를 측정해 suspend/resume 실험부터 한다."
    - badge: "보류 가능"
      title: "한 명이 로컬에서 짧게 쓰는 단일 사용자 에이전트다"
      fit: "공유 메모리나 조직 단위 권한 모델보다 단순성과 로컬 DX가 더 중요한 팀"
      watchouts: "이 경우는 하네스를 분리하는 비용이 이득보다 클 수 있다."
      next_step: "먼저 [Harness Engineering](/posts/2026-04-09-harness-engineering-agent-runtime-frame-trend/)과 [Capability Lease](/posts/2026-04-13-capability-lease-expiring-agent-permissions-trend/) 수준의 기본 운영 체계를 다진다."
learning_refs:
  - title: "Harness Engineering"
    href: "/posts/2026-04-09-harness-engineering-agent-runtime-frame-trend/"
    description: "왜 실행 프레임이 모델보다 중요해지는지 배경부터 이어집니다."
  - title: "Stateful Sandbox Snapshot"
    href: "/posts/2026-04-11-stateful-sandbox-snapshot-environment-replay-trend/"
    description: "샌드박스를 세션 그 자체가 아니라 교체 가능한 실행 환경으로 볼 때 도움이 됩니다."
  - title: "Execution Receipt"
    href: "/posts/2026-04-14-execution-receipt-agent-operations-trend/"
    description: "세션 제어 평면이 실제 실행 증거와 어떻게 연결돼야 하는지 이어집니다."
faqs:
  - question: "샌드박스 밖 하네스면 결국 더 복잡해지는 것 아닌가?"
    answer: "맞습니다. 단일 사용자 로컬 환경에서는 종종 과합니다. 다만 멀티유저, 장시간 세션, 조직 메모리, 자격증명 분리 요구가 커지면 그 복잡성을 제어 평면으로 당겨오는 편이 더 낫습니다."
  - question: "그냥 샌드박스를 오래 살려 두면 안 되나?"
    answer: "가능하지만 그러면 세션 내구성, 비용, 공유 상태, 자격증명 노출 면적을 다시 안고 가게 됩니다. 샌드박스를 세션과 동일시하지 않는 구조가 필요한 이유가 여기에 있습니다."
  - question: "모델 성능이 좋아지면 이 문제가 줄어들지 않나?"
    answer: "일부는 줄어들 수 있지만, 승인, 정책, 메모리 일관성, 자격증명 경계 같은 운영 문제는 모델 IQ보다 아키텍처 영향이 훨씬 큽니다."
---

최근 에이전트 운영 얘기를 보면 주제가 또 한 단계 이동하고 있습니다. 예전에는 프롬프트, 그다음엔 도구 권한, 그다음엔 검증기와 승인 게이트가 중심이었다면, 이제는 **에이전트 루프 자체를 어디서 돌릴 것인가**가 중요한 질문이 됐습니다. 쉽게 말해 모델이 생각하고 정책을 적용하고 메모리를 읽는 하네스를, 실제 코드와 쉘 명령을 실행하는 샌드박스와 같은 곳에 둘 것인지 분리할 것인지가 아키텍처 선택지로 올라온 것입니다.

저는 이 흐름이 [Harness Engineering](/posts/2026-04-09-harness-engineering-agent-runtime-frame-trend/), [Stateful Sandbox Snapshot](/posts/2026-04-11-stateful-sandbox-snapshot-environment-replay-trend/), [Capability Lease](/posts/2026-04-13-capability-lease-expiring-agent-permissions-trend/), [Execution Receipt](/posts/2026-04-14-execution-receipt-agent-operations-trend/) 이후에 자연스럽게 나온 다음 단계라고 봅니다. 실행 프레임, 권한, 증거를 따로 보기 시작했다면, 이제 남는 질문은 "세션의 두뇌와 작업장을 같은 런타임에 둬야 하나"이기 때문입니다.

## 이 글에서 얻는 것

- 왜 최근 에이전트 플랫폼이 하네스를 샌드박스 밖으로 빼는 구조를 검토하는지 이해할 수 있습니다.
- 단일 사용자 로컬 에이전트와 멀티유저 조직형 에이전트에서 아키텍처 선택 기준이 왜 달라지는지 구분할 수 있습니다.
- sandbox resume latency, session durability, shared memory consistency 같은 운영 기준을 어떤 숫자로 시작하면 되는지 감을 잡을 수 있습니다.
- 이 구조가 단순 보안 미신이 아니라 비용, 내구성, 공유 상태 문제와 연결된다는 점을 설명할 수 있습니다.

## 핵심 개념/이슈

### 1) 핵심 분기점은 "루프가 샌드박스 안에 사는가"다

에이전트 시스템은 겉보기보다 비슷합니다. 프롬프트를 보내고, 응답을 받고, 툴을 실행하고, 결과를 다시 넣는 루프가 있습니다. 차이는 그 루프가 어디에서 사는가입니다.

- **Inside-the-Sandbox Harness**: 추론 루프와 툴 실행이 같은 환경에 있다.
- **Outside-the-Sandbox Harness**: 추론 루프와 정책, 메모리, 승인 상태는 제어 평면에 있고, 실제 명령 실행만 샌드박스로 위임한다.

단일 사용자 로컬 환경에서는 첫 번째가 단순하고 빠릅니다. 하지만 조직 단위 운영으로 가면 두 번째가 매력적이기 시작합니다. 샌드박스를 세션 그 자체로 보지 않고, **필요할 때만 붙였다 떼는 실행기**로 볼 수 있기 때문입니다.

### 2) 하네스를 밖으로 빼면 샌드박스가 약해지는 대신 세션이 강해진다

이 구조의 가장 큰 장점은 보통 보안 문장으로만 설명되지만, 실제로는 운영상의 이점이 더 큽니다.

첫째, **자격증명이 샌드박스 안에 남지 않습니다.** LLM API 키, 사용자 토큰, 승인 상태, 조직 메모리 저장소 접근 권한을 제어 평면에 두면, 샌드박스는 코드 읽기와 명령 실행 같은 한정된 책임만 가집니다.

둘째, **샌드박스를 중간에 내려도 세션이 죽지 않습니다.** 세션 루프가 밖에 있으면 샌드박스는 교체 가능한 부품이 됩니다. 이건 [Stateful Sandbox Snapshot](/posts/2026-04-11-stateful-sandbox-snapshot-environment-replay-trend/)이 말한 환경 재개 개념과도 이어집니다. 좋은 팀은 샌드박스를 세션과 동일시하지 않고, 세션이 샌드박스를 잠깐 빌리는 구조로 갑니다.

셋째, **idle 시간이 긴 에이전트에 특히 유리합니다.** 실제 워크플로를 보면 모델 추론, 대기, CI 상태 확인, 승인 대기처럼 샌드박스가 필요 없는 구간이 꽤 많습니다. `idle_ratio`가 **60% 이상**인 세션이라면 샌드박스를 항상 켜 두는 쪽이 오히려 낭비일 수 있습니다.

### 3) 멀티유저가 되면 로컬 파일시스템 가정이 바로 흔들린다

Outside-the-Sandbox 구조가 본격적으로 필요해지는 순간은 사용자가 늘어날 때입니다. 한 명이 로컬에서 짧게 쓰는 도구는 메모리와 스킬을 파일처럼 다뤄도 문제가 잘 안 드러납니다. 하지만 조직 단위 에이전트는 다릅니다.

- 여러 세션이 같은 메모리를 동시에 읽고 쓴다.
- 승인 기록과 증거 레코드가 세션 밖에서도 보여야 한다.
- 같은 팀의 스킬과 운영 규칙이 여러 사용자에게 공유돼야 한다.
- 세션이 몇 시간 이상 살아서 배포나 재시작을 넘어가야 한다.

이 지점부터는 로컬 파일시스템이 아니라 **공유 상태 저장소**가 본체가 됩니다. 그래서 최근 흐름은 read/write/edit 도구는 그대로 유지하되, 경로에 따라 실제 backend를 다르게 라우팅하는 방향으로 갑니다. 에이전트는 파일을 읽는다고 생각하지만, 실제로는 어떤 경로는 샌드박스 파일이고 어떤 경로는 메모리 DB인 식입니다. 이 방향은 [Agent Handoff Packet](/posts/2026-04-17-agent-handoff-packet-runtime-trend/)이나 [Execution Receipt](/posts/2026-04-14-execution-receipt-agent-operations-trend/)처럼 **세션 외부에서도 이어져야 하는 상태**가 늘어날수록 더 중요해집니다.

### 4) 대신 durable execution이 갑자기 핵심 문제가 된다

하네스를 밖으로 빼는 순간 공짜로 따라오는 것도 있습니다. 바로 세션 내구성 책임입니다. 샌드박스 안에서 루프를 돌리면 프로세스가 곧 세션이지만, 제어 평면으로 빼면 세션은 장시간 실행 함수에 가깝습니다.

그래서 이 구조를 진지하게 운영하려면 아래가 같이 필요합니다.

- 중간 단계 checkpoint
- 배포 후 재개 가능한 durable execution
- sandbox 재할당 후 재수화(rehydrate)
- 장시간 대기 중 타임아웃, 취소, 승인 상태 관리

실무 출발선은 이 정도가 무난합니다.

- `session_rehydrate_success_rate` **99% 이상**
- `sandbox_resume_p95` **100ms 이하**면 인터랙티브 체감 유지 가능
- `tool_roundtrip_p95`가 baseline 대비 **20% 이상** 늘어나면 구조 재검토
- 세션 배포 중단/재시작 후 손실 없는 복구율 **100% 목표**

즉 이 구조는 샌드박스를 약하게 만들지만, 제어 평면은 더 강하게 만들어야 성립합니다.

### 5) 2주 파일럿은 이렇게 설계하는 편이 현실적이다

개념을 이해한 뒤 가장 많이 나오는 질문은 "그래서 우리 팀은 어디서부터 떼어내야 하나"입니다. 이때 처음부터 전면 재구성을 시도하면 거의 항상 과합니다. 오히려 **승인 기록, 메모리, 실행 증거처럼 세션 바깥에서도 살아 있어야 하는 것** 하나만 골라 파일럿으로 분리하는 편이 훨씬 안정적입니다.

예를 들어 현재 구조가 `에이전트 프로세스 + 샌드박스 + 로컬 메모리 파일`로 붙어 있다면, 첫 2주는 아래처럼 보는 편이 좋습니다.

1. **1주차**: 승인 기록과 실행 receipt만 제어 평면 저장소로 올립니다.
2. **2주차**: 샌드박스는 그대로 두고, 세션 재개 시 승인/증거를 외부 저장소에서 재수화하는 흐름만 검증합니다.
3. 이때 코드 편집 같은 핵심 작업은 그대로 두고, 세션 지속성에만 집중합니다.

이 방식의 장점은 실패해도 손실 반경이 작다는 점입니다. 모델 루프, 툴 권한, 파일 편집기까지 한 번에 옮기지 않기 때문에 문제가 생겨도 **"승인 저장소만 다시 로컬로 붙이면 원복"**이 가능해집니다. 저는 이런 파일럿을 설계할 때 아래 4개 지표를 같이 보길 권합니다.

- `resume_without_manual_fix_rate`: 사람이 세션을 수동 복구하지 않고 바로 이어진 비율
- `approval_lookup_p95`: 승인 상태를 읽어오는 시간
- `receipt_write_failure_rate`: 실행 증거 저장 실패율
- `sandbox_detach_success_rate`: 샌드박스를 내려도 세션 상태가 유지된 비율

핵심은 화려한 분산 구조를 먼저 만들기보다, **현재 세션에서 정말 샌드박스 안에 있을 이유가 없는 책임부터 밖으로 빼는 것**입니다. 이 기준이 서야 이후에 [Execution Receipt](/posts/2026-04-14-execution-receipt-agent-operations-trend/), [Task Graph Runtime](/posts/2026-04-29-task-graph-runtime-agent-ops-trend/), [Tool Contract Test](/posts/2026-04-30-tool-contract-test-agent-runtime-trend/) 같은 운영 글과도 자연스럽게 연결됩니다.

### 6) 가장 까다로운 부분은 보안보다 일관성과 우회 경로다

의외로 어려운 부분은 "분리하면 더 안전하다" 한 줄이 아닙니다. 운영에서는 아래가 더 빨리 아픕니다.

- 두 세션이 같은 메모리를 동시에 수정하면 누가 이겨야 하는가
- bash나 셸 명령이 가상화 레이어를 우회하면 어떻게 할 것인가
- 같은 read/write 인터페이스를 유지하면서 backend 차이를 어떻게 숨길 것인가
- 세션이 다른 샌드박스로 넘어갈 때 어떤 상태를 복원해야 하는가

특히 bash는 구조적 툴 호출이 아니라 우회 경로이기 때문에, 파일 경로 가상화를 뚫고 실제 샌드박스 파일시스템만 보게 만들 수 있습니다. 그래서 Outside-the-Sandbox 구조를 택한 팀은 대개 **가상 네임스페이스 차단 규칙**, **명령 파싱 기반 가드**, **권한 lease 축소**를 같이 둡니다. 이건 [Capability Lease](/posts/2026-04-13-capability-lease-expiring-agent-permissions-trend/)가 왜 단순 allowlist보다 좁은 범위와 짧은 TTL을 강조하는지와도 연결됩니다.

## 실무 적용

### 1) 어떤 팀이 먼저 검토해야 하나

아래 조건 중 2개 이상이면 분리형 하네스를 한 번은 검토할 가치가 큽니다.

- 조직 단위로 여러 사용자가 같은 에이전트를 쓴다
- 세션 길이가 자주 **30분 이상**으로 길다
- 승인, 메모리, 실행 증거를 세션 밖에서도 조회해야 한다
- 샌드박스가 실제 명령 실행보다 idle 상태로 머무는 시간이 길다
- 자격증명을 샌드박스에 넣는 구조가 점점 불편해진다

반대로 1인용 로컬 에이전트, 짧은 세션, 공유 메모리 없음, read-only 중심 작업이라면 inside 구조가 더 낫습니다. 구조 분리는 목적이 아니라 비용이기 때문입니다.

### 2) 추천 시작 숫자

처음부터 완벽한 제어 평면을 만들 필요는 없습니다. 다만 아래 숫자는 먼저 고정하는 편이 좋습니다.

- `sandbox_resume_p95`: **100ms 이하** 목표
- `idle_ratio`: **50~60% 이상**이면 suspend/resume 후보
- `session_rehydrate_success_rate`: **99% 이상**
- `shared_memory_conflict_rate`: 초기에는 **1% 이하**를 목표로 보고, 초과 시 충돌 정책 설계
- `credential_in_sandbox_count`: 가능하면 **0** 목표
- `agent_step_loss_after_deploy`: **0** 목표

이 숫자가 없으면 구조를 바꾼 뒤 좋아졌는지 나빠졌는지 판단하기 어렵습니다.

### 3) 도입 순서

가장 안전한 순서는 보통 이렇습니다.

1. **승인/증거/메모리부터 샌드박스 밖으로 이동**
2. read/write 경로를 가상화할 최소 인터페이스 정리
3. 세션 checkpoint와 재개 흐름 추가
4. 마지막에 sandbox suspend/resume 최적화

많은 팀이 4번부터 하고 싶어 하지만, 실제로는 1~3번이 먼저 닫혀야 샌드박스 수명과 세션 수명을 분리할 수 있습니다. 특히 [Execution Receipt](/posts/2026-04-14-execution-receipt-agent-operations-trend/)와 [Review Ops Unified Human Gate](/posts/2026-04-23-review-ops-unified-human-gate-trend/)까지 붙이려면 승인과 증거는 제어 평면에 있어야 훨씬 다루기 쉽습니다.

### 4) 운영 우선순위

저는 이 구조의 운영 우선순위를 아래 순서로 보는 편이 맞다고 생각합니다.

1. 자격증명과 승인 상태를 샌드박스 밖에 둔다
2. 세션이 배포와 장애를 넘어 살아남게 만든다
3. 공유 메모리 일관성을 최소한 설명 가능하게 만든다
4. sandbox resume 성능을 다듬는다
5. 마지막에 비용 최적화를 한다

많은 팀이 4, 5부터 달리다가 1~3을 나중에 갚습니다. 그런데 Outside-the-Sandbox Harness의 진짜 가치는 절약한 컨테이너 비용보다 **설명 가능한 세션 경계**에 있습니다.

## 트레이드오프/주의점

첫째, **분리형 하네스는 구조적으로 더 복잡합니다.** 단일 사용자 로컬 도구라면 그 복잡성이 과할 수 있습니다.

둘째, **shared memory consistency는 생각보다 빨리 아픈 문제입니다.** 마지막 기록 승리(last-writer-wins)로 시작할 수는 있어도, 중요한 운영 메모리까지 같은 규칙으로 두면 나중에 깨질 가능성이 큽니다.

셋째, **bash는 늘 새는 구멍이 됩니다.** 구조화된 read/write는 가상화해도 셸 명령은 우회 가능성이 있어서 별도 가드가 필요합니다.

넷째, **샌드박스를 쉽게 교체할 수 있어도 workspace 재수화 전략이 약하면 체감은 오히려 나빠집니다.** resume이 빨라도 필요한 파일, 캐시, 도구 상태가 제때 안 살아나면 사용자는 더 느리게 느낍니다.

다섯째, **모델 성능이 좋아져도 이 문제는 사라지지 않습니다.** 승인, 권한, 메모리, 내구성은 운영 구조 문제라서 모델 IQ보다 아키텍처 차이가 더 크게 드러납니다.

## 실패 신호와 롤백 기준

Outside-the-Sandbox Harness를 도입할 때는 "이상이 생기면 무엇을 되돌릴지"를 미리 적어 두는 편이 좋습니다. 분리형 구조가 어려운 이유는 장애가 났을 때 샌드박스, 제어 평면, 메모리 저장소 중 어디가 원인인지 한 번에 안 보이기 때문입니다.

제가 실무에서 먼저 적는 롤백 기준은 대체로 아래 4가지입니다.

- `sandbox_resume_p95`가 파일럿 이전 대비 **20% 이상** 악화되면 suspend/resume 최적화는 보류하고, 세션 분리 범위를 줄입니다.
- `session_rehydrate_success_rate`가 **99% 아래**로 떨어지면 즉시 shared memory 확장을 멈추고 승인/증거만 유지합니다.
- 운영자가 세션 상태를 설명하지 못할 정도로 **source of truth가 두 군데 이상** 생기면, 마지막으로 안정적이었던 저장소를 단일 기준으로 되돌립니다.
- bash 우회나 직접 파일 접근 때문에 제어 평면 정책이 반복적으로 무시되면, 경로 가상화보다 먼저 **권한 lease 축소**와 **명령 실행 가드**를 다시 세웁니다.

여기서 중요한 건 롤백을 실패로 보지 않는 태도입니다. 오히려 샌드박스 밖 하네스는 작은 단위로 떼어내고, 숫자가 나빠지면 한 단계 되돌리는 식으로 가야 정상입니다. 특히 멀티유저 전환 전에 이 기준이 없으면, 구조가 좋아진 것처럼 보여도 실제로는 운영자가 설명할 수 없는 상태만 늘어날 수 있습니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 세션 루프와 툴 실행 환경이 현재 어떻게 결합돼 있는지 그렸다.
- [ ] 승인, 메모리, 증거, 자격증명 중 무엇을 샌드박스 밖으로 먼저 뺄지 우선순위를 정했다.
- [ ] `sandbox_resume_p95`, `session_rehydrate_success_rate`, `idle_ratio`를 측정한다.
- [ ] `approval_lookup_p95`, `receipt_write_failure_rate`처럼 제어 평면 지표도 같이 본다.
- [ ] bash 또는 셸 경로 우회를 탐지하거나 제한하는 규칙이 있다.
- [ ] shared memory 충돌 시 정책(last-writer-wins, merge, human gate)을 문서화했다.
- [ ] 세션 배포 중단이나 샌드박스 교체 후 손실 없이 이어지는지 복구 테스트를 했다.
- [ ] 수치가 나빠졌을 때 어느 책임을 다시 샌드박스 안으로 되돌릴지 롤백 순서를 적어 두었다.

### 연습 과제

1. 현재 에이전트 워크플로를 `세션 제어 평면`과 `실행 샌드박스`로 나눠 그려 보세요. 어떤 책임이 섞여 있는지 바로 드러날 가능성이 큽니다.
2. 최근 10개 세션을 골라 실제로 샌드박스가 필요한 단계와 필요 없는 단계를 분류해 보세요. idle ratio가 생각보다 높을 수 있습니다.
3. 메모리, 승인, 증거 중 하나를 샌드박스 파일이 아니라 제어 평면 저장소로 올린다고 가정하고, 읽기/쓰기 인터페이스를 어떻게 유지할지 설계해 보세요.
4. bash 우회, 메모리 충돌, 세션 재개 실패를 각각 1개씩 상정해 runbook 초안을 적어 보세요.

## 관련 글

- [Harness Engineering](/posts/2026-04-09-harness-engineering-agent-runtime-frame-trend/)
- [Stateful Sandbox Snapshot](/posts/2026-04-11-stateful-sandbox-snapshot-environment-replay-trend/)
- [Capability Lease](/posts/2026-04-13-capability-lease-expiring-agent-permissions-trend/)
- [Execution Receipt](/posts/2026-04-14-execution-receipt-agent-operations-trend/)
- [Agent Handoff Packet](/posts/2026-04-17-agent-handoff-packet-runtime-trend/)
- [Review Ops Unified Human Gate](/posts/2026-04-23-review-ops-unified-human-gate-trend/)
