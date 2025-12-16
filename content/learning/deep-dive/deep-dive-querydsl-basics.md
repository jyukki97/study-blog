---
title: "QueryDSL 입문: 타입세이프 쿼리와 페이징"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["QueryDSL", "JPA", "Repository", "페이징"]
categories: ["Backend Deep Dive"]
description: "기본 문법, 동적 where, 페이징/정렬 패턴을 예제로 정리"
module: "spring-core"
study_order: 26
---

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

## 동적 where 패턴

```java
private BooleanExpression nameContains(String keyword) {
    return StringUtils.hasText(keyword) ? user.name.containsIgnoreCase(keyword) : null;
}
```

## 페이징 주의

- `.fetchResults()`는 5.0에서 제거 예정 → count 쿼리 분리
- `orderBy` 없으면 정렬 보장 X

## 체크리스트

- [ ] Q타입 생성: gradle 플러그인/annotationProcessor 설정 확인
- [ ] 동적 조건은 `BooleanExpression...` varargs로 관리
- [ ] 카운트 쿼리 최적화: fetchJoin 제거, 필요한 컬럼만 선택
