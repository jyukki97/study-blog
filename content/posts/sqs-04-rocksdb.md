---
title: "[4편] Warm Storage를 위해 RocksDB를 선택한 이유"
date: 2025-06-23
draft: false
tags: ["RocksDB", "Storage", "Spring Boot", "메시지큐"]
categories: ["Development", "Learning"]
description: "Redis Disk에서 RocksDB로 전환하며 겪은 시행착오와 COLD Storage 구현기"
project: "Simple Queue Service"
series: "Simple Queue Service"
---

> "Redis Disk라... 구현을 시작해볼까?"

지난편에서 Hot/Warm/Cold 스토리지 계층화를 설계하면서, Warm Storage를 "Redis Disk"라고 했었는데요. 실제로 구현하다 보니 **"이게 정말 맞나?"** 싶은 순간들이 많았어요.

이번 포스트에서는 **Redis Disk에서 RocksDB로 전환한 이유**와 **실제 구현 과정에서 겪은 문제들**을 솔직하게 공유해보겠습니다.

## 🤔 처음 계획: "Redis Disk면 되겠지?"

### 초기 아키텍처의 순진한 생각

```
Hot (Redis Memory) → Warm (Redis Disk) → Cold (File System)
```

**당시 생각:**
- Redis는 이미 써봤으니까 익숙하고
- ChatGPT 한테 물어보니 Redis Disk 라는게 있다고하고
- Redis Disk 관련 설정만 바꾸면 되겠지?
- 같은 Redis니까 연동도 쉬울 거고

### 첫 번째 충격: Redis Disk가 생각과 달랐다

실제로 Redis 설정을 건드려보니...

```redis
# Redis persistence 설정
save 900 1      # 900초마다 최소 1개 변경시 저장
save 300 10     # 300초마다 최소 10개 변경시 저장
save 60 10000   # 60초마다 최소 10000개 변경시 저장

# AOF 설정
appendonly yes
appendfsync everysec
```

**문제 발견:**
- Redis Disk = 메모리 데이터의 백업용이지, 별도 디스크 스토리지가 아님
- 결국 모든 데이터가 메모리에 상주해야 함
- "Warm"의 목적(메모리 절약)을 전혀 달성할 수 없음

> "아... 이거 완전 잘못 생각했네... Redis Disk는 그냥 백업용이었구나..."

## 🔍 대안 찾기: "그럼 뭘 써야 하지?"

### 요구사항 정리

**Warm Storage가 해야 할 일:**
1. Hot에서 넘어온 데이터를 디스크에 저장 (메모리 절약)
2. 빠른 조회 (Redis 수준은 아니어도 합리적인 성능)
3. TTL 지원 (자동 만료)
4. 순차 접근 지원 (FIFO 큐를 위한)

### 후보들 검토

**1. SQLite**
```kotlin
// 장점: 가벼움, SQL 지원
// 단점: 동시성 제한, 큐 작업에는 오버헤드
```

**2. LevelDB/RocksDB**
```kotlin
// 장점: Key-Value 최적화, 높은 성능, 순차 접근 지원
// 단점: TTL 네이티브 지원 안 함
```

**3. MapDB**
```kotlin
// 장점: Java 네이티브, 다양한 자료구조
// 단점: 성능이 아쉬움, 커뮤니티 작음
```

### "RocksDB로 결정!"

결국 **RocksDB**를 선택한 이유:

**1. 성능**: LSM Tree 기반으로 Write 성능이 뛰어남
**2. 순차 접근**: Iterator 지원으로 FIFO 구현에 적합
**3. 검증됨**: Kafka, Cassandra 등에서 실제 사용
**4. JNI 바인딩**: Java에서 사용 가능

```kotlin
// RocksDB의 매력적인 특징들
val options = Options()
    .setCreateIfMissing(true)
    .setMaxBackgroundJobs(4)
    .setWriteBufferSize(64 * 1024 * 1024) // 64MB
    
val db = RocksDB.open(options, "/path/to/warm-storage")
```

## 🛠️ 실제 구현: WarmStorageService

### TTL 문제 해결하기

RocksDB는 TTL을 네이티브로 지원하지 않아서 직접 구현해야 했어요.

```kotlin
@Service
class RocksDBWarmStorageService {
    
    // 메시지 저장 시 TTL 정보도 함께 저장
    suspend fun saveMessage(message: Message): Boolean {
        val messageData = MessageWithTTL(
            message = message,
            expireAt = Instant.now().plus(warmStorageTtl)
        )
        
        val key = message.messageId.toByteArray()
        val value = objectMapper.writeValueAsBytes(messageData)
        
        return withContext(Dispatchers.IO) {
            try {
                rocksDB.put(key, value)
                true
            } catch (e: Exception) {
                logger.error("Failed to save message to warm storage", e)
                false
            }
        }
    }
    
    // 조회 시 TTL 체크
    suspend fun getMessage(messageId: String): Message? {
        val key = messageId.toByteArray()
        
        return withContext(Dispatchers.IO) {
            try {
                val value = rocksDB.get(key) ?: return@withContext null
                val messageWithTTL = objectMapper.readValue<MessageWithTTL>(value)
                
                // TTL 체크
                if (messageWithTTL.expireAt.isBefore(Instant.now())) {
                    // 만료된 메시지는 삭제하고 null 반환
                    rocksDB.delete(key)
                    null
                } else {
                    messageWithTTL.message
                }
            } catch (e: Exception) {
                logger.error("Failed to get message from warm storage", e)
                null
            }
        }
    }
}
```

### FIFO를 위한 순차 접근 구현

```kotlin
// 큐의 가장 오래된 메시지 찾기
suspend fun getOldestMessage(queueName: String): Message? {
    val prefix = "${queueName}:".toByteArray()
    
    return withContext(Dispatchers.IO) {
        rocksDB.newIterator().use { iterator ->
            iterator.seek(prefix)
            
            while (iterator.isValid()) {
                val key = iterator.key()
                
                // 큐 prefix 체크
                if (!key.startsWith(prefix)) break
                
                val value = iterator.value()
                val messageWithTTL = objectMapper.readValue<MessageWithTTL>(value)
                
                // TTL 체크
                if (messageWithTTL.expireAt.isAfter(Instant.now())) {
                    return@withContext messageWithTTL.message
                } else {
                    // 만료된 메시지는 삭제
                    rocksDB.delete(key)
                }
                
                iterator.next()
            }
            null
        }
    }
}
```

## 🚨 COLD Storage 구현하며 겪은 진짜 문제들

### 문제 1: 파일 포맷을 어떻게 할까?

처음엔 단순하게 JSON으로 하나씩 저장하려고 했어요.

```kotlin
// 첫 번째 시도: 메시지당 파일 하나
fun saveMessage(message: Message) {
    val file = File("${coldStoragePath}/${message.messageId}.json")
    file.writeText(objectMapper.writeValueAsString(message))
}
```

**문제점:**
- 메시지 1백만 개 = 파일 1백만 개
- 파일시스템 inode 고갈
- 디렉토리 스캔 성능 최악

### 해결: 날짜/큐별 아카이브 방식

생각해보니 세그먼트보다는 **아카이브** 개념이 더 맞는 것 같아서 날짜별/큐별로 파일을 나누어 저장하는 방식으로 했어요.

```kotlin
// 날짜/큐별 아카이브 저장
@Service
class ColdStorageService {
    
    suspend fun saveBatch(messages: List<Message>): BatchResult {
        // 1. 날짜별로 그룹화
        val messagesByDate = messages.groupBy {
            LocalDate.ofInstant(it.sentTimestamp, ZoneId.systemDefault())
        }

        messagesByDate.forEach { (date, dayMessages) ->
            val archivePath = getArchivePath(date) // data/cold/archives/2025/01/15/
            
            // 2. 큐별로 다시 그룹화  
            val messagesByQueue = dayMessages.groupBy { "${it.tenantId}:${it.queueName}" }
            
            messagesByQueue.forEach { (queueKey, queueMessages) ->
                val safeQueueKey = queueKey.replace(":", "_")
                val archiveFile = archivePath.resolve("$safeQueueKey.json.gz")
                
                // 3. 기존 파일과 병합 (중복 제거)
                val allMessages = if (Files.exists(archiveFile)) {
                    val existing = readMessagesFromFile(archiveFile).toMutableList()
                    val existingIds = existing.map { it.messageId }.toSet()
                    val newMessages = queueMessages.filter { !existingIds.contains(it.messageId) }
                    existing.addAll(newMessages)
                    existing
                } else {
                    queueMessages
                }
                
                // 4. 압축하여 저장
                val messagesJson = objectMapper.writeValueAsString(allMessages)
                writeCompressedFile(archiveFile, messagesJson)
            }
        }
    }
}
```

**이 방식의 장점:**
- 파일 수가 관리 가능한 수준 (날짜별/큐별)
- 압축으로 디스크 공간 절약 (.gz)
- 같은 큐의 메시지들이 한 파일에 모여 있어 조회 효율적

### 문제 2: 인덱싱을 어떻게 할까?

날짜/큐별 파일은 좋은데, 특정 메시지를 찾으려면...

```kotlin
// 현재 구현: 전체 아카이브 스캔
override suspend fun getMessage(messageId: String): Message? = withContext(Dispatchers.IO) {
    try {
        // 인덱스가 없어서 모든 파일을 뒤져야 함 😱
        val location = findMessageLocation(messageId) // 현재는 null 반환
        if (location != null) {
            readMessageFromFile(location)
        } else {
            // 인덱스가 없으니 브루트포스 검색...
            null
        }
    } catch (e: Exception) {
        null
    }
}

private fun findMessageLocation(messageId: String): MessageLocation? {
    // 실제 구현에서는 인덱스 파일을 사용하여 빠른 검색
    return null  // 😅 아직 구현 안됨
}
```

**현재 상황:**
- 인덱스 없이 브루트포스 검색에 의존
- 메시지 조회 성능이 파일 수에 비례해서 느려짐

### 미해결: 인덱스는 나중에...

**솔직한 고백:**
인덱싱은... 나중에 필요하면 구현하기로 😅

### 문제 3: 동시성 처리 - 메시지가 사라지는 미스터리

#### 첫 번째 문제: 파일 동시 접근

여러 스레드가 동시에 같은 아카이브 파일에 접근하면 파일이 깨져요.

```kotlin
// 파일별 락 관리
private val fileLocks = ConcurrentHashMap<String, ReentrantLock>()

suspend fun saveBatch(messages: List<Message>): BatchResult {
    messagesByQueue.forEach { (queueKey, queueMessages) ->
        val archiveFile = archivePath.resolve("$safeQueueKey.json.gz")
        
        // 파일별 락을 사용하여 동시성 보호
        val fileLock = fileLocks.computeIfAbsent(archiveFile.toString()) { ReentrantLock() }
        
        try {
            fileLock.lock()
            
            // 기존 파일과 병합 처리
            val allMessages = if (Files.exists(archiveFile)) {
                val existingMessages = readMessagesFromFile(archiveFile).toMutableList()
                val existingMessageIds = existingMessages.map { it.messageId }.toSet()
                val newUniqueMessages = queueMessages.filter { !existingMessageIds.contains(it.messageId) }
                
                if (newUniqueMessages.isNotEmpty()) {
                    existingMessages.addAll(newUniqueMessages)
                }
                existingMessages
            } else {
                queueMessages
            }
            
            // 압축하여 저장
            val messagesJson = objectMapper.writeValueAsString(allMessages)
            writeCompressedFile(archiveFile, messagesJson)
            
        } finally {
            fileLock.unlock()
        }
    }
}
```

#### 두 번째 문제: WARM → COLD 이동 시 메시지 누락

**더 심각한 문제가 있었어요.** Warm에서 Cold로 메시지를 이동시킬 때 계속 메시지가 사라지는 거예요. 처음엔 원인을 전혀 몰랐습니다.

```kotlin
// 문제가 있던 초기 구현
suspend fun moveWarmToCold(queueName: String): Boolean {
    return withContext(Dispatchers.IO) {
        try {
            // 1. Warm에서 메시지들 조회
            val warmMessages = warmStorage.getMessages(queueName, 1000)
            
            // 2. Cold에 저장
            val result = coldStorage.saveBatch(warmMessages)
            
            // 3. Warm에서 삭제 🚨 여기서 문제!
            warmMessages.forEach { message ->
                warmStorage.deleteMessage(message.messageId)
            }
            
            result.successCount > 0
        } catch (e: Exception) {
            false
        }
    }
}
```

**문제 상황:**
- 새로운 메시지가 Warm에 계속 들어오고 있음
- `getMessages()`로 가져온 시점과 `deleteMessage()`를 실행하는 시점 사이의 시간차
- 그 사이에 다른 스레드가 같은 메시지를 처리하거나, 새로운 메시지가 추가됨

#### 디버깅 과정: "왜 메시지가 사라지지?"

```kotlin
// 디버깅용 로그 추가
suspend fun moveWarmToCold(queueName: String): Boolean {
    logger.info("WARM→COLD 이동 시작: $queueName")
    
    return withContext(Dispatchers.IO) {
        try {
            val beforeCount = warmStorage.getMessageCount(queueName)
            logger.info("이동 전 WARM 메시지 수: $beforeCount")
            
            val warmMessages = warmStorage.getMessages(queueName, 1000)
            logger.info("조회된 메시지 수: ${warmMessages.size}")
            
            val result = coldStorage.saveBatch(warmMessages)
            logger.info("COLD 저장 결과: ${result.successCount}성공, ${result.failCount}실패")
            
            // 삭제 전에 다시 체크
            val beforeDeleteCount = warmStorage.getMessageCount(queueName)
            logger.info("삭제 전 WARM 메시지 수: $beforeDeleteCount")
            
            warmMessages.forEach { message ->
                val deleted = warmStorage.deleteMessage(message.messageId)
                if (!deleted) {
                    logger.warn("메시지 삭제 실패: ${message.messageId}")
                }
            }
            
            val afterCount = warmStorage.getMessageCount(queueName)
            logger.info("이동 후 WARM 메시지 수: $afterCount")
            
            // 🚨 여기서 발견: beforeCount != beforeDeleteCount + warmMessages.size
            if (beforeDeleteCount != beforeCount - warmMessages.size) {
                logger.error("메시지 수 불일치 감지! 예상: ${beforeCount - warmMessages.size}, 실제: $beforeDeleteCount")
            }
            
            result.successCount > 0
        } catch (e: Exception) {
            logger.error("WARM→COLD 이동 실패", e)
            false
        }
    }
}
```

**원인 발견:**
- 조회와 삭제 사이에 다른 프로세스가 메시지를 처리하거나 추가
- RocksDB의 Iterator 사용 중에도 동시 수정이 발생
- 트랜잭션이 없어서 원자성 보장 안 됨

#### 해결: 개별 메시지 이동으로 우회

**개별 메시지 단위로 이동**하는 방식으로 우회했어요.

```kotlin
// 현재 구현: 개별 메시지 이동
private fun moveWarmToCold(messageId: String, queue: Queue): Mono<Void> {
    return warmTierManagerService.getMessageFromWarm(messageId)
        .cast(Message::class.java)
        .flatMap { message ->
            // COLD 저장소에 저장
            mono {
                coldStorageService.saveMessage(message)
            }
            .onErrorResume { error ->
                logger.error("COLD 저장 중 예외 발생: $messageId", error)
                Mono.error(RuntimeException("Failed to save message to COLD storage: $messageId", error))
            }
            .flatMap { success ->
                if (success) {
                    // 저장 성공하면 WARM에서 삭제
                    warmTierManagerService.deleteMessageFromWarm(messageId)
                        .then(updateMessageTier(messageId, "COLD"))
                } else {
                    logger.error("COLD 저장 실패: messageId=$messageId")
                    Mono.error(RuntimeException("Failed to save message to COLD storage: $messageId"))
                }
            }
        }
}
```

**이 방식의 특징:**
- 개별 메시지 단위로 처리해서 전체 배치 실패 위험은 줄어듦
- 하지만 여전히 동시성 문제는 남아있음 (같은 메시지를 두 번 처리할 가능성)
- 배치 처리보다는 성능이 떨어짐

**흐음...:**
이거... 괜찮나?... 성능이 많이 구린 것 같은데... 나중에 생각해보자.

## 🚀 다음에 할 것

- 성능 측정
- 계층별 데이터 분포 시각화  
- COLD 단계에서 파일에 쓸 때, 좀 더 좋은 방법이 있을지 생각해보기
- Redis 에서 Index 를 관리하고 있는데, 좋은 방법일지 고민해보기
