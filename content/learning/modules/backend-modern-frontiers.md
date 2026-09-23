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
module_aliases: ["backend-modern-frontiers"]
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

## 이 단계의 핵심 주제

- Vector DB 인덱싱과 검색 알고리즘
- HTTP/3 & QUIC의 성능/지연 최적화 원리
- Serverless/MicroVM과 eBPF 기반 관측

## 미니 실습

- **RAG 파이프라인 설계**: 임베딩→검색→리랭킹 흐름 그리기
- **HTTP/3 비교**: TCP vs QUIC의 병목 지점 정리
- **콜드 스타트 분석**: 서버리스 초기 지연 원인 분해

## 완료 기준

- 신기술을 “왜 필요한지” 설명할 수 있다
- 기존 기술의 한계와 해결 방식을 비교할 수 있다
- 도입 시 트레이드오프를 말로 정리할 수 있다

## 추천 학습 순서와 운영 체크포인트

이 모듈은 기술 이름을 많이 아는 것보다 **어떤 제약을 먼저 측정하고, 언제 도입을 멈춰야 하는지**를 익히는 데 목적이 있습니다. 아래 순서로 한 주제씩 읽고 작은 실험을 남기면, 유행하는 기술을 기능 목록으로만 소비하지 않게 됩니다.

1. **[HTTP/3와 QUIC](/learning/deep-dive/deep-dive-http3-quic/)** 으로 TCP의 head-of-line blocking, 연결 재개, 네트워크 전환이 사용자 지연에 미치는 영향을 먼저 분리합니다. 실험에서는 평균 응답시간보다 연결 실패율, 재전송, p95·p99를 함께 기록합니다.
2. **[Vector DB 내부 원리](/learning/deep-dive/deep-dive-vector-db-internals/)** 로 임베딩 품질과 검색 지연의 교환 관계를 확인합니다. 정답 문서가 검색 결과 상위에 들어오는 비율, 인덱스 구축 시간, 메모리 사용량을 같은 데이터셋에서 비교해야 합니다.
3. **[eBPF 기반 프로덕션 디버깅 플레이북](/learning/deep-dive/deep-dive-ebpf-production-debugging-playbook/)** 으로 애플리케이션 지표만으로 설명되지 않는 CPU, 락, 네트워크 병목을 좁히는 순서를 연습합니다. eBPF는 APM을 대체하는 첫 도구가 아니라, 기존 로그·메트릭·트레이스로 가설을 세운 뒤 쓰는 확대경입니다.
4. **[Java Virtual Threads와 Spring MVC/WebFlux 선택 기준](/learning/deep-dive/deep-dive-java-virtual-threads-spring-mvc-webflux-playbook/)** 으로 동시성 비용이 줄어도 DB 커넥션, 외부 API quota, CPU가 그대로 병목으로 남는다는 점을 확인합니다. 이 글은 이전 키인 `backend-modern-frontiers`로 분류된 노트도 이 모듈에서 계속 찾을 수 있게 연결합니다.

### 도입 전 10분 체크리스트

- **문제 정의**: 바꾸려는 대상이 평균 성능이 아니라 tail latency, 연결 복구, 검색 정확도, 운영 가시성 중 무엇인지 한 문장으로 적습니다.
- **기준선**: 트래픽 조건, 데이터 크기, p95/p99, 오류율, CPU·메모리·하류 풀 사용량을 배포 전후 같은 대시보드에서 비교합니다.
- **작은 canary**: 전체 전환 대신 한 엔드포인트·한 인덱스·일부 인스턴스만 대상으로 하고, 중단 조건(오류율 상승·p99 악화·비용 상한)을 숫자로 둡니다.
- **롤백**: feature flag, 기존 프로토콜/검색 경로, 이전 런타임 설정을 즉시 되돌릴 수 있는지 배포 전에 확인합니다. 새 기술이 잘 동작하지 않는 상황도 운영 절차의 일부입니다.

이 과정을 남기면 "HTTP/3를 켰다" 또는 "Vector DB를 붙였다"가 아니라, **어떤 사용자 문제를 어떤 지표로 개선했고 어떤 비용을 감수했는가**를 팀에 설명할 수 있습니다.

## 추천 학습 자료
- **논문**: [The QUIC Transport Protocol (Google)](https://dl.acm.org/doi/10.1145/3098822.3098842)
- **영상**: [AWS re:Invent - Deep Dive on Firecracker](https://www.youtube.com/watch?v=Rds4Cq5Z44I)
