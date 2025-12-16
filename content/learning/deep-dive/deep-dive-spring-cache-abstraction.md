---
title: "Spring Cache Abstraction 활용하기"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["Spring", "Cache", "Redis", "Caffeine"]
categories: ["Backend Deep Dive"]
description: "@Cacheable/@CachePut/@CacheEvict 사용법과 Redis/Caffeine 연동 패턴"
module: "spring-core"
study_order: 135
---

## 기본 어노테이션

- `@Cacheable`: 캐시 조회/적재
- `@CachePut`: 캐시 갱신
- `@CacheEvict`: 캐시 무효화(단일/전체)

```java
@Cacheable(cacheNames = "user", key = "#id")
public UserDto get(Long id) { ... }
```

## 구성 예시

```java
spring:
  cache:
    type: redis
  data:
    redis:
      host: localhost
      port: 6379
```

- 로컬 캐시(Caffeine) + 원격 캐시(Redis) 2단계 구성 가능

## 체크리스트

- [ ] 키 스키마 정의, TTL 설정
- [ ] 캐시 무효화 전략(@CacheEvict) 마련
- [ ] 직렬화 포맷(Jackson/CBOR)와 버전 관리
- [ ] 멱등/일관성 요구사항에 맞는 캐시 계층 설계
