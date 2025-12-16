---
title: "Spring 통합 테스트와 Testcontainers"
date: 2025-12-16
draft: false
topic: "Testing"
tags: ["Testcontainers", "Spring Boot", "Integration Test", "JPA", "Redis"]
categories: ["Backend Deep Dive"]
description: "MySQL/Redis/Kafka를 Testcontainers로 올려 실제 환경과 유사한 통합 테스트를 구성하는 방법"
module: "spring-core"
study_order: 197
---

## 이 글에서 얻는 것

- 통합 테스트(Integration Test)가 왜 필요한지, 단위 테스트와 어떻게 역할을 나눌지 기준이 생깁니다.
- Testcontainers로 MySQL/Redis/Kafka 같은 의존성을 “진짜로” 붙여서 테스트하는 기본 패턴을 익힙니다.
- CI에서 느려짐/불안정(플레이키) 문제를 줄이는 운영 팁(이미지 고정, 재사용, 시드/정리)을 정리합니다.

## 0) 통합 테스트는 언제 필요할까

단위 테스트가 로직의 대부분을 커버해야 하지만, 다음 영역은 단위 테스트만으로 놓치기 쉽습니다.

- DB 매핑/쿼리/트랜잭션 경계(JPA 동작)
- Redis/Kafka 같은 외부 의존성과의 연결/설정
- 마이그레이션(Flyway/Liquibase) 적용 여부

이런 것들은 “실제로 붙여보는 테스트”가 가장 빠르고 확실합니다.

## 1) Testcontainers가 해결하는 문제

Testcontainers는 테스트 실행 시 Docker 컨테이너를 올려서,
로컬/CI 어디서든 “비슷한 환경”을 재현할 수 있게 해줍니다.

- 로컬에 DB를 설치하지 않아도 됨
- CI에서도 동일한 버전의 DB/Redis/Kafka를 쓸 수 있음
- “내 컴퓨터에서는 되는데 CI에서는 안 됨”을 줄여줌

## 2) 기본 패턴: 컨테이너 + DynamicPropertySource

```java
@Testcontainers
@SpringBootTest
public class OrderServiceTest {

    @Container
    static MySQLContainer<?> mysql = new MySQLContainer<>("mysql:8.0");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", mysql::getJdbcUrl);
        registry.add("spring.datasource.username", mysql::getUsername);
        registry.add("spring.datasource.password", mysql::getPassword);
    }
}
```

핵심은:

- 컨테이너는 테스트 시작 시 올라오고,
- 실제 연결 정보(랜덤 포트 포함)를 스프링 설정으로 주입해,
- 애플리케이션이 “진짜 DB”에 붙도록 만드는 것입니다.

## 3) 베스트 프랙티스(실무에서 자주 쓰는 것)

- 정적 컨테이너로 테스트 클래스 간 재사용 → 성능 향상
- 테스트 전용 프로필 분리, 마이그레이션 툴(Flyway/Liquibase) 함께 실행
- Kafka/Redis도 동일 방식으로 등록, 네트워크 포트 충돌 주의

추가 팁:

- 이미지 버전은 고정하세요(예: `mysql:8.0.36`). “latest”는 CI에서 갑자기 깨지기 쉽습니다.
- 데이터 정리는 “테스트 격리”의 핵심입니다. 테스트마다 데이터를 초기화하는 전략(트랜잭션 롤백/테이블 truncate/새 스키마)을 정하세요.
- 컨테이너 시작 시간이 부담이면:
  - 테스트 스코프를 좁히고(진짜 필요한 테스트만 컨테이너),
  - 컨테이너 재사용 전략을 고려합니다(환경/정책에 따라).

## 4) CI에서 주의할 점

- CI가 Docker를 사용할 수 있는지 확인해야 합니다(권한/런타임).
- 네트워크 제한/이미지 pull 제한이 있으면 미리 이미지 캐시(프리풀) 또는 사설 레지스트리를 고려합니다.
- 테스트가 병렬로 돌 때 컨테이너/DB 상태가 섞이지 않도록(공유 상태) 설계를 주의합니다.

## 5) 자주 하는 실수

- 통합 테스트를 너무 많이 만들어서 빌드가 느려지고, 결국 안 돌리게 됨
- 이미지 버전이 흔들려 CI가 간헐적으로 깨짐
- 데이터 시드/정리가 불완전해서 테스트가 순서에 의존(플레이키)

## 연습(추천)

- `@DataJpaTest + Testcontainers`로 Repository 테스트를 하나 만들고, 로컬 H2와 어떤 차이가 있는지 확인해보기
- Redis 컨테이너를 추가해 캐시 동작을 통합 테스트로 검증해보기(캐시 히트/미스)
- CI에서 테스트가 느릴 때 어디가 병목인지(컨테이너 startup/pull/마이그레이션) 측정하고 개선 포인트를 정리해보기
