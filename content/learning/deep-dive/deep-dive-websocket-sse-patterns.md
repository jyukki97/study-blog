---
title: "실시간 통신: WebSocket vs SSE vs Webhook"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["WebSocket", "SSE", "Webhook", "Realtime", "Spring Boot", "STOMP"]
categories: ["Backend Deep Dive"]
description: "실시간/준실시간 요구에 따라 WebSocket, SSE, Webhook을 선택하는 기준과 설계 패턴 — Spring Boot 구현 코드, 스케일 아웃 전략, 운영 체크리스트 포함"
module: "architecture"
study_order: 475
---

## 이 글에서 얻는 것

- WebSocket/SSE/Webhook(그리고 Long Polling)을 "유행"이 아니라 **요구사항(방향/지연/규모/신뢰성)**으로 선택할 수 있습니다.
- 실시간 시스템에서 가장 어려운 문제(연결 관리, 재연결, 순서/중복, 백프레셔, 스케일 아웃)를 **코드 레벨**에서 풀 수 있습니다.
- Webhook을 안전하게 운영하기 위한 서명 검증/재시도/멱등성 기준을 정리할 수 있습니다.

---

## 0) 먼저 "실시간"의 정의를 정하라

실시간은 한 가지가 아닙니다.

- **즉시성**: 100ms가 필요한가, 2~3초여도 되는가?
- **방향**: 서버→클라이언트만이면 되는가, 양방향이 필요한가?
- **신뢰성**: 유실이 0이어야 하나(정산/결제), 몇 개 유실은 허용 가능한가(알림)?

이 세 가지가 프로토콜 선택을 거의 결정합니다.

---

## 1) 프로토콜 선택 매트릭스

### 1-1) 비교표

| 기준 | WebSocket | SSE | Webhook | Long Polling |
|------|-----------|-----|---------|-------------|
| 방향 | **양방향** | 서버→클라이언트 | 서버→서버 | 서버→클라이언트 |
| 프로토콜 | ws:// (HTTP Upgrade) | HTTP/1.1+ | HTTP POST | HTTP |
| 지연 | ~ms | ~ms | 초~분 | 초 |
| 브라우저 지원 | ✅ 전 브라우저 | ✅ (IE 제외) | N/A | ✅ |
| 자동 재연결 | ❌ 직접 구현 | ✅ 내장 | N/A | ❌ 직접 구현 |
| 프록시/CDN 호환 | ⚠️ 설정 필요 | ✅ HTTP 기반 | ✅ | ✅ |
| 연결당 리소스 | 높음 | 중간 | 없음 | 높음 |
| 스케일 아웃 난이도 | **높음** | 중간 | 낮음 | 높음 |

### 1-2) 결정 트리

```
"실시간 통신이 필요하다"
 ├─ 양방향? (채팅/게임/협업)
 │   └─ YES → WebSocket
 │       └─ HTTP 호환 필요? → Socket.IO (폴백 포함)
 ├─ 서버→클라이언트만? (알림/피드/대시보드)
 │   └─ YES → SSE
 │       └─ IE 지원 필요? → Long Polling (폴백)
 └─ 서버→서버? (외부 연동/결제/배송)
     └─ YES → Webhook
         └─ 순서 보장 필요? → 메시지 큐 + Webhook 조합
```

---

## 2) WebSocket 심화 — Spring Boot + STOMP 구현

### 2-1) 기본 설정

```java
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        // 외부 브로커(Redis)로 스케일 아웃 지원
        config.enableStompBrokerRelay("/topic", "/queue")
            .setRelayHost("localhost")
            .setRelayPort(61613)       // RabbitMQ STOMP 포트
            .setClientLogin("guest")
            .setClientPasscode("guest")
            .setSystemHeartbeatSendInterval(10000)
            .setSystemHeartbeatReceiveInterval(10000);

        config.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
            .setAllowedOriginPatterns("*")
            .withSockJS();  // SockJS 폴백
    }
}
```

### 2-2) 메시지 핸들러 — 채팅 예시

```java
@Controller
@RequiredArgsConstructor
@Slf4j
public class ChatController {
    private final SimpMessagingTemplate messagingTemplate;
    private final ChatMessageRepository messageRepo;

    @MessageMapping("/chat.send")
    public void sendMessage(@Payload ChatMessage message,
                            SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        message.setTimestamp(Instant.now());
        message.setMessageId(UUID.randomUUID().toString());

        // 영속화 (메시지 유실 방지)
        messageRepo.save(message);

        // 룸 구독자에게 브로드캐스트
        messagingTemplate.convertAndSend(
            "/topic/chat.room." + message.getRoomId(), message);

        log.debug("메시지 전송: room={}, from={}, id={}",
            message.getRoomId(), message.getSender(), message.getMessageId());
    }

    @MessageMapping("/chat.join")
    public void joinRoom(@Payload JoinRequest request,
                         SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        headerAccessor.getSessionAttributes().put("username", request.getUsername());
        headerAccessor.getSessionAttributes().put("roomId", request.getRoomId());

        ChatMessage notification = ChatMessage.builder()
            .type(MessageType.JOIN)
            .sender(request.getUsername())
            .roomId(request.getRoomId())
            .content(request.getUsername() + "님이 입장했습니다.")
            .timestamp(Instant.now())
            .build();

        messagingTemplate.convertAndSend(
            "/topic/chat.room." + request.getRoomId(), notification);
    }
}
```

### 2-3) 연결 이벤트 처리 & 하트비트

```java
@Component
@RequiredArgsConstructor
@Slf4j
public class WebSocketEventListener {
    private final SimpMessagingTemplate messagingTemplate;
    private final ConnectionRegistry connectionRegistry;

    @EventListener
    public void handleConnect(SessionConnectedEvent event) {
        String sessionId = event.getMessage().getHeaders()
            .get(SimpMessageHeaderAccessor.SESSION_ID_HEADER, String.class);
        connectionRegistry.register(sessionId);
        log.info("WebSocket 연결: sessionId={}", sessionId);
    }

    @EventListener
    public void handleDisconnect(SessionDisconnectEvent event) {
        String sessionId = event.getSessionId();
        ConnectionInfo info = connectionRegistry.remove(sessionId);

        if (info != null && info.getRoomId() != null) {
            ChatMessage leave = ChatMessage.builder()
                .type(MessageType.LEAVE)
                .sender(info.getUsername())
                .roomId(info.getRoomId())
                .content(info.getUsername() + "님이 퇴장했습니다.")
                .timestamp(Instant.now())
                .build();
            messagingTemplate.convertAndSend(
                "/topic/chat.room." + info.getRoomId(), leave);
        }
        log.info("WebSocket 해제: sessionId={}, reason={}",
            sessionId, event.getCloseStatus());
    }
}
```

### 2-4) 인증 — 장기 연결에서 토큰 갱신

```java
@Configuration
public class WebSocketSecurityConfig {

    /**
     * CONNECT 시점에 JWT 검증
     */
    @Bean
    public ChannelInterceptor authInterceptor(JwtTokenProvider tokenProvider) {
        return new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                StompHeaderAccessor accessor =
                    StompHeaderAccessor.wrap(message);

                if (StompCommand.CONNECT.equals(accessor.getCommand())) {
                    String token = accessor.getFirstNativeHeader("Authorization");
                    if (token == null || !token.startsWith("Bearer ")) {
                        throw new MessagingException("인증 토큰 필요");
                    }
                    String jwt = token.substring(7);
                    if (!tokenProvider.validate(jwt)) {
                        throw new MessagingException("토큰 만료/무효");
                    }
                    String userId = tokenProvider.getUserId(jwt);
                    accessor.getSessionAttributes().put("userId", userId);
                }
                return message;
            }
        };
    }
}
```

**토큰 갱신 전략**:
- 클라이언트가 토큰 만료 전에 `DISCONNECT → CONNECT`로 재연결
- 또는 커스텀 STOMP 메시지(`/app/auth.refresh`)로 토큰 갱신
- 서버 측: 인증 실패 시 `ERROR` 프레임 + 연결 종료

---

## 3) SSE(Server-Sent Events) — Spring WebFlux 구현

### 3-1) 기본 SSE 엔드포인트

```java
@RestController
@RequestMapping("/api/notifications")
@RequiredArgsConstructor
public class NotificationSseController {
    private final NotificationService notificationService;

    /**
     * SSE 스트림 — 무한 Flux + heartbeat
     */
    @GetMapping(produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<NotificationDto>> stream(
            @RequestParam String userId,
            @RequestHeader(value = "Last-Event-ID", required = false) String lastEventId) {

        // 1) 놓친 이벤트 복구 (Last-Event-ID 기반)
        Flux<ServerSentEvent<NotificationDto>> missed = Flux.empty();
        if (lastEventId != null) {
            missed = notificationService.getAfter(userId, lastEventId)
                .map(this::toSse);
        }

        // 2) 실시간 이벤트 스트림
        Flux<ServerSentEvent<NotificationDto>> live =
            notificationService.subscribe(userId)
                .map(this::toSse);

        // 3) 하트비트 (30초마다 빈 이벤트 → 연결 유지)
        Flux<ServerSentEvent<NotificationDto>> heartbeat =
            Flux.interval(Duration.ofSeconds(30))
                .map(tick -> ServerSentEvent.<NotificationDto>builder()
                    .comment("heartbeat")
                    .build());

        return Flux.concat(missed, Flux.merge(live, heartbeat))
            .doOnCancel(() -> notificationService.unsubscribe(userId));
    }

    private ServerSentEvent<NotificationDto> toSse(NotificationDto dto) {
        return ServerSentEvent.<NotificationDto>builder()
            .id(dto.getId())                    // Last-Event-ID로 사용
            .event(dto.getType())               // 이벤트 타입
            .data(dto)                          // JSON 페이로드
            .retry(Duration.ofSeconds(5))        // 재연결 간격 힌트
            .build();
    }
}
```

### 3-2) Sink 기반 발행 — Redis Pub/Sub 연동

```java
@Service
@Slf4j
public class NotificationService {
    // userId → Sinks.Many (SSE 구독자)
    private final ConcurrentMap<String, Sinks.Many<NotificationDto>> sinks
        = new ConcurrentHashMap<>();
    private final NotificationRepository notificationRepo;

    public Flux<NotificationDto> subscribe(String userId) {
        Sinks.Many<NotificationDto> sink = sinks.computeIfAbsent(userId,
            k -> Sinks.many().multicast().onBackpressureBuffer(256));
        return sink.asFlux();
    }

    public void unsubscribe(String userId) {
        Sinks.Many<NotificationDto> sink = sinks.remove(userId);
        if (sink != null) sink.tryEmitComplete();
    }

    /**
     * 알림 발행 — DB 저장 + SSE 푸시
     */
    public void publish(String userId, NotificationDto notification) {
        // 영속화 (재연결 시 Last-Event-ID로 복구 가능)
        notificationRepo.save(notification);

        Sinks.Many<NotificationDto> sink = sinks.get(userId);
        if (sink != null) {
            Sinks.EmitResult result = sink.tryEmitNext(notification);
            if (result.isFailure()) {
                log.warn("SSE 발행 실패: userId={}, result={}", userId, result);
            }
        }
    }

    public Flux<NotificationDto> getAfter(String userId, String lastEventId) {
        return notificationRepo.findByUserIdAndIdGreaterThan(userId, lastEventId);
    }
}
```

### 3-3) SSE vs WebSocket — 세부 비교

| 상황 | 권장 | 이유 |
|------|------|------|
| 알림/피드 (서버→클라이언트) | **SSE** | 자동 재연결, HTTP 호환, 구현 단순 |
| 채팅/게임 (양방향) | **WebSocket** | 양방향 필수 |
| 대시보드 실시간 차트 | **SSE** | 단방향 충분, 프록시 친화 |
| 파일 업로드 진행률 | **SSE** | 서버→클라이언트 진행률 푸시 |
| 협업 편집 (Google Docs류) | **WebSocket** | 양방향 + 저지연 필수 |

---

## 4) Webhook 설계 — 운영 수준 구현

### 4-1) 발행자 측 — 서명 + 재시도 + DLQ

```java
@Service
@RequiredArgsConstructor
@Slf4j
public class WebhookDispatcher {
    private final WebClient webClient;
    private final WebhookEndpointRepository endpointRepo;
    private final WebhookDeliveryLogRepository deliveryLog;

    private static final int MAX_RETRY = 5;
    private static final Duration[] BACKOFF = {
        Duration.ofSeconds(1),   // 1차
        Duration.ofSeconds(5),   // 2차
        Duration.ofSeconds(30),  // 3차
        Duration.ofMinutes(5),   // 4차
        Duration.ofMinutes(30),  // 5차
    };

    /**
     * Webhook 전송 — HMAC-SHA256 서명 + 지수 백오프 재시도
     */
    public Mono<Void> dispatch(String eventType, Object payload) {
        String payloadJson = toJson(payload);
        String deliveryId = UUID.randomUUID().toString();

        return endpointRepo.findByEventType(eventType)
            .flatMap(endpoint -> {
                String signature = hmacSha256(endpoint.getSecret(), payloadJson);

                return webClient.post()
                    .uri(endpoint.getUrl())
                    .header("Content-Type", "application/json")
                    .header("X-Webhook-Id", deliveryId)
                    .header("X-Webhook-Signature", "sha256=" + signature)
                    .header("X-Webhook-Timestamp", Instant.now().toString())
                    .bodyValue(payloadJson)
                    .retrieve()
                    .toBodilessEntity()
                    .timeout(Duration.ofSeconds(5))
                    .retryWhen(Retry.fixedDelay(MAX_RETRY, Duration.ofSeconds(1))
                        .filter(ex -> isRetryable(ex)))
                    .doOnSuccess(resp ->
                        deliveryLog.save(DeliveryLog.success(deliveryId, endpoint)))
                    .doOnError(ex ->
                        deliveryLog.save(DeliveryLog.failure(deliveryId, endpoint, ex)))
                    .then();
            })
            .then();
    }

    /**
     * HMAC-SHA256 서명 생성
     */
    private String hmacSha256(String secret, String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(UTF_8), "HmacSHA256"));
            byte[] hash = mac.doFinal(payload.getBytes(UTF_8));
            return Hex.encodeHexString(hash);
        } catch (Exception e) {
            throw new RuntimeException("HMAC 생성 실패", e);
        }
    }

    private boolean isRetryable(Throwable ex) {
        if (ex instanceof WebClientResponseException wcre) {
            int status = wcre.getStatusCode().value();
            return status >= 500 || status == 429;
        }
        return ex instanceof java.net.ConnectException
            || ex instanceof java.util.concurrent.TimeoutException;
    }
}
```

### 4-2) 수신자 측 — 서명 검증 + 멱등성

```java
@RestController
@RequestMapping("/webhooks")
@RequiredArgsConstructor
@Slf4j
public class WebhookReceiverController {
    private final StringRedisTemplate redis;
    private final WebhookProcessingService processingService;

    @Value("${webhook.secret}")
    private String webhookSecret;

    @PostMapping("/payment")
    public ResponseEntity<String> receivePaymentWebhook(
            @RequestBody String payload,
            @RequestHeader("X-Webhook-Id") String webhookId,
            @RequestHeader("X-Webhook-Signature") String signature,
            @RequestHeader("X-Webhook-Timestamp") String timestamp) {

        // 1) 타임스탬프 검증 (5분 이내만 허용 → Replay 방어)
        Instant ts = Instant.parse(timestamp);
        if (Duration.between(ts, Instant.now()).abs().toMinutes() > 5) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body("TIMESTAMP_EXPIRED");
        }

        // 2) HMAC 서명 검증
        String expected = "sha256=" + hmacSha256(webhookSecret, payload);
        if (!MessageDigest.isEqual(expected.getBytes(), signature.getBytes())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body("INVALID_SIGNATURE");
        }

        // 3) 멱등성 체크 (같은 webhook-id는 한 번만 처리)
        Boolean isNew = redis.opsForValue()
            .setIfAbsent("webhook:processed:" + webhookId, "1",
                Duration.ofHours(48));
        if (Boolean.FALSE.equals(isNew)) {
            // 이미 처리됨 → 2xx 반환 (발행자가 재시도 안 하도록)
            return ResponseEntity.ok("ALREADY_PROCESSED");
        }

        // 4) 빠르게 2xx 반환 후 비동기 처리
        processingService.processAsync(payload);
        return ResponseEntity.ok("ACCEPTED");
    }
}
```

### 4-3) Webhook 운영 대시보드 메트릭

```yaml
# 권장 모니터링 항목
- 전송 성공률: success_count / total_count (목표 > 99%)
- 평균 지연: 전송 시작 → 2xx 수신 시간
- 재시도율: retry_count / total_count (높으면 수신자 장애)
- DLQ 건수: 최대 재시도 초과 건수 (0이 목표)
- 엔드포인트별 실패율: 특정 수신자만 실패하는지
```

---

## 5) 스케일 아웃 전략

### 5-1) WebSocket — Redis Pub/Sub 기반 팬아웃

```
[클라이언트] ←→ [Server A] ←→ [Redis Pub/Sub] ←→ [Server B] ←→ [클라이언트]
                              (메시지 브릿지)
```

- Spring의 `enableStompBrokerRelay()`로 RabbitMQ/ActiveMQ 사용
- 또는 Redis Pub/Sub으로 서버 간 메시지 동기화

```java
// Redis Pub/Sub 기반 크로스 서버 브로드캐스트
@Component
@RequiredArgsConstructor
public class RedisCrossServerRelay {
    private final RedisTemplate<String, String> redis;
    private final SimpMessagingTemplate messagingTemplate;

    // 메시지 수신 시 → Redis 채널에 발행
    public void broadcastToCluster(String roomId, ChatMessage message) {
        redis.convertAndSend("chat:room:" + roomId, toJson(message));
    }

    // Redis 채널 구독 → 로컬 WebSocket 클라이언트에게 전달
    @Bean
    public RedisMessageListenerContainer messageListenerContainer(
            RedisConnectionFactory factory) {
        var container = new RedisMessageListenerContainer();
        container.setConnectionFactory(factory);
        container.addMessageListener((message, pattern) -> {
            String channel = new String(message.getChannel());
            String roomId = channel.replace("chat:room:", "");
            ChatMessage chatMessage = fromJson(new String(message.getBody()));
            messagingTemplate.convertAndSend(
                "/topic/chat.room." + roomId, chatMessage);
        }, new PatternTopic("chat:room:*"));
        return container;
    }
}
```

### 5-2) SSE — Reactive + Redis Streams

```
[Producer] → [Redis Streams] → [Server A: SSE] → [클라이언트]
                              → [Server B: SSE] → [클라이언트]
```

각 서버가 Redis Streams Consumer Group으로 이벤트를 소비하고,
해당 서버에 연결된 SSE 클라이언트에게 푸시합니다.

### 5-3) 커넥션 수 산정

```
필요 서버 수 = 최대 동시 접속 × 연결당 메모리 / 서버당 가용 메모리

예시:
- 동시 접속 10만
- WebSocket 연결당 ~50KB
- 서버 메모리 8GB, 50% 할당
→ 10만 × 50KB = 5GB → 최소 2대 (여유 포함 3~4대)
```

---

## 6) 백프레셔: 느린 소비자가 전체를 망치지 않게

실시간 시스템에서 가장 흔한 장애:
일부 클라이언트가 느리다 → 서버 버퍼가 쌓인다 → 메모리/스레드 고갈

### 6-1) 대응 패턴

| 패턴 | 구현 | 적용 시점 |
|------|------|----------|
| 버퍼 제한 | `onBackpressureBuffer(256)` | SSE Flux |
| 최신만 유지 | `onBackpressureLatest()` | 상태 업데이트(주가/센서) |
| 드롭 | `onBackpressureDrop()` | 유실 허용 (로그/메트릭) |
| 연결 종료 | per-connection 큐 > 임계값 → close | WebSocket |
| 코얼레싱 | 같은 키의 이벤트를 병합 | 대시보드/차트 |

### 6-2) WebSocket 버퍼 제한 설정

```java
@Configuration
public class WebSocketTransportConfig implements WebSocketMessageBrokerConfigurer {
    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        registration
            .setSendBufferSizeLimit(512 * 1024)      // 512KB
            .setSendTimeLimit(20_000)                  // 20초
            .setMessageSizeLimit(128 * 1024);          // 메시지 최대 128KB
    }
}
```

---

## 7) 연결 관리: 하트비트와 재연결

### 7-1) 클라이언트 재연결 전략 (JavaScript)

```javascript
class ResilientWebSocket {
  constructor(url) {
    this.url = url;
    this.reconnectAttempt = 0;
    this.maxReconnect = 10;
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      console.log('Connected');
      this.reconnectAttempt = 0;     // 성공 시 카운터 리셋
      this.startHeartbeat();
    };
    this.ws.onclose = (event) => {
      this.stopHeartbeat();
      if (this.reconnectAttempt < this.maxReconnect) {
        // 지수 백오프 + 지터
        const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 30000)
                    + Math.random() * 1000;
        this.reconnectAttempt++;
        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
        setTimeout(() => this.connect(), delay);
      }
    };
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);   // 25초마다 ping
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
  }
}
```

### 7-2) Reconnect Storm 방어

대규모 서버 재시작 시 모든 클라이언트가 동시에 재연결 → **연결 폭풍**

방어:
- 클라이언트: 지수 백오프 + **랜덤 지터** (위 코드 참고)
- 서버: 연결 수락 속도 제한 (`RateLimiter` on connect)
- LB: 점진적 서버 등록 (rolling restart)

---

## 8) 프로토콜별 운영 체크리스트

### WebSocket

- [ ] 하트비트 간격 설정 (서버/클라이언트 양쪽)
- [ ] 재연결 로직 + 지수 백오프 + 지터
- [ ] 인증 토큰 갱신 전략 (만료 전 재연결 or 인밴드 갱신)
- [ ] per-connection 버퍼/큐 제한
- [ ] Nginx/ALB WebSocket 타임아웃 설정 (`proxy_read_timeout 3600s`)
- [ ] 크로스 서버 브로드캐스트 (Redis Pub/Sub or 외부 브로커)
- [ ] 동시 연결 수 모니터링 + 알람

### SSE

- [ ] `Last-Event-ID` 기반 이어받기 구현
- [ ] 하트비트 이벤트 (유령 연결 방지)
- [ ] 백프레셔 설정 (`onBackpressureBuffer/Latest/Drop`)
- [ ] Nginx: `proxy_buffering off`, `X-Accel-Buffering: no`
- [ ] 연결 수 & 이벤트 전송률 메트릭

### Webhook

- [ ] HMAC-SHA256 서명 생성/검증
- [ ] 타임스탬프 검증 (Replay 공격 방어)
- [ ] 멱등성 키 (`X-Webhook-Id`)
- [ ] 지수 백오프 재시도 (최대 5회)
- [ ] DLQ + 재처리 도구
- [ ] 수신자: 빠른 2xx + 비동기 처리
- [ ] 전송 성공률/지연 모니터링

---

## 9) 안티패턴 6가지

| # | 안티패턴 | 증상 | 해결 |
|---|---------|------|------|
| 1 | 모든 곳에 WebSocket | 리소스 낭비, 스케일 아웃 난항 | SSE/Webhook으로 충분한지 먼저 판단 |
| 2 | 재연결 미구현 | 네트워크 순단 → 영구 끊김 | 지수 백오프 + 지터 필수 |
| 3 | 하트비트 없음 | 유령 연결 누적 → 메모리 누수 | ping/pong 또는 주기 이벤트 |
| 4 | 무한 버퍼 | 느린 클라이언트 → OOM | per-connection 버퍼 제한 |
| 5 | Webhook 동기 처리 | 발행자 타임아웃 → 재시도 폭풍 | 즉시 2xx + 비동기 처리 |
| 6 | 서명 미검증 | 위조 Webhook 수신 | HMAC + 타임스탬프 필수 |

---

## 연습(추천)

1. **SSE 알림 스트림**: `Last-Event-ID` 기반 재연결 이어받기를 구현하고, 서버 재시작 후에도 메시지 유실이 없는지 확인
2. **WebSocket 백프레셔**: 느린 클라이언트를 시뮬레이션해 버퍼가 쌓일 때 정책(드롭/종료/샘플링)을 비교
3. **Webhook 수신 API**: 서명 검증 + 멱등성 키 + 재시도 백오프를 구현하고, 중복/지연이 와도 안전한지 테스트
4. **Reconnect Storm 시뮬레이션**: 서버를 재시작하고 1000개 클라이언트의 재연결 패턴을 관찰 (지터 유무 비교)
5. **크로스 서버 채팅**: Redis Pub/Sub으로 2대 서버 간 메시지 동기화가 되는지 검증

---

## 관련 심화 학습

- [Spring WebFlux 심화](/learning/deep-dive/deep-dive-spring-webflux/) — SSE/WebSocket의 리액티브 구현
- [TCP/HTTP2 기초](/learning/deep-dive/deep-dive-tcp-http2-basics/) — WebSocket 업그레이드가 일어나는 프로토콜 레이어
- [HTTP/3 & QUIC](/learning/deep-dive/deep-dive-http3-quic/) — 차세대 전송 프로토콜과 실시간 통신
- [로드 밸런서와 헬스체크](/learning/deep-dive/deep-dive-load-balancer-healthchecks/) — WebSocket 연결의 로드밸런싱
- [Redis Streams 심화](/learning/deep-dive/deep-dive-redis-streams-advanced/) — 실시간 이벤트 배달 백엔드
- [Resilience4j Circuit Breaker](/learning/deep-dive/deep-dive-resilience4j-circuit-breaker/) — Webhook 전송 실패 시 서킷 브레이커
- [API Rate Limit & Backpressure](/learning/deep-dive/deep-dive-api-rate-limit-backpressure/) — 백프레셔 설계의 상위 맥락
