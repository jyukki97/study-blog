---
title: "네트워크 기초: TCP 핸드셰이크와 HTTP/2"
date: 2025-12-16
draft: false
topic: "Network"
tags: ["TCP", "HTTP2", "Handshake", "Multiplexing"]
categories: ["Backend Deep Dive"]
description: "TCP 3-way, 흐름/혼잡 제어, HTTP/2 멀티플렉싱·HPACK·헤더 압축 핵심"
module: "foundation"
study_order: 35
---

## TCP 핵심

- 3-way handshake, 4-way close, TIME_WAIT 의미
- 흐름 제어(Window), 혼잡 제어(Slow start, AIMD)

## HTTP/2 특징

- 단일 커넥션 멀티플렉싱, 헤더 압축(HPACK), 서버 푸시(추후 비권장)
- HOL Blocking 완화, 우선순위

## 체크리스트

- [ ] Keep-Alive/Max Concurrent Streams 설정 확인
- [ ] TLS(1.2/1.3) + ALPN으로 h2 협상
- [ ] HTTP/2 다운그레이드 시 성능 영향 확인
