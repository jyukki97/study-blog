---
title: "백엔드 커리큘럼 심화: Async Request-Reply와 Operation Resource 운영 플레이북 (202 Accepted·Polling·Webhook)"
date: 2026-04-30
draft: false
topic: "Backend API Design"
tags: ["Async Request-Reply", "Operation Resource", "202 Accepted", "Polling", "Webhook", "Backend Architecture"]
categories: ["Backend Deep Dive"]
description: "처리 시간이 길거나 외부 부작용이 있는 작업을 동기 API로 억지로 처리하지 않고, 202 Accepted와 operation resource로 분리해 안정적으로 운영하는 기준을 정리합니다."
module: "architecture"
study_order: 1184
---

사용자 프로필 저장처럼 100~300ms 안에 끝나는 작업은 동기 API가 자연스럽습니다. 문제는 모든 작업을 그 방식으로 밀어붙일 때 생깁니다. 보고서 생성, 대용량 업로드 후 변환, 외부 결제 승인, 여러 하위 시스템을 거치는 provisioning은 서버가 "요청은 받았지만 아직 끝나지 않았다"는 상태를 먼저 모델링해야 안전합니다. 이걸 하지 않으면 타임아웃, 중복 클릭, 재시도 폭주, 상태 불일치가 한 번에 붙습니다.

그래서 실무에서는 긴 작업을 단순히 "백그라운드로 돌린다"보다, **클라이언트가 추적 가능한 operation resource를 함께 설계**하는 쪽이 낫습니다. 이 글은 `202 Accepted + Location + operation status endpoint` 패턴을 언제 쓰고, polling과 webhook를 어떻게 섞고, 실패와 재시도를 어떤 숫자로 관리할지 정리한 운영 플레이북입니다.

## 이 글에서 얻는 것

- 어떤 작업을 동기 API로 두고, 어떤 작업을 async request-reply로 분리해야 하는지 **판단 기준**을 잡을 수 있습니다.
- `202 Accepted`를 반환할 때 operation resource에 어떤 필드를 두어야 하는지 알 수 있습니다.
- polling, webhook, SSE를 섞을 때 무엇을 우선하고 어디서 비용이 커지는지 이해할 수 있습니다.
- 재시도, 멱등성, 상태 전이, 보관 기간 같은 **실무 숫자 기준**을 바로 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) 긴 작업을 동기 응답으로 유지하면 성능 문제가 아니라 제어 문제로 번진다

동기 API가 위험해지는 기준은 단순 평균 응답시간이 아닙니다. 보통 아래 셋 중 둘 이상이면 async 전환을 먼저 검토하는 편이 안전합니다.

1. **p95 처리시간이 2초를 넘는다**
2. **외부 시스템 2개 이상과 상태를 맞춰야 한다**
3. **실패 시 사용자가 같은 요청을 다시 눌러 중복 부작용이 생길 수 있다**

예를 들어 결제 후 영수증 발행, 파일 바이러스 검사, 권한 프로비저닝은 한 번의 HTTP 연결 안에서 끝내려 할수록 문제가 커집니다. 클라이언트는 5초 안에 응답을 원하지만 서버는 20초짜리 작업을 붙잡고 있고, 사용자는 새로고침이나 재시도를 눌러 같은 작업을 또 만듭니다. 그 순간 핵심 이슈는 느림이 아니라 **중복 실행과 상태 추적 부재**입니다.

이 패턴은 [REST API 설계 원칙](/learning/deep-dive/deep-dive-rest-api-design/), [종단간 Deadline Budget과 Cancellation](/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/), [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/)를 같이 봐야 더 선명해집니다. 긴 작업을 동기로 유지하면 deadline은 짧아지고 실제 작업은 뒤에 남으며, 사용자는 같은 요청을 다시 던지기 쉽습니다.

### 2) Async Request-Reply의 본체는 큐가 아니라 operation resource다

많은 팀이 비동기 API를 도입하면서 큐만 붙이고 클라이언트 추적 모델은 비워 둡니다. 그러면 서버 내부는 비동기화됐지만 클라이언트 입장에서는 여전히 "언제 끝나는지 모르는 요청"이 됩니다. 그래서 핵심은 메시지 큐보다 **operation resource**입니다.

권장 흐름은 아래와 같습니다.

1. 클라이언트가 `POST /exports` 또는 `POST /provisioning-jobs` 호출
2. 서버는 멱등성 키를 확인하고 작업 수락 여부 판단
3. 즉시 `202 Accepted` 반환
4. `Location: /operations/{operationId}` 또는 본문에 operation URI 제공
5. 클라이언트는 `GET /operations/{id}`로 상태 조회
6. 완료 시 `result_uri`, 실패 시 `error_code`, 취소 시 `canceled_at` 제공

operation resource에 최소한 아래 필드는 있어야 운영이 쉽습니다.

- `operation_id`
- `status` (`accepted`, `running`, `succeeded`, `failed`, `canceled`, `expired`)
- `submitted_at`, `started_at`, `finished_at`
- `request_id`, `idempotency_key`
- `progress_percent` 또는 `current_step`
- `result_uri` 또는 `error`
- `retryable` 여부
- `expires_at`

핵심은 "작업이 큐에 들어갔다"가 아니라, **클라이언트와 운영자가 같은 상태 객체를 본다**는 점입니다. 이 모델이 없으면 장애 때 support 팀은 DB와 큐를 뒤져야 하고, 사용자는 버튼을 다시 누르게 됩니다.

### 3) Polling, Webhook, SSE는 대체재가 아니라 대상별 조합이다

실무에서 자주 나오는 오해가 "polling은 구식이고 webhook가 정답"이라는 생각입니다. 실제로는 소비자 유형에 따라 다릅니다.

- **브라우저/모바일 최종 사용자**: polling 또는 SSE가 단순하고 안정적
- **B2B 파트너 시스템**: webhook가 효율적이지만 서명·재시도·DLQ가 필수
- **사내 어드민 대시보드**: polling으로 시작하고 필요 시 SSE 추가

처음 기준을 잡을 때는 아래처럼 보면 편합니다.

- 완료 시간이 **10초 이하**면 1~2초 간격 polling으로 충분한 경우가 많음
- 평균 완료 시간이 **수분 단위**면 polling 간격을 5~15초로 늘리거나 webhook 병행
- 클라이언트 수가 많아 동시 polling 요청이 작업 수보다 **10배 이상** 커지면 SSE/webhook 검토
- 파트너 시스템에 외부 효과가 있으면 webhook를 쓰되 [Webhook Delivery Reliability 플레이북](/learning/deep-dive/deep-dive-webhook-delivery-reliability-playbook/)의 서명·재시도 기준을 같이 붙임

즉 설계 질문은 "무조건 실시간인가"가 아니라, **누가 상태를 소비하고 어떤 실패를 감당할 수 있는가**입니다. 사용자 화면 한두 개 때문에 webhook 인프라를 먼저 키우는 건 과할 수 있고, 반대로 외부 파트너 통합에 polling만 강제하면 지연과 비용이 빠르게 커집니다. 실시간성이 정말 중요하면 [WebSocket과 SSE 패턴](/learning/deep-dive/deep-dive-websocket-sse-patterns/)을 같이 검토하면 됩니다.

### 4) 큐를 넣는 순간 ack, visibility, retry 정책이 API 품질에 직접 연결된다

async request-reply는 HTTP 레이어에서 끝나지 않습니다. 실제 품질은 작업 큐와 워커 정책에서 결정됩니다. 예를 들어 operation status는 `running`인데 워커가 죽어서 메시지는 다시 보이지 않는 상태면, 클라이언트는 영원히 끝나지 않는 작업을 보게 됩니다.

그래서 큐 정책은 operation 상태와 같이 설계해야 합니다.

- visibility timeout은 **평균 처리시간의 2~3배**에서 시작
- 최대 재시도 횟수는 **3~5회** 범위에서 작업 성격별 분리
- 1회 처리 시간이 5분을 넘는 작업은 heartbeat 또는 step checkpoint 필요
- `failed`와 `retrying`을 같은 상태로 뭉개지 말 것
- 최종 실패는 DLQ로 격리하고 operation에는 `retryable=false`를 명시

이 부분은 [Queue Visibility Timeout / Ack-Nack 플레이북](/learning/deep-dive/deep-dive-queue-visibility-timeout-acknack-playbook/)과 [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)를 함께 보는 편이 좋습니다. API 계약과 워커 계약이 따로 놀면 "202는 잘 나가는데 실제 완료율은 낮은" 이상한 시스템이 됩니다.

## 실무 적용

### 1) 동기 vs 비동기 의사결정 기준

제가 실무에서 먼저 보는 기준은 아래 순서입니다.

1. **사용자 체감 목표**
   - p95 응답 목표가 1초 내외인데 작업 자체가 3초 이상이면 비동기 우선
2. **외부 부작용 크기**
   - 이메일, 결제, 권한 부여, 파트너 API 호출처럼 중복 실행이 비싸면 비동기 + 멱등성 필수
3. **상태 추적 필요성**
   - 사용자가 "요청이 접수됐는지, 진행 중인지, 실패했는지"를 봐야 하면 operation resource 필요
4. **트래픽 형태**
   - 순간 피크에서 긴 작업이 thread/connection을 오래 점유하면 비동기 우선

빠른 출발 기준은 아래 정도가 현실적입니다.

- 동기 유지: p95 **1.5초 이하**, 외부 의존성 **1개 이하**, 중복 부작용 낮음
- 경계 구간: p95 **1.5~3초**, 팬아웃 **2~3개**, 실패 시 재시도 가능성 높음
- 비동기 전환: p95 **3초 초과** 또는 외부 부작용 큼 또는 완료 콜백/상태 추적 필요

### 2) API 계약 예시

`POST /reports`
- 요청 성공 수락 시 `202 Accepted`
- 응답 헤더 `Location: /operations/op_123`
- 응답 본문에는 `operation_id`, `status`, `poll_after_seconds` 포함

`GET /operations/op_123`
- `accepted`: 아직 큐 대기 중
- `running`: 실제 처리 중
- `succeeded`: `result_uri` 포함
- `failed`: `error_code`, `retryable`, `failed_reason` 포함
- `expired`: 조회 가능 기간 종료

추천 시작값:

- `poll_after_seconds`: 기본 **2초**, 장기 작업은 **5초**
- operation 조회 가능 기간: 성공 후 **24시간**, 실패 후 **7일**
- 멱등성 키 보존 기간: **24~72시간**
- progress 갱신 최소 간격: **5초** 또는 step 완료 시점

### 3) 운영 지표와 알람 기준

비동기 API는 접수량보다 **완료 품질**을 봐야 합니다. 시작 지표는 아래면 충분합니다.

- `operation_accept_to_start_p95`가 **30초 초과**하면 큐 적체 점검
- `operation_running_time_p95`가 기준선 대비 **50% 이상 상승**하면 워커/외부 의존성 확인
- `operation_stuck_ratio`가 **1% 초과**하면 heartbeat 또는 timeout 누락 조사
- `duplicate_operation_ratio`가 **0.3% 초과**하면 idempotency key 정책 재점검
- `poll_requests_per_completed_operation`이 **20 초과**면 polling 간격 또는 push 방식 개선 검토

중요한 우선순위는 보통 **중복 부작용 방지 > 완료율 > 실시간성 > 구현 단순성** 순입니다. 완료 알림이 3초 늦는 것보다 같은 결제가 두 번 처리되는 쪽이 훨씬 비쌉니다.

### 4) 도입 순서

**1단계, 상태 모델 먼저**
- 큐 도입보다 operation status 스키마와 상태 전이표를 확정합니다.

**2단계, 멱등성 추가**
- `POST` 요청에 idempotency key를 받아 같은 작업 중복 생성을 막습니다.

**3단계, 워커/큐 정책 연결**
- 재시도, visibility timeout, DLQ 조건을 operation 상태와 매핑합니다.

**4단계, 알림 채널 확장**
- polling으로 시작하고, 실제 병목이 보일 때 webhook 또는 SSE를 추가합니다.

이 순서가 좋은 이유는 운영 문제 대부분이 "전달 채널 부재"보다 "상태 계약 부재"에서 나오기 때문입니다.

## 트레이드오프/주의점

1. **비동기화가 항상 더 싸진 않다**  
큐, 워커, 상태 저장소, 알림 채널이 추가되므로 시스템 구성은 분명 복잡해집니다. 처리 시간이 800ms인 작업까지 전부 operation resource로 빼면 오히려 과설계가 됩니다.

2. **진행률 숫자는 거짓말이 되기 쉽다**  
`progress_percent`를 억지로 넣으면 의미 없는 10%, 60%, 90%만 늘어날 수 있습니다. 단계 기반 작업이면 `current_step`이 더 정직할 때가 많습니다.

3. **실패를 숨기면 support 비용이 커진다**  
"백그라운드에서 처리 중"만 보여주고 실제 실패 이유를 감추면 사용자와 운영자 모두 재시도를 남발하게 됩니다. `retryable` 여부와 오류 코드는 최대한 명시하는 편이 낫습니다.

4. **polling 비용은 완료 시간 분포와 함께 봐야 한다**  
평균 2분짜리 작업을 1초마다 polling하면 완료 1건당 상태 조회가 120번입니다. 작업 수가 하루 10만 건이면 상태 조회만으로도 별도 비용이 됩니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] p95 3초 초과 또는 외부 부작용 큰 작업을 동기 API로 억지 유지하고 있지 않다.
- [ ] `202 Accepted` 응답에 operation URI 또는 식별자가 포함된다.
- [ ] operation resource에 상태, 결과, 오류, 만료 시각이 명시된다.
- [ ] idempotency key와 중복 작업 정책이 문서화돼 있다.
- [ ] polling 간격, 조회 보관 기간, DLQ 조건이 숫자로 정리돼 있다.
- [ ] 큐 재시도 상태와 operation 상태 전이가 서로 어긋나지 않는다.

### 연습 과제

1. 현재 서비스에서 p95 2초를 넘는 API 3개를 골라, 동기 유지 이유와 async 전환 시 장단점을 표로 적어 보세요.  
2. 하나의 긴 작업 API를 골라 `accepted → running → succeeded/failed/canceled/expired` 상태 전이표를 작성해 보세요.  
3. 완료까지 평균 45초 걸리는 작업을 가정하고, polling 2초와 5초의 상태 조회 비용 차이를 계산해 보세요.  
4. 같은 요청이 3번 중복 제출될 때 멱등성 키가 없으면 어떤 외부 부작용이 발생하는지 시나리오로 적어 보세요.

## 관련 글

- [REST API 설계 원칙](/learning/deep-dive/deep-dive-rest-api-design/)
- [종단간 Deadline Budget과 Cancellation](/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/)
- [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/)
- [Webhook Delivery Reliability 플레이북](/learning/deep-dive/deep-dive-webhook-delivery-reliability-playbook/)
- [Queue Visibility Timeout / Ack-Nack 플레이북](/learning/deep-dive/deep-dive-queue-visibility-timeout-acknack-playbook/)
- [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)
- [WebSocket과 SSE 패턴](/learning/deep-dive/deep-dive-websocket-sse-patterns/)
