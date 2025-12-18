---
title: "Service Mesh (Istio): 마이크로서비스 통신 관리"
date: 2025-12-16
draft: false
topic: "DevOps"
tags: ["Service Mesh", "Istio", "Microservices", "Traffic Management", "Security"]
categories: ["Backend Deep Dive"]
description: "Istio Service Mesh로 마이크로서비스 간 통신을 관리하고 보안을 강화하는 방법"
module: "ops-observability"
study_order: 325
---

## 이 글에서 얻는 것

- **Service Mesh**가 무엇이고 왜 필요한지 이해합니다.
- **Istio**의 핵심 기능을 파악합니다.
- **트래픽 관리**와 **보안** 기능을 활용합니다.
- **마이크로서비스 환경**에서 Service Mesh의 역할을 이해합니다.

## 1) Service Mesh란?

```
기존 방식:
Service A → Service B
- 각 서비스가 직접 통신 로직 구현
- 재시도, 타임아웃, 로드 밸런싱 각자 구현
- 중복 코드, 일관성 문제

Service Mesh:
Service A → Sidecar Proxy → Sidecar Proxy → Service B
           ↓                             ↓
        Control Plane (Istio)

- Proxy가 통신 처리
- 애플리케이션 코드 변경 없음
- 중앙 집중식 관리
```

## 2) Istio 아키텍처

```
Istio = Control Plane + Data Plane

Control Plane (istiod):
- 설정 관리
- 인증서 발급
- 서비스 디스커버리

Data Plane (Envoy Proxy):
- 각 Pod의 Sidecar
- 트래픽 라우팅
- 로드 밸런싱
- mTLS 암호화
```

## 3) 트래픽 관리

### VirtualService (라우팅)

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: reviews
spec:
  hosts:
  - reviews
  http:
  - match:
    - headers:
        user:
          exact: "tester"
    route:
    - destination:
        host: reviews
        subset: v2
  - route:
    - destination:
        host: reviews
        subset: v1
      weight: 90
    - destination:
        host: reviews
        subset: v2
      weight: 10
```

## 4) 보안 (mTLS)

```yaml
# 자동 mTLS 활성화
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
spec:
  mtls:
    mode: STRICT  # 모든 통신 암호화
```

## 요약

- Service Mesh: 마이크로서비스 통신 인프라
- Istio: 트래픽 관리 + 보안 + 관측성
- Sidecar Proxy로 투명한 통신 관리
- 애플리케이션 코드 변경 없이 기능 추가

## 다음 단계

- Kubernetes: `/learning/deep-dive/deep-dive-kubernetes-basics/`
- 마이크로서비스: `/learning/deep-dive/deep-dive-microservices-patterns/`
