---
title: "4단계: 운영 · 배포 · 모니터링"
date: 2025-12-16
draft: false
topic: "Backend Roadmap"
tags: ["DevOps", "CI/CD", "모니터링", "AWS", "Docker"]
categories: ["Learning"]
description: "Docker, CI/CD, 모니터링, 클라우드 배포까지 운영 스택을 갖추는 모듈"
weight: 4
study_order: 300
layout: "learning-module"
module_key: "ops-observability"
url: "/learning/career/backend-ops-observability-phase/"
aliases:
  - "/learning/career/backend-ops-observability-phase/"
---

## 목표

- Docker/Dockerfile 작성, 멀티 스테이지 빌드와 헬스체크 이해
- GitHub Actions 등 CI 파이프라인으로 테스트/빌드 자동화
- Prometheus/Grafana, ELK로 관측성 베이스라인 구축
- AWS EC2+RDS 또는 ECS 배포 경험 쌓기

## 핵심 체크리스트

- [ ] Dockerfile 베스트 프랙티스 (멀티 스테이지, non-root, healthcheck)
- [ ] docker-compose로 앱+DB+Redis 로컬 올리기
- [ ] GitHub Actions: 테스트→빌드→도커 이미지 빌드/푸시 워크플로 작성
- [ ] 배포 전략: Blue/Green 혹은 Rolling 업데이트 개념 적용
- [ ] 모니터링: Spring Actuator + Prometheus scrape + Grafana 대시보드
- [ ] 로깅: JSON 구조 로그, ELK/Opensearch 파이프라인 개념
- [ ] 클라우드: EC2+RDS 배포, ALB 헬스체크, 보안그룹 최소 권한 설정

## 실습 과제

- [ ] `Dockerfile` 멀티 스테이지 빌드 + `HEALTHCHECK` 추가
- [ ] GitHub Actions에서 테스트/빌드 + Docker Hub(ECR) 푸시
- [ ] `/actuator/prometheus` 지표를 Prometheus로 스크랩 → Grafana 대시보드 1개 생성
- [ ] Cloud 환경에서 1회 배포 후, 장애 가정하고 롤백 시나리오 문서화

## 참고 자료

- Docker Docs, AWS Well-Architected, AWS Architecture Center
- Prometheus/Grafana 공식 문서, 구글 SRE
- 실습 팁: 작은 API 서비스라도 CI/CD + 모니터링을 붙여 운영 관점 학습을 체감하기
