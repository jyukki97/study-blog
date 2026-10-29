---
title: "백엔드 커리큘럼 심화: Java ScopedValue로 요청 컨텍스트를 안전하게 전파하는 기준"
date: 2026-10-29
draft: false
topic: "Backend Concurrency"
tags: ["Java", "ScopedValue", "Structured Concurrency", "Spring Boot", "Observability", "Backend"]
categories: ["Backend Deep Dive"]
description: "Java ScopedValue를 ThreadLocal의 단순 대체재로 보지 않고, 요청 컨텍스트의 범위·전파·정리·관측성을 설계하는 실무 기준으로 정리합니다."
module: "backend-modern-frontiers"
study_order: 1241
---

요청 ID, 인증 주체, 테넌트, 언어 설정, trace context는 비즈니스 로직보다 먼저 서비스 전체를 가로지릅니다. Java 서버에서는 오랫동안 `ThreadLocal`이 이 정보를 전달하는 편리한 통로였습니다. 그러나 비동기 작업, executor 전환, 재시도, Virtual Thread가 섞이면 “누가 값을 넣었고 언제 지웠는가”가 코드 밖으로 밀려납니다. 누락된 정리 코드는 다음 요청에 이전 사용자의 컨텍스트를 남길 수 있고, 복사된 컨텍스트는 취소된 작업까지 오래 붙잡을 수 있습니다.

Java의 `ScopedValue`는 이 문제를 마법처럼 없애지 않습니다. 다만 값을 **어느 호출 범위에서만 읽게 할지**를 API로 드러내고, 그 범위가 끝나면 자동으로 사라지게 만듭니다. 이 글은 [Java Virtual Threads와 Spring MVC/WebFlux 선택](/learning/deep-dive/deep-dive-java-virtual-threads-spring-mvc-webflux-playbook/), [ThreadLocal 컨텍스트 전파·정리](/learning/deep-dive/deep-dive-threadlocal-context-propagation-cleanup-playbook/), [End-to-End Deadline과 Cancellation](/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/), [구조화된 로깅](/learning/deep-dive/deep-dive-structured-logging/)을 하나의 요청 경계로 연결합니다.

## 이 글에서 얻는 것

- `ScopedValue`가 적합한 읽기 전용 요청 메타데이터와, 명시적으로 전달해야 하는 가변 상태를 구분합니다.
- Spring MVC 또는 Virtual Thread 기반 서비스에서 filter·service·하위 작업까지 컨텍스트 범위를 설계하는 방법을 익힙니다.
- 로그 MDC, 보안 주체, trace ID를 섞지 않고 누락·오염을 검증하는 기준을 얻습니다.
- JDK 기능 상태와 운영 런타임 지원 범위를 고려해 canary 도입 여부를 판단할 수 있습니다.

## 핵심 개념/이슈

### 1) ThreadLocal의 문제는 저장소보다 수명이다

`ThreadLocal` 자체가 항상 잘못된 도구는 아닙니다. 문제는 요청이 하나의 platform thread에서 시작해 끝난다는 가정이 무너지면 수명이 보이지 않는다는 점입니다. thread pool을 쓰는 서비스에서 `set()` 뒤 `remove()`가 누락되면 다음 요청이 같은 worker를 빌렸을 때 이전 값을 읽을 수 있습니다. executor를 넘으면 값이 사라져 audit log에서 주체가 빠지고, 값을 복사하면 반대로 취소된 작업에 값이 계속 남습니다.

`ScopedValue`는 전역 map이 아니라 동적 호출 범위에 값을 바인딩하는 모델입니다. 호출자는 `where(...).run(...)` 같은 범위 안에서만 값을 제공하고, 하위 호출자는 읽기만 합니다. 범위를 벗어나면 값은 더 이상 bound 상태가 아닙니다. 즉 질문이 “정리 코드를 어느 finally에 둘까?”에서 “이 요청 메타데이터가 유효한 호출 경계는 어디까지인가?”로 바뀝니다.

```java
public final class RequestContext {
    public static final ScopedValue<RequestMeta> META = ScopedValue.newInstance();

    public static void run(RequestMeta meta, Runnable work) {
        ScopedValue.where(META, meta).run(work);
    }
}

RequestContext.run(meta, () -> chain.doFilter(request, response));
```

여기서 `RequestMeta`는 request ID, tenant ID, 인증된 subject의 식별자처럼 **요청 동안 변하지 않아야 하는 작은 값**으로 제한합니다. entity manager, HTTP request/response 객체, 큰 JWT 원문, 연결 객체, 변경 가능한 `Map`을 넣는 저장소로 만들면 수명은 좋아져도 결합도와 메모리 비용은 그대로입니다.

### 2) 읽기 전용 메타데이터와 가변 상태를 분리한다

`ScopedValue`는 가변 요청 상태를 숨기는 도구가 아닙니다. 다음처럼 값을 나누면 설계가 단순해집니다.

| 값의 성격 | 권장 전달 방식 | 이유 |
| --- | --- | --- |
| request ID, trace ID, tenant ID, locale | `ScopedValue` 후보 | 읽기 위주이고 요청 동안 바뀌면 안 됨 |
| timeout/deadline, cancellation signal | 명시적 context 객체 또는 parameter | 호출자가 예산·취소를 보고 결정을 내려야 함 |
| DB transaction, security principal | Spring/Security의 공식 경계 유지 | lifecycle과 cleanup을 프레임워크가 소유 |
| 누적 결과, pagination cursor, mutable cache | method parameter·return value | 변경과 소유자를 코드에서 보여야 함 |
| MDC logging field | logging bridge 또는 명시적 log event | 비동기 경계를 넘을 때 전파 규칙을 검증해야 함 |

특히 deadline을 `ScopedValue`에 넣고 하위 호출이 몰래 읽게 만들면, 어떤 API가 시간 예산을 소비하는지 추적하기 어렵습니다. [End-to-End Deadline과 Cancellation](/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/)에서 다루듯 남은 예산은 외부 호출 timeout 계산과 retry 중단에 직접 쓰이므로, 인터페이스에서 보이는 context가 낫습니다. 반대로 `tenantId`는 대부분의 조회·로그·권한 설명에 필요하지만 business method마다 인자로 반복하면 잡음이 커질 수 있어 scoped read가 잘 맞습니다.

### 3) 구조화된 동시성에서도 전파 범위를 다시 판단한다

Virtual Thread나 구조화된 동시성은 작업을 많이 만든다고 해서 컨텍스트의 의미가 자동으로 같아지는 것은 아닙니다. 같은 요청에서 상품·재고·추천을 병렬 조회한다면 자식 작업은 같은 request ID와 tenant ID를 가져도 됩니다. 그러나 background reconciliation, 큐 consumer, 다음 날 재시도 작업까지 웹 요청의 주체를 끌고 가면 안 됩니다. 그것은 전파가 아니라 출처를 위조하는 일입니다.

작업 생성 위치를 기준으로 나누세요. 요청을 기다리는 child는 부모 요청 범위 안에서 시작하고 종료·취소되는 경우에만 같은 메타데이터를 상속 후보로 둡니다. durable 작업은 job ID, original request ID, triggering actor를 payload 또는 작업 레코드로 명시하고 consumer가 자신의 실행 context를 새로 바인딩합니다. 외부 callback은 trace header를 보내더라도 사용자 권한이나 내부 tenant 식별자를 무조건 전파하지 않고 allowlist로 제한합니다.

이 구분은 기존 decorator를 없애자는 뜻이 아닙니다. 라이브러리가 `ThreadLocal` MDC만 읽는다면 [ThreadLocal 컨텍스트 전파·정리](/learning/deep-dive/deep-dive-threadlocal-context-propagation-cleanup-playbook/)의 bridge가 필요할 수 있습니다. 다만 bridge는 한 방향의 호환 계층으로 두고, 새 비즈니스 API까지 암묵적 전파에 의존하게 만들지 않는 편이 안전합니다.

### 4) 보안 컨텍스트와 관측성 컨텍스트는 같은 값이 아니다

로그에 `actorId`가 있다고 해서 그 값으로 권한을 판정해서는 안 됩니다. 관측성 컨텍스트는 원인을 추적하기 위한 설명이고, 보안 컨텍스트는 검증된 credential·권한·세션 수명에 따라 행동을 허용하는 경계입니다. 둘을 한 `RequestMeta`에 편하게 넣으면 logging code가 권한 객체에 접근하거나, 비동기 로그가 만료된 credential을 오래 보존할 수 있습니다.

원칙은 세 가지입니다. 첫째, `subjectId`, `tenantId`, `requestId`처럼 최소 식별자만 둡니다. 둘째, 외부 header에서 온 correlation ID와 서버가 생성한 ID의 신뢰 등급을 구분합니다. 셋째, 인가기는 검증된 principal을 읽고 logger는 안전한 식별자 사본만 읽게 합니다. `ScopedValue`는 수명 경계를 제공하지만 데이터 분류·redaction·retention 정책을 대신하지 않습니다.

## 실무 적용

### 1) endpoint 하나에서 shadow mode로 시작한다

첫 적용에서 모든 `ThreadLocal`을 바꾸지 마세요. 읽기 비중이 높고 side effect가 작은 endpoint 하나를 골라 `requestId`와 `tenantId`만 scoped binding으로 추가합니다. 기존 MDC와 새 메타데이터를 1~2주 같이 기록하되, 개인식별정보나 원문 token은 비교 로그에 넣지 않습니다.

| 관찰 항목 | 출발 기준 | 중단 또는 조사 조건 |
| --- | --- | --- |
| request ID 누락률 | 전체 로그의 0.1% 미만 | 배포 전 기준보다 0.1%p 이상 증가 |
| tenant ID 불일치 | 0건 | 같은 request ID에서 서로 다른 tenant가 관측됨 |
| p95 지연 | 기준선 ±5% 이내 | 15분 이상 10% 초과 악화 |
| 메모리/GC | 기준선 ±10% 이내 | 메타데이터가 큰 객체를 붙잡는 정황 |
| child trace 연결 | 표본 50건 중 100% | parent-child가 끊기거나 다른 요청으로 연결됨 |

숫자는 보편적인 SLA가 아니라 canary에서 이상을 빨리 발견하기 위한 출발값입니다. 특히 tenant 불일치는 한 건이어도 성능 수치와 무관하게 즉시 롤백·조사 대상입니다.

### 2) ingress 경계는 하나, 생성 규칙은 원천별로 둔다

HTTP ingress에서 request ID를 생성·검증하고 `ScopedValue`를 바인딩하는 filter를 하나 둡니다. gateway header를 받을 수는 있지만 길이·문자 집합·중복 여부를 제한하고 신뢰한 proxy에서 왔는지 확인해야 합니다. 내부 API, scheduler, message consumer도 같은 타입을 쓸 수 있지만 원천별 factory를 분리하는 편이 좋습니다. Queue job은 payload의 original request ID를 audit field로 보존하면서, consumer 실행 자체의 execution ID는 새로 발급해야 합니다.

이 규칙이 없으면 “어제의 웹 요청이 오늘의 worker 권한으로 실행됐다” 같은 모호한 로그가 생깁니다. durable 작업에는 original request ID와 current execution ID를 둘 다 남기되 뜻을 섞지 않는 것이 핵심입니다.

### 3) 테스트는 값의 존재보다 경계 이탈을 검증한다

단위 테스트에서 값 일치를 확인하는 것만으로는 부족합니다. 성공·예외·timeout 뒤 다음 요청에서 이전 tenant ID가 읽히지 않는지, 병렬 child가 correlation ID는 공유하되 mutable 상태는 공유하지 않는지, queue consumer가 새 execution ID를 만드는지 검사하세요. 외부 callback에는 allowlist 밖의 header가 나가지 않아야 하고, logging bridge가 실패해도 authorization 결과는 변하지 않아야 합니다.

[구조화된 로깅](/learning/deep-dive/deep-dive-structured-logging/)의 필드 계약을 assertion으로 쓰면, 대시보드에서 보기 좋은 로그와 실제 서비스 경계가 함께 유지됩니다.

## 트레이드오프/주의점

첫째, `ScopedValue`는 사용하는 JDK의 기능 상태와 Spring Boot 지원 범위를 확인해야 합니다. preview 기능 활성화가 필요한 환경이라면 production 기본값으로 올리지 마세요. 장기 지원 JDK를 고정한 팀은 `ThreadLocal`을 안전하게 감싼 context carrier와 명시적 parameter가 더 현실적일 수 있습니다.

둘째, 암묵적 읽기는 method signature를 깨끗하게 만들지만 숨은 의존성을 만듭니다. 특정 service가 tenant가 있어야만 동작한다면 public API에는 `TenantContext` 같은 명시적 요구를 남기고 scoped value는 편의 read로 제한하는 절충안이 좋습니다. fixture에서 값을 바인딩하지 않으면 실패하는 테스트가 늘어난다면 사용 범위가 넓어진 신호입니다.

셋째, 컨텍스트를 많이 전파할수록 개인정보·cardinality·로그 비용이 커집니다. user ID를 metric label에 직접 넣지 않고, request log에도 필요한 기간만 보존하세요.

## 체크리스트 또는 연습

- [ ] 읽기 전용 메타데이터와 가변 상태를 구분했다.
- [ ] token, session 객체, request/response, 큰 mutable 객체를 `ScopedValue`에 저장하지 않는다.
- [ ] HTTP, scheduler, queue consumer가 서로 다른 factory로 execution context를 만든다.
- [ ] 원본 요청 ID와 background 실행 ID의 의미를 로그 스키마에서 구분한다.
- [ ] 예외·timeout·취소 뒤 컨텍스트 누수와 tenant 불일치를 검증하는 테스트가 있다.
- [ ] JDK 기능 상태와 운영 런타임 지원 범위를 확인한 뒤 canary를 시작했다.

연습으로 현재 서비스의 `ThreadLocal` 하나를 골라 보세요. 그 값이 **누가 만들고, 누가 읽고, executor를 지나도 남아야 하는지, 요청이 끝난 뒤 누가 지워야 하는지**를 한 장에 적습니다. 네 질문 중 하나라도 답하기 어렵다면 그 값은 `ScopedValue`로 옮길 후보이거나, 반대로 명시적 parameter로 드러내야 할 숨은 의존성일 가능성이 큽니다.

## 관련 글

- [Java Virtual Threads, Spring MVC와 WebFlux 선택](/learning/deep-dive/deep-dive-java-virtual-threads-spring-mvc-webflux-playbook/)
- [ThreadLocal 컨텍스트 전파·정리](/learning/deep-dive/deep-dive-threadlocal-context-propagation-cleanup-playbook/)
- [End-to-End Deadline과 Cancellation](/learning/deep-dive/deep-dive-end-to-end-deadline-cancellation-playbook/)
- [구조화된 로깅](/learning/deep-dive/deep-dive-structured-logging/)
