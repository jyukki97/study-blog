---
title: "백엔드 커리큘럼 심화: Business Calendar와 Cutoff Policy, 영업일·마감 시각을 재현 가능하게 설계하는 법"
date: 2026-09-12
draft: false
topic: "Data System"
tags: ["Business Calendar", "Cutoff", "Timezone", "Settlement", "Domain Modeling", "Backend Operations"]
categories: ["Backend Deep Dive"]
description: "영업일, 공휴일, 지역별 마감 시각을 단순 cron 조건이 아닌 버전 있는 도메인 정책으로 모델링하고, 정산·예약·리포트의 재현성과 운영 안전성을 확보하는 기준을 정리합니다."
module: "data-system"
study_order: 1510
key_takeaways:
  - "영업일은 UTC 날짜나 서버 시간의 별칭이 아니라, 지역·공휴일·휴장·조기 마감 규칙으로 계산한 도메인 값이다."
  - "마감은 한 번의 시각 비교가 아니라 정책 버전, 대상 시간대, 결정 시각, 입력 snapshot을 남겨 재현해야 한다."
  - "마감 직전 요청은 시간 동기화만으로 해결되지 않는다. idempotency, grace window, 상태 전이, 재처리 기준을 함께 둬야 한다."
operator_checklist:
  - "업무마다 calendar_id, zone_id, cutoff policy version, holiday source owner를 명시한다."
  - "마감 판정 결과에 evaluated_at, effective_business_date, policy_version, input_hash를 저장한다."
  - "공휴일·조기 마감 데이터는 최소 90일 앞까지 검증하고, 변경은 두 사람 검토와 diff 기록을 거친다."
  - "마감 직전 15분에는 처리 지연·NTP offset·큐 lag를 함께 감시하고, 기준 초과 시 자동 확정 대신 보류 경로로 보낸다."
learning_refs:
  - title: "Clock Skew와 시간 의미론"
    href: "/learning/deep-dive/deep-dive-clock-skew-time-semantics-playbook/"
    description: "벽시계, 단조 시계, 이벤트 시각을 구분해 시간 오차가 업무 판정으로 번지지 않게 합니다."
  - title: "타임존·국제화 처리 베스트 프랙티스"
    href: "/learning/deep-dive/deep-dive-timezone-i18n-handling/"
    description: "UTC 저장과 지역 달력 기준 값을 언제 분리해야 하는지 다룹니다."
  - title: "Bitemporal·Effective-Dated Records"
    href: "/learning/deep-dive/deep-dive-bitemporal-effective-dated-records-playbook/"
    description: "정책이 언제 효력을 가졌고 시스템이 언제 알았는지를 함께 남기는 모델입니다."
  - title: "Reconciliation Ledger Pipeline"
    href: "/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/"
    description: "마감 뒤 원장·파생 데이터·외부 결과의 차이를 대사하는 운영 패턴입니다."
---

## 이 글에서 얻는 것

- 영업일과 마감 시각을 `LocalDate.now()` 또는 서버 cron에 묻어 두지 않고, 명시적 정책으로 설계하는 방법을 배웁니다.
- 국가·고객·상품마다 다른 공휴일, 조기 마감, grace window를 어떤 데이터로 저장하고 어떤 시점에 판정할지 정할 수 있습니다.
- 마감 직전 요청, 지연 이벤트, 정책 변경, 재처리 상황에서 **당시의 결정**을 재현하는 기준을 얻습니다.
- 정산·예약·배치·리포트에서 정합성을 우선할지 즉시성을 우선할지 숫자와 상태 전이로 결정할 수 있습니다.

백엔드에서 시간 문제는 흔히 UTC 저장 여부로 끝난다고 생각합니다. 그러나 "한국 영업일 기준 오늘", "뉴욕 장 마감 전", "매월 셋째 영업일", "공휴일이면 다음 영업일" 같은 요구가 등장하면 UTC와 타임존만으로는 부족합니다. 이때 필요한 것은 시각 변환 함수가 아니라 **업무 달력과 마감 정책**입니다.

[타임존·국제화 처리](/learning/deep-dive/deep-dive-timezone-i18n-handling/)가 절대 시각과 지역 시각을 구분하는 기본을 다뤘다면, 이 글은 지역 시각 위에 놓이는 업무 규칙을 다룹니다. [Clock Skew와 시간 의미론](/learning/deep-dive/deep-dive-clock-skew-time-semantics-playbook/)의 시간 오차, [Bitemporal·Effective-Dated Records](/learning/deep-dive/deep-dive-bitemporal-effective-dated-records-playbook/)의 정책 이력, [Reconciliation Ledger Pipeline](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)의 사후 대사가 함께 있어야 마감 결과를 설명할 수 있습니다.

## 핵심 개념/이슈

### 1) 영업일은 날짜 타입이 아니라 계산 결과다

`2026-09-12`라는 `LocalDate`가 있다고 해서 모든 업무의 영업일이 같은 것은 아닙니다. 한 서비스 안에서도 한국 고객 지원은 `Asia/Seoul`, 미국 결제 정산은 `America/New_York`, 글로벌 리포트는 UTC를 기준으로 삼을 수 있습니다. 여기에 주말, 법정 공휴일, 거래소 휴장, 임시 휴무, 조기 마감이 더해집니다.

따라서 `business_date`는 원본 입력이 아니라 다음 정책으로 계산한 결과여야 합니다.

| 구성 요소 | 예시 | 반드시 남길 값 |
| --- | --- | --- |
| calendar | KR-BUSINESS, US-NYSE | `calendar_id`, source version |
| 지역 | Asia/Seoul, America/New_York | IANA `zone_id` |
| 영업 규칙 | 월~금, 지정 휴일 제외 | weekend/holiday rule |
| 예외 | 12:00 조기 마감, 임시 휴장 | exception id, effective range |
| 마감 정책 | 당일 17:00, 다음 영업일 이월 | policy version, grace window |

예를 들어 "9월 12일 16:58 KST에 접수한 환불"은 서버가 받은 `received_at`만으로 당일 처리인지 판단하면 안 됩니다. 고객 계약의 `calendar_id`, 업무 유형의 cutoff, 해당 날짜의 조기 마감 예외, 그리고 결제 원장이 허용하는 지연을 확인해야 합니다. 날짜를 테이블 컬럼 하나로 저장하는 것은 좋지만, 그 날짜가 **어떤 정책으로 산출됐는지**를 잃으면 장애·감사·재정산에서 근거가 사라집니다.

### 2) cutoff는 비교 연산이 아니라 상태 전이 규칙이다

가장 단순한 구현은 `now < 17:00`이면 당일, 아니면 다음 날로 보내는 방식입니다. 이 구현은 요청이 몰리는 마감 시점에 특히 취약합니다. API를 16:59:59에 수신했지만 DB commit이 17:00:03에 끝났다면 어느 날짜에 귀속할까요? 외부 결제 승인 시각이 더 중요한가요? 큐 지연으로 10분 늦게 처리됐다면요?

업무마다 먼저 **권위 있는 시각(authoritative timestamp)**을 정해야 합니다.

| 업무 | 우선 시각 | 권장 규칙 |
| --- | --- | --- |
| 고객 접수 | API gateway 수신 시각 | 검증 완료 전이라도 접수 영수증을 남김 |
| 결제/정산 | 결제사 승인 시각 또는 원장 event time | 수신 시각과 분리 보관, 늦은 이벤트는 보정 |
| 예약 변경 | 사용자가 확정한 시각 | 지역 calendar와 상품별 변경 마감 적용 |
| 일 마감 배치 | snapshot 기준 시각 | 동일 snapshot을 재실행에도 재사용 |

이후 상태는 `RECEIVED → VALIDATED → ELIGIBLE_FOR_TODAY → CLOSED`처럼 나눕니다. 마감 뒤 늦게 들어온 값은 실패로 뭉개지 말고 `LATE_REVIEW` 또는 `NEXT_BUSINESS_DATE`로 분기합니다. 이 구조가 있어야 운영자가 "당일 반영인지", "다음 영업일 이월인지", "사람 승인이 필요한 예외인지"를 데이터로 확인할 수 있습니다.

### 3) grace window는 편의 기능이 아니라 위험 예산이다

마감 직후 1~2분 동안 네트워크 재시도나 큐 지연을 허용하고 싶을 수 있습니다. 이를 무제한으로 허용하면 마감의 의미가 사라지고, 아예 허용하지 않으면 정상 사용자가 불공정하게 탈락합니다. grace window는 고객 경험과 정합성 사이의 **명시적 위험 예산**으로 다뤄야 합니다.

출발점은 다음처럼 작게 두는 편이 안전합니다.

- 고객 접수: gateway 수신 시각 기준, **최대 120초** grace window
- 금액·권리 변동: 원장 event time 기준, 자동 허용은 **0~30초**, 그 뒤는 검토 큐
- 대량 파일: upload 완료 시각이 아닌 검증 완료 전의 접수 receipt 기준, 파일 hash 필수
- 외부 파트너 이벤트: watermark를 **5~15분** 두고, 이후 도착분은 adjustment로 분리

숫자는 고정값이 아닙니다. 최근 30일의 p99 큐 지연이 8초인데 10분 grace를 둔다면 편의를 위해 통제를 잃는 것입니다. 반대로 p99 지연이 70초인데 30초만 허용하면 정상 요청을 예외 처리로 밀어 넣습니다. grace window는 `p99 end-to-end delay + 2배 안전 여유`에서 시작하고, 월 1회 실제 late ratio와 고객 이의 제기 비율로 조정합니다.

## 실무 적용

### 1) 정책을 versioned data로 모델링한다

공휴일 목록과 cutoff를 코드 상수 또는 cron 표현식에 숨기지 않습니다. 최소한 아래와 같은 정책 레코드를 둡니다.

```text
calendar_id: KR_SETTLEMENT
zone_id: Asia/Seoul
policy_version: 2026.09.1
effective_from: 2026-09-01T00:00:00+09:00
regular_cutoff: 17:00
grace_seconds: 120
holiday_source: operations-calendar-v4
exception: 2026-09-29, cutoff=12:00, reason=half-day
```

마감 판정 결과에도 `policy_version`, `calendar_id`, `evaluated_at`, `source_event_time`, `result_business_date`를 함께 적습니다. 정책이 9월 20일에 바뀌어도 9월 12일 결정을 다시 계산할 때 당시 버전을 쓸 수 있어야 합니다. 단순히 현재 달력으로 과거를 재계산하면 이미 확정한 정산과 다른 결과가 나올 수 있습니다.

### 2) 마감 job은 idempotent snapshot으로 닫는다

일 마감은 "자정에 한 번 실행"하는 작업이 아니라 특정 범위를 확정하는 작업입니다. 따라서 작업 키를 `calendar_id + business_date + cutoff_policy_version`으로 잡고, 선택한 입력 범위의 snapshot hash를 저장합니다. 재실행하더라도 같은 key와 같은 snapshot이면 결과를 덮어쓰지 말고 이전 실행의 결과를 재사용하거나 명시적 correction run으로 분리합니다.

권장 운영 기준은 다음과 같습니다.

1. cutoff 15분 전부터 queue lag, DB write p99, clock offset을 1분 간격으로 관측합니다.
2. queue lag가 grace window의 50%를 넘거나 NTP offset이 100ms를 넘으면 자동 확정을 멈추고 `PENDING_REVIEW`로 전환합니다.
3. 마감 job은 대상 레코드 수, 금액 합계, rejected count, policy version을 receipt로 남깁니다.
4. 확정 뒤에는 원장 합계와 파생 집계의 차이가 **0.01%**를 넘는지 대사하고, 초과하면 다음 영업일 처리 전에 원인을 분류합니다.

이 순서는 성능보다 정합성을 보호합니다. 마감 시간을 맞추기 위해 불완전한 데이터를 확정하는 것보다, 보류 상태와 근거를 남겨 재처리하는 편이 더 싸게 끝납니다.

### 3) 테스트는 날짜 예제가 아니라 정책 경계표로 만든다

단위 테스트에 평일 한 건만 넣어서는 부족합니다. calendar마다 아래 경계를 fixture로 고정합니다.

| 케이스 | 기대 결과 |
| --- | --- |
| 평일 cutoff 1초 전 | 당일 business date |
| 평일 cutoff 정확히 | 정책의 inclusive/exclusive 정의대로 고정 |
| grace 마지막 1초 | 자동 허용 또는 review를 명확히 검증 |
| 조기 마감일 | 일반 cutoff가 아닌 exception 적용 |
| 휴일 전 영업일 마감 뒤 | 다음 영업일로 이동 |
| DST gap/overlap 지역 | 존재하지 않는 시각 거부, 중복 시각의 offset 기록 |
| 과거 정책 재실행 | 당시 policy version으로 동일 결과 |

`cutoff <= now`처럼 애매한 비교식을 팀마다 해석하지 않도록, inclusive 여부를 정책 명세에 적고 fixture 이름에도 드러냅니다. CI에서는 앞으로 90일의 holiday source를 파싱해 중복 날짜, 누락 zone, 과거 effective range 충돌을 막는 검증을 추가하는 것이 좋습니다.

## 트레이드오프/주의점

1. **외부 공휴일 API를 요청 경로에서 직접 호출하지 않습니다.** 최신성은 좋아 보여도 장애가 마감 판정 장애로 번집니다. 검증된 정책 snapshot을 내부에 복제하고, source 갱신 실패는 사전 경보로 처리합니다.
2. **현재 날짜로 과거 결과를 재계산하지 않습니다.** 예외 휴일이 뒤늦게 추가되거나 policy가 바뀌면 결과가 달라집니다. 원결정과 correction을 구분해야 합니다.
3. **서버 타임존에 의존하지 않습니다.** 컨테이너·개발 PC·배치 worker의 기본 zone은 정책이 아닙니다. IANA zone을 데이터와 코드에 명시합니다.
4. **grace를 무한 예외 처리로 만들지 않습니다.** 자동 허용 범위를 넘긴 건은 사람이 설명 가능한 review queue로 보내고, 승인자·사유·재귀속 결과를 남깁니다.

## 체크리스트와 연습

### 출시 전 체크리스트

- [ ] 업무별로 calendar, zone, cutoff, authoritative timestamp, grace를 문서화했다.
- [ ] 마감 결과에 policy version과 입력 snapshot hash를 저장한다.
- [ ] 휴일·조기 마감 변경에 owner, 검토자, effective date가 있다.
- [ ] cutoff 직전 처리 지연·clock offset·큐 적체의 보류 기준이 숫자로 있다.
- [ ] 재실행이 기존 확정 결과를 바꾸지 않고 correction 경로로 분리된다.
- [ ] 다음 90일 정책 fixture와 DST 경계 테스트가 CI에서 통과한다.

### 연습: 월말 정산 마감 표 만들기

가상의 KR 정산 서비스를 정하고, 월~금 17:00 마감, 공휴일 이월, 120초 grace, 조기 마감일 12:00을 정책 데이터로 표현해 보세요. 이어서 `16:59:59`, `17:00:00`, `17:01:59`, `17:02:01`, 휴일 전날, 조기 마감일의 여섯 요청을 표로 만들고 각 요청의 authoritative timestamp, policy version, 결과 business date, 상태를 기록합니다. 마지막으로 5분 늦게 도착한 결제사 이벤트를 자동 반영할지 adjustment로 보낼지 이유를 적어 보세요.

## 마무리

Business Calendar는 달력 라이브러리 선택 문제가 아닙니다. 조직이 "언제 접수됐고, 어느 영업일에 속하며, 어떤 정책으로 확정됐는가"를 나중에도 답할 수 있게 만드는 도메인 계약입니다. 시간대 변환을 정확히 하는 것에서 멈추지 말고, 정책 버전·상태 전이·snapshot·대사까지 연결해야 마감이 장애가 아닌 재현 가능한 업무 절차가 됩니다.
