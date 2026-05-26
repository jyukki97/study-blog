---
title: "백엔드 심화 학습"
description: "백엔드 개발자가 알아야 할 핵심 개념을 깊이 있게 학습합니다"
---

백엔드 개발의 핵심 개념을 심도 있게 다룹니다. JVM 내부 구조, GC 알고리즘, Spring AOP/Transaction/Security, JPA N+1 문제, Database 인덱싱, Redis 캐싱 전략처럼 기반 지식이 되는 주제부터, 배포 안정성·관측성·트래픽 전환·장애 대응처럼 운영에서 바로 쓰이는 주제까지 함께 정리합니다.

이 페이지는 단순 목록이 아니라 **지금 어떤 문제를 풀고 있는지에 따라 바로 들어갈 수 있는 학습 허브**로 쓰는 것을 목표로 합니다. 개념을 처음 잡을 때는 기초 설명을 먼저 보고, 이미 운영 이슈를 겪고 있다면 아래 추천 경로처럼 관련 글을 묶어서 읽어보세요.

## 오늘 추천 학습 경로: 안전한 릴리스와 운영 검증

최근 백엔드 시스템은 기능을 "한 번에 배포하고 끝"내기보다, 작은 단위로 노출하고 관측한 뒤 점진적으로 확대하는 방향으로 움직입니다. 배포 자체보다 중요한 것은 **새 경로가 실제 트래픽을 만났을 때 어떤 비용·지연·정합성 리스크를 만들지 미리 확인하는 것**입니다. 그래서 오늘은 기능 플래그, 트래픽 전환, Shadow Traffic, Drain-aware 배포, 분산 트레이싱을 하나의 릴리스 검증 흐름으로 묶었습니다.

1. [Feature Flag: 배포와 릴리스를 분리하는 운영 패턴](/learning/deep-dive/deep-dive-feature-flags/)
2. [Feature Flag Lifecycle Cleanup: 오래된 플래그가 운영 부채가 되지 않게 하는 법](/learning/deep-dive/deep-dive-feature-flag-lifecycle-cleanup-playbook/)
3. [Traffic Cutover & Migration: 트래픽 전환을 안전하게 설계하는 법](/learning/deep-dive/deep-dive-traffic-cutover-migration/)
4. [백엔드 커리큘럼 심화: Shadow Traffic과 Dark Launch 운영 플레이북](/learning/deep-dive/deep-dive-shadow-traffic-dark-launch-playbook/)
5. [Drain-aware Deployment: 연결을 끊지 않는 배포 전략](/learning/deep-dive/deep-dive-drain-aware-deployment-playbook/)
6. [분산 트레이싱 도입 플레이북](/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/)

### 이런 분에게 특히 추천

- 새 기능을 배포할 때마다 "문제 생기면 바로 롤백" 말고 더 구체적인 사전 검증 절차가 필요한 경우
- 카나리, blue/green, feature flag, shadow traffic의 차이가 머릿속에서 섞이는 경우
- p95/p99 지연, 에러율, diff rate, queue lag처럼 릴리스 중단 기준을 숫자로 잡고 싶은 경우
- 배포 중 커넥션 드레인, 캐시 워밍, downstream 부하, 추적 ID 전파가 자주 빠지는 경우

### 읽는 순서 팁

- **릴리스 제어가 약하면** Feature Flag부터 읽고, 배포와 기능 노출을 분리하는 기준을 먼저 잡습니다.
- **플래그가 오래 남는다면** Feature Flag Lifecycle Cleanup 글에서 owner, 만료일, cleanup trigger를 먼저 고정합니다.
- **트래픽을 옮겨야 한다면** Traffic Cutover 글에서 전환 단위, rollback window, 성공 기준을 확인합니다.
- **사용자 영향 없이 검증하고 싶다면** Shadow Traffic 글로 넘어가 복제 금지 요청, PII 마스킹, diff checker 기준을 정합니다.
- **배포 중 연결 끊김이 문제라면** Drain-aware Deployment로 readiness, preStop, connection draining 순서를 점검합니다.
- **원인 추적이 어렵다면** 분산 트레이싱 글을 마지막에 붙여 trace/span/log correlation을 보강합니다.

### 실무 적용 체크리스트

아래 항목을 릴리스 리뷰 템플릿에 붙여두면 글을 읽고 끝나는 것을 줄일 수 있습니다.

- 기능 플래그 이름, owner, 기본값, 만료 예정일이 정해져 있는가?
- 새 경로로 보낼 트래픽 비율과 증가 간격이 문서화되어 있는가?
- shadow 대상에서 결제·주문·포인트·알림처럼 부작용이 있는 요청을 차단했는가?
- 신규/기존 응답 diff에서 정확히 일치해야 하는 필드와 허용 오차가 있는 필드를 나눴는가?
- p95/p99, error rate, timeout, queue lag, downstream QPS의 중단 기준이 숫자로 적혀 있는가?
- 배포 종료 전 readiness false, connection drain, background worker stop 순서가 검증되었는가?
- 문제가 생겼을 때 flag off, traffic shift back, rollback deploy 중 무엇을 먼저 할지 정했는가?
- 장애 분석을 위해 trace id, request id, feature flag variant, shadow run id가 로그에 남는가?

이 경로를 다 읽고 나면 특정 배포 기법 이름을 아는 수준을 넘어, **릴리스 전 검증 → 제한 노출 → 관측 → 중단/확대 판단 → 롤백**까지 하나의 운영 루프로 설계할 수 있습니다. 블로그에 흩어진 심화 글도 이 흐름 안에서 다시 연결되므로, 최신 글을 읽은 뒤 관련 개념으로 자연스럽게 이동하기 좋아집니다.

## 기존 설계 학습 경로: DDD와 헥사고날 아키텍처

구조 설계 주제가 필요하다면 아래 경로를 이어서 보면 좋습니다. 운영 안정화가 "릴리스 후 시스템을 지키는 기술"이라면, DDD와 헥사고날 아키텍처는 "변경이 잦아도 도메인 규칙을 잃지 않는 구조"에 가깝습니다.

1. [DDD 전술적 설계: Entity, VO, 그리고 Aggregate](/learning/deep-dive/deep-dive-ddd-tactical/)
2. [육각형 아키텍처 (Hexagonal): 도메인을 프레임워크로부터 격리하라](/learning/deep-dive/deep-dive-hexagonal-architecture/)
3. [DDD 심화: Aggregate Root와 트랜잭션 경계](/learning/deep-dive/deep-dive-ddd-aggregates/)

개념이 약하면 `DDD 전술적 설계`부터 시작하고, 현재 구조 개선이 급하면 `육각형 아키텍처`를 먼저 읽은 뒤, 운영 관점의 경계 설정이 궁금하면 `Aggregate Root와 트랜잭션 경계`까지 이어서 보세요. 이 경로를 다 읽고 나면 단순히 패턴 이름을 아는 수준이 아니라, **도메인 규칙을 어디에 두고 어떤 경계로 보호할지**를 더 분명하게 판단할 수 있습니다.
