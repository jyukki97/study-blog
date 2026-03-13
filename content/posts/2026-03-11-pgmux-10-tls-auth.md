---
title: "Go로 PostgreSQL 프록시 만들기 (10) - TLS Termination과 프록시 인증"
date: 2026-03-11
draft: false
tags: ["Go", "PostgreSQL", "Database", "Proxy", "TLS", "Security", "Authentication"]
categories: ["Database"]
project: "pgmux"
description: "프록시 앞단에서 TLS를 종단하고, 백엔드 없이 클라이언트를 직접 인증하는 Front-end Auth를 구현한다."
---

## 들어가며

> "보안은 부가기능이 아니라 인프라의 기본값이어야 한다."

지금까지 프록시는 평문 TCP로 통신하고, 인증은 백엔드 PG에 그대로 중계했다. 프로덕션 환경에서는 두 가지가 빠져있다:

1. 클라이언트 ↔ 프록시 구간의 **암호화** (TLS)
2. 프록시 레벨의 **접근 제어** (인증)

이번 편에서 구현한 것:
1. SSL Request 핸들링과 TLS 연결 업그레이드
2. 프록시 자체 MD5 인증 (Front-end Auth)
3. 보안 아키텍처의 레이어 분리

## 🔒 TLS Termination

### PG wire protocol의 SSL 핸드셰이크

PostgreSQL 클라이언트는 연결 시 **SSLRequest**를 먼저 보낸다:

```
Client → Server: SSLRequest (8 bytes, code=80877103)
Server → Client: 'S' (TLS 가능) or 'N' (TLS 불가)
```

'S'를 응답하면 클라이언트는 즉시 TLS 핸드셰이크를 시작한다. 핵심은 **일반 TCP 연결 위에서 TLS로 업그레이드**하는 것이다.

### 구현

```go
if code == protocol.SSLRequestCode {
    if s.tlsConfig != nil {
        // Accept TLS — respond 'S' and upgrade connection
        if _, err := clientConn.Write([]byte{'S'}); err != nil {
            return
        }
        tlsConn := tls.Server(clientConn, s.tlsConfig)
        if err := tlsConn.Handshake(); err != nil {
            slog.Error("TLS handshake", "error", err)
            return
        }
        clientConn = tlsConn  // 이후 모든 I/O는 암호화
    } else {
        // No TLS configured — reject
        clientConn.Write([]byte{'N'})
    }
    // TLS 후 다시 StartupMessage를 읽는다
    startup, err = protocol.ReadStartupMessage(clientConn)
}
```

Go의 `crypto/tls`가 무거운 작업을 다 해준다. `tls.Server()`로 기존 `net.Conn`을 감싸면, 이후 `Read()`/`Write()` 호출이 자동으로 암호화/복호화된다.

### 설정

```yaml
tls:
  enabled: true
  cert_file: "/path/to/server.crt"
  key_file: "/path/to/server.key"
```

`enabled: false`이면 SSLRequest에 'N'을 응답하고, 클라이언트는 평문으로 진행한다. 기존 동작과 완전히 호환된다.

### TLS Termination 아키텍처

```
Client ──[TLS]──► Proxy ──[TCP]──► PostgreSQL
         암호화              평문 (내부망)
```

프록시가 TLS를 종단(Terminate)하므로, 백엔드 PG는 TLS 설정이 필요 없다. AWS RDS처럼 프록시와 DB가 같은 VPC에 있으면 내부 구간은 평문이어도 안전하다.

## 🔑 Front-end Auth: 프록시 자체 인증

### 왜 프록시에서 인증하는가?

기존 방식(Backend Auth Relay):
```
Client ──auth──► Proxy ──relay──► PostgreSQL
                  (중계만 함)       (인증 판단)
```

문제:
- 인증을 위해 매번 백엔드에 **임시 커넥션**을 생성해야 한다
- DB 사용자 목록 = 프록시 접근 가능자 목록 (분리 불가)
- 백엔드가 다운되면 인증 자체가 불가

Front-end Auth:
```
Client ──auth──► Proxy ──(pool)──► PostgreSQL
                  (직접 인증)        (이미 인증된 풀)
```

프록시가 자체 사용자 목록으로 인증을 완료한다. 백엔드 풀 커넥션은 이미 인증된 상태이므로, 클라이언트 인증과 완전히 분리된다.

### MD5 챌린지-응답 구현

```go
func (s *Server) frontendAuth(clientConn net.Conn, username string) error {
    // 1. 사용자 조회
    var password string
    for _, u := range s.cfg.Auth.Users {
        if u.Username == username {
            password = u.Password
            break
        }
    }

    // 2. 랜덤 salt 생성 + MD5 챌린지 전송
    salt := make([]byte, 4)
    rand.Read(salt)
    authPayload := make([]byte, 8)
    binary.BigEndian.PutUint32(authPayload[0:4], 5) // MD5Password
    copy(authPayload[4:8], salt)
    protocol.WriteMessage(clientConn, protocol.MsgAuthentication, authPayload)

    // 3. 클라이언트 응답 수신 및 검증
    msg, _ := protocol.ReadMessage(clientConn)
    clientHash := strings.TrimRight(string(msg.Payload), "\x00")
    expectedHash := pgMD5Password(username, password, salt)

    if clientHash != expectedHash {
        s.sendError(clientConn, "password authentication failed")
        return fmt.Errorf("MD5 password mismatch")
    }

    // 4. AuthenticationOk + ReadyForQuery
    protocol.WriteMessage(clientConn, protocol.MsgAuthentication, okPayload)
    protocol.WriteMessage(clientConn, protocol.MsgReadyForQuery, []byte{'I'})
    return nil
}
```

MD5 인증 흐름:
```
Proxy → Client: AuthenticationMD5Password(salt=random_4bytes)
Client → Proxy: "md5" + md5(md5(password + user) + salt)
Proxy:          검증 → AuthenticationOk + ReadyForQuery
```

salt는 매번 랜덤으로 생성되므로, 네트워크에서 해시를 캡처해도 재사용할 수 없다 (replay attack 방지).

### 설정

```yaml
auth:
  enabled: true
  users:
    - username: "app_user"
      password: "secret123"
    - username: "readonly"
      password: "readpass"
```

`auth.enabled: false`이면 기존처럼 백엔드 relay로 동작한다. 운영 환경에서는 TLS + Front-end Auth를 함께 켜는 것이 권장된다.

## 🛡️ 보안 레이어 정리

TLS와 Auth를 추가한 후의 전체 보안 아키텍처:

```
┌──────────────────────────────────────────┐
│ Layer 1: TLS (전송 암호화)                │
│   Client ↔ Proxy 구간 암호화              │
├──────────────────────────────────────────┤
│ Layer 2: Front-end Auth (접근 제어)       │
│   프록시 자체 사용자 인증 (MD5)            │
├──────────────────────────────────────────┤
│ Layer 3: Backend Auth (DB 인증)           │
│   풀 커넥션이 이미 PG 인증 완료            │
├──────────────────────────────────────────┤
│ Layer 4: Admin API Password Masking      │
│   /admin/config에서 비밀번호 ******** 처리 │
└──────────────────────────────────────────┘
```

각 레이어가 독립적으로 on/off 가능하다. 개발 환경에서는 전부 끄고, 프로덕션에서는 전부 켜는 방식으로 유연하게 운영할 수 있다.

## 배운 점

1. **TLS Termination은 프록시의 자연스러운 책임** — 프록시가 이미 TCP 연결을 중간에서 잡고 있으므로, TLS를 여기서 끊는 것이 가장 효율적이다. 백엔드마다 인증서를 관리할 필요가 없다.
2. **PG의 SSL 업그레이드는 HTTP와 다르다** — HTTP는 포트를 분리(80 vs 443)하지만, PG는 같은 포트에서 SSLRequest → 'S'/'N' → TLS 업그레이드 순서로 진행한다.
3. **인증 레이어 분리가 유연성을 준다** — 프록시 사용자와 DB 사용자를 분리하면, DB 접속 정보를 앱에 노출하지 않고도 접근 제어가 가능하다.
4. **Go의 `crypto/tls`는 놀랍도록 간단하다** — `tls.Server(conn, config)` 한 줄로 기존 TCP 연결을 TLS로 업그레이드할 수 있다. 프로토콜 세부사항을 다 추상화해준다.

프로젝트 소스코드: [github.com/jyukki97/pgmux](https://github.com/jyukki97/pgmux)
