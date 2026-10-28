---
title: "백엔드 커리큘럼 심화: 실시간 구독 인가와 권한 회수, 연결 한 번의 인증으로 끝내지 않는 법"
date: 2026-10-28T10:06:00+09:00
lastmod: 2026-10-28T10:06:00+09:00
draft: false
tags: ["WebSocket", "SSE", "GraphQL Subscription", "Authorization", "Session Security", "Backend Reliability"]
categories: ["Backend", "Security", "Real-time"]
series: "백엔드 커리큘럼 심화"
keywords: ["realtime subscription authorization", "websocket permission revocation", "SSE authorization", "GraphQL subscription security"]
description: "WebSocket·SSE·GraphQL Subscription에서 연결 인증, 채널별 인가, 토큰 만료, 권한 변경과 강제 회수를 분리해 설계하는 실무 플레이북입니다."
summary: "실시간 연결이 열렸다는 사실은 특정 데이터 스트림을 계속 읽을 권한이 있다는 뜻이 아니다. 연결 신원, 구독 대상 인가, 이벤트 전달 직전의 재검증, 권한 변경 후 회수 경로를 분리해야 장수 연결이 과거 권한을 붙들지 않는다."
key_takeaways:
  - "WebSocket handshake의 인증 성공은 transport 입장권일 뿐이며, topic·resource별 인가는 subscribe 시점과 권한 변경 시점에 별도로 판정해야 한다."
  - "고위험 데이터는 권한 변경 뒤 30초~1분 안에 기존 구독을 회수할 수 있어야 하며, access token TTL만으로 그 목표를 약속할 수 없다."
  - "fan-out worker는 tenant·resource·event type·권한 버전을 확인한 뒤 최소 payload만 전달해야 한다."
---

WebSocket이나 SSE를 붙이면 서버는 연결을 오래 유지한 채 이벤트를 보낼 수 있습니다. 이 편리함 때문에 handshake에서 access token을 한 번 검증한 뒤, 연결이 살아 있는 한 같은 사용자가 모든 채널을 계속 볼 수 있게 만들기 쉽습니다. 하지만 연결 당시 프로젝트 멤버였던 사용자가 20분 뒤 제거됐거나, 관리자가 session을 회수했거나, tenant가 바뀌었다면 어떨까요? TCP 연결이 살아 있다는 사실과 **지금 이 이벤트를 볼 권한이 있다**는 사실은 다릅니다.

실시간 기능의 보안은 “접속 토큰이 유효한가”보다 더 긴 수명주기를 다룹니다. 연결은 transport 자원이고, subscription은 데이터 접근 권한이며, event delivery는 실제 정보 공개입니다. 이 셋을 하나의 `authenticated=true`로 합치면 권한 변경이 반영되지 않는 창과 장애 때 추적 불가능성이 생깁니다. 이 글은 [WebSocket·SSE·Webhook 선택](/learning/deep-dive/deep-dive-websocket-sse-patterns/), [WebSocket 재연결·Replay·Ack](/learning/deep-dive/2026-10-19-websocket-reconnect-replay-ack-playbook/), [Object-Level Authorization](/learning/deep-dive/deep-dive-object-level-authorization-bola-playbook/), [Device Session Registry와 회수](/learning/deep-dive/deep-dive-device-session-registry-revocation-playbook/)를 실시간 권한 관점으로 연결합니다.

## 이 글에서 얻는 것

- 연결 인증, 구독 인가, 이벤트 전달 인가를 왜 분리해야 하는지 이해합니다.
- tenant, 프로젝트, 문서, 관리자 채널처럼 대상별로 좁은 subscription scope를 설계할 수 있습니다.
- 토큰 만료·역할 변경·강제 로그아웃 뒤 기존 연결을 회수하는 기준을 얻습니다.
- 매 이벤트 재검증 비용과 stale 권한 허용 창 사이에서 수치로 결정할 수 있습니다.

## 핵심 개념/이슈

### 1) 연결 성공은 채널 접근 허가가 아니다

`wss://api.example.com/realtime` handshake에서 token을 검증하는 일은 “누가 이 연결을 열었는가”를 확인합니다. 그러나 같은 사용자가 `project:42`, `project:99`, `admin:audit`, `document:abc`를 모두 읽어도 되는지는 다른 질문입니다. 하나의 연결에서 구독을 추가·제거하는 multiplexing 프로토콜이라면, handshake의 user ID만 믿고 client가 보낸 topic 문자열을 그대로 map에 넣는 구현은 BOLA가 되기 쉽습니다.

안전한 모델은 최소 세 단계입니다.

| 단계 | 서버가 확인할 사실 | 성공의 의미 | 실패 시 행동 |
| --- | --- | --- | --- |
| connect | session/token, issuer, 만료, device 상태 | transport 연결을 열 수 있음 | 연결 거절 또는 재인증 요구 |
| subscribe | principal이 target resource를 읽을 수 있음 | 특정 subscription 생성 가능 | 해당 subscription만 `denied` |
| deliver | subscription이 아직 유효하고 event가 scope에 맞음 | 이 이벤트의 payload를 공개 가능 | drop·revoke·재검증 |

예를 들어 `document:123`이라는 topic 이름을 client가 보내도 서버는 document의 tenant, 현재 membership, 문서 분류를 다시 확인해야 합니다. `tenant:7`처럼 넓은 topic도 마찬가지입니다. tenant admin이 아니면 멤버 목록이나 결제 이벤트까지 섞어 보내지 않도록 event type별 scope를 나눕니다. topic 명명은 routing 힌트일 뿐 권한 증명이 아닙니다.

```json
{
  "type": "subscribe",
  "subscription_id": "sub_71f",
  "resource": {"kind": "document", "id": "doc_123"},
  "requested_events": ["comment.created", "document.status_changed"]
}
```

서버는 이 요청을 받은 뒤 `principal_id`, `tenant_id`, resource owner, 현재 role, 허용 event type을 판정하고 결정 결과를 저장합니다. 클라이언트가 보내는 `tenant_id`, `role`, `user_id`는 힌트로만 취급합니다. 인증 주체의 tenant는 signed token claim 또는 server session에서, 대상 문서의 tenant는 권한 DB에서 얻어야 합니다.

### 2) 권한에는 버전이 있고, 연결에는 오래된 판단이 남는다

실시간 기능의 핵심 위험은 만료된 권한 결정입니다. 사용자가 프로젝트에서 제거됐는데 connection 메모리에는 `canRead=true`가 남아 있거나, access token의 TTL이 1시간이라 session revoke를 해도 한 시간 동안 이벤트가 계속 나가면 회수 약속은 지켜지지 않습니다. 그래서 권한 판단에 `authz_version` 또는 `membership_version`을 둡니다. 사용자 또는 tenant의 권한을 바꿀 때 version을 증가시키고, connection/subscription이 기억한 version과 비교합니다. version이 다르면 재평가하거나 구독을 즉시 끊습니다.

```text
connection: conn_54 / user_18 / session_s9 / authz_version=41
subscription: sub_71f / document:doc_123 / membership_version=41

role removed -> authz_version=42, revocation event published
gateway receives event -> conn_54 closes sub_71f with reason=permission_revoked
```

version 비교가 권한 DB 조회를 완전히 없애 주지는 않습니다. 하지만 모든 이벤트마다 복잡한 policy engine을 부르는 대신, 변경이 없을 때는 싼 정수 비교로 통과시키고 변경이 있을 때만 재평가할 선택지를 줍니다. 단, version을 connection 프로세스의 로컬 cache에만 두면 여러 gateway에 전파되지 않습니다. 권한 변경 이벤트, 짧은 TTL cache, 재연결 시 full check 중 적어도 두 겹을 두는 편이 좋습니다.

### 3) 회수 목표는 민감도와 전달량에 맞춰 정한다

모든 채널을 즉시 끊는 것이 항상 최선은 아닙니다. 읽기 전용 협업 커서처럼 민감도가 낮고 재연결 비용이 큰 stream은 1~5분의 권한 cache가 실용적일 수 있습니다. 반면 관리자 감사 로그, 결제 상태, 인사 정보는 stale 권한 창을 훨씬 작게 잡아야 합니다.

| 데이터/행동 | 권장 재검증·회수 목표 | 기본 전파 방식 | 자동 중단 기준 |
| --- | --- | --- | --- |
| 공개성 높은 알림 | 5분 이하 | token TTL + reconnect | token 만료 |
| 팀 협업 문서 이벤트 | 1분 이하 | membership version + invalidation | 멤버 제거·tenant 이동 |
| 결제·개인정보·관리자 이벤트 | 30초 이하 | revoke pub/sub + registry lookup | role 삭제·session revoke |
| write command를 받는 socket | 명령마다 | server-side authorization | target/version 불일치 1건 |

여기서 “30초 이내”는 token 만료 시간이 아니라 **권한 변경이 저장된 시점부터 마지막 연결이 닫힐 때까지**입니다. 이를 측정하려면 `revocation_published_at`, gateway 수신 시각, close frame 시각, client reconnect 시각을 분리해 기록해야 합니다. pub/sub가 유실되면 최신 version을 모르는 gateway가 남을 수 있으므로, 30~60초 heartbeat 또는 다음 이벤트 전 version 조회 같은 fallback이 필요합니다.

## 실무 적용

### 1) subscription을 서버가 소유하는 레코드로 만든다

클라이언트의 topic 문자열만 map에 넣지 말고, 서버가 판단한 scope를 저장합니다. DB에 영구 저장할지 Redis 같은 TTL registry에 둘지는 재연결과 감사 요구에 따라 다르지만, connection lifetime 동안 server-side source of truth가 있어야 합니다.

```yaml
subscription:
  subscription_id: sub_71f
  connection_id: conn_54
  principal_id: user_18
  session_id: sess_a9
  tenant_id: tenant_7
  resource: { kind: document, id: doc_123 }
  allowed_events: [comment.created, document.status_changed]
  authz_version: 41
  expires_at: "2026-10-28T01:26:00Z"
```

이 레코드가 있으면 권한 변경 이벤트가 `principal_id=user_18` 또는 `tenant_id=tenant_7`로 영향을 받는 연결을 찾을 수 있습니다. 반대로 client가 재구독할 때마다 전 연결을 잊으면, session revoke와 support 조사에서 “누구에게 무엇을 보냈는가”를 되짚기 어렵습니다. 로그에는 payload 원문 대신 event type, resource hash, policy decision, version만 남겨 민감 데이터가 관측 계층으로 새지 않게 합니다.

### 2) event fan-out 앞에 작은 정책 gate를 둔다

이벤트 생산자가 `document.updated`를 발행했다고 해서 broker consumer가 모든 subscriber에게 그대로 보내면 안 됩니다. 최소한 `tenant_id`와 resource ID가 일치하는 subscription만 선택하고, event type이 허용 목록에 있는지 확인합니다. 개인정보 필드가 역할에 따라 달라진다면 payload 하나를 만든 뒤 필터링하기보다, role별 projection을 만들거나 민감 필드를 제거한 event를 분리하는 편이 안전합니다.

처리량이 높을 때의 기본 순서는 다음과 같습니다.

1. connection이 살아 있는지와 `expires_at`을 확인합니다.
2. tenant/resource/event-type으로 subscription 후보를 좁힙니다.
3. cached `authz_version`이 최신 version과 같은지 비교합니다.
4. 다르면 policy 재평가 후 허용·축소·revoke 중 하나를 기록합니다.
5. 허용된 최소 payload만 serialize해 보냅니다.

매 이벤트 DB 조회가 부담이면 3단계의 version cache를 30~60초 TTL로 시작할 수 있습니다. 단, role 삭제가 발생한 경우 invalidation이 먼저 도착해야 하고, invalidation 지연 p99가 목표 회수 시간의 절반을 넘으면 TTL을 더 길게 잡아서는 안 됩니다. 성능 최적화의 우선순위는 **민감 이벤트의 잘못된 전달 0건 > 권한 변경의 빠른 반영 > fan-out 처리량**입니다.

### 3) 재인증과 재연결을 같은 것으로 취급하지 않는다

연결이 끊기면 client는 일반 네트워크 오류처럼 자동 재연결할 수 있습니다. 하지만 `permission_revoked`, `session_revoked`, `token_expired`는 UX와 보안 행동이 달라야 합니다. 권한 회수는 이전 resume cursor를 그대로 복원하면 안 되고, 새 token으로 다시 subscribe 인가를 받아야 합니다. 반면 일시 네트워크 오류는 [Replay·Ack 설계](/learning/deep-dive/2026-10-19-websocket-reconnect-replay-ack-playbook/)의 cursor에서 재개할 수 있습니다.

```text
network_error       -> backoff 후 reconnect, 기존 subscription 재요청
token_expired       -> refresh/re-auth 후 새 session으로 subscribe
permission_revoked  -> 해당 resource cursor 폐기, 화면 권한 제거
session_revoked     -> 모든 subscription 종료, login 화면으로 이동
```

서버도 close code 하나만으로 모든 원인을 숨기지 않는 편이 좋습니다. 외부 공격자에게 계정 상태를 누설하지 않는 범위에서 `reauth_required`, `subscription_denied`, `permission_revoked` 같은 안정된 애플리케이션 오류 코드를 제공하면 client가 불필요한 무한 재연결을 피할 수 있습니다. 상세 policy 이유는 사용자에게 주지 말고 audit log에만 남깁니다.

## 트레이드오프/주의점

가장 단순한 설계는 handshake에서 JWT를 검증하고 token이 만료될 때만 연결을 끊는 방식입니다. 인프라 비용은 낮지만 role change와 session revoke가 token TTL만큼 지연됩니다. token을 5분으로 짧게 만들면 창은 줄지만 reconnect·refresh 폭주와 모바일 배터리 비용이 늘어납니다. 따라서 짧은 TTL만으로 해결하려 하지 말고, 고위험 subscription에는 명시적인 revoke signal을 추가하세요.

반대로 모든 event에 원격 authorization service를 동기 호출하면 정확도는 높아 보여도 fan-out path의 tail latency와 의존성 장애 면적이 커집니다. 권한 서비스가 느려질 때 협업 화면 전체가 멈추는 구조가 될 수 있습니다. resource별 version, local cache, deny-by-default timeout, 고위험 경로의 강한 재검증을 조합하는 것이 보통 더 균형 잡힌 선택입니다.

또 하나의 함정은 연결 수만 모니터링하는 것입니다. `active_connections`가 정상이어도 만료 token, revoked session, 권한 없는 subscription이 섞여 있으면 안전하지 않습니다. 최소한 `subscribe_denied_rate`, `revocation_propagation_seconds`, `stale_authz_delivery_total`, `reconnect_after_revoke_total`, resource별 fan-out latency를 분리하세요. 특히 `stale_authz_delivery_total`은 정상 목표가 0인 보안 불변식입니다. 한 건이라도 확인되면 평균 latency보다 먼저 원인을 조사해야 합니다.

## 체크리스트 또는 연습

- [ ] handshake 인증과 resource별 subscribe 인가가 별도 코드 경로와 audit event를 가집니다.
- [ ] topic 문자열, tenant ID, role을 클라이언트 입력 그대로 권한 근거로 쓰지 않습니다.
- [ ] subscription에 principal, session, tenant, resource, allowed event, authz version, expiry를 저장합니다.
- [ ] role 제거·tenant 이동·session revoke마다 영향을 받는 subscription을 30초~1분 목표 안에 close할 수 있습니다.
- [ ] revoke pub/sub가 유실됐을 때 version 조회 또는 heartbeat로 회복하는 fallback이 있습니다.
- [ ] event fan-out은 resource/tenant/event-type을 확인한 뒤 최소 payload만 전달합니다.
- [ ] `network_error`, `token_expired`, `permission_revoked`, `session_revoked`를 같은 재연결 규칙으로 처리하지 않습니다.
- [ ] stale 권한으로 전달된 이벤트 수를 0건 불변식으로 모니터링합니다.

연습으로 현재 실시간 채널 하나를 골라 보세요. “사용자가 이 채널을 구독할 수 있는가”, “구독 후 권한을 잃으면 언제 어떤 신호로 끊는가”, “broker event가 잘못된 tenant로 갈 수 있는가”를 각각 한 문장으로 답합니다. 세 답 중 하나라도 token 만료에만 의존한다면, 먼저 subscription record와 revoke event를 추가할 경로부터 설계하는 것이 좋습니다.

## 관련 글

- [WebSocket·SSE·Webhook 선택](/learning/deep-dive/deep-dive-websocket-sse-patterns/)
- [WebSocket 재연결·Replay·Ack](/learning/deep-dive/2026-10-19-websocket-reconnect-replay-ack-playbook/)
- [Object-Level Authorization(BOLA) 방어](/learning/deep-dive/deep-dive-object-level-authorization-bola-playbook/)
- [Device Session Registry와 회수](/learning/deep-dive/deep-dive-device-session-registry-revocation-playbook/)
