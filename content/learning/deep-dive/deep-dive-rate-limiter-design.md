---
title: "시스템 설계: Rate Limiter"
date: 2025-12-16
draft: false
topic: "System Design"
tags: ["Rate Limiting", "Token Bucket", "Sliding Window", "Redis"]
categories: ["Backend Deep Dive"]
description: "Token Bucket, Leaky Bucket, Sliding Window 알고리즘과 분산 환경에서의 구현 전략"
module: "data-system"
study_order: 295
---

## 알고리즘 비교

- Token Bucket: 토큰 충전/소비, 버스트 허용
- Leaky Bucket: 고정 배출량, 완화된 버스트
- Sliding Window: 실제 요청 타임스탬프 기반, 정확도 높음

## Redis 구현 예시 (슬라이딩 윈도우)

```lua
-- key, now, window, limit
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, now)
  redis.call('EXPIRE', key, window)
  return 1
end
return 0
```

## 체크리스트

- [ ] 키 설계: 사용자/IP/클라이언트별
- [ ] 버스트 허용량, 창 크기, 응답 코드/메시지 정의
- [ ] 분산 락 혹은 Lua 스크립트로 원자성 확보
- [ ] 모니터링: 차단율/허용율/지연 시간 지표
