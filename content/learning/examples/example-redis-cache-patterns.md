---
title: "Redis 캐시 패턴 모음"
date: 2025-12-16
draft: false
topic: "Redis"
tags: ["Redis", "Cache Aside", "Write Through", "TTL", "분산락"]
categories: ["Development", "Learning"]
description: "Cache-Aside, Write-Through, Write-Behind, 분산락 패턴을 코드 예시와 함께 정리"
module: "data-system"
study_order: 33
---

## Cache-Aside

```java
String getUser(String key) {
    String cached = redis.get(key);
    if (cached != null) return cached;
    String data = db.findUser(key);
    redis.setex(key, 3600, data);
    return data;
}
```

## Write-Through / Write-Behind

- Write-Through: DB 쓰기 직후 캐시 갱신
- Write-Behind: 캐시에만 쓰고 배치로 DB 반영 → 지연/유실 대비 큐/로그 필요

## 분산락 (간단 예시)

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

## 체크리스트

- [ ] TTL + 슬라이딩 만료로 스톰 방지 (서로 다른 만료 시간 분포)
- [ ] 캐시 키 스키마 정의: prefix:entity:id
- [ ] 대용량 무효화는 버전 키(네임스페이스)로 처리 고려
- [ ] 분산락은 타임아웃/재시도/재진입 여부를 명시
