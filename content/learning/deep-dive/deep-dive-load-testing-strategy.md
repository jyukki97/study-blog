---
title: "부하 테스트 전략과 성능 튜닝 체크리스트"
date: 2025-12-16
draft: false
topic: "Performance"
tags: ["Load Test", "k6", "JMeter", "Performance Tuning", "Gatling", "SLO", "Capacity Planning"]
categories: ["DevOps"]
description: "부하 시나리오 설계, 목표 지표(SLI/SLO), 병목 파악과 튜닝 루틴"
module: "ops-observability"
study_order: 350
---

## 이 글에서 얻는 것

- "부하 테스트를 한다"를 도구 실행이 아니라, **목표 설정 → 시나리오 → 측정 → 병목 분석 → 재검증** 루프로 설계할 수 있습니다.
- p95/p99 레이턴시, 에러율, 포화(saturation)를 함께 보고 "어디가 병목인지"를 분류할 수 있습니다.
- 테스트가 잘못 설계돼서(캐시 워밍업/데이터/환경) 결과가 왜곡되는 흔한 함정을 피할 수 있습니다.
- 도구별 특성을 비교하고, 팀 상황에 맞는 도구를 선택할 수 있습니다.

---

## 0) 부하 테스트는 '튜닝'이 아니라 '사실 확인'이다

부하 테스트의 목적은 보통 세 가지입니다.

- 현재 용량(capacity)에서 SLO를 만족하는가?
- 어느 지점에서 무너지는가(breakpoint)?
- 병목이 어디인가(DB/락/커넥션 풀/CPU/GC/네트워크)?

즉, 먼저 "어디까지 되는지"를 알고, 그 다음에 튜닝을 합니다.

> **"성능 테스트 없이 최적화하는 것은, 지도 없이 길을 찾는 것과 같다."**
> 감이 아니라 데이터로 의사결정해야 합니다.

---

## 1) 테스트 종류를 구분하면 계획이 쉬워진다

| 종류 | 목적 | 부하 패턴 | 지속 시간 | 주요 관측 지표 |
| :--- | :--- | :--- | :--- | :--- |
| **Load test** | SLO 만족 확인 | 예상 피크까지 점진 증가 | 10~30분 | p95, 에러율, 처리량 |
| **Stress test** | 한계점 발견 | 예상 피크의 150~300% | 10~20분 | breakpoint, 그레이스풀 저하 여부 |
| **Spike test** | 순간 급증 대응 | 0 → 피크 → 0 순간 전환 | 5~10분 | 복구 시간, 오토스케일 반응 |
| **Soak test** | 장시간 안정성 | 일반 부하 지속 | 2~24시간 | 메모리 누수, GC 증가, 커넥션 누수 |
| **Breakpoint test** | 절대 한계 측정 | 무한 증가 | 실패까지 | max RPS, 첫 에러 지점 |

```
💡 실무에서 자주 빠뜨리는 것:
  
  1. Soak test를 안 한다 → 배포 3일 후 메모리 누수로 장애
  2. Spike test를 안 한다 → 이벤트 오픈 시 서킷브레이커 폭발
  3. Stress test만 한다 → "어디까지 되는지"만 알고 "왜 무너지는지"를 모름
```

---

## 2) 목표(SLI/SLO)를 먼저 고정하라

### SLI와 SLO의 관계

```
SLI (Service Level Indicator): 측정하는 지표
  → 예: "주문 조회 API의 응답 시간"

SLO (Service Level Objective): 목표 수준
  → 예: "p95 < 200ms, 에러율 < 0.1%"

SLA (Service Level Agreement): 고객과의 약속
  → 예: "가용성 99.9%, 위반 시 크레딧 환불"
```

### SLO 설정 프레임워크

대체로 아래 3가지는 필수입니다.

| 분류 | SLI (지표) | SLO (목표) | 측정 방법 |
| :--- | :--- | :--- | :--- |
| **레이턴시** | p95/p99 응답 시간 | p95 < 200ms, p99 < 500ms | 히스토그램(Prometheus) |
| **가용성** | 성공 요청 비율 | > 99.9% (= 에러 < 0.1%) | `rate(http_5xx) / rate(http_total)` |
| **처리량** | 초당 요청 수 | 피크 시 500 RPS 유지 | Counter rate |
| **포화도** | 리소스 사용률 | CPU < 80%, 커넥션 풀 < 90% | Gauge |

**SLO 예시 (주문 서비스):**

```
주문 조회 (GET /api/orders)
  └─ p95 < 200ms, p99 < 500ms, 5xx < 0.1%

주문 생성 (POST /api/orders)
  └─ p95 < 500ms, p99 < 1s, 5xx < 0.05%

검색 (GET /api/search)
  └─ p95 < 300ms, p99 < 800ms, 5xx < 0.5%
```

> SLO가 없으면 부하 테스트는 "느린데요?"로 끝나기 쉽습니다.

---

## 3) 시나리오 설계: 실제 사용자 경로를 모델링

### 좋은 시나리오의 3요소

**요소 1: 현실적인 요청 비율 (Traffic Mix)**

```
실제 서비스 트래픽 분석 결과:
  - 상품 목록 조회: 50%   (GET /products)
  - 상품 상세 조회: 30%   (GET /products/{id})
  - 장바구니 추가:  10%   (POST /cart)
  - 주문 생성:      5%    (POST /orders)
  - 결제:           3%    (POST /payments)
  - 기타:           2%

❌ 안 좋은 시나리오: 모든 API를 균등하게 1:1:1 호출
✅ 좋은 시나리오: 실제 비율을 반영
```

**요소 2: Think Time (사용자 대기 시간)**

```
실제 사용자는 쉬지 않고 요청을 보내지 않습니다.

페이지 열람: 5~15초
장바구니 담기 전 고민: 10~30초
결제 정보 입력: 30~60초

Think Time 없는 테스트 → 실제보다 10~50배 높은 RPS
→ "서버가 1000 RPS도 못 버텨요!" (실제 피크는 100 RPS)
```

**요소 3: 데이터 분포**

```
❌ 모든 요청이 같은 상품 ID 조회 → 캐시 히트 100% (비현실적)
❌ 모든 요청이 다른 상품 ID 조회 → 캐시 히트 0% (비현실적)

✅ 현실적 분포:
  - 인기 상품 20%가 조회의 80%를 차지 (파레토)
  - zipf 분포 또는 실제 로그 기반 분포 사용
```

### 시나리오 설계 체크리스트

| 항목 | 확인 | 위험 |
| :--- | :--- | :--- |
| API 호출 비율이 현실적인가? | ☐ | 균등 분배 → 읽기 부하 과소평가 |
| Think Time이 있는가? | ☐ | 없으면 RPS 과대 산정 |
| 데이터 분포가 현실적인가? | ☐ | 단일 키 → 캐시 히트 100% |
| DB 데이터 규모가 충분한가? | ☐ | 적은 데이터 → 인덱스/플랜 문제 안 드러남 |
| 인증/세션이 포함되었는가? | ☐ | 미포함 → 인증 병목 놓침 |
| 파일 업로드/다운로드 포함? | ☐ | 대역폭/I/O 병목 놓침 |

---

## 4) 환경: 프로덕션과 비슷해야 의미가 있다

### 환경 동등성 체크리스트

| 요소 | 프로덕션 | 테스트 환경 | 차이 영향 |
| :--- | :--- | :--- | :--- |
| **서버 스펙** | 4 vCPU, 16GB | 2 vCPU, 8GB | CPU 병목 2배 빨리 도달 |
| **인스턴스 수** | 4대 (LB) | 1대 | 분산 효과 없음 |
| **DB 데이터** | 100만 행 | 1,000행 | 인덱스/플랜 완전히 다름 |
| **캐시** | Redis 3대 | 로컬 캐시 | 캐시 누락 패턴 다름 |
| **네트워크** | AZ 간 1ms | 로컬 0.1ms | 레이턴시 과소 평가 |
| **커넥션 풀** | max=50 | max=10 | 풀 고갈 시점 다름 |

```
⚠️ 환경 차이가 불가피할 때의 대응:

1. 차이를 문서에 명시: "테스트 환경은 프로덕션의 1/4 스펙"
2. 결과에 보정 계수를 적용하지 않음: 숫자는 그대로 보고
3. 대신 경향(trend)에 집중: "커넥션 풀이 먼저 포화됨 → 프로덕션도 동일 패턴"
4. 정기적으로 프로덕션 환경 테스트 (카나리아/쉐도우 트래픽)
```

---

## 5) 도구 비교와 선택

### 5-1) 주요 부하 테스트 도구 비교

| 도구 | 스크립트 언어 | 분산 실행 | 리소스 효율 | 학습 곡선 | 적합한 상황 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **k6** | JavaScript | ✅ (k6-operator) | ⭐⭐⭐⭐⭐ (Go) | 낮음 | API 테스트, CI 통합 |
| **JMeter** | XML/GUI | ✅ | ⭐⭐ (Java) | 중간 | 복잡한 프로토콜, 비개발자 |
| **Gatling** | Scala/Java | ✅ | ⭐⭐⭐⭐ (Akka) | 중간 | Java/Scala 팀 |
| **Locust** | Python | ✅ | ⭐⭐⭐ (gevent) | 낮음 | Python 팀, 빠른 프로토타입 |
| **Artillery** | YAML/JS | ✅ (Cloud) | ⭐⭐⭐ (Node) | 낮음 | 서버리스 테스트 |
| **wrk/hey** | CLI | ❌ | ⭐⭐⭐⭐⭐ | 매우 낮음 | 단순 벤치마크, 빠른 확인 |

### 5-2) k6 실전 예시: 전체 시나리오

```js
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// 커스텀 메트릭
const errorRate = new Rate('errors');
const orderDuration = new Trend('order_duration');

export const options = {
  // 단계별 부하 증가 (Load Test)
  stages: [
    { duration: '2m', target: 20 },   // 워밍업
    { duration: '5m', target: 50 },   // 정상 부하
    { duration: '3m', target: 100 },  // 피크 부하
    { duration: '2m', target: 0 },    // 쿨다운
  ],
  
  // SLO 기반 임계값
  thresholds: {
    http_req_failed: ['rate<0.01'],              // 에러율 < 1%
    http_req_duration: ['p(95)<200', 'p(99)<500'], // p95 < 200ms
    'http_req_duration{name:order_create}': ['p(95)<500'], // 주문 생성 별도 SLO
    errors: ['rate<0.05'],                        // 커스텀 에러율 < 5%
  },
};

const BASE_URL = __ENV.BASE_URL || 'https://api.example.com';

// 테스트 데이터 (실제로는 CSV/JSON 파일에서 로드)
const PRODUCT_IDS = [101, 102, 103, 204, 305, 406, 507, 608, 709, 810];

export default function () {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${__ENV.TOKEN}`,
  };
  
  // ── 시나리오 1: 상품 목록 조회 (50%) ──
  group('상품 목록 조회', () => {
    const res = http.get(`${BASE_URL}/api/products?page=1&size=20`, {
      headers,
      tags: { name: 'product_list' },
    });
    
    check(res, {
      'status is 200': (r) => r.status === 200,
      'has products': (r) => JSON.parse(r.body).content?.length > 0,
    }) || errorRate.add(1);
  });
  
  sleep(Math.random() * 3 + 2); // Think time: 2~5초
  
  // ── 시나리오 2: 상품 상세 조회 (30%) ──
  if (Math.random() < 0.6) {  // 60% 확률로 상세 조회 진행
    group('상품 상세 조회', () => {
      const productId = PRODUCT_IDS[Math.floor(Math.random() * PRODUCT_IDS.length)];
      const res = http.get(`${BASE_URL}/api/products/${productId}`, {
        headers,
        tags: { name: 'product_detail' },
      });
      
      check(res, {
        'status is 200': (r) => r.status === 200,
      }) || errorRate.add(1);
    });
    
    sleep(Math.random() * 5 + 5); // Think time: 5~10초
  }
  
  // ── 시나리오 3: 주문 생성 (5%) ──
  if (Math.random() < 0.1) {
    group('주문 생성', () => {
      const startTime = Date.now();
      
      const payload = JSON.stringify({
        productId: PRODUCT_IDS[Math.floor(Math.random() * PRODUCT_IDS.length)],
        quantity: Math.ceil(Math.random() * 3),
      });
      
      const res = http.post(`${BASE_URL}/api/orders`, payload, {
        headers,
        tags: { name: 'order_create' },
      });
      
      orderDuration.add(Date.now() - startTime);
      
      check(res, {
        'status is 201': (r) => r.status === 201,
        'has orderId': (r) => JSON.parse(r.body).orderId !== undefined,
      }) || errorRate.add(1);
    });
    
    sleep(Math.random() * 10 + 10); // 결제 후 대기: 10~20초
  }
}

// 테스트 시작 전 실행 (데이터 준비 등)
export function setup() {
  console.log(`Target: ${BASE_URL}`);
  // 사전 조건 확인
  const healthCheck = http.get(`${BASE_URL}/actuator/health`);
  if (healthCheck.status !== 200) {
    throw new Error('서버가 준비되지 않았습니다');
  }
}

// 테스트 종료 후 실행 (정리)
export function teardown(data) {
  console.log('테스트 완료. 결과를 확인하세요.');
}
```

### 5-3) k6 CI 통합 (GitHub Actions)

```yaml
# .github/workflows/load-test.yml
name: Load Test
on:
  schedule:
    - cron: '0 3 * * 1'  # 매주 월요일 새벽 3시
  workflow_dispatch:       # 수동 실행 가능

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install k6
        run: |
          sudo gpg -k
          sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
            --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D68
          echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | \
            sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update && sudo apt-get install k6
          
      - name: Run Load Test
        env:
          BASE_URL: ${{ secrets.STAGING_URL }}
          TOKEN: ${{ secrets.TEST_TOKEN }}
        run: k6 run --out json=results.json tests/load-test.js
        
      - name: Upload Results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: k6-results
          path: results.json
          
      - name: Check Thresholds
        if: failure()
        run: echo "⚠️ 부하 테스트 SLO 위반!" >> $GITHUB_STEP_SUMMARY
```

---

## 6) 측정: 부하 테스트는 '관측성 테스트'이기도 하다

### 6-1) 반드시 함께 봐야 하는 지표

테스트 동안 최소한 아래를 같이 봅니다.

| 계층 | 지표 | 도구 | 왜 필요한가 |
| :--- | :--- | :--- | :--- |
| **애플리케이션** | p95/p99, 에러율, 스레드 풀/큐 | Prometheus + Grafana | 서비스 성능 |
| **JVM** | GC pause, 힙 사용량, 할당률 | JMX, VisualVM | 메모리/GC 병목 |
| **DB** | 쿼리 시간, 슬로우 로그, 락 대기, 커넥션 수 | pg_stat_statements, slow_log | DB 병목 |
| **캐시** | hit ratio, latency, eviction | Redis INFO | 캐시 효율 |
| **인프라** | CPU/메모리/네트워크/디스크 | node_exporter | 리소스 포화 |
| **분산 트레이싱** | 느린 요청 경로 | Jaeger, Tempo | 근본 원인 파악 |

### 6-2) 워밍업 구간 처리

```
부하 테스트 초반 1~2분은 결과에서 제외해야 합니다.

이유:
1. JVM JIT 컴파일: 인터프리터 → 네이티브 코드 전환 (수십 ms → 수 ms)
2. 캐시 워밍업: 첫 요청은 모두 Cache Miss
3. 커넥션 풀 워밍업: lazy init이면 초반에 커넥션 생성 비용
4. 오토스케일: 반응 시간 30초~3분

k6에서의 처리:
  stages: [
    { duration: '2m', target: 20 },  // ← 워밍업 (결과 분석에서 제외)
    { duration: '5m', target: 50 },  // ← 실제 측정 구간
    ...
  ]
```

### 6-3) 결과 해석 패턴

```
패턴 1: 레이턴시가 서서히 올라감
  → 메모리 누수 또는 GC 빈도 증가
  → 확인: jvm_gc_pause_seconds, jvm_memory_used_bytes 추이

패턴 2: 특정 RPS에서 갑자기 에러 폭증
  → 리소스 포화 (커넥션 풀, 스레드 풀, DB 커넥션)
  → 확인: hikaricp_connections_active == hikaricp_connections_max

패턴 3: 레이턴시가 일정하다가 계단식으로 뜀
  → GC Full GC 발생 또는 오토스케일 전환점
  → 확인: jvm_gc_pause_seconds에서 Major GC 확인

패턴 4: RPS가 올라가도 처리량이 안 늘어남
  → 동기 병목 (락, 동기화, 외부 API 대기)
  → 확인: 스레드 덤프에서 BLOCKED/WAITING 스레드
```

---

## 7) 튜닝 루틴: 원인별로 접근하라

### 7-1) 병목 유형별 진단과 대응

| 병목 | 증상 | 진단 방법 | 대응 |
| :--- | :--- | :--- | :--- |
| **DB 쿼리** | p99만 느림, CPU 여유 | 슬로우 로그, EXPLAIN | 인덱스, 쿼리 최적화 |
| **커넥션 풀 고갈** | 갑자기 타임아웃 폭증 | HikariCP 메트릭 | 풀 크기 + 쿼리 시간 단축 |
| **CPU 포화** | p95/p99 동시 상승 | CPU 프로파일링 (async-profiler) | 핫 코드 최적화, 스케일아웃 |
| **GC 압박** | 간헐적 레이턴시 스파이크 | GC 로그, 할당률 | 객체 할당 줄이기, 힙 조정 |
| **스레드 블로킹** | 처리량 정체, CPU 여유 | 스레드 덤프 (jstack) | 비동기화, 타임아웃 설정 |
| **외부 API 지연** | 특정 요청만 느림 | 분산 트레이스 | 타임아웃, 서킷브레이커, 캐시 |
| **네트워크 대역폭** | 대용량 응답 시 느림 | 네트워크 I/O 모니터링 | 압축, 페이징, CDN |

### 7-2) 커넥션 풀 사이징 공식

```
풀 크기만 무작정 키우면 안 됩니다. 근거가 있어야 합니다.

기본 공식 (PostgreSQL 가이드):
  pool_size = (core_count * 2) + effective_spindle_count
  
  예: 4 vCPU 서버 → pool_size = (4 * 2) + 1 = 9~10

실무 조정:
  1. 평균 쿼리 시간이 길면 (> 100ms) → 풀 약간 키움
  2. 외부 API 호출이 많으면 → 별도 스레드 풀로 분리
  3. 절대 DB max_connections보다 크면 안 됨
  
  인스턴스 4대 × pool_size 10 = 총 40 커넥션
  DB max_connections = 100 → 나머지 60은 배치/모니터링/마이그레이션용 여유
```

### 7-3) 튜닝 원칙: 한 번에 하나만

```
튜닝 루프:

1. 측정 (Baseline): 현재 성능 기록
2. 가설: "슬로우 쿼리가 p99를 올리고 있다"
3. 변경: 인덱스 하나 추가 (한 가지만!)
4. 재측정: 같은 시나리오, 같은 환경
5. 비교: p99가 내려갔는가?
6. 반복

⚠️ 흔한 실수:
  - 인덱스 추가 + 풀 크기 변경 + GC 옵션 변경을 동시에
  → 뭐가 효과가 있었는지 알 수 없음
  → 오히려 성능이 나빠져도 어디를 되돌려야 할지 모름
```

---

## 8) 부하 테스트 흔한 함정 TOP 10

| # | 함정 | 증상 | 해결 |
| :--- | :--- | :--- | :--- |
| 1 | 워밍업 없이 측정 | 초반 레이턴시가 비현실적으로 높음 | 2~3분 워밍업 후 측정 |
| 2 | 테스트 클라이언트가 병목 | RPS가 올라가지 않음 | 분산 실행 또는 서버 스펙 확인 |
| 3 | Think Time 없음 | 비현실적으로 높은 RPS | 실제 사용자 패턴 반영 |
| 4 | 캐시 히트 100% | 프로덕션보다 훨씬 빠른 결과 | 다양한 키로 분산 |
| 5 | DB 데이터 부족 | 인덱스 스캔이 풀 스캔으로 안 바뀜 | 프로덕션 규모 데이터 |
| 6 | SSL/TLS 미반영 | 실제보다 빠른 결과 | HTTPS로 테스트 |
| 7 | 단일 엔드포인트만 테스트 | 특정 API만 최적화 | Traffic Mix 반영 |
| 8 | 결과를 안 남김 | 이전 대비 비교 불가 | 매번 리포트 저장 |
| 9 | 프로덕션 데이터로 테스트 | 개인정보 유출 위험 | 마스킹/합성 데이터 |
| 10 | 한 번만 실행 | 우연한 결과에 의존 | 최소 3회 반복, 편차 확인 |

---

## 9) 결과를 남겨라 (다음 테스트를 위해)

부하 테스트는 한 번으로 끝나지 않습니다. 테스트 리포트 템플릿:

```markdown
# 부하 테스트 리포트

## 개요
- 날짜: 2026-03-23
- 대상: 주문 서비스 v2.1.0
- 테스트 종류: Load Test (피크 100 VU)
- 환경: staging (프로덕션의 1/2 스펙)

## SLO 결과
| 지표 | SLO | 결과 | 판정 |
|------|-----|------|------|
| GET /orders p95 | < 200ms | 185ms | ✅ PASS |
| POST /orders p95 | < 500ms | 620ms | ❌ FAIL |
| 에러율 | < 0.1% | 0.05% | ✅ PASS |

## 병목 분석
- POST /orders가 SLO 초과: HikariCP 커넥션 풀 고갈 확인
- 원인: 재고 확인 쿼리가 테이블 락을 잡고 평균 200ms

## 개선 계획
1. 재고 확인 쿼리에 SELECT FOR UPDATE SKIP LOCKED 적용
2. 커넥션 풀 10 → 15로 증가 (DB max 100, 현재 총 40)
3. 개선 후 동일 시나리오로 재테스트

## 환경 상세
- 인스턴스: 2 vCPU, 4GB × 2대
- DB: PostgreSQL 16, 데이터 50만 행
- 캐시: Redis 7, 1GB
```

---

## 10) 용량 계획 (Capacity Planning)

부하 테스트 결과를 바탕으로 용량을 계획합니다.

### Little's Law 기반 계산

```
동시 사용자 = 도착률(RPS) × 평균 체류 시간(초)

예: 100 RPS, 평균 응답 200ms
  → 동시 요청 = 100 × 0.2 = 20

스레드 풀이 20개면 이론상 커버.
실무에서는 2~3배 여유: 40~60개
```

### 피크 트래픽 예측

```
평상시 트래픽: 100 RPS
피크 배율: ×5 (이벤트/프로모션)
안전 마진: ×1.5

필요 용량 = 100 × 5 × 1.5 = 750 RPS

현재 서버 1대 한계 = 300 RPS (Stress Test 결과)
→ 최소 3대 필요 (LB behind)
→ 오토스케일: min=3, max=6, target CPU=70%
```

---

## 운영 체크리스트

### 테스트 전

- [ ] SLO(p95/에러율/처리량)가 정의되어 있는가?
- [ ] 시나리오에 Think Time과 Traffic Mix가 반영되었는가?
- [ ] 테스트 환경과 프로덕션 차이가 문서화되었는가?
- [ ] DB에 충분한 데이터(프로덕션 규모)가 있는가?
- [ ] 모니터링(Prometheus, 슬로우 로그, GC 로그)이 켜져 있는가?

### 테스트 중

- [ ] 워밍업 구간(2~3분)을 결과에서 제외하는가?
- [ ] 테스트 클라이언트가 병목이 아닌지 확인했는가?
- [ ] 레이턴시/에러율/리소스를 실시간으로 관찰하고 있는가?

### 테스트 후

- [ ] 결과 리포트를 작성하고 저장했는가?
- [ ] SLO 위반 항목의 병목 원인을 파악했는가?
- [ ] 개선 후 동일 시나리오로 재테스트 계획이 있는가?
- [ ] 용량 계획에 결과를 반영했는가?

---

## 관련 글

- [APM 기본](/learning/deep-dive/deep-dive-apm-basics/) — 모니터링 지표, Golden Signals
- [Prometheus & Grafana](/learning/deep-dive/deep-dive-prometheus-grafana/) — 메트릭 수집과 대시보드
- [SLO/SLI/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/) — 서비스 수준 목표 설계
- [커넥션 풀 관리](/learning/deep-dive/deep-dive-connection-pool/) — HikariCP 사이징과 모니터링
- [GC 튜닝 실전](/learning/deep-dive/deep-dive-gc-tuning-practical/) — GC 병목 진단과 튜닝
- [Tail Latency Engineering](/learning/deep-dive/deep-dive-tail-latency-engineering-playbook/) — p99 최적화 전략
- [서킷브레이커](/learning/deep-dive/deep-dive-resilience4j-circuit-breaker/) — 외부 의존성 장애 격리
- [Serverless 내부](/learning/deep-dive/deep-dive-serverless-internals/) — 서버리스 부하 특성

---

## 연습(추천)

1. **기본**: 핵심 API 3개를 골라 "요청 비율/데이터 분포/캐시 히트율 가정"을 문서로 만들고 k6 스크립트를 작성해보기
2. **중급**: p95/p99가 튀는 구간에서 스레드 덤프/GC 로그/슬로우 로그로 원인을 좁혀보는 연습해보기
3. **고급**: 개선을 하나만 적용(예: 인덱스 추가)한 뒤 같은 시나리오로 재테스트해 "정말 좋아졌는지" A/B 비교해보기
4. **CI 통합**: GitHub Actions에 부하 테스트를 주 1회 스케줄로 등록하고, SLO 위반 시 Slack 알림 설정
