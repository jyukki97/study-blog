---
title: "블로그 아카이브"
date: 2026-03-11
lastmod: 2026-07-08
description: "개발 트렌드 분석, 프로젝트 회고, 기술 뉴스를 AI 운영, 보안, 백엔드 설계 관점으로 빠르게 탐색할 수 있는 아카이브 페이지"
tags: ["posts", "index", "아카이브"]
keywords: ["개발 블로그 아카이브", "백엔드 학습 글", "기술 트렌드 정리", "AI 운영 거버넌스", "프로젝트 회고"]
---

이 페이지는 블로그의 전체 글을 **학습, 트렌드, 프로젝트** 관점으로 빠르게 훑기 위한 허브입니다. 글 수가 늘어나면 최신 글만 따라가서는 맥락이 끊기기 쉬워서, 어떤 독자가 어떤 순서로 읽으면 좋은지 한눈에 잡을 수 있게 구조를 정리해 두는 편이 더 낫다고 생각했습니다.

특히 이 블로그는 단순 뉴스 요약보다, **실무 의사결정에 바로 연결되는 기준**을 남기는 데 초점을 두고 있습니다. 그래서 같은 주제라도 “개념 설명”, “운영 관점 해석”, “프로젝트 구현 경험”이 섞여 있습니다. 아카이브를 볼 때는 최신순보다도, 지금 내게 필요한 읽기 목적이 무엇인지 먼저 정하고 들어오는 편이 효율적입니다.

## 이번 주 먼저 읽으면 좋은 흐름

이번 주의 새 글은 **배포 결정을 위한 LLM 평가 → 관측 데이터의 완전성 → 플랫폼 리소스 계약 → 실행 권한의 경계**라는 하나의 흐름으로 읽는 편이 좋습니다. 최근 글의 공통점은 새 기능을 도입할 수 있느냐가 아니라, 그 기능이 내놓는 수치와 결과를 어느 조건에서 신뢰하고 언제 사람에게 되돌릴지를 먼저 정한다는 데 있습니다.

처음 방문한 독자라면 아래 여섯 편을 순서대로 읽어 보세요. 평가 기준을 먼저 세우고, 그 기준을 만드는 관측 데이터가 누락되지 않는지 확인한 뒤, 인프라 계약과 에이전트 실행 경계로 넓혀 가는 동선입니다.

1. [LLM 평가는 점수표가 아니라 배포 결정을 위한 Guardrail이 된다](/posts/2026-09-04-llm-evaluation-decision-guardrail-production-trend/) : primary outcome, 안전 제약, 운영 guardrail을 섞지 않고 release gate로 만드는 기준을 잡습니다.
2. [OpenTelemetry Metric Cardinality Limit과 데이터 완전성](/posts/2026-09-03-opentelemetry-metric-cardinality-overflow-data-completeness-trend/) : 총합이 남아 있어도 속성별 수치가 조용히 누락될 수 있는 overflow를 SLO·경보 관점에서 살핍니다.
3. [Kubernetes Metrics API와 DRA 리소스 계약](/posts/2026-09-02-kubernetes-metrics-api-dra-resource-contract-trend/) : 관측·스케줄링 입력이 바뀔 때 API 버전, 리소스 소유권, fallback을 함께 검증하는 방법을 연결합니다.
4. [OpenTelemetry Go Logs RC와 상관관계 계약](/posts/2026-09-01-opentelemetry-go-logs-rc-correlation-contract-trend/) : 로그·trace·metric을 한 화면에 모으기 전에 어떤 correlation key와 누락 기준을 계약으로 둘지 확인합니다.
5. [도구 선택과 데이터 이식성에 관한 9월 4일 개발 뉴스](/posts/2026-09-04-dev-news-senior-insights/) : 코딩 에이전트의 도구 호출, 도메인·데이터 이식성, 신원확인의 문제를 통제권과 되돌림 관점으로 읽습니다.
6. [AI의 실행 경계와 개발 기본값에 관한 9월 3일 개발 뉴스](/posts/2026-09-03-dev-news-senior-insights/) : 로컬 LLM, 에이전트 거래, 로컬 검색을 도입할 때 읽기·쓰기 권한과 재검증 경계를 어떻게 나눌지 정리합니다.

이 흐름을 읽을 때는 다음 네 가지 질문을 붙이면 글 사이의 연결이 더 선명해집니다.

- 이 변경이 내리는 제품 또는 운영 결정은 무엇이며, 평균 점수와 별개로 절대 허용할 수 없는 실패는 무엇인가?
- 그 결정을 뒷받침하는 metric·log·trace가 속성별로도 완전한가? overflow·지연·누락 때 어떤 자동화가 멈춰야 하는가?
- 외부 API, 리소스, 데이터 저장소가 바뀔 때 owner·버전·fallback·rollback이 같은 변경 단위에 기록되는가?
- 에이전트가 읽기에서 쓰기 작업으로 넘어가는 순간에 서버 재검증, 최소 권한, idempotency, 사람 승인이 남는가?

조금 더 깊게 들어가고 싶다면 [Synthetic Replay 기반 평가 Gate](/posts/2026-04-20-synthetic-replay-eval-gate-trend/), [OpenTelemetry 선언적 구성과 버전 계약](/posts/2026-08-29-opentelemetry-declarative-config-versioned-contract-trend/), [Agent Sandbox Egress Policy](/posts/2026-05-16-agent-sandbox-egress-policy-trend/)를 이어 읽어 보세요. 각각 재현 가능한 검증, telemetry 설정의 배포 안전성, 외부 호출 권한을 보강합니다.

따라서 이번 주의 추천 동선은 “더 많은 자동화”가 아니라 **결정 기준 → 데이터 신뢰성 → 변경 계약 → 실행 권한**을 차례로 확인하는 흐름입니다. 이 순서로 보면 AI 기능, 관측성, Kubernetes, 외부 플랫폼처럼 다른 주제도 결국 신뢰할 수 있는 입력과 되돌릴 수 있는 실행을 설계하는 문제로 만난다는 점을 확인할 수 있습니다.

## 이 아카이브를 가장 잘 쓰는 방법

### 1) 요즘 흐름을 빠르게 파악하고 싶을 때

최근 개발 트렌드 글부터 2, 3편 읽는 방식이 가장 빠릅니다. 단순히 새 기술 이름을 외우기보다,

- 왜 갑자기 팀들이 그 주제를 중요하게 보는지
- 비용, 품질, 운영 리스크가 어디서 바뀌는지
- 당장 체크해야 할 지표나 체크리스트가 무엇인지

를 같이 보는 데 초점을 맞추면 좋습니다.

바로 들어가기 좋은 글:

- [/posts/2026-04-19-policy-shadow-rollout-agent-runtime-trend/](/posts/2026-04-19-policy-shadow-rollout-agent-runtime-trend/)
- [/posts/2026-04-16-context-contract-registry-agent-input-governance-trend/](/posts/2026-04-16-context-contract-registry-agent-input-governance-trend/)
- [/posts/2026-04-10-test-evidence-pipeline-ai-change-review-trend/](/posts/2026-04-10-test-evidence-pipeline-ai-change-review-trend/)
- [/posts/2026-04-09-harness-engineering-agent-runtime-frame-trend/](/posts/2026-04-09-harness-engineering-agent-runtime-frame-trend/)

### 2) 개념을 체계적으로 다시 잡고 싶을 때

학습용 글은 용어 설명에서 끝나지 않고, 실제 시스템 설계나 장애 대응에 연결되는 예시를 같이 넣는 편입니다. 그래서 익숙한 주제라도 “왜 이 개념이 운영에서 중요해지는지”를 다시 정리할 때 읽기 좋습니다.

추천 진입 순서:

1. 관심 분야 키워드로 검색한다.
2. 짧은 트렌드 글로 문제의식을 먼저 잡는다.
3. 관련 심화 학습 글로 개념을 보강한다.
4. 프로젝트 글에서 구현 흔적과 trade-off를 확인한다.

이 순서로 보면 읽은 내용이 머릿속에 더 오래 남습니다.

### 3) 프로젝트 맥락까지 보고 싶을 때

프로젝트 글은 결과만 나열하기보다, 중간에 부딪힌 문제와 설계가 바뀐 이유를 같이 남겨 두는 쪽을 선호합니다. 그래서 완성된 정답보다는 **생각이 바뀌는 과정**을 보고 싶은 분에게 더 잘 맞습니다.

대표 시리즈:

- [/projects/pgmux/](/projects/pgmux/)
- [/posts/sqs-01-architecture/](/posts/sqs-01-architecture/)
- [/posts/sqs-02-admin-dashboard/](/posts/sqs-02-admin-dashboard/)
- [/posts/sqs-03-storage-architecture/](/posts/sqs-03-storage-architecture/)

## 추천 읽기 흐름

### 흐름 A. AI 개발 생산성, 거버넌스, 리뷰 체계

1. Harness Engineering으로 실행 프레임 관점을 잡고
2. Tool Permission Manifest / Runtime Validator 계열 글로 통제 구조를 보고
3. Test Evidence Pipeline 글로 리뷰 단계에서 어떤 증거가 필요한지 연결해서 읽으면 좋습니다.

이 흐름은 “AI가 코드를 더 빨리 쓴다”를 넘어서, **팀이 어떻게 안전하게 더 많이 처리할 것인가**를 고민할 때 특히 유용합니다.

### 흐름 B. 백엔드 학습에서 실무 설계로 넘어가기

1. 학습 글에서 기초 개념을 다시 잡고
2. 트렌드 글에서 현업 우선순위를 확인한 뒤
3. 프로젝트 글에서 구현 선택과 한계를 비교해 보세요.

이렇게 보면 개념이 추상적으로만 남지 않고, 실제 설계 기준으로 연결됩니다.

### 흐름 C. 시리즈형 프로젝트 따라가기

프로젝트 글은 앞뒤 문맥이 이어지는 경우가 많아서, 검색으로 한 편만 읽기보다 관련 글을 연속해서 보는 편이 훨씬 낫습니다. 특히 PGMUX, Simple Queue Service 같은 시리즈는 문제 발견 → 설계 수정 → 운영 관점 재정리 순서로 보면 흐름이 잘 보입니다.

### 흐름 D. 에이전트 운영 거버넌스 흐름으로 읽기

최근 AI 운영 글은 서로 따로 읽어도 되지만, 아래 순서로 보면 입력, 실행, 전달, 검증 통제가 한 흐름으로 이어집니다.

1. [/posts/2026-04-16-context-contract-registry-agent-input-governance-trend/](/posts/2026-04-16-context-contract-registry-agent-input-governance-trend/) 에서 입력 계약과 컨텍스트 소유권을 먼저 잡고
2. [/posts/2026-04-05-tool-permission-manifest-runtime-attestation-trend/](/posts/2026-04-05-tool-permission-manifest-runtime-attestation-trend/) 으로 실행 권한 경계를 확인한 뒤
3. [/posts/2026-04-14-execution-receipt-agent-operations-trend/](/posts/2026-04-14-execution-receipt-agent-operations-trend/) 에서 실제 실행 증거와 추적 구조를 연결하고
4. [/posts/2026-04-17-agent-handoff-packet-runtime-trend/](/posts/2026-04-17-agent-handoff-packet-runtime-trend/) 으로 멀티에이전트 handoff를 작업 패킷 관점으로 마무리하고
5. [/posts/2026-04-19-policy-shadow-rollout-agent-runtime-trend/](/posts/2026-04-19-policy-shadow-rollout-agent-runtime-trend/) 으로 새 정책을 바로 enforce하지 않고 shadow rollout으로 올리는 기준까지 이어서 보면 좋습니다.

이 순서는 "에이전트를 어떻게 더 똑똑하게 만들까"보다, **팀이 어떻게 더 안전하게 운영 품질을 유지할까**에 초점을 맞출 때 특히 유용합니다. 특히 마지막 글까지 읽으면 입력 계약과 실행 증거가 왜 결국 정책 배포 기준으로 이어지는지 한 번에 이해하기 쉬워집니다.

추가로 바로 이어 읽고 싶다면 아래 두 편도 잘 붙습니다.

- [/posts/2026-04-12-action-lineage-agent-observability-graph-trend/](/posts/2026-04-12-action-lineage-agent-observability-graph-trend/) : handoff 전후에 어떤 실행 흔적을 추적해야 하는지 볼 때 좋습니다.
- [/posts/2026-04-11-stateful-sandbox-snapshot-environment-replay-trend/](/posts/2026-04-11-stateful-sandbox-snapshot-environment-replay-trend/) : packet에 snapshot 참조를 왜 같이 묶어야 하는지 이해할 때 연결감이 좋습니다.

## 검색과 태그를 사용할 때 팁

- 특정 기술 이름이 분명하면 검색창으로 바로 찾는 편이 가장 빠릅니다.
- 주제가 넓다면 태그로 먼저 범위를 줄이고, 그다음 제목과 설명을 보는 편이 좋습니다.
- 비슷한 글이 여러 편일 때는 날짜보다 description과 key takeaway를 먼저 확인하면 중복 읽기를 줄일 수 있습니다.

### QA/검증 글을 찾을 때

프로젝트 글에는 "QA"라는 단어가 제목과 본문에 자주 나오지만, 태그에서는 더 넓은 의미의 **Quality Assurance**로 묶어두는 편이 탐색에 유리합니다. QA는 버그를 찾는 단계만 뜻하지 않고, 릴리스 전에 어떤 실패 모드를 먼저 의심할지, 수정 뒤 어떤 회귀를 막을지, 운영자가 어떤 증거를 보고 배포를 승인할지까지 포함하기 때문입니다.

PGMUX 시리즈를 볼 때는 Quality Assurance 태그가 붙은 글을 단순 버그 수정 목록으로 읽기보다, 다음 질문을 들고 읽으면 더 얻는 게 많습니다.

- 정상 경로에서는 통과하지만 특정 조합에서 깨지는 조건은 무엇이었나?
- 테스트가 놓친 이유는 fixture 부족, 동시성 타이밍, 설정 reload, 프로토콜 경계 중 어디에 있었나?
- 수정이 다시 다른 경로를 깨뜨리지 않도록 어떤 체크를 추가했나?
- 릴리스 전에 사람이 봐야 하는 증거는 테스트 성공, race detector, 로그, 벤치마크, runbook 중 무엇인가?

이 관점으로 읽으면 [QA 소견 6건과 운영 안전성 수정](/posts/2026-03-14-pgmux-46-qa-findings-six-bugs/), [QA 3차: 풀 안전성의 마지막 구멍들](/posts/2026-03-14-pgmux-48-qa-round3-pool-safety/), [QA 5차: 릴리즈 위생과 CI 안정성](/posts/2026-03-17-pgmux-54-qa-round5-release-hygiene/) 같은 글이 단순 회고가 아니라 릴리스 게이트 설계 예시로 보입니다. 특히 AI 코드 리뷰나 자동 수정 도구를 붙이는 팀이라면, "찾았다"보다 "재발하지 않게 어떤 증거를 남겼나"를 중심으로 읽는 편이 좋습니다.

## 이런 분께 특히 맞습니다

- 백엔드와 플랫폼 엔지니어링을 실무 관점으로 정리하고 싶은 분
- 단순 개념 요약보다 운영 trade-off와 의사결정 기준이 궁금한 분
- AI 개발 도구, 런타임 통제, 코드 리뷰 체계 변화를 꾸준히 따라가고 싶은 분
- 프로젝트 회고를 통해 설계가 바뀌는 과정을 보고 싶은 분

필요한 주제가 정해져 있다면 상단 검색과 태그 필터를 먼저 쓰는 게 가장 빠르고, 방향을 아직 못 정했다면 위의 추천 읽기 흐름 중 하나를 골라 따라가면 됩니다.
