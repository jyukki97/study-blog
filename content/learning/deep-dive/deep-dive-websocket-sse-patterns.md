---
title: "실시간 통신: WebSocket vs SSE vs Webhook"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["WebSocket", "SSE", "Webhook", "Realtime"]
categories: ["Backend Deep Dive"]
description: "실시간/준실시간 요구에 따라 WebSocket, SSE, Webhook을 선택하는 기준과 설계 패턴"
module: "architecture"
study_order: 475
---

## 선택 기준

- WebSocket: 양방향, 저지연(채팅/알림/게임)
- SSE: 단방향 서버→클라이언트 스트림, 브라우저 친화적, 라우터/방화벽 우호적
- Webhook: 비동기 알림/동기화, 재시도/서명 검증 필수

## 설계 포인트

- 커넥션 수/스케일: LB에서 WebSocket 지원, 스티키 여부 확인
- 백프레셔: 메시지 큐/버퍼 크기, 드롭/재전송 정책
- 보안: 인증 토큰 갱신, 기밀 데이터 암호화(https/wss)

## 체크리스트

- [ ] 프로토콜 선택 근거(양방향/단방향/지연/규모)
- [ ] 연결 관리(heartbeat/ping-pong, 재연결)
- [ ] Webhook 서명 검증, 재시도/멱등 처리
