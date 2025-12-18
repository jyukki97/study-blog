---
title: "MySQL 대용량 처리: 파티셔닝과 샤딩 전략"
date: 2025-12-16
draft: false
topic: "Database"
tags: ["MySQL", "Partitioning", "Sharding", "Scalability", "Database"]
categories: ["Backend Deep Dive"]
description: "MySQL 파티셔닝과 샤딩으로 대용량 데이터를 효율적으로 처리하는 방법"
module: "data-system"
study_order: 218
---

## 이 글에서 얻는 것

- **파티셔닝**으로 단일 테이블의 대용량 데이터를 분할합니다.
- **샤딩**으로 여러 데이터베이스에 데이터를 분산합니다.
- **적절한 분할 전략**을 선택할 수 있습니다.
- **대용량 데이터**의 성능을 최적화할 수 있습니다.

## 1) 파티셔닝 (Partitioning)

### 1-1) 파티셔닝이란?

```
하나의 큰 테이블을 여러 파티션으로 분할

테이블: orders (1억 건)
↓ 파티셔닝
파티션 1: 2023년 주문 (1000만 건)
파티션 2: 2024년 주문 (3000만 건)
파티션 3: 2025년 주문 (6000만 건)

장점:
- 쿼리 성능 향상 (필요한 파티션만 스캔)
- 관리 용이 (오래된 파티션 삭제)
```

### 1-2) Range 파티셔닝

```sql
CREATE TABLE orders (
    id BIGINT AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    amount DECIMAL(10, 2),
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (YEAR(created_at)) (
    PARTITION p2023 VALUES LESS THAN (2024),
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);

-- 쿼리 시 자동으로 적절한 파티션만 스캔
SELECT * FROM orders
WHERE created_at >= '2025-01-01' AND created_at < '2025-12-31';
-- p2025 파티션만 스캔!

-- 파티션 추가
ALTER TABLE orders ADD PARTITION (
    PARTITION p2026 VALUES LESS THAN (2027)
);

-- 오래된 파티션 삭제
ALTER TABLE orders DROP PARTITION p2023;
```

### 1-3) Hash 파티셔닝

```sql
CREATE TABLE users (
    id BIGINT AUTO_INCREMENT,
    name VARCHAR(100),
    email VARCHAR(255),
    created_at DATETIME,
    PRIMARY KEY (id)
) PARTITION BY HASH(id) PARTITIONS 10;

-- ID를 해시해서 0~9 파티션에 균등 분배
```

### 1-4) List 파티셔닝

```sql
CREATE TABLE orders (
    id BIGINT,
    country VARCHAR(2),
    amount DECIMAL(10, 2),
    PRIMARY KEY (id, country)
) PARTITION BY LIST COLUMNS(country) (
    PARTITION p_asia VALUES IN ('KR', 'JP', 'CN'),
    PARTITION p_europe VALUES IN ('UK', 'DE', 'FR'),
    PARTITION p_america VALUES IN ('US', 'CA', 'BR')
);
```

## 2) 샤딩 (Sharding)

### 2-1) 샤딩이란?

```
여러 데이터베이스 서버에 데이터 분산

DB 1: user_id 1~1000만
DB 2: user_id 1000만~2000만
DB 3: user_id 2000만~3000만

장점:
- 수평 확장 (서버 추가로 용량 증가)
- 부하 분산
- 장애 격리
```

### 2-2) Hash 기반 샤딩

```java
@Service
public class ShardingService {

    private List<DataSource> shards;

    public DataSource getShard(Long userId) {
        int shardIndex = (int) (userId % shards.size());
        return shards.get(shardIndex);
    }

    public User findUser(Long userId) {
        DataSource shard = getShard(userId);
        // shard에서 조회
        return jdbcTemplate.queryForObject(
            "SELECT * FROM users WHERE id = ?",
            new Object[]{userId},
            new UserRowMapper()
        );
    }
}
```

### 2-3) Range 기반 샤딩

```java
@Service
public class RangeShardingService {

    public DataSource getShard(Long userId) {
        if (userId < 10_000_000) {
            return shard1;
        } else if (userId < 20_000_000) {
            return shard2;
        } else {
            return shard3;
        }
    }
}
```

### 2-4) ShardingSphere 사용

```yaml
# application.yml
spring:
  shardingsphere:
    datasource:
      names: ds0,ds1,ds2
      ds0:
        type: com.zaxxer.hikari.HikariDataSource
        driver-class-name: com.mysql.cj.jdbc.Driver
        jdbc-url: jdbc:mysql://db1:3306/shard0
      ds1:
        jdbc-url: jdbc:mysql://db2:3306/shard1
      ds2:
        jdbc-url: jdbc:mysql://db3:3306/shard2
    rules:
      sharding:
        tables:
          users:
            actual-data-nodes: ds$->{0..2}.users
            database-strategy:
              standard:
                sharding-column: user_id
                sharding-algorithm-name: user-hash
        sharding-algorithms:
          user-hash:
            type: HASH_MOD
            props:
              sharding-count: 3
```

## 3) 주의사항

### ⚠️ 샤딩의 문제점

```
1. JOIN 어려움:
   - 다른 샤드에 있는 테이블 JOIN 불가
   - 애플리케이션 레벨에서 처리 필요

2. 트랜잭션:
   - 여러 샤드에 걸친 트랜잭션 어려움
   - 분산 트랜잭션 또는 보상 트랜잭션 필요

3. 리샤딩 (Re-sharding):
   - 샤드 개수 변경 시 데이터 재분배 필요
   - 다운타임 발생 가능
```

## 요약

- 파티셔닝: 단일 DB 내 테이블 분할
- 샤딩: 여러 DB에 데이터 분산
- 파티셔닝이 샤딩보다 구현 간단
- 대용량 데이터 처리에 필수

## 다음 단계

- DB 레플리케이션: `/learning/deep-dive/deep-dive-db-replication/`
- 읽기 전용 복제본: `/learning/deep-dive/deep-dive-read-replicas/`
