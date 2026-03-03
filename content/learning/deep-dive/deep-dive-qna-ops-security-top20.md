---
title: "Q&A 모음: 운영/보안 20제"
date: 2025-12-16
draft: false
topic: "Q&A"
tags: ["Ops", "Security", "DevOps", "Q&A"]
categories: ["Q&A"]
description: "CI/CD, 모니터링/알람, 네트워크, CORS/CSRF/OWASP 등 운영/보안 관련 20문항 Q&A"
module: "qna"
study_order: 802
---

운영(Ops)과 보안(Security) 영역에서 자주 묻는 20문항을 정리했습니다. 배포, 모니터링, 네트워크, 보안 순서로 구성되어 있습니다.

---

## Section A — 배포 & CI/CD (Q1–Q6)

### Q1. 블루/그린 배포 vs 롤링 배포 vs 카나리 배포 차이는?

| 전략 | 동작 | 장점 | 단점 |
|------|------|------|------|
| 블루/그린 | 새 환경(그린) 준비 후 트래픽 전환 | 즉시 롤백 가능 | 인프라 2배 필요 |
| 롤링 | 인스턴스를 순차적으로 교체 | 리소스 효율 | 롤백 느림, 버전 혼재 |
| 카나리 | 소수(5~10%)에게 먼저 배포 후 확대 | 위험 최소화 | 라우팅 설정 복잡 |

**실무 팁:** Kubernetes에서는 `Deployment`의 `strategy.type: RollingUpdate`가 기본이며, Istio/Argo Rollouts로 카나리를 구현합니다.

### Q2. CI/CD 파이프라인 필수 단계는?

```
코드 Push → Lint/Format 검사 → 단위 테스트 → 통합 테스트 
→ 보안 스캔(SAST) → Docker 이미지 빌드 → 이미지 스캔 
→ 스테이징 배포 → E2E 테스트 → 프로덕션 배포 → Smoke Test
```

**핵심 원칙:**
- **Fail Fast**: 빠른 검사를 앞에 배치
- **Immutable Artifact**: 한 번 빌드한 이미지를 모든 환경에서 사용
- **Rollback Plan**: 매 배포마다 롤백 명령어를 문서화

### Q3. GitOps란 무엇이고, 장점은?

**핵심 답변:** Git 저장소를 **단일 진실의 원천(Single Source of Truth)**으로 사용하여 인프라/애플리케이션 상태를 선언적으로 관리하는 운영 모델입니다.

- **ArgoCD**: Kubernetes 매니페스트를 Git과 자동 동기화
- **Flux**: CNCF 프로젝트, GitOps toolkit

**장점:** 감사 추적(Git 히스토리), 롤백(Git revert), 일관성 보장.

### Q4. Docker 이미지 최적화 방법은?

1. **멀티스테이지 빌드**: 빌드 도구는 중간 단계에만, 최종 이미지는 런타임만 포함
2. **경량 베이스 이미지**: `eclipse-temurin:21-jre-alpine` (Full JDK 대비 1/3 크기)
3. **레이어 캐싱**: 변경이 적은 레이어를 앞에 배치 (`COPY pom.xml` → `RUN mvn dependency:resolve` → `COPY src`)
4. **`.dockerignore`**: 불필요한 파일 제외

### Q5. Helm Chart와 Kustomize 차이는?

- **Helm**: 템플릿 엔진 + 패키지 매니저. `values.yaml`로 환경별 변수 주입
- **Kustomize**: 오버레이 방식, 원본 YAML을 수정 없이 패치. kubectl 내장

**실무 팁:** 복잡한 애플리케이션은 Helm, 간단한 환경 분리는 Kustomize가 적합합니다.

### Q6. Feature Flag(기능 플래그) 운영 전략은?

**핵심 답변:** 코드 배포와 기능 릴리스를 분리하여, 플래그로 기능을 활성화/비활성화합니다.

- **도구**: LaunchDarkly, Unleash, 자체 구현(DB/Redis 기반)
- **주의점**: 오래된 플래그는 기술 부채 — 분기별 정리 필수
- **킬 스위치**: 장애 시 특정 기능을 즉시 비활성화

---

## Section B — 모니터링 & 알람 (Q7–Q12)

### Q7. 모니터링의 4가지 신호(Four Golden Signals)는?

Google SRE에서 제안한 핵심 지표:

| 신호 | 설명 | 예시 메트릭 |
|------|------|------------|
| Latency | 요청 처리 시간 | P50, P95, P99 응답시간 |
| Traffic | 시스템 부하량 | RPS (Requests Per Second) |
| Errors | 실패율 | 5xx 비율, 에러 카운트 |
| Saturation | 리소스 포화도 | CPU, 메모리, 디스크, 커넥션 풀 |

### Q8. Prometheus + Grafana 모니터링 구성 방법은?

```
Application (Micrometer) → /actuator/prometheus 엔드포인트
  ↓ (scrape)
Prometheus (시계열 DB, PromQL)
  ↓
Grafana (시각화 대시보드, 알람)
```

**실무 팁:**
- `histogram_quantile(0.99, ...)` 으로 P99 계산
- Recording Rule로 자주 쓰는 쿼리 사전 계산
- 대시보드는 RED 메서드(Rate, Error, Duration) 기반으로 구성

### Q9. 알람을 설계할 때 핵심 원칙은?

1. **증상 기반(Symptom-based)**: "CPU 90%"가 아니라 "응답시간 P99 > 500ms" 같은 사용자 영향 기준
2. **단계별 심각도**: Warning → Critical → Page
3. **지속 조건(for)**: 순간 스파이크가 아닌 5분 이상 지속 시 알림
4. **알람 피로 방지**: 액션 가능한 알람만 유지, 노이즈는 대시보드로

### Q10. 로그 관리 전략 (ELK/EFK)은?

```
Application → Fluent Bit/Filebeat (수집) 
  → Kafka (버퍼, 선택) 
  → Logstash/Fluentd (파싱/변환) 
  → Elasticsearch (저장/검색) 
  → Kibana (시각화)
```

**구조적 로깅 필수 항목:**
- `traceId`, `spanId` (분산 추적)
- `userId`, `requestId` (요청 추적)
- `level`, `timestamp`, `service` (기본)

### Q11. SLO/SLI/SLA 차이는?

| 용어 | 정의 | 예시 |
|------|------|------|
| SLI (Service Level Indicator) | 측정 지표 | 요청 성공률, P99 레이턴시 |
| SLO (Service Level Objective) | 내부 목표 | 성공률 ≥ 99.9%, P99 < 200ms |
| SLA (Service Level Agreement) | 고객 계약 | SLO 미달 시 크레딧 보상 |

**실무 팁:** SLO는 SLA보다 엄격하게 설정하여 여유(error budget)를 확보하세요.

### Q12. 헬스체크 설계 시 고려사항은?

- **Liveness**: 프로세스가 살아있는가? (실패 시 재시작)
- **Readiness**: 트래픽을 받을 준비가 되었는가? (실패 시 로드밸런서에서 제외)
- **Startup**: 초기화 완료 여부 (느린 앱의 Liveness 실패 방지)

```yaml
# Kubernetes 예시
livenessProbe:
  httpGet: { path: /actuator/health/liveness, port: 8080 }
  periodSeconds: 10
  failureThreshold: 3
readinessProbe:
  httpGet: { path: /actuator/health/readiness, port: 8080 }
  periodSeconds: 5
```

---

## Section C — 네트워크 & 보안 (Q13–Q20)

### Q13. CORS와 CSRF의 차이는?

- **CORS (Cross-Origin Resource Sharing)**: 브라우저가 다른 출처(Origin)의 리소스 요청을 허용하는 메커니즘. 서버가 `Access-Control-Allow-Origin` 헤더로 제어
- **CSRF (Cross-Site Request Forgery)**: 인증된 사용자의 세션을 악용하여 의도하지 않은 요청을 보내는 공격

**CSRF 방어:** CSRF 토큰, SameSite 쿠키, Referer 검증

### Q14. HTTPS/TLS 동작 원리는?

1. **TCP 핸드셰이크** (3-way)
2. **TLS 핸드셰이크**: 클라이언트 Hello → 서버 인증서 전송 → 키 교환 (ECDHE) → 세션 키 생성
3. **대칭 키 암호화**: 세션 키로 데이터 암호화 (AES-256-GCM)

**TLS 1.3 개선점:** 핸드셰이크 1-RTT (1.2는 2-RTT), 0-RTT 재연결, 취약 암호 제거.

### Q15. OWASP Top 10에서 가장 중요한 항목 5가지는?

1. **Broken Access Control**: 권한 검사 누락 → URL, API 수준의 인가 검사 필수
2. **Injection**: SQL, NoSQL, OS 명령 주입 → Prepared Statement, ORM 사용
3. **Cryptographic Failures**: 평문 저장, 약한 해시 → bcrypt/argon2, TLS 강제
4. **Security Misconfiguration**: 기본 비밀번호, 불필요한 포트 → 최소 권한 원칙
5. **SSRF**: 내부 네트워크 요청 유도 → URL 화이트리스트, 메타데이터 API 차단

### Q16. JWT의 구조와 보안 주의점은?

**구조:** `Header.Payload.Signature` (Base64URL 인코딩)

**보안 주의점:**
- Payload는 **암호화되지 않음** — 민감 정보 금지
- `alg: none` 공격 방지 — 서버에서 알고리즘 강제 지정
- 탈취 대비 — 짧은 만료시간 + Refresh Token 조합
- 로그아웃 — 토큰 블랙리스트 또는 짧은 TTL로 대응

### Q17. Rate Limiting 구현 전략은?

| 알고리즘 | 동작 | 적합한 경우 |
|----------|------|------------|
| Fixed Window | 시간 창 내 요청 수 제한 | 간단한 구현 |
| Sliding Window | 이동 평균 기반 | 정확한 제한 |
| Token Bucket | 토큰 리필 방식 | 버스트 허용 |
| Leaky Bucket | 고정 속도 처리 | 균일한 처리율 |

**구현:** API Gateway(Kong, Nginx), Spring Cloud Gateway `RequestRateLimiter`, Redis 기반 분산 Rate Limiter

### Q18. 비밀 관리(Secret Management) 베스트 프랙티스는?

1. **하드코딩 금지** — 코드/설정 파일에 비밀 포함 ✗
2. **Vault/AWS Secrets Manager**: 중앙 집중 관리 + 접근 제어
3. **자동 회전(Rotation)**: DB 비밀번호 90일 주기 자동 변경
4. **최소 권한**: 서비스별로 필요한 비밀만 접근
5. **감사 로그**: 비밀 접근 이력 기록

### Q19. 네트워크 분리(VPC/서브넷) 설계 원칙은?

```
Internet → ALB (Public Subnet)
  → Application (Private Subnet)
    → Database (Isolated Subnet, 인터넷 접근 불가)
```

- **Public Subnet**: 인터넷 게이트웨이 연결 (로드밸런서, Bastion)
- **Private Subnet**: NAT Gateway 통해 아웃바운드만 허용 (앱 서버)
- **Isolated Subnet**: 인터넷 연결 없음 (DB, 캐시)
- **Security Group**: 최소 포트만 허용, 소스 기반 제한

### Q20. 인시던트 대응(Incident Response) 프로세스는?

1. **감지(Detect)**: 알람 또는 사용자 리포트
2. **분류(Triage)**: 심각도 판단 (SEV1~SEV4), 담당자 지정
3. **완화(Mitigate)**: 즉시 조치 (롤백, 스케일아웃, 기능 비활성화)
4. **해결(Resolve)**: 근본 원인 수정 + 배포
5. **사후 분석(Postmortem)**: 타임라인, 근본 원인, 재발 방지 액션 아이템

**핵심 원칙:**
- 비난 없는 문화 (Blameless Postmortem)
- 커뮤니케이션 채널 단일화 (Slack/Teams 전용 채널)
- 자동화: PagerDuty/OpsGenie로 에스컬레이션

---

## 마무리 체크리스트

✅ 배포 파이프라인에 보안 스캔(SAST/DAST)이 포함되어 있는가?  
✅ 4대 신호(Latency, Traffic, Errors, Saturation) 모니터링이 구축되어 있는가?  
✅ 비밀 관리가 중앙화되어 있고, 자동 회전이 설정되어 있는가?  
✅ 인시던트 대응 절차가 문서화되어 있고, 팀이 숙지하고 있는가?
