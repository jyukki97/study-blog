---
title: "Spring MVC 요청 처리 흐름: Filter → DispatcherServlet → Interceptor → Controller"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["Spring", "MVC", "DispatcherServlet", "Filter", "Interceptor", "ExceptionHandling"]
categories: ["Backend Deep Dive"]
description: "요청이 들어와서 응답이 나가기까지: Filter/DispatcherServlet/Interceptor/예외 처리 흐름과 디버깅 포인트"
module: "spring-core"
study_order: 115
---

## 이 글에서 얻는 것

- Spring MVC에서 요청이 **어떤 순서**로 흘러가는지(필터 → 디스패처 → 컨트롤러 → 예외 처리)를 큰 그림으로 설명할 수 있습니다.
- Filter와 Interceptor의 차이를 “대충 비슷한 훅”이 아니라 **실행 위치/책임/사용 기준**으로 구분할 수 있습니다.
- 404/405/검증 실패/인증 실패 같은 문제를 만났을 때, “어느 계층에서 끊겼는지”를 빠르게 좁히는 방법을 얻습니다.
- 로그/트레이싱/인증 같은 횡단 관심사를 어디에 두면 좋은지(필터 vs 인터셉터 vs AOP) 감각이 생깁니다.

## 0) 전체 흐름(한 장 그림)

요청이 들어오면 대략 아래 순서로 흘러갑니다.

1) **서블릿 컨테이너(Tomcat)** 가 커넥션을 받아 요청을 만든다  
2) **Filter 체인**을 순서대로 통과한다(서블릿 레벨)  
3) `DispatcherServlet`이 요청을 받아 **핸들러(Controller)** 를 찾고 실행한다  
4) **Interceptor**가 컨트롤러 전후에 훅을 걸고, 예외/완료 시점에 정리한다  
5) 응답이 만들어지고, 다시 **Filter 체인**을 거쳐 클라이언트로 나간다  

핵심은 “컨트롤러만 실행되는 게 아니라”, 앞뒤에 여러 레이어가 있다는 점입니다.

## 1) Filter vs Interceptor: 어디에 무엇을 둘까

### Filter(서블릿 레벨)

- `DispatcherServlet` **밖**에서 동작합니다(컨테이너가 호출).
- 스프링 MVC뿐 아니라 “서블릿 요청”이면 전부 적용됩니다.
- 대표 용도: 요청/응답 로깅, 인코딩, CORS, 인증의 ‘입구’(특히 Spring Security), traceId/MDC 세팅

### Interceptor(스프링 MVC 레벨)

- `DispatcherServlet` **안**에서 동작합니다(스프링이 호출).
- “어떤 핸들러(컨트롤러 메서드)가 선택됐는지” 정보를 알 수 있습니다.
- 대표 용도: 인증/인가의 도메인 전처리, 요청 파라미터/헤더 검증, 컨트롤러 실행 시간 측정, 권한 체크(컨트롤러 기준)

실무 기준(짧게):

- “컨트롤러가 뭔지 몰라도 되는” 공통 기능 → Filter  
- “어떤 핸들러가 실행되는지”까지 봐야 하는 공통 기능 → Interceptor  

## 2) DispatcherServlet 안쪽에서 무슨 일이 일어나는가

`DispatcherServlet`은 사실상 “프론트 컨트롤러”입니다. 내부에서 크게 3가지를 합니다.

1) **HandlerMapping**: 어떤 컨트롤러가 이 요청을 처리할지 찾기  
2) **HandlerAdapter**: 찾은 핸들러(메서드)를 실제로 실행하기  
3) **결과를 응답으로 변환**: `@ResponseBody`면 메시지 컨버터(JSON 등)로 바디 작성, 아니면 뷰 리졸버로 렌더링

여기서 흔히 만나는 실패는 다음과 같습니다.

- `404`: 매핑되는 핸들러를 못 찾음(경로/메서드/컨트롤러 스캔 문제)
- `405`: 경로는 맞는데 메서드(GET/POST 등)가 안 맞음
- `400`: 바디 파싱 실패(`HttpMessageNotReadableException`), 타입 변환 실패 등
- `422/400`: 검증 실패(Bean Validation)

## 3) Interceptor 훅(언제 무엇을 하게 되나)

스프링 MVC 인터셉터는 보통 다음 3개를 제공합니다.

- `preHandle`: 컨트롤러 호출 “전” (권한/요청 검증, 시작 시간 저장)
- `postHandle`: 컨트롤러 호출 “후”, 뷰 렌더링 “전” (모델 조작 등)
- `afterCompletion`: 렌더링/예외 포함 “완료” 시점 (리소스 정리, MDC 정리)

주의: `afterCompletion`은 예외가 나도 호출됩니다. “무조건 정리해야 하는 것”을 여기에 둡니다.

## 4) 예외 처리는 어디에서 결정되는가

예외는 “던지면 끝”이 아니라, 누가 잡아서 어떤 응답으로 바꿀지가 중요합니다.

Spring MVC에서 컨트롤러 안쪽 예외는 보통 다음 경로로 처리됩니다.

- `@RestControllerAdvice` (또는 `@ControllerAdvice`)  
- `HandlerExceptionResolver` 체인  

그래서 “예외를 어디서 잡아야 하나?”의 기본 답은:

- 비즈니스 로직(Service)은 **의미 있는 예외를 던지고**  
- 컨트롤러 바깥(Advice)에서 **HTTP 응답으로 매핑**하는 구조가 보통 가장 단단합니다.

## 5) 디버깅 포인트(자주 터지는 곳)

- 404/405가 뜰 때: 컨트롤러 스캔, `@RequestMapping` 경로/메서드, 프록시(보안) 설정 확인
- 요청 바디 파싱이 실패할 때: Content-Type, JSON 형식, 메시지 컨버터 설정 확인
- “필터는 도는데 컨트롤러가 안 탄다”면: 필터에서 응답을 이미 써버렸거나, 보안 필터에서 차단됐을 가능성
- 응답이 느리다면: 컨트롤러 내부 블로킹 작업(외부 호출/DB)과 스레드풀 포화를 먼저 의심

## 연습(추천)

- Filter 1개 + Interceptor 1개를 만들어서, 요청 1번에 로그가 어떤 순서로 찍히는지 확인해보기
- `@RestControllerAdvice`로 예외를 `{code, message, traceId}` 형태로 매핑해보고, 400/404/500이 각각 어떻게 처리되는지 비교해보기

## 연결해서 읽기

- 검증/에러 응답 규약: `/learning/deep-dive/deep-dive-spring-validation-response/`
- Spring Security 필터 체인 감각: `/learning/deep-dive/deep-dive-spring-security/`
- MVC vs WebFlux(실행 모델 연결): `/learning/deep-dive/deep-dive-spring-webflux-vs-mvc/`
