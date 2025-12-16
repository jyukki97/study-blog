---
title: "API 레이트 리밋과 백프레셔 심화"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["Rate Limit", "Backpressure", "API Gateway", "Resilience"]
categories: ["Backend Deep Dive"]
description: "API Gateway 레이트 리밋, 애플리케이션 레벨 백프레셔, 큐/서킷 브레이커 연계"
module: "architecture"
study_order: 470
---

## Gateway 레벨

- 글로벌/사용자별 할당량, burst 제한
- 분산 환경: Redis/Lua, 토큰 버킷/슬라이딩 윈도우 활용

## 앱 레벨 백프레셔

- 큐 길이/세마포어로 처리량 제한, 초과 시 즉시 실패 혹은 스로틀
- 서킷 브레이커/리트라이/백오프 조합

## 체크리스트

- [ ] 레이트 리밋/백프레셔 위치 구분(Gateway vs App)
- [ ] 실패 응답/재시도 정책 명시
- [ ] 모니터링: 차단율, 대기열 길이, 지연
