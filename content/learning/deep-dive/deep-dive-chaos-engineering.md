---
title: "Chaos Engineering: 장애를 주입하여 시스템 회복력 검증"
date: 2025-12-13
draft: false
topic: "DevOps"
tags: ["Chaos Engineering", "Resilience", "Fault Injection", "Testing", "LitmusChaos", "AWS FIS"]
categories: ["Backend Deep Dive"]
description: "Chaos Engineering 원칙부터 Steady-State Hypothesis 설계, LitmusChaos·AWS FIS·Chaos Toolkit 실전 구현, GameDay 운영, 성숙도 모델까지 — 프로덕션 회복력 검증 완전 가이드"
module: "ops-observability"
study_order: 352
quizzes:
  - question: "Chaos Engineering의 핵심 목적은?"
    options:
      - "시스템을 고장내는 것"
      - "프로덕션 환경에서 장애가 발생하기 전에 시스템의 약점을 미리 발견하고 회복력을 검증하는 것"
      - "개발자를 테스트하는 것"
      - "비용을 줄이는 것"
    answer: 1
    explanation: "Chaos Engineering은 '의도적 장애 주입'을 통해 시스템이 실제 장애 상황에서 어떻게 동작하는지 검증하고, Circuit Breaker 등이 제대로 동작하는지 확인합니다."

  - question: "Chaos Engineering 실험에서 'Steady State Hypothesis'란?"
    options:
      - "시스템이 불안정한 상태"
      - "실험 전 정상 상태를 정의하고, 장애 주입 후에도 이 상태가 유지되어야 함을 가설로 세우는 것"
      - "장애를 발생시키는 설정"
      - "롤백 계획"
    answer: 1
    explanation: "'요청 응답 시간 < 1초'같은 정상 상태를 먼저 정의하고, 장애를 주입해도 이 조건이 충족되는지 검증합니다."

  - question: "Chaos Engineering을 프로덕션에 적용할 때 권장되는 접근법은?"
    options:
      - "처음부터 100% 트래픽에 적용"
      - "개발 → 스테이징 → 프로덕션 1% → 프로덕션 100%로 점진적 확대"
      - "프로덕션에서는 적용하지 않음"
      - "비업무 시간에만 적용"
    answer: 1
    explanation: "작게 시작하여 점진적으로 확대해야 합니다. 처음에는 개발/스테이징에서 충분히 테스트하고, 프로덕션은 소수 트래픽부터 시작합니다."

  - question: "Chaos Monkey가 Netflix에서 하는 역할은?"
    options:
      - "코드 리뷰"
      - "무작위로 프로덕션 인스턴스를 종료하여 시스템의 장애 복구 능력을 상시 검증"
      - "부하 테스트"
      - "보안 점검"
    answer: 1
    explanation: "랜덤하게 인스턴스를 죽여서 '언제든 인스턴스가 죽을 수 있다'는 가정 하에 설계하도록 강제하고, 자동 복구가 제대로 동작하는지 검증합니다."

  - question: "Chaos Engineering 실험 중 이상 징후가 발견되면 해야 할 행동은?"
    options:
      - "실험을 계속 진행한다."
      - "즉시 실험을 중단하고 롤백한 후 결과를 분석하여 개선점을 도출한다."
      - "다음 날 분석한다."
      - "무시한다."
    answer: 1
    explanation: "Chaos Engineering은 시스템을 파괴하는 것이 목적이 아닙니다. 이상 징후 발견 시 즉시 중단하고 학습하며, 다음 실험 전에 개선해야 합니다."
---

## 이 글에서 얻는 것

- **Chaos Engineering** 5대 원칙과 왜 필요한지 이해합니다
- **Steady-State Hypothesis**를 설계하고 실험 시나리오를 작성할 수 있습니다
- **LitmusChaos, AWS FIS, Chaos Toolkit** 실전 구현으로 장애를 주입합니다
- **GameDay** 프로세스를 기획하고 운영할 수 있습니다
- **Chaos 성숙도 모델**로 조직의 현재 수준을 진단하고 로드맵을 세울 수 있습니다

---

## 1. Chaos Engineering이란?

> "시스템이 예기치 않은 상황에서도 기대한 대로 동작하는가를 검증하기 위해, 의도적으로 장애를 주입하는 실험적 접근"

### 왜 필요한가?

| 전통 테스트 | Chaos Engineering |
|:---|:---|
| "이 기능이 동작하는가?" | "이 기능이 장애 상황에서도 동작하는가?" |
| 행복 경로(Happy Path) 중심 | 실패 경로(Failure Path) 중심 |
| 단위·통합 테스트로 커버 | **분산 시스템의 창발적 장애** 발견 |
| 배포 전 실행 | 프로덕션에서도 실행 |

Netflix가 2011년 Chaos Monkey를 만든 이유: **"언제든 인스턴스가 죽을 수 있다"는 가정 하에 설계하라**.

### 5대 원칙 (Principles of Chaos Engineering)

```
1. 정상 상태(Steady State) 정의
   → "정상"을 비즈니스 메트릭으로 수치화

2. 가설 수립
   → "장애 X를 주입해도 정상 상태가 유지될 것이다"

3. 실제 이벤트 재현
   → 서버 다운, 네트워크 지연, 디스크 풀, DNS 실패 등

4. 폭발 반경(Blast Radius) 최소화
   → 작게 시작, 점진적 확대, 즉시 중단 가능

5. 자동화와 지속 실행
   → CI/CD 통합, 정기 실행으로 회귀 방지
```

---

## 2. 실험 설계: Steady-State Hypothesis

모든 Chaos 실험의 핵심은 **"정상 상태를 먼저 정의하는 것"**입니다.

### Steady-State 정의 프레임워크

| 계층 | 메트릭 | 정상 기준 (예시) | 측정 방법 |
|:---|:---|:---|:---|
| **비즈니스** | 주문 성공률 | ≥ 99.9% | 주문 API 응답 2xx 비율 |
| **서비스** | 응답 시간 p99 | < 500ms | Prometheus histogram |
| **인프라** | 에러율 | < 0.1% | ALB 5xx / total |
| **의존성** | Circuit Breaker Open 횟수 | 0 | Resilience4j 메트릭 |

### 실험 시나리오 설계 템플릿

```markdown
## 실험: [실험 이름]

### 배경
- 대상 서비스: [서비스 A]
- 의존성: [DB, Cache, 외부 API]
- 최근 관련 장애: [있으면 기재]

### Steady-State Hypothesis
- 주문 API 응답 시간 p99 < 500ms
- 에러율 < 0.1%
- Circuit Breaker 미작동 (Closed 상태)

### 실험 방법
- **장애 유형**: [서비스 B Pod 50% Kill]
- **범위**: [Namespace: staging, 트래픽의 10%]
- **지속 시간**: [5분]

### 중단 조건 (Abort Criteria)
- 에러율 > 5%
- p99 > 3초
- 비즈니스 메트릭 이상

### 롤백 절차
1. 실험 즉시 중단 (kill experiment)
2. [kubectl rollout restart deployment/service-b]
3. 메트릭 정상 복구 확인

### 예상 결과
- Circuit Breaker가 Open되어 fallback 응답 반환
- 전체 에러율 0.1% 미만 유지

### 실제 결과
- [ ] 가설 유지 / 가설 깨짐
- 발견 사항: [기재]
- 개선 사항: [기재]
```

---

## 3. 장애 유형 카탈로그

### 인프라 레벨

| 장애 유형 | 설명 | 도구 |
|:---|:---|:---|
| **Pod Kill** | 특정 Pod 강제 종료 | LitmusChaos, Chaos Mesh |
| **Node Drain** | 노드 전체 Pod 퇴거 | kubectl, AWS FIS |
| **CPU Stress** | CPU 사용률 강제 증가 | stress-ng, LitmusChaos |
| **Memory Stress** | 메모리 압박 | stress-ng |
| **Disk Fill** | 디스크 용량 소진 | dd, fallocate |
| **AZ 장애** | 가용 영역 전체 격리 | AWS FIS |

### 네트워크 레벨

| 장애 유형 | 설명 | 도구 |
|:---|:---|:---|
| **Network Latency** | 지연 주입 (100ms~5s) | tc netem, Toxiproxy |
| **Packet Loss** | 패킷 손실 (1%~50%) | tc netem |
| **DNS Failure** | DNS 조회 실패 | LitmusChaos, CoreDNS 조작 |
| **Network Partition** | 서비스 간 통신 차단 | iptables, Chaos Mesh |

### 애플리케이션 레벨

| 장애 유형 | 설명 | 도구 |
|:---|:---|:---|
| **Exception Injection** | 특정 API에 500 에러 주입 | Toxiproxy, 코드 내 chaos flag |
| **Slow Response** | 응답 지연 주입 | Toxiproxy |
| **Connection Pool Exhaustion** | DB 커넥션 고갈 | pgbench, 커스텀 스크립트 |
| **Cache Failure** | Redis 다운 | Pod Kill, Failover 테스트 |

---

## 4. 실전 구현: LitmusChaos (Kubernetes)

### 설치

```bash
# LitmusChaos 3.x 설치 (Helm)
helm repo add litmuschaos https://litmuschaos.github.io/litmus-helm/
helm install litmus litmuschaos/litmus \
  --namespace litmus --create-namespace \
  --set portal.frontend.service.type=ClusterIP
```

### Pod Kill 실험

```yaml
# pod-kill-experiment.yaml
apiVersion: litmuschaos.io/v1alpha1
kind: ChaosEngine
metadata:
  name: order-service-chaos
  namespace: staging
spec:
  appinfo:
    appns: staging
    applabel: "app=order-service"
    appkind: deployment
  engineState: active
  chaosServiceAccount: litmus-admin
  experiments:
    - name: pod-delete
      spec:
        components:
          env:
            - name: TOTAL_CHAOS_DURATION
              value: "300"        # 5분간 실험
            - name: CHAOS_INTERVAL
              value: "30"         # 30초마다 Pod Kill
            - name: FORCE
              value: "false"      # Graceful shutdown
            - name: PODS_AFFECTED_PERC
              value: "50"         # 50% Pod만 대상
        probe:
          - name: "order-api-health"
            type: httpProbe
            mode: Continuous
            httpProbe/inputs:
              url: "http://order-service.staging:8080/actuator/health"
              method:
                get:
                  criteria: ==
                  responseCode: "200"
            runProperties:
              probeTimeout: 5s
              interval: 10s
              retry: 3
              probePollingInterval: 2s
```

```bash
# 실험 실행
kubectl apply -f pod-kill-experiment.yaml

# 실험 상태 확인
kubectl get chaosengine order-service-chaos -n staging -o yaml

# 실험 결과 확인
kubectl get chaosresult order-service-chaos-pod-delete -n staging -o yaml
```

### Network Latency 실험

```yaml
apiVersion: litmuschaos.io/v1alpha1
kind: ChaosEngine
metadata:
  name: network-latency-chaos
  namespace: staging
spec:
  appinfo:
    appns: staging
    applabel: "app=payment-service"
    appkind: deployment
  engineState: active
  chaosServiceAccount: litmus-admin
  experiments:
    - name: pod-network-latency
      spec:
        components:
          env:
            - name: NETWORK_INTERFACE
              value: "eth0"
            - name: NETWORK_LATENCY
              value: "500"       # 500ms 지연
            - name: JITTER
              value: "100"       # ±100ms 변동
            - name: TOTAL_CHAOS_DURATION
              value: "300"
            - name: DESTINATION_IPS
              value: "10.0.10.0/24"  # DB 서브넷만 대상
        probe:
          - name: "payment-p99-check"
            type: promProbe
            mode: Continuous
            promProbe/inputs:
              endpoint: "http://prometheus.monitoring:9090"
              query: >
                histogram_quantile(0.99,
                  rate(http_server_requests_seconds_bucket{
                    service="payment-service"
                  }[1m]))
              comparator:
                type: float
                criteria: "<="
                value: "2.0"     # p99 < 2초 이내 유지되어야 함
            runProperties:
              probeTimeout: 10s
              interval: 15s
```

---

## 5. 실전 구현: AWS Fault Injection Service (FIS)

AWS 매니지드 서비스를 대상으로 하는 Chaos 실험에 최적화된 도구입니다.

### AZ 장애 시뮬레이션

```json
{
  "description": "AZ-a 장애 시뮬레이션",
  "targets": {
    "ec2-instances": {
      "resourceType": "aws:ec2:instance",
      "resourceTags": {
        "Application": "myapp"
      },
      "filters": [
        {
          "path": "Placement.AvailabilityZone",
          "values": ["ap-northeast-2a"]
        }
      ],
      "selectionMode": "ALL"
    }
  },
  "actions": {
    "stop-instances": {
      "actionId": "aws:ec2:stop-instances",
      "parameters": {
        "startInstancesAfterDuration": "PT10M"
      },
      "targets": {
        "Instances": "ec2-instances"
      }
    }
  },
  "stopConditions": [
    {
      "source": "aws:cloudwatch:alarm",
      "value": "arn:aws:cloudwatch:ap-northeast-2:123456789012:alarm:chaos-abort-alarm"
    }
  ],
  "roleArn": "arn:aws:iam::123456789012:role/FISExperimentRole"
}
```

### RDS Failover 테스트

```json
{
  "description": "RDS Multi-AZ Failover 테스트",
  "actions": {
    "rds-failover": {
      "actionId": "aws:rds:reboot-db-instances",
      "parameters": {
        "forceFailover": "true"
      },
      "targets": {
        "DBInstances": "rds-target"
      }
    }
  },
  "targets": {
    "rds-target": {
      "resourceType": "aws:rds:db",
      "resourceArns": [
        "arn:aws:rds:ap-northeast-2:123456789012:db:myapp-db"
      ],
      "selectionMode": "ALL"
    }
  },
  "stopConditions": [
    {
      "source": "aws:cloudwatch:alarm",
      "value": "arn:aws:cloudwatch:ap-northeast-2:123456789012:alarm:db-connection-alarm"
    }
  ]
}
```

### Terraform으로 FIS 관리

```hcl
resource "aws_fis_experiment_template" "az_failure" {
  description = "AZ-a failure simulation"
  role_arn    = aws_iam_role.fis.arn

  stop_condition {
    source = "aws:cloudwatch:alarm"
    value  = aws_cloudwatch_metric_alarm.chaos_abort.arn
  }

  action {
    name      = "stop-instances"
    action_id = "aws:ec2:stop-instances"

    parameter {
      key   = "startInstancesAfterDuration"
      value = "PT10M"
    }

    target {
      key   = "Instances"
      value = "ec2-targets"
    }
  }

  target {
    name           = "ec2-targets"
    resource_type  = "aws:ec2:instance"
    selection_mode = "ALL"

    resource_tag {
      key   = "Application"
      value = "myapp"
    }

    filter {
      path   = "Placement.AvailabilityZone"
      values = ["ap-northeast-2a"]
    }
  }

  tags = { Name = "az-failure-test" }
}
```

---

## 6. 실전 구현: Chaos Toolkit (범용)

어떤 인프라에서든 사용할 수 있는 Python 기반 오픈소스 프레임워크입니다.

### 설치 및 기본 실험

```bash
pip install chaostoolkit chaostoolkit-kubernetes chaostoolkit-prometheus
```

```yaml
# experiment-service-down.yaml
version: 1.0.0
title: "주문 서비스 장애 시 결제 서비스 회복력 검증"
description: >
  주문 서비스 Pod를 50% 종료했을 때,
  결제 서비스의 Circuit Breaker가 정상 동작하고
  전체 에러율이 1% 미만으로 유지되는지 검증

tags:
  - kubernetes
  - circuit-breaker
  - order-service

contributions:
  reliability: high
  security: none

# 1단계: 정상 상태 정의
steady-state-hypothesis:
  title: "결제 서비스 정상 동작 확인"
  probes:
    - name: "결제 API 응답 코드 200"
      type: probe
      provider:
        type: http
        url: "http://payment-service.staging:8080/actuator/health"
        timeout: 5
      tolerance:
        status: 200

    - name: "에러율 1% 미만"
      type: probe
      provider:
        type: python
        module: chaosprometheus.probes
        func: query_instant
        arguments:
          query: >
            sum(rate(http_server_requests_seconds_count{
              service="payment-service", status=~"5.."}[5m]))
            /
            sum(rate(http_server_requests_seconds_count{
              service="payment-service"}[5m]))
          api_url: "http://prometheus.monitoring:9090"
      tolerance:
        type: range
        range: [0.0, 0.01]

# 2단계: 장애 주입
method:
  - type: action
    name: "주문 서비스 Pod 50% 종료"
    provider:
      type: python
      module: chaosk8s.pod.actions
      func: terminate_pods
      arguments:
        label_selector: "app=order-service"
        ns: staging
        qty: 2
        rand: true
        grace_period: 30
    pauses:
      after: 30   # 30초 대기 후 Steady-State 재검증

  - type: probe
    name: "Circuit Breaker 상태 확인"
    provider:
      type: python
      module: chaosprometheus.probes
      func: query_instant
      arguments:
        query: >
          resilience4j_circuitbreaker_state{
            name="orderServiceCB", application="payment-service"} == 1
        api_url: "http://prometheus.monitoring:9090"
    tolerance: true   # Circuit Breaker가 Open(1)이면 정상

# 3단계: 롤백
rollbacks:
  - type: action
    name: "주문 서비스 복원"
    provider:
      type: python
      module: chaosk8s.deployment.actions
      func: rollout_restart
      arguments:
        name: order-service
        ns: staging
```

```bash
# 실험 실행
chaos run experiment-service-down.yaml

# 실험 보고서 생성
chaos report --export-format=pdf journal.json report.pdf
```

---

## 7. GameDay 운영 가이드

GameDay는 Chaos Engineering을 **조직 차원의 훈련**으로 확장한 것입니다.

### GameDay 프로세스

```
1주 전: 계획
├── 대상 서비스·실험 시나리오 선정
├── 참가자 역할 지정 (Driver / Observer / Scribe)
├── 중단 기준(Abort Criteria) 합의
└── Runbook·롤백 절차 준비

당일: 실행
├── 09:00 킥오프 (목적·범위·안전장치 공유)
├── 09:30 Steady-State 베이스라인 측정
├── 10:00 실험 1: Pod Kill
├── 10:30 실험 2: Network Latency
├── 11:00 실험 3: DB Failover
├── 11:30 실험 4: AZ 장애
└── 12:00 정리·복원 확인

당일: 회고
├── 발견된 약점 목록화
├── 개선 액션 아이템·담당자·기한 확정
├── 다음 GameDay 주제 선정
└── 전사 공유 (결과 요약)
```

### GameDay 체크리스트

| 단계 | 항목 | 확인 |
|:---|:---|:---|
| **사전** | 실험 시나리오 문서화 완료 | ☐ |
| **사전** | Rollback 절차 검증 완료 | ☐ |
| **사전** | 모니터링 대시보드 준비 | ☐ |
| **사전** | Abort 알람 설정 완료 | ☐ |
| **사전** | 이해관계자(PM·CTO) 통보 | ☐ |
| **실행** | Steady-State 베이스라인 기록 | ☐ |
| **실행** | 각 실험 시작/종료 시간 기록 | ☐ |
| **실행** | 이상 징후 즉시 Scribe 기록 | ☐ |
| **사후** | 발견 사항 JIRA 티켓 생성 | ☐ |
| **사후** | 회고 문서 작성 및 공유 | ☐ |

### 역할 정의

| 역할 | 책임 | 인원 |
|:---|:---|:---|
| **Driver** | 실험 실행, 장애 주입/해제 | 1명 |
| **Observer** | 대시보드·메트릭 실시간 감시 | 2~3명 |
| **Scribe** | 타임라인·발견 사항 실시간 기록 | 1명 |
| **Incident Commander** | 중단 판단, 에스컬레이션 | 1명 (시니어) |
| **On-call Standby** | 실제 장애 전파 시 긴급 대응 | 1~2명 |

---

## 8. 관측성(Observability) 연계

Chaos 실험은 **관측 없이 실행하면 의미가 없습니다.** 실험 중 반드시 모니터링해야 할 항목:

### 실험 중 관측 대시보드

```
┌─────────────────────────────────────────────────┐
│  Chaos Experiment: order-service-pod-kill         │
│  Status: RUNNING  |  Duration: 03:24             │
├─────────────────────────────────────────────────┤
│  📊 Golden Signals                               │
│  ├── Error Rate: 0.02% (Threshold: < 1%)  ✅    │
│  ├── Latency p99: 420ms (Threshold: < 500ms) ✅ │
│  ├── Traffic: 1,200 req/s (Normal: 1,100)  ✅   │
│  └── Saturation: CPU 45%, Mem 62%          ✅   │
├─────────────────────────────────────────────────┤
│  🔧 Resilience Signals                           │
│  ├── Circuit Breaker: CLOSED → OPEN (예상대로)   │
│  ├── Retry Count: 23 (Budget 100)          ✅   │
│  ├── Fallback Invoked: 18회               ✅    │
│  └── Pod Ready: 2/4 (50% Kill)            ✅    │
├─────────────────────────────────────────────────┤
│  ⚠️ Downstream Impact                            │
│  ├── Payment Service: Healthy              ✅    │
│  ├── Notification: Healthy                 ✅    │
│  └── Frontend: Degraded (order 버튼 비활성) ⚠️   │
└─────────────────────────────────────────────────┘
```

### Prometheus 쿼리 예시

```promql
# 실험 전후 에러율 비교
sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m]))
/
sum(rate(http_server_requests_seconds_count[5m]))

# Circuit Breaker 상태 변화
resilience4j_circuitbreaker_state{application="payment-service"}

# Pod Restart 횟수
increase(kube_pod_container_status_restarts_total{
  namespace="staging", pod=~"order-service.*"
}[1h])

# Fallback 호출 횟수
increase(resilience4j_circuitbreaker_calls_total{
  kind="fallback"
}[5m])
```

### Grafana Annotation으로 실험 구간 표시

```bash
# 실험 시작 시 Annotation 생성
curl -X POST http://grafana:3000/api/annotations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GRAFANA_TOKEN" \
  -d '{
    "dashboardUID": "chaos-dashboard",
    "time": '$(date +%s000)',
    "tags": ["chaos", "pod-kill", "order-service"],
    "text": "Chaos Experiment Started: order-service pod-kill 50%"
  }'
```

---

## 9. Chaos 성숙도 모델

### 5단계 성숙도

| 레벨 | 이름 | 특징 | 도구 | 빈도 |
|:---|:---|:---|:---|:---|
| **L1** | Ad-hoc | `kubectl delete pod` 수동 실행 | 없음 | 비정기 |
| **L2** | Scripted | Chaos Toolkit 실험 파일 작성 | Chaos Toolkit | 월 1회 |
| **L3** | Automated | CI/CD에 Chaos 테스트 통합 | LitmusChaos + CI | 주 1회 |
| **L4** | Continuous | 프로덕션에서 상시 실행 | AWS FIS + 자동 Abort | 매일 |
| **L5** | Culture | 전 팀이 자체 실험 설계·실행 | 셀프서비스 플랫폼 | 상시 |

### 성숙도 진단 체크리스트

```
L1 → L2 전환 조건:
☐ Steady-State Hypothesis 문서화 습관
☐ 최소 3개 실험 시나리오 작성 완료
☐ 롤백 절차 테스트 완료

L2 → L3 전환 조건:
☐ 스테이징 환경에서 주기적 실행 (주 1회 이상)
☐ CI 파이프라인에 Chaos 단계 추가
☐ 실험 결과 자동 리포팅

L3 → L4 전환 조건:
☐ 프로덕션 Canary 실험 1건 이상 성공
☐ 자동 Abort 메커니즘 검증
☐ 온콜 팀과 협의·훈련 완료
☐ GameDay 분기 1회 이상 진행

L4 → L5 전환 조건:
☐ 팀별 자체 실험 설계·실행
☐ Chaos 실험 커버리지 메트릭 존재
☐ 경영진 보고 포함 (SLA/SLO 연계)
```

### 도입 로드맵 (권장 12개월)

```
Month 1-2:  L1 → L2
├── Chaos Toolkit 설치, 첫 실험 3건 작성
├── 스테이징 환경에서 Pod Kill / Network Latency 실행
└── 팀 내 Chaos 소개 세션

Month 3-4:  L2 → L3
├── LitmusChaos 도입 (K8s 환경)
├── CI 파이프라인에 nightly chaos job 추가
└── 실험 결과 Slack 자동 알림

Month 5-8:  L3 → L4
├── 프로덕션 Canary 실험 시작 (트래픽 1%)
├── AWS FIS로 AZ 장애·RDS Failover 테스트
├── 첫 GameDay 실시
└── 온콜 팀 훈련

Month 9-12: L4 → L5
├── 팀별 셀프서비스 실험 플랫폼
├── Chaos 커버리지 대시보드
└── 분기별 GameDay 정례화
```

---

## 10. 안티패턴과 주의사항

### 반드시 피해야 할 실수

| 안티패턴 | 문제 | 해결 |
|:---|:---|:---|
| **YOLO Chaos** | Abort 조건 없이 프로덕션 실험 | 반드시 중단 알람 설정 |
| **관측 없는 실험** | 장애 주입했는데 결과를 모름 | Probe/Metric 필수 연계 |
| **Big Bang** | 처음부터 프로덕션 100% 대상 | 스테이징 → 카나리 → 점진 확대 |
| **1회성 실험** | 한 번 하고 끝 | CI/CD 통합, 정기 실행 |
| **비밀 실험** | 팀에 알리지 않고 실행 | 이해관계자 사전 통보 필수 |
| **Fix-less Chaos** | 발견만 하고 개선 안 함 | 실험 → 티켓 → 수정 → 재실험 |

### Chaos Engineering ≠ 부하 테스트

| 항목 | Chaos Engineering | 부하 테스트 |
|:---|:---|:---|
| **목적** | 회복력 검증 | 성능 한계 측정 |
| **방법** | 장애 주입 | 트래픽 증가 |
| **측정** | 정상 상태 유지 여부 | TPS, 응답 시간, 에러율 |
| **환경** | 스테이징 + 프로덕션 | 주로 스테이징 |
| **빈도** | 상시 | 배포 전·정기 |

---

## 운영 체크리스트

### 실험 전

- [ ] Steady-State Hypothesis 작성 (비즈니스 메트릭 포함)
- [ ] 실험 시나리오 문서화 (배경/방법/중단 조건/롤백)
- [ ] 모니터링 대시보드 준비 (Golden Signals + Resilience)
- [ ] Abort 알람 설정 완료
- [ ] 이해관계자 통보

### 실험 중

- [ ] 베이스라인 메트릭 기록
- [ ] 실시간 대시보드 감시
- [ ] 이상 징후 즉시 기록
- [ ] Abort 기준 초과 시 즉시 중단

### 실험 후

- [ ] 실험 결과 정리 (가설 유지/깨짐)
- [ ] 발견 사항 JIRA 티켓 생성
- [ ] 개선 후 재실험 계획
- [ ] 회고 문서 공유

---

## 요약

1. **정상 상태를 먼저 정의**: 숫자로 측정 가능한 비즈니스 메트릭
2. **작게 시작, 점진적 확대**: 스테이징 → 프로덕션 카나리 → 전체
3. **도구 선택**: LitmusChaos(K8s), AWS FIS(AWS 매니지드), Chaos Toolkit(범용)
4. **관측이 핵심**: 장애 주입 + 메트릭 모니터링 = 학습
5. **문화로 만들기**: GameDay 정례화, 성숙도 모델 단계적 향상

## 관련 글

- [Resilience4j Circuit Breaker](/learning/deep-dive/deep-dive-resilience4j-circuit-breaker/)
- [Prometheus + Grafana](/learning/deep-dive/deep-dive-prometheus-grafana/)
- [Observability Baseline](/learning/deep-dive/deep-dive-observability-baseline/)
- [Observability Alarms](/learning/deep-dive/deep-dive-observability-alarms/)
- [부하 테스트 전략](/learning/deep-dive/deep-dive-load-testing-strategy/)
- [Kubernetes 기초](/learning/deep-dive/deep-dive-kubernetes-basics/)
- [Kubernetes Rollouts](/learning/deep-dive/deep-dive-kubernetes-rollouts/)
- [Timeout/Retry/Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/)
- [Graceful Shutdown](/learning/deep-dive/deep-dive-graceful-shutdown/)
- [SLO/SLI/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/)
