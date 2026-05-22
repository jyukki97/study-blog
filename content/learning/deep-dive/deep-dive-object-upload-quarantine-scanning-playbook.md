---
title: "백엔드 커리큘럼 심화: Object Upload Quarantine과 비동기 스캔, 파일 업로드를 안전하게 공개하는 법"
date: 2026-05-22
draft: false
topic: "Backend Security"
tags: ["File Upload", "Object Storage", "Quarantine", "Malware Scanning", "S3", "Backend Security"]
categories: ["Backend Deep Dive"]
description: "Presigned URL과 Object Storage 기반 파일 업로드에서 업로드 완료와 공개 가능 상태를 분리하고, 격리 버킷·비동기 스캔·상태 전이·운영 지표로 안전하게 공개하는 기준을 정리합니다."
module: "backend-security"
study_order: 1238
---

파일 업로드는 구현이 쉬워 보이지만 운영 사고가 자주 나는 영역입니다. Presigned URL을 발급하고 클라이언트가 S3 같은 Object Storage에 직접 올리게 만들면 앱 서버 대역폭은 아낄 수 있습니다. 하지만 이 구조를 "업로드가 끝나면 곧바로 공개"로 설계하면 위험합니다. 사용자는 이미지라고 올렸지만 실제로는 HTML, 스크립트, 압축 폭탄, 악성 문서, 실행 파일일 수 있습니다. Content-Type 헤더와 확장자는 사용자가 정할 수 있고, 업로드 완료 이벤트는 중복되거나 늦게 올 수 있으며, 스캔 워커가 멈춘 동안 파일이 CDN에 먼저 노출될 수도 있습니다.

그래서 실무에서는 direct upload와 direct publish를 분리해야 합니다. 파일은 먼저 격리 영역에 들어오고, 서버가 메타데이터와 상태를 관리하며, 스캔과 정책 검사를 통과한 뒤에만 서비스 경로로 공개됩니다. 이 글은 [파일 업로드와 서빙 시스템 설계](/learning/deep-dive/deep-dive-system-design-file-serving/), [Object Storage S3 기초](/learning/deep-dive/deep-dive-object-storage-s3/), [SSRF와 Egress Control](/learning/deep-dive/deep-dive-ssrf-egress-control-playbook/), [비동기 요청-응답 Operation Resource](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/)와 함께 보면 좋습니다. 핵심은 파일을 저장하는 것이 아니라, **공개 가능한 파일인지 설명할 수 있는 상태 전이**를 만드는 것입니다.

## 이 글에서 얻는 것

- Presigned URL 기반 업로드에서 업로드 완료와 공개 가능 상태를 분리하는 이유를 이해할 수 있습니다.
- quarantine bucket, metadata row, scan worker, clean bucket/CDN을 어떤 순서로 연결할지 잡을 수 있습니다.
- 파일 크기, MIME signature, 압축 해제 비율, 스캔 지연, 공개 TTL 같은 숫자 기준을 세울 수 있습니다.
- 악성 파일, 스캔 실패, 이벤트 중복, CDN 캐시 노출, 개인정보 처리 같은 운영 리스크를 체크리스트로 관리할 수 있습니다.

## 핵심 개념/이슈

### 1) Direct upload는 direct publish가 아니다

Presigned URL을 쓰는 가장 큰 이유는 앱 서버가 대용량 바이너리를 직접 받지 않게 하는 것입니다. 하지만 클라이언트가 Object Storage에 직접 업로드한다고 해서 그 객체를 곧바로 서비스에 노출해야 한다는 뜻은 아닙니다. 업로드 직후 파일의 기본 상태는 `CLEAN`이 아니라 `UPLOADED` 또는 `PENDING_SCAN`이어야 합니다.

권장 상태 전이는 아래처럼 단순하게 시작할 수 있습니다.

```text
INITIATED -> UPLOADED -> SCANNING -> CLEAN -> PUBLISHED
                         |          |
                         v          v
                      REJECTED    EXPIRED
```

`INITIATED`는 서버가 업로드 의도를 등록하고 presigned URL을 발급한 상태입니다. `UPLOADED`는 object storage 이벤트나 완료 콜백으로 실제 파일이 들어온 상태입니다. `SCANNING`은 워커가 파일을 검사 중인 상태이고, `CLEAN`은 서비스 정책상 공개 가능하다는 판정입니다. 사용자가 접근할 수 있는 URL은 `CLEAN` 이후에만 발급합니다. 만약 아바타 이미지처럼 빨리 보여야 하는 파일도 이 원칙은 유지하되, 스캔 목표 시간을 짧게 잡는 방식으로 풀어야 합니다.

### 2) 격리 영역은 권한과 네트워크 경계가 달라야 한다

quarantine은 단순 폴더명이 아닙니다. 가능하면 공개 버킷과 격리 버킷을 분리하거나, 최소한 bucket policy와 CDN origin을 분리해야 합니다. `uploads/quarantine/...` 같은 prefix만 쓰더라도 CDN이 해당 prefix를 origin으로 읽을 수 있으면 격리 의미가 약합니다. 격리 영역의 객체는 앱 사용자에게 직접 서빙되지 않아야 하고, 스캔 워커와 제한된 운영 도구만 읽을 수 있어야 합니다.

실무 기준은 아래처럼 잡을 수 있습니다.

| 영역 | 접근 주체 | 공개 여부 | 보존 기준 |
| --- | --- | --- | --- |
| quarantine bucket/prefix | upload client write, scanner read | 비공개 | 1~7일 후 미처리 만료 |
| clean bucket/prefix | backend copy/write, CDN read | 정책에 따라 공개 | 서비스 보존 정책 |
| rejected bucket/prefix | scanner write, operator read | 비공개 | 7~30일 또는 즉시 삭제 |
| metadata DB | backend, worker | API로만 노출 | 감사·정책 기준 |

중요한 것은 파일이 아니라 메타데이터가 source of truth라는 점입니다. Object Storage에 객체가 있어도 DB 상태가 `CLEAN`이 아니면 사용자에게 보여주지 않습니다. 반대로 DB가 `CLEAN`인데 객체가 없으면 스캔이나 이동 파이프라인 장애입니다. 이 불일치를 정기적으로 잡는 관점은 [Reconciliation 파이프라인](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)과도 이어집니다.

### 3) Presigned URL은 짧고 좁아야 한다

Presigned URL은 임시 권한입니다. 너무 길게 열어두거나 넓은 key 범위를 허용하면 업로드 경로가 권한 우회 통로가 됩니다. 출발점은 아래 기준이 현실적입니다.

- URL TTL: 일반 업로드 5~15분, 대용량 업로드 30~60분
- 최대 파일 크기: 아바타 5~10MB, 일반 문서 50~100MB, 대용량 미디어는 별도 multipart 정책
- object key: 서버가 생성한 `tenant_id/user_id/file_id` 기반 key만 허용
- overwrite 금지: 같은 `file_id`에 재업로드가 필요하면 object version 또는 attempt id 분리
- Content-Length 제한: 클라이언트 선언만 믿지 말고 완료 후 실제 크기 검증
- Content-Type: 허용 목록으로 받되, 최종 판단은 magic byte와 파서 검사로 수행

특히 `public-read` ACL을 presigned upload에 섞는 것은 피해야 합니다. 업로드 순간 공개되는 구조가 되기 때문입니다. 공개는 서버가 `CLEAN` 판정 후 별도 copy, tag 변경, DB 상태 변경, signed download URL 발급 중 하나로 처리합니다.

### 4) 스캔은 바이러스 검사 하나로 끝나지 않는다

파일 스캔이라고 하면 ClamAV 같은 악성코드 검사를 떠올리기 쉽습니다. 하지만 백엔드 업로드 보안은 더 넓습니다. 최소한 아래 검사가 필요합니다.

- 실제 파일 크기와 선언 크기 비교
- 확장자, Content-Type, magic byte 일치 여부
- 이미지/문서 파서로 열리는지 확인
- 압축 파일의 entry 수, 총 해제 크기, 최대 depth 확인
- 실행 파일, HTML, SVG script, macro 문서 차단 여부
- 악성코드/평판 스캔
- EXIF 위치 정보, 개인정보 메타데이터 제거 필요 여부
- 썸네일 생성 또는 안전한 포맷 재인코딩 가능 여부

압축 파일은 특히 조심해야 합니다. 업로드 크기는 5MB인데 압축 해제 후 5GB가 되는 파일은 스캐너와 저장소를 동시에 압박합니다. 출발 기준으로는 압축 해제 총량이 원본의 20~100배를 넘거나, entry 수가 10,000개를 넘거나, depth가 5단계를 넘으면 자동 거절 또는 수동 검토로 보내는 편이 안전합니다. 서비스 성격상 zip 업로드가 필요 없다면 처음부터 금지하는 것이 가장 단순합니다.

### 5) 완료 이벤트는 중복과 지연을 기본값으로 본다

Object Storage 이벤트, 큐 메시지, 클라이언트 완료 콜백은 모두 중복될 수 있습니다. 같은 파일에 대해 스캔 job이 두 번 생성될 수 있고, 사용자가 네트워크 문제로 완료 API를 여러 번 호출할 수도 있습니다. 그래서 scan job은 `file_id + upload_attempt + object_version` 기준으로 멱등해야 합니다.

예를 들어 `UPLOADED` 전이는 `INITIATED`일 때만 성공하고, 이미 `SCANNING`이나 `CLEAN`인 파일에 같은 이벤트가 다시 오면 현재 상태를 반환합니다. 스캔 워커도 같은 object hash를 이미 검사했다면 결과를 재사용할 수 있습니다. 다만 hash 기반 재사용은 조심해야 합니다. 같은 바이너리라도 tenant, 공개 범위, 정책 버전이 다르면 결과 적용 방식이 달라질 수 있습니다.

## 실무 적용

### 1) 메타데이터 테이블을 먼저 설계한다

파일 객체보다 먼저 파일 상태를 설명하는 row가 있어야 합니다. 최소 모델은 아래 정도입니다.

```sql
CREATE TABLE upload_file (
  file_id              varchar(64) PRIMARY KEY,
  tenant_id            varchar(64) NOT NULL,
  owner_id             varchar(64) NOT NULL,
  object_key           varchar(512) NOT NULL,
  object_version       varchar(128),
  original_filename    varchar(255) NOT NULL,
  declared_content_type varchar(120),
  detected_content_type varchar(120),
  declared_size_bytes  bigint,
  actual_size_bytes    bigint,
  sha256               varchar(80),
  status               varchar(32) NOT NULL,
  policy_version       varchar(64) NOT NULL,
  scan_result          varchar(64),
  rejection_reason     varchar(120),
  created_at           timestamptz NOT NULL,
  uploaded_at          timestamptz,
  scanned_at           timestamptz,
  published_at         timestamptz,
  expires_at           timestamptz
);
```

`status`만 있으면 부족합니다. 나중에 왜 거절됐는지, 어떤 정책 버전에서 통과했는지, 파일 크기가 선언과 달랐는지 설명해야 합니다. 파일 업로드가 고객 지원, 법무, 보안 이슈와 연결되는 서비스라면 `policy_version`, `scan_engine_version`, `request_id`도 남기는 편이 좋습니다.

### 2) 공개 경로는 DB 상태를 확인하게 만든다

사용자가 파일을 보려고 할 때 object key를 그대로 조합해서 내려주면 안 됩니다. API는 DB에서 `status=CLEAN` 또는 `PUBLISHED`인지 확인하고, 권한을 확인한 뒤, 짧은 다운로드 URL이나 CDN URL을 반환합니다. 공개 파일이라면 CDN URL을 줄 수 있지만, 비공개 파일은 signed URL TTL을 1~10분 정도로 짧게 둡니다.

CDN을 붙일 때는 더 엄격해야 합니다. rejected 파일이 잠깐이라도 CDN에 캐시되면 DB 상태를 되돌려도 이미 퍼질 수 있습니다. 따라서 CDN origin은 clean 영역만 바라보게 하고, quarantine 영역은 origin 자체에서 제외합니다. 실수로 노출된 경우를 대비해 object key를 예측 불가능하게 만들고, purge 절차를 runbook에 넣습니다.

### 3) 정책을 파일 유형별로 나눈다

모든 파일에 같은 정책을 적용하면 과하거나 부족해집니다. 처음에는 아래 정도의 tier로 나누면 운영 판단이 빨라집니다.

| 파일 유형 | 예시 | 공개 목표 | 정책 |
| --- | --- | ---: | --- |
| 작은 이미지 | 아바타, 썸네일 | p95 30~60초 | 이미지 파서 검증, 재인코딩, EXIF 제거 |
| 일반 문서 | PDF, txt, docx | p95 1~3분 | MIME signature, malware scan, macro 차단 |
| 대용량 미디어 | 동영상, 음성 | p95 5~15분 | multipart 완료 검증, transcoding 후 공개 |
| 압축 파일 | zip, tar | 비권장 | 필요 시 entry/depth/해제 크기 제한 |
| 실행 가능 파일 | exe, sh, jar | 기본 차단 | 내부 배포 경로만 별도 승인 |

정책은 비즈니스 요구와 보안 비용의 합의입니다. 예를 들어 고객이 계약서를 올리는 B2B SaaS라면 docx/PDF를 막을 수 없지만, 공개 커뮤니티 프로필 이미지만 받는 서비스라면 이미지 외 파일을 받을 이유가 거의 없습니다. 파일 유형을 넓히는 것은 기능 추가가 아니라 공격 표면 확대입니다.

### 4) 스캔 워커에는 처리량보다 중단 조건을 먼저 넣는다

스캔 워커는 CPU, 메모리, 디스크 I/O를 많이 씁니다. 워커 수를 늘리면 빨라질 것 같지만, 압축 해제나 이미지 변환이 섞이면 노드 전체가 불안정해질 수 있습니다. 그래서 처리량 기준과 중단 조건을 같이 둬야 합니다.

권장 시작점은 아래와 같습니다.

- scanner worker 동시성: 노드 CPU 코어 수의 50~70% 이하
- 단일 파일 스캔 timeout: 작은 이미지 10초, 일반 문서 60초, 대용량 파일은 별도 job
- scan queue lag p95: 이미지 60초 이하, 문서 3분 이하
- `PENDING_SCAN` 15분 초과: 경고
- `SCANNING` 30분 초과: stuck job으로 재시도 또는 격리
- scanner error rate 1% 초과 5분 지속: 신규 공개 중지 또는 degraded mode

중요한 것은 스캔 실패 시 "일단 공개"하지 않는 것입니다. 공개 커뮤니티 서비스라면 fail-closed가 기본입니다. 내부 분석 파일처럼 사용자가 직접 다시 받을 뿐인 경우에도, 스캔 실패 파일에는 명확한 warning과 다운로드 차단 정책을 둬야 합니다.

### 5) 운영 지표는 업로드 성공률보다 공개 지연과 오염 차단을 본다

대시보드에는 최소한 아래 지표를 올립니다.

- `upload_initiated_total`
- `upload_completed_total`
- `upload_orphan_object_count`
- `scan_queue_lag_seconds_p95`
- `scan_duration_seconds_p95`
- `pending_scan_age_max_seconds`
- `scan_rejected_total{reason}`
- `mime_mismatch_rate`
- `zip_expansion_block_total`
- `clean_publish_latency_seconds_p95`
- `cdn_purge_required_total`

업로드 성공률만 보면 사용자 입장에서는 좋아 보일 수 있습니다. 하지만 실제 운영 지표는 "업로드된 파일이 안전하게 공개되기까지 얼마나 걸렸는가"와 "정책 위반 파일을 얼마나 설명 가능하게 차단했는가"입니다. `mime_mismatch_rate`가 0.5%를 넘으면 클라이언트 구현 문제나 공격 시도를 의심하고, `pending_scan_age_max`가 15분을 넘으면 스캐너 장애로 봅니다.

## 트레이드오프/주의점

첫째, 동기 스캔은 단순하지만 사용자 지연을 키웁니다. 앱 서버가 업로드를 직접 받고 요청 안에서 스캔한 뒤 응답하면 구현 흐름은 명확합니다. 하지만 50MB 문서, 대용량 이미지, 압축 파일이 들어오는 순간 요청 timeout과 서버 리소스 문제가 커집니다. 사용자에게 즉시 공개가 꼭 필요하지 않다면 비동기 스캔이 더 안전합니다.

둘째, 비동기 스캔은 상태 UX가 필요합니다. 사용자는 업로드가 끝났는데 파일이 아직 보이지 않는 상황을 만납니다. 이때 화면에는 "처리 중" 상태, 예상 지연, 실패 시 재업로드 안내가 있어야 합니다. 백엔드도 `GET /uploads/{fileId}` 같은 상태 API를 제공해야 합니다. 이 구조는 긴 작업을 operation resource로 다루는 패턴과 같습니다.

셋째, 외부 스캔 서비스는 개인정보 경계가 됩니다. 파일을 외부 SaaS로 보내 검사하면 운영은 쉬워질 수 있지만, 고객 문서나 개인정보가 제3자에게 전송됩니다. 계약, 지역, 보존 기간, 학습 사용 여부, 삭제 SLA를 확인해야 합니다. 민감 파일은 자체 스캐너 또는 격리된 VPC 경로를 우선 검토합니다.

넷째, false positive와 false negative를 모두 인정해야 합니다. 스캐너가 정상 파일을 막으면 고객 지원 비용이 생기고, 악성 파일을 놓치면 보안 사고가 됩니다. 그래서 거절 사유는 사용자에게 너무 자세히 노출하지 않되, 운영자는 `policy_version`, `signature`, `engine_version`, `sample hash`를 볼 수 있어야 합니다.

다섯째, "이미지만 받는다"는 말도 안전하지 않습니다. SVG는 스크립트와 외부 참조를 포함할 수 있고, 이미지 파서 취약점도 존재합니다. 공개 이미지 서비스라면 SVG를 금지하거나 sanitize하고, JPEG/PNG/WebP도 서버에서 재인코딩해 안전한 파생본만 공개하는 편이 낫습니다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] 업로드 완료 상태와 공개 가능 상태가 분리되어 있다.
- [ ] quarantine 영역은 CDN이나 사용자 다운로드 경로에서 직접 접근할 수 없다.
- [ ] presigned URL은 짧은 TTL, 정확한 object key, 크기 제한, overwrite 금지를 갖는다.
- [ ] Content-Type과 확장자만 믿지 않고 magic byte와 파서 검증을 수행한다.
- [ ] 스캔 실패, timeout, stuck job은 fail-closed로 처리된다.
- [ ] `PENDING_SCAN`, `SCANNING`, `CLEAN`, `REJECTED` 상태 전이가 멱등하다.
- [ ] 공개 URL 발급은 DB 상태와 사용자 권한을 확인한 뒤에만 이뤄진다.
- [ ] scan lag, rejected reason, MIME mismatch, orphan object 지표가 있다.
- [ ] rejected 파일의 보존 기간과 삭제 정책이 문서화되어 있다.
- [ ] CDN purge와 공개 취소 절차가 runbook에 있다.

### 연습

1. 현재 서비스의 업로드 파일 유형을 5개 이하로 분류해 보세요. 이미지, 문서, 압축, 미디어, 기타로 나눴을 때 정말 받아야 하는 파일만 남기는 것이 목표입니다.
2. 아바타 이미지 업로드를 예로 들어 `INITIATED -> UPLOADED -> SCANNING -> CLEAN -> PUBLISHED` 상태 전이를 API 응답과 함께 적어 보세요.
3. 압축 파일을 허용해야 한다고 가정하고, 최대 entry 수, 최대 해제 크기, 최대 depth, timeout 기준을 숫자로 정해 보세요. 기준을 못 정하겠다면 아직 허용할 준비가 안 된 것입니다.
4. `PENDING_SCAN` 상태가 30분 이상 쌓이는 장애를 가정해 보세요. 신규 업로드를 계속 받을지, 공개를 멈출지, 사용자에게 어떤 상태를 보여줄지 runbook으로 정리합니다.
5. CDN에 잘못 공개된 파일 1개를 취소하는 절차를 작성해 보세요. DB 상태 변경, object 이동/삭제, CDN purge, 감사 로그, 고객 안내가 모두 포함되어야 합니다.

파일 업로드의 목표는 사용자가 올린 바이트를 빠르게 저장하는 데서 끝나지 않습니다. 운영 가능한 시스템은 "이 파일이 언제, 어떤 정책으로, 어떤 근거로 공개됐는가"를 설명할 수 있어야 합니다. direct upload는 서버 부하를 줄이는 좋은 기술이지만, 공개 판정까지 클라이언트와 스토리지 이벤트에 맡기면 위험합니다. 안전한 업로드 파이프라인은 업로드를 격리하고, 검증하고, 상태로 설명한 뒤, 필요한 파일만 공개합니다.
