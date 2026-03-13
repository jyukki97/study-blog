---
title: "Go로 PostgreSQL 프록시 만들기 (21) - Prepared Statement Multiplexing"
date: 2026-03-12
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "Prepared Statement", "Wire Protocol", "Security"]
categories: ["Database"]
description: "Transaction Pooling 환경에서 Prepared Statement를 사용할 수 없는 PgBouncer의 한계를 극복하기 위해, Parse/Bind 메시지를 인터셉트하여 Simple Query로 합성하는 Multiplexing 기능을 구현한다."
---

## 들어가며

PgBouncer의 가장 유명한 한계점이 있다. **Transaction Pooling 모드에서 Prepared Statement를 사용할 수 없다는 것이다.**

이유는 단순하다. Prepared Statement는 **서버 측 상태**다. `Parse` 메시지로 등록한 statement는 그 커넥션에만 존재한다. 그런데 Transaction Pooling은 쿼리마다 다른 백엔드 커넥션을 할당할 수 있으므로, 클라이언트가 `Bind`를 보내는 시점에 해당 statement가 존재하지 않을 수 있다.

pgmux에서는 이 문제를 다른 방식으로 해결한다. **Parse/Bind를 인터셉트하여 파라미터를 바인딩한 Simple Query로 합성(Synthesize)하는 것이다.**

---

## PG Extended Query Protocol 복습

PostgreSQL의 Extended Query Protocol은 5개의 메시지로 구성된다:

```
Client → Parse    (SQL + statement name + param type OIDs)
Client → Bind     (statement name + parameter values + format codes)
Client → Describe (statement/portal 메타데이터 요청)
Client → Execute  (portal 실행)
Client → Sync     (배치 완료, 결과 전송 트리거)
```

일반 프록시(proxy 모드)에서는 이 메시지들을 그대로 백엔드에 전달한다. 하지만 multiplex 모드에서는:

```
Parse  → 프록시가 statement 등록 (query + paramOIDs 저장)
Bind   → 파라미터 값 추출
Sync   → $1, $2... 를 실제 값으로 치환한 Simple Query를 백엔드에 전송
```

---

## T19-1: Bind 메시지 완전 파싱

기존 `ParseBindMessage()`는 portal name과 statement name만 추출했다. Multiplexing을 위해서는 **파라미터 값까지 완전히 파싱**해야 한다.

Bind 메시지의 와이어 포맷:

```
portal_name\0 + statement_name\0 +
int16(num_format_codes) + int16[](format_codes) +
int16(num_params) + (int32(param_len) + bytes[](value))[] +
int16(num_result_format_codes) + int16[](result_format_codes)
```

핵심 구현:

```go
type BindMessageDetail struct {
    Portal           string
    StatementName    string
    FormatCodes      []int16  // 0=text, 1=binary
    Parameters       [][]byte // nil = NULL
    ResultFormatCodes []int16
}

func ParseBindMessageFull(payload []byte) (*BindMessageDetail, error) {
    // ... 순차적으로 파싱
    // param_len == -1 이면 NULL
    // param_len >= 0 이면 해당 바이트만큼 읽기
}
```

format code가 1개이면 모든 파라미터에 동일 적용, 0개이면 모두 text, N개이면 각각 대응한다. 이 규칙은 PG 프로토콜 스펙에 명시되어 있다.

---

## T19-2: SQL 리터럴 직렬화 — 보안의 핵심

파라미터 값을 SQL 문자열로 변환할 때 **SQL Injection을 완벽히 차단**해야 한다. OID(타입 번호)별로 변환 규칙이 다르다.

### 타입별 직렬화 규칙

| 타입 | OID | 변환 규칙 |
|------|-----|-----------|
| bool | 16 | `TRUE` / `FALSE` |
| int2/4/8 | 21/23/20 | 숫자 문자열 검증 후 그대로 |
| float4/8 | 700/701 | `NaN`, `Infinity` 특수 처리 |
| numeric | 1700 | 정규식 검증 (지수 표기 포함) |
| text/varchar | 25/1043 | `'` → `''` 이스케이핑 |
| bytea | 17 | `E'\\x...'` hex 포맷 |
| UUID | 2950 | 36자리 형식 검증 |
| NULL | - | `NULL` 리터럴 |
| 알 수 없는 타입 | * | text로 취급 + 이스케이핑 |

### 이스케이핑의 핵심

```go
func escapeStringLiteral(s string) string {
    var b strings.Builder
    b.WriteByte('\'')
    for i := 0; i < len(s); i++ {
        ch := s[i]
        if ch == '\'' {
            b.WriteString("''")    // single quote → 두 개로
        } else if ch == 0 {
            continue               // NULL byte 제거
        } else {
            b.WriteByte(ch)
        }
    }
    b.WriteByte('\'')
    return b.String()
}
```

`standard_conforming_strings=on`(PG 9.1+ 기본값)을 전제로, 백슬래시는 특별한 의미가 없으므로 single quote 이스케이핑만으로 충분하다.

정수/숫자 타입은 반드시 **형식 검증**을 거친다. `1; DROP TABLE users;--` 같은 값이 int4 타입으로 들어오면 에러를 반환한다.

---

## T19-3: Query Synthesizer

핵심 로직은 간단하다. 쿼리의 `$1`, `$2` 플레이스홀더를 리터럴 값으로 치환한다.

```
입력: SELECT * FROM users WHERE name = $1 AND age > $2
파라미터: ['Alice', 30]
출력: SELECT * FROM users WHERE name = 'Alice' AND age > 30
```

하지만 한 가지 함정이 있다. **문자열 리터럴 내부의 `$1`은 치환하면 안 된다.**

```sql
SELECT * FROM users WHERE bio = '$1 is not replaced' AND id = $1
```

이를 위해 single-quoted 문자열과 dollar-quoted 문자열(`$$ ... $$`)을 추적하며 건너뛰는 파서를 구현했다.

```go
func replacePlaceholders(query string, literals []string) (string, error) {
    for i < len(query) {
        if query[i] == '\'' {
            // 문자열 리터럴 — 끝까지 스킵 (escaped quote '' 처리)
        }
        if query[i] == '$' && nextIsDollarTag(query, i) {
            // dollar-quoted 문자열 — 닫는 태그까지 스킵
        }
        if query[i] == '$' && nextIsDigit(query, i+1) {
            // 플레이스홀더 — 리터럴로 치환
        }
    }
}
```

---

## T19-5: Server 통합

`pool.prepared_statement_mode: "multiplex"` 설정 시, Extended Query 처리가 완전히 달라진다:

```
[proxy 모드]  Parse → buffer → Bind → buffer → Sync → 백엔드에 그대로 전달
[multiplex 모드] Parse → 등록 + ParseComplete → Bind → 추출 + BindComplete → Sync → 합성 → Simple Query 전송
```

multiplex 모드에서는 프록시가 ParseComplete('1'), BindComplete('2'), CloseComplete('3')를 **직접 생성하여 클라이언트에 전송**한다. 실제 백엔드에는 합성된 Simple Query만 전달된다.

Describe 메시지는 특별 처리가 필요하다. 클라이언트(특히 ORM)가 컬럼 메타데이터를 요청하면, 프록시가 임시로 백엔드에 Parse → Describe → Close → Sync를 보내고 결과를 릴레이한다.

---

## T19-6: SQL Injection 방어 테스트

보안이 핵심인 기능이므로, 공격 페이로드를 체계적으로 테스트했다:

```go
// DROP TABLE 주입
input: "'; DROP TABLE users; --"
type:  text
결과:  '''; DROP TABLE users; --'   // 안전하게 문자열 리터럴로 처리

// 정수 타입으로 주입 시도
input: "1; DROP TABLE users;--"
type:  int4
결과:  에러 (숫자 형식 검증 실패)

// NULL byte 주입
input: "hello\x00world"
type:  text
결과:  'helloworld'   // NULL byte 제거

// 중첩 이스케이핑
input: "''''"
type:  text
결과:  ''''''''''     // 각 ' → '' 변환 + 양끝 인용부호
```

---

## 설정

```yaml
pool:
  prepared_statement_mode: "multiplex"  # "proxy" | "multiplex"
```

- `proxy` (기본값): 기존 동작. Parse/Bind/Execute를 그대로 백엔드에 전달.
- `multiplex`: Parse/Bind를 인터셉트하여 Simple Query로 합성. Transaction Pooling과 Prepared Statement를 동시에 사용 가능.

---

## 제한사항

- **binary format result**: multiplex 모드에서 결과는 text format으로 반환된다.
- **COPY**: COPY 프로토콜은 지원하지 않는다.
- **커서**: `DECLARE CURSOR ... FETCH` 패턴은 multiplex 모드에서 동작하지 않는다.
- **다중 statement 배치**: 한 Sync에 여러 Parse/Bind가 있으면 마지막 것만 합성된다.

---

## 마무리

PgBouncer의 가장 큰 한계인 "Transaction Pooling + Prepared Statement 불가" 문제를 해결하는 킬러 피처를 구현했다. 경쟁 제품(PgBouncer, PgCat, Odyssey) 어디에도 없는 기능이다.

보안 관점에서 가장 까다로운 Phase였다. 파라미터 직렬화에서 단 하나의 이스케이핑 실수도 SQL Injection으로 이어지기 때문이다. 타입별 검증과 포괄적 테스트 매트릭스로 이를 방어했다.

다음 글에서는 오픈소스 릴리스를 위한 GitHub Actions CI, Docker Image, 벤치마크 Suite를 다룰 예정이다.
