---
title: "백엔드 커리큘럼 심화: 삭제 전파와 Erasure Evidence, 사용자 삭제를 ‘완료’라고 말할 수 있는 기준"
date: 2026-10-06T10:06:00+09:00
lastmod: 2026-10-06T10:06:00+09:00
draft: false
topic: "Backend Privacy Architecture"
tags: ["Data Deletion", "Privacy", "Retention", "Tombstone", "Object Storage", "Backend Reliability"]
categories: ["Backend Deep Dive", "Data Architecture"]
description: "사용자·테넌트 데이터 삭제를 단일 DELETE가 아니라 데이터 인벤토리, tombstone, 비동기 전파, 보존 예외, 검증 가능한 deletion evidence로 설계하는 실무 플레이북입니다."
module: "backend-data-governance"
study_order: 1441
keywords: ["data deletion architecture", "erasure evidence", "deletion propagation", "privacy deletion workflow", "tombstone retention"]
---

사용자 삭제 요청을 받았을 때 `DELETE FROM users WHERE id = ?`를 실행하면 끝났다고 생각하기 쉽습니다. 실제 서비스에서 사용자 데이터는 사용자 테이블 하나에만 있지 않습니다. 주문·권한·감사 로그·검색 인덱스·캐시·파일 저장소·분석 웨어하우스·비동기 큐·백업에 서로 다른 형태와 보존 기간으로 남습니다. 일부는 지워야 하고, 일부는 법적·회계적 이유로 식별자를 분리한 채 보존해야 하며, 일부는 다음 배치가 돌 때까지 즉시 지울 수 없습니다.

따라서 삭제의 목표는 “모든 바이트를 지금 즉시 없앤다”가 아니라 **어떤 데이터가 어떤 근거로 언제 접근 불가능해졌고, 어떤 예외가 언제 만료되는지 증명할 수 있는 상태**를 만드는 것입니다. 이 글은 [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/), [테넌트 오프보딩](/learning/deep-dive/deep-dive-tenant-lifecycle-offboarding-playbook/), [검색 인덱스 동기화·재색인](/learning/deep-dive/deep-dive-search-index-sync-reindexing-playbook/), [Object Storage와 S3](/learning/deep-dive/deep-dive-object-storage-s3/)를 하나의 삭제 실행 관점으로 연결합니다.

## 이 글에서 얻는 것

- 삭제 요청, 접근 차단, 물리 삭제, 보존 예외를 서로 다른 상태로 분리하는 방법을 배웁니다.
- DB·캐시·검색·객체 저장소·큐·분석계에 삭제를 전파하는 우선순위를 정합니다.
- tombstone과 deletion job을 써서 늦게 도착한 이벤트가 데이터를 되살리지 못하게 하는 기준을 만듭니다.
- “삭제했다”는 응답을 로그가 아니라 범위·상태·예외가 담긴 evidence로 검증하는 방법을 익힙니다.

## 핵심 개념/이슈

### 1) 논리 삭제, 접근 차단, 물리 삭제는 같은 일이 아니다

삭제에는 적어도 네 단계가 있습니다.

| 단계 | 하는 일 | 사용자에게 약속할 수 있는 것 |
| --- | --- | --- |
| 요청 수락 | 대상·권한·법적 hold를 확인하고 작업 ID를 만든다 | 요청이 유실되지 않았다 |
| 접근 차단 | 로그인, API 토큰, 세션, 캐시 조회를 즉시 막는다 | 더 이상 일반 경로로 보이지 않는다 |
| 전파 삭제 | 각 저장소의 제거·익명화·키 폐기를 비동기로 수행한다 | 범위별 작업이 진행 중이다 |
| 완료 검증 | 재조회, 표본 검증, 예외 만료를 확인한다 | 정의한 삭제 정책을 충족했다 |

`deleted_at`만 채우는 soft delete는 첫 두 단계에 도움을 줄 수 있지만 물리 삭제 자체는 아닙니다. 반대로 객체를 먼저 지우면 DB의 참조, 검색 문서, CDN 캐시가 남아 “없는 파일”을 계속 노출할 수 있습니다. 가장 먼저 보호할 것은 저장 용량이 아니라 **새 접근과 새 처리의 차단**입니다. 인증 토큰 폐기, tenant status 변경, cache key 차단, worker의 대상 제외가 DB 배치보다 앞서야 하는 이유입니다.

### 2) 삭제 범위는 테이블 목록이 아니라 데이터 흐름 목록으로 만든다

데이터 인벤토리를 `users`, `orders` 같은 테이블 목록으로만 만들면 비정규 경로를 빠뜨립니다. 다음 다섯 범주로 나누면 누락을 줄일 수 있습니다.

1. **원본 시스템**: 사용자 프로필, 권한, 업무 데이터, 연결된 계정
2. **파생 저장소**: Redis, 검색 인덱스, materialized view, 추천 feature
3. **외부·파일 저장소**: object key, CDN, 이메일·분석 SaaS export
4. **비동기 경로**: outbox, 큐 메시지, 재시도·DLQ, scheduled job payload
5. **복구·감사 경로**: 백업, WAL, 보안 감사 로그, 법적 보존 레코드

범주마다 행동도 달라집니다. 캐시는 짧은 TTL을 기다리기보다 즉시 purge해야 하고, 검색은 delete-by-ID 뒤 재색인 검증이 필요합니다. 암호화된 대형 파일은 per-tenant data-encryption key를 폐기해 빠르게 읽기 불가능하게 만들 수 있지만, 키 폐기가 실제 object lifecycle 삭제를 대신하지는 않습니다. 백업은 보통 즉시 재작성보다 “복구 시 tombstone 정책을 재적용한다”는 통제가 현실적입니다.

### 3) tombstone은 늦게 온 데이터의 부활을 막는 안전장치다

삭제 직후 오래된 이벤트가 도착하거나, 실패한 worker가 과거 payload를 다시 실행하는 일은 흔합니다. 이때 원본 row만 없애면 consumer가 “없으니 새로 생성”하는 버그가 생길 수 있습니다. 삭제 대상에 대해 최소한 아래 정보를 가진 tombstone을 둡니다.

```text
subject_type=user
subject_id=usr_123
deletion_request_id=del_20261006_001
effective_at=2026-10-06T10:06:00+09:00
policy_version=privacy-v4
recreate_policy=deny
expires_at=2027-10-06T00:00:00+09:00
```

consumer는 이벤트의 발생 시각과 tombstone의 `effective_at`을 비교합니다. 삭제 이전 이벤트라도 새 상태를 만들려 하면 차단·quarantine하고, 복구가 필요한 업무 데이터라면 담당자 승인으로만 해제합니다. 일반 사용자 데이터의 tombstone 보존은 적어도 최대 큐 지연, 최대 retry 기간, 백업 복구 윈도를 합친 기간보다 길어야 합니다. 예를 들어 큐 재처리가 최대 14일이고 백업 복구가 90일 안에 가능하다면, 30일 tombstone은 너무 짧습니다.

### 4) ‘완료’는 저장소별 결과를 모은 evidence다

운영자는 삭제 완료 여부를 한 개의 boolean으로 보고 싶어 합니다. 그러나 구현은 storage별 상태를 유지하는 편이 정직합니다.

```yaml
deletion_evidence:
  request_id: del_20261006_001
  subject_ref: user:usr_123
  access_blocked_at: 2026-10-06T10:06:04+09:00
  scopes:
    primary_db: erased
    search_index: verified_absent
    object_storage: key_revoked_pending_lifecycle
    queue_payloads: quarantined
    analytics: anonymized
    backup: expires_on_restore_policy
  exceptions:
    - reason: accounting_retention
      fields: [invoice_number, amount, tax_date]
      expires_at: 2031-10-06
```

이 구조는 개인정보 원문을 evidence에 복사하라는 뜻이 아닙니다. 내부 subject reference, 정책 버전, 작업 결과, hash나 count만 남겨야 합니다. 완료 기준도 숫자로 고정합니다. 예를 들어 접근 차단은 **5분 이내**, hot storage와 검색 제거는 **24시간 이내**, cold tier lifecycle은 **30일 이내**, 실패 작업은 **24시간 안에 담당자에게 escalation**처럼 잡습니다. 정답인 숫자는 없지만, 없으면 삭제는 결국 백그라운드 작업의 희망 사항이 됩니다.

## 실무 적용

### 1) 삭제 오케스트레이션을 상태 머신으로 둔다

한 HTTP 요청에서 모든 저장소를 순회하지 마세요. timeout과 partial failure 때문에 사용자는 실패 응답을 받았는데 일부는 이미 지워진 상태가 됩니다. 권장 흐름은 다음과 같습니다.

1. API가 대상 소유권·요청 유형·legal hold를 확인하고 `deletion_request`를 만든다.
2. 같은 트랜잭션에서 account 상태를 `DELETING`으로 바꾸고 tombstone/outbox를 기록한다.
3. access-control·session·cache worker가 우선 실행되어 새 접근을 막는다.
4. 저장소별 worker가 독립적으로 erase, anonymize, key revoke, purge를 수행한다.
5. verifier가 표본 재조회와 count 검증을 수행하고 evidence를 갱신한다.
6. 실패가 SLA를 넘으면 재시도 lane이 아니라 담당 owner에게 보낸다.

이때 상태는 `REQUESTED → BLOCKED → PROPAGATING → VERIFYING → COMPLETED` 정도로 작게 시작합니다. `FAILED`는 모든 일을 되돌린다는 뜻이 아니라, 사람이 확인해야 할 예외가 생겼다는 뜻으로 정의합니다. [운영 상태 머신 설계](/learning/deep-dive/deep-dive-operational-state-machine-design/)처럼 상태 전이의 actor와 허용 조건을 먼저 정하면 복구도 안전해집니다.

### 2) 우선순위는 개인 식별 가능성과 재노출 위험으로 정한다

모든 저장소를 동시에 처리할 필요는 없습니다. 다음 순서가 일반적으로 안전합니다.

1. 인증·세션·권한·공개 profile처럼 **즉시 재노출되는 경로**
2. 검색·캐시·추천처럼 **다른 사용자에게 노출될 수 있는 파생 경로**
3. 파일 원본과 다운로드 URL처럼 **직접 반출 가능한 경로**
4. 분석·집계처럼 **식별자 분리나 익명화가 가능한 경로**
5. 백업·불변 감사처럼 **보존 예외와 복구 통제가 필요한 경로**

작업량이 큰 테넌트에서는 삭제 worker의 동시성도 제한합니다. 예를 들어 object delete는 tenant당 20개, 전체 200개로 시작하고, error rate가 1%를 넘거나 storage throttling이 생기면 감속합니다. 삭제를 빨리 끝내겠다고 production I/O를 포화시키면 다른 고객 데이터까지 위험해집니다.

### 3) 검증은 ‘없음’과 ‘접근 불가’를 둘 다 검사한다

각 storage에 맞는 검증을 둡니다.

- primary DB: subject의 PII column이 없거나 anonymized 되었는지, 참조 무결성이 깨지지 않았는지 확인
- cache/search: subject ID와 이전 email·닉네임 query로 0건인지 확인
- object storage: key 존재 여부와 읽기 권한, CDN purge receipt를 함께 확인
- queue/DLQ: 대상 ID를 가진 pending payload가 quarantine 또는 drop 되었는지 확인
- analytics: user key가 분리되었고 원시 PII export가 막혔는지 확인

샘플링만으로 끝내지 말고, 고위험 경로는 매번 검증합니다. 예를 들어 파일 다운로드와 권한 API는 삭제 대상마다 100% negative test를 실행하고, 대형 분석 파티션은 일별 count와 hash sampling을 조합할 수 있습니다. 이 차이를 정책에 적어 두어야 “어디까지 검증했는가”를 정직하게 말할 수 있습니다.

## 트레이드오프/주의점

첫째, soft delete를 오래 유지하면 복구는 쉬워지지만 접근 차단 조건이 모든 query에 섞입니다. 삭제 후 30일 복구 같은 제품 정책이 있다면 그 기간은 `PENDING_ERASURE`로 명시하고, 복구 창이 끝난 뒤에만 영구 삭제로 전환하세요. 영구 삭제 요청과 일반 탈퇴를 같은 플래그로 처리하면 법적 약속과 제품 UX가 충돌합니다.

둘째, 감사 로그를 무조건 지우거나 무조건 남기는 양극단을 피해야 합니다. 보안 사고 추적과 회계 의무가 필요한 레코드는 식별자를 토큰화·분리하고 접근 권한을 좁혀 보존할 수 있습니다. 단, “감사 목적”이 개인 데이터 무기한 보관의 변명이 되면 안 됩니다. 보존 근거, 필드, owner, 만료일을 evidence의 예외로 적습니다.

셋째, backup은 흔히 삭제 설계에서 빠집니다. 백업을 매번 다시 쓰는 것은 비현실적일 수 있지만, 복구 후 삭제 tombstone을 먼저 재적용하지 않으면 과거 데이터가 되살아납니다. 복구 런북에는 **복구 → tombstone/차단 목록 적용 → 외부 노출 전 검증** 순서를 반드시 넣어야 합니다.

## 체크리스트 또는 연습

- [ ] 삭제 요청에 대상, 요청 주체, 법적 hold, 정책 버전, 요청 ID가 기록된다.
- [ ] 요청 직후 세션·토큰·권한·공개 조회 경로가 5분 안에 차단된다.
- [ ] DB, cache, search, object storage, queue, analytics, backup의 owner와 처리 방식이 인벤토리에 있다.
- [ ] tombstone 보존 기간이 최대 retry·DLQ·backup restore window보다 길다.
- [ ] 저장소별 erase/anonymize/key-revoke/retain 예외와 목표 시간이 문서화돼 있다.
- [ ] 완료 evidence에 원문 PII가 아니라 작업 결과·정책 버전·예외 만료만 남는다.
- [ ] 복구 훈련에서 삭제 tombstone을 먼저 재적용하고 public endpoint negative test를 실행한다.

연습으로 현재 서비스의 사용자 ID 하나를 고르고, 그 ID가 들어갈 수 있는 저장소를 위 다섯 범주에 따라 표로 만드세요. 이어서 “삭제 10분 뒤에도 외부에 노출되면 가장 위험한 곳” 세 곳을 고르고, 각각 차단 방식·검증 명령·owner·SLA를 적습니다. 이 네 칸을 채우면 데이터 삭제는 막연한 컴플라이언스 문구가 아니라 운영 가능한 백엔드 기능이 됩니다.
