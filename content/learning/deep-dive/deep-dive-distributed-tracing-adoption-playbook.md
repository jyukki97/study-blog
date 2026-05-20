---
title: "분산 트레이싱 도입 플레이북: p95 지연 원인을 서비스 경계별로 추적하는 법"
date: 2026-04-24
draft: false
topic: "Backend Architecture"
tags: ["Distributed Tracing", "OpenTelemetry", "Latency", "Observability", "Backend Operations"]
categories: ["Backend Deep Dive"]
description: "로그와 메트릭만으로 놓치기 쉬운 지연 전파를 분산 트레이싱으로 추적하는 도입 기준과 운영 체크포인트를 정리합니다."
module: "backend-observability"
study_order: 1168
---

장애 회고를 하다 보면 비슷한 문장이 반복됩니다. "DB는 괜찮았고 CPU도 안 찼는데, 왜 API 응답이 1.8초까지 튀었지?" 로그는 이벤트를 잘 남기고, 메트릭은 평균과 비율을 잘 보여주지만, **하나의 사용자 요청이 서비스 경계를 몇 번 넘었고 어디에서 기다렸는지**까지는 바로 답해주지 못하는 경우가 많습니다. 특히 BFF, 인증, 캐시, 결제, 검색처럼 호출 체인이 3홉 이상으로 늘어나면 병목은 단일 컴포넌트보다 **경계 사이의 전파 지연**에서 자주 생깁니다.

그래서 분산 트레이싱은 "관측 도구 하나 더 추가"가 아니라, **지연 원인을 요청 단위로 복원하는 장치**에 가깝습니다. 저는 팀이 [Observability Baseline](/learning/deep-dive/deep-dive-observability-baseline/)과 [구조적 로그](/learning/deep-dive/deep-dive-structured-logging/)까지는 갖췄는데도 p95 원인 분석에 15분 이상 걸린다면, 그다음 우선순위는 트레이싱이라고 보는 편이 맞다고 생각합니다.

## 이 글에서 얻는 것

- 분산 트레이싱이 언제 "있으면 좋은 것"을 넘어 "없으면 느린 것"이 되는지 판단할 수 있습니다.
- span, trace, sampling을 도구 이름이 아니라 운영 기준으로 이해할 수 있습니다.
- OpenTelemetry 기준으로 작게 시작해도 효과를 보는 도입 순서와 숫자 기준을 가져갈 수 있습니다.
- 로그, 메트릭, 트레이스를 어떻게 역할 분리해야 과투자를 줄일 수 있는지 정리할 수 있습니다.

## 핵심 개념/이슈

### 1) 분산 트레이싱의 본체는 "요청 경로 복원"이다

메트릭은 "어디가 느린가"를 알려주고, 로그는 "무슨 일이 있었는가"를 보여줍니다. 하지만 사용자가 보낸 한 요청이 `api -> auth -> product -> cache -> db`를 거치는 동안 **어느 홉에서 대기했고 어느 홉은 빨랐는지**를 연결해서 보려면 trace가 필요합니다.

실무에서 도입을 검토할 조건은 보통 이 정도면 충분합니다.

- 크리티컬 요청 경로가 **3개 이상 서비스/스토어**를 지난다.
- p95 지연이 목표보다 **30% 이상 자주 초과**한다.
- 장애 분석 때 로그를 서비스별로 붙여 읽는 시간이 **15분 이상** 걸린다.
- [API Composition/Aggregation](/learning/deep-dive/deep-dive-api-composition-aggregation-playbook/) 같은 fan-out 경로에서 "어느 다운스트림이 꼬리 지연을 만들었는지" 바로 안 보인다.

이 중 2개 이상이면 트레이싱 ROI가 빠르게 나오는 편입니다.

### 2) span을 많이 찍는 것보다 "경계"를 잘 찍는 것이 중요하다

초기 도입 팀이 자주 하는 실수는 내부 함수 호출까지 전부 span으로 쪼개는 것입니다. 그러면 비용은 늘고, 화면은 복잡해지고, 정작 중요한 경계가 흐려집니다. 초기에는 아래 4곳만 잡아도 충분합니다.

1. **HTTP/gRPC 진입점**: root span
2. **외부 호출 경계**: downstream HTTP/gRPC, 메시지 발행/소비
3. **스토리지 경계**: DB, Redis, 검색엔진
4. **대기 구간**: 큐, thread pool, 비동기 작업 handoff

핵심은 코드 라인 추적이 아니라 **대기와 네트워크가 발생하는 경계**를 남기는 것입니다. 이 구조가 잡혀야 [SLO/SLI/Error Budget](/learning/deep-dive/deep-dive-slo-sli-error-budget/)에서 말하는 사용자 지연 목표와 실제 병목을 연결할 수 있습니다.

### 3) 샘플링은 비용 절감 옵션이 아니라 운영 정책이다

모든 요청을 100% 수집하면 좋을 것 같지만, 대부분의 팀은 저장 비용과 조회 비용 때문에 오래 못 갑니다. 그래서 샘플링은 일찍 정책화하는 편이 낫습니다.

권장 시작점은 아래 정도입니다.

- 정상 요청 기본 샘플링: **1~5%**
- 5xx 응답: **100%**
- p95 초과 슬로우 요청: **20~100%**
- 신규 배포 30분: 평시의 **2배 샘플링**

중요한 건 "전체를 균등하게 줄이는 것"보다 **에러와 슬로우 패스를 더 진하게 남기는 것**입니다. 배포 직후나 특정 테넌트 이슈를 볼 때는 일시적으로 샘플링을 올리고, 안정 구간에서는 다시 내리는 식이 현실적입니다. 이건 [부하 테스트 전략](/learning/deep-dive/deep-dive-load-testing-strategy/)과 같이 봐야 의미가 있습니다. 테스트 단계에서 느린 경로 후보를 미리 알아야 샘플링도 똑똑하게 걸 수 있기 때문입니다.

### 4) 속성(attribute)은 많이 넣는 것보다 "카디널리티 예산"을 지키는 것이 중요하다

`user_id`, `email`, raw URL, 검색어 전문 같은 고카디널리티 값을 무심코 넣으면 저장소와 쿼리 비용이 급증합니다. 개인정보 리스크도 커집니다. 실무에서는 아래 우선순위가 안전합니다.

- 1순위: `service.name`, `endpoint`, `http.method`, `status_code`, `db.system`
- 2순위: `tenant_tier`, `region`, `feature_flag`, `retry_count`
- 3순위: 필요 시 해시/버킷 처리한 식별자
- 금지에 가깝게 볼 것: email, raw token, full SQL, free-text input

저는 trace attribute도 로그 필드처럼 **예산이 있는 자원**으로 다뤄야 한다고 봅니다. root span 누락보다 더 흔한 장애가, 쓸모없는 필드 과다 주입으로 인한 비용 폭증입니다.

## 실무 적용

### 1) 4주 도입 순서

**1주차, 경로 선택**  
가입/주문/검색처럼 사용자 영향이 큰 상위 3개 요청 경로만 고릅니다. 전체 시스템 동시 도입은 거의 항상 과합니다.

**2주차, 자동 계측 + 루트 연결**  
OpenTelemetry 자동 계측으로 HTTP, DB, Redis 경계부터 붙이고, 서비스 간 trace context 전파가 끊기지 않는지 확인합니다.

**3주차, 샘플링/필드 정책 고정**  
기본 샘플링, 에러 우선 수집, 금지 attribute 목록을 문서화합니다. 이 단계 없이 운영에 들어가면 비용이 새기 쉽습니다.

**4주차, 대시보드와 알람 연결**  
`trace coverage`, `root span missing rate`, `slow trace top path`, `error trace exemplar`를 [알람 설계](/learning/deep-dive/deep-dive-observability-alarms/)와 연결합니다.

### 2) 의사결정 기준(숫자·조건·우선순위)

초기 2주 운영에서는 아래 순서를 권장합니다.

- **1순위, coverage**: 크리티컬 경로의 trace 연결률 **80% 이상**
- **2순위, 품질**: root span 누락률 **2% 이하**
- **3순위, 비용**: span drop rate **1% 이하**, 저장 비용은 관측 예산의 **20~25% 이내**
- **4순위, 효용**: 슬로우 요청 분석 평균 시간이 기존 대비 **50% 이상 단축**

만약 수집량은 많은데 분석 시간이 줄지 않는다면, 계측 부족이 아니라 **span 이름/속성 체계가 나쁜 경우**가 많습니다. 이때는 span 개수를 더 늘리기보다 naming과 경계 정의를 먼저 정리해야 합니다.

### 3) 어떤 팀은 아직 안 해도 된다

다음 조건이면 트레이싱보다 다른 투자가 먼저일 수 있습니다.

- 단일 애플리케이션이고 외부 호출이 거의 없다.
- p95 병목이 이미 DB 단일 쿼리로 명확하다.
- 로그 상관관계 ID와 메트릭만으로 대부분 10분 안에 원인 분석이 끝난다.
- 아직 [관측 기본선](/learning/deep-dive/deep-dive-observability-baseline/)과 구조적 로그가 없다.

이 경우 트레이싱은 정답이 아니라 과속일 수 있습니다. 기본 로그/메트릭이 약한 상태에서 트레이싱부터 올리면 "비싼 로그"로 끝나는 경우가 꽤 많습니다.

## 트레이드오프/주의점

첫째, 전 구간 100% 수집은 대부분 오래 못 갑니다. 샘플링과 보존기간을 함께 설계해야 합니다.  
둘째, span을 함수 단위로 과도하게 쪼개면 병목은 더 안 보이고 노이즈만 늘어납니다.  
셋째, 고카디널리티 속성과 개인정보는 추적 가치보다 운영 비용과 리스크가 더 큽니다.  
넷째, 트레이싱만으로 문제를 해결할 수는 없습니다. 느린 쿼리 자체를 고치는 일은 여전히 인덱스, 쿼리 플랜, 락 분석의 영역입니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 크리티컬 요청 경로 3개를 골라 trace coverage를 측정했다.
- [ ] 서비스 간 trace context 전파가 끊기는 지점을 확인했다.
- [ ] 기본 샘플링, 에러 샘플링, 슬로우 요청 샘플링 기준을 숫자로 정했다.
- [ ] 금지 attribute 목록과 PII 마스킹 규칙을 정했다.
- [ ] 슬로우 요청 분석 시간 단축을 도입 성공 기준으로 잡았다.

### 연습 과제

1. 검색 API 1개를 골라 root span, 캐시 span, DB span만 붙인 뒤 병목 분석 시간이 얼마나 줄었는지 기록해 보세요.  
2. fan-out 호출이 있는 API에서 가장 느린 downstream이 p95에 미치는 비중을 trace로 계산해 보세요.  
3. 기본 샘플링 1%와 슬로우 요청 100% 샘플링을 함께 적용했을 때 저장 비용과 분석 효용이 어떻게 달라지는지 비교해 보세요.

## 관련 글

- [Observability Baseline](/learning/deep-dive/deep-dive-observability-baseline/)
- [구조적 로그 설계](/learning/deep-dive/deep-dive-structured-logging/)
- [SLO/SLI/Error Budget 실전](/learning/deep-dive/deep-dive-slo-sli-error-budget/)
- [API Composition/Aggregation 플레이북](/learning/deep-dive/deep-dive-api-composition-aggregation-playbook/)
- [부하 테스트 전략](/learning/deep-dive/deep-dive-load-testing-strategy/)
