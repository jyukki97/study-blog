---
title: "백엔드 커리큘럼 심화: Presigned URL 접근 제어 운영 플레이북"
date: 2026-07-18
draft: false
topic: "Object Storage Security"
tags: ["Presigned URL", "Object Storage", "S3", "File Download", "Access Control", "Backend Security"]
categories: ["Backend Deep Dive"]
description: "Presigned URL을 단순 파일 링크가 아니라 만료, 권한 재검증, 객체 버전, 감사 로그, 취소 한계까지 가진 임시 접근 권한으로 운영하는 기준을 정리합니다."
module: "backend-security"
study_order: 1470
keywords: ["presigned url", "signed url", "object storage access control", "download authorization", "file serving security"]
key_takeaways:
  - "Presigned URL은 파일 주소가 아니라 특정 object key와 조건에 대해 짧게 위임한 임시 권한이다."
  - "발급 전 권한 검증과 발급 후 URL 만료는 서로 다른 경계이며, 이미 발급된 URL은 즉시 취소하기 어렵다는 점을 설계에 반영해야 한다."
  - "민감 파일은 URL TTL, object version, CDN cache, 감사 로그, 권한 변경 전파 시간을 함께 관리해야 한다."
operator_checklist:
  - "파일 유형별 download URL TTL, 최대 다운로드 횟수 정책, 권한 변경 후 잔여 노출 시간을 숫자로 정한다."
  - "사용자에게 object key를 직접 받지 않고 file_id 기준으로 메타데이터, 소유권, 상태, tenant를 재검증한다."
  - "비공개 파일은 CDN/public bucket 경로와 분리하고, URL 발급 이벤트를 audit log와 rate limit에 남긴다."
learning_refs:
  - title: "Object Storage와 파일 관리"
    href: "/learning/deep-dive/deep-dive-object-storage-s3/"
    description: "S3, bucket, object key, presigned URL의 기본 구조를 복습하기 좋습니다."
  - title: "파일 업로드와 서빙 시스템 설계"
    href: "/learning/deep-dive/deep-dive-system-design-file-serving/"
    description: "파일 메타데이터, 저장소, 다운로드 API를 시스템 설계 관점으로 연결합니다."
  - title: "Object Upload Quarantine과 비동기 스캔"
    href: "/learning/deep-dive/deep-dive-object-upload-quarantine-scanning-playbook/"
    description: "업로드 완료와 공개 가능 상태를 분리하는 보안 흐름입니다."
  - title: "API Key Lifecycle"
    href: "/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/"
    description: "임시 권한과 장기 키를 구분하고 회전, 폐기, 감사 기준을 잡는 데 도움이 됩니다."
decision_guide:
  intro: "Presigned URL은 서버 부하를 줄이는 편리한 패턴이지만, 파일 민감도와 권한 변경 속도에 따라 운영 무게가 달라집니다."
  cases:
    - badge: "엄격 관리"
      title: "개인정보, 계약서, 정산 파일, 내부 리포트"
      fit: "사용자 권한이 바뀌면 노출을 빠르게 줄여야 하고, 다운로드 이력이 감사 대상인 파일입니다."
      watchouts: "URL을 이미 받은 사용자가 만료 전까지 접근할 수 있으므로 TTL과 CDN cache를 짧게 잡아야 합니다."
      next_step: "발급 API에 권한 재검증, TTL 1~5분, audit log, rate limit, object version 고정을 먼저 넣습니다."
    - badge: "일반 관리"
      title: "로그인 사용자용 이미지, 첨부파일, 학습 자료"
      fit: "비공개이지만 짧은 지연 노출이 큰 사고로 이어지지는 않는 파일입니다."
      watchouts: "object key 추측, referer 노출, 채팅 공유로 URL이 퍼지는 상황을 고려해야 합니다."
      next_step: "TTL 5~15분, file_id 기반 발급, 다운로드 API rate limit부터 적용합니다."
    - badge: "단순 가능"
      title: "완전 공개 정적 파일"
      fit: "권한 검사가 필요 없고 CDN cache가 제품 요구와 맞는 파일입니다."
      watchouts: "나중에 비공개로 바뀔 수 있는 파일을 public URL로 굳히면 마이그레이션 비용이 큽니다."
      next_step: "public/private 전환 가능성이 있는 파일은 처음부터 메타데이터 상태를 분리합니다."
faqs:
  - question: "Presigned URL을 발급하면 서버 권한 검사는 더 이상 필요 없나요?"
    answer: "아닙니다. 발급 API에서 반드시 권한을 검증해야 합니다. Presigned URL은 그 검증 결과를 짧은 시간 object storage에 위임하는 수단입니다."
  - question: "이미 발급한 URL을 취소할 수 있나요?"
    answer: "보통 즉시 취소는 어렵습니다. object 삭제, key 회전, bucket policy 변경, CDN purge 같은 강한 조치가 필요할 수 있으므로 민감 파일은 짧은 TTL과 version 고정이 기본입니다."
---

Presigned URL은 백엔드 파일 기능에서 자주 쓰입니다. 앱 서버가 대용량 파일을 직접 흘리지 않아도 되고, S3 같은 object storage가 업로드와 다운로드 트래픽을 처리해 줍니다. 구현도 처음에는 간단합니다. 서버가 사용자의 권한을 확인한 뒤 `GetObject`나 `PutObject`에 서명한 URL을 내려주고, 클라이언트가 그 URL로 직접 접근합니다.

하지만 운영에 들어가면 질문이 달라집니다. 사용자가 권한을 잃은 직후에도 이전에 받은 URL로 파일을 열 수 있는가? URL이 채팅방에 공유되면 누가 접근했는지 알 수 있는가? CDN이 비공개 파일을 cache하면 어떻게 되는가? 객체가 새 버전으로 바뀌었는데 예전 URL은 무엇을 가리키는가? 이 질문에 답하지 못하면 Presigned URL은 서버 부하를 줄인 만큼 권한 경계를 흐리게 만듭니다.

이 글은 [Object Storage와 파일 관리](/learning/deep-dive/deep-dive-object-storage-s3/), [파일 업로드와 서빙 시스템 설계](/learning/deep-dive/deep-dive-system-design-file-serving/), [Object Upload Quarantine](/learning/deep-dive/deep-dive-object-upload-quarantine-scanning-playbook/), [Authorization 모델](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/)과 이어집니다. 핵심은 Presigned URL을 "파일 링크"가 아니라 **짧게 위임한 임시 접근 권한**으로 보는 것입니다.

## 이 글에서 얻는 것

- Presigned URL을 발급할 때 서버가 어떤 권한, 상태, 객체 버전, TTL을 확인해야 하는지 이해합니다.
- 이미 발급된 URL은 즉시 취소하기 어렵다는 한계를 전제로 설계할 수 있습니다.
- 파일 민감도별 TTL, CDN cache, audit log, rate limit 기준을 숫자로 잡을 수 있습니다.
- 다운로드 URL 발급 API를 object key가 아니라 file metadata와 권한 계약 중심으로 설계하는 방법을 가져갑니다.

## 핵심 개념/이슈

### 1) Presigned URL은 인증을 생략하는 링크가 아니다

Presigned URL은 object storage에 "이 요청은 특정 시간 동안 허용해도 된다"고 서명한 요청입니다. 사용자는 URL 자체만 있으면 object storage에 접근할 수 있습니다. 그래서 발급 전 서버 권한 검사가 전부입니다. 발급 API가 느슨하면 object storage는 그 실수를 바로잡아 주지 않습니다.

나쁜 패턴은 사용자가 `bucket`과 `key`를 넘기면 서버가 그대로 서명해 주는 방식입니다. 이러면 object key를 추측하거나 다른 tenant의 key를 넣는 공격에 약해집니다. 좋은 패턴은 사용자가 `file_id`만 넘기고, 서버가 DB에서 파일 메타데이터를 조회한 뒤 권한을 다시 판단하는 방식입니다.

발급 전 확인해야 할 최소 조건은 아래입니다.

| 확인 항목 | 이유 | 실패 시 처리 |
| --- | --- | --- |
| tenant_id와 owner/group 권한 | 다른 조직 파일 접근 차단 | 403 |
| file 상태 | 스캔 전, 삭제, 만료 파일 차단 | 404 또는 409 |
| object key와 version | 잘못된 객체 또는 예전 객체 접근 방지 | 409 |
| 파일 민감도 | TTL과 audit 강도 결정 | 정책 적용 |
| 요청 빈도 | URL 대량 발급과 scraping 방지 | 429 |

이 검사는 [Authorization 모델](/learning/deep-dive/deep-dive-authorization-models-rbac-abac-rebac/)의 RBAC/ABAC와 연결됩니다. 단순히 "로그인했는가"가 아니라 "이 사용자, 이 tenant, 이 파일 상태, 이 시점에 다운로드 목적이 허용되는가"를 봐야 합니다.

### 2) URL 만료는 권한 취소와 다르다

Presigned URL의 TTL은 안전장치지만 완전한 취소 장치는 아닙니다. 이미 발급된 URL은 만료 전까지 동작할 수 있습니다. 사용자의 프로젝트 권한이 삭제되어도, 30분 TTL URL을 이미 받았다면 남은 시간 동안 접근 가능할 수 있습니다. 따라서 TTL은 "권한 변경 후 최대 잔여 노출 시간"입니다.

초기 기준은 이렇게 둘 수 있습니다.

| 파일 유형 | 권장 TTL | 추가 조건 |
| --- | ---: | --- |
| 개인정보/계약서/정산 파일 | 1~5분 | 발급 audit 필수, CDN cache 금지 |
| 로그인 사용자 첨부파일 | 5~15분 | file_id 기반 재검증, rate limit |
| 임시 미리보기 이미지 | 1~10분 | thumbnail도 원본 권한 상속 |
| 대용량 다운로드 artifact | 10~30분 | 1회성 작업 token, 만료 후 재발급 |
| 공개 정적 파일 | signed URL 불필요 가능 | public 경로로 분리 |

TTL을 너무 짧게 잡으면 사용자가 큰 파일을 내려받다가 실패할 수 있습니다. 반대로 너무 길게 잡으면 권한 변경과 URL 공유에 취약합니다. 대용량 파일은 URL TTL만 늘리는 대신 range request, resumable download, 재발급 API를 설계하는 편이 낫습니다.

### 3) File metadata가 source of truth여야 한다

object storage에 객체가 있다고 해서 사용자에게 보여줘도 된다는 뜻은 아닙니다. 파일의 진짜 상태는 DB의 metadata row가 가져야 합니다.

```sql
CREATE TABLE file_asset (
  file_id           varchar(64) PRIMARY KEY,
  tenant_id         varchar(64) NOT NULL,
  owner_id          varchar(64) NOT NULL,
  object_key        varchar(512) NOT NULL,
  object_version    varchar(128),
  status            varchar(32) NOT NULL,
  sensitivity       varchar(32) NOT NULL,
  content_type      varchar(120),
  size_bytes        bigint NOT NULL,
  checksum_sha256   varchar(80),
  created_at        timestamptz NOT NULL,
  deleted_at        timestamptz,
  retention_until   timestamptz
);
```

다운로드 API는 이 row를 기준으로 판단합니다. `status=PUBLISHED` 또는 `CLEAN`인지, `deleted_at`이 비어 있는지, `retention_until` 정책에 걸리지 않는지, object version이 현재 버전인지 확인합니다. 이 관점은 [Object Upload Quarantine](/learning/deep-dive/deep-dive-object-upload-quarantine-scanning-playbook/)과 같습니다. 업로드 완료, 스캔 완료, 공개 가능, 삭제 예정은 서로 다른 상태입니다.

### 4) object version을 고정하지 않으면 URL 의미가 흔들린다

같은 object key에 덮어쓰기가 가능하면 URL이 어떤 파일을 가리키는지 헷갈릴 수 있습니다. 사용자가 `reports/monthly.csv`에 대한 URL을 받았는데, 그 사이 새 파일이 같은 key로 올라오면 이전 URL이 새 객체를 가리킬 수 있습니다. 감사와 재현성 측면에서 좋지 않습니다.

민감 파일이나 리포트 artifact는 object key를 불변으로 두는 편이 안전합니다.

```text
tenant/{tenantId}/files/{fileId}/versions/{versionId}/original
tenant/{tenantId}/exports/{jobId}/artifact/{artifactId}.csv
```

S3 versioning을 쓰는 경우에도 발급 시점의 version id를 metadata에 저장하고, URL도 해당 version을 대상으로 발급합니다. 덮어쓰기가 필요한 public asset과 감사가 필요한 private file을 같은 key 정책으로 다루면 운영 사고가 납니다.

### 5) CDN과 cache는 비공개 파일에서 별도 경계다

Presigned URL을 CDN 뒤에 붙이면 다운로드 성능은 좋아질 수 있습니다. 하지만 CDN cache가 비공개 파일을 보관하면 권한 변경 후에도 잔여 노출이 커집니다. 특히 `Cache-Control`을 잘못 두거나 signed URL query string을 cache key에서 제외하면 다른 사용자의 응답이 재사용될 수 있습니다.

비공개 파일 기준은 보수적으로 잡습니다.

- private origin과 public origin을 분리한다.
- 민감 파일은 `Cache-Control: private, no-store` 또는 매우 짧은 TTL을 둔다.
- CDN cache key에 서명 관련 query/header 정책이 반영되는지 확인한다.
- 권한 변경이나 삭제 이벤트 후 purge가 필요한 파일 유형을 분리한다.
- 썸네일, 변환본, preview PDF도 원본 권한을 상속한다.

[파일 업로드와 서빙 시스템 설계](/learning/deep-dive/deep-dive-system-design-file-serving/)에서 말하는 파일 서빙 경로는 단순히 빠른 전송이 아니라 권한과 cache 경계를 함께 설계하는 일입니다.

## 실무 적용

### 1) 다운로드 URL 발급 API는 object key를 숨긴다

권장 API는 아래처럼 시작합니다.

```text
POST /files/{fileId}/download-url
  request: { "purpose": "preview" | "download" | "export" }
  response: { "url": "...", "expires_at": "...", "file_version": "v17" }
```

서버 내부 흐름은 이렇습니다.

1. `file_id`로 metadata를 조회한다.
2. tenant, owner, group, role, ABAC 조건을 확인한다.
3. 파일 상태가 `CLEAN/PUBLISHED`인지 확인한다.
4. sensitivity와 purpose에 따라 TTL을 결정한다.
5. object key와 version을 고정해 presigned URL을 만든다.
6. 발급 이벤트를 audit log에 남긴다.
7. 같은 사용자와 파일에 대한 발급 rate limit을 적용한다.

사용자에게 object key를 직접 받지 않으면 key 추측 공격과 tenant 경계 우회를 크게 줄일 수 있습니다.

### 2) 민감도별 정책을 코드가 아니라 테이블로 둔다

파일 정책은 코드 곳곳의 `if`로 흩어지기 쉽습니다. 최소한 아래 정도의 정책표를 둡니다.

```yaml
download_url_policy:
  public_asset:
    signed: false
    cdn_cache_ttl: 86400
  private_attachment:
    signed: true
    url_ttl_seconds: 600
    audit: basic
    cdn_cache_ttl: 0
  sensitive_report:
    signed: true
    url_ttl_seconds: 120
    audit: strict
    cdn_cache_ttl: 0
    require_object_version: true
  settlement_export:
    signed: true
    url_ttl_seconds: 300
    audit: strict
    require_job_owner: true
    max_issue_per_hour: 10
```

의사결정 우선순위는 **권한 재검증 > 짧은 TTL > cache 차단 > 감사 로그 > 사용자 편의**입니다. 편의 때문에 TTL을 늘릴 수는 있지만, 민감 파일에서는 그 결정이 잔여 노출 시간을 늘린다는 점을 명시해야 합니다.

### 3) 감사 로그는 파일 접근이 아니라 URL 발급부터 남긴다

object storage access log만으로는 부족합니다. 사용자가 실제 다운로드했는지 보는 것도 중요하지만, 서버가 언제 어떤 판단으로 URL을 발급했는지가 먼저입니다.

권장 audit 필드:

```text
event_type=FILE_DOWNLOAD_URL_ISSUED
file_id, tenant_id, requester_id, subject_owner_id
object_version, sensitivity, purpose
expires_at, ttl_seconds
authorization_result, policy_version
request_ip_hash, user_agent_class
```

민감 파일은 실제 object storage access log와 발급 로그를 주기적으로 맞춰 봅니다. 발급 로그는 있는데 access가 없을 수 있고, access는 있는데 발급 로그가 없다면 우회 경로나 오래된 URL 공유 가능성을 의심해야 합니다.

### 4) 권한 변경 이벤트와 잔여 노출 시간을 연결한다

사용자가 프로젝트에서 제거되거나 파일이 삭제되면 이미 발급된 URL이 남아 있을 수 있습니다. 이때 목표는 "0초 취소"가 아니라 정책적으로 허용한 잔여 노출 시간 안에 닫히는지 확인하는 것입니다.

운영 기준 예시:

- 민감 파일 권한 변경 후 잔여 URL 노출: 최대 5분
- 일반 첨부파일 권한 변경 후 잔여 URL 노출: 최대 15분
- 삭제/비공개 이벤트 후 CDN purge 완료: p95 2분, p99 10분
- URL 발급 실패율: 정상 상태 0.5% 이하
- 파일별 URL 발급 rate limit: 사용자당 분당 20회, 민감 파일은 시간당 10회

이 수치를 문서화하면 보안 리뷰에서 "Presigned URL이라 안전합니다"가 아니라 "권한 변경 후 최대 5분까지 잔여 노출을 허용하고, 그 이상은 알람입니다"라고 말할 수 있습니다.

## 트레이드오프/주의점

첫째, Presigned URL은 앱 서버 부하를 줄이지만 access control의 일부를 storage로 위임합니다. 발급 API가 틀리면 storage는 그대로 허용합니다. 그래서 인증/인가 테스트는 파일 API에 남아야 합니다.

둘째, URL TTL을 짧게 잡으면 보안은 좋아지지만 사용자 경험이 나빠질 수 있습니다. 특히 큰 파일이나 불안정한 네트워크에서는 만료 재발급이 필요합니다. 이 문제를 TTL 증가로만 풀지 말고 재발급 API, range request, 다운로드 세션을 검토합니다.

셋째, 이미 발급된 URL을 즉시 취소하기 어렵습니다. object 삭제, key 변경, bucket policy 변경, CDN purge 같은 조치는 비용이 크고 부작용이 있습니다. 따라서 민감 파일은 처음부터 짧은 TTL과 version 고정, cache 차단을 기본값으로 둬야 합니다.

넷째, public과 private을 같은 bucket/prefix/CDN 정책으로 섞으면 나중에 분리하기 어렵습니다. 완전 공개 파일과 권한 기반 파일은 저장소 경계, cache 정책, 메타데이터 상태를 다르게 가져가는 편이 안전합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] URL 발급 API가 object key가 아니라 `file_id`를 입력으로 받는다.
- [ ] 발급 전 tenant, owner, role, 파일 상태, object version을 재검증한다.
- [ ] 파일 민감도별 TTL과 CDN cache 정책이 숫자로 정해져 있다.
- [ ] 민감 파일은 URL 발급 audit log와 object access log를 함께 본다.
- [ ] 이미 발급된 URL의 잔여 노출 시간을 보안 정책에 명시했다.
- [ ] 삭제, 비공개, 권한 변경 이벤트가 CDN purge 또는 짧은 TTL 정책과 연결되어 있다.
- [ ] 썸네일, 변환본, export artifact도 원본 권한을 상속한다.

### 연습

1. 현재 서비스의 파일 다운로드 API 하나를 골라 사용자가 object key를 직접 전달할 수 있는지 확인해 보세요. 가능하다면 `file_id` 기반 발급 구조로 바꿀 때 필요한 metadata 필드를 적어 봅니다.
2. 개인정보가 포함된 CSV export를 가정하고 URL TTL, 발급 rate limit, audit 필드, 권한 변경 후 잔여 노출 시간을 숫자로 정해 보세요.
3. CDN을 쓰는 비공개 파일 경로가 있다면 cache key에 서명 query/header가 어떻게 반영되는지, 삭제 이벤트 후 purge가 얼마나 걸리는지 측정해 보세요.
