---
title: "백엔드 커리큘럼 심화: Tamper-Evident Audit Log, 조작 방지 감사 로그를 운영 증거로 만드는 법"
date: 2026-05-12
draft: false
topic: "Audit Log"
tags: ["Audit Log", "Tamper Evidence", "Security", "Compliance", "Observability", "Backend Architecture"]
categories: ["Backend Deep Dive"]
description: "관리자 액션, 권한 변경, 결제·정산 이벤트를 나중에 설명 가능한 증거로 남기기 위해 append-only 로그, 해시 체인, 보존 정책, 조회 권한을 실무 기준으로 정리합니다."
module: "backend-security-phase"
study_order: 1220
---

감사 로그(audit log)는 애플리케이션 로그를 조금 더 오래 보관하는 기능이 아닙니다. 장애 분석을 위한 로그가 "무슨 일이 있었나"를 빠르게 찾는 도구라면, 감사 로그는 나중에 "누가, 언제, 어떤 권한으로, 무엇을 바꿨고, 그 기록을 믿을 수 있는가"를 설명하는 운영 증거입니다. 특히 관리자 권한 변경, 결제 취소, 정산 값 수정, 개인정보 조회, 고객 데이터 export 같은 액션은 성공 여부만 남기면 부족합니다. 왜 허용됐는지, 어떤 값이 바뀌었는지, 변경 당시 정책 버전이 무엇이었는지까지 추적 가능해야 합니다.

문제는 감사 로그도 결국 데이터라는 점입니다. 같은 데이터베이스에 같은 권한으로 저장해 두면 운영자가 실수로 수정할 수 있고, 침해자가 애플리케이션 권한을 얻었을 때 흔적을 지울 수도 있습니다. 그래서 실무에서는 단순 audit table을 넘어 append-only 저장, 해시 체인, 별도 보존소, 조회 권한 분리, 삭제 불가능한 보관 정책을 함께 설계합니다. 이 글은 [구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/), [권한 판정 캐시](/learning/deep-dive/deep-dive-authorization-decision-cache-invalidation-playbook/), [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/), [Execution Receipt 운영](/learning/deep-dive/deep-dive-execution-receipt-operations-playbook/)과 연결해서 감사 로그를 운영 증거로 만드는 기준을 정리합니다.

## 이 글에서 얻는 것

- 일반 애플리케이션 로그, 보안 로그, 감사 로그를 어떤 기준으로 분리할지 이해할 수 있습니다.
- append-only audit event, 해시 체인, 외부 anchor를 이용해 조작 탐지 가능성을 높이는 방법을 잡을 수 있습니다.
- 고위험 액션에서 감사 로그 실패를 fail-closed로 볼지, 비동기 재시도로 볼지 숫자와 조건으로 판단할 수 있습니다.

## 핵심 개념/이슈

### 1) 감사 로그는 검색 편의보다 증거성을 먼저 둔다

일반 로그는 운영자가 빠르게 grep하고 집계하기 좋게 설계합니다. 반면 감사 로그는 시간이 지나도 의미가 바뀌지 않아야 합니다. 예를 들어 "관리자가 사용자 권한을 변경했다"라는 이벤트를 남긴다면 최소한 아래 정보가 필요합니다.

```text
event_id: aud_20260512_000001
occurred_at: 2026-05-12T01:08:31Z
actor_type: admin_user
actor_id: adm_123
tenant_id: tenant_a
action: user.role.update
target_type: user
target_id: usr_456
result: success
request_id: req_789
source_ip_hash: sha256:...
policy_version: authz-policy-2026-05-12.1
before_digest: sha256:...
after_digest: sha256:...
reason_code: support_ticket_approved
prev_hash: sha256:...
event_hash: sha256:...
```

여기서 핵심은 "변경 전/후 전체 값을 다 저장하자"가 아닙니다. 개인정보와 민감값을 그대로 저장하면 감사 로그가 또 다른 유출 표면이 됩니다. 실무에서는 원문 대신 digest, 내부 ID, reason code, ticket id, policy version을 남기고, 원문이 필요한 항목은 별도 암호화 저장소와 더 엄격한 접근 통제를 둡니다. [시크릿 관리](/learning/deep-dive/deep-dive-secret-management/)와 마찬가지로 감사 로그에도 최소 노출 원칙이 필요합니다.

### 2) append-only만으로는 충분하지 않다

`INSERT`만 허용하는 audit table을 만들면 append-only처럼 보입니다. 하지만 DB 관리자 권한이 있으면 과거 row를 업데이트하거나 삭제할 수 있습니다. 애플리케이션 버그가 잘못된 migration을 실행해도 기록이 바뀔 수 있습니다. 그래서 조작 방지 감사 로그는 보통 세 겹으로 설계합니다.

1. **쓰기 경로 제한**: 애플리케이션은 insert 전용 계정으로만 감사 이벤트를 쓴다.
2. **조작 탐지**: 이벤트마다 `prev_hash + canonical_event_payload`로 `event_hash`를 만들고 stream별 hash chain을 유지한다.
3. **외부 보관/anchor**: 일정 간격으로 마지막 hash를 별도 계정의 object storage, WORM bucket, KMS-signed record, 또는 외부 감사 시스템에 저장한다.

해시 체인은 누군가 중간 이벤트를 바꾸면 뒤 이벤트의 hash가 깨지도록 만듭니다. 외부 anchor는 침해자가 주 DB와 감사 DB를 동시에 조작하더라도, 과거 어느 시점 이후 기록이 바뀌었는지 찾는 기준점이 됩니다. 엄밀히 말하면 이것은 "조작 불가능"이 아니라 **조작 탐지 가능**입니다. 실무에서 더 현실적인 목표도 바로 이것입니다.

운영 기준은 아래처럼 시작할 수 있습니다.

| 위험도 | 예시 | 권장 감사 로그 정책 |
| --- | --- | --- |
| 최상 | 권한 부여/회수, 결제 취소, 개인정보 export | 비즈니스 트랜잭션과 같은 경계에서 기록, 실패 시 fail-closed |
| 높음 | 관리자 설정 변경, API key 발급, feature flag 변경 | outbox same transaction + 1분 이내 영구 저장 |
| 중간 | 일반 사용자 프로필 변경, 알림 설정 변경 | 비동기 기록 허용, 단 유실률 0에 가깝게 재시도 |
| 낮음 | 읽기 이벤트 중 민감도 낮은 화면 조회 | 샘플링 또는 별도 access log 가능 |

### 3) 감사 로그 실패는 기능 실패와 연결된다

많은 서비스가 audit write를 "부가 기능"으로 취급합니다. 비즈니스 업데이트는 성공했는데 감사 로그 저장이 실패하면 그냥 에러 로그만 남기고 넘어갑니다. 저위험 기능에서는 그럴 수 있지만, 고위험 액션에서는 위험합니다. 권한 변경은 성공했는데 감사 증거가 없다면, 나중에 사고가 났을 때 복구와 책임 추적이 불가능합니다.

판단 기준은 액션의 되돌리기 비용과 규제/계약 리스크입니다.

- **fail-closed**: 권한 변경, 결제/정산 수정, 고객 데이터 export, 관리자 impersonation 시작/종료
- **same transaction outbox**: 주문 상태 변경, 보안 설정 변경, API token 생성/폐기
- **async retry 허용**: 일반 설정 변경, 알림 구독, low-risk profile update
- **샘플링 가능**: 대량 읽기 로그 중 제품 분석 목적 이벤트

숫자로는 high-risk 감사 로그의 영구 저장 지연 p95를 **5초 이하**, p99를 **30초 이하**로 잡는 것이 출발점입니다. inline write가 p95 **50ms**를 넘게 밀리면 사용자 지연에 영향을 줄 수 있으므로 outbox 전환을 검토합니다. 단, outbox도 비즈니스 변경과 같은 DB transaction에 들어가야 "변경은 됐는데 감사 이벤트 생성 자체가 빠지는" 문제를 줄일 수 있습니다.

### 4) 조회 권한도 쓰기 권한만큼 중요하다

감사 로그는 민감합니다. "누가 어떤 고객 데이터를 조회했는지" 자체가 개인정보와 내부 운영 정보를 포함합니다. 그래서 감사 로그 저장소를 만들었다고 해서 모든 개발자와 운영자에게 자유 조회 권한을 주면 안 됩니다.

기본 원칙은 다음입니다.

- 서비스 계정은 audit event insert만 가능하고 update/delete 권한은 없다.
- 일반 운영자는 자기 담당 tenant 또는 ticket 범위의 마스킹된 로그만 본다.
- 원문 payload 복호화는 break-glass 절차와 이중 승인으로 제한한다.
- 감사 로그 조회 자체도 별도 감사 로그로 남긴다.
- 대량 export는 기본 차단하고, 필요 시 만료 링크와 watermark를 둔다.

감사 로그는 사고 조사 때 가장 먼저 열어보는 데이터입니다. 따라서 조회 체계가 느슨하면 침해자가 가장 먼저 지우거나 훔칠 대상도 감사 로그가 됩니다.

## 실무 적용

### 1) 이벤트 스키마를 먼저 고정한다

처음부터 완벽한 감사 플랫폼을 만들 필요는 없습니다. 하지만 이벤트 스키마는 초기에 고정하는 편이 좋습니다. 최소 필드는 아래 정도입니다.

```text
event_id, occurred_at, received_at, actor_type, actor_id,
tenant_id, action, target_type, target_id, result,
request_id, correlation_id, policy_version, reason_code,
before_digest, after_digest, source_context, prev_hash, event_hash
```

`occurred_at`은 애플리케이션에서 액션이 발생한 시간이고, `received_at`은 감사 저장소가 받은 시간입니다. 둘을 분리해야 큐 지연, clock skew, 재처리를 판단할 수 있습니다. [시계 skew와 시간 의미](/learning/deep-dive/deep-dive-clock-skew-time-semantics-playbook/)를 고려하면 서버 시간이 서로 다를 수 있으므로, 고위험 이벤트는 중앙 수신 시각을 함께 남기는 편이 안전합니다.

`source_context`에는 user agent, IP, device id 같은 값을 넣고 싶어지지만, 원문 저장은 신중해야 합니다. IP는 hash 또는 prefix 마스킹, user agent는 필요한 경우에만 보존하고, 민감 header나 token은 절대 저장하지 않습니다.

### 2) 같은 트랜잭션 outbox로 유실을 줄인다

가장 흔한 구조는 비즈니스 DB에 `audit_outbox`를 두고, 변경 트랜잭션 안에서 outbox row를 같이 insert한 뒤, 별도 worker가 감사 저장소로 전달하는 방식입니다.

```text
1. API 요청 수신
2. 권한 판정 및 비즈니스 변경
3. 같은 DB transaction 안에서 audit_outbox insert
4. commit
5. worker가 audit_outbox를 읽어 audit store에 append
6. audit store가 hash chain과 anchor 갱신
```

이 방식의 장점은 비즈니스 변경과 감사 이벤트 생성이 같이 성공하거나 같이 실패한다는 점입니다. 단점은 최종 audit store 반영이 약간 늦을 수 있다는 점입니다. 그래서 고위험 액션은 outbox 적재 성공을 commit 조건으로 삼고, audit store 반영 지연이 p99 **30초**를 넘으면 알람을 울립니다. 반대로 모든 이벤트를 API 요청 경로에서 원격 audit store에 직접 쓰면 지연과 장애 전파가 커질 수 있습니다.

운영 지표는 아래를 기본으로 봅니다.

| 지표 | 시작 목표 |
| --- | --- |
| `audit_outbox_lag_seconds` | p95 5초 이하, p99 30초 이하 |
| `audit_append_error_total` | high-risk 0건 목표 |
| `audit_hash_chain_verification_failed_total` | 0건, 발생 시 Sev 분류 |
| `audit_anchor_delay_seconds` | high-risk stream 5분 이하 |
| `audit_export_total` | owner/ticket 없이 0건 |

### 3) stream 단위를 잘 나눈다

해시 체인을 하나의 전역 stream으로 만들면 순서가 단순하지만 병목이 생깁니다. 모든 이벤트가 하나의 마지막 hash를 갱신해야 하기 때문입니다. 반대로 stream을 너무 잘게 쪼개면 검증이 복잡해집니다.

현실적인 기준은 tenant, action risk tier, region 정도입니다.

- B2B SaaS: `tenant_id + region` 단위 stream
- 금융/정산: `ledger_account` 또는 `settlement_batch` 단위 stream
- 관리자 액션: `tenant_id + admin_action` stream
- 대규모 읽기 access log: 별도 access stream, hash anchor 간격 완화

처음에는 tenant별 stream으로 시작하고, 초당 이벤트가 **500~1,000건**을 넘거나 hash 갱신이 병목이 되면 shard를 나누는 편이 좋습니다. stream을 나눌 때도 anchor record에는 stream id, sequence range, start/end hash, event count를 넣어 나중에 검증 범위를 좁힐 수 있게 합니다.

### 4) 보존 정책과 삭제 정책을 분리한다

감사 로그는 오래 보관해야 하지만, 무조건 영구 보관이 정답은 아닙니다. 개인정보 최소화와 삭제권 요구가 있는 도메인에서는 원문 payload를 오래 들고 있는 것이 오히려 리스크입니다. 그래서 보존 정책은 계층화합니다.

- hot index: 최근 **30~90일**, 빠른 조회와 incident response용
- warm storage: **1년 내외**, 압축·마스킹 후 검색 가능
- cold/WORM storage: 계약·규제 기준에 따라 **3~7년**, 원문 최소화
- cryptographic erasure: 삭제 대상 원문은 key 파기 또는 별도 payload 삭제, event shell은 보존

핵심은 audit event의 존재와 순서는 유지하되, 개인정보 원문은 보존 기간과 접근 권한을 더 좁게 가져가는 것입니다. 이 지점은 [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)와 함께 설계해야 합니다.

## 트레이드오프/주의점

첫째, 감사 로그를 너무 많이 남기면 보안이 좋아지는 것이 아니라 노이즈가 늘어납니다. 모든 조회를 원문 payload와 함께 기록하면 비용과 개인정보 리스크가 커지고, 정작 중요한 권한 변경이나 export 이벤트가 묻힙니다. 우선순위는 **고위험 쓰기 > 민감 데이터 export > 권한/정책 변경 > break-glass 조회 > 일반 읽기**입니다.

둘째, 해시 체인은 조작을 막지 않습니다. 조작을 들키게 만드는 장치입니다. 따라서 hash verification job, anchor 보관, 실패 알람이 없으면 `event_hash` 필드는 장식이 됩니다. 최소 하루 1회 전체 또는 구간 검증을 돌리고, high-risk stream은 5~15분 단위 incremental 검증을 권장합니다.

셋째, 감사 로그 저장소가 서비스 가용성을 과하게 떨어뜨릴 수 있습니다. 모든 이벤트를 동기 원격 쓰기로 처리하면 audit store 장애가 곧 전체 장애가 됩니다. 그래서 fail-closed 범위를 명확히 좁히고, 나머지는 same transaction outbox + 재시도 + 지연 알람으로 처리하는 것이 현실적입니다.

넷째, 운영자 조회 UX를 무시하면 결국 우회가 생깁니다. 사고 조사자는 빠르게 timeline을 보고 싶어 합니다. 마스킹된 기본 조회, ticket 기반 temporary access, request_id/correlation_id 검색, tenant 단위 필터를 제공해야 합니다. 권한이 너무 빡빡해서 매번 DB 접근을 요청하게 만들면, 감사 시스템 바깥의 비공식 조회가 늘어납니다.

의사결정 기준은 **증거성 > 유실 방지 > 최소 노출 > 조회 가능성 > 비용** 순서로 두는 것이 안전합니다. 감사 로그는 예쁘게 많이 쌓는 데이터가 아니라, 가장 나쁜 날에 팀을 방어해 줄 증거입니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 감사 로그와 일반 애플리케이션 로그의 목적, 저장소, 접근 권한이 분리되어 있다.
- [ ] high-risk 액션 목록과 fail-closed 대상이 문서화되어 있다.
- [ ] 비즈니스 변경과 audit outbox insert가 같은 transaction으로 묶인다.
- [ ] audit event에는 actor, action, target, tenant, result, request_id, policy_version, reason_code가 포함된다.
- [ ] 원문 개인정보 대신 digest, 내부 ID, 마스킹 값을 우선 저장한다.
- [ ] event hash, prev hash, stream id, sequence가 있어 조작 탐지가 가능하다.
- [ ] hash anchor가 별도 계정/저장소에 주기적으로 보관된다.
- [ ] 감사 로그 조회와 export 자체도 다시 감사 로그로 남는다.
- [ ] outbox lag, append error, hash verification failure에 알람이 있다.
- [ ] 보존 기간과 cryptographic erasure 기준이 데이터 유형별로 정해져 있다.

### 연습

1. 현재 서비스에서 "나중에 설명하지 못하면 위험한 액션" 10개를 뽑고, fail-closed / outbox / async / sample 중 하나로 분류해 보세요. 10개 중 권한 변경, 데이터 export, 결제 취소가 빠지면 다시 점검해야 합니다.  
2. 관리자 권한 변경 이벤트 하나를 예로 들어 audit event JSON을 설계해 보세요. 원문 before/after를 저장하지 않고도 나중에 변경 사실을 검증할 수 있는 digest와 reason code를 넣는 것이 목표입니다.  
3. tenant별 hash chain을 만든다고 가정하고, 중간 이벤트 하나가 삭제됐을 때 어떤 검증 job이 몇 분 안에 감지해야 하는지 SLO를 정해 보세요.

## 관련 글

- [구조화 로깅: 검색 가능한 운영 로그 설계](/learning/deep-dive/deep-dive-structured-logging/)
- [권한 판정 캐시와 권한 무효화 플레이북](/learning/deep-dive/deep-dive-authorization-decision-cache-invalidation-playbook/)
- [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)
- [Execution Receipt 운영 플레이북](/learning/deep-dive/deep-dive-execution-receipt-operations-playbook/)
- [시크릿 관리 실무](/learning/deep-dive/deep-dive-secret-management/)
