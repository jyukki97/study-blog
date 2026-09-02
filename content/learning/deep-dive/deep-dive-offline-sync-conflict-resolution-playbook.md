---
title: "백엔드 커리큘럼 심화: 오프라인 동기화, Sync Token·Tombstone·충돌 정책으로 모바일 쓰기를 안전하게 합치는 법"
date: 2026-09-02
draft: false
topic: "Backend Architecture"
tags: ["Offline Sync", "Sync Token", "Conflict Resolution", "Tombstone", "Idempotency", "Mobile Backend"]
categories: ["Backend Deep Dive"]
description: "오프라인 클라이언트의 로컬 변경을 서버에 안전하게 반영하고, 변경 피드·삭제 tombstone·충돌 정책·재동기화 기준을 운영 가능한 계약으로 설계하는 방법을 정리합니다."
module: "backend-data-system"
study_order: 1205
keywords: ["offline sync backend", "sync token", "tombstone", "mobile conflict resolution", "delta sync", "idempotent mutation"]
---

모바일 앱, 현장 태블릿, 데스크톱 클라이언트는 언제든 네트워크가 끊길 수 있습니다. 사용자는 오프라인에서 메모를 수정하고, 체크리스트를 완료하고, 사진과 상태 변경을 쌓아 둡니다. 연결이 돌아오면 서버는 그 변경을 받아야 하고, 클라이언트는 다른 기기에서 생긴 변경도 받아야 합니다. 이 문제를 단순히 “실패하면 다시 POST한다”로 취급하면 중복 쓰기, 삭제된 항목의 부활, 오래된 화면의 덮어쓰기, 무한 전체 내려받기가 차례로 생깁니다.

오프라인 동기화의 본질은 데이터베이스 복제가 아니라 **각 엔터티에서 어떤 변경을 적용하고 어떤 충돌을 사람에게 보낼지 정하는 API 계약**입니다. 이 글은 [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/), [이벤트 스키마 호환성](/learning/deep-dive/deep-dive-event-schema-registry-compatibility-playbook/), [Bounded Staleness와 Read-Your-Writes](/learning/deep-dive/deep-dive-bounded-staleness-read-your-writes-playbook/), [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)와 연결해, 동기화 경계를 백엔드 관점에서 설계합니다.

## 이 글에서 얻는 것

- sync token, 변경 버전, mutation id를 각각 어디에 쓰는지 구분할 수 있습니다.
- 삭제를 즉시 row 제거가 아닌 tombstone 이벤트로 다뤄, 오래 오프라인이었던 기기를 안전하게 따라오게 만들 수 있습니다.
- 서버 우선, 필드 병합, 사용자 충돌 해결 중 어느 정책을 적용할지 데이터 성격별로 결정할 수 있습니다.
- 토큰 만료, 페이지 크기, 재시도, 재동기화, 관측 지표에 숫자 기준을 두고 운영할 수 있습니다.

## 핵심 개념/이슈

### 1) 동기화는 두 종류의 흐름을 분리해야 한다

동기화 API에는 방향이 다른 두 흐름이 있습니다.

1. **upload(클라이언트 → 서버)**: 로컬에서 발생한 create/update/delete 의도를 서버의 도메인 규칙에 따라 반영합니다.
2. **download(서버 → 클라이언트)**: 마지막으로 확인한 지점 이후의 변경을 순서대로 전달합니다.

upload 결과를 download로 대신하면, 사용자는 “내 수정이 저장됐는지”를 오래 기다리고 실패 원인도 알기 어렵습니다. 반대로 upload만 성공 처리하면 다른 기기에서 한 변경과 삭제를 놓칩니다. 따라서 클라이언트는 각 로컬 변경에 안정적인 `mutation_id`를 붙이고, 서버는 별도의 단조 증가 `change_seq` 또는 불변 변경 로그 위치를 내려주는 편이 좋습니다.

```text
로컬 변경: mutation_id + entity_id + base_version + operation + payload
서버 변경 피드: change_seq + entity_id + entity_version + operation + changed_at
```

여기서 `mutation_id`는 재전송 중복을 닫는 키이고, `base_version`은 사용자가 어떤 버전을 보고 편집했는지 말해 주는 충돌 증거입니다. `change_seq`는 “다음에 어디서부터 읽을지”를 위한 포인터입니다. 셋을 하나의 `updated_at` timestamp로 합치면 같은 밀리초의 변경, 서버 간 시계 차이, 정렬 불안정 때문에 다음 페이지를 빠뜨리거나 중복하기 쉬워집니다. 시간 자체의 의미는 [Clock Skew와 시간 의미론](/learning/deep-dive/deep-dive-clock-skew-time-semantics-playbook/)처럼 별도로 다루고, sync cursor는 서버가 발급한 순서 값으로 두는 편이 안전합니다.

### 2) Sync Token은 마지막 시간보다 “일관된 변경 피드 위치”를 표현해야 한다

안전한 download 응답은 변경 목록과 함께 다음 시작 위치를 제공합니다.

```json
{
  "changes": [
    {"seq": 48201, "entity": "task", "id": "t-9", "version": 8, "op": "UPSERT"},
    {"seq": 48202, "entity": "task", "id": "t-3", "version": 4, "op": "DELETE"}
  ],
  "next_sync_token": "feed:v3:48202",
  "has_more": false
}
```

서버는 한 요청에서 읽을 상한 위치를 먼저 고정하고 그 범위만 페이지로 나눠야 합니다. 그렇지 않으면 첫 페이지를 읽는 중 새 변경이 뒤에 끼어들어, `has_more`가 거짓인데도 중간 변경을 건너뛸 수 있습니다. token에는 테넌트, feed format version, cursor 위치, 필요하면 권한 snapshot 식별자를 서명하거나 서버 측 상태로 연결합니다. 사용자가 다른 tenant의 token을 바꿔 끼워도 데이터가 섞이지 않게 해야 합니다.

시작 기준은 아래처럼 작게 잡는 것이 현실적입니다.

| 항목 | 시작 기준 | 이유 |
| --- | --- | --- |
| download page | 100~500 변경 또는 압축 전 1 MiB 이하 | 모바일 메모리와 재시도 비용을 함께 제한 |
| sync token 보존 | 최대 오프라인 허용 기간의 2~3배 | 휴대폰 장기 미접속 뒤에도 증분 복구를 허용 |
| token 예시 | 오프라인 허용 14일이면 30~45일 | 휴가·재설치 지연을 흡수하되 무한 보관은 피함 |
| token 만료 응답 | `410 Gone` + full-resync 안내 | 조용한 부분 동기화보다 명시적 복구가 안전 |
| upload batch | 20~100 mutation | 한 건의 충돌 때문에 전체 재시도가 커지는 것을 방지 |

최대 보존을 지난 token은 억지로 이어 붙이지 않는 편이 낫습니다. 서버는 `full_resync_required`를 명시하고, 클라이언트는 최신 snapshot을 받은 뒤 아직 제출하지 않은 로컬 mutation만 다시 upload합니다. 이때 전체 다운로드를 화면 요청과 같은 트랜잭션으로 만들지 말고, [비동기 요청-응답 Operation Resource](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/)처럼 재개 가능한 별도 작업으로 다루면 대용량 계정도 안정적으로 복구할 수 있습니다.

### 3) 삭제는 tombstone 없이 전달할 수 없다

서버 DB에서 `task t-3`을 바로 제거하면, 20일 동안 오프라인이었던 클라이언트는 그 삭제 사실을 받을 방법이 없습니다. 기기가 가진 오래된 row를 다음 동기화에서 다시 upload하면 삭제된 데이터가 부활할 수도 있습니다. 그래서 변경 피드에는 `DELETE` 이벤트 또는 tombstone이 필요합니다.

tombstone에는 최소한 `entity_id`, 삭제 version, 삭제 시각, 삭제 주체, tenant 범위를 둡니다. 클라이언트는 tombstone version보다 낮은 로컬 수정본을 자동으로 되살리지 않고 충돌 또는 폐기 정책으로 보냅니다. 서버는 tombstone을 token 보존 기간보다 짧게 지우면 안 됩니다. 예를 들어 token을 45일 보관한다면 tombstone은 최소 45일, 감사·복구 요구가 있으면 90일 이상 보관하거나 archive로 옮깁니다.

단, tombstone은 모든 데이터에 동일하게 적용되지 않습니다. 개인정보 삭제처럼 원본과 식별자를 오래 남기면 안 되는 도메인은 [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)의 법적 삭제 흐름을 우선합니다. 이 경우에도 동기화 피드에는 실제 값 대신 “이 리소스는 더 이상 접근할 수 없다”는 최소한의 삭제 marker와 만료 정책을 설계해야 합니다.

### 4) 충돌은 기술 문제가 아니라 도메인별 결정 문제다

두 기기가 같은 제목을 편집했다는 사실만으로 어느 값을 채택할지는 정해지지 않습니다. 다음처럼 도메인별로 정책을 명시해야 합니다.

| 데이터 성격 | 기본 정책 | 이유 |
| --- | --- | --- |
| 읽음 여부, 마지막 접속 시각 | 서버 병합 또는 max 값 | 단일 진실값보다 단조성 유지가 중요 |
| 개인 메모 초안 | 사용자 선택 또는 revision 보관 | 조용한 덮어쓰기가 사용자 손실로 이어짐 |
| 체크리스트 항목 완료 | 상태 전이 규칙 + version 검증 | 완료 후 미완료로 되돌리는 효과를 통제 |
| 재고, 결제, 권한 | 서버 권위 + 충돌 거절 | 클라이언트 병합이 정합성·보안 경계를 깨면 안 됨 |
| 태그 집합 | add/remove 연산 로그 병합 검토 | 마지막 전체 목록 덮어쓰기보다 의도가 보존됨 |

가장 위험한 기본값은 `last write wins`입니다. 구현은 쉬워도 늦게 재접속한 클라이언트의 과거 시계가 최신 서버 값을 덮을 수 있고, 사용자는 잃은 내용을 알아차리지 못합니다. 정말 허용할 수 있는 필드에만 서버 수신 시각 기준 last-write-wins를 쓰고, 그 밖에는 `base_version` 불일치에 대해 `409 Conflict`와 현재 서버 revision을 돌려주는 편이 낫습니다. 충돌 화면에서 재시도할 때도 새 `mutation_id`를 만들지 말고, 같은 작업인지 새 병합 작업인지 구분해 감사 가능하게 남겨야 합니다.

### 5) exactly-once 동기화보다 멱등 mutation과 순서 규칙이 먼저다

모바일 네트워크는 응답을 받은 뒤에도 앱이 결과를 저장하기 전에 종료될 수 있습니다. 따라서 “성공 응답을 한 번만 보낸다”는 보장은 충분하지 않습니다. 서버는 `(actor_id, mutation_id)`에 unique 제약을 두고, 최초 처리 결과를 저장해 같은 mutation을 다시 받으면 같은 결과를 돌려줘야 합니다. 이 구조는 [Transactional Inbox와 Idempotent Consumer](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/)의 소비자 중복 방지 원리와 같습니다.

하지만 멱등성만으로 `A 수정 → B 삭제 → 오래된 A 수정 재전송`의 업무 의미를 해결하지는 못합니다. entity version, 허용 상태 전이, tombstone 우선순위를 함께 둬야 합니다. 우선순위는 **권한·도메인 불변식 > 삭제와 상태 전이 > 사용자 데이터 손실 방지 > 동기화 속도**입니다.

## 실무 적용

### 1) 서버 API를 snapshot, change feed, mutation ledger로 나눈다

처음부터 복잡한 양방향 CRDT를 도입하기보다 아래 세 API로 시작하는 편이 좋습니다.

1. `GET /sync/snapshot`: token이 만료됐을 때 현재 허용 데이터와 baseline token을 발급합니다.
2. `GET /sync/changes?token=...`: baseline 뒤의 UPSERT/DELETE를 안정 순서로 페이지 처리합니다.
3. `POST /sync/mutations`: mutation_id, base_version, operation을 받아 개별 성공·충돌·검증 오류를 반환합니다.

mutation 처리에서는 도메인 row 변경, mutation ledger 기록, change feed append를 가능한 한 같은 트랜잭션에 묶습니다. 별도 저장소 때문에 완전히 같은 트랜잭션이 불가능하다면 [Transactional Outbox와 CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)처럼 발행 지연을 관측하고, feed 누락을 찾는 reconciliation job을 둡니다. 응답 성공만 기록하고 feed append가 유실되면 다른 기기는 영구히 변화를 보지 못합니다.

### 2) 충돌율을 먼저 관측하고 자동 병합은 나중에 넓힌다

초기에는 충돌을 숨기지 말고 `conflict_total{entity,reason}`으로 기록하세요. conflict가 전체 mutation의 0.1% 미만이고 대부분 오래된 앱 버전에서만 생긴다면 안내·업데이트 유도가 먼저입니다. 반대로 특정 엔터티가 1% 이상 충돌하거나 동일 사용자가 반복 충돌한다면 데이터 모델 또는 화면 저장 단위가 너무 거친 신호입니다.

canary는 한 엔터티와 내부 사용자부터 시작합니다. 7일 동안 다음 조건을 함께 확인합니다.

- 중복 mutation 재처리 결과가 100% 동일하다.
- `token_expired` 뒤 full resync 성공률이 99.9% 이상이다.
- tombstone을 받은 뒤 오래된 로컬 row가 되살아나는 사건이 0건이다.
- change feed lag p95가 사용자 요구 시간 안에 있다. 협업 task라면 예를 들어 5초, 비핵심 설정이라면 수 분도 허용될 수 있습니다.

### 3) 권한 변경은 동기화 순서보다 먼저 검증한다

sync token이 유효해도 사용자의 tenant, 조직 역할, 공유 권한은 달라질 수 있습니다. download 요청마다 현재 권한을 확인하고, 더 이상 볼 수 없는 entity를 token에 있었던 이유만으로 보내지 않아야 합니다. upload도 `base_version`보다 권한 검사를 먼저 합니다. “오프라인에서 수정했으니 나중에도 저장해 준다”는 규칙은 퇴사자, 프로젝트 제외 사용자, 회수된 기기에 권한을 되돌려 줄 수 있습니다.

권한 회수 뒤 어떤 로컬 사본을 지울지, 화면에서는 무엇을 보여 줄지, 서버는 어떤 audit event를 남길지까지 결정해야 합니다. 기기·세션 회수는 [Device Session Registry와 Revocation](/learning/deep-dive/deep-dive-device-session-registry-revocation-playbook/)를 함께 검토하세요.

## 트레이드오프/주의점

첫째, 증분 동기화는 전체 snapshot보다 대역폭이 작지만 변경 피드 보존, token 포맷, tombstone, replay 검증이 필요합니다. 계정당 데이터가 작고 하루 한 번만 접속한다면 매번 snapshot이 오히려 더 단순할 수 있습니다. 데이터량이 커지거나 여러 기기에서 자주 수정할 때 delta sync의 비용 절감이 커집니다.

둘째, 자동 병합은 충돌율을 낮추지만 사용자가 의도하지 않은 결과를 만들 수 있습니다. 태그 집합처럼 연산 의미가 분명한 데이터부터 시작하고, 자유 텍스트나 권한·금전 값은 원문 revision 보관과 사용자 선택을 우선하세요.

셋째, offline queue는 영구 저장이 필요합니다. 앱 메모리에만 mutation을 두면 종료 시 유실되고, 암호화되지 않은 로컬 저장소에 민감 payload를 남기면 기기 탈취 위험이 생깁니다. 민감도에 따라 로컬 암호화, 재인증 전송, 최대 오프라인 기간을 별도로 정해야 합니다.

넷째, 긴 재동기화가 DB와 API를 압박할 수 있습니다. 전체 snapshot에는 pagination, 압축, tenant별 동시성 상한, 재개 token을 두고, 대량 동기화는 온라인 API pool과 분리하는 것이 좋습니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 모든 로컬 쓰기에 actor 범위의 `mutation_id`와 서버가 보관하는 결과 ledger가 있다.
- [ ] sync token은 timestamp가 아니라 tenant·format·변경 피드 위치에 연결된 불투명 포인터다.
- [ ] token 만료 시 명시적으로 `410` 또는 동등한 full-resync 절차를 제공한다.
- [ ] tombstone 보존 기간이 최대 token 보존 기간 이상이며, 개인정보 삭제 예외 정책이 있다.
- [ ] entity별 충돌 정책과 `base_version` 불일치 응답이 문서화돼 있다.
- [ ] mutation ledger, 도메인 변경, change feed 발행의 유실을 탐지하거나 원자적으로 묶었다.
- [ ] 권한 변경 뒤 download와 upload가 모두 현재 권한을 재검증한다.

### 연습

1. 현재 서비스의 한 엔터티를 골라 “서버 우선, 필드 병합, 사용자 선택” 중 하나의 충돌 정책을 고르고, 그 이유와 금지해야 할 병합 사례를 두 개씩 적어 보세요.
2. 최대 14일 오프라인을 허용한다고 가정하고 token/tombstone 보존 기간, 페이지 크기, full-resync 조건을 숫자로 설계해 보세요.
3. `수정 성공 직후 앱 종료`, `삭제 뒤 오래된 수정 재전송`, `권한 회수 뒤 재접속` 세 상황의 API 응답과 화면 동작을 순서도로 작성해 보세요.

## 관련 글

- [멱등성 설계](/learning/deep-dive/deep-dive-idempotency/)
- [Transactional Inbox와 Idempotent Consumer](/learning/deep-dive/deep-dive-transactional-inbox-idempotent-consumer-playbook/)
- [이벤트 스키마 호환성](/learning/deep-dive/deep-dive-event-schema-registry-compatibility-playbook/)
- [Bounded Staleness와 Read-Your-Writes](/learning/deep-dive/deep-dive-bounded-staleness-read-your-writes-playbook/)
- [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)
