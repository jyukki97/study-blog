---
title: "gRPC vs REST vs GraphQL: 무엇을 선택해야 할까?"
date: 2025-03-15
draft: false
tags: ["REST", "gRPC", "GraphQL", "API", "비교분석"]
categories: ["Development"]
description: "gRPC, REST, GraphQL 세 가지 API 패러다임을 성능, 개발경험, 사용성 측면에서 비교 분석해보자."
keywords: ["gRPC REST GraphQL 비교", "API 아키텍처 선택", "REST API", "GraphQL", "gRPC"]
lastmod: 2026-05-28
summary: "REST, gRPC, GraphQL은 서로 대체재처럼 보이지만 실제로는 강점이 다릅니다. 기본값은 REST로 두고, 서버 간 고성능 통신은 gRPC, 화면별 데이터 조합 문제가 커질 때 GraphQL을 검토하는 식으로 선택 기준을 잡는 편이 현실적입니다."
key_takeaways:
  - "REST는 브라우저·캐시·문서화·운영 단순성이 좋아 대부분의 공개/일반 API 기본값으로 적합하다."
  - "gRPC는 HTTP/2와 Protobuf 기반이라 서버 간 통신, 스트리밍, 엄격한 계약이 필요한 환경에서 강하다."
  - "GraphQL은 성능 자체보다 프론트엔드 데이터 조합 유연성, BFF 역할, 타입 스키마 기반 협업이 핵심 장점이다."
operator_checklist:
  - "외부 공개 API라면 REST를 기본값으로 두고 캐시·버전·문서 전략부터 정한다."
  - "내부 마이크로서비스 호출이 많고 latency budget이 빡빡하면 gRPC를 별도 후보로 검토한다."
  - "화면마다 필요한 필드 조합이 계속 달라지고 over-fetching이 반복되면 GraphQL PoC를 해본다."
  - "GraphQL을 쓰면 N+1, persisted query, rate limit, observability를 도입 조건에 포함한다."
decision_guide:
  title: "REST, gRPC, GraphQL 선택 기준"
  intro: "기술 이름보다 호출 주체, 네트워크 경계, 캐싱 방식, 팀 운영 역량을 먼저 봐야 합니다."
  cases:
    - badge: "기본값"
      title: "브라우저·모바일·외부 파트너가 쓰는 일반 API"
      fit: "REST가 가장 단순하고 캐시, 문서, 디버깅, 호환성 관리가 쉽다."
      watchouts: "화면별 조합 API가 늘어나면 endpoint가 과하게 많아질 수 있다."
      next_step: "OpenAPI, 버전 정책, pagination, error format을 먼저 고정한다."
    - badge: "성능/계약"
      title: "서버 간 내부 통신과 streaming이 중요하다"
      fit: "gRPC는 코드 생성, Protobuf 계약, HTTP/2 streaming으로 서비스 간 호출에 강하다."
      watchouts: "브라우저 직접 호출과 운영 디버깅은 REST보다 불편할 수 있다."
      next_step: "서비스 간 API부터 제한적으로 적용하고 gateway 경계를 분리한다."
    - badge: "조합/화면"
      title: "프론트 화면별 데이터 조합이 계속 바뀐다"
      fit: "GraphQL은 클라이언트가 필요한 필드를 고르고 schema로 협업하기 좋다."
      watchouts: "N+1, 권한 필터링, query complexity, 캐싱을 설계하지 않으면 운영 비용이 커진다."
      next_step: "BFF 범위에서 PoC를 만들고 resolver batching과 persisted query를 같이 검증한다."
learning_refs:
  - title: "REST API 설계"
    href: "/learning/deep-dive/deep-dive-rest-api-design/"
    description: "REST를 기본값으로 둘 때 endpoint, status code, versioning, error response를 잡는 기준입니다."
  - title: "gRPC 서비스 설계"
    href: "/learning/deep-dive/deep-dive-grpc-service-design/"
    description: "Protobuf, streaming, 내부 서비스 간 API 계약을 설계할 때 같이 볼 글입니다."
  - title: "GraphQL 스키마 설계"
    href: "/learning/deep-dive/deep-dive-graphql-schema-design/"
    description: "GraphQL을 단순 fetch 대체가 아니라 schema와 resolver 운영 문제로 보는 기준입니다."
faqs:
  - question: "REST, gRPC, GraphQL 중 하나만 표준으로 정해도 되나요?"
    answer: "가능은 하지만 보통 좋은 기준은 아닙니다. 공개 API는 REST, 내부 고성능 호출은 gRPC, 화면 조합 문제는 GraphQL처럼 경계별로 표준을 나누는 편이 운영상 더 자연스럽습니다."
  - question: "GraphQL이 있으면 REST endpoint를 전부 없애도 되나요?"
    answer: "대부분은 추천하지 않습니다. GraphQL은 화면 조합과 BFF에는 강하지만 파일 다운로드, webhook, 단순 CRUD, CDN 캐시 중심 API는 REST가 더 단순하고 안정적인 경우가 많습니다."
cover:
  image: "/images/graphql-vs-rest.png"
  alt: "API 패러다임 비교"
  caption: "gRPC vs REST vs GraphQL 비교 분석"
---

> 저번 포스트에서 **gRPC** 와 **REST** 비교를 해봤다. <br>
> 생각해보니 **GraphQL** 을 놓쳤었다. 안 써본 거라 제외하고 생각했던 것 같다. <br>
> 이참에 세가지 한번 비교해보자

---

## 1. gRPC, REST, GraphQL 개요

개요는 chat GPT 가 정성을 다해 써줬다. 뭐 사실 이게 중요한건 아니니까 모르던 부분만 스윽 읽고 넘어가자 어짜피 실전파라 코드로 보는게 빠르더라.

### gRPC란?

gRPC(Google Remote Procedure Call)는 Google이 개발한 고성능 RPC(Remote Procedure Call) 프레임워크입니다. Protocol Buffers(ProtoBuf)를 사용하여 데이터를 직렬화하며, HTTP/2를 기반으로 빠르고 효율적인 통신을 제공합니다.

#### gRPC 특징
- **바이너리 데이터 직렬화 (ProtoBuf)**: JSON보다 빠르고 가벼운 데이터 전송
- **HTTP/2 기반**: 다중 스트리밍, 헤더 압축 등을 지원하여 효율적인 네트워크 사용
- **자동 코드 생성**: 클라이언트 및 서버 스텁을 자동으로 생성하여 개발 생산성 향상
- **양방향 스트리밍 지원**: 서버와 클라이언트가 지속적으로 데이터를 주고받을 수 있음
- **다양한 언어 지원**: Java, Python, Go, C++, Kotlin 등 다양한 언어에서 사용 가능

### REST란?
REST(Representational State Transfer)는 가장 널리 사용되는 API 설계 패턴으로, HTTP 프로토콜을 기반으로 클라이언트와 서버 간 통신을 수행합니다.

#### REST 특징
- **HTTP 기반**: GET, POST, PUT, DELETE 등의 HTTP 메서드 사용
- **JSON 또는 XML 데이터 포맷**: 일반적으로 JSON을 사용하여 데이터를 직렬화
- **Stateless(무상태성)**: 각 요청이 독립적이며, 서버는 클라이언트 상태를 유지하지 않음
- **캐싱 지원**: HTTP 캐싱을 활용하여 성능 최적화 가능

### GraphQL이란?
GraphQL은 Facebook에서 개발한 API 쿼리 언어로, 클라이언트가 원하는 데이터를 정확하게 요청할 수 있도록 설계되었습니다.

#### GraphQL 특징
- **필요한 데이터만 요청**: 오버페칭(over-fetching) 및 언더페칭(under-fetching) 문제 해결
- **단일 엔드포인트**: 다양한 리소스를 하나의 API에서 제공
- **타입 시스템 제공**: 명확한 스키마 정의를 통한 안정적인 API 제공
- **클라이언트 중심 API**: 프론트엔드에서 필요한 데이터 구조를 직접 정의할 수 있음

---

## 2. gRPC vs REST vs GraphQL 비교

|  특징  | gRPC  | REST  | GraphQL  |
|--------|------|------|---------|
| **전송 방식** | HTTP/2 + ProtoBuf | HTTP/1.1 + JSON | HTTP/1.1 + JSON |
| **속도** | 매우 빠름 (바이너리) | 일반적 (텍스트) | REST보다 다소 느림 (쿼리 파싱 필요) |
| **데이터 직렬화** | ProtoBuf (바이너리) | JSON, XML | JSON |
| **유연성** | 낮음 (고정된 메서드) | 중간 (엔드포인트 기반) | 높음 (필요한 데이터만 요청) |
| **실시간 스트리밍** | 지원 (양방향) | 제한적 (SSE, WebSocket 필요) | 지원 (Subscription) |
| **언어 지원** | 다양한 언어 지원 | 주로 웹 개발 중심 | 주로 웹 개발 중심 |
| **학습 곡선** | 높음 | 낮음 | 중간 |
| **사용 사례** | 마이크로서비스, 고성능 API | 전통적인 웹 API | 대화형 UI, 클라이언트 맞춤형 데이터 요청 |

---

## 3. 언제 어떤 기술을 선택해야 할까?

### gRPC가 적합한 경우
- **마이크로서비스 간 통신**: 빠르고 효율적인 서비스 간 통신이 필요할 때
- **고성능 API**: 네트워크 대역폭을 최적화하고 성능을 극대화해야 할 때
- **양방향 스트리밍 필요**: 실시간 데이터 흐름이 중요한 경우 (예: 채팅, 스트리밍 서비스)
- **다양한 언어를 사용하는 환경**: 여러 언어로 클라이언트를 개발해야 할 때

### REST가 적합한 경우
- **웹 서비스 API**: 브라우저 및 모바일 앱에서 쉽게 접근할 수 있는 API가 필요할 때
- **간단한 CRUD 서비스**: 복잡한 기능 없이 간단한 데이터 전송이 필요한 경우
- **캐싱이 중요한 경우**: REST API는 HTTP 캐싱을 지원하여 성능 최적화 가능

### GraphQL이 적합한 경우
- **프론트엔드 맞춤형 데이터 제공**: 클라이언트가 원하는 데이터만 받아야 하는 경우
- **오버페칭/언더페칭 문제 해결**: REST API의 단점인 불필요한 데이터 전송 문제 해결
- **복잡한 관계형 데이터 처리**: 여러 개의 API 요청을 하나로 합쳐야 할 때 (예: 대시보드 UI)

---

## 4. 결론

| 선택 기준 | 추천 기술 |
|----------|--------|
| 빠른 속도와 효율성 | **gRPC** |
| 간단한 웹 API | **REST** |
| 프론트엔드 맞춤형 API | **GraphQL** |
| 실시간 스트리밍 | **gRPC, GraphQL** |
| 마이크로서비스 간 통신 | **gRPC** |
| 기존 시스템과의 호환성 | **REST** |

각 기술은 특정 상황에서 장점을 발휘합니다. 단순한 CRUD API라면 REST가 적합하고, 프론트엔드 최적화를 원한다면 GraphQL이 좋은 선택입니다. 반면, 성능이 중요한 마이크로서비스 환경에서는 gRPC가 강력한 솔루션이 될 수 있습니다.

따라서, 사용하려는 서비스의 **요구 사항을 분석**하고 **적절한 기술을 선택하는 것**이 가장 중요합니다!

## 4-1. 실무 선택 기준을 조금 더 현실적으로 잡아보면

처음에는 세 기술을 같은 줄에 놓고 "뭐가 더 좋은가?"로 비교하기 쉬운데, 실제로는 **호출하는 주체가 누구인가**가 먼저다. 브라우저와 모바일 앱이 직접 호출하는 API인지, 내부 서비스끼리 호출하는 API인지, 아니면 여러 백엔드를 묶어서 화면에 필요한 데이터만 뽑아주는 BFF인지에 따라 답이 달라진다.

내 기준으로는 기본값을 이렇게 둔다.

| 상황 | 기본 선택 | 이유 |
|---|---|---|
| 공개 API, 일반 웹/앱 API | REST | 디버깅, 캐싱, 문서화, 호환성 관리가 쉽다 |
| 내부 서비스 간 고빈도 호출 | gRPC | Protobuf 계약과 HTTP/2 기반 통신이 유리하다 |
| 화면마다 데이터 조합이 크게 다름 | GraphQL | 프론트가 필요한 필드를 직접 고르기 좋다 |
| 파일 업로드/다운로드, webhook | REST | HTTP 표준 기능과 인프라 지원을 그대로 쓰기 좋다 |
| 실시간 양방향 streaming | gRPC 또는 GraphQL subscription | 통신 패턴을 먼저 보고 선택해야 한다 |

여기서 중요한 건 REST가 낡았고 GraphQL이 새롭다는 식으로 보면 안 된다는 점이다. REST는 여전히 기본기가 좋다. URL, HTTP method, status code, CDN, 로그, curl 디버깅까지 운영자가 이해하기 쉽다. 그래서 특별한 이유가 없으면 REST를 기본값으로 두는 게 손해가 적다.

gRPC는 반대로 "사람이 브라우저에서 바로 호출하기 편한 API"라기보다는 **서비스 간 계약**에 가깝다. 요청/응답 타입이 명확하고, 코드 생성으로 클라이언트 stub을 만들 수 있고, streaming도 자연스럽다. 대신 장애가 났을 때 curl 하나로 바로 확인하는 느낌은 REST보다 떨어진다. 그래서 외부 공개 API 전체를 gRPC로 밀기보다는 내부 서비스 간 통신부터 적용하는 편이 부담이 작다.

GraphQL은 REST를 예쁘게 대체하는 문법이라기보다 **데이터 조합 계층**으로 보는 게 맞다. 화면 A는 게시글과 댓글 3개가 필요하고, 화면 B는 게시글 작성자와 태그만 필요하고, 화면 C는 통계까지 필요하다면 REST endpoint가 화면 단위로 늘어나기 쉽다. 이때 GraphQL은 프론트가 필요한 shape을 직접 요청할 수 있어서 생산성이 올라갈 수 있다. 하지만 resolver N+1, query complexity 제한, 캐싱, 권한 필터링을 제대로 안 잡으면 서버 운영이 어려워진다.

그래서 도입 전에는 아래 질문을 먼저 던지는 게 낫다.

- 이 API를 가장 많이 호출하는 주체가 브라우저인가, 내부 서버인가?
- HTTP 캐시나 CDN 캐시가 핵심 성능 전략인가?
- 클라이언트마다 필요한 필드 조합이 실제로 많이 다른가?
- 팀이 Protobuf/schema/resolver 같은 계약 변경 프로세스를 관리할 준비가 되어 있는가?
- 장애가 났을 때 로그, trace, metric으로 어느 필드/메서드가 느린지 바로 볼 수 있는가?

이 질문에 답을 못 하면 새 기술을 붙여도 선택 기준이 흔들린다. 특히 GraphQL은 "필요한 데이터만 가져온다"는 장점이 있지만, 서버 입장에서는 그 요청을 해석하고 리졸버를 실행하고 권한을 검사해야 한다. 반대로 REST도 query parameter나 dedicated endpoint를 잘 설계하면 충분히 화면 최적화를 할 수 있다. 결국 기술보다 **운영 가능한 API 계약을 유지할 수 있는가**가 더 중요하다.


## 5. 질문 모음

### Q. REST 의 장점이 캐싱이라니 다른 두개도 캐싱 할 수 있지않은가?

#### A. REST는 HTTP 캐싱을 기본적으로 지원하는 반면, gRPC와 GraphQL은 별도의 캐싱 전략이 필요해.
| 특징 | REST | gRPC | GraphQL |
|----------|--------|--------|--------|
| 기본 캐싱 지원 | ✅ (HTTP 캐싱) | ❌ (별도 구현 필요) | ❌ (별도 구현 필요) |
| 클라이언트 캐싱 | 가능 (브라우저, CDN) | 가능 (클라이언트 메모리) | 가능 (Apollo, Relay 등) |
| 서버 캐싱 | 가능 (Reverse Proxy) | 가능 (Redis, Memcached) | 가능 (Redis, Persisted Queries) |

REST는 기본적으로 HTTP 캐싱을 활용할 수 있어서 쉽고 강력한 캐싱을 제공하지만,
gRPC와 GraphQL도 적절한 캐싱 전략을 적용하면 성능을 개선할 수 있어.

```
=> 결국 나머지도 노오오력 하면 된다는거잖아..
```

### Q. GraphQL 특징이 단일 엔드포인트라고 적혀있는데, 하나의 API 로 여러 리소스를 준다는 것인가?

#### A. 맞아! GraphQL의 단일 엔드포인트(single endpoint)란 하나의 API 요청으로 여러 리소스를 한 번에 가져올 수 있다는 의미야

### REST 방식 
REST에서는 각 리소스마다 개별적인 엔드포인트를 제공해.
예를 들어, 블로그의 게시글과 댓글 데이터를 가져오려면 두 번의 요청을 보내야 해.

1️⃣ 게시글 가져오기 (/posts/1)
```json
GET /posts/1
{
  "id": 1,
  "title": "GraphQL vs REST",
  "content": "REST와 GraphQL의 차이점...",
  "authorId": 100
}
```
2️⃣ 댓글 가져오기 (/posts/1/comments)

```json
GET /posts/1/comments
[
  { "id": 201, "postId": 1, "content": "좋은 글이네요!" },
  { "id": 202, "postId": 1, "content": "더 많은 예제가 있으면 좋겠어요." }
]
```

* REST 방식에서는 여러 개의 API 엔드포인트를 호출해야 필요한 데이터를 모두 가져올 수 있음
* 여러 번의 요청이 필요해서 네트워크 비용이 증가할 수 있음.


### GraphQL 방식

GraphQL에서는 단일 엔드포인트(/graphql)를 사용하고, 필요한 데이터를 한 번에 요청할 수 있어.

1️⃣ GraphQL 쿼리

```graphql
query {
  post(id: 1) {
    title
    content
    comments {
      content
    }
  }
}
```

* GraphQL에서는 한 번의 요청으로 여러 리소스를 가져올 수 있어!
* 네트워크 비용을 줄이고 필요한 데이터만 받을 수 있어서 효율적.

```
=> ??? 사실 REST 에서도 GraphQL 처럼 post API 요청 시 댓글도 다 줄 수 있지않나? 쿼리를 넣어도 되고...
=> 쿼리 파싱해서 뭐 분기하는게 불편할 수 있는데, GraphQL 도 비슷하게 구현될 것 같은데.. 아닌가 이건 안해봐서 모르겠다. 담에 해보고 생각해봐야지
```


### Q. 저번 테스트에 따르면 gRPC 같은 경우에는 클라이언트 친화적인 것 같지는 않거든? GraphQL 은 어때, 웹에서 쓰기에도 편하게 쓸 수 있어?

#### A. GraphQL은 웹에서 쓰기에 매우 편리한 API 방식이야! 

gRPC는 클라이언트 친화적이지 않다는 단점이 있어.<br>
이유를 살펴보면 다음과 같아:

* 바이너리 포맷 사용 (ProtoBuf) → 사람이 직접 읽고 쓰기 어려움
* 브라우저에서 직접 호출 불가능 → gRPC-Web 같은 추가적인 설정이 필요
* REST처럼 간편한 요청이 어려움 → 클라이언트에서 Stub 코드 생성이 필요

### GraphQL이 클라이언트 친화적인 이유

#### 브라우저에서 쉽게 요청 가능

* REST API처럼 브라우저에서 직접 fetch 또는 Axios를 이용해 호출할 수 있음.
* 예를 들어, 다음과 같이 GraphQL 쿼리를 보낼 수 있어:
```javascript
fetch('/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `{
      post(id: 1) {
        title
        content
      }
    }`
  })
})
.then(response => response.json())
.then(data => console.log(data));
```

#### 필요한 데이터만 선택해서 가져올 수 있음

* REST에서는 /users/1을 호출하면 불필요한 데이터를 포함한 전체 객체를 받아야 하지만,
* GraphQL에서는 특정 필드만 선택해서 받을 수 있음 → 오버페칭 방지

```graphql
query {
  user(id: 1) {
    name
    email
  }
}
```
#### 프론트엔드 라이브러리 지원이 풍부함

* GraphQL은 Apollo Client, Relay 같은 라이브러리를 활용하면 클라이언트에서 편하게 사용할 수 있음.
* Apollo Client를 사용하면 자동 캐싱과 쿼리 관리가 쉬워짐.

```javascript
import { useQuery, gql } from '@apollo/client';

const GET_POST = gql`
  query {
    post(id: 1) {
      title
      content
    }
  }
`;

function Post() {
  const { loading, error, data } = useQuery(GET_POST);

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error: {error.message}</p>;

  return <h1>{data.post.title}</h1>;
}
```

#### Subscription(실시간 데이터) 지원

* GraphQL은 WebSocket을 사용한 Subscription을 지원해서 실시간 데이터를 쉽게 받을 수 있음.
* 예를 들어, 채팅 메시지나 알림 시스템을 만들 때 편리함.

### 결론: GraphQL은 클라이언트 친화적인가?

| 기준 | REST | gRPC | GraphQL |
|----------|--------|--------|--------|
| 브라우저에서 직접 호출 | ✅ 가능 | ❌ 불가능 (gRPC-Web 필요) | ✅ 가능 |
| 필요한 데이터만 가져오기 | ❌ 불가능 (고정된 응답) | ❌ 불가능 | ✅ 가능 |
| 프론트엔드 라이브러리 지원 | ✅ 일반적 | ❌ 거의 없음 | ✅ 풍부함 (Apollo, Relay 등) |
| 실시간 데이터 (Subscription) | ❌ WebSocket 필요 | ✅ 지원 | ✅ 지원 |


✔ gRPC는 클라이언트 친화적이지 않지만,<br>
✔ GraphQL은 웹 프론트엔드에서 매우 편리하게 사용할 수 있는 API 방식이야! 




```
=> 살짝만 봤는데, REST 랑 동작이 매우 비슷하다
=> 사용하는데에도 REST 랑 별 차이는 없을 듯
=> 직접 구현해봐야겠지만, 구현 난이도가 적다면 Front 용 API 는 이걸로 대체하는 것도 나쁘지는 않을 듯
=> 다만, 써봐야 알겠지만, 이게 Front 입장에서 과연 편할까?... 저거 직접 data 하나하나 명시하는거 귀찮을 것 같은데...
=> 근데 왜 REST 는 필요한 데이터만 가져오기가 불가능이지?.. 쿼리 파라미터에 추가로 필요한 데이터 넣어서 파싱하면 뭐 어찌저찌 가능하지않나, 아! 빼기가 안되나? ㅇㅈ
```



## 내 생각

```
기본적으로 그냥 REST 쓰면 딱히 손해보는 일은 없어 보인다.
다만, 저번 REST VS gRPC 포스트에서 적었듯이 서버끼리의 통신은 gRPC도 고려해볼만 할 것 같다.

프론트랑 통신은 REST VS GraphQL 인데, 이건 좀 더 테스트를 해봐야할 것 같다. 아직까지는 REST 를 버리고 갈만큼 매력적으로 다가오지않는다. 
```

## 같이 보면 좋은 글

- [REST vs GraphQL 성능 비교](/posts/2025-03-15-2-rest-vs-graphql/)
- [REST API 설계](/learning/deep-dive/deep-dive-rest-api-design/)
- [gRPC 서비스 설계](/learning/deep-dive/deep-dive-grpc-service-design/)
- [GraphQL 스키마 설계](/learning/deep-dive/deep-dive-graphql-schema-design/)
- [API Gateway 설계](/learning/deep-dive/deep-dive-api-gateway-design/)
