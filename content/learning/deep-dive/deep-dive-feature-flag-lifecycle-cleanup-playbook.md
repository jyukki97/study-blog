---
title: "백엔드 커리큘럼 심화: Feature Flag Lifecycle Cleanup, 오래된 플래그가 운영 부채가 되지 않게 하는 법"
date: 2026-05-26
draft: false
topic: "Release Engineering"
tags: ["Feature Flag", "Release Engineering", "Cleanup", "Technical Debt", "Control Plane", "Backend Reliability"]
categories: ["Backend Deep Dive"]
description: "기능 플래그를 안전한 릴리스 장치로 쓰되, 오래된 if문과 실험 토글이 운영 부채가 되지 않도록 생명주기, 만료 기준, 정리 자동화를 숫자 중심으로 정리합니다."
module: "release-reliability"
study_order: 1243
---

피처 플래그는 배포와 릴리스를 분리하는 강력한 도구입니다. 하지만 운영 기간이 길어질수록 더 자주 보는 사고는 "플래그가 없어서 장애가 났다"보다 "플래그가 너무 많아서 누가 무엇을 켜도 되는지 모른다" 쪽입니다. 새 checkout, 새 권한 정책, 추천 실험, 임시 우회, 장애 완화 스위치가 모두 같은 테이블에 쌓이면 플래그 시스템은 릴리스 장치가 아니라 작은 control plane이 됩니다.

이 글은 [피처 플래그 기본](/learning/deep-dive/deep-dive-feature-flags/), [배포 런북](/learning/deep-dive/deep-dive-deployment-runbook/), [Control Plane/Data Plane 분리](/learning/deep-dive/deep-dive-control-plane-data-plane-separation-playbook/), [Policy-driven Progressive Delivery](/posts/2026-03-27-policy-driven-progressive-delivery-trend/)와 이어집니다. 핵심은 플래그를 덜 쓰자는 말이 아니라, **생성할 때부터 제거 조건을 같이 배포**하자는 것입니다.

## 이 글에서 얻는 것

- 플래그를 release flag, experiment flag, ops kill switch, permission/config flag로 나누는 기준을 잡습니다.
- 플래그 생성 시 owner, expiry, rollback window, cleanup trigger를 어떻게 기록해야 하는지 이해합니다.
- 오래된 플래그를 CI, 대시보드, 정기 리뷰로 제거하는 실무 루프를 만들 수 있습니다.
- 너무 빠른 제거와 너무 늦은 제거 사이의 트레이드오프를 숫자로 판단할 수 있습니다.

## 핵심 개념/이슈

### 1) 모든 플래그를 같은 수명으로 보면 안 된다

플래그는 겉으로는 boolean 하나지만 목적이 다릅니다. 목적이 다르면 제거 기준도 달라야 합니다.

| 유형 | 예시 | 권장 수명 | 제거 기준 |
| --- | --- | --- | --- |
| Release flag | 새 결제 화면 1%, 10%, 100% 노출 | 1~4주 | 100% 노출 후 7~14일 안정 |
| Experiment flag | A/B 테스트 variant | 2~8주 | 분석 종료 + 의사결정 기록 |
| Ops kill switch | 외부 API 장애 시 기능 차단 | 장기 보존 가능 | 런북과 정기 리허설 필요 |
| Permission/config flag | 특정 tenant 권한, 정책 버전 | 장기 또는 영구 | control plane 자산으로 관리 |
| Migration flag | v1/v2 read path 전환 | 1~12주 | backfill, shadow compare, rollback window 종료 |

문제는 release flag가 ops flag처럼 오래 남거나, 실험 flag가 제품 정책처럼 굳어지는 순간입니다. 예를 들어 `new_checkout_enabled`가 100% 켜진 뒤 3개월 동안 코드에 남아 있으면 테스트는 두 세계를 계속 떠안습니다. 반대로 장애 대응용 `payment_provider_disable` 같은 kill switch는 제거하면 안 되는 경우가 많습니다. 플래그 정리의 첫 단계는 "오래됨" 하나로 판단하지 않고 목적을 분류하는 것입니다.

### 2) 플래그 생성은 코드 변경이 아니라 운영 계약이다

플래그를 추가할 때 최소한 아래 필드는 같이 남겨야 합니다.

```yaml
flag_key: checkout.v2.enabled
type: release
owner: payments-platform
created_at: 2026-05-26
expires_at: 2026-06-23
default: false
rollback_window_days: 14
success_metric:
  - checkout_error_rate < 0.3%
  - payment_latency_p95 < 1200ms
cleanup_trigger: "100% rollout 후 14일 동안 rollback 미사용"
linked_runbook: "/runbooks/checkout-v2-rollout"
```

이 필드가 없으면 플래그는 금방 고아가 됩니다. 특히 `owner`와 `cleanup_trigger`가 중요합니다. owner가 없으면 아무도 삭제 PR을 열지 않고, cleanup trigger가 없으면 "혹시 모르니 남기자"가 기본값이 됩니다. 실무 기준으로는 release flag의 90% 이상이 `expires_at`을 가져야 하고, 만료일이 지난 release flag는 다음 스프린트 안에 삭제 후보로 올라와야 합니다.

### 3) 플래그 부채는 코드 복잡도보다 테스트 조합 폭발이 먼저 온다

플래그 1개는 분기 2개입니다. 독립적인 플래그 5개는 이론상 32개 조합입니다. 물론 모든 조합을 테스트하지는 않지만, 문제는 장애가 보통 "플래그 A는 켜고 B는 끈 상태에서 특정 tenant만 실패"처럼 나타난다는 점입니다.

운영 기준은 아래처럼 잡을 수 있습니다.

- 한 서비스의 활성 release/experiment flag가 20개를 넘으면 정리 리뷰를 연다.
- 한 요청 경로에서 평가되는 플래그가 5개 이상이면 설계 리뷰 대상이다.
- critical path의 플래그 조합 테스트는 "기본값 + next rollout + kill switch" 3종을 최소로 둔다.
- 30일 이상 호출되지 않은 flag key는 삭제 후보로 표시한다.
- 100% 또는 0%로 고정된 release flag는 14일 뒤 코드 제거 PR을 자동 생성한다.

이 숫자는 절대값이 아니라 출발점입니다. 결제, 권한, 배포 경로처럼 실패 비용이 큰 서비스는 더 엄격해야 하고, 내부 백오피스 실험은 조금 느슨할 수 있습니다.

## 실무 적용

### 1) 플래그 레지스트리를 코드와 같이 리뷰한다

플래그 관리 SaaS를 쓰더라도 원본 계약은 repo에 남기는 편이 좋습니다. 예를 들어 `flags/checkout-v2.yaml` 같은 파일을 두고, 애플리케이션 코드와 같은 PR에서 생성·수정·삭제를 리뷰합니다. 운영 콘솔에서 즉시 값을 바꾸는 것은 필요하지만, 플래그의 의미와 수명은 버전 관리되어야 합니다.

추천 workflow:

1. 기능 PR에서 플래그 계약 파일 추가
2. rollout PR 또는 운영 변경에서 비율 조정
3. 100% 안정 후 cleanup issue 자동 생성
4. cleanup PR에서 죽은 분기, 테스트, 문서, 대시보드 제거
5. 플래그 서비스의 key 삭제 또는 archived 처리

중요한 점은 "플래그 OFF 분기 제거"만으로 끝내지 않는 것입니다. 테스트 fixture, 문서, 알람 라벨, 대시보드 필터, 고객 지원 매크로에도 플래그 이름이 남을 수 있습니다. cleanup PR의 정의는 코드 삭제보다 넓어야 합니다.

### 2) 만료 알림보다 자동 실패가 효과적이다

슬랙 알림만으로는 오래된 플래그가 잘 줄지 않습니다. 알림은 흘러가고, 담당자는 바쁩니다. 그래서 최소한 다음 게이트가 필요합니다.

- 새 release flag에 `expires_at`이 없으면 CI 실패
- 만료 후 14일이 지난 release flag가 있으면 warning에서 failure로 승격
- owner가 없는 flag는 운영 콘솔 변경 금지
- cleanup issue가 2회 스프린트 동안 미처리되면 팀 debt 지표에 반영
- kill switch는 만료가 아니라 분기별 리허설 증거를 요구

kill switch를 일반 만료 규칙에 넣으면 위험합니다. 장애 완화 스위치는 오래 살아도 됩니다. 대신 90일마다 "실제로 껐을 때 핵심 경로가 어떻게 degraded 되는지"를 staging 또는 canary에서 확인해야 합니다. 테스트되지 않은 kill switch는 없는 것과 비슷합니다.

### 3) 로그에는 flag value보다 decision context가 필요하다

장애 분석에서는 "플래그가 켜져 있었다"만으로 부족합니다. 어떤 rule이 이 사용자를 variant B로 보냈는지, 기본값인지 tenant override인지, rollout percentage에 들어간 것인지가 필요합니다.

로그 필드 예시:

```text
flag.checkout_v2.value=true
flag.checkout_v2.reason=percentage_rollout
flag.checkout_v2.version=2026-05-26.3
flag.checkout_v2.owner=payments-platform
```

이 정보가 있어야 플래그 값을 되돌렸는데도 문제가 계속되는지, 특정 cohort만 영향을 받는지, stale SDK cache가 있는지 판단할 수 있습니다. 특히 모바일·프론트엔드·백엔드가 같은 flag key를 공유한다면 SDK cache TTL과 서버 평가 결과를 분리해서 봐야 합니다.

## 트레이드오프/주의점

첫째, 너무 빠른 cleanup은 롤백 경로를 없앨 수 있습니다. 새 경로가 100% 켜졌다고 바로 예전 분기를 지우면, 다음 날 숨어 있던 문제를 발견했을 때 선택지가 줄어듭니다. 핵심 경로는 최소 7일, 결제·권한·데이터 마이그레이션은 14~30일 rollback window를 두는 편이 안전합니다.

둘째, 너무 늦은 cleanup은 설계 판단을 흐립니다. 플래그가 오래 남으면 개발자는 현재 제품 상태를 코드만 보고 이해할 수 없습니다. "이 분기가 실제로 쓰이나?"를 매번 콘솔에서 확인해야 하고, 테스트도 방어적으로 늘어납니다.

셋째, 플래그 시스템을 범용 설정 저장소로 쓰면 control plane이 비대해집니다. 사용자별 가격 정책, tenant별 권한, 모델 라우팅, 장애 우회, 실험 설정을 모두 같은 flag namespace에 넣으면 접근 권한과 감사 기준이 섞입니다. 영구 정책은 별도 policy/config 시스템으로 승격하는 편이 낫습니다.

넷째, 클라이언트 플래그는 서버 플래그보다 제거가 느립니다. 모바일 앱은 사용자 업데이트가 필요하고, 오래된 버전이 남습니다. 모바일에 노출된 flag key는 서버에서 100%로 고정됐더라도 최소 1~2개 앱 릴리스 주기 동안 호환성을 봐야 합니다.

## 체크리스트 또는 연습

- [ ] 모든 활성 플래그에 `type`, `owner`, `created_at`, `expires_at` 또는 `review_cycle`이 있다.
- [ ] release/experiment flag와 ops kill switch를 같은 만료 규칙으로 처리하지 않는다.
- [ ] 100% 또는 0% 고정 후 14일이 지난 release flag 목록을 볼 수 있다.
- [ ] critical path에서 동시에 평가되는 플래그 수를 측정한다.
- [ ] cleanup PR은 코드, 테스트, 문서, 대시보드, 운영 콘솔 key를 함께 정리한다.
- [ ] kill switch는 90일마다 리허설하고 결과를 런북에 남긴다.

연습으로 현재 서비스의 플래그 10개를 골라 `release / experiment / ops / permission / migration`으로 분류해 보세요. 그중 100% 고정된 플래그가 있다면 제거 PR의 범위를 작성합니다. 코드 분기 1개를 지우는 데 그치지 말고, 테스트 조합, 로그 필드, 대시보드, 고객 지원 문구까지 어디에 흔적이 남는지 같이 추적하면 플래그 cleanup이 왜 운영 작업인지 바로 보입니다.
