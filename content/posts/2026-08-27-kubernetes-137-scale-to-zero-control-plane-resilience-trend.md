---
title: "2026 개발 트렌드: Kubernetes v1.37, Scale-to-Zero와 429 내성이 오토스케일링·컨트롤 플레인 계약을 바꾼다"
date: 2026-08-27T10:06:00+09:00
lastmod: 2026-08-27T10:06:00+09:00
draft: false
tags: ["Kubernetes", "HPA", "Scale to Zero", "Control Plane", "Platform Engineering", "Resilience"]
categories: ["Development", "Platform Engineering", "Cloud Native"]
series: "2026 개발 운영 트렌드"
keywords: ["Kubernetes v1.37", "HPA scale to zero", "ResilientWatchCacheInitialization", "HTTP 429 Retry-After", "Kubernetes control plane"]
description: "Kubernetes v1.37의 HPA scale-to-zero Beta와 watch cache 초기화 안정화, manifest 기반 admission 설정을 바탕으로 workload 비용 최적화와 control-plane 회복력을 함께 설계하는 기준을 정리합니다."
summary: "Kubernetes v1.37은 유휴 worker를 0까지 내리는 기능과 API server가 회복 중 과부하를 429로 경계 짓는 동작을 함께 강화했다. 중요한 변화는 replica 수를 줄이는 것보다, 0에서 깨우는 신호·429 재시도·admission 정책의 부트스트랩 경계를 명시하게 된 점이다."
key_takeaways:
  - "Kubernetes v1.37에서 external/object metric 기반 HPA scale-to-zero가 Beta로 기본 활성화됐다. CPU·메모리만으로는 0에서 다시 깨울 수 없다."
  - "watch cache 초기화 안정화는 API server가 복구 중 무제한 list/watch 요청을 쌓지 않고, 제한된 요청만 처리하며 나머지를 429와 Retry-After로 되돌리는 방향이다."
  - "scale-to-zero와 429는 비용 절감 기능이 아니라 wake-up latency, backlog, retry budget, controller client 동작을 함께 계약화해야 하는 운영 변화다."
  - "manifest 기반 admission 설정은 etcd가 불안정해도 정책을 부트스트랩 단계부터 적용할 수 있지만, 파일 배포·변경 통제·rollback 책임도 키운다."
operator_checklist:
  - "minReplicas: 0은 object/external metric이 있고 0→1 wake-up을 관측할 수 있는 비동기 worker나 GPU/배치 workload부터 적용한다."
  - "queue depth뿐 아니라 oldest message age, cold-start p95, dependency saturation을 함께 보고, critical API·로그인·결제 path는 별도 검토한다."
  - "Kubernetes API를 호출하는 controller·operator·CI는 429와 Retry-After를 정상 과도 상태로 처리하고 exponential backoff와 jitter를 적용한다."
  - "admission static manifest는 owner, version, signature 또는 immutable image, canary cluster, break-glass rollback 경로를 갖춘 뒤 도입한다."
learning_refs:
  - title: "Kubernetes Custom Metrics와 Autoscaling Contract"
    href: "/posts/2026-07-20-kubernetes-custom-metrics-autoscaling-contract-trend/"
    description: "CPU 밖의 업무 신호로 HPA를 움직일 때 metric freshness와 downstream 보호를 설계하는 기준입니다."
  - title: "Kubernetes Rollout 전략"
    href: "/learning/deep-dive/deep-dive-kubernetes-rollouts/"
    description: "새 플랫폼 기능을 canary·관측·rollback으로 확장하는 기본 배포 절차입니다."
  - title: "Admission Control과 Concurrency Limit"
    href: "/learning/deep-dive/deep-dive-admission-control-concurrency-limits/"
    description: "과부하 때 요청을 무한 대기시키지 않고 우선순위·한도·거절 규칙을 운영하는 방법입니다."
  - title: "Post-Ingress-NGINX Migration"
    href: "/posts/2026-08-23-ingress-nginx-retirement-behavior-ledger-migration-trend/"
    description: "클러스터 경계 기능을 바꿀 때 YAML 변환보다 실제 행위 계약과 cutover 증거가 먼저라는 사례입니다."
---

Kubernetes v1.37이 2026년 8월 26일 공개됐습니다. 이번 릴리스에서 눈에 띄는 변화는 기능 수보다 운영 모델입니다. HPA의 scale-to-zero가 Beta로 기본 활성화됐고, API server의 watch cache 초기화는 복구 중 etcd와 API Priority and Fairness 용량을 무한 list/watch 요청으로 소진하지 않도록 더 단단해졌습니다. admission 정책도 API 객체만이 아니라 디스크의 static manifest에서 부트스트랩할 수 있습니다.

각 기능은 따로 보면 비용, API 성능, 보안 설정의 이야기입니다. 함께 보면 방향은 하나입니다. **평상시에는 낭비를 줄이고, 복구·과부하 시에는 무한 대기 대신 명시적인 경계와 재시도 계약을 둔다**는 것입니다. 이 글은 [Kubernetes Custom Metrics와 Autoscaling Contract](/posts/2026-07-20-kubernetes-custom-metrics-autoscaling-contract-trend/), [Kubernetes Rollout 전략](/learning/deep-dive/deep-dive-kubernetes-rollouts/), [Admission Control과 Concurrency Limit](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/), [Post-Ingress-NGINX Migration](/posts/2026-08-23-ingress-nginx-retirement-behavior-ledger-migration-trend/)의 다음 단계로 읽을 수 있습니다.

참고한 공식 신호:

- Kubernetes Blog, [Kubernetes v1.37: Garhwal](https://kubernetes.io/blog/2026/08/26/kubernetes-v1-37-release/)
- Kubernetes Docs, [Horizontal Pod Autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/)
- Kubernetes Docs, [API Priority and Fairness](https://kubernetes.io/docs/concepts/cluster-administration/flow-control/)

## 이 글에서 얻는 것

- HPA scale-to-zero가 가능한 workload와, 계속 최소 replica를 둬야 하는 workload를 구분합니다.
- 0에서 1로 깨우는 신호, cold start, queue backlog를 하나의 운영 기준으로 묶습니다.
- Kubernetes API 429를 오류로만 보지 않고 controller의 정상적인 과도 상태 처리로 설계하는 법을 이해합니다.
- manifest 기반 admission을 왜 부트스트랩 보안의 도구로 보며, 어떤 변경 통제가 필요한지 정리합니다.

## 핵심 개념/이슈

### 1) Scale-to-zero는 “replica를 0으로”보다 “누가 다시 깨우는가”가 핵심이다

v1.37의 HPA scale-to-zero는 object 또는 external metric을 쓰는 workload에서 `minReplicas: 0`을 허용합니다. queue consumer, 이벤트 처리 worker, 야간 batch, 비동기 GPU inference처럼 “할 일이 없으면 실행 중인 Pod도 필요 없는” 종류가 적합합니다. CPU와 메모리 metric만으로는 Pod가 0개일 때 관측할 대상이 없으므로, 0에서 다시 올릴 수 없습니다.

따라서 설정의 출발점은 `minReplicas: 0`이 아니라 **독립적으로 존재하는 wake-up signal**입니다. 예를 들어 메시지 큐의 pending count, 오래된 메시지 나이, scheduled job 수처럼 Pod가 없어도 수집되는 신호가 필요합니다. HPA는 scale-to-zero 상태를 `ScaledToZero=True` condition으로 남겨, 운영자가 수동으로 replica를 0으로 만든 상태와 구별할 수 있게 합니다.

| workload | 0까지 축소 검토 | 기본 보류 또는 별도 설계 |
| --- | --- | --- |
| queue consumer | external queue depth·oldest age가 있음 | wake-up metric이 없는 polling worker |
| batch/GPU job | 시작 지연이 SLO 안이고 checkpoint 가능 | 첫 요청 p95가 엄격한 동기 API |
| 개발·staging 서비스 | 비용이 중요하고 cold start를 감수 가능 | 인증·결제·관리자 핵심 경로 |
| webhook 처리 | durable queue 앞단이 존재 | Pod가 없으면 provider timeout이 나는 직접 receiver |

scale-to-zero의 경제성은 평균 replica 수가 아니라 **유휴 시간 × Pod 비용 − cold-start로 생기는 손실**로 계산합니다. 10분마다 한 번, 30초짜리 작업이 있는 worker라면 후보가 될 수 있습니다. 반대로 30초 안에 사용자가 응답을 받아야 하고 이미지 pull·JVM warm-up만 45초인 API는 replica 0이 절감보다 이탈을 키웁니다.

### 2) queue depth 하나로는 0→1 품질을 설명하지 못한다

큐에 100개가 쌓였다고 해도 초당 1,000개를 처리하는 worker와 초당 2개를 처리하는 worker의 의미는 다릅니다. scale-to-zero에서는 특히 첫 Pod가 뜨는 시간까지 포함해야 합니다. `queue_depth`와 `oldest_message_age_seconds`, `cold_start_seconds`, `dependency_error_rate`를 함께 보세요.

시작 기준 예시는 다음과 같습니다.

| 항목 | 시작 기준 | 이유 |
| --- | --- | --- |
| scale up | oldest message age 30초 초과 또는 queue depth 100 초과 | 적은 backlog에서도 사용자 지연을 포착 |
| min/max | 0 / 안전한 downstream 한도 | DB·외부 API가 버틸 수 있는 병렬성에 묶음 |
| cold-start p95 | 업무 SLO의 25% 이하 | 깨우는 시간만으로 SLO를 쓰지 않게 함 |
| scale down stabilization | 5~10분 | 짧은 idle gap에서 0↔1 진동 방지 |
| 0 상태 검증 | 24시간 canary | `ScaledToZero`, wake-up, 누락 작업을 같이 관찰 |

queue depth가 늘었다고 Pod만 많이 만들면 DB connection pool, 외부 API quota, lock 경합이 먼저 무너질 수 있습니다. [Custom Metrics 글](/posts/2026-07-20-kubernetes-custom-metrics-autoscaling-contract-trend/)에서 다룬 것처럼, replica 상한은 “원하는 처리량”이 아니라 **가장 약한 downstream이 허용하는 동시성**으로 정해야 합니다. scale-to-zero는 overprovisioning을 줄이는 장치이지, backlog를 무한 처리하는 장치가 아닙니다.

### 3) API server의 429는 복구 중 정상적인 backpressure 계약이다

v1.37은 watch cache 초기화와 재초기화 동안 expensive list/watch 요청이 etcd나 API Priority and Fairness 용량을 다 써 버리지 않도록 개선합니다. 제한된 요청은 처리하되 나머지는 HTTP 429와 `Retry-After`로 돌려보내고, 클라이언트는 이를 존중해야 합니다. “API 요청이 실패하지 않게” 기다리는 방식보다, 과부하 범위를 명확히 하여 control plane 전체가 멈추는 것을 막는 방향입니다.

이 변화는 operator, custom controller, CI/CD, inventory crawler에도 영향을 줍니다. 429를 즉시 재시도하면 watch cache 보호 장치를 다시 공격하게 됩니다. 재시도 구현은 최소한 아래 특성을 가져야 합니다.

```text
429 + Retry-After 존재  -> 서버가 준 대기 시간을 우선 적용
429 + Retry-After 없음  -> exponential backoff + full jitter
연속 429 / deadline 초과 -> 작업을 실패 또는 재큐잉하고 무한 loop 금지
쓰기 요청               -> idempotency·resourceVersion·재조회 규칙과 함께 재시도
```

중요한 controller라면 429 rate, retry queue length, workqueue oldest age, reconcile success latency를 한 대시보드에 올리세요. 첫 429가 곧 incident는 아닙니다. 하지만 API server 복구 중 429가 늘고 controller workqueue age까지 상승한다면, 실제 데이터 플레인에 필요한 Service, Endpoint, 정책 업데이트가 늦어질 수 있습니다. 이때 [Admission Control과 Concurrency Limit](/learning/deep-dive/deep-dive-admission-control-concurrency-limits/)에서 말한 “거절을 실패가 아닌 용량 신호로 다루는” 원칙이 control plane에도 적용됩니다.

### 4) admission static manifest는 더 이른 보안 경계이자 더 엄격한 배포 대상이다

v1.37의 manifest 기반 admission control configuration은 admission webhook과 CEL 정책을 API 객체에만 두지 않고, API server 디스크의 `staticManifestsDir`에서 읽을 수 있게 합니다. etcd가 불안정해도 API server 시작부터 정책을 적용하고, API로 관리되는 admission resource 자체가 변조되는 위험도 줄일 수 있습니다.

이는 “정책을 파일로 바꾸면 더 안전하다”는 단순한 결론이 아닙니다. 파일에 든 정책은 누가 어떤 이미지·노드·구성 관리 경로로 배포하는지에 따라 더 강하거나 더 약해질 수 있습니다. 특히 잘못된 deny 정책은 API server가 올라왔어도 cluster 변경을 막을 수 있습니다. [Ingress migration](/posts/2026-08-23-ingress-nginx-retirement-behavior-ledger-migration-trend/)처럼 리소스 문법보다 실제 행위와 rollback을 먼저 검증해야 합니다.

## 실무 적용

### 1) workload를 세 부류로 나눠 canary한다

처음부터 모든 HPA에 `minReplicas: 0`을 넣지 마세요. 다음 순서가 현실적입니다.

1. **유휴 worker canary**: 낮은 위험 queue consumer 하나를 골라 1개 namespace, 24시간 적용합니다. 0 상태, 첫 wake-up, 메시지 누락, oldest age를 확인합니다.
2. **비용 영향 검증**: idle 시간·replica-hours·cold-start p95·backlog SLO를 이전 7일 기준선과 비교합니다. 비용만 줄고 oldest age가 나빠지면 확대하지 않습니다.
3. **중요 workload 분리**: sync API, webhook ingress, 결제·인증 path는 1개 이상의 warm replica 또는 별도 wake-up architecture를 유지합니다.

`ScaledToZero` condition이 True인 것만으로 성공을 선언하면 안 됩니다. 0 상태에서 첫 작업이 들어온 뒤 언제 1이 됐는지, 어느 시점부터 실제 처리량이 생겼는지, 그 사이 provider retry나 사용자가 기다린 시간이 얼마인지까지 확인해야 합니다.

### 2) Kubernetes API client의 retry budget을 점검한다

platform 팀은 controller별로 “429를 얼마나 감당하고 언제 포기할지”를 정해야 합니다. 작업 deadline이 2분인데 client가 최대 10분 재시도하면 나중에 성공해도 제품 요구는 실패입니다. 반대로 수 시간 뒤 재조정해도 되는 inventory sync라면 재큐잉이 낫습니다.

| client 유형 | 권장 deadline | 429 처리 | 실패 후 행동 |
| --- | --- | --- |
| deployment controller | Kubernetes 기본 workqueue 규칙 | Retry-After·jitter | reconcile 재큐잉 |
| CI deploy | release window 안 | bounded retry | 명확한 429 evidence와 재시도 안내 |
| inventory crawler | 수십 분 단위 | 낮은 QPS, page 단위 resume | 다음 scan으로 이월 |
| break-glass 운영 도구 | 사람 대기 시간 안 | 요청 수 최소화 | priority·권한 검토 후 수동 retry |

이 표를 작성하면 “재시도는 항상 좋은 것”이라는 가정을 걷어낼 수 있습니다. backoff는 이미 늦어진 요청의 성공률을 올릴 수 있지만, 모든 client가 동시에 깨면 thundering herd가 됩니다. retry에는 jitter, 동시성 상한, deadline, idempotency가 같이 있어야 합니다.

### 3) static admission은 control-plane change로 다룬다

manifest 정책은 Git revision, owner, review, canary cluster, rollback commit을 연결합니다. 적용 전에는 허용·거절 request fixture를 준비하고, 특히 cluster bootstrap, CNI, storage driver, system namespace가 의도치 않게 막히지 않는지 확인합니다. 적용 후에는 deny count, API server admission latency, webhook/CEL error, policy file hash를 관측합니다.

권장 순서는 **audit/evaluate → staging enforce → 저위험 production namespace → 전체 enforce**입니다. 예외가 필요하면 policy를 통째로 끄는 대신 namespace·service account·만료일이 있는 좁은 예외를 둡니다. rollback은 파일만 되돌리는 것이 아니라, API server가 새 manifest를 언제 읽는지와 변경 중 control plane 가용성이 유지되는지를 포함해야 합니다.

## 트레이드오프/주의점

첫째, scale-to-zero는 비용을 줄이지만 cold start와 cache warm-up을 사용자가 지불하게 할 수 있습니다. Pod start 시간에는 image pull, scheduling, init container, JVM·model warm-up, dependency connection이 모두 들어갑니다. 목표 SLO에서 이 시간을 뺀 처리 예산이 남는지 먼저 계산하세요.

둘째, external metric이 정확하지 않으면 HPA는 정확하게 잘못 움직입니다. metric freshness가 60초를 넘거나 queue exporter가 실패한 상태에서 scale-down을 허용하면 backlog가 눈에 띄지 않게 밀릴 수 있습니다. metric 실패 시에는 축소 보류와 알림을 기본으로 두는 편이 안전합니다.

셋째, 429를 모두 성공으로 재시도하면 control plane이 다시 포화됩니다. Retry-After 준수, jitter, per-client concurrency limit이 없는 retry는 보호 장치의 효과를 없앱니다.

넷째, manifest 기반 admission은 etcd 의존을 줄여도 노드 파일·구성 관리 경로의 신뢰 요구를 높입니다. 정책 파일이 바뀐 사실, 적용 hash, rollback 권한을 감사하지 않으면 더 이른 보안 경계가 더 이른 단일 장애점이 될 수 있습니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] scale-to-zero 후보가 CPU가 아닌 object/external wake-up metric을 갖고 있다.
- [ ] `oldest_message_age`, cold-start p95, 0→1 성공 시간, dependency saturation을 함께 본다.
- [ ] scale-down stabilization은 최소 5분부터 시작하고 24시간 canary 증거가 있다.
- [ ] critical synchronous path, webhook receiver, 인증·결제 workload는 별도 warm-capacity 판단을 했다.
- [ ] controller·operator·CI가 429와 Retry-After를 존중하고 jitter·deadline·재큐잉 규칙을 가진다.
- [ ] 429 rate와 controller workqueue age를 control-plane recovery 지표로 모니터링한다.
- [ ] static admission manifest에는 owner, version, canary, enforce 전 fixture, rollback path, file hash가 있다.

### 연습

1. 현재 queue worker 하나를 골라 “Pod가 0개여도 읽을 수 있는 wake-up metric”, cold-start p95, allowed oldest age를 숫자로 정리해 보세요.
2. Kubernetes API client가 429를 받았을 때 Retry-After가 있는 경우와 없는 경우의 backoff 의사코드를 작성해 보세요.
3. admission 정책 하나를 static manifest로 옮긴다고 가정하고, audit 단계 fixture 3개와 rollback 성공 기준 2개를 적어 보세요.
