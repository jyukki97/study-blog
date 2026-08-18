---
title: "2026 개발 트렌드: Post-Quantum Origin Authentication, PQC 전환은 TLS 인증 경계부터 분리해 설계한다"
date: 2026-08-17T10:06:00+09:00
lastmod: 2026-08-17T10:06:00+09:00
draft: false
tags: ["Post-Quantum Cryptography", "PQC", "TLS", "ML-DSA", "ML-KEM", "Cloudflare", "Platform Engineering", "Security"]
categories: ["Development", "Security", "Platform Engineering"]
series: ["dev-trends"]
keywords: ["post-quantum origin authentication", "ML-DSA TLS", "ML-KEM migration", "PQC origin mTLS", "cryptographic agility"]
description: "ML-DSA 기반 origin authentication 지원은 PQC가 연구 주제에서 배포·인증서·신뢰 저장소·다운그레이드 방지의 운영 과제로 옮겨가고 있음을 보여줍니다. 전환 순서와 검증 기준을 정리합니다."
summary: "PQC 전환은 알고리즘 하나를 켜는 작업이 아니다. 키 합의(ML-KEM), 인증(ML-DSA), TLS 버전, origin trust store, 인증서 수명주기, 다운그레이드 거부를 분리한 뒤 통제 가능한 origin 구간에서 증명해야 한다."
key_takeaways:
  - "2026년 7월 Cloudflare의 ML-DSA origin authentication 지원은 PQC가 visitor 구간만이 아니라 edge-to-origin 신뢰 경계로 이동했음을 보여준다."
  - "ML-KEM 키 합의와 ML-DSA 서명은 보호하는 위험이 다르므로 하나를 켰다고 '양자내성 TLS'라고 단정하면 안 된다."
  - "클래식 인증서를 여전히 허용하면 PQ 서명을 제시해도 다운그레이드가 가능하다. 검증자는 허용할 신뢰 체인을 명시해야 한다."
  - "PQC 파일럿은 지원 라이브러리·TLS 1.3·인증서 inventory·handshake 실패율·rollback을 갖춘 origin 한 곳에서 시작하는 것이 현실적이다."
operator_checklist:
  - "TLS endpoint, proxy, CDN, mTLS client, trust store, certificate owner, 라이브러리 버전을 한 inventory에 묶는다."
  - "PQC 파일럿은 classical fallback 정책을 명시하고, high-assurance origin에서는 허용 체인에 classical CA가 남지 않았는지 확인한다."
  - "도입 전후 handshake failure, TLS version, signature type, p95 handshake time, connection reuse를 같은 대시보드에서 비교한다."
  - "Go 1.27처럼 아직 draft인 런타임 지원은 production 의존성으로 확정하지 말고 release·vendor 지원 상태를 재확인한다."
learning_refs:
  - title: "TLS Handshake 딥다이브"
    href: "/learning/deep-dive/deep-dive-tls-handshake/"
    description: "키 합의, 인증서 검증, 대칭 암호가 TLS에서 어떤 순서로 만나는지 복습합니다."
  - title: "Certificate Lifecycle과 Rotation"
    href: "/learning/deep-dive/deep-dive-certificate-lifecycle-rotation-playbook/"
    description: "새 인증서 체인을 배포·검증·회수하는 운영 절차를 함께 설계할 수 있습니다."
  - title: "Runtime Security Patch Runway"
    href: "/posts/2026-07-22-runtime-security-patch-runway-trend/"
    description: "암호 라이브러리·런타임 업그레이드를 배포 준비도와 지원 창으로 관리하는 기준입니다."
  - title: "Security Default Setup Rollout"
    href: "/posts/2026-08-06-security-default-setup-rollout-contract-trend/"
    description: "중앙 보안 설정을 파일럿·점진 적용·예외 관리로 확장하는 방법입니다."
---

포스트양자암호(PQC)는 오랫동안 "언젠가 해야 할 암호 교체"처럼 들렸습니다. 그러나 2026년에는 전환의 단위가 더 구체적으로 내려오고 있습니다. Cloudflare는 7월에 Authenticated Origin Pulls(AOP)와 Custom Origin Trust Store(COTS)에서 ML-DSA 기반 post-quantum authentication을 지원한다고 발표했습니다. 이제 CDN edge와 origin 사이의 TLS 신뢰 경계에서, 키 합의뿐 아니라 상대가 진짜 peer인지 검증하는 서명까지 PQC로 다루는 경로가 생긴 것입니다.

이 변화의 핵심은 "새 알고리즘을 켠다"가 아닙니다. [TLS Handshake 딥다이브](/learning/deep-dive/deep-dive-tls-handshake/)에서 보듯 TLS에는 대칭 암호, 키 합의, 서명이라는 서로 다른 구성요소가 있습니다. [Certificate Lifecycle과 Rotation](/learning/deep-dive/deep-dive-certificate-lifecycle-rotation-playbook/) 관점에서는 인증서 발급·trust store·회수도 함께 바뀝니다. 그리고 [Runtime Security Patch Runway](/posts/2026-07-22-runtime-security-patch-runway-trend/)가 말하듯, 라이브러리와 런타임 지원 창을 확인하지 않은 채 보안 설정만 앞서면 운영 중단을 부를 수 있습니다.

참고한 공식 신호:

- [Cloudflare: Post-quantum authentication to origins is now supported](https://blog.cloudflare.com/post-quantum-authentication-to-origins/) — 2026-07-29 발표
- [Cloudflare Docs: Post-quantum cryptography between Cloudflare and origin servers](https://developers.cloudflare.com/ssl/post-quantum-cryptography/pqc-to-origin/) — AOP·COTS 요구사항과 검증 절차
- [Cloudflare Docs: Post-quantum cryptography](https://developers.cloudflare.com/ssl/post-quantum-cryptography/) — 키 합의와 서명의 범위 구분
- [Go 1.27 draft release notes](https://go.dev/doc/go1.27) — `crypto/mldsa`를 포함한 예정 변경; 글 작성 시점에는 draft임

## 이 글에서 얻는 것

- ML-KEM 기반 키 합의와 ML-DSA 기반 인증이 해결하는 위협을 구분할 수 있습니다.
- visitor-to-edge와 edge-to-origin을 같은 TLS 설정으로 뭉뚱그리지 않고, 통제 가능한 origin 경계에서 PQC를 검증하는 방법을 얻습니다.
- certificate inventory, trust store, TLS 1.3, 라이브러리 지원, 다운그레이드 거부를 포함한 파일럿 진입 기준을 세울 수 있습니다.
- 성능·호환성·보안 사이에서 언제 확대하고 언제 보류할지 숫자와 조건으로 결정할 수 있습니다.

## 핵심 개념/이슈

### 1) PQC는 한 가지 교체가 아니라 두 가지 이행이다

TLS handshake에는 적어도 세 역할이 있습니다. 대칭 암호는 실제 데이터의 기밀성과 무결성을 보호하고, 키 합의는 양쪽이 공유 비밀을 만들게 하며, 서명은 인증서의 주인이 실제 상대인지 증명합니다. PQC 전환에서 대칭 암호를 당장 바꾸는 것이 아니라, 양자 컴퓨터에 취약한 고전적 공개키 암호가 쓰이는 **키 합의**와 **서명**을 분리해 봐야 합니다.

| 구성요소 | 대표 PQC 알고리즘 | 주로 줄이는 위험 | 운영 질문 |
| --- | --- | --- | --- |
| 키 합의 | ML-KEM, X25519MLKEM768 같은 hybrid | 지금 수집한 암호문을 미래에 복호화하는 HNDL | TLS 1.3과 client/origin이 협상 가능한가? |
| 인증·서명 | ML-DSA | 미래의 고전 키 위조로 인한 peer impersonation | 검증자가 클래식 체인을 여전히 허용하는가? |
| 대칭 암호 | 기존 AES/ChaCha 계열 | 대량 데이터 암호화 | 키 길이·라이브러리 정책은 충분한가? |

Cloudflare 문서가 강조하듯, ML-DSA 인증서가 제시된다는 사실만으로 post-quantum authentication이 끝나지 않습니다. 검증자가 classical certificate도 허용하면 공격자는 약한 고전 키로 상대를 사칭할 수 있습니다. 이것은 기능의 fallback이 아니라 보호 수준의 **다운그레이드**입니다. 따라서 전환 완료 기준에는 "어떤 CA와 signature type을 명시적으로 거부하는가"가 들어가야 합니다.

### 2) origin 경계가 첫 파일럿에 적합한 이유

공개 웹의 visitor-to-edge 경로는 브라우저, 모바일 SDK, 오래된 사내 기기, WebPKI 호환성을 모두 고려해야 합니다. 반면 edge-to-origin 구간은 보통 서비스 운영자가 CDN 설정, origin TLS, mTLS trust store, proxy 버전을 함께 통제합니다. Cloudflare의 AOP는 edge가 origin에 client certificate를 제시하는 모델이고, COTS는 edge가 origin server certificate를 검증할 때 신뢰할 CA를 정하는 모델입니다. 두 기능을 함께 써야 양방향 인증 경계를 PQC로 구성할 수 있습니다.

그렇다고 모든 구간이 자동으로 PQC가 되는 것은 아닙니다. Cloudflare 문서의 현재 범위도 origin-facing 인증에 한정됩니다. visitor-to-edge 인증과 내부 연결의 지원 상태는 별도입니다. 아키텍처 다이어그램에서 다음 세 연결을 분리해 inventory해야 합니다.

```text
browser / mobile client  -- TLS -->  edge / CDN
edge / CDN               -- TLS -->  origin proxy
origin proxy             -- TLS -->  internal service or database
```

첫 번째 연결을 보호한 정책이 두 번째와 세 번째에 자동 전파된다고 가정하면 안 됩니다. 특히 origin 뒤에 service mesh, API gateway, legacy TLS terminator가 있으면 실제 신뢰 경계는 더 늘어납니다.

### 3) certificate inventory가 암호 전환의 시작점이다

PQC 프로젝트가 certificate 생성 명령부터 시작하면 대부분 중간에 멈춥니다. 먼저 다음 inventory를 만들고, owner가 없는 항목을 파일럿 범위에서 제외해야 합니다.

| 필드 | 예시 | 판단 기준 |
| --- | --- | --- |
| endpoint·방향 | `cdn -> origin-api` | 누가 client이고 누가 certificate를 검증하는가 |
| TLS terminator | nginx, Envoy, cloud load balancer | 실제 라이브러리와 TLS 1.3 지원 여부 |
| trust store | public CA, private CA, COTS | classical CA 허용 여부와 rollback 범위 |
| certificate owner | platform-security | 발급·갱신·폐기 책임자 |
| 데이터 등급 | public, internal, regulated | HNDL·사칭 위험 우선순위 |
| 호환성 집합 | OpenSSL, Java, Go, device firmware | ML-DSA 지원과 upgrade path |

Cloudflare의 origin 문서는 ML-DSA 파일럿에 TLS 1.3과 ML-DSA를 지원하는 origin 라이브러리(예: OpenSSL 3.5.0 이상)를 요구합니다. 또한 업로드하는 private key encoding 제약처럼 공급자별 운영 조건도 존재합니다. 한편 Go 1.27 release note는 `crypto/mldsa`를 예고하지만 글 작성 시점에는 draft입니다. 예정된 런타임 API를 배포 계획의 확정 근거로 쓰기보다, GA release·사용 중인 TLS stack·managed platform 지원 여부를 각 환경에서 다시 확인해야 합니다.

### 4) 성공 기준은 handshake 하나가 아니라 policy와 관측성이다

PQC test 환경에서 `openssl s_client` 한 번이 성공해도 rollout 준비가 끝난 것은 아닙니다. AOP와 COTS는 신뢰 체인을 바꾸는 설정이므로 정상 traffic, certificate rotation, 장애 복구, 잘못된 CA 거부를 모두 검증해야 합니다. Cloudflare 문서가 예시로 드는 `Signature type: mldsa44`, `Negotiated TLS1.3 group: X25519MLKEM768` 같은 결과는 유용하지만, 그것은 한 connection의 증거일 뿐입니다.

파일럿 SLO는 아래처럼 작게 잡을 수 있습니다.

| 지표 | 확대 조건 | 중단·롤백 조건 |
| --- | --- | --- |
| TLS handshake failure | 기준선 대비 +0.05%p 미만 | +0.2%p 이상이 10분 지속 |
| p95 handshake time | 기준선 대비 +10% 이내 | +25% 또는 timeout 증가 |
| origin 5xx | 기준선 변동 범위 | certificate verify 오류가 1건이라도 발생 |
| PQ negotiation 비율 | 파일럿 대상의 99% 이상 | 클래식 fallback이 의도 밖에서 관측 |
| rotation rehearsal | 신규·이전 체인 모두 검증 | rollback certificate 복구 실패 |

숫자는 서비스의 여유와 traffic에 맞춰 조정합니다. 단, failure rate와 verification error는 별도의 alert로 둬야 합니다. connection reuse가 높으면 handshake 비용은 작게 보일 수 있지만, 재시작·배포·장애 때 연결이 동시에 열리면 조건이 달라집니다.

## 실무 적용

### 1) 4단계 파일럿으로 범위를 넓힌다

**1단계: 발견.** TLS endpoint, certificate chain, trust store, TLS version, terminator 라이브러리, owner를 inventory하고, regulated data나 privileged origin을 우선순위로 정합니다. TLS 1.2만 가능한 legacy endpoint는 "예외"로 표시하되, PQC 적용 완료처럼 집계하지 않습니다.

**2단계: 격리 검증.** production과 분리된 origin에서 ML-DSA CA와 leaf certificate를 만들고, AOP 또는 동등한 mTLS 구성을 적용합니다. 정상 체인, 만료 체인, 잘못된 issuer, classical certificate를 각각 시도합니다. 이 단계의 핵심 테스트는 접속 성공이 아니라 **classical chain이 거부되는지**입니다.

**3단계: 저위험 canary.** read-only 또는 낮은 비즈니스 영향의 hostname 1개에 적용합니다. traffic 5%에서 시작해 24시간 동안 handshake·5xx·재시도·connection churn을 비교하고, certificate rotation rehearsal을 한 번 통과시킵니다.

**4단계: 고보증 origin 확대.** 25%, 50%, 100%로 넓히되, 각 단계에서 24시간 이상 지표와 rollback path를 확인합니다. 결제·권한·고객 PII 경로는 별도 change review로 다루고, 오래된 device나 proxy가 있는 경로는 강제로 밀어 넣지 않습니다.

### 2) trust store 변경을 배포로 취급한다

COTS처럼 custom trust store를 쓰는 기능은 보통 certificate 하나를 더 추가하는 설정처럼 보이지만, Cloudflare 문서에서는 custom CA 업로드가 해당 zone의 기본 public CA 신뢰를 대체한다고 설명합니다. 즉 trust store는 "보안 옵션"이 아니라 인증 성공/실패를 바꾸는 production policy입니다.

그래서 변경 요청에는 최소 다음을 넣습니다.

- 허용할 PQ CA와 명시적으로 거부할 classical CA 목록
- affected hostname, origin, owner, 만료일
- 이전 trust store의 암호화된 backup과 rollback 담당자
- certificate verify 실패 시 alert와 즉시 복원 절차
- 새 trust chain을 쓰는 canary probe와 주기적 synthetic handshake

이 방식은 [Security Default Setup Rollout](/posts/2026-08-06-security-default-setup-rollout-contract-trend/)의 원칙과 같습니다. 안전한 기본값을 만들되, 어떤 서비스가 왜 예외인지와 예외가 언제 끝나는지를 운영 데이터로 남겨야 합니다.

### 3) 암호 민첩성 지표를 운영 지표로 올린다

PQC는 한 번의 마이그레이션으로 끝나지 않습니다. 표준·라이브러리·브라우저·managed service의 지원 범위는 계속 움직입니다. `tls_version`, `key_agreement`, `signature_algorithm`, `cert_issuer`, `verify_result`를 connection telemetry에 남기면 새 표준이 나와도 추측 대신 실제 협상 데이터를 보고 전환할 수 있습니다.

과도한 라벨은 관측 비용을 올릴 수 있으므로 raw certificate subject나 사용자 식별자를 metric label에 넣지 않습니다. 대신 algorithm과 outcome은 low-cardinality로 집계하고, 상세 handshake log는 sampling·접근 통제·짧은 보존 기간 아래 둡니다. 암호 전환도 결국 [OpenTelemetry Blueprints](/posts/2026-08-16-opentelemetry-blueprints-governed-observability-trend/)처럼 "무엇을 관측하고 어떤 행위로 연결할지"를 계약으로 만드는 작업입니다.

## 트레이드오프/주의점

PQC는 모든 환경에서 즉시 강제할 보안 toggle이 아닙니다. ML-DSA 키와 인증서는 크기·CPU·라이브러리 호환성 면에서 기존 RSA/ECDSA와 다른 비용을 가질 수 있고, TLS termination을 managed service에 맡긴 팀은 실제 지원 버전을 직접 통제하지 못할 수 있습니다. 그래서 고위험 데이터 경로를 우선하되, 지원되지 않는 legacy origin을 억지로 배제해 가용성을 해치는 것보다 time-bound 예외와 upgrade 계획을 남기는 편이 낫습니다.

가장 흔한 오해는 hybrid key agreement를 켰으니 인증도 안전하다는 생각입니다. HNDL을 줄이는 키 합의와 peer impersonation을 막는 서명은 다릅니다. 반대로 ML-DSA certificate를 올렸으니 안전하다는 생각도 위험합니다. verifier가 classical chain을 accept하면 공격자에게 약한 경로를 남깁니다. **제시한 알고리즘이 아니라 거부한 알고리즘까지** 확인해야 합니다.

마지막으로 특정 CDN의 origin 기능은 유용한 시작점이지 전체 기업 PKI의 대체재가 아닙니다. 내부 mTLS, service mesh, VPN, code signing, device identity는 별도 inventory와 전환 순서가 필요합니다. 제품 문서의 지원 범위와 목표 연도를 조직 전체의 완료 일정으로 복사하지 말고, 각 신뢰 경계의 데이터 수명·위협 모델·호환성을 기준으로 우선순위를 다시 매겨야 합니다.

## 체크리스트 또는 연습

이번 주에는 production 변경 없이 origin 하나를 골라 아래만 해 보세요.

- [ ] `client -> edge`, `edge -> origin`, `origin -> internal` TLS 연결을 따로 그렸는가?
- [ ] 각 연결의 TLS terminator, TLS version, certificate issuer, trust store owner를 적었는가?
- [ ] HNDL 보호가 필요한 데이터와 live impersonation 방지가 필요한 high-assurance origin을 분리했는가?
- [ ] ML-DSA 지원 여부를 release note가 아니라 실제 library·managed service 버전으로 확인했는가?
- [ ] PQ certificate를 제시했을 때 classical certificate도 통과하는지 negative test를 했는가?
- [ ] trust store 변경의 rollback certificate와 담당자가 준비됐는가?
- [ ] p95 handshake time, verify failure, 5xx, PQ negotiation 비율의 기준선을 저장했는가?

PQC 전환의 첫 산출물은 새 인증서가 아니라 **신뢰 경계별 inventory와 거부 정책**이어야 합니다. 그 두 가지가 있어야 기술 지원이 바뀌어도 팀이 보안 수준을 잃지 않고 다음 알고리즘으로 이동할 수 있습니다.
