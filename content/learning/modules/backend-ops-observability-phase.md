---
title: "6단계: 클라우드 네이티브 & DevOps"
date: 2025-12-16
draft: false
topic: "Backend Roadmap"
tags: ["DevOps", "CI/CD", "모니터링", "AWS", "Docker", "K8s", "Release Engineering"]
categories: ["Learning"]
description: "Docker, K8s, CI/CD, 모니터링, 트레이싱까지 운영 스택을 갖추는 모듈"
weight: 6
study_order: 600
layout: "learning-module"
module_key: "ops-observability"
url: "/learning/modules/backend-ops-observability-phase/"
aliases:
  - "/learning/modules/backend-ops-observability-phase/"
learning_refs:
  - title: "Observability Baseline"
    href: "/learning/deep-dive/deep-dive-observability-baseline/"
    description: "서비스를 운영하기 전에 로그, 메트릭, 트레이스, 대시보드, 알람의 최소 기준선을 잡는 방법입니다."
  - title: "알람 전략: 에러율/레이턴시/자원지표 설계"
    href: "/learning/deep-dive/deep-dive-observability-alarms/"
    description: "운영자가 실제로 깨야 하는 알람과 노이즈를 만드는 알람을 구분하는 기준입니다."
  - title: "SLO/SLI/Error Budget"
    href: "/learning/deep-dive/deep-dive-slo-sli-error-budget/"
    description: "가용성 목표를 감으로 정하지 않고 사용자 영향과 변경 속도를 함께 판단하는 운영 지표입니다."
  - title: "Feature Flag Lifecycle Cleanup"
    href: "/learning/deep-dive/deep-dive-feature-flag-lifecycle-cleanup-playbook/"
    description: "플래그를 생성할 때 owner, expiry, cleanup trigger를 함께 정의해 릴리스 부채를 줄이는 운영 절차입니다."
  - title: "Traffic Cutover & Migration"
    href: "/learning/deep-dive/deep-dive-traffic-cutover-migration/"
    description: "새 경로로 트래픽을 옮길 때 전환 단위, 성공 기준, 롤백 윈도우를 숫자로 고정하는 방법입니다."
  - title: "분산 트레이싱 도입 플레이북"
    href: "/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/"
    description: "릴리스 중 문제가 생겼을 때 trace/span/log correlation으로 원인을 좁히는 관측성 기준입니다."
  - title: "인시던트 커맨드와 Severity 운영 플레이북"
    href: "/learning/deep-dive/deep-dive-incident-command-severity-playbook/"
    description: "장애가 실제로 발생했을 때 IC, Tech Lead, 커뮤니케이션, 종료 기준을 역할과 숫자로 고정하는 절차입니다."
---

## 이 단계에서 얻는 것

이 단계는 “기능을 만든다”에서 한 단계 더 나아가, **만든 서비스를 안전하게 운영하는 능력**을 만드는 구간입니다.

- **배포 가능한 형태로 만들기**: Docker로 패키징하고, 환경 차이를 통제할 수 있습니다.
- **자동화된 품질 게이트**: CI에서 테스트/빌드/리포트를 고정해 “깨지는 코드”가 들어오는 걸 줄입니다.
- **무중단 배포/롤백 감각**: 롤아웃 전략과 헬스체크를 이해하고, 장애 시 빠르게 되돌릴 수 있습니다.
- **관측성 베이스라인**: 로그·메트릭·트레이스로 “왜 느린지/왜 실패하는지”를 추측이 아니라 데이터로 파악합니다.
- **운영 보안 기본기**: 비밀 관리/네트워크/권한 최소화 같은 운영 기본기를 갖춥니다.

## 이 모듈을 보는 방법

이 모듈은 “읽고 끝”보다, 작은 서비스 하나를 정해서 아래를 계속 반복하는 방식이 효과적입니다.

1) Docker로 패키징한다  
2) CI로 테스트/빌드를 고정한다  
3) 배포하고(헬스체크/롤백 포함)  
4) 관측성을 붙여서 지표로 확인한다  

각 글의 연습은 “완벽한 인프라”가 아니라, **운영 사고를 막는 최소한의 기준**을 만드는 데 목적이 있습니다.

## 왜 이런 순서인가

운영 문제는 보통 “환경/배포/관측”에서 시작합니다.

- 먼저 컨테이너로 실행 환경을 고정하고,
- CI로 품질/재현성을 확보한 뒤,
- 배포 전략과 관측성으로 “장애를 빠르게 발견하고 되돌리는” 루프를 만듭니다.

## 이 단계의 핵심 주제

- 컨테이너 패키징(Docker)과 환경 분리
- CI/CD 파이프라인과 품질 게이트
- 배포 전략(롤링/블루그린/카나리)과 롤백
- 관측성(Logs/Metrics/Tracing) 기본
- 운영 보안(비밀 관리, 최소 권한)

## 관측성 기준선: 무엇을 먼저 볼 것인가

운영 모듈에서 관측성을 배울 때 가장 흔한 실수는 도구 이름을 먼저 외우는 것입니다. Prometheus, Grafana, Loki, OpenTelemetry, Jaeger 같은 도구는 중요하지만, 더 먼저 정해야 하는 것은 **서비스가 건강하다고 말할 수 있는 기준**입니다. 기준이 없으면 대시보드는 예쁜 숫자판이 되고, 알람은 밤마다 울리는 소음이 됩니다.

작은 백엔드 서비스라도 처음에는 아래 네 가지 신호를 한 화면에 모으는 것을 목표로 잡으면 좋습니다.

1. **요청 성공률**: HTTP 5xx, 비즈니스 실패, timeout을 분리해서 봅니다. 단순히 200이 많다고 안전한 것이 아니라, 결제 실패·권한 실패·큐 적재 실패처럼 사용자 행동을 막는 실패를 따로 봐야 합니다.
2. **지연 시간**: 평균보다 p95/p99를 우선합니다. 평균은 일부 느린 요청을 숨기기 쉽고, 실제 사용자는 꼬리 지연에서 불편을 느끼기 때문입니다.
3. **포화도**: CPU, 메모리, DB 커넥션 풀, worker queue, thread pool, downstream QPS를 함께 봅니다. 포화도는 에러보다 먼저 올라오는 경우가 많아서 조기 경보 역할을 합니다.
4. **변경 이력**: 배포 버전, feature flag variant, 설정 변경, 인프라 변경 시간을 지표와 같은 화면에 표시합니다. 장애 원인 분석에서 "언제부터"를 빠르게 좁히는 데 가장 큰 도움을 줍니다.

### 로그/메트릭/트레이스 역할 분리

세 가지를 모두 붙이는 것보다, 각각의 역할을 구분하는 편이 더 중요합니다.

- **로그**는 개별 사건을 설명합니다. request id, user/account scope, feature flag, 주요 domain id, 에러 코드가 남아야 합니다.
- **메트릭**은 추세와 임계값을 보여줍니다. 요청 수, 실패율, 지연 시간, 큐 길이, 재시도 수처럼 집계 가능한 숫자를 남깁니다.
- **트레이스**는 경로를 연결합니다. API gateway, 애플리케이션, DB, 캐시, 메시지 브로커, 외부 API 호출을 하나의 흐름으로 묶습니다.

예를 들어 주문 생성 API가 느려졌다면 메트릭은 "p99가 2초에서 8초로 올랐다"를 알려주고, 트레이스는 "재고 서비스 호출에서 6초를 썼다"를 보여주며, 로그는 "특정 warehouse id에서 lock wait가 반복됐다"를 설명합니다. 이 셋이 연결되어야 운영자는 감으로 추측하지 않고 다음 조치를 정할 수 있습니다.

### 알람을 만들 때의 최소 기준

알람은 많이 만들수록 안전해지는 것이 아닙니다. 운영자가 실제로 행동할 수 없는 알람은 곧 무시됩니다. 이 모듈에서는 알람을 추가할 때마다 아래 질문을 통과시키는 습관을 들이면 좋습니다.

- 이 알람은 사용자 영향과 연결되는가?
- 알람이 울리면 10분 안에 할 수 있는 첫 조치가 있는가?
- warning과 critical의 차이가 숫자로 구분되는가?
- 배포 직후 일시적 변동과 실제 장애를 구분할 방법이 있는가?
- 같은 원인으로 알람 10개가 동시에 울릴 때 대표 알람이 정해져 있는가?
- 업무 시간 외에 깨울 만큼 긴급한가?

예를 들어 CPU 90% 알람만으로는 부족합니다. CPU가 높아도 요청 성공률과 지연 시간이 정상이라면 튜닝 대상일 수는 있어도 즉시 장애는 아닐 수 있습니다. 반대로 CPU가 50%여도 DB 커넥션 풀이 고갈되어 요청이 timeout된다면 사용자 영향은 이미 발생한 것입니다. 그래서 알람은 리소스 지표 단독보다 **성공률 + 지연 시간 + 포화도**를 함께 보는 쪽이 더 안전합니다.

### 실습 확장: 운영 런북 1장 만들기

이 단계의 미니 실습을 끝냈다면, 마지막에 서비스별 운영 런북을 한 장으로 정리해보세요. 형식은 길 필요가 없습니다.

- 서비스가 제공하는 핵심 사용자 행동 1~3개
- 각 행동의 SLI: 성공률, p95/p99, 처리량, 큐 지연
- 장애로 볼 기준: 몇 분 동안 어떤 숫자가 넘으면 장애인지
- 첫 확인 화면: 대시보드 URL, 로그 검색 쿼리, trace 검색 기준
- 첫 조치: rollback, flag off, traffic shift, queue drain, rate limit 중 우선순위
- 에스컬레이션 기준: 누구에게, 어떤 증거를 붙여, 몇 분 안에 넘길지
- 종료 기준: 에러율 회복, backlog 해소, 데이터 보정 완료, 회고 액션 등록

이 런북을 만들고 나면 Docker/CI/CD/관측성 글이 따로 노는 것이 아니라 하나의 운영 루프로 이어집니다. 개발자는 코드를 배포하는 데서 끝나지 않고, "사용자가 실제로 문제없이 쓰고 있는가"를 숫자로 확인하는 습관을 갖게 됩니다.

## 릴리스 운영 루프: 만들고, 노출하고, 지우기

운영 모듈에서 자주 빠지는 부분은 "배포가 끝난 뒤 남는 것"입니다. Docker 이미지가 잘 빌드되고 CI가 초록색이며 카나리 배포가 성공해도, 릴리스 플래그·임시 우회 코드·대시보드 필터·알람 예외가 계속 남아 있으면 다음 변경의 비용이 올라갑니다. 그래서 이 단계에서는 배포 전략을 **release control loop**로 봐야 합니다.

실무에서는 아래 순서로 연결하면 좋습니다.

1. **릴리스 전 계약 작성**: 기능 플래그를 만든다면 owner, 기본값, 만료일, 성공 지표, rollback window를 같이 기록합니다.
2. **제한 노출**: 카나리나 트래픽 전환 비율을 정하고, p95/p99 지연·error rate·timeout·queue lag 기준을 숫자로 둡니다.
3. **관측성 연결**: trace id, request id, flag variant, rollout version이 로그와 메트릭에서 함께 보이게 합니다.
4. **중단/확대 판단**: 성공 기준을 만족하면 노출 비율을 올리고, 실패하면 flag off, traffic shift back, rollback deploy 중 무엇을 먼저 할지 실행합니다.
5. **부채 정리**: 100% 노출 후 안정 기간이 지나면 죽은 분기, 테스트 fixture, 문서, 대시보드 필터, 운영 콘솔 key까지 cleanup 범위에 넣습니다.

이 루프를 넣으면 "무중단 배포를 할 줄 안다"에서 끝나지 않고, 변경이 반복되어도 운영 표면이 계속 정리됩니다. 특히 릴리스 플래그는 시간이 지나면 테스트 조합을 폭발시키기 때문에, 생성 시점부터 제거 조건을 같이 두는 편이 장기적으로 더 안전합니다.

### 추천 연결 글

- [Feature Flag Lifecycle Cleanup](/learning/deep-dive/deep-dive-feature-flag-lifecycle-cleanup-playbook/): 오래된 플래그가 운영 부채가 되지 않게 owner, expiry, cleanup trigger를 관리하는 방법
- [Traffic Cutover & Migration](/learning/deep-dive/deep-dive-traffic-cutover-migration/): 트래픽 전환 단위와 롤백 윈도우를 설계하는 방법
- [분산 트레이싱 도입 플레이북](/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/): 릴리스 중 장애 원인을 추적하기 위한 trace/span/log 기준
- [인시던트 커맨드와 Severity 운영 플레이북](/learning/deep-dive/deep-dive-incident-command-severity-playbook/): 실제 장애가 선언된 뒤 역할, 15분 업데이트, 종료 기준을 운영하는 방법

## 미니 실습

- **이미지 빌드 & 실행**: Dockerfile로 빌드 → 컨테이너 실행
- **CI 파이프라인 구성**: 테스트/빌드 자동화 1회 성공
- **대시보드 만들기**: p95/p99, 에러율, CPU/메모리 한 화면 구성

## 완료 기준 (다음 단계로 넘어가기 전)

- 도커 이미지로 빌드/실행이 가능하고, 로컬에서 docker-compose로 의존성을 함께 올릴 수 있다
- PR 기준으로 테스트가 자동 실행되고, 실패 시 원인이 재현 가능하게 남는다
- 배포 시 헬스체크/롤백이 동작하고, 최소한의 런북(롤백 절차)이 있다
- p95/p99 레이턴시/에러율/리소스 사용량을 한 화면에서 볼 수 있다(대시보드 1개라도)
