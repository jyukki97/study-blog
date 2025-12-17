---
title: "데이터베이스 마이그레이션: Flyway로 스키마 버전 관리하기"
date: 2025-12-16
draft: false
topic: "Database"
tags: ["Database Migration", "Flyway", "Schema", "Version Control", "Spring Boot"]
categories: ["Backend Deep Dive"]
description: "Flyway를 이용한 데이터베이스 스키마 버전 관리와 안전한 마이그레이션 전략"
module: "data-system"
study_order: 250
---

## 이 글에서 얻는 것

- **DB 마이그레이션**이 왜 필요한지, 어떤 문제를 해결하는지 이해합니다.
- **Flyway**로 데이터베이스 스키마를 버전 관리할 수 있습니다.
- **마이그레이션 파일**을 작성하고, 안전하게 적용할 수 있습니다.
- **롤백 전략**과 장애 대응 방법을 익힙니다.

## 0) DB 마이그레이션은 "스키마의 Git"이다

### 왜 필요한가?

**문제 상황:**
```
개발자 A: "로컬에서는 되는데..."
개발자 B: "내 DB에는 그 컬럼이 없는데요?"
운영 서버: "배포했더니 테이블이 없다고 에러가..."

원인:
- 수동 SQL 실행 → 누가, 언제 실행했는지 모름
- 환경마다 스키마가 다름
- 버전 관리 안 됨
```

**해결: DB 마이그레이션 도구**
```
마이그레이션 도구:
- 스키마 변경을 코드로 관리
- Git으로 버전 관리
- 자동 적용 (환경 간 일관성)
- 실행 이력 추적
```

## 1) Flyway vs Liquibase

### 1-1) 비교

```
Flyway:
- 간단한 설정
- SQL 기반 (익숙함)
- 빠른 학습 곡선
- 커뮤니티 에디션 (무료)

Liquibase:
- XML/YAML/JSON 지원
- DB 독립적 (여러 DB 지원)
- 더 많은 기능
- 복잡한 설정

추천: Flyway (시작하기 쉬움)
```

### 1-2) Flyway 동작 원리

```
1. flyway_schema_history 테이블 생성 (최초 실행 시)
   - version, description, checksum, installed_on 등 저장

2. 마이그레이션 파일 탐색
   - src/main/resources/db/migration/

3. 미실행 파일 찾기
   - checksum으로 변경 감지

4. 순서대로 실행
   - V1, V2, V3...

5. 이력 기록
   - flyway_schema_history에 저장
```

## 2) Flyway 설정

### 2-1) Spring Boot 설정

**의존성:**
```gradle
// build.gradle
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-data-jpa'
    implementation 'org.flywaydb:flyway-core'
    runtimeOnly 'com.mysql:mysql-connector-j'
}
```

**application.yml:**
```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/mydb
    username: user
    password: password

  flyway:
    enabled: true                           # Flyway 활성화 (기본: true)
    baseline-on-migrate: true               # 기존 DB에 Flyway 적용 시
    locations: classpath:db/migration       # 마이그레이션 파일 위치
    sql-migration-prefix: V                 # 버전 파일 접두사
    sql-migration-separator: __             # 구분자
    sql-migration-suffixes: .sql            # 파일 확장자
    validate-on-migrate: true               # 실행 전 검증
```

### 2-2) 디렉토리 구조

```
src/main/resources/
└── db/
    └── migration/
        ├── V1__create_users_table.sql
        ├── V2__add_email_to_users.sql
        ├── V3__create_orders_table.sql
        └── V4__add_index_on_user_email.sql
```

**파일명 규칙:**
```
V{버전}__{설명}.sql

V: Version (필수)
{버전}: 1, 2, 3 또는 1.0, 1.1, 2.0 (순서대로 실행)
__: 구분자 (언더스코어 2개)
{설명}: 영문/숫자/언더스코어 (공백 불가)
.sql: 확장자

예:
V1__create_users_table.sql
V2__add_email_to_users.sql
V2.1__add_index_on_email.sql
```

## 3) 마이그레이션 파일 작성

### 3-1) 테이블 생성

**V1__create_users_table.sql:**
```sql
CREATE TABLE users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_username ON users(username);
```

### 3-2) 컬럼 추가

**V2__add_email_to_users.sql:**
```sql
ALTER TABLE users
ADD COLUMN email VARCHAR(255);

ALTER TABLE users
ADD CONSTRAINT uk_email UNIQUE (email);
```

### 3-3) 테이블 추가

**V3__create_orders_table.sql:**
```sql
CREATE TABLE orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_user_id ON orders(user_id);
CREATE INDEX idx_created_at ON orders(created_at);
```

### 3-4) 데이터 마이그레이션

**V4__migrate_user_data.sql:**
```sql
-- 기존 데이터 업데이트
UPDATE users
SET email = CONCAT(username, '@example.com')
WHERE email IS NULL;

-- 기본값 설정 후 NOT NULL 제약 추가
ALTER TABLE users
MODIFY COLUMN email VARCHAR(255) NOT NULL;
```

### 3-5) 복잡한 마이그레이션

**V5__refactor_user_status.sql:**
```sql
-- 1. 새 컬럼 추가
ALTER TABLE users
ADD COLUMN status VARCHAR(20);

-- 2. 기존 데이터 마이그레이션
UPDATE users
SET status = CASE
    WHEN deleted_at IS NOT NULL THEN 'DELETED'
    WHEN email_verified = 1 THEN 'ACTIVE'
    ELSE 'PENDING'
END;

-- 3. NOT NULL 제약 추가
ALTER TABLE users
MODIFY COLUMN status VARCHAR(20) NOT NULL;

-- 4. 기존 컬럼 제거 (선택적)
-- ALTER TABLE users
-- DROP COLUMN deleted_at,
-- DROP COLUMN email_verified;
```

## 4) 실행과 확인

### 4-1) 자동 실행

```bash
# Spring Boot 애플리케이션 시작 시 자동 실행
./gradlew bootRun

# 로그:
# Flyway: Migrating schema `mydb` to version "1 - create users table"
# Flyway: Migrating schema `mydb` to version "2 - add email to users"
# Flyway: Successfully applied 2 migrations
```

### 4-2) 마이그레이션 이력 확인

```sql
-- flyway_schema_history 테이블 조회
SELECT
    installed_rank,
    version,
    description,
    type,
    script,
    checksum,
    installed_on,
    execution_time,
    success
FROM flyway_schema_history
ORDER BY installed_rank;

-- 결과:
-- rank | version | description           | script                      | installed_on        | success
-- 1    | 1       | create users table    | V1__create_users_table.sql  | 2025-12-16 10:00:00 | 1
-- 2    | 2       | add email to users    | V2__add_email_to_users.sql  | 2025-12-16 10:00:01 | 1
```

## 5) 롤백 전략

### 5-1) Flyway는 자동 롤백 미지원

```
Flyway Community Edition:
- 롤백 기능 없음
- Pro 버전에서만 지원

해결 방법:
1. 새 마이그레이션으로 롤백 (권장)
2. 수동 롤백 (긴급 상황)
```

### 5-2) 새 마이그레이션으로 롤백

**V2__add_email_to_users.sql (원본):**
```sql
ALTER TABLE users
ADD COLUMN email VARCHAR(255);
```

**V3__remove_email_from_users.sql (롤백):**
```sql
ALTER TABLE users
DROP COLUMN email;
```

### 5-3) 수동 롤백 (긴급)

```sql
-- 1. 문제가 된 마이그레이션 확인
SELECT * FROM flyway_schema_history
WHERE success = 0;

-- 2. 수동으로 롤백 SQL 실행
ALTER TABLE users
DROP COLUMN email;

-- 3. flyway_schema_history에서 해당 레코드 삭제 (주의!)
DELETE FROM flyway_schema_history
WHERE version = '2';

-- 4. 마이그레이션 파일 수정 후 재실행
```

## 6) 실무 패턴

### 6-1) 환경별 설정

**개발 환경:**
```yaml
# application-dev.yml
spring:
  flyway:
    clean-disabled: false  # clean 허용 (전체 삭제)
    baseline-on-migrate: true
```

**운영 환경:**
```yaml
# application-prod.yml
spring:
  flyway:
    clean-disabled: true   # clean 금지 (안전)
    validate-on-migrate: true
    out-of-order: false    # 순서 엄격히 적용
```

### 6-2) 버전 번호 전략

**방법 1: 연속 번호**
```
V1__create_users.sql
V2__create_orders.sql
V3__add_email.sql
```

**방법 2: 날짜 기반 (권장)**
```
V20251216_1000__create_users.sql
V20251216_1030__create_orders.sql
V20251217_0900__add_email.sql

장점:
- 여러 개발자가 동시 작업 시 충돌 감소
- 시간 순서 명확
```

**방법 3: 시맨틱 버저닝**
```
V1.0__initial_schema.sql
V1.1__add_users_email.sql
V2.0__refactor_orders.sql

장점:
- 메이저/마이너 구분
- 하위 호환성 표시
```

### 6-3) 테스트 데이터

```
src/main/resources/db/migration/
├── V1__create_schema.sql
├── V2__add_columns.sql
└── ...

src/test/resources/db/migration/
├── V1__create_schema.sql (동일)
├── V2__add_columns.sql (동일)
└── V999__test_data.sql (테스트 데이터)
```

**V999__test_data.sql:**
```sql
-- 테스트 데이터 (테스트 환경에서만)
INSERT INTO users (username, email) VALUES
('alice', 'alice@test.com'),
('bob', 'bob@test.com');

INSERT INTO orders (user_id, amount, status) VALUES
(1, 100.00, 'COMPLETED'),
(2, 200.00, 'PENDING');
```

## 7) 베스트 프랙티스

### ✅ 1. 작은 단위로 마이그레이션

```
❌ 나쁜 예: 하나의 파일에 모든 변경
V1__massive_changes.sql
- 10개 테이블 생성
- 100개 컬럼 추가
- 데이터 마이그레이션

✅ 좋은 예: 논리적 단위로 분리
V1__create_users_table.sql
V2__create_orders_table.sql
V3__add_email_to_users.sql
```

### ✅ 2. 실행 전 백업

```bash
# 운영 DB 마이그레이션 전 백업
mysqldump -u user -p mydb > backup_before_migration.sql

# 마이그레이션 실행
./gradlew bootRun

# 문제 발생 시 복구
mysql -u user -p mydb < backup_before_migration.sql
```

### ✅ 3. 멱등성 (Idempotent) 고려

```sql
-- ❌ 나쁜 예 (재실행 시 에러)
CREATE TABLE users (...);

-- ✅ 좋은 예 (재실행 가능)
CREATE TABLE IF NOT EXISTS users (...);

-- 컬럼 추가 (안전)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- 인덱스 추가 (안전)
CREATE INDEX IF NOT EXISTS idx_email ON users(email);
```

### ✅ 4. 트랜잭션 고려

```sql
-- DDL은 자동 커밋됨 (MySQL)
-- 여러 DDL을 하나의 트랜잭션으로 묶을 수 없음

-- ✅ 하나의 파일에 관련 작업만
V2__add_email.sql:
ALTER TABLE users ADD COLUMN email VARCHAR(255);
CREATE INDEX idx_email ON users(email);
```

### ✅ 5. 변경 사항 문서화

```sql
-- V5__add_user_status.sql

/**
 * [JIRA-123] 사용자 상태 관리 기능 추가
 *
 * 변경 내용:
 * - users 테이블에 status 컬럼 추가
 * - 기존 deleted_at, email_verified 컬럼을 status로 통합
 *
 * 작성자: Alice
 * 작성일: 2025-12-16
 */

ALTER TABLE users
ADD COLUMN status VARCHAR(20);

-- 기존 데이터 마이그레이션
UPDATE users ...
```

## 8) 장애 대응

### 8-1) 마이그레이션 실패 시

```
문제:
- V5 마이그레이션 중 에러 발생
- flyway_schema_history에 실패 기록
- 다음 실행 시 V5를 건너뜀

해결:
1. 문제 파악
SELECT * FROM flyway_schema_history WHERE success = 0;

2. 수동 롤백 (DB 상태 복구)

3. flyway_schema_history에서 실패 레코드 삭제
DELETE FROM flyway_schema_history WHERE version = '5';

4. 마이그레이션 파일 수정

5. 재실행
```

### 8-2) Checksum 불일치

```
문제:
- 이미 실행된 마이그레이션 파일 수정
- Checksum 불일치 에러

해결 (주의!):
1. 파일을 원래대로 되돌리기 (권장)

2. 또는 Flyway repair (검증 후 사용)
flyway repair

3. 또는 새 마이그레이션 생성 (가장 안전)
V6__fix_previous_migration.sql
```

## 9) 자주 하는 실수

### ❌ 실수 1: 실행된 파일 수정

```
❌ 나쁜 예:
V1__create_users.sql 실행 후 내용 수정
→ Checksum 불일치 에러

✅ 좋은 예:
새 마이그레이션 파일 생성
V2__add_missing_column.sql
```

### ❌ 실수 2: 버전 번호 중복

```
❌ 나쁜 예:
개발자 A: V3__add_email.sql
개발자 B: V3__add_phone.sql
→ 충돌!

✅ 좋은 예:
날짜 기반 버전 사용
V20251216_1000__add_email.sql
V20251216_1030__add_phone.sql
```

### ❌ 실수 3: 롤백 계획 없음

```
❌ 나쁜 예:
마이그레이션만 작성, 롤백 고려 안 함

✅ 좋은 예:
마이그레이션 작성 시 롤백 방법 문서화
또는 새 마이그레이션으로 롤백 준비
```

## 연습 (추천)

1. **Flyway 설정**
   - Spring Boot 프로젝트에 Flyway 추가
   - 테이블 생성 마이그레이션 작성

2. **버전 관리**
   - 여러 마이그레이션 파일 작성
   - 실행 이력 확인

3. **롤백 연습**
   - 컬럼 추가 후 제거
   - 새 마이그레이션으로 롤백

## 요약: 스스로 점검할 것

- DB 마이그레이션의 필요성을 설명할 수 있다
- Flyway로 스키마 버전을 관리할 수 있다
- 마이그레이션 파일 명명 규칙을 이해한다
- 안전한 마이그레이션 전략을 수립할 수 있다
- 롤백 방법을 알고 있다

## 다음 단계

- 데이터베이스 샤딩: `/learning/deep-dive/deep-dive-database-sharding/`
- 읽기 전용 복제본: `/learning/deep-dive/deep-dive-database-replication/`
- 무중단 배포: `/learning/deep-dive/deep-dive-zero-downtime-deployment/`
