---
title: "Circuit Breaker 패턴: 장애 전파를 끊는 두꺼비집"
date: 2025-11-08
draft: false
topic: "Spring"
tags: ["Circuit Breaker", "Resilience4j", "Fault Tolerance", "Microservices"]
categories: ["Backend Deep Dive"]
description: "외부 API/DB 장애가 내 서비스까지 번지지 않게 막는 Resilience4j 패턴과 설정값 가이드"
module: "resilience"
quizzes:
  - question: "Circuit Breaker 패턴의 주요 목적은?"
    options:
      - "성능을 향상시킨다."
      - "외부 서비스 장애가 호출하는 서비스로 전파되어 전체 시스템이 다운되는 것(Cascade Failure)을 방지한다."
      - "보안을 강화한다."
      - "로그를 수집한다."
    answer: 1
    explanation: "B 서비스가 죽었을 때, A 서비스가 계속 호출하면 A도 느려지다 죽습니다(스레드 풀 고갈). Circuit Breaker는 장애를 감지하면 호출을 차단(Fail Fast)하여 A 서비스를 보호합니다."

  - question: "Circuit Breaker의 세 가지 상태(CLOSED, OPEN, HALF_OPEN)에서 OPEN 상태의 동작은?"
    options:
      - "정상적으로 요청을 전달한다."
      - "외부 서비스를 호출하지 않고 즉시 예외(CallNotPermittedException)를 반환한다(Fail Fast)."
      - "요청을 캐싱한다."
      - "재시도를 무한 반복한다."
    answer: 1
    explanation: "OPEN 상태에서는 외부 호출 없이 즉시 실패를 반환합니다. 이로써 장애 서비스에 대기하지 않아 스레드 풀이 고갈되는 것을 방지하고, 장애 서비스에 추가 부하를 주지 않습니다."

  - question: "HALF_OPEN 상태에서 Circuit Breaker의 동작은?"
    options:
      - "모든 요청을 차단한다."
      - "지정된 수의 시험 호출을 허용하고, 결과에 따라 CLOSED(회복) 또는 OPEN(재차단)으로 전환한다."
      - "무한정 대기한다."
      - "Fallback만 실행한다."
    answer: 1
    explanation: "HALF_OPEN은 장애가 회복되었는지 확인하는 상태입니다. 몇 개의 요청을 보내보고 성공하면 CLOSED로 돌아가고, 실패하면 다시 OPEN으로 차단합니다."

  - question: "Resilience4j에서 `slidingWindowSize`와 `failureRateThreshold` 설정의 의미는?"
    options:
      - "DB 연결 수와 타임아웃"
      - "최근 N개(slidingWindowSize) 요청 중 실패율이 X%(failureRateThreshold)를 초과하면 OPEN 상태로 전환"
      - "재시도 횟수와 간격"
      - "스레드 풀 크기와 대기 시간"
    answer: 1
    explanation: "예: slidingWindowSize=100, failureRateThreshold=50이면 최근 100개 요청 중 50% 이상 실패하면 Circuit이 열립니다. 이를 통해 '일시적 오류'와 '지속적 장애'를 구분합니다."

  - question: "Circuit Breaker에서 Fallback 메서드가 필요한 이유는?"
    options:
      - "성능을 측정하기 위해"
      - "회로가 열렸을 때(호출 차단 시) 클라이언트에게 에러 대신 기본값이나 캐시된 데이터 등 대안 응답을 제공하기 위해"
      - "로그를 기록하기 위해"
      - "재시도를 위해"
    answer: 1
    explanation: "OPEN 상태에서 단순히 예외만 던지면 사용자 경험이 나빠집니다. Fallback으로 '잠시 점검 중입니다' 메시지나 캐시된 데이터를 반환하여 서비스 품질을 유지합니다."
study_order: 500
---

## 🔌 1. 왜 "두꺼비집"이라고 부를까?

집에 누전이 되면 전체 정전을 막기 위해 두꺼비집(배선 차단기)이 내려갑니다.
MSA에서도 마찬가지입니다. **B 서비스가 죽었을 때, 이를 호출하는 A 서비스까지 같이 느려지다 죽는 것(Cascade Failure)** 을 막기 위해 회로를 끊어버립니다.

### 1-1. 장애 전파 시나리오

```mermaid
sequenceDiagram
    participant Client
    participant CB as CircuitBreaker
    participant Service

    Client->>CB: Request 1
    CB->>Service: Call
    Note right of Service: Timeout! (5s)
    Service--xCB: Failure
    CB--xClient: TimeoutException

    Client->>CB: Request 2 ... N
    CB->>Service: Call
    Service--xCB: Failure (x N times)

    Note over CB: Failure Rate > Threshold
    Note over CB: State: CLOSED -> OPEN

    Client->>CB: Request N+1
    CB--xClient: CallNotPermittedException (Fail Fast)
    Note right of Client: No waiting, instant fail
```

---

## 🚦 2. 상태 기계 (State Machine)

서킷 브레이커는 3가지 상태를 오가며 시스템을 보호합니다.

```mermaid
stateDiagram-v2
    [*] --> CLOSED: 초기 상태 (정상)
    
    CLOSED --> OPEN: 실패율 임계치 초과 (차단)
    note right of OPEN: 즉시 에러 반환 (Fail Fast)
    
    OPEN --> HALF_OPEN: 대기 시간 경과 (간 보기)
    
    HALF_OPEN --> CLOSED: 시험 호출 성공
    HALF_OPEN --> OPEN: 시험 호출 실패
```

1. **CLOSED (닫힘)**: 정상. 전기가 잘 통함. (트래픽 통과)
2. **OPEN (열림)**: 차단됨. 전기가 안 통함. (호출 즉시 차단 예외 발생)
3. **HALF_OPEN (반 열림)**: "이제 좀 괜찮나?" 하고 몇 개만 살짝 보내봄. 성공하면 닫고, 실패하면 다시 엽니다.

---

## 🛡️ 3. Resilience4j 실전 설정

"실패가 몇 번 나면 끊을래?"를 결정하는 것이 핵심입니다.

```yaml
resilience4j:
  circuitbreaker:
    instances:
      myService:
        failureRateThreshold: 50        # 50% 실패하면 Open
        slidingWindowSize: 100          # 최근 100개 요청 기준
        minimumNumberOfCalls: 10        # 최소 10개는 표본이 쌓여야 함
        waitDurationInOpenState: 10s    # 10초 동안 차단 유지 후 Half-Open
        waitDurationInOpenState: 10s    # 10초 동안 차단 유지 후 Half-Open
        permittedNumberOfCallsInHalfOpenState: 3 # Half-Open 때 3개만 보내봄
```

### 3-2. Sliding Window (집계 방식)

최근 N개의 요청을 저장하고, 그 중 실패 비율을 계산합니다.

```mermaid
graph LR
    subgraph "Sliding Window (Size 10)"
    direction LR
    R1[OK] --- R2[OK] --- R3[Fail] --- R4[OK] --- R5[Fail] --- R6[Fail] --- R7[OK] -.- R10[New Request]
    end
    
    style R3 fill:#ffcdd2,stroke:#c62828
    style R5 fill:#ffcdd2,stroke:#c62828
    style R6 fill:#ffcdd2,stroke:#c62828
    style R10 fill:#fff9c4,stroke:#fbc02d
```

### Fallback (대안)

차단되었을 때 클라이언트에게 "에러"만 던지면 안 되겠죠?
**Fallback** 메소드를 통해 "기본값"이라도 줘야 합니다.

```java
@CircuitBreaker(name = "myService", fallbackMethod = "fallbackHello")
public String callExternalServer() {
    return restTemplate.getForObject("/api/hello", String.class);
}

// 🚧 장애 시 실행될 메소드
public String fallbackHello(Throwable t) {
    log.error("외부 서버 죽음: {}", t.getMessage());
    return "잠시 점검 중입니다. (기본 응답)";
}
```

---

## ⚠️ 4. 주의사항: "Thread Pool Hell"

서킷 브레이커 없이 `Timeout`만 걸면 어떻게 될까요?
응답이 30초 걸리는 장애 서버에 요청이 몰리면, 내 서버의 스레드 풀(Thread Pool)이 대기하느라 꽉 차버립니다. (Bulkhead 패턴이 필요한 이유)

서킷 브레이커는 **"아예 요청을 안 보내고(Fail Fast)"** 스레드를 즉시 반환하게 하여 내 서버를 살립니다.

## 요약

1. **목적**: 장애 전파 방지 (나라도 살자).
2. **상태**: Normal(Closed) -> Error(Open) -> Test(Half-Open).
3. **Fallback**: 안 될 때 줄 수 있는 '차선책'을 준비해라.
4. **설정**: 너무 빨리 열리면 민감하고, 너무 늦게 열리면 장애가 전파된다.
