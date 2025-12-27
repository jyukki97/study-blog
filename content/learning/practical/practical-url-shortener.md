---
title: "실전 프로젝트 1: URL Shortener (단축 URL 서비스)"
date: 2025-12-28
draft: false
topic: "Practical Project"
tags: ["System Design", "Project", "Cache", "Database"]
categories: ["Practical"]
description: "시스템 설계 인터뷰의 단골 문제, URL 단축 서비스를 직접 설계하고 구현하며 인덱스와 캐시를 이해합니다."
module: "practical"
study_order: 701
url: "/learning/practical/practical-url-shortener/"
---

## 🎯 프로젝트 목표

단순히 `bit.ly` 같은 서비스를 만드는 것이 목표가 아닙니다.  
**"유니크한 ID 생성 전략"**과 **"읽기 중심 부하 분산(Caching)"**을 실제 코드로 구현하고 검증하는 것이 핵심입니다.

## 📋 요구사항 명세 (Spec)

### 1. 기능 요구사항 (Functional)

1. **단축 (Shorten)**: 
    - 사용자가 긴 URL을 입력하면, 짧은 URL(7자 이내)을 반환해야 합니다.
    - 예: `https://my-blog.com/very/long/path...` -> `http://short.ly/X7sz2A`
2. **리다이렉트 (Redirect)**:
    - 단축된 URL로 접속하면, 원래의 긴 URL로 HTTP 302(또는 301) 리다이렉트되어야 합니다.
3. **통계 (Stats) - 선택**:
    - 해당 단축 URL이 몇 번 클릭기되었는지 카운트할 수 있어야 합니다.

### 2. 비기능 요구사항 (Non-Functional)

1. **ID 고유성**: 생성된 단축 ID는 절대 중복되어서는 안 됩니다.
2. **단축 ID 길이**: 가능한 짧아야 합니다 (Base62 등 활용).
3. **성능**: 리다이렉트는 매우 빨라야 합니다 (읽기 요청이 쓰기보다 훨씬 많음, Read-Heavy).

---

## 🏗️ 설계 가이드 (Step-by-Step)

### Step 1: ID 생성 전략 결정

가장 중요한 것은 "어떻게 중복 없는 짧은 문자열을 만들 것인가?"입니다.

- **방법 A: Hash 충돌 해결**  
  - MD5/SHA-256 해시의 앞 7자리를 쓴다면? -> 충돌 가능성 있음. 충돌 시 재시도 로직 필요.
- **방법 B: Auto Increment ID + Base62 Encoding (권장)**  
  - DB의 PK(1, 2, 3...)를 Base62(`0-9, a-z, A-Z`)로 변환합니다.
  - 예: `10,000,000,000` -> `aZK9` (매우 짧아짐)
  - **고민할 점**: 분산 환경에서 DB Auto Increment를 하나만 쓰면 병목이 되지 않을까? (Snowflake ID 고려 가능)

### Step 2: 데이터베이스 스키마 설계

- **Table**: `short_urls`
    - `id` (PK, BigInt)
    - `original_url` (Varchar, Index 필요할까?)
    - `short_key` (Varchar, Unique Index 필수)
    - `created_at`
- **고민**: `original_url`로 이미 생성된게 있는지 조회하려면 인덱스가 필요할까요? 길이가 너무 길면 인덱스 효율이 어떨까요?

### Step 3: 성능 최적화 (Caching)

리다이렉트 요청은 엄청나게 많이 발생할 수 있습니다. 매번 DB를 찌르는 것은 비효율적입니다.

- **Look-aside Cache 전략 적용**:
    1. 요청 들어옴 -> Redis 조회
    2. 있으면 -> 바로 리턴 (DB 접근 X)
    3. 없으면 -> DB 조회 -> Redis 저장 -> 리턴
- **TTL 설정**: URL 매핑이 자주 바뀌지 않으므로 TTL을 길게 가져가도 될까요? 아니면 영구 저장?

---

## 🚀 구현 체크리스트

- [ ] Spring Boot 프로젝트 생성
- [ ] Base62 인코딩/디코딩 유틸리티 구현 (직접 짜보세요!)
- [ ] ShortUrl 엔티티 및 Repository 구현
- [ ] 단축 API (`POST /api/v1/shorten`) 구현
- [ ] 리다이렉트 API (`GET /{shortKey}`) 구현
- [ ] (심화) Redis 연동하여 캐싱 적용
- [ ] (심화) JMeter나 k6로 부하 테스트 해보기

## ❓ 생각할 거리 (Self-Q&A)

1. **301 vs 302 리다이렉트**: 브라우저 캐싱 관점에서 둘의 차이는 무엇이고, 통계 기능을 위해서는 무엇을 써야 할까?
2. **악의적인 사용자**: 누군가 스크립트로 1초에 100만 개의 URL을 생성 요청하면 어떻게 막을까? (Rate Limiting)
3. **DB 용량**: 10억 개의 URL이 생기면 DB 용량은 얼마나 필요할까?

## 📚 참고 자료
- [System Design Primer - URL Shortener](https://github.com/donnemartin/system-design-primer)
- [Base62 Encoding 설명](https://en.wikipedia.org/wiki/Base62)
