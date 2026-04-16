---
title: "REST vs gRPC 성능 비교: 정말 gRPC가 좋을까?"
date: 2025-03-09
draft: false
tags: ["REST", "gRPC", "Kotlin", "성능테스트", "백엔드"]
categories: ["Development"]
description: "gRPC가 정말 REST보다 빠를까? 직접 성능 테스트를 통해 속도, 데이터 크기, CPU 사용량을 비교해보자."
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