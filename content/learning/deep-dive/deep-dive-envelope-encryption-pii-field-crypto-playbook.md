---
title: "백엔드 커리큘럼 심화: Envelope Encryption과 PII Field Crypto 운영 플레이북"
date: 2026-08-04
draft: false
topic: "Backend Security"
tags: ["Envelope Encryption", "KMS", "PII", "Field Level Encryption", "Data Security", "Backend Security"]
categories: ["Backend Deep Dive"]
description: "DB 전체 암호화만으로 부족한 개인정보·토큰·고위험 필드를 KMS, DEK, 키 버전, 검색용 blind index, 회전 런북으로 안전하게 운영하는 기준을 정리합니다."
module: "backend-security"
study_order: 1262
keywords: ["envelope encryption", "field level encryption", "PII encryption", "KMS", "blind index", "key rotation"]
summary: "민감 필드는 저장소 암호화에만 기대면 조회 권한, 백업, 로그, 내부자 접근 리스크를 줄이기 어렵습니다. Envelope Encryption은 KMS와 데이터 키를 분리하고, 필드 단위 암호화는 도메인별 검색·회전·삭제 기준까지 함께 설계해야 운영 가능한 보호 장치가 됩니다."
key_takeaways:
  - "DB TDE나 디스크 암호화는 인프라 분실 방어에는 유효하지만 애플리케이션 조회 권한 남용과 백업 확산 리스크까지 막지는 못한다."
  - "Envelope Encryption은 KMS의 KEK와 데이터별 DEK를 분리해 대량 데이터 암호화, 키 회전, 폐기 범위를 작게 만드는 기본 구조다."
  - "PII 필드 암호화는 검색, 정렬, 중복 검증, 감사, 삭제 요청까지 영향을 주므로 blind index와 키 버전 정책을 같이 잡아야 한다."
operator_checklist:
  - "민감 필드를 public, internal, confidential, restricted 4등급으로 분류하고 restricted 필드는 필드 단위 암호화 후보로 올린다."
  - "암호문에는 key_version, algorithm, nonce, ciphertext, tag를 함께 저장하고 원문은 로그·검색 인덱스·분석 이벤트로 내보내지 않는다."
  - "키 회전은 30일 단위 계획 회전, 유출 의심 15분 내 disable, 24~72시간 dual-read 검증을 기준으로 둔다."
learning_refs:
  - title: "비밀 관리"
    href: "/learning/deep-dive/deep-dive-secret-management/"
    description: "Vault, Secrets Manager, KMS, 회전 자동화의 기본기를 다룹니다."
  - title: "데이터 보존·삭제 아키텍처"
    href: "/learning/deep-dive/deep-dive-data-retention-deletion-architecture/"
    description: "삭제 요청, purge, archive, 보존 정책을 데이터 수명주기로 정리합니다."
  - title: "Tamper-Evident Audit Log"
    href: "/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/"
    description: "민감 데이터 접근과 키 사용을 조작 방지 증거로 남기는 기준입니다."
---

DB 디스크가 암호화되어 있고 클라우드 관리형 데이터베이스를 쓰면 "저장 데이터는 안전하다"고 생각하기 쉽습니다. 하지만 운영 사고는 대개 디스크를 훔쳐 가는 형태로만 오지 않습니다. 관리자 계정이 과하게 넓고, 백업이 여러 환경으로 복제되고, 디버깅 로그에 원문 값이 찍히고, 분석 파이프라인이 주민번호·전화번호·계좌 식별자를 그대로 가져갑니다. 이때 저장소 전체 암호화만으로는 충분하지 않습니다.

Envelope Encryption과 필드 단위 암호화의 목적은 암호학을 멋지게 쓰는 것이 아닙니다. **고위험 데이터가 노출되는 경로를 줄이고, 키 회전과 폐기를 실제 운영 절차로 만들며, 조회 권한이 있는 사람도 원문을 마음대로 볼 수 없게 하는 것**입니다. 이 글은 [비밀 관리](/learning/deep-dive/deep-dive-secret-management/), [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/), [API Key Lifecycle](/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/), [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)와 이어지는 백엔드 보안 운영 기준입니다.

## 이 글에서 얻는 것

- DB TDE, 디스크 암호화, 필드 단위 암호화의 책임 범위를 구분할 수 있습니다.
- KMS의 KEK, 데이터별 DEK, 키 버전, nonce, authentication tag를 어떤 구조로 저장해야 하는지 이해합니다.
- 개인정보 필드를 암호화할 때 검색, 정렬, 중복 검증, 분석, 삭제 요청이 어떻게 바뀌는지 판단할 수 있습니다.
- 키 회전과 사고 대응을 "언젠가 한다"가 아니라 15분, 24시간, 30일 같은 운영 숫자로 정할 수 있습니다.

## 핵심 개념/이슈

### 1) 저장소 전체 암호화는 필요하지만 충분하지 않다

디스크 암호화나 DB Transparent Data Encryption은 기본 방어선입니다. 스토리지 장비 유실, snapshot 탈취, 물리적 접근 같은 위험에는 효과가 있습니다. 하지만 애플리케이션이 정상적으로 DB에 접속해 `SELECT email, phone FROM users`를 실행하면 DB는 평문을 돌려줍니다. 운영자 권한이 넓거나, read replica가 분석 계정에 열려 있거나, 백업을 개발 환경으로 복원하는 문화가 있으면 원문 데이터는 쉽게 퍼집니다.

필드 단위 암호화는 이 지점을 줄입니다. 애플리케이션이 특정 필드를 저장하기 전 암호화하고, 복호화는 명시적인 권한과 키 접근을 통과해야만 수행합니다. 그러면 DBA나 read-only 분석 계정이 테이블을 읽어도 민감 필드의 원문은 보이지 않습니다.

도입 후보는 아래 기준으로 잡습니다.

| 데이터 | 기본 처리 |
| --- | --- |
| 로그인 이메일, 전화번호, 실명 | 암호화 후보, 검색 필요 시 blind index 병행 |
| 주민등록번호, 여권번호, 계좌번호 | restricted, 원칙적으로 필드 암호화 필수 |
| access token, refresh token, 외부 provider credential | 암호화 또는 토큰 전용 저장소 |
| 주소, 배송 메모, 고객지원 원문 | 보존 기간과 접근 통제를 함께 검토 |
| 공개 프로필 이름, 상품명 | 일반적으로 필드 암호화 대상 아님 |

판단 기준은 간단합니다. 값이 유출됐을 때 사용자에게 직접 피해가 생기거나, 재발급·회수 비용이 크거나, 법적 삭제 요청의 대상이면 최소한 confidential 이상으로 분류합니다. restricted 필드는 "DB 권한이 있으면 볼 수 있다"는 기본값을 버려야 합니다.

### 2) Envelope Encryption은 KEK와 DEK를 분리한다

모든 row를 KMS로 직접 암호화하면 느리고 비쌉니다. 일반적인 구조는 Envelope Encryption입니다.

```text
KMS key(KEK)
  -> data encryption key(DEK)를 암호화
DEK
  -> 실제 email, phone, token 같은 필드 값을 암호화
```

KEK는 KMS, Cloud KMS, Vault transit engine 같은 관리형 키 저장소에 둡니다. DEK는 데이터 묶음별로 생성하고, 평문 DEK로 필드를 암호화한 뒤, DEK 자체는 KEK로 감싸서 저장합니다. 애플리케이션은 복호화가 필요할 때만 KMS에 encrypted DEK를 풀어 달라고 요청하고, 짧은 시간 메모리에만 둡니다.

암호문 저장 구조는 아래처럼 명시해야 합니다.

```json
{
  "alg": "AES-256-GCM",
  "key_version": "pii-user-v4",
  "dek_ref": "kms:encrypted-dek:...",
  "nonce": "base64...",
  "ciphertext": "base64...",
  "tag": "base64..."
}
```

`alg`와 `key_version`이 없으면 나중에 알고리즘 교체와 키 회전이 막힙니다. `nonce`를 재사용하면 GCM 계열 암호에서 치명적입니다. authentication tag를 검증하지 않으면 암호문 변조를 놓칩니다. 그래서 이 구조는 "편한 JSON"이 아니라 장기 운영 계약입니다.

권장 시작값:

- 대칭 암호화: AES-256-GCM 또는 XChaCha20-Poly1305
- nonce: 암호화 작업마다 유일, 재사용 0건
- DEK 범위: tenant, 데이터 타입, shard, 또는 일정 기간 단위로 분리
- KMS 호출 캐시: 평문 DEK 메모리 캐시 5~30분 이하
- KMS 장애 fallback: 복호화가 필요한 write는 fail-closed, read-only 화면은 마스킹 응답 검토

### 3) 검색 가능한 암호화는 별도 문제다

필드를 암호화하면 `WHERE email = ?`, `ORDER BY phone`, `LIKE '%abc%'` 같은 쿼리는 그대로 쓸 수 없습니다. 그래서 팀은 종종 암호화를 미루거나, 검색 편의를 위해 평문 컬럼을 하나 더 남깁니다. 그 순간 보호 효과가 크게 줄어듭니다.

동등 검색이 필요하면 blind index를 씁니다. 예를 들어 이메일 원문을 정규화한 뒤 서버 비밀 pepper를 섞어 HMAC을 계산하고, 그 해시를 별도 컬럼에 저장합니다.

```text
email_ciphertext = encrypt("rose@example.com")
email_bidx = hmac_sha256(search_pepper_v3, lower(trim(email)))
```

이렇게 하면 같은 이메일을 찾을 수 있지만 원문은 노출하지 않습니다. 단, blind index도 완전한 보호는 아닙니다. 값의 후보군이 작으면 사전 공격 위험이 있습니다. 전화번호, 주민번호, 국가 코드처럼 범위가 좁은 값은 pepper를 강하게 보호하고, 접근 로그와 rate limit을 붙여야 합니다.

판단 기준:

| 요구사항 | 권장 방식 |
| --- | --- |
| 정확히 같은 이메일 찾기 | 정규화 + HMAC blind index |
| 부분 검색 | 별도 검색 서비스에 마스킹 토큰, 또는 기능 재설계 |
| 정렬 | 암호화 필드 기준 정렬 피하기, 생성일/상태 등 대체 키 사용 |
| 중복 검증 | blind index unique constraint |
| 분석 집계 | 원문 대신 비식별 key, cohort, count로 전환 |

부분 검색을 위해 원문을 인덱스에 밀어 넣으면 암호화가 무의미해집니다. 검색 UX가 필요하더라도 "고객센터가 마지막 4자리로 찾는다", "관리자는 정확한 이메일만 검색한다"처럼 업무 요구를 줄이는 쪽이 먼저입니다.

### 4) 키 버전은 데이터 모델의 일부다

키 회전은 새 key를 만들고 끝나는 일이 아닙니다. 이미 저장된 암호문은 과거 key_version으로 암호화되어 있습니다. 따라서 데이터는 자기 key_version을 알아야 하고, 애플리케이션은 여러 버전을 읽을 수 있어야 합니다.

권장 상태:

```text
ENABLED -> ENCRYPT_ONLY -> DECRYPT_ONLY -> DISABLED -> DESTROY_SCHEDULED
```

- `ENABLED`: 신규 암호화와 복호화 모두 가능
- `ENCRYPT_ONLY`: 신규 write에만 사용
- `DECRYPT_ONLY`: 기존 데이터 읽기만 허용, 신규 write 금지
- `DISABLED`: 일반 경로 사용 금지, 긴급 승인 필요
- `DESTROY_SCHEDULED`: 보존 기간 종료 후 물리 폐기 예정

일반 회전은 30~90일 단위로 잡고, 유출 의심이면 15분 안에 해당 key_version을 신규 write 금지로 내려야 합니다. 전체 re-encryption은 한 번에 하지 않습니다. 읽을 때 새 버전으로 다시 쓰는 lazy rotation과, 낮은 우선순위 backfill rotation을 병행합니다. backfill 중 온라인 API p95가 10% 이상 악화되거나 KMS error rate가 0.5%를 넘으면 자동 pause하는 식의 중단 조건도 필요합니다.

이 기준은 [Scheduler Misfire와 Backfill Control](/learning/deep-dive/deep-dive-scheduler-misfire-backfill-control-playbook/)과 비슷합니다. 키 회전도 production workload입니다. 보안 작업이라는 이유로 온라인 트래픽과 KMS quota를 무제한으로 써도 되는 것은 아닙니다.

### 5) 복호화 권한은 API 권한보다 좁아야 한다

사용자가 고객 목록을 볼 수 있다고 해서 모든 PII 원문을 볼 필요는 없습니다. 대부분의 화면은 마스킹 값이면 충분합니다.

```text
email: r***@example.com
phone: 010-****-1234
account: ****-****-8812
```

복호화는 별도 capability로 둡니다. 고객지원, 정산, 보안 사고 대응처럼 원문이 필요한 경로만 사유, ticket, operator id, 만료 시간을 요구합니다. 원문 조회가 발생하면 감사 로그에 남기고, 대량 조회는 기본 차단합니다.

실무 기준:

- 기본 API 응답은 마스킹 값
- 원문 복호화는 고위험 capability로 분리
- 원문 조회 1건마다 reason code와 actor 기록
- 1분 20건 이상 원문 조회 또는 평시 대비 5배 증가는 보안 알림
- 운영자 bulk export는 기본 금지, 필요 시 승인과 암호화 파일로 제한

이 부분은 [Object-Level Authorization](/learning/deep-dive/deep-dive-object-level-authorization-bola-playbook/)과 연결됩니다. "해당 고객에 접근할 수 있는가"와 "해당 고객의 원문 PII를 볼 수 있는가"는 다른 질문입니다.

## 실무 적용

### 1) 4단계 도입 순서

1단계는 데이터 분류입니다. 테이블과 이벤트 payload에서 민감 필드를 뽑고 public, internal, confidential, restricted로 나눕니다. restricted 필드는 원문 저장 위치, 검색 필요 여부, 보존 기간, 삭제 요청 대상 여부를 같이 적습니다.

2단계는 신규 write 경로입니다. 새로 들어오는 데이터부터 암호화합니다. 기존 데이터 re-encryption보다 신규 유입 차단이 먼저입니다. 이때 API 응답, 로그, 이벤트, 검색 인덱스에 원문이 새지 않는지 테스트를 붙입니다.

3단계는 read path와 마스킹입니다. 서비스 계층에서 원문 복호화와 마스킹 응답을 분리합니다. 기본 화면은 마스킹, 원문 조회는 별도 permission과 감사 로그를 통과하게 만듭니다.

4단계는 기존 데이터 회전입니다. 낮은 우선순위 backfill worker로 과거 평문 또는 구버전 암호문을 새 구조로 옮깁니다. 완료 검증은 count, null ratio, decrypt failure, sample hash 비교를 같이 봅니다.

### 2) 의사결정 기준(숫자·조건·우선순위)

우선순위는 **유출 피해 큰 필드 > 신규 write 차단 > 원문 노출 경로 제거 > 기존 데이터 회전 > 검색 UX 개선**입니다.

초기 수치 기준:

| 항목 | 기준 |
| --- | --- |
| restricted 필드 신규 평문 저장 | 0건 |
| 복호화 실패율 | 0.01% 초과 시 배포 중단 후보 |
| KMS p95 latency | 100ms 초과 10분 지속 시 캐시/쿼터 점검 |
| KMS error rate | 0.5% 초과 5분 지속 시 fail-closed 또는 마스킹 fallback |
| key rotation 주기 | 일반 90일, high-risk 30일 |
| 원문 조회 감사 누락 | 0건 |
| blind index mismatch | 0.01% 초과 시 backfill pause |

모든 필드를 한 번에 암호화하려 하지 마세요. 계좌번호, 주민번호, access token, OAuth credential처럼 피해가 큰 필드부터 시작합니다. 이메일과 전화번호는 로그인·검색·고객지원 UX와 강하게 엮여 있으므로 blind index, 마스킹, 관리자 도구까지 같이 설계합니다.

### 3) 테스트와 운영 대시보드

테스트는 암호화 성공만 보면 부족합니다.

- 같은 원문이라도 nonce가 달라 ciphertext가 달라지는가
- 같은 원문에서 blind index는 안정적으로 같은 값이 나오는가
- key_version이 DECRYPT_ONLY일 때 신규 write가 막히는가
- 로그, trace, 에러 리포트에 원문이 남지 않는가
- KMS 장애 때 restricted write가 fail-closed 되는가
- 권한 없는 운영자가 원문 복호화 API를 호출하면 차단되는가

대시보드는 아래 항목으로 시작합니다.

- key_version별 암호화 row 수
- decrypt failure rate
- KMS latency와 error rate
- 원문 조회 횟수와 reason code 분포
- blind index collision 또는 mismatch
- rotation backlog age
- 평문 필드 감지 스캐너 결과

이 값들이 없으면 암호화는 코드에는 있지만 운영에는 없습니다.

## 트레이드오프/주의점

첫째, 필드 암호화는 성능 비용이 있습니다. KMS 호출, 암복호화 CPU, 암호문 크기 증가, 인덱스 제약이 모두 비용입니다. 그래서 모든 컬럼을 암호화하는 방식보다 데이터 등급 기반 접근이 현실적입니다.

둘째, 검색과 정렬 UX가 바뀝니다. 암호화 필드는 일반 B-tree 인덱스로 부분 검색하기 어렵습니다. 고객센터 요구를 그대로 받아 "이름 중간 글자로 검색"을 만들기보다 정확 검색, 마지막 4자리, ticket 기반 조회처럼 업무 흐름을 바꾸는 편이 안전할 때가 많습니다.

셋째, 키를 잃으면 데이터도 잃습니다. KEK를 폐기하면 해당 DEK를 더 이상 풀 수 없습니다. 그래서 destroy는 보존 정책, 법적 의무, 백업 상태, 샘플 복구 검증을 통과한 뒤 진행해야 합니다. 삭제 요청 처리와 암호학적 삭제를 연결하려면 [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)의 purge 기준을 함께 봐야 합니다.

넷째, 개발 환경 편의를 이유로 암호화를 끄면 테스트가 거짓이 됩니다. 로컬에서는 dummy KMS나 test key를 쓰더라도 암호화 흐름 자체는 유지해야 합니다. 그래야 serialization, key_version, blind index, 마스킹 테스트가 운영과 같은 경로를 탑니다.

다섯째, 암호화는 접근 통제를 대체하지 않습니다. 원문 복호화 capability가 아무 API에서나 호출 가능하면 암호화는 우회됩니다. 권한, 감사 로그, rate limit, alert가 같이 있어야 보호 장치가 됩니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 민감 필드 등급표가 있고 restricted 필드는 owner와 보존 기간이 있다.
- [ ] 암호문 저장 구조에 `alg`, `key_version`, `nonce`, `ciphertext`, `tag`가 포함된다.
- [ ] 원문 조회와 마스킹 조회가 API 권한에서 분리되어 있다.
- [ ] 동등 검색은 평문 컬럼이 아니라 pepper가 들어간 blind index로 처리한다.
- [ ] 키 상태 전이와 dual-read, lazy rotation, backfill rotation 절차가 문서화되어 있다.
- [ ] 로그, trace, 검색 인덱스, 분석 이벤트에 원문 PII가 나가지 않는 테스트가 있다.
- [ ] KMS 장애와 키 유출 의심 시 fail-closed, disable, rotation 기준이 숫자로 정해져 있다.

### 연습

1. 현재 사용자 테이블에서 이메일, 전화번호, 주소, 실명, provider token을 골라 등급, 검색 필요 여부, 보존 기간, 암호화 방식을 표로 정리해 보세요.
2. 이메일 정확 검색을 blind index로 바꾸는 migration plan을 작성하세요. 신규 write, 기존 backfill, mismatch 검증, rollback 조건을 포함합니다.
3. "PII key v3 유출 의심" 상황을 가정하고 15분 내 신규 write 차단, 24시간 내 영향 범위 산정, 7일 내 rotation 완료 계획을 런북으로 만들어 보세요.
4. 고객지원 화면에서 원문 전화번호 조회가 필요한 케이스와 마스킹으로 충분한 케이스를 나누고, reason code와 감사 로그 필드를 설계해 보세요.

Envelope Encryption의 핵심은 데이터를 암호문으로 바꾸는 것이 아니라, 민감 데이터 접근을 운영 가능한 계약으로 바꾸는 것입니다. 좋은 설계는 "DB가 털려도 괜찮다" 같은 과장된 약속을 하지 않습니다. 대신 어떤 필드가 어디에서 평문이 될 수 있는지, 그 순간 누가 왜 봤는지, 키를 언제 어떻게 바꿀 수 있는지까지 설명합니다. 그 설명 가능성이 백엔드 보안의 실제 품질입니다.

## 관련 글

- [비밀 관리: Vault/Secrets Manager와 Spring 연동](/learning/deep-dive/deep-dive-secret-management/)
- [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)
- [API Key Lifecycle 발급·회전·폐기](/learning/deep-dive/deep-dive-api-key-lifecycle-rotation-revocation-playbook/)
- [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)
- [Object-Level Authorization BOLA 플레이북](/learning/deep-dive/deep-dive-object-level-authorization-bola-playbook/)
