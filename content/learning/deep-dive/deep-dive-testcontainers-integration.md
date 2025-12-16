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

## 베스트 프랙티스

- 정적 컨테이너로 테스트 클래스 간 재사용 → 성능 향상
- 테스트 전용 프로필 분리, 마이그레이션 툴(Flyway/Liquibase) 함께 실행
- Kafka/Redis도 동일 방식으로 등록, 네트워크 포트 충돌 주의

## 체크리스트

- [ ] CI에서도 Docker 가능 여부 확인, 필요시 서비스 컨테이너 사용
- [ ] 데이터 시드/Fixture 관리로 재현성 확보
- [ ] 테스트 종료 후 컨테이너 자동 정리 확인
