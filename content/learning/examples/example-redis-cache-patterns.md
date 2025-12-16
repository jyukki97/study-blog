---
title: "Redis 캐시 패턴 모음"
date: 2025-12-16
draft: false
topic: "Redis"
tags: ["Redis", "Cache Aside", "Write Through", "TTL", "분산락"]
categories: ["Development", "Learning"]
description: "Cache-Aside, Write-Through, Write-Behind, 분산락 패턴을 코드 예시와 함께 정리"
module: "data-system"
study_order: 230
---

## 이 글에서 얻는 것

- Redis 캐시를 “붙여서 빨라짐” 수준이 아니라, **패턴(읽기/쓰기/무효화/락)** 으로 선택할 수 있습니다.
- Cache-Aside/Write-Through/Write-Behind의 트레이드오프(정합성/지연/장애 시나리오)를 정리할 수 있습니다.
- TTL/키 스키마/스탬피드/침투 같은 운영 이슈를 설계 단계에서 예방할 수 있습니다.

## 0) 캐시의 기본 전제: 정합성 요구사항부터 확정

캐시는 “정답”이 아니라, 정합성과 성능 사이의 선택입니다.

- 약간의 stale이 허용된다 → TTL 기반 캐시가 단순하고 효과적
- 변경 즉시 반영이 필요하다 → 무효화/갱신이 필요(복잡도 증가)

## 1) Cache-Aside: 가장 흔한 기본 패턴

읽기 시 캐시를 먼저 보고, 없으면 DB에서 읽어서 캐시에 적재합니다.

```java
String getUser(String key) {
    String cached = redis.get(key);
    if (cached != null) return cached;

    String data = db.findUser(key);
    redis.setex(key, 3600, data);
    return data;
}
```

장점:

- 구현이 단순하고, 캐시 장애 시에도 DB로 폴백 가능

주의:

- 스탬피드(만료 순간 동시 요청)와 침투(없는 키 반복 요청)에 대비가 필요

## 2) Write-Through / Write-Behind: 쓰기 경로를 바꿔서 얻는 것/잃는 것

### Write-Through(정합성 우선)

- DB 쓰기 직후 캐시도 갱신합니다.
- 읽기는 빠르고 정합성은 높지만, 쓰기 경로가 느려지고(두 번 쓰기) 장애 전파가 커질 수 있습니다.

### Write-Behind(성능 우선)

- 캐시에만 쓰고, 나중에 비동기로 DB에 반영합니다.
- 쓰기는 빠르지만 유실/중복/순서 문제가 생길 수 있어 “로그/큐/재처리” 설계가 사실상 필수입니다.

## 3) 분산락(Distributed Lock): 필요한 경우에만, 짧게

```java
boolean acquired = redis.set(lockKey, uuid, "NX", "PX", 3000);
try {
    if (acquired) {
        // critical section
    }
} finally {
    // LUA 스크립트로 본인 락만 해제
}
```

실무 포인트:

- 락은 반드시 TTL이 있어야 합니다(무한 락 금지).
- unlock은 “내가 잡은 락만” 풀어야 합니다(UUID 비교 + Lua).
- 분산락은 만능이 아닙니다. DB 유니크 제약/트랜잭션으로 해결 가능한지 먼저 검토하는 편이 안전합니다.

## 4) 운영에서 자주 터지는 문제와 대응

### 캐시 스탬피드(Cache Stampede)

핫 키가 만료되는 순간 DB로 동시 요청이 몰립니다.

대응:

- TTL에 지터(jitter)로 만료 분산
- “하나만 로드”하도록 락/싱글플라이트(환경에 따라)
- 핫 키 워밍업

### 캐시 침투(Cache Penetration)

없는 데이터 요청이 반복되면 캐시가 항상 miss → DB로 계속 갑니다.

대응:

- 없음을 캐시(null 캐싱, 짧은 TTL)
- 입력 검증/차단

### 키 스키마/무효화

- 키 스키마를 고정하세요: `prefix:entity:version:id`
- 대량 무효화가 필요하면 “버전 키(네임스페이스)”로 한 번에 바꾸는 전략도 고려합니다.

## 5) 자주 하는 실수

- TTL 없이 캐시를 넣어 stale 데이터가 영구히 남는 경우
- 키 스키마가 제각각이라 운영에서 추적/무효화가 어려운 경우
- 락 TTL 없이 분산락을 걸어 장애 시 영구 락이 되는 경우

## 연습(추천)

- Cache-Aside에 TTL 지터를 적용해 스탬피드가 줄어드는지 관찰해보기
- “없는 데이터” 요청이 반복될 때 DB 부하가 어떻게 변하는지 보고, null 캐싱으로 개선해보기
- 분산락을 적용해 “중복 처리”를 막는 예제를 만든 뒤, DB 유니크 제약으로도 해결 가능한지 비교해보기
