---
title: "REST vs GraphQL 성능 비교: 실제 테스트 결과"
date: 2025-03-15
draft: false
tags: ["REST", "GraphQL", "성능테스트", "API", "벤치마크"]
categories: ["Development"]
description: "REST와 GraphQL의 실제 성능을 wrk를 사용해 벤치마크 테스트로 비교해보자."
cover:
  image: "/images/graphql-vs-rest.png"
  alt: "REST vs GraphQL 성능 비교"
  caption: "REST와 GraphQL 성능 벤치마크 결과"
---

## 개요

> 이전 포스트에서 **gRPC**, **REST**, **GraphQL**에 대해 알아봤다.  
> **GraphQL**이 REST를 완전히 대체할 만큼 매력적이지는 않았지만, 성능 측면에서는 어떨지 직접 테스트해보자.

## 성능 테스트 환경

- **도구**: wrk (HTTP 벤치마킹 도구)
- **설정**: 8 threads, 100 connections, 30초 동안 테스트
- **대상**: 게시물 목록 조회 API

## 테스트 결과

### REST API 테스트

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

| 비교 항목 | REST API | GraphQL | 비고 |
|---|---|---|---|
| 평균 응답 시간 (Latency) | 143.24ms | 225.51ms | 1.57배 느림 |
| 초당 요청 처리량 (Requests/sec) | 672.18 req/sec | 424.83 req/sec | 1.58배 낮음 |
| 최대 응답 시간 (Max Latency) | 589.18ms	 | 850.47ms | |
| 총 요청 수 | 2,0234 req | 1,2770 req |  |
| 데이터 전송량 (Transfer/sec) | 85.93MB/sec | 30.70MB/sec | |

<br>

<img src="{{site.baseurl}}/assets/images/rest-grpc-post-cpu-usage.png">

| Metric | REST API | GraphQL | 비고 |
|---|---|---|---|
| Average CPU Usage (%) | 281.98% | 549.1% | 1.95배 높음 |
| Max CPU Usage (%) | 328.9% | 632.8% | 1.92배 높음 |

<br>

### 단건 조회 (댓글 포함)

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

| 비교 항목 | REST API | GraphQL | 비고 |
|---|---|---|---|
| 평균 응답 시간 (Latency) | 22.63ms | 45.72ms | 2배 느림 |
| 초당 요청 처리량 (Requests/sec) | 4264.89 req/sec | 2100.63 req/sec | 2배 낮음 |
| 최대 응답 시간 (Max Latency) | 105.55ms	 | 201.01ms | |
| 총 요청 수 | 128,274 req | 63,127 req |  |
| 데이터 전송량 (Transfer/sec) | 1.47MB/sec | 1.07MB/sec | |

<br>

<img src="{{site.baseurl}}/assets/images/rest-grpc-comment-cpu-usage.png">

| Metric | REST API | GraphQL | 비고 |
|---|---|---|---|
| Average CPU Usage (%) | 128.75%  | 153.2% | 1.19배 높음 |
| Max CPU Usage (%) | 148.0% | 172.0% | 1.16배 높음 |

### 결론

```
뭐랄까...
GraphQL 은 느리고, CPU 도 많이 먹는 것 같다...
REST 와 비교했을 때, 구현이 더 귀찮을 것을 생각하면, 
일반적인 상황에서는 딱히 쓸 이유는 없어보인다..
GraphQL 의 성능을 생각해봤을 때에는 쓸 이유가 명확할 때에만 쓰게될 것 같다.
```