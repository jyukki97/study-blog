---
title: "백엔드 커리큘럼 심화: 문서 처리 파이프라인, 원본·파생본·재처리를 안전하게 분리하는 법"
date: 2026-10-20T10:06:00+09:00
lastmod: 2026-10-20T10:06:00+09:00
draft: false
topic: "Backend Reliability"
tags: ["Document Processing", "Object Storage", "Idempotency", "Job Queue", "Backend Reliability", "Data Integrity"]
categories: ["Backend Deep Dive"]
keywords: ["document processing pipeline", "rendition versioning", "원본 파생본", "문서 변환 재처리", "백엔드 비동기 작업"]
description: "업로드된 문서의 원본, 미리보기, 텍스트 추출, OCR 결과를 한 파일의 상태로 뭉개지 않고 버전·작업·검증 증거로 분리해 재처리와 장애 복구를 가능하게 만드는 백엔드 설계를 정리합니다."
summary: "문서 처리는 파일 업로드 기능이 아니라 외부 도구와 비동기 작업이 섞인 데이터 파이프라인이다. 원본 불변성, 파생본 버전, idempotency, 검증 상태를 분리해야 변환기 교체와 재처리를 안전하게 할 수 있다."
key_takeaways:
  - "원본 객체는 덮어쓰지 않고 content hash와 보존 정책을 붙인 불변 입력으로 다뤄야 한다."
  - "미리보기·OCR·검색 텍스트 같은 파생본은 생성기 버전과 입력 hash를 함께 기록해야 정확한 재처리 대상을 고를 수 있다."
  - "변환 성공은 worker exit code가 아니라 검증 규칙을 통과한 파생본이 publish된 상태로 판정해야 한다."
operator_checklist:
  - "원본, 파생본, 처리 시도, 공개 상태를 서로 다른 식별자와 상태로 분리한다."
  - "같은 source hash와 processor version의 작업은 하나만 실행되도록 deduplication key를 둔다."
  - "재처리는 새 파생본을 shadow로 검증한 뒤 publish하며, 실패한 기존 결과를 즉시 삭제하지 않는다."
module: "backend-data-system"
study_order: 1504
---

사용자가 PDF, 이미지, 오피스 문서를 올리면 많은 서비스가 곧바로 썸네일 생성, 텍스트 추출, OCR, 바이러스 검사, 검색 색인으로 이어집니다. 하지만 이를 `file.status = DONE` 하나로 관리하면 변환 라이브러리를 올린 뒤 무엇을 다시 돌려야 하는지, worker가 두 번 실행됐을 때 어느 결과가 유효한지, 미리보기는 성공했지만 원본 검사가 실패한 경우 무엇을 노출할지 설명하기 어렵습니다.

안전한 출발점은 업로드 파일을 단일 레코드가 아니라 **불변 원본(source)·파생본(rendition)·처리 시도(attempt)·공개 결정(publication)** 으로 나누는 것입니다. 이 글은 [객체 업로드 격리와 악성 파일 검사](/learning/deep-dive/deep-dive-object-upload-quarantine-scanning-playbook/), [재개 가능한 multipart 업로드](/learning/deep-dive/deep-dive-resumable-multipart-upload-session-playbook/), [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/), [재시작 가능한 worker 결과 원장](/learning/deep-dive/deep-dive-job-result-ledger-restartable-worker-playbook/)을 문서 처리라는 하나의 흐름으로 연결합니다.

## 이 글에서 얻는 것

- 원본 보관, 변환 산출물, 사용자 공개 상태를 왜 분리해야 하는지 이해합니다.
- 변환기 버전 변경 뒤 재처리 범위를 입력 hash와 processor version으로 계산합니다.
- 중복 메시지·부분 실패·늦게 도착한 worker 결과가 있어도 잘못된 파생본을 publish하지 않는 기준을 세웁니다.
- 파일 수, 대기 시간, 오류율만이 아니라 검증 실패와 재처리 backlog를 운영 지표로 만듭니다.

## 핵심 개념/이슈

### 1) 원본은 입력이고, 미리보기는 교체 가능한 산출물이다

원본 객체는 업로드 완료 뒤 같은 key에 덮어쓰지 않는 편이 좋습니다. `source_id`, 저장소 object version, byte size, MIME 판정 결과, SHA-256, 업로드 완료 시각을 묶어 입력을 고정합니다. 클라이언트가 `invoice.pdf`라는 같은 이름으로 재업로드해도 새 source가 생겨야 이전 변환 결과의 근거가 사라지지 않습니다. 신뢰할 수 없는 입력은 검사 전까지 quarantine prefix에 두고, 검사 결과가 허용일 때만 처리 큐로 넘깁니다.

반대로 페이지 이미지, 접근성용 텍스트, OCR JSON, 검색용 청크는 모두 파생본입니다. 이들은 원본보다 더 자주 교체됩니다. 예를 들어 OCR 엔진을 바꾸거나 PDF 렌더러의 보안 패치를 올리면 원본을 다시 받지 않고 기존 source에서 새 rendition을 만들어야 합니다. 따라서 path에 `source_id`만 넣는 대신 `source_sha256`, `processor_name`, `processor_version`, `output_schema_version`을 저장합니다. “파일이 있다”는 사실과 “현재 정책에서 보여도 된다”는 결정도 분리해야 합니다.

| 레코드 | 반드시 남길 값 | 상태를 바꾸는 주체 |
| --- | --- | --- |
| source | hash, 크기, 탐지 MIME, 검사 결과, 보존 정책 | upload/scan 경로 |
| rendition | 입력 hash, processor version, output hash, 검증 결과 | processor worker |
| attempt | dedup key, 시작·종료, 오류 분류, trace id | queue worker |
| publication | 현재 사용 rendition id, 정책 버전, publish 시각 | 도메인 서비스 |

### 2) 작업 idempotency는 파일 이름이 아니라 입력 조합으로 만든다

큐는 at-least-once 전달을 전제로 봐야 합니다. worker가 결과를 object storage에 쓴 직후 죽으면 메시지는 다시 올 수 있고, 가시성 timeout이 짧으면 같은 작업이 병렬 실행될 수 있습니다. `document_id` 하나만 dedup key로 쓰면 새 processor를 배포했을 때 필요한 재처리까지 막아 버립니다. 반대로 매번 새 작업을 만들면 비용과 결과 충돌이 늘어납니다.

실무에서는 `SHA-256(source) + rendition_type + processor_version + option_hash`를 작업의 논리 키로 삼는 방식이 안전합니다. DB unique constraint나 lease로 한 키의 active attempt를 하나만 허용하고, 이미 검증된 동일 rendition이 있으면 worker는 no-op으로 닫습니다. 단, lease가 만료됐다고 이전 worker 결과를 무조건 버리면 긴 PDF에서 정상 작업을 잃을 수 있습니다. attempt 번호와 fencing token을 두고, publish 시점에 최신 유효 token인지 확인해야 합니다.

```text
dedup_key = sha256(source_hash + "pdf_preview" + renderer_v4 + options_v2)

source accepted -> outbox(rendition_requested, dedup_key)
worker claim -> attempt #18, fencing_token 42
render + validate -> rendition stored with output_hash
publish -> token 42가 현재 lease인지, source가 여전히 allowed인지 재확인
```

### 3) exit code 0은 공개 승인과 다르다

렌더러가 성공해도 페이지 수가 0이거나, 썸네일이 비정상적으로 작거나, OCR 텍스트가 비어 있을 수 있습니다. 외부 변환기에는 손상 파일을 조용히 빈 결과로 바꾸는 경우도 있습니다. 그래서 성공 상태는 `worker_succeeded`가 아니라 최소 검증을 지난 `validated`로 둡니다. PDF preview라면 page count 1 이상, 첫 페이지 decode 가능, output MIME 일치, output size 상한 같은 검사를 붙일 수 있습니다. OCR은 언어별 최소 문자 수를 일괄 강제하기보다, 이미지형 문서인지와 text layer가 있는지에 따라 “검증 불확실” 상태를 허용하는 편이 낫습니다.

공개 결정은 source의 security verdict, rendition validation, 현재 processor policy를 함께 보고 수행합니다. 검사 실패 원본의 오래된 미리보기를 그대로 노출하지 않도록 source 상태 변경도 publication을 무효화해야 합니다. 이 연결이 없으면 스토리지는 정리됐는데 CDN 캐시나 검색 색인에 파생 텍스트가 남는 사고가 생깁니다.

## 실무 적용

### 1) 상태 전이는 좁게, 재시도 규칙은 명시적으로 둔다

가장 단순한 상태 기계는 다음 정도면 충분합니다. `uploaded -> quarantined -> accepted -> processing -> validated -> published`가 정상 경로이고, `rejected`, `retryable_failure`, `terminal_failure`, `superseded`를 별도로 둡니다. `processing`은 source 상태가 아니라 attempt 상태이며, source 하나가 여러 rendition을 동시에 처리할 수 있다는 점을 모델에 반영해야 합니다.

재시도는 오류 유형별로 다르게 둡니다. 네트워크 timeout·일시적 object-store 5xx는 3~5회 지수 backoff 대상이지만, 지원하지 않는 암호화 PDF·손상된 ZIP·정책 위반 MIME은 즉시 terminal failure가 맞습니다. 변환 시간이 p95 40초인 workload라면 visibility timeout을 45초로 두는 식은 위험합니다. p99, heartbeat 주기, 재시도 여유를 합쳐 최소 2배 이상으로 시작하고, 긴 작업은 진행 heartbeat나 lease 연장을 사용하세요. 동시 처리 수는 CPU·메모리뿐 아니라 외부 OCR API quota와 object storage request 한도도 포함해 정합니다.

| 신호 | 출발 기준 | 즉시 조치 기준 |
| --- | --- | --- |
| 처리 대기 p95 | 사용자 화면은 2분 이내 | 10분 초과가 15분 지속 |
| validation failure 비율 | processor별 기준선 기록 | 배포 후 2배 또는 5% 초과 |
| 중복 claim | 전체 attempt의 0.5% 미만 | 2% 초과 시 lease/timeout 점검 |
| 재처리 backlog | 하루 처리량의 20% 이내 | 2일 이상 누적 시 우선순위 분리 |

수치는 보편적인 SLA가 아니라 초기 경보선입니다. 계약서 첨부물처럼 빠른 결과가 필요한 서비스와 야간 대량 색인이 가능한 서비스는 같은 queue를 공유하지 않는 편이 좋습니다. 우선순위는 **security verdict 보존 → 원본 불변성 → publish 검증 → 재시도 비용 → 처리 속도**입니다.

### 2) processor 교체는 overwrite가 아니라 shadow 재처리로 한다

새 renderer를 바로 기존 rendition path에 덮어쓰면 rollback 근거와 비교 표본을 잃습니다. 먼저 대표 문서 100~500개를 선택해 이전·새 결과의 page count, output hash, 렌더 시간, validation failure, 사용자 확인 오류를 비교합니다. hash가 다르다는 사실만으로 실패로 보지 말고, 예상 가능한 폰트·압축 차이와 누락·깨짐을 구분해야 합니다. 위험이 낮으면 새 processor version으로 rendition을 별도 저장하고, cohort 1%에서 publication pointer만 전환합니다.

전환 중에도 source hash와 attempt의 trace id를 검색 가능하게 남기면 CS 문의에서 “원본이 달랐는지, 변환기 버전이 달랐는지, 공개 결정이 달랐는지”를 빠르게 분리할 수 있습니다. 이 증거는 단순한 worker 로그보다 오래 보관할 가치가 있습니다.

## 트레이드오프/주의점

원본과 파생본을 분리하면 저장 비용과 메타데이터가 늘어납니다. 모든 rendition을 무기한 보관할 필요는 없습니다. 현재 publish본, rollback window 안의 직전본, 규제·감사상 보존해야 하는 원본만 hot storage에 두고 나머지는 수명 주기 정책으로 archive 또는 삭제할 수 있습니다. 단, source를 먼저 지웠는데 rendition·검색 인덱스가 남는 순서는 피해야 합니다. 삭제 요청은 publication 차단, 파생본 tombstone, 색인 제거, object deletion 증거를 하나의 작업으로 추적하세요.

외부 OCR·바이러스 검사 서비스를 쓸 때는 원본을 어디까지 전송하는지도 기능 품질만큼 중요합니다. 민감 문서는 지역, 데이터 보존 기간, 학습 사용 여부, 재시도 시 중복 전송을 계약에 적어야 합니다. 변환 sandbox는 필요하지만, sandbox가 악성 입력 검사를 대체하지는 않습니다. 업로드 크기·압축 해제 크기·페이지 수·실행 시간·egress를 함께 제한해야 합니다.

## 체크리스트 또는 연습

- [ ] 현재 서비스의 문서 유형 3개에 대해 source, rendition, attempt, publication 식별자를 각각 적었다.
- [ ] rendition의 dedup key에 입력 hash와 processor version, 옵션 version을 포함했다.
- [ ] worker 성공 뒤에도 MIME, 크기, decode, 정책 상태를 검증한 뒤에만 publish한다.
- [ ] timeout, 중복 실행, 늦은 결과 도착을 넣은 테스트에서 fencing token 또는 동등한 조건부 publish가 동작한다.
- [ ] 새 processor는 100개 이상 shadow 표본으로 비교하고, rollback 가능한 이전 rendition을 남긴다.

연습으로 PDF 미리보기 기능 하나를 골라 `source_id`와 `rendition_id`를 같은 값으로 쓰고 있는 지점을 찾아보세요. 그 뒤 renderer v1과 v2가 동시에 실행되고, v1 작업이 늦게 끝나는 상황을 표로 그려 보세요. 어느 조건에서 v1이 v2 결과를 덮어쓰지 못해야 하는지 설명할 수 있다면, 재처리 설계의 핵심을 잡은 것입니다.
