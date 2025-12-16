---
title: "Spring AOP와 트랜잭션 내부 동작"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["Spring", "AOP", "Transaction", "Proxy"]
categories: ["Backend Deep Dive"]
description: "프록시 기반 AOP, @Transactional 적용 시점, self-invocation 주의사항 정리"
module: "spring-core"
study_order: 145
---

## AOP 프록시

- 기본: JDK Dynamic Proxy(인터페이스) or CGLIB(클래스)
- 포인트컷/어드바이스로 횡단 관심사를 분리 (로깅/트랜잭션)

## @Transactional 적용 흐름

- 빈 생성 시 프록시 래핑 → 메서드 호출 진입 전 PlatformTransactionManager로 트랜잭션 시작
- 종료 시 commit/rollback 결정 → 예외 유형에 따라 롤백 규칙 적용

```java
@Service
@Transactional
public class OrderService {
    public void placeOrder(...) { ... }
}
```

## self-invocation 문제

- 같은 클래스 내부 메서드 호출은 프록시 우회 → 어드바이스 미적용
- 해결: 구조 분리(서비스 분리) or AOP Context (`AopContext.currentProxy()`) 제한적으로 사용

## 체크리스트

- [ ] public 메서드 진입 지점에서만 @Transactional 적용됨을 기억
- [ ] 프록시 우회 호출(self-invocation) 방지 설계
- [ ] 커스텀 어노테이션/어드바이스 순서(Ordered) 명확히 지정
