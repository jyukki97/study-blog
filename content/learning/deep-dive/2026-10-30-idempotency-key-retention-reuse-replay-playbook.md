---
title: "백엔드 커리큘럼 심화: 멱등 키 보존 기간·재사용·재처리 경계를 설계하는 법"
date: 2026-10-30
draft: false
topic: "Backend Reliability"
tags: ["Idempotency", "API Design", "Retry", "Data Retention", "Distributed Systems", "Backend"]
categories: ["Backend Deep Dive"]
description: "멱등 키를 TTL 캐시가 아니라 요청 의미, 외부 부수효과, 재처리 기간, 보존 정책을 함께 가진 운영 계약으로 설계하는 기준을 정리합니다."
module: "backend-distributed"
study_order: 1263
---

멱등 키는 흔히 `Idempotency-Key` header를 받고 Redis에 하루 보관하는 구현으로 시작합니다. 초반에는 충분해 보이지만, 결제 승인 timeout이 이틀 뒤 고객 문의로 돌아오거나 큐 재처리가 14일 뒤 실행되면 질문이 늘어납니다. “키가 있으면 이전 응답을 주면 되는가?”, “만료된 키는 새 요청인가?”, “결과를 보관하면 개인정보도 함께 보관해야 하는가?”가 그것입니다.

핵심은 멱등 키가 캐시 키가 아니라 **한 번의 비즈니스 의도와 처리 결과를 묶는 식별자**라는 점입니다. 이 글은 [UPSERT·UNIQUE·멱등 키의 쓰기 경로](/learning/deep-dive/deep-dive-upsert-unique-idempotency-write-path-playbook/), [Transactional Inbox와 Idempotent Consumer](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/), [API 오류 의미와 재시도 계약](/learning/deep-dive/deep-dive-api-error-semantics-retryability-contract/), [Poison Message 격리와 안전한 재처리](/learning/deep-dive/deep-dive-poison-message-quarantine-safe-replay-playbook/)를 연결해 보존·재사용·재처리 규칙까지 다룹니다.

## 이 글에서 얻는 것

- API 요청과 이벤트 소비에서 멱등 키의 범위와 수명 주기를 구분할 수 있습니다.
- client retry, queue redelivery, 분쟁 조회 기간을 근거로 TTL을 정할 수 있습니다.
- 같은 키의 payload 변경, 처리 중 충돌, 만료 뒤 재사용을 서로 다른 상태로 처리할 수 있습니다.
- 응답 전문을 오래 남기지 않으면서 중복 외부 효과를 확인할 최소 ledger를 설계할 수 있습니다.

## 핵심 개념/이슈

### 1) 중복 제거 창과 증거 보존 기간은 다르다

멱등 키 TTL을 24시간으로 두는 경우가 많지만, 그 숫자는 대개 SDK 예제에서 왔을 뿐 제품의 중복 가능 기간을 설명하지 못합니다. API client가 30초만 retry해도 모바일 앱의 오프라인 큐는 며칠 뒤 요청을 재전송할 수 있고, consumer는 DLQ replay·장애 복구·backfill 때문에 수 주 뒤 같은 event ID를 받을 수 있습니다.

그래서 먼저 두 기간을 분리합니다. **중복 제거 창**은 같은 의도를 이전 결과로 판정해야 하는 최소 시간입니다. **증거 보존 기간**은 외부 부수효과와 중복 여부를 나중에 조사할 수 있어야 하는 시간입니다. 주문 생성 API가 모바일 재전송을 72시간 허용한다면 결과는 적어도 72시간 살아 있어야 합니다. 결제 문의가 90일 남더라도 response body 전체를 90일 보관할 이유는 없습니다. 72시간 후에는 `key_hash`, 요청 fingerprint, provider operation ID, 최종 상태, 만료 시각만 남기는 ledger로 전환할 수 있습니다.

이 분리는 저장 비용뿐 아니라 민감정보 노출도 줄입니다. response body에는 주소·이메일·상품 상세가 들어갈 수 있지만, 중복을 조사하는 데 필요한 것은 보통 hash·상태·외부 영수증 참조입니다. key 자체도 원문 대신 hash 또는 암호화된 값을 저장해야 로그와 백업이 새로운 유출 경로가 되지 않습니다.

### 2) 키가 같다고 같은 요청은 아니다

키 충돌을 무조건 “이전 성공 응답 반환”으로 처리하면 오류를 숨깁니다. client bug 때문에 `order-41` 키로 10,000원 결제 뒤 100,000원 결제가 들어올 수 있기 때문입니다. 키와 함께 method, canonical path, tenant 또는 principal scope, 정규화된 비즈니스 입력의 hash를 가진 request fingerprint를 저장해야 합니다. authorization header, trace ID, 순서가 무의미한 배열처럼 변동성이 큰 값은 fingerprint에서 제외합니다.

| 도착 상태 | fingerprint | 기본 처리 | 운영 신호 |
| --- | --- | --- | --- |
| `completed` 존재 | 동일 | 저장한 status·결과 참조 반환 | replay 수 증가 |
| `processing` 존재 | 동일 | 새 작업 금지, poll 또는 `202` | lease 초과 여부 |
| 키 존재 | 다름 | `409 conflict` | client key 재사용 조사 |
| TTL 만료, ledger 존재 | 동일 | 재실행 전 상태 조회 | 늦은 retry |
| 키·ledger 없음 | 해당 없음 | 새 작업 시작 | 정상 |

결제·환불·권한 변경처럼 되돌리기 어려운 write에는 “TTL이 끝났으니 새로 실행”을 기본으로 두면 안 됩니다. 만료 뒤 동일 key가 오면 자연 키나 provider operation ID를 한 번 조회합니다. 결과가 불명확하면 `manual_review`로 멈추는 편이 자동 중복 실행보다 안전합니다.

### 3) `processing`은 잠금이 아니라 복구 가능한 lease다

처리 시작 전에 키를 저장했는데 worker가 죽으면 키가 영구 `processing`에 남습니다. 반대로 lease가 너무 짧으면 느린 외부 호출 중 두 번째 worker가 같은 효과를 만듭니다. boolean 하나보다 상태 머신이 필요합니다.

```text
received -> processing -> completed
                  |            |
                  v            v
               uncertain      expired
                  |
                  v
              reconciled
```

외부 provider timeout이 20초이고 내부 retry를 포함해 45초가 걸릴 수 있다면, 초기 lease는 90~120초가 적당합니다. worker는 30초마다 heartbeat를 갱신하고, 만료 뒤에는 즉시 재실행하지 말고 provider 상태를 조회합니다. 조회가 불가능한 external write는 `uncertain`으로 남겨 자동 replay를 막아야 합니다. [Commit 경계와 외부 부수효과](/learning/deep-dive/2026-10-26-commit-boundary-external-side-effects-playbook/)처럼 DB rollback만으로 원격 실행이 없었다고 결론 내릴 수 없기 때문입니다.

### 4) API 키와 이벤트 deduplication key를 섞지 않는다

HTTP API 키는 사용자가 시작한 한 번의 의도를 대표합니다. 메시지 소비의 dedup key는 producer event ID와 consumer effect의 조합이어야 합니다. 같은 `event_id`라도 이메일 consumer와 분석 적재 consumer는 다른 효과를 내므로 단일 dedup table을 공유하면 안 됩니다.

`consumer_name + event_id + effect_version`을 권장합니다. `effect_version`은 버그 수정 뒤 의도적으로 재처리할 때 과거 기록과 새 처리 정책을 구분합니다. 단, version만 올려 중복 방지를 우회하면 위험합니다. 재처리 사유, 대상 건수, 예상 외부 호출 수, 외부 write 금지 여부를 적은 job manifest가 함께 있어야 합니다. 1만 건 이상 backfill은 shadow 결과를 먼저 만들고 100건 표본에서 원본·재처리 결과와 side effect 수를 비교한 뒤 실행하세요.

## 실무 적용

### 1) 결과 캐시와 증거 ledger를 분리한다

작은 서비스도 아래처럼 response와 증거의 수명을 분리할 수 있습니다.

```sql
CREATE TABLE idempotency_record (
  scope_hash       TEXT NOT NULL,
  key_hash         TEXT NOT NULL,
  request_hash     TEXT NOT NULL,
  state            TEXT NOT NULL,
  response_ref     TEXT,
  external_ref     TEXT,
  lease_expires_at TIMESTAMPTZ,
  replay_until     TIMESTAMPTZ NOT NULL,
  evidence_until   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope_hash, key_hash)
);
```

`response_ref`에는 짧은 암호화 응답 또는 object reference를 두고 `replay_until` 뒤에는 body를 삭제합니다. `evidence_until`까지는 request hash, 상태, external reference, 삭제 시각만 남깁니다. scope hash에는 tenant와 principal 또는 resource owner를 포함하세요. 이전 key를 안다고 다른 사용자가 결과를 재생하면 안 되므로 replay 시에도 현재 권한과 resource 상태를 확인합니다.

### 2) 위험도별 기간을 선언하고 측정으로 보정한다

아래는 시작값일 뿐입니다. 실제 retry, 고객 문의, DLQ age를 보고 조정합니다.

| 경로 | replay window | evidence 보존 | 자동 재실행 |
| --- | ---: | ---: | --- |
| 내부 read-model 갱신 | 24시간 | 7일 | event ID 동일 시 가능 |
| 사용자 생성 API | 7일 | 30일 | 동일 hash일 때만 |
| 결제·환불·권한 변경 | 30일 | 규정·분쟁 기간 | 불확실 상태에서는 금지 |
| 외부 알림 발송 | 7일 | 30일 | provider receipt 확인 후만 |

매주 `idempotency_replay_rate`, `key_payload_mismatch_rate`, `processing_lease_expired_total`, `uncertain_state_age_p95`를 봅니다. replay가 0.5%를 넘거나 payload mismatch가 하루 10건 이상이면 client key 생성 규칙을 조사할 신호입니다. `uncertain`이 15분을 넘긴 레코드는 재시도 알림보다 reconciliation worker의 상태 조회가 먼저여야 합니다.

### 3) 배포와 재처리도 키 정책에 넣는다

새 버전이 request canonicalization을 바꾸면 같은 JSON도 다른 hash가 됩니다. hash 알고리즘과 정규화 규칙에는 버전을 붙이고, 최소 replay window 동안 이전 버전 fingerprint도 읽게 유지하세요. rolling deploy 중 구버전 검증 로직을 먼저 지우면 정상 재시도가 `409`으로 바뀔 수 있습니다.

DLQ replay는 버튼 하나가 아니라 별도 운영 작업입니다. 대상 event ID 수, 이미 완료된 비율, 실패 사유, 예상 외부 호출 수를 먼저 산출해야 합니다. [CDC connector lag와 snapshot 복구](/learning/deep-dive/deep-dive-cdc-connector-lag-snapshot-recovery-playbook/)처럼 재처리의 핵심은 빨리 따라잡는 것이 아니라 어느 시점부터 어떤 효과를 다시 낼지 경계를 증명하는 데 있습니다.

## 트레이드오프/주의점

보존 기간을 길게 잡으면 늦은 중복을 잘 막지만 저장 비용과 개인정보 보존 범위가 커집니다. 짧게 잡으면 테이블은 가벼워도 주말 장애 뒤 재전송과 지원 요청을 새 작업으로 오인합니다. full response와 최소 ledger의 수명을 분리하는 이유입니다.

멱등 키는 concurrency control도 대체하지 않습니다. 서로 다른 키로 같은 재고를 차감하거나 같은 상태 전이를 요청하면 optimistic lock, DB constraint, 상태 머신이 별도로 필요합니다. “키가 있으니 안전하다”가 아니라 **같은 의도의 중복만 줄인다**고 범위를 명시해야 합니다.

## 체크리스트 또는 연습

- [ ] write endpoint마다 같은 의도의 범위와 client 최대 retry 시간을 문서화했다.
- [ ] key와 함께 fingerprint, principal/tenant scope, 상태, external reference를 저장한다.
- [ ] 같은 키·다른 payload는 응답 재사용이 아니라 충돌로 처리한다.
- [ ] `processing`은 heartbeat가 있는 lease이며 만료 뒤에는 상태 조회를 한다.
- [ ] response body와 최소 증거 ledger의 보존 기간이 분리돼 있다.
- [ ] 외부 write의 `uncertain` 상태는 자동 replay하지 않는다.
- [ ] 이벤트 재처리는 consumer·effect version·job manifest로 범위를 증명한다.

연습으로 주문 생성 또는 외부 알림 API 하나를 골라 client retry, 모바일 오프라인 재전송, queue redelivery, 고객 문의의 최대 지연을 표로 적으세요. 각 경우에 필요한 replay window와 evidence retention을 계산하고, 같은 key지만 금액 또는 수신자가 다른 요청의 HTTP 상태와 운영 알림을 정하면 TTL이 구현 상수가 아니라 제품 계약이 됩니다.

## 관련 글

- [UPSERT·UNIQUE·멱등 키를 쓰기 경로 기준으로 고르는 법](/learning/deep-dive/deep-dive-upsert-unique-idempotency-write-path-playbook/)
- [Transactional Inbox와 Idempotent Consumer](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/)
- [API 오류 의미와 재시도 계약](/learning/deep-dive/deep-dive-api-error-semantics-retryability-contract/)
- [Poison Message 격리와 안전한 재처리](/learning/deep-dive/deep-dive-poison-message-quarantine-safe-replay-playbook/)
