---
title: "3단계: 데이터베이스 & 데이터 시스템"
date: 2025-12-16
draft: false
topic: "Backend Roadmap"
tags: ["데이터베이스", "데이터시스템", "Redis", "Kafka"]
categories: ["Learning"]
description: "인덱스/트랜잭션/락/캐시/메시징으로 데이터 시스템의 성능·정합성·확장성을 다지는 모듈"
weight: 3
study_order: 200
layout: "learning-module"
module_key: "data-system"
url: "/learning/modules/backend-data-system-phase/"
aliases:
  - "/learning/modules/backend-data-system-phase/"
learning_refs:
  - title: "Bulk Import Job, 대량 업로드 운영 설계"
    href: "/learning/deep-dive/deep-dive-bulk-import-job-row-error-playbook/"
    description: "CSV·엑셀·JSONL 업로드를 상태 있는 import job, row error, 멱등성, 부분 성공 정책으로 설계합니다."
  - title: "Async Request-Reply Operation Resource"
    href: "/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/"
    description: "처리 시간이 긴 데이터 변경 작업을 202 Accepted와 상태 조회 API로 분리하는 계약입니다."
  - title: "Batch Idempotency/Reprocessing"
    href: "/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/"
    description: "배치 재실행, 체크포인트, 멱등 키, 중복 효과 방지를 운영 기준으로 정리합니다."
  - title: "Workload-aware Queue Partitioning"
    href: "/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/"
    description: "대형 job과 온라인 트래픽이 서로 밀어내지 않도록 큐와 worker pool을 나누는 방법입니다."
---

## 이 단계에서 얻는 것

이 단계는 “스프링을 안다”에서 한 단계 더 나아가, **데이터/정합성/성능**을 근거 있게 다룰 수 있게 만드는 구간입니다.

- **DB 성능 감각**: 인덱스/실행 계획을 보고 “왜 느린지”를 추적하고, 튜닝 방향을 세울 수 있습니다.
- **정합성 감각**: 트랜잭션/격리 수준/락/데드락을 이해해서 “깨지지 않는” 설계를 할 수 있습니다.
- **캐시/메시징 감각**: Redis 캐시 패턴, Kafka/Outbox 같은 비동기 설계를 “언제/왜” 쓰는지 연결할 수 있습니다.
- **데이터 관측/운영 감각**: “느린 쿼리/락 대기/캐시 미스/컨슈머 지연” 같은 신호를 지표/로그로 연결합니다.

## 이 모듈을 보는 방법

이 페이지 아래에 연결된 글이 순서대로 정렬됩니다.

1) 인덱스/실행 계획으로 “느림”을 해부하고  
2) 트랜잭션/락으로 “정합성”을 확보하고  
3) 캐시/메시징으로 “확장/운영”을 설계하는 흐름으로 읽으면 좋습니다.

각 글의 연습은 “완성 프로젝트”가 목표가 아니라, **작은 재현/관찰**로 감각을 만드는 것이 목표입니다.

## 왜 이런 순서인가

데이터 관련 문제는 결국 다음 순서로 좁혀집니다.

- 쿼리가 느리다 → 실행 계획/인덱스/풀/락 대기 중 어디가 원인인지 분해  
- 정합성이 깨진다 → 트랜잭션 경계/격리 수준/동시성 제어를 재설계  
- 트래픽이 커진다 → 캐시/비동기/샤딩 같은 확장 전략을 선택  

그래서 “인덱스/EXPLAIN → 트랜잭션/락 → 캐시/메시징 → 설계 문제” 순서를 기본으로 둡니다.

## 이 단계의 핵심 주제

- 인덱스/실행 계획/쿼리 튜닝
- 트랜잭션/격리 수준/락/데드락
- 캐시 전략(Cache-Aside/Write-Through/Stampede)
- 메시징/이벤트 기반 설계(Kafka, Outbox)
- 데이터 관측(슬로우 쿼리/락 대기/컨슈머 지연)

## 데이터 변경 파이프라인으로 확장하기

데이터 시스템을 공부할 때 인덱스와 트랜잭션까지만 보면 "DB를 잘 쓰는 법"에서 멈추기 쉽습니다. 실무에서는 그다음 질문이 더 자주 나옵니다. 관리자가 엑셀 20만 행을 올리면 어떻게 처리할지, 외부 파트너 파일을 다시 받으면 중복 반영을 어떻게 막을지, 배치가 절반만 성공했을 때 어떤 기준으로 재처리할지 같은 문제입니다.

이런 작업은 단순 CRUD가 아니라 **상태를 가진 데이터 변경 파이프라인**으로 봐야 합니다. 요청 하나가 오래 걸리고, 일부 row가 실패하며, 사용자가 같은 파일을 다시 올리고, worker가 온라인 DB와 자원을 공유하는 상황을 모두 정상 경로로 다룹니다. 그래서 이 모듈의 후반부는 `쿼리 튜닝 → 정합성 제어 → 비동기 처리 → 재처리/대조` 순서로 확장해서 읽는 편이 좋습니다.

추천 흐름은 아래와 같습니다.

1. [Async Request-Reply Operation Resource](/learning/deep-dive/deep-dive-async-request-reply-operation-resource-playbook/)로 긴 작업을 동기 응답에서 분리합니다.
2. [Bulk Import Job, 대량 업로드 운영 설계](/learning/deep-dive/deep-dive-bulk-import-job-row-error-playbook/)로 파일 업로드, 검증, dry-run, apply, row error를 하나의 job 모델로 묶습니다.
3. [Batch Idempotency/Reprocessing](/learning/deep-dive/deep-dive-batch-idempotency-reprocessing/)으로 같은 입력이 다시 들어와도 같은 업무 효과가 두 번 나지 않게 만듭니다.
4. [Workload-aware Queue Partitioning](/learning/deep-dive/deep-dive-workload-aware-queue-partitioning-fair-scheduling/)으로 대형 import와 짧은 온라인 후처리 작업이 같은 큐에서 서로 막지 않게 분리합니다.
5. [Reconciliation Ledger Pipeline](/learning/deep-dive/deep-dive-reconciliation-ledger-pipeline/)으로 원장, 파생 테이블, 외부 시스템 사이의 불일치를 주기적으로 확인합니다.

### 실무 판단 체크리스트

- 처리 시간이 5초를 넘거나 row 수가 1,000개를 넘을 수 있으면 동기 API 대신 operation resource를 검토했는가?
- 업로드 성공, 검증 성공, 실제 반영 성공을 서로 다른 상태로 나누었는가?
- 파일 단위 fingerprint와 row 단위 effect key를 분리해 중복 업로드와 중복 반영을 따로 막는가?
- 부분 성공 허용률, 자동 중단 기준, 사람 승인 기준이 숫자로 정해져 있는가?
- 대형 job이 온라인 트래픽의 DB CPU, lock wait, queue lag를 악화시키면 자동 throttle 또는 pause할 수 있는가?
- 재처리 후에는 성공 로그뿐 아니라 reconciliation이나 샘플 대조로 실제 side effect를 확인하는가?

이 관점을 잡으면 데이터 시스템 학습이 "쿼리를 빠르게 만든다"에서 끝나지 않습니다. 느린 쿼리, 락, 캐시 미스, 큐 지연, 재처리, 데이터 불일치를 하나의 운영 흐름으로 연결할 수 있습니다. 특히 백오피스 import, 정산, 권한 변경, 파트너 동기화처럼 장애가 조용히 데이터 오염으로 번지는 기능에서는 이 흐름이 필수에 가깝습니다.

## 미니 실습

- **EXPLAIN 읽기**: 느린 쿼리를 만들고 실행 계획으로 병목 찾기
- **락/데드락 재현**: 트랜잭션 두 개로 락 대기 상황 만들기
- **캐시 스탬피드 방지**: TTL 지터 또는 락으로 붐 방지 실험
- **Import job 모델링**: 업로드/검증/apply/부분 실패 상태와 row error 코드를 표로 정의
- **재처리 안전성 점검**: 같은 파일을 두 번 실행해도 중복 효과가 나지 않는 멱등 키 설계

## 완료 기준 (다음 단계로 넘어가기 전)

- EXPLAIN을 보고 `ALL/filesort/temporary` 같은 위험 신호를 읽고, 인덱스/쿼리 개선 방향을 말로 설명할 수 있다
- 격리 수준/락 때문에 생기는 현상(데드락/락 대기)을 로그/지표로 구분할 수 있다
- 캐시를 “붙여서 빨라졌다”가 아니라, 키/TTL/무효화/스탬피드까지 포함해 설계할 수 있다
- 대량 데이터 변경을 동기 API, 비동기 operation, 배치 job 중 어디에 둘지 판단할 수 있다
- 재처리와 reconciliation 기준을 함께 설명할 수 있다
