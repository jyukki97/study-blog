---
title: "10단계: 현대적 백엔드 기술 (Modern Frontiers)"
date: 2025-12-28
draft: false
topic: "Backend Roadmap"
tags: ["AI", "Vector DB", "QUIC", "Serverless", "eBPF"]
categories: ["Learning"]
description: "AI 시대의 백엔드(Vector Search), 차세대 웹 프로토콜(HTTP/3), 그리고 Serverless/MicroVM 등 최신 기술의 '내부 원리'를 다룹니다."
weight: 10
study_order: 100
layout: "learning-module"
module_key: "modern-frontiers"
url: "/learning/modules/backend-modern-frontiers/"
---

## 이 단계에서 얻는 것

단순히 "신기술을 써봤다"가 아니라, 이 기술들이 **기존 기술(RDBMS, TCP, VM)의 한계를 어떻게 극복했는지** 엔지니어링 관점에서 이해합니다.

- **AI Native Backend**: RAG/LLM 서비스의 핵심인 Vector DB가 고차원 데이터를 어떻게 인덱싱(HNSW)하는지 봅니다.
- **Next-Gen Web**: 구글이 왜 TCP를 버리고 UDP 기반의 QUIC을 만들었는지, HTTP/3가 모바일 환경에서 왜 강한지 이해합니다.
- **Modern Compute**: AWS Lambda와 같은 FaaS가 콜드 스타트를 줄이기 위해 사용하는 MicroVM 기술을 봅니다.

## 커리큘럼 (Topic List)

### 1. AI & Data (Vector Search)
- **Vector Embeddings**: 텍스트/이미지를 숫자로 바꾸는 의미.
- **HNSW (Hierarchical Navigable Small World)**: 수억 개의 벡터 중 가장 유사한 것을 10ms 안에 찾는 그래프 알고리즘.
- **RAG Architecture**: LLM + Vector DB + Backend의 흐름.

### 2. Network (HTTP/3 & QUIC)
- **Head-of-Line Blocking**: TCP의 태생적 한계와 QUIC의 멀티플렉싱 해결법.
- **0-RTT Handshake**: 연결 수립 속도의 혁신.
- **Connection Migration**: 와이파이 ↔ LTE 전환 시 끊기지 않는 원리.

### 3. Compute & Kernel (Serverless & eBPF)
- **MicroVM (Firecracker)**: 컨테이너보다 격리 수준은 높고 VM보다 가벼운 기술.
- **eBPF (extended Berkeley Packet Filter)**: 커널 소스를 수정하지 않고 커널 기능을 확장/관측하는 리눅스의 초능력. (쿠버네티스 CNI, 보안 모니터링의 핵심)

## 추천 학습 자료
- **논문**: [The QUIC Transport Protocol (Google)](https://dl.acm.org/doi/10.1145/3098822.3098842)
- **영상**: [AWS re:Invent - Deep Dive on Firecracker](https://www.youtube.com/watch?v=Rds4Cq5Z44I)
