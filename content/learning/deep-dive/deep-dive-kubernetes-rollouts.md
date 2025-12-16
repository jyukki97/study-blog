---
title: "Kubernetes 롤아웃 전략과 무중단 배포"
date: 2025-12-16
draft: false
topic: "DevOps"
tags: ["Kubernetes", "Deployment", "RollingUpdate", "BlueGreen", "Canary"]
categories: ["DevOps"]
description: "RollingUpdate, Canary, Blue/Green 전략과 실습 체크리스트"
module: "ops-observability"
study_order: 315
---

## 핵심 전략 비교

- **RollingUpdate**: 기본 전략, `maxUnavailable`/`maxSurge`로 가용성-속도 조절
- **Canary**: 소수 Replica로 새 버전 배포 후 트래픽 점진 전환 (Ingress/Service 분리)
- **Blue/Green**: 완전히 분리된 환경, 스위칭만으로 전환/롤백

## 설정 포인트

- `readinessProbe`/`livenessProbe`로 트래픽 유입 전 안정성 확보
- `preStop` 훅 + `terminationGracePeriodSeconds`로 연결 드레인
- 리소스 요청/제한을 먼저 설정해 HPA/스케줄러 영향 최소화

## 실습 과제

- [ ] RollingUpdate 파라미터 변경 전/후 배포 시간 및 중단 여부 비교
- [ ] Ingress 분리로 Canary 10%/50%/100% 트래픽 전환 실습
- [ ] Blue/Green용 두 Deployment/Service 구성 후 DNS/Ingress 스위칭 테스트
- [ ] 실패 시 롤백 절차 스크립트화 (`kubectl rollout undo`, 라벨 스위치)

## 참고

- Kubernetes 공식 문서: Deployment, Probes, RollingUpdate
- 서비스 메시(Istio/Linkerd) 사용 시 Canary 트래픽 분할을 더 세밀하게 설정 가능
