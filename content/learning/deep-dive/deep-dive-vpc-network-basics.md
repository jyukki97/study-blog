---
title: "클라우드 네트워크 기초: VPC/Subnet/보안그룹"
date: 2025-12-16
draft: false
topic: "Networking"
tags: ["VPC", "Subnet", "Security Group", "NACL"]
categories: ["DevOps"]
description: "VPC, 서브넷, 라우팅, 보안그룹/네트워크 ACL 개념과 설계 체크리스트"
module: "ops-observability"
study_order: 370
---

## 핵심 개념

- VPC: 격리된 가상 네트워크, CIDR 블록 할당
- Subnet: AZ별 네트워크 구간, 퍼블릭/프라이빗 분리
- Security Group: 상태 저장 방화벽(인바운드/아웃바운드)
- NACL: 서브넷 단위, 상태 비저장 룰

## 체크리스트

- [ ] 퍼블릭/프라이빗 서브넷 분리, NAT 게이트웨이로 아웃바운드
- [ ] SG 최소 권한: 필요 포트만 허용, 소스/대상 제한
- [ ] NACL 기본 allow, 필요 시 차단 룰 추가
- [ ] 라우팅 테이블: 인터넷 게이트웨이/NAT/프라이빗 경로 확인
