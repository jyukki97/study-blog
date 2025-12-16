---
title: "gRPC 서비스 설계 기초"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["gRPC", "Protobuf", "Streaming", "IDL"]
categories: ["Backend Deep Dive"]
description: "프로토 정의, 일방향/양방향 스트리밍, gRPC-Gateway 연계 등 gRPC 설계 핵심"
module: "architecture"
study_order: 480
---

## 핵심 개념

- IDL: proto로 스키마/서비스 정의, 언어별 코드 생성
- 호출 유형: Unary, Server/Client/Bidirectional Streaming
- 채널/커넥션 재사용, 데드라인/타임아웃 설정

```proto
service OrderService {
  rpc CreateOrder (CreateOrderRequest) returns (CreateOrderResponse);
  rpc StreamOrders (OrderStreamRequest) returns (stream OrderEvent);
}
```

## 게이트웨이

- gRPC-Gateway로 HTTP/JSON ↔ gRPC 변환, 브라우저 호환
- 보안: TLS/ALPN, 인증(메타데이터 헤더), 레이트 리밋은 게이트웨이에서

## 체크리스트

- [ ] proto 버전 관리/호환성(필드 번호 고정, 삭제 대신 deprecated)
- [ ] 타임아웃/리트라이/데드라인 명시
- [ ] 스트리밍 시 백프레셔/버퍼 크기 설정
