---
title: "HTTP Essentials: 요청/응답 구조와 메서드, 상태 코드"
date: 2025-12-29
draft: false
topic: "Network"
tags: ["HTTP", "Network", "REST"]
categories: ["Backend Deep Dive"]
description: "HTTP 메시지 구조부터 GET/POST 차이, 2xx~5xx 상태 코드의 정확한 의미까지, 백엔드 개발자의 필수 상식"
module: "foundation"
study_order: 50
quizzes:
  - question: "HTTP 메시지 구조에서 'Body(본문)'와 'Header(헤더)'를 구분하는 기준은?"
    options:
      - "Content-Length 헤더의 값"
      - "빈 줄 (CRLF, \\r\\n)"
      - "Start Line"
      - "특수 문자 @ 구분자"
    answer: 1
    explanation: "HTTP 프로토콜은 헤더의 끝을 알리기 위해 빈 줄(Empty Line, CRLF) 하나를 두고 그 뒤부터 본문(Body)으로 간주합니다."

  - question: "HTTP 메서드 중 '멱등성(Idempotence)'을 가지지 않는 대표적인 메서드는?"
    options:
      - "GET"
      - "PUT"
      - "DELETE"
      - "POST"
    answer: 3
    explanation: "멱등성은 여러 번 호출해도 결과(서버 상태)가 같은 성질입니다. GET(조회), PUT(대체), DELETE(삭제)는 멱등하지만, POST(등록/처리)는 호출할 때마다 새로운 리소스가 생성되거나 상태가 변할 수 있어 멱등하지 않습니다."

  - question: "다음 중 '클라이언트의 요청에 문제가 있음(Client Error)'을 나타내는 HTTP 상태 코드 대역은?"
    options:
      - "2xx"
      - "3xx"
      - "4xx"
      - "5xx"
    answer: 2
    explanation: "2xx는 성공, 3xx는 리다이렉션, 4xx는 클라이언트 오류(예: 400 Bad Request, 404 Not Found), 5xx는 서버 오류(예: 500 Internal Server Error)입니다."

  - question: "HTTP 상태 코드 `401 Unauthorized`와 `403 Forbidden`의 가장 큰 차이점은?"
    options:
      - "401은 '인증(Authentication)'이 안 된 상태, 403은 '권한(Authorization)'이 없는 상태"
      - "401은 서버 오류, 403은 클라이언트 오류"
      - "차이가 없다."
      - "403이 더 심각한 오류다."
    answer: 0
    explanation: "401은 '누구인지 증명라(로그인 필요)'는 뜻이고, 403은 '누구인지는 알겠는데(로그인 됨), 접근할 자격은 없다(관리자만 가능 등)'는 뜻입니다."

  - question: "HTTP/1.1에서 도입된 `Keep-Alive` 기능의 주된 목적은?"
    options:
      - "서버의 CPU 사용률을 줄이기 위해"
      - "매 요청마다 TCP 연결(3-Way Handshake)을 맺고 끊는 오버헤드를 줄이기 위해 연결을 재사용"
      - "패킷 손실을 방지하기 위해"
      - "보안 강화를 위해"
    answer: 1
    explanation: "HTTP는 비연결성(Connectionless) 프로토콜이었으나, 성능 향상을 위해 TCP 연결을 유지하고 여러 요청을 처리하는 Persistent Connection(Keep-Alive) 개념이 도입되었습니다."

  - question: "GET 요청의 특징으로 올바르지 않은 것은?"
    options:
      - "데이터를 URL의 Query String에 포함하여 전송한다."
      - "서버의 상태를 변경하지 않는 조회 작업에 주로 사용된다."
      - "브라우저 히스토리에 남고, 캐시될 수 있다."
      - "대용량 바이너리 데이터를 전송하기에 적합하다."
    answer: 3
    explanation: "GET은 URL 길이 제한이 있고 데이터가 노출되므로, 대용량 파일이나 민감한 데이터를 전송할 때는 Body를 사용하는 POST나 PUT이 적합합니다."
---

## 이 글에서 얻는 것

- **HTTP 메시지 해부**: Start Line, Header, Body 구조를 명확히 이해합니다.
- **메서드의 의미**: GET vs POST 차이를 넘어, PUT vs PATCH, 멱등성(Idempotence)의 중요성을 압니다.
- **상태 코드의 언어**: 200, 201, 400, 401, 403, 404, 500, 502의 정확한 쓰임새를 익힙니다.

---

## 1. HTTP 메시지 구조: 편지 봉투와 내용물

HTTP 메시지는 텍스트 기반이며, 크게 3부분으로 나뉩니다.

```text
POST /api/users HTTP/1.1     <-- Start Line (요청 라인)
Host: example.com            <-- Headers
Content-Type: application/json
Authorization: Bearer token

{                            <-- Body (본문)
  "name": "Alice",
  "age": 25
}
```

1.  **Start Line**: 
    *   **요청**: `Method PATH Version` (예: `GET /index.html HTTP/1.1`)
    *   **응답**: `Version StatusCode StatusText` (예: `HTTP/1.1 200 OK`)
2.  **Headers**: 메타데이터 (보내는 사람, 타입, 길이, 인증 정보 등).
3.  **Empty Line (CRLF)**: 헤더와 본문을 나누는 경계선. **필수**입니다.
4.  **Body**: 실제 전송할 데이터 (HTML, JSON, 이미지 등). 없는 경우도 많습니다(GET 등).

---

## 2. HTTP 메서드(Method): 동사(Verb)

서버에게 "무엇을 하라"고 시키는 명령어입니다.

| 메서드 | 의미 | Body 유무 | 멱등성(Idempotence) |
|:---:|:---|:---:|:---:|
| **GET** | 리소스 **조회**. 상태 변경 없음. | X | O |
| **POST** | 리소스 **등록** 또는 프로세스 처리. | O | X |
| **PUT** | 리소스 **대체** (없으면 생성, 있으면 덮어쓰기). | O | O |
| **PATCH** | 리소스 **부분 변경**. | O | △ (구현 나름) |
| **DELETE** | 리소스 **삭제**. | X | O |

> **멱등성(Idempotence)**이란?
> 연산을 한 번 하든, 백 번 하든 결과(서버 상태)가 똑같은 성질.
> *   `DELETE /users/1`: 1번 유저를 지운다. 100번 호출해도 1번 유저는 없는 상태. (멱등)
> *   `POST /users`: 유저를 추가한다. 100번 호출하면 유저 100명 생성. (멱등 X)

---

## 3. HTTP 상태 코드(Status Code): 결과 보고

서버가 클라이언트에게 "일이 어떻게 됐는지" 알려주는 3자리 숫자입니다.

### 2xx: 성공 (Success)
*   `200 OK`: 요청 성공. 가장 일반적.
*   `201 Created`: 생성 성공. (주로 POST 요청의 응답, `Location` 헤더에 생성된 URI 포함)
*   `204 No Content`: 성공했는데 줄 건 없음. (주로 DELETE 성공 시)

### 3xx: 리다이렉션 (Redirection)
*   `301 Moved Permanently`: 영구 이동. (주소 바뀜, SEO 점수 이동)
*   `302 Found`: 임시 이동.
*   `304 Not Modified`: "너 캐시 가지고 있지? 그거 그대로 써." (성능 최적화 핵심)

### 4xx: 클라이언트 오류 (Client Error) - "네가 잘못했어"
*   `400 Bad Request`: 요청 파라미터가 틀림, JSON 형식이 깨짐 등.
*   `401 Unauthorized`: **인증** 필요. (로그인 안 함)
*   `403 Forbidden`: **권한** 부족. (로그인은 했는데 접근 불가)
*   `404 Not Found`: 리소스 없음. (URL 오타)
*   `405 Method Not Allowed`: GET만 되는데 POST를 보냄.
*   `429 Too Many Requests`: 요청 너무 많이 보냄 (Rate Limit).

### 5xx: 서버 오류 (Server Error) - "내가(서버가) 잘못했어"
*   `500 Internal Server Error`: 서버 내부 로직 에러 (NPE 등).
*   `502 Bad Gateway`: 게이트웨이(Nginx)가 뒷단 서버(Tomcat)로부터 이상한 응답을 받음.
*   `503 Service Unavailable`: 서버 과부하, 점검 중.
*   `504 Gateway Timeout`: 뒷단 서버가 응답을 안 줌 (시간 초과).

---

## 4. HTTP 헤더(Header): 꼬리표

### 필수/주요 헤더
*   **Host**: 요청하는 도메인 이름. (가상 호스팅 환경에서 필수)
*   **Content-Type**: Body의 형식. (`application/json`, `text/html`)
*   **Content-Length**: Body의 길이(바이트).
*   **Authorization**: 인증 토큰 (`Bearer ...`).
*   **User-Agent**: 클라이언트 정보 (브라우저/OS).

### 협상(Negotiation)
*   **Accept**: 클라이언트가 원하는 데이터 타입 (`application/json`).
*   **Accept-Language**: 원하는 언어.

---

## 요약

1.  **GET**은 조회(안전, 멱등), **POST**는 처리(보안, 데이터 변경).
2.  **2xx**는 성공, **4xx**는 네 탓, **5xx**는 내 탓.
3.  **401**은 로그인 필요, **403**은 권한 부족.
4.  메시지는 **Start Line**, **Header**, **Body**로 구성되며 헤더와 바디 사이엔 **빈 줄**이 있다.
