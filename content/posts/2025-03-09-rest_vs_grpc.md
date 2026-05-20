---
title: "REST vs gRPC 성능 비교: 정말 gRPC가 좋을까?"
date: 2025-03-09
draft: false
tags: ["REST", "gRPC", "Kotlin", "성능테스트", "백엔드"]
categories: ["Development"]
description: "gRPC가 정말 REST보다 빠를까? 직접 성능 테스트를 통해 속도, 데이터 크기, CPU 사용량을 비교해보자."
summary: "이번 테스트에서는 gRPC가 REST보다 응답 속도와 페이로드 크기에서 유리했지만, CPU 사용량과 운영 복잡도까지 포함하면 항상 정답은 아닙니다. 내부 고빈도 호출, 타입 안정성, 스트리밍 요구가 크면 gRPC가 맞고, 외부 공개 API와 빠른 디버깅이 중요하면 REST가 여전히 현실적인 선택입니다."
keywords: ["rest vs grpc", "grpc 성능 비교", "rest api 성능", "grpc protobuf", "api 아키텍처 선택"]
key_takeaways:
  - "같은 머신의 단순 호출에서는 gRPC가 더 빠르고 페이로드도 작았지만, 그 차이만으로 전체 아키텍처를 결정하면 위험하다."
  - "내부 서비스 간 고빈도 호출, 스트리밍, 타입 안정성이 중요할수록 gRPC의 장점이 커진다."
  - "외부 공개 API, 브라우저 친화성, 빠른 디버깅이 중요하면 REST의 운영 편의성이 더 크다."
operator_checklist:
  - "성능 수치만 보지 말고 RTT, 재시도 정책, 연결 재사용, 직렬화 비용을 분리해 본다."
  - "외부 API와 내부 서비스 통신을 같은 기준으로 비교하지 않는다."
  - "Proto 관리, 코드 생성, 게이트웨이 운영 비용을 팀 역량과 함께 계산한다."
learning_refs:
  - title: "gRPC 서비스 설계"
    href: "/learning/deep-dive/deep-dive-grpc-service-design/"
    description: "gRPC를 실제 운영에 넣을 때 필요한 인터페이스 설계와 버전 전략을 더 깊게 정리한 글입니다."
  - title: "REST API 설계"
    href: "/learning/deep-dive/deep-dive-rest-api-design/"
    description: "REST를 유지할 때 어떤 설계 원칙과 운영 기준을 잡아야 하는지 같이 보면 판단이 더 선명해집니다."
  - title: "API 성능 면접 Q&A"
    href: "/learning/qna/api-performance-qna/"
    description: "성능 비교를 해석할 때 면접과 실무에서 자주 나오는 질문을 빠르게 점검할 수 있습니다."
faqs:
  - question: "단순 성능 테스트에서 gRPC가 빠르면 바로 전환해도 될까요?"
    answer: "아닙니다. 내부 호출량, 스트리밍 요구, 팀의 Proto 운영 역량, 외부 공개 API 비중까지 함께 봐야 합니다. 단순 벤치마크는 후보를 좁히는 자료일 뿐, 전환 결정 자체를 대신하지는 못합니다."
  - question: "브라우저 기반 서비스도 gRPC가 더 나은 선택인가요?"
    answer: "대부분의 브라우저 중심 서비스에서는 REST가 더 실용적입니다. 디버깅, 캐싱, 도구 생태계, 외부 파트너 연동 편의성 면에서 REST가 여전히 강합니다."
  - question: "gRPC의 핵심 장점은 결국 속도뿐인가요?"
    answer: "속도도 장점이지만 타입 안정성, 명확한 스키마 계약, 스트리밍, 내부 플랫폼 표준화 효과까지 같이 봐야 합니다. 반대로 이 장점을 조직이 활용하지 못하면 운영 복잡도만 늘어날 수 있습니다."
cover:
  image: "/images/grpc-vs-rest.png"
  alt: "gRPC vs REST 성능 비교"
  caption: "gRPC와 REST API 성능 비교 테스트"
---

## 들어가며

> gRPC는 REST보다 빠르다?
> 뭔가 지나가다 들었던 것 같은데 gRPC가 REST보다 성능이 좋다고 했던 것 같다.
> 단순한 API 호출에서 성능 차이가 있을까?
> 뭐.. 테스트 해보면 알겠지 확인해보자.

## 1차 테스트: 기본 성능 비교
### REST API 구현

```kotlin
@RestController
@RequestMapping("/api")
class RestTestController {

    @GetMapping("/hello")
    fun hello(): Mono<Map<String, String>> {
        return Mono.just(mapOf("message" to "Hello from REST"))
    }
}
```

### gRPC 구현

```proto
syntax = "proto3";

option java_multiple_files = true;
option java_package = "com.example.grpc";

service HelloService {
  rpc SayHello (HelloRequest) returns (HelloResponse);
}

message HelloRequest {
  string name = 1;
}

message HelloResponse {
  string message = 1;
}
```

```kotlin
@GrpcService
class HelloServiceImpl : HelloServiceGrpc.HelloServiceImplBase() {

    override fun sayHello(request: HelloRequest, responseObserver: StreamObserver<HelloResponse>) {
        val response = HelloResponse.newBuilder()
            .setMessage("Hello from gRPC, ${request.name}")
            .build()

        responseObserver.onNext(response)
        responseObserver.onCompleted()
    }
}
```

### 테스트 코드

성능 측정을 위한 테스트 코드를 작성했다:

```kotlin
class GrpcRestPerformanceTest {

    companion object {
        private lateinit var restClient: WebClient
        private lateinit var grpcStub: HelloServiceGrpc.HelloServiceBlockingStub

        @JvmStatic
        @BeforeAll
        fun setup() {
            restClient = WebClient.create("http://localhost:8080")

            val channel = ManagedChannelBuilder.forAddress("localhost", 9090)
                .usePlaintext()
                .build()

            grpcStub = HelloServiceGrpc.newBlockingStub(channel)
        }
    }

    @Test
    fun testRestVsGrpcPerformance() {
        val restTime = measureTimeMillis {
            repeat(1000) {
                restClient.get()
                    .uri("/api/test")
                    .retrieve()
                    .bodyToMono(String::class.java)
                    .block()
            }
        }

        val grpcTime = measureTimeMillis {
            repeat(1000) {
                grpcStub.sayHello(HelloRequest.newBuilder().setName("test").build())
            }
        }

        println("REST API 실행 시간: ${restTime}ms")
        println("gRPC 실행 시간: ${grpcTime}ms")
    }
}
```

### 1차 테스트 결과

```
REST API 실행 시간: 728ms
gRPC 실행 시간: 493ms
```

**결과 분석:**
- gRPC가 REST보다 약 **47% 더 빠른** 성능을 보였다
- 하지만 단순한 문자열 응답에서는 큰 차이를 체감하기 어려웠다
- 데이터 양이 너무 작아서 잘 안느껴지나? 좀 더 늘려보자

## 2차 테스트: 대용량 데이터 비교
### REST API (대용량 데이터)

1000개의 아이템을 포함한 응답을 생성하도록 수정했다:

```kotlin
@GetMapping("/hello-big")
fun helloBig(): Mono<Map<String, Any>> {
    return Mono.just(
        mapOf(
            "message" to "Hello from REST",
            "dataList" to List(1000) { "Item $it" } // 1000개 데이터 추가
        )
    )
}
```

### gRPC (대용량 데이터)

```proto
service HelloService {
  rpc SayHelloBig (HelloRequest) returns (HelloBigResponse);
}

message HelloBigResponse {
  string message = 1;
  repeated string dataList = 2;  // 데이터 추가
}
```

```kotlin
override fun sayHelloBig(request: HelloRequest, responseObserver: StreamObserver<HelloBigResponse>) {
    val response = HelloBigResponse.newBuilder()
        .setMessage("Hello from gRPC, ${request.name}")
        .addAllDataList(List(1000) { "Item $it" }) // 1000개 데이터 추가
        .build()

    responseObserver.onNext(response)
    responseObserver.onCompleted()
}
```

#### 테스트 코드

```kotlin
@Test
fun testRestVsGrpcPerformance2() {
    val restTime = measureTimeMillis {
        repeat(1000) {
            restClient.get()
                .uri("/api/hello-big")
                .retrieve()
                .bodyToMono(String::class.java)
                .block()
        }
    }

    val grpcTime = measureTimeMillis {
        repeat(1000) {
            grpcStub.sayHelloBig(HelloRequest.newBuilder().setName("test").build())
        }
    }

    println("REST API 실행 시간: ${restTime}ms")
    println("gRPC 실행 시간: ${grpcTime}ms")
}
```

### 2차 테스트 결과

```
REST API 실행 시간: 749ms
gRPC 실행 시간: 586ms
```

**흥미로운 발견:**
- gRPC가 여전히 **27% 더 빠르다**
  - 간단한 String 이라지만 리스트 1000개를 보낼일이 거의 없다는 거 생각하면, 속도 차이는 없다고 봐도 될지도?... (그냥 Streaming 용 인가??...)
  - 으음... 데이터가 늘었을 때, 속도차이가 줄었다.. 음.. 직렬화 비용이 gRPC 가 더 비싼가? cost 를 비교해볼까?..

## 리소스 사용량 분석

### 데이터 크기 비교

gRPC의 성능 우위가 데이터 크기 때문인지 확인해보자.

### 테스트 코드

데이터 크기를 측정하는 코드를 작성했다:

```kotlin
@Test
fun testApiNetworkUsage() {
    val requestJson = objectMapper.writeValueAsBytes(mapOf("name" to "test"))
    val restRequestSize = requestJson.size

    val restResponseSize = measureTimeMillis {
        val response = restClient.get()
            .uri("/api/hello-big")
            .retrieve()
            .bodyToMono(String::class.java)
            .block()
        response?.toByteArray()?.size ?: 0
    }

    val grpcRequestProto = HelloRequest.newBuilder().setName("test").build().toByteArray()
    val grpcRequestSize = grpcRequestProto.size

    val grpcResponseSize = measureTimeMillis {
        val response = grpcStub.sayHelloBig(HelloRequest.newBuilder().setName("test").build())
        response.toByteArray().size
    }

    println("REST 요청 크기: ${restRequestSize} bytes")
    println("REST 응답 크기: ${restResponseSize} bytes")

    println("gRPC 요청 크기: ${grpcRequestSize} bytes")
    println("gRPC 응답 크기: ${grpcResponseSize} bytes")
}
```

### 데이터 크기 비교 결과

```
REST 요청 크기: 15 bytes
REST 응답 크기: 135 bytes
gRPC 요청 크기: 6 bytes  
gRPC 응답 크기: 73 bytes
```

**분석:**
- gRPC가 요청 크기에서 **2.5배**, 응답 크기에서 **2배** 더 작다
  - HTTP/2 + Protobuf + 바이너리 직렬화의 효과가 확실히 나타났다
  - 네트워크 트래픽 절약 효과가 성능 향상의 주요 원인으로 보인다

### CPU 사용량 테스트

CPU 사용량도 함께 측정해봤다:

### 테스트 코드

```kotlin
private fun getProcessCpuLoad(): Double {
    val osBean = ManagementFactory.getOperatingSystemMXBean() as com.sun.management.OperatingSystemMXBean
    return osBean.processCpuLoad * 100
}

@Test
fun testRestApiCpuUsage() {
    val cpuBefore = getProcessCpuLoad()
    val timeTaken = measureTimeMillis {
        repeat(1000) {
            restClient.get()
                .uri("/api/hello-big")
                .retrieve()
                .bodyToMono(String::class.java)
                .block()
        }
    }
    val cpuAfter = getProcessCpuLoad()

    println("REST API 실행 시간: ${timeTaken}ms, CPU 사용량: ${cpuBefore}% → ${cpuAfter}%")
}

@Test
fun testGrpcCpuUsage() {
    val cpuBefore = getProcessCpuLoad()
    val timeTaken = measureTimeMillis {
        repeat(1000) {
            grpcStub.sayHelloBig(HelloRequest.newBuilder().setName("test").build())
        }
    }
    val cpuAfter = getProcessCpuLoad()

    println("gRPC 실행 시간: ${timeTaken}ms, CPU 사용량: ${cpuBefore}% → ${cpuAfter}%")
}
```


### CPU 사용량 테스트 결과

```
REST API 실행 시간: 565ms, CPU 사용량: 0.0% → 13.67%
gRPC 실행 시간: 463ms, CPU 사용량: 0.0% → 17.61%
```

**분석:**
- gRPC가 CPU를 **약 30% 더 많이** 사용한다
  - 데이터 직렬화와 압축 과정에서 추가적인 CPU 연산이 필요하다
  - 성능 향상의 대가로 CPU 리소스를 더 소모한다

![CPU 사용량 비교](/images/rest-grpc-post-cpu-usage.png)

## 이 테스트를 그대로 믿으면 안 되는 이유

여기까지 보면 "그럼 무조건 gRPC가 낫네?"라는 결론으로 가기 쉽다. 그런데 실제 서비스 의사결정은 이 정도 테스트만으로 내리면 위험하다. 이번 비교는 **같은 머신, 단순 요청/응답, 짧은 연결 경로**를 기준으로 했기 때문에 다음 변수들이 빠져 있다.

### 1) 브라우저와 외부 공개 API는 여전히 REST가 강하다

브라우저, 모바일 앱, 외부 파트너 연동처럼 사람이 직접 호출을 확인하거나 디버깅해야 하는 환경에서는 JSON/HTTP 기반 REST가 훨씬 다루기 쉽다. 요청을 눈으로 확인하기 쉽고, curl·Postman·브라우저 개발자도구 같은 생태계도 풍부하다. 내부 서비스 간 통신과 외부 공개 API를 같은 기준으로 비교하면 판단이 흐려진다.

### 2) 네트워크 거리와 직렬화 비용을 분리해서 봐야 한다

이번 실험에서는 gRPC가 더 작은 페이로드를 보내면서 유리했지만, 데이터 구조가 복잡해지거나 스트리밍/양방향 통신이 섞이면 해석이 달라질 수 있다. 반대로 네트워크 RTT가 큰 환경에서는 직렬화 차이보다 재시도 정책, 연결 재사용, 타임아웃 설정이 더 큰 영향을 줄 수도 있다. 즉 "gRPC가 몇 퍼센트 빠르다"보다 **어떤 병목을 줄였는가**를 봐야 한다.

### 3) 팀의 운영 편의성도 성능만큼 중요하다

Proto 관리, 코드 생성, 버전 호환, 게이트웨이 운영 비용까지 포함하면 gRPC는 분명 추가 학습 비용이 있다. 작은 팀이나 초기 제품에서는 이 비용이 생각보다 크게 느껴질 수 있다. 반대로 서비스 간 호출량이 많고 타입 안정성 이점이 중요한 조직이라면 이 비용이 금방 상쇄된다.

## 선택 전에 확인할 체크리스트

- 내부 서비스 간 고빈도 호출이 많은가?
- 응답 크기와 네트워크 비용이 병목인가?
- 팀이 Proto 스키마와 코드 생성 흐름을 관리할 준비가 되어 있는가?
- 외부 공개 API보다 내부 플랫폼 통신 비중이 더 큰가?
- 디버깅 편의성보다 타입 안정성과 성능 일관성이 더 중요한가?

이 질문에 대부분 "예"라면 gRPC 쪽으로 기울 가능성이 높다. 반대로 외부 연동, 빠른 실험, 단순 CRUD API가 중심이라면 REST가 여전히 훨씬 현실적인 선택이다. 비슷한 비교가 궁금하다면 [REST vs GraphQL](/posts/2025-03-15-2-rest-vs-graphql/) 글도 같이 보면 API 스타일 선택 기준을 더 입체적으로 볼 수 있다.

## 현업에서 더 유용한 선택 기준

숫자만 보면 gRPC 쪽으로 마음이 기울기 쉽지만, 실제로는 **요청 성격과 팀 운영 방식**을 같이 봐야 합니다. 아래처럼 케이스를 나눠 보면 판단이 조금 더 쉬워집니다.

| 상황 | 더 유리한 선택 | 이유 |
| --- | --- | --- |
| 브라우저, 모바일 앱, 외부 파트너가 직접 호출 | REST | 디버깅, 캐싱, 문서화, 도구 생태계가 훨씬 익숙하고 넓다 |
| 내부 마이크로서비스 간 고빈도 호출 | gRPC | 바이너리 직렬화, HTTP/2, 타입 계약 이점이 누적된다 |
| 서버 스트리밍, 양방향 스트리밍 필요 | gRPC | 연결 유지와 스트림 모델이 자연스럽다 |
| 빠른 프로토타이핑과 API 가시성 우선 | REST | curl, Postman, 브라우저에서 바로 검증 가능하다 |
| 여러 팀이 공유하는 플랫폼 표준 API | gRPC | Proto 스키마를 중심으로 계약을 강제하기 좋다 |

실무에서는 한 가지만 고집하기보다 **외부는 REST, 내부는 gRPC**처럼 혼합 전략을 쓰는 경우도 많습니다. 특히 BFF나 API Gateway를 두고 외부 요청은 REST로 받되, 내부 서비스 간 통신은 gRPC로 연결하는 구조는 꽤 현실적인 절충안입니다.

## 테스트를 다시 한다면 이렇게 보강하면 좋다

이번 글의 실험은 방향을 잡는 데는 충분했지만, 아키텍처 결정을 내리기에는 아직 빠진 변수가 있습니다. 다음 항목을 추가하면 해석력이 훨씬 좋아집니다.

### 1) 연결 재사용과 동시성 수준을 분리해서 측정하기

단일 요청 1000회 반복과, 동시 요청 50개 또는 100개 환경은 의미가 다릅니다. 특히 내부 서비스 통신은 피크 구간에서 연결 풀, 타임아웃, backpressure 설정이 결과를 크게 바꿉니다. 단건 latency뿐 아니라 **p95, p99, 에러율**도 같이 봐야 합니다.

### 2) 서버 CPU뿐 아니라 클라이언트 개발 비용도 같이 보기

gRPC는 Proto 정의, 코드 생성, 버전 관리, 게이트웨이 변환까지 고려해야 합니다. 속도 이득이 조금 있어도 팀이 이 흐름에 익숙하지 않으면 장애 대응 속도가 오히려 느려질 수 있습니다. 반대로 이미 사내 플랫폼이 Proto 중심이라면 그 비용은 거의 고정비처럼 작아집니다.

### 3) 페이로드 크기보다 병목 위치를 먼저 특정하기

네트워크가 병목인지, 직렬화가 병목인지, DB 응답이 병목인지 모른 채 REST와 gRPC만 바꾸면 기대한 개선이 안 나올 수 있습니다. API 레이어 최적화는 결국 전체 요청 경로 안에서 봐야 합니다. 예를 들어 DB 조회가 90%를 차지하는 요청이라면, 전송 포맷 변경보다 쿼리 최적화가 훨씬 큰 효과를 냅니다.

## 선택 전에 이 질문만은 꼭 해보자

1. 외부 공개 API인가, 내부 서비스 간 통신인가?  
2. 성능 병목이 네트워크/직렬화 쪽인지 이미 확인했는가?  
3. 팀이 Proto 계약과 코드 생성 파이프라인을 꾸준히 운영할 수 있는가?  
4. 장애가 났을 때 누가 어떻게 디버깅할지 이미 그려져 있는가?  
5. 하나로 통일해야 하는가, 아니면 외부와 내부를 분리한 혼합 전략이 더 나은가?

이 질문에 답하고 나면 "무조건 gRPC", "무조건 REST" 같은 결론은 대부분 사라집니다. 비슷한 판단 프레임이 더 궁금하면 [REST vs GraphQL](/posts/2025-03-15-2-rest-vs-graphql/)과 [gRPC vs REST vs GraphQL](/posts/2025-03-15-1-grpc-vs-rest-vs-graphql/)도 같이 읽어보면 좋습니다.

## 최종 결론

### 성능 비교 요약

| 항목 | REST | gRPC | 차이점 |
|------|------|------|--------|
| **응답 속도** | 749ms | 586ms | gRPC가 **30% 더 빠름** |
| **요청 데이터 크기** | 15 bytes | 6 bytes | gRPC가 **2.5배 더 작음** |
| **응답 데이터 크기** | 135 bytes | 73 bytes | gRPC가 **2배 더 작음** |
| **CPU 사용량** | 13.6% | 17.6% | gRPC가 **30% 더 많이 사용** |

### 언제 gRPC를 사용해야 할까?

**gRPC가 유리한 경우:**
- 마이크로서비스 간 내부 통신
- 높은 처리량이 필요한 시스템
- 네트워크 대역폭이 제한적인 환경
- 타입 안정성이 중요한 경우

**REST가 유리한 경우:**
- 웹 브라우저와의 직접 통신
- 개발 및 디버깅 편의성이 중요한 경우
- CPU 리소스가 제한적인 환경
- 빠른 프로토타이핑이 필요한 경우

### 마무리

테스트 결과, gRPC는 확실히 성능상 이점이 있지만 **CPU 리소스를 더 많이 소모**한다는 트레이드오프가 있다. 

서버 간 통신에서 네트워크 효율성과 성능이 중요하다면 gRPC를 고려해볼 만하지만, 모든 상황에서 좋은건 아니라는 점을 기억하자.