---
title: "Go로 PostgreSQL 프록시 만들기 (8) - 보안 취약점 심화 수정"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Security", "QA"]
categories: ["Database"]
description: "프로토콜 레벨 DoS 공격, SQL 문자열 리터럴을 이용한 힌트 인젝션과 키워드 오탐을 수정한다."
---

## 들어가며

> "정상적인 클라이언트만 온다고 가정하면, 그건 보안이 아니라 희망사항이다."

7편에서 기능적 버그를 수정했지만, QA 심화 리뷰에서 **보안 관점**의 취약점 3건이 추가로 발견됐다. 이번에는 악의적인 입력을 전제로 한 공격 시나리오다.

1. [CRITICAL] Memory Bomb DoS — 프로토콜 length 스푸핑으로 OOM
2. [MAJOR] 힌트 인젝션 — 문자열 리터럴 내 `/* route:writer */`
3. [MAJOR] 키워드 오탐 — 문자열 리터럴 내 SQL 키워드

## 🔥 CRITICAL: Memory Bomb DoS

### 문제

PG wire protocol의 모든 메시지는 `[type:1byte][length:4bytes][payload]` 구조다. `ReadMessage()`는 length를 읽고 그만큼 `make([]byte, length-4)`로 버퍼를 할당한다:

```go
// Before: length에 상한 제한 없음
payload := make([]byte, length-4)
```

공격자가 length에 `1073741824` (1GB)를 보내면?

```
→ make([]byte, 1GB)
→ OS가 1GB 메모리 할당
→ OOM 패닉 → 프록시 크래시
```

**인증 전에도 악용 가능**하다. TCP 연결만 맺으면 첫 메시지에서 바로 공격할 수 있다.

### 수정

`MaxMessageSize` 상수(16MB)를 추가하고, `make()` 전에 검사:

```go
const MaxMessageSize = 16 * 1024 * 1024 // 16MB

func ReadMessage(r io.Reader) (*Message, error) {
    // ... type, length 읽기 ...

    payloadLen := int(length - 4)
    if payloadLen > MaxMessageSize {
        return nil, fmt.Errorf("message too large: %d bytes (max %d)",
            payloadLen, MaxMessageSize)
    }

    payload := make([]byte, payloadLen)
    // ...
}
```

16MB는 PostgreSQL의 기본 `max_allowed_packet`과 유사한 수준이다. 정상적인 쿼리가 16MB를 넘는 경우는 거의 없고, 넘더라도 프록시가 아닌 직접 연결을 사용하면 된다.

### 왜 ReadStartupMessage은 이미 안전한가?

```go
func ReadStartupMessage(r io.Reader) (*Message, error) {
    // ...
    if length < 4 || length > 10000 {  // ← 이미 10KB 제한
        return nil, fmt.Errorf("invalid startup message length: %d", length)
    }
```

startup 메시지는 처음 만들 때부터 10KB 상한이 있었다. 하지만 이후의 일반 메시지(`ReadMessage`)에는 적용하지 않았던 것이 빈틈이었다.

## 🚨 MAJOR: 힌트 인젝션

### 문제

프록시는 `/* route:writer */` 힌트 주석으로 강제 라우팅을 지원한다. 문제는 `extractHint()`가 **SQL 문자열 리터럴 내부의 힌트도 감지**한다는 것:

```sql
SELECT * FROM users WHERE note = '/* route:writer */ trick'
```

정규식이 쿼리 전체를 스캔하므로, 따옴표 안의 `/* route:writer */`도 매칭된다. 결과적으로 reader 쿼리가 writer로 라우팅된다.

### 공격 시나리오

악의적인 사용자가 모든 SELECT에 `'/* route:writer */'` 문자열을 넣으면:
- 모든 읽기 쿼리가 writer(Primary)로 몰림
- reader(Replica) 유휴, writer 과부하
- 사실상 R/W 분산 무효화

### 수정

힌트 검사 전에 문자열 리터럴을 제거하는 `stripStringLiterals()` 유틸리티를 추가:

```go
func stripStringLiterals(query string) string {
    var result strings.Builder
    inSingle, inDouble := false, false

    for i := 0; i < len(query); i++ {
        ch := query[i]
        switch {
        case ch == '\'' && !inDouble:
            result.WriteByte(ch)
            if inSingle {
                if i+1 < len(query) && query[i+1] == '\'' {
                    result.WriteByte('\'')
                    i++ // escaped quote ('')
                } else {
                    inSingle = false
                }
            } else {
                inSingle = true
            }
        case ch == '"' && !inSingle:
            result.WriteByte(ch)
            inDouble = !inDouble
        case inSingle || inDouble:
            // 따옴표 내부 콘텐츠 스킵
        default:
            result.WriteByte(ch)
        }
    }
    return result.String()
}
```

적용 전후:
```
입력: SELECT * FROM users WHERE note = '/* route:writer */ trick'
변환: SELECT * FROM users WHERE note = ''
→ 힌트 매칭 실패 → QueryRead ✓
```

PostgreSQL의 escaped quote (`''`)도 올바르게 처리한다:
```
입력: SELECT 'it''s fine'
변환: SELECT ''''
```

## 🚨 MAJOR: 키워드 오탐

### 문제

`containsWriteKeyword()`와 `extractCTETables()`는 쿼리 텍스트에서 SQL 키워드를 직접 검색한다. 문자열 리터럴 내부도 예외 없이 스캔하므로:

```sql
-- 1) false cache invalidation
SELECT * FROM logs WHERE action = 'INSERT INTO admin_table'
→ "admin_table" 캐시 무효화 (오탐)

-- 2) false table extraction
WITH x AS (SELECT * FROM a WHERE b = 'INSERT INTO oops') SELECT 1
→ "oops')" 테이블 추출 (오탐 + 파싱 깨짐)
```

### 실제 영향

- **캐시 히트율 저하**: 무관한 테이블이 무효화되어 캐시 효과 감소
- **잘못된 분류**: SELECT 쿼리가 `QueryWrite`로 분류될 수 있음 (CTE 경로)
- **메트릭 왜곡**: writer/reader 카운터가 실제와 불일치

### 수정

힌트 인젝션과 동일한 `stripStringLiterals()`를 적용:

```go
func containsWriteKeyword(query string) bool {
    upper := strings.ToUpper(stripStringLiterals(query))
    // ... 기존 word boundary 검사 ...
}

func extractCTETables(query string) []string {
    sanitized := stripStringLiterals(query)
    upper := strings.ToUpper(sanitized)
    // ... 기존 keyword 스캔 ...
}
```

`stripStringLiterals`는 따옴표 자체는 유지하고 내용만 제거하므로, 문자열 위치나 길이가 바뀌어도 키워드 검색에는 영향이 없다.

## 공통 패턴: 전처리 → 분석

세 함수 모두 같은 패턴을 따른다:

```
원본 쿼리
  ↓ stripStringLiterals()     ← 문자열 리터럴 제거
  ↓ extractHint() / containsWriteKeyword() / extractCTETables()
  ↓ 분석 결과
```

이 전처리 단계는 `splitStatements()`의 따옴표 추적 로직과 동일한 원리다. SQL 파서 없이 안전하게 분석하려면 **따옴표 경계를 먼저 처리**해야 한다는 교훈이다.

## 배운 점

1. **프로토콜 레벨 방어는 필수** — 네트워크에서 들어오는 데이터는 length 필드까지 포함해서 전부 의심해야 한다. `ReadStartupMessage`는 방어가 있었지만 `ReadMessage`에는 없었다.
2. **문자열 리터럴은 SQL 분석의 지뢰** — 완전한 SQL 파서 없이 정규식으로 분석하면, 따옴표 내부가 반드시 문제를 일으킨다. `stripStringLiterals` 같은 전처리가 최소한의 방어선이다.
3. **공격자 관점으로 리뷰하라** — "정상적인 사용자"만 상정한 코드 리뷰로는 이런 취약점을 놓친다. "이 입력값을 내가 제어할 수 있다면?" 관점이 필요하다.
4. **유틸리티 하나가 여러 버그를 막는다** — `stripStringLiterals`라는 단일 함수가 힌트 인젝션, 키워드 오탐, CTE 파싱 오류를 동시에 해결했다.

프로젝트 소스코드: [github.com/jyukki97/pgmux](https://github.com/jyukki97/pgmux)
