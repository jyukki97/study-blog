---
title: "배포 체크리스트 & 롤백 런북"
date: 2025-12-16
draft: false
topic: "Ops"
tags: ["Deployment", "Rollback", "Runbook", "Checklist"]
categories: ["DevOps"]
description: "배포 전/후 체크리스트, 롤백 절차와 온콜 대응을 문서화한 런북 예시"
module: "ops-observability"
study_order: 380
---

## 배포 전
- [ ] 변경 목록/마이그레이션 스텝 확인, 피처 플래그 준비
- [ ] 헬스체크/알람 상태 점검
- [ ] DB 마이그레이션 순서/롤백 계획 확인

## 배포 중
- [ ] 블루/그린 혹은 롤링 진행 여부 결정
- [ ] 에러율/레이턴시/자원 지표 모니터링
- [ ] 필요 시 트래픽 컷오버 속도 조절

## 롤백 런북
- [ ] 롤백 명령/스텝 명시 (예: `kubectl rollout undo`, 라벨 스위치)
- [ ] 데이터 변경이 있으면 역마이그레이션/스냅샷 복구 절차 포함
- [ ] 롤백 후 검증 체크리스트(헬스체크, 코어 기능)
