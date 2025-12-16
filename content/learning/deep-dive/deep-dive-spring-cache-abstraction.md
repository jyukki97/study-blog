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

## 이 글에서 얻는 것

- 스프링 캐시를 “어노테이션 몇 개”가 아니라 **캐시 전략(Cache-aside) 구현 도구**로 이해할 수 있습니다.
- `@Cacheable/@CachePut/@CacheEvict`를 언제 써야 하는지, 그리고 “왜 캐시가 안 먹는지” 디버깅할 수 있습니다.
- 캐시 키/TTL/무효화/직렬화 같은 실무 이슈를 설계 기준으로 정리할 수 있습니다.
- Redis/Caffeine을 붙일 때 흔히 터지는 문제(스탬피드, penetration, stale 데이터)를 예방할 수 있습니다.

## 0) 캐시는 “정답”이 아니라 트레이드오프다

캐시는 대부분 **속도 ↔ 정합성(일관성)** 의 교환입니다.

- 조회가 많고 변경이 적으면 캐시 효과가 큽니다.
- 변경이 잦으면 무효화/정합성 비용이 커져서 오히려 복잡해집니다.

그래서 “어디에 캐시를 둘지”가 더 중요합니다. 보통은:

- 비싼 조회(외부 API/복잡한 DB 조회/집계)  
- 사용자별/리소스별 “핫 키”가 명확한 조회  
- 실패/타임아웃이 잦은 의존성 앞단(단, 회복탄력성과 함께)  

## 1) Spring Cache Abstraction: 캐시 구현체를 숨기고 ‘전략’에 집중

스프링 캐시 추상화는 “메서드 호출 결과를 캐시에 저장/조회”하는 형태로 캐시-aside 패턴을 간단히 구현합니다.

핵심 어노테이션 3가지:

- `@Cacheable`: 캐시 조회 후 없으면 실행하고 저장
- `@CachePut`: 항상 실행하고, 결과를 캐시에 갱신(캐시 업데이트)
- `@CacheEvict`: 캐시 무효화(단일 키/전체)

```java
@Cacheable(cacheNames = "user", key = "#id")
public UserDto getUser(Long id) { ... }
```

## 2) “캐시가 안 먹는” 대표 원인 5가지

1) **프록시를 안 탐(self-invocation)**: 같은 클래스 내부 호출은 `@Cacheable`이 적용되지 않을 수 있습니다.  
2) **키가 매번 달라짐**: DTO/복잡 객체를 그대로 키로 쓰면 `equals/hashCode`/toString 때문에 키가 불안정해집니다.  
3) **조건/예외로 저장이 안 됨**: `condition/unless` 때문에 저장되지 않거나, 예외가 나서 저장이 안 됩니다.  
4) **TTL이 너무 짧음/없음**: 기대한 시간보다 빨리 지워지거나(짧음), 영구히 남아서 stale 데이터가 됩니다(없음).  
5) **직렬화/역직렬화 실패**(Redis): 클래스 변경/버전 불일치로 캐시 히트가 “실패처럼” 보입니다.

디버깅 팁:

- 캐시 hit/miss 로그를 임시로 넣어보거나, Redis라면 키를 직접 조회해 “실제로 저장이 됐는지”부터 확인합니다.

## 3) 키 설계: 캐시의 80%는 키에서 결정된다

좋은 키의 조건:

- **안정적**: 동일한 요청이면 동일한 키
- **충돌 없음**: 다른 의미의 요청이 같은 키로 합쳐지지 않음
- **버전 가능**: 응답 스키마가 바뀌면 안전하게 분리 가능(버전 prefix)

권장 패턴:

- `user:v1:{id}`
- `product:v1:{id}`
- `search:v2:{normalizedQuery}:{page}:{size}`

Spring Cache에서 키를 커스터마이징하는 방법:

- 단순한 경우: `key = "'user:v1:' + #id"`
- 복잡한 경우: `KeyGenerator`를 구현해서 중앙에서 관리

## 4) TTL과 무효화: “언제까지 믿을 건가”

캐시 정합성을 맞추는 대표 방식은 두 가지입니다.

### 4-1) TTL 기반(시간이 지나면 자동 만료)

- 구현이 단순하지만, TTL 동안은 stale 데이터가 될 수 있습니다.
- “어느 정도 stale이 괜찮다”는 요구사항에 잘 맞습니다(프로필 조회, 공지, 카탈로그 등).

### 4-2) 쓰기 시 무효화/갱신(Write-through/Invalidate)

- 변경이 발생할 때 `@CacheEvict` 또는 `@CachePut`로 정합성을 끌어올립니다.
- 단, “어떤 변경이 어떤 캐시를 깨야 하는지”를 정확히 관리해야 합니다(복잡도 상승).

실무 팁:

- 기본은 TTL + 중요한 변경 포인트에서 최소한의 evict를 섞는 방식이 관리하기 쉽습니다.

## 5) 캐시 스탬피드/penetration: 운영에서 진짜 터지는 문제

### 스탬피드(Cache stampede)

TTL 만료 순간에 다수 요청이 동시에 DB로 몰리는 현상입니다.

완화 방법:

- `@Cacheable(sync = true)`로 “하나만 로드하고 나머지는 대기”하도록(캐시 구현체 지원/환경에 따라 차이)
- TTL에 지터(jitter)를 넣어 만료 시점을 분산
- 핫 키는 사전 워밍업

### 캐시 침투(Cache penetration)

존재하지 않는 키 조회가 DB를 계속 때리는 현상입니다.

완화 방법:

- “없음”도 캐시하기(null 캐싱, 짧은 TTL)
- 입력 검증 강화(말도 안 되는 id를 빠르게 차단)

Spring/Redis에서는 null 캐싱 옵션이 구현체에 따라 다르므로, “없음 캐싱”을 쓸 때는 정책을 명확히 합니다.

## 6) Redis/Caffeine 구성: 최소한의 형태

Boot 설정만으로도 기본 구성이 됩니다.

```yaml
spring:
  cache:
    type: redis
  data:
    redis:
      host: localhost
      port: 6379
```

TTL/직렬화를 더 제어하고 싶다면 `RedisCacheManager`를 명시적으로 구성합니다.

```java
@Bean
public RedisCacheManager cacheManager(RedisConnectionFactory connectionFactory) {
    RedisCacheConfiguration defaultConfig = RedisCacheConfiguration.defaultCacheConfig()
        .entryTtl(Duration.ofMinutes(5));

    Map<String, RedisCacheConfiguration> perCache = Map.of(
        "user", defaultConfig.entryTtl(Duration.ofMinutes(1)),
        "product", defaultConfig.entryTtl(Duration.ofMinutes(10))
    );

    return RedisCacheManager.builder(connectionFactory)
        .cacheDefaults(defaultConfig)
        .withInitialCacheConfigurations(perCache)
        .build();
}
```

로컬 캐시(Caffeine) + 원격 캐시(Redis)로 2단계 캐시를 만들 수도 있지만,
정합성/무효화가 더 어려워지니 “정말 필요할 때”만 도입하는 편이 좋습니다.

## 연습(추천)

- `getUser(id)`에 캐시를 붙이고, 같은 id를 연속 호출했을 때 DB 조회가 줄어드는지 로그로 확인해보기
- “없는 id” 요청이 반복될 때 DB가 계속 맞는지 확인하고, 없음을 캐시했을 때 부하가 줄어드는지 비교해보기
- TTL 만료 순간에 동시 요청을 만들어(간단한 부하 도구) 스탬피드가 생기는지 관찰하고 완화책을 적용해보기
