---
title: "육각형 아키텍처 (Hexagonal): 도메인을 프레임워크로부터 격리하라"
date: 2025-12-28
draft: false
topic: "Architecture"
tags: ["Hexagonal", "Ports and Adapters", "Clean Architecture", "Architecture"]
categories: ["Backend Deep Dive"]
description: "도메인 모델이 스프링, JPA, 외부 API에 잠식되지 않도록 Ports & Adapters 구조를 실무 예시로 정리합니다."
summary: "헥사고날 아키텍처의 핵심은 계층을 늘리는 것이 아니라 의존성 방향을 바로잡는 데 있습니다. 도메인이 인터페이스를 정의하고, 외부 기술은 어댑터로 밀어내는 구조를 실제 코드 기준으로 설명합니다."
key_takeaways:
  - "도메인 코어는 외부 기술을 몰라야 한다."
  - "In Port는 유스케이스 진입점, Out Port는 외부 의존의 추상화다."
  - "테스트와 기술 교체 비용은 구조가 결정한다."
operator_checklist:
  - "도메인/애플리케이션 계층이 Spring, JPA, Web 어노테이션을 직접 import하는지 확인한다."
  - "UseCase 인터페이스와 구현 책임이 섞여 있지 않은지 점검한다."
  - "외부 API, 메시지 큐, 영속성 접근이 Adapter 레이어로 분리돼 있는지 본다."
series: "DDD와 헥사고날 아키텍처"
module: "architecture-mastery"
learning_refs:
  - title: "DDD 전술적 설계: Entity, VO, 그리고 Aggregate"
    href: "/learning/deep-dive/deep-dive-ddd-tactical/"
    description: "헥사고날 구조의 중심이 되는 도메인 객체를 먼저 정리한 글입니다."
  - title: "Aggregate Root와 트랜잭션 경계"
    href: "/learning/deep-dive/deep-dive-ddd-aggregates/"
    description: "구조만 나누는 것이 아니라, 어떤 경계를 보호해야 하는지 함께 이해할 수 있습니다."
  - title: "마이크로서비스 패턴"
    href: "/learning/deep-dive/deep-dive-microservices-patterns/"
    description: "서비스 경계가 커졌을 때 헥사고날 구조가 어떤 식으로 확장되는지 이어서 보기 좋습니다."
faqs:
  - question: "레이어드 아키텍처와 완전히 다른 건가요?"
    answer: "완전히 반대라기보다, 기존 레이어 구조에서 의존성 방향을 더 엄격하게 통제하는 방식에 가깝습니다. Controller, Service, Repository라는 이름을 그대로 써도 도메인이 외부 기술을 모르면 헥사고날 원칙에 더 가깝게 갈 수 있습니다."
  - question: "작은 프로젝트에도 필요한가요?"
    answer: "처음부터 모든 포트와 어댑터를 거창하게 만들 필요는 없습니다. 다만 핵심 도메인 규칙이 있는 프로젝트라면 최소한 도메인 계층이 프레임워크 어노테이션과 영속성 구현에 직접 묶이지 않도록 시작하는 것이 장기적으로 훨씬 낫습니다."
quizzes:
  - question: "헥사고날(육각형) 아키텍처의 핵심 원칙은?"
    options:
      - "모든 레이어가 데이터베이스에 의존한다."
      - "도메인 코어는 외부(Web, DB)를 몰라야 하며, 모든 의존성은 도메인을 향해야 한다(Dependency Rule)."
      - "Controller가 모든 비즈니스 로직을 처리한다."
      - "프레임워크를 최대한 많이 사용한다."
    answer: 1
    explanation: "헥사고날 아키텍처에서 도메인 로직은 순수하게 유지되어야 합니다. 외부 기술(JPA, Web)은 Adapter로 분리되고, 도메인은 Port(인터페이스)만 바라봅니다."

  - question: "'Port'와 'Adapter'의 관계로 올바른 것은?"
    options:
      - "Port가 Adapter를 구현한다."
      - "Port는 도메인이 외부와 소통하는 인터페이스이고, Adapter는 그 인터페이스를 구현하는 외부 기술 계층이다."
      - "Port와 Adapter는 동일한 개념이다."
      - "Adapter는 도메인 로직을 담당한다."
    answer: 1
    explanation: "Port는 도메인 계층에 정의된 인터페이스입니다. Adapter(예: JPA Repository, REST Controller)는 Port를 구현하여 외부 기술과 도메인을 연결합니다."

  - question: "'In Port'와 'Out Port'의 차이는?"
    options:
      - "In Port는 입력 포트, Out Port는 출력 포트로 동일하다."
      - "In Port는 외부(Controller)가 도메인을 호출하는 UseCase 인터페이스이고, Out Port는 도메인이 외부(DB, 외부 API)를 호출하는 인터페이스이다."
      - "둘 다 Controller에서 정의한다."
      - "In Port는 DB 접근, Out Port는 HTTP 접근에 사용된다."
    answer: 1
    explanation: "In Port(Driving Side)는 Controller가 Service를 호출할 때 사용하는 UseCase 인터페이스입니다. Out Port(Driven Side)는 Service가 DB나 외부 시스템을 호출할 때 사용하는 인터페이스입니다."

  - question: "헥사고날 아키텍처를 적용하면 JPA를 MyBatis로 교체할 때 어떤 코드가 변경되는가?"
    options:
      - "도메인 로직 전체"
      - "Controller와 Service"
      - "Out Port를 구현하는 Persistence Adapter만 변경하면 되고, 도메인 로직은 변경 불필요"
      - "모든 계층"
    answer: 2
    explanation: "도메인은 Out Port 인터페이스에만 의존합니다. JPA Adapter를 MyBatis Adapter로 교체해도 Port 구현체만 바꾸면 되므로 도메인 로직은 1줄도 수정할 필요가 없습니다."

  - question: "전통적인 계층형 아키텍처(Controller → Service → Repository)의 한계는?"
    options:
      - "테스트가 쉽다."
      - "Service가 Repository 구현체(JPA)에 직접 의존하여 비즈니스 로직이 영속성 프레임워크에 오염될 수 있다."
      - "성능이 좋다."
      - "확장성이 뛰어나다."
    answer: 1
    explanation: "계층형 아키텍처에서 Service가 JpaRepository를 직접 사용하면 도메인 로직이 JPA에 종속됩니다. 헥사고날 아키텍처는 인터페이스(Port)로 이 의존성을 끊어 도메인을 순수하게 유지합니다."
study_order: 1102
---

## 이 글에서 얻는 것

- 전통적인 계층형 구조가 왜 시간이 갈수록 프레임워크 중심으로 기울어지는지 이해합니다.
- **Port**와 **Adapter**를 어디에 두고, 무엇을 의존해야 하는지 코드 수준으로 정리합니다.
- DDD의 Entity, Aggregate를 실제 애플리케이션 구조로 보호하는 방법을 연결합니다.

## 1) 계층형 아키텍처는 왜 자꾸 DB 중심이 될까

처음 프로젝트를 만들 때는 `Controller -> Service -> Repository` 구조가 가장 익숙합니다. 문제는 시간이 지나면 Service가 점점 JPA, 외부 API 응답 형식, 메시지 큐 포맷까지 모두 알아야 하는 위치가 된다는 점입니다.

그 결과,

- 비즈니스 로직이 프레임워크 어노테이션과 섞이고,
- 테스트가 스프링 컨텍스트 없이는 어려워지고,
- 저장 방식이 바뀔 때 도메인 코드까지 흔들립니다.

즉, 레이어는 있어도 **의존성 방향이 잘못된 상태**가 됩니다. 헥사고날 아키텍처는 이 문제를 "레이어를 더 늘려서"가 아니라 "도메인이 무엇을 알아야 하는지 다시 제한해서" 풀어냅니다.

## 2) 핵심 아이디어: 도메인 코어는 바깥 세상을 몰라야 한다

헥사고날 아키텍처의 핵심 문장은 아주 단순합니다.

> **애플리케이션 코어는 Web, DB, 외부 API를 몰라야 한다.**

이를 위해 도메인 내부에서 인터페이스를 정의하고, 바깥쪽에서 그것을 구현합니다.

```mermaid
graph TD
    subgraph Adapter [Adapters (Details)]
        Web[Web Adapter<br/>(Controller)]
        DB[Persistence Adapter<br/>(JPA)]
        Ext[External System Adapter<br/>(Feign)]
    end

    subgraph Port [Ports (Interfaces)]
        InPort[In Port<br/>(UseCase)]
        OutPort[Out Port<br/>(Load/Save Port)]
    end

    subgraph Domain [Domain Core]
        Service[Service]
        Entity[Entity / Aggregates]
    end

    Web --> InPort
    Service -.->|implements| InPort

    Service --> OutPort
    DB -.->|implements| OutPort
    Ext -.->|implements| OutPort

    style Domain fill:#e8f5e9,stroke:#2e7d32
    style Port fill:#fff9c4,stroke:#fbc02d
    style Adapter fill:#e1f5fe,stroke:#0277bd
```

이 그림에서 중요한 건 모양이 아니라 화살표 방향입니다. 모든 의존은 도메인 쪽을 향해야 합니다.

## 3) In Port와 Out Port를 실무 언어로 이해하기

헷갈리지 않게 아주 실무적으로 보면,

- **In Port**: "우리 시스템이 외부로부터 받는 유스케이스 계약"
- **Out Port**: "도메인이 외부 도움을 받을 때 기대하는 계약"

예를 들어 송금 기능이 있다면,

- `SendMoneyUseCase`는 In Port입니다.
- `LoadAccountPort`, `SaveTransferPort`, `SendNotificationPort`는 Out Port가 될 수 있습니다.

이 구분이 좋은 이유는 도메인 서비스가 "무엇을 해야 하는지"만 알고 "어떻게 저장하고 어디로 보낼지"는 모르게 만들기 때문입니다.

### Port 예시

```java
public interface LoadAccountPort {
    Account loadAccount(Long accountId);
}
```

### Domain Service 예시

```java
@RequiredArgsConstructor
public class SendMoneyService implements SendMoneyUseCase {
    private final LoadAccountPort loadAccountPort;

    // 핵심 로직은 인터페이스만 안다
}
```

### Adapter 예시

```java
@Component
@RequiredArgsConstructor
class AccountPersistenceAdapter implements LoadAccountPort {
    private final SpringDataAccountRepository accountRepository;

    @Override
    public Account loadAccount(Long accountId) {
        return accountMapper.mapToDomain(accountRepository.findById(accountId));
    }
}
```

여기서 JPA, QueryDSL, Feign, Kafka는 모두 Adapter 쪽 디테일입니다. 도메인 로직이 여기를 import하기 시작하면 헥사고날 구조는 사실상 무너진 겁니다.

## 4) DDD와 헥사고날은 왜 같이 가야 할까

[DDD 전술적 설계](/learning/deep-dive/deep-dive-ddd-tactical/)에서 Entity, VO, Aggregate를 아무리 잘 나눠도, 그 객체들이 결국 JPA Entity와 HTTP DTO 사이에 끼여 흔들리면 효과가 반감됩니다.

헥사고날 아키텍처는 DDD의 결과물을 보호하는 외곽 성벽 역할을 합니다.

- DDD가 **무엇이 핵심 도메인인지**를 정해주고,
- Aggregate 설계가 **어디까지 같이 바뀌어야 하는지**를 정해주며,
- 헥사고날 구조가 **그 규칙이 외부 기술에 오염되지 않게 막아줍니다.**

즉, 개념 설계와 구조 설계가 따로가 아니라 한 줄로 이어져 있습니다.

## 5) 흔한 오해: 포트가 많을수록 좋은 게 아니다

헥사고날을 처음 적용할 때 모든 CRUD마다 포트를 만들고, 클래스 수만 급격히 늘리는 경우가 있습니다. 이건 오히려 구조를 부담스럽게 만듭니다.

좋은 기준은 이렇습니다.

- **핵심 유스케이스**는 In Port로 드러낸다.
- **외부 의존성이 바뀔 가능성이 있거나 테스트 격리가 필요한 지점**만 Out Port로 추상화한다.
- 단순한 내부 헬퍼까지 전부 포트로 만들 필요는 없다.

즉, 헥사고날은 "인터페이스 남발"이 아니라 **변화 방향이 다른 것들을 분리하는 기술**입니다.

## 6) 도입 순서도 작게 가는 편이 좋다

기존 프로젝트에 한 번에 전부 적용하려 하면 반발이 큽니다. 보통은 아래 순서가 무난합니다.

1. 새 기능 하나를 선택한다.
2. UseCase 인터페이스를 먼저 만든다.
3. 도메인 서비스가 JPA나 외부 API를 직접 모르도록 Out Port를 뺀다.
4. 기존 Repository/Client를 Adapter로 감싼다.
5. 테스트를 도메인 단위로 붙인다.

이렇게 작은 성공 경험을 만든 뒤 넓히는 편이 훨씬 현실적입니다.

## 7) 리뷰 때 바로 보는 체크포인트

- 도메인 패키지에서 `org.springframework`, `jakarta.persistence`를 직접 import하는가?
- 애플리케이션 서비스가 Feign DTO, JPA Entity, API 응답 모델을 그대로 다루는가?
- UseCase 인터페이스 없이 Controller가 구현체를 직접 붙들고 있는가?
- 테스트가 전부 통합 테스트뿐이고, 순수 도메인 테스트가 없는가?

이 중 둘 이상 해당하면 구조가 이미 외부 기술 중심으로 기울었을 가능성이 큽니다.

## 요약

- **Hexagonal Architecture**의 핵심은 도메인을 중심에 두고 의존성 방향을 바로잡는 것입니다.
- **In Port**는 유스케이스 진입점, **Out Port**는 외부 의존의 계약입니다.
- 외부 기술은 모두 **Adapter**로 밀어내면 테스트성과 교체 가능성이 크게 좋아집니다.
- DDD의 Entity, Aggregate를 실제 코드에서 지키려면 구조적 보호막이 필요합니다.

## 다음 단계

- [DDD 전술적 설계: Entity, VO, 그리고 Aggregate](/learning/deep-dive/deep-dive-ddd-tactical/)
- [Aggregate Root와 트랜잭션 경계](/learning/deep-dive/deep-dive-ddd-aggregates/)
- [마이크로서비스 패턴](/learning/deep-dive/deep-dive-microservices-patterns/)
