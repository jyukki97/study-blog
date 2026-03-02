---
title: "운영 중 스키마 변경 실전: Online DDL + Expand/Contract 패턴"
date: 2026-03-01
draft: false
topic: "Database"
tags: ["Online DDL", "Expand-Contract", "MySQL", "Schema Migration", "Zero Downtime"]
categories: ["Backend Deep Dive"]
description: "서비스를 멈추지 않고 DB 스키마를 변경할 때 필요한 실무 기준, 트레이드오프, 흔한 실수와 점검 루틴을 정리합니다."
module: "database"
study_order: 531
---

## 이 글에서 얻는 것

- 무중단 스키마 변경에서 **왜 Expand/Contract가 표준 패턴인지** 설명할 수 있습니다.
- Online DDL, shadow table(gh-ost/pt-osc) 선택 기준을 **트래픽/테이블 크기/운영 제약** 기준으로 정리할 수 있습니다.
- 실무에서 자주 터지는 실패 패턴(락, 롤백 실패, 앱-DB 버전 불일치)을 미리 피할 수 있습니다.

---

## 1) 문제 정의: "ALTER TABLE 한 번"이 왜 장애가 되는가

운영 DB는 개발 DB와 다릅니다.

- 테이블이 수천만~수억 건
- 트래픽이 24시간 지속
- 앱 서버가 롤링 배포 중(구버전/신버전 공존)

이때 단순한 `ALTER TABLE ...`은 메타데이터 락 또는 긴 백그라운드 작업으로
**읽기/쓰기 지연 급증**을 만들 수 있습니다.

핵심은 SQL 문법이 아니라,
**앱 버전 호환성 + 데이터 전환 순서 + 롤백 가능성**입니다.

---

## 2) 실무 기준: Expand/Contract 3단계

### 단계 1) Expand (호환 가능한 확장)

- 새 컬럼/새 인덱스/새 테이블을 먼저 추가
- 기존 코드가 깨지지 않게 backward compatible 상태 유지

예)
- `status` 컬럼 추가 (nullable)
- 신규 인덱스 추가
- 기존 컬럼/테이블은 아직 제거하지 않음

### 단계 2) Migrate (이중 쓰기/백필)

- 앱에서 구/신 스키마를 함께 처리
- 배치/스트리밍으로 과거 데이터 백필
- 검증 지표(누락률, 지연, 에러율) 모니터링

### 단계 3) Contract (정리)

- 신 스키마 100% 전환 확인 후 구 컬럼 제거
- 이 단계는 반드시 별도 배포로 분리

> 원칙: **추가(Expand)와 삭제(Contract)를 같은 배포에서 하지 않는다.**

---

## 3) 어떤 방식으로 변경할까? (선택 기준)

### A. DB Native Online DDL (MySQL 8 INPLACE/INSTANT)

- 장점: 도구 단순, 운영 복잡도 낮음
- 단점: 작업 유형에 따라 여전히 락/재빌드 발생 가능
- 적합: 컬럼 추가, 인덱스 추가 등 "지원되는" 케이스

### B. Shadow Table 기반 (gh-ost, pt-online-schema-change)

- 장점: 대형 테이블에서 안전하게 점진 복사 + cut-over 가능
- 단점: 설정/모니터링/컷오버 운영 난이도 상승
- 적합: 트래픽 높고 테이블이 큰 핵심 테이블

### C. 서비스 레벨 우회 (신규 테이블로 이관)

- 장점: DB 락 리스크 축소, 점진 전환 용이
- 단점: 애플리케이션 코드 복잡도 증가
- 적합: 구조 변화가 큰 경우(컬럼 rename 수준을 넘어 모델 변경)

---

## 4) 트레이드오프: 안전성 vs 속도

- **빠르게 끝내기**를 선택하면
  - 배포 횟수는 줄지만, 실패 시 복구 난이도가 커집니다.
- **단계 분리(Expand → Migrate → Contract)**를 선택하면
  - 배포와 검증 비용은 늘지만, 장애 확률과 blast radius가 줄어듭니다.

실무에서는 대부분 "빠른 1회성 변경"보다
**작게 나눠서 되돌릴 수 있는 변경**이 이깁니다.

---

## 5) 자주 하는 실수

1. **컬럼 rename을 즉시 수행**
   - 많은 DB에서 내부적으로 drop/add에 가깝게 동작할 수 있습니다.
   - 안전한 방식은 `new_column 추가 → 이중 쓰기 → 읽기 전환 → old_column 제거`입니다.

2. **백필 완료 전에 Contract 실행**
   - 일부 레코드가 구 스키마에만 남아 데이터 유실로 이어집니다.

3. **롤백 경로를 코드에 준비하지 않음**
   - DB는 바뀌었는데 앱만 롤백하면 더 위험해집니다.
   - 최소 1개 배포 주기 동안 구/신 스키마 공존 코드를 유지해야 합니다.

4. **컷오버 시간대 무시**
   - 피크 시간 컷오버는 작은 락도 큰 장애로 증폭됩니다.

---

## 6) 운영 체크리스트

- 변경 유형별 Online DDL 지원 여부 사전 확인
- Expand/Contract를 서로 다른 릴리스로 분리
- 백필 진행률/누락률 대시보드 준비
- 컷오버 전후 슬로우 쿼리/락 대기 모니터링
- 롤백 시나리오(앱 롤백 + DB 호환성) 리허설 완료

---

## 7) 연습 문제

1. `orders` 테이블(8억 건)에 `channel` 컬럼을 추가한다고 가정하고,
   - Native Online DDL vs gh-ost 중 선택 근거를 작성해보세요.
2. `user_status` 컬럼명을 `account_status`로 바꿔야 할 때,
   - Expand/Contract 단계별 배포 계획(앱/DB/모니터링)을 설계해보세요.
3. 백필 중 0.3% 누락이 발견된 상황에서,
   - 즉시 조치 / 배포 보류 / 재검증 절차를 문서화해보세요.

---

## 요약

- 무중단 스키마 변경의 핵심은 SQL 기술보다 **배포 순서와 호환성 설계**입니다.
- Online DDL 도구 선택은 "가능 여부"보다 **롤백 가능성/운영 복잡도**까지 포함해 판단해야 합니다.
- Expand/Contract를 습관화하면, 큰 테이블 변경도 안전하게 반복할 수 있습니다.

---

## 🔗 관련 글 / 다음 글

- [데이터베이스 마이그레이션: Flyway로 스키마 버전 관리하기](/learning/deep-dive/deep-dive-database-migration/)
- [트래픽 컷오버 & 데이터 마이그레이션 전략](/learning/deep-dive/deep-dive-traffic-cutover-migration/)
- [DB 병목 대응 순서 Q&A](/learning/qna/db-bottleneck-troubleshooting-framework-qna/)
