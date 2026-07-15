---
title: "2026 개발 트렌드: AI Security Review Control Loop, 보안 탐지·수정·검증이 PR 안으로 들어온다"
date: 2026-07-15T10:06:00+09:00
draft: false
tags: ["AI Security", "Code Scanning", "Copilot", "Secure SDLC", "Application Security", "Platform Engineering"]
categories: ["Development", "Security", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["AI security review", "code scanning", "agentic autofix", "secure SDLC", "pull request security"]
description: "GitHub의 AI security detections, Copilot /security-review, agentic autofix 흐름을 바탕으로 보안 리뷰가 IDE와 PR 안의 탐지·수정·검증 루프로 이동하는 변화를 정리합니다."
lastmod: 2026-07-15
summary: "AI 보안 도구는 장문 리포트 생성에서 IDE·PR 안의 control loop로 이동하고 있습니다. 탐지, 수정, 재검증, 비용, human gate를 한 흐름으로 묶지 않으면 보안 신호는 개발 속도를 높이는 대신 노이즈와 잘못된 자동수정을 늘립니다."
key_takeaways:
  - "GitHub의 2026년 7월 업데이트들은 AI 보안 탐지가 PR annotation, Copilot app slash command, agentic autofix PR로 이동하고 있음을 보여준다."
  - "실무 핵심은 AI가 찾고 고치는 것이 아니라 finding provenance, 재현 테스트, CodeQL 재검증, credit/Actions 비용, human approval을 하나의 control loop로 묶는 것이다."
  - "AI 보안 리뷰는 기존 SAST를 대체하기보다 CodeQL, dependency scan, secret scanning이 못 보는 영역을 보완하는 보조 신호로 운영해야 한다."
operator_checklist:
  - "AI security finding은 CodeQL 결과와 구분되는 label, confidence, affected file, reproduction evidence, owner를 가진 ticket 또는 PR comment로 받는다."
  - "agentic autofix PR은 재현 테스트와 재검증 로그가 없으면 merge gate를 통과하지 못하게 한다."
  - "AI credits, Actions minutes, false positive rate, patch verification pass rate를 보안 리뷰 운영 지표에 포함한다."
learning_refs:
  - title: "AI Vulnerability Triage Pipeline"
    href: "/posts/2026-05-13-ai-vulnerability-triage-pipeline-trend/"
    description: "AI가 만든 취약점 후보를 운영 가능한 triage packet으로 바꾸는 기준입니다."
  - title: "Test Evidence Pipeline"
    href: "/posts/2026-04-10-test-evidence-pipeline-ai-change-review-trend/"
    description: "AI가 만든 수정 PR에 검증 증거를 붙이는 리뷰 구조입니다."
  - title: "Security Triage Context Plane"
    href: "/posts/2026-07-08-security-triage-context-plane-trend/"
    description: "보안 후보를 owner, 영향 범위, 정책 맥락과 함께 라우팅하는 운영 관점입니다."
  - title: "Agentic PR Governance"
    href: "/posts/2026-05-25-agentic-pr-governance-trend/"
    description: "에이전트가 연 PR을 사람 리뷰와 정책 게이트 안에 넣는 기준입니다."
decision_guide:
  title: "AI Security Review Control Loop를 어디부터 적용할까"
  intro: "모든 PR에 무작정 AI 보안 리뷰를 붙이면 비용과 노이즈가 먼저 늘 수 있습니다. 코드 위험도, 기존 스캔 공백, 보안팀 처리량을 기준으로 단계 적용해야 합니다."
  cases:
    - badge: "즉시 적용"
      title: "인증·권한·파일 처리·결제·테넌트 경계 코드"
      fit: "작은 결함이 데이터 유출, 권한 상승, 금전 손실로 이어지는 영역입니다."
      watchouts: "자동수정이 정상 권한 경로나 기존 고객 플로우를 깨뜨릴 수 있습니다."
      next_step: "AI review는 PR annotation까지만 열고, autofix는 draft PR + 보안 owner 승인으로 시작합니다."
    - badge: "부분 적용"
      title: "CodeQL 지원이 약한 언어·프레임워크가 섞인 저장소"
      fit: "기존 정적 분석 커버리지가 낮아 blind spot이 큰 코드베이스입니다."
      watchouts: "AI finding label을 CodeQL finding과 섞으면 신뢰도와 차단 정책이 흐려집니다."
      next_step: "AI finding을 informational로 받고 2~4주 precision과 confirmed rate를 측정합니다."
    - badge: "보류"
      title: "기본 SAST·secret scan·dependency scan도 안정화되지 않은 팀"
      fit: "기본 보안 게이트가 없거나 PR 리뷰 SLA가 없는 초기 단계입니다."
      watchouts: "AI 리뷰를 먼저 붙이면 처리 큐가 무너지고 개발자는 알림을 무시합니다."
      next_step: "기본 스캔과 owner routing을 먼저 안정화한 뒤 high-risk path부터 실험합니다."
faqs:
  - question: "AI security detections가 CodeQL을 대체하나요?"
    answer: "아닙니다. GitHub 설명 기준으로도 AI detections는 CodeQL 기본 분석이 켜진 저장소에서 동작하지만 CodeQL 자체가 수행하는 분석은 아닙니다. 기존 정적 분석을 보완하는 신호로 봐야 합니다."
  - question: "agentic autofix PR은 자동 merge해도 되나요?"
    answer: "초기에는 권장하지 않습니다. 재현 테스트, CodeQL 재검증, 변경 범위 설명, 보안 owner 승인을 갖춘 draft PR로 처리하고, 반복 패턴에서만 자동화 수준을 올리는 편이 안전합니다."
---

AI 보안 도구의 위치가 바뀌고 있습니다. 몇 달 전만 해도 관심은 "AI가 취약점을 잘 찾는가"에 가까웠습니다. 이제는 그 다음 단계가 보입니다. 탐지는 pull request에 직접 표시되고, 개발자는 IDE나 Copilot app에서 `/security-review`를 실행하며, 이미 열린 code scanning alert는 에이전트에게 할당해 수정 PR까지 만들 수 있습니다. 보안 리뷰가 별도 포털이나 릴리스 직전 체크리스트가 아니라 **개발자가 코드를 바꾸는 바로 그 루프** 안으로 들어오는 흐름입니다.

2026년 7월 14일 GitHub는 code scanning에서 AI-powered security detections를 PR에 직접 표시하는 공개 프리뷰를 알렸습니다. 같은 날 Copilot app에는 현재 작업 중인 변경분을 대상으로 `/security-review`를 실행하는 기능이 공개 프리뷰로 추가됐습니다. 앞선 7월 10일에는 code scanning alert를 Copilot에 할당하면 관련 파일을 탐색하고 수정안을 만들고 CodeQL을 다시 실행해 alert가 닫히는지 검증한 뒤 draft PR을 여는 agentic autofix가 공개 프리뷰로 소개됐습니다. 각각은 작은 기능처럼 보이지만, 함께 보면 방향이 분명합니다. **AI 보안은 리포트 생성기가 아니라 탐지·수정·검증 control loop로 제품화되고 있습니다.**

이 글은 [AI Vulnerability Triage Pipeline](/posts/2026-05-13-ai-vulnerability-triage-pipeline-trend/), [Test Evidence Pipeline](/posts/2026-04-10-test-evidence-pipeline-ai-change-review-trend/), [Security Triage Context Plane](/posts/2026-07-08-security-triage-context-plane-trend/), [Agentic PR Governance](/posts/2026-05-25-agentic-pr-governance-trend/)와 이어집니다. 이전 글들이 AI 보안 후보를 어떻게 판정하고 PR을 어떻게 통제할지 다뤘다면, 이번 글은 그 흐름이 IDE, PR, code scanning, agentic autofix로 좁아지는 운영 변화를 봅니다.

참고 신호:

- GitHub Changelog, Code scanning shows AI security detections on pull requests: https://github.blog/changelog/2026-07-14-code-scanning-shows-ai-security-detections-on-pull-requests/
- GitHub Changelog, Security reviews now available in the GitHub Copilot app: https://github.blog/changelog/2026-07-14-security-reviews-now-available-in-the-github-copilot-app/
- GitHub Changelog, Agentic autofix for code scanning alerts in public preview: https://github.blog/changelog/2026-07-10-agentic-autofix-for-code-scanning-alerts-in-public-preview/
- GitHub Changelog, CodeQL 2.26.0 adds Kotlin 2.4.0 support and AI prompt injection detection: https://github.blog/changelog/2026-07-10-codeql-2-26-0-adds-kotlin-2-4-0-support-and-ai-prompt-injection-detection/

## 이 글에서 얻는 것

- AI 보안 리뷰가 왜 별도 보안 리포트에서 PR·IDE 안의 control loop로 이동하는지 이해합니다.
- AI detections, `/security-review`, agentic autofix, CodeQL 재검증의 역할을 분리할 수 있습니다.
- 도입 시 confirmed rate, false positive, patch verification, AI credit, Actions minutes를 어떤 기준으로 볼지 정리합니다.
- 자동 수정 수준을 어디까지 허용하고 어디서 human gate를 걸어야 하는지 판단 기준을 가져갑니다.

## 핵심 개념/이슈

### 1) 보안 탐지가 PR annotation으로 들어오면 처리 방식이 달라진다

기존 SAST 결과는 별도 security tab, 주간 리포트, 보안팀 큐에서 발견되는 경우가 많았습니다. 이 방식은 중앙 관리에는 좋지만 개발자 행동과 거리가 생깁니다. 개발자는 이미 다음 작업으로 넘어간 뒤 알림을 받고, 보안팀은 owner를 찾느라 시간을 씁니다. 반대로 PR 안에 finding이 붙으면 맥락이 살아 있습니다. 어떤 변경이 어떤 위험을 만들었는지, 리뷰어가 바로 볼 수 있습니다.

GitHub의 AI security detections는 CodeQL이 기본으로 지원하지 않는 언어와 프레임워크의 blind spot을 줄이는 방향으로 설명됩니다. 결과는 PR에 표시되고, AI가 생성한 alert는 `AI` label로 구분됩니다. 이 구분이 중요합니다. AI finding은 유용한 신호지만 CodeQL rule과 같은 운영 신뢰도를 가진다고 가정하면 안 됩니다. 초기에는 informational로 받고, false positive와 confirmed rate를 측정한 뒤 차단 정책을 결정하는 편이 안전합니다.

초기 분류 기준은 아래처럼 둘 수 있습니다.

| finding source | 기본 처리 | merge 영향 |
| --- | --- | --- |
| CodeQL high/critical | 기존 ruleset 기준 | block 가능 |
| Secret scanning confirmed | 즉시 revoke/rotate | block 또는 incident |
| Dependency critical vuln | 정책별 허용·차단 | 조건부 block |
| AI security detection | triage 후보 | 초기 2~4주 informational |
| AI autofix PR | draft PR + evidence 검토 | human approval 필요 |

이 구조는 [Security Triage Context Plane](/posts/2026-07-08-security-triage-context-plane-trend/)와 맞닿아 있습니다. 중요한 것은 finding을 많이 만드는 것이 아니라, source와 confidence에 따라 적절한 owner와 action으로 보내는 것입니다.

### 2) IDE 안의 `/security-review`는 "왼쪽 이동"이 아니라 "작업 중 점검"이다

보안을 shift-left한다고 해서 모든 책임을 개발자에게 떠넘기는 것은 아닙니다. Copilot app의 `/security-review` 같은 흐름은 개발자가 아직 코드를 손에 쥐고 있을 때 고위험 패턴을 확인하게 해줍니다. GitHub 설명 기준으로 이 명령은 현재 workstream changes를 분석하고, severity와 confidence가 붙은 high-confidence finding, 적용 가능한 제안, 우선순위가 있는 view를 제공합니다. injection, XSS, insecure data handling, path traversal, weak cryptography 같은 일반적이고 영향 큰 클래스가 대상입니다.

실무적으로는 이 기능을 "보안팀 대신"이 아니라 "PR 올리기 전 셀프 체크"로 쓰는 편이 맞습니다. 예를 들어 파일 업로드, path join, SQL query builder, OAuth callback, webhook signature, tenant id 필터를 건드린 개발자는 PR 전에 `/security-review`를 돌리고 결과를 PR description에 남길 수 있습니다.

권장 기준:

- high-risk path 변경 PR의 80% 이상에서 self security review evidence를 남긴다.
- P1/P2 finding이 나오면 PR 제출 전에 수정하거나 `accepted risk` 사유를 쓴다.
- low confidence finding은 보안팀 큐로 바로 보내지 않고 팀 내부 리뷰에서 1차 분류한다.
- self review가 통과해도 기존 CodeQL, secret scan, dependency review는 그대로 유지한다.

이렇게 보면 `/security-review`는 릴리스 게이트가 아니라 개발 중간 피드백입니다. 빠른 피드백일수록 수정 비용이 낮지만, 최종 판정까지 자동화된 것은 아닙니다.

### 3) agentic autofix의 핵심은 패치 생성이 아니라 재검증 증거다

agentic autofix에서 눈에 띄는 부분은 "AI가 고친다"입니다. 하지만 운영 관점에서 더 중요한 부분은 다른 데 있습니다. GitHub 설명에 따르면 alert를 Copilot에 할당하면 관련 파일을 탐색하고, 수정안을 만들고, CodeQL을 다시 실행해 fix가 alert를 닫는지 확인하고, draft PR을 엽니다. 수정 생성보다 **검증 루프**가 핵심입니다.

보안 자동 수정은 일반 리팩터링보다 위험합니다. 취약점을 닫는 듯 보이지만 우회 경로가 남을 수 있고, 정상 사용자 플로우를 깨뜨릴 수 있으며, 공격자에게 취약점 위치를 더 선명하게 보여줄 수 있습니다. 그래서 agentic autofix PR에는 최소한 아래 증거가 있어야 합니다.

```yaml
security_autofix_evidence:
  source_alert: "code_scanning_alert_1842"
  finding_source: "CodeQL"
  severity: "high"
  changed_files:
    - "src/upload/PathResolver.java"
    - "src/upload/PathResolverTest.java"
  validation:
    codeql_rerun: "passed"
    regression_tests: "passed"
    exploit_reproduction: "blocked"
  human_owner: "appsec-platform"
  merge_policy: "security_owner_required"
  ai_credit_estimate: 12
  actions_minutes: 8
```

이 증거가 없으면 자동수정 PR은 그럴듯한 코드 변경일 뿐입니다. [Test Evidence Pipeline](/posts/2026-04-10-test-evidence-pipeline-ai-change-review-trend/)의 원칙처럼 보안 PR은 "무엇을 고쳤다"보다 "어떤 실패가 더 이상 재현되지 않는다"를 보여줘야 합니다.

### 4) CodeQL과 AI detections는 경쟁 관계가 아니라 계층 관계다

AI 보안 탐지가 나오면 기존 SAST가 곧 쓸모없어질 것처럼 말하기 쉽습니다. 저는 그렇게 보지 않습니다. 정적 분석 규칙은 재현성과 설명 가능성이 강합니다. 같은 코드에는 같은 결과가 나오고, policy gate와 audit에 넣기 좋습니다. AI detections는 더 넓은 패턴과 프레임워크 공백을 볼 수 있지만, confidence와 비용, 재현성 관리가 필요합니다.

운영 모델은 계층으로 보는 편이 낫습니다.

| 계층 | 역할 | 장점 | 주의점 |
| --- | --- | --- | --- |
| CodeQL/SAST rule | 검증 가능한 정적 패턴 탐지 | 반복성, merge gate 적합 | rule coverage 밖 blind spot |
| AI detections | rule 밖 의심 경로 탐지 | 넓은 커버리지, 빠른 확장 | false positive, 비용, 설명 품질 |
| `/security-review` | 개발 중 셀프 점검 | 수정 비용 낮음 | 최종 승인 대체 불가 |
| agentic autofix | 알려진 alert 수정 가속 | 패치 초안과 재검증 | human gate 없으면 회귀 위험 |
| human security review | 판정과 책임 | 맥락·영향 평가 | 처리량 제한 |

이 계층을 섞지 않아야 합니다. AI finding을 바로 block하면 개발자는 불신할 수 있고, CodeQL high를 informational로만 두면 확정된 위험을 놓칠 수 있습니다.

### 5) 비용과 처리량이 새로운 보안 운영 지표가 된다

GitHub 문서 신호에서 눈에 띄는 또 하나는 비용입니다. AI security detections는 Copilot license와 AI credits를 요구하고, agentic autofix도 AI credits와 GitHub Actions minutes를 소비합니다. 보안 자동화가 agentic workflow로 갈수록 탐지 비용은 단순한 SaaS 구독료가 아니라 "finding당 AI credit", "autofix당 Actions minutes", "리뷰어 시간", "오탐 처리 시간"으로 쪼개집니다.

초기 운영 지표는 아래 정도면 충분합니다.

| 지표 | 권장 시작 기준 |
| --- | --- |
| AI finding confirmed rate | 20~50% 목표, 10% 미만이면 범위 축소 |
| duplicate/known issue rate | 25% 이하 |
| high-risk PR self review coverage | 80% 이상 |
| autofix patch verification pass rate | 90% 이상 |
| autofix rollback/rework rate | 10% 이하 |
| P1 triage SLA | 24시간 이내 95% |
| AI credit per confirmed fix | 월별 추세로 관리 |
| Actions minutes per autofix PR | 저장소별 예산 안에서 관리 |

보안팀이 "좋아 보이니 전체 적용"으로 가면 비용과 알림이 빨리 커집니다. 반대로 숫자로 관리하면 어떤 저장소에서 AI review가 실제로 도움이 되는지, 어디서는 기존 rule과 교육이 더 나은지 판단할 수 있습니다.

## 실무 적용

### 1) PR 보안 리뷰 루프를 5단계로 나눈다

실무에서는 아래 순서가 안전합니다.

1. **Developer self-check**  
   high-risk path 변경 시 `/security-review` 또는 사내 AI review를 실행하고 PR description에 결과를 남깁니다.

2. **Automated scan**  
   CodeQL, secret scanning, dependency review, AI detections가 PR에 annotation을 남깁니다.

3. **Triage routing**  
   severity, confidence, source, affected component에 따라 product owner 또는 appsec owner로 라우팅합니다.

4. **Fix generation**  
   확정 alert 중 반복 패턴이나 수정 범위가 작은 건만 agentic autofix를 허용합니다.

5. **Verification and approval**  
   재현 테스트, CodeQL 재검증, regression test, 보안 owner 승인을 통과해야 merge합니다.

이 흐름은 보안팀이 모든 PR을 수동으로 붙잡는 방식보다 지속 가능합니다. 동시에 AI가 만든 신호와 패치를 검증 없이 통과시키지 않습니다.

### 2) 고위험 코드 경로부터 적용한다

처음부터 전체 저장소에 AI security review를 강제하면 노이즈가 큽니다. 시작점은 위험한 코드 경로입니다.

우선 적용 후보:

- 인증, 세션, 토큰, OAuth callback
- authorization check, tenant isolation, admin boundary
- 파일 업로드·다운로드, path normalization, object storage access
- SQL/NoSQL query builder, search filter, deserialization
- webhook receiver, signature verification, replay defense
- 결제, 주문, 정산, 포인트, 쿠폰
- 암호화, key handling, secret loading

이 목록은 [OWASP Top 10 대응 체크리스트](/learning/deep-dive/deep-dive-owasp-top10-checklist/)와 함께 관리하면 좋습니다. 보안 리뷰는 모든 줄을 똑같이 보는 것이 아니라, 실패 비용이 큰 경계에 더 많은 예산을 쓰는 일입니다.

### 3) AI finding packet을 표준화한다

AI finding이 PR comment로만 남으면 추적이 어렵습니다. 최소한 아래 구조로 변환해 저장해야 합니다.

```yaml
ai_security_finding:
  id: "ai-pr-20260715-044"
  source: "github_ai_security_detection"
  label: "AI"
  class: "path_traversal"
  severity: "medium"
  confidence: "medium"
  affected_files:
    - "src/files/download.ts"
  entrypoint: "GET /files/:name"
  suggested_fix: "normalize and enforce storage root prefix"
  reproducibility: "not_proven"
  owner: "files-platform"
  status: "candidate"
```

이 packet은 [AI Vulnerability Triage Pipeline](/posts/2026-05-13-ai-vulnerability-triage-pipeline-trend/)의 축소판입니다. PR 안에서는 간단해야 하지만, 나중에 confirmed/false_positive/duplicate/hardening을 학습하려면 구조화가 필요합니다.

### 4) agentic autofix 허용 범위를 좁게 시작한다

자동수정은 매력적이지만 처음부터 넓게 열면 위험합니다. 저는 아래 조건을 만족하는 alert부터 허용하는 편이 낫다고 봅니다.

- CodeQL 또는 재현 가능한 rule 기반 alert다.
- 수정 범위가 5개 파일 이하로 예상된다.
- regression test를 만들거나 기존 테스트를 수정할 수 있다.
- 인증·권한 모델 자체를 재설계하는 변경이 아니다.
- 보안 owner가 PR을 리뷰할 수 있다.
- draft PR로 열리고 자동 merge는 금지된다.

반대로 아래는 초기 자동수정에서 제외합니다.

- 암호화 프로토콜 교체
- 권한 모델 변경
- multi-tenant isolation 핵심 로직
- 대규모 sanitizer 도입
- public API 동작 변경
- 데이터 마이그레이션이 필요한 수정

자동수정의 목표는 사람을 없애는 것이 아니라 반복적이고 국소적인 패치 초안을 빠르게 만드는 것입니다. [Agentic PR Governance](/posts/2026-05-25-agentic-pr-governance-trend/)에서 말한 것처럼 책임자는 여전히 사람입니다.

### 5) merge gate는 source별로 다르게 둔다

권장 merge 정책 예시:

```yaml
security_merge_policy:
  codeql:
    high_or_critical: "block"
    medium: "owner_review"
  secret_scanning:
    confirmed: "block_and_rotate"
  dependency_review:
    critical: "block_unless_exception"
  ai_security_detection:
    first_30_days: "informational"
    after_baseline:
      high_confidence_high_impact: "owner_review"
      medium_or_low: "triage_queue"
  agentic_autofix_pr:
    require:
      - "validation_log"
      - "security_owner_approval"
      - "regression_test"
```

핵심은 AI finding을 무시하지도, 과신하지도 않는 것입니다. 30일 정도 baseline을 쌓고, confirmed rate와 오탐 패턴을 본 뒤 특정 클래스만 owner review로 승격하는 방식이 현실적입니다.

## 트레이드오프/주의점

첫째, AI 보안 리뷰가 빠른 피드백을 주더라도 최종 책임은 도구가 지지 않습니다. customer data, auth bypass, payment integrity 같은 영역에서는 human security owner가 필요합니다.

둘째, PR 안의 annotation은 편하지만 알림 피로를 만들 수 있습니다. high/medium/low를 모두 같은 톤으로 뿌리면 개발자는 결국 무시합니다. source, severity, confidence, actionability로 화면을 줄여야 합니다.

셋째, agentic autofix는 취약점 위치와 수정 방향을 PR에 드러냅니다. private repo 내부에서는 유용하지만, 오픈소스 프로젝트에서는 공개 PR 타이밍과 advisory 정책을 조심해야 합니다.

넷째, AI credits와 Actions minutes가 보안 비용으로 들어옵니다. 전체 PR에 상시 실행하는 것보다 high-risk path, protected branch, release candidate에 우선 적용하는 편이 비용 대비 효과가 좋습니다.

다섯째, 기존 SAST와 secret scanning이 없는 팀이 AI review부터 붙이면 기본 위생을 건너뛰게 됩니다. AI review는 기본 게이트 위에 올라가는 보완 계층이지 대체물이 아닙니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] AI security detection과 CodeQL finding을 label과 정책에서 구분한다.
- [ ] high-risk path 변경 PR에는 self security review evidence를 요구한다.
- [ ] AI finding packet에 source, severity, confidence, affected file, owner, status가 있다.
- [ ] agentic autofix PR에는 재현 테스트 또는 CodeQL 재검증 로그가 있다.
- [ ] AI finding은 초기 2~4주 informational로 운영하며 confirmed rate와 false positive를 측정한다.
- [ ] 자동수정 허용 범위와 제외 범위가 문서화되어 있다.
- [ ] AI credit, Actions minutes, 리뷰어 처리량을 월별로 본다.
- [ ] external disclosure가 필요한 취약점은 자동 PR 생성 전에 security owner가 판단한다.

### 연습

1. 지난 30일 PR 중 인증, 파일 처리, webhook, SQL builder를 건드린 PR을 골라 보세요. 이 PR들에만 AI security self-check를 붙이면 전체 PR 대비 몇 퍼센트인지 계산합니다.
2. 기존 CodeQL high alert 5개를 골라 agentic autofix 후보인지 분류해 보세요. 수정 범위, 테스트 가능성, 권한 모델 영향, 공개 위험을 기준으로 봅니다.
3. AI finding을 `candidate/confirmed/duplicate/hardening/false_positive`로 나누는 triage board를 만들고, 2주 동안 confirmed rate와 median triage time을 기록합니다.
4. PR template에 `security_review_evidence` 항목을 추가해 보세요. high-risk path 변경, self-review 실행 여부, finding 처리 상태, 남은 risk acceptance를 짧게 쓰게 하면 됩니다.

정리하면 AI Security Review Control Loop의 핵심은 "AI가 보안을 대신 본다"가 아닙니다. 좋은 흐름은 탐지를 개발 루프 가까이 가져오되, finding provenance, 재현 증거, 수정 검증, 비용 통제, 사람 승인까지 하나의 루프로 묶습니다. 보안 자동화가 개발 속도를 높이려면 더 많은 알림보다 더 좋은 판정 경로가 필요합니다.
