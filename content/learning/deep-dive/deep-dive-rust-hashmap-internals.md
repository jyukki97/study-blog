---
title: "Rust 해시맵 내부 동작 깊이 보기"
date: 2025-12-16
draft: true
topic: "Backend"
tags: ["Rust", "HashMap", "해시", "데이터구조"]
categories: ["Backend Deep Dive"]
description: "Rust HashMap(기본: SwissTable) 내부 구조, 해시 충돌 처리, 성능 특성을 정리"
module: "foundation"
---

## 이 글에서 얻는 것

- 해시맵이 평균 O(1)인 이유와, “갑자기 느려지는 순간”이 언제인지(충돌/리사이즈/메모리) 설명할 수 있습니다.
- Rust 표준 `HashMap`이 사용하는 SwissTable 계열의 아이디어(컨트롤 바이트, 캐시 친화, 프로빙)를 큰 그림으로 이해합니다.
- `with_capacity`/`reserve`/`entry` 같은 API가 성능에 어떤 영향을 주는지 감각을 잡습니다.
- “보안 vs 성능” 관점에서 해시 함수(SipHash vs ahash 등)를 선택할 때 무엇을 고려해야 하는지 정리합니다.

## 왜 백엔드에서 해시맵 내부를 알아야 할까

해시맵은 캐시, 집계, 중복 제거, 라우팅(키 → 핸들러), 세션/토큰 관리 등 백엔드 곳곳에 등장합니다.
대부분의 경우 “그냥 쓰면 빨라서” 문제가 없지만, 규모가 커지면 다음이 성능/장애로 이어집니다.

- 키가 많아질수록 **리사이즈(재해싱) 비용**이 스파이크를 만든다
- 충돌이 많아지면 “O(1)”이 아니라 **체감상 O(n)** 처럼 느려진다
- 키/값이 무겁거나(큰 객체) 할당이 많으면 **메모리/GC** 부담이 커진다

## 1) 해시맵의 기본 동작(충돌 처리 관점)

해시맵은 크게 두 방식을 많이 씁니다.

- **Separate Chaining**: 버킷마다 리스트/트리로 충돌을 연결(자바 HashMap은 체이닝 + 일부 트리화)
- **Open Addressing**: 충돌이 나면 “다음 칸”으로 이동하며 빈 자리를 찾음(프로빙)

Rust의 `HashMap`은 기본적으로 open addressing 계열(구현은 hashbrown/SwissTable 아이디어)을 사용합니다.

핵심 감각:

- open addressing은 메모리가 비교적 연속적이라 **캐시 친화적**일 수 있음
- 대신 부하율(load factor)이 올라가면 프로빙 길이가 길어져 성능이 급격히 나빠질 수 있음

## 2) SwissTable 계열의 아이디어(큰 그림)

SwissTable의 포인트는 “충돌이 나도 빨리 찾게” 만드는 구현 디테일에 있습니다.

- 엔트리를 저장하는 배열과 별도로, **컨트롤 바이트(control bytes)** 라는 작은 메타데이터 배열을 둡니다.
- 조회할 때는 컨트롤 바이트를 먼저 훑어서(종종 SIMD로) “후보가 될 수 있는 버킷”을 빠르게 좁힙니다.
- 그 다음에만 실제 키 비교를 수행합니다(키 비교는 보통 더 비싸기 때문).

이 구조가 주는 효과:

- 캐시 미스가 줄어들고, 키 비교 횟수가 줄어들어 평균 성능이 좋아질 수 있습니다.

## 3) 리사이즈와 capacity: 성능 스파이크의 주범

해시맵은 내부 배열이 꽉 차면 더 큰 배열로 옮기는 과정(리사이즈/재해싱)을 합니다.
이때 순간적으로 CPU/메모리를 크게 쓰면서 지연이 튈 수 있습니다.

그래서 “대충 크기를 예측할 수 있을 때”는 초기 용량을 주는 게 좋습니다.

```rust
use std::collections::HashMap;

let mut counts: HashMap<String, usize> = HashMap::with_capacity(100_000);
```

실무 감각:

- 이벤트 집계/로그 분석/대량 배치처럼 “대략 N개 들어올 것”을 알면 `with_capacity`/`reserve`로 스파이크를 줄입니다.

## 4) `entry` API: 중복 조회를 줄이는 기본기

집계 코드는 `get` 후 `insert`를 하면 해시를 두 번 치는 경우가 많습니다.
`entry`는 한 번의 조회로 “있으면 수정/없으면 생성”을 처리합니다.

```rust
use std::collections::HashMap;

let mut counts: HashMap<String, usize> = HashMap::new();
for word in ["a", "b", "a"] {
    *counts.entry(word.to_string()).or_insert(0) += 1;
}
```

## 5) 해시 함수 선택: 보안 vs 성능

해시맵은 입력이 “특정 형태로 편향”되면 충돌이 늘어 성능이 급락할 수 있습니다.
그래서 표준 라이브러리는 일반적으로 **충돌 공격(DoS)에 강한 해시**를 기본값으로 둡니다(대신 느릴 수 있음).

- 기본(SipHash 계열): 공격에 비교적 강함(사용자 입력 키가 많은 경우 안전)
- 빠른 해시(ahash 등): 성능이 좋을 수 있지만, 신뢰 경계 밖 입력에는 주의해야 함

선택 기준(요약):

- 키가 외부 사용자 입력에 크게 좌우된다 → 기본 해시 유지가 안전
- 내부 시스템에서 생성된 키(신뢰 가능한 입력) + 성능 병목이 명확하다 → 빠른 해시를 “근거 있게” 고려

## 6) 실무에서 자주 하는 실수

- “Map이 느리다”라고 느끼면 무작정 해시를 바꾸기 전에, 먼저 **리사이즈/할당/키 크기**부터 확인하기
- 커스텀 키 타입을 만들 때 `Hash`/`Eq`가 일관되지 않으면(동등한데 해시가 다름) 조회가 깨집니다
- 순회 순서가 안정적일 거라고 기대하기(해시맵의 순서는 보장되지 않습니다)

## 7) SwissTable를 조금 더 깊게: 그룹 스캔 + 프로빙

Rust `HashMap`의 핵심 구현체인 `hashbrown`은 버킷을 “한 칸씩” 보는 대신, **컨트롤 바이트 그룹**을 먼저 검사해 후보를 좁힙니다.

흐름을 단순화하면 대략 이렇습니다.

1. 키를 해시해서 상위/하위 비트를 나눠 사용
2. 하위 비트로 시작 버킷(그룹)을 정함
3. 해당 그룹의 컨트롤 바이트를 한 번에 스캔해 “같을 가능성이 있는 슬롯”만 추림
4. 후보 슬롯에서 실제 키 비교
5. 실패 시 다음 그룹으로 프로빙

이 방식의 장점은 **불필요한 키 비교를 줄이는 것**입니다.
키가 길거나(문자열) 비교 비용이 클수록 차이가 커집니다.

## 8) 삭제가 잦을 때 성능이 흔들리는 이유

Open addressing 계열 해시맵은 삭제 시 내부적으로 “빈 칸”과 구분되는 삭제 마커(개념적으로 tombstone)를 다룹니다.
삭제가 매우 잦은 워크로드에서는 이 흔적이 쌓이며 프로빙 길이가 늘 수 있습니다.

실무에서 체감되는 신호:

- 엔트리 수는 비슷한데 조회 지연이 서서히 증가
- CPU 프로파일에서 해시맵 조회 비중이 비정상적으로 커짐
- 특정 구간 이후 p95/p99가 갑자기 튐

대응 패턴:

- 장시간 누적 캐시라면 주기적 재구성(rebuild) 고려
- 삭제·삽입이 매우 잦다면 자료구조 선택 재검토(BTreeMap, sharded map 등)
- 단순히 해시 함수 교체 전에 워크로드 특성(삽입/조회/삭제 비율)부터 계측

## 9) `HashMap` vs `BTreeMap`: 선택 기준

둘 다 표준 컬렉션이지만 용도가 다릅니다.

- `HashMap`: 평균 O(1), 빠른 단건 조회/삽입에 강함
- `BTreeMap`: O(log n), **정렬 순회/범위 조회**(`range`)가 필요할 때 유리

백엔드에서 자주 헷갈리는 포인트:

- “조회가 많다”만으로 HashMap 고정 아님
- `top N`, `기간 범위`, `정렬된 키 순회`가 중요하면 BTreeMap이 전체 파이프라인 비용을 낮출 수 있음

## 10) 간단 벤치마크 템플릿(criterion)

감으로 결정하지 말고, 최소한 아래 3개를 같은 데이터셋으로 비교해보면 좋습니다.

- `HashMap::new()`
- `HashMap::with_capacity(n)`
- 빠른 해시 빌더(`ahash`) 적용 버전

```rust
// Cargo.toml
// [dev-dependencies]
// criterion = "0.5"

use criterion::{criterion_group, criterion_main, Criterion};
use std::collections::HashMap;

fn bench_insert(c: &mut Criterion) {
    let keys: Vec<String> = (0..100_000).map(|i| format!("key-{i}")).collect();

    c.bench_function("hashmap_new_insert", |b| {
        b.iter(|| {
            let mut m: HashMap<String, usize> = HashMap::new();
            for k in &keys {
                m.insert(k.clone(), 1);
            }
            m.len()
        })
    });

    c.bench_function("hashmap_with_capacity_insert", |b| {
        b.iter(|| {
            let mut m: HashMap<String, usize> = HashMap::with_capacity(keys.len());
            for k in &keys {
                m.insert(k.clone(), 1);
            }
            m.len()
        })
    });
}

criterion_group!(benches, bench_insert);
criterion_main!(benches);
```

측정 시 체크:

- 평균만 보지 말고 p95/p99(지연 스파이크) 확인
- 키 생성 비용(문자열 clone)과 맵 연산 비용을 분리
- 운영 입력 분포와 비슷한 데이터셋으로 재검증

## 11) 운영 체크리스트(실전용)

- 예상 키 개수가 있으면 `with_capacity`/`reserve` 적용
- 핫패스 집계는 `entry`로 중복 조회 제거
- 커스텀 키 타입은 `Eq`/`Hash` 일관성 테스트 추가
- 외부 입력 키가 크거나 악의적일 수 있으면 기본 해시 유지
- 삭제가 잦은 캐시는 재구성 시점(예: 엔트리 churn 임계치) 정의
- 맵 교체 전/후 벤치 결과를 PR에 남겨 회귀 추적 가능하게 유지

## 함께 보면 좋은 글

- [Spring 예외 처리 구조 깊이 보기](/learning/deep-dive/deep-dive-spring-exception-handling/)
- [Docker Compose 네트워크 깊이 보기](/learning/deep-dive/deep-dive-docker-compose-network/)
- [HTTP/3와 QUIC 깊이 보기](/learning/deep-dive/deep-dive-http3-quic/)

## 연습(추천)

- `with_capacity` 유무 + 삭제 비율(0%, 10%, 30%)을 바꿔 p95 지연 비교
- `HashMap`과 `BTreeMap`으로 같은 요구사항(단건 조회 vs 범위 조회)을 구현해 총 처리시간 비교
- 키 분포를 균등/편향 2종으로 나눠 충돌 증가 시 처리량 변화를 관찰
