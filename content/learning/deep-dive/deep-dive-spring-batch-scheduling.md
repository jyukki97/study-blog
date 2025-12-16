---
title: "Spring Batch와 스케줄링 기초"
date: 2025-12-16
draft: false
topic: "Spring"
tags: ["Spring Batch", "Scheduling", "Quartz", "Cron"]
categories: ["Backend Deep Dive"]
description: "대량 배치 처리와 스케줄링 설계, Spring Batch/Quartz/스케줄러 기본"
module: "spring-core"
study_order: 175
---

## Spring Batch 핵심

- Job/Step/Chunk 기반 처리, 재시도/스킵 설정
- ItemReader/Processor/Writer 분리

## 스케줄링

- 간단 주기: `@Scheduled(cron="0 0 * * * *")`
- 복잡 스케줄: Quartz/Spring Batch 연계, failover 고려

## 체크리스트

- [ ] 배치 재시도/스킵/재처리 설계
- [ ] 상태 저장(JobRepository) DB 관리
- [ ] 스케줄러 단일화/락으로 중복 실행 방지
