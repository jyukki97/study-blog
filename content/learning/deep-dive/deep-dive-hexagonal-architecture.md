---
title: "육각형 아키텍처 (Hexagonal): 도메인을 프레임워크로부터 격리하라"
date: 2025-12-28
draft: false
topic: "Architecture"
tags: ["Hexagonal", "Ports and Adapters", "Clean Architecture", "Architecture"]
categories: ["Backend Deep Dive"]
description: "스프링조차도 도메인 로직에 침범하지 못하게 하라. Ports & Adapters 패턴의 구현."
module: "architecture-mastery"
study_order: 1102
---

## 이 글에서 얻는 것

- **Layered Architecture** (Controller -> Service -> Repository)의 한계와 의존성 문제를 이해합니다.
- **의존성 역전 원칙(DIP)**이 아키텍처 레벨에서 어떻게 적용되는지 봅니다.
- **Port** (인터페이스)와 **Adapter** (구현체)를 통한 완벽한 격리 방법을 배웁니다.

## 1) 계층형 아키텍처의 배신

전통적인 계층형 아키텍처는 데이터베이스 주도 설계(Database Driven Design)로 빠지기 쉽습니다.
`Service`가 `Repository` 구현체(JPA 등)에 의존하게 되고, 결국 비즈니스 로직이 영속성 프레임워크에 오염됩니다.

## 2) 육각형 아키텍처 (Ports & Adapters)

핵심 아이디어는 **"애플리케이션 코어(도메인)는 바깥 세상(Web, DB)을 모르게 하라"** 입니다.

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

### The Dependency Rule (의존성 규칙)
화살표를 보세요. **모든 화살표가 도메인(가운데)을 향해 들어옵니다.**
- **Web Adapter**는 `In Port`를 호출합니다. (Inbound)
- **Domain Service**는 `Out Port`를 호출합니다. (Outbound)
- **DB Adapter**는 `Out Port`를 구현(Implements)합니다. (Dependency Inversion)

도메인 코드는 `JPA Repository`를 import하지 않습니다. 오직 순수한 자바 인터페이스(`OutPort`)만 바라봅니다.

## 3) 구현 예시 (Spring Boot)

### Port (Interface in Domain Layer)
```java
// domain/port/out/LoadAccountPort.java
public interface LoadAccountPort {
    Account loadAccount(Long accountId);
}
```

### Domain Service (Business Logic)
```java
// domain/service/SendMoneyService.java
@RequiredArgsConstructor
public class SendMoneyService implements SendMoneyUseCase {
    private final LoadAccountPort loadAccountPort; // 인터페이스에만 의존!
    
    // ...
}
```

### Adapter (Infrastructure Layer)
```java
// adapter/out/persistence/AccountPersistenceAdapter.java
@Component
@RequiredArgsConstructor
class AccountPersistenceAdapter implements LoadAccountPort {
    private final SpringDataAccountRepository accountRepository; // JPA는 여기 숨음
    
    @Override
    public Account loadAccount(Long accountId) {
        // JPA Entity -> Domain Entity 변환
        return accountMapper.mapToDomain(accountRepository.findById(accountId));
    }
}
```

## 요약

- **Hexagonal Architecture**는 도메인을 프레임워크로부터 보호합니다.
- **Port**는 도메인이 외부와 소통하는 문(Interface)이고, **Adapter**는 그 문을 통과하는 변환기(Implementation)입니다.
- 이렇게 하면 나중에 **JPA를 MyBatis로 바꾸거나, RDBMS를 Mongo로 바꿔도** 도메인 로직은 1줄도 수정할 필요가 없습니다.

## 마무리

축하합니다! **Backend Developer Deep Dive Roadmap**의 모든 여정을 마쳤습니다.
이제 당신은 단순한 코더가 아니라, 시스템의 깊이를 이해하고 설계할 수 있는 **엔지니어**입니다.
