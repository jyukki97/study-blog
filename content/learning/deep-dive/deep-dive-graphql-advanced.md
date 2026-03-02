---
title: "GraphQL 심화: 스키마 설계와 성능 최적화"
study_order: 1003
date: 2025-12-28
topic: "API"
topic_icon: "📊"
topic_description: "GraphQL 스키마 설계, N+1 해결, 실시간 Subscription"
tags: ["GraphQL", "API", "DataLoader", "Federation"]
categories: ["Modern"]
draft: false
description: "GraphQL 스키마 설계, DataLoader로 N+1 해결, 성능 최적화와 보안 고려사항"
module: "modern-frontiers"
quizzes:
  - question: "GraphQL이 REST의 Under-fetching 문제를 해결하는 방식은?"
    options:
      - "여러 번 요청한다."
      - "클라이언트가 필요한 데이터를 쿼리로 명시하여 한 번의 요청으로 연관 데이터를 모두 가져온다."
      - "캐시를 사용한다."
      - "더 빠른 네트워크를 사용한다."
    answer: 1
    explanation: "REST에서 user → posts → comments를 가져오려면 3번 요청이 필요하지만, GraphQL은 한 쿼리에 모든 관계를 포함하여 1번으로 해결합니다."

  - question: "GraphQL에서 N+1 문제가 발생하는 원인과 해결책은?"
    options:
      - "GraphQL은 N+1 문제가 없다."
      - "각 User의 posts를 개별 쿼리로 가져오면 N+1 발생. DataLoader로 배치 처리하여 해결"
      - "더 많은 서버를 사용한다."
      - "캐시를 비운다."
    answer: 1
    explanation: "users 조회 1번 + 각 user의 posts 조회 N번 = N+1. DataLoader는 16ms 대기 후 모든 userId를 모아 IN절 한 번으로 처리합니다."

  - question: "GraphQL Subscription의 동작 방식은?"
    options:
      - "클라이언트가 주기적으로 폴링한다."
      - "WebSocket 연결을 유지하고, 서버에서 이벤트 발생 시 클라이언트에게 실시간으로 푸시한다."
      - "HTTP Long Polling"
      - "SMS로 알린다."
    answer: 1
    explanation: "Subscription은 WebSocket 기반입니다. 채팅, 알림 등 실시간 기능에 적합하며, 서버가 postCreated 같은 이벤트를 발행하면 구독자에게 전달됩니다."

  - question: "GraphQL에서 Query Complexity 제한을 두는 이유는?"
    options:
      - "코드를 간단하게 유지하기 위해"
      - "중첩이 깊은 쿼리로 인한 서버 과부하(DoS)를 방지하기 위해"
      - "클라이언트를 빠르게 하기 위해"
      - "필요 없다"
    answer: 1
    explanation: "`users { posts { comments { author } } }` 같은 깊은 중첩은 데이터베이스 쿼리 폭발을 일으킬 수 있습니다. 복잡도/깊이 제한으로 악의적 쿼리를 차단합니다."

  - question: "GraphQL의 Cursor-based Pagination이 Offset 방식보다 나은 점은?"
    options:
      - "구현이 더 쉽다."
      - "대용량 데이터에서 Page Drift(데이터 변경 시 중복/누락) 문제 없이 일관된 성능 제공"
      - "페이지 번호를 사용한다."
      - "차이 없다."
    answer: 1
    explanation: "Offset은 데이터가 추가/삭제되면 같은 아이템이 중복되거나 누락됩니다. Cursor는 '마지막으로 본 아이템' 기준이라 무한 스크롤에 적합합니다."
---

## 이 글에서 얻는 것

- GraphQL과 REST의 **본질적 차이**를 이해합니다
- **N+1 문제**를 DataLoader로 해결하는 패턴을 익힙니다
- 실시간 기능을 위한 **Subscription** 구현 방법을 알아봅니다

---

## GraphQL vs REST

### 핵심 차이

```mermaid
flowchart LR
    subgraph REST["REST API"]
        R1["GET /users"]
        R2["GET /users/1"]
        R3["GET /users/1/posts"]
        R4["GET /posts/1/comments"]
    end
    
    subgraph GQL["GraphQL"]
        G1["POST /graphql\n(단일 엔드포인트)"]
    end
    
    Client --> REST
    Client --> GQL
    
    REST --> |"4번 요청"| DB[(Database)]
    GQL --> |"1번 요청"| DB
    
    style REST fill:#ffebee,stroke:#c62828
    style GQL fill:#e8f5e9,stroke:#2e7d32
```

| 특성 | REST | GraphQL |
|------|------|---------|
| 엔드포인트 | 리소스별 다수 | 단일 `/graphql` |
| 데이터 결정 | 서버가 결정 | 클라이언트가 결정 |
| Over-fetching | 발생 가능 | 필요한 것만 요청 |
| Under-fetching | N+1 요청 필요 | 한 번에 해결 |
| 캐싱 | HTTP 캐시 활용 | 별도 전략 필요 |
| 버전 관리 | URL 버전 (/v1, /v2) | Schema Evolution |

### Under-fetching 문제 해결

```graphql
# REST: 3번 요청 필요
# GET /users/1
# GET /users/1/posts
# GET /posts/1/comments

# GraphQL: 1번 요청으로 해결
query GetUserWithPosts {
  user(id: 1) {
    id
    name
    email
    posts {
      id
      title
      comments {
        id
        content
        author {
          name
        }
      }
    }
  }
}
```

---

## Schema 설계 패턴

### Type 정의

```graphql
# schema.graphql

# 기본 타입
type User {
  id: ID!
  email: String!
  name: String!
  posts: [Post!]!
  createdAt: DateTime!
}

type Post {
  id: ID!
  title: String!
  content: String!
  author: User!
  comments: [Comment!]!
  publishedAt: DateTime
}

type Comment {
  id: ID!
  content: String!
  author: User!
  post: Post!
}

# Input 타입 (mutation용)
input CreatePostInput {
  title: String!
  content: String!
}

input UpdatePostInput {
  title: String
  content: String
}

# Query & Mutation
type Query {
  user(id: ID!): User
  users(first: Int, after: String): UserConnection!
  post(id: ID!): Post
  posts(filter: PostFilter): [Post!]!
}

type Mutation {
  createPost(input: CreatePostInput!): Post!
  updatePost(id: ID!, input: UpdatePostInput!): Post!
  deletePost(id: ID!): Boolean!
}
```

### Pagination (Cursor-based)

```graphql
# Relay 스타일 Connection
type UserConnection {
  edges: [UserEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type UserEdge {
  node: User!
  cursor: String!
}

type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}

# 사용
query GetUsers {
  users(first: 10, after: "cursor123") {
    edges {
      node {
        id
        name
      }
      cursor
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

### 장점
- Offset 방식의 "Page Drift" 문제 해결
- 무한 스크롤에 적합
- 대용량 데이터에서도 일관된 성능

---

## N+1 문제와 DataLoader

### 문제 상황

```java
// ❌ N+1 문제 발생
@QueryMapping
public List<User> users() {
    return userRepository.findAll();  // 1번 쿼리
}

@SchemaMapping(typeName = "User")
public List<Post> posts(User user) {
    // 각 User마다 호출됨 → N번 쿼리!
    return postRepository.findByUserId(user.getId());
}

// 실행 쿼리:
// 1. SELECT * FROM users (1번)
// 2. SELECT * FROM posts WHERE user_id = 1 (N번)
// 3. SELECT * FROM posts WHERE user_id = 2
// ...
// → 총 N+1번 쿼리!
```

### DataLoader로 해결

```mermaid
sequenceDiagram
    participant Client
    participant GraphQL
    participant DataLoader
    participant DB

    Client->>GraphQL: Query users with posts
    GraphQL->>DataLoader: Load posts for user 1
    GraphQL->>DataLoader: Load posts for user 2
    GraphQL->>DataLoader: Load posts for user 3
    
    Note over DataLoader: Batch 수집 (16ms 대기)
    
    DataLoader->>DB: SELECT * FROM posts WHERE user_id IN (1,2,3)
    DB-->>DataLoader: All posts
    DataLoader-->>GraphQL: Distribute to resolvers
    GraphQL-->>Client: Response
```

```java
// ✅ DataLoader 사용
@Component
public class PostDataLoader extends MappedBatchLoader<Long, List<Post>> {
    
    @Autowired
    private PostRepository postRepository;
    
    @Override
    public CompletionStage<Map<Long, List<Post>>> load(Set<Long> userIds) {
        // 한 번의 쿼리로 모든 posts 조회
        List<Post> allPosts = postRepository.findByUserIdIn(userIds);
        
        // userId별로 그룹화
        Map<Long, List<Post>> postsByUserId = allPosts.stream()
            .collect(Collectors.groupingBy(Post::getUserId));
        
        return CompletableFuture.completedFuture(postsByUserId);
    }
}

// Resolver에서 사용
@SchemaMapping(typeName = "User")
public CompletableFuture<List<Post>> posts(
        User user, 
        DataLoader<Long, List<Post>> postDataLoader) {
    return postDataLoader.load(user.getId());
}
```

**결과**: N+1 쿼리 → 2번 쿼리로 최적화

---

## Subscription (실시간)

### WebSocket 기반 실시간 업데이트

```graphql
# Schema
type Subscription {
  postCreated: Post!
  commentAdded(postId: ID!): Comment!
  userOnlineStatusChanged: UserStatus!
}

type UserStatus {
  userId: ID!
  isOnline: Boolean!
}
```

```java
// Spring GraphQL + WebSocket
@Controller
public class SubscriptionController {
    
    @SubscriptionMapping
    public Flux<Post> postCreated() {
        return postEventPublisher.getPostStream();
    }
    
    @SubscriptionMapping
    public Flux<Comment> commentAdded(@Argument String postId) {
        return commentEventPublisher.getCommentStream()
            .filter(comment -> comment.getPostId().equals(postId));
    }
}

// 이벤트 발행
@Service
public class PostService {
    
    @Autowired
    private Sinks.Many<Post> postSink;
    
    public Post createPost(CreatePostInput input) {
        Post post = postRepository.save(new Post(input));
        postSink.tryEmitNext(post);  // 구독자에게 전파
        return post;
    }
}
```

### 클라이언트 사용

```javascript
// Apollo Client
const POST_SUBSCRIPTION = gql`
  subscription OnPostCreated {
    postCreated {
      id
      title
      author {
        name
      }
    }
  }
`;

function NewPostNotifier() {
  const { data, loading } = useSubscription(POST_SUBSCRIPTION);
  
  if (data) {
    showNotification(`New post: ${data.postCreated.title}`);
  }
  
  return null;
}
```

---

## 보안 및 성능

### Query Complexity 제한

```java
// 쿼리 복잡도 제한
@Configuration
public class GraphQLConfig {
    
    @Bean
    public Instrumentation complexityInstrumentation() {
        return new MaxQueryComplexityInstrumentation(100);  // 최대 100
    }
}
```

```graphql
# 복잡도 계산 예시
query {
  users(first: 10) {           # 복잡도: 10
    posts {                    # 복잡도: 10 * 10 = 100
      comments {               # 복잡도: 100 * 10 = 1000 ❌ 초과!
        author { name }
      }
    }
  }
}
```

### Query Depth 제한

```java
@Bean
public Instrumentation depthInstrumentation() {
    return new MaxQueryDepthInstrumentation(5);  // 최대 5단계
}
```

---

## 요약

### GraphQL vs REST 선택 기준

| GraphQL 선택 | REST 선택 |
|-------------|----------|
| 복잡한 데이터 관계 | 단순 CRUD |
| 모바일 앱 (대역폭 중요) | 캐싱 필수 |
| 다양한 클라이언트 | 파일 업로드/다운로드 |
| 실시간 기능 필요 | 간단한 API |

### 핵심 포인트

- **DataLoader**: N+1 문제 필수 해결책
- **Cursor Pagination**: 대용량 데이터 페이징
- **Subscription**: WebSocket 기반 실시간
- **Complexity/Depth 제한**: DoS 방어

---

## 🔗 Related Deep Dive

- **[gRPC 서비스 설계](/learning/deep-dive/deep-dive-grpc-service-design/)**: Protobuf와 HTTP/2 기반 API.
- **[API Gateway 설계](/learning/deep-dive/deep-dive-api-gateway-design/)**: 인증, 라우팅, Rate Limiting.
