---
title: "부하 테스트 전략과 성능 튜닝 체크리스트"
date: 2025-12-16
draft: false
topic: "Performance"
tags: ["Load Test", "k6", "JMeter", "Performance Tuning"]
categories: ["DevOps"]
description: "부하 시나리오 설계, 목표 지표(SLI/SLO), 병목 파악과 튜닝 루틴"
module: "ops-observability"
study_order: 350
---

## 시나리오 설계

- 트래픽 패턴: 폭주/램프업/지속 부하
- 사용자 경로: 핵심 API 3~5개, 캐시 미스/히트 비율 포함
- 목표 지표: p95/p99 레이턴시, 에러율, 시스템 리소스

## 도구 예시 (k6)

```js
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = { vus: 50, duration: '2m' };

export default function () {
  const res = http.get('https://api.example.com/orders');
  check(res, { 'status 200': (r) => r.status === 200 });
  sleep(1);
}
```

## 튜닝 루틴

- 프로파일링: CPU/GC/스레드, DB 쿼리, 캐시 히트율 확인
- 커넥션 풀/타임아웃/큐 길이 조정
- CDN/캐시/쿼리 최적화 → 애플리케이션 코드 최적화 순

## 체크리스트

- [ ] SLI/SLO 정의(p95/p99, 에러율)
- [ ] 트래픽 패턴/데이터 세트 준비
- [ ] 테스트 후 병목 원인별 액션 플랜(네트워크/DB/애플리케이션) 수립
