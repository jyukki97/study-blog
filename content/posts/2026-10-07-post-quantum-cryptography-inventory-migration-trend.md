---
title: "2026 개발 트렌드: Post-Quantum Cryptography 전환은 알고리즘 교체보다 암호 자산 인벤토리와 변경관리 문제다"
date: 2026-10-07T10:06:00+09:00
lastmod: 2026-10-07T10:06:00+09:00
draft: false
tags: ["Post-Quantum Cryptography", "PQC", "Cryptographic Agility", "TLS", "Platform Engineering", "Security"]
categories: ["Development", "Security", "Platform Engineering"]
series: "2026 개발 운영 트렌드"
keywords: ["post-quantum cryptography migration", "PQC inventory", "cryptographic agility", "TLS migration", "crypto asset management"]
description: "PQC 준비를 라이브러리 버전 교체로 축소하지 않고, 데이터 수명·TLS/mTLS·서명·KMS·공급망을 인벤토리와 호환성 시험으로 연결하는 실무 기준을 정리합니다."
summary: "PQC 준비의 첫 산출물은 새 알고리즘을 켠 화면이 아니라, 어떤 데이터와 서비스가 어떤 암호 경계·키·프로토콜·중간 장비에 의존하는지 설명하는 검증 가능한 목록이다. 전환은 큰 플래그 하나가 아니라 위험도별 호환성 실험과 되돌릴 수 있는 변경으로 진행해야 한다."
key_takeaways:
  - "PQC 우선순위는 유행하는 라이브러리보다 데이터의 기밀 수명, 외부 노출도, 키 교체 난이도로 정해야 한다."
  - "TLS 종단만 바꾸면 끝나지 않는다. mTLS, API gateway, service mesh, artifact 서명, KMS, 오래 보관하는 백업까지 암호 자산 범위에 넣어야 한다."
  - "초기 목표는 전사 활성화가 아니라, inventory 완성도와 대표 경로의 interoperability·latency·rollback 증거를 확보하는 것이다."
operator_checklist:
  - "서비스·데이터·프로토콜·키 owner·라이브러리·종료일을 연결한 crypto inventory를 만든다."
  - "7년 이상 보관하거나 외부 노출이 큰 데이터 경로부터 우선순위를 매긴다."
  - "대표 TLS/mTLS·서명 검증 경로에서 후보 구성을 canary로 시험하고 연결 실패와 handshake 크기를 측정한다."
  - "중간 proxy·SDK·HSM/KMS·고객 endpoint의 지원 여부와 rollback 조건을 변경 전 확인한다."
---

Post-Quantum Cryptography(PQC)는 종종 “새 암호 알고리즘을 적용하는 보안 업데이트”로 소개됩니다. 하지만 운영 환경에서 더 어려운 질문은 알고리즘 이름이 아닙니다. 고객 데이터는 몇 년 동안 읽을 수 있어야 하는가, TLS를 종료하는 곳은 몇 군데인가, service mesh의 mTLS와 외부 API의 TLS는 같은 라이브러리를 쓰는가, artifact 서명 검증기는 누가 소유하는가가 먼저입니다.

양자 컴퓨터가 언제 어떤 규모로 현실화될지 단정할 필요는 없습니다. 지금부터 수집해 보관한 암호문이 훗날 복호화 대상이 될 수 있다는 장기 기밀성 위험과, 암호 라이브러리·프로토콜을 한 번에 바꾸기 어려운 현실이 이미 전환 계획을 요구하기 때문입니다. 이 글은 [Certificate Lifecycle과 Rotation](/learning/deep-dive/deep-dive-certificate-lifecycle-rotation-playbook/), [Envelope Encryption과 PII 필드 암호화](/learning/deep-dive/deep-dive-envelope-encryption-pii-field-crypto-playbook/), [CI/CD 공급망 보안](/learning/deep-dive/deep-dive-cicd-security-supply-chain/), [API Deprecation·Sunset 운영](/learning/deep-dive/deep-dive-api-deprecation-sunset-playbook/)을 PQC 전환의 운영 관점으로 연결합니다.

## 이 글에서 얻는 것

- PQC 준비 대상을 TLS 한 항목이 아니라 데이터·키·프로토콜·검증자 관계로 인벤토리하는 방법을 배웁니다.
- 기밀성 수명, 노출도, 교체 난이도로 우선순위를 정하는 기준을 얻습니다.
- canary 실험에서 interoperability, handshake 실패, 지연, rollback을 함께 검증하는 법을 이해합니다.
- “새 알고리즘을 지원한다”는 벤더 문구와 실제 서비스 전환 증거를 구분합니다.

## 핵심 개념/이슈

### 1) 위험은 키 길이만이 아니라 데이터의 수명에서 시작한다

PQC를 먼저 검토할 대상은 오늘 결제 화면의 짧은 요청만이 아닙니다. 지금 암호화해 보관한 뒤 수년 뒤에도 민감한 데이터가 될 계약서, 건강·인증 정보, 장기 비밀, 소스 코드와 backup이 더 큰 후보일 수 있습니다. 이를 흔히 “지금 수집하고 나중에 복호화한다”는 위험으로 설명하지만, 실무 판단은 더 구체적이어야 합니다.

| 데이터·경로 | 우선순위를 올리는 조건 | 첫 조치 |
| --- | --- | --- |
| 장기 보관 PII·계약 문서 | 보관 또는 기밀 유지가 7년 이상 | 저장 암호화·key hierarchy·복호화 주체 inventory |
| 외부 TLS API | 인터넷 노출, 고객 SDK 다양성 | edge의 protocol/cipher 관측과 client 호환성 표본 수집 |
| 내부 mTLS | 서비스 수가 많고 mesh/proxy가 혼재 | CA·sidecar·workload identity owner 매핑 |
| artifact·문서 서명 | release 검증 수명이 길고 제3자 검증자가 있음 | signer·verifier·timestamp·재서명 정책 정리 |
| 짧은 수명의 telemetry | 24시간 이내 보존, 민감도 낮음 | inventory에는 넣되 우선 전환 대상에서는 낮춤 |

“7년”은 절대 기준이 아닙니다. 고객 계약, 법적 보존, 공격 모델에 따라 달라집니다. 다만 기밀 수명과 암호 교체 lead time을 분리해 숫자로 토론하게 해 준다는 점이 중요합니다. 데이터가 10년 민감한데 서비스·vendor·client를 바꾸는 데 3년이 걸린다면, 기다릴 여유가 10년인 것이 아닙니다.

### 2) 암호 자산은 certificate 목록보다 넓다

certificate 만료 알림을 잘 받는 조직도 암호 의존성을 모두 알고 있지는 않습니다. 아래 요소는 서로 다른 owner와 release cadence를 가질 수 있습니다.

- 외부 HTTPS와 API gateway의 TLS termination
- service mesh, database proxy, message broker의 mTLS
- KMS/HSM의 customer-managed key, envelope key, key wrapping 방식
- JWT·SAML·SSH·코드 서명처럼 검증자가 분산된 서명 경로
- 모바일 SDK, IoT firmware, 오래된 B2B client처럼 즉시 업데이트할 수 없는 endpoint
- backup archive, object storage, log export, disaster-recovery 복원 절차

이 목록이 없으면 PQC 지원 라이브러리를 업데이트해도 실제로 어느 경로에 적용됐는지 알 수 없습니다. 특히 edge proxy 하나가 지원한다고 해서 내부 mTLS sidecar, KMS, signing pipeline도 같은 기능과 기본값을 가진다고 가정하면 안 됩니다. **프로토콜 협상**, **키 생성·보관**, **서명·검증**, **복구·감사**를 각각 inventory 항목으로 둬야 합니다.

### 3) crypto agility는 “언제든 교체 가능”이라는 구호가 아니다

암호 민첩성은 알고리즘을 추상 interface 뒤에 감추는 것만으로 생기지 않습니다. 새 구성을 배포할 수 있고, 관측할 수 있으며, 실패하면 이전 구성으로 좁게 돌아갈 수 있어야 합니다. 다음 네 가지가 하나의 변경 단위입니다.

1. **정책**: 서비스가 허용하는 protocol·algorithm·key size·deprecation 날짜
2. **구현**: runtime, TLS library, SDK, KMS/HSM, proxy 설정과 버전
3. **호환성**: client, partner, middlebox, load balancer가 실제 handshake/verify를 통과하는지
4. **증거**: 선택된 알고리즘, 실패 이유, fallback 비율, rollback revision을 볼 수 있는지

구성 플래그에 `pqc_enabled=true`가 있어도 연결된 client가 compatibility path로만 내려가면 전환 증거가 아닙니다. 반대로 fallback을 바로 제거하면 오래된 client나 중간 장비가 조용히 끊길 수 있습니다. 초기에 중요한 지표는 채택률보다 **handshake 실패 원인 분포와 fallback 비율**입니다.

## 실무 적용

### 1) inventory를 서비스 목록이 아니라 관계 표로 만든다

스프레드시트든 CMDB든 시작 형식은 단순해도 됩니다. 대신 한 행이 서비스 이름으로 끝나면 안 됩니다. 다음처럼 보호 대상과 암호 경계를 연결합니다.

| 필드 | 예시 | 필요한 이유 |
| --- | --- | --- |
| asset/data class | `customer-contract-pdf` | 기밀 수명과 규제 기준 판단 |
| boundary | public TLS, mesh mTLS, at-rest, artifact signing | 전환 대상 분리 |
| protocol/implementation | TLS termination vendor·library·version | 지원 범위와 변경 owner 확인 |
| key/certificate owner | platform security, payment team | rotation과 incident 책임 명확화 |
| verifier/client population | mobile 3.x, partner A, CI runner | 호환성 시험 표본 결정 |
| retention/deprecation date | 7년, 2028-12 | 우선순위와 마감일 산정 |
| rollback | config revision, legacy listener, reissue path | 실패 시 복구 가능성 검증 |

완성도를 처음부터 100%로 약속하지 마세요. 첫 30일 목표는 고객 데이터가 지나는 상위 10개 경로와 production certificate의 **80% 이상**을 관계 표에 넣는 정도가 현실적입니다. owner와 client population이 비어 있는 항목은 “발견됨”이지 “준비됨”이 아닙니다.

### 2) 전환 우선순위는 세 점수와 hard stop으로 정한다

간단한 출발점은 `risk = confidentiality_lifetime × exposure × migration_lead_time`입니다. 각 요소를 1~5로 평가해 합계가 아니라 곱으로 두면, 한 요소가 매우 큰 자산이 위로 올라옵니다. 예를 들어 10년 보관하는 공개 API의 TLS 경로가 5×5×3이라면, 1일 보관 내부 job의 1×1×4보다 먼저 실험할 이유가 분명해집니다.

그러나 점수만으로 rollout하면 안 됩니다. 아래 hard stop이 하나라도 있으면 “활성화”가 아니라 조사 또는 lab 검증으로 둡니다.

- 핵심 고객 endpoint 또는 중간 proxy의 지원 여부가 확인되지 않았다.
- KMS/HSM 또는 certificate automation이 후보 구성을 관리·회전할 수 없다.
- handshake/verify 실패가 발생했을 때 client·algorithm·proxy version을 구분해 관측할 수 없다.
- 기존 구성으로 되돌렸을 때 새로 생성한 key·서명·암호문을 읽을 수 있는지 검증하지 못했다.

이 기준은 [API sunset](/learning/deep-dive/deep-dive-api-deprecation-sunset-playbook/)처럼 “지원 종료일”과 “실제 client 이행”을 분리하게 합니다. security deadline이 있다고 해서 미확인 endpoint를 무시한 전사 big-bang이 안전해지는 것은 아닙니다.

### 3) canary는 negotiation과 운영 지표를 함께 시험한다

첫 실험은 production 전체 변경이 아니라 representative traffic에서 시작합니다. edge TLS라면 직원용 또는 동의한 canary client 1~5%에 후보 구성을 제공하고, 내부 mTLS라면 의존성이 적은 service pair 하나를 선정합니다. 최소 2주 동안 아래를 기존 경로와 비교합니다.

| 지표 | 확대 중단 기준 예시 | 이유 |
| --- | --- | --- |
| handshake/verify failure rate | baseline보다 0.2%p 증가 | 호환성 회귀 감지 |
| p95 handshake latency | baseline보다 15% 증가 | CPU·network·middlebox 영향 확인 |
| handshake message size | path MTU/ingress limit 검토 필요 | fragmentation·proxy 제한 방지 |
| unexpected fallback rate | 1% 초과 또는 증가 추세 | 실제 채택이 아닌 호환성 문제 탐지 |
| rollback success | drill에서 100% | 사고 시 복구 경로 검증 |

수치는 조직의 현재 기준선보다 중요하지 않습니다. 기준선이 없다면 먼저 1주 동안 client family, TLS version, 실패 alert, handshake duration을 수집합니다. 한 번의 성공적인 connection은 충분하지 않습니다. connection reuse를 끈 경우, mobile network, 오래된 SDK, mutual TLS, peak traffic 모두에서 behavior가 달라질 수 있습니다.

### 4) 서명과 저장 암호화는 별도 migration으로 다룬다

TLS에서 후보 구성을 시험했다고 artifact signing이나 저장 데이터 암호화가 자동으로 준비되는 것은 아닙니다. 서명은 검증 기간이 길고, 이미 배포한 verifier가 새 signature를 읽어야 하며, 오래된 artifact를 재서명해야 할 수도 있습니다. 저장 암호화는 [envelope encryption](/learning/deep-dive/deep-dive-envelope-encryption-pii-field-crypto-playbook/)의 key hierarchy와 re-encryption throughput이 관건입니다.

각 영역은 다음 질문에 답해야 합니다.

- **서명**: verifier가 새 형식을 이해하지 못하면 어떤 compatibility signature를 얼마 동안 함께 제공하는가?
- **저장 데이터**: 새 key wrapping을 적용한 객체를 복원·export·DR에서 읽을 수 있는가?
- **키 lifecycle**: 새 key의 생성·rotation·revocation·audit을 KMS/HSM과 automation이 지원하는가?
- **공급망**: build와 release 검증자는 어떤 signer version·trust root를 pin하며, 변경 사실을 어떻게 증명하는가?

따라서 PQC 프로그램의 산출물은 “지원한다”는 vendor 목록이 아니라 asset별 실험 결과, 지원 버전, known limitation, next review date입니다. [CI/CD 공급망 보안](/learning/deep-dive/deep-dive-cicd-security-supply-chain/)의 provenance처럼, 암호 변경도 누가 무엇을 어떤 구성으로 검증했는지 남겨야 다음 담당자가 안전하게 이어받습니다.

## 트레이드오프/주의점

PQC 후보나 hybrid 구성은 handshake 크기, CPU 사용량, certificate/키 관리 복잡도를 늘릴 수 있습니다. 특히 header size 제한, 오래된 TLS inspection 장비, 작은 MTU, IoT firmware는 개발 환경에서 보이지 않는 실패를 만듭니다. 그래서 “보안이 좋아졌으니 성능 영향은 감수한다”가 아니라, 영향을 측정하고 서비스별 SLO 안에 들어오는지 판단해야 합니다.

fallback도 양면적입니다. 호환성에는 필요하지만 영구 fallback은 새 구성이 실제로 쓰이는지 감추고 downgrade 경로를 남길 수 있습니다. fallback은 이유 코드와 종료 기준을 갖춘 임시 제어여야 합니다. 대상 client를 파악하지 못한 상태에서 fallback을 제거하거나 유지하는 둘 다 위험합니다.

마지막으로, 규격·라이브러리 지원 발표를 production readiness와 혼동하지 마세요. 지원은 특정 version, protocol mode, key store, platform에서만 유효할 수 있습니다. vendor statement는 inventory의 입력일 뿐이며, 대표 workload의 interoperability test와 rollback drill이 통과해야 전환 근거가 됩니다.

## 체크리스트 또는 연습

- [ ] TLS, mTLS, at-rest encryption, signing, backup/DR을 분리한 crypto inventory가 있다.
- [ ] 각 항목에 data class, 기밀 수명, implementation version, key owner, verifier/client population, rollback이 연결돼 있다.
- [ ] 장기 기밀성·외부 노출·교체 lead time으로 우선순위를 산정하고 hard stop을 별도 기록한다.
- [ ] canary에서 client family별 handshake/verify failure, p95 latency, message size, fallback reason을 비교한다.
- [ ] KMS/HSM·certificate automation·proxy·SDK의 실제 지원 version을 검증했고, vendor 문구만으로 통과시키지 않는다.
- [ ] 서명과 저장 암호화 migration에는 별도 compatibility 및 복원 시험 계획이 있다.
- [ ] fallback에는 owner, 이유 코드, 종료 날짜, 제거 조건이 있다.

연습으로 production 서비스 하나를 골라 public TLS, 내부 mTLS, database encryption, artifact signing 네 줄을 작성해 보세요. 각 줄에 현재 implementation, key/certificate owner, 가장 오래된 client, 데이터 보존 기간, rollback을 채웁니다. 다섯 칸 중 두 칸 이상이 비어 있다면 새 알고리즘을 평가하기 전에 inventory를 고치는 일이 우선입니다. 반대로 네 줄이 채워졌다면 그중 가장 긴 기밀 수명과 가장 짧은 migration lead time이 만나는 경로 하나를 골라, 1% canary와 2주 관측 계획을 만들 수 있습니다.

## 관련 글

- [Certificate Lifecycle과 Rotation](/learning/deep-dive/deep-dive-certificate-lifecycle-rotation-playbook/)
- [Envelope Encryption과 PII 필드 암호화](/learning/deep-dive/deep-dive-envelope-encryption-pii-field-crypto-playbook/)
- [CI/CD 공급망 보안](/learning/deep-dive/deep-dive-cicd-security-supply-chain/)
- [API Deprecation·Sunset 운영](/learning/deep-dive/deep-dive-api-deprecation-sunset-playbook/)
