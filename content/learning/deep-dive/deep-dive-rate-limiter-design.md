---
title: "시스템 설계: Rate Limiter"
date: 2025-12-16
draft: false
topic: "System Design"
tags: ["Rate Limiting", "Token Bucket", "Sliding Window", "Redis"]
categories: ["Backend Deep Dive"]
description: "Token Bucket, Leaky Bucket, Sliding Window 알고리즘과 분산 환경에서의 구현 전략"
module: "architecture"
study_order: 458
---

## 이 글에서 얻는 것

- Rate Limiting이 왜 필요한지(보호/공정성/비용)와 어디에 둘지(Edge/Gateway/App) 설계할 수 있습니다.
- Token Bucket / Leaky Bucket / (Fixed/Sliding) Window 알고리즘의 트레이드오프를 이해하고 요구사항에 맞춰 선택할 수 있습니다.
- 분산 환경에서 Redis로 “원자적” 레이트 리미터를 구현할 때 주의할 점(키 설계, TTL, 동시성, 장애 시 정책)을 정리할 수 있습니다.

## 0) 레이트 리미터는 ‘정책’이다

먼저 정책을 명확히 해야 구현이 흔들리지 않습니다.

- 무엇을 기준으로 제한할까? (IP / userId / API key / tenant)
- 어디에 적용할까? (전체 서비스 / 특정 엔드포인트 / 특정 기능)
- 제한을 넘으면 무엇을 돌려줄까? (429 + `Retry-After`)
- 장애 시 어떻게 할까? (fail-open: 통과 / fail-closed: 차단)

## 1) 알고리즘 선택: 정확도 vs 비용 vs 버스트 허용

### Fixed Window Counter(고정 창)

- “매 분 100회” 같은 형태로 단순합니다.
- 경계에서 버스트가 생길 수 있습니다(59초에 100회 + 60초에 100회).

### Sliding Window Log(슬라이딩 로그)

- 요청 타임스탬프를 모두 기록해 가장 정확합니다.
- 대신 저장/삭제 비용이 커지고, 요청이 많으면 메모리가 증가합니다.

### Sliding Window Counter(근사)

- 고정 창 2개를 가중합하는 형태로 근사합니다.
- 정확도는 조금 떨어지지만 비용이 낮습니다.

### Token Bucket(버스트 허용)

- 토큰이 시간에 따라 충전되고, 요청은 토큰을 소비합니다.
- “짧은 버스트는 허용하되 장기 평균은 제한”에 좋습니다.

### Leaky Bucket(출력 평탄화)

- 일정 속도로 “흘려보내는” 모델이라 버스트를 완화합니다.
- 큐/대기 모델과 결합하면 UX가 달라질 수 있습니다(대기 vs 즉시 차단).

## 2) 어디에 두나: 계층형이 실전에서 강하다

- Edge(CDN/WAF): DDoS/봇 차단, IP 기반 대규모 방어(가장 앞단)
- API Gateway: 인증 후 userId/API key 기반 정책(서비스 공통)
- Application: 도메인 특화 제한(예: 결제 시도, 로그인 시도)

앞단에서 대규모 트래픽을 줄이고, 뒷단에서 정교한 정책을 적용하는 방식이 운영에 유리합니다.

## 3) 분산 환경에서의 핵심: “원자성”과 “키 설계”

여러 서버가 동시에 같은 키를 제한하면, 중앙 저장소에서 원자적으로 카운팅해야 합니다.

그래서 Redis에서 흔히 쓰는 방식:

- `INCR` + TTL(고정 창)
- `ZSET` + Lua(슬라이딩 로그)
- Lua로 Token Bucket 계산

키 설계 예시:

- `rl:v1:ip:{ip}:login`
- `rl:v1:user:{userId}:api:{endpoint}`

키에는 “버전”을 넣어 정책 변경/대량 무효화에 대비하는 편이 안전합니다.

## 4) Redis 구현 예시: Sliding Window Log(Lua)

슬라이딩 로그는 정확하지만, 구현 디테일이 중요합니다.

- 같은 ms에 여러 요청이 오면 ZSET member가 충돌할 수 있어 “유니크 member”가 필요합니다.
- TTL은 ms 단위라면 `PEXPIRE`를 사용해야 합니다.

```lua
-- KEYS[1] = key
-- ARGV[1] = now(ms)
-- ARGV[2] = window(ms)
-- ARGV[3] = limit
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

-- 오래된 요청 제거
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

local count = redis.call('ZCARD', key)
if count >= limit then
  return 0
end

-- member 충돌 방지(동일 timestamp 중복)
local seqKey = key .. ':seq'
local seq = redis.call('INCR', seqKey)
redis.call('PEXPIRE', seqKey, window)

local member = tostring(now) .. '-' .. tostring(seq)
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)

return 1
```

이 스크립트는 “한 번의 평가/삽입”이 원자적으로 이뤄져서 분산 환경에서도 안전합니다.

## 5) 응답/헤더: 클라이언트를 ‘올바르게’ 유도하기

레이트리밋은 차단만이 아니라, 클라이언트가 재시도 타이밍을 이해하게 해야 합니다.

- `429 Too Many Requests`
- 가능한 경우 `Retry-After` 헤더 제공

## 6) 모니터링/운영 포인트

- 차단율(block rate) / 허용율(allow rate)
- 상위 차단 키(top offenders)
- 레이트리미터 자체 지연(Redis round-trip)
- Redis 장애 시 정책(fail-open/closed)과 알람

## 7) 자주 하는 실수

- IP만 기준으로 해서 NAT 환경에서 정상 사용자가 묶이는 경우
- 키 설계가 불안정해서(요청마다 키가 달라짐) 제한이 안 먹는 경우
- TTL 단위를 잘못 적용해서 제한 창이 깨지는 경우
- 장애 시 정책이 없어서 Redis 장애가 곧 서비스 장애로 번지는 경우

## 연습(추천)

- 로그인/회원가입/댓글 작성 같은 민감 엔드포인트 3개를 골라 “키 설계 + 정책(창/limit/버스트)”을 작성해보기
- fail-open vs fail-closed를 각각 선택했을 때 어떤 사고가 가능한지 시나리오를 적어보기
- Token Bucket을 Redis Lua로 구현해보고, 버스트 허용이 실제로 어떻게 동작하는지 테스트해보기
