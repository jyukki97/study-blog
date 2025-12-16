---
title: "Java 예외 처리 & Optional/Stream 패턴"
date: 2025-12-16
draft: false
topic: "Backend"
tags: ["Java", "Exception", "Optional", "Stream"]
categories: ["Backend Deep Dive"]
description: "체크예외 vs 런타임예외, Optional/Stream에서 흔한 함정과 안전한 사용 패턴 정리"
module: "foundation"
study_order: 14
---

## 예외 처리 원칙

- **비즈니스 예외 = 런타임 예외로 래핑**: 체크 예외가 전파되며 호출부 오염 방지
- **메시지 vs 코드 분리**: 에러 코드(Enum) + 메시지 템플릿, 로깅은 내부/응답은 최소
- **복구 가능한 예외만 try-catch**, 나머지는 상위로 전파 후 공통 핸들러에서 처리

## Optional 안전 패턴

- ❌ `Optional.get()` 남발, `null` 반환 금지
- ✅ `orElseThrow`, `map`/`flatMap`/`filter` 체이닝
- 컬렉션에는 Optional 사용 지양 → 빈 리스트 반환

```java
User user = userRepository.findById(id)
        .orElseThrow(() -> new NotFoundException("USER_NOT_FOUND"));
```

## Stream 주의점

- 부수효과(side effect) 최소화, 병렬 스트림은 CPU 바운드에서만 신중히 사용
- `collect` 대신 `toList()` (Java 16+), NPE 방지 위해 원본은 null 대신 빈 컬렉션 반환

```java
List<String> names = users.stream()
    .map(User::getName)
    .filter(Objects::nonNull)
    .toList();
```

## 체크리스트

- [ ] 예외 계층: `BaseBusinessException` + 에러코드/메시지
- [ ] Optional 반환 메서드: 도메인 조회에만, DTO 필드엔 사용하지 않음
- [ ] Stream에서 공유 상태 변경 금지, 병렬 사용 시 스레드 안전 확인

## 추가 학습

- Effective Java 아이템 69~73 (예외), 아이템 55 (Optional)
