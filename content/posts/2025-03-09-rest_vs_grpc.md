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