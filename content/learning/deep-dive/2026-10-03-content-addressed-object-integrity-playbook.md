---
title: "백엔드 커리큘럼 심화: Content-Addressed Object Integrity, 업로드한 바이트와 공개한 파일을 같게 만드는 법"
date: 2026-10-03T10:06:00+09:00
lastmod: 2026-10-03T10:06:00+09:00
draft: false
topic: "Storage Integrity"
tags: ["Object Storage", "SHA-256", "Content Addressing", "Data Integrity", "File Upload", "Backend Security"]
categories: ["Backend Deep Dive"]
description: "오브젝트 스토리지 업로드에서 이름·ETag·Content-Type만 믿지 않고, 바이트 해시, 임시 객체, 검증 상태, 불변 공개 키를 연결해 전송 오류와 재시도·중복 업로드를 다루는 방법을 정리합니다."
summary: "파일을 저장했다는 사실은 같은 파일을 나중에 읽어 준다는 보장이 아니다. content-addressed identity와 검증 상태를 분리하면 업로드 재시도, 멀티파트 조립, 중복 제거, 공개 전 스캔을 하나의 무결성 계약으로 운영할 수 있다."
module: "ops-observability"
study_order: 1366
keywords: ["content addressed storage", "object storage integrity", "sha256 upload verification", "multipart checksum", "immutable object key"]
key_takeaways:
  - "파일명·확장자·ETag는 식별자나 무결성 증명으로 충분하지 않으며, 공개 대상의 기준은 검증된 바이트 digest여야 한다."
  - "업로드 의도, 임시 객체, 스캔·해시 검증, 공개 manifest를 분리하면 재시도와 중복 이벤트가 데이터 오염으로 번지지 않는다."
  - "해시가 같아도 접근 권한이 같아지는 것은 아니므로 tenant 경계와 암호화 키·보존 정책은 별도 메타데이터로 유지해야 한다."
operator_checklist:
  - "완료 처리 전에 기대 크기·실제 크기·강한 checksum과 검증 주체를 기록한다."
  - "multipart 업로드의 ETag를 SHA-256 검증값으로 해석하지 않는다."
  - "공개 URL은 mutable upload key가 아니라 검증된 object version 또는 digest manifest를 가리키게 한다."
  - "hash mismatch, incomplete upload, scan pending, refcount underflow를 운영 지표로 수집한다."
---

오브젝트 스토리지에 `invoice.pdf`를 올리고 URL을 DB에 넣는 일은 간단해 보입니다. 그러나 모바일 재시도, 프록시, 멀티파트 조립, 중복 완료 이벤트, 백그라운드 변환 워커가 섞이면 "업로드가 성공했다"는 상태는 지나치게 약합니다. 같은 파일명 아래에 다른 바이트가 덮일 수 있고, 멀티파트 ETag를 MD5라고 착각해 손상 검증을 건너뛸 수도 있으며, 스캔 전 임시 객체가 CDN 경로에 노출될 수도 있습니다.

이 글의 목표는 모든 파일을 별도 스토리지 시스템으로 옮기는 것이 아닙니다. **공개하는 논리 파일이 어떤 바이트인지, 누가 언제 검증했는지 재현할 수 있게 만드는 것**입니다. [Object Storage와 S3](/learning/deep-dive/deep-dive-object-storage-s3/), [Resumable Multipart Upload Session](/learning/deep-dive/deep-dive-resumable-multipart-upload-session-playbook/), [Object Upload Quarantine](/learning/deep-dive/deep-dive-object-upload-quarantine-scanning-playbook/), [Envelope Encryption](/learning/deep-dive/deep-dive-envelope-encryption-pii-field-crypto-playbook/)에서 다룬 저장·업로드·보안 경계를 하나의 무결성 계약으로 연결합니다.

## 이 글에서 얻는 것

- 파일명이나 ETag 대신 digest를 언제 식별자로 써야 하는지 판단할 수 있습니다.
- direct upload, multipart, 재시도, 비동기 스캔을 거쳐도 공개 바이트를 바꾸지 않는 상태 전이를 설계할 수 있습니다.
- deduplication의 비용 절감과 tenant 간 정보 노출 위험을 분리해서 검토할 수 있습니다.
- checksum 오류, 검증 지연, orphan 객체를 수치로 관측하고 배포·장애 기준에 넣을 수 있습니다.

## 핵심 개념/이슈

### 1) 파일명·ETag·Content-Type은 바이트의 신분증이 아니다

사용자가 주는 파일명은 표시용 속성이고, `Content-Type`과 확장자는 정책 판단의 보조 입력일 뿐입니다. 둘 다 바이트 내용을 증명하지 않습니다. ETag도 객체 저장소와 업로드 방식에 따라 의미가 달라집니다. 단일 업로드에서는 MD5와 비슷하게 보일 수 있어도, multipart ETag는 파트 구성에서 계산된 값이거나 암호화·프록시 설정에 따라 달라질 수 있습니다. 따라서 ETag를 일반적인 SHA-256 checksum처럼 비교하는 설계는 이식성도 안전성도 낮습니다.

content-addressed identity는 저장된 **정확한 바이트열**을 강한 해시로 표현합니다. 예를 들어 `sha256:ab12...`는 "이 이름의 파일"이 아니라 "이 바이트의 파일"을 뜻합니다. 같은 digest가 두 번 나오면 전송 결과가 같다는 검증 근거가 생기고, digest가 다르면 같은 `invoice.pdf`라도 다른 객체입니다. 다만 해시는 암호화·권한을 대신하지 않습니다. 해시를 알고 있다는 사실만으로 다른 tenant의 객체 존재 여부를 추측하거나 접근할 수 없도록, 공개 권한과 조회 API는 논리 객체 ID·tenant ID 기준으로 계속 검사해야 합니다.

### 2) 업로드 완료와 검증 완료는 다른 상태다

클라이언트가 `PUT` 응답을 받았다고 해서 서비스가 그 객체를 읽거나 공개해도 된다는 뜻은 아닙니다. 네트워크 재시도로 두 개의 temp object가 남을 수 있고, 업로드 완료 이벤트는 적어도 한 번 이상 전달될 수 있으며, multipart complete 직후에만 서버가 최종 길이와 checksum을 안정적으로 읽을 수 있는 제공자도 있습니다. 그러므로 `uploaded=true` 하나로 상태를 합치면 재처리할수록 판단이 흐려집니다.

권장 상태는 아래처럼 역할을 나누는 것입니다.

| 상태 | 의미 | 공개 가능 여부 |
| --- | --- | --- |
| `initiated` | 크기·정책이 있는 업로드 의도를 만들었다 | 불가 |
| `received` | 임시 key에 바이트가 도착했다 | 불가 |
| `verified` | 크기와 강한 checksum이 기대값 또는 서버 계산값과 일치한다 | 불가 |
| `approved` | 악성코드·콘텐츠·권한 정책을 통과했다 | manifest를 통해 가능 |
| `rejected` / `expired` | 불일치·정책 위반·시간 초과다 | 불가 |

`verified`와 `approved`를 분리하는 이유는 무결성과 안전성이 다르기 때문입니다. SHA-256이 맞는 PDF도 악성일 수 있고, 스캔을 통과한 파일도 중간에 다른 객체로 바뀌면 안 됩니다. 이 분리는 [비동기 요청-응답 Operation Resource](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/)의 장기 작업 상태 모델과도 잘 맞습니다.

### 3) 물리 객체와 논리 파일을 분리해야 재시도가 멱등해진다

`uploads/{userId}/invoice.pdf`처럼 mutable key를 최종 URL로 쓰면 새 업로드가 과거 영수증을 덮는지, 같은 요청 재시도가 같은 결과인지 알기 어렵습니다. 대신 `uploads/{uploadId}`에는 임시 바이트만 두고, 검증 뒤 `objects/sha256/ab/ab12...`처럼 불변 physical key를 만들거나 공급자의 immutable version ID를 저장합니다. 애플리케이션 DB의 `document`는 그 digest와 검증 상태를 참조하는 논리 레코드가 됩니다.

이 구조에서 `CompleteUpload(uploadId)`는 여러 번 호출돼도 같은 digest와 같은 논리 객체를 반환해야 합니다. 다른 바이트가 도착했다면 성공을 덮어쓰지 말고 `checksum_mismatch`로 닫아야 합니다. 동일 digest를 저장 비용 절감을 위해 재사용할 수는 있지만, tenant별 object reference와 암호화·보존·삭제 정책은 합치지 않는 것이 보수적입니다. 전역 dedup은 "이 파일이 이미 존재한다"는 존재 여부를 side channel로 만들 수 있고, tenant별 암호화 키를 쓰면 ciphertext digest도 달라질 수 있습니다.

## 실무 적용

### 1) 업로드 의도부터 공개 manifest까지 네 단계로 만든다

첫 단계에서 서버는 `uploadId`, tenant, 허용 MIME 계열, 최소·최대 크기, 만료 시각, 선택적인 client SHA-256을 기록하고 임시 key용 presigned URL만 발급합니다. 결제 영수증처럼 최대 크기가 명확한 도메인은 예를 들어 **10 MiB 이하**를 먼저 거절해 불필요한 전송과 스캔 비용을 막을 수 있습니다. 사용자 생성 동영상처럼 큰 파일은 별도 정책·multipart session으로 분리합니다. 클라이언트 hash는 유용한 힌트지만, 신뢰 경계 밖 입력이므로 그것만으로 승인하면 안 됩니다.

둘째, complete API는 제공자 메타데이터에서 실제 크기와 strong checksum을 읽고, 필요하면 격리 워커가 스트리밍 SHA-256을 계산합니다. 작은 문서처럼 **128 MiB 이하**이고 비용이 허용되면 서버 재계산이 가장 이해하기 쉬운 출발점입니다. 더 큰 multipart 객체는 저장소가 제공하는 SHA-256 checksum을 complete 단계에 강제하고, 파트 목록·최종 길이·checksum 알고리즘을 함께 보관합니다. 어느 경우든 ETag 비교만으로 `verified`를 만들지 않는 것이 원칙입니다.

셋째, 검증된 객체를 quarantine 경로에서 스캔·콘텐츠 정책·메타데이터 추출로 보냅니다. 스캐너는 `uploadId`가 아니라 이미 고정된 digest를 입력으로 받아야 재시도 때 다른 바이트를 검사하지 않습니다. 마지막으로 승인 워커가 `(tenant_id, logical_object_id, digest)`를 포함한 manifest를 트랜잭션으로 확정합니다. 읽기 API는 이 manifest가 `approved`인 경우에만 short-lived download URL을 발급합니다. CDN origin에 temp prefix를 직접 열어 두면 이 설계가 무너집니다.

### 2) 검증 기준은 오류율과 시간 제한으로 고정한다

초기 운영 기준으로는 다음 정도가 실용적입니다. 제품 위험도와 객체 크기 분포를 본 뒤 조정해야 하며, 모든 서비스에 그대로 적용할 값은 아닙니다.

| 지표·조건 | 출발 기준 | 조치 |
| --- | --- | --- |
| checksum mismatch | 0건이 정상 | 즉시 공개 중단, client·proxy·multipart 경로 분리 조사 |
| `received → verified` p95 | 문서 5분, 대용량 별도 SLA | 지연 시 worker queue와 storage head 실패율 확인 |
| `verified → approved` p95 | 일반 파일 15분 | 초과 객체는 알림 후 사용자에게 pending 표시 |
| temp object TTL | 24시간부터 시작 | 만료 전에 complete되지 않으면 abort·삭제 큐로 이동 |
| orphan bytes / accepted bytes | 1% 미만 | refcount·이벤트 중복·cleanup 실패를 점검 |

hash mismatch를 "가끔 나는 재시도 오류"로 허용하지 마세요. checksum mismatch가 생겼다면 해당 logical object는 새 upload intent로 다시 시작해야 합니다. 반면 스캐너 지연은 대상 파일을 계속 비공개 상태로 보관하면서 재시도할 수 있습니다. 실패 종류마다 되돌리는 범위가 다르므로, 하나의 `upload_failed` 카운터로 합치지 않는 편이 좋습니다.

### 3) 삭제와 변환도 원본 digest를 보존한 채 다룬다

이미지 썸네일, PDF 미리보기, OCR 텍스트처럼 파생 결과가 생기면 원본과 결과물의 관계를 `(source_digest, transform_version, output_digest)`로 기록합니다. 그러면 변환 라이브러리를 바꾼 뒤 어떤 결과만 재생성할지 알 수 있고, 같은 원본에서 나온 오래된 미리보기를 무작정 덮어쓰지 않아도 됩니다. 파생 객체의 공개 여부도 원본의 tenant 권한과 삭제 hold를 상속해야 합니다.

삭제 요청에서는 논리 reference를 먼저 끊고, 물리 객체는 보존 기간과 참조 수를 확인한 뒤 비동기로 정리합니다. `refcount=0`은 유용한 최적화 힌트이지만 이벤트 중복과 재처리로 음수가 될 수 있으므로, 정기 reconciliation에서 manifest를 기준으로 재계산할 수 있어야 합니다. 법적 보존이나 backup 삭제가 필요한 데이터는 [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)의 별도 절차를 따릅니다. digest를 쓴다고 보존 의무가 사라지지는 않습니다.

## 트레이드오프/주의점

1. **서버 재해싱은 가장 강한 검증이지만 비용과 지연을 늘린다.** 객체 크기·위험도별로 provider checksum 검증과 서버 재계산을 나누되, 어떤 경로든 강한 checksum 증거를 남겨야 한다.
2. **전역 dedup은 저장비를 줄이지만 존재 여부와 삭제 연동을 복잡하게 만든다.** 민감 tenant·고객별 키·보존 정책이 다르면 tenant 내부 dedup부터 시작하는 편이 안전하다.
3. **불변 key는 정정 기능을 없애는 것이 아니다.** 논리 manifest를 새 digest로 바꾸고 이전 version을 보존·폐기하는 방식으로 수정 이력을 다룬다.
4. **checksum은 악성 파일을 찾아 주지 않는다.** 무결성 검증 후에도 quarantine, malware scan, content policy, 다운로드 권한 검사가 필요하다.
5. **해시 알고리즘 변경도 데이터 마이그레이션이다.** 새 알고리즘을 추가할 때는 알고리즘 식별자와 digest를 함께 저장하고, 과거 객체를 한 번에 재해싱하지 않는다.

## 체크리스트 또는 연습

### 운영 체크리스트

- [ ] upload intent에 tenant, 크기 제한, 만료 시각, 허용 정책, idempotency key가 있다.
- [ ] multipart ETag를 보편적 MD5 또는 SHA-256 무결성 증명으로 취급하지 않는다.
- [ ] complete 전에 실제 길이와 strong checksum을 확인하고 검증 근거를 저장한다.
- [ ] temp object, verified object, 공개 manifest, CDN origin이 분리돼 있다.
- [ ] digest가 같아도 tenant 권한·암호화 키·보존 정책을 자동 공유하지 않는다.
- [ ] checksum mismatch, 검증·스캔 지연, orphan 비율, refcount 이상을 관측한다.
- [ ] logical delete와 physical cleanup을 분리하고 reconciliation 경로가 있다.

### 연습

현재 서비스의 파일 한 종류를 고르고 `uploadId`, 실제 크기, checksum 알고리즘·값, quarantine key, final digest, 논리 객체 ID, 승인 시각을 어느 테이블 또는 이벤트에 남길지 그려 보세요. 이어서 complete API를 두 번 호출하고, 첫 호출 뒤 다른 바이트가 같은 임시 key에 도착했다고 가정합니다. 어느 상태 전이가 거절돼야 하는지와 사용자에게 어떤 재시도 안내를 보여 줄지를 정리하면, 저장 API가 아니라 무결성 계약을 설계하고 있는지 확인할 수 있습니다.

## 관련 글

- [Object Storage와 S3](/learning/deep-dive/deep-dive-object-storage-s3/)
- [Resumable Multipart Upload Session](/learning/deep-dive/deep-dive-resumable-multipart-upload-session-playbook/)
- [Object Upload Quarantine과 비동기 스캔](/learning/deep-dive/deep-dive-object-upload-quarantine-scanning-playbook/)
- [Envelope Encryption과 PII Field Crypto](/learning/deep-dive/deep-dive-envelope-encryption-pii-field-crypto-playbook/)
- [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)
