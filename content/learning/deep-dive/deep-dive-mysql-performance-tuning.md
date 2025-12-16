---
title: "MySQL 성능 튜닝: 슬로우 쿼리와 커넥션 풀"
date: 2025-12-16
draft: false
topic: "Database"
tags: ["MySQL", "Performance", "Slow Query", "HikariCP"]
categories: ["Backend Deep Dive"]
description: "슬로우 쿼리 로그, 커넥션 풀(HikariCP) 파라미터, 실행 계획 튜닝 포인트"
module: "data-system"
study_order: 215
---

## 슬로우 쿼리 로그

- 활성화: `slow_query_log=1`, `long_query_time=1`
- 쿼리별 실행 계획/실행 시간 분석 → 인덱스/쿼리 리라이트

## 커넥션 풀 (HikariCP)

- 핵심 파라미터: `maximumPoolSize`, `minimumIdle`, `connectionTimeout`, `idleTimeout`
- DB 연결 제한과 애플리케이션 스레드 수를 함께 고려

```properties
spring.datasource.hikari.maximum-pool-size=30
spring.datasource.hikari.connection-timeout=2000
```

## 체크리스트

- [ ] 슬로우 쿼리 상위 N개 주기적 점검
- [ ] 풀 사이즈를 DB 커넥션 한도/CPU 코어에 맞춰 설정
- [ ] 타임아웃/validationQuery 설정으로 커넥션 고립 방지
- [ ] 실행 계획 튜닝 후 지표(쿼리 시간/락 대기) 비교
