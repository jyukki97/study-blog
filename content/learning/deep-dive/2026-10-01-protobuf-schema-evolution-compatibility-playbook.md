---
title: "백엔드 커리큘럼 심화: Protobuf 스키마 진화, 필드 번호와 의미를 함께 지키는 호환성 플레이북"
date: 2026-10-01T10:06:00+09:00
lastmod: 2026-10-01T10:06:00+09:00
draft: false
topic: "Backend API Contract"
tags: ["Protobuf", "gRPC", "Schema Evolution", "Backward Compatibility", "API Contract"]
categories: ["Backend Deep Dive"]
description: "Protobuf·gRPC 계약을 바꿀 때 필드 번호, presence, enum, JSON 변환, producer·consumer 배포 순서를 함께 관리해 조용한 데이터 손실과 롤백 불능 배포를 막는 방법을 정리합니다."
summary: "Protobuf는 컴파일러가 타입 오류를 많이 잡아 주지만, 배포된 여러 버전의 producer와 consumer 사이의 의미까지 보장하지는 않는다. schema diff, reserved tag, additive rollout, 호환성 테스트, 관측 기준을 하나의 변경 절차로 묶어야 안전하게 진화한다."
module: "distributed-systems"
study_order: 367
keywords: ["protobuf schema evolution", "protobuf backward compatibility", "grpc api versioning", "protobuf reserved field numbers"]
key_takeaways:
  - "필드 이름보다 wire tag 번호와 wire type이 호환성의 핵심이며, 삭제한 번호는 반드시 reserved로 남긴다."
  - "새 필드 추가는 대체로 안전하지만, 새 enum 값·presence·기본값·JSON gateway를 포함하면 의미 호환성은 별도로 검증해야 한다."
  - "생산자·소비자의 배포 순서는 read old/write old에서 read new/write new으로 한 단계씩 이동해야 rollback 여지를 남긴다."
  - "schema lint만 통과시키지 말고 이전 descriptor와의 breaking diff, 구·신 바이너리 상호운용성, 핵심 RPC의 실제 payload를 함께 확인한다."
operator_checklist:
  - "삭제한 field number와 field name을 reserved로 선언한다."
  - "변경마다 old writer/new reader와 new writer/old reader 조합을 테스트한다."
  - "새 enum 값과 unknown field가 중간 서비스에서 보존되는지 확인한다."
  - "JSON/HTTP gateway가 있으면 JSON field name, null·zero·omitted 의미를 따로 검증한다."
  - "호환성 위반, unknown enum, decode 실패, version skew 비율을 배포 지표로 남긴다."
---

gRPC를 도입하면 API 계약이 `.proto` 파일로 모이고, 생성된 코드가 많은 실수를 막아 줍니다. 그러나 실제 서비스에는 오늘 배포한 서버, 어제 배포한 worker, 몇 주 뒤 업데이트될 모바일 앱, 그리고 JSON gateway를 사용하는 외부 고객이 함께 존재합니다. 이 환경에서 "컴파일된다"는 사실은 같은 저장소의 최신 코드가 맞는다는 뜻일 뿐, 이미 배포된 상대와 같은 의미로 통신한다는 보장은 아닙니다.

특히 Protobuf는 필드 이름이 아니라 field number와 wire type으로 데이터를 읽습니다. 삭제한 `customer_id = 7`을 나중에 전혀 다른 의미의 `discount_code = 7`로 재사용하면, 오래된 메시지는 오류 없이 새 의미로 해석될 수 있습니다. 오류가 명확히 터지는 변경보다 더 위험합니다. 이 글은 [gRPC 서비스 설계](/learning/deep-dive/deep-dive-grpc-service-design/), [gRPC 스트리밍 흐름 제어](/learning/deep-dive/2026-09-29-grpc-streaming-flow-control-backpressure-playbook/), [이벤트 스키마 레지스트리 호환성](/learning/deep-dive/deep-dive-event-schema-registry-compatibility-playbook/), [Consumer-Driven Contract Testing](/learning/deep-dive/deep-dive-consumer-driven-contract-testing/)의 원칙을 RPC schema 변경에 적용합니다.

## 이 글에서 얻는 것

- Protobuf의 wire 호환성과 애플리케이션 의미 호환성이 왜 다른지 설명할 수 있습니다.
- field number, enum, `oneof`, presence, JSON 변환에서 어떤 변경을 차단해야 하는지 판단할 수 있습니다.
- 구·신 producer와 consumer이 섞인 상태에서 안전한 배포 순서를 설계할 수 있습니다.
- descriptor diff, 상호운용성 테스트, canary 지표를 이용해 schema 변경을 운영할 수 있습니다.

## 핵심 개념/이슈

### 1) 호환성의 기본 단위는 이름이 아니라 tag와 wire type이다

아래처럼 새 필드를 추가하는 일은 대부분 wire 수준에서 안전합니다. 이전 consumer는 모르는 field `3`을 건너뛰고, 새 consumer는 이전 payload에 `note`가 없으면 기본 상태로 읽습니다.

```proto
message CreateOrderRequest {
  string order_id = 1;
  int64 amount = 2;
  optional string note = 3;
}
```

반대로 field `2`의 `int64`를 `string`으로 바꾸거나, 지운 `4`번을 다른 의미로 재사용하거나, 기존 field를 `oneof`로 옮기는 변경은 안전하다고 가정하면 안 됩니다. wire type이 달라지면 decode 실패 또는 unknown field 처리가 일어나고, 우연히 같은 type이면 더 나쁜 의미 오해가 남을 수 있습니다. 삭제는 아래처럼 명시합니다.

```proto
message CreateOrderRequest {
  reserved 4, 9 to 11;
  reserved "legacy_coupon";
  string order_id = 1;
  int64 amount = 2;
}
```

`reserved`는 장식이 아니라 미래의 실수를 컴파일 단계에서 막는 안전장치입니다. 서비스가 장기 운영될수록 과거의 field number를 기억하는 사람이 사라지므로, 삭제 사유와 대체 field도 changelog에 남겨야 합니다. field 번호를 촘촘히 맞추는 것보다 한 번 사용한 번호의 수명을 추적하는 일이 우선입니다.

### 2) presence와 enum은 "값이 없다"의 의미를 바꾼다

proto3 scalar는 값이 없을 때 `0`, `false`, 빈 문자열처럼 보일 수 있습니다. 그래서 `0`이 실제 금액인지, 클라이언트가 값을 보내지 않았다는 뜻인지 구분해야 하는 API에는 `optional`, wrapper, 또는 명시적인 상태 field가 필요합니다. `discount_percent = 0`이 "할인 없음"과 "아직 계산하지 않음"을 동시에 뜻하면 새 consumer는 잘못된 결정을 내릴 수 있습니다.

enum도 주의 대상입니다. 새 enum 값을 추가하는 것은 숫자 표현만 보면 확장적이지만, 오래된 consumer가 그 값을 `UNSPECIFIED`로 바꾸거나 switch default에서 조용히 무시하면 업무 의미가 사라집니다. 결제 상태처럼 미지원 값이 위험한 도메인에서는 unknown enum을 허용 상태로 내려보내지 말고 `unsupported_state` 오류·보류 큐·알람 중 하나로 보이게 해야 합니다. JSON gateway가 있다면 snake_case field와 camelCase JSON name, `null`, 빈 문자열, 누락 field가 어떻게 바뀌는지도 별도 계약입니다. gRPC binary 테스트만 통과했다고 REST 고객까지 안전한 것은 아닙니다.

### 3) source·wire·semantic 호환성을 따로 판정한다

변경 리뷰에서 다음 세 질문을 한 줄씩 답하면 과신을 크게 줄일 수 있습니다.

| 층 | 확인 질문 | 대표 실패 |
| --- | --- | --- |
| source | 생성 코드를 다시 컴파일하는 저장소가 빌드되는가 | field rename으로 client accessor가 사라짐 |
| wire | 구·신 바이너리가 payload를 잃지 않고 읽는가 | tag 재사용, type 변경, `oneof` 전환 |
| semantic | 같은 업무 입력에서 같은 의사결정을 하는가 | 새 enum을 구 버전이 승인으로 오해 |

새 field를 추가해도 server가 그 field를 필수 업무 조건으로 즉시 사용하면 오래된 client가 영원히 그 값을 보내지 않아 장애가 납니다. 반대로 서버가 새 field를 먼저 읽을 수 있게 배포하고, 충분한 client 비율이 올라온 뒤에만 새 의미를 강제해야 합니다. 이 판단은 [API 응답 호환성 계약](/learning/deep-dive/deep-dive-api-response-compatibility-contract-playbook/) 및 [외부 API schema drift 방어](/learning/deep-dive/deep-dive-third-party-api-schema-drift-guard-playbook/)와 같은 원리입니다.

## 실무 적용

### 1) 변경을 read → write → enforce 세 단계로 분리한다

가장 보수적인 rollout은 새 데이터를 읽을 수 있는 쪽을 먼저 배포하는 것입니다. `shipping_method_v2`를 추가한다고 가정하면 순서는 다음처럼 고정합니다.

1. **Read new**: 서버·worker가 새 field 또는 새 enum을 받아도 오류 없이 보존·관측하도록 배포한다. 아직 새 값은 쓰지 않는다.
2. **Write new**: producer를 5% canary로 열어 새 값을 쓴다. 구 consumer가 unknown field를 버리는지, gateway가 변환하는지 확인한다.
3. **Prefer new**: 24~72시간의 정상 traffic과 batch window를 포함해 새 값을 우선 사용한다. 구 field는 fallback으로만 둔다.
4. **Enforce and retire**: 구 client 비율, fallback 사용률, replay 보존 기간이 모두 기준 아래일 때만 새 값 누락을 오류로 만든다. 그 뒤 구 field를 deprecated하고 번호는 reserved로 남긴다.

출발 기준은 서비스마다 다르지만, 핵심 결제·권한 RPC라면 `decode_error`와 `unknown_enum`은 0건, fallback 사용률은 0.1% 미만, 구 client의 최대 지원 기간은 명시돼 있어야 강제를 검토할 수 있습니다. 모바일처럼 업데이트가 느린 채널은 server가 수개월 fallback을 유지해야 할 수 있습니다. "신규 앱이 나왔으니 바꿔도 된다"가 아니라 실제 version 분포와 계약 종료일로 판단합니다.

### 2) CI에는 descriptor diff와 상호운용성 매트릭스를 함께 둔다

lint는 format과 naming을 잡지만 이전 release와 비교하지 않으면 tag 재사용을 놓칠 수 있습니다. CI에서 기준 branch 또는 마지막 release descriptor와 현재 descriptor를 비교하고, breaking change는 기본 차단으로 둡니다. 예외가 필요하면 API owner, 영향 consumer, migration 방식, 종료일을 PR에 기록합니다.

자동 테스트는 최소 네 조합을 포함합니다.

| writer | reader | 목적 |
| --- | --- | --- |
| old | old | 기준 payload와 기존 동작 고정 |
| old | new | 새 코드가 과거 메시지를 읽는지 확인 |
| new | old | 구 배포분이 새 메시지에서 무엇을 잃는지 확인 |
| new | new | 새 의미와 validation 검증 |

여기에 JSON transcoding을 쓰는 public endpoint와 주요 async consumer를 한 조합씩 더합니다. fixture는 happy path 하나로 끝내지 말고 누락 optional, enum 신값, deprecated field가 있는 과거 payload, 큰 숫자, 알 수 없는 field를 넣습니다. `buf breaking` 같은 descriptor 검사 도구는 유용하지만 실제 binary와 gateway가 섞인 상호운용성 테스트를 대체하지는 않습니다.

### 3) schema version보다 version skew를 관측한다

모든 message에 version 숫자를 넣는다고 호환성이 생기지는 않습니다. 대신 서버·consumer가 어떤 schema 계열을 실제로 처리하는지 드러나는 지표를 둡니다. 최소 지표는 `protobuf_decode_error_total`, `unknown_enum_total`, `deprecated_field_seen_total`, `fallback_path_total`, client SDK version 분포입니다. 새 field가 내려간 뒤 deprecated field 지표가 줄지 않으면 배포가 아니라 전달 경로 또는 stale worker 문제일 수 있습니다.

배포 직후에는 RPC 성공률만 보지 말고 다음을 봅니다.

- candidate producer 5%에서 old consumer validation error가 baseline보다 **0.05%p** 이상 늘지 않는가
- 새 enum의 unknown 또는 fallback 비율이 **0.1% 미만**으로 48시간 유지되는가
- critical RPC의 p95 latency와 payload size가 baseline 대비 **10% 이내**인가
- dead-letter, retry, compensation 건수가 이전 7일 같은 요일 범위를 벗어나지 않는가

이 수치는 제품 기본값이 아니라 보수적인 출발점입니다. 한 항목이라도 설명되지 않으면 rollout 비율을 늘리지 말고 write new를 끄는 편이 낫습니다. 새 schema를 삭제할 필요는 없지만 새 의미를 강제하는 단계는 멈춰야 합니다.

## 트레이드오프/주의점

1. **Protobuf의 작은 payload는 진화 비용을 없애지 않는다.** JSON보다 형식은 엄격하지만 tag와 enum 숫자가 장기 공개 API가 된다는 책임이 생긴다.
2. **field rename은 wire 수준에서 안전할 수 있어도 source·문서·JSON client에는 breaking change다.** generated accessor, OpenAPI 문서, analytics field를 같이 검색해야 한다.
3. **새 field의 즉시 필수화는 가장 흔한 rollout 실수다.** 먼저 읽고, 다음에 쓰고, 실제 adoption을 본 뒤에만 업무 규칙에 넣는다.
4. **unknown field 보존은 중간 계층마다 다르다.** proxy, mapper, JSON 변환, 오래된 library가 값을 드롭할 수 있으므로 end-to-end fixture로 확인한다.
5. **deprecated를 방치하면 영구 이중 경로가 된다.** fallback에는 owner와 종료일을 붙이고, 제거 후에도 tag는 재사용하지 않는다.

## 체크리스트 또는 연습

### 배포 체크리스트

- [ ] 삭제·rename한 field number와 name을 `reserved`로 남겼다.
- [ ] 현재 descriptor가 마지막 release descriptor와 breaking diff 없이 비교됐다.
- [ ] old/new writer·reader 네 조합과 JSON gateway fixture를 실행했다.
- [ ] 새 enum, optional 누락, deprecated field, unknown field fixture가 있다.
- [ ] write new는 5% canary에서 시작하며 rollback switch가 있다.
- [ ] fallback 경로의 owner·종료일·제거 조건이 문서화됐다.
- [ ] decode error, unknown enum, deprecated field, fallback 비율을 배포 후 확인한다.

### 연습

현재 서비스의 request message 하나를 골라 field별로 `tag`, 업무 의미, nullable/presence, JSON name, producer, consumer, 삭제 가능 여부를 표로 만드세요. 그 뒤 새 enum 값 하나를 추가한다고 가정하고 old writer/new reader와 new writer/old reader에서 어떤 결과가 나와야 안전한지 fixture로 작성합니다. 마지막으로 "이 값을 모든 client에 언제부터 필수로 만들 수 있는가"를 version 분포, fallback 비율, 지원 종료일 세 숫자로 답해 보세요. 답이 없다면 schema가 아니라 배포 계약부터 보강해야 합니다.

## 관련 글

- [gRPC 서비스 설계](/learning/deep-dive/deep-dive-grpc-service-design/)
- [gRPC 스트리밍 흐름 제어와 역압](/learning/deep-dive/2026-09-29-grpc-streaming-flow-control-backpressure-playbook/)
- [이벤트 스키마 레지스트리 호환성 운영](/learning/deep-dive/deep-dive-event-schema-registry-compatibility-playbook/)
- [Consumer-Driven Contract Testing](/learning/deep-dive/deep-dive-consumer-driven-contract-testing/)
- [API 응답 호환성 계약](/learning/deep-dive/deep-dive-api-response-compatibility-contract-playbook/)
