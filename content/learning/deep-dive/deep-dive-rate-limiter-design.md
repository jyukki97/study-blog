---
title: "Rate Limiter: 트래픽 홍수에서 살아남기"
date: 2025-12-16
draft: false
topic: "System Design"
tags: ["Rate Limiting", "Token Bucket", "Sliding Window", "Redis"]
categories: ["Backend Deep Dive"]
description: "DDoS 방어부터 유료 API 사용량 제한까지. Token Bucket 알고리즘과 Redis 분산 처리"
module: "resilience"
study_order: 501
quizzes:
  - question: "Rate Limiting을 적용하는 가장 중요한 세 가지 이유는?"
    options:
      - "로깅, 캐싱, 인증"
      - "DDoS/트래픽 폭주 방지(Protection), 특정 사용자의 리소스 독점 방지(Fairness), 유료 등급별 사용량 제한(Business)"
      - "성능 향상, 메모리 절약, CPU 최적화"
      - "보안, 인가, 암호화"
    answer: 1
    explanation: "Rate Limiting은 시스템 보호(Protection), 사용자 간 공정성(Fairness), 그리고 비즈니스 모델(유료 플랜 차등) 구현에 핵심적인 역할을 합니다."

  - question: "Token Bucket 알고리즘에서 '버킷 크기(Capacity)'와 '충전 속도(Refill Rate)'가 의미하는 것은?"
    options:
      - "DB 연결 수와 쿼리 속도"
      - "버킷 크기는 허용되는 순간 트래픽(Burst) 양이고, 충전 속도는 지속 가능한 평균 처리량"
      - "메모리 크기와 CPU 속도"
      - "네트워크 대역폭과 지연 시간"
    answer: 1
    explanation: "Token Bucket에서 Capacity=100, Refill Rate=10/sec이면 순간적으로 100개를 처리할 수 있고(Burst), 지속적으로는 초당 10개가 처리 가능한 평균 속도가 됩니다."

  - question: "Fixed Window Rate Limiting의 경계값 문제(두 윈도우 경계에서 2배 트래픽 허용)를 해결하는 방법은?"
    options:
      - "윈도우 크기를 늘린다."
      - "Sliding Window 방식을 사용하여 시간을 겹쳐서 계산한다."
      - "Token Bucket을 사용하면 해결된다."
      - "문제가 되지 않으므로 무시한다."
    answer: 1
    explanation: "Fixed Window는 59초에 100개, 01초에 100개가 들어오면 1분 내 200개를 허용하는 버그가 있습니다. Sliding Window는 현재 시점 기준으로 과거 1분간의 요청을 계산하여 이를 방지합니다."

  - question: "분산 환경에서 Rate Limiting을 구현할 때 Redis와 Lua Script를 함께 사용하는 이유는?"
    options:
      - "Redis가 Lua만 지원하기 때문"
      - "GET → 카운트 증가 → SET 사이의 Race Condition을 방지하기 위해 Lua Script로 원자성(Atomicity)을 보장하기 위해"
      - "Lua가 더 빠르기 때문"
      - "보안을 위해"
    answer: 1
    explanation: "여러 서버가 동시에 Redis를 읽고 쓸 때, 별도의 GET/INCR 명령 사이에 다른 요청이 끼어들 수 있습니다. Lua Script는 Redis에서 원자적으로 실행되어 이 문제를 해결합니다."

  - question: "Rate Limit에 걸린 요청에 `429 Too Many Requests` 응답을 줄 때, 함께 제공하면 좋은 HTTP 헤더는?"
    options:
      - "Content-Type"
      - "Retry-After (재시도 가능 시점 안내)"
      - "Cache-Control"
      - "Authorization"
    answer: 1
    explanation: "`Retry-After` 헤더로 클라이언트에게 언제 다시 요청해도 되는지 알려주면, 클라이언트가 불필요한 재시도 없이 적절히 대기할 수 있어 시스템 부하를 줄입니다."
---

## 🚧 1. 왜 막아야 하나요?

"무한대로 받으면 좋은 거 아닌가요?"
아닙니다. 모든 시스템은 용량의 한계가 있습니다.

1. **Protection**: DDoS 공격이나 버그로 인한 트래픽 폭주 방지.
2. **Fairness**: 특정 사용자가 리소스를 독점하지 못하게 함 (Neighbor Problem).
3. **Business**: 유료 플랜에 따른 등급 나누기 (Free: 100req/min, Pro: 1000req/min).

---

## 🪣 2. Token Bucket 알고리즘

가장 널리 쓰이는 알고리즘입니다. AWS, Google Guava 등에서 채택했습니다.

```mermaid
graph TD
    Bucket[버킷 (Token 통)]
    Refill[충전 기계] -->|초당 N개| Bucket
    User["사용자 요청"] -->|"1. 토큰 있니?"| Bucket
    
    Bucket -->|Yes (토큰 -1)| Success[요청 처리]
    Bucket -->|No (0개)| Fail[429 Too Many Requests]
    
    style Bucket fill:#f9f,stroke:#333
```

- **버킷 크기 (Capacity)**: 최대 모을 수 있는 토큰 수. (이만큼의 **순간 트래픽(Burst)** 을 허용함)
- **충전 속도 (Refill Rate)**: 초당 몇 개씩 생기나. (지속 가능한 평균 처리량)

> **비유**: 지하철 개찰구에 표를 미리 10장 사둔 사람은 연속으로 10명 빠르게 지나갈 수 있습니다. 하지만 표가 떨어지면 매표소에서 한 장씩 사야 하니 속도가 느려집니다.

---

## 🪟 3. Sliding Window (슬라이딩 윈도우)

"1분에 100개 제한"인데, **59초에 100개, 01초에 100개**가 들어오면?
고정 윈도우(Fixed Window) 방식은 경계값 부근에서 2배의 트래픽을 허용하는 버그가 있습니다.

이를 막기 위해 **Sliding Window**는 시간을 겹쳐서 계산합니다.
(Redis의 `ZSET`을 이용해 타임스탬프 로그를 저장하고 `count`하는 방식이 정확하지만, 메모리를 많이 씁니다.)

```mermaid
gantt
    title Fixed vs Sliding Window (Limit: 1/min)
    dateFormat X
    axisFormat %s
    
    section Traffic
    Req A (T=59s) :done, 59, 60
    Req B (T=61s) :active, 61, 62
    
    section Fixed Window
    Window 1 (0-60s) :crit, 0, 60
    Window 2 (60-120s) :crit, 60, 120
    
    section Sliding Window
    Window at T=61 (1-61s) :active, 1, 61
```

---

## ⚡ 4. 분산 환경 구현의 핵심: Redis + Lua

서버가 여러 대일 때, 로컬 메모리(HashMap)에 카운트를 저장하면 구멍이 숭숭 뚫립니다.
**중앙 저장소(Redis)** 가 필요합니다.

하지만 `GET` -> `계산` -> `SET` 사이에 Race Condition이 발생합니다.
그래서 **Lua Script**로 원자성(Atomicity)을 보장해야 합니다.

```mermaid
sequenceDiagram
    participant App
    participant Redis
    participant Lua
    
    App->>Redis: EVAL script
    Note over Redis, Lua: Atomicity Guaranteed
    
    Redis->>Lua: Run Logic
    Lua->>Redis: GET key (Current Count)
    Redis-->>Lua: Returns 10
    
    alt Count < Limit
        Lua->>Redis: INCR key
        Lua->>Redis: EXPIRE key
        Lua-->>Redis: Return 1 (Allowed)
    else Count >= Limit
        Lua-->>Redis: Return 0 (Blocked)
    end
    
    Redis-->>App: Response
```

```lua
-- redis_rate_limit.lua
local key = KEYS[1]
local limit = tonumber(ARGV[1])

local current = tonumber(redis.call('get', key) or "0")

if current + 1 > limit then
    return 0 -- 차단
else
    redis.call('incr', key)
    redis.call('expire', key, 60) -- 1분 TTL
    return 1 -- 통과
end
```

## 요약

1. **알고리즘**: **Token Bucket**이 표준. 버스트 혀용이 싫으면 Leaky Bucket.
2. **위치**: API Gateway나 앞단에서 막을수록 좋다. (App 서버 리소스 보호)
3. **구현**: 분산 환경에서는 Redis Lua Script로 원자성을 챙겨라.
4. **응답**: 그냥 거절하지 말고 `Retry-After` 헤더를 줘라. (클라이언트 예절)
