---
title: "백엔드 커리큘럼 심화: Request Body Guardrail, 큰 요청 본문을 안전하게 받는 법"
date: 2026-06-28
draft: false
topic: "Backend Reliability"
tags: ["HTTP", "Request Body", "File Upload", "Streaming", "Rate Limit", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "큰 JSON, 파일 업로드, multipart 요청을 서버가 언제 거절하고 언제 스트리밍·비동기 처리로 넘겨야 하는지 실무 기준으로 정리합니다."
module: "backend-resilience"
study_order: 1246
key_takeaways:
  - "요청 본문은 애플리케이션 코드에 도달하기 전부터 CDN, LB, gateway, app server, parser에서 각각 예산을 가져야 한다."
  - "큰 요청은 메모리에 올려 처리하기보다 직접 업로드, 스트리밍, 비동기 job 모델 중 하나로 분리해야 한다."
  - "body size, 처리 시간, 임시 파일, 재시도, 멱등성, 관측 지표를 함께 설계해야 장애와 중복 처리를 줄일 수 있다."
operator_checklist:
  - "endpoint별 최대 body size, content-type, timeout, retry 허용 여부를 문서화한다."
  - "10MB를 넘는 요청은 동기 JSON 처리 대신 object storage direct upload 또는 async operation으로 분리한다."
  - "413, 415, 422, 202 응답 기준과 업로드 상태 조회 API를 함께 제공한다."
learning_refs:
  - title: "Async Request-Reply Operation Resource"
    href: "/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/"
    description: "긴 작업을 동기 요청이 아니라 상태 있는 operation resource로 분리하는 기준입니다."
  - title: "Object Upload Quarantine Scanning"
    href: "/learning/deep-dive/deep-dive-object-upload-quarantine-scanning-playbook/"
    description: "업로드 완료와 처리 가능 상태를 분리하고 검사 단계를 두는 보안 설계입니다."
  - title: "Bulk Import Job"
    href: "/learning/deep-dive/deep-dive-bulk-import-job-row-error-playbook/"
    description: "CSV·엑셀·JSONL 대량 업로드를 job, row error, 멱등성으로 운영하는 방법입니다."
decision_guide:
  cases:
    - badge: "동기 처리"
      title: "작은 JSON 요청"
      fit: "대부분 1MB 이하이고 300ms 안에 검증·저장이 끝나는 요청"
      watchouts: "클라이언트 버그로 20MB JSON이 들어오는 경로를 열어두면 heap과 parser가 먼저 터진다."
      next_step: "endpoint별 body limit과 validation error 응답을 고정한다."
    - badge: "분리 권장"
      title: "파일·대량 데이터 요청"
      fit: "10MB 이상, 행 단위 검증, 바이러스 검사, 변환, 재처리가 필요한 요청"
      watchouts: "업로드 성공과 업무 반영 성공을 같은 HTTP 200으로 묶으면 재시도와 장애 분석이 어려워진다."
      next_step: "presigned upload, quarantine, async import job, status API로 나눈다."
faqs:
  - question: "큰 파일을 서버가 받아서 바로 S3에 올리면 안 되나요?"
    answer: "가능하지만 서버 네트워크, temp disk, timeout, 재시도 비용을 직접 떠안습니다. 10~50MB를 넘는 업로드가 잦다면 presigned URL이나 multipart direct upload가 보통 더 안전합니다."
  - question: "body size limit은 하나만 두면 충분한가요?"
    answer: "아닙니다. CDN, gateway, app server, framework parser, endpoint 정책이 서로 다르게 실패할 수 있으므로 계층별 한도와 에러 응답을 맞춰야 합니다."
---

요청 본문은 백엔드에서 가장 과소평가되는 자원 중 하나입니다. `POST /orders`의 4KB JSON과 `POST /imports`의 80MB CSV는 같은 HTTP 요청처럼 보이지만, 서버가 감당해야 하는 비용은 완전히 다릅니다. 하나는 메모리에 올려 검증하고 트랜잭션으로 저장해도 됩니다. 다른 하나는 네트워크 대역폭, reverse proxy buffer, 애플리케이션 heap, multipart temp file, DB I/O, 재시도, 사용자 대기 시간을 모두 흔듭니다.

문제는 큰 요청이 보통 장애 전까지 조용하다는 점입니다. 개발 환경에서는 10행짜리 파일만 올립니다. QA에서는 2MB 샘플만 씁니다. 운영에서는 파트너가 30만 행짜리 파일을 올리고, 모바일 클라이언트가 같은 요청을 세 번 재시도하고, gateway는 body를 다 읽은 뒤에야 인증 실패를 돌려줍니다. 이때 서버는 "비즈니스 로직이 느리다"가 아니라 **요청을 받아들이는 입구부터 예산이 없어서** 무너집니다.

이 글은 [Async Request-Reply Operation Resource](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/), [Object Upload Quarantine Scanning](/learning/deep-dive/deep-dive-object-upload-quarantine-scanning-playbook/), [Bulk Import Job](/learning/deep-dive/deep-dive-bulk-import-job-row-error-playbook/), [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)와 이어지는 주제입니다. 핵심은 큰 요청을 "잘 파싱하기"가 아니라, **받을지 말지, 어디까지 읽을지, 어떤 상태로 넘길지**를 먼저 결정하는 것입니다.

## 이 글에서 얻는 것

- 요청 본문 크기가 애플리케이션 heap, proxy buffer, temp disk, timeout에 어떤 압력을 주는지 이해합니다.
- endpoint별 body size limit, content-type allowlist, streaming 처리 기준을 숫자로 잡을 수 있습니다.
- 파일 업로드와 대량 JSON 요청을 동기 처리, direct upload, async job으로 나누는 판단 기준을 정리합니다.
- `413 Payload Too Large`, `415 Unsupported Media Type`, `422 Validation Failed`, `202 Accepted`를 어떤 상황에 쓸지 구분합니다.
- 큰 요청에서 멱등성, 재시도, 관측 지표를 함께 설계하는 체크리스트를 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) 요청 본문은 애플리케이션 코드보다 먼저 자원을 쓴다

많은 개발자가 controller 메서드에 도달한 뒤의 처리 시간만 봅니다. 하지만 큰 body는 그 전에 이미 비용을 씁니다.

- CDN이나 WAF가 body를 읽으며 검사합니다.
- Load balancer나 reverse proxy가 buffering합니다.
- Web server가 multipart temp file을 만듭니다.
- Framework가 JSON을 객체로 역직렬화합니다.
- Validation이 실패해도 이미 네트워크와 CPU를 썼습니다.

그래서 body guardrail은 controller의 `if (file.size > limit)`만으로 부족합니다. 입구 계층에서 너무 큰 요청을 빨리 거절하고, 애플리케이션 내부에서는 endpoint 의미에 맞게 한 번 더 제한해야 합니다.

권장 시작 기준은 아래처럼 둡니다.

| 요청 유형 | 기본 처리 | 권장 한도 |
| --- | --- | --- |
| 일반 JSON command | 동기 처리 | 256KB~1MB |
| 검색/필터 JSON | 동기 또는 QUERY/POST 분리 | 64KB~512KB |
| 이미지·문서 업로드 metadata | 동기 + object key 참조 | 32KB 이하 |
| multipart 파일 업로드 | direct upload 우선 | 서버 경유 10MB 이하 |
| CSV·JSONL import | async job | 파일 10MB 이상부터 분리 |
| 동영상·대형 압축 파일 | multipart direct upload | 서버 경유 금지에 가깝게 운영 |

숫자는 서비스마다 달라질 수 있습니다. 중요한 것은 기본값을 무제한으로 두지 않는 것입니다. 특히 JSON body는 압축을 풀고 객체로 만들 때 원본보다 훨씬 큰 heap을 잡을 수 있습니다. 5MB JSON이 파싱 뒤 50MB 이상의 객체 그래프로 바뀌는 일도 드물지 않습니다.

### 2) limit은 한 곳이 아니라 계층별로 맞춰야 한다

body limit이 여러 계층에서 다르면 사용자와 운영자 모두 혼란스럽습니다. 예를 들어 gateway는 50MB까지 허용하는데 Spring multipart limit은 10MB라면, 사용자는 업로드가 오래 걸린 뒤에야 실패를 봅니다. 반대로 app은 100MB를 처리할 수 있는데 CDN이 20MB에서 자르면 개발팀은 application log에서 아무것도 못 봅니다.

최소한 아래 계층을 표로 맞춰야 합니다.

| 계층 | 봐야 할 값 | 실패 응답 |
| --- | --- | --- |
| CDN/WAF | max upload size, inspection timeout | 413 또는 provider error |
| Load balancer | idle timeout, request timeout | 408/502/504 |
| Gateway/Nginx | `client_max_body_size`, buffering | 413 |
| App server | max post size, multipart temp dir | 413/500 |
| Framework | JSON parser limit, multipart part limit | 400/413 |
| Endpoint policy | content-type, business size limit | 413/415/422 |

운영 기준은 "가장 바깥 계층이 가장 빠르게 거절"입니다. 단, 사용자에게 의미 있는 에러 메시지를 주고 싶다면 gateway나 API layer에서 일관된 오류 포맷을 만들어야 합니다.

### 3) buffering, streaming, direct upload는 서로 다른 선택지다

큰 요청을 처리하는 방법은 대략 세 가지입니다.

첫째, **buffering**입니다. body를 메모리나 temp file에 다 받은 뒤 처리합니다. 구현이 쉽고 validation이 단순하지만, 큰 요청에서는 heap과 disk가 병목이 됩니다. 1MB 이하 JSON command나 작은 form submit에 적합합니다.

둘째, **streaming**입니다. 요청을 조금씩 읽으며 파싱하거나 object storage로 흘려보냅니다. 메모리 사용량을 줄일 수 있지만 중간 실패, 부분 처리, checksum, validation 순서가 복잡해집니다. CSV line validation이나 압축 해제, virus scan pipeline에는 유용하지만, DB 트랜잭션과 직접 묶으면 위험합니다.

셋째, **direct upload**입니다. 클라이언트가 서버에서 짧은 업로드 권한을 받고 object storage에 직접 올립니다. 서버는 파일 자체가 아니라 object key, checksum, size, content-type, owner만 받습니다. 10MB 이상 파일이 반복적으로 들어온다면 이 방식이 기본값에 가깝습니다.

의사결정 기준은 아래처럼 잡을 수 있습니다.

- 1MB 이하, 300ms 안에 끝나는 command: 동기 JSON
- 1~10MB, 드문 요청, 즉시 검증 필요: 제한적 서버 경유 + 엄격한 timeout
- 10~100MB, 사용자 업로드: presigned URL + quarantine + async processing
- 100MB 이상 또는 불안정 네트워크: multipart direct upload + resume + checksum
- 행 단위 업무 반영: upload와 apply를 분리한 import job

### 4) 큰 요청은 재시도와 멱등성을 같이 설계해야 한다

큰 요청은 실패하기 쉽고, 실패하면 사용자가 다시 시도합니다. 여기서 멱등성이 없으면 중복 데이터가 생깁니다. 특히 모바일, 브라우저, 파트너 배치, API gateway retry가 겹치면 같은 파일이나 같은 JSON payload가 여러 번 들어올 수 있습니다.

큰 요청의 멱등성 기준:

- 클라이언트가 `Idempotency-Key`를 보낼 수 있다.
- 서버는 body hash 또는 file checksum을 저장한다.
- 같은 key에 다른 body hash가 들어오면 `409 Conflict`로 막는다.
- upload 완료와 business apply 완료를 다른 상태로 둔다.
- 재시도는 새 작업 생성이 아니라 기존 operation 상태 조회로 이어진다.

이 기준은 [Idempotency Key](/learning/deep-dive/deep-dive-idempotency/)와 [Batch Idempotency/Reprocessing](/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/)에서 다룬 원칙과 같습니다. 큰 요청일수록 "다시 보내면 되겠지"가 아니라 "다시 보내도 같은 결과가 나오는가"를 먼저 설계해야 합니다.

### 5) 관측성은 body 원문이 아니라 비용과 상태를 남긴다

장애 분석을 위해 요청 본문을 로그에 남기고 싶을 때가 있습니다. 하지만 큰 body 원문은 로그 비용을 폭발시키고 개인정보와 시크릿 유출 위험을 키웁니다. 대신 아래 지표를 남기는 편이 안전합니다.

- endpoint별 body size p50/p95/p99
- content-type별 요청 수와 거절 수
- 413/415/422 비율
- multipart temp disk 사용량
- upload duration, client abort count
- body read timeout count
- async job 전환 후 processing lag
- checksum mismatch, duplicate upload count

원문 대신 `body_hash`, `file_size`, `content_type`, `operation_id`, `object_key_ref`를 남깁니다. 민감한 body는 [구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/) 기준으로 마스킹하거나 아예 저장하지 않는 편이 낫습니다.

## 실무 적용

### 1) endpoint별 body policy를 먼저 만든다

API 문서에는 요청 필드만이 아니라 body policy가 들어가야 합니다.

```yaml
endpoint: POST /imports/products
content_types:
  - text/csv
  - application/x-ndjson
max_server_body_size: 10MB
preferred_flow: direct_upload_then_async_import
sync_timeout: 5s
idempotency_required: true
checksum_required: true
max_rows_per_file: 300000
max_apply_rate: 1000 rows/sec
retry_policy:
  client_retry: status_polling_only
  duplicate_key: return_existing_operation
errors:
  too_large: 413
  unsupported_type: 415
  invalid_rows: 422
  accepted: 202
```

이 문서가 있으면 구현, QA, 운영이 같은 기준으로 봅니다. 특히 `max_server_body_size`와 `preferred_flow`를 분리해야 합니다. "최대 100MB까지 허용"이라는 말이 "100MB를 app server가 직접 받는다"는 뜻은 아닐 수 있습니다.

### 2) 업로드와 업무 반영을 분리한다

큰 파일 처리의 안정적인 흐름은 보통 아래 순서입니다.

1. 클라이언트가 업로드 intent를 만든다.
2. 서버가 object key, 만료 10~30분짜리 upload URL, 허용 content-type, size limit을 발급한다.
3. 클라이언트가 object storage에 직접 업로드한다.
4. 클라이언트가 checksum과 object key를 서버에 제출한다.
5. 서버가 quarantine 상태로 등록한다.
6. scanner 또는 validator가 파일을 검사한다.
7. 검증 통과 후 import job을 `ready_to_apply`로 바꾼다.
8. apply worker가 row 단위로 반영하고 상태를 갱신한다.

사용자에게는 업로드 성공, 검증 성공, 반영 성공이 모두 다르게 보여야 합니다. 업로드만 끝났는데 "처리 완료"처럼 보여주면 이후 실패를 설명하기 어렵습니다. 이 구조는 [Large Data Export Pipeline](/learning/deep-dive/deep-dive-large-data-export-pipeline-playbook/)에서 파일 생성과 다운로드 허용 상태를 나누는 방식과도 대칭입니다.

### 3) Spring 계열 기본값 예시

Spring MVC에서 multipart를 쓴다면 최소 아래 값을 명시적으로 둡니다.

```yaml
spring:
  servlet:
    multipart:
      max-file-size: 10MB
      max-request-size: 12MB
      file-size-threshold: 1MB
server:
  tomcat:
    max-http-form-post-size: 1MB
```

이 값은 예시일 뿐입니다. 중요한 것은 기능별로 다르게 보는 것입니다. 일반 form post와 파일 업로드를 같은 limit으로 묶으면 둘 중 하나가 망가집니다. 일반 API는 작게, 업로드 API는 별도 host/path/gateway rule로 분리하는 편이 운영이 쉽습니다.

또한 JSON body는 multipart 설정과 별개입니다. Jackson이나 validation 계층에서 깊은 nested object, 큰 array, field count를 제한해야 합니다. 배열 길이 10만 개짜리 JSON은 파일은 아니지만 서버 입장에서는 충분히 대형 입력입니다.

### 4) 실패 응답을 의도적으로 나눈다

큰 요청의 실패는 전부 `400 Bad Request`로 묶으면 안 됩니다.

| 상황 | 권장 응답 | 이유 |
| --- | --- | --- |
| body가 endpoint 한도 초과 | 413 | 클라이언트가 크기를 줄이거나 direct upload로 전환해야 함 |
| content-type 미지원 | 415 | CSV, JSONL, multipart 등 허용 형식을 명확히 안내 |
| 형식은 맞지만 row validation 실패 | 422 | 사용자가 데이터 내용을 고쳐야 함 |
| 처리 시간이 길어 비동기로 전환 | 202 | operation id로 상태 조회 |
| 같은 idempotency key, 다른 body | 409 | 중복 재시도와 다른 요청 충돌 구분 |

응답에는 가능한 범위에서 `max_size`, `allowed_content_types`, `operation_id`, `retry_after_seconds`를 넣습니다. 단, 보안 민감 업로드에서는 내부 검사 이유를 과하게 노출하지 않습니다.

## 트레이드오프/주의점

첫째, limit을 너무 낮게 잡으면 정상 사용자가 우회 경로를 만들거나 압축 파일을 억지로 쓰기 시작합니다. limit은 "작게"보다 "기능별로 설명 가능하게"가 중요합니다. 일반 JSON 1MB, 서버 경유 파일 10MB, direct upload 100MB 이상처럼 사용자가 이해할 수 있는 기준을 둡니다.

둘째, streaming은 만능이 아닙니다. 메모리를 줄이는 대신 재시작, 중간 실패, validation 순서, 부분 반영 문제가 생깁니다. streaming으로 읽으면서 DB에 바로 쓰는 구조는 실패 시 롤백 범위가 흐려지기 쉽습니다. 가능하면 streaming은 object storage나 staging table까지로 제한하고, 업무 반영은 별도 job에서 멱등하게 처리합니다.

셋째, 압축 파일은 실제 크기보다 위험할 수 있습니다. 5MB zip이 풀리면 수백 MB가 될 수 있고, nested archive나 path traversal 문제가 생길 수 있습니다. 압축 업로드는 압축 전 크기, 압축 후 크기, 파일 개수, 최대 depth를 모두 제한해야 합니다.

넷째, body를 검사하는 보안 장치는 비용을 씁니다. WAF, antivirus, DLP, content moderation을 붙이면 지연과 실패 지점이 늘어납니다. 그래서 검사 결과, scanner version, timeout, 재검사 정책을 operation 상태에 남겨야 합니다.

우선순위는 보통 **거절 기준 명확화 > 서버 메모리 보호 > 멱등성 > 상태 분리 > 처리량 최적화** 순서로 두는 편이 안정적입니다. 처리량을 먼저 올리면 잘못된 요청도 더 빠르게 많이 받게 됩니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] endpoint별 `max_body_size`, `content-type allowlist`, `timeout`이 문서화되어 있다.
- [ ] CDN, gateway, app server, framework limit이 서로 모순되지 않는다.
- [ ] 일반 JSON API와 파일 업로드 API의 limit이 분리되어 있다.
- [ ] 10MB 이상 파일은 direct upload 또는 async job으로 보내는 기준이 있다.
- [ ] 업로드 성공, 검증 성공, 업무 반영 성공 상태가 분리되어 있다.
- [ ] idempotency key와 body hash 또는 checksum을 저장한다.
- [ ] `413`, `415`, `422`, `202`, `409` 응답 기준이 테스트되어 있다.
- [ ] body 원문을 로그에 남기지 않고 size, hash, operation id만 남긴다.
- [ ] multipart temp disk 사용량과 client abort count를 모니터링한다.

### 연습

1. 현재 서비스의 `POST` endpoint 10개를 골라 평균 body size, p95 body size, 최대 허용 크기를 표로 적어보세요. 값이 "모름"이면 guardrail이 없는 것입니다.
2. 50MB CSV 상품 업로드 기능을 설계한다고 가정하고, direct upload, quarantine, validation, apply, status API를 8단계 상태 전이로 작성해 보세요.
3. 같은 idempotency key로 다른 파일 checksum이 들어온 경우 어떤 응답과 운영 로그를 남길지 정해 보세요.

## 관련 글

- [Async Request-Reply Operation Resource](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/)
- [Object Upload Quarantine Scanning](/learning/deep-dive/deep-dive-object-upload-quarantine-scanning-playbook/)
- [Bulk Import Job, 대량 업로드 운영 설계](/learning/deep-dive/deep-dive-bulk-import-job-row-error-playbook/)
- [Idempotency Key 설계](/learning/deep-dive/deep-dive-idempotency/)
- [API Rate Limit과 Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/)
