---
title: "Redis 고급 기능: BitMap, HyperLogLog, Geo, Bloom Filter"
date: 2025-11-23
draft: false
topic: "Database"
tags: ["Redis", "BitMap", "HyperLogLog", "Geo", "Bloom Filter"]
categories: ["Backend Deep Dive"]
description: "Redis의 고급 데이터 구조로 메모리 효율적인 솔루션 구현하기"
module: "data-system"
study_order: 304
quizzes:
  - question: "Redis BitMap으로 DAU(일일 활성 사용자)를 추적할 때의 메모리 효율은?"
    options:
      - "일반 Set과 동일하다."
      - "1억 명을 12.5MB로 저장 가능 - 일반 Set 대비 약 64배 효율적"
      - "더 많은 메모리를 사용한다."
      - "1GB 이상 필요하다."
    answer: 1
    explanation: "BitMap은 user ID를 offset으로 사용해 비트 하나로 방문 여부를 표시합니다. 1억 비트 ÷ 8 = 12.5MB입니다."

  - question: "HyperLogLog가 유니크 카운트에 적합한 이유는?"
    options:
      - "정확도가 100%여서"
      - "고정 12KB 메모리로 수억 개의 유니크 요소를 0.81% 오차율로 카운트 가능"
      - "데이터를 모두 저장해서"
      - "느리기 때문"
    answer: 1
    explanation: "정확한 Set으로 1억 명을 저장하면 2GB 필요하지만, HyperLogLog는 12KB만으로 근사치를 구합니다. UV 집계에 적합합니다."

  - question: "Redis Geo 명령으로 '내 위치에서 반경 5km 이내 매장 찾기'를 구현하는 명령은?"
    options:
      - "GET"
      - "GEORADIUS 또는 GEOSEARCH로 중심 좌표와 반경을 지정하여 검색"
      - "SET"
      - "ZADD"
    answer: 1
    explanation: "GEOADD로 매장 위치를 저장하고, GEORADIUS로 반경 내 멤버를 거리순으로 조회할 수 있습니다. 위치 기반 서비스에 활용됩니다."

  - question: "Bloom Filter가 '없다'는 100% 확실하지만 '있다'는 확률적인 이유는?"
    options:
      - "메모리가 부족해서"
      - "해시 충돌로 인해 다른 요소가 같은 비트를 설정할 수 있어 False Positive 발생"
      - "구현 오류"
      - "둘 다 확실하다"
    answer: 1
    explanation: "비트가 0이면 '확실히 없음', 모든 비트가 1이면 '있을 수도 있음(다른 요소가 설정했을 수 있음)'입니다."

  - question: "Bloom Filter를 활용한 차단 사용자 확인 로직의 이점은?"
    options:
      - "항상 DB를 조회한다."
      - "대부분의 '차단 안 됨' 요청을 빠르게 걸러내어 DB 조회 횟수를 크게 줄임"
      - "Bloom Filter만으로 최종 판단"
      - "속도가 느려진다"
    answer: 1
    explanation: "Bloom Filter가 false면 DB 조회 없이 통과, true일 때만 DB 확인합니다. 대부분 차단되지 않은 사용자이므로 효율적입니다."
---

## 이 글에서 얻는 것

- **BitMap**으로 대용량 불리언 데이터를 효율적으로 저장합니다.
- **HyperLogLog**로 유니크 카운트를 메모리 효율적으로 구합니다.
- **Geo**로 위치 기반 서비스를 구현합니다.
- **Bloom Filter**로 존재 여부를 빠르게 확인합니다.

## 1) BitMap: 불리언 데이터의 효율적 저장

### 1-1) BitMap 기본

```bash
# 특정 비트 설정
SETBIT user:visited:20251216 123 1
# user ID 123이 오늘 방문함

# 비트 조회
GETBIT user:visited:20251216 123
# 1: 방문함, 0: 방문 안 함

# 비트 카운트
BITCOUNT user:visited:20251216
# 오늘 방문한 사용자 수
```

### 1-2) BitMap 시각화

BitMap은 0과 1로 이루어진 긴 배열입니다. 각 비트가 유저의 상태(방문 여부 등)를 나타냅니다.

```mermaid
graph LR
    subgraph BitMap Structure
    u1[User 1] -->|Offset 1| b1[1]
    u2[User 2] -->|Offset 2| b2[0]
    u3[User 3] -->|Offset 3| b3[1]
    u4[...]
    uN[User 999] -->|Offset 999| b999[1]
    end
    
    style b1 fill:#4caf50,stroke:#333,color:#fff
    style b2 fill:#e0e0e0,stroke:#333
    style b3 fill:#4caf50,stroke:#333,color:#fff
    style b999 fill:#4caf50,stroke:#333,color:#fff
```

### 1-3) 실전 사용: 일일 활성 사용자 (DAU)

```java
@Service
public class UserActivityService {

    @Autowired
    private StringRedisTemplate redisTemplate;

    // 사용자 방문 기록
    public void recordVisit(Long userId) {
        String key = "user:visited:" + LocalDate.now();
        redisTemplate.opsForValue().setBit(key, userId, true);
        
        // 30일 후 자동 삭제
        redisTemplate.expire(key, Duration.ofDays(30));
    }

    // DAU 조회
    public Long getDailyActiveUsers() {
        String key = "user:visited:" + LocalDate.now();
        return redisTemplate.execute((RedisCallback<Long>) connection -> {
            return connection.bitCount(key.getBytes());
        });
    }

    // 특정 사용자가 오늘 방문했는지
    public boolean hasVisitedToday(Long userId) {
        String key = "user:visited:" + LocalDate.now();
        return Boolean.TRUE.equals(redisTemplate.opsForValue().getBit(key, userId));
    }
}
```

**메모리 효율:**
```
일반 Set: 1억 명 × 8 bytes = 800MB
BitMap: 1억 비트 ÷ 8 = 12.5MB

약 64배 효율적!
```

## 2) HyperLogLog: 유니크 카운트

### 2-1) HyperLogLog 기본

```bash
# 요소 추가
PFADD unique:users:20251216 "user:1" "user:2" "user:3"

# 유니크 카운트
PFCOUNT unique:users:20251216
# 3

# 병합
PFMERGE unique:users:week unique:users:20251216 unique:users:20251217
```

### 2-2) HyperLogLog 원리 (확률적 카운팅)

HyperLogLog는 데이터를 실제로 저장하지 않고, "해시값의 패턴"을 기억합니다.

```mermaid
graph TD
    Input[Data: 'user123'] --> Hash[Hash Function]
    Hash --> Bits[Hash Result: 00101...]
    
    Bits --> BucketSelect{Leading Bits<br/>Select Bucket}
    Bits --> ZeroCount{Counting<br/>Leading Zeros}
    
    BucketSelect --> B1[Bucket 1]
    BucketSelect --> B2[Bucket 2]
    
    ZeroCount -->|Max Zeros observed| Register[Update Register in Bucket]
    
    Register --> Estimate[Calculate Cardinality]
```

### 2-3) 실전 사용: UV (Unique Visitors)

```java
@Service
public class UniqueVisitorService {

    @Autowired
    private StringRedisTemplate redisTemplate;

    // 방문자 기록
    public void recordVisitor(String visitorId) {
        String key = "uv:" + LocalDate.now();
        redisTemplate.opsForHyperLogLog().add(key, visitorId);
        redisTemplate.expire(key, Duration.ofDays(90));
    }

    // UV 조회
    public Long getUniqueVisitors() {
        String key = "uv:" + LocalDate.now();
        return redisTemplate.opsForHyperLogLog().size(key);
    }

    // 주간 UV (병합)
    public Long getWeeklyUniqueVisitors() {
        List<String> keys = new ArrayList<>();
        for (int i = 0; i < 7; i++) {
            String key = "uv:" + LocalDate.now().minusDays(i);
            keys.add(key);
        }
        
        String weekKey = "uv:week:" + LocalDate.now();
        redisTemplate.opsForHyperLogLog().union(weekKey, keys.toArray(new String[0]));
        
        return redisTemplate.opsForHyperLogLog().size(weekKey);
    }
}
```

**메모리 효율:**
```
정확한 Set: 1억 명 × 평균 20 bytes = 2GB
HyperLogLog: 12KB (고정)

오차율: 0.81%
```

## 3) Geo: 위치 기반 서비스

### 3-1) Geo 기본

```bash
# 위치 추가 (경도, 위도, 멤버)
GEOADD stores 127.0276 37.4979 "seoul-gangnam"
GEOADD stores 126.9784 37.5665 "seoul-city-hall"

# 거리 계산
GEODIST stores "seoul-gangnam" "seoul-city-hall" km
# 9.2 (km)

# 반경 내 검색
GEORADIUS stores 127.0 37.5 10 km WITHDIST WITHCOORD
```

```bash
# 반경 내 검색
GEORADIUS stores 127.0 37.5 10 km WITHDIST WITHCOORD
```

### 3-2) Geo 검색 시각화

중심점(내 위치)에서 설정한 반경 내에 있는 점(매장)들을 찾습니다.

```mermaid
graph TD
    subgraph Map
    Center((Me))
    S1(Store A<br/>2km)
    S2(Store B<br/>8km)
    S3(Store C<br/>12km)
    end
    
    Center -.->|Radius 10km| S1
    Center -.->|Radius 10km| S2
    Center -.-x|Out of range| S3
    
    style Center fill:#2196f3,stroke:#fff,color:#fff
    style S1 fill:#4caf50,stroke:#333
    style S2 fill:#4caf50,stroke:#333
    style S3 fill:#e0e0e0,stroke:#333,stroke-dasharray: 5 5
```

### 3-3) 실전 사용: 주변 매장 찾기

```java
@Service
public class StoreLocationService {

    @Autowired
    private StringRedisTemplate redisTemplate;

    // 매장 위치 등록
    public void registerStore(String storeId, double longitude, double latitude) {
        redisTemplate.opsForGeo().add("stores", 
            new Point(longitude, latitude), 
            storeId);
    }

    // 주변 매장 검색 (반경 5km 이내)
    public List<StoreDistance> findNearbyStores(double longitude, double latitude) {
        Circle circle = new Circle(new Point(longitude, latitude), 
            new Distance(5, Metrics.KILOMETERS));

        GeoResults<RedisGeoCommands.GeoLocation<String>> results = 
            redisTemplate.opsForGeo().radius("stores", circle);

        return results.getContent().stream()
            .map(result -> new StoreDistance(
                result.getContent().getName(),
                result.getDistance().getValue()
            ))
            .collect(Collectors.toList());
    }

    // 두 지점 간 거리
    public double getDistance(String store1, String store2) {
        Distance distance = redisTemplate.opsForGeo().distance(
            "stores", store1, store2, Metrics.KILOMETERS);
        
        return distance != null ? distance.getValue() : 0.0;
    }
}
```

## 4) Bloom Filter: 존재 여부 빠른 확인

## 4) Bloom Filter: 존재 여부 빠른 확인

Bloom Filter는 **"없다"는 100% 확실**하지만, **"있다"는 확률적(False Positive)**인 구조입니다.

### 4-1) 동작 원리

```mermaid
graph LR
    Input("Data: 'bad_user'") --> H1[Hash 1]
    Input --> H2[Hash 2]
    Input --> H3[Hash 3]
    
    H1 -->|Index 2| B2[Bit 2 = 1]
    H2 -->|Index 5| B5[Bit 5 = 1]
    H3 -->|Index 8| B8[Bit 8 = 1]
    
    subgraph BitArray
    B1[0] --- B2 --- B3[0] --- B4[0] --- B5 --- B6[0] --- B7[0] --- B8
    end
    
    style B2 fill:#f44336,color:#fff
    style B5 fill:#f44336,color:#fff
    style B8 fill:#f44336,color:#fff
    
    note["모든 인덱스가 1이어야 '존재 가능성 있음'<br/>하나라도 0이면 '무조건 없음'"]
```

### 4-2) Redisson Bloom Filter

```java
@Service
public class UserBlockService {

    @Autowired
    private RedissonClient redissonClient;

    private RBloomFilter<String> blockedUsers;

    @PostConstruct
    public void init() {
        blockedUsers = redissonClient.getBloomFilter("blocked:users");
        
        // 예상 요소 수: 1백만, 오차율: 1%
        blockedUsers.tryInit(1000000, 0.01);
    }

    // 사용자 차단
    public void blockUser(String userId) {
        blockedUsers.add(userId);
        // 실제 차단 목록에도 추가
        actualBlockList.add(userId);
    }

    // 차단 여부 확인 (빠른 사전 필터링)
    public boolean isBlocked(String userId) {
        // Bloom Filter로 먼저 체크 (false positive 가능)
        if (!blockedUsers.contains(userId)) {
            return false;  // 확실히 차단 안 됨
        }
        
        // Bloom Filter가 true 반환 시 실제 DB 확인
        return actualBlockList.contains(userId);
    }
}
```

**사용 시나리오:**
```
1. Bloom Filter 체크 (매우 빠름)
   - false → 100% 차단 안 됨
   - true → 차단되었을 수도 있음 (DB 확인 필요)

2. DB 확인 (Bloom Filter가 true인 경우만)

→ 대부분의 요청을 Bloom Filter에서 빠르게 걸러냄
```

## 5) 실전 조합 패턴

### 5-1) 실시간 통계 대시보드

```java
@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

    @Autowired
    private UserActivityService activityService;

    @Autowired
    private UniqueVisitorService visitorService;

    @GetMapping("/stats")
    public DashboardStats getStats() {
        return DashboardStats.builder()
            .dau(activityService.getDailyActiveUsers())
            .uv(visitorService.getUniqueVisitors())
            .weeklyUv(visitorService.getWeeklyUniqueVisitors())
            .build();
    }
}
```

### 5-2) 위치 기반 푸시 알림

```java
@Service
public class LocationPushService {

    public void sendNearbyPromotion(double userLat, double userLon) {
        // 주변 5km 이내 매장 찾기
        List<StoreDistance> nearbyStores = storeLocationService
            .findNearbyStores(userLon, userLat);

        // 가장 가까운 매장의 프로모션 전송
        if (!nearbyStores.isEmpty()) {
            String storeId = nearbyStores.get(0).getStoreId();
            Promotion promo = getPromotion(storeId);
            pushService.send(promo);
        }
    }
}
```

## 요약

- BitMap: 불리언 데이터를 메모리 효율적으로
- HyperLogLog: 유니크 카운트를 12KB로
- Geo: 위치 기반 서비스 구현
- Bloom Filter: 빠른 존재 여부 확인

## 다음 단계

- Redis 클러스터: `/learning/deep-dive/deep-dive-redis-cluster/`
- Redis Streams: `/learning/deep-dive/deep-dive-redis-streams/`
- 캐싱 전략: `/learning/deep-dive/deep-dive-caching-strategies/`
