---
title: "MySQL Index 성능 비교: B-Tree vs Hash vs Fulltext"
date: 2025-03-15
draft: false
tags: ["MySQL", "Database", "Index", "Performance", "B-Tree", "Hash", "Fulltext"]
categories: ["Database"]
description: "MySQL의 다양한 인덱스 타입(B-Tree, Hash, Fulltext)을 실제 테스트를 통해 성능 비교해보자."
---

## 들어가며

> 평소에 귀찮아서 B-Tree 인덱스만 사용했는데, 다른 인덱스 타입들도 궁금해졌다.  
> Hash Index와 Fulltext Index는 어떤 상황에서 유리할까? 직접 테스트해보자!

## 테스트 환경 설정

### 테스트 테이블 생성
다양한 인덱스 타입을 테스트하기 위한 테이블을 생성했다:

```sql
CREATE TABLE test_index (
    id INT AUTO_INCREMENT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- B-Tree 테스트용
    category VARCHAR(50), -- Hash Index 테스트용  
    description TEXT, -- Fulltext Index 테스트용

    INDEX idx_btree_created_at (created_at),
    INDEX idx_hash_category USING HASH (category),
    FULLTEXT INDEX idx_fulltext_description (description)
);
```

### 테스트 데이터 생성

10만 건의 랜덤 데이터를 생성했다:

```sql
INSERT INTO test_index (created_at, category, description)
SELECT
    NOW() - INTERVAL FLOOR(RAND() * 365) DAY,
    ELT(FLOOR(1 + (RAND() * 3)), 'A', 'B', 'C'),
    CONCAT(
        'This is a sample description ',
        FLOOR(RAND() * 1000),
        ' with random content'
    )
FROM information_schema.tables AS a
CROSS JOIN information_schema.tables AS b
LIMIT 100000;
```

## B-Tree 인덱스 테스트

### 범위 조회 성능

```sql
EXPLAIN ANALYZE
SELECT * FROM test_index
WHERE created_at BETWEEN '2024-10-01' AND '2024-11-01';

-> Index range scan on test_index using idx_btree_created_at over ('2024-10-01 00:00:00' <= created_at <= '2024-11-01 00:00:00'), with index condition: (test_index.created_at between '2024-10-01' and '2024-11-01')  (cost=3824 rows=8498) (actual time=0.19..26.6 rows=8498 loops=1)
```

```sql
EXPLAIN ANALYZE
SELECT * FROM test_index
IGNORE INDEX(idx_btree_created_at)      -- B-Tree 인덱스 제거
WHERE created_at BETWEEN '2024-10-01' AND '2024-11-01';

-> Filter: (test_index.created_at between '2024-10-01' and '2024-11-01')  (cost=10102 rows=11054) (actual time=0.0711..66.4 rows=8498 loops=1)
    -> Table scan on test_index  (cost=10102 rows=99495) (actual time=0.0548..42.1 rows=100000 loops=1)
```

##### 검색 조회 (=)

```sql
EXPLAIN ANALYZE 
SELECT * FROM test_index 
WHERE created_at='2025-01-01 06:53:52';

-> Index lookup on test_index using idx_btree_created_at (created_at=TIMESTAMP'2025-01-01 06:53:52')  (cost=101 rows=288) (actual time=0.0881..1.49 rows=288 loops=1)
```

```sql
EXPLAIN ANALYZE
SELECT * FROM test_index
IGNORE INDEX(idx_btree_created_at)      -- B-Tree 인덱스 제거
WHERE created_at='2025-01-01 06:53:52';

| -> Filter: (test_index.created_at = TIMESTAMP'2025-01-01 06:53:52')  (cost=10102 rows=270) (actual time=0.239..45.8 rows=288 loops=1)
    -> Table scan on test_index  (cost=10102 rows=99495) (actual time=0.03..39.5 rows=100000 loops=1)
```

##### 결과

| 항목        | B-Tree | 인덱스 X | 차이점 |
|------------|---------------|---------------|-------|
| **범위 조회** | 26.6ms | 66.4ms | 2.5배 차이 |
| **검색 조회** | 1.49ms | 45.8ms | 30배 차이 |

* 확실히 빠르긴하다..
* 범위 조회 효율이 더 잘나올 줄 알았는데, 검색 효율도 나쁘지않다
* 아닌가? 데이터가 늘면 늘수록 인덱스 없는 범위 조회 시간은 많이 걸릴라나?

## 2. Hash Index 테스트

##### 범위 조회 (BETWEEN)

```sql
EXPLAIN ANALYZE  
SELECT * FROM test_index 
WHERE category BETWEEN 'A' AND 'B';

-> Filter: (test_index.category between 'A' and 'B')  (cost=10102 rows=49747) (actual time=0.0455..53.5 rows=66775 loops=1)
    -> Table scan on test_index  (cost=10102 rows=99495) (actual time=0.0401..41 rows=100000 loops=1)
```

```sql
EXPLAIN ANALYZE  
SELECT * FROM test_index 
IGNORE INDEX(idx_hash_category)     -- Hash 인덱스 제거
WHERE category BETWEEN 'A' AND 'B';

| -> Filter: (test_index.category between 'A' and 'B')  (cost=10102 rows=11054) (actual time=0.0491..53.9 rows=66775 loops=1)
    -> Table scan on test_index  (cost=10102 rows=99495) (actual time=0.045..41.2 rows=100000 loops=1)
```

##### 검색 조회 (=)

```sql
EXPLAIN ANALYZE  
SELECT * FROM test_index 
WHERE category='B';

-> Index lookup on test_index using idx_hash_category (category='B')  (cost=5431 rows=49747) (actual time=0.0495..47.8 rows=33477 loops=1)
```

```sql
EXPLAIN ANALYZE  
SELECT * FROM test_index
IGNORE INDEX(idx_hash_category)     -- Hash 인덱스 제거 
WHERE category='B';

-> Filter: (test_index.category = 'B')  (cost=10102 rows=49748) (actual time=0.0344..25.7 rows=33477 loops=1)
    -> Table scan on test_index  (cost=10102 rows=99495) (actual time=0.0323..21.2 rows=100000 loops=1)
```

##### 결과

| 항목        | Hash 인덱스 | 인덱스 X | 차이점 |
|------------|---------------|---------------|-------|
| **범위 조회** | 53.5ms | 53.9ms | X |
| **검색 조회** | 47.8ms | 25.7ms | 2배 차이 |

* ????? 검색 했는데 왜 Hash 인덱스가 더 느리지?..
* 범위 조회가 안되는 대신 검색 조회 효율을 높이기 위해 사용하는 것 아니었나??
* 흐음..... 데이터가 A, B, C 뿐이라 해시 효율이 안나오나? 데이터를 바꿔보자

### 2-1 Hash Index 테스트: 데이터 변경

```sql
CREATE TABLE hash_test (
    id INT AUTO_INCREMENT PRIMARY KEY,
    uuid VARCHAR(36),

    INDEX idx_hash_uuid USING HASH (uuid)
);
```

```sql
INSERT INTO hash_test (uuid)
SELECT 
    UUID()
FROM information_schema.tables AS a
CROSS JOIN information_schema.tables AS b
LIMIT 100000;
```

##### 검색 조회 (=)

```sql
EXPLAIN ANALYZE  
SELECT * 
FROM hash_test  
WHERE uuid='eaeaf92b-fb22-11ef-9745-0242ac110002';

-> Covering index lookup on hash_test using idx_hash_uuid (uuid='eaeaf92b-fb22-11ef-9745-0242ac110002')  (cost=0.35 rows=1) (actual time=0.0349..0.0403 rows=1 loops=1)
```

```sql
EXPLAIN ANALYZE  
SELECT * 
FROM hash_test 
IGNORE INDEX(idx_hash_uuid)       -- Hash 인덱스 제거 
WHERE uuid='eaeaf92b-fb22-11ef-9745-0242ac110002';

-> Filter: (hash_test.uuid = 'eaeaf92b-fb22-11ef-9745-0242ac110002')  (cost=10079 rows=1) (actual time=16..34.3 rows=1 loops=1)
    -> Table scan on hash_test  (cost=10079 rows=99750) (actual time=0.303..23.4 rows=100000 loops=1)
```

##### 결과

| 항목        | Hash 인덱스 | 인덱스 X | 차이점 |
|------------|---------------|---------------|-------|
| **검색 조회** | 0.0403ms | 34.3ms | 800배 차이 |

* 이게 옳게된 결과지
* 흐음.. 데이터에 따라 인덱스를 고르는 것도 신중히 해야할 듯
* 같은 값이 많으면 Hash 인덱스의 성능이 떨어진다!

## 3. Fulltext Index 테스트

##### 검색 조회 (MATCH)

```sql
EXPLAIN ANALYZE
SELECT * FROM test_index
WHERE MATCH(description) AGAINST('random');

-> Filter: (match test_index.`description` against ('random'))  (cost=0.35 rows=1) (actual time=15.7..89.4 rows=100000 loops=1)
    -> Full-text index search on test_index using idx_fulltext_description (description='random')  (cost=0.35 rows=1) (actual time=15.7..85.6 rows=100000 loops=1)
```

```sql
EXPLAIN ANALYZE  
SELECT * FROM test_index 
IGNORE INDEX(idx_fulltext_description)      -- Fulltext 인덱스 제거
WHERE MATCH(description) AGAINST('random');

-> Filter: (match test_index.`description` against ('random'))  (cost=10102 rows=11054) (actual time=0.571..27.3 rows=100000 loops=1)
    -> Table scan on test_index  (cost=10102 rows=99495) (actual time=0.568..19.5 rows=100000 loops=1)
```

##### 검색 조회 (LIKE)

```sql
EXPLAIN ANALYZE  
SELECT * FROM test_index  
WHERE description LIKE '%random%';

-> Filter: (test_index.`description` like '%random%')  (cost=10102 rows=11054) (actual time=0.0473..62.9 rows=100000 loops=1)
    -> Table scan on test_index  (cost=10102 rows=99495) (actual time=0.0422..32.8 rows=100000 loops=1)
```

```sql
EXPLAIN ANALYZE  
SELECT * FROM test_index 
IGNORE INDEX(idx_fulltext_description)       -- Fulltext 인덱스 제거
WHERE description LIKE '%random%';

-> Filter: (test_index.`description` like '%random%')  (cost=10102 rows=11054) (actual time=0.052..70.5 rows=100000 loops=1)
    -> Table scan on test_index  (cost=10102 rows=99495) (actual time=0.0452..36.9 rows=100000 loops=1)
```

##### 결과

| 항목        | Fulltext 인덱스 | 인덱스 X | 차이점 |
|------------|---------------|---------------|-------|
| **검색 조회 (MATCH)** | 89.4ms | 27.3ms | 3배 차이 |
| **검색 조회 (LIKE)** | 62.9ms | 70.5ms | X |

* 일단 LIKE 검색은 Fulltext 인덱스가 안먹는구나 확인
* MATCH 검색은 왜 또 인덱스 뺀게 더 빠를까....
* 으음... 또 데이터 문제일까? random 이라는 문구가 모든 row 에 존재해서 사실상 테이블 스캔이랑 동일하게 전체 검사를 하게 된건가?..

### 3-1. Fulltext Index 테스트: 데이터 변경

```sql
CREATE TABLE fulltext_test ( 
    id INT AUTO_INCREMENT PRIMARY KEY, 
    description TEXT, 
    
    FULLTEXT INDEX idx_fulltext_description (description)
);
```

```sql
INSERT INTO fulltext_test (description)
SELECT CONCAT(
        ELT(FLOOR(1 + (RAND() * 5)),
            'AI',
            'Blockchain',
            'Quantum Computing',
            'Cybersecurity',
            'Cloud Computing'
        ),
        ' is transforming the world of ',
        ELT(FLOOR(1 + (RAND() * 5)),
            'finance',
            'healthcare',
            'automotive',
            'retail',
            'education'
        ),
        '. Experts predict it will impact over ',
        FLOOR(10 + (RAND() * 90)),
        ' million users by ',
        FLOOR(2025 + (RAND() * 10)),
        '.'
        )
FROM information_schema.tables AS a
CROSS JOIN information_schema.tables AS b
LIMIT 1000000;
```
##### 검색 조회 (MATCH)
```sql
EXPLAIN ANALYZE
SELECT * FROM fulltext_test 
WHERE MATCH(description) AGAINST('Blockchain');

 -> Filter: (match fulltext_test.`description` against ('Blockchain'))  (cost=0.35 rows=1) (actual time=5.64..35.9 rows=22668 loops=1)
    -> Full-text index search on fulltext_test using idx_fulltext_description (description='Blockchain')  (cost=0.35 rows=1) (actual time=5.63..34.3 rows=22668 loops=1)
```

```sql
EXPLAIN ANALYZE   
SELECT * 
FROM fulltext_test 
IGNORE INDEX(idx_fulltext_description) 
WHERE MATCH(description) AGAINST('Blockchain');

 -> Filter: (match fulltext_test.`description` against ('Blockchain'))  (cost=11596 rows=12572) (actual time=0.046..48.7 rows=22668 loops=1)
    -> Table scan on fulltext_test  (cost=11596 rows=113155) (actual time=0.0288..36.6 rows=114244 loops=1)
```

##### 결과

| 항목        | Fulltext 인덱스 | 인덱스 X | 차이점 |
|------------|---------------|---------------|-------|
| **검색 조회 (MATCH)** | 35.9ms | 48.7ms | 1.35배 차이 |

* 성능 향상이 있긴 하지만, 위에 B-Tree 나 Hash 만큼 드라마틱 하지는 않은 것 같다.
* 문장이 더 다양하고, 긴 문장이면 효과가 더 나올라나?

## 4. B-Tree VS Hash Index

* 생각보다 B-Tree 도 검색효율이 나오는 것 같아서 둘을 비교해보자

##### 범위 조회 (BETWEEN)

```sql
EXPLAIN ANALYZE 
SELECT * 
FROM btree_hash_test 
WHERE btree_column BETWEEN 100000 AND 200000;

-> Index range scan on btree_hash_test using idx_btree over (100000 <= btree_column <= 200000), with index condition: (btree_hash_test.btree_column between 100000 and 200000)  (cost=4535 rows=10078) (actual time=1.62..11.9 rows=10078 loops=1)
```

```sql
EXPLAIN ANALYZE 
SELECT * 
FROM btree_hash_test 
WHERE hash_column BETWEEN 100000 AND 200000;

-> Index range scan on btree_hash_test using idx_hash over (100000 <= hash_column <= 200000), with index condition: (btree_hash_test.hash_column between 100000 and 200000)  (cost=4475 rows=9943) (actual time=3.58..21.8 rows=9943 loops=1)
```

##### 검색 조회 (=)

```sql
EXPLAIN ANALYZE 
SELECT * 
FROM btree_hash_test 
WHERE btree_column=146708;

-> Index lookup on btree_hash_test using idx_btree (btree_column=146708)  (cost=0.35 rows=1) (actual time=0.0424..0.0454 rows=1 loops=1)
```

```sql
EXPLAIN ANALYZE 
SELECT * 
FROM btree_hash_test 
WHERE hash_column=921585;

-> Index lookup on btree_hash_test using idx_hash (hash_column=921585)  (cost=0.35 rows=1) (actual time=0.0199..0.0213 rows=1 loops=1)
```

##### 결과

| 항목        | B-Tree | Hash 인덱스 | 차이점 |
|------------|---------------|---------------|-------|
| **범위 조회 (BETWEEN)** | 11.9ms | 21.8ms | 2배 차이 |
| **검색 조회 (=)** | 0.0454ms | 0.0213ms | 2배 차이 |

* 범위랑 검색 모두 2배 차이씩 나는 것 같다.
* 대충 범위 조회를 많이쓰면 B-Tree를 검색 조회를 많이 쓰면 Hash Index 를 사용하면 될 것 같다.


## 결과

```
그냥 대충 B-Tree 써도 손해는 없어보인다.
다만, 속도차이를 보니 속도를 타이트하게 잡아야한다면, 다른 Index 를 고려해볼 필요는 있을 것 같다.
```

## 나중에 더 해볼 것

1. INSERT, UPDATE 시 속도 저하가 어느 정도인지 테스트 해보고싶다.
2. 생각보다 Fulltext Index 테스트가 안좋았던 것 같다. 테스트 방식을 바꿔야 할 것 같다 => 크롤링으로 많은 데이터를 가져와서 Fulltext Index 걸어봐야 확실히 성능이 좋아지는지 알 수 있을 것 같다.