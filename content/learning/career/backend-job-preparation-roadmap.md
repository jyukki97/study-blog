---
title: "백엔드 개발자 이직 준비 완벽 로드맵 (2025년)"
date: 2025-01-26
topic: "Career"
tags: ["백엔드", "이직", "로드맵", "학습", "면접준비"]
categories: ["Career"]
draft: false
---

## 들어가며

백엔드 개발자로 이직을 준비하면서 "무엇을 공부해야 할까?"라는 고민이 가장 큽니다. 이 글은 실제 이직 준비 과정에서 필요한 학습 로드맵과 각 영역별 핵심 주제를 정리한 가이드입니다.

**난이도 표시:**
- ⭐ 필수 (모든 백엔드 개발자)
- ⭐⭐ 중요 (중급 이상)
- ⭐⭐⭐ 심화 (시니어 레벨)

---

## 1. Java/Kotlin 핵심 ⭐

### 1.1 Java 기초 강화

**핵심 주제:**
- [ ] **JVM 내부 구조** - ClassLoader, Runtime Data Area, Execution Engine
- [ ] **메모리 관리** - Heap (Young/Old Generation), Stack, Method Area
- [ ] **GC 알고리즘** - Serial, Parallel, CMS, G1GC, ZGC 비교
- [ ] **동시성 프로그래밍** - Thread, synchronized, volatile, Atomic 클래스
- [ ] **컬렉션 프레임워크** - ArrayList vs LinkedList, HashMap 내부 구조, ConcurrentHashMap

**학습 자료:**
```java
// 예제: HashMap 내부 동작 이해
Map<String, Integer> map = new HashMap<>();
// 1. hash() 메서드로 해시값 계산
// 2. (n-1) & hash로 버킷 인덱스 결정
// 3. 같은 버킷에 충돌 시 LinkedList → Tree (Java 8+)
```

**실습 과제:**
- [ ] Custom ThreadPool 구현
- [ ] LRU Cache 구현 (LinkedHashMap 활용)
- [ ] Producer-Consumer 패턴 구현 (BlockingQueue)

### 1.2 Java 8+ 최신 기능

- [ ] **Stream API** - map, filter, reduce, parallel stream
- [ ] **Optional** - NullPointerException 방지
- [ ] **CompletableFuture** - 비동기 프로그래밍
- [ ] **Lambda & Method Reference**
- [ ] **Record, Sealed Classes** (Java 14+)

**추천 자료:**
- 📘 "Effective Java 3판" - Joshua Bloch
- 📘 "Java Concurrency in Practice" - Brian Goetz
- 🎥 [Oracle Java Tutorials](https://docs.oracle.com/javase/tutorial/)

---

## 2. Spring Framework 심화 ⭐

### 2.1 Spring Core

**핵심 개념:**
- [ ] **IoC/DI** - BeanFactory vs ApplicationContext, @Autowired vs @Inject
- [ ] **Bean Lifecycle** - 생성 → 의존성 주입 → 초기화 → 소멸
- [ ] **AOP** - Proxy 패턴, @Aspect, Around/Before/After Advice
- [ ] **Spring Events** - ApplicationEventPublisher, @EventListener

```java
// Bean Lifecycle 이해
@Component
public class UserService {

    @PostConstruct  // 의존성 주입 후 실행
    public void init() {
        log.info("UserService initialized");
    }

    @PreDestroy  // Bean 소멸 전 실행
    public void cleanup() {
        log.info("UserService cleanup");
    }
}
```

### 2.2 Spring Boot

- [ ] **Auto Configuration** - @SpringBootApplication 동작 원리
- [ ] **외부 설정** - application.yml, Environment, @ConfigurationProperties
- [ ] **Spring Boot Starter** - 자동 의존성 관리
- [ ] **Actuator** - /health, /metrics, /prometheus 엔드포인트
- [ ] **Profile** - dev, staging, prod 환경 분리

### 2.3 Spring Data JPA

- [ ] **영속성 컨텍스트** - 1차 캐시, 변경 감지, 쓰기 지연
- [ ] **N+1 문제** - Fetch Join, @EntityGraph, Batch Size
- [ ] **연관관계 매핑** - @OneToMany, @ManyToOne, FetchType.LAZY
- [ ] **QueryDSL** - 타입 세이프 쿼리
- [ ] **Pagination** - Pageable, Slice vs Page

**실전 문제:**
```java
// ❌ N+1 문제 발생
@Query("SELECT u FROM User u")
List<User> findAll();  // users 조회 → 각 user마다 orders 조회

// ✅ Fetch Join으로 해결
@Query("SELECT u FROM User u LEFT JOIN FETCH u.orders")
List<User> findAllWithOrders();  // 1번의 쿼리로 해결
```

### 2.4 Spring Security

- [ ] **인증/인가** - Authentication, Authorization
- [ ] **Filter Chain** - SecurityFilterChain, UsernamePasswordAuthenticationFilter
- [ ] **JWT** - Token 기반 인증
- [ ] **OAuth2** - Authorization Code, Client Credentials
- [ ] **CORS, CSRF** - 보안 설정

**추천 자료:**
- 📘 "스프링 부트와 AWS로 혼자 구현하는 웹 서비스" - 이동욱
- 📘 "자바 ORM 표준 JPA 프로그래밍" - 김영한
- 🎥 [인프런 - 김영한의 스프링 완전 정복 로드맵](https://www.inflearn.com/roadmaps/373)

---

## 3. 데이터베이스 ⭐

### 3.1 MySQL/PostgreSQL

**핵심 개념:**
- [ ] **인덱스** - B-Tree, Clustered vs Non-Clustered, Covering Index
- [ ] **실행 계획** - EXPLAIN, type (const > eq_ref > ref > range)
- [ ] **트랜잭션** - ACID, Isolation Level (READ COMMITTED, REPEATABLE READ)
- [ ] **락** - Shared Lock, Exclusive Lock, Deadlock
- [ ] **복제** - Master-Slave Replication, Read Replica

**쿼리 최적화:**
```sql
-- ❌ 느린 쿼리
SELECT * FROM orders WHERE DATE(created_at) = '2025-01-01';

-- ✅ 인덱스 활용
SELECT * FROM orders
WHERE created_at >= '2025-01-01 00:00:00'
  AND created_at < '2025-01-02 00:00:00';

-- EXPLAIN으로 확인
EXPLAIN SELECT ...;
```

### 3.2 NoSQL (Redis)

- [ ] **자료구조** - String, Hash, List, Set, Sorted Set
- [ ] **캐싱 전략** - Cache-Aside, Write-Through, Write-Behind
- [ ] **분산 락** - Redisson, SETNX
- [ ] **Pub/Sub** - 메시지 브로커 기능
- [ ] **영속성** - RDB, AOF

**실습 과제:**
- [ ] Redis로 세션 스토어 구현
- [ ] Leaderboard 구현 (Sorted Set)
- [ ] Rate Limiter 구현 (Token Bucket)

**추천 자료:**
- 📘 "Real MySQL 8.0" - 백은빈, 이성욱
- 📘 "데이터 중심 애플리케이션 설계" - Martin Kleppmann
- 🎥 [MySQL Performance Blog](https://www.percona.com/blog/)

---

## 4. 시스템 설계 (System Design) ⭐⭐

### 4.1 확장성 (Scalability)

**핵심 패턴:**
- [ ] **수평 확장 vs 수직 확장** - Scale-out vs Scale-up
- [ ] **로드 밸런싱** - Round Robin, Least Connection, IP Hash
- [ ] **캐싱 계층** - CDN, Application Cache (Redis), Database Cache
- [ ] **데이터베이스 샤딩** - Hash-based, Range-based Sharding
- [ ] **CQRS** - Command Query Responsibility Segregation

### 4.2 가용성 (Availability)

- [ ] **Health Check** - Liveness, Readiness Probe
- [ ] **Circuit Breaker** - Resilience4j, Hystrix
- [ ] **Retry & Timeout** - Exponential Backoff
- [ ] **Failover** - Active-Active, Active-Standby
- [ ] **Multi-Region** - Geo-Distribution

### 4.3 대표 시스템 설계 문제

**연습 문제:**
1. **URL Shortener 설계** (Bit.ly)
   - Hash 함수, Collision 처리, Custom Alias

2. **뉴스피드 시스템** (Facebook, Instagram)
   - Fan-out on Write vs Fan-out on Read

3. **Rate Limiter** (API Throttling)
   - Token Bucket, Leaky Bucket, Sliding Window

4. **분산 메시지 큐** (Kafka, RabbitMQ)
   - Partitioning, Consumer Group, Offset 관리

5. **검색 엔진** (Elasticsearch)
   - Inverted Index, Relevance Scoring

**추천 자료:**
- 📘 "가상 면접 사례로 배우는 대규모 시스템 설계 기초" - Alex Xu
- 📘 "System Design Interview Vol. 2" - Alex Xu
- 🎥 [System Design Primer (GitHub)](https://github.com/donnemartin/system-design-primer)

---

## 5. 알고리즘 & 자료구조 ⭐

### 5.1 필수 자료구조

- [ ] **Array, LinkedList** - 탐색, 삽입, 삭제 시간 복잡도
- [ ] **Stack, Queue** - DFS, BFS 구현
- [ ] **Hash Table** - Collision 처리 (Chaining, Open Addressing)
- [ ] **Tree** - Binary Tree, BST, AVL Tree, Red-Black Tree
- [ ] **Heap** - Priority Queue, Top K 문제
- [ ] **Graph** - DFS, BFS, Dijkstra, Union-Find

### 5.2 핵심 알고리즘

**정렬:**
- [ ] Quick Sort, Merge Sort (O(n log n))
- [ ] Heap Sort, Counting Sort

**탐색:**
- [ ] Binary Search (O(log n))
- [ ] Two Pointers, Sliding Window

**동적 계획법:**
- [ ] Knapsack, LIS (Longest Increasing Subsequence)
- [ ] DP 문제 패턴 인식

**그래프:**
- [ ] 최단 경로 (Dijkstra, Bellman-Ford)
- [ ] 최소 신장 트리 (Kruskal, Prim)

### 5.3 코딩테스트 전략

**난이도별 목표:**
- **프로그래머스 Level 2**: 80% 이상 풀이
- **LeetCode Medium**: 100문제 이상
- **백준 골드 3 이상**: 50문제 이상

**시간 배분:**
- 1일 1~2문제 꾸준히 (3개월)
- 주말: 모의 코딩테스트 (2시간)

**추천 자료:**
- 📘 "이것이 취업을 위한 코딩 테스트다" - 나동빈
- 🎥 [프로그래머스](https://programmers.co.kr/)
- 🎥 [LeetCode Top Interview Questions](https://leetcode.com/problem-list/top-interview-questions/)

---

## 6. 테스트 & 품질 ⭐⭐

### 6.1 단위 / 통합 테스트

- [ ] **JUnit 5** - 테스트 라이프사이클, Assertions, Parameterized Test
- [ ] **Mockito** - Mock, Stub, ArgumentCaptor, BDDMockito
- [ ] **Spring Test** - @SpringBootTest, @WebMvcTest, @DataJpaTest
- [ ] **Testcontainers** - 도커 기반 통합 테스트 환경 구성 (MySQL, Redis, Kafka)
- [ ] **테스트 피라미드** - Unit / Integration / E2E 비율 이해

### 6.2 테스트 전략

- [ ] **테스트 가능한 설계** - 의존성 주입, 순수 도메인 로직 분리
- [ ] **경계값 테스트** - null, 빈 값, 최대/최소 값
- [ ] **회귀 테스트** - 장애/버그 재현 후 테스트 추가
- [ ] **CI 연동** - GitHub Actions / GitLab CI로 PR 시 자동 테스트

**실습 과제:**
- [ ] 주요 서비스 레이어에 단위 테스트 50개 이상 작성
- [ ] REST API 통합 테스트 작성 (MockMvc 또는 RestAssured)
- [ ] Testcontainers로 실제 DB/Redis와 통합 테스트 구성

---

## 7. API 설계 & 아키텍처 ⭐⭐

### 7.1 REST API 설계

- [ ] **리소스 설계** - URI 규칙, 명사형 리소스, 계층 구조
- [ ] **HTTP 메서드** - GET/POST/PUT/PATCH/DELETE 용도 구분
- [ ] **상태 코드** - 2xx/4xx/5xx, 에러 응답 표준 포맷
- [ ] **페이징/정렬/필터링** - 요청 파라미터 설계
- [ ] **버저닝** - URL / Header 기반 버전 관리

### 7.2 코드 구조 & 설계 원칙

- [ ] **SOLID 원칙** - SRP, OCP, LSP, ISP, DIP
- [ ] **레이어드 아키텍처** - Controller / Service / Repository 분리
- [ ] **도메인 중심 설계** - 엔티티/밸류/도메인 서비스 분리
- [ ] **트랜잭션 경계** - 서비스 레이어 기준 트랜잭션 관리
- [ ] **모듈 분리** - Core / API / Batch 등 모듈화

**실습 과제:**
- [ ] 기존 프로젝트 패키지 구조 리팩토링
- [ ] 공통 응답/에러 포맷(ResponseEnvelope, ErrorResponse) 설계
- [ ] API 명세(OpenAPI/Swagger) 작성 및 문서 자동화

---

## 8. DevOps & 협업 ⭐⭐

### 8.1 Git & 브랜치 전략

- [ ] **Git 기초** - rebase, merge, cherry-pick, revert
- [ ] **브랜치 전략** - Git Flow, Trunk-based Development 개념 이해
- [ ] **Pull Request** - 코드 리뷰 템플릿, 리뷰 코멘트 반영
- [ ] **커밋 메시지 컨벤션** - feat/fix/docs/chore 등 태그 사용

### 8.2 CI/CD & 배포 자동화

- [ ] **CI 파이프라인** - 테스트, 빌드, 린트 자동화
- [ ] **CD 기초** - Blue-Green, Rolling Update 개념
- [ ] **Docker** - Dockerfile 작성, 이미지 빌드, docker-compose
- [ ] **배포 전략** - 무중단 배포 개념, 헬스 체크

**실습 과제:**
- [ ] 개인 프로젝트에 GitHub Actions로 CI 구성
- [ ] Docker 이미지 빌드 후 서버에 배포
- [ ] PR 기반 코드 리뷰 프로세스 경험해 보기

---

## 9. CS 기초 (운영체제/네트워크) ⭐⭐

### 6.1 운영체제

**핵심 주제:**
- [ ] **프로세스 vs 스레드** - Context Switching, Multi-threading
- [ ] **동기화** - Mutex, Semaphore, Monitor, Deadlock
- [ ] **메모리 관리** - Virtual Memory, Paging, Segmentation
- [ ] **CPU 스케줄링** - FCFS, SJF, Round Robin, Priority
- [ ] **페이지 교체** - LRU, LFU, FIFO

### 6.2 네트워크

**필수 개념:**
- [ ] **OSI 7계층 / TCP/IP 4계층**
- [ ] **HTTP/HTTPS** - 메서드, 상태 코드, Header, Cookie/Session
- [ ] **TCP vs UDP** - 3-way Handshake, Flow Control, Congestion Control
- [ ] **DNS** - Domain Name Resolution
- [ ] **CDN** - Content Delivery Network
- [ ] **WebSocket** - 실시간 양방향 통신

**심화:**
- [ ] **HTTP/2, HTTP/3** - Multiplexing, QUIC
- [ ] **gRPC** - Protocol Buffers, Streaming
- [ ] **GraphQL** - REST vs GraphQL

**추천 자료:**
- 📘 "Operating System Concepts (공룡책)" - Silberschatz
- 📘 "그림으로 배우는 Http & Network Basic" - 우에노 센
- 🎥 [널널한 개발자 - 네트워크 기초](https://www.youtube.com/c/널널한개발자)

---

## 10. 메시징 시스템 ⭐⭐

### 7.1 Kafka

**핵심 개념:**
- [ ] **Producer/Consumer** - Message 발행/구독
- [ ] **Topic & Partition** - 병렬 처리, Ordering 보장
- [ ] **Consumer Group** - Offset 관리, Rebalance
- [ ] **At-least-once vs Exactly-once** - Idempotent Producer
- [ ] **Kafka Streams** - 실시간 데이터 처리

**실습 과제:**
```java
// Producer 설정
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("key.serializer", "org.apache.kafka.common.serialization.StringSerializer");
props.put("value.serializer", "org.apache.kafka.common.serialization.StringSerializer");
props.put("acks", "all");  // 모든 replica 확인

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
producer.send(new ProducerRecord<>("orders", "key", "value"));
```

### 7.2 RabbitMQ

- [ ] **Exchange Type** - Direct, Fanout, Topic, Headers
- [ ] **Queue & Routing Key**
- [ ] **Dead Letter Queue** - 실패한 메시지 처리
- [ ] **Message Acknowledgement**

**Kafka vs RabbitMQ 선택 기준:**
- **Kafka**: 대용량 이벤트 스트리밍, 로그 수집, 실시간 분석
- **RabbitMQ**: 작업 큐, 비동기 처리, 우선순위 큐

**추천 자료:**
- 📘 "카프카, 데이터 플랫폼의 최강자" - 고승범
- 🎥 [Confluent Kafka Tutorials](https://kafka.apache.org/documentation/)

---

## 11. 클라우드 (AWS) ⭐⭐

### 8.1 핵심 서비스

**필수:**
- [ ] **EC2** - Instance Types, Auto Scaling, ELB
- [ ] **RDS** - Multi-AZ, Read Replica, Aurora
- [ ] **S3** - Bucket Policy, Lifecycle, CloudFront
- [ ] **Lambda** - Serverless, Event-driven
- [ ] **VPC** - Subnet, Security Group, NAT Gateway

**중급:**
- [ ] **ECS/EKS** - Container Orchestration
- [ ] **ElastiCache** - Redis, Memcached
- [ ] **SQS** - Message Queue
- [ ] **SNS** - Pub/Sub Notification
- [ ] **CloudWatch** - Monitoring, Logging, Alerting

### 8.2 AWS 아키텍처 패턴

**3-Tier 아키텍처:**
```
Internet → ALB → EC2 (Web/API) → RDS (Database)
                   ↓
              ElastiCache (Redis)
```

**Serverless 아키텍처:**
```
API Gateway → Lambda → DynamoDB
              ↓
             SQS → Lambda → S3
```

**추천 자료:**
- 📘 "AWS 공인 솔루션스 아키텍트" - 시험 가이드
- 🎥 [AWS Skill Builder](https://explore.skillbuilder.aws/)
- 🎥 [AWS Architecture Center](https://aws.amazon.com/architecture/)

---

## 12. 모니터링 & 로깅 ⭐⭐

### 9.1 Observability 3 Pillars

**Metrics (지표):**
- [ ] **Prometheus + Grafana** - 메트릭 수집 및 시각화
- [ ] **Micrometer** - Spring Boot Actuator 메트릭
- [ ] **핵심 지표** - Latency, Throughput, Error Rate, Saturation

**Logging (로깅):**
- [ ] **ELK Stack** - Elasticsearch, Logstash, Kibana
- [ ] **Logback/Log4j2** - 로그 레벨, Appender
- [ ] **구조화 로깅** - JSON 형식, Correlation ID

**Tracing (추적):**
- [ ] **Zipkin/Jaeger** - 분산 추적
- [ ] **OpenTelemetry** - 표준화된 Observability

### 9.2 APM (Application Performance Monitoring)

- [ ] **Pinpoint** - 네이버 오픈소스 APM
- [ ] **New Relic, DataDog** - 상용 APM

**추천 자료:**
- 📘 "사이트 신뢰성 엔지니어링 (SRE)" - Google
- 🎥 [Prometheus 공식 문서](https://prometheus.io/docs/)

---

## 13. 실전 프로젝트 아이디어 ⭐⭐⭐

### 10.1 포트폴리오 프로젝트

**Level 1: 기본 CRUD + 인증**
- [ ] **블로그 플랫폼** - 게시글 CRUD, 댓글, 좋아요, JWT 인증
- [ ] **전자상거래** - 상품 관리, 장바구니, 주문, 결제 (PG 연동)

**Level 2: 성능 최적화**
- [ ] **대용량 트래픽 처리** - Redis 캐싱, Read Replica, Connection Pool 튜닝
- [ ] **동시성 제어** - 재고 차감, 쿠폰 발급, 좌석 예약 (낙관적/비관적 락)

**Level 3: MSA & 분산 시스템**
- [ ] **마이크로서비스 분리** - User, Product, Order 서비스
- [ ] **이벤트 기반 아키텍처** - Kafka로 서비스 간 통신
- [ ] **분산 트랜잭션** - Saga Pattern, Outbox Pattern

### 10.2 오픈소스 기여

- [ ] **Spring Framework** - Issue 해결, 문서 개선
- [ ] **Apache Kafka** - Bug Fix, Feature 추가
- [ ] **작은 프로젝트부터** - Good First Issue 태그 찾기

**추천 자료:**
- 🎥 [GitHub Open Source Guide](https://opensource.guide/)
- 🎥 [Up For Grabs](https://up-for-grabs.net/)

---

## 14. 기술 블로그 & 문서화 ⭐⭐

### 11.1 학습 기록

**블로그 주제:**
- [ ] 문제 해결 과정 (Troubleshooting)
- [ ] 성능 개선 사례 (Before/After)
- [ ] 기술 선택 이유 (Trade-off)
- [ ] 신기술 학습 (POC 결과)

**작성 팁:**
```markdown
# 문제 상황
- 구체적인 에러 메시지, 재현 방법

# 원인 분석
- 로그, 스택 트레이스 분석
- 가설 수립 및 검증

# 해결 방법
- 코드 Before/After
- 성능 비교 (응답 시간, TPS)

# 배운 점
- 근본 원인, 재발 방지 방법
```

### 11.2 추천 기술 블로그

**국내:**
- [우아한형제들 기술 블로그](https://techblog.woowahan.com/)
- [카카오 기술 블로그](https://tech.kakao.com/)
- [네이버 D2](https://d2.naver.com/)
- [토스 기술 블로그](https://toss.tech/)

**해외:**
- [Netflix Tech Blog](https://netflixtechblog.com/)
- [Uber Engineering](https://eng.uber.com/)
- [Airbnb Engineering](https://medium.com/airbnb-engineering)

---

## 15. 면접 준비 ⭐⭐⭐

### 12.1 기술 면접

**카테고리별 예상 질문:**

**Java/Spring:**
- JVM 메모리 구조를 설명하고, GC 동작 원리를 설명해주세요
- @Transactional 동작 원리와 Propagation을 설명해주세요
- N+1 문제를 해결한 경험을 설명해주세요

**데이터베이스:**
- 인덱스는 언제 사용하고, 어떻게 동작하나요?
- 트랜잭션 격리 수준의 차이점을 설명해주세요
- 대용량 데이터를 처리한 경험이 있나요?

**시스템 설계:**
- URL Shortener를 설계한다면 어떻게 하시겠습니까?
- 대규모 트래픽을 처리하기 위한 방법은?
- 캐싱 전략을 설명해주세요

**실무 경험:**
- 가장 기억에 남는 문제 해결 경험은?
- 성능 개선을 위해 어떤 노력을 했나요?
- 장애 대응 경험을 공유해주세요

### 12.2 코딩 테스트

**시간 배분 (2시간 기준):**
- 문제 이해 및 계획: 15분
- 코드 작성: 1시간 30분
- 테스트 케이스 검증: 15분

**체크리스트:**
- [ ] 시간/공간 복잡도 분석
- [ ] 엣지 케이스 처리 (null, 빈 배열, 최댓값)
- [ ] 변수명, 함수명 명확하게
- [ ] 주석으로 의도 설명

### 12.3 행동 면접 (Behavioral)

**STAR 기법:**
- **S**ituation (상황): 어떤 상황이었나요?
- **T**ask (과제): 어떤 목표가 있었나요?
- **A**ction (행동): 무엇을 했나요?
- **R**esult (결과): 어떤 결과를 얻었나요?

**예시 질문:**
- 팀원과 의견 충돌이 있었던 경험은?
- 마감 기한을 맞추지 못할 뻔한 경험은?
- 새로운 기술을 빠르게 학습한 경험은?

**추천 자료:**
- 📘 "코딩 인터뷰 완전 분석" - Gayle Laakmann McDowell
- 🎥 [Tech Interview Handbook](https://www.techinterviewhandbook.org/)

---

## 학습 로드맵 (3개월 플랜)

### 1개월차: 기본기 다지기
**주중 (월~금):**
- 오전: Java/Spring 개념 학습 (2시간)
- 오후: 알고리즘 문제 풀이 (1시간)
- 저녁: CS 기초 (1시간)

**주말:**
- 토: 프로젝트 구현 (4시간)
- 일: 기술 블로그 작성 (2시간)

**체크리스트:**
- [ ] Java 핵심 개념 30개 정리
- [ ] 프로그래머스 Level 2 30문제
- [ ] 미니 프로젝트 1개 완성

### 2개월차: 심화 학습
**주중:**
- 오전: Spring 심화, JPA 최적화 (2시간)
- 오후: LeetCode Medium 문제 (1시간)
- 저녁: 시스템 설계 학습 (1시간)

**주말:**
- 토: 메인 프로젝트 개발 (5시간)
- 일: 시스템 설계 문제 연습 (3시간)

**체크리스트:**
- [ ] Spring 면접 질문 50개 답변 작성
- [ ] LeetCode Medium 50문제
- [ ] 시스템 설계 5개 문제 연습
- [ ] 메인 프로젝트 MVP 완성

### 3개월차: 실전 대비
**주중:**
- 오전: 기술 면접 질문 답변 연습 (2시간)
- 오후: 모의 코딩테스트 (1시간)
- 저녁: AWS, Kafka 등 추가 기술 학습 (1시간)

**주말:**
- 토: 프로젝트 마무리 & 배포 (4시간)
- 일: 모의 면접 & 피드백 (3시간)

**체크리스트:**
- [ ] 기술 면접 질문 100개 답변 완성
- [ ] 모의 코딩테스트 10회 (2시간 제한)
- [ ] 프로젝트 배포 (AWS EC2, RDS)
- [ ] 기술 블로그 10개 포스트
- [ ] 이력서 & 포트폴리오 완성

---

## 추천 학습 순서

### 우선순위 1 (필수) - 매일
1. **알고리즘 문제 풀이** (1시간)
2. **Java/Spring 개념** (1시간)
3. **프로젝트 구현** (주말 4시간)

### 우선순위 2 (중요) - 주 3회
4. **데이터베이스** (인덱스, 쿼리 최적화)
5. **CS 기초** (운영체제, 네트워크)
6. **시스템 설계**

### 우선순위 3 (심화) - 주 1회
7. **Kafka, Redis** (메시징, 캐싱)
8. **AWS** (클라우드 아키텍처)
9. **모니터링** (Prometheus, ELK)

---

## 마무리: 이직 성공을 위한 팁

### 1. 꾸준함이 핵심
- **매일 1시간**이라도 꾸준히 학습하기
- GitHub 잔디 심기 (commit streak)
- 학습 기록을 블로그/노션에 정리

### 2. 실전 프로젝트 중요성
- **토이 프로젝트보다 실무형 프로젝트**
- 단순 CRUD가 아닌 **성능 최적화, 동시성 제어** 등 고민한 흔적
- **README에 기술 선택 이유, 트레이드오프** 명시

### 3. 네트워킹
- **개발자 커뮤니티** 참여 (OKKY, 인프런, 42서울)
- **오픈소스 기여**로 실력 증명
- **스터디 그룹** 만들기 (면접 스터디, 알고리즘 스터디)

### 4. 멘탈 관리
- 면접 탈락은 당연한 과정
- **피드백 받고 개선**하기
- 장기전으로 생각하고 번아웃 방지

---

## 참고 자료 모음

### 📚 필독서
1. "Effective Java 3판" - Joshua Bloch
2. "자바 ORM 표준 JPA 프로그래밍" - 김영한
3. "Real MySQL 8.0" - 백은빈, 이성욱
4. "가상 면접 사례로 배우는 대규모 시스템 설계 기초" - Alex Xu
5. "이것이 취업을 위한 코딩 테스트다" - 나동빈

### 🎥 온라인 강의
- [인프런 - 김영한의 스프링 로드맵](https://www.inflearn.com/roadmaps/373)
- [프로그래머스 - 코딩테스트 고득점 Kit](https://programmers.co.kr/learn/challenges)
- [Udemy - AWS Certified Solutions Architect](https://www.udemy.com/course/aws-certified-solutions-architect-associate-saa-c03/)

### 🌐 유용한 사이트
- [Baeldung](https://www.baeldung.com/) - Java/Spring 튜토리얼
- [LeetCode](https://leetcode.com/) - 알고리즘 문제
- [System Design Primer](https://github.com/donnemartin/system-design-primer) - 시스템 설계
- [Tech Interview Handbook](https://www.techinterviewhandbook.org/) - 면접 준비

---

## 체크리스트

이직 준비를 시작하기 전에 아래 체크리스트를 확인하세요:

### 기술 역량
- [ ] Java/Spring 핵심 개념 80% 이상 이해
- [ ] 알고리즘 문제 200개 이상 풀이
- [ ] 실무형 프로젝트 1개 이상 완성
- [ ] 데이터베이스 쿼리 최적화 경험
- [ ] 시스템 설계 5개 문제 연습

### 포트폴리오
- [ ] GitHub 프로필 정리 (README, Pinned Repositories)
- [ ] 기술 블로그 10개 이상 포스트
- [ ] 프로젝트 README 상세 작성 (기술 스택, 아키텍처, 트러블슈팅)
- [ ] 오픈소스 기여 경험 (선택)

### 면접 준비
- [ ] 기술 면접 질문 100개 답변 작성
- [ ] 모의 코딩테스트 10회 이상
- [ ] 시스템 설계 모의 면접 5회 이상
- [ ] 자기소개 및 경력 기술서 작성

### 이력서
- [ ] 기술 스택 명확히 기재 (경력별 프로젝트)
- [ ] 성과 중심으로 작성 (숫자로 증명)
- [ ] 맞춤법, 오탈자 확인
- [ ] PDF 파일로 준비

---

**이 로드맵은 계속 업데이트됩니다. 여러분의 이직 준비를 응원합니다! 💪**

*마지막 업데이트: 2025년 1월*
