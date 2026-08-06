---
title: "백엔드 커리큘럼 심화: Restore Drill과 PITR, 백업을 실제 복구 능력으로 검증하는 법"
date: 2026-08-06T10:06:00+09:00
lastmod: 2026-08-06T11:30:00+09:00
draft: false
topic: "Ops"
tags: ["Backup", "PITR", "Restore Drill", "Disaster Recovery", "PostgreSQL", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "백업 파일 보관을 넘어 PITR, 복구 드릴, 데이터 무결성 검증, RTO/RPO 측정을 운영 루틴으로 만드는 실무 플레이북입니다."
module: "ops-observability"
study_order: 1481
summary: "백업은 성공 로그가 아니라 복구 가능한 상태로 검증되어야 합니다. Restore Drill과 PITR 기준을 잡고, 실제 복구 시간과 데이터 손실 범위를 숫자로 관리하는 방법을 정리합니다."
keywords: ["restore drill", "PITR", "backup recovery", "RTO RPO", "PostgreSQL backup", "disaster recovery"]
key_takeaways:
  - "백업 성공률과 복구 성공률은 다른 지표다. 운영 기준은 restore time, data loss window, checksum, application smoke까지 봐야 한다."
  - "PITR은 백업 옵션이 아니라 사고 시점과 정합성 기준을 고르는 운영 절차다."
  - "Tier-0/Tier-1 데이터는 최소 분기 1회 실제 restore drill, 월 1회 샘플 PITR 검증을 운영 루틴으로 둔다."
  - "복구 검증은 DB 접속 성공이 아니라 핵심 쿼리, 외부 의존성, secret/config, 애플리케이션 smoke까지 통과해야 닫힌다."
operator_checklist:
  - "서비스별 RPO/RTO, 백업 위치, PITR 가능 범위, restore owner를 inventory한다."
  - "복구 드릴마다 실제 RTO, 데이터 손실 범위, 누락 설정, 수동 단계 수, 실패 원인을 기록한다."
  - "복구 환경은 production과 네트워크·시크릿·외부 webhook을 분리하고, 복구 후 정리 절차를 자동화한다."
learning_refs:
  - title: "백업·DR 전략"
    href: "/learning/deep-dive/deep-dive-backup-dr-strategy/"
    description: "RPO/RTO와 백업 방식의 기본 개념입니다."
  - title: "DB Major Version Upgrade"
    href: "/learning/deep-dive/deep-dive-db-major-version-upgrade-zero-downtime-playbook/"
    description: "복구 가능성을 DB 업그레이드와 함께 검증하는 운영 기준입니다."
  - title: "트래픽 컷오버 마이그레이션"
    href: "/learning/deep-dive/deep-dive-traffic-cutover-migration/"
    description: "복구 후 트래픽 전환과 검증 기준을 연결합니다."
  - title: "데이터베이스 마이그레이션"
    href: "/learning/deep-dive/deep-dive-database-migration/"
    description: "스키마 변경 이력과 복구 시점 선택의 기본입니다."
decision_guide:
  title: "복구 방식 선택 기준"
  intro: "장애가 났을 때는 백업이 있다는 사실보다 어떤 복구 방식을 선택할지 빠르게 좁히는 기준이 더 중요합니다."
  cases:
    - badge: "PITR"
      title: "오염 시작 시각이 비교적 명확하다"
      fit: "잘못된 배치, 실수 DELETE, 위험한 migration처럼 특정 시점 이후 데이터가 넓게 오염된 경우"
      watchouts: "정상 사용자 쓰기도 함께 잃을 수 있고, 외부 시스템에 이미 전파된 부작용은 되돌리지 못한다."
      next_step: "오염 시작·종료 시각, 정상 쓰기 손실 범위, 외부 전파 여부를 먼저 incident ledger에 고정한다."
    - badge: "Correction"
      title: "영향 row나 tenant를 식별할 수 있다"
      fit: "오염 범위가 좁고 보정 SQL/job을 검증할 수 있으며 전체 서비스 롤백 비용이 큰 경우"
      watchouts: "보정 job이 2차 오염을 만들 수 있으므로 dry-run, sample 검증, 승인자가 필요하다."
      next_step: "영향 row 목록, before/after checksum, 재실행 가능성, rollback query를 같은 PR 또는 runbook에 둔다."
    - badge: "DR restore"
      title: "원본 저장소나 리전 자체를 신뢰할 수 없다"
      fit: "storage corruption, region outage, primary DB 접근 불가처럼 원본을 살리는 시간이 RTO를 넘는 경우"
      watchouts: "DNS, secret, queue offset, external write path까지 전환해야 해서 DB restore만으로는 끝나지 않는다."
      next_step: "read-only 전환 가능성, 트래픽 컷오버 조건, 복구 환경 smoke test를 동시에 시작한다."
faqs:
  - question: "백업 모니터링이 성공이면 restore drill을 생략해도 되나요?"
    answer: "생략하면 안 됩니다. 백업 성공은 파일이나 snapshot이 만들어졌다는 신호이고, restore drill은 그 산출물로 애플리케이션까지 살릴 수 있는지 확인하는 별도 검증입니다."
  - question: "PITR과 보정 job 중 무엇을 먼저 검토해야 하나요?"
    answer: "오염 범위가 좁고 영향 row를 식별할 수 있으면 보정 job을 먼저 검토하고, 범위가 넓거나 시작 시각만 명확하면 PITR을 검토하는 편이 안전합니다."
  - question: "복구 드릴에서 가장 자주 빠지는 검증은 무엇인가요?"
    answer: "DB 접속 성공 이후의 업무 검증이 자주 빠집니다. migration history, sequence, 핵심 테이블 checksum, 외부 발송 차단, 애플리케이션 smoke까지 확인해야 합니다."
---

백업은 "매일 새벽 S3에 파일이 올라간다"로 끝나지 않습니다. 장애가 났을 때 정해진 시간 안에, 허용 가능한 데이터 손실 범위 안에서, 애플리케이션이 다시 읽고 쓸 수 있는 상태로 돌아와야 백업입니다. 운영에서 자주 생기는 함정은 백업 성공 로그를 복구 능력으로 착각하는 것입니다. 덤프 파일은 쌓이는데 복구 스크립트는 오래됐고, WAL은 보관되지만 어느 시점으로 되돌려야 하는지 기준이 없고, 복구한 DB는 뜨지만 시크릿과 외부 연동이 맞지 않아 서비스는 올라오지 않는 식입니다.

이 글은 [백업·DR 전략](/learning/deep-dive/deep-dive-backup-dr-strategy/)의 다음 단계입니다. 기본 개념을 "백업 방식"에서 "복구 드릴"로 옮깁니다. 함께 보면 좋은 글은 [DB Major Version Upgrade](/learning/deep-dive/deep-dive-db-major-version-upgrade-zero-downtime-playbook/), [트래픽 컷오버 마이그레이션](/learning/deep-dive/deep-dive-traffic-cutover-migration/), [데이터베이스 마이그레이션](/learning/deep-dive/deep-dive-database-migration/), [서비스 의존성 Inventory](/learning/deep-dive/deep-dive-service-dependency-inventory-ownership-playbook/)입니다. 핵심 질문은 하나입니다. **지금 백업으로 실제로 어디까지, 얼마나 빨리, 얼마나 정확하게 돌아갈 수 있는가**입니다.

## 이 글에서 얻는 것

- 백업 성공률, 복구 성공률, RPO, RTO를 서로 다른 운영 지표로 분리할 수 있습니다.
- PITR(Point-in-Time Recovery)을 "언제든 되돌릴 수 있다"가 아니라 사고 시점과 정합성 기준을 고르는 절차로 설계할 수 있습니다.
- restore drill을 샘플 확인이 아니라 데이터 무결성, 설정, 애플리케이션 smoke, 트래픽 전환 가능성까지 검증하는 루틴으로 만들 수 있습니다.
- 운영 DB, 분석 DB, object storage, secret, schema migration 이력을 함께 복구 대상으로 inventory하는 기준을 얻습니다.

## 핵심 개념/이슈

### 1) 백업 성공과 복구 성공은 다른 지표다

백업 성공은 정해진 위치에 백업 산출물이 만들어졌다는 뜻입니다. 복구 성공은 그 산출물로 서비스를 다시 운영 가능한 상태로 만들었다는 뜻입니다. 둘 사이에는 큰 간극이 있습니다.

| 구분 | 확인하는 것 | 실패 예시 |
| --- | --- | --- |
| backup success | 덤프/스냅샷/WAL 업로드 완료 | 파일은 있지만 암호화 키가 없어 읽지 못함 |
| restore success | 새 환경에 DB 복원 완료 | DB는 떴지만 migration 이력 불일치 |
| recovery success | 앱 smoke와 핵심 업무 검증 완료 | 로그인, 결제 조회, 배치가 실패 |
| business recovery | 사용자 영향이 허용 범위 안에 있음 | RTO 30분 목표인데 3시간 걸림 |

실무에서는 백업 성공률 99.9%보다 최근 restore drill 성공 시각이 더 중요할 때가 많습니다. 6개월 동안 실제 복구를 한 번도 안 했다면 백업이 있어도 위험합니다. 스토리지 정책, 권한, 압축 형식, DB 버전, 확장 모듈, 시크릿 위치, 네트워크 정책은 조용히 변하기 때문입니다.

운영 기준은 숫자로 잡습니다.

- Tier-0 데이터: RPO 5분 이하, RTO 30~60분 목표, 분기 1회 전체 복구 드릴
- Tier-1 데이터: RPO 15분 이하, RTO 2~4시간 목표, 반기 1회 전체 복구 드릴
- Tier-2 데이터: RPO 24시간 이하, RTO 1영업일 목표, 연 1회 샘플 복구
- 실제 드릴 RTO가 목표의 1.2배를 넘으면 개선 티켓 생성
- 복구 검증 중 데이터 mismatch는 0건을 목표로 하고, 설명 가능한 차이는 별도 ledger로 남김

### 2) PITR은 "되돌리기 버튼"이 아니라 사고 시점 선택 절차다

PITR은 특정 시각 또는 특정 WAL 위치까지 데이터베이스를 복구하는 방식입니다. 랜섬웨어, 잘못된 배치, 실수로 실행한 `DELETE`, 잘못된 migration처럼 "최신 상태가 오히려 오염된 상태"일 때 필요합니다.

문제는 복구 시각을 고르는 일이 생각보다 어렵다는 점입니다. 예를 들어 10:03에 잘못된 배치가 시작됐고, 10:07에 모니터링이 울렸고, 10:12에 운영자가 배치를 중단했다고 합시다. 10:02:59로 돌리면 오염은 피하지만 정상 사용자 쓰기 9분도 잃습니다. 10:05로 돌리면 정상 쓰기는 일부 살리지만 오염 데이터가 섞일 수 있습니다. 그래서 PITR runbook에는 "몇 시로 되돌릴지"를 정하는 증거가 있어야 합니다.

복구 시점 선택에 필요한 입력:

- 사고를 만든 배포, 배치, 운영 명령의 시작 시각과 종료 시각
- 오염된 테이블, tenant, 계정, row 범위
- 정상 사용자 쓰기의 손실 허용 범위
- 보정 job으로 살릴 수 있는 데이터와 복구로만 살릴 수 있는 데이터
- 외부 시스템에 이미 전파된 부작용 여부

작은 실수는 전체 DB PITR보다 보정 job이 안전할 수 있습니다. 반대로 어떤 row가 오염됐는지 모르면 PITR이 더 빠를 수 있습니다. 기준은 **오염 범위 식별 시간 + 보정 시간**과 **PITR RTO + 정상 쓰기 손실 비용**을 비교하는 것입니다.

### 3) Restore Drill은 DB 접속 확인으로 끝나면 안 된다

복구 드릴의 가장 낮은 수준은 덤프 파일을 풀어 DB가 뜨는지 보는 것입니다. 필요하지만 충분하지 않습니다. 서비스가 실제로 복구됐는지는 애플리케이션 관점에서 봐야 합니다.

최소 검증 단계는 아래와 같습니다.

1. 백업 산출물 무결성 확인: 파일 크기, checksum, 암호화 키 접근, WAL 연속성
2. 격리 환경 복원: production 쓰기 경로와 분리된 네트워크에서 restore
3. schema/version 확인: migration history, extension, collation, timezone, DB parameter 대조
4. 데이터 샘플 검증: row count, 핵심 테이블 checksum, 최근 N건 업무 레코드 비교
5. 애플리케이션 smoke: 로그인, 주요 조회, 배치 dry-run, read-only API 확인
6. 운영 검증: 알람, 대시보드, audit log, backup job 재등록 여부 확인

특히 PostgreSQL은 DB 자체가 뜬다고 끝이 아닙니다. extension 버전, collation 차이, logical replication slot, sequence 값, role/permission, `search_path`, timezone 설정이 달라지면 애플리케이션에서만 문제가 보일 수 있습니다. 복구 환경에서 `SELECT 1`만 통과한 상태를 성공으로 기록하면 실전에서 다시 막힙니다.

### 4) 복구 환경은 production과 의도적으로 분리해야 한다

복구 드릴은 production 데이터를 다루기 때문에 보안 경계가 필요합니다. 잘못하면 복구한 환경이 실제 외부 webhook을 호출하거나, 고객에게 이메일을 보내거나, 검색 인덱스를 덮어쓰거나, production secret을 평문으로 노출할 수 있습니다.

격리 기준:

- 외부 발송 경로는 기본 차단하고, 필요한 경우 sink/mock endpoint로 라우팅
- production write secret은 주입하지 않고 read-only 또는 drill 전용 secret 사용
- 복구 DB는 public network에 노출하지 않음
- 개인정보 접근은 최소 인원, TTL, 감사 로그로 제한
- 복구 완료 후 스토리지, 임시 DB, 로그를 정리하는 절차 포함

복구 드릴은 안전해야 반복할 수 있습니다. 반복이 어려우면 결국 문서만 남고 실제 검증은 사라집니다.

## 실무 적용

### 1) Restore Inventory부터 만든다

복구 계획은 서비스 단위가 아니라 데이터 제품 단위로 잡아야 합니다. 하나의 서비스도 primary DB, Redis snapshot, object storage, search index, message offset, external provider state를 가질 수 있습니다. 모두 같은 방식으로 복구되지 않습니다.

권장 inventory:

| 필드 | 예시 | 이유 |
| --- | --- | --- |
| data_asset | `orders-postgres-primary` | 무엇을 복구하는지 명확히 함 |
| tier | `T0` | RPO/RTO와 드릴 주기 결정 |
| backup_method | snapshot + WAL archive | 복구 방식 선택 |
| backup_location | cross-account S3, region B | 계정/리전 장애 대비 |
| encryption_key | KMS key alias, owner | 키 없으면 백업도 무용지물 |
| restore_owner | payments-platform | 장애 때 책임자 |
| validation_queries | row count, checksum, sample order | 성공 기준 |
| app_smoke | order read, payment status read | 업무 동작 확인 |
| dependencies | secrets, object storage, search index | DB만 복구해서 끝나지 않음 |

처음에는 Tier-0/Tier-1만 해도 됩니다. 주문, 결제, 권한, 감사 로그, 구독 상태처럼 비즈니스 효과가 큰 데이터부터 시작합니다. 로그성 데이터와 분석 이벤트는 보존 정책이 중요하지만, 반드시 같은 RTO를 요구하지는 않습니다.

### 2) 의사결정 기준: PITR, 보정, read-only 전환

장애 때는 "복구할까 말까"를 그 자리에서 토론하면 늦습니다. 미리 기준을 둡니다.

| 상황 | 우선 선택 | 조건 |
| --- | --- | --- |
| 단일 tenant, 오염 row 식별 가능 | 보정 job | 영향 row가 10,000건 이하이고 보정 검증 가능 |
| 전역 배치가 핵심 테이블 오염 | PITR 검토 | 오염 시작 시각이 명확하고 정상 쓰기 손실 비용이 감당 가능 |
| DB는 정상, 앱 배포만 문제 | rollback/cutover | 데이터 오염 없음, [트래픽 컷오버](/learning/deep-dive/deep-dive-traffic-cutover-migration/)로 해결 가능 |
| migration 실패로 schema 불일치 | forward fix 또는 restore | migration 이력이 깨졌고 안전한 repair가 없음 |
| 원본 DB 손상/리전 장애 | DR restore | primary 접근 불가 또는 storage corruption 의심 |

우선순위는 **데이터 오염 확산 중단 > 복구 시점 선택 > 외부 부작용 확인 > 사용자 트래픽 전환** 순서가 안전합니다. 오염이 계속 진행 중이면 먼저 쓰기 중단, 배치 중단, read-only 전환을 검토합니다. 이 판단은 [Graceful Degradation/Brownout](/learning/deep-dive/deep-dive-graceful-degradation-brownout-playbook/)과 연결됩니다.

### 3) Restore Drill Runbook 예시

드릴은 매번 다른 사람이 따라 해도 같은 결과가 나와야 합니다. 아래처럼 단계와 종료 조건을 둡니다.

```text
restore_drill:
  target: orders-postgres-primary
  tier: T0
  rpo_target: 5m
  rto_target: 60m
  drill_window: "monthly sample PITR, quarterly full restore"
  stop_conditions:
    - "backup checksum mismatch"
    - "WAL continuity gap"
    - "missing encryption key"
    - "app smoke failure on critical read path"
  validation:
    - "schema migration head matches production"
    - "orders row count diff <= 0.01% for selected snapshot"
    - "latest 100 paid orders have matching payment status"
    - "sequence values are greater than max(id)"
    - "external notification sink receives no production sends"
```

실제 실행 순서는 이렇게 잡을 수 있습니다.

1. 드릴 시작 시각과 대상 백업 시각을 기록한다.
2. 격리 VPC 또는 임시 namespace를 만든다.
3. snapshot과 WAL archive 접근 권한을 확인한다.
4. DB를 복원하고 recovery target time을 적용한다.
5. migration history, extension, role, sequence를 검증한다.
6. 핵심 테이블 row count와 checksum을 비교한다.
7. 애플리케이션을 read-only profile로 띄운다.
8. smoke test 5~10개를 실행한다.
9. 실제 RTO, 수동 단계 수, 실패/지연 원인을 기록한다.
10. 임시 환경과 민감 로그를 정리한다.

좋은 드릴은 실패를 발견합니다. 실패가 없는 드릴만 반복된다면 너무 얕게 검증하고 있을 가능성이 큽니다.

### 4) 검증 쿼리는 업무 의미를 가져야 한다

복구 후 `count(*)`만 비교하면 부족합니다. 업무 의미가 있는 검증이 필요합니다.

예시:

- 최근 24시간 `CAPTURED` 결제와 주문 상태가 일치하는가
- `orders.total_amount`와 `order_items` 합계 차이가 0인가
- 마지막 백업 시각 이전의 감사 로그 hash chain이 끊기지 않았는가
- `user_role`과 권한 projection의 version이 맞는가
- outbox에서 이미 발행된 이벤트와 미발행 이벤트가 구분되는가
- sequence 값이 현재 max id보다 작은 테이블이 없는가

이런 검증은 [Tamper-Evident Audit Log](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/), [Payment Authorization/Capture 상태 머신](/learning/deep-dive/deep-dive-payment-authorization-capture-state-machine-playbook/)처럼 업무 원장과 직접 연결됩니다. 복구 검증은 인프라 작업이면서 동시에 도메인 정합성 작업입니다.

## 트레이드오프/주의점

첫째, 복구 드릴은 비용이 듭니다. 큰 DB를 복원하면 임시 스토리지, compute, 네트워크 비용이 생깁니다. 하지만 실전에서 첫 복구를 시도하는 비용이 훨씬 큽니다. 전체 복구는 분기 단위, 샘플 PITR은 월 단위처럼 층을 나누면 부담을 줄일 수 있습니다.

둘째, RPO/RTO 목표를 너무 공격적으로 잡으면 운영이 과해집니다. 모든 데이터를 RPO 5분, RTO 30분으로 둘 필요는 없습니다. 주문과 결제는 강하게, 분석 이벤트와 추천 로그는 느슨하게 가져가도 됩니다. 목표는 비즈니스 영향으로 정해야지 기술적으로 가능하다는 이유로 정하면 안 됩니다.

셋째, 복구 환경에 production secret을 그대로 넣으면 드릴이 사고가 될 수 있습니다. 특히 이메일, SMS, 결제 PG, webhook, 검색 인덱스, 데이터 웨어하우스 쓰기 경로는 기본 차단해야 합니다.

넷째, PITR은 외부 부작용을 되돌리지 못합니다. DB를 10:02로 돌려도 10:05에 이미 발송된 이메일, 결제 승인, 외부 CRM 업데이트는 남아 있습니다. 그래서 고위험 도메인은 복구 후 reconciliation과 보상 작업까지 runbook에 넣어야 합니다.

다섯째, 백업 보존만 늘리면 개인정보·컴플라이언스 비용도 늘어납니다. 삭제 요청, 보존 기간, 암호화 키 폐기 정책과 충돌하지 않도록 [데이터 보존·삭제 아키텍처](/learning/deep-dive/deep-dive-data-retention-deletion-architecture/)와 함께 봐야 합니다.

## 체크리스트 또는 연습

- [ ] Tier-0/Tier-1 데이터 자산별 RPO, RTO, 백업 방식, 복구 owner가 적혀 있다.
- [ ] 최근 90일 안에 실제 restore drill을 수행했고, 결과와 실패 원인을 기록했다.
- [ ] PITR target time을 고르는 기준과 사고 시각 수집 방법이 runbook에 있다.
- [ ] 복구 검증에 row count뿐 아니라 업무 checksum, sample query, app smoke가 포함된다.
- [ ] 복구 환경은 production 외부 발송, webhook, 결제, 검색 index write를 기본 차단한다.
- [ ] encryption key, DB role, extension, sequence, migration history를 복구 검증 항목으로 둔다.
- [ ] restore drill 결과가 목표 RTO의 1.2배를 넘으면 follow-up 티켓이 생성된다.

연습 과제:

1. 현재 서비스에서 가장 중요한 DB 하나를 골라 RPO/RTO를 숫자로 적어 보세요. "중요함" 대신 "최대 몇 분 손실, 몇 분 안 복구"로 써야 합니다.
2. 최근 백업 하나를 기준으로 격리 환경에 복원한다고 가정하고, 필요한 secret, role, extension, object storage, app config를 inventory하세요.
3. 핵심 업무 검증 쿼리 5개를 작성해 보세요. 단순 row count보다 "주문-결제 상태 일치", "권한 projection 일치", "sequence 안전성"처럼 복구 후 실제 사고를 막는 쿼리가 좋습니다.
4. 잘못된 배치가 10분 동안 실행된 시나리오를 만들고, PITR과 보정 job 중 어느 쪽이 나은지 판단 기준을 표로 작성해 보세요.

백업은 보험이지만, 복구 드릴은 보험 약관을 실제로 읽고 청구까지 해보는 일에 가깝습니다. 운영팀이 복구를 한 번도 연습하지 않았다면 RPO/RTO는 문서 속 숫자일 뿐입니다. 작게라도 반복해서 측정해야, 장애 당일에 백업이 진짜 복구 능력으로 바뀝니다.
