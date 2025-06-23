---
title: "[3편] 메시지 큐에서 Redis를 쓰는게 맞을까?..."
date: 2025-06-19
draft: false
tags: ["Redis", "FIFO", "Spring Boot", "메시지큐"]
categories: ["Development", "Learning"]
description: "간단한 REST API + Redis 메시지 큐를 만들다가 멀티 테넌트 분리의 필요성을 깨달은 경험담"
project: "Simple Queue Service"
series: "Simple Queue Service"
---

> Redis는 빠르지만 생각해보니 메시지 쌓이면 메모리 아깝겠는데?... 이거 큐에서 써도 되나?

관리 도구까지 만들고 나서, 더 할거 없나 찾는 도중에 정말로 **현실적인 고민**이 시작되더라고요. Redis는 분명 빠르지만, Queue로 쓰기에는 뭔가 아쉬운 부분들이 있었어요.

**솔직한 고민들:**
- 사용자가 늘어나면 메시지도 폭증할 텐데...
- 이걸 다 메모리에 담고 있어야 하나?
- 메모리 비용이 너무 비싸지 않을까?

이번 포스트에서는 **처음 고민부터 실제 구현까지의 전 과정**을 솔직하게 공유해보겠습니다.

## 🤔 처음 고민: "Redis는 빠르지만 Queue로는 아쉬워"

### 메모리 기반의 한계

Redis를 쓰면서 계속 마음에 걸렸던 부분들:

**1. 메모리는 코스트가 높다**

안그래도 메모리는 별로 없는데 메시지는 쌓이면 계속 쌓일거란 말이지...

**2. Queue로 쓰기엔 뭔가 아쉬운 게 있어**

Redis는 캐시나 세션 저장용으로는 완벽하지만, Queue로 쓰기엔:
- 모든 데이터가 메모리에 상주해야 함
- 사용자가 늘면 메시지도 폭증할 텐데...
- 오래된 메시지까지 비싼 메모리를 점유
- 14일 보관 정책이면 정말 큰 메모리가 필요

#### "Queue에서 Redis 써도 되는거 맞아?..."

### "Kafka처럼 파일시스템으로 가볼까?"

Kafka 써보기도 했고... 대략 구조도 알고 하니... 이거 따라가볼까??..

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Producer   │───▶│ Disk-based  │◀───│  Consumer   │
│             │    │   Storage   │    │             │
└─────────────┘    └─────────────┘    └─────────────┘
                          │
                    ┌─────▼─────┐
                    │  segment  │
                    │   files   │
                    └───────────┘
```

**Kafka의 매력:**
- 디스크 기반이라 용량 걱정 없음
- 순차 접근으로 디스크도 충분히 빠름

**걱정:**
> "아니... 파일시스템.. 느리겠는데?... 이거 나는 빠르게 구현할 자신이 없는디... 이게 Simple Queue 인데 느리면 이거 뭐 대용량 쓰는것도 아니고 굳이... 그리고 생각해야될게 너무 많은데?..."

**구현해야 할 것들:**
- 파일 포맷 설계
- 인덱싱 시스템  
- 파일 로테이션
- 동시성 제어
- 에러 복구
- 데이터 압축

### "아... 이걸 어쩌냐... 흠..."

그러다가 번뜩 든 생각: **메모리에 들고있다가 오래된 것만 파일로 넘길까?**

**핵심 아이디어:**
- **인메모리에 들고 있다가**
- **좀 쌓인 메시지는 디스크에 넣는 거지**

```
Hot Storage (Redis Memory):
└─ 최근 메시지, 즉시 처리 필요
└─ 비싸지만 빠름

Cold Storage (File System):  
└─ 오래된 메시지, 장기 보관
└─ 저렴하지만 느림
```

**예상 효과:**
- 성능: Hot 영역은 Redis 수준 유지
- 비용: 대부분 데이터는 저렴한 디스크에
- 복잡도: 점진적 구현 가능

## 🚨 그런데... FIFO가 문제였다

### 설계하다가 깨달은 치명적 문제

Hot/Cold 아이디어에 신이 나서 설계하다가, **갑자기 든 생각...**

> "FIFO는 결국 언제나 디스크를 확인해야 하는 거 아닌가?"

#### "어.. 음.. FIFO 는 순서가 보장되어야하는데... 이게 오래된건 Cold 에 가있을 테니... FIFO 는 언제나 디스크를 봐야하네?..."

**문제의 핵심:**
- **FIFO 보장을 위해 항상 Cold Storage 확인 필요**
- Hot이 비어있어도 Cold에 더 오래된 메시지가 있을 수 있음
- 결국 매번 디스크 I/O를 피할 수 없음

**그 순간의 절망:**
```
성능 향상을 위해 Hot/Cold로 나눴는데...
FIFO 때문에 결국 Cold를 매번 확인해야 함
그럼 성능 이점이 없어지는 거 아닌가? 🤯
```

### 뭐 FIFO 는 느릴 수도 있지~

```
┌─────────────┐    Hot (Redis Memory)     ┌─────────────┐
│  Producer   │───▶ 즉시 처리 메시지        │  Consumer   │
└─────────────┘    1시간 보관             └─────────────┘
                        │
                   자동 이관 (1시간 후)
                        ▼
                 Warm (Redis Disk)
                    중간 빈도 접근
                     24시간 보관
                        │
                   자동 이관 (24시간 후)
                        ▼
                 Cold (File System)
                   장기 보관 저장소
                    14일간 보관
```

**기대했던 효과:**
- Hot에만 최근 1시간 메시지 → 메모리 사용량 95% 감소
- Warm에서 중간 처리 → 성능 손실 최소화  
- Cold에서 장기 보관 → 비용 절약

**설정값들:**
```yaml
# application.yml 설정
app:
  storage:
    hot:
      ttl-hours: 1
      max-memory-usage-percent: 80
    warm:
      ttl-days: 1
      max-disk-usage-gb: 100
    cold:
      base-path: ${COLD_STORAGE_PATH:/tmp/sqs-cold-storage}
      compression-enabled: true
      encryption-enabled: false
      max-file-size-mb: 100
    tiering:
      enabled: true
      check-interval-seconds: 300  # 5분
      batch-size: 1000
      hot-to-warm-age-seconds: 3600    # 1시간
      warm-to-cold-age-seconds: 86400  # 24시간
```

## 실제 구현: UnifiedStorageService

### 핵심 아키텍처

```kotlin
@Service
class UnifiedStorageService(
    private val hotStorage: HotStorageService,      // Redis 메모리
    private val warmStorage: WarmStorageService,    // Redis 디스크
    private val coldStorage: ColdStorageService,    // 파일시스템
    private val tieringManager: TieringManagerService // 계층화 관리
) {
    
    // 메시지 저장 (항상 Hot부터 시작)
    suspend fun saveMessage(message: Message): Boolean {
        val saved = hotStorage.saveMessage(message)
        if (saved) {
            tieringManager.trackMessageLocation(message.messageId, StorageTier.HOT)
        }
        return saved
    }
    
    // 메시지 조회 (위치 추적으로 최적화)
    suspend fun getMessage(messageId: String): Message? {
        // 1. 위치 정보로 빠른 조회
        val location = tieringManager.getMessageLocation(messageId)
        if (location != null) {
            val storageService = getStorageService(location.tier)
            val message = storageService.getMessage(messageId)
            if (message != null) {
                // 접근했으므로 Hot 승격 고려
                considerPromotion(messageId, location.tier)
                return message
            }
        }
        
        // 2. 전체 계층 순차 검색 (Hot → Warm → Cold)
        return hotStorage.getMessage(messageId)
            ?: warmStorage.getMessage(messageId)?.also { 
                tieringManager.promoteMessage(messageId, StorageTier.HOT)
            }
            ?: coldStorage.getMessage(messageId)?.also { 
                tieringManager.promoteMessage(messageId, StorageTier.WARM)
            }
    }
}
```

## 첫 번째 현실: FIFO가 진짜 문제였다

### 예상했던 문제가 현실로

```kotlin
// FIFO 큐에서 가장 오래된 메시지 조회
suspend fun getOldestMessage(queue: Queue): Message? {
    val queueName = "${queue.tenantId}:${queue.queueName}"
    
    return when (queue.queueType) {
        QueueType.FIFO -> {
            // 😱 결국 모든 계층을 순서대로 검색해야 함
            hotStorage.getOldestMessage(queueName)
                ?: warmStorage.getOldestMessage(queueName)?.also { 
                    tieringManager.promoteMessage(it.messageId, StorageTier.HOT)
                }
                ?: coldStorage.getOldestMessage(queueName)?.also { 
                    tieringManager.promoteMessage(it.messageId, StorageTier.HOT)
                }
        }
        QueueType.STANDARD -> {
            // Standard는 Hot 우선으로 최적화 가능
            hotStorage.getOldestMessage(queueName) ?: run {
                scheduleAsyncPromotion(queueName)
                null
            }
        }
    }
}
```

**발견한 문제:**
- FIFO는 **순서 보장 때문에 항상 모든 계층 확인 필요**
- Hot이 비어있어도 Warm/Cold에 더 오래된 메시지가 있을 수 있음
- 결국 Cold Storage I/O를 피할 수 없음

### 해결책: 큐 타입별 다른 전략

```kotlin
enum class QueueType {
    FIFO,     // 순서 보장 (모든 계층 검색)
    STANDARD  // 최적 성능 (Hot 우선)
}
```

**FIFO 큐:**
- 정확성 우선: 모든 계층 검색
- 성능 손실 감수
- 중요한 워크플로우용

**Standard 큐:**  
- 성능 우선: Hot 스토리지만 확인
- 백그라운드에서 비동기 승격
- 대용량 처리용

## 😅 두 번째 현실: 메시지 위치 추적도 메모리를 먹는다

### 예상치 못한 메타데이터 오버헤드

```kotlin
// 메시지마다 위치 정보를 추적해야 함
data class MessageLocation(
    val messageId: String,
    val tier: StorageTier,
    val lastAccessTime: Instant,
    val accessCount: Long = 0,
    val migrationHistory: List<TierMigrationRecord> = emptyList()
)

// 이것도 결국 Redis 메모리 사용... 😅
```

**현실 체크:**
- 메시지 1백만 개 = 위치 정보도 1백만 개
- 메타데이터만으로도 상당한 메모리 사용
- "메모리 절약하려다가 메모리 더 쓰는 거 아닌가?" 싶은 순간

### 해결책: 캐시 + 만료 정책

```kotlin
@Service
class TieringManagerServiceImpl {
    private val messageLocationCache = ConcurrentHashMap<String, MessageLocation>()
    
    override suspend fun trackMessageLocation(messageId: String, tier: StorageTier) {
        val location = MessageLocation(
            messageId = messageId,
            tier = tier,
            lastAccessTime = Instant.now()
        )
        
        // 메모리 캐시
        messageLocationCache[messageId] = location

        ...
    }
}
```

## 🚀 다음에 할 것

- 음... FIFO 는 순서가 보장되어야 하니까 Cold 만 보면 될 것 같다?...
- 그렇다면 FIFO 는 오래된 걸 Cold 로 보내는게 아니라 최근 메시지를 Cold 로 보내면 되지않을까?...
- 이럴려면 현재는 오래된 즉, 시간으로만 Hot/Cold 를 보내는데, 메시지 갯수로도 보내는 걸 추가하고..
- FIFO 는 메시지 갯수가 넘어가면 최신부터 Cold 로 넘기는걸 하면 될지도?...
- 다음에 해보자~

