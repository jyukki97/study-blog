---
title: "JVM GC 튜닝 실무 가이드"
date: 2025-12-16
draft: false
topic: "Backend"
tags: ["JVM", "GC", "Tuning", "Performance"]
categories: ["Backend Deep Dive"]
description: "GC 로그 해석, Young/Old 튜닝 포인트, GC 선택(G1/ZGC) 가이드"
module: "foundation"
study_order: 75
---

## GC 선택

- 서버 애플리케이션: G1 기본, 저지연 필요 시 ZGC/SHENANDOAH 검토
- 파라미터는 기본값 우선, 문제 발생 시 최소 조정

## 로그 해석

- `-Xlog:gc*:file=gc.log:time,uptime,level,tags`
- 지표: GC Pause, Frequency, Promotion Failed, Concurrent Cycle 시간

## 튜닝 포인트

- 힙/스레드 스택 크기, `MaxGCPauseMillis` 목표
- 객체 생존율 → Eden/Survivor 크기 조정
- 대용량 할당/배치 → `-XX:+AlwaysPreTouch`, 메모리 파편 주의
- 추천 기본값 예시(G1):
  - `-XX:+UseG1GC -XX:MaxGCPauseMillis=200 -XX:+AlwaysPreTouch`
  - 필요 시 `-XX:InitiatingHeapOccupancyPercent=45` 등 최소만 조정

## 체크리스트

- [ ] GC 로그 수집/시각화 도입
- [ ] Pause 목표 설정 및 실제 측정 비교
- [ ] 메모리 누수/대용량 객체 존재 여부 확인(힙 덤프)
- [ ] Promotion 실패/메타스페이스 OOM 여부 로그로 확인
