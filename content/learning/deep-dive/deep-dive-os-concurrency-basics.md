---
title: "운영체제 기초: 프로세스·스레드·스케줄링"
date: 2025-12-16
draft: false
topic: "CS"
tags: ["OS", "Process", "Thread", "Scheduling", "Concurrency"]
categories: ["Backend Deep Dive"]
description: "프로세스/스레드 차이, 컨텍스트 스위칭, 스케줄링 알고리즘, 동기화 기본"
module: "foundation"
study_order: 25
---

## 핵심 개념

- 프로세스 vs 스레드: 주소 공간 분리 vs 공유
- 컨텍스트 스위칭: PCB 저장/복구 비용, 스레드 수 과다 시 오버헤드
- 스케줄링: FCFS, SJF, RR, 우선순위, 멀티레벨 큐

## 동기화 기초

- 임계구역 보호: Mutex, Semaphore
- 교착상태 조건(상호배제/점유·대기/비선점/환형대기)과 회피

## 실무 적용

- 스레드 수=코어 수보다 과도하면 컨텍스트 스위칭↑ → 풀 크기 제한
- IO 작업은 별도 풀/논블로킹으로 분리, CPU 바운드 작업과 경쟁 줄이기
- 락 순서/타임아웃 설계로 데드락 회피, 모니터링 시 blocked 스레드/스택 추적
- 긴 작업을 전용 워커로 옮기고, OS 스케줄링 영향을 줄이기 위해 우선순위 조정은 신중하게 사용

## 체크리스트

- [ ] 스레드 수를 CPU/IO 특성에 맞게 제한
- [ ] 락 순서/타임아웃 설정으로 교착 방지
- [ ] 스케줄링 영향: CPU 바운드 vs IO 바운드 분리
