---
title: "2026 개발 트렌드: Dependency Budget, AI가 만든 ‘작은 import’를 운영 비용으로 계산하기"
date: 2026-10-18T10:06:00+09:00
lastmod: 2026-10-18T10:06:00+09:00
draft: false
tags: ["AI Coding", "Dependency Management", "Software Supply Chain", "Developer Productivity", "Platform Engineering"]
categories: ["Development", "AI", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["dependency budget", "AI generated dependencies", "software supply chain governance", "dependency review", "package adoption policy"]
description: "AI 코딩 도구가 추가하는 패키지를 단순한 구현 편의가 아니라 보안·호환성·빌드·운영 비용을 가진 변경으로 심사하는 Dependency Budget 운영 기준을 정리합니다."
summary: "에이전트는 몇 줄의 코드를 줄이기 위해 새 라이브러리를 제안하기 쉽다. 하지만 의존성 하나는 transitive package, release 권한, 취약점 대응, runtime footprint, 업그레이드 책임을 함께 들인다. Dependency Budget은 import를 막는 규칙이 아니라 이 비용을 변경 전부터 드러내는 팀의 의사결정 방식이다."
key_takeaways:
  - "새 dependency는 코드 라인 수를 줄여도 공급망·운영·호환성 비용을 추가하는 architecture change다."
  - "AI 생성 PR은 dependency 변경을 별도 gate로 분리해야, 기능 diff에 묻힌 lockfile·install script·권한 확대를 놓치지 않는다."
operator_checklist:
  - "PR에서 manifest와 lockfile 변경을 기능 코드와 별도 요약으로 제시하고, 새 직접 의존성의 목적·대안·owner·제거 조건을 남긴다."
  - "install script, native addon, 새 network client, broad filesystem access가 생기면 low-risk change로 자동 분류하지 않는다."
---

AI 코딩 도구는 반복적인 구현을 빠르게 끝내는 데 강합니다. 다만 “날짜 포맷 하나는 이 package로”, “재시도는 이 client로”, “validation은 이 SDK로” 같은 제안은 기능 diff에서는 작아 보여도 운영에는 오래 남습니다. 새 dependency는 코드 몇 줄을 줄이는 대신 transitive dependency, registry 신뢰, release cadence, 취약점 알림, 빌드 시간, binary 크기, 라이선스, 담당자와 제거 비용을 들여옵니다.

그래서 최근의 실무 논점은 AI가 라이브러리를 추천하는가가 아니라, **새 import를 어떤 근거로 제품의 장기 비용으로 승인할 것인가**에 있습니다. 여기서 Dependency Budget은 패키지 수를 무조건 줄이는 금욕 규칙이 아닙니다. 팀이 감당할 수 있는 신뢰 경계와 유지보수량을 명시하고, 작은 편의가 큰 공급망 변경을 숨기지 못하게 만드는 운영 계약입니다. [패키지 릴리스 Quarantine Gate](/posts/2026-05-12-package-release-quarantine-gate-trend/), [실행 도달성 기반 취약점 우선순위](/posts/2026-10-15-runtime-reachability-evidence-vulnerability-prioritization-trend/), [저장소별 AI 코딩 에이전트 평가](/posts/2026-10-17-ai-coding-agent-repository-evaluation-contract-trend/), [의존성 업데이트 파이프라인](/posts/2026-05-07-dependency-update-pipeline-trend/)을 하나의 PR 판단으로 묶어 보겠습니다.

## 이 글에서 얻는 것

- direct dependency와 transitive dependency가 서로 다른 운영 비용을 만드는 이유를 이해합니다.
- AI 생성 변경에서 dependency 추가를 별도 review gate로 다루는 방법을 배웁니다.
- 단순 패키지 개수 대신 위험·소유권·업데이트 가능성을 포함한 예산 지표를 만듭니다.
- 새 라이브러리를 허용할 조건과 표준 라이브러리·기존 플랫폼 기능을 우선할 조건을 구분합니다.

## 핵심 개념/이슈

### 1) import 하나는 새 실행 경로를 만든다

직접 package 하나가 lockfile에서 수십 개의 간접 package를 끌고 올 수 있습니다. 그중에는 install lifecycle script, native binary, optional dependency, 다른 network client, 별도 telemetry, 지원 종료된 runtime 제약이 섞일 수 있습니다. 코드 리뷰에서 `import helper from 'x'` 한 줄만 보면 이런 변화는 보이지 않습니다.

또한 “이미 널리 쓰이는 package”라는 말은 도입의 시작 신호일 뿐 승인 근거는 아닙니다. 이 서비스의 runtime에서 실제로 실행되는지, 기존 라이브러리나 표준 API로 같은 문제를 풀 수 없는지, 취약점이 나왔을 때 누가 며칠 안에 올릴지, 서비스 크기와 cold start 예산을 침범하지 않는지를 따로 봐야 합니다. 특히 AI는 저장소의 내부 공용 모듈을 발견하지 못하거나, 한 번 쓰기 편한 wrapper를 새로 들이는 방식으로 중복을 만들 수 있습니다.

### 2) Dependency Budget은 숫자 하나가 아니다

`dependencies: 100개 이하` 같은 규칙은 신호가 될 수 있지만, 1개의 native addon과 10개의 순수 utility package를 같은 위험도로 볼 수는 없습니다. 예산은 최소 네 축을 함께 기록하는 편이 실용적입니다.

| 축 | PR에서 볼 질문 | 출발 기준 |
| --- | --- | --- |
| 필요성 | 표준 라이브러리·기존 공용 모듈로 해결 가능한가 | 대안이 있으면 새 direct dependency 보류 |
| 공격면 | install script, native code, 네트워크·파일 접근이 추가되는가 | 하나라도 추가되면 보안 검토 대상으로 승격 |
| 운영성 | owner, update policy, 지원 runtime, rollback이 있는가 | owner·제거 조건 없으면 승인하지 않음 |
| 비용 | transitive 증가, artifact 크기, build/cold-start 영향은 어떤가 | baseline보다 10% 이상 악화 시 근거와 관찰 기간 필요 |

이 표는 특정 수치를 강제하려는 것이 아닙니다. 팀이 “코드가 짧아졌다”와 “시스템이 단순해졌다”를 혼동하지 않게 하는 장치입니다. 검증 라이브러리 하나가 input boundary를 안전하게 만들고 자체 구현의 버그를 줄인다면 예산을 쓸 만합니다. 반대로 문자열 하나를 다듬기 위해 유지보수자 없는 package와 40개의 transitive dependency를 추가한다면, 구현 편의보다 장기 책임이 큽니다.

### 3) AI 변경은 dependency diff를 더 잘 보이게 해야 한다

AI agent의 patch가 기능 테스트를 통과해도 dependency decision까지 옳았다는 뜻은 아닙니다. agent는 현재 task에 필요한 코드만 최적화하고, 다음 분기의 취약점 패치·라이선스 검토·runtime upgrade 비용은 보지 못할 수 있습니다. 따라서 manifest나 lockfile이 바뀐 PR에는 기능 설명과 별도로 아래 레코드를 요구하는 편이 좋습니다.

```yaml
dependency_change:
  direct_package: "example-validator"
  purpose: "외부 request 경계의 schema parse"
  alternatives_checked: ["기존 validation module", "표준 library"]
  transitive_delta: 12
  privileged_behavior: "no install script; no native addon"
  owner: "api-platform"
  removal_trigger: "공용 validator 통합 시 제거"
  verification: ["lockfile diff", "license scan", "cold-start comparison"]
```

이 정보는 양식을 채우기 위한 양식이 아닙니다. reviewer가 “새 기능”과 “새 신뢰 경계”를 분리해 판단하고, 6개월 뒤 package를 제거할 사람을 찾게 해 줍니다. 자동 생성할 수 있는 항목은 CI가 채우되, 필요성과 대안·owner는 변경자가 책임지는 편이 낫습니다.

## 실무 적용

### 1) 세 단계 gate로 시작한다

첫 단계는 **가시화**입니다. CI가 direct/indirect delta, 새 registry host, lifecycle script, license, artifact 크기, 알려진 취약점을 PR에 표시하게 합니다. 이 단계에서는 차단보다 누락 없는 정보를 목표로 합니다.

둘째는 **위험 분리**입니다. 순수한 작은 utility라도 owner와 제거 기준은 요구하되, native addon·install script·새 network egress·권한 있는 CLI를 넣는 변경은 보안·플랫폼 검토로 보냅니다. 기능 코드 20줄과 동일한 승인 경로에 두면 위험한 package가 빨리 통과합니다.

셋째는 **제거 가능성**입니다. 분기마다 직접 dependency 중 호출이 없는 항목, 90일 이상 업데이트가 밀린 고위험 항목, owner 없는 항목을 점검합니다. 새 항목을 줄이는 일만큼 이미 들어온 의존성을 정리하는 일이 중요합니다. dependency 수가 줄어도 lockfile의 취약한 transitive package가 남는다면 성공으로 보지 마세요.

### 2) 확대·중단 기준을 명시한다

다음은 첫 4주 파일럿의 예시입니다.

- dependency 변경 PR의 **100%**에 목적·대안·owner·검증 결과가 있어야 합니다.
- install script, native addon, 새 외부 host, privileged CLI가 포함된 변경은 **0건 무검토 병합**을 유지합니다.
- AI가 만든 dependency PR은 같은 기능을 기존 모듈로 구현한 대안과 비교해, test·artifact·운영 비용 중 한 가지 이상의 측정 가능한 이득을 보여야 합니다.
- artifact 크기, build p95, cold start 중 하나가 baseline보다 **10% 이상** 나빠지면 rollout을 멈추고 필요성을 다시 검토합니다.
- owner가 없는 direct dependency 또는 **90일** 넘게 security update가 막힌 high-risk dependency는 정리 backlog가 아니라 risk register에 올립니다.

수치는 서비스의 배포 빈도와 언어 생태계에 맞춰 조정해야 합니다. 중요한 것은 완벽한 점수보다, 승인 기준과 중단 조건이 코드 작성 속도보다 먼저 있다는 사실입니다.

### 3) 플랫폼 팀은 금지 목록보다 안전한 대안을 만든다

개발자가 새 package를 찾는 이유는 대개 기존 경로가 발견하기 어렵거나 쓰기 불편하기 때문입니다. “추가 금지”만 외치면 이름만 다른 package, 복사한 유틸리티, vendoring으로 문제를 옮길 수 있습니다. 인증 HTTP client, schema validation, retry, 날짜 처리, logging처럼 반복되는 영역에는 지원 runtime과 owner가 명확한 공용 모듈·golden path를 제공하세요.

AI agent에도 이 정보를 context로 주어야 합니다. 허용된 package 목록, 내부 표준 모듈, 금지된 runtime API, dependency 변경 시 실행할 검사 명령을 repository instruction에 짧게 넣으면, reviewer가 나중에 되돌리는 제안 자체를 줄일 수 있습니다. 이것은 agent의 창의성을 억제하는 일이 아니라 변경 비용의 경계를 정확히 알려 주는 일입니다.

## 트레이드오프/주의점

Dependency Budget을 지나치게 엄격하게 적용하면 보안이 검증된 라이브러리 대신 자체 구현을 부추길 수 있습니다. 암호화, parser, 인증, 검증처럼 직접 구현의 실패 비용이 큰 영역은 검증된 dependency가 오히려 위험을 낮춥니다. 따라서 기본 우선순위는 **문제의 안전한 해결 → 명확한 owner와 provenance → 작은 transitive/권한 면적 → 성능·크기 → 편의성**으로 두는 편이 좋습니다.

반대로 SCA가 깨끗하다는 결과도 면허증은 아닙니다. 알려진 CVE가 없어도 maintainer 권한 변경, 오염된 publish pipeline, runtime에서의 과도한 네트워크·파일 접근은 남습니다. package 채택과 취약점 patch를 같은 체크 하나로 합치지 말고, 도입 전 신뢰 판단과 도입 후 도달성·업데이트 운영을 분리하세요.

## 체크리스트 또는 연습

- [ ] manifest와 lockfile 변경을 PR의 별도 dependency summary로 표시한다.
- [ ] 새 direct dependency마다 목적, 대안, owner, 제거 조건을 기록한다.
- [ ] install script, native addon, 새 egress, privileged CLI는 자동 low-risk로 분류하지 않는다.
- [ ] artifact 크기·build p95·cold start·transitive delta 중 해당되는 지표를 baseline과 비교한다.
- [ ] AI agent가 읽는 저장소 지침에 표준 모듈과 dependency 검증 명령을 넣는다.
- [ ] 분기마다 unused, ownerless, 업데이트 지연 dependency를 실제 제거 후보로 검토한다.

연습으로 최근 PR 하나를 골라 lockfile의 변경을 코드 diff와 분리해서 읽어 보세요. 새 package가 없더라도 transitive version, registry URL, lifecycle script가 바뀌었는지 적습니다. 같은 기능을 기존 표준 모듈로 구현했을 때의 코드·test·artifact 비용을 비교해 보세요. “라이브러리를 썼다”가 아니라 “무엇을 신뢰하고 누가 계속 책임지는가”를 설명할 수 있으면 Dependency Budget이 작동하기 시작한 것입니다.

## 관련 글

- [패키지 릴리스 Quarantine Gate](/posts/2026-05-12-package-release-quarantine-gate-trend/)
- [Runtime Reachability Evidence로 취약점 우선순위 정하기](/posts/2026-10-15-runtime-reachability-evidence-vulnerability-prioritization-trend/)
- [AI 코딩 에이전트의 저장소별 실행 계약](/posts/2026-10-17-ai-coding-agent-repository-evaluation-contract-trend/)
- [의존성 업데이트 파이프라인](/posts/2026-05-07-dependency-update-pipeline-trend/)
