---
title: "Redis Cache Stampede 방지 실전: 락, 조기만료, 이중 캐시"
date: 2026-02-12
draft: false
topic: "Caching"
tags: ["Redis", "Cache Stampede", "Thundering Herd", "Distributed Lock", "Lua"]
categories: ["Backend Deep Dive"]
description: "TTL 만료 폭발을 막는 락/조기만료/이중 캐시 전략과 실전 코드 패턴"
module: "data-system"
quizzes:
  - question: "Cache Stampede(Thundering Herd)의 핵심 원인은?"
    options:
      - "캐시 히트율이 너무 높은 것"
      - "핫 키가 만료되는 순간 다수의 요청이 동시에 DB를 조회하는 것"
      - "Redis 메모리가 부족한 것"
      - "네트워크 지연이 큰 것"
    answer: 1
    explanation: "핫 키의 TTL 만료 시점에 동시 요청이 DB로 쏠리면서 백엔드를 마비시키는 현상이 Cache Stampede입니다."

  - question: "분산 락을 사용할 때 가장 중요한 구현 포인트는?"
    options:
      - "락을 영원히 유지한다"
      - "락 획득 실패 시 무한 대기"
      - "만료 시간을 반드시 설정하고, 해제는 소유자만 가능하게 한다"
      - "락 키를 여러 개 만든다"
    answer: 2
    explanation: "락이 해제되지 않으면 장애가 되므로 만료 시간을 두고, 소유자 토큰을 검증해 안전하게 해제해야 합니다."

  - question: "조기 만료(Early Expiration) 전략의 장점은?"
    options:
      - "캐시 데이터를 항상 최신으로 유지한다"
      - "만료 직전부터 확률적으로 갱신하여 동시 재생성 폭발을 줄인다"
      - "TTL을 없앤다"
      - "락 없이도 완벽한 정합성을 보장한다"
    answer: 1
    explanation: "조기 만료는 만료 직전 확률적으로 갱신을 시도해 재생성 요청을 분산시키는 전략입니다."

  - question: "이중 캐시(L1/L2) 전략이 유리한 상황은?"
    options:
      - "요청이 아주 적은 서비스"
      - "핫 키가 매우 자주 조회되는 서비스"
      - "데이터 정합성이 절대적인 금융 시스템"
      - "캐시를 사용하지 않는 서비스"
    answer: 1
    explanation: "핫 키가 많고 조회가 매우 잦은 경우, 애플리케이션 로컬 캐시(L1)가 Redis(L2)까지의 부하를 줄여줍니다."
study_order: 309
---

## 이 글에서 얻는 것

- Cache Stampede의 구조적 원인을 설명할 수 있습니다.
- **분산 락 + 조기 만료 + 이중 캐시**를 조합하는 실전 패턴을 이해합니다.
- 실제 코드로 안전한 락 획득/해제를 구현할 수 있습니다.

## 1) 문제 상황: TTL 만료 순간 폭발

핫 키가 만료되는 순간, 동시에 수천 개 요청이 DB로 쏠리면 **DB가 먼저 죽습니다**.
이를 막기 위해 단순 TTL 외에 추가 전략이 필요합니다.

## 2) 기본 전략 3가지

### 2-1. 분산 락으로 단일 재생성 보장

한 번에 한 요청만 DB를 조회해 캐시를 다시 채우게 합니다.

```java
public String getUserProfile(String userId) {
    String key = "user:" + userId;
    String cached = redis.get(key);
    if (cached != null) return cached;

    String lockKey = "lock:" + key;
    String token = UUID.randomUUID().toString();
    boolean locked = redis.set(lockKey, token, 5, TimeUnit.SECONDS, NX);

    if (!locked) {
        sleep(80); // 짧게 대기 후 재시도
        return redis.get(key); // 재조회
    }

    try {
        String fresh = db.loadUser(userId);
        redis.set(key, fresh, 60, TimeUnit.SECONDS);
        return fresh;
    } finally {
        // 안전한 락 해제: 토큰 검증
        releaseLock(lockKey, token);
    }
}
```

Lua로 안전 해제:

```lua
-- unlock.lua
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
```

### 2-2. 조기 만료 (Probabilistic Early Expiration)

TTL이 끝나기 전에 **확률적으로 갱신**하여 요청을 분산시킵니다.

```java
boolean shouldRefresh(double ttlLeftSec) {
    // 만료가 가까울수록 확률을 증가
    double p = Math.exp(-ttlLeftSec / 10.0);
    return Math.random() < p;
}
```

- 10초 남았을 때 30% 갱신
- 2초 남았을 때 80% 갱신

### 2-3. 이중 캐시 (L1/L2)

- **L1 (로컬 캐시, Caffeine)**: 초고속, 짧은 TTL
- **L2 (Redis)**: 공유 캐시, 긴 TTL

```java
String get(String key) {
    String v = localCache.getIfPresent(key);
    if (v != null) return v;

    v = redis.get(key);
    if (v != null) {
        localCache.put(key, v);
        return v;
    }

    v = db.load(key);
    redis.set(key, v, 60, TimeUnit.SECONDS);
    localCache.put(key, v);
    return v;
}
```

## 3) 운영 체크리스트

- 락 키 TTL이 너무 길면 장애 유발
- 조기 만료 확률/시간은 **트래픽 패턴**에 맞게 튜닝
- 핫 키는 별도 모니터링 (Top N 키, hit/miss율)

## 4) 실무 설계 팁

1. **락 없는 캐시 재생성**은 소규모 트래픽에만 허용
2. **락 + 조기만료** 조합이 가장 현실적
3. Redis 장애 대비를 위해 **fallback**(DB 타임아웃/서킷브레이커)도 필요

## 요약

- Cache Stampede는 TTL 만료 시점의 **동시 재생성 폭발**이다.
- **분산 락**, **조기 만료**, **이중 캐시**는 서로 보완 관계다.
- 락 해제는 반드시 **소유자 토큰 검증**으로 안전하게 처리해야 한다.

## 연습(추천)

- 인기 키의 TTL을 5초로 줄여 스탬피드 상황을 재현해보기
- 조기 만료 확률을 바꿔가며 DB QPS 변화를 측정해보기
- 로컬 캐시(L1) 유무에 따라 Redis 부하 차이를 비교해보기
