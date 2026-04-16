---
title: "2026 개발 트렌드: Tool Permission Manifest + Runtime Attestation, 에이전트 자동화의 병목은 모델이 아니라 권한 증적이다"
date: 2026-04-05
draft: false
tags: ["Tool Permission Manifest", "Runtime Attestation", "AI Agent", "Security", "Platform Engineering", "Governance"]
categories: ["Development", "Learning"]
description: "에이전트 자동화가 확장될수록 실패 원인은 모델 품질보다 권한 드리프트와 실행 증적 부재로 이동합니다. 최근 팀들이 도입하는 Tool Permission Manifest와 Runtime Attestation 운영 패턴을 실무 기준으로 정리합니다."
---

초기 AI 자동화의 관심사는 대부분 "어떤 모델이 더 잘 쓰나"였습니다. 그런데 2026년 들어 운영 현장에서 더 자주 나오는 질문은 이쪽입니다.

- 이 에이전트가 왜 이 툴을 호출했는가?
- 이 권한은 누가, 언제, 어떤 조건으로 승인했는가?
- 사고가 났을 때 실행 경로를 재현할 수 있는가?

실제 운영 사고를 보면, 문제의 시작이 모델 오답이 아닌 경우가 많습니다. 권한 범위가 배포 사이에 조용히 넓어졌거나, 허용된 도구 목록과 런타임 실제 호출이 어긋나면서 예상 밖 액션이 실행됩니다. 그래서 최근 팀들은 프롬프트 튜닝보다 **Tool Permission Manifest(권한 계약 파일) + Runtime Attestation(실행 증적 검증)**를 먼저 붙이고 있습니다.

핵심은 "에이전트가 똑똑한가"가 아니라, **에이전트가 무엇을 할 수 있는지를 사람이 감사 가능한 형태로 고정했는가**입니다.

## 이 글에서 얻는 것

- 왜 에이전트 운영 실패가 모델 품질보다 권한 관리 실패에서 더 자주 발생하는지 이해할 수 있습니다.
- permission manifest와 runtime attestation을 어디에 두어야 실효성이 있는지 아키텍처 관점으로 정리할 수 있습니다.
- 도입 시 필요한 의사결정 기준(허용 권한 범위, 승인 조건, 증적 보존 기간)을 숫자·조건 중심으로 가져갈 수 있습니다.

## 핵심 개념/이슈

### 1) 권한 드리프트가 자동화 시스템의 숨은 장애 원인이다

권한 드리프트는 보통 이렇게 생깁니다.

- 급한 핫픽스에서 임시 예외를 추가하고 회수하지 않음
- 개발/운영 환경의 툴 allowlist가 분리되지 않음
- 툴 버전 업데이트 후 새 액션 스코프가 자동으로 열림

이때 사고 패턴은 "명백한 해킹"보다 "정상 플로우처럼 보이는 과권한 실행"에 가깝습니다. 기존에 다룬 [AI 코딩 에이전트 런타임 거버넌스](/posts/2026-03-04-ai-coding-agent-runtime-governance-trend/)와 [Prompt Firewall + DLP](/posts/2026-03-25-llm-gateway-prompt-firewall-dlp-trend/)가 중요한 이유도 같은 맥락입니다.

### 2) Tool Permission Manifest는 문서가 아니라 배포 단위 계약이어야 한다

운영팀이 실제로 효과를 보는 방식은 "위키 페이지"가 아니라 배포 아티팩트로 권한을 고정하는 것입니다.

manifest 최소 필드 예시:

- `tool_id`, `allowed_actions`, `risk_level`
- `required_approvals`(예: low=0, medium=1, high=2)
- `data_scope`(읽기 전용/특정 경로/특정 테이블)
- `expiry`(예외 권한 만료일)
- `owner`(서비스 책임자)

중요한 점은 manifest가 코드와 함께 버전 관리되고, PR 리뷰를 거쳐야 한다는 것입니다. 그래야 "언제 누가 권한을 넓혔는지"를 추적할 수 있습니다.

### 3) Runtime Attestation은 로그 수집이 아니라 "실행 전후 검증"이다

많은 팀이 로그를 남기지만, 사고가 터지면 "로그는 있는데 신뢰할 수 없다"는 문제가 생깁니다. Runtime attestation은 단순 로그와 다릅니다.

- 실행 전: 요청된 액션이 manifest와 일치하는지 검증
- 실행 중: 승인 토큰/세션 컨텍스트/정책 버전 해시를 캡처
- 실행 후: 결과와 증적을 불변 저장소(append-only)로 기록

즉 "호출 기록"이 아니라 **정책 준수 여부를 증명하는 체인**을 남기는 것입니다. 이 접근은 [Schema-Constrained Output + Runtime Validator](/posts/2026-04-04-schema-constrained-output-runtime-validator-trend/)의 계약 중심 운영과 같은 방향입니다.

### 4) 고위험 액션은 자동화율보다 승인 지연 상한이 더 중요하다

삭제·외부 전송·권한 변경 같은 고위험 액션에서 "완전 자동화율"만 KPI로 두면, 결국 정책 우회가 발생합니다. 최근 팀들은 KPI를 이렇게 바꿉니다.

- 고위험 자동 실행률이 아니라 "승인 포함 총 리드타임 p95"
- 승인 대기 중 누락 건수(만료/취소) 비율
- 승인 후 되돌림(rollback) 발생률

결국 성숙한 팀은 빠른 자동화보다 **예측 가능한 통제 리드타임**을 먼저 최적화합니다.

## 실무 적용

### 1) 운영 기준 아키텍처

권장 흐름은 아래처럼 단순하게 시작하는 것이 좋습니다.

1. 에이전트가 툴 호출 의도를 생성
2. policy gateway가 manifest와 액션 스코프를 대조
3. 위험도에 따라 자동 승인/단일 승인/이중 승인 분기
4. 실행 시 attestation 레코드(정책 해시, 승인자, 입력 요약) 생성
5. 결과와 함께 불변 저장소에 적재, 대시보드로 노출

이 구조를 적용하면 모델을 바꿔도 통제 계층을 유지할 수 있습니다. 비용/품질 최적화는 [Inference Router 품질·비용 게이트](/posts/2026-04-03-inference-router-quality-cost-gateway-trend/)로 분리해 관리하는 편이 안정적입니다.

### 2) 의사결정 기준(숫자·조건·우선순위)

우선순위는 **무단 실행 방지 > 감사 가능성 확보 > 운영 속도 > 비용** 순으로 잡는 것이 안전합니다.

초기 도입 기준 예시:

- 미등록 툴 호출 차단률: 100%
- manifest 없는 고위험 액션 실행률: 0%
- 승인 리드타임 p95: 5분 이내
- 승인 후 rollback 비율: 1% 미만
- 증적 누락률(attestation record missing): 0.1% 미만

자동 완화 규칙 예시:

- 동일 세션에서 deny 3회 연속이면 자동 escalated review로 전환
- 고위험 액션 승인 대기 10분 초과 시 담당 온콜 알림
- 증적 누락 1건 이상 발생 시 관련 자동 실행 즉시 중지(수동 모드 전환)

실무에서는 "얼마나 많이 자동화했는가"보다 "문제가 생겼을 때 10분 내 설명 가능한가"를 기준으로 보는 편이 맞습니다.

### 3) 4주 도입 플랜

**1주차: 권한 인벤토리**  
현재 에이전트가 호출 가능한 툴·액션을 전수 조사하고 위험도를 low/medium/high로 분류합니다.

**2주차: manifest 최소 스키마 적용**  
핵심 워크플로 5개에 대해 allowlist와 승인 조건을 코드 저장소에 고정합니다.

**3주차: attestation 파이프라인 연결**  
실행 전 정책 대조 + 실행 후 증적 저장을 붙이고, 누락률 대시보드를 만듭니다.

**4주차: 승인 운영 최적화**  
승인 병목 상위 3개를 줄여 p95 리드타임을 목표 범위로 맞춥니다.

승인 흐름 설계는 [Approval-Driven Auto-Remediation](/posts/2026-03-17-approval-driven-auto-remediation-trend/) 글과 함께 보면 바로 적용하기 쉽습니다.

## 트레이드오프/주의점

1) **초기엔 개발 속도가 느려진다**  
manifest 작성과 승인 규칙 설계가 추가되므로 PoC 속도는 떨어질 수 있습니다.

2) **정책을 과도하게 세분화하면 운영 복잡도가 급증한다**  
툴마다 예외 규칙이 많아지면 승인자가 오히려 판단을 못 하게 됩니다.

3) **attestation 저장 비용이 무시할 수준이 아니다**  
장기 보존 정책(예: 90일 hot, 1년 cold)을 설계하지 않으면 비용이 빠르게 커집니다.

4) **승인자를 병목으로 만들면 결국 비공식 우회가 생긴다**  
승인 SLA와 백업 승인자를 명확히 두지 않으면 정책 준수율이 떨어집니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 고위험 툴 액션에 대해 manifest(권한/소유자/만료일)가 정의되어 있다.
- [ ] 실행 전 정책 대조와 실행 후 attestation 기록이 모두 자동화되어 있다.
- [ ] 승인 규칙이 위험도별로 분리되어 있고 SLA가 명시되어 있다.
- [ ] 증적 누락률/승인 지연/rollback 비율을 주간 지표로 추적한다.
- [ ] 임시 예외 권한의 만료일과 회수 책임자가 지정되어 있다.

### 연습 과제

1. 현재 운영 중인 자동화 워크플로 3개를 골라, 각 워크플로의 툴 액션을 `low/medium/high`로 재분류해 보세요.  
2. 고위험 액션 1개를 선택해 manifest 필드(허용 범위, 승인자, 만료일, 증적 필드)를 실제 YAML 형태로 작성해 보세요.  
3. 지난 1주 실행 로그에서 "승인 없이 실행됐으면 위험했을 액션"을 5건 뽑아, attestation 체인으로 재현 가능한지 점검해 보세요.

## 관련 글

- [AI 코딩 에이전트 런타임 거버넌스](/posts/2026-03-04-ai-coding-agent-runtime-governance-trend/)
- [Schema-Constrained Output + Runtime Validator](/posts/2026-04-04-schema-constrained-output-runtime-validator-trend/)
- [Inference Router 품질·비용 게이트](/posts/2026-04-03-inference-router-quality-cost-gateway-trend/)
- [LLM Gateway Prompt Firewall + DLP](/posts/2026-03-25-llm-gateway-prompt-firewall-dlp-trend/)
- [승인형 Auto-Remediation 운영](/posts/2026-03-17-approval-driven-auto-remediation-trend/)
- [AI 코드 Provenance/SBOM](/posts/2026-03-08-ai-code-provenance-and-sbom-trend/)
