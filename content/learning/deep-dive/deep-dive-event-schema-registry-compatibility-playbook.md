---
title: "백엔드 커리큘럼 심화: 이벤트 스키마 레지스트리와 호환성 운영 플레이북"
date: 2026-03-18
draft: false
topic: "Architecture"
tags: ["Schema Registry", "Event-Driven Architecture", "Kafka", "Compatibility", "Data Contract"]
categories: ["Backend Deep Dive"]
description: "이벤트 스키마 변경으로 장애를 만들지 않기 위해, 호환성 모드 선택부터 배포 순서·검증 기준·운영 지표까지 실무형으로 정리합니다."
module: "distributed-system"
study_order: 1108
---

## 이 글에서 얻는 것

- 이벤트 기반 아키텍처에서 스키마 변경을 안전하게 배포하기 위한 **의사결정 프레임**을 얻습니다.
- Backward/Forward/Full 호환성 모드를 서비스 구조에 맞게 선택하는 **숫자 기준**을 확보합니다.
- "변경은 쉬운데 운영이 무섭다"는 상태에서 벗어나, CI 게이트·카나리·롤백까지 포함한 **실전 운영 플레이북**을 만들 수 있습니다.

## 핵심 개념/이슈

### 1) 이벤트 스키마 장애는 코드 버그보다 복구 비용이 크다

API 서버 버그는 롤백으로 빠르게 복구되는 경우가 많지만, 이벤트 스키마 장애는 이미 전송된 메시지가 남기 때문에 후폭풍이 길어집니다. 특히 소비자가 많을수록 복구 시간이 기하급수적으로 늘어납니다.

대표적인 실패 패턴은 아래 3가지입니다.

1. `required` 필드 추가 후 구버전 소비자 파싱 실패
2. 필드 의미 변경(예: `amount` 단위를 원→센트로 변경)으로 조용한 데이터 오염 발생
3. 주키(업무 식별자) 해석 변경으로 멱등성 붕괴

이 문제는 단순 직렬화 라이브러리 문제가 아니라 **데이터 계약(Data Contract) 운영 문제**입니다. 배경 개념은 [Kafka 기초](/learning/deep-dive/deep-dive-kafka-foundations/), [멱등성과 순서 보장](/learning/deep-dive/deep-dive-kafka-idempotence-ordering/), [Consumer-Driven Contract Testing](/learning/deep-dive/deep-dive-consumer-driven-contract-testing/)를 같이 보면 더 명확해집니다.

### 2) 호환성 모드는 기술 선택이 아니라 조직 구조 선택이다

Schema Registry를 도입하면 보통 Backward/Forward/Full 중 하나를 고르게 됩니다. 여기서 중요한 건 "무엇이 더 엄격한가"보다 "우리 조직의 배포 현실에 맞는가"입니다.

- **Backward**: 새 소비자가 옛 이벤트를 읽을 수 있음
- **Forward**: 옛 소비자가 새 이벤트를 읽을 수 있음
- **Full**: 양방향 모두 가능

실무 기준으로는 아래처럼 시작하는 게 안전합니다.

- 소비자 수가 5개 미만, 단일 팀 운영: Backward 우선
- 소비자 수가 5~20개, 릴리즈 주기 불균형: Full 권장
- 외부 파트너 연동 포함, 릴리즈 통제 약함: Full + 엄격 검증 필수

"팀 간 릴리즈 속도 차이"가 2주 이상 벌어지는 조직에서는 Forward만으로는 사고를 못 막는 경우가 많습니다. 이때는 Full로 올리고, 호환성 예외는 승인 절차를 두는 편이 운영 리스크가 낮습니다.

### 3) 버전 전략에서 가장 중요한 건 네이밍이 아니라 Subject 경계다

Schema Registry를 붙여도 Subject(스키마 관리 단위)를 잘못 잡으면 장기적으로 혼란이 커집니다.

권장 기준:

- 토픽 기준 Subject: 운영 단순성은 높지만, 이벤트 타입이 섞이면 충돌 가능
- 레코드 타입 기준 Subject: 타입별 독립 운영 가능, 초기 설계 비용 증가
- 도메인+이벤트 타입 기준 Subject: 중대형 서비스에서 가장 균형적

예: `billing.invoice-issued.v1`, `billing.payment-captured.v2`

핵심은 "토픽 단위"가 아니라 **업무 의미 단위**로 진화 이력을 분리하는 것입니다. 그래야 재처리·감사·정산 이슈가 생겼을 때 원인 추적이 가능합니다. 이는 [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/) 운영에서도 동일하게 중요합니다.

### 4) 안전한 변경의 기본 규칙: 추가는 느슨하게, 삭제는 장기 계획으로

실무에서 사고를 줄이려면 변경 룰을 팀 규칙으로 고정해야 합니다.

- 필드 추가: nullable/default를 명확히 두고 배포
- 필드 삭제: "deprecate → 무사용 검증 → 삭제" 3단계로 최소 2 릴리즈 이상 유지
- 의미 변경: 이름 재사용 금지, 새 필드로 분리(`amount_v2`)
- enum 확장: 소비자가 unknown 값을 안전 처리하도록 기본 분기 강제

특히 "삭제"는 기술 작업이 아니라 **소비자 추적 작업**입니다. 소비자 인벤토리가 없으면 삭제 시점을 판단할 수 없습니다.

### 5) 운영 지표가 없으면 호환성은 선언에 그친다

아래 4개는 반드시 대시보드로 운영해야 합니다.

- 파싱 실패율(consumer deserialize error rate) < **0.1%**
- 스키마 검증 실패 PR 비율 < **5%**
- deprecated 필드 제거 리드타임 < **90일**
- 버전별 소비자 분포(구버전 소비자 비율) < **20%**

구버전 소비자 비율이 30%를 넘기면, 스키마 변경이 사실상 묶이기 시작합니다. 이 상태는 플랫폼 문제이므로 개별 서비스 팀에게만 책임을 넘기면 해결되지 않습니다.

## 실무 적용

### 1) 권장 아키텍처 (중간 규모 팀 기준)

- Producer 서비스: 이벤트 생성 + 로컬 계약 검증
- CI 파이프라인: 스키마 호환성 검사, 소비자 계약 테스트 실행
- Schema Registry: 버전 관리, 호환성 정책 강제
- Broker(Kafka/PubSub): 이벤트 전달
- Consumer 서비스: 역직렬화 가드 + unknown 필드 허용
- 운영 계층: 파싱 실패율/버전 분포/DLQ 누적 모니터링

이 구조에서 핵심은 "런타임 실패 전에 CI에서 대부분 차단"하는 것입니다.

### 2) 의사결정 기준(숫자·조건·우선순위)

우선순위는 **데이터 정합성 > 배포 속도 > 개발 편의성**으로 두는 것이 안전합니다.

- 호환성 모드 선택
  - 소비자 1~4개: Backward 가능
  - 소비자 5개 이상 또는 외부 파트너 포함: Full 권장
- 변경 승인 기준
  - required 필드 추가: 아키텍트 리뷰 필수
  - 의미 변경: 신규 필드 분리 + 마이그레이션 문서 없으면 배포 금지
- 롤아웃 기준
  - 카나리 소비자에서 30분 이상 파싱 오류 0건
  - 전체 전환 전 DLQ 증가율 10% 이내

### 3) 4단계 배포 플레이북

1. **등록 전 검증**: 스키마 PR에서 호환성 체크 + 계약 테스트 통과
2. **Producer 선배포**: 새 스키마로 emit하되 구필드 유지(deprecated)
3. **Consumer 점진 전환**: 카나리→10%→50%→100% 순서
4. **정리 단계**: deprecated 사용량이 0이 된 뒤 삭제 PR 진행

카나리 구간에서 이상이 발견되면 신규 버전 등록을 되돌리기보다, emit 경로를 구버전으로 즉시 회귀시키는 편이 복구가 빠릅니다.

### 4) 장애 대응 런북 최소 항목

- 어떤 Subject/Version에서 오류가 시작됐는지
- 영향을 받는 소비자 목록과 트래픽 비중
- 임시 우회(구버전 emit 강제 or 특정 consumer skip)
- 정합성 보정 범위(재처리 기간, 보정 방식)
- 재발 방지 항목(CI 규칙 추가, 릴리즈 승인 조건 강화)

운영 알림 체계는 [관측 알람 설계](/learning/deep-dive/deep-dive-observability-alarms/)와 연결해 "에러 발생"이 아니라 "의미 있는 임계치 초과" 기준으로 세팅해야 알림 피로를 줄일 수 있습니다.

## 트레이드오프/주의점

1) **엄격한 호환성은 초기 개발 속도를 늦출 수 있습니다.**  
대신 장애 복구 비용과 팀 간 조율 비용을 장기적으로 크게 낮춥니다.

2) **Schema Registry 도입만으로 품질이 보장되진 않습니다.**  
소비자 계약 테스트와 릴리즈 승인 정책이 빠지면 운영 효과가 거의 없습니다.

3) **deprecated 필드가 쌓이면 기술 부채가 됩니다.**  
유예 기간을 숫자로 고정하지 않으면 "언젠가 정리" 상태로 방치됩니다.

4) **버전 증가는 자연스럽지만, 의미 중복 이벤트는 위험합니다.**  
비슷한 이벤트를 여러 타입으로 분기하면 분석·정산·감사에서 해석 충돌이 발생합니다.

## 체크리스트 또는 연습

### 팀 체크리스트

- [ ] 이벤트 타입별 Subject 경계를 문서화했다.
- [ ] 호환성 모드 선택 기준을 소비자 수/배포 주기로 정의했다.
- [ ] 스키마 PR에 자동 호환성 검사와 계약 테스트를 붙였다.
- [ ] deprecated 필드 제거 리드타임 목표(예: 90일)를 운영한다.
- [ ] 파싱 실패율, DLQ 증가율, 버전 분포를 대시보드로 본다.

### 연습 과제

1. 현재 운영 중인 이벤트 3개를 골라 "필드 추가/삭제/의미 변경" 시나리오를 작성하고, 각각 허용·금지 조건을 정리해보세요.  
2. 구버전 소비자가 25% 남아 있는 상태를 가정하고, 삭제 예정 필드를 어떤 순서로 제거할지 2주 단위 계획을 작성해보세요.  
3. 스키마 변경 실패 사고를 하나 가정해, 30분 내 임시복구 액션과 1주 내 재발방지 액션을 분리해보세요.

## 관련 글

- [Kafka 기초와 운영 관점 정리](/learning/deep-dive/deep-dive-kafka-foundations/)
- [Kafka 멱등성·순서 보장 설계](/learning/deep-dive/deep-dive-kafka-idempotence-ordering/)
- [Consumer-Driven Contract Testing 실전](/learning/deep-dive/deep-dive-consumer-driven-contract-testing/)
- [Transactional Outbox + CDC 패턴](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)
- [관측 알람 설계와 임계치 운영](/learning/deep-dive/deep-dive-observability-alarms/)
