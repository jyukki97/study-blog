---
title: "백엔드 커리큘럼 심화: DB 자격증명 회전과 커넥션 풀 무중단 전환 플레이북"
date: 2026-08-16
draft: false
topic: "Backend Security & Operations"
tags: ["Database Credential Rotation", "Secret Rotation", "Connection Pool", "HikariCP", "Zero Downtime", "Backend Security"]
categories: ["Backend Deep Dive"]
description: "DB 비밀번호·토큰을 교체할 때 애플리케이션 커넥션 풀을 끊지 않고 전환하는 방법과, 이중 자격증명·롤백·검증 기준을 숫자 중심으로 정리합니다."
module: "backend-security"
study_order: 1191
---

DB 자격증명 회전은 보안 문서에서 흔히 ‘90일마다 비밀번호를 바꾼다’는 한 줄로 끝납니다. 그러나 실제 장애는 회전 정책이 아니라 **기존 커넥션과 새 커넥션이 한동안 함께 존재한다는 사실**을 무시할 때 생깁니다. 비밀번호를 바꾼 직후 새 연결은 인증에 실패하고, 풀에 남은 연결은 잠시 정상처럼 보입니다. 이후 커넥션이 교체되는 순간 로그인 실패, 재시도 폭증, DB 부하 증가가 한 번에 터질 수 있습니다.

따라서 DB 자격증명 회전은 secret 저장소의 값 변경이 아니라, 애플리케이션·커넥션 풀·DB 계정·배포 절차가 함께 지키는 **전환 계약**으로 다뤄야 합니다. 이 글에서는 [Secret 관리](/learning/deep-dive/deep-dive-secret-management/), [커넥션 풀 사이징과 포화 해석](/learning/deep-dive/deep-dive-connection-pool-sizing-saturation-playbook/), [설정 변경 안전 롤아웃](/learning/deep-dive/deep-dive-config-change-safety-rollout-playbook/), [배포 런북](/learning/deep-dive/deep-dive-deployment-runbook/)과 연결해 무중단 회전의 기준을 정리합니다.

## 이 글에서 얻는 것

- DB 비밀번호, 단기 토큰, IAM 기반 임시 자격증명을 각각 어떤 회전 방식으로 다뤄야 하는지 구분할 수 있습니다.
- ‘새 secret을 배포했다’와 ‘모든 신규 DB 연결이 새 자격증명으로 검증됐다’를 분리해서 확인할 수 있습니다.
- 이중 자격증명, 풀의 점진적 폐기, canary, 롤백 창을 포함한 안전한 전환 순서를 만들 수 있습니다.
- 인증 실패율, pool acquire latency, 오래된 연결 비율을 이용해 회전 실패를 기능 장애로 번지기 전에 감지할 수 있습니다.

## 핵심 개념/이슈

### 1) 회전의 대상은 문자열 하나가 아니라 연결 생명주기다

애플리케이션 프로세스는 시작할 때 환경 변수나 secret volume에서 DB 비밀번호를 읽고, 그 값으로 커넥션 풀을 만듭니다. 이후 풀은 수십 분 또는 수 시간 동안 물리 연결을 재사용할 수 있습니다. 이때 secret 저장소의 값을 바꿔도 이미 열린 연결은 자동으로 새 비밀번호를 사용하지 않습니다. 더 위험한 경우는 애플리케이션이 secret 변경을 감지해도, 기존 풀을 즉시 닫아 대량 재접속을 만드는 경우입니다.

회전 시에는 최소 세 상태를 구분해야 합니다.

| 상태 | 의미 | 운영 판단 |
| --- | --- | --- |
| 기존 연결 | 이전 자격증명으로 이미 인증된 물리 연결 | 즉시 차단하지 말고 유예 기간 안에 점진적으로 폐기 |
| 신규 연결 | 새 secret으로 인증을 시도하는 연결 | canary에서 성공률과 권한을 먼저 검증 |
| 재시도 연결 | 인증 실패 뒤 다시 연결되는 흐름 | 무제한 재시도를 막고 원인을 드러내야 함 |

핵심은 ‘DB가 새 비밀번호를 받아들인다’가 아니라, **새 연결이 새 자격증명으로 성공하고 오래된 연결은 안전하게 자연 소멸한다**는 것을 증명하는 일입니다. 커넥션 풀의 `maxLifetime`, `idleTimeout`, validation query, 재접속 backoff가 회전 설계에 들어가야 하는 이유입니다.

### 2) 정적 비밀번호·이중 계정·단기 토큰은 같은 방식으로 바꾸면 안 된다

가장 단순한 방식은 하나의 DB 사용자 비밀번호를 교체하는 것입니다. 하지만 이전 비밀번호가 곧바로 무효가 되면 재기동되지 않은 프로세스가 새 연결을 만들지 못합니다. 그래서 가용성이 중요한 서비스는 한 사용자 비밀번호를 즉시 덮어쓰기보다 **동일 권한의 두 계정 또는 두 credential version을 겹치는 기간에 운영**하는 편이 안전합니다.

예를 들어 `app_rw_a`와 `app_rw_b`에 같은 최소 권한을 주고, 현재 활성 계정을 config에 둡니다. 회전은 `a → b → a` 순서로 반복합니다. `b`의 새 secret을 먼저 배포하고, 새 연결이 `b`로 성공하는 것을 확인한 뒤 `a`의 연결을 드레인합니다. DB가 IAM 인증이나 짧은 TTL 토큰을 제공한다면 방식이 달라집니다. 이 경우 장기 비밀번호보다 토큰 갱신 실패와 프로세스의 credential provider 캐시가 더 큰 위험이 됩니다.

실무 선택 기준은 아래처럼 단순화할 수 있습니다.

- **소규모 내부 서비스, 짧은 점검 창 허용**: 단일 계정 회전도 가능하지만, 점검 창과 재기동 계획을 명시합니다.
- **고객 경로·24시간 서비스**: 이중 계정 또는 DB가 지원하는 겹침 가능한 credential version을 우선합니다.
- **클라우드 관리형 DB와 workload identity 사용 가능**: 단기 토큰을 우선 검토하되, 토큰 갱신 실패와 최대 세션 수를 별도 관측합니다.
- **사람·배치·서비스가 같은 계정을 공유**: 먼저 계정을 분리합니다. 공유 계정 상태에서는 안전한 회전도 감사도 어렵습니다.

여기서 우선순위는 **최소 권한과 서비스 분리 > 회전 빈도 > 자동화 편의성**입니다. 회전 주기를 짧게 잡아도 모든 서비스가 같은 고권한 계정을 쓰면 사고 반경은 줄지 않습니다.

### 3) `maxLifetime`은 회전 유예 시간보다 짧아야 한다

이중 credential을 준비해도 기존 연결이 너무 오래 남으면 이전 credential을 끄지 못합니다. 반대로 모든 연결을 한꺼번에 끊으면 connection storm이 발생합니다. 두 위험 사이를 조정하는 값이 커넥션 풀의 최대 수명입니다.

권장 출발점은 다음과 같습니다.

- 이전 credential 폐기 전 유예 시간: **30~60분**부터 시작
- 풀의 `maxLifetime`: 유예 시간보다 **5~10분 이상 짧게** 설정
- `maxLifetime` jitter: 인스턴스별·연결별로 **5~10%** 분산
- 단일 인스턴스의 동시 새 연결: DB 안정 active session의 **10~20% 이내**로 제한
- 인증 오류율: 정상 상태 **0%**가 기준이며, canary에서 0.1%라도 지속되면 확대 중단

예를 들어 이전 계정을 45분 뒤 폐기한다면 풀의 최대 수명을 30~35분 근처에서 시작할 수 있습니다. 다만 모든 연결이 정확히 30분에 만료되면 또 다른 피크가 되므로 만료 시점을 분산해야 합니다. 이 수치는 절대 정답이 아닙니다. DB의 세션 제한, 인스턴스 수, 평시 연결 생성률, 장애 허용 시간을 보고 조정해야 합니다.

### 4) secret reload는 ‘값 반영’과 ‘새 연결 검증’의 두 단계다

Spring Boot, Kubernetes, sidecar, secret agent는 각자 다른 방식으로 secret 변경을 전달합니다. 환경 변수는 대체로 프로세스 재시작 전까지 바뀌지 않고, 파일 volume은 바뀌어도 DataSource가 자동으로 새 비밀번호를 읽는다고 보장할 수 없습니다. 따라서 ‘secret 파일 mtime이 바뀌었다’는 성공 지표가 될 수 없습니다.

안전한 reload는 다음 두 단계를 분리합니다.

1. 새 secret version을 애플리케이션이 읽고, 형식·만료 시각·대상 DB를 검증한다.
2. 새 DataSource 또는 새 physical connection으로 `SELECT 1`과 최소 권한 쿼리를 실행하고, 성공한 뒤에만 기존 풀을 드레인한다.

두 번째 단계가 빠지면 잘못된 secret, 잘못된 endpoint, 권한이 빠진 계정도 배포 성공처럼 보입니다. 검증 쿼리는 단순 ping만으로 끝내지 말고, 해당 서비스가 실제로 필요한 schema와 읽기/쓰기 권한을 대표하는 **부작용 없는 최소 쿼리**로 잡는 편이 낫습니다. 예를 들어 쓰기 권한이 필요한 서비스라면 실제 테이블을 변경하지 않는 transaction rollback 테스트나 권한 조회를 준비할 수 있습니다.

### 5) 회전 중 인증 실패는 재시도보다 격리가 먼저다

자격증명이 잘못된 상태에서 애플리케이션이 요청마다 즉시 재접속하면 DB 인증 로그와 connection attempt가 급격히 늘어납니다. 이는 단순 인증 오류가 커넥션 포화와 API 장애로 번지는 전형적인 경로입니다. [Timeout·Retry·Backoff](/learning/deep-dive/deep-dive-timeout-retry-backoff/)의 원칙처럼, 인증 실패는 일시 네트워크 오류와 다르게 취급해야 합니다.

다음 규칙이 유용합니다.

- `password authentication failed`, 권한 거부 같은 **결정적 인증 실패는 즉시 재시도하지 않고** secret version·배포 상태를 확인합니다.
- 연결 거부·일시 네트워크 오류만 bounded exponential backoff로 최대 **2~3회** 재시도합니다.
- 1분 동안 인증 실패가 **5건 이상** 또는 신규 연결 실패율이 **0.5% 이상**이면 canary 확대를 멈추고 롤백 판단으로 올립니다.
- 활성 요청의 DB 의존도가 높다면, 새 연결 실패 때 무한 대기하지 말고 빨리 실패·degraded response·큐 적재 중 하나로 닫습니다.

이 기준은 비밀번호 회전 실패를 숨기지 않고, 작은 canary에서 드러나게 만드는 장치입니다.

## 실무 적용

### 1) 권장 전환 순서: 준비 → 검증 → 드레인 → 폐기

무중단 회전은 아래 순서를 기본값으로 두는 편이 안전합니다.

1. **인벤토리**: DB 사용자, 권한, 사용하는 서비스·배치·운영 도구, 현재 secret version을 목록화합니다.
2. **새 credential 준비**: 비활성 계정 또는 새 version을 만들고, 기존 계정과 권한 diff가 없는지 확인합니다.
3. **canary 배포**: 전체의 5% 또는 단일 인스턴스에 새 credential을 주입합니다.
4. **신규 연결 검증**: 새 physical connection 성공률, 대표 권한 쿼리, `pool_acquire_p95`, DB 인증 오류를 10~15분 관찰합니다.
5. **점진 확대**: 25% → 50% → 100%로 확대하되 각 단계에서 신규 연결 성공률 99.9% 이상, 인증 오류 0건을 확인합니다.
6. **기존 풀 드레인**: `maxLifetime`과 idle eviction으로 이전 연결을 분산 폐기합니다. 강제 close는 마지막 수단입니다.
7. **이전 credential 폐기**: 모든 워크로드가 새 version을 사용하고, 이전 연결 수가 0임을 확인한 뒤 유예 시간을 끝냅니다.
8. **감사 기록**: 누가, 어떤 버전으로, 언제 회전했는지와 검증 결과·롤백 여부를 남깁니다.

이 순서에서 가장 자주 생략되는 단계는 4번입니다. 하지만 이 검증이 없으면 5번의 대규모 배포가 실험이 됩니다. 운영 서비스라면 전환 자체보다 ‘언제 멈출지’가 더 먼저 정해져 있어야 합니다.

### 2) Spring/HikariCP에서 점검할 값

프레임워크에 따라 구현은 다르지만, Java/Spring에서 HikariCP를 쓴다면 아래 항목의 관계를 확인합니다.

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 16
      minimum-idle: 2
      max-lifetime: 1800000      # 30분: credential 유예 시간보다 짧게
      idle-timeout: 600000       # 10분
      connection-timeout: 200    # 전체 API deadline보다 훨씬 짧게
      validation-timeout: 1000
```

설정 자체보다 중요한 질문은 세 가지입니다.

- secret이 바뀐 뒤 DataSource가 새 password로 **새 physical connection**을 만들 수 있는가?
- `maxLifetime` 만료가 여러 인스턴스에 몰리지 않도록 분산돼 있는가?
- `connection-timeout`이 상위 API deadline을 침범하거나 재시도를 증폭하지 않는가?

특히 `minimum-idle`이 높은 풀은 idle 연결이 오래 남을 수 있습니다. 회전 직후 새 credential이 정상이어도, 트래픽이 낮은 서비스는 이전 연결이 생각보다 오래 남습니다. 이런 서비스는 의도적인 health-triggered refresh나 점진적 soft eviction이 필요한지 검토해야 합니다. 단, 모든 인스턴스에서 동시에 soft eviction을 실행하면 connection storm가 될 수 있으므로 rollout controller로 분산해야 합니다.

### 3) 대시보드와 중단 기준

회전용 대시보드는 적어도 아래 항목을 같은 시간축에 둡니다.

- secret version을 읽은 인스턴스 수와 새 credential 적용 비율
- DB 로그인 성공/실패 수와 SQLSTATE 또는 오류 코드
- 새 physical connection 생성률, pool active/idle/pending
- `pool_acquire_p95/p99`, API error rate, API latency p95
- 이전 credential을 쓰는 연결 추정치 또는 계정별 active session
- DB CPU, active session, connection limit 사용률

중단 기준도 숫자로 둡니다.

| 신호 | 조치 |
| --- | --- |
| 새 연결 인증 실패 1건이 5분 내 반복 | 다음 rollout 단계 중지, secret·권한·endpoint 확인 |
| pool acquire p95가 기준선의 2배를 5분 유지 | 드레인 속도 낮추고 인스턴스별 refresh 분산 |
| DB connection limit 80% 초과 | 강제 refresh 중단, 풀 상한과 인스턴스 수 재계산 |
| API 5xx가 기준선보다 0.5%p 이상 상승 | 새 credential 배포 롤백 또는 canary 격리 |

‘회전은 보안 작업이니 성능 지표와 별개’라는 생각은 위험합니다. 회전 실패는 새 연결의 장애이고, 새 연결은 결국 요청 경로에 들어옵니다.

### 4) 롤백은 이전 비밀번호 복원이 아니라 접근 경로 복원이다

이중 계정 방식에서는 롤백이 비교적 단순합니다. 새 계정을 끄는 대신, canary가 이전 계정으로 다시 새 연결을 만들게 하면 됩니다. 반면 단일 계정의 비밀번호를 덮어쓴 경우 이전 비밀번호를 복원하는 과정 자체가 또 하나의 회전입니다. 그래서 고가용성 서비스에서 단일 계정 회전이 불리합니다.

롤백 계획에는 다음을 넣습니다.

- 이전 credential의 유효 기간과 폐기 예정 시각
- 새 secret version을 사용한 인스턴스 목록
- 기존 pool을 유지할지, 새 pool을 이전 credential으로 만들지의 기준
- 이전 credential으로도 새 physical connection을 만들 수 있다는 canary 검증
- 사고 중 비밀값을 로그·슬랙·티켓 본문에 노출하지 않는 절차

복구가 필요한 순간에 비밀번호를 복사해 붙여 넣는 방식은 피해야 합니다. secret manager의 version pointer나 배포 변수처럼 감사 가능한 경로를 통해 되돌려야 합니다.

## 트레이드오프/주의점

첫째, 이중 계정은 운영 객체를 하나 더 만듭니다. 권한 drift가 생기면 회전보다 권한 차이 때문에 장애가 날 수 있습니다. 그래서 계정 A/B의 grant를 주기적으로 diff하고, 권한 변경은 둘에 같이 적용해야 합니다.

둘째, 짧은 `maxLifetime`은 이전 연결을 빨리 없애지만 연결 생성 비용과 DB 인증 부하를 높입니다. 긴 수명은 안정적으로 보이지만 credential 폐기 창이 길어집니다. 값 하나로 해결하지 말고, 트래픽·DB 한도·유예 시간을 함께 맞춰야 합니다.

셋째, 단기 토큰은 비밀번호를 없애지만 갱신 경로를 새로운 단일 장애점으로 만들 수 있습니다. IAM API 지연, metadata endpoint 장애, 노드 시간 오차까지 관측 범위에 넣어야 합니다.

넷째, 운영자 계정과 애플리케이션 계정을 섞으면 회전의 반경이 커집니다. 애플리케이션 런타임 계정은 최소 권한으로 분리하고, DDL·백업·조사 계정은 별도의 강한 통제 아래 둡니다.

다섯째, 로그에 JDBC URL, username, secret version을 남기는 것과 password를 남기는 것은 다릅니다. 조사에 필요한 식별 정보는 남기되, 비밀 원문·토큰·connection string의 민감 파라미터는 redaction 규칙으로 차단해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 서비스·배치·운영 도구별 DB 계정과 권한이 분리돼 있다.
- [ ] 고가용성 경로는 단일 비밀번호 덮어쓰기 대신 겹침 가능한 credential 전환을 사용한다.
- [ ] 이전 credential 유예 시간보다 pool `maxLifetime`이 짧고 만료가 분산된다.
- [ ] secret reload 뒤 새 physical connection과 최소 권한 쿼리를 검증한다.
- [ ] 인증 실패는 무제한 재시도하지 않으며, canary 중단 기준이 수치로 있다.
- [ ] 계정별 active session, pool acquire latency, DB connection limit을 한 대시보드에서 본다.
- [ ] 이전 credential을 폐기하기 전 모든 워크로드의 새 credential 전환을 확인한다.

### 연습 과제

1. 현재 서비스 하나의 DB 계정에 연결된 애플리케이션·배치·운영 도구를 모두 적어 보세요. 공유 계정이 보이면 먼저 분리 우선순위를 정합니다.
2. ‘유예 45분, 인스턴스 6대, 풀 최대 16’이라는 조건에서 `maxLifetime`, refresh 분산, DB connection limit의 관계를 계산해 보세요. 동시에 새 연결이 생길 수 있는 최악의 수를 적는 것이 목표입니다.
3. staging에서 잘못된 새 secret을 canary 한 대에만 주입했다고 가정하고, 어떤 오류 코드·대시보드·중단 기준으로 5분 안에 확대를 막을지 런북을 작성해 보세요.

## 함께 보면 좋은 글

- [Secret 관리](/learning/deep-dive/deep-dive-secret-management/)
- [커넥션 풀 사이징과 포화 해석](/learning/deep-dive/deep-dive-connection-pool-sizing-saturation-playbook/)
- [설정 변경 안전 롤아웃](/learning/deep-dive/deep-dive-config-change-safety-rollout-playbook/)
- [Timeout·Retry·Backoff 설계](/learning/deep-dive/deep-dive-timeout-retry-backoff/)
- [배포 런북](/learning/deep-dive/deep-dive-deployment-runbook/)
