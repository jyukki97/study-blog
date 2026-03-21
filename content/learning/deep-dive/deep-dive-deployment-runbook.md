---
title: "배포 런북: 안전한 배포와 롤백"
date: 2025-12-16
draft: false
topic: "Ops"
tags: ["Deployment", "Rollback", "Runbook", "Kubernetes", "ArgoCD", "Blue-Green", "Canary"]
categories: ["DevOps"]
description: "배포 전/중/후 판단 기준과 실전 명령어, K8s 매니페스트, ArgoCD Rollout, DB 마이그레이션 SQL까지 — 바로 복사해서 쓰는 런북"
module: "ops-observability"
study_order: 380
---

## 이 글에서 얻는 것

- 배포를 "코드 올리기"가 아니라 **변경을 안전하게 적용하는 절차**로 설계할 수 있습니다.
- 롤링/블루그린/카나리 전략을 "언제 무엇을 쓰는지" 기준으로 선택할 수 있습니다.
- **Kubernetes**, **ArgoCD Rollouts**, **Helm** 실전 명령어와 매니페스트를 즉시 활용합니다.
- DB 마이그레이션이 포함된 배포에서 **expand/contract** SQL을 단계별로 작성합니다.
- 장애 조짐이 보일 때 "배포 중단→완화→롤백"을 어떤 순서로 판단해야 하는지 런북 감각이 생깁니다.
- 배포 사고 RCA(Root Cause Analysis) 템플릿으로 재발을 방지합니다.

---

## 0) 배포는 '변경 관리'다

안전한 배포는 한 문장으로 요약하면 이렇습니다.

- 변경 범위를 작게 나누고(Blast radius),
- 빨리 감지하고(Detect),
- 빨리 복구한다(Recover).

그래서 런북에는 "명령"만이 아니라, **판단 기준(어떤 지표가 얼마면 중단/롤백할지)**이 들어가야 합니다.

---

## 1) 배포 전략 비교표 (의사결정 매트릭스)

| 전략 | 무중단 | 즉시 롤백 | 트래픽 제어 | 리소스 비용 | 복잡도 | 적합한 경우 |
|:---|:---:|:---:|:---:|:---:|:---:|:---|
| **Rolling** | ✅ | ⚠️ 느림 | ❌ | ★ | ★ | 내부 서비스, API 호환 보장 시 |
| **Blue/Green** | ✅ | ✅ 즉시 | ❌ (전체 전환) | ★★★ | ★★ | 릴리스 정합성 중요, 동시 2환경 가능 |
| **Canary** | ✅ | ✅ 빠름 | ✅ % 제어 | ★★ | ★★★ | 사용자 영향 최소화, A/B 검증 |
| **Shadow** | ✅ | ✅ (영향 없음) | ✅ 복제 | ★★★ | ★★★★ | 위험도 높은 변경, 성능 비교 |

### 선택 디시전 트리

```
신규 배포 or 변경?
├── API 호환성 깨짐? → Blue/Green (전체 전환)
├── 사용자 영향 불확실? → Canary (점진 노출)
├── DB 스키마 변경 포함? → Expand/Contract + Canary
├── 내부 서비스 + 호환 보장? → Rolling (가장 단순)
└── 위험도 매우 높음? → Shadow (실트래픽 복제, 응답 폐기)
```

---

## 2) 배포 전에 '반드시' 결정할 3가지

1) **검증 기준**: 무엇을 보면 성공/실패인지 (예: 5xx < 0.1%, p99 < 500ms, 핵심 플로우 성공률 > 99.5%)
2) **완화 수단**: 피처 플래그/트래픽 스위치/레이트리밋 등 "즉시 영향 줄이는 버튼"
3) **되돌리기 방법**: 코드 롤백만 가능한지, 데이터/스키마까지 손댈지 (가장 중요)

이 3개가 없으면 배포 중 이상이 생겼을 때 "우왕좌왕"하게 됩니다.

### 사전 확인 체크리스트

```text
□ 변경 범위: 어떤 기능/엔드포인트/배치가 영향을 받는가
□ 의존성: DB/캐시/메시지/외부 API 상태 (최근 장애/지연)
□ 관측 준비: 대시보드/알람/로그 조회 링크 (배포 중 클릭 한 번에 보이게)
□ 완화 수단: 피처 플래그 기본값 / 레이트리밋 / 트래픽 스위치 준비
□ DB 마이그레이션: expand/contract 단계로 분리했는가
□ 롤백 절차: 코드 롤백 명령어가 런북에 있는가
□ 온콜 연락처: 장애 에스컬레이션 경로 확인
```

---

## 3) Kubernetes 배포 실전 매니페스트

### 3-1. Rolling Update (기본)

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  labels:
    app: order-service
    version: v2.3.1
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1    # 최대 1개 Pod 내려감
      maxSurge: 1           # 최대 1개 Pod 추가 생성
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
        version: v2.3.1
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8080"
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: order-service
          image: registry.example.com/order-service:v2.3.1
          ports:
            - containerPort: 8080
          
          # Readiness: 트래픽 수신 준비 완료 확인
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 5
            failureThreshold: 3
          
          # Liveness: 프로세스 정상 동작 확인
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 3
          
          # Startup: 초기화 완료 대기 (느린 앱)
          startupProbe:
            httpGet:
              path: /actuator/health
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 30  # 최대 150초 대기
          
          # Graceful Shutdown: SIGTERM → 진행 중 요청 완료 후 종료
          lifecycle:
            preStop:
              exec:
                command: ["sh", "-c", "sleep 5"]  # LB 연결 해제 대기
          
          resources:
            requests:
              cpu: 500m
              memory: 512Mi
            limits:
              cpu: "1"
              memory: 1Gi
          
          env:
            - name: SPRING_PROFILES_ACTIVE
              value: "production"
            - name: JAVA_OPTS
              value: "-XX:MaxRAMPercentage=75.0 -XX:+UseG1GC"
```

### 3-2. Rolling Update 실전 명령어

```bash
# 배포 시작
kubectl apply -f deployment.yaml

# 배포 상태 실시간 모니터링
kubectl rollout status deployment/order-service --timeout=300s

# 배포 이력 확인
kubectl rollout history deployment/order-service

# ⚠️ 즉시 롤백 (이전 버전으로)
kubectl rollout undo deployment/order-service

# 특정 리비전으로 롤백
kubectl rollout undo deployment/order-service --to-revision=3

# 배포 일시 정지 (관찰용)
kubectl rollout pause deployment/order-service

# 배포 재개
kubectl rollout resume deployment/order-service

# Pod 상태 상세 확인
kubectl get pods -l app=order-service -o wide
kubectl describe pod <pod-name> | grep -A 20 "Events:"

# 최근 로그 확인 (에러 집중)
kubectl logs -l app=order-service --tail=100 --since=5m | grep -i error
```

### 3-3. ArgoCD Rollouts — Canary 배포

```yaml
# rollout.yaml (Argo Rollouts)
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: order-service
spec:
  replicas: 4
  strategy:
    canary:
      # 단계별 트래픽 비율
      steps:
        - setWeight: 5        # 5% 트래픽 → 카나리
        - pause: { duration: 5m }  # 5분 관찰
        - analysis:
            templates:
              - templateName: success-rate
            args:
              - name: service-name
                value: order-service
        - setWeight: 25       # 25%로 증가
        - pause: { duration: 10m }
        - setWeight: 50       # 50%
        - pause: { duration: 10m }
        - setWeight: 100      # 전체 전환
      
      # 자동 롤백 분석
      canaryMetadata:
        labels:
          role: canary
      stableMetadata:
        labels:
          role: stable
      
      # 트래픽 라우팅 (Istio/Nginx)
      trafficRouting:
        istio:
          virtualService:
            name: order-service-vsvc
            routes:
              - primary
  
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
    spec:
      containers:
        - name: order-service
          image: registry.example.com/order-service:v2.3.1
          ports:
            - containerPort: 8080
---
# analysis-template.yaml (자동 성공률 검증)
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: success-rate
spec:
  args:
    - name: service-name
  metrics:
    - name: success-rate
      # Prometheus 쿼리로 성공률 측정
      provider:
        prometheus:
          address: http://prometheus:9090
          query: |
            sum(rate(http_server_requests_seconds_count{
              app="{{args.service-name}}",
              status!~"5.."
            }[5m])) /
            sum(rate(http_server_requests_seconds_count{
              app="{{args.service-name}}"
            }[5m])) * 100
      # 성공률 99% 미만이면 자동 롤백
      successCondition: result[0] >= 99
      failureLimit: 3
      interval: 60s
    
    - name: p99-latency
      provider:
        prometheus:
          address: http://prometheus:9090
          query: |
            histogram_quantile(0.99,
              sum(rate(http_server_requests_seconds_bucket{
                app="{{args.service-name}}"
              }[5m])) by (le)
            ) * 1000
      # p99 500ms 초과 시 실패
      successCondition: result[0] <= 500
      failureLimit: 3
      interval: 60s
```

### 3-4. ArgoCD Rollouts 명령어

```bash
# Argo Rollouts 플러그인 사용
kubectl argo rollouts get rollout order-service --watch

# 카나리 수동 승격 (다음 단계로)
kubectl argo rollouts promote order-service

# 즉시 전체 승격 (나머지 단계 건너뛰기)
kubectl argo rollouts promote order-service --full

# 즉시 롤백 (카나리 중단)
kubectl argo rollouts abort order-service

# 특정 리비전으로 롤백
kubectl argo rollouts undo order-service --to-revision=5

# 대시보드 (브라우저)
kubectl argo rollouts dashboard
```

---

## 4) Blue/Green 배포 — Kubernetes Service 활용

```yaml
# blue-deployment.yaml (현재 운영 중)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service-blue
spec:
  replicas: 4
  selector:
    matchLabels:
      app: order-service
      slot: blue
  template:
    metadata:
      labels:
        app: order-service
        slot: blue
    spec:
      containers:
        - name: order-service
          image: registry.example.com/order-service:v2.2.0
---
# green-deployment.yaml (새 버전)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service-green
spec:
  replicas: 4
  selector:
    matchLabels:
      app: order-service
      slot: green
  template:
    metadata:
      labels:
        app: order-service
        slot: green
    spec:
      containers:
        - name: order-service
          image: registry.example.com/order-service:v2.3.1
---
# service.yaml (트래픽 스위칭)
apiVersion: v1
kind: Service
metadata:
  name: order-service
spec:
  selector:
    app: order-service
    slot: blue   # ← 이 값을 blue/green으로 전환
  ports:
    - port: 80
      targetPort: 8080
```

### 전환/롤백 명령어

```bash
# Green으로 전환 (배포)
kubectl patch service order-service -p '{"spec":{"selector":{"slot":"green"}}}'

# Blue로 롤백 (즉시!)
kubectl patch service order-service -p '{"spec":{"selector":{"slot":"blue"}}}'

# Green 정상 확인 후 Blue 축소
kubectl scale deployment order-service-blue --replicas=0
```

---

## 5) DB 마이그레이션: Expand/Contract 원칙

가장 안전한 방식은 "한 번의 배포로 스키마를 완전히 바꾸지 않는 것"입니다.

### 5-1. 전체 과정 (컬럼 이름 변경 예시)

```
AS-IS: orders.user_name (VARCHAR 50)
TO-BE: orders.customer_name (VARCHAR 100)
```

### Phase 1: Expand (확장) — 배포 #1

```sql
-- V1.1__add_customer_name_column.sql (Flyway)
-- 새 컬럼 추가 (기존 코드에 영향 없음)
ALTER TABLE orders ADD COLUMN customer_name VARCHAR(100);

-- 트리거로 실시간 동기화 (기존 쓰기도 새 컬럼에 반영)
CREATE OR REPLACE FUNCTION sync_customer_name()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.customer_name IS NULL THEN
    NEW.customer_name := NEW.user_name;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_customer_name
  BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION sync_customer_name();
```

### Phase 2: Backfill (데이터 이행) — 배포 #1 직후

```sql
-- V1.2__backfill_customer_name.sql
-- 기존 데이터를 배치로 채움 (락 최소화)
UPDATE orders
SET customer_name = user_name
WHERE customer_name IS NULL
  AND id BETWEEN 1 AND 100000;  -- 배치 단위로 실행

UPDATE orders
SET customer_name = user_name
WHERE customer_name IS NULL
  AND id BETWEEN 100001 AND 200000;

-- 진행률 확인 쿼리
SELECT 
  COUNT(*) AS total,
  COUNT(customer_name) AS filled,
  ROUND(COUNT(customer_name)::numeric / COUNT(*) * 100, 2) AS pct
FROM orders;
```

### Phase 3: 애플리케이션 전환 — 배포 #2

```java
// 코드에서 customer_name을 읽고/쓰도록 변경
// user_name은 여전히 트리거가 동기화하므로 롤백 가능
@Entity
public class Order {
    @Column(name = "customer_name", length = 100)
    private String customerName;
    
    // 호환성: 구버전과 신버전이 공존할 때 둘 다 읽음
    @Column(name = "user_name", length = 50, insertable = false, updatable = false)
    private String userName;
}
```

### Phase 4: Contract (수축) — 배포 #3 (충분한 안정 기간 후)

```sql
-- V1.3__drop_user_name_column.sql
-- ⚠️ 파괴적 변경 — 롤백 불가! 반드시 Phase 3 안정 확인 후 실행

-- 트리거 제거
DROP TRIGGER IF EXISTS trg_sync_customer_name ON orders;
DROP FUNCTION IF EXISTS sync_customer_name();

-- NOT NULL 제약 추가
ALTER TABLE orders ALTER COLUMN customer_name SET NOT NULL;

-- 구 컬럼 삭제 (최종)
ALTER TABLE orders DROP COLUMN user_name;
```

### 5-2. Expand/Contract 체크리스트

```text
Phase 1 (Expand):
  □ 새 컬럼/테이블만 추가 (기존 코드 영향 없음)
  □ 동기화 트리거 또는 듀얼 라이트 설정
  □ 롤백: ALTER TABLE DROP COLUMN으로 즉시 원복 가능

Phase 2 (Backfill):
  □ 배치 단위로 실행 (락/부하 분산)
  □ 진행률 모니터링 쿼리 준비
  □ 대형 테이블은 pt-online-schema-change 또는 gh-ost 사용

Phase 3 (코드 전환):
  □ 신/구 버전이 공존해도 동작 확인
  □ 읽기: 새 컬럼 우선, fallback 구 컬럼
  □ 쓰기: 양쪽 다 쓰기 또는 트리거 동기화
  □ 최소 1~2주 안정 운영 후 Phase 4 진행

Phase 4 (Contract):
  □ ⚠️ 롤백 불가 — 확실할 때만 실행
  □ 구 컬럼 참조하는 쿼리/인덱스/뷰 모두 제거 확인
  □ 실행 전 DDL 검증 (staging에서 먼저)
  □ 실행 후 에러 로그 10분 관찰
```

---

## 6) Helm 배포 실전

```bash
# 현재 릴리스 상태
helm list -n production

# 배포 (values 파일 + 오버라이드)
helm upgrade order-service ./charts/order-service \
  -n production \
  -f values-production.yaml \
  --set image.tag=v2.3.1 \
  --set replicaCount=4 \
  --timeout 5m \
  --wait                    # Pod Ready까지 대기
  --atomic                  # 실패 시 자동 롤백

# 배포 이력 확인
helm history order-service -n production

# 롤백 (이전 리비전으로)
helm rollback order-service 0 -n production  # 0 = 직전

# 특정 리비전으로 롤백
helm rollback order-service 5 -n production

# 변경 사항 미리 확인 (dry-run + diff)
helm diff upgrade order-service ./charts/order-service \
  -n production \
  -f values-production.yaml \
  --set image.tag=v2.3.1
```

---

## 7) 배포 중 관측 — 반드시 보는 4가지

### 7-1. 핵심 지표와 판단 기준

| 지표 | 정상 범위 | 경고 (관찰) | 위험 (중단/롤백) |
|:---|:---|:---|:---|
| **에러율 (5xx)** | < 0.1% | 0.1% ~ 1% | > 1% |
| **p99 레이턴시** | < 200ms | 200ms ~ 500ms | > 500ms 또는 2배 이상 증가 |
| **CPU 사용률** | < 60% | 60% ~ 80% | > 80% 지속 |
| **DB 커넥션 풀** | < 70% | 70% ~ 90% | > 90% 또는 대기 발생 |
| **Kafka Consumer Lag** | < 1000 | 1000 ~ 10000 | > 10000 또는 증가 추세 |
| **핵심 플로우 성공률** | > 99.9% | 99% ~ 99.9% | < 99% |

### 7-2. 실시간 모니터링 명령어

```bash
# Pod 리소스 사용량 실시간
kubectl top pods -l app=order-service --containers

# 에러 로그 실시간 스트림
kubectl logs -l app=order-service -f --since=1m | grep -iE "error|exception|fatal"

# 5xx 비율 (Prometheus)
# sum(rate(http_server_requests_seconds_count{status=~"5.."}[2m]))
# / sum(rate(http_server_requests_seconds_count[2m])) * 100

# 전체 Pod 이벤트 (OOMKill, CrashLoop 감지)
kubectl get events -n production --sort-by='.lastTimestamp' | tail -20
```

### 7-3. Grafana 대시보드 필수 패널

```json
{
  "panels": [
    {
      "title": "배포 중 에러율 (5xx)",
      "query": "sum(rate(http_server_requests_seconds_count{status=~'5..'}[2m])) by (pod) / sum(rate(http_server_requests_seconds_count[2m])) by (pod) * 100",
      "alert": "> 1% 시 PagerDuty"
    },
    {
      "title": "p99 레이턴시 (카나리 vs 안정)",
      "query": "histogram_quantile(0.99, sum(rate(http_server_requests_seconds_bucket[2m])) by (le, role))",
      "note": "role=canary vs role=stable 비교"
    },
    {
      "title": "Pod Ready 상태",
      "query": "kube_deployment_status_replicas_ready{deployment='order-service'}",
      "note": "desiredReplicas와 비교"
    }
  ]
}
```

---

## 8) 이상 발생 시 대응 런북

### 8-1. 판단 플로우

```
배포 중 이상 감지
├── 에러율 > 1% OR p99 > 500ms?
│   ├── YES → 배포 즉시 중단
│   │   ├── 완화 수단 있음? (피처 플래그 OFF / 레이트리밋)
│   │   │   ├── YES → 완화 실행 → 5분 관찰 → 정상화?
│   │   │   │   ├── YES → 원인 분석 후 재배포
│   │   │   │   └── NO → 롤백
│   │   │   └── NO → 즉시 롤백
│   │   └── DB 스키마 변경 포함?
│   │       ├── YES → 코드만 롤백 (스키마는 expand 상태 유지)
│   │       └── NO → 코드 롤백
│   └── NO → 관찰 계속 (5분 단위)
└── Pod CrashLoopBackOff?
    ├── 로그 확인 → OOM? → 메모리 limit 조정
    ├── 설정 오류? → ConfigMap/Secret 확인
    └── 의존성 장애? → DB/Redis/Kafka 상태 확인
```

### 8-2. 롤백 명령어 모음

```bash
# ── Kubernetes 롤백 ──
kubectl rollout undo deployment/order-service
kubectl rollout status deployment/order-service

# ── Helm 롤백 ──
helm rollback order-service 0 -n production --wait

# ── ArgoCD Rollouts 롤백 ──
kubectl argo rollouts abort order-service
kubectl argo rollouts undo order-service

# ── 피처 플래그 즉시 OFF ──
curl -X PATCH https://flagsmith.example.com/api/v1/flags/new-checkout/ \
  -H "Authorization: Token ${FLAGSMITH_TOKEN}" \
  -d '{"enabled": false}'

# ── DB 마이그레이션 롤백 (Flyway) ──
# ⚠️ Expand 단계만 되돌림 (Contract 후에는 불가)
flyway -url=jdbc:postgresql://db:5432/orders \
  -user=deploy \
  -target=1.0 \
  undo

# ── 서비스 메쉬 트래픽 차단 ──
kubectl patch virtualservice order-service-vsvc -p '
spec:
  http:
  - route:
    - destination:
        host: order-service-stable
      weight: 100
'
```

---

## 9) 배포 후 검증 (스모크 테스트)

### 9-1. 자동화 스크립트

```bash
#!/bin/bash
# post-deploy-smoke.sh
set -e

BASE_URL="https://api.example.com"
TESTS_PASSED=0
TESTS_FAILED=0

check() {
  local name="$1" url="$2" expected_status="$3" expected_body="$4"
  
  response=$(curl -s -o /tmp/smoke_body -w "%{http_code}" "$url")
  body=$(cat /tmp/smoke_body)
  
  if [ "$response" = "$expected_status" ] && echo "$body" | grep -q "$expected_body"; then
    echo "✅ $name (HTTP $response)"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo "❌ $name (HTTP $response, expected $expected_status)"
    echo "   Body: $(echo $body | head -c 200)"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

echo "=== Post-Deploy Smoke Test ==="

# 헬스체크
check "Health"        "$BASE_URL/actuator/health"        "200" "UP"
check "Readiness"     "$BASE_URL/actuator/health/readiness" "200" "UP"

# 핵심 플로우
check "주문 목록"     "$BASE_URL/api/orders?size=1"      "200" "content"
check "상품 조회"     "$BASE_URL/api/products/1"         "200" "name"
check "인증 실패"     "$BASE_URL/api/orders"             "401" "Unauthorized"
check "잘못된 입력"   "$BASE_URL/api/orders" -d '{"amount":-1}' "400" "validation"

echo ""
echo "=== Results: $TESTS_PASSED passed, $TESTS_FAILED failed ==="

if [ $TESTS_FAILED -gt 0 ]; then
  echo "⚠️ 스모크 테스트 실패 — 롤백을 고려하세요"
  exit 1
fi
```

### 9-2. GitHub Actions에서 자동 실행

```yaml
# .github/workflows/deploy.yml (발췌)
- name: Deploy to production
  run: helm upgrade ...

- name: Smoke test
  run: |
    sleep 30  # Pod Ready 대기
    bash scripts/post-deploy-smoke.sh
  
- name: Auto-rollback on failure
  if: failure()
  run: |
    echo "⚠️ Smoke test failed — rolling back"
    helm rollback order-service 0 -n production --wait
    # Slack 알림
    curl -X POST "$SLACK_WEBHOOK" -d '{"text":"🚨 배포 롤백: order-service v2.3.1 smoke test 실패"}'
```

---

## 10) 배포 사고 RCA 템플릿

배포 후 문제가 발생했다면 반드시 기록합니다.

```markdown
## 배포 사고 RCA — [서비스명] [날짜]

### 타임라인
- HH:MM 배포 시작 (v2.3.0 → v2.3.1)
- HH:MM 카나리 5% 전환
- HH:MM 에러율 3.2% 감지 (알람 발동)
- HH:MM 배포 중단 + 피처 플래그 OFF
- HH:MM 에러율 정상화 확인
- HH:MM 롤백 실행 (v2.3.0)
- HH:MM 전체 정상 확인

### 영향
- 영향 시간: XX분
- 영향 범위: 주문 생성 API 5xx (약 YY건)
- 사용자 영향: 주문 실패 → 재시도 시 성공

### 근본 원인
- 새 버전에서 DB 컬럼 타입 변경이 구 버전 Pod와 호환되지 않았음
- expand/contract를 한 번에 실행한 것이 원인

### 재발 방지
- [ ] DB 스키마 변경은 반드시 expand/contract 3단계로 분리
- [ ] 카나리 분석에 DB 에러 메트릭 추가
- [ ] 배포 전 스키마 호환성 검증 CI 단계 추가

### 교훈
- 파괴적 스키마 변경은 배포와 분리해야 한다
```

---

## 11) 운영 안티패턴 6가지

| 안티패턴 | 왜 위험한가 | 올바른 접근 |
|:---|:---|:---|
| 금요일 오후 배포 | 주말에 인력 부족 | 월~수 오전 배포 |
| "한 번에 크게" 배포 | Blast radius 최대 | 작은 단위로 자주 |
| 롤백 절차 없이 배포 | 장애 시 우왕좌왕 | 런북에 롤백 명령어 필수 |
| DB 스키마 + 코드 동시 변경 | 롤백 불가능 | expand/contract 분리 |
| 수동 배포 (ssh → pull → restart) | 재현 불가, 감사 불가 | CI/CD 파이프라인 필수 |
| 배포 후 관찰 안 함 | 느린 장애 놓침 | 최소 15분 대시보드 관찰 |

---

## 요약

- 배포 전략은 **변경의 위험도**에 따라 선택한다 (Rolling < Blue/Green < Canary < Shadow).
- **검증 기준 + 완화 수단 + 되돌리기 방법** 3가지가 런북의 핵심이다.
- DB 마이그레이션은 반드시 **expand/contract**로 분리한다.
- 배포 중 **에러율/레이턴시/리소스/의존성** 4가지를 실시간 관찰한다.
- 사고가 나면 **RCA를 기록**하여 런북을 계속 진화시킨다.

---

## 연습(추천)

- 내 서비스의 배포 런북을 1페이지로 써보기 (검증 지표 3개 + 중단/롤백 기준 3개)
- DB 스키마 변경이 포함된 배포를 하나 골라 expand/contract로 분해해보기
- "피처 플래그 off"로 즉시 완화되는 시나리오를 만들어보고, 배포 중 실제로 써보기
- ArgoCD Rollouts AnalysisTemplate을 작성하고, staging에서 자동 롤백을 검증해보기

---

## 관련 심화 학습

- [Kubernetes 기초](/learning/deep-dive/deep-dive-kubernetes-basics/) — Pod, Service, Deployment 핵심
- [Kubernetes Rollouts](/learning/deep-dive/deep-dive-kubernetes-rollouts/) — 롤링 업데이트와 롤백 전략
- [CI/CD GitHub Actions](/learning/deep-dive/deep-dive-ci-cd-github-actions/) — 파이프라인 설계
- [GitHub Actions CI 파이프라인](/learning/deep-dive/deep-dive-github-actions-ci-pipeline/) — 실전 워크플로
- [Feature Flags](/learning/deep-dive/deep-dive-feature-flags/) — 피처 플래그로 배포 리스크 제어
- [Online DDL & Expand/Contract](/learning/deep-dive/deep-dive-online-ddl-expand-contract/) — 무중단 스키마 변경
- [Graceful Shutdown](/learning/deep-dive/deep-dive-graceful-shutdown/) — 배포 시 안전한 종료
- [Load Balancer & Health Checks](/learning/deep-dive/deep-dive-load-balancer-healthchecks/) — 트래픽 라우팅과 헬스 체크
- [Observability Baseline](/learning/deep-dive/deep-dive-observability-baseline/) — 배포 모니터링 기반
- [Chaos Engineering](/learning/deep-dive/deep-dive-chaos-engineering/) — 배포 복원력 검증
