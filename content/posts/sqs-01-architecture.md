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