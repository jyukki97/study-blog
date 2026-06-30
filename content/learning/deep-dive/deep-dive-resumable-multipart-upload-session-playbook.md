---
title: "백엔드 커리큘럼 심화: Resumable Multipart Upload Session, 대용량 업로드를 재개 가능하게 운영하는 법"
date: 2026-06-30
draft: false
topic: "File Upload"
tags: ["File Upload", "Multipart Upload", "Presigned URL", "Object Storage", "Checksum", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "대용량 파일 업로드를 단일 요청이 아니라 upload session, part ledger, checksum, 완료 검증, 만료 정리로 운영하는 기준을 정리합니다."
module: "backend-reliability"
study_order: 1245
keywords: ["resumable upload", "multipart upload", "presigned url", "upload session", "object storage upload"]
key_takeaways:
  - "100MB 이상 파일이나 불안정한 네트워크 업로드는 단일 HTTP 요청보다 재개 가능한 multipart upload session으로 다루는 편이 안전하다."
  - "업로드 성공 여부는 클라이언트 콜백이 아니라 서버의 session state, part ledger, checksum, object storage complete 결과로 판정해야 한다."
  - "multipart upload는 사용자 경험을 개선하지만 미완료 part 비용, 세션 만료, 중복 완료, 스캔 전 공개 같은 운영 위험을 함께 만든다."
operator_checklist:
  - "파일 유형별 최대 크기, part size, 동시 업로드 수, session TTL, idle timeout을 숫자로 문서화한다."
  - "upload_session과 upload_part 테이블에 상태, checksum, part 번호, attempt, expires_at을 남긴다."
  - "미완료 multipart upload를 1~7일 안에 abort하고 orphan object와 DB 상태를 reconciliation한다."
learning_refs:
  - title: "Request Body Guardrail과 Streaming"
    href: "/learning/deep-dive/deep-dive-request-body-guardrail-streaming-playbook/"
    description: "서버가 큰 본문을 직접 받을지, direct upload로 넘길지 판단하는 기준입니다."
  - title: "Object Upload Quarantine과 비동기 스캔"
    href: "/learning/deep-dive/deep-dive-object-upload-quarantine-scanning-playbook/"
    description: "업로드 완료와 공개 가능 상태를 분리하는 보안 운영 기준입니다."
  - title: "Object Storage와 파일 관리"
    href: "/learning/deep-dive/deep-dive-object-storage-s3/"
    description: "Presigned URL, S3, multipart upload의 기본 개념을 복습하기 좋습니다."
  - title: "비동기 요청-응답 Operation Resource"
    href: "/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/"
    description: "오래 걸리는 작업을 상태 API와 operation resource로 관리하는 패턴입니다."
---

파일 업로드는 처음에는 간단합니다. `multipart/form-data`로 서버에 올리고, 서버가 디스크나 S3 같은 object storage에 저장하면 됩니다. 하지만 파일이 300MB, 2GB, 10GB로 커지고 사용자가 모바일 네트워크나 사내 프록시 뒤에서 업로드하기 시작하면 이 방식은 금방 흔들립니다. 요청 하나가 10분 동안 열린 채로 유지되고, 중간에 끊기면 처음부터 다시 올려야 하며, 서버는 임시 파일과 커넥션을 오래 붙잡습니다. 사용자는 "업로드 실패"를 보지만 운영자는 어느 부분까지 올라갔는지 설명하지 못합니다.

이때 필요한 관점이 **Resumable Multipart Upload Session**입니다. 업로드를 단일 HTTP 요청이 아니라 `session 생성 -> part 업로드 -> part 검증 -> complete -> 스캔/공개`로 나눕니다. 클라이언트는 실패한 part만 다시 올리고, 서버는 업로드 상태를 DB row와 object storage 상태로 추적합니다. 이 글은 [Request Body Guardrail](/learning/deep-dive/deep-dive-request-body-guardrail-streaming-playbook/), [Object Storage와 파일 관리](/learning/deep-dive/deep-dive-object-storage-s3/), [Object Upload Quarantine](/learning/deep-dive/deep-dive-object-upload-quarantine-scanning-playbook/), [비동기 Operation Resource](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/)를 대용량 업로드 운영 관점으로 묶습니다.

## 이 글에서 얻는 것

- 단일 업로드, presigned direct upload, resumable multipart upload를 어떤 기준으로 나눌지 판단할 수 있습니다.
- upload session과 upload part ledger를 어떻게 설계해야 중단, 재개, 중복 완료, 만료 정리를 설명할 수 있는지 이해합니다.
- part size, presigned URL TTL, 동시 업로드 수, checksum, session TTL 같은 숫자 기준을 잡을 수 있습니다.
- 대용량 업로드 이후 스캔, 공개, orphan part 정리, 비용 모니터링까지 하나의 운영 흐름으로 설계할 수 있습니다.

## 핵심 개념/이슈

### 1) 대용량 업로드는 요청이 아니라 상태를 가진 작업이다

10MB 이하의 작은 이미지나 문서는 서버 경유 업로드도 현실적입니다. 서버가 검증하고 저장하고 응답하면 됩니다. 하지만 파일이 커질수록 업로드는 API 요청보다 비동기 작업에 가까워집니다. 사용자는 업로드를 시작하고, 여러 part를 보내고, 네트워크가 끊기면 일부를 다시 보내며, 마지막에 완료 요청을 보냅니다. 서버는 그 사이 상태를 기억해야 합니다.

실무 출발 기준은 아래처럼 둘 수 있습니다.

| 파일 크기/조건 | 권장 방식 | 이유 |
| --- | --- | --- |
| 10MB 이하 | 서버 경유 또는 단일 presigned PUT | 구현 단순성 우선 |
| 10~100MB | presigned direct upload | 앱 서버 대역폭과 temp disk 보호 |
| 100MB 이상 | multipart upload session | 중단 재개, 병렬 전송, 실패 part 재시도 필요 |
| 1GB 이상 또는 모바일 네트워크 | resumable multipart 필수에 가깝게 운영 | 처음부터 재시작 비용이 너무 큼 |

숫자는 서비스마다 조정해야 합니다. 핵심은 "업로드가 오래 걸릴 수 있다"는 사실을 API 계약에 반영하는 것입니다. 100MB 이상 파일을 단일 요청으로 받는다면, reverse proxy timeout, application timeout, multipart temp dir, client retry, 사용자 새로고침까지 모두 장애 원인이 됩니다.

### 2) upload session은 object key보다 먼저 만들어야 한다

클라이언트가 바로 object storage에 part를 올리게 하더라도, 서버에는 먼저 upload session이 있어야 합니다. 이 row가 source of truth입니다. 객체가 일부 올라와도 session이 없으면 누구의 파일인지, 언제까지 유지할지, 어떤 정책으로 검사할지 알 수 없습니다.

권장 상태 전이는 아래처럼 시작할 수 있습니다.

```text
INITIATED -> PART_UPLOADING -> COMPLETING -> UPLOADED -> SCANNING -> CLEAN -> PUBLISHED
      |             |              |             |          |
      v             v              v             v          v
   EXPIRED       ABORTED         FAILED       REJECTED    EXPIRED
```

`INITIATED`는 서버가 업로드 의도를 등록한 상태입니다. `PART_UPLOADING`은 하나 이상의 part URL이 발급됐거나 part가 올라오는 상태입니다. `COMPLETING`은 클라이언트가 complete 요청을 보냈고 서버가 object storage에 multipart complete를 시도하는 상태입니다. `UPLOADED`는 object storage 기준으로 하나의 객체가 완성된 상태입니다. 공개 가능 여부는 아직 아닙니다. 공개는 [Object Upload Quarantine](/learning/deep-dive/deep-dive-object-upload-quarantine-scanning-playbook/)의 스캔과 정책 검증 이후에만 결정합니다.

### 3) part ledger가 없으면 재개 가능한 척만 하게 된다

Multipart upload를 쓴다고 해서 자동으로 재개 가능해지는 것은 아닙니다. 서버가 어떤 part가 성공했고 어떤 part를 다시 보내야 하는지 설명할 수 있어야 합니다. 이를 위해 `upload_part` 같은 ledger가 필요합니다.

최소 필드는 아래 정도입니다.

```sql
CREATE TABLE upload_session (
  session_id          varchar(64) PRIMARY KEY,
  tenant_id           varchar(64) NOT NULL,
  owner_id            varchar(64) NOT NULL,
  file_id             varchar(64) NOT NULL,
  object_key          varchar(512) NOT NULL,
  storage_upload_id   varchar(256),
  status              varchar(32) NOT NULL,
  declared_size_bytes bigint NOT NULL,
  actual_size_bytes   bigint,
  part_size_bytes     int NOT NULL,
  total_parts         int NOT NULL,
  content_type        varchar(120),
  checksum_sha256     varchar(80),
  created_at          timestamptz NOT NULL,
  expires_at          timestamptz NOT NULL,
  completed_at        timestamptz
);

CREATE TABLE upload_part (
  session_id          varchar(64) NOT NULL,
  part_number         int NOT NULL,
  status              varchar(32) NOT NULL,
  size_bytes          int,
  checksum_sha256     varchar(80),
  storage_etag        varchar(160),
  uploaded_at         timestamptz,
  attempt_count       int NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, part_number)
);
```

여기서 중요한 점은 object storage의 ETag를 파일 전체 checksum으로 착각하지 않는 것입니다. 특히 S3 multipart upload의 ETag는 단일 PUT의 MD5와 의미가 다를 수 있습니다. 무결성을 확실히 보려면 part별 checksum과 전체 파일 checksum을 별도로 저장하고, complete 이후 실제 object metadata 또는 별도 hash 계산으로 검증해야 합니다.

### 4) part size와 동시성은 사용자 경험과 비용을 동시에 바꾼다

part를 너무 작게 잡으면 요청 수가 폭증합니다. part를 너무 크게 잡으면 실패한 part를 다시 올리는 비용이 커지고 모바일에서 체감이 나빠집니다. S3 multipart upload는 마지막 part를 제외하고 최소 5MB 제한이 있지만, 실무 기본값은 그보다 크게 잡는 편이 많습니다.

권장 시작점:

| 환경 | part size | 클라이언트 병렬 수 | 비고 |
| --- | ---: | ---: | --- |
| 브라우저 일반 문서 | 16~32MB | 3~4 | 진행률 표시와 재시도 균형 |
| 모바일 네트워크 | 8~16MB | 1~3 | 배터리와 네트워크 변동 고려 |
| 사내 안정망/데스크톱 | 32~64MB | 4~6 | 대역폭이 충분할 때 |
| 대용량 미디어/전용 클라이언트 | 64~128MB | 4~8 | 서버와 storage throttling 확인 필요 |

동시성을 높이면 빠르게 보일 수 있지만, tenant 하나가 대역폭과 storage request budget을 독점할 수 있습니다. 그래서 서버는 session당, 사용자당, tenant당 active part upload 수를 제한해야 합니다. 출발점은 사용자당 동시 session 2개, session당 part 병렬 4개, tenant당 총 active part 20~50개 정도로 두고 실제 트래픽에서 조정합니다.

### 5) complete 요청은 멱등해야 한다

사용자가 마지막 part를 올린 뒤 `POST /uploads/{sessionId}/complete`를 호출했다고 가정해 봅시다. 이 요청이 timeout나면 클라이언트는 다시 complete를 호출할 수 있습니다. 서버가 이때 새 객체를 만들거나 상태를 꼬이게 하면 안 됩니다.

complete는 아래 조건을 확인한 뒤 멱등하게 동작해야 합니다.

1. session이 현재 사용자/tenant의 것인지 확인
2. status가 `PART_UPLOADING` 또는 `COMPLETING`인지 확인
3. 필요한 part가 모두 `UPLOADED`인지 확인
4. part number, ETag/checksum 목록이 storage complete 요청과 일치하는지 확인
5. 이미 `UPLOADED` 이상이면 같은 결과를 반환
6. 완료 실패가 recoverable이면 `FAILED_RETRYABLE`, 불가능하면 `FAILED` 또는 `ABORTED`

이 구조는 [Idempotency 설계](/learning/deep-dive/deep-dive-idempotency/)와 같습니다. 중복 요청은 에러가 아니라 정상적인 네트워크 현실입니다. 특히 complete는 외부 storage 상태와 DB 상태를 함께 바꾸므로, 재시도해도 같은 결론으로 닫히게 만들어야 합니다.

## 실무 적용

### 1) API 계약을 세 단계로 나눈다

대용량 업로드 API는 최소 세 단계로 나누는 편이 좋습니다.

```text
POST /uploads
  -> upload session 생성, part_size, total_parts, expires_at 반환

POST /uploads/{sessionId}/parts/{partNumber}/url
  -> 해당 part에 대한 짧은 TTL presigned URL 반환

POST /uploads/{sessionId}/complete
  -> part 목록 검증 후 storage multipart complete, 상태 전이
```

추가로 클라이언트 재개를 위해 조회 API가 필요합니다.

```text
GET /uploads/{sessionId}
  -> status, uploaded_parts, missing_parts, expires_at, retry_after 반환
```

이 API가 있어야 브라우저 새로고침, 앱 재실행, 네트워크 끊김 이후에도 이어서 올릴 수 있습니다. 클라이언트가 로컬에 `sessionId`, `file fingerprint`, `part size`를 저장하고, 서버에서 missing part를 받아 실패한 부분만 다시 올리는 구조가 됩니다.

### 2) TTL을 URL, session, object cleanup으로 분리한다

만료 정책은 하나로 끝나지 않습니다. 최소 세 가지 시간이 필요합니다.

| 대상 | 권장 시작값 | 목적 |
| --- | ---: | --- |
| part presigned URL | 5~15분 | 임시 권한 노출 축소 |
| upload session idle timeout | 30~60분 | 방치된 업로드 감지 |
| upload session TTL | 24시간 | 사용자 재개 허용 범위 |
| incomplete multipart cleanup | 1~7일 | storage 비용과 orphan part 정리 |
| quarantine object TTL | 1~7일 | 미스캔/미처리 파일 정리 |

presigned URL은 짧게, session은 조금 길게, incomplete multipart storage cleanup은 lifecycle rule과 배치로 확실히 둡니다. URL이 만료됐다고 session을 바로 죽이면 사용자는 재개할 수 없습니다. 반대로 session이 만료됐는데 storage part가 계속 남아 있으면 비용이 새고, object key가 재사용될 때 혼란이 생깁니다.

### 3) 완료 후에는 스캔과 공개를 분리한다

Multipart complete가 성공하면 파일은 storage에 존재합니다. 하지만 사용자가 접근해도 되는 파일이라는 뜻은 아닙니다. 완료 이후에는 [Object Upload Quarantine](/learning/deep-dive/deep-dive-object-upload-quarantine-scanning-playbook/)과 같은 정책으로 넘어가야 합니다.

권장 흐름:

1. complete 성공 후 `UPLOADED` 상태로 전이
2. 실제 size, part count, checksum 검증
3. content type, magic byte, 확장자 검사
4. malware scan 또는 media transcode job 생성
5. `CLEAN` 판정 후 clean bucket/prefix로 이동하거나 공개 metadata 갱신
6. 다운로드 API는 DB 상태가 `CLEAN/PUBLISHED`일 때만 signed URL 발급

대용량 미디어는 스캔뿐 아니라 transcoding이 붙을 수 있습니다. 이때 업로드 session과 transcoding job을 섞지 않는 편이 좋습니다. 업로드의 완료 기준은 "원본 객체가 안전하게 수신됨"이고, 서비스 공개 기준은 "정책상 사용 가능한 파생 산출물이 준비됨"입니다.

### 4) 업로드 품질 지표를 별도로 본다

업로드 장애는 API error rate만으로 잘 보이지 않습니다. 사용자는 part 재시도 끝에 성공할 수 있고, 서버 API는 200을 많이 내지만 체감은 나쁠 수 있습니다.

대시보드에는 최소 아래 지표를 둡니다.

| 지표 | 권장 기준 |
| --- | --- |
| `upload_session_started_total` | 파일 유형/tenant별 추세 |
| `upload_session_completed_ratio` | 일반 문서 95% 이상, 대용량은 별도 baseline |
| `part_retry_rate` | 5% 초과 시 네트워크/part size 점검 |
| `complete_failure_rate` | 0.5% 이하 목표 |
| `orphan_multipart_bytes` | 일별 증가량 0에 가깝게 |
| `upload_resume_success_ratio` | 재개 시도 중 최종 완료 비율 |
| `scan_pending_age_p95` | 파일 유형별 SLA 이내 |
| `abort_cleanup_lag` | cleanup 정책 대비 지연 |

특히 `orphan_multipart_bytes`는 비용 신호입니다. 미완료 part는 사용자에게 보이지 않지만 storage 비용은 쌓입니다. 트래픽이 많은 서비스에서 cleanup이 며칠 멈추면 생각보다 큰 비용과 quota 압박으로 이어집니다.

## 트레이드오프/주의점

첫째, multipart upload는 구현 복잡도가 큽니다. 작은 파일만 받는 서비스라면 단일 presigned upload와 size limit으로 충분합니다. 20MB 파일에 multipart session, part ledger, cleanup worker를 모두 붙이면 과설계입니다.

둘째, 클라이언트 구현 품질이 중요합니다. 서버가 잘 설계돼도 브라우저가 session id를 잃어버리거나, 실패 part를 모두 다시 올리거나, complete 전에 모든 part 성공 여부를 확인하지 않으면 사용자 경험은 나빠집니다. 웹, iOS, Android, CLI 클라이언트가 있다면 같은 upload protocol contract를 공유해야 합니다.

셋째, part checksum을 생략하면 장애 분석이 어려워집니다. 네트워크 중간 장비, 브라우저 버그, 클라이언트 파일 변경, 잘못된 resume이 섞이면 "객체는 있는데 원본과 다르다"는 최악의 상황이 생깁니다. 최소 part size, 전체 size, 전체 checksum 중 하나 이상은 강제하는 편이 안전합니다.

넷째, 세션 만료와 사용자 기대가 충돌할 수 있습니다. 사용자는 어제 올리던 8GB 파일을 오늘 이어서 올리고 싶어 할 수 있지만, 시스템은 storage cost와 임시 권한 노출을 줄여야 합니다. 대용량 미디어 서비스가 아니라면 24시간 session TTL과 1~7일 incomplete cleanup 정도가 현실적인 출발점입니다.

다섯째, direct upload는 앱 서버를 보호하지만 권한 모델을 없애지 않습니다. presigned URL은 특정 object key와 method, 만료 시간에만 유효해야 하며, 사용자가 임의 tenant key로 업로드할 수 없어야 합니다. object key는 서버가 만들고, overwrite는 version 또는 attempt id로 통제합니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] 파일 유형별 최대 크기와 업로드 방식을 문서화했다.
- [ ] 100MB 이상 파일은 multipart/resumable upload 후보로 분리했다.
- [ ] upload session과 part ledger에 status, checksum, ETag, attempt, expires_at이 있다.
- [ ] part presigned URL TTL은 짧고, session TTL과 cleanup TTL은 별도다.
- [ ] complete API는 중복 호출되어도 같은 결과를 반환한다.
- [ ] multipart complete 이후 바로 공개하지 않고 스캔/정책 검증 상태로 넘긴다.
- [ ] incomplete multipart upload cleanup과 orphan object reconciliation이 있다.
- [ ] upload completion ratio, part retry rate, orphan bytes, scan pending age를 모니터링한다.

### 연습

1. 현재 서비스에서 가장 큰 파일 업로드 기능 하나를 고르고, 10MB/100MB/1GB 기준으로 어떤 업로드 방식을 적용할지 표로 나눠 보세요.
2. `upload_session`과 `upload_part` 테이블을 직접 설계하고, 네트워크가 70% 지점에서 끊긴 뒤 재개하는 시나리오를 상태 전이로 써 보세요.
3. 사용자가 complete 요청을 두 번 보낸 경우, 첫 번째는 storage complete 성공 후 API timeout, 두 번째는 재호출이라고 가정하고 서버가 어떤 응답을 내려야 하는지 정리해 보세요.
4. 미완료 multipart part가 3일 동안 쌓인 상황을 가정하고, 어떤 lifecycle rule, 배치, 알람, 사용자 안내가 필요한지 runbook 10줄로 작성해 보세요.

정리하면 대용량 업로드의 핵심은 빠른 전송 기술이 아니라 **설명 가능한 상태 관리**입니다. 어떤 part가 올라갔고, 무엇을 다시 올리면 되며, 언제 만료되고, 완료 후 어떤 검증을 거쳐 공개되는지 답할 수 있어야 합니다. 그 답이 없으면 multipart upload는 안정성 기능이 아니라 실패를 여러 조각으로 나누는 복잡한 장치가 됩니다.
