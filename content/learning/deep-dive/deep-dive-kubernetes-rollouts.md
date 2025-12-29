---
title: "Kubernetes 롤아웃 전략과 무중단 배포"
date: 2025-12-16
draft: false
topic: "DevOps"
tags: ["Kubernetes", "Deployment", "RollingUpdate", "BlueGreen", "Canary"]
categories: ["DevOps"]
description: "RollingUpdate, Canary, Blue/Green 전략과 실습 체크리스트"
module: "ops-observability"
study_order: 315
quizzes:
  - question: "Kubernetes RollingUpdate에서 maxSurge와 maxUnavailable 설정의 역할은?"
    options:
      - "둘 다 동일한 의미이다."
      - "maxSurge: 새 파드를 추가로 띄울 수, maxUnavailable: 배포 중 내려가도 되는 파드 수를 제어"
      - "CPU 사용량을 제한한다."
      - "메모리를 제한한다."
    answer: 1
    explanation: "가용성 우선이면 maxUnavailable=0으로 설정하고 maxSurge를 늘립니다. 비용 우선이면 surge를 낮추되 배포가 느려질 수 있습니다."

  - question: "Canary 배포의 핵심이 '배포'보다 '관측'인 이유는?"
    options:
      - "관측이 더 재미있어서"
      - "소수 사용자에게 먼저 노출하고, 에러율/레이턴시 지표가 기준을 넘으면 즉시 롤백해야 하기 때문"
      - "배포가 더 어려워서"
      - "비용이 싸서"
    answer: 1
    explanation: "카나리는 '작게 먼저 터뜨리기' 전략입니다. 새 버전을 5%만 노출하고 모니터링해서 문제가 있으면 빠르게 중단합니다."

  - question: "무중단 배포에서 readinessProbe가 중요한 이유는?"
    options:
      - "파드를 재시작하기 위해"
      - "앱이 트래픽을 받을 준비가 될 때까지 Service 엔드포인트에 포함되지 않게 하여, 에러를 방지"
      - "로깅을 위해"
      - "보안을 위해"
    answer: 1
    explanation: "앱이 시작되는 중(warmup)에 트래픽이 들어오면 타임아웃/에러가 발생합니다. readiness가 통과해야 트래픽을 받습니다."

  - question: "배포 시 종료 드레이닝(preStop + terminationGracePeriodSeconds)이 필요한 이유는?"
    options:
      - "빠른 종료를 위해"
      - "기존 연결을 처리 중인 요청이 완료될 때까지 기다려 5xx 에러 없이 종료하기 위해"
      - "메모리를 절약하기 위해"
      - "필요 없다"
    answer: 1
    explanation: "종료 신호를 받은 즉시 끊으면 진행 중인 요청이 실패합니다. preStop에서 준비 상태를 내리고 grace period 동안 기존 연결이 빠져나가게 합니다."

  - question: "kubectl rollout undo만으로 롤백이 완전하지 않을 수 있는 경우는?"
    options:
      - "항상 완전하다."
      - "DB 스키마 변경(컬럼 삭제 등)이 backward compatible하지 않으면, 코드를 되돌려도 서비스가 깨질 수 있다."
      - "네트워크 문제일 때"
      - "CPU 부족일 때"
    answer: 1
    explanation: "새 버전이 컬럼을 삭제했다면 롤백한 구버전 코드가 그 컬럼을 참조하여 에러가 납니다. DB 마이그레이션도 backward compatible하게 설계해야 합니다."
---

## 이 글에서 얻는 것

- RollingUpdate/Canary/Blue-Green의 차이를 “용어”가 아니라 **장애 반경/비용/운영 난이도**로 비교할 수 있습니다.
- 무중단 배포의 핵심(헬스체크, 준비/종료, 드레이닝)을 이해하고 설정 포인트를 잡을 수 있습니다.
- 롤백이 “명령 하나”가 아니라, 데이터 마이그레이션/호환성까지 포함한 운영 루프라는 감각을 얻습니다.

## 0) 무중단 배포는 ‘배포 중에도 요청을 받는다’는 뜻

무중단 배포의 실패는 대부분 “배포 전략”이 아니라 아래에서 터집니다.

- readiness가 늦게/잘못 올라와 트래픽이 너무 빨리 유입
- 종료 시 연결이 끊기며 에러가 발생(드레이닝 부족)
- DB 마이그레이션이 호환되지 않아 새/구 버전이 공존할 수 없음

그래서 전략(롤링/카나리/블루그린)보다 “기본기(헬스체크/그레이스풀)”가 먼저입니다.

## 1) RollingUpdate: 가장 기본, 가장 많이 쓰는 전략

Deployment의 기본 전략은 RollingUpdate입니다.

- `maxSurge`: 새 파드를 얼마나 “추가”로 올릴지
- `maxUnavailable`: 배포 중 “내려가도 되는” 파드 수

감각적으로:

- 가용성을 우선하면 `maxUnavailable`을 낮추고(또는 0), `maxSurge`를 늘립니다.
- 비용을 줄이면 surge를 낮추고 배포가 더 느려질 수 있습니다.

## 2) Canary: “작게 먼저 터뜨리기”

카나리는 새 버전을 소수만 노출해 문제를 빨리 발견하고, 안전하면 점진적으로 늘리는 방식입니다.

구현 방식은 환경에 따라 다릅니다.

- Ingress에서 가중치 라우팅(지원되는 컨트롤러/설정)
- 서비스 메시(Istio/Linkerd)로 트래픽 분할
- 별도 Service/Deployment를 두고 라우팅을 제어

카나리의 핵심은 “배포”보다 “관측”입니다.

- 에러율/레이턴시/자원 사용량이 기준을 넘으면 즉시 중단/롤백

## 3) Blue/Green: “완전히 분리하고 스위치”

Blue(현재)와 Green(새 버전)을 동시에 유지하고, 트래픽을 스위칭합니다.

장점:

- 전환/롤백이 빠르고 명확합니다(스위치만 되돌리면 됨).

단점:

- 두 환경을 동시에 유지하므로 비용이 증가합니다.
- DB 마이그레이션/상태 공유가 있으면 “완전 분리”가 어려울 수 있습니다.

## 4) 무중단 배포의 기본기: readiness/liveness, 종료 드레이닝

### 4-1) readinessProbe: “트래픽 받을 준비가 됐나”

readiness가 통과하기 전에는 서비스 엔드포인트에 포함되지 않게 해야 합니다.
가장 흔한 사고는 “앱은 뜨는 중인데 트래픽이 들어오는” 케이스입니다.

### 4-2) livenessProbe: “죽었나(재시작 대상인가)”

liveness는 잘못 설정하면 정상 파드를 죽이는 무기가 됩니다.
“외부 의존성 장애”를 liveness로 보면, 장애 때 재시작 폭풍이 날 수 있으니 주의합니다.

### 4-3) 종료 드레이닝: preStop + grace period

배포/스케일 인 시 연결을 끊지 않으려면:

- `preStop` 훅으로 종료 신호를 받은 뒤 준비 상태를 내리고
- `terminationGracePeriodSeconds` 동안 기존 연결이 빠져나가게(드레인)

하도록 설계합니다.

## 5) 롤백: 데이터/호환성까지 포함해서 설계하라

`kubectl rollout undo`는 코드 롤백입니다.
하지만 DB 스키마/마이그레이션이 호환되지 않으면 “코드만 되돌려도” 서비스가 깨질 수 있습니다.

실무에서는 다음을 함께 설계합니다.

- backward compatible 마이그레이션(확장 → 백필 → 전환 → 정리)
- 기능 플래그로 위험 기능을 빠르게 끄는 방법

## 6) 자주 하는 실수

- readiness/liveness를 같은 엔드포인트로 둬서 장애 상황에 재시작 폭풍
- 종료 드레이닝 없이 바로 SIGKILL처럼 끊겨 5xx 증가
- 롤백을 고려하지 않은 DB 변경(컬럼 삭제/타입 변경 등)
- 카나리를 했지만 “판단 지표”가 없어 결국 감으로 진행

## 연습(추천)

- `maxSurge/maxUnavailable`을 바꿔가며 배포 시간/에러율이 어떻게 달라지는지 관찰해보기
- readiness를 일부러 늦게 올리거나 잘못 설정해보고, 배포 중 에러가 왜 나는지 재현해보기
- “호환 가능한 마이그레이션” 시나리오(컬럼 추가→백필→전환→삭제)를 작은 예제로 문서화해보기
