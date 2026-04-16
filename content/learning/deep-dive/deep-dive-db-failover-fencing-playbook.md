---
title: "백엔드 커리큘럼 심화: DB 장애조치(Failover) 운영 플레이북 — RTO/RPO, Fencing, Connection Draining"
date: 2026-04-02
draft: false
topic: "Database Reliability"
tags: ["Failover", "RTO", "RPO", "Fencing", "Connection Draining", "Replication Lag"]
categories: ["Backend Deep Dive"]
description: "DB 장애조치를 사람이 감으로 처리하지 않도록, 트리거 조건·우선순위·롤백 기준을 숫자로 정의하는 실무형 플레이북입니다."
module: "database-reliability"
study_order: 1120
---

DB 장애는 "서버 하나가 죽었다"로 끝나지 않습니다. 더 위험한 시나리오는 **애매하게 살아 있는 상태**입니다. 리더가 일부 노드에서만 보이고, 복제 지연이 급격히 늘고, 애플리케이션은 오래된 커넥션을 붙잡은 채로 재시도를 폭증시킵니다. 이 상황에서 Failover를 너무 빨리 하면 데이터 손실 위험이 커지고, 너무 늦게 하면 서비스 중단 시간이 길어집니다.

실무에서 필요한 건 영웅적인 판단이 아니라 **반복 가능한 의사결정 규칙**입니다. 어떤 신호가 들어오면 누가, 몇 분 안에, 어떤 순서로 리더 승격·트래픽 전환·연결 드레이닝을 실행할지 사전에 정해야 합니다. 이 글은 그 기준을 RTO/RPO와 Fencing 중심으로 정리합니다.

## 이 글에서 얻는 것

- DB Failover를 "장애 나면 승격" 수준이 아니라 **트리거-검증-실행-복구** 단계로 설계하는 기준을 얻을 수 있습니다.
- RTO/RPO를 선언만 하지 않고, 실제 자동화/운영에 연결하는 **숫자 기반 판단 조건**을 정리할 수 있습니다.
- Split-brain, stale read, 좀비 커넥션 같은 대표적인 실패 패턴을 줄이는 **우선순위 운영 절차**를 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) Failover의 본질은 "빠른 승격"이 아니라 "안전한 단절"이다

많은 팀이 Failover 성숙도를 승격 시간으로만 평가합니다. 하지만 실제 사고의 비용은 보통 여기서 발생합니다.

1. 기존 리더가 완전히 격리되지 않은 상태에서 새 리더 승격
2. 두 리더가 각각 쓰기를 받는 split-brain 발생
3. 나중에 정합성 복구에 수시간~수일 소요

그래서 Failover의 1순위는 승격이 아니라 **Fencing(기존 리더 쓰기 권한 강제 차단)**입니다. 네트워크 ACL, 스토리지 fence, 오케스트레이터 레벨의 write-deny 중 최소 하나는 즉시 발동되어야 합니다. 이 기본 관점은 [백업/DR 전략](/learning/deep-dive/deep-dive-backup-dr-strategy/)과 같이 봐야 제대로 잡힙니다.

### 2) RTO/RPO는 문서가 아니라 런타임 임계치여야 한다

- **RTO(복구 시간 목표)**: 장애 인지부터 쓰기 재개까지 허용 시간
- **RPO(복구 시점 목표)**: 허용 가능한 데이터 손실량

예를 들어 주문/결제 계열 서비스라면 보수적으로 다음처럼 시작합니다.

- Tier 1 서비스: `RTO <= 5분`, `RPO <= 5초`
- Tier 2 서비스: `RTO <= 15분`, `RPO <= 60초`

중요한 건 수치를 선언하는 게 아니라, Failover 트리거와 연결하는 겁니다. 예를 들어 `replication_lag > RPO` 상태에서 강제 승격하면, 그 순간 RPO 위반을 인정하는 의사결정이 됩니다. 따라서 트리거는 단일 지표가 아니라 다중 조건으로 잡아야 합니다.

- 30초 이상 리더 healthcheck 실패
- 쓰기 실패율 20% 이상(5분 창)
- 복제 지연 증가 추세(예: 10초→40초 급등)
- 애플리케이션 타임아웃률 3% 초과

복제와 읽기 분리 기반 운영은 [DB Replication과 Read/Write Splitting](/learning/deep-dive/deep-dive-db-replication-read-write-splitting/)을 먼저 정리해 두는 편이 안전합니다.

### 3) Fencing이 없으면 자동 Failover는 위험한 가속기다

자동화 자체는 답이 아닙니다. 아래 보호 장치가 빠져 있으면 자동 Failover는 사고를 빠르게 키웁니다.

- 기존 리더에 대한 쓰기 차단 확인(성공 여부 이벤트)
- 새 리더 승격 전 WAL/GTID 적용 범위 검증
- 애플리케이션 레벨 write endpoint 강제 재라우팅
- 실패 시 즉시 "수동 승인 모드" 전환

실무에선 보통 **3단계 가드레일**을 둡니다.

1. Auto(저위험): read-only 또는 비핵심 워크로드
2. Assisted(중위험): 자동 탐지 + 사람 승인 후 승격
3. Manual(고위험): 온콜 리더 승인 필수

핵심은 기술 난이도가 아니라 비즈니스 영향도입니다. 같은 DB라도 어떤 도메인 데이터를 담고 있는지에 따라 정책이 달라져야 합니다.

### 4) Connection Draining을 빼먹으면 복구 후에도 장애가 이어진다

Failover 직후 흔한 오해는 "새 리더가 올라왔으니 끝났다"입니다. 실제로는 오래된 커넥션이 기존 리더/죽은 소켓을 계속 붙잡아 2차 장애를 만듭니다.

운영 기준 예시:

- 앱 커넥션 풀 최대 lifetime: 2~5분
- Failover 이벤트 수신 시 기존 풀 강제 soft-evict
- 재시도는 최대 2회 + 지터 백오프
- 60초 내 풀 재수렴 실패 시 인스턴스 순차 재시작

이 과정은 [Graceful Shutdown](/learning/deep-dive/deep-dive-graceful-shutdown/)과 [Load Balancer Healthcheck](/learning/deep-dive/deep-dive-load-balancer-healthchecks/) 설계와 결합해야 효과가 납니다.

### 5) 장애조치 신뢰도는 "평시 리허설 빈도"에서 갈린다

Failover 절차는 문서가 아니라 근육 기억입니다. 분기 1회로는 부족하고, 최소 월 1회 GameDay를 권장합니다.

권장 리허설 항목:

- 리더 프로세스 다운
- 네트워크 반분리(partition)
- 복제 지연 인위적 증가
- 잘못된 DNS 캐시/서비스 디스커버리 지연

리허설 성공 기준도 수치로 둬야 합니다.

- 탐지 시간(MTTD) 60초 이내
- 의사결정~승격 완료(MTTR DB) 4분 이내
- 데이터 검증 실패율 0.1% 미만

## 실무 적용

### 1) 장애조치 의사결정 매트릭스(숫자·조건·우선순위)

우선순위는 **데이터 보존 > 쓰기 복구 > 읽기 성능** 순서가 기본입니다.

- 즉시 Failover 후보
  - 리더 healthcheck 연속 6회 실패(10초 주기)
  - 쓰기 에러율 30% 이상 2분 지속
  - fencing 성공 확인 가능
- 관찰/보류 조건
  - 리더 응답은 있으나 replication lag 급등만 발생
  - 네트워크 경로 불안정으로 양측 상태 불명확
- 수동 승인 강제 조건
  - RPO 초과가 확실한 승격
  - 멀티리전 동시 이상 징후
  - 최근 24시간 내 스키마 변경 배포가 있었던 경우

이렇게 조건을 나눠야 "모든 장애에 같은 버튼"을 누르는 실수를 줄일 수 있습니다.

### 2) 15분 운영 런북 예시

**0~2분: 탐지/분류**
- 리더 상태, replication lag, 애플리케이션 오류율 동시 확인
- false positive(모니터링 오류) 여부 1차 배제

**2~5분: fencing + 승격 결정**
- 기존 리더 write fence 적용
- 승격 후보 replica의 최신성(LSN/GTID) 확인
- 자동/수동 모드 결정

**5~9분: 트래픽 전환**
- DB endpoint 갱신(Proxy, VIP, Service discovery)
- 앱 커넥션 드레이닝 및 풀 재연결 유도
- 핵심 API synthetic check 실행

**9~15분: 검증/안정화**
- write 성공률, p95/p99, replication catch-up 모니터링
- 읽기 지연/오류가 안정권 들어오면 incident 단계 하향
- 사후 분석용 타임라인 자동 기록

### 3) 관측 지표와 알람 규칙

Failover 품질을 보려면 지표를 최소 3층으로 구성해야 합니다.

1. **DB 계층**: replication lag, commit latency, leader heartbeat
2. **앱 계층**: connection pool active/idle, timeout rate, retry rate
3. **사용자 계층**: 핵심 트랜잭션 성공률, p99 latency

알람은 "장애 감지"와 "복구 완료"를 분리합니다.

- 감지 알람: 리더 비정상 + 쓰기 실패율 급등
- 복구 완료 알람: 3분 연속 성공률 기준 충족

임계치 설계는 [Observability 알람 설계](/learning/deep-dive/deep-dive-observability-alarms/)를 참고해 서비스 등급별로 다르게 가져가는 게 안전합니다.

### 4) 우선 적용할 자동화 3가지

1. **Failover Dry-run 파이프라인**: 실제 승격 없이 검증 단계만 주기 실행
2. **Connection Pool 강제 재순환 훅**: Failover 이벤트를 앱에 브로드캐스트
3. **RPO 위반 사전 경고**: replication lag가 임계치 70%를 넘으면 조기 경보

처음부터 완전 자동화로 가지 말고, Assisted 모드에서 기준을 다듬는 편이 사고 비용이 낮습니다.

## 트레이드오프/주의점

1) **RPO를 보수적으로 잡을수록 Failover는 느려질 수 있다**  
데이터 손실을 거의 허용하지 않으면 승격 후보 최신성 검증 시간이 늘어납니다.

2) **자동화 비율을 높일수록 예외 상황 설명 가능성이 중요해진다**  
"왜 승격했는가"를 1분 내 설명하지 못하면 운영 신뢰가 급격히 떨어집니다.

3) **연결 드레이닝을 공격적으로 하면 순간 트래픽 손실이 생길 수 있다**  
반대로 드레이닝을 느슨하게 하면 stale connection이 오래 남습니다. 서비스 특성에 맞는 균형값이 필요합니다.

4) **단일 리전 기준으로 튜닝한 규칙을 멀티리전에 그대로 복제하면 오작동한다**  
리전 간 RTT와 복제 지연 분포가 다르므로 임계치를 분리해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 서비스 등급별 RTO/RPO가 숫자로 정의되어 있고 Failover 트리거와 연결돼 있다.
- [ ] 승격 전에 fencing 성공을 검증하는 절차가 자동화돼 있다.
- [ ] Failover 이벤트 시 앱 커넥션 풀 재순환(드레이닝) 동작이 검증돼 있다.
- [ ] 월 1회 이상 GameDay로 MTTD/MTTR/RPO 위반 여부를 측정한다.
- [ ] 장애 종료 후 24시간 내 타임라인·원인·개선 항목이 문서화된다.

### 연습 과제

1. 현재 운영 중인 서비스 1개를 선택해 `RTO`, `RPO`, `Failover trigger`를 한 표로 정리해 보세요.  
2. 리더 다운/네트워크 파티션 두 시나리오를 구분해, 어느 경우에 수동 승인으로 전환할지 조건을 정의해 보세요.  
3. Failover 이벤트 이후 애플리케이션 커넥션 풀이 정상화되는 데 걸린 시간을 계측해, 목표값(예: 90초 이내)을 세워보세요.

## 관련 글

- [백업/DR 전략 설계](/learning/deep-dive/deep-dive-backup-dr-strategy/)
- [DB Replication과 Read/Write Splitting](/learning/deep-dive/deep-dive-db-replication-read-write-splitting/)
- [Graceful Shutdown 실전 가이드](/learning/deep-dive/deep-dive-graceful-shutdown/)
- [Load Balancer Healthcheck 설계](/learning/deep-dive/deep-dive-load-balancer-healthchecks/)
- [Observability 알람 임계치 설계](/learning/deep-dive/deep-dive-observability-alarms/)
- [트래픽 컷오버 마이그레이션 전략](/learning/deep-dive/deep-dive-traffic-cutover-migration/)
