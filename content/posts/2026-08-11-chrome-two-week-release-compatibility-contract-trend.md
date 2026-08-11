---
title: "2026 개발 트렌드: Chrome 2주 릴리스 주기, 브라우저 호환성 검증도 상시 운영 계약이 된다"
date: 2026-08-11T10:06:00+09:00
lastmod: 2026-08-11T10:06:00+09:00
draft: false
tags: ["Chrome", "Web Platform", "Browser Compatibility", "Release Engineering", "Frontend", "Quality Engineering"]
categories: ["Development", "Web", "Release Engineering"]
series: ["dev-trends"]
keywords: ["Chrome two week release cycle", "Chrome 153", "browser compatibility testing", "web platform release engineering", "Chrome Beta testing"]
description: "2026년 9월 Chrome 153부터 시작되는 2주 Beta·Stable 릴리스 주기를 바탕으로 브라우저 호환성 테스트, deprecation 대응, enterprise 채널, 카나리와 rollback 기준을 운영 계약으로 설계하는 법을 정리합니다."
summary: "Chrome의 stable milestone이 4주에서 2주 주기로 빨라지면 웹 팀은 월 1회 수동 확인으로는 변화를 따라가기 어렵습니다. Beta 선행 검증, 핵심 퍼널 smoke, feature detection, exception TTL, 사용자 버전 telemetry를 하나의 compatibility control loop로 묶어야 합니다."
key_takeaways:
  - "Chrome은 2026년 9월 Chrome 153부터 Desktop·Android·iOS의 Beta와 Stable milestone을 2주 주기로 전환하며, Beta는 Stable 약 3주 전에 제공한다."
  - "릴리스 간격이 절반으로 줄면 호환성 테스트도 버전별 프로젝트가 아니라 매일 실행되는 상시 pipeline이 되어야 한다."
  - "Extended Stable의 8주 주기는 유지되지만 일반 사용자 분포를 대신하지 않으므로 enterprise 채널만 테스트해서는 부족하다."
  - "핵심 지표는 테스트 통과 수보다 stable exposure 전 탐지율, browser-version별 error delta, 예외 TTL, 복구 시간이다."
operator_checklist:
  - "Chrome Stable·Beta에서 로그인, 결제, 검색, 업로드 등 핵심 퍼널 5~10개를 매일 자동 실행한다."
  - "버전별 JS error, Web Vitals, API failure를 비교하되 low-volume 버전은 최소 1,000 session 또는 24시간 창으로 판정한다."
  - "UA sniffing과 browser-specific workaround에는 owner, reason, expires_at, 제거 테스트를 붙인다."
  - "Beta에서 핵심 퍼널 실패율이 기준선 대비 0.5%p 이상 증가하면 release readiness issue를 자동 생성한다."
learning_refs:
  - title: "Runtime Security Patch Runway"
    href: "/posts/2026-07-22-runtime-security-patch-runway-trend/"
    description: "런타임 패치와 EOL 대응 시간을 운영 runway로 관리하는 기준입니다."
  - title: "Policy-Driven Progressive Delivery"
    href: "/posts/2026-03-27-policy-driven-progressive-delivery-trend/"
    description: "카나리 지표와 중단 기준을 배포 정책으로 만드는 흐름입니다."
  - title: "Synthetic Monitoring과 User Journey Probe"
    href: "/learning/deep-dive/deep-dive-synthetic-monitoring-user-journey-probes-playbook/"
    description: "실제 사용자 퍼널을 외부 probe로 검증하는 실무 기준입니다."
  - title: "Consumer-Driven Contract Testing"
    href: "/learning/deep-dive/deep-dive-consumer-driven-contract-testing/"
    description: "제공자와 소비자 사이의 호환성 계약을 자동 검증하는 기본기입니다."
decision_guide:
  title: "2주 브라우저 주기에 어떻게 대응할까"
  intro: "모든 팀이 거대한 브라우저 랩을 만들 필요는 없습니다. 사용자 분포와 핵심 업무 영향에 따라 자동화 깊이를 정합니다."
  cases:
    - badge: "Daily Beta gate"
      title: "웹이 핵심 제품이고 Chrome 사용자가 40% 이상이다"
      fit: "로그인·결제·에디터·화상회의처럼 브라우저 API 의존성이 큰 서비스"
      watchouts: "E2E 전체를 매일 돌리면 flaky test와 CI 비용이 신호를 덮을 수 있다."
      next_step: "핵심 퍼널 5~10개만 Stable·Beta로 매일 돌리고 나머지는 주 1회 matrix로 분리한다."
    - badge: "Risk-based matrix"
      title: "콘텐츠·관리자 도구 중심이고 변경 빈도가 낮다"
      fit: "브라우저별 핵심 차이가 적고 배포 rollback이 빠른 서비스"
      watchouts: "수동 QA만 두면 휴일이나 릴리스 겹침 때 Beta 검증이 빠진다."
      next_step: "매일 smoke 3개, 주 1회 전체 matrix, 실제 error telemetry로 시작한다."
    - badge: "Extended Stable"
      title: "관리형 기업 단말이 중심이다"
      fit: "브라우저 버전을 정책으로 고정하고 8주 변화 창이 필요한 내부 업무 시스템"
      watchouts: "외부 고객과 BYOD 사용자는 일반 Stable에 더 빨리 노출된다."
      next_step: "Extended Stable을 운영 기준선으로 쓰되 일반 Stable·Beta smoke를 별도 유지한다."
faqs:
  - question: "Chrome만 테스트하면 충분한가요?"
    answer: "아닙니다. 이번 변화의 직접 대상은 Chrome이지만 Safari와 Firefox의 엔진·릴리스 정책은 다릅니다. 실제 사용자 비중과 핵심 기능을 기준으로 최소 Chrome Stable/Beta, Safari stable, Firefox stable을 유지하는 편이 안전합니다."
  - question: "2주마다 전체 회귀 테스트를 수동으로 해야 하나요?"
    answer: "그 방식은 지속하기 어렵습니다. 핵심 퍼널은 매일 자동 smoke, 넓은 matrix는 주 1회, 실제 사용자 telemetry는 상시 관측으로 나누는 편이 현실적입니다."
  - question: "Extended Stable을 쓰면 대응을 미뤄도 되나요?"
    answer: "관리형 단말의 변화 속도는 늦출 수 있지만 공개 웹 사용자의 일반 Stable 노출은 계속됩니다. 외부 고객이 있다면 Extended Stable은 추가 채널이지 유일한 기준이 아닙니다."
---

2026년 9월부터 Chrome의 릴리스 리듬이 달라집니다. Chrome for Developers 공지에 따르면 Chrome은 기존 4주 milestone 주기에서 **2주 주기**로 전환합니다. 시작점은 2026년 9월 8일 Stable로 예정된 Chrome 153입니다. Desktop, Android, iOS에 적용되고 Dev와 Canary 채널은 그대로 유지됩니다. Beta도 2주마다 나오며 Stable 약 3주 전에 제공됩니다. 기업 관리 환경을 위한 Extended Stable은 기존 8주 주기를 유지합니다.

브라우저 공급자 입장에서는 더 작은 변경을 더 자주 배포하고 보안·성능 개선을 빨리 전달하는 변화입니다. 웹 서비스를 운영하는 팀에게는 다른 의미가 있습니다. **월간 브라우저 확인을 상시 호환성 운영으로 바꿔야 한다**는 뜻입니다. 기존에는 한 milestone에서 놓친 문제를 다음 버전 전에 고칠 시간이 비교적 넓었습니다. 이제 Beta 신호를 놓치면 다음 Stable이 2주 간격으로 연이어 들어옵니다. QA를 버전별 행사처럼 운영하면 triage와 수정이 겹쳐 backlog가 쌓일 가능성이 큽니다.

이 글은 [Runtime Security Patch Runway](/posts/2026-07-22-runtime-security-patch-runway-trend/), [Policy-Driven Progressive Delivery](/posts/2026-03-27-policy-driven-progressive-delivery-trend/), [Synthetic Monitoring과 User Journey Probe](/learning/deep-dive/deep-dive-synthetic-monitoring-user-journey-probes-playbook/), [Consumer-Driven Contract Testing](/learning/deep-dive/deep-dive-consumer-driven-contract-testing/)과 이어집니다. 브라우저도 외부 runtime이며, 버전 변화는 서비스가 직접 배포하지 않아도 사용자 환경에 자동으로 들어오는 production change입니다.

참고한 공식 신호:

- Chrome for Developers, Get features faster with Chrome's two-week release cycle: https://developer.chrome.com/blog/chrome-two-week-release
- Chrome Status Roadmap: https://chromestatus.com/roadmap
- Chrome for Developers, Release notes: https://developer.chrome.com/release-notes
- Chrome Enterprise release notes: https://support.google.com/chrome/a/answer/7679408

## 이 글에서 얻는 것

- 2주 Beta·Stable 주기가 웹 개발팀의 테스트와 릴리스 운영에 어떤 변화를 만드는지 이해합니다.
- 전체 E2E를 매번 돌리는 대신 핵심 퍼널 smoke, 주간 matrix, 실제 사용자 telemetry를 계층화하는 기준을 얻습니다.
- feature detection, browser workaround TTL, deprecation inventory를 호환성 계약으로 만드는 방법을 정리합니다.
- Beta failure를 언제 경고하고 언제 배포 차단까지 올릴지 숫자로 판단할 수 있습니다.

## 핵심 개념/이슈

### 1) 릴리스 간격이 절반이면 대응 backlog는 두 배보다 더 빨리 쌓일 수 있다

4주 주기에서는 browser milestone 하나를 확인하고, 문제를 재현하고, 수정하고, 다음 버전을 준비할 시간이 있었습니다. 2주 주기에서는 M153 문제를 수정하는 동안 M154 Beta 검증이 시작될 수 있습니다. triage와 검증이 직렬 프로세스라면 팀의 처리량보다 변화 유입량이 빨라집니다.

단순히 회의 횟수를 두 배로 늘리는 것으로는 해결되지 않습니다. 테스트를 계층화해야 합니다.

| 계층 | 주기 | 범위 | 실패 시 액션 |
| --- | --- | --- | --- |
| critical smoke | 매일 | 로그인, 결제, 검색, 업로드 5~10개 | 즉시 issue, owner 호출 |
| Beta compatibility | 매일 또는 Beta 갱신 시 | Chrome Beta + 핵심 퍼널 | stable exposure 전 수정/완화 |
| cross-browser matrix | 주 1회 | Chrome/Safari/Firefox + desktop/mobile | 주간 compatibility backlog |
| full regression | 주요 제품 릴리스 전 | 전체 E2E와 접근성 | 제품 release gate |
| production telemetry | 상시 | 버전별 JS error, API failure, Web Vitals | 실제 영향 기준 rollback/feature off |

핵심은 모든 테스트를 매일 돌리는 것이 아니라 **실패 비용이 큰 사용자 여정을 더 자주 보는 것**입니다. 결제·인증·문서 저장이 깨지는 문제와 장식 animation이 다른 문제를 같은 큐에 넣으면 중요한 신호가 묻힙니다.

### 2) Beta는 참고 채널이 아니라 3주 선행 production 신호다

Chrome은 각 버전 Beta를 Stable 약 3주 전에 제공한다고 안내합니다. Stable 주기가 2주인데 Beta lead time은 약 3주라는 점이 중요합니다. 운영이 잘 되면 동시에 여러 milestone을 보게 됩니다. 현재 Stable, 다음 Beta, 더 앞선 Dev/Canary가 겹칩니다.

팀이 실제로 관리할 최소 상태는 다음과 같습니다.

```yaml
browser_release_readiness:
  current_stable: "M152"
  next_stable: "M153"
  beta_first_seen_at: "2026-08-19"
  stable_target_at: "2026-09-08"
  critical_journeys_total: 8
  critical_journeys_passed: 8
  browser_specific_exceptions_open: 2
  release_blockers_open: 0
  owner: "web-platform"
```

이 상태를 사람의 기억이나 캘린더에만 두면 빠집니다. Chrome Status Roadmap 또는 release feed를 주기적으로 읽어 지원 matrix와 CI image를 갱신해야 합니다. 정확한 날짜가 바뀔 수 있으므로 하드코딩한 일정 하나보다 공식 roadmap 동기화 시각을 함께 기록합니다.

### 3) 자동 업데이트는 외부에서 들어오는 production deployment다

웹 팀은 애플리케이션 배포를 직접 통제하지만 사용자 브라우저 업데이트는 통제하지 못합니다. 어제와 같은 JavaScript bundle을 제공해도 오늘 사용자 runtime이 달라질 수 있습니다. 브라우저 변경은 사실상 공급자가 수행하는 외부 production deployment입니다.

따라서 browser version을 장애 분석 필드에 넣어야 합니다.

- browser family와 major version
- OS와 device class
- feature flag variant
- JS error fingerprint
- failed API/route
- Core Web Vitals와 navigation timing
- release/build SHA

다만 user agent 원문을 무제한 보관하거나 metric label로 넣으면 개인정보·카디널리티 문제가 생깁니다. `Chrome/153`, `Safari/xx`, `Firefox/xx`처럼 major version과 제한된 device class로 정규화합니다. 버전별 session 수가 너무 적을 때는 성급히 회귀로 판정하지 않습니다.

초기 판정 기준 예시:

- 브라우저 버전별 최소 1,000 session 또는 24시간 관측
- JS error session rate가 직전 Stable 대비 0.5%p 이상 증가하면 조사
- 로그인/결제 실패율이 기준선의 1.5배 또는 0.2%p 이상 증가하면 즉시 완화 검토
- LCP p75가 20% 이상 악화되고 sample 5,000 이상이면 성능 회귀 issue
- 특정 major에서만 재현되고 영향 사용자가 1% 이상이면 release blocker 후보

숫자는 서비스에 맞게 조정해야 하지만, 최소 표본과 절대·상대 증가를 같이 두는 것이 중요합니다. 0.01%에서 0.02%는 2배지만 실제 영향은 작을 수 있고, 2%에서 2.5%는 1.25배지만 사용자 영향은 큽니다.

### 4) UA sniffing보다 feature detection이 더 중요해진다

릴리스가 빨라질수록 `if Chrome >= 153` 같은 버전 분기는 빨리 낡습니다. 같은 major라도 enterprise policy, rollout 단계, platform 차이 때문에 실제 기능 가용성이 다를 수 있습니다. 버전 번호보다 기능 존재와 동작을 확인하는 feature detection이 기본이어야 합니다.

```javascript
if ('showOpenFilePicker' in window) {
  // 지원 경로
} else {
  // 대체 업로드 경로
}
```

하지만 feature detection도 만능은 아닙니다. API가 존재하지만 특정 입력에서 동작이 바뀌거나 성능 회귀가 생길 수 있습니다. 따라서 계약은 세 층으로 봅니다.

1. capability detection: API가 존재하는가
2. behavioral smoke: 핵심 입력에서 기대 결과가 나오는가
3. production telemetry: 실제 사용자 오류율이 안정적인가

browser-specific workaround가 필요하면 다음 필드를 붙입니다.

```yaml
compatibility_exception:
  id: "WEB-1842"
  browser: "Chrome 153"
  affected_flow: "document-export"
  reason: "behavioral regression"
  fallback: "server-side export"
  owner: "docs-platform"
  expires_at: "2026-10-15"
  removal_test: "e2e/export/chrome-153.spec.ts"
```

만료일 없는 예외는 코드에 남아 다음 버전의 정상 동작까지 막을 수 있습니다. [Feature Flag Lifecycle Cleanup](/learning/deep-dive/deep-dive-feature-flag-lifecycle-cleanup-playbook/)과 같은 방식으로 owner와 제거 조건을 둡니다.

### 5) Extended Stable은 시간을 사지만 공개 웹의 기준선은 아니다

Chrome의 Extended Stable은 8주 주기를 유지합니다. 관리형 기업 단말이나 Chromium embedder에게는 중요한 선택지입니다. 사내 업무 시스템이 browser update를 검증할 시간을 확보할 수 있습니다.

하지만 외부 고객이 일반 Stable, 모바일, 개인 장비를 사용한다면 Extended Stable만 테스트해서는 부족합니다. 공개 웹 서비스의 production 분포는 보통 여러 채널과 버전이 섞입니다.

권장 분리:

| 사용자군 | 기준 채널 | 추가 검증 |
| --- | --- | --- |
| 관리형 사내 단말 | Extended Stable | 다음 일반 Stable smoke |
| 공개 B2C 웹 | Stable | Beta 핵심 퍼널 |
| 브라우저 확장·에디터 | Stable + Beta | permission/API behavior matrix |
| kiosk/embedder | 고정/Extended | upgrade rehearsal와 rollback image |
| 모바일 웹 | Android/iOS Stable | 실제 device 또는 device farm |

즉 Extended Stable은 지연 전략이지 호환성 테스트 면제권이 아닙니다.

### 6) 더 빠른 보안·기능 전달과 더 짧은 검증 창을 같이 본다

2주 주기는 장점도 큽니다. 기능과 안정성 개선이 더 작은 단위로 배포되면 문제 원인을 좁히기 쉬워질 수 있고, 사용자는 개선을 더 빨리 받습니다. 보안 업데이트 자체는 이미 별도 주기로 빠르게 제공될 수 있지만 milestone 변화도 더 자주 들어옵니다.

트레이드오프는 명확합니다.

- 공급자: 더 작은 release scope, 더 빠른 피드백
- 사용자: 최신 기능과 개선을 더 빨리 받음
- 웹 팀: 호환성 검증 이벤트가 늘고 deprecation runway가 체감상 짧아짐
- enterprise: 일반 Stable과 Extended Stable 사이의 version spread 관리 필요

따라서 KPI도 "지원 브라우저 목록이 최신인가"에서 "변화를 Stable 전에 발견하고 복구했는가"로 바뀌어야 합니다.

## 실무 적용

### 1) 핵심 퍼널을 10개 이하로 고정한다

처음부터 전체 E2E suite를 Chrome Beta에서 매일 돌리면 비용과 flaky noise가 커집니다. 가장 비싼 실패부터 고릅니다.

예시:

1. 회원가입과 로그인
2. OAuth redirect와 session 유지
3. 결제 수단 등록과 결제 완료
4. 검색·필터·페이지 이동
5. 파일 업로드와 다운로드
6. 문서 편집과 자동 저장
7. 카메라·마이크 권한 요청
8. 관리자 승인 작업

선정 기준은 최근 90일 트래픽, 매출 영향, 복구 난이도입니다. 핵심 퍼널은 5~10개로 제한하고 각 퍼널에 owner와 최대 허용 실패율을 둡니다. 나머지 시각 회귀와 edge case는 주간 matrix로 보냅니다.

### 2) Stable과 Beta를 같은 테스트 코드로 실행한다

채널별 테스트 코드가 다르면 차이가 테스트 drift인지 브라우저 변화인지 알기 어렵습니다. 같은 containerized runner 또는 browser automation 설정에서 channel만 바꿉니다.

```yaml
browser_smoke_matrix:
  schedule: "daily"
  channels:
    - "chrome-stable"
    - "chrome-beta"
  journeys:
    - "auth-login"
    - "checkout-card"
    - "file-upload"
    - "editor-autosave"
  retry: 1
  fail_policy:
    stable: "page-oncall"
    beta: "open-release-readiness-issue"
```

Beta 한 번 실패했다고 product deploy를 무조건 막지는 않습니다. 먼저 동일 build의 Stable 결과, 재시도, screenshot, console, network trace를 묶어야 합니다. 반대로 핵심 퍼널이 3회 연속 실패하거나 실제 API/permission 변화가 확인되면 Stable 노출 전에 owner와 deadline을 정합니다.

### 3) 실패를 재현 번들로 남긴다

브라우저 호환성 이슈는 시간이 지나면 채널이 업데이트되어 재현 환경이 사라질 수 있습니다. issue에는 최소한 아래를 남깁니다.

- browser channel, exact version, OS image
- application build SHA와 feature flag
- test step과 입력 fixture
- screenshot/video
- console log와 network HAR의 민감정보 제거본
- expected/actual behavior
- fallback 또는 flag-off 경로

이 흐름은 [Reproduction Bundle](/posts/2026-04-26-reproduction-bundle-ai-bug-report-trend/)과 같습니다. 자동 테스트 실패 메시지 한 줄보다 재현 가능한 증거 묶음이 수정 시간을 줄입니다.

### 4) 호환성 예외 장부를 운영한다

브라우저 workaround는 보통 급하게 들어갑니다. 문제는 정상화된 뒤에도 남는다는 점입니다. 예외 장부에 다음을 기록합니다.

| 필드 | 기준 |
| --- | --- |
| browser/version | major 또는 behavior 조건 |
| affected flow | 업무 퍼널 이름 |
| fallback | 기능 축소, server path, flag off |
| owner | 팀이 아니라 개인/rotation |
| expires_at | 기본 30~60일 |
| removal evidence | Beta/Stable 통과 test |
| user impact | session 비율, 실패율 |

예외가 60일을 넘으면 재승인하고, 해당 browser 사용자가 0.5% 미만으로 내려간 legacy 예외는 제거 후보로 올립니다. 반대로 사용자가 많고 fallback이 중요한 경우에는 workaround가 아니라 정식 호환 계층으로 승격할 수 있습니다.

### 5) 배포 정책과 브라우저 rollout을 연결한다

애플리케이션 배포와 browser rollout이 같은 주에 겹치면 원인 분리가 어려워집니다. telemetry에 app build와 browser major를 함께 남겨야 합니다. 고위험 UI 변경은 Chrome Beta smoke 통과 후 canary를 시작하고, browser Stable 전환 주간에는 browser API 의존성이 큰 변경의 blast radius를 줄이는 것도 현실적입니다.

초기 release gate 예시:

- Stable·Beta 핵심 퍼널 8/8 통과
- blocker severity issue 0건
- Beta JS error rate가 Stable 대비 +0.5%p 미만
- browser-specific exception 신규 3건 미만
- rollback 또는 feature flag off가 15분 안에 가능
- 실제 사용자 session coverage 95% 이상인 browser matrix 유지

이 기준은 [Progressive Delivery](/posts/2026-03-27-policy-driven-progressive-delivery-trend/)와 같은 원리입니다. 모든 문제를 미리 잡는 것이 아니라 노출 전에 중요한 회귀를 잡고, 놓친 문제는 빠르게 제한하는 구조입니다.

### 6) 4주 전환 준비를 짧은 실행 계획으로 만든다

Chrome 153 Stable 예정일인 9월 8일을 기준으로 역산하면 다음처럼 준비할 수 있습니다.

| 시점 | 할 일 | 종료 조건 |
| --- | --- | --- |
| 지금 | 사용자 browser 분포와 핵심 퍼널 선정 | 상위 95% session 커버 |
| 1주 내 | Stable/Beta daily smoke 구성 | 7일 성공률 95% 이상 |
| Beta 노출 후 | M153 실제 test와 예외 triage | blocker 0건 또는 완화 owner 지정 |
| Stable 전 | fallback·flag-off drill | 15분 내 기능 제한 가능 |
| Stable 후 24시간 | 버전별 error delta 비교 | 기준선 이내 또는 incident 전환 |

정확한 채널 날짜는 공식 roadmap을 다시 확인해야 합니다. 계획의 핵심은 날짜 암기가 아니라 Beta 감지부터 Stable 후 검증까지 owner가 끊기지 않는 것입니다.

## 트레이드오프/주의점

첫째, 테스트 matrix를 무한히 늘리면 비용과 flaky rate가 먼저 커집니다. 사용자가 거의 없는 과거 버전까지 모든 commit에서 돌리기보다 실제 session의 95%를 덮는 matrix와 핵심 퍼널을 우선합니다.

둘째, Beta 사용자는 production 분포와 다릅니다. 개발자·얼리어답터 비율이 높고 OS·extension 조합도 다를 수 있습니다. Beta smoke는 선행 신호이고, Stable 실제 telemetry를 대체하지 않습니다.

셋째, UA sniffing은 빠른 완화에 유용할 수 있지만 영구 해법으로 남기면 버전 증가 속도를 따라가지 못합니다. 예외에는 TTL과 제거 test가 필요합니다.

넷째, Chrome 2주 주기를 이유로 Safari와 Firefox 검증을 줄이면 안 됩니다. 웹 표준 구현과 보안 정책은 엔진마다 다르고, 특히 iOS 환경의 제약은 Desktop Chrome 결과로 설명되지 않습니다.

다섯째, 자동 업데이트를 막아 안정성을 얻는 전략은 보안 패치 지연 비용을 만듭니다. 관리형 단말에서는 Extended Stable과 강제 업데이트 deadline을 함께 두고, 오래된 major 비율과 취약점 runway를 봐야 합니다.

여섯째, 모든 Beta failure를 앱 release blocker로 만들면 개발 흐름이 멈춥니다. 핵심 퍼널, 실제 재현, Stable 대비 delta, fallback 존재 여부로 severity를 나눕니다.

## 체크리스트 또는 연습

- [ ] Chrome 153 전환 일정과 공식 roadmap 확인 시각을 기록했다.
- [ ] 로그인·결제·업로드 등 핵심 퍼널을 5~10개로 고정했다.
- [ ] 같은 smoke suite를 Chrome Stable과 Beta에서 매일 실행한다.
- [ ] Safari와 Firefox stable 최소 검증을 유지한다.
- [ ] browser major별 JS error와 핵심 API 실패율을 볼 수 있다.
- [ ] low-volume 버전 판정에 최소 표본 또는 관측 창을 둔다.
- [ ] browser-specific workaround에 owner와 30~60일 TTL이 있다.
- [ ] UA sniffing 대신 feature detection을 기본으로 사용한다.
- [ ] Beta 실패에 screenshot, console, network, build SHA가 묶여 있다.
- [ ] feature flag off 또는 fallback 경로를 15분 안에 실행할 수 있다.
- [ ] Extended Stable과 일반 Stable 사용자를 별도 집계한다.
- [ ] Stable 노출 후 24시간 버전별 error delta를 검토한다.

연습으로 현재 서비스의 핵심 사용자 여정 다섯 개를 고르세요. 각 여정에 대해 Chrome Stable/Beta, Safari stable, Firefox stable의 실행 주기와 실패 임계치를 적습니다. 그다음 browser-specific 코드 분기를 검색해 owner와 만료일이 없는 항목 수를 세어 보세요. 마지막으로 Chrome Beta에서만 결제 실패율이 0.3%p 증가한 상황을 가정하고, **언제 issue로만 남기고 언제 배포를 중단하며 어떤 fallback을 켤지** 세 줄로 정리해 보세요.

