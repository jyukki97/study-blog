---
title: "클라우드 비용 최적화 전략"
date: 2025-12-16
draft: false
topic: "Ops"
tags: ["Cost Optimization", "Autoscaling", "FinOps", "Reserved Instance", "Spot", "Kubernetes"]
categories: ["DevOps"]
description: "FinOps 프레임워크, Compute/DB/Network/Storage 영역별 최적화, Kubernetes 비용 관리, Spot/RI 전략, 비용 모니터링 대시보드 설계까지 실무 중심 정리"
module: "ops-observability"
study_order: 385
---

## 이 글에서 얻는 것

- 클라우드 비용을 "아껴야지"가 아니라 **어디서 돈이 새는지(Compute/Storage/Network/Observability)** 구조로 파악할 수 있습니다.
- 비용 최적화의 우선순위를 "큰 항목부터" 잡고, 효과가 큰 액션(권장 루틴)을 실행할 수 있습니다.
- 자동 확장/예약 할인/캐시 같은 선택이 비용뿐 아니라 안정성/성능과 연결된다는 트레이드오프 감각이 생깁니다.
- FinOps 프레임워크의 Inform → Optimize → Operate 사이클을 실무에 적용할 수 있습니다.

---

## 0) 비용 최적화는 '지출 절감'이 아니라 '가치 대비 비용'이다

진짜 목표는 보통 이겁니다.

- 같은 트래픽을 더 적은 비용으로 처리하거나,
- 같은 비용으로 더 높은 SLO/더 많은 기능을 제공하는 것.

그래서 비용 최적화도 관측성이 필요합니다.
"어떤 요청/기능이 비용을 만든다"를 모르고 줄이면, 중요한 걸 잘라버릴 수 있습니다.

### FinOps의 3단계 사이클

```
┌─────────────┐
│   Inform    │ ← 비용 가시성: 누가, 어디서, 왜 쓰는지 파악
│  (알아보기)  │
└──────┬──────┘
       │
┌──────▼──────┐
│  Optimize   │ ← 실행: Rightsizing, RI/SP 구매, 아키텍처 변경
│  (최적화)   │
└──────┬──────┘
       │
┌──────▼──────┐
│   Operate   │ ← 거버넌스: 예산 정책, 이상 탐지, 지속 개선
│  (운영하기)  │
└──────┴──────┘
       ↻ 매월 반복
```

**핵심**: 비용 최적화는 일회성 프로젝트가 아니라, **지속적인 운영 프로세스**입니다.

---

## 1) 비용의 큰 덩어리부터 본다

### 일반적인 클라우드 비용 구성비

| 영역 | 비용 비중 (일반적) | 최적화 난이도 | ROI |
|------|-------------------|-------------|-----|
| **Compute** (EC2/ECS/EKS/Lambda) | 40~60% | 중 | ★★★★★ |
| **Database** (RDS/DynamoDB/ElastiCache) | 15~25% | 중~고 | ★★★★ |
| **Network** (Egress/NAT/ALB) | 10~20% | 고 | ★★★ |
| **Storage** (S3/EBS/스냅샷/로그) | 5~15% | 저 | ★★★ |
| **Observability** (CloudWatch/Datadog) | 3~10% | 중 | ★★★ |

> 실제 비율은 서비스마다 다릅니다. **먼저 비용 보고서를 보고 상위 3개를 파악하는 것**이 첫 번째 액션입니다.

### AWS Cost Explorer 활용법

```bash
# AWS CLI로 최근 30일 서비스별 비용 확인
aws ce get-cost-and-usage \
  --time-period Start=2026-02-20,End=2026-03-20 \
  --granularity MONTHLY \
  --metrics "BlendedCost" \
  --group-by Type=DIMENSION,Key=SERVICE \
  --query 'ResultsByTime[0].Groups[*].[Keys[0],Metrics.BlendedCost.Amount]' \
  --output table
```

---

## 2) Compute: 리소스 과대할당을 먼저 제거한다

### Rightsizing: 가장 ROI가 높은 액션

"필요 이상으로 큰 인스턴스"는 가장 흔한 낭비입니다.

```bash
# AWS Compute Optimizer로 추천 인스턴스 확인
aws compute-optimizer get-ec2-instance-recommendations \
  --filters "name=Finding,values=OVER_PROVISIONED"
```

**Rightsizing 판단 기준:**

| 지표 | 현재 값 | 판단 |
|------|--------|------|
| CPU 평균 사용률 | < 20% (2주 평균) | 과대할당 → 한 단계 축소 |
| 메모리 사용률 | < 30% (2주 평균) | 과대할당 → 메모리 최적 인스턴스 |
| CPU 피크 사용률 | > 80% (주 3회 이상) | 적절 또는 부족 |
| 네트워크 I/O | 인스턴스 한도의 < 10% | 네트워크 최적화 인스턴스 불필요 |

**비용 절감 예시:**

```
m5.2xlarge (8 vCPU, 32GB)  → $0.384/h × 720h = $276.48/월
  CPU 평균 15%, 메모리 평균 20%

→ m5.xlarge (4 vCPU, 16GB)  → $0.192/h × 720h = $138.24/월
  절감: $138.24/월 (50%)
```

### Autoscaling: 패턴별 전략

```yaml
# Target Tracking (가장 추천 — 지표 기반 자동 조절)
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: order-service-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: order-service
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60    # CPU 60% 유지 목표
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300  # 5분 안정화 후 축소
      policies:
        - type: Pods
          value: 2                      # 한 번에 최대 2개만 줄임
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0    # 즉시 확장
      policies:
        - type: Percent
          value: 100                    # 한 번에 2배까지 확장 가능
          periodSeconds: 60
```

**주의**: 스케일다운이 너무 공격적이면 "확장→축소→확장" 진동(thrashing)이 발생합니다. `stabilizationWindowSeconds`를 충분히 두세요.

### Spot/Preemptible 인스턴스 활용

| 워크로드 | Spot 적합 여부 | 이유 |
|---------|---------------|------|
| 배치 처리 / ETL | ✅ 매우 적합 | 중단돼도 재실행 가능 |
| CI/CD 빌드 러너 | ✅ 적합 | 빌드 재실행 가능 |
| 비동기 큐 컨슈머 | ✅ 적합 | 메시지는 큐에 남음 |
| Stateless API 서버 | ⚠️ 조건부 | On-Demand와 혼합 필요 |
| 데이터베이스 | ❌ 부적합 | 데이터 손실 위험 |
| 단일 서버 (Single Point) | ❌ 부적합 | 중단 = 전체 장애 |

**Spot 비용 절감 예시:**

```
On-Demand m5.xlarge:  $0.192/h
Spot m5.xlarge:       $0.058/h (약 70% 절감)

CI/CD 러너 10대 × 8시간/일 × 22일
  On-Demand: $0.192 × 80h × 22 = $337.92/월
  Spot:      $0.058 × 80h × 22 = $102.08/월
  절감:      $235.84/월
```

### 스케줄 기반 비용 절감

```bash
# 개발/스테이징 환경 — 업무 시간에만 운영
# AWS Instance Scheduler 또는 K8s CronJob

# 평일 09:00 시작
0 9 * * 1-5 aws ec2 start-instances --instance-ids i-xxx

# 평일 20:00 중지
0 20 * * 1-5 aws ec2 stop-instances --instance-ids i-xxx

# 월 절감: 24h → 11h = 54% 절감 (주말 포함하면 더)
```

---

## 3) DB: 성능 최적화가 곧 비용 최적화다

DB는 "늘리면 비싸고, 줄이기 어렵고, 장애에 민감"합니다.

### DB 비용 최적화 우선순위

```
1순위: 슬로우 쿼리 제거 (무료 — 스펙 업 없이 성능 2~10배)
2순위: 읽기 캐시 (Redis/ElastiCache — DB 부하 50~80% 감소)
3순위: Read Replica (쓰기 노드 부담 분산)
4순위: RI/Savings Plan 적용 (1~3년 약정으로 40~60% 절감)
5순위: 인스턴스 Rightsizing (실사용 대비 과대할당 제거)
```

### 슬로우 쿼리 → 비용 절감 계산

```sql
-- 슬로우 쿼리 예시: 풀 테이블 스캔
SELECT * FROM orders WHERE status = 'PENDING' AND created_at > '2026-01-01';
-- 실행 시간: 2.3초, 하루 10만 회 실행

-- 인덱스 추가 후
CREATE INDEX idx_orders_status_created ON orders(status, created_at);
-- 실행 시간: 0.005초 (460배 개선)
```

CPU 사용률이 70% → 15%로 하락하면, `db.r6g.2xlarge → db.r6g.large`로 Rightsizing 가능:
```
db.r6g.2xlarge: $0.958/h × 720h = $689.76/월
db.r6g.large:   $0.240/h × 720h = $172.80/월
절감: $516.96/월
```

### 캐시 도입 비용 효과

```
Redis r6g.large (13GB):  $0.166/h × 720h = $119.52/월
DB 읽기 60% 절감 → DB 인스턴스 한 단계 축소: -$200/월

순 절감: $80.48/월 + DB 안정성 향상
```

---

## 4) Network: 숨은 비용(egress/NAT/cross-AZ)이 크다

### 네트워크 비용 구조 (AWS 기준)

| 트래픽 방향 | 비용 |
|------------|------|
| 인터넷 → AWS (ingress) | 무료 |
| AWS → 인터넷 (egress) | $0.09/GB (첫 10TB) |
| 같은 AZ 내 | 무료 |
| 다른 AZ (같은 리전) | $0.01/GB (양방향) |
| 다른 리전 | $0.02/GB |
| NAT Gateway 처리 | $0.045/GB + $0.045/h |

### Egress 비용 최적화

```
문제: API 응답 평균 50KB × 일 1억 회 = 5TB/월
비용: 5TB × $0.09 = $450/월

최적화 1: gzip 압축 (평균 80% 감소)
  → 1TB/월 × $0.09 = $90/월 (절감 $360)

최적화 2: CDN (CloudFront) 적용
  → CloudFront egress: $0.085/GB (작지만 캐시 히트로 Origin 트래픽 감소)
  → 캐시 히트율 70%이면 Origin 트래픽 1.5TB → 0.45TB
  → 추가 절감 $94.5/월
```

### NAT Gateway 비용 절감

```bash
# S3/DynamoDB 접근이 NAT를 타는지 확인
# VPC Flow Logs에서 NAT Gateway를 거치는 목적지 분석

# 해결: S3 Gateway Endpoint (무료!)
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-xxx \
  --service-name com.amazonaws.ap-northeast-2.s3 \
  --route-table-ids rtb-xxx

# ECR/CloudWatch 등: Interface Endpoint ($0.01/h + $0.01/GB)
# NAT Gateway ($0.045/h + $0.045/GB)보다 저렴
```

**NAT 비용 절감 예시:**

```
현재: ECR pull 500GB/월 via NAT
  처리비용: 500GB × $0.045 = $22.50
  시간비용: $0.045/h × 720h = $32.40
  합계: $54.90/월

VPC Endpoint 전환 후:
  처리비용: 500GB × $0.01 = $5.00
  시간비용: $0.01/h × 720h = $7.20
  합계: $12.20/월
  절감: $42.70/월
```

### Cross-AZ 트래픽 줄이기

```yaml
# Kubernetes: 같은 AZ 우선 라우팅 (Topology Aware Routing)
apiVersion: v1
kind: Service
metadata:
  name: order-service
  annotations:
    service.kubernetes.io/topology-mode: Auto
spec:
  # ...
```

```
3개 AZ, 각 10개 Pod, 일 트래픽 10TB
  Cross-AZ 비율 66% → 6.6TB × $0.01 = $66/월
  Topology Routing 적용 후 Cross-AZ 20% → $20/월
  절감: $46/월
```

---

## 5) Storage/로그: '보존 기간'이 비용을 만든다

### S3 수명 주기 정책 설계

```json
{
  "Rules": [
    {
      "ID": "LogLifecycle",
      "Filter": { "Prefix": "logs/" },
      "Status": "Enabled",
      "Transitions": [
        { "Days": 30,  "StorageClass": "STANDARD_IA" },
        { "Days": 90,  "StorageClass": "GLACIER_IR" },
        { "Days": 365, "StorageClass": "DEEP_ARCHIVE" }
      ],
      "Expiration": { "Days": 730 }
    }
  ]
}
```

**스토리지 클래스별 비용 비교 (1TB/월, ap-northeast-2):**

| 클래스 | 저장 비용 | 검색 비용 | 적합한 데이터 |
|--------|----------|----------|-------------|
| S3 Standard | $23.00 | 무료 | 자주 접근 |
| S3 Standard-IA | $12.50 | $0.01/GB | 월 1회 미만 접근 |
| S3 Glacier IR | $4.00 | $0.03/GB | 분기 1회 접근 |
| S3 Glacier DA | $0.99 | $0.02/GB + 12h 대기 | 연 1회 미만 (규정 보관) |

### 로그 비용 최적화

```
문제: CloudWatch Logs 500GB/월
  수집: $0.50/GB × 500GB = $250
  저장: $0.03/GB × 500GB = $15 (1개월만)
  1년 보관: $15 × 12 = $180

최적화:
1) 불필요 로그 필터링 (DEBUG 레벨 제거 → 40% 감소)
2) 보존 기간 30→14일 설정
3) S3 Export로 장기 보관 (Glacier: $0.004/GB)

절감: $250 → $150/월 (수집) + 장기 보관 비용 90% 절감
```

### EBS 스냅샷 관리

```bash
# 30일 이상 된 스냅샷 찾기
aws ec2 describe-snapshots --owner-ids self \
  --query "Snapshots[?StartTime<='2026-02-20'].[SnapshotId,VolumeSize,StartTime]" \
  --output table

# Data Lifecycle Manager로 자동 정리 설정
# 최근 7개 스냅샷만 유지, 나머지 자동 삭제
```

---

## 6) Kubernetes 비용 최적화

### Resource Request/Limit 최적화

```yaml
# ❌ 흔한 문제: request가 너무 큼 → 노드 낭비
resources:
  requests:
    cpu: "2"          # 실제 사용 0.3 → 1.7 CPU 낭비
    memory: "4Gi"     # 실제 사용 800Mi → 3.2Gi 낭비
  limits:
    cpu: "4"
    memory: "8Gi"

# ✅ 실측 기반 설정 (VPA 추천값 참고)
resources:
  requests:
    cpu: "500m"       # P95 사용량의 1.2배
    memory: "1Gi"     # P99 사용량의 1.3배
  limits:
    cpu: "1"          # 버스트 허용
    memory: "1536Mi"  # OOM 방지 여유
```

### VPA (Vertical Pod Autoscaler) 추천값 활용

```bash
# VPA 설치 후 추천값 확인
kubectl describe vpa order-service-vpa

# 출력 예시
# Recommendation:
#   Container: order-service
#     Lower Bound:  CPU: 250m,  Memory: 512Mi
#     Target:       CPU: 500m,  Memory: 1Gi
#     Upper Bound:  CPU: 1200m, Memory: 2Gi
```

### 노드 풀 전략

```yaml
# 혼합 노드 풀 전략
노드 풀 1 (On-Demand): 핵심 서비스 (API, DB proxy)
  - 인스턴스: m5.xlarge × 3 (최소)
  - 항상 유지

노드 풀 2 (Spot): 비동기/배치 워크로드
  - 인스턴스: m5.xlarge, m5a.xlarge, m4.xlarge (다양화)
  - 0~20대 오토스케일
  - 비용 70% 절감

노드 풀 3 (ARM/Graviton): 컴퓨트 집약 서비스
  - 인스턴스: m6g.xlarge (Graviton)
  - x86 대비 20% 저렴 + 성능 유사/우위
```

### Karpenter로 노드 최적화 (AWS)

```yaml
apiVersion: karpenter.sh/v1alpha5
kind: Provisioner
metadata:
  name: default
spec:
  requirements:
    - key: karpenter.sh/capacity-type
      operator: In
      values: ["spot", "on-demand"]
    - key: node.kubernetes.io/instance-type
      operator: In
      values: ["m5.xlarge", "m5.2xlarge", "m5a.xlarge", "m6g.xlarge"]
  limits:
    resources:
      cpu: "100"
  ttlSecondsAfterEmpty: 30   # 빈 노드 30초 후 제거
  consolidation:
    enabled: true              # 여유 노드 자동 통합
```

Karpenter는 Cluster Autoscaler보다 **더 빠르게(수초 내)** 노드를 프로비저닝하고, **빈 노드를 적극적으로 제거**합니다.

---

## 7) 예약 할인(RI/Savings Plan): 안정 구간만 커밋하라

### RI vs Savings Plan 비교

| 기준 | Reserved Instance | Savings Plan |
|------|------------------|-------------|
| 할인율 | 최대 72% | 최대 66% |
| 유연성 | 인스턴스 타입/리전 고정 | 인스턴스 패밀리 내 자유 변경 |
| 적합 | 안정적인 워크로드 | 인스턴스 변경 가능성 있는 워크로드 |
| 리스크 | 미사용 시 손실 큼 | 미사용 시 손실 상대적 작음 |

### 커밋 전략: "바닥 덮기"

```
월별 컴퓨트 사용량 패턴 (6개월 관찰):

사용량 ▲
  100% │          ╱╲
   80% │    ╱╲  ╱    ╲   ╱╲
   60% │  ╱    ╲╱      ╲╱    ╲    ← 피크: On-Demand
   40% │╱                      ╲
   20% │━━━━━━━━━━━━━━━━━━━━━━━━  ← 바닥: RI/Savings Plan
    0% └─────────────────────────
       1월  2월  3월  4월  5월  6월

바닥(항상 필요한 양) = 전체의 약 40%
→ 이 40%만 RI/SP로 커밋 (1년 All Upfront)
→ 나머지 60%는 On-Demand + Spot 혼합
```

**구매 타이밍 체크리스트:**
- [ ] 최소 2~4주 사용 패턴을 관찰했는가?
- [ ] "항상 켜져 있는" 워크로드를 식별했는가?
- [ ] 향후 아키텍처 변경(컨테이너 전환, ARM 마이그레이션) 계획이 없는가?
- [ ] Savings Plan은 인스턴스 패밀리가 같은 범위 내인가?

---

## 8) Observability 비용 관리

### 텔레메트리 비용 구조

```
로그:   수집 ($0.50/GB) + 저장 ($0.03/GB/월) + 쿼리 ($0.005/GB)
메트릭: 커스텀 메트릭당 ($0.30/개/월) + API 호출 ($0.01/1000)
트레이스: 수집 ($5.00/M spans) + 저장 ($0.03/GB/월)
```

### 텔레메트리 비용 최적화 전략

| 전략 | 절감 효과 | 리스크 |
|------|----------|--------|
| **로그 레벨 조정** (DEBUG→INFO) | 30~50% 수집 비용 감소 | 디버깅 시 정보 부족 |
| **샘플링** (트레이스 10% 수집) | 90% 트레이스 비용 감소 | 희귀 에러 놓칠 수 있음 |
| **카디널리티 관리** (메트릭 레이블 제한) | 커스텀 메트릭 비용 감소 | 분석 세밀도 하락 |
| **Head-based → Tail-based 샘플링** | 에러만 100% 수집 + 정상 5% | 구현 복잡도 |
| **보존 기간 단축** (30→14일) | 저장 비용 50% 감소 | 과거 분석 불가 |

```yaml
# OpenTelemetry Collector — Tail-based 샘플링 예시
processors:
  tail_sampling:
    decision_wait: 10s
    policies:
      - name: errors-always
        type: status_code
        status_code: { status_codes: [ERROR] }    # 에러는 100% 수집
      - name: slow-requests
        type: latency
        latency: { threshold_ms: 1000 }            # 1초 이상은 100%
      - name: normal-5-percent
        type: probabilistic
        probabilistic: { sampling_percentage: 5 }   # 정상은 5%
```

---

## 9) 비용 모니터링 대시보드 설계

### 핵심 지표 (KPI)

| 지표 | 공식 | 목표 |
|------|------|------|
| **단위 비용** | 월 비용 / 월 요청 수 | 전월 대비 감소 |
| **Coverage Rate** | RI/SP 커버 시간 / 전체 시간 | 60~80% |
| **Waste Rate** | 유휴 리소스 비용 / 전체 비용 | < 10% |
| **Cost per Active User** | 월 비용 / MAU | 서비스 성장과 비례 이하 |

### 비용 알림 설정

```bash
# AWS Budgets — 월 예산 초과 시 알림
aws budgets create-budget \
  --account-id 123456789012 \
  --budget '{
    "BudgetName": "monthly-total",
    "BudgetLimit": { "Amount": "5000", "Unit": "USD" },
    "TimeUnit": "MONTHLY",
    "BudgetType": "COST"
  }' \
  --notifications-with-subscribers '[
    {
      "Notification": {
        "NotificationType": "ACTUAL",
        "ComparisonOperator": "GREATER_THAN",
        "Threshold": 80
      },
      "Subscribers": [
        { "SubscriptionType": "EMAIL", "Address": "ops@example.com" }
      ]
    }
  ]'
```

### 이상 탐지 (Cost Anomaly Detection)

```
정상 패턴: 일 $150~$170
이상 감지: 일 $250 (50% 증가)
  → 원인: 새 배치 잡이 m5.4xlarge를 24시간 방치
  → 조치: Spot + 완료 후 자동 종료 설정
```

---

## 10) 비용 태깅 전략

### 필수 태그

```json
{
  "Service": "order-service",
  "Environment": "production",
  "Team": "backend",
  "CostCenter": "engineering",
  "ManagedBy": "terraform"
}
```

### 태깅 강제 정책 (AWS SCP)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyUntaggedResources",
      "Effect": "Deny",
      "Action": [
        "ec2:RunInstances",
        "rds:CreateDBInstance"
      ],
      "Resource": "*",
      "Condition": {
        "StringNotLike": {
          "aws:RequestTag/Service": "?*",
          "aws:RequestTag/Environment": "?*",
          "aws:RequestTag/Team": "?*"
        }
      }
    }
  ]
}
```

> **핵심**: 태그가 없으면 "누가 이 비용을 만들었는지" 추적이 불가능합니다. 태깅은 비용 가시성의 기본입니다.

---

## 11) 운영 체크리스트

### 월간 비용 리뷰

- [ ] 비용 상위 3개 항목을 파악했는가?
- [ ] 전월 대비 10% 이상 증가한 항목의 원인을 확인했는가?
- [ ] 유휴 리소스(EC2, EBS, EIP, 스냅샷)를 정리했는가?
- [ ] RI/Savings Plan 커버리지가 60% 이상인가?

### Compute 점검

- [ ] CPU/메모리 사용률 20% 미만인 인스턴스에 Rightsizing을 적용했는가?
- [ ] 개발/스테이징 환경에 스케줄 시작/중지가 설정되어 있는가?
- [ ] Spot 사용 가능한 워크로드를 식별했는가?

### Network 점검

- [ ] NAT Gateway를 통한 S3/ECR 트래픽을 VPC Endpoint로 전환했는가?
- [ ] CDN을 통한 Egress 비용 절감이 적용되어 있는가?
- [ ] Cross-AZ 트래픽이 과도하지 않은가?

### Storage/Observability 점검

- [ ] S3 수명 주기 정책이 설정되어 있는가?
- [ ] 로그 보존 기간이 명확히 정해져 있는가?
- [ ] 트레이스 샘플링이 적용되어 있는가?
- [ ] 모든 리소스에 비용 태그가 붙어 있는가?

---

## 연습(추천)

1. AWS Cost Explorer에서 최근 3개월 비용 추이를 확인하고, 상위 3개 항목을 뽑아 각각 1개 절감 액션을 정해보기
2. 현재 EC2/Pod의 CPU/메모리 사용률을 확인하고, Rightsizing 후보를 선정해보기
3. NAT Gateway를 통한 S3 트래픽을 VPC Endpoint로 전환하고 비용 절감을 계산해보기
4. S3 수명 주기 정책을 설정해서 30일 이상 된 로그를 Glacier로 이동시켜보기
5. Kubernetes VPA 추천값과 현재 Request/Limit을 비교해보기

---

## 관련 심화 학습

- [Observability Baseline](/learning/deep-dive/deep-dive-observability-baseline/) — 관측성 파이프라인과 비용 관계
- [Observability Alarms](/learning/deep-dive/deep-dive-observability-alarms/) — 알람 기반 비용 이상 탐지
- [Autoscaling & Load Testing](/learning/deep-dive/deep-dive-load-testing-strategy/) — 스케일링 전략과 비용 트레이드오프
- [Kubernetes 기초](/learning/deep-dive/deep-dive-kubernetes-basics/) — 리소스 관리와 스케줄링
- [Redis 캐싱](/learning/deep-dive/deep-dive-redis-caching/) — 캐시로 DB 비용 절감
- [SLO/SLI/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/) — 비용과 신뢰성의 균형
- [Capacity Planning](/learning/deep-dive/deep-dive-capacity-planning-littles-law-saturation/) — 용량 계획과 비용 예측
