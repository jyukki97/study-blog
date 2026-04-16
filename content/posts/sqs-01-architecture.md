---
title: "[1편] 간단한 메시지 큐에서 멀티 테넌트 시스템까지"
date: 2025-06-17
draft: false
tags: ["메시지큐", "멀티테넌트", "Spring Boot", "Redis"]
categories: ["Development", "Learning"]
description: "간단한 REST API + Redis 메시지 큐를 만들다가 멀티 테넌트 분리의 필요성을 깨달은 경험담"
project: "Simple Queue Service"
series: "Simple Queue Service"
---

> "간단하게 시작했는데..."

Kafka 나 AWS SQS 같은 걸 직접 만들어보면 재밌을 것 같다는 생각에서 시작한 프로젝트였습니다. 처음엔 정말 간단하게 "메시지 넣고 빼기"만 구현하려고 했는데... 

이번 포스트에서는 **간단한 큐에서 시작해서 멀티 테넌트 시스템이 필요해진 과정**을 공유해보겠습니다.

## 🤔 1단계: "정말 간단한" 큐부터 시작

### 처음의 순진한 생각
```kotlin
// 정말로 이것부터 시작했습니다
@RestController
class SimpleQueueController {
    private val messages = mutableListOf<String>()
    
    @PostMapping("/send")
    fun sendMessage(@RequestBody message: String): String {
        messages.add(message)
        return "메시지 전송 완료"
    }
    
    @GetMapping("/receive")
    fun receiveMessage(): String? {
        return if (messages.isNotEmpty()) {
            messages.removeAt(0)
        } else {
            null
        }
    }
}
```

"간단하게 메시지를 전달하고 받는 API 에서 시작했습니다..."

### 첫 번째 문제: 메시지가 사라져버린다 😱

서버를 재시작하면 모든 메시지가 사라져버렸습니다. 당연한 거였는데 왜 생각 못했을까요?

```kotlin
// Redis로 저장하도록 개선
@RestController
class QueueController(
    private val redisTemplate: RedisTemplate<String, String>
) {
    @PostMapping("/send")
    fun sendMessage(@RequestBody message: String): String {
        redisTemplate.opsForList().rightPush("simple-queue", message)
        return "메시지 저장 완료"
    }
    
    @GetMapping("/receive")
    fun receiveMessage(): String? {
        return redisTemplate.opsForList().leftPop("simple-queue")
    }
}
```


## 🔧 2단계: "진짜" 큐 기능들 추가

### 가시성 타임아웃 구현하기

메시지를 받아간 후 처리 중에 Consumer가 죽으면 어쩌지?...
처리하지 못한 메시지는 다시 복구되도록 타임아웃 후에 복구

```kotlin
// 메시지 수신 시 InFlight 추가
// => 다음 수신 시 만료된 메시지를 복원하는 로직부터 실행 or 스케줄러에서 주기적으로 복원
private fun addToInFlight(queue: Queue, message: Message): Mono<Long> {
    val score = message.visibleAt.epochSecond.toDouble()
    val value = "${message.messageId}:${message.receiptHandle}"
    return redisTemplate.opsForZSet()
        .add(queue.getInFlightKey(), value, score)
        .map { if (it) 1L else 0L }
}
```

### 지연 큐 (Delay Queue) 구현

"메시지를 보내는데, 5분 후에 도착했으면 좋겠는데?..."

```kotlin
private fun addToQueue(queue: Queue, message: Message): Mono<Long> {
    return if (message.visibleAt > Instant.now()) {
        // 지연된 메시지는 delayed queue에 추가
        val score = message.visibleAt.epochSecond.toDouble()
        redisTemplate.opsForZSet()
            .add(queue.getDelayedKey(), message.messageId, score)
            .map { if (it) 1L else 0L }
    } else {
        // 즉시 처리 가능한 메시지는 available queue에 추가
        redisTemplate.opsForList()
            .rightPush(queue.getMessagesKey(), message.messageId)
    }
}
```

## 🚨 3단계: 생각해보니 서비스하려면 유저도 필요하지않나?...

여기서부터 이 프로젝트가 "장난감 큐"에서 "운영을 흉내 내는 시스템"으로 넘어가기 시작했습니다. 단일 사용자 기준에서는 큐 이름 하나만 잘 정해도 별문제가 없는데, 여러 팀이나 여러 서비스가 동시에 쓰기 시작하면 기준이 완전히 바뀝니다.

예를 들어 이런 질문이 바로 생깁니다.

- 같은 `orders` 큐 이름을 두 팀이 동시에 쓰면 누구 메시지인지 어떻게 구분할까?
- 특정 팀의 실수나 폭주가 다른 팀 큐 처리량에 영향을 주면 어떻게 막을까?
- 장애가 났을 때 "어느 테넌트의 어떤 큐에서" 문제가 났는지 바로 추적할 수 있을까?

이 질문에 답하지 못하면, 기능은 있어도 서비스로 운영하기는 어렵습니다. 그래서 멀티 테넌트 분리는 단순 인증 기능 추가가 아니라, **데이터 모델, 키 설계, 관측성 기준을 전부 다시 정리하는 작업**에 가까웠습니다.

## 멀티 테넌트로 넘어가면서 기준이 달라진 지점

처음에는 "API Key 하나 붙이면 되겠지"라고 생각했는데, 실제로는 그보다 훨씬 넓은 범위를 건드려야 했습니다.

### 1) 큐 이름보다 '소유자 컨텍스트'가 먼저여야 했다

단일 테넌트 환경에서는 `order-processing`, `email-send`, `billing` 같은 이름이 곧 식별자였습니다. 하지만 멀티 테넌트에서는 이름만으로는 아무 의미가 없습니다. 중요한 건 "누가 만든 큐인가"입니다.

그래서 키 설계도 `queue:{queueName}` 중심에서 `tenant:{tenantId}:queue:{queueName}` 중심으로 바뀌었습니다. 이 차이가 중요한 이유는 단순 충돌 방지뿐 아니라, 나중에 통계 집계, 삭제 범위 제한, 운영자 검색까지 전부 이 구조를 타게 되기 때문입니다.

### 2) 인증보다 격리가 더 큰 문제였다

인증은 "이 요청이 누구 것인가"를 확인하는 문제이고, 격리는 "그래서 어디까지 접근 가능해야 하는가"를 제한하는 문제였습니다.

예를 들어 API Key 인증만 붙여도 요청 자체는 구분됩니다. 그런데 서비스 코드 내부에서 큐 조회, 메시지 조회, DLQ 조회가 전부 tenant context를 빠뜨린 채 구현돼 있으면, 인증은 있어도 격리는 무너집니다. 그래서 이후 단계에서는 controller보다 service와 storage key 생성기를 더 조심해서 보게 됐습니다.

### 3) 운영 화면이 없으면 격리 설계가 맞는지 검증하기가 어렵다

멀티 테넌트 구조를 넣고 나면, 실제로는 "정말 분리됐는지" 확인하는 도구가 필요합니다. 이게 다음 글인 [2편 Admin 페이지 구현](/posts/sqs-02-admin-dashboard/)으로 자연스럽게 이어진 이유입니다. 눈으로 큐 목록, 메시지 수, 테넌트별 상태를 확인해 보지 않으면 설계가 맞는지 계속 확신하기 어렵더라고요.

## 실무 관점에서 먼저 챙겨야 했던 체크리스트

이 단계에서 지금 다시 시작한다면, 저는 아래 항목부터 먼저 고정할 것 같습니다.

- [ ] 큐/메시지/DLQ 키에 tenant context가 빠질 여지가 없는가
- [ ] 로그와 메트릭에서 tenantId, queueName, messageId를 함께 남기는가
- [ ] 큐 삭제, 재처리, DLQ 조회 같은 관리 기능이 테넌트 경계를 넘지 않는가
- [ ] 테스트 데이터도 단일 테넌트 시나리오만이 아니라 2개 이상 테넌트 충돌 시나리오를 포함하는가
- [ ] 운영자가 상태를 눈으로 확인할 수 있는 최소 대시보드가 있는가

이 체크리스트를 먼저 잡아 두면, 이후 저장소 구조를 바꾸거나 UI를 붙일 때도 기준이 흔들리지 않습니다.

## 🚨 3단계: 생각해보니 서비스하려면 유저도 필요하지않나?...

### 문제의 시작: "유저가 필요하다!"

생각해보니 Queue 를 서비스한다라고 생각하면 유저가 있어야한다!

**진짜 멀티 테넌트 시스템을 만들어야겠다고 결심!**

```kotlin
// 테넌트 엔티티 정의
data class Tenant(
    val tenantId: String,
    val apiKey: String,
    val name: String,
    val createdAt: Instant,
    val isActive: Boolean = true
)
```

### API Key 기반 테넌트 분리


```kotlin
// API Key 기반 인증 필터
@Component
class ApiKeyAuthenticationFilter(
    private val tenantService: TenantService,
    private val objectMapper: ObjectMapper
) : WebFilter {
    ......
}
```

### 문제점: "유저 별로 토픽 이름이 겹치면?..."

생각해보니 토픽 이름이 유저별로 겹칠 수 있다... 닉네임 선점?..

#### 키 구조를 바꾸자

```kotlin
// Before: 전역 네임스페이스
"queue:my-queue"
"queue:messages:my-queue"

// After: 테넌트별 네임스페이스  
"tenant:{tenantId}:queue:my-queue"
"tenant:{tenantId}:queue:messages:my-queue"
"tenant:{tenantId}:queue:delayed:my-queue"
```

## 🏗️ 4단계: 최종 아키텍처가 나올 때까지

### 진화한 최종 구조

수많은 시행착오 끝에 도달한 아키텍처입니다:

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Applications                      │
│                 (팀별로 각자의 API Key로 접근)                   │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTP/REST API
┌────────────────────────────▼────────────────────────────────┐
│                  API Gateway Layer                          │
│          - 인증: "이 API Key는 어느 테넌트의 것인가?"              │
│          - 격리: "테넌트별로 완전히 분리된 네임스페이스"               │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│              Multi-Tenant Application Layer                 │
│   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│   │   Queue     │ │   Message   │ │   Tenant    │           │
│   │ Controller  │ │ Controller  │ │ Controller  │           │
│   └─────────────┘ └─────────────┘ └─────────────┘           │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│               Tenant-Aware Storage Layer                    │
│  tenant:{tenantId}:queue:{queueName}                        │
│  tenant:{tenantId}:messages:{queueName}                     │
│  tenant:{tenantId}:delayed:{queueName}                      │
└─────────────────────────────────────────────────────────────┘
```

### 실제 사용 흐름

```kotlin
// 1. 테넌트 생성
POST /admin/tenants
{
  "name": "backend-team",
  "description": "백엔드 팀 전용 큐"
}
// 응답: { "apiKey": "sk-abc123..." }

// 2. 해당 테넌트에서 큐 생성  
POST /api/v1/queues
Headers: X-API-Key: sk-abc123...
{
  "queueName": "order-processing"
}

// 3. 메시지 전송 (테넌트별로 완전 격리됨)
POST /api/v1/queues/order-processing/messages
Headers: X-API-Key: sk-abc123...
{
  "messageBody": "주문 처리 요청"
}
```

## 🔄 5단계: 테스트 해보며 생긴 문제들

### 문제 1: 큐가 너무 많다

테스트하느라 큐를 많이 만들다보니 이제 몇개를 만들었는지 기억도 안난다...

```kotlin
// 큐 목록 조회 API 추가
@GetMapping("/queues")
fun listQueues(
    @RequestParam(defaultValue = "20") limit: Int,
    @RequestParam(defaultValue = "0") offset: Int,
    @RequestParam(required = false) namePattern: String?
): Mono<ApiResponse<QueueListResponse>> {
    return queueService.listQueues(limit, offset, namePattern)
        .map { ApiResponse.success(it) }
}
```

### 문제 2: 메시지 처리 실패 시?....

가시성 타임아웃 구현으로 실패시 다시 복구가 되는데...
계속 실패하면 큐가 망가지지 않을까?...

**데드레터 큐(DLQ) 구현이 필요했습니다.**

```kotlin
// 큐 생성 시 DLQ 설정 가능하도록
data class CreateQueueRequest(
    val queueName: String,
    val attributes: QueueAttributes = QueueAttributes()
)

data class QueueAttributes(
    val visibilityTimeoutSeconds: Int = 30,
    val maxReceiveCount: Int = 3,
    val deadLetterTargetArn: String? = null // DLQ 이름
)
```

### 문제: "API를 curl 일일이 써가면서 하니까 너무 불편한데?..."

처음에는 개발하면서 성공하나?.. 하면서 콜 했던 API 들이 많아지니까 너무 불편하다...

### 해결: Admin 페이지의 필요성이 절실해졌다

**원하는 기능들:**
- 전체 큐 목록 및 각 큐의 상태 조회
- 실시간 메시지 개수 (대기/처리중/DLQ)
- 큐 생성/삭제/설정 변경을 위한 UI

## 🚀 다음 편 예고

다음 편에서는 실제로 **Admin 페이지를 구현하는 과정**을 자세히 다뤄보겠습니다.

- React로 관리자 대시보드 만들기