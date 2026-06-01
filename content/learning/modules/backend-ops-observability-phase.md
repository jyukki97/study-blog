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
