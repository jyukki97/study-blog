---
title: "QueryDSL 입문: 타입세이프 쿼리와 페이징"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["QueryDSL", "JPA", "Repository", "페이징"]
categories: ["Backend Deep Dive"]
description: "기본 문법, 동적 where, 페이징/정렬 패턴을 예제로 정리"
module: "spring-core"
study_order: 190
---

## 이 글에서 얻는 것

- QueryDSL을 “문법”이 아니라, 동적 쿼리를 안전하게 만들기 위한 **타입 세이프 쿼리 도구**로 이해할 수 있습니다.
- 동적 where/정렬/페이징을 실무 패턴(조건 조립, DTO 프로젝션, count 분리)으로 구성할 수 있습니다.
- offset 페이징 한계, 비효율 count, 정렬 누락 같은 실전 함정을 피할 수 있습니다.

## 0) QueryDSL은 왜 쓰나

스프링 데이터/JPA에서 조회가 복잡해지면 보통 다음 문제가 생깁니다.

- 메서드 이름 기반 쿼리가 폭발한다(읽기 어려움/유지보수 어려움)
- 문자열 JPQL은 런타임에 터진다(오타/필드명 변경)
- 조건이 늘수록 if/문자열 조립이 지저분해진다

QueryDSL은 “쿼리를 코드로” 표현하고, 컴파일 타임에 타입/필드 오류를 잡게 해줍니다.

## 1) 기본 조회: selectFrom + where + order + paging

```java
QUser user = QUser.user;

List<User> users = queryFactory
    .selectFrom(user)
    .where(
        user.status.eq(Status.ACTIVE),
        user.name.containsIgnoreCase(keyword)
    )
    .orderBy(user.createdAt.desc())
    .offset(page * size)
    .limit(size)
    .fetch();
```

포인트:

- `where()`는 조건을 여러 개 받을 수 있고, **null 조건은 무시**되는 패턴을 이용해 동적 조건을 깔끔하게 만들 수 있습니다.
- 페이징에서는 `orderBy`가 사실상 필수입니다(정렬 없으면 결과 순서가 보장되지 않아 “중복/누락”이 생길 수 있음).

## 2) 동적 where 패턴: null을 반환해서 조건을 “없애기”

```java
private BooleanExpression nameContains(String keyword) {
    return StringUtils.hasText(keyword) ? user.name.containsIgnoreCase(keyword) : null;
}
```

실무에서는 다음처럼 조합하는 형태가 자주 나옵니다.

```java
List<User> users = queryFactory.selectFrom(user)
    .where(
        nameContains(keyword),
        statusEq(status),
        createdAtBetween(from, to)
    )
    .fetch();
```

## 3) 조건이 많아지면: BooleanBuilder(조립) 패턴

조건이 복잡해지면 `BooleanBuilder`로 “조건을 누적”하는 패턴도 유용합니다.

```java
BooleanBuilder builder = new BooleanBuilder();
if (StringUtils.hasText(keyword)) builder.and(user.name.containsIgnoreCase(keyword));
if (status != null) builder.and(user.status.eq(status));

List<User> users = queryFactory.selectFrom(user)
    .where(builder)
    .fetch();
```

## 4) DTO 프로젝션: 엔티티 대신 “조회 모델”로 받기

엔티티를 그대로 내려주면 지연 로딩/N+1/직렬화 이슈가 생기기 쉽습니다.
조회 목적이라면 필요한 필드만 DTO로 가져오는 게 안정적인 경우가 많습니다.

예시(개념):

- `Projections.constructor(UserDto.class, user.id, user.name, user.createdAt)`

## 5) 페이징: count 쿼리는 ‘분리’가 기본

실무에서 페이지 조회는 보통 “콘텐츠 쿼리 + count 쿼리” 2개가 필요합니다.
여기서 count 쿼리가 무거워지면 페이지 API가 느려집니다.

권장 포인트:

- count 쿼리는 fetchJoin/복잡한 orderBy를 빼고 가능한 단순하게
- 그룹/조인 구조가 복잡하면 “정확한 count”가 비싸질 수 있으니 설계를 같이 고민(요구사항/대체 지표)

## 6) offset 페이징의 한계와 키셋 페이징

offset이 커질수록 DB는 앞쪽 데이터를 버리기 위해 더 많은 작업을 하게 될 수 있습니다.
대량 데이터에서 “뒤 페이지가 느리다”면 키셋(Seek) 페이징을 고려합니다.

예: `createdAt < lastCreatedAt` 또는 `(createdAt, id) < (lastCreatedAt, lastId)` 같은 형태.

## 7) 자주 하는 실수

- 정렬 없이 페이징을 해서 “중복/누락”이 발생
- count 쿼리에 fetchJoin/불필요한 조인을 넣어 페이지 조회가 느려짐
- 조건 조립이 흩어져서(서비스/레포/유틸) 쿼리 규칙이 깨짐

## 연습(추천)

- 검색 조건 5개(상태/기간/키워드/정렬/페이지)를 가진 조회 API를 QueryDSL로 구현해보기
- count 쿼리를 분리하고, fetchJoin이 있을 때/없을 때 성능 차이를 비교해보기
- offset이 커질수록 얼마나 느려지는지 관찰하고, 키셋 페이징으로 개선해보기
