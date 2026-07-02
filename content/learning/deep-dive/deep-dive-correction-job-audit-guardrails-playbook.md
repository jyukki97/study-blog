---
title: "백엔드 커리큘럼 심화: Correction Job과 감사 가능한 데이터 보정 운영 플레이북"
date: 2026-07-02
draft: false
topic: "Backend Operations"
tags: ["Correction Job", "Data Repair", "Audit Log", "Reconciliation", "Idempotency", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "장애 후 데이터 보정을 개인 SQL 작업이 아니라 dry-run, 승인, 멱등 실행, 감사 로그, 종료 기준을 갖춘 운영 작업으로 설계하는 방법을 정리합니다."
summary: "Correction Job은 불일치를 실제로 고치는 단계입니다. 안전한 보정은 빠른 UPDATE보다 대상 산정, dry-run 증거, 승인, 멱등 실행, 종료 검증을 먼저 갖춰야 합니다."
key_takeaways:
  - "데이터 보정은 장애 대응의 마지막 수동 작업이 아니라 재실행 가능한 운영 workflow여야 한다."
  - "고위험 보정은 dry-run report, 영향 범위, 중단 조건, 승인자, rollback 또는 compensation 경로가 있어야 실행할 수 있다."
  - "Correction Job의 품질은 처리 건수보다 오보정률, 재실행 안전성, 감사 가능성, 종료 검증으로 판단한다."
operator_checklist:
  - "보정 대상 산정 쿼리와 실제 수정 쿼리를 분리하고, dry-run 결과를 승인 전 증거로 남긴다."
  - "job_id, target_id, before_hash, after_hash, reason, approver, execution_batch를 효과 원장에 기록한다."
  - "batch size, DB CPU, lock wait, error rate, mismatch residual 기준으로 자동 pause와 abort를 둔다."
learning_refs:
  - title: "Reconciliation 파이프라인"
    href: "/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/"
    description: "불일치를 탐지하고 위험도별 복구 후보로 분류하는 앞단 설계입니다."
  - title: "Batch Idempotency/Reprocessing"
    href: "/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/"
    description: "보정 job을 재실행해도 같은 결과가 나오게 만드는 체크포인트와 멱등성 기준입니다."
  - title: "Tamper-Evident Audit Log"
    href: "/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/"
    description: "보정 이력을 운영 증거로 남기고 사후 조작 가능성을 줄이는 감사 로그 설계입니다."
decision_guide:
  intro: "Correction Job은 빠르게 고치는 도구가 아니라, 잘못 고칠 가능성을 제한하는 운영 절차입니다."
  cases:
    - badge: "자동 보정"
      title: "대상 산정이 명확하고 inverse effect가 작다"
      fit: "중복 이벤트 취소, 누락된 파생 테이블 재계산, 읽기 모델 재생성처럼 원본 기준이 분명한 경우에 맞습니다."
      watchouts: "자동 보정이라도 건수 상한과 abort 조건이 없으면 장애 중 2차 사고를 만들 수 있습니다."
      next_step: "dry-run mismatch count, 예상 수정 건수, checksum 기준을 만든 뒤 작은 batch부터 적용합니다."
    - badge: "승인 후 보정"
      title: "금액, 권한, 개인정보, 회계 마감 데이터가 포함된다"
      fit: "오보정 비용이 크고 이해관계자 설명이 필요한 데이터에 적합합니다."
      watchouts: "승인자가 볼 수 있는 report가 없으면 승인은 형식만 남고 책임 경계가 흐려집니다."
      next_step: "before/after sample, 금액 합계, 영향 사용자 수, rollback/compensation 계획을 한 화면에 묶습니다."
    - badge: "보정 보류"
      title: "source of truth가 흔들리거나 원인 분류가 끝나지 않았다"
      fit: "어느 쪽 데이터가 맞는지 모르는 상태라면 수정보다 동결과 증거 보존이 우선입니다."
      watchouts: "잘못된 기준으로 빠르게 고치면 나중에 원장과 감사 로그까지 오염됩니다."
      next_step: "read-only snapshot, 영향 범위 산정, 원인 가설 검증을 먼저 끝냅니다."
faqs:
  - question: "장애 때 SQL 한 번으로 고치면 더 빠르지 않나요?"
    answer: "작은 내부 데이터는 그럴 수 있습니다. 하지만 결제, 권한, 재고, 개인정보처럼 실패 비용이 큰 데이터는 빠른 수정보다 재현 가능한 대상 산정과 감사 증거가 중요합니다."
  - question: "Correction Job과 Reconciliation은 무엇이 다른가요?"
    answer: "Reconciliation은 차이를 찾고 분류하는 단계이고, Correction Job은 실제 상태를 바꾸는 단계입니다. 후자는 승인, 멱등성, 중단 조건, 효과 원장이 더 중요합니다."
  - question: "rollback이 어려운 보정은 어떻게 하나요?"
    answer: "물리 rollback이 어렵다면 compensation을 설계합니다. 예를 들어 포인트를 되돌리는 대신 반대 방향 원장 이벤트를 추가하고, 사용자 고지와 정산 반영까지 하나의 closure 기준으로 묶습니다."
module: "backend-data-system"
study_order: 1446
---

장애가 끝났다고 해서 운영이 끝나는 것은 아닙니다. API가 다시 200을 반환해도, 장애 중 누락된 포인트 적립, 중복 차감된 쿠폰, 잘못 노출된 권한, 부분 적용된 관리자 일괄 수정이 남아 있으면 사용자는 계속 영향을 받습니다. 이때 많은 팀이 급하게 SQL을 짜서 데이터를 맞춥니다. 문제는 그 SQL이 어떤 대상에 적용됐고, 누가 승인했고, 중간에 실패하면 어디서 다시 시작해야 하는지 남지 않는다는 점입니다.

Correction Job은 이런 보정 작업을 개인의 임시 SQL에서 운영 가능한 workflow로 끌어올리는 방식입니다. 앞단의 [Reconciliation 파이프라인](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)이 불일치를 찾는 역할이라면, Correction Job은 그 불일치를 **어떤 조건에서 실제로 수정할지**를 다룹니다. 재실행 안전성은 [Batch Idempotency/Reprocessing](/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/)과 연결되고, 사후 설명 책임은 [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)와 연결됩니다.

## 이 글에서 얻는 것

- 장애 후 데이터 보정을 수동 SQL이 아니라 승인 가능한 운영 작업으로 설계하는 기준을 얻습니다.
- dry-run, 대상 산정, batch 실행, pause/abort, 종료 검증을 어떤 순서로 배치할지 이해합니다.
- 금액, 권한, 개인정보, 재고처럼 오보정 비용이 큰 도메인에서 자동 보정과 승인 보정을 나누는 숫자 기준을 잡을 수 있습니다.
- 보정 이력을 감사 로그와 effect ledger로 남겨, 나중에 "무엇을 왜 바꿨는지" 설명할 수 있습니다.

## 핵심 개념/이슈

### 1) Correction Job의 핵심은 UPDATE가 아니라 대상 산정이다

데이터 보정 사고의 대부분은 수정 쿼리 자체보다 대상 산정에서 발생합니다. `status = 'FAILED'`인 주문을 모두 `PAID`로 바꾸는 쿼리는 쉬워 보이지만, 그 안에는 실제 실패 주문, 결제 승인 이벤트가 늦게 온 주문, 이미 환불된 주문, 테스트 주문이 섞일 수 있습니다. 따라서 Correction Job은 항상 "무엇을 바꿀지"와 "어떻게 바꿀지"를 분리해야 합니다.

기본 구조는 아래처럼 둡니다.

1. candidate query: 보정 후보를 찾되 실제 수정은 하지 않음
2. dry-run report: 건수, 금액 합계, tenant, 위험 유형, 샘플 before/after를 생성
3. approval gate: 위험도에 따라 자동 적용, 1인 승인, 2인 승인, 보류로 분기
4. apply job: 작은 batch로 수정하고 effect ledger를 남김
5. verification: 원본 기준 재검증, 잔존 mismatch, 사용자 영향 closure 확인

숫자 기준은 처음에는 보수적으로 시작합니다. 자동 보정은 `estimated_rows <= 10,000`, `high_risk_rows = 0`, `expected_amount_delta = 0`, `dry_run_error = 0`, `DB CPU p95 < 60%`일 때만 허용합니다. 금액이나 권한이 바뀌는 작업은 1건이라도 승인 대상으로 두는 편이 안전합니다.

### 2) dry-run report는 승인자를 위한 증거 패킷이다

"승인해주세요"라는 메시지만으로는 운영 통제가 되지 않습니다. 승인자가 확인할 수 있는 증거가 있어야 합니다. 좋은 dry-run report에는 최소 다음 항목이 들어갑니다.

| 항목 | 이유 | 예시 기준 |
| --- | --- | --- |
| 대상 건수 | 영향 범위 판단 | 1만 건 초과 시 배치 window 필요 |
| 금액/포인트 합계 | 손실 상한 판단 | 100만 원 초과 시 2인 승인 |
| tenant/user 분포 | 특정 고객 집중 여부 | 한 tenant 30% 초과 시 별도 확인 |
| before/after sample | 의도한 변경인지 검토 | 위험 유형별 20건 샘플 |
| 제외 건수와 사유 | 누락/오탐 확인 | excluded reason별 비중 |
| 중단 조건 | 실행 중 피해 제한 | error rate 0.5% 초과, lock wait 2초 초과 |

이 report는 파일로만 남기기보다 job record에 붙이는 편이 좋습니다. 나중에 "왜 이 건을 자동으로 고쳤나"를 묻는 사람이 있으면, 그 시점의 후보 쿼리, dry-run 결과, 승인자, 적용 batch를 한 번에 볼 수 있어야 합니다.

### 3) 보정 실행은 멱등성과 효과 원장이 있어야 한다

Correction Job은 반드시 재실행될 수 있다고 가정해야 합니다. 중간에 DB lock이 길어져 멈추거나, 배포가 겹치거나, 특정 row에서 validation error가 날 수 있습니다. 재실행 시 같은 row를 다시 바꿔도 안전하려면 effect ledger가 필요합니다.

예시는 아래와 같습니다.

```sql
CREATE TABLE correction_effects (
  job_id           varchar(80)  NOT NULL,
  target_type      varchar(80)  NOT NULL,
  target_id        varchar(120) NOT NULL,
  action           varchar(80)  NOT NULL,
  before_hash      varchar(128) NOT NULL,
  after_hash       varchar(128) NOT NULL,
  reason_code      varchar(80)  NOT NULL,
  approved_by      varchar(120),
  execution_batch  integer      NOT NULL,
  applied_at       timestamp    NOT NULL,
  PRIMARY KEY (job_id, target_type, target_id, action)
);
```

핵심은 `job_id + target_id + action`을 멱등 키로 쓰는 것입니다. 같은 job이 재시작돼도 이미 처리한 row는 건너뛰고, before hash가 달라졌다면 stale candidate로 보고 중단합니다. 이렇게 해야 보정 작업이 온라인 쓰기와 충돌했을 때 조용히 덮어쓰지 않습니다.

### 4) 고위험 보정은 rollback보다 compensation을 먼저 생각한다

데이터 보정에서 "rollback 가능"이라는 말은 종종 과장됩니다. 결제나 포인트는 이미 사용자에게 알림이 갔고, 외부 PG나 회계 시스템에 전파됐을 수 있습니다. 이 경우 물리적으로 예전 row로 되돌리는 것이 오히려 더 위험합니다. 대신 반대 방향 원장 이벤트를 추가하는 compensation이 더 안전할 때가 많습니다.

예를 들어 포인트가 1,000점 중복 적립됐다면 기존 원장을 삭제하지 않고 `CORRECTION_DEBIT` 이벤트를 추가합니다. 쿠폰이 잘못 복구됐다면 쿠폰 상태를 직접 덮어쓰기보다 correction reason과 함께 취소 이벤트를 남깁니다. 권한이 잘못 부여됐다면 revoke 이벤트와 감사 로그를 남기고, 노출 가능 기간을 별도 인시던트 기록으로 닫습니다.

이 사고방식은 [Poison Message Quarantine/Safe Replay](/learning/deep-dive/deep-dive-poison-message-quarantine-safe-replay-playbook/)와도 비슷합니다. 안전한 재처리와 보정은 "성공 로그"가 아니라 재실행 근거와 효과 기록으로 닫아야 합니다.

## 실무 적용

### 1) Correction Job 상태 머신을 명시한다

상태가 없으면 운영자는 job이 안전한지 판단할 수 없습니다. 최소 상태는 아래처럼 둡니다.

```text
DRAFT
  -> DRY_RUN_READY
  -> APPROVAL_REQUIRED
  -> APPROVED
  -> APPLYING
  -> PAUSED
  -> VERIFYING
  -> CLOSED
  -> ABORTED
```

`DRAFT`에서는 후보 쿼리를 저장하고, `DRY_RUN_READY`에서는 실제 결과를 만들며, `APPROVED` 이후에만 쓰기 작업이 가능합니다. `PAUSED`는 실패가 아니라 정상 제어 상태입니다. 운영 DB CPU가 올라가거나 lock wait가 길어지면 자동으로 멈추고 나중에 재개할 수 있어야 합니다.

### 2) batch와 throttle 기준을 보수적으로 시작한다

초기 기본값은 아래 정도가 현실적입니다.

- batch size: 500~2,000 rows
- batch 간 sleep: 100~500ms
- 단일 transaction 시간: 2초 이하
- lock wait p95: 500ms 이하, 2초 초과 3회면 pause
- DB CPU p95: 65% 초과 5분 지속 시 pause
- apply error rate: 0.5% 초과 시 abort
- residual mismatch: apply 후 0.1% 초과면 close 금지

대량 보정은 빨리 끝내는 것이 목표가 아닙니다. 온라인 트래픽을 건드리지 않고, 잘못된 대상을 조기에 발견하고, 중간에 멈춰도 재개 가능한 것이 목표입니다. 대량 입력 작업의 실패 정책은 [Bulk Import Job](/learning/deep-dive/deep-dive-bulk-import-job-row-error-playbook/)과 같이 보면 좋습니다.

### 3) 승인 기준은 도메인별로 다르게 둔다

모든 job을 사람이 승인하면 느려지고, 모든 job을 자동화하면 위험합니다. 도메인별 기준을 나눕니다.

| 도메인 | 자동 가능 조건 | 승인 필요 조건 |
| --- | --- | --- |
| 읽기 모델/검색 인덱스 | 원본 재생성, 사용자 직접 영향 없음 | 권한/삭제 전파 포함 |
| 포인트/쿠폰 | 금액성 가치 0원, 파생값 재계산 | 사용자 잔액 변동, 만료 복구 |
| 결제/환불 | dry-run only 권장 | 실제 금액 상태 변경은 2인 승인 |
| 권한/RBAC | 권한 축소 일부 자동 가능 | 권한 부여, 관리자 권한, tenant 이동 |
| 개인정보 | 자동 삭제 전파는 가능 | 복구, 재노출, 외부 전송 관련 변경 |

특히 권한과 개인정보는 처리 건수보다 변경 방향이 중요합니다. 권한 축소 1만 건보다 관리자 권한 부여 1건이 더 위험할 수 있습니다.

### 4) 종료 기준을 숫자로 닫는다

Correction Job은 "다 돌았다"가 아니라 "검증 기준을 만족했다"로 닫아야 합니다.

- dry-run 후보 대비 적용 완료율: 99.9% 이상
- residual mismatch: 일반 데이터 0.1% 이하, 금액/권한/개인정보 0건
- effect ledger 누락: 0건
- apply 후 reconciliation 재검사 통과
- 사용자 고지나 CS 대응이 필요한 건은 ticket 연결 완료
- 후속 재발 방지 action owner 지정

장애 대응과 연결된 보정이라면 [Incident Command와 Severity](/learning/deep-dive/deep-dive-incident-command-severity-playbook/)의 closure 기준에 넣는 편이 좋습니다. API 복구, 데이터 보정, 사용자 영향 확인, 재발 방지 항목이 분리되어야 합니다.

## 트레이드오프/주의점

첫째, Correction Job 체계를 만들면 초기 속도는 느려집니다. 후보 쿼리만 짜면 끝날 일을 dry-run, 승인, effect ledger, verification으로 나누기 때문입니다. 하지만 장애 후 같은 실수를 반복하지 않으려면 이 비용이 필요합니다. 특히 월 1회 이상 보정이 반복되는 도메인은 수동 SQL보다 job화하는 편이 결국 더 빠릅니다.

둘째, 자동 보정률을 KPI로 삼으면 위험합니다. 좋은 지표는 자동 처리 비율이 아니라 오보정률, 승인 대기 시간, residual mismatch, 재실행 성공률입니다. 자동으로 많이 고치는 팀보다, 위험한 건을 정확히 멈추는 팀이 더 안정적입니다.

셋째, 감사 로그에 원문 개인정보를 남기면 보정 체계가 새로운 보안 리스크가 됩니다. before/after 전체 값을 저장하기보다 hash, masked sample, reason code, owner, approval record를 남기고, 원문 조회는 break-glass 절차로 제한합니다.

넷째, 보정 job과 온라인 쓰기가 같은 row를 건드릴 수 있습니다. stale candidate 검증 없이 덮어쓰면 최신 사용자 행동을 되돌릴 수 있습니다. apply 직전 `updated_at`, version, before hash를 다시 확인하고 달라졌다면 skip 또는 재분류해야 합니다.

의사결정 우선순위는 **정답 기준 고정 > 대상 산정 정확도 > 오보정 방지 > 재실행 안전성 > 처리 속도**입니다. 빠른 보정은 이 순서를 지킬 때만 가치가 있습니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 보정 대상 산정 쿼리와 실제 수정 쿼리를 분리했다.
- [ ] dry-run report에 건수, 금액 합계, 샘플, 제외 사유, 중단 조건이 포함된다.
- [ ] job 상태 머신과 승인 상태가 저장된다.
- [ ] effect ledger에 job_id, target_id, before/after hash, reason, approver가 남는다.
- [ ] 재시작 시 이미 적용된 row를 건너뛰는 멱등 키가 있다.
- [ ] lock wait, DB CPU, error rate, residual mismatch 기준으로 pause/abort가 동작한다.
- [ ] 종료 전 reconciliation 재검사와 사용자 영향 closure를 확인한다.

### 연습

1. 최근 운영에서 수동 SQL로 고친 사례 하나를 골라 candidate query, dry-run report, approval 기준, apply batch, verification 기준으로 다시 작성해 보세요.
2. 포인트 중복 적립 5,000건을 보정한다고 가정하고 자동 보정 가능 조건과 2인 승인 조건을 숫자로 나눠 보세요.
3. 권한이 잘못 부여된 사용자 30명을 수정하는 job을 설계하고, before/after 원문을 저장하지 않으면서도 감사 가능한 effect ledger 필드를 정해 보세요.

## 관련 글

- [Reconciliation 파이프라인으로 금액·포인트 데이터 불일치 줄이기](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)
- [배치 멱등성·재처리 전략](/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/)
- [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)
- [Bulk Import Job, 대량 업로드 운영 설계](/learning/deep-dive/deep-dive-bulk-import-job-row-error-playbook/)
- [Incident Command와 Severity 운영](/learning/deep-dive/deep-dive-incident-command-severity-playbook/)
