---
title: "백엔드 커리큘럼 심화: PATCH API를 Merge Patch·JSON Patch·Field Mask와 동시성 계약으로 설계하는 법"
date: 2026-09-13T10:06:00+09:00
lastmod: 2026-09-13T10:06:00+09:00
draft: false
topic: "API Design"
tags: ["PATCH", "JSON Merge Patch", "JSON Patch", "Field Mask", "ETag", "Optimistic Concurrency", "API Contract"]
categories: ["Backend Deep Dive"]
description: "PATCH를 단순히 '일부 필드 수정'으로 두지 않고, 표현식 선택·도메인 검증·If-Match·오류 의미·감사 로그를 하나의 변경 계약으로 설계하는 실무 플레이북입니다."
module: "architecture-mastery"
study_order: 1519
summary: "PATCH의 위험은 HTTP 메서드 이름이 아니라 클라이언트가 무엇을 바꾸려 했는지 서버가 잃어버리는 데 있다. Merge Patch, JSON Patch, field mask는 서로 다른 의도를 표현하며, 동시성 조건·불변식·오류 코드·감사 증거까지 함께 정해야 안전한 부분 수정 API가 된다."
keywords: ["PATCH API design", "JSON Merge Patch", "JSON Patch RFC 6902", "field mask API", "If-Match optimistic concurrency", "partial update contract"]
key_takeaways:
  - "JSON Merge Patch는 객체 필드의 단순한 추가·교체·삭제에는 읽기 쉽지만, null이 값인지 삭제인지 구분해야 하거나 배열 일부를 바꿀 때는 표현력이 부족하다."
  - "JSON Patch는 경로별 add/remove/replace/test를 감사하기 좋지만, 배열 인덱스와 operation 순서가 API 계약이 되므로 외부 공개 API에는 허용 경로와 op 수를 강하게 제한해야 한다."
  - "변경의 정확성은 PATCH 본문만으로 보장되지 않는다. version 또는 강한 ETag를 If-Match로 요구하고, 412·422·409·428을 서로 다른 복구 행동으로 정의해야 lost update를 막을 수 있다."
  - "금액, 상태 전이, 권한처럼 도메인 동작 자체가 중요한 경우에는 범용 PATCH보다 명시적 command endpoint가 검증·감사·권한 모델에 더 잘 맞는다."
operator_checklist:
  - "리소스·필드별로 immutable, server-managed, patchable, command-only 분류표를 만들고 allowlist를 코드와 API 문서에서 같은 source of truth로 관리한다."
  - "PATCH마다 If-Match 또는 동등한 version precondition을 요구하고, 경쟁 갱신률·412 비율·재시도 성공률을 endpoint별로 관측한다."
  - "본문 크기, 최대 path 깊이, JSON Patch operation 수, 배열 수정 정책을 request boundary에서 제한한다."
  - "변경 전·후 version, actor, request ID, 허용된 field path, 결과 상태를 감사 이벤트로 남기되 민감한 원문 값은 마스킹한다."
learning_refs:
  - title: "HTTP 캐싱·ETag·재검증 운영"
    href: "/learning/deep-dive/deep-dive-http-caching-etag-revalidation-playbook/"
    description: "ETag를 304 최적화뿐 아니라 If-Match 기반 낙관적 동시성 조건으로 쓰는 기준입니다."
  - title: "API Error Semantics와 Retryability 계약"
    href: "/learning/deep-dive/deep-dive-api-error-semantics-retryability-contract/"
    description: "412, 422, 409처럼 호출자가 다르게 복구해야 하는 오류를 설계합니다."
  - title: "Idempotency 설계"
    href: "/learning/deep-dive/deep-dive-idempotency/"
    description: "부분 수정 요청의 네트워크 재전송과 업무 중복을 별개로 다루는 방법입니다."
  - title: "도메인 불변식 Registry와 데이터 품질"
    href: "/learning/deep-dive/deep-dive-domain-invariant-registry-data-quality-playbook/"
    description: "필드 유효성 검사를 넘어 상태·금액·권한의 업무 불변식을 고정합니다."
decision_guide:
  title: "어떤 부분 수정 표현식을 선택할까"
  intro: "선택 기준은 payload가 짧은가가 아니라, 변경 의도·삭제 의미·동시성·감사 대상을 손실 없이 표현할 수 있는가다."
  cases:
    - badge: "Merge Patch 적합"
      title: "객체의 선택 필드를 독립적으로 바꾸며 null의 의미가 명확한 설정 리소스"
      fit: "예: 알림 설정, 프로필의 선택 항목처럼 배열 조작과 복잡한 상태 전이가 없는 경우입니다."
      watchouts: "null을 삭제로 쓸지 값으로 허용할지를 field별 schema에 명시하지 않으면 의도가 사라집니다."
      next_step: "patchable field allowlist와 nullable/clearable 표를 만든 뒤 5% traffic canary로 시작합니다."
    - badge: "JSON Patch 적합"
      title: "문서의 경로별 변경 기록과 test 조건이 필요한 내부 관리 도구"
      fit: "변경 path와 operation 자체가 감사 단위이고, client와 server가 같은 document shape를 엄격히 관리할 수 있습니다."
      watchouts: "배열 인덱스와 operation 순서가 API 표면이 되므로 무제한 path·op를 외부에 열면 안 됩니다."
      next_step: "허용 op·경로·최대 20 operations·최대 path 깊이 6을 validator에서 강제합니다."
    - badge: "명시적 command 우선"
      title: "결제 승인, 주문 취소, 역할 변경처럼 전이와 권한이 중요한 업무 동작"
      fit: "'상태를 paid로 바꾼다'보다 '승인한다'가 업무 의도와 감사 기록을 더 정확하게 표현합니다."
      watchouts: "범용 PATCH로 우회하면 전이 규칙과 actor 검증이 field validation 뒤로 숨습니다."
      next_step: "POST /payments/{id}:capture처럼 command와 precondition·승인 근거를 분리합니다."
---

`PATCH /users/42`가 있다고 해서 부분 수정 API가 설계된 것은 아니다. `{"role":"admin"}`처럼 짧은 본문 하나에는 적어도 네 가지 질문이 들어 있다. 이 값은 기존 값을 **교체**하는가, `null`은 **삭제**인가 값인가, 다른 사용자가 방금 바꾼 필드를 덮어써도 되는가, 그리고 이 변경이 실제로는 권한 승격이라는 **업무 동작**인가다. 이 질문에 답하지 않으면 PATCH는 편리한 endpoint가 아니라 lost update와 권한 우회의 통로가 된다.

이 글은 [HTTP 캐싱·ETag·재검증 운영](/learning/deep-dive/deep-dive-http-caching-etag-revalidation-playbook/), [API Error Semantics와 Retryability 계약](/learning/deep-dive/deep-dive-api-error-semantics-retryability-contract/), [Idempotency 설계](/learning/deep-dive/deep-dive-idempotency/), [도메인 불변식 Registry와 데이터 품질](/learning/deep-dive/deep-dive-domain-invariant-registry-data-quality-playbook/)의 원칙을 부분 수정에 적용한다. 표현식 하나를 고르는 일보다 **의도, 조건, 검증, 결과**를 같은 API 계약으로 묶는 일이 핵심이다.

표준의 최소 사실도 구분해 두자. [RFC 7396](https://www.rfc-editor.org/info/rfc7396/)의 JSON Merge Patch는 대상 JSON 문서에 객체 형태의 변경을 합치는 형식이고, [RFC 6902](https://www.rfc-editor.org/info/rfc6902/)의 JSON Patch는 `add`, `remove`, `replace`, `move`, `copy`, `test` operation 배열을 정의한다. 표준이 도메인 권한이나 database transaction을 대신 정해 주지는 않는다. 서버가 어떤 path를 받고, 실패한 요청을 어떻게 원자적으로 처리하며, 누가 무엇을 수정할 수 있는지는 서비스의 책임이다.

## 이 글에서 얻는 것

- Merge Patch, JSON Patch, field mask, 명시적 command가 각각 어떤 변경 의도를 보존하는지 판단합니다.
- `If-Match`·version·불변식 검증을 이용해 부분 수정의 lost update를 막는 흐름을 설계합니다.
- 400, 409, 412, 422, 428을 호출자의 재조회·수정·재시도 행동에 맞춰 분리합니다.
- path allowlist, request budget, 감사 이벤트, canary 지표를 숫자로 고정해 PATCH를 운영 가능한 계약으로 만듭니다.

## 핵심 개념/이슈

### 1) PATCH는 '필드 목록'이 아니라 변경 의도를 전송하는 형식이다

가장 읽기 쉬운 형태는 Merge Patch다. 예를 들어 사용자가 알림 설정의 일부만 바꾸는 요청은 다음처럼 보일 수 있다.

```http
PATCH /notification-preferences/42
Content-Type: application/merge-patch+json
If-Match: "v17"

{"email": false, "digestHour": 9}
```

객체 필드가 독립적이고 `null`의 의미가 "이 값을 지운다"로 고정돼 있다면 이 형식은 좋다. 하지만 RFC 7386에서 `null`은 대상 필드 제거를 뜻한다. 업무상 `null`이라는 값 자체가 필요하거나 `nickname`을 비울 수 있는 경우에는 `null` 하나로 삭제와 값 설정을 구분할 수 없다. 또한 배열은 원소 단위 병합이 아니라 통째로 교체된다. `channels: ["email", "push"]`에서 push만 제거하려고 `{"channels":["email"]}`를 보내면, 동시 변경된 새 채널까지 사라질 수 있다.

JSON Patch는 변경 대상과 동작을 분명히 한다.

```json
[
  {"op": "test", "path": "/version", "value": 17},
  {"op": "replace", "path": "/displayName", "value": "Min"},
  {"op": "remove", "path": "/phoneNumber"}
]
```

여기서 `test`는 document 안의 조건을 명시하고 `remove`는 삭제 의도를 전달한다. 하지만 `/members/2` 같은 배열 path는 목록 정렬·삽입에 따라 다른 대상을 가리킬 수 있다. operation A가 document shape를 바꾸면 operation B의 path 해석도 달라진다. 그러므로 JSON Patch는 변경 path를 그대로 감사하기 좋은 반면, 공개 API에서 임의 경로와 임의 op를 받는 일반 편집기가 되어서는 안 된다.

세 번째 선택지는 field mask 또는 명시적 update field다.

```json
{
  "profile": {"displayName": "Min", "locale": "ko-KR"},
  "updateMask": ["profile.displayName", "profile.locale"]
}
```

field mask는 값과 '바꾸려는 field'를 분리한다. nullable value도 표현하기 쉽고 generated client와 schema를 관리하는 조직에 맞는다. 반대로 마스크와 payload가 어긋났을 때 어느 쪽을 신뢰할지, nested field를 마스크할 수 있는지, 빈 mask가 no-op인지 오류인지를 문서화해야 한다.

### 2) PATCHable field와 업무 command를 먼저 분리한다

API 모델에 있는 모든 필드가 수정 가능한 것은 아니다. `createdAt`, `ownerId`, `balance`, `status`, `role`을 JSON path로 노출하면 시스템은 값 검증만 하다가 중요한 업무 전이를 잃는다. 이 글에서 권하는 초기 분류는 네 가지다.

| 분류 | 예시 | API 정책 |
| --- | --- | --- |
| immutable | `id`, 생성 시각, 원본 주문 금액 | PATCH 거부 |
| server-managed | version, 감사 actor, 계산된 잔액 | 입력 무시가 아니라 400/422로 거부 |
| patchable | 표시명, 알림 설정, 설명 | allowlist와 형식·권한 검증 뒤 허용 |
| command-only | 결제 승인, 주문 취소, 역할 부여 | 별도 command endpoint와 전이 규칙 사용 |

예를 들어 `PATCH /orders/81 {"status":"cancelled"}`는 상태 값 하나를 바꾸는 듯하지만, 취소 가능 기간, 이미 출고됐는지, 재고 복원, 환불, actor 권한, 감사 사유를 모두 요구한다. `POST /orders/81:cancel`에 `reason`과 `If-Match`를 요구하면 도메인 의도와 감사 대상을 드러낼 수 있다. PATCH를 쓰지 않는 것이 덜 RESTful해서가 아니라, 더 정확한 계약이기 때문이다.

### 3) 부분 수정의 동시성 제어는 선택 사항이 아니다

두 클라이언트가 version 17의 프로필을 읽었다고 하자. A는 표시명을, B는 locale을 고친다. 서버가 현재 version과 무관하게 Merge Patch를 적용하면 운 좋게 둘 다 남을 수 있다. 그러나 둘 다 `channels` 배열 전체를 보냈거나, A가 B가 바꾼 필드를 오래된 값으로 함께 전송했다면 B의 변경은 조용히 사라진다. 부분 수정이 전체 교체보다 안전하다는 보장은 없다.

기본 흐름은 다음처럼 고정한다.

1. GET 응답에 강한 ETag 또는 monotonic `version`을 보낸다.
2. 상태를 실제로 바꾸는 PATCH/command에는 `If-Match`를 요구한다.
3. 현재 ETag와 다르면 저장 전에 멈추고 `412 Precondition Failed`를 돌려준다.
4. 클라이언트는 최신 표현을 재조회하고, 사용자 입력과 diff를 다시 보여 준 뒤 새 조건으로 재시도한다.

`If-Match`가 없으면 `428 Precondition Required`가 더 낫다. 조건 없이 저장해 주고 "마지막 저장이 이긴다"고 암묵적으로 정하면 충돌률을 측정할 수도 없다. 다만 version 충돌이 아니어도 저장이 실패할 수 있다. 할인율 범위·상태 전이·다른 리소스의 예약 수량처럼 최신 버전에서도 성립하지 않는 업무 규칙은 `422 Unprocessable Content` 또는 도메인에 맞는 `409 Conflict`로 분리한다.

| 응답 | 뜻 | 호출자 다음 행동 |
| --- | --- | --- |
| 400 | JSON, content type, path 문법이 잘못됨 | 요청 생성 버그 수정; 자동 재시도 금지 |
| 412 | ETag/version이 오래됨 | 최신 상태 재조회 후 사용자 의도 재적용 |
| 422 | 형식은 맞지만 field 값·조합이 불가능 | 입력 수정; 어떤 field가 실패했는지 표시 |
| 409 | 다른 업무 상태·중복 전이와 충돌 | 현재 상태와 가능한 action 재조회 |
| 428 | precondition 누락 | ETag를 얻어 조건을 붙여 다시 요청 |

### 4) 재전송 안전성과 동시성 안전성은 다르다

네트워크 timeout 뒤에 클라이언트가 같은 PATCH를 보낼 수 있다. `replace /displayName`은 결과만 보면 반복해도 같아 보이지만, 감사 이벤트가 두 번 생기거나 수정 시각이 두 번 달라질 수 있다. `add /tags/-`나 "포인트 10 차감" 같은 동작은 반복 자체가 결과를 바꾼다. 이는 [Idempotency 설계](/learning/deep-dive/deep-dive-idempotency/)의 request identity 문제이고, `If-Match`가 해결하는 오래된 read의 문제와 다르다.

외부 모바일·결제 경로처럼 재전송이 흔한 write에는 idempotency key와 결과 ledger를 추가한다. 반면 같은 사용자가 새 입력으로 다시 저장하는 editor에는 이전 key를 재사용하지 않게 해야 한다. 권장 우선순위는 **도메인 불변식 → version precondition → idempotency 처리 → 편의성**이다. 앞의 셋 없이 재시도 버튼만 만들면 장애 때 중복 수정이 늘어난다.

## 실무 적용

### 1) 입력 경계에서 표현식별 budget을 강제한다

먼저 endpoint별 허용 콘텐츠 타입을 하나 또는 둘로 좁힌다. `application/json` 하나에 Merge Patch, JSON Patch, command body를 모두 추측하게 만들면 client와 gateway의 검증 규칙이 갈라진다. Merge Patch라면 patchable object key의 allowlist, 최대 본문 32KiB, 최대 nested depth 6, unknown key 거부를 시작점으로 둔다. JSON Patch라면 더 보수적으로 최대 20 operations, path 길이 256 bytes, path depth 6, `move`·`copy` 기본 금지를 둔다.

특히 배열은 팀 단위로 하나를 고른다. 순서가 의미 없는 tag 집합이면 `addTag`, `removeTag` command 또는 key 기반 path만 허용한다. 순서가 중요한 playlist라면 원소 ID와 목표 위치를 받는 command가 배열 index patch보다 안전하다. 한 요청이 20개가 넘는 field를 꾸준히 바꾼다면 PATCH 최적화가 아니라 화면·aggregate·batch API 경계가 잘못된 신호일 수 있다.

### 2) 저장 직전의 검증 순서를 고정한다

안전한 서버 handler는 patch를 DB entity에 바로 덮어쓰지 않는다. 다음 순서가 재현과 관측에 유리하다.

1. content type, 본문 크기, op/path allowlist를 검증한다.
2. `If-Match` 또는 version precondition을 읽고 현재 version과 비교한다.
3. 허용된 patch를 별도 candidate representation에 적용한다. JSON Patch의 어느 op가 실패해도 부분 저장하지 않는다.
4. schema validation과 cross-field·상태 전이·권한 불변식을 검사한다.
5. 한 transaction에서 변경, version 증가, 감사 이벤트/outbox 기록을 함께 commit한다.
6. 새 ETag와 최소 표현 또는 operation receipt를 응답한다.

이 순서에서 2와 5 사이에 동시 writer가 끼어들지 않도록 DB의 optimistic locking 또는 조건부 update를 사용한다. ORM entity의 version field를 늘리는 것만으로 충분한지는 bulk update와 cache 경로까지 확인해야 한다. 수정 성공 후 메시지를 보내는 흐름이 있다면 [Transactional Outbox + CDC](/learning/deep-dive/deep-dive-transactional-outbox-cdc/)처럼 상태와 이벤트를 같은 commit 경계에 기록한다.

### 3) 2주 canary에는 성공률뿐 아니라 '의도 보존'을 측정한다

새 PATCH endpoint를 5% traffic에서 2주 관찰할 때, 2xx 비율만 높으면 안 된다. 최소 기준은 `412` 비율 2% 이하, validation `422` 비율 3% 이하, unknown path 거부 0.5% 이하, idempotency replay가 아닌 중복 감사 이벤트 0건으로 시작할 수 있다. 기준은 제품별로 다르지만 숫자와 기간을 먼저 적어야 "문제가 없었다"가 재현 가능한 결론이 된다.

또한 endpoint·클라이언트 version별로 patch op 수, 대상 field path, request size p95, ETag mismatch, 저장 transaction p95를 나눠 본다. `412`가 급증하면 서버를 느슨하게 만들기 전에 editor가 stale state를 오래 들고 있는지, GET 응답이 cache돼 있는지, 자동 재시도가 사용자 선택을 덮는지부터 확인한다. `422`가 늘면 validation 문구보다 generated client schema와 UI 제약이 server schema와 갈라졌는지 확인한다.

## 트레이드오프/주의점

1. **Merge Patch의 단순함에는 삭제·배열의 대가가 있다.** null과 배열 교체가 제품 의미에 맞지 않으면 억지로 쓰지 않는다.
2. **JSON Patch의 정밀함에는 공개 API 표면 확대의 대가가 있다.** path는 내부 모델을 드러내고, 배열 index와 operation 순서는 client 의존성을 만든다.
3. **ETag는 권한 검증을 대신하지 않는다.** 최신 version을 가진 사용자가 모든 field를 수정할 수 있는 것은 아니다. actor·tenant·object-level authorization은 patch 적용 전 별도로 확인한다.
4. **'부분 저장 후 오류'는 가장 위험하다.** op 하나가 실패했을 때 이전 op가 commit되지 않게 candidate 적용과 transaction 경계를 분리한다.
5. **무조건 PATCH가 더 효율적인 것은 아니다.** 작은 resource의 전체 PUT이 더 이해하기 쉽고, 상태 전이는 command가 더 안전하다.

## 체크리스트 또는 연습

### 배포 체크리스트

- [ ] 리소스 field를 immutable, server-managed, patchable, command-only로 분류했다.
- [ ] 콘텐츠 타입별 path/op allowlist, 최대 32KiB 본문, 최대 깊이 6, JSON Patch 최대 20 operations를 정했다.
- [ ] write 요청에 강한 ETag 또는 version precondition을 요구하고 412·428의 client 행동을 문서화했다.
- [ ] patch candidate 검증, 업무 불변식, 저장, version 증가, 감사/outbox 기록이 하나의 transaction 흐름으로 연결된다.
- [ ] 400·409·412·422·428의 error code와 안전한 재시도 여부를 SDK/UI에서 구분한다.
- [ ] 5% canary에서 충돌률, validation 실패, request size, 중복 감사 이벤트를 2주 비교한다.

### 연습: 알림 설정 API의 계약 고르기

`emailEnabled`, `digestHour`, `channels`, `timezone`, `updatedAt`을 가진 알림 설정을 설계해 보자. `channels`에 push 하나를 추가하고, `digestHour`를 비우며, 다른 탭이 동시에 timezone을 바꾸는 세 동작을 각각 적는다. 어떤 것은 Merge Patch로, 어떤 것은 command 또는 field mask로 표현할지 정하고 `If-Match`가 오래됐을 때 UI가 무엇을 보여 줄지 써 보자. 마지막으로 `updatedAt`을 patchable 목록에 넣었을 때 생기는 문제를 actor·감사·시간 신뢰성 관점에서 설명해 보자.

## 마무리

좋은 PATCH API는 짧은 payload를 자랑하지 않는다. 클라이언트가 바꾸려는 대상과 서버가 허용한 업무 변화가 같고, 경쟁 수정과 재전송을 분리하며, 실패 뒤 다음 행동까지 예측 가능하게 만든다. 먼저 field 분류와 precondition을 고정한 뒤 표현식을 선택하자. 그 순서가 Merge Patch의 편의성과 JSON Patch의 정밀함을 모두 안전하게 쓰는 출발점이다.
