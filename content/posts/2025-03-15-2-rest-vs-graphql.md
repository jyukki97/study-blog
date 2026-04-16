---
title: "REST vs GraphQL 성능 비교: 실제 테스트 결과"
date: 2025-03-15
draft: false
tags: ["REST", "GraphQL", "성능테스트", "API", "벤치마크"]
categories: ["Development"]
description: "REST와 GraphQL의 실제 성능을 wrk로 비교하고, 어떤 상황에서 무엇을 선택해야 하는지 실무 기준으로 정리한다."
keywords: ["REST GraphQL 비교", "GraphQL 성능", "REST API 벤치마크", "API 아키텍처 선택"]
cover:
  image: "/images/graphql-vs-rest.png"
  alt: "REST vs GraphQL 성능 비교"
  caption: "REST와 GraphQL 성능 벤치마크 결과"
---

## 개요

> 이전 글에서 **gRPC**, **REST**, **GraphQL**을 훑어봤다.  
> 이번에는 감으로 말하지 않고, 실제 요청을 때려 보면서 **REST와 GraphQL이 어느 정도 차이 나는지** 확인해 본다.

결론부터 말하면, 이번 테스트에서는 **REST가 더 빠르고 CPU도 덜 사용했다.** 다만 여기서 바로 "GraphQL은 느리니까 쓰지 말자"로 결론 내리면 조금 성급하다. 성능 수치만 볼 게 아니라 **데이터 조합 유연성, BFF 구성 난이도, 프런트엔드 생산성, 캐싱 전략**까지 같이 봐야 하기 때문이다.

이 글은 단순 비교표로 끝내지 않고, 아래 질문에 답하는 쪽으로 정리했다.

- 목록 조회와 단건 조회에서 실제 차이가 얼마나 나는가?
- 왜 이런 차이가 생겼는가?
- 실무에서는 어느 조건에서 REST를, 어느 조건에서 GraphQL을 택하는가?

## 성능 테스트 환경

- **도구**: `wrk` (HTTP 벤치마킹 도구)
- **설정**: 8 threads, 100 connections, 30초 동안 테스트
- **대상**: 게시물 목록 조회 API, 게시물 단건 조회 API
- **비교 관점**: 응답 시간, 처리량, 전송량, CPU 사용량

테스트 조건을 아주 공정한 논문 수준으로 맞춘 것은 아니고, **동일한 애플리케이션에서 동일한 도메인 데이터를 조회할 때 어느 쪽이 상대적으로 더 무거운지** 보는 용도에 가깝다. 그래서 아래 수치는 절대값보다 **경향성**으로 읽는 편이 맞다.

## 테스트 결과

### 1) 게시물 목록 조회

#### REST API 테스트

```bash
wrk -t8 -c100 -d30s http://localhost:8080/posts

// -------
8 threads and 100 connections
Thread Stats   Avg      Stdev     Max   +/- Stdev
  Latency   143.24ms   49.04ms 589.18ms   85.56%
  Req/Sec    84.58     18.74   128.00     74.96%
20234 requests in 30.10s, 2.53GB read
Requests/sec:    672.18
Transfer/sec:     85.93MB
```

#### GraphQL 테스트

```bash
wrk -t8 -c100 -d30s -s ./test-grapql-post-list.lua http://localhost:8080/graphql

// -------
8 threads and 100 connections
Thread Stats   Avg      Stdev     Max   +/- Stdev
  Latency   225.51ms   73.18ms 850.47ms   85.31%
  Req/Sec    53.34     18.47   131.00     71.55%
12770 requests in 30.06s, 0.90GB read
Requests/sec:    424.83
Transfer/sec:     30.70MB
```

| 비교 항목 | REST API | GraphQL | 해석 |
|---|---|---|---|
| 평균 응답 시간 (Latency) | 143.24ms | 225.51ms | GraphQL이 약 1.57배 느림 |
| 초당 요청 처리량 (Requests/sec) | 672.18 req/sec | 424.83 req/sec | REST가 약 1.58배 더 많이 처리 |
| 최대 응답 시간 (Max Latency) | 589.18ms | 850.47ms | GraphQL의 꼬리 지연이 더 큼 |
| 총 요청 수 | 20,234 req | 12,770 req | 같은 시간 동안 처리량 차이 확인 |
| 데이터 전송량 (Transfer/sec) | 85.93MB/sec | 30.70MB/sec | GraphQL 응답이 더 작았지만 서버는 더 바빴음 |

![목록 조회 시 CPU 사용량 비교](/images/rest-grpc-post-cpu-usage.png)

| Metric | REST API | GraphQL | 해석 |
|---|---|---|---|
| Average CPU Usage (%) | 281.98% | 549.1% | GraphQL이 약 1.95배 높음 |
| Max CPU Usage (%) | 328.9% | 632.8% | 피크 구간에서도 차이 유지 |

여기서 재미있는 지점은 **GraphQL의 전송량은 더 적은데 CPU는 더 많이 먹었다**는 점이다. 즉 병목이 네트워크가 아니라 **서버 내부 처리 비용**에 더 가깝다는 뜻이다.

### 2) 단건 조회(댓글 포함)

```bash
wrk -t8 -c100 -d30s http://localhost:8080/posts/1

// -------
8 threads and 100 connections
Thread Stats   Avg      Stdev     Max   +/- Stdev
  Latency    22.63ms    8.89ms 105.55ms   78.00%
  Req/Sec   536.37    113.74     1.32k    76.25%
128274 requests in 30.08s, 44.28MB read
Requests/sec:   4264.89
Transfer/sec:      1.47MB
```

```bash
wrk -t8 -c100 -d30s -s ./test-grapql-post-comment.lua http://localhost:8080/graphql

// -------
8 threads and 100 connections
Thread Stats   Avg      Stdev     Max   +/- Stdev
  Latency    45.72ms   14.19ms 201.01ms   86.96%
  Req/Sec   263.78     39.41   450.00     67.62%
63127 requests in 30.05s, 32.15MB read
Requests/sec:   2100.63
Transfer/sec:      1.07MB
```

| 비교 항목 | REST API | GraphQL | 해석 |
|---|---|---|---|
| 평균 응답 시간 (Latency) | 22.63ms | 45.72ms | GraphQL이 약 2배 느림 |
| 초당 요청 처리량 (Requests/sec) | 4264.89 req/sec | 2100.63 req/sec | REST가 약 2배 많이 처리 |
| 최대 응답 시간 (Max Latency) | 105.55ms | 201.01ms | 고부하 시 GraphQL이 더 불안정 |
| 총 요청 수 | 128,274 req | 63,127 req | 단건 조회에서도 차이 유지 |
| 데이터 전송량 (Transfer/sec) | 1.47MB/sec | 1.07MB/sec | 응답 크기 이점이 처리량 손실을 상쇄하지 못함 |

![단건 조회 시 CPU 사용량 비교](/images/rest-grpc-comment-cpu-usage.png)

| Metric | REST API | GraphQL | 해석 |
|---|---|---|---|
| Average CPU Usage (%) | 128.75% | 153.2% | GraphQL이 약 1.19배 높음 |
| Max CPU Usage (%) | 148.0% | 172.0% | 부하 피크도 더 큼 |

## 왜 이런 차이가 났을까

이번 결과만 보면 이유는 꽤 단순하다.

1. **GraphQL은 파싱과 검증 비용이 추가된다**  
   요청마다 쿼리 문서를 해석하고, 스키마 검증과 리졸버 실행 계획을 거친다.

2. **리졸버 구조가 잘못 잡히면 호출이 분산된다**  
   REST는 보통 하나의 핸들러에서 한 번에 데이터를 조합하지만, GraphQL은 필드별 리졸버 설계에 따라 내부 호출 수가 늘어나기 쉽다. 흔히 말하는 N+1 문제가 여기서 많이 터진다.

3. **캐싱 전략이 REST보다 복잡하다**  
   REST는 URL 단위 캐시가 직관적이지만, GraphQL은 POST 기반 요청이 많고 쿼리 shape도 달라져 캐시 적중 전략을 별도로 설계해야 한다.

4. **응답 크기 최적화 이점이 항상 승리하지는 않는다**  
   GraphQL은 필요한 필드만 가져오므로 payload는 줄 수 있다. 하지만 이번 케이스처럼 서버 CPU가 병목이면, 네트워크 절약보다 실행 비용이 더 크게 보일 수 있다.

## 그래서 실무에서는 뭘 고르면 되나

### REST가 더 잘 맞는 경우

- 조회 패턴이 비교적 고정적이다.
- CDN/HTTP 캐시를 강하게 활용하고 싶다.
- 팀이 운영 단순성과 예측 가능한 성능을 더 중시한다.
- API 소비자가 많고, 문서화/버전 관리 기준을 명확하게 가져가야 한다.

### GraphQL이 잘 맞는 경우

- 화면마다 필요한 데이터 조합이 계속 다르다.
- 여러 백엔드/마이크로서비스를 BFF에서 유연하게 묶어야 한다.
- 프런트엔드 팀이 스키마 기반으로 빠르게 실험해야 한다.
- over-fetching, under-fetching이 반복적으로 생산성을 깎고 있다.

핵심은 **GraphQL은 성능을 위해 선택하는 기술이라기보다, 데이터 접근 유연성과 프런트엔드 생산성을 위해 선택하는 기술**이라는 점이다. 성능은 기본적으로 설계와 운영으로 방어해야 한다.

## 도입 전에 체크할 질문

- 정말로 프런트가 필드 선택 유연성을 크게 필요로 하는가?
- 리졸버 N+1을 막기 위한 DataLoader나 배치 전략이 준비돼 있는가?
- 캐싱, persisted query, rate limit 기준을 운영팀이 감당할 수 있는가?
- 단순 CRUD API 몇 개를 예쁘게 만들고 싶은 수준은 아닌가?

이 질문에 대부분 "아직 아니다"라면 REST가 더 좋은 기본값일 가능성이 크다.

## 이 테스트를 해석할 때의 주의점

이 결과는 어디까지나 **특정 구현체, 특정 쿼리, 특정 데이터 모델** 기준이다. GraphQL 서버를 persisted query, resolver batching, response caching까지 포함해 잘 튜닝하면 격차가 줄어들 수 있다. 반대로 REST도 엔드포인트가 지나치게 잘게 쪼개져 있으면 클라이언트 왕복이 늘어나 비효율이 생길 수 있다.

즉, 이번 결과는 "GraphQL은 무조건 느리다"가 아니라 아래 정도로 해석하는 게 맞다.

> 기본 상태에서 단순 조회 API를 비교하면, REST가 더 가볍고 예측 가능하게 나오는 경우가 많다.  
> GraphQL은 그 복잡성을 감당할 만큼의 명확한 이점이 있을 때 쓰는 편이 합리적이다.

## 결론

정리하면 이렇다.

- **성능만 보면** 이번 실험에서는 REST가 확실히 우세했다.
- **운영 비용까지 포함하면** 단순 서비스의 기본 선택지는 여전히 REST 쪽이 편하다.
- **하지만 화면별 데이터 조합 유연성이 핵심인 서비스라면** GraphQL은 충분히 고려할 가치가 있다.

내 기준에서는, 특별한 이유가 없다면 **기본값은 REST**, 명확한 프런트엔드 조합 문제나 BFF 요구가 있을 때만 **GraphQL을 선택**하는 쪽이 더 현실적이다.

## 체크리스트

- [ ] 현재 서비스에서 over-fetching / under-fetching 문제가 반복되고 있는가?
- [ ] GraphQL 도입 시 resolver batching, 캐싱, 관측 지표까지 설계할 준비가 되어 있는가?
- [ ] REST로도 충분히 해결 가능한 요구를 과하게 복잡하게 만들고 있지는 않은가?
- [ ] 선택 기준이 "유행"이 아니라 "운영상 이점"으로 설명되는가?

## 관련 글

- [REST vs gRPC 비교](/posts/2025-03-09-rest_vs_grpc/)
- [API Gateway 설계](/learning/deep-dive/deep-dive-api-gateway-design/)
- [GraphQL 스키마 설계](/learning/deep-dive/deep-dive-graphql-schema-design/)
- [GraphQL 심화](/learning/deep-dive/deep-dive-graphql-advanced/)
- [캐시 일관성과 무효화](/learning/deep-dive/deep-dive-cache-consistency-invalidation-playbook/)
