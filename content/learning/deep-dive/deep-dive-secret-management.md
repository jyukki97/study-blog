---
title: "비밀 관리: Vault/Secrets Manager와 Spring 연동"
date: 2025-12-16
draft: false
topic: "Security"
tags: ["Secrets", "Vault", "AWS Secrets Manager", "Spring", "KMS", "SOPS", "Secret Rotation"]
categories: ["DevOps"]
description: "애플리케이션 비밀을 분리·주입·회전하는 설계 — Vault/AWS SM 비교, Spring 연동 코드, 회전 자동화, 유출 대응, 운영 체크리스트까지"
module: "ops-observability"
study_order: 345
---

## 이 글에서 얻는 것

- "설정(config)"과 "비밀(secret)"을 구분하고, 왜 분리해야 하는지(유출/회수 비용) 설명할 수 있습니다.
- 소스/도커 이미지에 비밀을 넣지 않고, 런타임에 안전하게 주입하는 대표 패턴(Env/File/Secret Manager)을 선택할 수 있습니다.
- Vault와 AWS Secrets Manager를 비교하고, 팀 상황에 맞는 것을 선택할 수 있습니다.
- Spring Boot에서 비밀을 주입하고 회전하는 코드를 직접 작성할 수 있습니다.
- 유출 사고 대응 절차와 운영 체크리스트를 갖추게 됩니다.

---

## 0) 비밀 관리가 '운영 능력'인 이유

비밀이 유출되면 보통 "코드 배포로" 해결되지 않습니다.

```
유출 발생
  ↓
1. 키/토큰 폐기 (즉시)
2. 새 키 발급 (회전)
3. 영향 범위 조사 (감사 로그)
4. 재발 방지 시스템 구축 (정책/도구/CI 게이트)
```

**실제 비용:** GitHub에 AWS 키가 커밋되면 평균 **수 분 내**에 봇이 스캔하여 악용합니다. 회수까지 걸리는 시간이 곧 피해 규모입니다.

---

## 1) 무엇이 Secret인가 — 분류 기준

| 구분 | 예시 | 민감도 | 관리 방법 |
|------|------|:---:|------|
| **Secret (필수 보호)** | DB 비밀번호, API 키, OAuth client secret, 암호화 키, JWT signing key | 🔴 | Secret Manager/Vault |
| **Sensitive Config** | 내부 서비스 URL(VPN 내부), feature flag (A/B 테스트 비율) | 🟡 | ConfigMap + 접근 제한 |
| **Plain Config** | 포트, 로그 레벨, 타임아웃 | 🟢 | application.yml, ConfigMap |

### Secret 식별 체크리스트

- [ ] 이 값이 공개되면 금전적 피해가 발생하는가?
- [ ] 이 값으로 다른 시스템에 인증/접근할 수 있는가?
- [ ] 이 값이 유출되면 회수/교체 비용이 발생하는가?

하나라도 Yes → **Secret으로 관리**.

---

## 2) 설계 원칙 5가지

### 2-1) 소스/이미지에 비밀을 넣지 않는다

```bash
# ❌ Git에 커밋된 비밀 (실제 사고의 80%+)
spring.datasource.password=MySecretP@ss123

# ❌ Dockerfile에 하드코딩
ENV DB_PASSWORD=MySecretP@ss123

# ❌ 로그에 노출
log.info("Connecting with password: {}", password);
```

```bash
# ✅ 환경변수로 주입
spring.datasource.password=${DB_PASSWORD}

# ✅ .gitignore에 로컬 비밀 파일 등록
echo ".env.local" >> .gitignore
echo "secrets/" >> .gitignore
```

### 2-2) 최소 권한 (Least Privilege)

```
서비스 A (주문)     → order-db: READ/WRITE
                    → payment-api: 호출 가능
                    → user-db: ✗ 접근 불가

서비스 B (결제)     → payment-db: READ/WRITE
                    → 외부 PG API 키: 접근 가능
                    → order-db: ✗ 접근 불가
```

**구현:**
- **경로 분리**: `secret/order-service/*`, `secret/payment-service/*`
- **IAM Role 기반**: 서비스별 다른 IAM Role → 필요한 Secret만 접근
- **Kubernetes RBAC**: ServiceAccount별 다른 Secret 접근 권한

### 2-3) 회전(Rotate) 가능하게 설계한다

```java
// ❌ 비밀번호 하드코딩 — 회전 시 재배포 필요
@Value("${db.password}")
private final String dbPassword;  // 시작 시 고정

// ✅ 동적 DataSource — 비밀번호 변경 시 커넥션 풀 갱신
@Configuration
public class DynamicDataSourceConfig {

    @Bean
    @RefreshScope  // Spring Cloud 리프레시로 동적 갱신
    public DataSource dataSource(
            @Value("${spring.datasource.url}") String url,
            @Value("${spring.datasource.username}") String username,
            @Value("${spring.datasource.password}") String password) {

        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(url);
        config.setUsername(username);
        config.setPassword(password);
        config.setMaximumPoolSize(20);
        config.setMaxLifetime(Duration.ofMinutes(30).toMillis());  // 커넥션 30분마다 교체
        return new HikariDataSource(config);
    }
}
```

### 2-4) 감사 로그 (Audit Trail)

누가, 언제, 어떤 비밀에 접근했는지 기록:

```json
{
  "timestamp": "2026-03-22T09:15:30Z",
  "event": "secret.read",
  "principal": "order-service/pod-abc123",
  "secret_path": "secret/order-service/db-password",
  "source_ip": "10.0.1.42",
  "result": "allowed"
}
```

### 2-5) 암호화 at Rest + in Transit

- **At Rest**: Secret Manager/Vault는 기본 암호화 (AES-256-GCM 등)
- **In Transit**: TLS 필수 (Vault → App, App → DB 모두)
- **봉투 암호화**: KMS로 DEK(Data Encryption Key) 생성 → DEK로 데이터 암호화 → KMS로 DEK 암호화 저장

---

## 3) 주입 방식 비교

| 방식 | 보안 수준 | 회전 용이성 | 복잡도 | 적합 환경 |
|------|:---:|:---:|:---:|------|
| 환경변수 (Env) | 🟡 | 재배포 필요 | 낮음 | 로컬/간단한 서비스 |
| 파일 마운트 | 🟢 | 파일 교체로 가능 | 중간 | K8s Secret/CSI |
| Secret Manager API | 🟢 | 자동 회전 지원 | 중간 | AWS/GCP/Azure |
| Vault (동적 시크릿) | 🟢🟢 | 자동(임대/만료) | 높음 | 대규모/높은 보안 요구 |

### 환경변수 주입의 한계

```bash
# /proc/$PID/environ 으로 모든 환경변수 노출 가능
cat /proc/1/environ | tr '\0' '\n' | grep PASSWORD
# DB_PASSWORD=MySecretP@ss123  ← 노출!

# 에러 보고(Sentry 등)에 환경변수가 포함될 수 있음
# 컨테이너 inspect로도 조회 가능
docker inspect <container> | jq '.[0].Config.Env'
```

**대안:** 파일 마운트 + 읽은 후 즉시 메모리에만 보관

---

## 4) Vault vs AWS Secrets Manager 비교

| 관점 | HashiCorp Vault | AWS Secrets Manager |
|------|:---:|:---:|
| 운영 부담 | 🔴 직접 운영 (HA/백업/업그레이드) | 🟢 완전 관리형 |
| 동적 시크릿 | ✅ DB 자격증명 자동 생성/만료 | △ Lambda 기반 회전 |
| 정책 세분화 | ✅ ACL/Sentinel 정책 | 🟢 IAM 정책 |
| 암호화 서비스 | ✅ Transit 엔진 (App 암호화) | △ KMS 별도 사용 |
| 멀티클라우드 | ✅ | ✗ AWS 전용 |
| 비용 | 인프라 비용 | $0.40/secret/월 + API 호출 |
| 적합 | 멀티클라우드/높은 보안 요구 | AWS 단일 클라우드 |

### Vault — 동적 DB 시크릿 설정

```bash
# Vault에 DB 시크릿 엔진 활성화
vault secrets enable database

# PostgreSQL 연결 설정
vault write database/config/order-db \
    plugin_name=postgresql-database-plugin \
    connection_url="postgresql://{{username}}:{{password}}@order-db:5432/orders" \
    allowed_roles="order-service-role" \
    username="vault_admin" \
    password="vault_admin_password"

# Role 생성 — 임시 자격증명 (TTL 1시간, 최대 24시간)
vault write database/roles/order-service-role \
    db_name=order-db \
    creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; \
        GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" \
    revocation_statements="DROP ROLE IF EXISTS \"{{name}}\";" \
    default_ttl="1h" \
    max_ttl="24h"
```

```bash
# 자격증명 발급 (매번 다른 사용자/비밀번호)
vault read database/creds/order-service-role
# Key             Value
# lease_id        database/creds/order-service-role/abc123
# lease_duration  1h
# username        v-order-se-abc123-1234567890
# password        A1b2C3d4E5f6G7h8
```

### AWS Secrets Manager — Spring 연동

```yaml
# build.gradle
dependencies {
    implementation 'io.awspring.cloud:spring-cloud-aws-starter-secrets-manager:3.1.0'
}
```

```yaml
# application.yml
spring:
  config:
    import: aws-secretsmanager:/secret/order-service
  cloud:
    aws:
      secretsmanager:
        region: ap-northeast-2
```

```java
// Secrets Manager에 저장된 JSON:
// { "spring.datasource.username": "order_user",
//   "spring.datasource.password": "SecurePass123!" }

// → Spring Boot가 자동으로 프로퍼티로 바인딩
@Value("${spring.datasource.password}")
private String dbPassword;  // "SecurePass123!" 주입됨
```

---

## 5) Spring Boot Vault 연동 — 실전 코드

### 5-1) 의존성과 기본 설정

```groovy
// build.gradle
dependencies {
    implementation 'org.springframework.cloud:spring-cloud-starter-vault-config:4.1.0'
    implementation 'org.springframework.vault:spring-vault-core:3.1.0'
}
```

```yaml
# application.yml
spring:
  cloud:
    vault:
      uri: https://vault.internal.example.com:8200
      authentication: KUBERNETES  # K8s 환경
      kubernetes:
        role: order-service
        service-account-token-file: /var/run/secrets/kubernetes.io/serviceaccount/token
      kv:
        enabled: true
        backend: secret
        default-context: order-service
      # 동적 DB 시크릿 사용 시
      database:
        enabled: true
        role: order-service-role
        backend: database
  config:
    import: vault://
```

### 5-2) AppRole 인증 (비 K8s 환경)

```yaml
spring:
  cloud:
    vault:
      uri: https://vault.internal.example.com:8200
      authentication: APPROLE
      app-role:
        role-id: ${VAULT_ROLE_ID}      # 환경변수로 주입
        secret-id: ${VAULT_SECRET_ID}  # 환경변수로 주입 (1회용 권장)
        role: order-service
```

### 5-3) 비밀 회전 시 자동 갱신

```java
@Configuration
@EnableScheduling
public class VaultLeaseRefreshConfig {

    private final SecretLeaseContainer leaseContainer;
    private final DataSource dataSource;

    @EventListener
    public void onSecretLeaseExpired(SecretLeaseExpiredEvent event) {
        String path = event.getSource().getPath();
        if (path.contains("database/creds")) {
            log.info("DB 시크릿 임대 만료 — 커넥션 풀 갱신 트리거");
            refreshConnectionPool();
        }
    }

    @EventListener
    public void onSecretLeaseRotated(SecretLeaseRotatedEvent event) {
        log.info("DB 시크릿 회전 완료 — 새 자격증명 적용");
        refreshConnectionPool();
    }

    private void refreshConnectionPool() {
        if (dataSource instanceof HikariDataSource hikari) {
            HikariPoolMXBean pool = hikari.getHikariPoolMXBean();
            pool.softEvictConnections();  // 기존 커넥션을 점진적으로 교체
            log.info("커넥션 풀 soft eviction 완료");
        }
    }
}
```

---

## 6) 회전(Rotation) 전략 상세

### 6-1) 이중 키(Dual Key) — JWT 서명 키 회전

```java
@Component
public class JwtKeyRotationManager {

    // 현재 키 + 이전 키를 동시에 유지
    private volatile JwtKeyPair currentKey;
    private volatile JwtKeyPair previousKey;

    /**
     * 서명(Sign): 항상 currentKey 사용
     * 검증(Verify): currentKey → previousKey 순서로 시도
     */
    public String sign(Claims claims) {
        return Jwts.builder()
            .setClaims(claims)
            .setHeaderParam("kid", currentKey.getId())
            .signWith(currentKey.getPrivateKey(), SignatureAlgorithm.RS256)
            .compact();
    }

    public Claims verify(String token) {
        String kid = extractKid(token);

        // 1차: kid에 매칭되는 키로 검증
        JwtKeyPair matchedKey = findKeyById(kid);
        if (matchedKey != null) {
            return parseWithKey(token, matchedKey.getPublicKey());
        }

        // 2차: 키를 순서대로 시도 (kid 누락된 레거시 토큰)
        try {
            return parseWithKey(token, currentKey.getPublicKey());
        } catch (SignatureException e) {
            return parseWithKey(token, previousKey.getPublicKey());
        }
    }

    /**
     * 회전 실행 — 30일 주기 (Cron 또는 수동)
     * Grace period: 이전 키는 토큰 만료 시간(예: 24시간) 동안 유효
     */
    @Scheduled(cron = "0 0 3 1 * *")  // 매월 1일 새벽 3시
    public void rotate() {
        previousKey = currentKey;
        currentKey = generateNewKeyPair();
        publishKeyToJwksEndpoint(currentKey, previousKey);
        log.info("JWT 키 회전 완료: new_kid={}, prev_kid={}",
            currentKey.getId(), previousKey.getId());
    }
}
```

### 6-2) DB 비밀번호 회전 플로우

```
┌──────────┐    1. 새 비밀번호 생성    ┌──────────────┐
│  Vault / │ ──────────────────────→ │     DB       │
│  SM      │    2. ALTER USER         │  (Postgres)  │
│          │ ──────────────────────→ │              │
│          │    3. 새 비밀번호 저장     │              │
│          │ ←────────────────────── │              │
└──────┬───┘                         └──────────────┘
       │ 4. 앱에 새 비밀번호 전파
       ↓
┌──────────┐
│   App    │  5. softEvictConnections()
│  (Spring)│     → 기존 커넥션 점진 교체
└──────────┘
```

**주의:** 회전 중 짧은 시간(수 초) 동안 기존 커넥션과 새 커넥션이 공존합니다. `maxLifetime`을 적절히 설정하여 점진 교체.

---

## 7) 유출 사고 대응 절차 (Incident Response)

### 7-1) 즉시 대응 (0~15분)

```bash
# 1. 유출된 키 즉시 폐기
aws secretsmanager update-secret --secret-id prod/db-password \
    --secret-string "$(openssl rand -base64 32)"

# 또는 Vault에서 revoke
vault lease revoke -prefix database/creds/order-service-role

# 2. AWS IAM 키 유출 시 — 즉시 비활성화
aws iam update-access-key --access-key-id AKIA... --status Inactive --user-name deploy-user

# 3. GitHub에 커밋된 경우 — BFG로 히스토리 제거
# (주의: 이미 복제된 곳에서는 제거 불가)
bfg --replace-text passwords.txt repo.git
git reflog expire --expire=now --all && git gc --prune=now --aggressive
```

### 7-2) 영향 분석 (15분~1시간)

- [ ] 유출된 키로 접근 가능한 리소스 목록 파악
- [ ] 감사 로그에서 비정상 접근 패턴 확인
- [ ] 해당 키가 사용된 다른 서비스/환경 확인
- [ ] 유출 경로 파악 (Git 커밋/로그/에러 보고/공유 문서)

### 7-3) 재발 방지 (1일~1주)

- [ ] Secret Scanning (gitleaks/GitGuardian) CI 게이트 추가
- [ ] pre-commit hook으로 패턴 검사

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks
```

```yaml
# .github/workflows/secret-scan.yml
name: Secret Scan
on: [push, pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 8) Kubernetes 환경 — Secret 주입 베스트 프랙티스

### 8-1) CSI Secret Store Driver (권장)

```yaml
# SecretProviderClass — Vault에서 시크릿 가져오기
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: order-service-secrets
spec:
  provider: vault
  parameters:
    vaultAddress: "https://vault.internal:8200"
    roleName: "order-service"
    objects: |
      - objectName: "db-password"
        secretPath: "secret/data/order-service"
        secretKey: "password"
      - objectName: "api-key"
        secretPath: "secret/data/order-service"
        secretKey: "external-api-key"

---
# Pod에 파일로 마운트
apiVersion: v1
kind: Pod
metadata:
  name: order-service
spec:
  serviceAccountName: order-service-sa
  containers:
    - name: app
      image: order-service:latest
      volumeMounts:
        - name: secrets
          mountPath: "/mnt/secrets"
          readOnly: true
  volumes:
    - name: secrets
      csi:
        driver: secrets-store.csi.k8s.io
        readOnly: true
        volumeAttributes:
          secretProviderClass: "order-service-secrets"
```

### 8-2) External Secrets Operator (멀티 소스)

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: order-service-secrets
spec:
  refreshInterval: 1h  # 1시간마다 동기화
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: order-service-secrets
    creationPolicy: Owner
  data:
    - secretKey: DB_PASSWORD
      remoteRef:
        key: prod/order-service
        property: db-password
    - secretKey: API_KEY
      remoteRef:
        key: prod/order-service
        property: external-api-key
```

---

## 9) 로컬/CI 환경 비밀 관리

### 9-1) 환경별 비밀 주입 전략

| 환경 | 주입 방식 | 도구 |
|------|---------|------|
| 로컬 개발 | `.env.local` (gitignored) | direnv, dotenv |
| CI/CD | GitHub Secrets → 환경변수 | GitHub Actions |
| 스테이징 | Secret Manager (별도 경로) | AWS SM / Vault |
| 프로덕션 | Secret Manager + CSI Driver | AWS SM / Vault |

### 9-2) SOPS로 암호화된 설정 파일 관리

```bash
# SOPS + age 키로 secrets.yaml 암호화
sops --encrypt --age age1ql3z7hjy54pw3h... secrets.yaml > secrets.enc.yaml

# Git에 커밋해도 안전 (암호화된 상태)
git add secrets.enc.yaml

# CI에서 복호화
export SOPS_AGE_KEY=$(cat /run/secrets/sops-age-key)
sops --decrypt secrets.enc.yaml > secrets.yaml
```

---

## 10) 운영 체크리스트

### 설계 단계

- [ ] Secret vs Config 분류표 작성
- [ ] 비밀 주입 방식 결정 (Env/File/Secret Manager)
- [ ] 회전 주기 정책 수립 (DB: 90일, API 키: 180일, 서명 키: 365일)
- [ ] 봉투 암호화(KMS) 적용 여부 결정

### 구현 단계

- [ ] Secret Manager/Vault 연동 코드 작성
- [ ] 동적 DataSource로 비밀번호 회전 대응
- [ ] pre-commit hook + CI Secret Scanning 추가
- [ ] `.gitignore`에 비밀 파일 패턴 등록

### 운영 단계

- [ ] 감사 로그 활성화 (누가/언제/어떤 비밀 접근)
- [ ] 유출 대응 Runbook 작성 및 팀 공유
- [ ] 회전 자동화 + 모니터링 알림 (회전 실패 시)
- [ ] 분기별 비밀 위생 점검 (미사용 키 폐기, 권한 리뷰)

### 모니터링 지표

| 지표 | 임계값 | 알림 |
|------|:---:|------|
| Secret 접근 실패율 | > 1% | Warning |
| 회전 실패 | 1회 | Critical |
| 비밀 만료까지 남은 일수 | < 7일 | Warning |
| 미사용 Secret (90일+) | 존재 | Info (분기 리뷰) |

---

## 연습(추천)

1. **로컬에서는 `.env`로, 운영에서는 `spring.config.import`로** 동일한 설정 키를 주입하도록 구조를 만들어보기
2. **"필수 시크릿 누락" 시 애플리케이션이 시작 단계에서 실패**하도록 `@PostConstruct` 검증을 추가해보기
3. **회전 시나리오를 문서로 써보기** — 누가/어떻게/언제 키를 바꾸고, 장애 시 롤백은 어떻게 하는지
4. **gitleaks를 CI에 추가**하고 의도적으로 비밀 패턴을 커밋해서 차단되는지 확인하기
5. **SOPS로 암호화된 설정 파일**을 Git에 커밋하고, CI에서 복호화하여 주입하는 파이프라인 구축해보기

---

## 관련 심화 학습

- [OWASP Top 10 체크리스트](/learning/deep-dive/deep-dive-owasp-top10-checklist/) — A02 암호화 실패, A07 인증 실패
- [CI/CD 보안과 공급망](/learning/deep-dive/deep-dive-cicd-security-supply-chain/) — Secret Scanning, SBOM
- [설정 관리 전략](/learning/deep-dive/deep-dive-config-management/) — Config vs Secret 분리
- [OAuth2와 OIDC](/learning/deep-dive/deep-dive-oauth2-oidc/) — Client Secret 관리
- [Spring Security](/learning/deep-dive/deep-dive-spring-security/) — 인증/인가 통합
- [JWT 인증](/learning/deep-dive/deep-dive-jwt-auth/) — Signing Key 회전
- [Kubernetes 기초](/learning/deep-dive/deep-dive-kubernetes-basics/) — K8s Secret, RBAC
