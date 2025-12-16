---
title: "관측성 베이스라인: 로그·메트릭·트레이스"
date: 2025-12-16
draft: false
topic: "Observability"
tags: ["Observability", "Logging", "Metrics", "Tracing", "Prometheus", "ELK"]
categories: ["DevOps"]
description: "로그/메트릭/트레이스 3대 기둥과 Spring Boot 기반 기본 설정 가이드"
module: "ops-observability"
study_order: 330
---

## 로그

- JSON 구조 로그 + Correlation ID (`traceId`) 포함
- 로그 레벨: INFO 기본, 비정상은 WARN/ERROR, PII 마스킹
- 수집: Filebeat/FluentBit → Logstash/Opensearch

## 메트릭

- Micrometer + Prometheus 스크랩
- 핵심 지표: 요청 레이턴시/에러율/Throughput, JVM 메모리/GC, DB 커넥션 풀
- 알람: 슬로우 레이턴시/에러율 급증 시 알림

## 트레이스

- OpenTelemetry/Zipkin/Jaeger로 분산 트레이싱
- HTTP/gRPC 클라이언트 스팬 자동 수집, DB/Redis/Kafka 인스트루멘테이션

## 체크리스트

- [ ] `/actuator/prometheus` 노출 및 인증/네트워크 제한 적용
- [ ] 로그에 `traceId`/`spanId`/사용자 식별자 포함
- [ ] 대용량 로그는 샘플링/레이트 리밋 고려
- [ ] 알람 임계치 + 온콜 라우팅 정의
