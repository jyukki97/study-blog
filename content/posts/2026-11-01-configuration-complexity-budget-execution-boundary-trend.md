---
title: "2026 개발 트렌드: 설정은 더 이상 단순 텍스트가 아니다 — 구성 복잡도 예산으로 실행 경계를 관리하기"
date: 2026-11-01T10:06:00+09:00
lastmod: 2026-11-01T10:06:00+09:00
draft: false
tags: ["Platform Engineering", "Configuration", "CI/CD", "Security", "Developer Experience"]
categories: ["Development", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["configuration complexity budget", "operational configuration governance", "CI YAML security", "executable configuration"]
description: "CI YAML, curl 옵션, 템플릿, 정책 파일처럼 코드가 아닌 것으로 분류되던 설정이 실행력을 갖는 환경에서, 구성 복잡도 예산과 검증 경계를 운영하는 방법을 정리합니다."
summary: "설정의 위험은 파일 확장자가 아니라 입력·분기·반복·외부 I/O·권한을 얼마나 조합하는지에서 나온다. 구성 복잡도 예산은 설정을 금지하는 규칙이 아니라, 실행력이 커지는 지점에서 검토·테스트·권한을 비례시키는 운영 계약이다."
---

CI YAML, Helm template, API gateway rule, `curl` 한 줄, 정규식, feature flag 조건은 흔히 “코드가 아닌 설정”으로 취급됩니다. 그래서 PR 리뷰도 짧고, 테스트도 생략되며, 운영 권한은 스크립트보다 넓게 열리는 일이 생깁니다. 하지만 변수 치환, 조건 분기, 반복, 외부 호출, 파일 쓰기, secret 접근이 결합되면 설정은 이미 작은 실행 환경입니다.

10월 말 개발 뉴스에서 다뤄진 curl의 예상 밖 계산 가능성은 이 문제를 선명하게 보여 줍니다. 특정 도구의 결함을 일반화하자는 뜻은 아닙니다. 오히려 익숙한 유틸리티와 선언형 파일도 조합에 따라 리뷰어가 가정한 단순성을 넘어설 수 있다는 신호입니다. [10월 30일 개발 뉴스](/posts/2026-10-30-dev-news-senior-insights/), [도구 권한 manifest와 runtime attestation](/posts/2026-04-05-tool-permission-manifest-runtime-attestation-trend/), [IaC agent plan의 증거 정책](/posts/2026-10-24-iac-agent-plan-evidence-policy-trend/), [에이전트 툴 오류 계약](/posts/2026-10-29-agent-tool-error-contract-trend/)을 연결해, 설정을 안전하게 빠르게 바꾸는 기준을 제안합니다.

## 이 글에서 얻는 것

- 설정 파일이 단순 데이터에서 실행 표면으로 바뀌는 다섯 가지 신호를 구분합니다.
- 줄 수 대신 외부 I/O, 권한, 분기, 반복, 변경 가능성을 기준으로 복잡도 예산을 매기는 방법을 배웁니다.
- CI·배포·운영 스크립트에 dry-run, allowlist, timeout, receipt를 어떤 순서로 넣을지 정할 수 있습니다.
- 모든 YAML과 명령을 무겁게 승인하지 않으면서 고위험 조합만 느리게 만드는 기준을 얻습니다.

## 핵심 개념/이슈

### 1) 파일 확장자는 위험도를 설명하지 못한다

`deploy.yaml`은 데이터처럼 보일 수 있지만 template 함수로 환경 변수를 읽고, 조건에 따라 권한을 바꾸며, hook으로 원격 명령을 실행할 수 있습니다. `curl`은 네트워크 클라이언트처럼 보이지만 URL 조합, 입력 파일, 리다이렉트, 인증 헤더, 재시도와 결합되면 데이터 반출과 반복 실행의 표면이 됩니다. shell 한 줄 역시 입력이 고정되고 권한이 좁다면 작은 위험이지만, 브랜치 이름이나 PR 본문을 그대로 평가하면 코드 실행 경로가 됩니다.

따라서 “YAML이니 낮은 위험”, “정식 애플리케이션 코드니 높은 위험”이라는 분류는 충분하지 않습니다. 다음 다섯 질문이 더 실용적입니다.

1. **입력:** 비신뢰 문자열, branch, issue 본문, 외부 응답을 해석하는가?
2. **표현력:** 변수·조건·반복·동적 include 중 둘 이상을 쓰는가?
3. **효과:** 네트워크 호출, 파일 변경, 배포, ticket 생성, 데이터 write가 있는가?
4. **권한:** secret, production credential, broad token, host filesystem에 닿는가?
5. **가시성:** 실제로 펼쳐진 결과와 실행 대상, 실패 상태를 사람이 확인할 수 있는가?

다섯 항목 중 하나라도 외부 write 또는 broad credential이면 “설정 변경”이 아니라 실행 변경으로 분류하는 편이 안전합니다. 반대로 정적 label, 고정된 리소스 요청, 읽기 전용 dashboard query까지 같은 절차를 강제하면 팀은 정책을 우회하게 됩니다.

### 2) 복잡도 예산은 금지 목록이 아니라 검증을 비례시키는 장치다

구성 복잡도 예산(Configuration Complexity Budget)은 파일의 줄 수를 재는 규칙이 아닙니다. 어떤 조합부터 사람 검토와 강한 검증을 요구할지 팀이 합의하는 기준입니다. 아래 네 단계는 시작점으로 쓸 수 있습니다.

| 등급 | 전형적 조건 | 허용 예시 | 최소 gate |
| --- | --- | --- | --- |
| C0 정적 | 고정값, 외부 I/O·secret·분기 없음 | label, 정적 route, 문서 메타데이터 | schema/lint |
| C1 제한적 | 조건 또는 변수 1개, 읽기 전용 | 환경별 replica 수, 고정 GET probe | render/dry-run |
| C2 실행형 | 조건·반복 2개 이상 또는 외부 호출 | CI job, template hook, 배포 plan | render + sandbox + owner review |
| C3 고위험 | production write, secret, 동적 입력, 권한 변경 중 하나 | deploy, 권한 정책, 외부 publish | C2 + approval + receipt + rollback |

숫자는 제품마다 조정해야 하지만, 예를 들어 **동적 입력 1개와 외부 write 1개가 만나거나**, **secret 접근과 리다이렉트/동적 URL이 함께 있으면** C3로 올리는 규칙은 효과적입니다. 80줄짜리 정적 정책보다 12줄짜리 PR 본문 기반 shell 명령이 위험할 수 있기 때문입니다.

여기서 중요한 것은 “복잡한 설정은 나쁘다”가 아닙니다. 표현력이 필요한 자동화는 반복 업무를 줄입니다. 다만 실행력이 커진 만큼 사람이 이해할 수 있는 중간 산출물, 제한된 권한, 실패 뒤 멈출 지점을 함께 제공해야 합니다.

### 3) 해석 결과가 원본보다 더 중요한 경우가 많다

템플릿, include, 상속, 환경 변수, 기본값이 있는 설정은 원본 파일만 읽고 실제 동작을 알기 어렵습니다. 운영자가 검토해야 할 대상은 `values-prod.yaml` 20줄이 아니라, 그것이 렌더링한 deployment의 image, service account, network egress, resource limit, hook 목록입니다.

이 원칙은 AI가 설정을 생성할 때 더 중요합니다. 모델은 문법상 그럴듯한 YAML을 빠르게 만들 수 있지만, include된 파일의 권한 상승이나 기본값의 외부 endpoint까지 스스로 보장하지는 못합니다. [IaC plan 증거 정책](/posts/2026-10-24-iac-agent-plan-evidence-policy-trend/)처럼, 생성자 설명보다 계획 결과와 정책 diff를 1차 증거로 보아야 합니다.

## 실무 적용

### 1) 가장 먼저 실행형 설정을 inventory한다

한 번에 모든 repository를 고치지 말고, 다음 위치부터 찾습니다: CI workflow, deployment manifest, Helm/Kustomize, gateway policy, 운영용 shell, `curl` wrapper, cron, feature flag rule, agent tool manifest. 각 항목에 owner와 C0~C3 등급만 붙여도 숨은 실행 표면이 보입니다.

우선순위는 다음 순서가 좋습니다.

1. production write 또는 credential을 사용하는 C3
2. 외부 입력을 평가하는 C2
3. 실패했을 때 재실행이 중복 효과를 만들 수 있는 C2
4. 빈번히 바뀌지만 render/dry-run이 없는 C1

inventory가 문서 작업으로 끝나면 안 됩니다. C3에는 실제 실행 전에 펼친 plan, 대상 개수, 권한 diff, timeout, 승인자를 남깁니다. 같은 배포를 재시도해도 안전한지 idempotency key 또는 기존 상태 조회로 확인하고, 결과는 자연어 “성공” 대신 receipt로 저장합니다.

### 2) 모든 외부 호출에 네 가지 기본값을 둔다

설정 안의 HTTP 호출이나 CLI wrapper는 다음을 명시합니다.

```yaml
request_policy:
  allowed_hosts: ["api.internal.example"]
  connect_timeout_seconds: 3
  total_timeout_seconds: 15
  max_attempts: 2
  redirect: deny
  response_size_limit_bytes: 1048576
```

예시 값은 절대값이 아니라 정책의 모양을 보여 줍니다. 중요한 것은 timeout이 없거나 실패 시 무한 재시도하는 기본값을 남기지 않는 일입니다. URL을 동적으로 만들면 host allowlist를 정규화한 결과에 적용하고, secret은 query string·로그·rendered artifact에 섞이지 않게 합니다. [에이전트 sandbox egress 정책](/posts/2026-05-16-agent-sandbox-egress-policy-trend/)과 같은 원리로, 입력이 통제되지 않는 호출은 먼저 network 경계에서 좁혀야 합니다.

### 3) 검증 lane을 render, execute, observe로 나눈다

설정 검증을 “lint 통과” 한 단계로 끝내면 실제 권한과 실행 대상이 빠집니다. 간단한 세 lane을 두면 속도와 통제를 함께 잡을 수 있습니다.

| lane | 질문 | 예시 산출물 | 실패 시 행동 |
| --- | --- | --- | --- |
| render | 무엇으로 펼쳐지는가? | resolved config, plan diff | merge/배포 중단 |
| execute | 제한된 환경에서 실행되는가? | sandbox exit code, fixture 결과 | 재현 후 수정 |
| observe | 실제 효과가 예상과 같은가? | receipt, 대상 수, 오류율 | pause·rollback·owner 호출 |

C1은 render까지만, C2는 sandbox execute까지, C3는 observe receipt와 approval까지 요구하는 식으로 연결합니다. production 적용 전 canary를 1개 tenant 또는 1% traffic으로 제한하고, 오류율·권한 거부·대상 수가 기준선을 벗어나면 자동 확장을 멈춥니다. “계획상 100개 대상인데 실제 103개”처럼 작은 차이도 write 작업에서는 pause 신호가 될 수 있습니다.

### 4) 2주 동안 예산이 정책 우회를 만드는지 측정한다

처음부터 복잡한 점수 모델을 만들지 마세요. 2주간 C2/C3 설정 변경만 대상으로 다음 네 수치를 기록합니다.

- render 결과와 실제 실행 대상이 달랐던 비율
- timeout·redirect·권한 정책 때문에 중단된 실행 수
- rollback 또는 수동 개입까지 걸린 시간
- “긴급” 예외가 만료일 없이 남은 수

목표는 차단 수를 늘리는 것이 아닙니다. 예를 들어 C3 변경의 100%가 plan과 receipt를 남기고, policy 중단 뒤 재시도 성공률이 높으며, 예외가 7일 안에 정리된다면 팀의 운영 경계가 작동한다고 볼 수 있습니다. 반대로 C1까지 사람 승인을 기다리느라 릴리스가 밀리면 등급 기준이 과한 것입니다.

## 트레이드오프/주의점

설정을 코드처럼 다루자는 말이 모든 설정에 테스트 프레임워크와 복잡한 리뷰를 넣자는 뜻은 아닙니다. C0/C1까지 무겁게 만들면 작은 운영 개선은 ticket 밖에서 이뤄지고, 실제 위험은 더 보이지 않게 됩니다. 복잡도 예산은 **빠른 경로를 보존하기 위해 느린 경로의 조건을 명확히 하는 도구**여야 합니다.

반대로 lint와 schema가 있으니 안전하다고 가정해도 안 됩니다. 이 도구들은 문법과 일부 구조를 확인할 뿐, 동적 URL이 어떤 host로 해석되는지, template이 어떤 권한을 선택하는지, 재시도가 중복 write를 만드는지까지 판단하지 못합니다. static check, isolated canary, runtime receipt의 세 증거를 서로 대체하지 마세요.

마지막으로 원본 설정과 렌더된 결과를 모두 무기한 보관하면 secret과 개인정보의 새로운 저장소가 됩니다. receipt에는 원문 토큰이나 전체 payload 대신 config version, digest, 허용된 대상 수, 실행 결과, 만료 시각을 남깁니다. 설정의 투명성은 더 많은 로그가 아니라 필요한 증거를 안전하게 재현할 수 있다는 뜻입니다.

## 체크리스트 또는 연습

- [ ] CI, 배포, gateway, cron, 운영 wrapper 중 실행형 설정의 owner와 C0~C3 등급을 기록했다.
- [ ] 동적 입력 + 외부 write, 또는 secret + 동적 URL 조합은 C3로 올린다.
- [ ] 외부 호출에 allowlist, connect/total timeout, 재시도 상한, redirect 정책, 응답 크기 제한이 있다.
- [ ] template/include 설정은 원본뿐 아니라 resolved plan을 PR에서 확인한다.
- [ ] C2는 sandbox 또는 dry-run을, C3는 승인·receipt·rollback 경로를 요구한다.
- [ ] production write는 대상 수·권한 diff·오류율의 중단 기준을 갖는다.
- [ ] 예외에는 owner와 최대 7일의 만료일을 넣고, 만료 뒤 기본 정책으로 복귀시킨다.

연습으로 현재 CI workflow 또는 자주 쓰는 `curl` wrapper 하나를 골라 보세요. 입력, 외부 I/O, 권한, 분기·반복, 관측성 다섯 항목을 한 줄씩 적고 C0~C3 중 하나를 부여합니다. C2 이상이라면 실제 실행 없이 결과를 확인할 render/dry-run 한 가지와, 실패 후 멈출 기준 한 가지를 추가하세요. 작은 문서화만으로도 “설정이라 리뷰가 가벼워도 된다”는 빈틈을 줄일 수 있습니다.

## 관련 글

- [생성형 캔버스부터 curl의 계산 가능성까지: 10월 30일 개발 뉴스](/posts/2026-10-30-dev-news-senior-insights/)
- [IaC Agent Plan의 증거·정책 경계](/posts/2026-10-24-iac-agent-plan-evidence-policy-trend/)
