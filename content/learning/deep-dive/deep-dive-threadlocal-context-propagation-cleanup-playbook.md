---
title: "백엔드 커리큘럼 심화: ThreadLocal Context Propagation, 요청 컨텍스트 전파와 누수 방지"
date: 2026-07-19
draft: false
topic: "Java/Spring Operations"
tags: ["Java", "Spring", "ThreadLocal", "MDC", "SecurityContext", "Async", "Observability"]
categories: ["Backend Deep Dive"]
description: "MDC, SecurityContext, tenant context, transaction context처럼 ThreadLocal에 올라가는 요청 컨텍스트를 안전하게 전파하고 반드시 정리하는 실무 기준을 정리합니다."
module: "backend-ops-observability"
study_order: 1258
summary: "ThreadLocal은 동기 요청 흐름에서는 편하지만 스레드 풀, @Async, 메시지 컨슈머, virtual thread 전환 구간에서는 컨텍스트 유실과 이전 요청 오염을 동시에 만들 수 있다. 전파 대상, 금지 대상, 정리 지점, 관측 지표를 계약으로 고정해야 한다."
key_takeaways:
  - "ThreadLocal 컨텍스트는 요청 식별자, 인증 정보, tenant id처럼 작고 명확한 값만 담아야 하며, 큰 객체와 Entity를 넣으면 누수와 보안 사고로 이어진다."
  - "@Async, custom executor, scheduler, message listener는 ThreadLocal이 자동 전파되지 않는 경계이므로 TaskDecorator나 명시적 context carrier가 필요하다."
  - "요청 종료, 작업 종료, 예외 종료에서 clear가 항상 실행되는지 테스트하고 traceId 누락률, context leakage, MDC cardinality를 지표로 본다."
operator_checklist:
  - "모든 executor에 MDC/SecurityContext 전파 정책이 명시되어 있고, 전파하지 않을 executor도 이유를 문서화한다."
  - "요청 컨텍스트 필드는 traceId, requestId, tenantId, userId 같은 작은 식별자로 제한하고 payload, token, Entity, 대용량 DTO는 금지한다."
  - "비동기 작업과 메시지 컨슈머에서 이전 요청의 MDC 또는 SecurityContext가 섞이지 않는 회귀 테스트를 둔다."
  - "traceId 누락률 0.5% 초과, context leakage 1건 이상, 로그 cardinality 급증은 배포 회귀 후보로 본다."
learning_refs:
  - title: "구조화 로깅"
    href: "/learning/deep-dive/deep-dive-structured-logging/"
    description: "MDC를 JSON 로그 필드로 연결하고 검색 가능한 로그 계약을 만드는 기본기입니다."
  - title: "Spring @Async"
    href: "/learning/deep-dive/deep-dive-spring-async/"
    description: "ThreadPoolTaskExecutor와 CompletableFuture를 사용할 때 컨텍스트 경계가 어디서 끊기는지 같이 봅니다."
  - title: "Thread Pool 튜닝"
    href: "/learning/deep-dive/deep-dive-thread-pool/"
    description: "스레드 재사용과 큐 전략을 이해해야 ThreadLocal 오염 원인을 찾기 쉽습니다."
  - title: "Java Virtual Threads"
    href: "/learning/deep-dive/deep-dive-java-virtual-threads-spring-mvc-webflux-playbook/"
    description: "Virtual Thread 도입 전 ThreadLocal payload와 pinning 위험을 점검하는 기준입니다."
decision_guide:
  title: "ThreadLocal 컨텍스트를 언제 쓰고 언제 피할까"
  intro: "ThreadLocal은 편의 도구이지 도메인 상태 저장소가 아닙니다. 요청 범위의 작은 식별자에는 쓸 수 있지만, 비동기 경계를 넘거나 장기 작업으로 가면 명시적 파라미터와 context object가 더 안전합니다."
  cases:
    - badge: "사용 적합"
      title: "로그·트레이스·감사에 필요한 요청 식별자"
      fit: "traceId, requestId, tenantId, userId처럼 문자열 몇 개로 표현되는 값"
      watchouts: "MDC clear가 빠지면 다음 요청 로그에 섞인다."
      next_step: "필터 또는 interceptor에서 put/clear를 finally로 묶는다."
    - badge: "명시 전달"
      title: "비즈니스 판단에 필요한 컨텍스트"
      fit: "권한 정책 버전, 주문 처리 옵션, 외부 API 호출 정책처럼 코드 흐름에서 의미가 큰 값"
      watchouts: "ThreadLocal에 숨기면 테스트와 리팩터링이 어려워진다."
      next_step: "메서드 인자 또는 RequestContext 객체로 전달한다."
    - badge: "금지"
      title: "토큰, Entity, 큰 DTO, InputStream"
      fit: "요청 종료 후 남으면 보안·메모리 문제가 되는 값"
      watchouts: "스레드 풀 재사용 시 다른 사용자 요청에 노출될 수 있다."
      next_step: "필요한 최소 id만 뽑아 저장하고 원본은 로컬 변수로 제한한다."
faqs:
  - question: "MDC만 clear하면 충분한가요?"
    answer: "아닙니다. MDC 외에도 SecurityContextHolder, RequestContextHolder, tenant holder, 직접 만든 ThreadLocal이 있을 수 있습니다. 팀에서 사용하는 holder 목록을 만들고 모두 정리해야 합니다."
  - question: "@Async에서 SecurityContext가 사라지는 것은 버그인가요?"
    answer: "대부분 정상 동작입니다. 새 스레드에서는 부모 ThreadLocal을 자동으로 볼 수 없습니다. DelegatingSecurityContextExecutor나 TaskDecorator처럼 전파 방식을 명시해야 합니다."
---

ThreadLocal은 Spring 백엔드에서 아주 자주 보이는 도구입니다. `MDC`는 로그에 `traceId`를 넣고, `SecurityContextHolder`는 현재 인증 정보를 들고 있으며, 멀티테넌트 서비스는 `TenantContextHolder` 같은 클래스를 만들어 현재 tenant를 저장합니다. 동기 MVC 요청만 보면 편합니다. 컨트롤러에서 서비스, 리포지토리까지 같은 스레드를 타기 때문에 매번 `requestId`를 인자로 넘기지 않아도 됩니다.

문제는 운영 서비스가 더 이상 "요청 하나, 스레드 하나, 끝"으로만 움직이지 않는다는 점입니다. `@Async`, `CompletableFuture`, scheduler, Kafka listener, custom executor, virtual thread, WebFlux 경계를 만나면 ThreadLocal은 갑자기 사라지거나, 더 위험하게는 이전 요청 값이 남아 섞일 수 있습니다. 장애 분석을 하려고 로그를 봤는데 A 사용자의 traceId와 B 사용자의 userId가 같은 줄에 찍히면 관측성 문제가 아니라 보안 사고 후보입니다.

이 글은 [구조화 로깅](/learning/deep-dive/deep-dive-structured-logging/), [Spring @Async](/learning/deep-dive/deep-dive-spring-async/), [Thread Pool 튜닝](/learning/deep-dive/deep-dive-thread-pool/), [Java Virtual Threads](/learning/deep-dive/deep-dive-java-virtual-threads-spring-mvc-webflux-playbook/)와 이어집니다. 기존 글들이 로그, 비동기 실행, 스레드 수를 따로 봤다면, 이번 글은 그 사이를 지나는 **요청 컨텍스트의 생명주기**를 운영 기준으로 묶습니다.

## 이 글에서 얻는 것

- ThreadLocal 기반 컨텍스트가 언제 유실되고 언제 오염되는지 구분할 수 있습니다.
- MDC, SecurityContext, tenant context를 안전하게 전파하는 기준을 정리합니다.
- `@Async`, scheduler, message consumer, virtual thread 도입 전 봐야 할 숫자와 테스트 기준을 가져갑니다.
- 요청 컨텍스트에 넣어도 되는 값과 넣으면 안 되는 값을 실무 규칙으로 나눌 수 있습니다.

## 핵심 개념/이슈

### 1) ThreadLocal은 "현재 스레드"의 저장소다

ThreadLocal은 전역 저장소가 아닙니다. 이름 그대로 현재 스레드에 붙은 작은 저장 공간입니다. Spring MVC에서 요청 하나가 같은 worker thread로 처리되는 동안에는 이 특성이 장점입니다. 필터에서 `MDC.put("traceId", traceId)`를 하면 아래 호출 스택의 모든 로그가 같은 traceId를 갖습니다.

하지만 스레드 풀이 재사용된다는 점이 핵심입니다. 요청이 끝나도 worker thread는 사라지지 않고 다음 요청을 처리합니다. 그래서 마지막에 `clear()` 또는 `remove()`가 빠지면 다음 요청이 이전 요청의 값을 물려받을 수 있습니다. 메모리 누수도 여기서 시작합니다. `ThreadLocal<UserEntity>`처럼 큰 객체를 넣어 두면 요청이 끝났는데도 worker thread가 참조를 잡고 있어 GC가 회수하지 못합니다.

실무 기준은 보수적으로 잡는 편이 좋습니다.

| 항목 | 허용 | 금지 |
| --- | --- | --- |
| 로그 식별자 | `traceId`, `requestId`, `spanId` | 원문 request body |
| 사용자 정보 | 내부 `userId`, role code | access token, email 원문, 주민번호 |
| 테넌트 정보 | `tenantId`, plan code | tenant 설정 전체 객체 |
| 도메인 정보 | `orderId`, `jobId` 같은 짧은 id | JPA Entity, DTO, collection |
| 정책 정보 | `policyVersion`, `featureFlagSnapshotId` | mutable config object |

요청 컨텍스트 payload는 가능하면 1KB 이하로 제한합니다. 로그·트레이스 검색에 필요한 식별자만 담고, 업무 판단에 필요한 데이터는 명시적인 메서드 인자나 `RequestContext` 객체로 전달하는 편이 테스트하기 쉽습니다.

### 2) 컨텍스트 유실과 컨텍스트 오염은 다른 사고다

컨텍스트 유실은 새 스레드에서 값이 없는 문제입니다. 예를 들어 컨트롤러에서 `traceId=req-1`로 시작했는데 `@Async` 메서드 로그에는 traceId가 없습니다. 이 경우 장애 분석 때 비동기 작업과 원 요청을 연결하기 어렵습니다.

컨텍스트 오염은 더 위험합니다. worker thread가 이전 작업의 MDC를 지우지 않아 다음 작업 로그에 잘못된 userId나 tenantId가 찍히는 상태입니다. 유실은 "안 보인다"의 문제지만, 오염은 "틀리게 보인다"의 문제입니다. 운영자는 틀린 로그를 근거로 잘못된 고객, 잘못된 tenant, 잘못된 요청을 조사할 수 있습니다.

판정 기준도 다르게 둡니다.

| 증상 | 대표 원인 | 운영 기준 |
| --- | --- | --- |
| 비동기 로그 traceId 없음 | 전파 누락 | 누락률 0.5% 초과 시 개선 대상 |
| 다른 userId가 섞임 | clear 누락 | 1건이라도 배포 회귀 |
| scheduler 로그가 이전 requestId 보유 | 공용 executor 오염 | 즉시 수정 |
| tenant context가 consumer에 남음 | listener finally 누락 | 재처리 전 격리 |

장애 조사에서 "로그가 없어서 느리다"보다 "로그가 틀려서 잘못 판단한다"가 더 위험합니다. 그래서 clear 테스트는 전파 테스트보다 우선순위를 높게 둬야 합니다.

### 3) 비동기 경계는 자동 전파를 기대하면 안 된다

`@Async`는 별도 executor에서 작업을 실행합니다. `CompletableFuture.supplyAsync()`도 지정하지 않으면 common pool을 사용할 수 있습니다. 메시지 컨슈머와 scheduler도 HTTP 요청 thread와 무관합니다. 이 경계에서는 ThreadLocal이 자동으로 따라오지 않는다고 보는 편이 안전합니다.

Spring에서는 `TaskDecorator`로 MDC를 복사할 수 있습니다.

```java
public class ContextCopyingTaskDecorator implements TaskDecorator {
    @Override
    public Runnable decorate(Runnable task) {
        Map<String, String> mdc = MDC.getCopyOfContextMap();
        SecurityContext securityContext = SecurityContextHolder.getContext();

        return () -> {
            Map<String, String> previousMdc = MDC.getCopyOfContextMap();
            SecurityContext previousSecurity = SecurityContextHolder.getContext();
            try {
                if (mdc != null) {
                    MDC.setContextMap(mdc);
                } else {
                    MDC.clear();
                }
                SecurityContextHolder.setContext(securityContext);
                task.run();
            } finally {
                MDC.clear();
                if (previousMdc != null) {
                    MDC.setContextMap(previousMdc);
                }
                SecurityContextHolder.setContext(previousSecurity);
            }
        };
    }
}
```

핵심은 복사보다 복구입니다. worker thread에 기존 값이 있을 수 있으므로, 작업 시작 전 상태를 보관하고 작업 종료 후 정리합니다. 간단한 예제에서는 `MDC.clear()`만 보여주는 경우가 많지만, 공용 executor를 쓰는 코드에서는 이전 상태 복원이 더 안전할 때가 있습니다.

`SecurityContext`는 Spring Security가 제공하는 `DelegatingSecurityContextExecutor` 계열도 검토할 수 있습니다. 단, 무조건 전파가 정답은 아닙니다. 사용자의 인증 컨텍스트로 백그라운드 작업을 계속 실행하면 권한 만료, 계정 비활성화, 감사 로그 기준이 애매해질 수 있습니다. 비동기 작업이 사용자 권한으로 실행되는지, 시스템 권한으로 실행되는지 먼저 결정해야 합니다.

### 4) 메시지 컨슈머와 배치는 요청 컨텍스트를 새로 만든다

Kafka, SQS, RabbitMQ 같은 메시지 컨슈머는 HTTP 요청의 연장이 아닙니다. 메시지 헤더에 `traceparent`, `correlationId`, `tenantId`, `producerVersion`이 들어 있다면 그것을 읽어 새 컨텍스트를 구성해야 합니다. 없다면 consumer 자체가 새로운 root trace를 만들어야 합니다.

컨슈머에서 흔한 실수는 실패 메시지를 처리하다가 MDC를 지우지 않는 것입니다. 같은 consumer thread가 다음 메시지를 처리하므로, 이전 메시지의 `orderId`가 다음 메시지 로그에 찍힐 수 있습니다. 특히 poison message를 격리하거나 재처리할 때는 로그 오염이 원인 분석을 크게 흐립니다. 이 흐름은 [Poison Message Quarantine](/learning/deep-dive/deep-dive-poison-message-quarantine-safe-replay-playbook/)과 같이 봐야 합니다.

컨슈머 기준은 아래처럼 둡니다.

- 메시지 시작 시 header에서 context를 만든다.
- header가 없으면 `consumer-{topic}-{partition}-{offset}` 기반 requestId를 만든다.
- 처리 결과와 예외 로그에는 topic, partition, offset, retry_count, dead_letter_reason을 포함한다.
- `finally`에서 MDC, tenant holder, custom ThreadLocal을 모두 지운다.
- 같은 consumer thread로 서로 다른 tenant 메시지 2개를 연속 처리하는 테스트를 둔다.

배치와 scheduler도 비슷합니다. 사람이 누른 요청이 아니므로 userId를 억지로 만들지 말고 `actor=system`, `jobId`, `runId`, `triggerType`을 명시하는 편이 낫습니다.

### 5) Virtual Thread는 누수를 없애는 마법이 아니다

Virtual Thread는 요청마다 새 virtual thread를 만들 수 있으므로, 전통적인 worker pool 재사용 오염은 줄어들 수 있습니다. 하지만 ThreadLocal 문제 자체가 사라지는 것은 아닙니다. virtual thread 수가 많아지면 ThreadLocal payload가 큰 경우 메모리 압박이 더 빨리 보일 수 있고, 오래된 라이브러리가 ThreadLocal에 큰 객체를 숨기면 원인 추적이 어려워집니다.

Virtual Thread 도입 전에는 [Java Virtual Threads](/learning/deep-dive/deep-dive-java-virtual-threads-spring-mvc-webflux-playbook/)의 기준을 가져와서 다음을 점검합니다.

- request당 ThreadLocal key 수가 10개 이하인가
- 각 key payload가 문자열/작은 enum/id 중심인가
- MDC에 고카디널리티 또는 민감 필드가 들어가지 않는가
- `ThreadLocal.remove()`가 filter, interceptor, listener, decorator에 모두 있는가
- pinning 의심 구간과 ThreadLocal-heavy 구간이 hot path에 겹치지 않는가

## 실무 적용

### 1) Context holder 목록부터 만든다

팀에서 쓰는 컨텍스트 저장소를 먼저 inventory합니다. 보통 아래 항목이 섞여 있습니다.

```yaml
context_holders:
  MDC:
    fields: ["traceId", "spanId", "requestId", "tenantId", "userId"]
    owner: platform-observability
    clear_at: ["http_filter", "task_decorator", "message_listener"]
  SecurityContextHolder:
    fields: ["authentication"]
    owner: identity-platform
    clear_at: ["spring_security_filter", "async_decorator"]
  TenantContextHolder:
    fields: ["tenantId", "region"]
    owner: core-platform
    clear_at: ["tenant_filter", "consumer_finally"]
  RequestContextHolder:
    fields: ["request_attributes"]
    owner: web-platform
    clear_at: ["framework_managed", "custom_thread_boundary_blocked"]
```

이 목록이 없으면 코드 리뷰에서 빠집니다. 새 ThreadLocal holder를 만들 때는 owner, 허용 필드, clear 위치, 테스트 파일을 같이 추가하도록 규칙화합니다.

### 2) HTTP filter는 put과 clear를 한 파일에서 닫는다

요청 시작과 종료가 분리되면 실수하기 쉽습니다. 필터나 interceptor에서는 put과 clear를 최대한 같은 블록에 둡니다.

```java
try {
    MDC.put("traceId", traceId);
    MDC.put("requestId", requestId);
    TenantContext.set(tenantId);
    filterChain.doFilter(request, response);
} finally {
    TenantContext.clear();
    MDC.clear();
}
```

clear 순서는 팀 규칙으로 고정합니다. 예를 들어 custom holder를 먼저 지우고 마지막에 MDC를 지웁니다. 그래야 clear 중 예외가 나도 로그에 최소한의 traceId가 남습니다. clear 메서드는 예외를 던지지 않게 만드는 편이 좋습니다.

### 3) Executor는 용도별로 전파 정책을 다르게 둔다

모든 executor에 같은 정책을 넣으면 오히려 위험합니다.

| executor | 전파 대상 | 전파 금지 | 이유 |
| --- | --- | --- | --- |
| requestAsyncExecutor | MDC, trace context, 제한된 userId | access token, Entity | 요청 보조 작업 추적 |
| systemJobExecutor | runId, jobId | user SecurityContext | 시스템 권한 작업 |
| notificationExecutor | correlationId, tenantId | request body | 알림 발송 감사 |
| externalApiExecutor | trace context, deadline | mutable business object | timeout과 재시도 추적 |

사용자 요청에서 출발한 짧은 비동기 작업은 MDC와 trace context를 전파하는 게 좋습니다. 반면 매일 새벽 도는 정산 job에 마지막 HTTP 요청의 SecurityContext가 들어가면 안 됩니다. 전파는 편의가 아니라 권한 정책입니다.

### 4) 관측 지표를 둔다

컨텍스트 품질은 테스트만으로 부족합니다. 운영에서 누락률과 오염 의심을 봐야 합니다.

추천 지표:

- `log_trace_id_missing_ratio{service,executor}`: 0.5% 초과 시 개선
- `async_task_context_missing_total{executor,field}`: 새 executor 배포 후 증가 감시
- `context_leakage_suspected_total{service}`: userId와 tenantId 불일치 등 1건 이상 조사
- `mdc_field_cardinality{field}`: requestId 제외한 필드가 급증하면 금지 필드 의심
- `security_context_async_usage_total{executor}`: 사용자 권한 전파가 허용된 executor인지 검증

정확한 오염 탐지는 어렵지만, tenantId와 userId의 조직 매핑이 맞지 않거나 같은 requestId에 서로 다른 userId가 찍히는 경우는 강한 신호입니다. 이런 검사는 로그 파이프라인에서 샘플링으로도 충분히 효과가 있습니다.

### 5) 회귀 테스트는 "연속 실행"으로 만든다

ThreadLocal 버그는 단일 테스트로 잘 안 잡힙니다. 같은 worker thread가 재사용되는 상황을 만들어야 합니다.

테스트 아이디어:

1. fixed thread pool size 1로 executor를 만든다.
2. 첫 작업에 `tenant=A`, `user=alice`를 넣고 예외를 발생시킨다.
3. 두 번째 작업에 `tenant=B`, `user=bob`을 넣는다.
4. 두 번째 작업 로그와 holder에 A/alice가 남지 않는지 검증한다.
5. context가 없는 세 번째 작업을 실행해 이전 값이 없는지 확인한다.

이 테스트는 단순하지만 강합니다. 예외 종료, timeout, cancellation에서도 finally가 실행되는지 같이 확인할 수 있습니다.

### 6) 코드 리뷰 질문을 표준화한다

ThreadLocal 문제는 장애가 터진 뒤에 찾으면 늦습니다. 코드 리뷰에서 새 executor, 새 listener, 새 holder, 새 logging field가 보일 때마다 같은 질문을 반복해야 합니다. 질문이 표준화되어 있으면 리뷰어의 경험에 덜 의존하고, 팀이 "이 정도는 괜찮겠지"라고 넘어가는 지점을 줄일 수 있습니다.

| 변경 유형 | 리뷰 질문 | 통과 기준 |
| --- | --- | --- |
| 새 `ThreadLocal` holder | owner, 허용 값, clear 위치가 있는가 | holder 문서와 테스트가 같이 추가됨 |
| 새 `@Async` 메서드 | 어떤 executor를 쓰고 어떤 context를 전파하는가 | default executor 의존 없음 |
| 새 scheduler | user context를 만들지 않는가 | `actor=system`, `jobId`, `runId`가 로그에 남음 |
| 새 message listener | header에서 context를 새로 만들고 finally에서 지우는가 | 성공/실패/재시도 경로 모두 clear |
| 새 MDC field | 개인정보, token, 원문 payload, 고카디널리티 값이 아닌가 | 필드 목록과 cardinality 기준 갱신 |
| 새 virtual thread 적용 | ThreadLocal payload가 작은가 | key 수와 값 크기 점검 결과 기록 |

리뷰에서 가장 강하게 막아야 할 냄새는 "나중에 지우면 된다"입니다. ThreadLocal은 나중에 지우는 도구가 아니라 시작과 종료가 한 계약으로 묶여야 하는 도구입니다. `set()`이 보이면 같은 변경 안에서 `remove()` 또는 `clear()`가 어디서 보장되는지 확인해야 합니다.

다음 질문도 효과적입니다.

- 이 값은 로그 식별자인가, 비즈니스 판단 값인가?
- 이 값이 다음 사용자 요청에 남으면 보안 사고인가 단순 노이즈인가?
- 예외, timeout, cancellation, retry에서도 clear가 실행되는가?
- 같은 executor가 사용자 요청과 시스템 작업을 함께 처리하는가?
- 테스트가 단일 실행만 보나, 같은 worker thread의 연속 실행을 보나?
- MDC에 넣은 값이 로그 비용과 검색 cardinality를 폭발시키지 않는가?

답이 애매하면 ThreadLocal보다 명시적 `RequestContext` 인자가 낫습니다. 특히 결제, 권한, 테넌트 라우팅처럼 업무 결과를 바꾸는 값은 숨겨진 ThreadLocal에 의존할수록 테스트가 약해집니다.

## 트레이드오프/주의점

첫째, ThreadLocal을 모두 없애는 것은 현실적이지 않습니다. Spring Security, 트랜잭션, MDC처럼 프레임워크가 이미 쓰는 영역이 있습니다. 목표는 제거가 아니라 **사용 범위와 생명주기 통제**입니다.

둘째, 컨텍스트를 많이 전파할수록 디버깅은 편해지지만 보안과 비용이 커집니다. user email, IP, user agent, full URL query를 모두 MDC에 넣으면 로그 검색은 쉬워 보여도 개인정보와 cardinality 문제가 생깁니다. 필드는 적을수록 좋고, 필요한 값만 안정적으로 남겨야 합니다.

셋째, SecurityContext 전파는 권한 결정입니다. 요청을 시작한 사용자의 권한으로 비동기 작업을 계속할지, 시스템 계정으로 전환할지 명확히 해야 합니다. 결제 승인, 개인정보 조회, 관리자 작업은 특히 감사 로그 기준을 먼저 정해야 합니다.

넷째, Reactor/WebFlux는 ThreadLocal보다 Reactor Context를 기준으로 봐야 합니다. MVC와 WebFlux가 섞인 서비스에서는 "어디까지 ThreadLocal이고 어디부터 Reactor Context인가"를 문서화하지 않으면 traceId 유실이 반복됩니다.

다섯째, virtual thread 도입이 clear 책임을 없애지는 않습니다. 오히려 request당 ThreadLocal 사용량이 늘면 메모리와 진단 비용이 커질 수 있습니다. virtual thread 전환 전에는 ThreadLocal key 수와 payload 크기를 먼저 줄이는 편이 안전합니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] 팀에서 사용하는 ThreadLocal holder 목록과 owner가 문서화되어 있다.
- [ ] HTTP filter, async decorator, message listener, scheduler에서 clear 위치가 명확하다.
- [ ] `@Async`와 custom executor에 MDC/SecurityContext 전파 여부가 명시되어 있다.
- [ ] 요청 컨텍스트에 token, Entity, DTO, 원문 payload를 넣지 않는 규칙이 있다.
- [ ] traceId 누락률, context leakage 의심, MDC cardinality를 운영 지표로 본다.
- [ ] fixed thread pool size 1 기반의 연속 실행 회귀 테스트가 있다.
- [ ] 새 executor, listener, scheduler 추가 시 context 전파/정리 리뷰 질문을 통과한다.
- [ ] SecurityContext를 전파하는 비동기 작업은 사용자 권한 작업인지 시스템 권한 작업인지 감사 기준이 있다.

### 연습

1. 현재 서비스의 MDC 필드를 모두 뽑아 "필수, 선택, 금지"로 나눠 보세요. 금지 후보에는 email 원문, token, query string, request body가 들어가는지 확인합니다.
2. `@Async` executor 1개를 골라 TaskDecorator가 있는지 확인하고, 예외가 발생해도 MDC와 SecurityContext가 정리되는 테스트를 작성해 보세요.
3. Kafka consumer나 scheduler 중 하나를 골라 `runId`, `topic/partition/offset`, `tenantId`, `traceId`가 로그에 남는지 확인하고 누락률 기준을 정해 보세요.
4. 최근 PR 3개에서 새 로그 필드나 executor 변경을 찾아 위 리뷰 질문표로 다시 점검해 보세요.

## 관련 글

- [구조화 로깅: 검색 가능한 로그 설계](/learning/deep-dive/deep-dive-structured-logging/)
- [Spring 비동기 프로그래밍: @Async와 CompletableFuture](/learning/deep-dive/deep-dive-spring-async/)
- [Thread Pool 튜닝: 적정 스레드 수 찾기](/learning/deep-dive/deep-dive-thread-pool/)
- [Java Virtual Threads, Spring MVC와 WebFlux 전환 기준](/learning/deep-dive/deep-dive-java-virtual-threads-spring-mvc-webflux-playbook/)
- [OpenTelemetry 실무 가이드](/learning/deep-dive/deep-dive-opentelemetry/)
