---
title: "시스템 설계: URL Shortener"
date: 2025-12-16
draft: false
topic: "System Design"
tags: ["System Design", "URL Shortener", "Hash", "Cache", "DB"]
categories: ["Backend Deep Dive"]
description: "Key 생성, 충돌 방지, 캐시/DB 설계, 확장성·가용성 고려사항 정리"
module: "data-system"
study_order: 34
---

## 요구사항 요약

- 긴 URL → 짧은 키로 매핑, 고가용성/낮은 지연
- 커스텀 별칭 지원, 만료/통계(optional)

## 설계 포인트

- **Key 생성**: Base62, UUID → 해시 후 충돌 체크, 혹은 Snowflake/DB 시퀀스 + Base62 변환
- **저장소**: RDB(트랜잭션, 카운팅) + Redis 캐시 (최근 조회), CDN 캐싱 고려
- **리다이렉트 경로**: `GET /:code` → 캐시 조회 → 없으면 DB → 캐시에 적재
- **충돌/중복**: 선 점검 후 INSERT, Unique 제약
- **확장성**: 샤딩 키로 code 분배, Read replica로 조회 분산
- **가용성**: 캐시 TTL/슬라이딩, 헬스체크 + 다중 AZ, 지연 시 Graceful Degradation

## 체크리스트

- [ ] 캐시 미스 스톰 방지(랜덤 TTL, 미스 캐시)
- [ ] 카운트/통계는 비동기 적재(Kafka/Queue) 후 배치 집계
- [ ] 커스텀 별칭은 별도 테이블/Unique 제약으로 관리
- [ ] API 레이트 리밋 적용 (IP/User 기준)
