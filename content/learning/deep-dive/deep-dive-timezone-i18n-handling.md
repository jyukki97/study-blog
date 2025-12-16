---
title: "타임존·국제화 처리 베스트 프랙티스"
date: 2025-12-16
draft: false
topic: "Architecture"
tags: ["Timezone", "I18n", "Locale", "DateTime"]
categories: ["Backend Deep Dive"]
description: "UTC 저장/표시 변환, Locale별 메시지/포맷, 스케줄·마감 처리 시 주의점"
module: "architecture"
study_order: 495
---

## 시간 처리

- 저장/전송: UTC 기준, `Instant`/`OffsetDateTime` 사용
- 표시: 클라이언트 Locale/타임존에 맞춰 변환
- 반복 일정/마감: DST/윤초 고려, 표현 시점과 저장 시점 분리

## 국제화

- 메시지 번들(locale별), Validation 메시지 i18n
- 포맷: 숫자/날짜/통화 Locale 적용, API는 ISO 형식 유지

## 체크리스트

- [ ] DB/애플리케이션 타임존을 UTC로 일관 설정
- [ ] API 계약은 ISO8601(UTC), 클라이언트에서 변환
- [ ] 스케줄/리마인더는 지역 시간대 변동(DST) 시뮬레이션 테스트
