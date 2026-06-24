---
title: "백엔드 커리큘럼 심화: 대용량 데이터 Export 파이프라인, 조회 버튼을 운영 가능한 산출물로 바꾸기"
date: 2026-06-24
draft: false
topic: "Data Export"
tags: ["Data Export", "Batch Pipeline", "Object Storage", "Snapshot", "Backend Operations", "Security"]
categories: ["Backend Deep Dive"]
description: "대용량 CSV·엑셀·JSONL export를 동기 다운로드가 아니라 snapshot, job, object artifact, 감사 로그, 만료 정책이 있는 운영 파이프라인으로 설계하는 기준을 정리합니다."
module: "data-system"
study_order: 1201
keywords: ["data export pipeline", "large csv export", "snapshot export", "signed download", "backend data pipeline"]
---

관리자 화면에 "전체 다운로드" 버튼을 붙이는 일은 쉬워 보입니다. 검색 조건을 받아 `SELECT`를 날리고 CSV로 내려주면 끝처럼 느껴집니다. 하지만 데이터가 5천 행일 때와 50만 행일 때는 완전히 다른 문제입니다. 요청은 타임아웃되고, DB는 긴 쿼리로 밀리고, 사용자는 새로고침을 누르고, 같은 export가 여러 번 만들어집니다. 더 위험한 경우는 개인정보나 정산 데이터가 섞인 파일이 오래 살아남거나, 권한이 바뀐 뒤에도 예전 다운로드 링크가 계속 열리는 상황입니다.

그래서 대용량 export는 "조회 API의 부가 기능"이 아니라 **업무 증거가 되는 산출물 생성 파이프라인**으로 봐야 합니다. 이 글은 CSV·엑셀·JSONL 다운로드를 예로 들지만, 정산 리포트, 감사 로그 export, 고객 데이터 반출, 운영 분석 파일 생성에도 같은 기준을 적용할 수 있습니다. 기본 흐름은 [Async Request-Reply와 Operation Resource](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/), [Cursor Pagination Consistency](/learning/deep-dive/deep-dive-cursor-pagination-consistency-playbook/), [Object Storage와 파일 관리](/learning/deep-dive/deep-dive-object-storage-s3/), [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)와 연결됩니다.

## 이 글에서 얻는 것

- 동기 다운로드와 비동기 export job을 나누는 실무 기준을 잡을 수 있습니다.
- snapshot, filter hash, schema version, artifact metadata를 왜 함께 저장해야 하는지 이해할 수 있습니다.
- DB 부하, 파일 보관, signed URL, 개인정보 마스킹, 감사 로그를 한 흐름으로 설계할 수 있습니다.
- 대용량 export의 큐, 청크, 만료, 재시도, 알람 기준을 숫자로 정리할 수 있습니다.

## 핵심 개념/이슈

### 1) Export는 조회가 아니라 "시간이 걸리는 파일 생성 작업"이다

작은 목록 다운로드는 동기 API로 충분합니다. 문제는 "작게 시작한 다운로드"가 운영 중에 점점 커진다는 점입니다. 필터가 넓어지고, 고객이 늘고, 컬럼이 추가되고, 엑셀 수식 대응이나 마스킹 요구가 붙으면 단순 스트리밍 응답은 금방 한계에 닿습니다.

동기 다운로드를 유지해도 되는 기준은 보수적으로 잡는 편이 낫습니다.

- 결과가 **1만 행 이하**이고 파일 크기가 **10MB 이하**
- p95 생성 시간이 **2초 이하**
- 민감정보가 없거나 이미 화면 조회 권한과 동일한 범위
- 실패해도 사용자가 다시 눌렀을 때 중복 부작용이 없음

이 기준을 넘으면 비동기 export job으로 분리하는 것이 안전합니다. 특히 정산, 감사, 개인정보, 법적 증빙처럼 "나중에 같은 결과를 설명해야 하는 파일"은 행 수가 작아도 job으로 분리하는 편이 좋습니다. 파일 자체가 업무 증거가 되기 때문입니다.

### 2) Snapshot 기준이 없으면 페이지와 파일의 결과가 서로 다르다

관리자 화면에서 필터를 보고 "전체 export"를 눌렀는데, 파일 생성 중에 주문이 추가되거나 상태가 바뀌면 어떻게 될까요. 화면에는 12,431건이라고 보였는데 파일에는 12,517건이 들어갈 수 있습니다. 반대로 삭제나 권한 변경이 끼면 누락이 생길 수 있습니다.

그래서 export job에는 최소한 아래 기준을 고정해야 합니다.

- `requested_at`: 사용자가 export를 요청한 시각
- `snapshot_at` 또는 `snapshot_version`: 결과 집합을 고정하는 기준
- `filter_hash`: 필터 조건을 정규화한 해시
- `sort_key`: 출력 순서를 재현하기 위한 정렬 기준
- `schema_version`: 컬럼 목록과 의미의 버전

모든 export가 DB의 장기 트랜잭션 snapshot을 유지해야 한다는 뜻은 아닙니다. 오히려 긴 트랜잭션은 vacuum, undo, replication lag, connection 점유 비용을 키웁니다. 현실적인 선택지는 세 가지입니다.

1. 작은 결과: 요청 시점 조건으로 바로 생성
2. 중간 결과: `snapshot_at <= requested_at` 같은 시간 기준으로 고정
3. 큰 결과: 대상 id를 임시 테이블이나 object manifest로 먼저 materialize

정산·감사 export처럼 완전성이 중요하면 3번이 가장 설명하기 쉽습니다. 처음에 export 대상 id 목록을 고정하고, 이후 파일 생성은 그 목록을 따라갑니다. 이 방식은 저장 공간을 더 쓰지만, "왜 이 행이 들어갔고 저 행은 빠졌는가"를 나중에 설명할 수 있습니다.

### 3) 파일은 DB 결과가 아니라 artifact metadata와 함께 보관한다

S3 같은 object storage에 CSV를 올리는 것으로 끝내면 운영 정보가 흩어집니다. 파일과 함께 DB에 artifact metadata를 남겨야 합니다.

권장 필드는 아래 정도면 충분합니다.

- `export_id`, `requester_id`, `tenant_id`
- `status`: `accepted`, `running`, `uploading`, `available`, `failed`, `expired`, `canceled`
- `filter_hash`, `filter_summary`
- `snapshot_at`, `schema_version`
- `row_count`, `byte_size`, `checksum`
- `object_key`, `content_type`
- `expires_at`, `download_count`
- `audit_ref`, `approval_ref` 또는 `ticket_ref`

여기서 중요한 것은 `object_key`를 사용자에게 직접 노출하지 않는 것입니다. 다운로드 API는 export 상태, 사용자 권한, 만료 시각을 다시 확인한 뒤 짧은 signed URL을 발급해야 합니다. [Object Upload Quarantine Scanning](/learning/deep-dive/deep-dive-object-upload-quarantine-scanning-playbook/)에서 업로드 완료와 공개 가능 상태를 나눈 것처럼, export도 파일 생성과 다운로드 허용 상태를 분리해야 합니다.

### 4) 보안은 요청 시점과 다운로드 시점에 둘 다 걸어야 한다

대용량 export에서 자주 빠지는 부분이 권한 재검증입니다. 요청할 때는 권한이 있었지만, 파일이 만들어진 뒤 권한이 회수될 수 있습니다. 또는 사용자가 퇴사했는데 오래 살아 있는 링크를 누군가 전달받을 수도 있습니다.

보수적인 기준은 아래와 같습니다.

- export 요청 시 권한 확인
- 파일 생성 워커가 데이터 접근 권한과 tenant 범위를 다시 확인
- 다운로드 URL 발급 시 현재 권한을 다시 확인
- signed URL TTL은 민감 파일 **1~5분**, 일반 내부 파일 **5~15분**
- artifact 보관 기간은 일반 운영 파일 **7일**, 감사/정산 증빙은 정책에 따라 **30~180일**
- 개인정보 export는 승인 또는 ticket reference 없으면 생성 금지

CSV도 보안 표면입니다. Excel에서 열릴 가능성이 있는 파일은 `=`, `+`, `-`, `@`로 시작하는 셀을 그대로 내보내면 formula injection 문제가 생길 수 있습니다. 고객 입력 문자열을 CSV로 내릴 때는 prefix escape 정책을 두고, 원본값과 표시값이 달라지는 컬럼은 schema 문서에 남겨야 합니다.

### 5) Export 큐는 일반 작업 큐와 분리해야 한다

대용량 export는 CPU, DB I/O, 네트워크, object storage 업로드를 동시에 씁니다. 이메일 발송, 알림, 짧은 정합성 작업과 같은 큐에 섞으면 head-of-line blocking이 생깁니다. [Workload-aware Queue와 Fair Scheduling](/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/)에서 다룬 것처럼 작업 비용이 다른 큐는 분리하거나 가중치를 줘야 합니다.

권장 시작점은 아래와 같습니다.

- `exports-small`: 10MB 이하, p95 완료 30초 목표
- `exports-heavy`: 10MB 초과 또는 10만 행 초과, DB 보호 우선
- tenant당 동시 export **1~2개**
- 전체 heavy export worker 동시성은 DB replica 기준 **2~4개**부터 시작
- 단일 쿼리 청크는 **1,000~5,000행**
- object upload는 파일 크기 **100MB 초과**부터 multipart 또는 stream upload 검토

Export는 사용자 체감도 중요하지만, 운영 우선순위는 보통 **DB 보호 > 권한/마스킹 정확성 > 결과 재현성 > 생성 속도** 순입니다. 10초 빨리 내려주는 것보다 primary DB를 밀지 않는 것이 더 중요합니다.

## 실무 적용

### 1) 동기 다운로드와 export job의 의사결정 기준

아래 셋 중 하나라도 만족하면 비동기 job을 기본값으로 둡니다.

1. 결과가 **1만 행** 또는 **10MB**를 넘을 수 있다.
2. p95 생성 시간이 **2초**를 넘거나 DB 쿼리 시간이 **1초**를 넘는다.
3. 민감정보, 정산, 감사, 고객 데이터 반출처럼 다운로드 자체가 감사 대상이다.

반대로 화면에 보이는 현재 페이지, 100~500행짜리 운영 목록, 민감정보가 없는 간단한 CSV는 동기 응답으로 유지해도 됩니다. 단, 동기 응답도 최대 행 수와 timeout을 명시해야 합니다. "필터 없이 전체 다운로드"를 아무 제한 없이 허용하면 결국 장애 버튼이 됩니다.

### 2) API 계약 예시

`POST /exports`

```json
{
  "resource": "orders",
  "format": "csv",
  "filters": {
    "created_from": "2026-06-01",
    "created_to": "2026-06-24",
    "status": ["PAID", "REFUNDED"]
  },
  "columns": ["order_id", "paid_at", "amount", "status"]
}
```

응답은 `202 Accepted`로 두고 operation URI를 돌려줍니다.

```json
{
  "export_id": "exp_20260624_001",
  "status": "accepted",
  "poll_after_seconds": 5,
  "operation_uri": "/exports/exp_20260624_001"
}
```

`GET /exports/{exportId}`는 아래처럼 현재 상태와 다운로드 가능 여부를 반환합니다.

```json
{
  "export_id": "exp_20260624_001",
  "status": "available",
  "row_count": 12431,
  "byte_size": 3912048,
  "schema_version": "orders-export-v3",
  "expires_at": "2026-07-01T00:00:00+09:00",
  "download_uri": "/exports/exp_20260624_001/download"
}
```

`download_uri`는 실제 S3 key가 아니라 백엔드 API여야 합니다. 이 API가 현재 권한을 확인하고 짧은 signed URL로 redirect하거나 proxy-safe 응답을 돌려줍니다.

### 3) 생성 파이프라인 순서

1. 요청 검증: export 가능한 리소스, 컬럼, 필터인지 확인
2. 권한 확인: tenant, role, 승인 필요 여부 확인
3. job 생성: filter hash, schema version, snapshot 기준 저장
4. 대상 고정: 작은 결과는 직접 조회, 큰 결과는 id manifest 생성
5. 파일 생성: chunk 단위 조회, CSV/JSONL writer로 stream
6. 업로드: object storage에 저장, checksum 계산
7. finalize: row count, byte size, checksum, expires_at 저장
8. 알림: 필요 시 사용자에게 완료 알림
9. 만료 정리: object와 metadata를 정책에 따라 삭제 또는 archive

이 순서에서 4번과 7번이 특히 중요합니다. 대상 고정이 없으면 결과 재현성이 약해지고, finalize metadata가 없으면 파일이 정상인지 설명하기 어렵습니다.

### 4) 운영 지표와 알람 기준

초기 지표는 많을 필요 없습니다. 아래 다섯 개면 운영 상태를 꽤 잘 볼 수 있습니다.

- `export_accept_to_start_p95`: **1분 초과** 시 큐 적체 확인
- `export_generation_p95`: 파일 종류별 기준선 대비 **50% 상승** 시 쿼리/worker 점검
- `export_failure_rate`: **1% 초과** 시 실패 코드 상위 5개 확인
- `export_stale_available_count`: 만료됐는데 object가 남은 파일 **0건 목표**
- `sensitive_export_without_ticket`: **0건**

DB 보호 알람은 별도로 둡니다.

- replica lag **10초 초과 5분 지속**이면 heavy export worker 절반으로 축소
- primary CPU **80% 초과 10분 지속**이면 신규 heavy export 수락 지연
- lock wait timeout 비율 **1% 초과**면 해당 리소스 export 중단

## 트레이드오프/주의점

첫째, snapshot 정확성은 비용을 먹습니다. 대상 id를 고정하면 재현성은 좋아지지만 임시 저장 공간과 cleanup 작업이 필요합니다. 모든 export에 적용하기보다 정산, 감사, 고객 반출처럼 결과 설명 가능성이 중요한 리소스부터 적용하는 편이 현실적입니다.

둘째, 엑셀 친화성을 높일수록 데이터 계약이 흐려질 수 있습니다. 사람이 열기 좋은 CSV는 타입 정보가 약하고, locale, timezone, 숫자 포맷, formula escaping 이슈가 있습니다. 기계 처리 목적이면 JSONL이나 Parquet 같은 형식을 별도로 제공하는 편이 낫습니다.

셋째, signed URL은 권한 검사를 대체하지 않습니다. URL을 발급하기 전 현재 권한을 확인해야 하고, URL TTL은 짧아야 합니다. 특히 민감 파일은 다운로드 횟수, IP, requester를 감사 로그에 남기는 것이 좋습니다.

넷째, export 기능은 데이터 유출 경로가 될 수 있습니다. 화면 조회는 페이지 단위로 제한돼 있어도 export는 한 번에 수만 건을 내보냅니다. 그래서 export 권한은 일반 read 권한보다 강하게 다루고, 민감 컬럼은 기본 제외 또는 승인 기반 포함으로 설계해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 동기 다운로드 허용 기준을 행 수, 파일 크기, 생성 시간으로 문서화했다.
- [ ] 대용량 export는 `202 Accepted`와 operation/export resource로 분리했다.
- [ ] `filter_hash`, `snapshot_at`, `schema_version`, `row_count`, `checksum`을 metadata로 남긴다.
- [ ] 다운로드 시점에 현재 권한을 다시 확인하고 짧은 signed URL을 발급한다.
- [ ] 민감정보 export는 approval/ticket/audit reference 없이는 생성되지 않는다.
- [ ] CSV formula injection, timezone, locale, null 표현 규칙을 schema 문서에 적었다.
- [ ] heavy export 큐를 일반 작업 큐와 분리하거나 동시성을 제한했다.
- [ ] 만료된 artifact와 object storage 파일을 정리하는 cleanup job이 있다.

### 연습 과제

1. 현재 서비스의 "전체 다운로드" 기능 하나를 골라 최대 행 수, p95 생성 시간, 민감 컬럼 포함 여부를 적어 보세요.
2. 그 기능을 export job으로 바꾼다고 가정하고 `accepted -> running -> uploading -> available -> expired` 상태 전이표를 만드세요.
3. `filter_hash`, `schema_version`, `snapshot_at`이 없는 상태에서 감사 요청이 들어왔을 때 무엇을 설명하지 못하는지 시나리오로 써 보세요.
4. tenant당 동시 export 1개, 청크 2,000행, worker 3개 기준으로 50만 행 export가 DB에 주는 부하를 추정해 보세요.

## 관련 글

- [Async Request-Reply와 Operation Resource](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/)
- [Cursor Pagination Consistency](/learning/deep-dive/deep-dive-cursor-pagination-consistency-playbook/)
- [Object Storage와 파일 관리](/learning/deep-dive/deep-dive-object-storage-s3/)
- [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)
- [Workload-aware Queue와 Fair Scheduling](/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/)
