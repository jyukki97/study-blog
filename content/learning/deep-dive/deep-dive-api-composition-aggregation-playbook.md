---
title: "백엔드 커리큘럼 심화: API Composition과 Aggregation Gateway 실무 설계"
date: 2026-04-23
draft: false
topic: "Architecture"
tags: ["API Composition", "Aggregation Gateway", "BFF", "Fan-out", "Partial Failure", "Backend Architecture"]
categories: ["Backend Deep Dive"]
description: "여러 다운스트림을 한 요청에 묶는 API Composition을 설계할 때 fan-out, timeout budget, partial failure, 캐시, ownership을 숫자 기준으로 정리합니다."
module: "backend-api-architecture"
study_order: 1179
---

모놀리식 API를 서비스 단위로 나누고 나면, 프런트엔드는 종종 더 불편해집니다. 화면 하나를 그리려면 사용자, 주문, 추천, 재고, 포인트 API를 각각 호출해야 하고, 네트워크가 조금만 흔들려도 로딩 순서와 에러 처리가 복잡해집니다. 그래서 많은 팀이 어느 시점에 **API Composition**을 도입합니다. 여러 다운스트림 응답을 서버 쪽에서 조합해, 클라이언트가 한 번의 호출로 필요한 데이터를 받게 만드는 방식입니다.

문제는 여기서부터입니다. Composition은 UX를 좋게 만들 수 있지만, 잘못 설계하면 응답 지연이 fan-out으로 증폭되고, Gateway가 비즈니스 로직을 빨아들이는 거대한 병목이 됩니다. 결국 실무의 핵심은 “합칠 수 있는가”가 아니라 **어디까지 합쳐야 유리한가**입니다. 이 글은 그 판단 기준을 숫자와 운영 관점으로 정리한 플레이북입니다.

## 이 글에서 얻는 것

- API Composition이 필요한 상황과, 그냥 클라이언트 호출 최적화로 끝내야 하는 상황을 구분할 수 있습니다.
- Aggregation Gateway/BFF가 fan-out 지연과 부분 실패를 어떻게 관리해야 하는지 기준을 잡을 수 있습니다.
- 응답 조합, 캐시, 권한 위임, ownership을 어디까지 두어야 과도한 중앙집중화를 피할 수 있는지 판단할 수 있습니다.

## 핵심 개념/이슈

### 1) API Composition은 네트워크 호출 수를 줄이는 기술이 아니라, 화면 단위 계약을 서버로 옮기는 선택이다

Composition이 유효한 대표 상황은 명확합니다. 같은 화면에서 항상 같이 필요한 데이터가 있고, 클라이언트 종류별로 필요한 shape가 다르며, 네트워크 왕복이 사용자 체감 지연의 큰 비중을 차지할 때입니다. 반대로 조회 조합이 사용자 액션마다 크게 달라지거나, 조합 규칙이 서비스 고유 비즈니스 로직에 가까우면 함부로 중앙화하면 안 됩니다.

실무에서 먼저 보는 기준은 아래 정도가 현실적입니다.

- 한 화면 로딩에 필요한 백엔드 호출이 평균 **4개 이상**이다.
- 모바일 환경에서 첫 렌더링 p95가 **1.2초 이상**이고, 그중 네트워크 대기 비중이 **40% 이상**이다.
- 같은 화면을 웹, 모바일, 어드민이 모두 쓰지만 필요한 필드와 정렬 기준이 다르다.
- 프런트엔드에서 중복된 병렬 호출 오케스트레이션 코드가 반복된다.

이 조건이 겹치면 Composition을 검토할 가치가 큽니다. 다만 이때도 [API Gateway 설계](/learning/deep-dive/deep-dive-api-gateway-design/)에서 말하는 공통 횡단 관심사와, 실제 화면 조합 책임은 구분해야 합니다. Gateway가 인증, 라우팅, 공통 정책을 넘어서 도메인 계산까지 먹기 시작하면 금방 비대해집니다.

### 2) 가장 먼저 무너지는 것은 CPU가 아니라 fan-out latency budget이다

Composition의 본질적 위험은 병렬 호출 그 자체보다, **느린 하위 호출 하나가 전체 응답을 붙잡는 구조**입니다. 다운스트림 5개를 병렬로 부르면 평균 지연은 좋아 보일 수 있지만, 실제 사용자 체감은 가장 느린 요청의 tail latency에 끌려갑니다.

그래서 운영 기준은 단순 평균이 아니라 전체 예산에서 출발해야 합니다.

- 상위 API 목표 p95: **800ms**
- 인증/직렬화/네트워크 오버헤드: **120ms**
- 조합 레이어 로직: **80ms**
- 다운스트림 fan-out 총 예산: **500~550ms**
- 여유 버퍼: **50~100ms**

이 구조에서는 다운스트림별 timeout을 각각 500ms로 두면 안 됩니다. 상위 요청의 남은 예산 기준으로 줄여야 합니다. 이 부분은 [종단간 Deadline Budget과 Cancellation Propagation](/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/)과 같이 설계하는 편이 안전합니다. 조합 레이어가 남은 시간이 180ms인데도 하위 서비스에 300ms timeout을 보내면, 사용자는 이미 떠났는데 서버만 더 바빠집니다.

### 3) 모든 필드를 같은 중요도로 합치면 부분 실패를 설계할 수 없다

Composition API는 자주 “응답 하나”로 보이지만, 실제로는 중요도가 다른 데이터 묶음입니다. 예를 들어 주문 상세 화면이라면 주문 상태와 결제 상태는 필수지만, 추천 상품이나 리뷰 요약은 부가 정보일 수 있습니다. 이 구분이 없으면 다운스트림 한 곳만 느려도 전체를 500으로 떨어뜨리게 됩니다.

그래서 응답 필드를 최소 세 등급으로 나누는 편이 좋습니다.

1. **Blocking 필드**: 없으면 요청 자체를 실패시켜야 함
2. **Degradable 필드**: 없으면 기본값, stale cache, placeholder로 대체 가능
3. **Deferred 필드**: 별도 지연 로딩이나 후속 호출로 넘겨도 됨

초기 기준 예시는 아래처럼 잡을 수 있습니다.

- blocking downstream 개수: **2개 이하** 권장
- optional enrichment 비중: 전체 응답 필드의 **30~50%** 이하
- optional 호출 timeout: blocking보다 **짧게**, 보통 80~150ms
- stale cache 허용 시간: 추천/랭킹 **1~5분**, 프로필 요약 **30~60초**, 결제/재고 **0초**

이런 분류가 있어야 [Graceful Degradation 플레이북](/learning/deep-dive/deep-dive-graceful-degradation-brownout-playbook/)에서 말한 fallback, brownout, read-only 전략을 Composition API에도 그대로 연결할 수 있습니다.

### 4) Aggregation Gateway는 편하지만, ownership이 흐려지면 작은 모놀리스가 된다

처음에는 화면 조합만 맡기려던 레이어가 곧잘 아래 역할까지 가져갑니다. 권한 판단, 포맷 가공, 정렬, 비즈니스 규칙 우선순위, 캐시 전략, 심지어 downstream 재시도까지 한곳에 모입니다. 이 상태가 되면 서비스가 분리돼 있어도 운영은 다시 중앙 병목으로 회귀합니다.

그래서 ownership 원칙을 먼저 박아 두는 편이 좋습니다.

- **조합 레이어가 가져도 되는 것**: 응답 shape 변환, 병렬 호출 오케스트레이션, optional fallback 선택
- **가져오면 위험한 것**: 결제 승인 규칙, 주문 상태 전이, 재고 차감 결정, 고객 등급 산정
- **모호하면 원 서비스 우선**: 같은 규칙을 둘 이상 레이어가 해석하면 장애 때 정답이 흐려집니다.

특히 동일 키에 대한 중복 조회가 많다면 조합 레이어에서 무작정 fan-out을 늘리기보다 [Request Coalescing / SingleFlight](/learning/deep-dive/deep-dive-request-coalescing-singleflight/) 같은 병합 전략을 먼저 보는 편이 효율적입니다. Composition은 호출을 숨겨 주지만, 원본 부하까지 자동으로 줄여 주지는 않습니다.

## 실무 적용

### 1) 도입 판단 기준(숫자·조건·우선순위)

Composition 도입은 보통 아래 순서로 판단하면 깔끔합니다.

**1순위, 사용자 체감 이득이 분명한가**  
- 화면당 호출 수가 많고, 병렬 호출 오케스트레이션이 프런트엔드 반복 비용을 만든다.
- 첫 렌더링 개선 목표가 최소 **20% 이상** 잡힌다.

**2순위, fan-out budget을 통제할 수 있는가**  
- blocking downstream은 **2개 이하**, 총 downstream은 **5개 이하**에서 시작
- 조합 레이어 동시성 상한은 인스턴스당 **4~8개** 수준부터 측정
- 전체 요청 timeout은 고정 상수보다 remaining deadline 기반으로 전파

**3순위, 부분 실패 계약을 문서화할 수 있는가**  
- 어떤 필드는 비어도 되는지, 어떤 필드는 stale 허용인지, 어디서 206/부분 응답 또는 placeholder를 쓰는지 합의돼야 함

**4순위, 원 서비스 ownership이 유지되는가**  
- 도메인 규칙이 Aggregation으로 빨려 들어가기 시작하면 즉시 경계 재조정

### 2) 추천 운영 기본값

실무에서 무난한 시작점은 아래 정도입니다.

| 항목 | 권장 시작값 | 보류/재검토 기준 |
| --- | --- | --- |
| 총 downstream 수 | 3~5개 | 6개 초과 시 별도 read model 검토 |
| blocking downstream 수 | 최대 2개 | 3개 이상이면 전체 실패율 급증 위험 |
| optional 호출 timeout | 80~150ms | 200ms 초과면 지연 로딩 분리 검토 |
| 조합 레이어 재시도 | 기본 0회 | 재시도는 전체 증폭률 계산 후 제한 |
| stale cache TTL | 30초~5분 | 정합성 민감 데이터는 0초 |
| 인스턴스 동시 fan-out 상한 | 4~8 | CPU, connection pool, event loop 포화 시 축소 |

여기서 핵심 우선순위는 **응답 완전성보다 핵심 경로 성공률**, 그리고 **평균 latency보다 p95/p99 안정성**입니다.

### 3) 팀 운영 포인트

첫째, 응답 스키마에 `required`, `optional`, `stale_at` 같은 의미를 명시하세요. 문서 없이 코드만 보면 나중에 어떤 필드를 비워도 되는지 아무도 확신하지 못합니다.

둘째, 조합 레이어 대시보드는 서비스별 latency보다 **상위 API 기준 fan-out 폭, optional fallback 비율, partial response 비율**을 먼저 보세요. 이 숫자가 없으면 문제를 downstream 탓으로만 돌리게 됩니다.

셋째, 화면 요구사항이 자주 바뀌는 조직이라면 BFF별 owner를 분리하는 편이 낫습니다. 웹과 모바일이 서로 다른 릴리스 주기를 갖는데 하나의 거대한 Aggregation API를 공유하면 결국 가장 느린 팀의 속도에 맞춰집니다.

넷째, 반복적으로 6개 이상 서비스를 합쳐야 하는 엔드포인트는 신호로 봐야 합니다. 그쯤 되면 동기 조합이 아니라 별도 read model, materialized view, 비동기 집계 저장소가 더 나은 선택일 수 있습니다.

## 트레이드오프/주의점

1. **클라이언트 단순화와 서버 복잡도는 교환관계**입니다. 프런트엔드가 편해질수록 백엔드 조합 레이어의 장애 반경은 커질 수 있습니다.
2. **재시도와 hedge를 조합 레이어에서 무심코 켜면 증폭률이 커집니다.** downstream 4개, retry 1회만 있어도 최악의 경우 호출 수가 빠르게 불어납니다.
3. **캐시는 latency를 줄이지만 정합성 계약을 요구합니다.** stale 허용 범위를 문서화하지 않으면 “빠르지만 틀린 응답”이 늘어납니다.
4. **Composition은 임시 처방일 수도 있습니다.** 특정 화면 때문에 매번 조합이 복잡해진다면 API를 더 예쁘게 만드는 대신 읽기 모델을 다시 설계하는 쪽이 장기적으로 낫습니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 화면별 blocking 데이터와 optional 데이터를 구분했다.
- [ ] 상위 API p95 예산 안에서 downstream timeout을 remaining deadline 기준으로 전파한다.
- [ ] 총 downstream 수와 blocking downstream 수에 상한이 있다.
- [ ] stale cache 허용 시간과 partial response 규칙이 문서화돼 있다.
- [ ] 조합 레이어에 도메인 상태 전이 규칙이 새어 들어오지 않도록 owner를 정했다.

### 연습 과제

1. 현재 운영 중인 화면 하나를 골라, 실제로 필요한 downstream 호출 수와 blocking/optional 필드를 표로 나눠 보세요. 대부분 여기서 첫 과잉 조합이 드러납니다.  
2. 상위 API 목표 p95를 800ms로 두고, 인증/직렬화/조합 비용을 제외한 뒤 downstream별 budget을 다시 나눠 보세요. 지금 timeout 상수가 얼마나 낙관적인지 확인할 수 있습니다.  
3. 최근 느린 화면 API 하나를 골라, “동기 조합 유지”, “optional 분리”, “read model 전환” 세 가지 안을 latency, 복잡도, ownership 관점으로 비교해 보세요.

## 관련 글

- [API Gateway 설계](/learning/deep-dive/deep-dive-api-gateway-design/)
- [종단간 Deadline Budget과 Cancellation Propagation](/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/)
- [Request Coalescing / SingleFlight](/learning/deep-dive/deep-dive-request-coalescing-singleflight/)
- [Graceful Degradation 플레이북](/learning/deep-dive/deep-dive-graceful-degradation-brownout-playbook/)
- [Service Discovery와 Health-Aware Routing](/learning/deep-dive/deep-dive-service-discovery-health-aware-routing/)
