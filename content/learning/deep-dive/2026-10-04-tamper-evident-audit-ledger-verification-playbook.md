---
title: "백엔드 커리큘럼 심화: 변조 감지형 감사 원장, append-only 로그를 검증 가능한 증거로 만드는 법"
date: 2026-10-04T10:06:00+09:00
lastmod: 2026-10-04T10:06:00+09:00
draft: false
topic: "Security Architecture"
tags: ["Audit Log", "Tamper Evidence", "Hash Chain", "Data Integrity", "Backend Security", "Compliance"]
categories: ["Backend Deep Dive", "Security"]
description: "감사 로그를 단순한 append-only 테이블로 끝내지 않고, canonical payload·hash chain·외부 anchor·권한 분리·검증 job까지 포함한 변조 감지 원장으로 설계하는 기준을 정리합니다."
module: "security"
study_order: 1528
summary: "감사 로그의 행이 삭제되지 않는다는 사실만으로는 운영자 권한·백업 복구·순서 변경·선택적 수정에 대한 증명이 되지 않는다. 무엇을 기록할지, 어떤 바이트를 해시할지, 누가 키를 보유할지, 언제 독립적으로 검증할지를 먼저 계약으로 정해야 감사 로그가 사후 설명 가능한 증거가 된다."
keywords: ["tamper evident audit log", "audit hash chain", "append only ledger", "감사 로그 무결성", "변조 감지 원장"]
key_takeaways:
  - "append-only는 쓰기 경로의 성질일 뿐, 관리자·복구 작업·저장소 권한을 포함한 변조 감지 증명은 아니다."
  - "각 event의 canonical payload와 이전 hash를 함께 해시하고, 일정 구간의 root를 독립 저장소에 anchor해야 삭제·재정렬·수정을 발견할 수 있다."
  - "원본 PII를 해시에 무심코 넣으면 삭제·열람 요청과 충돌할 수 있으므로 최소 식별자, key version, 보존 정책을 분리한다."
  - "검증 실패는 단일 보안 알람이 아니라 원장 복구·권한 중지·배포 보류까지 이어지는 운영 절차여야 한다."
operator_checklist:
  - "감사 event에 actor, action, target, outcome, request/correlation id, 발생 시각, schema version, 정책 결정 근거를 남긴다."
  - "DB sequence가 아니라 event id와 canonical serialization을 해시 입력으로 고정하고, hash algorithm·key version을 record한다."
  - "일 단위 또는 10만 건 단위 중 먼저 도달하는 경계에서 root를 WORM bucket·별도 계정·서명된 release record에 anchor한다."
  - "원장 writer, 운영 조회자, backup 복구자, anchor verifier에 서로 다른 최소 권한을 주고 분기별 복구 훈련을 한다."
---

접근 권한 변경, 결제 취소, 운영자 impersonation, 데이터 export처럼 나중에 “누가 어떤 근거로 무엇을 했는가”를 설명해야 하는 작업은 애플리케이션 로그만으로 충분하지 않습니다. 일반 로그는 조회와 장애 분석에는 좋지만 rotation, 샘플링, 필드 변경, 권한 있는 운영자의 수정 가능성을 전제합니다. 감사 원장은 더 좁은 질문을 다룹니다. **기록이 있었다는 사실과 기록 사이의 순서가 사후에 조용히 바뀌지 않았음을 어느 수준까지 입증할 수 있는가**입니다.

여기서 흔한 오해는 `INSERT`만 허용하는 테이블을 만들면 감사 로그가 완성된다는 것입니다. 삭제 권한을 가진 계정, restore 과정, 잘못된 backfill, clock 변경, 이벤트의 선택적 누락은 append-only 제약 밖에서 일어납니다. 반대로 모든 event를 블록체인처럼 다루는 것도 답이 아닙니다. 비용과 복구 복잡도만 커지고, 어떤 업무 사실을 기록해야 하는지와 권한 분리가 불명확하면 증거의 품질은 나아지지 않습니다.

이 글은 [활동 타임라인과 Event Feed](/learning/deep-dive/deep-dive-activity-timeline-event-feed-playbook/), [운영 작업의 Execution Receipt](/learning/deep-dive/deep-dive-execution-receipt-operations-playbook/), [Reconciliation Ledger 파이프라인](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/), [PII 필드 암호화](/learning/deep-dive/deep-dive-envelope-encryption-pii-field-crypto-playbook/)를 연결합니다. 핵심은 “로그를 많이 남긴다”가 아니라, 업무 이벤트·검증 재료·키·보존·복구 책임을 분리해 **검증 가능한 기록 경로**를 만드는 것입니다.

## 이 글에서 얻는 것

- 운영 로그, 사용자 타임라인, 감사 원장을 목적과 보존 규칙으로 구분할 수 있습니다.
- hash chain과 주기적 anchor가 각각 어떤 변조를 발견하고, 무엇을 발견하지 못하는지 이해합니다.
- PII, 키 회전, 다중 writer, 백업 복구가 있는 환경에서 원장을 설계하는 순서를 잡습니다.
- 검증 실패를 발견했을 때 조사를 시작할 수 있는 지표·중단 기준·연습 절차를 만듭니다.

## 핵심 개념/이슈

### 1) append-only와 tamper-evident는 다른 약속이다

append-only 테이블은 애플리케이션의 정상 쓰기 경로에서 기존 행을 `UPDATE`·`DELETE`하지 않겠다는 약속입니다. 하지만 DBA 권한, 복제 지연, point-in-time restore, ETL 실수까지 막아 주지는 않습니다. tamper-evident 원장은 과거 행을 바꿀 수 없게 만든다는 과장된 약속 대신, **바뀌었다면 검증에서 흔적이 남는다**는 더 현실적인 목표를 둡니다.

가장 단순한 체인은 event마다 아래 값을 저장하는 방식입니다.

```text
event_hash = H(schema_version || event_id || occurred_at || canonical_payload || previous_hash)
```

`previous_hash` 때문에 중간 행 하나를 고치거나 제거하면 이후 hash가 모두 맞지 않습니다. 단, DB가 원장 전체를 다시 쓰고 마지막 hash도 바꿀 수 있는 권한을 가진 공격자라면 chain 하나로는 부족합니다. 그래서 일정 구간의 마지막 hash 또는 Merkle root를 **다른 권한 경계**에 anchor합니다. 예를 들어 원장 DB와 분리된 계정의 WORM object storage, 중앙 보안 계정의 서명된 manifest, 외부 timestamping service가 후보입니다. anchor 이전 구간의 재작성은 anchor 값과 불일치하게 됩니다.

| 보호하려는 문제 | chain만으로 감지 | 별도 설계가 필요한 부분 |
| --- | --- | --- |
| 행 내용 수정 | 가능 | canonical serialization이 고정돼야 함 |
| 중간 행 삭제·삽입 | 가능 | verifier가 연속 구간 전체를 읽어야 함 |
| 마지막 행 삭제 | 불완전 | 다음 anchor 또는 expected sequence가 필요 |
| DB 전체 restore 후 재작성 | 불완전 | DB 밖 immutable anchor와 권한 분리 필요 |
| 애초에 event를 기록하지 않음 | 불가능 | 업무 상태·권한 결정과 audit event의 대조 필요 |

따라서 “해시를 쓴다”보다 먼저 어떤 공격·실수 모델을 막을지 적어야 합니다. 고객이 결제 취소를 요청한 사실을 증명해야 한다면 payment state transition과 audit event를 reconciliation합니다. 운영자가 admin 권한을 부여한 사실을 증명해야 한다면 authorization decision과 impersonation receipt를 함께 남깁니다. 누락 자체는 hash chain이 아니라 **독립된 업무 원장과의 대사**로 드러납니다.

### 2) 해시할 것은 JSON 문자열이 아니라 canonical event다

같은 JSON도 field 순서, 공백, timestamp 형식, null 생략 여부에 따라 바이트가 달라집니다. serializer 버전을 올린 뒤 이전 event의 hash를 재현하지 못하면 원장은 스스로를 검증할 수 없습니다. 해시 입력은 사람이 보기 좋은 JSON이 아니라 schema가 정의한 canonical representation이어야 합니다. UTF-8, field ordering, decimal scale, timezone 표기, optional field의 존재 규칙을 정하고 `schema_version`을 event에 포함합니다.

event에는 적어도 `event_id`, `tenant_id` 또는 scope, `actor_type/id`, `action`, `target_type/id`, `outcome`, `occurred_at`, `request_id`, `policy_version`, `payload_digest`, `previous_hash`, `hash_algorithm`, `key_version`을 고려합니다. 업무 payload 전체를 그대로 넣을 필요는 없습니다. 주소·토큰·파일 원문처럼 보존이 위험한 값은 최소화하고, 필요한 경우 접근 통제된 evidence object의 ID와 digest만 남깁니다. “감사용이라 삭제할 수 없다”는 이유로 PII를 영구 복제하면 보존·삭제 의무와 충돌합니다.

순서도 조심해야 합니다. 서버 clock은 완벽하지 않고, 여러 region writer의 `occurred_at`은 역전될 수 있습니다. 검증 순서는 일반적으로 database가 부여한 `ledger_sequence` 또는 partition별 monotonic sequence로 결정하고, 업무 발생 시각은 별도 필드로 보관합니다. 전역 단일 sequence가 초당 수만 건의 병목이 된다면 tenant 또는 region partition마다 chain을 나누고, partition ID와 anchor root 목록을 함께 관리합니다. 이때 “전역 시간순”이라는 제품 요구가 정말 필요한지부터 확인해야 합니다.

### 3) writer 권한과 verifier 권한이 같으면 증거 경계가 없다

애플리케이션이 원장을 쓰고 같은 배포 자격 증명이 anchor 버킷을 수정하며, 같은 운영자가 verifier 결과를 무시할 수 있다면 hash chain은 우발적 오류 탐지에는 쓸모가 있어도 강한 감사 증거는 아닙니다. 최소한 다음 역할을 분리합니다.

1. **writer**: 신규 event와 이전 hash만 삽입한다. 과거 파티션 수정 권한은 없다.
2. **anchor publisher**: 닫힌 구간의 root를 별도 저장소에 쓰며, 원장 테이블 수정 권한은 없다.
3. **verifier**: read-only로 chain과 anchor를 재계산하고, 실패 결과를 독립된 alert sink에 낸다.
4. **recovery operator**: 복구는 할 수 있지만 anchor를 덮어쓰지 못하며, 복구 사실도 별도 event로 남긴다.

키가 필요한 HMAC 방식이라면 원장 writer와 verifier의 키 접근 범위도 분리해야 합니다. 공개 검증이 필요하면 서명 방식이 적합할 수 있지만 signing latency·키 운영 비용이 늘어납니다. 내부 변조 감지가 목적이고 검증 서비스가 신뢰 경계 안에 있으면 HMAC + 분리된 key management로 시작할 수 있습니다. 중요한 것은 알고리즘 이름이 아니라, 키 교체 후에도 과거 `key_version`으로 검증할 수 있고 폐기된 키로 새 event를 만들 수 없다는 운영 절차입니다.

## 실무 적용

### 1) 감사 대상과 증거 최소 단위를 먼저 정한다

첫 rollout에서 모든 CRUD를 원장에 넣지 마세요. 권한 변경, 금전 상태 변경, 데이터 export/delete, 운영자 impersonation, 정책 예외 승인처럼 고위험 action **5~10개**를 고릅니다. 각 action에 대해 “누가, 어떤 대상에, 어떤 정책 버전으로, 성공·거절·부분 실패 중 무엇을 했는가”를 답할 최소 event schema를 작성합니다. 읽기 조회까지 무차별 기록하면 비용과 민감 정보가 폭증해 정작 중요한 event를 찾기 어려워집니다.

업무 테이블과 audit event의 관계도 명시합니다. 예를 들어 role grant transaction이 commit될 때 `authorization_granted` event가 같은 outbox에 기록되도록 만들면 “권한은 있는데 audit event가 없다”를 대사할 수 있습니다. 비동기 전송이라면 [실행 영수증](/learning/deep-dive/deep-dive-execution-receipt-operations-playbook/)처럼 request ID, outcome, retry attempt를 남겨 요청 수와 기록 수를 비교하세요. 24시간 동안 audit event 수가 대응하는 업무 transition의 **99.99% 미만**이면 원장 무결성 이전에 기록 경로 누락 incident로 분류하는 편이 낫습니다.

### 2) 작은 chain과 독립 anchor를 canary로 검증한다

처음에는 tenant 하나 또는 admin action 하나에 partitioned chain을 적용합니다. `event_hash` 계산은 DB trigger보다 애플리케이션 outbox consumer에서 시작할 수 있지만, 재시도 때 동일 `event_id`가 다른 previous hash를 갖지 않도록 unique constraint와 idempotency를 둡니다. event가 초당 500건 이하라면 **5분 또는 10,000건** 중 먼저 닫히는 구간을 anchor하는 방식이 실용적인 시작점입니다. 더 높은 처리량에서는 partition별 root를 만들고 1시간마다 root-of-roots를 외부에 anchor할 수 있습니다.

verifier는 5분마다 직전 닫힌 구간을 검사하고, 하루 한 번은 최근 **30일** anchor를 표본이 아닌 전체 재검증합니다. 정상 조건은 chain gap 0건, anchor mismatch 0건, 검증 지연 p95 15분 이하처럼 숫자로 둡니다. verifier가 DB 읽기 부하를 만들면 replica 또는 immutable export를 쓰되, replica lag 자체도 관측합니다. 단순히 verifier job이 성공했다는 것보다 마지막으로 검증한 sequence와 anchor ID를 dashboard에 보여 주는 편이 좋습니다.

### 3) 실패 처리는 보안 경보와 업무 중단을 구분한다

anchor mismatch는 일반 application error가 아닙니다. production에서는 원장 writer의 신규 기록을 멈추기보다, 먼저 고위험 action을 `hold`하고 security owner에게 page하며 원본·replica·anchor 저장소의 read-only snapshot을 확보하는 절차가 필요합니다. 모든 로그인이나 읽기 트래픽까지 중단하면 단일 verifier 장애가 서비스 장애로 번질 수 있습니다.

권장 우선순위는 다음과 같습니다. (1) verifier의 code·key·clock·replica lag처럼 재현 가능한 오류를 확인하고, (2) 영향 구간과 last known-good anchor를 고정하며, (3) 고위험 mutation을 제한하고, (4) 독립 계정에서 다시 검증한 뒤, (5) 복구·backfill은 새 event와 incident reference로 남깁니다. 원장을 고치기 위해 과거 hash를 조용히 재생성해서는 안 됩니다. 그것은 무결성 실패를 숨기는 행위입니다.

## 트레이드오프/주의점

1. **hash chain은 신뢰의 시작점이지 진실 생성기가 아니다.** 업무 시스템이 event를 아예 만들지 않으면 chain은 완벽하게 이어져도 누락을 말해 주지 못한다. 상태 대사와 정책 decision log가 필요하다.
2. **전역 순서는 비용이 크다.** 모든 region과 tenant를 하나의 sequence로 묶으면 latency와 가용성이 악화된다. 법적·제품적 요구가 없으면 partition 순서와 명시적 correlation으로 충분한지 먼저 판단한다.
3. **PII를 무결성 명목으로 장기 보관하지 않는다.** 원본 대신 최소 metadata, encrypted evidence reference, digest를 사용하고, 법적 보존 기간과 키 폐기 절차를 함께 설계한다.
4. **anchor 저장소도 운영 대상이다.** WORM 설정, retention lock, 별도 계정, 복구 권한, 비용, export 실패 alert가 없으면 “DB 밖에 복사했다”는 말만 남는다.
5. **검증은 복구 절차를 시험해야 한다.** happy path hash 재계산만 성공해도 권한 오남용·restore·키 회전 중에 verifier가 멈춘다면 실제 증거 가치는 낮다.

## 체크리스트 또는 연습

### 도입 체크리스트

- [ ] 고위험 action 5~10개와 각 action의 최소 audit schema를 정의했다.
- [ ] `event_id`, canonical payload 규칙, schema/hash/key version, partition sequence를 명시했다.
- [ ] writer·anchor publisher·verifier·recovery operator의 권한을 분리했다.
- [ ] 5분/10,000건 등 anchor 경계와 anchor 저장 위치의 retention policy를 정했다.
- [ ] 업무 state transition과 audit event를 대사해 누락률을 측정한다.
- [ ] verifier의 gap, anchor mismatch, last verified sequence, verification lag에 임계값이 있다.
- [ ] mismatch 때 snapshot·hold·재검증·복구 event를 남기는 runbook을 리허설했다.

### 연습

관리자 권한 부여 기능 하나를 고르고 `request → policy decision → role mutation → audit event → anchor → verifier` 흐름을 그려 보세요. 이어서 (a) event 한 행 삭제, (b) backup restore 후 과거 event 수정, (c) writer key 교체 중 재시도라는 세 상황에서 어느 검사가 실패하는지 적습니다. 마지막으로 권한 부여 테이블의 일별 transition 수와 audit event 수가 어긋날 때, hash mismatch와 누락 incident를 어떻게 구분할지 정리하면 설계의 빈 곳이 드러납니다.

## 관련 글

- [활동 타임라인과 Event Feed를 설계하는 법](/learning/deep-dive/deep-dive-activity-timeline-event-feed-playbook/)
- [운영 작업의 Execution Receipt와 재현 가능한 영수증](/learning/deep-dive/deep-dive-execution-receipt-operations-playbook/)
- [Reconciliation Ledger로 업무 상태를 대사하는 법](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)
- [Envelope Encryption과 PII 필드 보안](/learning/deep-dive/deep-dive-envelope-encryption-pii-field-crypto-playbook/)
