---
title: "2026 개발 트렌드: OpenTelemetry Entity Events, 관측성은 신호 수집에서 시간축 있는 인프라 사실 그래프로 확장된다"
date: 2026-08-25T10:06:00+09:00
lastmod: 2026-08-25T10:06:00+09:00
draft: false
tags: ["OpenTelemetry", "Entity Events", "Observability", "Service Catalog", "Topology", "Platform Engineering"]
categories: ["Development", "Platform Engineering", "Observability"]
series: "2026 개발 운영 트렌드"
keywords: ["OpenTelemetry entity events", "temporal inventory", "entity graph", "bi-temporal observability", "service topology", "OTLP logs"]
description: "2026년 8월 OpenTelemetry Entity Events 흐름을 바탕으로, 관측성을 메트릭·로그·트레이스 수집에서 시간축 있는 자산·관계 그래프로 확장할 때의 모델, 도입 기준, 데이터 품질 게이트를 정리합니다."
summary: "Entity Events는 서비스·호스트·프로세스·인프라 관계를 현재값 테이블로 덮어쓰지 않고, OTLP 로그 기반의 이벤트 스트림과 시간축 projection으로 다루자는 제안이다. 아직 모델과 속성은 진화 중이므로, 전사 CMDB 대체가 아니라 좁은 장애 도메인의 관측 보강 pilot부터 시작해야 한다."
key_takeaways:
  - "Metrics·logs·traces가 시스템의 행동을 보여 준다면, entity events는 무엇이 존재하고 어떻게 연결됐으며 언제 바뀌었는지를 같은 관측 문맥에 추가한다."
  - "현재 인벤토리를 UPDATE로 덮어쓰지 말고 event time과 recorded time을 함께 보존해야 사후 사실과 당시 인지 상태를 분리할 수 있다."
  - "식별자는 불변 계약으로 두고 IP·상태·버전처럼 바뀌는 값은 descriptive attribute로 분리해야 조용한 entity merge를 피할 수 있다."
  - "Entity Data Model은 아직 안정화 전이다. production control plane의 source of truth로 바로 승격하지 말고, freshness·collision·edge coverage 게이트가 있는 read-only pilot으로 검증해야 한다."
operator_checklist:
  - "최초 pilot은 Tier-0 흐름 하나와 service.instance·database·Kubernetes workload처럼 3개 이하 entity type으로 제한한다."
  - "event_time과 recorded_time을 모두 저장하고, producer clock skew·late arrival·재전송을 정상 데이터로 다룬다."
  - "identity schema, 관계 type, PII 금지 attribute, 삭제/retention 정책을 producer contract로 문서화한다."
  - "entity freshness p95, identity collision rate, unresolved relationship rate, trace/resource join coverage를 매주 수치로 검토한다."
learning_refs:
  - title: "Service Dependency Inventory와 Ownership"
    href: "/learning/deep-dive/deep-dive-service-dependency-inventory-ownership-playbook/"
    description: "서비스 의존성과 owner를 장애 대응 가능한 inventory로 만드는 기본 구조입니다."
  - title: "Distributed Tracing 도입 플레이북"
    href: "/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/"
    description: "trace context와 서비스 관계를 실제 요청 흐름으로 검증하는 방법입니다."
  - title: "메트릭 카디널리티 예산과 라벨 거버넌스"
    href: "/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/"
    description: "entity attribute를 고카디널리티 metric label로 잘못 옮기지 않는 기준입니다."
  - title: "OpenTelemetry 네이티브 계측과 데이터 플레인"
    href: "/posts/2026-07-01-opentelemetry-native-data-plane-trend/"
    description: "OTel을 API 하나가 아니라 관측 데이터 플레인으로 보는 앞선 흐름입니다."
decision_guide:
  title: "Entity Events를 언제 pilot할까"
  intro: "도입 판단은 ‘그래프가 멋져 보이는가’가 아니라, 사고 때 현재 topology와 과거 변화의 근거가 반복해서 부족한가로 합니다."
  cases:
    - badge: "Pilot 권장"
      title: "장애 때 어떤 service instance·DB·route가 연결됐는지 매번 수작업으로 맞춘다"
      fit: "Tier-0 흐름에서 inventory와 trace resource가 분리돼 있고, 배포·failover·자동확장이 관계를 자주 바꾸는 팀에 맞습니다."
      watchouts: "기존 CMDB를 즉시 대체하지 말고 read-only projection과 incident query부터 만듭니다."
      next_step: "2주 동안 checkout 같은 한 흐름의 entity freshness·edge coverage를 측정합니다."
    - badge: "연계 우선"
      title: "이미 신뢰도 높은 service catalog·CMDB가 있다"
      fit: "owner, 비용, 승인 책임은 기존 catalog가 더 완전하지만 runtime 변화의 시간 정보가 부족한 경우입니다."
      watchouts: "두 시스템의 id를 느슨하게 name으로 매칭하면 silent merge가 생깁니다."
      next_step: "기존 catalog id와 entity id의 mapping contract를 먼저 만들고 변경 이력만 보강합니다."
    - badge: "보류"
      title: "producer마다 entity identity와 timestamp 품질이 제각각이다"
      fit: "host name 재사용, clock drift, tenant 경계 누락, identifier 충돌이 아직 정리되지 않은 환경입니다."
      watchouts: "그래프를 먼저 만들면 잘못된 관계가 빠르게 퍼져 incident 판단을 흐립니다."
      next_step: "identity contract와 NTP/시간 품질부터 정비한 뒤 작은 대상에서 재시도합니다."
faqs:
  - question: "Entity Events가 CMDB를 대체하나요?"
    answer: "아직 그렇게 보면 안 됩니다. 공식 Entity Data Model과 semantic conventions는 발전 중입니다. Entity Events는 runtime에서 관측한 사실과 변화 시간을 보강하는 신호로 시작하고, 권한·비용·승인 같은 관리 데이터의 source of truth는 별도로 검증해야 합니다."
  - question: "모든 host와 container를 바로 graph에 넣어야 하나요?"
    answer: "아닙니다. 고변동 entity를 무작정 넣으면 이벤트 볼륨과 collision 점검만 늘어납니다. 가장 자주 장애가 나는 한 사용자 흐름을 고르고 service instance·주요 dependency부터 시작하는 편이 낫습니다."
  - question: "관계 그래프가 있으면 tracing은 필요 없나요?"
    answer: "아닙니다. graph는 가능한 blast radius와 현재/과거 topology를 좁히고, trace는 실제 요청이 어떤 경로를 탔고 어디서 느려졌는지 증명합니다. 두 신호는 대체재가 아니라 join 관계입니다."
---

관측성 스택은 보통 메트릭, 로그, 트레이스로 설명됩니다. 이 세 신호는 시스템이 **어떻게 행동했는지**를 잘 보여 줍니다. 하지만 장애가 난 뒤 운영자가 실제로 묻는 질문 중 상당수는 다른 종류입니다. “지금 이 서비스 인스턴스는 어느 DB에 붙어 있는가?”, “지난 화요일에는 어떤 network path였는가?”, “우리가 09:00에 알고 있던 dependency는 무엇이었는가?” 같은 질문입니다. 대시보드와 trace만으로는 현재 인벤토리와 그 변화 이력을 조합해야 답할 수 있습니다.

2026년 8월 OpenTelemetry가 소개한 **Entity Events**는 이 빈칸을 메우려는 흐름입니다. host, process, service instance, volume 같은 entity의 상태와 관계를 OTLP log record로 내보내고, 이를 시간축 있는 graph로 projection해 기존 metric·log·trace와 연결합니다. 다만 공식 글도 Entity Data Model과 attribute convention이 아직 안정화 전이라고 명시합니다. 그래서 이 글은 ‘전사 CMDB를 OTel로 교체하자’가 아니라, **runtime 관측 사실을 시간축 있게 보강하는 read-only pilot을 어떤 기준으로 시작할까**에 집중합니다.

이 주제는 [Service Dependency Inventory와 Ownership](/learning/deep-dive/deep-dive-service-dependency-inventory-ownership-playbook/), [Distributed Tracing 도입 플레이북](/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/), [메트릭 카디널리티 예산과 라벨 거버넌스](/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/), [OpenTelemetry 네이티브 계측과 데이터 플레인](/posts/2026-07-01-opentelemetry-native-data-plane-trend/)의 다음 단계입니다.

참고한 공식 자료:

- [OpenTelemetry: What can you do with entity events?](https://opentelemetry.io/blog/2026/consuming-opentelemetry-entity-events/)
- [OpenTelemetry Entity Data Model](https://opentelemetry.io/docs/specs/otel/entities/)

## 이 글에서 얻는 것

- Entity Event가 기존 observability signal과 다른 질문에 답하는 이유를 이해합니다.
- mutable inventory table 대신 event stream과 projection을 쓸 때 필요한 시간·identity 모델을 설계합니다.
- 관계 edge를 metric label 폭발 없이 trace·log·metric의 탐색 범위로 사용하는 방법을 배웁니다.
- 아직 evolving인 specification을 production control plane으로 과신하지 않고 pilot·품질 gate로 도입하는 기준을 얻습니다.

## 핵심 개념/이슈

### 1) Entity Event는 ‘행동’이 아니라 ‘존재와 연결’의 변화다

API latency가 올라간다는 metric은 증상을 말하고, trace는 어떤 요청이 payment adapter에서 느려졌는지 말합니다. 하지만 payment adapter가 어느 region의 어떤 database endpoint로 failover됐는지, 그 change가 언제 관측됐는지는 다른 데이터가 필요합니다. Entity Event는 이 차이를 다룹니다.

공식 모델에서 entity event는 `otel.entity.event.type`, entity type, immutable identity, descriptive attribute를 붙인 OTLP log record입니다. 관계도 entity 상태와 함께 `depends_on`, `contains`, `runs_on` 같은 edge로 표현할 수 있습니다. 예를 들면 아래와 같은 개념입니다. 속성 이름은 spec 변화 가능성이 있으므로 illustration으로만 봐야 합니다.

```yaml
event_time: "2026-08-25T00:55:12Z"
entity:
  type: service.instance
  id:
    service.instance.id: checkout-7f998d4b6f-kx2rj
  attributes:
    service.name: checkout
    deployment.environment.name: production
    k8s.namespace.name: commerce
  relationships:
    - type: depends_on
      target:
        type: service.instance
        id:
          service.instance.id: payments-6b774c9d8c-jt8pw
```

핵심은 graph를 새 dashboard 장식으로 만들지 않는 데 있습니다. entity graph는 ‘어떤 신호를 먼저 조회할지’를 좁히는 index입니다. `db-07` 성능 저하가 보이면 graph에서 upstream service를 찾고, 그 service들의 trace와 metric만 우선 열어 blast radius를 빠르게 제한합니다. graph가 trace를 대체하는 것이 아니라, trace를 읽을 범위를 정합니다.

### 2) 현재값만 저장하면 장애 분석에 필요한 시간을 잃는다

인벤토리를 `entities` 테이블 한 줄로 관리하면 간단해 보입니다. 새 IP 또는 새 dependency가 발견될 때마다 `UPDATE`하면 현재 상태는 보기 좋습니다. 문제는 30분 뒤 incident review에서 “정확히 언제 바뀌었나”, “우리는 그 순간 무엇을 알고 있었나”를 물을 때입니다. 마지막 값만 남은 테이블은 이 두 질문을 모두 잃습니다.

그래서 Entity Event의 실무적 가치는 event sourcing과 **bi-temporal** 모델에 있습니다.

| 시간 | 뜻 | 답하는 질문 |
| --- | --- | --- |
| `event_time` | producer가 변화가 일어났다고 관측한 시각 | “지난 화요일 실제 topology는 어땠나?” |
| `recorded_time` | consumer가 이벤트를 수신·기록한 시각 | “09:00에 우리 시스템은 무엇을 알고 있었나?” |

두 시간을 한 컬럼으로 합치면 clock skew나 late arrival가 생긴 순간 기록의 의미가 흐려집니다. producer clock은 서로 다를 수 있고, network outage 뒤 오래된 event가 늦게 도착할 수도 있습니다. 초기에 다음 규칙을 두는 편이 안전합니다.

- append-only event log를 source로 두고 current graph는 projection으로 만든다.
- producer timestamp는 보존하되, ingest server가 찍는 `recorded_time`을 별도 필수 필드로 둔다.
- 순서는 전체 graph의 단일 전역 순서가 아니라 **entity별 timeline**으로 해석한다.
- 같은 상태를 재확인하는 heartbeat는 첫·마지막 event만 남기는 coalescing을 검토하되, relationship 추가·삭제는 절대 접지 않는다.

이 모델은 [Service Dependency Inventory와 Ownership](/learning/deep-dive/deep-dive-service-dependency-inventory-ownership-playbook/)에서 말한 정적 owner inventory에 runtime 변화 이력을 연결합니다. 어떤 dependency가 문서에 있었다는 것과, 사고 시점에 실제로 연결돼 있었다는 것은 다른 증거입니다.

### 3) identity는 관대하게 합치지 말고 불변 계약으로 둔다

temporal graph에서 가장 위험한 오류는 event 유실보다 **silent merge**일 때가 많습니다. 서로 다른 두 DB가 같은 host name을 쓰거나, 재사용된 PID를 같은 process로 보거나, DHCP로 바뀌는 IP를 identity에 포함하면 관계와 이력이 조용히 뒤섞입니다. 한 번 잘못 합쳐진 graph는 trace·metric 조회까지 잘못된 방향으로 유도합니다.

identity와 descriptive attribute의 경계를 먼저 정해야 합니다.

| 분류 | 적합한 값 | 부적합한 값 |
| --- | --- | --- |
| immutable identity | instance UUID, cloud resource ID, `process.pid + creation_time` | 현재 IP, deploy version, CPU usage |
| descriptive attribute | region, endpoint, image digest, last seen | 서로 다른 instance를 합치는 name-only key |
| relationship edge | `depends_on`, `runs_on`, `contains` | 사람이 읽기 쉬운 free-text 메모 |

실무에서는 entity type마다 identity contract를 짧게 작성합니다. 예를 들어 `service.instance`는 `service.instance.id`를, `database`는 cloud database ARN 또는 관리되는 immutable resource ID를 사용합니다. PID처럼 재사용될 수 있는 값은 creation time 같은 discriminator를 같이 둡니다. producer가 identity key를 바꾸려면 entity를 update하지 말고 **새 entity**로 만들도록 하는 편이 더 정직합니다.

이 원칙은 정합성만의 문제가 아닙니다. identity collision rate가 0.5%만 되어도 1,000개 entity 중 5개가 잘못된 blast radius를 만들 수 있습니다. pilot 초기에는 unknown·collision event를 강제로 quarantine하고, ‘추정으로 합치기’는 하지 않는 것이 낫습니다.

### 4) 관계는 observability join key이지 고카디널리티 metric label이 아니다

관계 그래프가 생겼다고 `dependency_id`, `instance_id`, `edge_id`를 모든 metric label에 넣으면 observability 비용은 곧 폭발합니다. [메트릭 카디널리티 예산과 라벨 거버넌스](/learning/deep-dive/deep-dive-metric-cardinality-budget-label-governance-playbook/)의 원칙은 여기에도 그대로 적용됩니다.

좋은 사용은 entity graph로 검색 범위를 고른 뒤, 이미 있는 resource identity로 signal을 join하는 것입니다.

```text
1. database entity db-payments-3에서 error spike 감지
2. graph에서 depends_on upstream 12개를 확인
3. 해당 service.instance의 최근 15분 trace/metric/log만 조회
4. change event를 기준으로 배포·failover·network edge 변화를 비교
```

이 방식은 metric label에 매 instance를 넣지 않아도 됩니다. OTel Resource에 같은 entity identity를 연결하면 graph는 scope를 정하고, trace는 요청 경로를, metric은 규모를, log는 구체적 오류를 설명합니다. Entity Event가 별도 관리 DB와 다른 점도 여기 있습니다. 같은 관측 문맥을 join하는 키로 기능해야 합니다.

### 5) 2026년의 신호는 ‘도입’보다 ‘정확한 관계의 증거’를 요구한다

공식 글에 따르면 Entity Event와 relationship 모델은 2026년 6월 spec v1.58.0에 포함됐지만, Entity Data Model과 semantic conventions는 여전히 발전 중입니다. 따라서 현재 시점에서 이 흐름은 확정된 product checklist가 아니라 표준화 방향입니다. attribute 이름, entity identity scope, producer 지원 범위를 고정 사실처럼 문서화하면 곧 migration 비용이 생길 수 있습니다.

그래서 성공 기준도 graph 화면을 열었다가 아니라 데이터 품질로 잡아야 합니다.

| 지표 | pilot 출발 gate | 실패 시 우선 조치 |
| --- | ---: | --- |
| Tier-0 entity freshness p95 | 5분 이하 | producer/Collector 장애와 heartbeat 주기 점검 |
| identity collision rate | 0.1% 미만 | matching 완화 대신 identity contract 수정 |
| unresolved relationship rate | 1% 미만 | target ID와 producer rollout 순서 점검 |
| trace-resource join coverage | 90% 이상 | resource attribute 통일 및 instrumentation 보완 |
| 변경 event의 owner 매핑 | 95% 이상 | catalog ID 연결 또는 ownership 보강 |

이 수치는 보편적 표준이 아니라 첫 2~4주 pilot의 보수적 출발선입니다. 서비스의 변화율과 incident SLO에 맞춰 조정할 수 있습니다. 다만 그래프가 불완전할 때 자동 remediation이나 배포 승인에 연결하지 않는 원칙은 고정하는 편이 좋습니다.

## 실무 적용

### 1) 전사 inventory가 아니라 한 장애 도메인에서 시작한다

첫 대상은 checkout처럼 고객 영향이 크고 dependency가 5~20개 수준으로 이해 가능한 흐름이 좋습니다. entity type도 `service.instance`, `database`, `k8s.workload` 정도로 제한합니다. 첫 2주에는 read-only query만 허용하고, 기존 CMDB와 service catalog를 대체하지 않습니다.

```text
producer (Kubernetes / cloud inventory / app deploy)
  → OTLP entity-event log
  → Collector: schema validate + PII redact + drop counter
  → durable event store
  → temporal projection (current graph + change history)
  → incident query API / dashboard

existing metrics · logs · traces
  └──────── same resource/entity identity로 join ────────┘
```

Collector 단계에서는 unknown entity type, identity key 누락, PII attribute, 너무 큰 relationship array를 drop하거나 quarantine합니다. ‘일단 전부 받아 두자’는 관측 data plane의 비용·보안·schema drift를 뒤로 미루는 방식입니다. [OpenTelemetry 네이티브 계측과 데이터 플레인](/posts/2026-07-01-opentelemetry-native-data-plane-trend/)에서 지적한 것처럼, 표준을 들여와도 governance를 같이 두지 않으면 단지 더 복잡한 pipeline이 됩니다.

### 2) pilot의 질문을 incident 중심으로 고정한다

도입 팀은 graph를 만들기 전에 3개의 query를 정해야 합니다. 예시는 다음과 같습니다.

1. “이 database entity에 지난 30분간 의존했던 service instance는 무엇인가?”
2. “오류가 시작되기 전후 15분에 topology에서 바뀐 edge·deploy·endpoint는 무엇인가?”
3. “09:00 당시 on-call이 알고 있던 dependency와 지금 재구성한 사실은 어디가 다른가?”

이 질문에 30초 안에 근거를 내지 못한다면 field를 더 수집하기 전에 identity·freshness·relationship quality를 먼저 보완해야 합니다. 반대로 2주 동안 실제 incident나 game day에서 세 질문 중 두 개 이상을 기존 dashboard보다 빠르게 답했다면, entity type 하나를 더 넓힐 근거가 생깁니다.

### 3) event volume은 ‘변화’와 ‘상태 재확인’을 분리해 제어한다

Kubernetes Pod, ephemeral process, network interface는 빠르게 바뀝니다. 모든 상태를 초 단위로 full snapshot 내보내면 graph가 정확해 보이기보다 collector·storage 비용만 크게 늘어납니다. 반대로 heartbeat를 모두 버리면 entity freshness를 판단할 수 없습니다.

출발 기준은 다음처럼 둡니다.

- 구조 변화(relationship add/remove, identity create/delete)는 원문 event를 보존한다.
- 변하지 않은 state heartbeat는 1~5분 주기로 받고, 연속 동일값은 first/last만 보존하는 coalescing을 검토한다.
- entity별 하루 event 상한을 정하고, 초과하면 sampling이 아니라 producer bug·attribute churn부터 조사한다.
- raw event 보존 기간은 7~30일, aggregated change history는 incident·audit 요구에 맞춰 더 길게 둔다.
- 개인 식별자, secret, raw URL query, full command line은 entity attribute allowlist 밖에 둔다.

이 기준은 누락 없는 event sourcing이라는 이상과 운영 가능한 비용 사이의 trade-off입니다. 삭제/관계 변화를 보존하고 반복되는 무변화 보고를 제어하는 쪽이 pilot에서 가장 실용적입니다.

## 트레이드오프/주의점

1. **Entity graph는 사실의 완전한 복제본이 아닙니다.** collector 지연, producer restart, clock skew, 권한 부족으로 관측된 topology가 실제보다 늦거나 좁을 수 있습니다. `recorded_time`과 freshness를 함께 보여야 합니다.
2. **불안정한 spec에 업무 자동화를 걸면 안 됩니다.** 모델이 진화하는 동안은 read-only incident 보조 도구로 두고, firewall 변경·deployment approval 같은 control action은 별도 검증 체계를 유지합니다.
3. **identity 완화는 단기적으로 보기 좋고 장기적으로 위험합니다.** name 유사도 기반 merge보다 unmatched entity를 경고하는 편이 장애 분석에는 안전합니다.
4. **기존 catalog와 역할을 구분해야 합니다.** runtime graph는 관측된 관계, catalog는 owner·비용·승인·문서 책임에 강합니다. 한 시스템을 다른 시스템의 실패로 대체하려 하지 않습니다.
5. **관계가 많다고 좋은 관측성은 아닙니다.** incident 질문과 연결되지 않는 edge는 수집·보존·권한 검토 비용만 올립니다. Tier-0에서 실제로 쓰인 query가 다음 확장 범위를 결정해야 합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] pilot 대상은 Tier-0 사용자 흐름 하나, entity type 3개 이하로 제한했다.
- [ ] entity별 immutable identity와 descriptive attribute의 경계가 문서화돼 있다.
- [ ] event time과 recorded time을 따로 보존하고 late arrival을 오류로 버리지 않는다.
- [ ] relationship type·target identity·삭제 의미가 producer contract에 명시돼 있다.
- [ ] PII·secret·고카디널리티 free-text attribute allowlist가 있다.
- [ ] freshness, collision, unresolved edge, trace join coverage에 수치 gate가 있다.
- [ ] graph 결과는 read-only이며 기존 catalog/CMDB와 자동으로 충돌 해결하지 않는다.

### 연습 과제

최근 장애 또는 game day 하나를 골라 `service.instance → database → network endpoint` 관계를 시간축으로 적어 보세요. 그 뒤 “실제 변화 시각”, “on-call이 그 사실을 알게 된 시각”, “trace로 확인한 요청 경로”를 세 열로 나눕니다. 세 열 중 하나가 빈다면 필요한 것은 더 많은 metric label이 아니라 entity identity·event time·resource join 중 무엇인지 구체적으로 드러납니다.
