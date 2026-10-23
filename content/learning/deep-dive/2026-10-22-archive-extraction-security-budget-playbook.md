---
title: "백엔드 커리큘럼 심화: Archive Extraction Gateway, 압축 파일을 신뢰할 수 있는 입력으로 바꾸는 법"
date: 2026-10-22T10:06:00+09:00
lastmod: 2026-10-22T10:06:00+09:00
draft: false
topic: "Backend Security"
tags: ["File Upload", "Archive Extraction", "Zip Bomb", "Path Traversal", "Sandboxing", "Backend Security"]
categories: ["Backend Deep Dive", "Security"]
description: "ZIP·TAR 같은 압축 파일을 업로드받을 때 압축 해제 예산, 경로 검증, 격리 실행, 검사 증거를 분리해 zip bomb과 path traversal을 운영 가능한 정책으로 다루는 방법을 정리합니다."
module: "backend-security"
study_order: 1261
keywords: ["archive extraction security", "zip bomb protection", "path traversal archive", "safe tar extraction", "file upload quarantine"]
summary: "압축 파일은 파일 하나처럼 보이지만, 서버가 해제하는 순간 수많은 경로·바이트·CPU·외부 파서 입력으로 확장된다. 수락한 업로드와 안전하게 소비할 수 있는 아카이브를 구분하고, 크기·항목·시간 예산과 격리된 worker·검사 receipt를 함께 둬야 한다."
key_takeaways:
  - "압축된 바이트 크기만으로는 위험을 판단할 수 없으므로 예상 해제 크기, 항목 수, 경로, 중첩 깊이, 해제 시간을 각각 제한한다."
  - "파일명 정규화와 prefix 검사만으로 안전하지 않다. symlink·hard link·절대 경로·특수 파일을 정책상 명시적으로 거부해야 한다."
  - "해제 성공은 worker exit code가 아니라 정책을 통과한 manifest와 검증된 산출물이 격리 영역에 존재하는 상태로 판정한다."
operator_checklist:
  - "아카이브 형식별 최대 압축 크기·해제 크기·항목 수·해제 시간과 예외 승인자를 문서화한다."
  - "quarantine, extraction sandbox, publish 영역을 다른 권한과 다른 저장 prefix로 분리한다."
  - "거부·실패·성공에 archive digest, 정책 버전, 검사 결과, 산출 manifest를 남긴다."
---

백업 묶음, 고객이 올린 자료, 플러그인 패키지, 대량 import는 ZIP·TAR·7z 같은 압축 파일로 들어오는 경우가 많습니다. 업로드 API가 `201 Created`를 돌려줬다고 해서 그 파일을 애플리케이션이 안전하게 열 수 있다는 뜻은 아닙니다. 작은 압축 파일이 수십 GiB로 풀릴 수 있고, `../../` 경로가 작업 디렉터리 밖을 가리킬 수 있으며, symlink와 특수 파일이 뒤 단계의 검사나 복사를 다른 대상으로 돌릴 수 있습니다.

이 글은 [파일 업로드 격리·악성코드 스캔](/learning/deep-dive/deep-dive-object-upload-quarantine-scanning-playbook/), [Content-Addressed Object Integrity](/learning/deep-dive/2026-10-03-content-addressed-object-integrity-playbook/), [문서 처리 파이프라인의 원본·파생본 분리](/learning/deep-dive/deep-dive-document-rendition-versioning-playbook/), [요청 본문 크기·스트리밍 Guardrail](/learning/deep-dive/deep-dive-request-body-guardrail-streaming-playbook/)을 아카이브 입력 경로에 연결합니다. 목표는 모든 압축 형식을 지원하는 것이 아니라, **해제 전·중·후에 서버가 소비할 수 있는 자원을 증명하고 위험한 산출물을 publish하지 않는 것**입니다.

## 이 글에서 얻는 것

- 압축 파일의 위험을 업로드 크기, 해제 크기, 파일 경로, parser, 후속 처리의 다섯 층으로 나누는 기준을 얻습니다.
- zip bomb과 path traversal을 단일 정규식이 아니라 수량 예산과 상태 전이로 막는 방법을 배웁니다.
- 격리 worker가 생성한 파일을 어떻게 manifest로 확인하고 공개 영역으로 승격할지 정리합니다.
- 암호화 아카이브, 중첩 압축, 검사 실패처럼 애매한 경우에 fail-closed를 적용할 조건을 만듭니다.

## 핵심 개념/이슈

### 1) 업로드 수락과 아카이브 소비 승인은 다른 사건이다

업로드 단계에서는 네트워크 전송을 끝냈을 뿐입니다. 실제 위험은 백엔드가 목록을 읽고, 압축을 풀고, 이미지·문서·코드 같은 하위 파일을 파싱하며 시작됩니다. 일반적인 파일 검사만 앞에 두면 압축 내부의 실제 파일 수와 해제 후 크기를 모르고, 반대로 애플리케이션 pod 안에서 곧바로 풀면 임시 디스크·inode·CPU·메모리·공유 볼륨이 함께 위험해집니다.

따라서 입력의 상태를 최소한 `received → quarantined → inspected → extracted → verified → published`로 나눕니다. `received`와 `quarantined`는 원본 바이트를 보관할 수 있는 상태이지만, 사용자 다운로드·색인·미리보기의 입력이 될 수는 없습니다. `verified`는 정책을 통과한 extract manifest가 있고, 각 산출물이 허용 형식인지 확인된 상태입니다. 어느 단계든 timeout, scanner 오류, 예상 밖의 entry type은 `rejected` 또는 `needs_review`로 끝내며 자동 공개로 되돌아가면 안 됩니다.

### 2) 압축 해제는 하나의 크기 제한이 아니라 다섯 개의 예산 문제다

“100MiB 이하 ZIP만 받는다”는 정책만으로는 부족합니다. 공격자는 높은 압축률, 아주 많은 빈 파일, 깊은 중첩, 긴 파일명, 압축 헤더와 실제 데이터의 불일치를 조합할 수 있습니다. 형식 라이브러리가 제공하는 metadata도 신뢰할 수 없는 입력으로 다루고, 스트리밍 중 실제로 쓴 바이트를 다시 계수해야 합니다.

아래 값은 시작점이지 보편적인 보안 표준이 아닙니다. 예를 들어 고객 백업을 허용하는 제품은 해제 크기가 더 커질 수 있지만, 그 경우에도 별도 queue와 디스크 quota를 가져야 합니다.

| 예산 | 일반 문서 묶음의 출발 기준 | 초과 시 기본 행동 | 이유 |
| --- | ---: | --- | --- |
| 압축 원본 크기 | 100MiB | 업로드 거부 또는 별도 import 경로 | ingress·저장 비용 보호 |
| 실제 해제 총량 | 1GiB | 즉시 중단·quarantine 유지 | zip bomb·디스크 고갈 차단 |
| entry 수 | 10,000개 | 중단·review | inode·scanner·색인 폭주 방지 |
| 해제 비율 | 100:1 | 중단 또는 승인 queue | 작지만 과도하게 부푸는 입력 감지 |
| 단일 entry | 256MiB | 해당 entry 거부 | 하위 parser·메모리 예산 보호 |
| 경로 깊이 | 10단계 | 거부 | 비정상 트리·후속 도구 오류 완화 |
| wall-clock | 60초/작업 | worker kill·재시도 금지 | CPU 고갈과 무한 처리 방지 |

압축 비율은 `expected_uncompressed / compressed` 하나만 보는 지표가 아닙니다. 압축 헤더가 거짓일 수 있으므로, 실제로 기록한 바이트와 작업 시간·entry 수를 함께 봅니다. `compressed=0`에 가까운 항목, data descriptor를 뒤에 두는 형식, ZIP64처럼 라이브러리별 해석이 다른 경우에는 metadata 기반 통과를 허용하지 말고 보수적으로 분기하세요.

### 3) 경로 문자열을 고친다고 안전한 파일 트리가 되지는 않는다

아카이브 entry의 이름은 운영체제 파일 경로가 아니라 공격자가 준 문자열입니다. `../`, 절대 경로, Windows drive prefix, NUL, 과도한 Unicode 정규화 차이뿐 아니라 symlink·hard link·device·FIFO가 문제를 만듭니다. `normalize(entry).startsWith(root)` 같은 검사는 필요한 첫 단계일 수 있지만, symlink가 만들어진 뒤의 실제 파일 시스템 해석까지 보장하지 않습니다.

안전한 기본값은 다음과 같습니다.

1. archive entry를 OS 경로로 join하기 전에 separator를 하나의 형식으로 정규화하고, 빈 이름·절대 경로·상위 디렉터리·제어 문자를 거부합니다.
2. 허용 타입을 regular file과 필요한 directory로 제한합니다. symlink, hard link, block/character device, FIFO는 지원 요구가 명확하기 전까지 거부합니다.
3. 대상 파일은 sandbox root 아래에서 새로 만들고, 기존 파일을 따라가거나 덮어쓰지 않습니다. 공개 저장소 key와 로컬 임시 경로를 같은 문자열로 재사용하지 않습니다.
4. 추출이 끝난 뒤 manifest의 상대 경로, 크기, digest, MIME 판별 결과를 다시 만들고 다음 단계는 manifest만 읽게 합니다.

MIME은 extension이나 archive header의 `Content-Type`만 믿지 말고 magic bytes와 허용 목록으로 확인해야 합니다. 특히 실행 파일, 스크립트, 이중 확장자, 문서 매크로, 또 다른 아카이브는 “해제했다”가 아니라 별도의 위험 분류가 필요합니다.

## 실무 적용

### 1) quarantine과 extraction sandbox의 소유권을 분리한다

원본은 tenant·업로드 세션·content digest를 묶은 quarantine prefix에 immutable로 저장합니다. extraction worker에는 이 원본을 **읽을 수 있는** 짧은 권한만 주고, 공개 prefix나 production database credential은 주지 않습니다. worker의 쓰기 대상은 작업 ID별 빈 scratch volume과 검증 전 산출 prefix뿐이어야 합니다.

작업을 다음처럼 나누면 재시도와 감사가 쉬워집니다.

```text
upload intent
  -> immutable quarantine object + sha256
  -> format sniff + policy preflight
  -> sandboxed extraction (byte / entry / time counters)
  -> per-entry type scan + manifest
  -> verifier accepts manifest
  -> copy/promote to published namespace
```

preflight는 빠른 거부를 위한 보조 장치입니다. entry count나 알려진 uncompressed size가 이미 예산을 넘으면 worker를 시작하지 않을 수 있습니다. 하지만 최종 판정은 streaming extraction 중의 실제 계수여야 합니다. worker가 죽었거나 timeout이 났다면 동일 job을 무한 재시도하지 말고, 시도 횟수와 소비한 byte·time을 receipt에 남긴 뒤 수동 review 또는 새 업로드를 요구하세요.

### 2) manifest를 다음 단계의 유일한 입력 계약으로 둔다

해제 작업이 `/tmp/foo`에 파일을 만들었다는 사실을 문서 변환기나 import job이 직접 믿으면, 재시도·cleanup·경로 변경 때 서로 다른 파일을 읽을 수 있습니다. verifier가 만든 manifest에 `source_digest`, `extractor_version`, `policy_version`, 상대 경로, 실제 크기, digest, detected_type, scan verdict를 넣고, 다음 단계에는 그 manifest ID만 넘깁니다.

예를 들어 2,000개 CSV를 import하는 서비스라면 추출 성공과 import 가능을 분리합니다. CSV 총량은 800MiB여도 한 파일이 300MiB를 넘으면 reject할 수 있고, UTF-8 검증이나 행 수 상한은 별도 import policy로 평가합니다. 이전에 올린 같은 원본 digest가 있다면 [content-addressed 무결성](/learning/deep-dive/2026-10-03-content-addressed-object-integrity-playbook/)을 이용해 검증 결과를 재사용할 수 있지만, **policy version이나 scanner definition이 바뀌면 예전 verdict를 그대로 publish 판단에 쓰지 않는 것**이 안전합니다.

### 3) 관측 지표는 거부율보다 예산 소비 분포를 먼저 본다

아카이브 거부율이 0%라고 안전한 것은 아닙니다. 정상 고객의 대형 파일이 작업 queue를 오래 점유하거나, 압축률이 높은 입력 때문에 scratch disk가 고갈될 수 있습니다. 다음 지표를 archive format·tenant tier·policy version별로 관찰하세요.

| 지표 | 경보보다 먼저 볼 질문 | 출발 행동 |
| --- | --- | --- |
| 실제 해제 bytes p95/p99 | 어느 형식·고객이 budget을 쓰는가 | tier별 queue·quota 분리 |
| entry 수와 경로 거부 사유 | 제품 기능 부족인가 공격 탐색인가 | 샘플 검토 후 policy 보완 |
| extraction 시간과 kill 비율 | CPU·I/O·parser 중 병목은 어디인가 | worker 동시성·time budget 조정 |
| `verified → published` 실패 | scanner·manifest·storage 중 어느 경계인가 | 자동 재시도 전에 receipt 비교 |

새 형식이나 예외 한도를 도입할 때는 먼저 7일 정도 observe-only로 실제 분포를 기록하고, 가장 위험이 큰 제한부터 enforce합니다. 예외가 반복되면 전역 10GiB 한도를 올리기보다 별도 import 제품 경로, 전용 worker pool, 승인된 포맷 목록을 만드는 편이 낫습니다.

## 트레이드오프/주의점

모든 아카이브를 완전히 해제하지 않고 검사하면 비용은 낮지만, 내부 콘텐츠의 위험을 놓칠 수 있습니다. 반대로 중첩된 아카이브까지 재귀적으로 모두 풀면 공격 표면과 비용이 급격히 커집니다. 일반 제품의 기본값은 **중첩 아카이브를 regular file로만 보관하고 자동 재귀 해제를 하지 않는 것**입니다. 업무상 필요한 경우에만 depth 1 또는 2, 누적 byte budget, 전용 queue를 명시적으로 추가하세요.

암호화 ZIP은 내용 검사가 어렵습니다. 비밀번호를 받는다는 이유로 scanner를 건너뛰거나 production worker에서 여러 번 password를 시도하면 안 됩니다. 정책상 허용하지 않으면 `unsupported_encryption`으로 거부하고, 허용한다면 password 전달·메모리 보관·audit·실패 횟수를 별도 비밀 처리 경로로 설계해야 합니다.

또한 sandbox가 있다고 해서 안전한 것은 아닙니다. container의 host mount, broad service account, unrestricted egress, 공유 `/tmp`가 있으면 parser 취약점 하나가 더 넓은 권한으로 이어집니다. worker는 비루트, read-only root filesystem, 제한된 CPU·memory·ephemeral storage, outbound 기본 차단을 원칙으로 두고, 이미지와 extractor library의 취약점 관리도 release 절차에 포함하세요.

## 체크리스트 또는 연습

- [ ] 업로드 원본, quarantine, extraction scratch, published namespace가 서로 다른 prefix·권한·보존 정책을 쓴다.
- [ ] 압축·해제 크기, entry 수, 경로 깊이, 단일 파일, wall-clock의 상한과 초과 시 행동이 있다.
- [ ] metadata preflight와 실제 streaming byte counter를 모두 사용하며, 전자는 최종 통과 근거가 아니다.
- [ ] 절대 경로, 상위 경로, symlink·hard link·special file, 중첩 archive의 기본 정책이 명시돼 있다.
- [ ] extractor는 공개 저장소와 production credential에 직접 쓰지 못하고, 실패 시 kill·quarantine 상태로 끝난다.
- [ ] 다음 단계는 로컬 경로가 아닌 versioned manifest와 entry digest를 입력으로 받는다.
- [ ] policy 버전·extractor 버전·scan verdict·예산 초과 사유를 receipt로 남긴다.

연습으로 현재 서비스에서 가장 큰 ZIP 하나를 골라 보세요. 압축 원본 크기만 적지 말고, 실제 해제 크기, entry 수, 최대 단일 파일, 처리 시간, 내부 파일 타입을 표로 기록합니다. 그 값이 지금의 pod ephemeral storage·worker 동시성·scanner 처리량과 곱해졌을 때도 안전한지 계산하면, 막연한 “파일 크기 제한”을 실제 운영 예산으로 바꿀 수 있습니다.

## 관련 글

- [파일 업로드 격리·악성코드 스캔](/learning/deep-dive/deep-dive-object-upload-quarantine-scanning-playbook/)
- [Content-Addressed Object Integrity](/learning/deep-dive/2026-10-03-content-addressed-object-integrity-playbook/)
- [문서 처리 파이프라인의 원본·파생본 분리](/learning/deep-dive/deep-dive-document-rendition-versioning-playbook/)
- [요청 본문 크기·스트리밍 Guardrail](/learning/deep-dive/deep-dive-request-body-guardrail-streaming-playbook/)
- [Resumable Multipart Upload Session](/learning/deep-dive/deep-dive-resumable-multipart-upload-session-playbook/)
