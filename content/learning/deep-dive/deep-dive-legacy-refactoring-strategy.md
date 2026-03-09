---
title: "레거시 리팩터링 전략"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["Legacy", "Refactoring", "Strangler", "Tech Debt"]
categories: ["Backend Deep Dive"]
description: "대규모 레거시 개선을 위한 우선순위, 단계별 접근, 위험 관리"
module: "architecture"
study_order: 450
---

## 이 글에서 얻는 것

- 레거시를 "갈아엎기"가 아니라 **리스크를 통제하며 개선하는 작업**으로 바라보는 관점을 얻습니다.
- 우선순위를 비즈니스 임팩트/위험/빈도 기준으로 잡고, 작은 배포 단위로 쪼개는 전략을 설계할 수 있습니다.
- Strangler, Branch by Abstraction, Characterization Test 같은 실무 패턴을 어떤 상황에 쓰는지 감각이 생깁니다.

## 0) 레거시란 '나쁜 코드'가 아니라 '바꾸기 어려운 코드'다

레거시는 보통 이렇게 정의하는 편이 실무적입니다.

- 테스트가 부족하고
- 의존성이 얽혀 있고
- 변경하면 어디가 깨질지 예측이 어렵다

즉 "품질"보다 "변경 비용"이 문제입니다.
그래서 레거시 개선의 핵심은 항상 **안전망 → 점진 변경**입니다.

### 레거시 판별 체크리스트

| 신호 | 심각도 | 측정 방법 |
|------|--------|-----------|
| 테스트 커버리지 < 20% | 🔴 높음 | `jacoco` 리포트 |
| 한 클래스가 1,000줄 이상 | 🟡 중간 | 코드 메트릭 도구 |
| 변경 시 연쇄 장애 발생 이력 | 🔴 높음 | 온콜 로그/포스트모템 |
| 원작자 퇴사 + 문서 부재 | 🟡 중간 | git blame + 팀 히스토리 |
| 외부 의존성 EOL/보안패치 중단 | 🔴 높음 | dependency-check |
| 배포 주기 > 2주 (이 모듈 때문에) | 🟡 중간 | 배포 기록 |

## 1) 우선순위 잡는 법(현실적인 기준)

모든 걸 고칠 수는 없으니, 다음 기준으로 고르면 실패 확률이 줄어듭니다.

### 우선순위 매트릭스

```
            비즈니스 임팩트 높음
                    │
         Q2         │         Q1
    (전략적 부채)     │    (지금 당장!)
    ─ 장기 플랜 수립   │    ─ 즉시 착수
    ─ 아키텍처 로드맵   │    ─ 안전망 + 점진 개선
                    │
  ──────────────────┼──────────────────
                    │
         Q4         │         Q3
    (무시해도 됨)     │    (기회 비용 고려)
    ─ 건드리지 않기    │    ─ 자주 건드릴 때만
    ─ 에너지 낭비     │    ─ Boy Scout Rule
                    │
            변경 빈도/장애 빈도 높음
```

**"핫 패스 + 자주 깨지는 곳"이 Q1이고, 여기부터 시작합니다.**

구체적 측정 기준:

| 기준 | 측정 방법 | 가중치 |
|------|-----------|--------|
| 사용자/비즈니스 임팩트 | 매출 기여도, 핵심 플로우 여부 | ★★★ |
| 장애/온콜 빈도 | 최근 6개월 인시던트 수 | ★★★ |
| 변경 빈도 | `git log --since=6months --format=oneline <path> \| wc -l` | ★★ |
| 성능 병목 | APM P99 latency, DB slow query 수 | ★★ |
| 보안 리스크 | CVE 미패치 수, EOL 라이브러리 | ★★★ |

## 2) 안전망 만들기: 테스트만이 전부는 아니다

레거시에서 가장 먼저 해야 할 건 "안전망"입니다.

### 2-1) Characterization Test (현재 동작 고정)

현재 동작을 "옳든 그르든" 그대로 기록합니다. 목적은 리팩터링 중 회귀를 감지하는 것입니다.

```java
// 레거시 주문 금액 계산 — 로직이 복잡하고 문서가 없음
// Characterization test: 현재 동작을 스냅샷으로 고정
@Test
void 기존_할인_로직_동작_고정() {
    LegacyOrderCalculator calc = new LegacyOrderCalculator();

    // 현재 동작 그대로 기록 (맞든 틀리든)
    assertThat(calc.calculate(1000, "VIP", 3))
        .isEqualTo(2550);  // 1000 * 3 * 0.85 = 2550

    assertThat(calc.calculate(500, "NORMAL", 1))
        .isEqualTo(500);   // 할인 없음

    assertThat(calc.calculate(1000, "VIP", 0))
        .isEqualTo(0);     // 수량 0일 때 동작 확인

    // 엣지 케이스: 음수 수량 — 현재 동작이 무엇인지 기록
    assertThat(calc.calculate(1000, "VIP", -1))
        .isEqualTo(-850);  // 버그일 수 있지만, 지금은 고정만
}
```

### 2-2) Golden Master (입력/출력 스냅샷)

배치/리포트처럼 복잡한 출력이 있는 경우, 전체 출력을 파일로 저장해두고 비교합니다.

```java
@Test
void 월간_리포트_출력_Golden_Master() {
    ReportGenerator generator = new ReportGenerator();
    String actual = generator.generate(testData);

    // 최초 실행: 결과를 golden master로 저장
    // 이후 실행: 저장된 결과와 비교
    assertThat(actual).isEqualToNormalizingNewlines(
        Files.readString(Path.of("src/test/resources/golden/monthly-report.txt"))
    );
}
```

### 2-3) 관측성 우선 강화

테스트가 당장 어렵다면, 관측성을 먼저 강화하는 것도 좋은 첫 단계입니다.

```java
// 레거시 메서드에 관측성 추가 (로직 변경 없이)
public OrderResult processOrder(OrderRequest request) {
    Timer.Sample sample = Timer.start(meterRegistry);
    try {
        OrderResult result = legacyProcessOrder(request);
        sample.stop(Timer.builder("legacy.order.process")
            .tag("status", "success")
            .register(meterRegistry));
        return result;
    } catch (Exception e) {
        sample.stop(Timer.builder("legacy.order.process")
            .tag("status", "error")
            .tag("error_type", e.getClass().getSimpleName())
            .register(meterRegistry));
        throw e;
    }
}
```

### 안전망 단계별 적용 순서

```
1단계: 관측성 (로그/메트릭/트레이스)
   ↓   "어디서 무엇이 깨지는지" 빨리 파악
2단계: Characterization test
   ↓   핫 패스의 현재 동작을 고정
3단계: Golden master
   ↓   배치/리포트 등 복잡한 출력 고정
4단계: 통합/E2E 테스트
       외부 의존성 포함 전체 플로우 검증
```

## 3) 점진 개선 패턴(자주 쓰는 것들)

### 3-1) Strangler Fig Pattern(점진 대체)

새 코드를 옆에 붙이고, 트래픽/기능을 조금씩 새 코드로 옮깁니다.

```
[클라이언트]
     │
     ▼
[라우터/프록시] ──── 비율 제어 (10% → 50% → 100%)
     │         │
     ▼         ▼
  [새 서비스]  [레거시]
     │         │
     ▼         ▼
  [새 DB]    [레거시 DB] ← 동기화 (초기 단계)
```

**적합한 경우:**
- 외부 API/UI가 있어서 라우팅이 가능한 경우
- 모듈 경계가 비교적 명확한 경우
- 점진적 트래픽 이관이 가능한 경우

```java
// Spring에서 피처 플래그 기반 Strangler 구현
@Service
public class OrderRouter {
    private final LegacyOrderService legacy;
    private final NewOrderService newService;
    private final FeatureFlagService flags;

    public OrderResult processOrder(OrderRequest request) {
        if (flags.isEnabled("new-order-service", request.getUserId())) {
            try {
                OrderResult result = newService.process(request);
                // Shadow 검증: 레거시 결과와 비교 (초기 단계)
                if (flags.isEnabled("shadow-verify")) {
                    OrderResult legacyResult = legacy.process(request);
                    if (!result.equals(legacyResult)) {
                        log.warn("결과 불일치: new={}, legacy={}",
                            result, legacyResult);
                        // 메트릭으로 불일치율 추적
                        meterRegistry.counter("strangler.mismatch").increment();
                    }
                }
                return result;
            } catch (Exception e) {
                log.error("새 서비스 실패, 레거시 폴백", e);
                return legacy.process(request); // 폴백
            }
        }
        return legacy.process(request);
    }
}
```

### 3-2) Branch by Abstraction

추상화(인터페이스)를 먼저 만들고, 구현을 교체합니다.

```java
// Step 1: 인터페이스 추출 (기존 코드 변경 최소화)
public interface PaymentGateway {
    PaymentResult charge(PaymentRequest request);
    PaymentResult refund(String transactionId, BigDecimal amount);
}

// Step 2: 레거시 구현을 인터페이스로 감싸기
@Component
@Profile("legacy")
public class LegacyPaymentGateway implements PaymentGateway {
    private final OldPaymentModule oldModule; // 기존 코드

    @Override
    public PaymentResult charge(PaymentRequest request) {
        // 레거시 호출을 새 인터페이스에 맞게 어댑팅
        OldPaymentResponse response = oldModule.doPayment(
            request.getAmount().intValue(),
            request.getCardNumber()
        );
        return PaymentResult.from(response);
    }
}

// Step 3: 새 구현 (나중에 교체)
@Component
@Profile("new")
public class StripePaymentGateway implements PaymentGateway {
    @Override
    public PaymentResult charge(PaymentRequest request) {
        // 새로운 Stripe API 사용
        return stripeClient.charge(request);
    }
}
```

### 3-3) Seams(틈 만들기)

테스트/교체가 가능하도록 경계를 만들고(의존성 주입, 어댑터), 그 안쪽을 점진적으로 정리합니다.

```java
// Before: 직접 의존 — 테스트/교체 불가능
public class ReportService {
    public Report generate() {
        Connection conn = DriverManager.getConnection(DB_URL); // 하드코딩
        SmtpClient smtp = new SmtpClient("mail.company.com");  // 하드코딩
        // ...
    }
}

// After: Seam 생성 — 의존성을 주입 가능하게
public class ReportService {
    private final DataSource dataSource;     // Seam
    private final MailSender mailSender;     // Seam

    public ReportService(DataSource ds, MailSender ms) {
        this.dataSource = ds;
        this.mailSender = ms;
    }
    // 이제 테스트에서 Mock 주입 가능
}
```

### 패턴 선택 가이드

| 상황 | 추천 패턴 | 이유 |
|------|-----------|------|
| 외부 접점(API/UI)이 있고 라우팅 가능 | Strangler | 트래픽 비율 제어로 리스크 최소화 |
| 내부 모듈/라이브러리 교체 | Branch by Abstraction | 인터페이스로 구현 분리 |
| 테스트 불가능한 God Class | Seams | 의존성 경계 먼저 생성 |
| DB 스키마 변경 필요 | Expand/Contract | 무중단 마이그레이션 |

## 4) 큰 변경을 작은 배포로 쪼개는 기술

레거시 개선이 실패하는 가장 흔한 이유는 "너무 큰 PR/너무 긴 브랜치"입니다.

### 피처 플래그로 배포와 릴리스 분리

```java
// 코드는 배포되었지만, 기능은 꺼진 상태
@Service
public class SearchService {
    @Autowired private FeatureFlagService flags;

    public SearchResult search(String query) {
        if (flags.isEnabled("elasticsearch-migration")) {
            return elasticSearch(query);  // 새 구현
        }
        return legacyDbSearch(query);     // 기존 구현
    }
}
```

### DB 변경: Expand/Contract

```sql
-- Phase 1: Expand (기존 호환 유지)
ALTER TABLE users ADD COLUMN email_new VARCHAR(320);

-- 배포: 새 컬럼에 쓰기 시작 (읽기는 여전히 old)
-- 백필: UPDATE users SET email_new = email WHERE email_new IS NULL;
-- 검증: 새 컬럼 데이터 정합성 확인

-- Phase 2: Contract (충분한 검증 후)
ALTER TABLE users DROP COLUMN email;
ALTER TABLE users RENAME COLUMN email_new TO email;
```

### 리팩터링 PR 쪼개기 원칙

```
1. 동작 변경 없는 구조 개선 (rename, extract method) → PR #1
2. 인터페이스 추출 / Seam 생성                      → PR #2
3. 새 구현 추가 (피처 플래그로 비활성)                → PR #3
4. 피처 플래그 ON + 모니터링                         → PR #4
5. 레거시 코드 제거                                  → PR #5
```

**원칙: 각 PR은 독립적으로 롤백 가능해야 합니다.**

## 5) 흔한 함정과 대응

| 함정 | 왜 위험한가 | 대응 |
|------|-------------|------|
| 전면 재작성 ("v2") | 기존 엣지 케이스/도메인 지식 소실, 완료까지 비즈니스 가치 0 | Strangler로 점진 대체 |
| 테스트 없이 리팩터링 | 회귀 감지 불가, "고쳤는데 다른 게 깨짐" | Characterization test 먼저 |
| 운영 지표 없이 개선 | "좋아진 건지" 판단 불가 | Before/After 메트릭 기준 수립 |
| 한 번에 큰 PR | 리뷰 불가, 롤백 불가, 머지 충돌 | 5개 이하 파일 변경/PR |
| 기술 부채를 별도 스프린트로 분리 | 영원히 안 됨 | 기능 작업에 20% Rule로 편입 |

### 성공 지표 설정

리팩터링 "전"에 아래를 기록해두면, 나중에 효과를 증명할 수 있습니다.

```markdown
## 리팩터링 Before/After 기록
- [ ] 해당 모듈 P99 latency: ___ms → 목표 ___ms
- [ ] 월간 인시던트 수: ___건 → 목표 ___건
- [ ] 테스트 커버리지: __% → 목표 __%
- [ ] 평균 PR 리드타임(이 모듈): ___일 → 목표 ___일
- [ ] 변경 시 장애 발생률: __% → 목표 __%
```

## 6) 실전 체크리스트: 레거시 개선 킥오프

```markdown
## 착수 전 점검
- [ ] 대상 모듈의 비즈니스 임팩트/장애 빈도/변경 빈도 측정
- [ ] 이해관계자(PM/팀)와 우선순위 합의
- [ ] Before 지표 기록 (latency, error rate, coverage)
- [ ] 안전망 수준 결정 (관측성만? Characterization test까지?)

## 실행 중 점검
- [ ] PR 크기: 파일 5개 이하, 리뷰 30분 이내
- [ ] 각 PR은 독립 롤백 가능
- [ ] 피처 플래그/Shadow 검증 활용
- [ ] 주간 회고에서 불일치율/장애 리뷰

## 완료 후 점검
- [ ] After 지표 기록 및 Before와 비교
- [ ] 레거시 코드/피처 플래그 정리 (기술 부채 잔존 방지)
- [ ] 학습 내용 ADR/위키에 기록
```

## 연습(추천)

- 레거시 코드에서 "가장 자주 장애가 나는 경로"를 하나 골라, Characterization test 5개로 동작을 고정해보기
- Branch by Abstraction을 적용해, 큰 의존성(외부 API/스토리지)을 인터페이스 뒤로 숨긴 뒤 구현을 교체해보기
- 피처 플래그를 도입해 "코드는 배포됐지만 기능은 꺼진 상태"로 배포해보고, 안전한 릴리스 루프를 경험해보기
- Strangler Pattern으로 검색 API를 DB 직접 조회 → Elasticsearch로 이관하는 시나리오를 설계하고, Shadow 검증 로직을 구현해보기

---

## 관련 심화 학습

- [모놀리스에서 모듈러로](/learning/deep-dive/deep-dive-monolith-to-modular/) — 점진적 분해 전략의 구체적 사례
- [헥사고날 아키텍처](/learning/deep-dive/deep-dive-hexagonal-architecture/) — 리팩터링 목표 아키텍처 패턴
- [TDD & JUnit/Mockito](/learning/deep-dive/deep-dive-tdd-junit-mockito/) — Characterization test 작성 실전
- [데이터베이스 마이그레이션](/learning/deep-dive/deep-dive-database-migration/) — 레거시 DB 스키마 점진 변경
- [피처 플래그와 배포 전략](/learning/deep-dive/deep-dive-online-ddl-expand-contract/) — Expand/Contract 패턴
- [관측성 기초](/learning/deep-dive/deep-dive-observability-baseline/) — 안전망으로서의 관측성 구축
