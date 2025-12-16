---
title: "MySQL 트랜잭션 격리 수준과 락"
date: 2025-12-16
draft: false
topic: "Database"
tags: ["MySQL", "Isolation", "Lock", "InnoDB"]
categories: ["Backend Deep Dive"]
description: "READ COMMITTED/REPEATABLE READ 차이, Gap/Next-Key Lock과 데드락 예방법"
module: "data-system"
study_order: 220
---

## 격리 수준 핵심

- READ COMMITTED: 커밋된 최신 버전 읽기, 팬텀 가능
- REPEATABLE READ(InnoDB 기본): 첫 SELECT 스냅샷 유지, 팬텀은 Next-Key Lock으로 차단
- SERIALIZABLE: 모든 SELECT → LOCK IN SHARE MODE

## 락 유형

- 레코드 락: 특정 인덱스 레코드
- 갭 락: 인덱스 사이 간격
- 넥스트키 락: 레코드+갭 (범위 조회 시)

## 데드락 예방 팁

- 일관된 접근 순서(테이블/인덱스/키)
- 작은 트랜잭션 단위, 장시간 트랜잭션 금지
- 범위 조회 시 적절한 인덱스 사용으로 락 범위 축소
- 재시도 로직: 데드락 감지 시 짧은 backoff 후 재실행

## 실습 과제

- [ ] `EXPLAIN`으로 인덱스 사용 여부 확인, 범위 조회의 잠금 범위 비교
- [ ] 동일 데이터에 대한 UPDATE 순서를 바꿔 데드락 재현 후 재시도 로직 적용
- [ ] `innodb_lock_monitor`로 잠금 정보 확인, 슬로우 쿼리 로그와 함께 분석
