---
title: "2026 개발 트렌드: AI Crawler Purpose Policy, robots.txt 이후의 운영 계약"
date: 2026-07-21T10:06:00+09:00
lastmod: 2026-07-21T10:06:00+09:00
draft: false
tags: ["ai", "crawler", "Cloudflare", "web", "security", "trend"]
categories: ["posts", "trends"]
series: ["dev-trends"]
keywords: ["AI crawler", "robots.txt", "Cloudflare", "Agent", "Training", "Search"]
description: "AI crawler를 Search, Agent, Training 목적별로 나누어 허용·차단·과금·관측 기준을 세우는 흐름을 정리합니다."
summary: "Cloudflare의 2026년 7월 AI traffic 옵션 공개를 계기로, 웹 운영자는 crawler를 단순 bot이 아니라 목적별 계약 대상으로 다뤄야 합니다."
key_takeaways:
  - "AI crawler 정책은 이제 allow/block 하나가 아니라 Search, Agent, Training 목적별 의사결정으로 이동하고 있다."
  - "검색 노출, 에이전트 사용성, 학습 데이터 제공은 서로 다른 비용과 수익 구조를 가진다."
  - "개발팀은 robots.txt, WAF, rate limit, 로그, 캐시, 원본 비용을 하나의 운영 정책으로 묶어야 한다."
operator_checklist:
  - "crawler 트래픽을 목적별로 분류하고 unknown/mixed-use를 별도 버킷으로 둔다."
  - "허용 crawler의 캐시 적중률, origin 비용, referral 또는 conversion 기여를 함께 본다."
  - "광고·유료 콘텐츠·개인화 페이지는 Agent와 Training 접근 기준을 별도로 승인한다."
learning_refs:
  - title: "LLM-readable docs surface"
    href: "/posts/2026-05-10-llm-readable-docs-surface-trend/"
    description: "AI가 읽는 문서 표면을 제공할 때 노출과 통제 기준을 함께 잡는 글입니다."
  - title: "Agent Resource Provenance Gate"
    href: "/posts/2026-07-13-agent-resource-provenance-gate-trend/"
    description: "에이전트가 가져오는 외부 리소스의 출처와 권한을 검증하는 기준입니다."
  - title: "API Rate Limit과 Backpressure"
    href: "/learning/deep-dive/deep-dive-api-rate-limit-backpressure/"
    description: "소비자별 예산, 제한, 과부하 완화를 설계하는 백엔드 기준입니다."
decision_guide:
  title: "AI crawler 목적별 정책을 어디부터 적용할까"
  intro: "Search, Agent, Training은 같은 bot 트래픽이지만 비즈니스 효과와 위험이 다릅니다. 먼저 경로와 목적을 나누고, 가치가 확인된 트래픽만 점진적으로 열어야 합니다."
  cases:
    - badge: "허용 우선"
      title: "Search crawler"
      fit: "검색 노출과 referral 가치가 있고 cache hit ratio가 높아 origin 비용이 통제되는 공개 페이지입니다."
      watchouts: "검색 bot이라고 해도 dynamic render와 무한 pagination을 열어 두면 비용이 빠르게 늘어납니다."
      next_step: "공개 문서·블로그부터 허용하고 cache hit 90% 이상, origin 5xx 0.1% 이하를 목표로 봅니다."
    - badge: "조건부 허용"
      title: "Agent crawler"
      fit: "사용자 요청 기반 조회이며 인증, attribution, rate limit, 감사 로그가 준비된 기능입니다."
      watchouts: "사람 세션과 같은 권한을 주면 쓰기 액션의 사고 반경이 커집니다."
      next_step: "읽기 전용 scope와 분당 30~120회 제한으로 시작하고 쓰기 액션은 별도 승인으로 분리합니다."
    - badge: "기본 차단"
      title: "Training crawler"
      fit: "콘텐츠 라이선스와 수익 배분 조건이 명확한 공개 자료 또는 계약된 파트너 접근입니다."
      watchouts: "referral 없이 원본 비용과 콘텐츠 재사용 리스크만 남을 수 있습니다."
      next_step: "계약이 없으면 차단하거나 낮은 rate limit을 두고, 경로별 허용 목록을 별도로 관리합니다."
---

2026년 7월 1일 Cloudflare는 AI crawler 트래픽을 `Search`, `Agent`, `Training` 세 목적별로 관리하는 옵션을 모든 고객에게 제공한다고 발표했다. 같은 날 공개된 [Cloudflare Bot Solutions changelog](https://developers.cloudflare.com/bots/changelog/)도 기존의 단일 `Block AI bots` 토글에서 벗어나 행동 기준으로 AI crawler를 다룬다고 설명한다. 이 변화는 단순한 제품 업데이트가 아니다. 웹 서비스 운영자가 crawler를 "허용할지 막을지"가 아니라 "어떤 목적의 접근을 어떤 조건으로 계약할지" 결정해야 하는 시점으로 넘어가고 있다는 신호다.

Cloudflare의 [Content Independence Day 1년 보고](https://blog.cloudflare.com/agentic-internet-bot-report/)는 이 흐름을 숫자로 보여 준다. 2026년 6월 기준 crawler 요청 중 AI training 목적이 52%이고, search·agent·training을 섞는 mixed-use crawler가 36%를 넘었다. 순수 search crawling은 여전히 퍼블리셔 노출에 중요하지만 전체 crawler 활동에서 작고 줄어드는 영역으로 묘사된다. [공식 발표문](https://www.cloudflare.com/press/press-releases/2026/cloudflare-allows-the-agentic-internet-to-flourish-with-a-simple-philosophy-your-content-your-rules/)은 2026년 9월 15일부터 신규 고객과 기존 고객의 신규 사이트에 대해, 광고가 있는 페이지에서는 Search는 허용하되 Training과 Agent use는 기본 차단하는 방향을 예고했다.

## 이 글에서 얻는 것

- AI crawler를 Search, Agent, Training으로 나눠 운영해야 하는 이유
- robots.txt만으로는 부족해진 지점과 WAF·rate limit·로그가 함께 필요한 이유
- 콘텐츠 사이트, SaaS 문서, 커머스, API 문서에서 목적별 정책을 다르게 잡는 기준
- crawler 허용 여부를 감정이 아니라 비용·수익·위험 숫자로 판단하는 방법
- 실무 팀이 바로 만들 수 있는 AI crawler 정책 체크리스트

## 핵심 개념/이슈

### crawler의 목적이 쪼개졌다

전통적인 웹 운영에서는 crawler를 대체로 검색 엔진 bot과 악성 bot으로 나눴다. 검색 엔진은 페이지를 긁어 가지만 사용자를 다시 보내 준다는 묵시적 교환이 있었다. 악성 bot은 rate limit, WAF, CAPTCHA, IP reputation으로 막으면 됐다. AI crawler 시대에는 이 구분이 충분하지 않다.

Search crawler는 검색 또는 AI 검색 결과에서 사이트를 발견 가능하게 만드는 트래픽이다. 사이트 입장에서는 referral, 브랜드 노출, 구매 전환으로 이어질 수 있다. Agent crawler는 사용자의 실시간 요청을 대신 수행한다. 예를 들어 "이 제품 재고가 있으면 장바구니에 담아 줘" 같은 에이전트 요청은 사람 대신 페이지를 읽고 액션을 실행한다. Training crawler는 모델 학습 또는 데이터셋 구축을 위해 콘텐츠를 수집한다. 즉시 referral을 주지 않을 수 있고, 콘텐츠 라이선스나 경쟁 리스크가 더 크다.

문제는 crawler가 스스로 목적을 명확히 밝히지 않거나 여러 목적을 섞는 경우다. mixed-use crawler가 늘어나면 운영자는 "검색 노출은 허용하고 싶지만 학습 수집은 막고 싶다"는 정책을 표현하기 어렵다. 그래서 목적별 정책은 User-Agent 문자열 하나가 아니라 bot 검증, 행동 패턴, 경로, 인증 상태, 계약 정보까지 합쳐야 한다.

### robots.txt는 선언이고, 운영 정책은 집행이다

robots.txt는 여전히 중요한 신호다. 하지만 선언을 존중하지 않는 crawler가 있거나, 같은 crawler가 Search와 Training을 구분하지 않는다면 robots.txt만으로는 원본 비용과 콘텐츠 통제를 지킬 수 없다. Cloudflare가 목적별 옵션을 내놓은 배경도 이 지점에 있다. 개발팀은 robots.txt를 "정책 문서"로 보고, 실제 집행은 edge rule, WAF, bot management, rate limit, 캐시 정책으로 이어야 한다.

이 흐름은 [LLM-readable docs surface](/posts/2026-05-10-llm-readable-docs-surface-trend/)와도 연결된다. AI가 읽기 쉬운 문서 표면을 제공하는 것은 노출과 통합 가능성을 높인다. 하지만 모든 페이지를 모든 목적에 열어 둔다는 뜻은 아니다. 공개 문서, 가격 페이지, 고객 데이터가 섞인 콘솔, 광고 기반 기사, 유료 리포트는 서로 다른 정책을 가져야 한다.

### Agent 접근은 provenance와 권한 문제다

Agent crawler는 단순 조회보다 더 민감하다. 에이전트가 사용자를 대신해 장바구니, 예약, 결제, 설정 변경 같은 액션을 수행한다면 "누가 요청했는가", "사용자가 승인했는가", "에이전트가 어떤 범위까지 행동할 수 있는가"를 검증해야 한다. 이는 [Agent Resource Provenance Gate](/posts/2026-07-13-agent-resource-provenance-gate-trend/)에서 다룬 출처·권한 검증과 같은 방향이다.

검색 bot은 보통 공개 페이지 중심으로 다루면 된다. Agent bot은 공개 페이지뿐 아니라 로그인 후 자원, 사용자별 상태, API 호출까지 이어질 수 있다. 따라서 Agent 접근을 허용하려면 최소한 다음 조건이 필요하다.

- 요청이 사용자 의도에 기반한다는 신호가 있는가?
- 읽기 전용인지, 쓰기 액션인지 구분되는가?
- 인증 토큰과 권한 범위가 사람이 직접 쓰는 세션보다 좁은가?
- 실패 시 사람에게 명확히 되돌려 줄 수 있는 오류 코드가 있는가?
- 과도한 반복 조회를 막는 rate limit이 있는가?

## 실무 적용

### 1. crawler inventory를 먼저 만든다

첫 번째 작업은 차단 규칙이 아니라 관측이다. 최근 30일 로그에서 User-Agent, IP ASN, verified bot 여부, path, status code, cache status, origin latency, referral 기여를 모은다. Cloudflare 같은 edge 계층을 쓰든 직접 Nginx/Envoy 로그를 보든, 최소 버킷은 다음처럼 둔다.

- `search_allowed`: Googlebot, Bingbot처럼 검색 노출과 referral 가치가 확인된 crawler
- `agent_candidate`: 실시간 사용자 요청처럼 보이지만 별도 검증이 필요한 crawler
- `training_declared`: 학습 목적을 명시한 crawler
- `mixed_use`: search, agent, training 구분이 불명확한 crawler
- `unknown_high_volume`: 정체가 불명확하고 요청량이 많은 crawler

처음 4주 동안은 매주 정책을 조정하고, 안정화 후에는 월 1회 리뷰한다. unknown crawler가 전체 origin 요청의 10%를 넘거나, 특정 crawler가 하루 100만 요청 이상을 만들거나, crawler traffic이 전체 origin 요청의 30%를 넘으면 별도 의사결정 회의를 연다.

### 2. 경로별 기본 정책을 나눈다

사이트 전체에 하나의 allow/block을 걸면 대개 실패한다. 경로별로 콘텐츠 가치와 위험이 다르기 때문이다.

- `/docs`, `/blog`, `/pricing`: Search 허용을 기본으로 두되, Training은 라이선스 정책에 따라 결정한다.
- `/app`, `/account`, `/billing`: Search와 Training은 차단, Agent는 명시 인증·권한이 있을 때만 제한 허용한다.
- `/api`, `/openapi.json`, `/llms.txt`: 개발자 생태계 노출을 위해 Search 또는 Agent를 허용할 수 있지만 rate limit과 버전 고정이 필요하다.
- `/premium`, `/reports`, `/course`: 유료 콘텐츠는 Training 기본 차단, Agent 접근은 구독 상태와 attribution 조건을 확인한다.
- 광고 기반 페이지: 2026년 9월 15일 Cloudflare 신규 기본값처럼 Search와 Training/Agent를 분리해 검토한다.

문서 표면을 제공한다면 [MCP Stateless Tool Contract](/posts/2026-06-23-mcp-stateless-tool-contract-trend/)처럼 기계가 읽는 계약을 명확히 하는 편이 좋다. 단, machine-readable 문서는 crawler 허용 정책과 함께 버전 관리해야 한다. 오래된 문서가 Agent에 의해 반복 사용되면 지원 비용이 늘어난다.

### 3. rate limit은 목적별로 다르게 둔다

AI crawler는 사람보다 훨씬 빠르게 반복 조회할 수 있다. 그래서 허용 여부와 별개로 비용 상한이 필요하다. 초기 기준은 보수적으로 잡는다.

- 검증된 Search crawler: 캐시 가능한 문서는 높게 허용하되 origin cache hit ratio 90% 이상을 목표로 한다.
- Agent crawler: 사용자 요청 기반이라면 사용자·agent·IP 조합으로 분당 30~120회 안에서 시작한다. 쓰기 액션은 훨씬 낮게 잡고 idempotency key를 요구한다.
- Training crawler: 계약이 없으면 차단 또는 아주 낮은 rate limit으로 둔다. 계약이 있더라도 off-peak window와 경로 제한을 둔다.
- unknown crawler: zone 또는 host 기준 1~5 req/s에서 시작하고, 비즈니스 가치가 확인되기 전까지 origin bypass를 허용하지 않는다.

백엔드 관점에서는 [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)의 원칙이 그대로 적용된다. crawler도 결국 소비자이고, 소비자별 예산이 있어야 한다. 캐시 적중률이 80% 아래로 떨어지거나 crawler 요청의 origin 5xx 비율이 0.1%를 넘으면 허용 정책을 자동으로 낮추는 것이 좋다.

### 4. 허용의 대가를 숫자로 본다

crawler 정책은 보안팀만의 일이 아니다. 검색 유입, 콘텐츠 수익, 인프라 비용, 파트너십, 법무 리스크가 얽힌 제품 의사결정이다. 따라서 각 crawler에 대해 다음 지표를 함께 본다.

- 요청 수와 대역폭 비용
- cache hit ratio와 origin CPU 사용량
- referral, 가입, 구매, 문서 읽기 같은 downstream 가치
- 콘텐츠 재사용 허가 여부와 라이선스 상태
- user-agent 투명성, 목적 구분 가능성, robots.txt 준수 여부
- blocked 요청 이후 사용자 불만 또는 파트너 영향

예를 들어 어떤 crawler가 하루 500만 요청을 만들지만 referral이 0이고 대부분이 변경 없는 페이지 재조회라면 차단 또는 강한 rate limit이 합리적이다. 반대로 요청 수가 많아도 캐시 hit이 98%이고 유의미한 가입 전환을 만든다면 Search 허용을 유지할 수 있다. 중요한 것은 "AI니까 막자"나 "노출이 필요하니 열자"가 아니라, 목적과 대가가 맞는지를 계속 측정하는 것이다.

## 트레이드오프/주의점

첫 번째 주의점은 과도한 차단이 발견 가능성을 떨어뜨릴 수 있다는 것이다. 특히 기술 블로그, 문서, 오픈소스 프로젝트는 검색과 AI 검색에서 발견되는 것이 채용, 영업, 커뮤니티 성장으로 이어진다. Search crawler까지 막으면 단기 비용은 줄어도 장기 유입이 줄 수 있다.

두 번째는 Agent 경험과 보안의 충돌이다. 에이전트가 사용자를 대신해 서비스를 쓰는 시대에는 bot을 모두 막는 정책이 제품 경쟁력을 낮출 수 있다. 하지만 Agent에게 사람과 같은 세션 권한을 주면 사고 반경이 커진다. Agent 접근은 별도 OAuth scope, 짧은 TTL, 읽기·쓰기 분리, action confirmation을 요구하는 쪽이 안전하다.

세 번째는 목적 분류의 불완전성이다. crawler가 Search, Agent, Training을 명확히 나눠 주지 않으면 운영자는 보수적으로 판단할 수밖에 없다. Cloudflare 발표처럼 mixed-use crawler를 별도 위험군으로 보는 이유다. 개발팀은 "정체를 모르지만 유명 회사라서 허용" 같은 예외를 줄이고, 목적을 증명하지 못하면 낮은 rate limit 또는 차단으로 시작해야 한다.

네 번째는 법무·콘텐츠 정책과 기술 정책의 불일치다. robots.txt에는 Training 차단을 선언했지만 CDN에서는 허용하거나, 약관은 학습 사용을 금지하지만 로그에는 대량 학습 crawler가 남아 있으면 분쟁 시 설명이 어렵다. 정책 문서, edge rule, 로그 대시보드, 영업 계약이 같은 기준을 말해야 한다.

마지막으로 관측 비용도 있다. crawler를 목적별로 분류하려면 로그 저장량과 분석 비용이 늘어난다. 모든 요청을 장기 보관하기보다 최근 30~90일은 세부 로그, 장기 보관은 집계 지표로 나누는 편이 현실적이다. [Observability Baseline](/learning/deep-dive/deep-dive-observability-baseline/)처럼 운영 질문을 먼저 정하고 그 질문에 필요한 필드만 남긴다.

## 체크리스트 또는 연습

### 실무 체크리스트

- 최근 30일 crawler traffic을 Search, Agent, Training, mixed-use, unknown으로 분류했는가?
- Search 허용 crawler의 referral 또는 전환 기여를 최소 월 1회 확인하는가?
- Agent 접근이 필요한 경로와 금지해야 하는 경로가 구분되어 있는가?
- Training 접근은 콘텐츠 라이선스, 광고 수익, 개인정보 정책과 맞는가?
- unknown crawler의 기본 rate limit과 차단 승격 기준이 있는가?
- cache hit ratio 90%, crawler origin 5xx 0.1% 이하 같은 운영 목표가 있는가?
- robots.txt, CDN/WAF rule, API gateway 정책, 약관이 서로 충돌하지 않는가?
- crawler 정책 변경 후 검색 유입, 고객 문의, origin 비용 변화를 7일 단위로 비교하는가?

### 연습

1. 운영 중인 사이트의 상위 20개 crawler User-Agent를 뽑고, 각 항목을 Search, Agent, Training, mixed-use, unknown 중 하나로 분류한다.
2. `/docs`, `/blog`, `/pricing`, `/app`, `/api`, `/premium` 경로별로 Search·Agent·Training 허용 여부를 표로 만든다.
3. unknown crawler가 전체 origin 요청의 35%를 차지하고 cache hit ratio가 70%인 상황을 가정한다. 즉시 차단, rate limit, cache rule 조정, 파트너 확인 중 어떤 순서로 대응할지 정한다.
4. Agent 접근을 허용해야 하는 제품 기능 하나를 고르고, 사용자 승인, OAuth scope, rate limit, 감사 로그, 실패 응답을 설계한다.

AI crawler 정책은 웹 운영의 주변 업무가 아니라 콘텐츠와 제품의 수익 모델을 지키는 계약면이 되고 있다. 2026년의 중요한 변화는 crawler를 좋은 bot과 나쁜 bot으로만 나누지 않는다는 점이다. Search는 발견 가능성을 만들고, Agent는 사용자 대신 행동하며, Training은 콘텐츠의 장기 가치를 가져간다. 개발팀은 이 셋을 같은 트래픽으로 보지 말고, 목적별 권리와 비용을 코드·로그·정책에 함께 반영해야 한다.
