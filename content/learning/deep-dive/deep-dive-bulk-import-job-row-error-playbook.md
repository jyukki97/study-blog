---
title: "백엔드 커리큘럼 심화: Bulk Import Job, 대량 업로드를 안전하게 처리하는 운영 설계"
date: 2026-05-27T10:06:00+09:00
draft: false
topic: "Backend Data Pipeline"
tags: ["Bulk Import", "Batch Processing", "Idempotency", "Async API", "Data Validation", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "CSV·엑셀·JSONL 같은 대량 업로드를 동기 API로 처리하지 않고, import job·row error·멱등성·부분 성공·재처리 기준으로 운영하는 방법을 정리합니다."
summary: "Bulk Import Job은 파일을 받는 기능이 아니라 데이터 변경을 지연 실행하는 운영 파이프라인입니다. 성공/실패를 row 단위로 기록하고, 멱등 키·검증 단계·부분 성공 정책·재처리 한도를 정해야 안전하게 확장할 수 있습니다."
key_takeaways:
  - "대량 import는 요청-응답 API가 아니라 상태를 가진 비동기 job으로 모델링해야 timeout, 부분 실패, 재시도 문제를 다룰 수 있다."
  - "row 단위 검증 결과와 error code를 구조화하지 않으면 운영자는 실패 원인보다 엑셀 파일을 다시 열어보는 데 시간을 쓴다."
  - "멱등 키, 중복 파일 fingerprint, row-level effect ledger, replay throttle을 함께 둬야 재업로드와 재처리가 안전해진다."
operator_checklist:
  - "업로드 완료와 import 적용 상태를 분리한다."
  - "job_id, file_fingerprint, idempotency_key, row_number, error_code를 저장한다."
  - "dry-run, canary apply, full apply 단계를 분리한다."
  - "부분 성공 허용률과 자동 중단 기준을 숫자로 둔다."
  - "적용률, 실패율, 재처리율, 온라인 트래픽 영향 지표를 import job마다 남긴다."
learning_refs:
  - title: "Async Request-Reply Operation Resource"
    href: "/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/"
    description: "긴 작업을 operation resource로 노출하는 API 계약입니다."
  - title: "Batch Idempotency/Reprocessing"
    href: "/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/"
    description: "배치 재처리와 체크포인트 설계의 기본 원칙입니다."
  - title: "Object Upload Quarantine"
    href: "/learning/deep-dive/deep-dive-object-upload-quarantine-scanning-playbook/"
    description: "업로드 완료와 공개/처리 가능 상태를 분리하는 보안 관점입니다."
faqs:
  - question: "대량 import도 그냥 API 여러 번 호출하면 안 되나요?"
    answer: "소량이면 가능하지만 파일 단위 검증, 부분 실패, 재처리, 사용자 피드백, 감사 로그가 필요해지는 순간 별도 job 모델이 더 안전합니다."
  - question: "부분 성공을 허용하는 편이 좋은가요?"
    answer: "도메인마다 다릅니다. 상품 카탈로그처럼 row 간 독립성이 높으면 부분 성공이 유용하지만, 정산·권한·재고처럼 전체 일관성이 중요하면 all-or-nothing 또는 승인 후 apply가 낫습니다."
module: "backend-data-system-phase"
study_order: 1244
---

관리자 화면에서 "CSV 업로드" 버튼 하나를 붙이는 일은 쉬워 보입니다. 파일을 받고, 파싱하고, DB에 넣으면 끝처럼 느껴집니다. 하지만 실제 운영에서는 이 기능이 자주 장애의 출발점이 됩니다. 10행짜리 테스트 파일은 잘 들어가지만, 고객이 20만 행짜리 파일을 올리면 요청 timeout이 나고, 절반은 저장됐는데 절반은 실패하고, 사용자는 같은 파일을 다시 올립니다. 그 결과 중복 데이터, 누락 데이터, 실패 원인 불명, DB 부하 급증이 한꺼번에 옵니다.

그래서 대량 업로드는 파일 처리 기능이 아니라 **상태를 가진 데이터 변경 파이프라인**으로 봐야 합니다. 이 글은 CSV·엑셀·JSONL import를 예로 들지만, 파트너 정산 파일, 상품 카탈로그 동기화, 사용자 일괄 초대, 쿠폰 발급, 권한 대량 변경에도 같은 기준을 적용할 수 있습니다. 기본 흐름은 [Async Request-Reply Operation Resource](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/), [Batch Idempotency/Reprocessing](/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/), [Object Upload Quarantine](/learning/deep-dive/deep-dive-object-upload-quarantine-scanning-playbook/), [Workload-aware Queue](/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/)와 이어집니다.

## 이 글에서 얻는 것

- 대량 import를 동기 API가 아니라 비동기 job으로 설계해야 하는 이유를 설명할 수 있습니다.
- dry-run, validation, canary apply, full apply를 어떤 순서로 나눌지 기준을 잡을 수 있습니다.
- row error, 부분 성공, 멱등성, 재업로드, 재처리 정책을 숫자로 정의할 수 있습니다.
- 운영자가 "파일 다시 주세요"가 아니라 error report와 replay plan으로 대응할 수 있게 만드는 체크리스트를 얻습니다.

## 핵심 개념/이슈

### 1) Bulk import는 HTTP 요청이 아니라 job이다

대량 import를 `POST /admin/products/import` 하나로 처리하면 곧 한계가 옵니다. 브라우저와 API gateway에는 timeout이 있고, 서버 thread는 오래 점유되며, DB transaction은 커지고, 실패 응답 하나로는 어떤 행이 왜 실패했는지 설명할 수 없습니다. 더 나쁜 상황은 클라이언트가 timeout을 실패로 보고 같은 파일을 다시 올리는 것입니다. 서버는 이미 일부 row를 반영했는데 사용자는 실패했다고 믿을 수 있습니다.

기본 API 계약은 아래처럼 분리하는 편이 안전합니다.

```text
POST /imports
  -> 202 Accepted
  -> operation_url: /imports/{job_id}

GET /imports/{job_id}
  -> status, progress, counters, error_report_url

POST /imports/{job_id}/apply
  -> 검증 완료 job만 실제 반영
```

상태는 최소 `uploaded`, `validating`, `validation_failed`, `ready_to_apply`, `applying`, `partially_applied`, `applied`, `failed`, `canceled` 정도로 나눕니다. 처음부터 복잡해 보이지만, 상태를 나누지 않으면 결국 로그와 DB row를 사람이 뒤져 상태를 추정하게 됩니다. 상태 모델은 곧 운영 UX입니다.

### 2) 업로드 성공과 적용 성공을 분리한다

파일이 object storage에 올라갔다고 데이터가 반영 가능한 것은 아닙니다. 파일에는 악성 매크로, 잘못된 MIME, 깨진 인코딩, 중복 헤더, 허용되지 않은 컬럼, 너무 큰 셀, 개인정보가 섞일 수 있습니다. 그래서 업로드 단계는 "받았다"까지만 의미하고, import 단계는 별도 검증을 거쳐야 합니다.

권장 단계는 아래입니다.

1. **Upload**: presigned URL 또는 서버 업로드로 파일 수신
2. **Quarantine**: 파일 크기, 확장자, MIME, signature, malware scan 확인
3. **Parse**: 인코딩, 헤더, 행 수, 컬럼 타입 검증
4. **Validate**: 도메인 규칙, FK 존재, 권한, 중복, 제한량 검증
5. **Dry-run report**: 반영 전 예상 성공/실패 요약 제공
6. **Apply**: 승인 또는 자동 정책에 따라 실제 쓰기
7. **Reconcile**: 카운터, 샘플, 불일치율, 감사 로그 확인

출발 숫자는 보수적으로 잡습니다. 예를 들어 일반 관리자 import는 파일 크기 50MB, row 수 10만, validation p95 2분, apply batch size 500~2,000 rows, 단일 job DB CPU 추가 사용률 15%p 이하부터 시작할 수 있습니다. 이 숫자는 정답이 아니라 안전한 초깃값입니다. 정산·권한·재고처럼 부작용이 큰 도메인은 더 낮게 시작합니다.

### 3) row error는 사람이 읽을 문장이 아니라 계약이다

대량 import에서 가장 중요한 산출물은 성공 메시지가 아니라 실패 리포트입니다. "1234행 처리 실패"만 주면 운영자는 원본 파일을 다시 열고, 개발자는 로그를 뒤집니다. 좋은 row error는 재현 가능하고, 사용자가 고칠 수 있고, 시스템이 집계할 수 있어야 합니다.

권장 구조는 아래와 같습니다.

```json
{
  "job_id": "imp_20260527_001",
  "row_number": 1842,
  "row_key": "sku:ABC-0192",
  "status": "rejected",
  "error_code": "PRICE_NEGATIVE",
  "message": "price must be greater than or equal to 0",
  "field": "price",
  "severity": "error",
  "raw_value_hash": "sha256:...",
  "suggested_action": "set a non-negative price and re-upload"
}
```

여기서 `message`는 바뀔 수 있지만 `error_code`는 API 계약입니다. error code가 있어야 상위 10개 실패 원인, 배포 후 error spike, 특정 고객 파일 품질을 집계할 수 있습니다. 원본 값은 민감정보일 수 있으므로 기본은 hash 또는 redacted value를 저장합니다. 원문이 필요하면 짧은 보존 기간과 감사 로그를 둡니다. 이 기준은 [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)와도 맞닿아 있습니다.

### 4) 부분 성공 정책을 먼저 정해야 한다

대량 import는 all-or-nothing과 partial success 사이에서 결정해야 합니다. 둘 중 하나가 항상 옳지는 않습니다.

| 도메인 | 권장 정책 | 이유 |
| --- | --- | --- |
| 상품 설명, 태그, 이미지 메타데이터 | 부분 성공 허용 | row 간 독립성이 높고 재수정 비용이 낮음 |
| 사용자 초대 | 부분 성공 허용 가능 | 이미 존재하는 이메일은 skip하고 신규만 처리 가능 |
| 쿠폰 대량 발급 | 제한적 부분 성공 | 중복 발급과 한도 초과를 강하게 막아야 함 |
| 권한 일괄 변경 | 기본은 dry-run 후 승인 | 잘못 적용하면 보안 사고 |
| 정산/포인트/재고 | all-or-nothing 또는 ledger 기반 | 부분 반영이 금전·수량 불일치로 이어짐 |

부분 성공을 허용한다면 실패 허용률을 숫자로 둡니다. 예를 들어 상품 import는 row rejection rate 5% 이하면 적용 가능, 5~20%는 사용자 승인 필요, 20% 초과는 자동 중단으로 둘 수 있습니다. 권한 변경은 실패율보다 실패 유형이 중요합니다. `USER_NOT_FOUND` 1건은 수정 가능한 오류지만, `FORBIDDEN_ROLE_ESCALATION` 1건은 전체 job 중단 신호일 수 있습니다.

### 5) 멱등성은 파일 단위와 row 단위로 나눠야 한다

사용자는 실패했다고 느끼면 같은 파일을 다시 올립니다. 운영자도 "다시 실행" 버튼을 누릅니다. 그래서 import는 재실행을 정상 시나리오로 봐야 합니다.

멱등성 키는 최소 두 층이 필요합니다.

- **file fingerprint**: normalized header + content hash + tenant_id + import_type
- **row effect key**: tenant_id + import_type + business_key + operation_version

file fingerprint는 같은 파일의 중복 등록을 감지합니다. row effect key는 같은 비즈니스 효과가 두 번 적용되는 것을 막습니다. 예를 들어 상품 가격 import라면 `tenant:store-1:price:sku-ABC:v20260527` 같은 키를 둘 수 있습니다. 단순히 row number를 키로 쓰면 사용자가 파일 정렬을 바꾸는 순간 중복 방지가 깨집니다. 반대로 business key만 쓰면 정상적인 두 번째 가격 변경까지 막을 수 있으므로 operation version이나 effective date를 함께 둡니다.

이 관점은 [UPSERT·UNIQUE·멱등 키](/learning/deep-dive/deep-dive-upsert-unique-idempotency-write-path-playbook/)와 같습니다. DB unique constraint는 중복 row를 막아주지만, "같은 업무 효과를 다시 냈는가"까지 자동으로 판단해 주지는 않습니다.

## 실무 적용

### 1) import job 테이블을 먼저 설계한다

최소 스키마는 아래 정도로 시작할 수 있습니다.

```sql
CREATE TABLE import_jobs (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  import_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  file_fingerprint VARCHAR(128) NOT NULL,
  uploaded_by VARCHAR(64) NOT NULL,
  total_rows INTEGER DEFAULT 0,
  valid_rows INTEGER DEFAULT 0,
  rejected_rows INTEGER DEFAULT 0,
  applied_rows INTEGER DEFAULT 0,
  failed_rows INTEGER DEFAULT 0,
  error_report_ref VARCHAR(256),
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

row 결과는 별도 테이블이나 object storage report로 분리합니다. 모든 row 결과를 DB에 영구 보관하면 비용이 커질 수 있습니다. 보통 최근 7~30일은 조회 가능하게 두고, 장기 보관은 압축된 report artifact로 넘기는 방식이 낫습니다. 단, 정산·권한처럼 감사가 필요한 import는 보관 기간을 길게 잡고 접근 권한을 제한합니다.

### 2) 검증과 적용을 다른 worker pool로 분리한다

validation은 CPU와 DB read를 많이 씁니다. apply는 DB write와 downstream side effect를 만듭니다. 둘을 같은 worker pool에 넣으면 검증 job 폭주가 실제 반영 작업을 막거나, 반대로 apply가 validation 대기열을 밀어냅니다.

권장 분리:

- `import-parse`: 파일 읽기, 인코딩, 헤더 검증
- `import-validate`: 도메인 read 검증, FK 확인, 중복 검사
- `import-apply-low-risk`: 상품/태그 같은 낮은 위험 변경
- `import-apply-high-risk`: 권한/정산/재고 같은 승인 기반 변경
- `import-report`: error report 생성과 알림

운영 기준은 [Workload-aware Queue](/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/)처럼 잡습니다. 대형 job이 짧은 job을 막지 않도록 tenant별 동시 실행 1~2개, 전체 apply worker는 DB write capacity의 10~20% 이하부터 시작합니다. 온라인 트래픽 p95가 20% 이상 악화되면 import apply를 자동 throttle하는 게 안전합니다.

### 3) dry-run을 기본값으로 둔다

관리자 기능은 "업로드하면 바로 반영"이 편해 보이지만, 실무에서는 dry-run이 더 빠릅니다. 잘못된 파일을 반영하고 되돌리는 시간보다, 반영 전에 오류를 보여주는 시간이 훨씬 싸기 때문입니다.

dry-run report에는 최소 아래가 필요합니다.

- 전체 row 수, 적용 가능 row 수, 거부 row 수
- error code별 top 10
- 샘플 row error 20개
- 예상 신규/수정/skip/delete 카운터
- 영향 범위: tenant, resource type, effective date
- apply 예상 시간과 부하 등급
- high-risk 경고: 권한 상승, 금액 변경, 재고 음수 가능성

자동 apply 기준은 좁게 둡니다. 예를 들어 `rejected_rows = 0`, `estimated_apply_rows <= 10,000`, `high_risk_error = 0`, `tenant_import_concurrency = 0`, `DB CPU < 60%`일 때만 자동 적용합니다. 그 외에는 사람이 report를 보고 승인하게 합니다.

### 4) replay와 cancel을 제품 기능으로 만든다

import job은 실패합니다. 그래서 처음부터 다시 실행, 이어 실행, 취소를 API와 UI에 넣어야 합니다.

- `cancel`: 아직 apply되지 않은 job은 즉시 취소, apply 중이면 batch 경계에서 중지
- `retry validation`: 파일은 그대로 두고 검증 로직 또는 참조 데이터 변경 후 재검증
- `retry failed rows`: 실패 row만 새 job으로 재시도
- `replay apply`: idempotency ledger 확인 후 적용 누락분만 재실행

고위험 replay에는 [Poison Message Quarantine/Safe Replay](/learning/deep-dive/deep-dive-poison-message-quarantine-safe-replay-playbook/)와 같은 근거 패킷이 필요합니다. root cause, 수정 증거, 영향 범위, replay 대상 row 수, 중단 조건, rollback/compensation 경로를 승인 전에 보여줘야 합니다.

## 트레이드오프/주의점

첫째, job 모델은 초기 구현량이 늘어납니다. 상태 테이블, worker, report, UI, 알림이 필요합니다. 하지만 동기 API로 시작해 장애가 난 뒤 job 모델로 옮기면 데이터 정리 비용이 더 큽니다. row 수가 1,000을 넘거나 처리 시간이 5초를 넘을 수 있으면 처음부터 job으로 두는 편이 낫습니다.

둘째, 부분 성공은 사용자 편의와 데이터 일관성 사이의 타협입니다. 부분 성공을 허용하면 업무가 앞으로 나아가지만, 누락 row를 나중에 별도로 관리해야 합니다. all-or-nothing은 일관성은 좋지만 작은 오류 하나가 전체 업무를 막습니다. 판단 우선순위는 **금전/권한/재고 정합성 > 고객 영향 범위 > 운영 재처리 비용 > 사용자 편의** 순서가 안전합니다.

셋째, error report에 원문 데이터를 과하게 남기면 보안 문제가 됩니다. 이메일, 전화번호, 주소, 계좌, 외부 식별자는 기본 마스킹하고, 원문 파일 접근은 만료와 감사 로그가 있는 경로로 제한합니다.

넷째, import worker는 온라인 서비스와 자원을 공유합니다. 밤에만 돌리는 배치라고 방심하면 안 됩니다. 야간 배치가 DB vacuum, index build, backup, analytics query와 겹치면 낮보다 더 위험할 수 있습니다. import에는 rate limit, tenant quota, pause switch가 필요합니다.

## 운영 지표와 알람 기준

대량 import 기능은 "성공했는가"만 보면 늦습니다. 운영자는 import가 온라인 서비스에 어떤 압력을 주는지, 사용자 파일 품질이 나빠지는지, 재처리가 반복되는지까지 봐야 합니다. 최소 대시보드는 job 단위 지표와 시스템 단위 지표를 나눕니다.

job 단위 지표:

- `total_rows`, `valid_rows`, `rejected_rows`, `applied_rows`, `skipped_rows`
- validation latency p50/p95, apply latency p50/p95
- row rejection rate, retry count, replay count
- error code top 10과 신규 error code 발생 여부
- dry-run 이후 apply까지 걸린 시간
- cancel 또는 manual approval 비율

시스템 단위 지표:

- import queue depth와 oldest job age
- worker pool별 처리량과 실패율
- DB write QPS, lock wait, replication lag, online API p95
- tenant별 동시 실행 수와 quota 초과 횟수
- report artifact 생성 실패율과 다운로드 실패율

알람은 단순 실패 건수보다 사용자 영향과 재처리 위험에 맞춥니다. 예를 들어 `ready_to_apply` 상태의 oldest job age가 30분을 넘으면 운영 지연이고, `applying` 상태에서 10분 이상 progress가 변하지 않으면 worker stuck 가능성이 있습니다. row rejection rate가 평소 2%에서 25%로 튀면 배포로 validator가 바뀌었거나 고객 파일 생성기가 깨졌을 수 있습니다. 온라인 API p95가 기준선 대비 20% 이상 악화되면 import apply를 자동 pause하고, 이미 시작한 job은 batch 경계에서 멈춥니다.

여기서 중요한 점은 import 지표가 제품 지표와 연결되어야 한다는 것입니다. "10만 row 중 9만 row 성공"은 좋아 보이지만, 실패한 1만 row가 특정 고객의 전체 상품이거나 금액 필드라면 사고입니다. 그래서 error report에는 `tenant_id`, `import_type`, `business_key`, `effective_date`, `risk_class`를 함께 남기고, 알람도 위험 등급별로 다르게 둡니다.

## 설계 리뷰 질문

설계 리뷰에서는 구현 방식보다 실패 경로를 먼저 묻는 편이 좋습니다. 아래 질문에 답하지 못하면 아직 운영 가능한 import가 아닙니다.

- 사용자가 같은 파일을 세 번 올리면 job과 row effect는 각각 몇 번 생기나요?
- API timeout 이후 실제로는 apply가 계속 진행 중일 때 UI는 어떤 상태를 보여주나요?
- 100만 row 중 83만 row가 성공하고 17만 row가 실패하면 rollback, 재처리, 승인 중 무엇을 하나요?
- validator 배포 버그로 정상 row가 대량 reject되면 기존 report를 어떻게 무효화하나요?
- apply 중 DB lock wait가 급증하면 어떤 지표가 pause를 트리거하나요?
- 실패 report에 개인정보 원문이 들어갔을 때 누가, 언제, 어떤 절차로 삭제하고 회전하나요?
- import job이 downstream 이벤트를 발행한다면 replay 시 이벤트 중복은 어디서 막나요?

답은 문서로 남깁니다. 특히 rollback 방법은 "DB 백업에서 복구"처럼 큰 문장으로 쓰면 실전에서 쓸 수 없습니다. 낮은 위험 import라면 `row effect ledger 기준으로 inverse update 생성`, 높은 위험 import라면 `apply 전 승인 + batch별 compensation script + 샘플 검증`처럼 실제 실행 단위로 쪼개야 합니다. replay와 보상 트랜잭션은 [Batch Idempotency/Reprocessing](/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/)의 체크포인트 사고방식과 같이 봅니다.

## 장애 대응 흐름

장애가 났을 때의 기본 순서는 멈춤, 범위 산정, 원인 분리, 재처리 판단입니다.

1. **Stop**: import apply queue를 pause하고 새 apply 요청을 막습니다. upload와 validation은 도메인에 따라 유지할 수 있지만, 원인이 validator라면 validation도 멈춥니다.
2. **Scope**: affected job id, tenant, import type, applied row count, downstream event count를 뽑습니다.
3. **Classify**: 파싱 오류, 검증 오류, 적용 오류, 중복 적용, downstream side effect 중 어디인지 나눕니다.
4. **Contain**: 중복 적용이면 idempotency ledger와 unique constraint를 확인하고, 누락 적용이면 checkpoint 이후 row만 분리합니다.
5. **Recover**: failed rows retry, compensation job, manual correction, all-or-nothing rollback 중 하나를 선택합니다.
6. **Verify**: import counter와 실제 business table count를 맞추고, 샘플 row 20개 이상을 원본 파일과 대조합니다.

운영 보고에는 `몇 건 실패`보다 `어떤 업무 효과가 잘못됐는가`를 먼저 씁니다. 예를 들어 "상품 import 3개 job에서 12,430 row가 reject됨"보다 "store-17의 신규 가격 8,912건이 적용되지 않았고 기존 가격은 유지됨"이 더 중요합니다. 이 차이가 있어야 고객 안내, 재처리, 보상 여부를 빠르게 정할 수 있습니다.

## 체크리스트 또는 연습

- [ ] import API가 `202 Accepted`와 `job_id`를 반환한다.
- [ ] 업로드 완료, 검증 완료, 적용 완료 상태가 분리되어 있다.
- [ ] file fingerprint로 같은 파일 재업로드를 감지한다.
- [ ] row-level error code와 error report를 제공한다.
- [ ] 부분 성공 허용률과 자동 중단 기준이 숫자로 정의되어 있다.
- [ ] apply 단계가 batch size, throttle, tenant concurrency를 가진다.
- [ ] replay 전에 idempotency ledger 또는 effect key를 확인한다.
- [ ] 고위험 import는 dry-run report와 사람 승인을 요구한다.

연습 과제는 하나면 충분합니다. 현재 서비스에서 "엑셀 업로드"로 처리하는 기능 하나를 고르고, `job status`, `row error code`, `partial success policy`, `idempotency key`, `apply throttle` 다섯 항목을 한 페이지로 적어 보세요. 숫자는 반드시 넣습니다. 예를 들어 `row rejection rate 5% 초과 시 승인 필요`, `batch size 1,000`, `tenant당 apply 동시 실행 1개`, `error report 30일 보관`처럼 시작하면 설계가 훨씬 현실적으로 바뀝니다.

정리하면 Bulk Import Job의 핵심은 파일을 빨리 읽는 것이 아닙니다. 사용자가 같은 파일을 다시 올리고, 일부 row가 실패하고, 운영자가 재실행 버튼을 누르고, 시스템이 바쁜 시간에 apply가 밀리는 상황을 전부 정상 경로로 받아들이는 것입니다. 이 전제를 코드와 API 계약에 넣으면 대량 업로드는 위험한 관리자 기능이 아니라 통제 가능한 데이터 파이프라인이 됩니다.
