---
title: "백엔드 커리큘럼 심화: HTTP 응답 압축을 CPU·캐시·안전성 계약으로 설계하는 법"
date: 2026-08-29T10:06:00+09:00
lastmod: 2026-08-29T10:06:00+09:00
draft: false
topic: "HTTP"
tags: ["HTTP Compression", "Content-Encoding", "Brotli", "Zstandard", "Caching", "Backend Performance"]
categories: ["Backend Deep Dive"]
description: "gzip·Brotli·Zstandard를 단순한 전송량 절감 옵션으로 보지 않고, CPU 예산·캐시 키·ETag·스트리밍·압축 해제 안전성까지 포함한 HTTP 응답 압축 운영 기준을 정리합니다."
module: "foundation"
study_order: 1502
summary: "응답 압축의 성공 기준은 압축률 하나가 아니다. 대표 경로의 wire bytes 감소, p95 CPU·응답시간, CDN cache hit, 오류·취소율을 같이 보고, 이미 압축된 형식·비공개 응답·스트리밍은 예외 정책으로 명시해야 한다."
key_takeaways:
  - "Accept-Encoding 협상은 서버의 알고리즘 선택만이 아니라 CDN cache key와 Vary, 디버깅 도구 호환성까지 바꾸는 HTTP 계약이다."
  - "작은 JSON을 무조건 압축하면 헤더·CPU 비용이 이득을 지울 수 있다. payload 크기, 요청률, CPU headroom을 함께 기준으로 둬야 한다."
  - "ETag는 표현(representation)에 묶인다. 압축 전 바이트와 압축 후 바이트를 섞어 검증하거나 Vary를 빼면 잘못된 캐시 응답이 생길 수 있다."
  - "응답 압축과 요청 본문 압축 해제는 다른 위험 모델이다. 후자는 압축 해제 크기·비율·시간 제한을 별도 보안 게이트로 다뤄야 한다."
operator_checklist:
  - "대표 응답별 원본/전송 바이트, 압축 CPU 시간, p95/p99 latency, cache hit ratio를 같은 대시보드에서 본다."
  - "text 계열만 allowlist로 압축하고, 이미지·동영상·zip·이미 압축된 protobuf는 기본 제외한다."
  - "CDN 또는 reverse proxy가 Content-Encoding을 협상하면 Vary: Accept-Encoding과 cache-key 정책을 함께 검증한다."
  - "inbound Content-Encoding은 최대 압축 해제 크기와 비율을 검사한 뒤에만 애플리케이션 parser로 넘긴다."
learning_refs:
  - title: "HTTP 캐싱과 ETag 재검증"
    href: "/learning/deep-dive/deep-dive-http-caching-etag-revalidation-playbook/"
    description: "표현별 validator와 CDN 캐시 규칙을 압축 협상과 함께 설계하는 기준입니다."
  - title: "응답 페이로드 예산과 필드 투영"
    href: "/learning/deep-dive/deep-dive-response-payload-budget-field-projection-playbook/"
    description: "압축보다 먼저 보내지 않아도 되는 필드를 줄이는 API 설계 기준을 다룹니다."
  - title: "HTTP 기초 심화"
    href: "/learning/deep-dive/deep-dive-http-essentials/"
    description: "헤더, 표현, content negotiation의 기본 모델을 복습합니다."
  - title: "Request Body Guardrail과 Streaming"
    href: "/learning/deep-dive/deep-dive-request-body-guardrail-streaming-playbook/"
    description: "큰 요청 본문과 스트림을 크기·시간·메모리 예산으로 제한하는 방법입니다."
decision_guide:
  title: "어디에서 어떤 압축 정책을 시작할까"
  intro: "선택 기준은 ‘가장 높은 압축률’이 아니라, 그 응답이 네트워크·CPU·캐시 중 어느 자원을 실제 병목으로 쓰는가입니다."
  cases:
    - badge: "CDN 우선"
      title: "공개 JSON·HTML이 많고 같은 응답이 반복된다"
      fit: "캐시 적중이 높고 원본 서버 CPU를 보호해야 하는 API·문서·웹 페이지에 맞습니다."
      watchouts: "origin과 CDN에서 이중 압축하지 말고, Vary와 ETag 표현을 실제 요청으로 검증해야 합니다."
      next_step: "상위 10개 cacheable route에서 gzip과 Brotli의 전송 바이트·hit ratio를 1주 비교합니다."
    - badge: "애플리케이션 제한 적용"
      title: "개인화 JSON이 많아 CDN hit가 낮다"
      fit: "응답 크기가 충분하고 네트워크 전송이 병목인 사용자별 API에 맞습니다."
      watchouts: "CPU가 포화될 때 압축 작업이 요청 대기열을 키우지 않도록 size threshold와 level을 낮게 시작해야 합니다."
      next_step: "2KB 이상 응답만 low compression level로 canary하고 p95 CPU·latency를 비교합니다."
    - badge: "기본 제외"
      title: "이미 압축된 바이너리·Range 응답·장기 스트림"
      fit: "JPEG, MP4, ZIP, gzip 파일, 대용량 다운로드, SSE처럼 압축 이득보다 복구·지연 위험이 큰 경우입니다."
      watchouts: "압축을 억지로 붙이면 CPU만 쓰고 seek·progress·flush 의미가 무너질 수 있습니다."
      next_step: "Content-Type과 response mode 기반 allowlist를 만들고 제외 이유를 운영 문서에 남깁니다."
---

HTTP 응답 압축은 설정 한 줄로 켤 수 있어서 쉬운 최적화처럼 보입니다. 그러나 production에서 이 기능은 단지 `gzip on`이 아닙니다. 같은 URL이라도 클라이언트의 `Accept-Encoding`에 따라 다른 표현이 나가고, CDN은 어떤 표현을 캐시했는지 구분해야 하며, 원본 서버는 줄어든 전송량 대신 CPU 시간을 사용합니다. 특히 API가 이미 작은 JSON을 보내거나 CPU가 포화에 가까우면, 압축은 평균 네트워크 바이트를 줄이면서 p99 응답시간을 더 나쁘게 만들 수도 있습니다.

이 글의 결론은 간단합니다. **압축은 payload 절감 정책이 아니라 표현·캐시·CPU·안전성의 공동 계약**으로 운영합니다. 먼저 [응답 페이로드 예산과 필드 투영](/learning/deep-dive/deep-dive-response-payload-budget-field-projection-playbook/)으로 불필요한 바이트를 제거하고, 그 뒤 [HTTP 캐싱과 ETag 재검증](/learning/deep-dive/deep-dive-http-caching-etag-revalidation-playbook/)과 결합해 전송해야 합니다. 요청 본문을 받는 경로는 [Request Body Guardrail과 Streaming](/learning/deep-dive/deep-dive-request-body-guardrail-streaming-playbook/)의 압축 해제 제한을 별도로 적용합니다.

참고한 표준 자료:

- [RFC 9110: Content Coding과 Accept-Encoding](https://www.rfc-editor.org/rfc/rfc9110.html)
- [MDN: Content-Encoding](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Encoding)

## 이 글에서 얻는 것

- `Accept-Encoding`, `Content-Encoding`, `Vary`가 응답 표현과 cache key를 어떻게 바꾸는지 이해합니다.
- gzip·Brotli·Zstandard 중 무엇을 기본으로 둘지, 응답 크기와 CPU 예산을 기준으로 정합니다.
- ETag·304·CDN·Range·streaming에서 압축이 만드는 캐시와 운영 함정을 구분합니다.
- 요청 압축 해제 폭탄과 응답 압축을 혼동하지 않고 각각의 안전 장치를 설계합니다.

## 핵심 개념/이슈

### 1) 압축 협상은 ‘파일 포맷 선택’이 아니라 표현 선택이다

클라이언트는 `Accept-Encoding: br, zstd, gzip`처럼 이해 가능한 content coding을 보냅니다. 서버 또는 CDN은 이 목록과 자신의 지원 범위를 비교해 `Content-Encoding`을 정합니다. 여기서 원본 JSON은 하나여도 wire 위의 표현은 여럿입니다.

```text
GET /api/products?category=book
Accept-Encoding: br, gzip

200 OK
Content-Type: application/json
Content-Encoding: br
Vary: Accept-Encoding
```

`Vary: Accept-Encoding`이 빠지면 공유 캐시는 Brotli를 이해하는 첫 클라이언트에게 만든 표현을 gzip만 지원하거나 압축을 전혀 지원하지 않는 다음 클라이언트에게 그대로 줄 수 있습니다. 따라서 캐시를 켜면서 압축을 켰다면 **Vary가 실제 CDN cache key에 반영되는지**를 확인해야 합니다. proxy가 `Vary`를 자동으로 존중한다는 가정만으로는 부족합니다. CDN rule, cache key override, origin response header를 모두 봅니다.

또한 `q` 값은 클라이언트 선호도이지 서버에 대한 강제 명령이 아닙니다. 서버가 `br`을 제공하지 않으면 `gzip`이나 identity 표현을 선택할 수 있습니다. 운영 관점에서는 “최신 알고리즘을 항상 쓴다”보다, 지원하지 않는 client와 장애 시 identity fallback이 정상 작동하는지가 더 중요합니다.

### 2) 압축률과 지연은 같은 방향으로 움직이지 않는다

일반적으로 Brotli는 정적 text에서 높은 압축률을 보일 수 있고, gzip은 호환성이 넓고 구현이 성숙했습니다. Zstandard는 압축·해제 속도 특성이 좋아지는 구간이 있지만, 모든 browser와 edge가 같은 수준으로 지원한다고 전제하면 안 됩니다. 알고리즘 이름만으로 결론을 내리지 말고, 실제 대표 응답을 아래 네 숫자로 비교해야 합니다.

| 지표 | 왜 보는가 | 초기 판단 기준 예시 |
| --- | --- | --- |
| 전송 바이트 절감률 | 네트워크 비용·모바일 체감 | text 응답에서 중앙값 20% 미만이면 적용 이유 재검토 |
| 압축 CPU 시간 | origin 또는 edge 포화 영향 | request당 p95 5ms 이하를 출발선으로 둠 |
| API p95/p99 | 압축이 tail latency를 키우는지 | p95 +3%, p99 +5% 이내 canary 허용 |
| cache hit ratio | 원본 CPU를 실제로 줄이는지 | public route가 hit 60% 미만이면 cache policy부터 점검 |

이 수치는 보편적 정답이 아니라 시작점입니다. 예를 들어 사내망의 낮은 RTT API는 3KB JSON을 20% 줄여도 체감 이득이 작습니다. 반대로 해외 모바일 사용자가 많은 문서 사이트는 30KB HTML을 절반 가까이 줄이는 편이 훨씬 값집니다. **응답 크기, 네트워크, 요청률, CPU headroom**을 함께 봐야 합니다.

작은 payload에 압축을 기본 적용하지 않는 이유도 여기에 있습니다. 500B JSON은 algorithm header와 CPU cost 때문에 이득이 거의 없을 수 있습니다. 처음에는 `Content-Type` allowlist와 1~2KB size threshold를 두고 시작한 뒤, route별 bytes·CPU를 보고 조정하는 편이 안전합니다.

### 3) 압축보다 먼저 줄여야 할 것은 응답 모델이다

응답이 500KB인 이유가 사용자가 실제로 필요로 하는 데이터라면 압축이 도움 됩니다. 하지만 상세 화면에 쓰지 않는 관계 데이터, 중복된 필드명, 무제한 목록을 같이 실어 보내는 문제라면 압축은 비용을 가릴 뿐입니다. 압축된 500KB가 전송 중에는 작아져도 서버는 직렬화·압축하고 클라이언트는 해제·파싱해야 합니다.

먼저 다음 순서를 따릅니다.

1. field projection, pagination, summary endpoint로 원본 payload를 줄인다.
2. cacheable 응답은 validator와 TTL을 정해 재전송 자체를 줄인다.
3. 남은 text payload만 size threshold와 content type 기준으로 압축한다.
4. 마지막으로 level을 높여 압축률을 더 얻을지, CPU와 latency 기준으로 결정한다.

이 순서는 [HTTP 기초 심화](/learning/deep-dive/deep-dive-http-essentials/)의 representation 개념과도 맞닿습니다. 전송 최적화가 API 모델의 과잉 전송을 정당화해서는 안 됩니다.

### 4) ETag와 캐시는 ‘압축 전 원본’만으로 단순화되지 않는다

ETag는 특정 응답 **표현**을 검증하는 validator입니다. origin이 압축 전 JSON에서 ETag를 만들고 edge가 이를 다시 Brotli로 바꾼다면, 캐시 계층이 같은 ETag를 어떤 바이트에 적용하는지 명확해야 합니다. 구현마다 origin ETag를 보존하거나, variant별 ETag를 만들거나, compression을 cache 전에 수행하는 방식이 다릅니다. 이 차이를 모른 채 304 검증을 통과시킨다고 생각하면 잘못된 representation을 재사용할 수 있습니다.

운영 원칙은 세 가지로 좁힙니다.

- encoding variant를 공유할 때는 `Vary: Accept-Encoding`을 반드시 보낸다.
- ETag 생성 위치(origin, CDN, application)와 strong/weak validator 정책을 문서화한다.
- deployment 전 `Accept-Encoding: br`, `gzip`, `identity` 세 요청으로 body, `Content-Encoding`, `Vary`, ETag, 304 응답을 직접 확인한다.

같은 이유로 `Range` 응답과 대용량 download는 기본 압축 대상이 아닙니다. 이미 저장된 파일에서 일부 바이트를 요구하는 것과, 전체 객체를 새로 압축해 보낸 바이트 범위는 의미가 다릅니다. 동영상, 설치 파일, ZIP, JPEG, PDF 대부분도 이미 압축돼 있어 이득이 작고 CPU만 씁니다.

### 5) 응답 압축과 압축 해제 폭탄은 다른 문제다

응답 압축은 서버가 만든 알려진 data를 wire에 효율적으로 싣는 문제입니다. 반면 inbound `Content-Encoding: gzip`은 신뢰할 수 없는 client가 작은 압축 body를 매우 큰 data로 팽창시킬 수 있는 입력 보안 문제입니다. 이 둘을 같은 middleware 옵션으로 켜고 끝내면 위험합니다.

upload·webhook·import endpoint는 압축 전 `Content-Length`만 믿지 말고, **압축 해제 후 최대 크기**, **압축비 상한**, **해제 시간**, **동시 해제 수**를 제한합니다. 예를 들어 일반 API는 해제 후 10MB, 대량 import는 비동기 저장 뒤 malware/format scan, ratio 100:1 초과는 차단 또는 quarantine처럼 workload별 정책을 분리합니다. 해제 완료 뒤 JSON parser가 거대한 객체를 만들기 전에 stream 단계에서 중단해야 메모리 보호가 됩니다.

## 실무 적용

### 1) 정책을 응답 분류표로 시작한다

압축을 global boolean으로 두지 말고 endpoint를 네 가지로 분류합니다.

| 응답 종류 | 기본 정책 | 근거 | 예외 |
| --- | --- | --- |
| 공개 HTML·CSS·JS·문서 | CDN 압축 허용 | 반복 요청과 전송량이 큼 | immutable asset은 build-time precompression 검토 |
| 2KB 이상 JSON API | low-level gzip/Brotli canary | 개인화여도 text 전송량 절감 | CPU headroom 부족 시 gzip 또는 identity로 degrade |
| Protobuf·이미지·동영상·zip | 기본 제외 | 대개 이미 압축됨 | 원본 codec와 실제 bytes 측정 후만 예외 |
| SSE·다운로드·Range | 기본 제외 | flush·progress·range 의미 유지 | 별도 streaming protocol과 client 호환성 검증 |

서비스가 CPU 70%를 넘는 동안은 더 높은 compression level을 자동으로 선택하지 않습니다. CPU 80%가 5분 지속되고 API p99가 기준선보다 10% 악화되면, 첫 보호 조치는 비핵심 response compression level을 낮추거나 끄는 것입니다. 데이터를 더 많이 보내는 것이 이상적이지는 않지만, latency queue가 길어지는 것보다 예측 가능한 복구가 낫습니다.

### 2) canary는 전송량과 자원 보호를 같이 검증한다

첫 rollout은 상위 5개 text route의 5~10% traffic으로 충분합니다. 같은 release에서 API 모델, CDN rule, compression level을 동시에 바꾸지 마세요. 원인을 분리할 수 없게 됩니다.

1. baseline 7일: route별 원본/전송 바이트, p95/p99, CPU, cache hit, 4xx/5xx를 기록합니다.
2. canary 3~7일: `br` 또는 gzip variant만 열고, identity 요청과 응답 의미·ETag가 같은지 비교합니다.
3. 확대 gate: 전송 바이트 중앙값 15% 이상 감소, p95 CPU +5%p 이내, p99 latency +5% 이내, cache 오류 0건이면 25%로 올립니다.
4. rollback: cache poisoning, client decode error, p99 +10% 또는 CPU 80% 지속 중 하나면 즉시 직전 policy로 복구합니다.

여기서 관측 필드는 최소 `route`, `content_type`, `content_encoding`, `original_bytes`, `wire_bytes`, `compression_ms`, `cache_status`입니다. user ID나 full query string은 metric label에 넣지 않습니다. 고카디널리티가 필요한 조사 데이터는 sampled log 또는 trace로 분리합니다.

### 3) Spring/프록시 설정은 역할을 한 곳으로 고정한다

application, ingress, CDN 모두 압축 기능이 있을 수 있습니다. 이중 압축은 보통 `Content-Encoding: gzip`을 다시 gzip하는 형태로 막히지만, 설정 충돌은 header와 cache behavior를 예측하기 어렵게 만듭니다. public cacheable traffic은 CDN/edge, private JSON은 ingress 또는 application처럼 **책임 위치를 하나로** 고정합니다.

예를 들어 reverse proxy가 압축 주체라면 application은 raw representation과 정확한 `Content-Type`, `Cache-Control`, ETag만 제공합니다. proxy는 text allowlist, minimum size, `Vary`를 관리합니다. application이 압축 주체라면 CDN은 encoded representation을 그대로 cache하고 재압축하지 않는지 검증합니다. 각 route의 ownership을 runbook에 적어 두면 장애 시 `curl --compressed` 하나로도 어느 계층을 봐야 할지 빨라집니다.

### 4) 압축 해제 endpoint는 별도 threat model로 시험한다

압축된 request를 허용할 이유가 명확한 endpoint만 allowlist합니다. 일반 browser form이나 webhook이 반드시 gzip body를 보낼 필요는 드뭅니다. 허용한다면 정상 payload, 선언한 것보다 큰 payload, 높은 압축비 payload, 취소된 upload를 각각 테스트합니다.

- 최대 해제 바이트: 동기 API는 예를 들어 10MB, batch import는 object storage로 스트리밍 후 비동기 검사
- 해제 ratio: 100:1을 넘으면 alert와 block 후보로 기록
- 시간: request deadline의 20% 이상을 해제에 쓰면 parser 전에 timeout 처리
- 동시성: CPU intensive decompression은 request executor 전체가 아닌 제한된 worker budget으로 격리

이 기준은 [Request Body Guardrail과 Streaming](/learning/deep-dive/deep-dive-request-body-guardrail-streaming-playbook/)에서 말하는 max bytes와 timeout을 content coding 단계까지 확장한 것입니다.

## 트레이드오프/주의점

1. **더 높은 압축률은 더 좋은 사용자 경험과 동의어가 아닙니다.** CPU가 부족한 service는 gzip low level이나 identity가 p99에 더 유리할 수 있습니다. 모바일 네트워크와 origin CPU 중 어느 쪽이 병목인지 먼저 확인합니다.

2. **Brotli 또는 Zstandard를 제품 요구로 고정하지 않습니다.** client, CDN, library, observability proxy의 지원이 다를 수 있습니다. 알고리즘 교체는 HTTP 호환성 release로 보고 canary와 fallback을 둡니다.

3. **`Vary`를 놓치면 평균 지표가 정상이어도 일부 client가 깨집니다.** browser만 보지 말고 SDK, crawler, internal proxy, 오래된 client가 `identity`와 `gzip`을 어떻게 처리하는지 확인합니다.

4. **압축은 민감정보를 없애 주지 않습니다.** response body에 포함하면 안 되는 값은 redaction과 authorization으로 막아야 합니다. 같은 connection에서 attacker-controlled text와 secret을 섞어 압축하는 side-channel 문제는 보안 민감 경로에서 별도 검토 대상입니다.

## 체크리스트 또는 연습

### 체크리스트

- [ ] endpoint별 text/binary/streaming 분류와 압축 allowlist가 있다.
- [ ] `br`, `gzip`, `identity` 요청에서 `Content-Encoding`, `Vary`, ETag, body 의미를 비교했다.
- [ ] 원본 바이트·wire 바이트·compression CPU·p95/p99·cache hit를 한 dashboard에서 본다.
- [ ] 이미 압축된 media, Range, SSE, 큰 download는 기본 제외한다.
- [ ] inbound compressed request는 해제 후 크기·ratio·시간·동시성 제한을 통과해야 한다.
- [ ] CPU 80% 지속 또는 p99 +10% 때 compression rollback/degrade 기준이 있다.

### 연습: 상품 목록 API의 압축 정책 만들기

1. `/api/products`의 7일 payload 분포를 1KB 미만, 1~10KB, 10KB 이상으로 나눕니다.
2. 10KB 이상 응답만 gzip low level로 10% canary하고, 원본/전송 bytes와 API p95/p99를 비교합니다.
3. CDN을 쓴다면 `Accept-Encoding` 세 variant로 cache hit와 `Vary`를 확인합니다.
4. 결과가 좋지 않다면 compression level을 올리지 말고, pagination·field projection으로 원본 payload부터 줄입니다.

## 관련 글

- [HTTP 캐싱과 ETag 재검증](/learning/deep-dive/deep-dive-http-caching-etag-revalidation-playbook/)
- [응답 페이로드 예산과 필드 투영](/learning/deep-dive/deep-dive-response-payload-budget-field-projection-playbook/)
- [HTTP 기초 심화](/learning/deep-dive/deep-dive-http-essentials/)
- [Request Body Guardrail과 Streaming](/learning/deep-dive/deep-dive-request-body-guardrail-streaming-playbook/)
