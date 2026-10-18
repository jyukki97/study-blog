---
title: "백엔드 커리큘럼 심화: 관측 데이터 분류·마스킹, 로그를 증거로 남기되 비밀값을 새지 않는 법"
date: 2026-10-18T10:06:00+09:00
lastmod: 2026-10-18T10:06:00+09:00
draft: false
topic: "Backend Observability Security"
tags: ["Observability", "Log Redaction", "PII", "Secrets", "OpenTelemetry", "Data Governance"]
categories: ["Backend Deep Dive"]
description: "로그·trace·metric을 장애 증거로 유지하면서도 개인정보와 비밀값을 줄이는 데이터 분류, 수집 경계, 마스킹, 검증 기준을 정리합니다."
summary: "관측 데이터는 디버깅에 유용할수록 민감한 원문을 담기 쉽다. 수집 뒤 정규식으로 지우는 방식만 믿지 말고, 데이터 분류·수집 허용 목록·전송 전 변환·보존·접근 통제를 하나의 계약으로 운영해야 한다."
module: "ops-observability"
study_order: 1562
keywords: ["observability data redaction", "logging PII", "secret masking", "trace data governance", "OpenTelemetry redaction"]
key_takeaways:
  - "마스킹은 로그 저장소의 기능 하나가 아니라 애플리케이션 계측, collector, sink, 조회 권한에 걸친 다층 통제다."
  - "원문을 넓게 수집한 뒤 나중에 지우는 것보다, 필드별 허용 목록과 형태 검증으로 수집 자체를 좁히는 편이 누락에 강하다."
operator_checklist:
  - "토큰·비밀번호·cookie·인가 header·전체 body는 기본 거부하고, 필요한 상관관계에는 목적 제한 식별자를 쓴다."
---

장애를 분석할 때 운영자는 요청 ID, 사용자 상태, 외부 API 응답, SQL 조건, 예외 stack trace를 원합니다. 문제는 이 정보가 많아질수록 access token, 세션 cookie, 이메일 주소, 배송지, 결제 식별자처럼 서비스가 원래 보호해야 하는 값도 관측 파이프라인으로 흘러들기 쉽다는 점입니다. 한 번 중앙 로그 저장소와 alert, export, 개발자 로컬 다운로드에 복제된 원문은 삭제 요청 하나로 회수하기 어렵습니다.

그래서 관측성의 목표를 “최대한 많이 남긴다”로 두면 안 됩니다. 목표는 **장애를 재현하고 책임을 설명할 수 있을 만큼의 증거를, 그 목적에 필요한 최소 범위로 남기는 것**입니다. 이 글은 [구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/), [분산 추적 도입](/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/), [변조 방지 감사 로그](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/), [필드 단위 암호화](/learning/deep-dive/deep-dive-envelope-encryption-pii-field-crypto-playbook/)의 원칙을 수집·마스킹 운영으로 연결합니다.

## 이 글에서 얻는 것

- 로그, trace, metric, audit event가 같은 민감도와 보존 기간을 가질 수 없는 이유를 이해합니다.
- “정규식으로 비밀번호를 가린다”보다 견고한 필드 분류와 허용 목록 기반 계측 방식을 설계합니다.
- collector와 저장소에 도달하기 전후로 어떤 방어선을 둬야 하는지 구분합니다.
- redaction 누락을 테스트하고, 장애 분석력을 잃지 않았는지 숫자로 판정하는 기준을 만듭니다.

## 핵심 개념/이슈

### 1) 관측 데이터는 원본 업무 데이터의 그림자가 아니다

업무 DB는 schema, 접근 권한, 삭제 절차를 두고 관리하는 반면, 로그는 문자열처럼 취급되기 쉽습니다. 하지만 아래 값은 모두 개인 또는 보안 데이터가 될 수 있습니다.

| 신호 | 위험한 원문 예 | 보통 충분한 대체값 |
| --- | --- | --- |
| HTTP 로그 | `Authorization`, `Cookie`, 전체 request body | auth scheme, token 존재 여부, body 크기, 허용된 error code |
| trace attribute | 이메일, 전화번호, 주문 상세 | tenant ID, pseudonymous user hash, order state |
| 예외 | ORM entity 전체 `toString()`, upstream 응답 body | exception type, stable error code, response size |
| metric label | 고객 ID, URL 전체, 검색어 | endpoint template, tenant tier, outcome class |
| 감사 event | 권한 변경 전후 전체 payload | actor, 대상 ID, 변경 종류, 승인 ID, payload digest |

`user_id`도 자동으로 안전하다고 보지 마세요. 조직의 다른 시스템과 쉽게 결합해 개인을 식별할 수 있거나 외부에 노출될 수 있다면 confidential로 분류해야 합니다. 반대로 장애 상관관계가 필요하다면 원문 이메일 대신 회전 가능한 HMAC 기반 `user_ref`처럼 목적 제한된 식별자를 쓸 수 있습니다. 이 값도 키 회전, 충돌, 접근 범위를 고려해야 하므로 익명화라는 말로 책임이 사라지지 않습니다.

### 2) redaction은 한 지점의 filter가 아니라 실패를 가정한 방어선이다

애플리케이션 logger 앞단의 filter만 두면 라이브러리 debug 로그, proxy access log, 예외 처리 우회, 새 서비스의 직접 exporter가 빠질 수 있습니다. 반대로 collector만 믿으면 원문이 process stdout, APM agent buffer, dead-letter topic을 이미 지나갔을 수 있습니다. 따라서 아래 네 경계의 역할을 나눕니다.

1. **생성 전**: DTO와 logger API가 허용된 field만 받게 합니다. request/response 전체 덤프는 debug 환경에서도 명시 승인 없이는 막습니다.
2. **프로세스 안**: header와 query parameter는 allowlist로 추출하고, known secret key는 값 자체를 format하지 않습니다.
3. **collector**: 정규식·형태 검사로 우회 경로를 한 번 더 가리고, 예상 못 한 high-risk field는 격리 또는 drop 합니다.
4. **저장·조회**: 환경별 index와 접근 권한을 분리하고, 짧은 보존 기간·export 감사·삭제 가능 범위를 적용합니다.

특히 “문자열에 `token`이 들어가면 마스킹” 같은 규칙은 충분하지 않습니다. `session`, `credential`, `api_key` 같은 이름 변형과 JSON 중첩, URL encoding, base64, multipart body를 놓치기 쉽고, `token_count`처럼 안전한 값을 과도하게 지워 분석력을 낮출 수도 있습니다. field 이름, MIME type, 길이, 값의 형태를 함께 보는 규칙과 unknown field 기본 거부가 필요합니다.

### 3) 추적 가능성과 기밀성은 같은 필드를 요구하지 않는다

운영자가 원하는 질문은 대체로 “어느 요청이 실패했는가”, “어느 tenant에서 증가했는가”, “같은 재시도가 반복되는가”입니다. 이 질문에는 고객의 원문 입력이 필요 없는 경우가 많습니다. `trace_id`, `request_id`, endpoint template, status family, dependency name, retry attempt, normalized error code만으로도 상당수 incident를 좁힐 수 있습니다.

실제 payload 검사가 필요한 예외는 존재합니다. 이때는 전체 관측 저장소의 검색 기능을 열지 말고, 짧은 TTL을 가진 격리 artifact에 암호화해 보관하고, incident ID·승인자·조회 시각을 남기는 절차가 낫습니다. 평상시 모든 request body를 남기는 것은 좋은 디버깅이 아니라 장기 유출면을 만드는 일입니다.

## 실무 적용

### 1) field inventory와 수집 계약부터 만든다

처음부터 전사 분류 체계를 완성하려 하지 말고, internet-facing API와 인증·결제·파일 업로드 경로의 상위 30개 field부터 시작합니다. 각 field에 아래 판단을 남깁니다.

| 필드 | 분류 | 수집 방식 | 보존·접근 | 대체안 |
| --- | --- | --- | --- | --- |
| `http.route` | internal | allow | 30일, 운영 역할 | route template |
| `enduser.id` | confidential | hash 후 allow | 14일, incident role | 회전 HMAC reference |
| `http.request.header.authorization` | restricted | deny | 저장 금지 | scheme 존재 여부 |
| `payment.transaction_id` | confidential | allow | 30일, 결제 on-call | 필요 시 부분 마스킹 |
| `http.request.body` | restricted | 기본 deny | 저장 금지 | size, schema error code |

분류가 없는 새 attribute는 통과시키지 말고 `telemetry_unknown_field_total`로 집계합니다. 하루 1건의 unknown은 문서 보완 항목일 수 있지만, 배포 직후 급증하면 exporter 또는 middleware 변경을 멈추고 원인을 확인해야 합니다. 새 서비스가 빠르게 늘어나는 조직이라면 schema registry나 CI lint가 이 계약을 강제하도록 발전시킬 수 있습니다.

### 2) 숫자로 시작하는 운영 기준을 둔다

기준선은 조직의 규제와 사고 이력에 맞게 조정해야 하지만, 다음은 현실적인 출발점입니다.

- high-risk field가 collector까지 도달한 건수는 **0건**이 hard gate입니다. 한 건이면 severity와 무관하게 해당 경로를 격리합니다.
- redaction fixture 200개 이상에서 known secret·cookie·인증 header 탐지율은 **100%**, 안전한 정상 field의 오탐 삭제는 **1% 미만**을 목표로 합니다.
- production debug 로그의 body capture는 기본 **0%**입니다. incident override는 owner 2인 승인과 **24시간 이하 TTL**을 둡니다.
- confidential trace attribute의 보존은 우선 **14~30일**, 일반 운영 로그는 **30~90일**처럼 목적별로 분리합니다. “무기한”은 근거 없는 기본값으로 두지 않습니다.
- 분기마다 대표 요청 50개와 악의적 변형 50개를 replay해, collector와 sink에서 원문이 남지 않는지 확인합니다.

마스킹률이 높다고 성공은 아닙니다. drop이 급증해 retry 원인을 전혀 분류하지 못하거나 정상 correlation key까지 지워지면 서비스 복구 시간이 늘어납니다. redaction hit 수, unknown field 수, incident에서 필요한 상관관계를 찾는 데 걸린 시간, 민감 데이터 탐지 건수를 함께 보세요.

### 3) 테스트는 정상 입력보다 우회 입력을 중심으로 한다

CI fixture에는 `Authorization: Bearer ...`만 넣지 말고, 대소문자 변형, 중첩 JSON, 배열, URL-encoded query, escaped 문자열, base64처럼 실제 우회가 일어나는 형태를 넣습니다. 개발자가 새 HTTP client를 추가하거나 logger format을 바꿀 때 fixture가 실패하면, 보안팀 검토를 기다리지 않고 변경자가 원인을 바로 볼 수 있습니다.

운영에서도 canary 요청 하나로 충분하지 않습니다. 실제 collector config, sampling, gzip, retry queue, dead-letter와 최종 sink까지 같은 형식이 유지되는지 확인해야 합니다. secret을 실제로 넣는 대신 테스트 전용 sentinel 값과 단방향 fingerprint를 사용하면, 검사 과정 자체가 또 다른 유출이 되는 일을 피할 수 있습니다.

## 트레이드오프/주의점

첫째, hash는 만능 마스킹이 아닙니다. 작은 도메인의 전화번호 끝자리나 국가 코드처럼 후보가 적은 값은 쉽게 대입할 수 있고, 같은 salt를 오래 쓰면 여러 데이터셋을 연결할 수 있습니다. 상관관계가 꼭 필요할 때만 키 관리가 되는 HMAC을 쓰고, 원문과 mapping table을 관측 플랫폼에 두지 마세요.

둘째, compliance 요구 때문에 모든 데이터를 감사 로그에 복사하는 설계도 위험합니다. 감사 로그는 누가 어떤 행위를 했는지를 설명하는 데 강하고, 전체 request payload 보관소가 아닙니다. 불변성·보존 기간·삭제 의무가 충돌할 수 있으므로, payload는 별도 분류된 시스템에 두고 audit에는 digest와 참조만 남기는 편이 낫습니다.

셋째, emergency override는 꼭 필요하지만 상시 예외가 되면 안 됩니다. 승인 없는 debug flag, 환경 변수 하나로 켜지는 raw payload logging, 개인 노트북으로의 로그 export는 공격자에게도 같은 우회로를 제공합니다. 우선순위는 **수집 최소화 → 전송 전 변환 → 제한된 조회 → 짧은 보존 → 사고 대응 증거**입니다.

## 체크리스트 또는 연습

- [ ] 상위 API의 telemetry field를 public/internal/confidential/restricted로 분류하고 owner를 지정했다.
- [ ] 인증 header, cookie, 비밀번호, access token, 전체 body는 allowlist 밖에서 기본 거부된다.
- [ ] 프로세스·collector·sink 각각에서 누락될 수 있는 경로를 한 번 이상 점검했다.
- [ ] 정상·중첩·인코딩·오타 변형을 포함한 redaction fixture가 CI에서 실행된다.
- [ ] high-risk leak 0건, fixture 탐지율 100%, override TTL 24시간 이하처럼 조치 가능한 수치를 정했다.
- [ ] incident용 제한 artifact와 일반 observability 저장소의 접근·보존 규칙을 분리했다.

연습으로 로그인 API 하나를 고르세요. 현재 로그와 trace에서 나오는 field를 적고, “장애 원인 분류에 정말 필요한가”를 한 항목씩 표시합니다. 이메일·authorization·body를 제거한 뒤에도 실패한 dependency, status, latency, retry, correlation을 설명할 수 있다면 그 설계가 더 안전한 출발점입니다. 설명이 안 된다면 원문을 복구하기 전에 필요한 업무 상태를 좁은 enum이나 pseudonymous reference로 새로 계측해 보세요.

## 관련 글

- [구조화 로깅: 검색 가능한 사건 기록 만들기](/learning/deep-dive/deep-dive-structured-logging/)
- [분산 추적 도입 플레이북](/learning/deep-dive/deep-dive-distributed-tracing-adoption-playbook/)
- [변조 방지 감사 로그 플레이북](/learning/deep-dive/deep-dive-tamper-evident-audit-log-playbook/)
- [Envelope Encryption과 PII 필드 암호화](/learning/deep-dive/deep-dive-envelope-encryption-pii-field-crypto-playbook/)
