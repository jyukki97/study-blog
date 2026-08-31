---
title: "2026 개발 트렌드: Agent Plugin과 MCP Allowlist, 확장 생태계의 단위가 패키지에서 실행 계약으로 바뀐다"
date: 2026-08-22T10:06:00+09:00
lastmod: 2026-08-22T10:06:00+09:00
draft: false
tags: ["Agent Plugins", "MCP", "AI Coding", "Developer Tools", "Platform Engineering", "Supply Chain Security"]
categories: ["Development", "AI", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["Agent Plugins 1.0", "MCP allowlist", "agent extension governance", "managed settings", "AI developer tool policy"]
description: "Agent Plugins 1.0, GitHub Copilot의 MCP allowlist와 agent app usage metrics 흐름을 바탕으로, 에이전트 확장을 패키지 설치가 아니라 실행 권한·출처·관측이 결합된 계약으로 운영하는 방법을 정리합니다."
summary: "하나의 플러그인이 여러 에이전트 클라이언트에서 skill과 MCP server를 함께 배포하게 되면서, 설치 승인만으로는 부족해졌습니다. 어떤 서버가 어떤 명령·URL·권한으로 실행되고 누가 얼마나 쓰는지까지 관리해야 합니다."
key_takeaways:
  - "Agent Plugins 1.0은 skill과 MCP server 구성을 하나의 이식 가능한 패키지로 묶어, 확장 배포 범위를 여러 에이전트 클라이언트로 넓힌다."
  - "플러그인 marketplace allowlist와 MCP server allowlist는 다른 통제다. 전자는 획득 경로, 후자는 실제 실행 endpoint·명령을 제한한다."
  - "도입 의사결정은 설치 수가 아니라 plugin별 실행 권한, 실행 빈도, 실패율, 비용, 사람 승인 비율로 내려야 한다."
operator_checklist:
  - "플러그인마다 publisher, digest/version, 포함 skill, MCP URL·명령, 필요한 credential, write capability를 inventory로 만든다."
  - "새 marketplace는 기본 차단하고, approved plugin과 approved MCP server를 별도 allowlist로 운영한다."
  - "원격 MCP URL은 scheme·host·path 기준으로, 로컬 MCP는 명령과 인자를 정확히 match한다. 표시 이름만으로 승인하지 않는다."
  - "월 1회 미사용 plugin, unknown MCP connection, 권한이 넓어진 새 version을 제거 또는 재승인한다."
learning_refs:
  - title: "Agent Resource Provenance Gate"
    href: "/posts/2026-07-13-agent-resource-provenance-gate-trend/"
    description: "AI가 제안한 URL·패키지·스킬을 실행 전에 검증하는 기준입니다."
  - title: "Team-Scoped AI Governance"
    href: "/posts/2026-08-04-team-scoped-ai-governance-managed-settings-trend/"
    description: "조직 기본 정책과 팀별 예외를 분리하는 방법입니다."
  - title: "Managed Dev-Tool Telemetry Plane"
    href: "/posts/2026-07-09-managed-dev-tool-telemetry-plane-trend/"
    description: "개발 도구 telemetry를 운영 경계로 다루는 흐름입니다."
  - title: "Agentic Development Surface Convergence"
    href: "/posts/2026-07-27-agentic-development-surface-convergence-trend/"
    description: "IDE·CLI·앱·클라우드 에이전트가 같은 작업 표면으로 합쳐지는 변화를 다룹니다."
---

AI 코딩 도구의 확장은 이제 “IDE에 편리한 플러그인 하나를 설치한다”는 수준을 넘고 있습니다. 8월 6일 공개된 Agent Plugins 1.0은 skill과 MCP server 구성을 하나의 이식 가능한 패키지로 묶고, 8월 12일 GitHub Copilot은 이를 VS Code, Copilot CLI, Copilot app에서 지원한다고 발표했습니다. 그 다음 질문은 배포가 아니라 운영입니다. 같은 패키지가 여러 클라이언트에서 skill을 읽고 MCP server를 실행할 수 있다면, 그 패키지는 문서 묶음이 아니라 **권한과 네트워크·로컬 실행을 함께 운반하는 실행 계약**입니다.

GitHub은 8월 6일 enterprise managed settings에 `allowedMcpServers`와 `deniedMcpServers`를 추가했습니다. URL, 로컬 command와 argument, 이름 기준의 matcher로 MCP server를 제어하며, 형식을 검증할 수 없으면 허용하지 않는 fail-closed 정책입니다. 8월 7일에는 agent app별 activity를 usage metrics API에서 분리해 볼 수 있게 했고, 8월 18일에는 JetBrains에도 plugin governance, MCP allowlist, OpenTelemetry, permission mode를 확장했습니다. 이 흐름을 한 문장으로 요약하면 이렇습니다. **에이전트 확장은 marketplace에서 고르는 제품이 아니라, 출처·실행 경로·권한·사용 증거를 같이 관리해야 하는 운영 자산이 되고 있다.**

이 글은 [Agent Resource Provenance Gate](/posts/2026-07-13-agent-resource-provenance-gate-trend/), [Team-Scoped AI Governance](/posts/2026-08-04-team-scoped-ai-governance-managed-settings-trend/), [Managed Dev-Tool Telemetry Plane](/posts/2026-07-09-managed-dev-tool-telemetry-plane-trend/), [Agentic Development Surface Convergence](/posts/2026-07-27-agentic-development-surface-convergence-trend/)의 다음 단계입니다. 앞선 글이 리소스 검증, 팀 정책, telemetry, client surface를 각각 다뤘다면, 이번에는 네 요소가 plugin과 MCP를 통해 한 패키지로 만나는 지점을 봅니다.

참고한 공식 신호:

- GitHub Changelog, [Agent Plugins 1.0 in VS Code, Copilot CLI, and the Copilot app](https://github.blog/changelog/2026-08-12-agent-plugins-1-0-in-vs-code-copilot-cli-and-the-copilot-app/)
- GitHub Changelog, [MCP allowlists in enterprise managed settings](https://github.blog/changelog/2026-08-06-mcp-allowlists-in-enterprise-managed-settings/)
- GitHub Changelog, [Copilot usage metrics API adds agent app activity](https://github.blog/changelog/2026-08-07-copilot-usage-metrics-api-adds-agent-app-activity/)
- GitHub Changelog, [Enterprise managed settings in GitHub Copilot for JetBrains](https://github.blog/changelog/2026-08-18-enterprise-managed-settings-in-github-copilot-for-jetbrains/)

## 이 글에서 얻는 것

- Agent Plugin, marketplace, MCP server가 각각 무엇을 통제하는 표면인지 분리할 수 있습니다.
- 플러그인 설치 승인과 MCP 실행 승인 사이에 필요한 정책 계층을 설계할 수 있습니다.
- 확장 도입을 생산성 데모가 아니라 권한·비용·증거 중심의 rollout으로 바꾸는 기준을 얻습니다.

## 핵심 개념/이슈

### 1) 이식성은 편의성인 동시에 blast radius의 확장이다

Agent Plugins 1.0의 장점은 분명합니다. 하나의 패키지에 `skills/`와 `mcp.json`을 두고, 공급자별 확장은 namespace 아래에 두면 여러 호환 클라이언트가 같은 내용을 발견할 수 있습니다. 팀은 manifest와 디렉터리 구조를 복제하지 않아도 되고, runbook과 그 runbook이 호출하는 도구를 함께 배포할 수 있습니다.

하지만 같은 이유로 잘못된 확장의 범위도 넓어집니다. 특정 IDE에서만 테스트한 로컬 command가 CLI나 데스크톱 앱에서도 실행될 수 있고, skill 문서에 든 지시가 여러 agent surface에서 읽힐 수 있습니다. 그러므로 “이 플러그인은 안전한가?”라는 단일 질문보다 아래 네 질문이 정확합니다.

1. **획득**: 누가 어느 marketplace에서 이 버전을 가져오는가?
2. **발견**: 어느 클라이언트가 skill·MCP 설정을 자동으로 읽는가?
3. **실행**: 어떤 URL 또는 command와 argument가 실제 실행되는가?
4. **권한**: credential, repo write, cloud API, 네트워크 egress가 어디까지 결합되는가?

이 네 층은 같은 allowlist로 해결되지 않습니다. publisher를 믿는 것과 해당 버전의 원격 MCP endpoint를 허용하는 것은 별개입니다.

### 2) marketplace allowlist와 MCP allowlist는 서로 대체하지 않는다

`strictKnownMarketplaces`와 `extraKnownMarketplaces` 같은 plugin 정책은 **어디서 패키지를 설치할 수 있는가**를 제한합니다. `enabledPlugins`는 특정 plugin을 자동 활성화하거나 차단할 수 있습니다. 반면 MCP allowlist는 실제 MCP server를 `serverUrl`, `serverCommand`, `serverName`으로 match합니다. GitHub의 안내처럼 이름은 사용자가 바꿀 수 있으므로 편의 신호일 뿐 보안 통제가 아닙니다. 원격 서버는 canonicalized URL로, 로컬 server는 정확한 command와 argument로 묶어야 합니다.

| 통제 대상 | 질문 | 강한 식별자 | 약한 식별자 |
| --- | --- | --- | --- |
| Plugin/marketplace | 어떤 패키지를 받는가 | publisher, version, digest, marketplace | 표시 이름, download 수 |
| MCP server | 무엇을 실제 호출하는가 | HTTPS URL, local command + argument | 사용자가 정한 server name |
| 실행 권한 | 어떤 부수 효과가 가능한가 | credential scope, repo/cloud role, egress rule | "읽기 전용일 것"이라는 설명 |
| 운영 증거 | 누가 얼마나 쓰는가 | stable agent ID, session/job count, audit event | 전체 사용량 합계 |

따라서 정책 순서는 **known marketplace 제한 → 승인 plugin 지정 → 승인 MCP endpoint/command 지정 → 실행 권한 최소화 → telemetry 확인**이 적절합니다. 이 중 하나가 빠지면 나머지가 정상이어도 빈 경로가 생깁니다. 예를 들어 trusted marketplace에서 받은 plugin도 예상하지 못한 remote URL을 포함할 수 있고, URL이 허용되어도 과도한 cloud credential을 들고 실행되면 위험합니다.

### 3) plugin manifest는 SBOM의 시작점이지 최종 증거가 아니다

manifest에는 skill과 MCP 설정이 보이므로 inventory의 좋은 시작점입니다. 그러나 manifest만 보고 “안전”을 판정하면 안 됩니다. 로컬 MCP command가 다시 package manager를 실행하거나, skill이 외부 문서를 읽어 행동을 바꾸거나, endpoint가 redirect 또는 동적 tool discovery를 제공할 수 있기 때문입니다.

실무 inventory는 다음처럼 한 줄로 추적할 수 있어야 합니다.

```yaml
agent_extension:
  plugin: "acme/deploy-helper"
  version: "1.8.3"
  publisher_verified: true
  clients: ["vscode", "cli"]
  mcp_servers:
    - id: "deploy-readonly"
      match: "https://tools.example.com/mcp/v1"
      capability: "read deployment status"
      credential_scope: "deployments:read"
      write_capability: false
  approval_expires_at: "2026-11-20"
```

여기서 `write_capability`가 true이거나 credential이 production 범위를 포함하면, 일반 marketplace approval로 끝내지 말고 별도 owner 승인을 요구해야 합니다. 상태 변경 도구는 read-only 검색 도구보다 위험도가 한 단계 높습니다.

### 4) 사용량은 생산성 홍보 지표가 아니라 권한 회수의 근거다

agent app activity가 agent별로 분리되면 “설치했는가” 대신 “누가 어떤 agent를 몇 번 시작했는가”를 볼 수 있습니다. GitHub의 API는 display name이 바뀔 수 있으므로 stable `agent_id`로 기간별 데이터를 결합하라고 안내합니다. 이 점은 운영상 중요합니다. 이름별 대시보드는 리브랜딩이나 marketplace 표기 변경으로 왜곡될 수 있습니다.

초기 기준은 단순하게 잡아도 됩니다.

- 30일 동안 session 0건인 plugin은 제거 후보로 분류
- 신규 plugin은 10명 이하, read-only scope, 2주 canary에서 시작
- unknown MCP connection은 0건이 목표이며 1건이라도 발견되면 정책·클라이언트 버전을 조사
- plugin별 실패율이 2%를 넘거나 지원 요청이 주 3건을 넘으면 rollout 확대를 멈춤
- write-capable plugin은 월 1회 permission diff와 최근 실행 sample을 review

좋은 지표는 agent의 대화 수가 아니라 **성공 작업당 비용, 승인 거절률, 권한 있는 실행의 감사 가능성, 사람이 되돌린 변경 비율**입니다. 사용이 많아도 rollback이 많거나 알 수 없는 endpoint가 늘면 확장은 성공이 아닙니다.

## 실무 적용

### 1) 4주 rollout을 권한이 낮은 순서로 설계한다

**1주차 — inventory와 차단 기본값.** 현재 설치된 plugin, marketplace, MCP URL·command를 수집합니다. owner와 용도를 알 수 없는 것은 disable 상태로 두고, `strictKnownMarketplaces`와 MCP deny baseline을 먼저 적용합니다.

**2주차 — read-only canary.** 개발자 5~10명에게 검색·문서 조회·상태 확인 같은 read-only 확장만 허용합니다. credential은 최소 scope, egress는 allowlist host만 둡니다. session count, error rate, tool call 대상, latency를 관측합니다.

**3주차 — 팀별 승인.** 효과가 확인된 plugin만 팀별 override로 엽니다. production write 권한은 아직 분리하고, 승인 전후 권한 diff를 PR에 첨부합니다. 팀 중복 소속 때문에 더 넓은 권한이 합쳐지는지도 확인합니다.

**4주차 — 실행형 capability 검토.** deploy, issue write, ticket close처럼 state-changing 도구는 idempotency key, 사람 승인, audit receipt, kill switch가 모두 있을 때만 올립니다. 이 네 조건 중 하나라도 빠지면 read-only로 유지합니다.

### 2) 확장 승인 템플릿을 표준화한다

플러그인마다 긴 보안 문서를 쓰기보다, 승인 PR에 다음 질문을 강제하면 일관성이 생깁니다.

- publisher와 source repository는 무엇이며 version/digest를 고정했는가?
- 포함된 skills와 MCP server의 URL·command·arguments는 무엇인가?
- 로컬 파일, 네트워크, repo, cloud에 필요한 최소 권한은 무엇인가?
- tool이 실패하거나 잘못 호출될 때 되돌릴 수 있는가? kill switch는 있는가?
- 적용 client와 지원하지 않는 client는 무엇인가?
- 사용량·오류·권한 사용을 어떤 stable ID와 telemetry로 확인하는가?

특히 원격 URL은 `https://tools.example.com/mcp/v1`처럼 path까지 관리하고, `*.example.com` 같은 광범위 wildcard는 불가피한 경우에만 승인합니다. 로컬 command도 `node`만 허용하는 대신 실제 script path와 고정 argument까지 match해야 합니다. 실행 파일 이름 하나만 허용하면 인자에 의한 목적지 변경을 놓칠 수 있습니다.

### 3) 플랫폼 팀의 의사결정 우선순위

확장 생태계에서는 기능 다양성보다 경계의 명확성이 중요합니다. 우선순위는 **credential·write 권한 보호 > 실행 경로 검증 > 관측 가능성 > 팀 생산성 > marketplace 선택 폭**으로 두는 편이 낫습니다. 이 순서라면 데모가 좋아도 출처가 불명확하거나 audit가 안 되는 plugin은 보류할 근거가 생깁니다.

## 트레이드오프/주의점

1. **엄격한 allowlist는 실험 속도를 낮춘다.** 그래서 모든 도구를 전사 차단할 필요는 없습니다. sandboxed read-only canary와 만료일 있는 예외를 제공하면 안전과 탐색을 같이 가져갈 수 있습니다.

2. **한 vendor의 정책이 모든 client를 덮는다고 가정하면 안 된다.** 지원되는 IDE·CLI·앱과 정책 적용 시점이 다를 수 있습니다. client coverage를 inventory 필드로 두고 unknown surface를 별도 위험으로 관리해야 합니다.

3. **사용량 API는 결과 품질을 말해 주지 않는다.** session 수는 adoption 신호일 뿐입니다. 테스트 통과율, review rework, rollback, 비용처럼 실제 결과 지표와 합쳐야 합니다.

4. **표준 패키지는 신뢰된 패키지가 아니다.** 이식 가능한 manifest는 배포 형식을 맞출 뿐 publisher 신뢰, dependency provenance, prompt injection, egress 안전성을 자동으로 보장하지 않습니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] plugin marketplace와 MCP server allowlist를 별도 정책으로 운영한다.
- [ ] remote MCP URL은 URL, local MCP는 command와 argument 기준으로 승인한다.
- [ ] write-capable 확장은 credential scope, 사람 승인, audit receipt, kill switch를 모두 갖춘다.
- [ ] client별 정책 적용 범위와 미지원 surface를 inventory에 기록한다.
- [ ] agent ID 기준 usage, 오류, 권한 사용을 30일 단위로 검토한다.
- [ ] 미사용·미소유·unknown endpoint 확장은 disable 또는 재승인한다.

### 연습

1. 현재 조직에서 쓰는 agent plugin 하나를 골라 publisher, version, 포함 MCP, 실행 command/URL, 권한, kill switch를 6열 표로 작성해 보세요.
2. 새 MCP server를 read-only로 2주 canary 한다고 가정하고, 허용할 host/path와 거절할 command·권한을 명시해 보세요.
3. 30일 사용량 데이터에서 session은 많지만 rollback이 잦은 plugin을 찾았다고 가정하고, 유지·권한 축소·중단 중 어떤 결정을 할지 지표 임계값과 함께 적어 보세요.

## 관련 글

- [Agent Resource Provenance Gate](/posts/2026-07-13-agent-resource-provenance-gate-trend/)
- [Team-Scoped AI Governance](/posts/2026-08-04-team-scoped-ai-governance-managed-settings-trend/)
- [Managed Dev-Tool Telemetry Plane](/posts/2026-07-09-managed-dev-tool-telemetry-plane-trend/)
- [Agentic Development Surface Convergence](/posts/2026-07-27-agentic-development-surface-convergence-trend/)
