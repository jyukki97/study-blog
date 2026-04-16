---
title: "[2편] Admin 페이지 구현"
date: 2025-06-18
draft: false
tags: ["React", "프론트엔드"]
categories: ["Development", "Learning"]
description: "curl 명령어가 귀찮아서 만든 도구를 쓸만하게 만드는 방법"
project: "Simple Queue Service"
series: "Simple Queue Service"
---

> "매번 curl로 API 테스트하기 귀찮아서 만들기 시작했는데..."

[1편](/posts/sqs-01-architecture/)에서 큐와 멀티 테넌트 구조를 어느 정도 잡고 나니까, 이번에는 전혀 다른 병목이 보이기 시작했습니다. 서버 코드는 돌아가는데, 내가 그 상태를 확인하는 방식이 너무 원시적이었던 거죠. 큐 목록을 보고 싶어도 curl, 메시지 하나 넣어보고 싶어도 curl, 통계 확인하려고 또 curl. 기능이 늘어날수록 API 자체보다 **확인하는 과정**이 더 귀찮아졌습니다.

```bash
# 매일매일 반복하던 명령어들...
curl -X GET "http://localhost:8080/api/v1/queues" -H "X-API-Key: test-tenant-key"
curl -X POST "http://localhost:8080/api/v1/queues/test-queue/messages" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: test-tenant-key" \
  -d '{"messageBody": "test message"}'
curl -X GET "http://localhost:8080/api/v1/queue" \
  -H "X-API-Key: test-tenant-key"
```

이건 분명 기능 테스트인데, 체감은 거의 수작업 운영 같았습니다. 그래서 이번 포스트에서는 **curl 안 치려고 만든 임시 도구가 어떻게 관리자 페이지다운 형태로 커졌는지**, 그리고 그 과정에서 어떤 기준이 생겼는지를 정리해보겠습니다.

## 🤦‍♂️ 1단계: "curl 치기 너무 귀찮다..."

### 처음의 솔직한 동기

개발하면서 큐를 테스트하려면 매번 이런 과정을 거쳐야 했어요.

```bash
# 1. 큐 목록 확인
curl -X GET "http://localhost:8080/api/v1/queues" \
  -H "X-API-Key: test-tenant-key" | jq

# 2. 메시지 전송
curl -X POST "http://localhost:8080/api/v1/queues/my-queue/messages" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: test-tenant-key" \
  -d '{"messageBody": "test message"}'

# 3. 메시지 수신
curl -X GET "http://localhost:8080/api/v1/queues/my-queue/messages" \
  -H "X-API-Key: test-tenant-key"

# 4. 큐 상태 확인
curl -X GET "http://localhost:8080/api/v1/queues/my-queue/stats" \
  -H "X-API-Key: test-tenant-key" | jq
```

몇 번 하다 보니 바로 생각이 들더라고요. **"이거 버튼 클릭으로 할 수 없나?"**

### 첫 번째 버전: 정말 단순한 테스트 도구

```typescript
function QuickTester() {
  const [apiKey, setApiKey] = useState('test-tenant-key');
  const [queueName, setQueueName] = useState('my-queue');
  const [message, setMessage] = useState('test message');
  const [response, setResponse] = useState('');

  const sendMessage = async () => {
    try {
      const res = await fetch(`/api/v1/queues/${queueName}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify({ messageBody: message })
      });
      const data = await res.text();
      setResponse(data);
    } catch (error) {
      setResponse(`Error: ${error}`);
    }
  };

  return <div>...</div>;
}
```

이 단계에서는 솔직히 UI라기보다 버튼 달린 API 클라이언트에 가까웠습니다. 그래도 중요했던 건, **반복되는 확인 동작을 한 화면으로 모으는 것만으로도 개발 속도가 꽤 올라갔다**는 점이었습니다.

## 2단계: 큐 목록과 상태를 같이 보여주자

테스트 도구를 쓰다 보니 다음 병목이 또 나왔습니다. 큐가 여러 개가 되니까 이름을 매번 복붙해 넣는 것도 귀찮았어요. 결국 필요한 건 단일 액션 버튼이 아니라, **현재 큐 상태를 훑고 바로 액션으로 이어지는 흐름**이었습니다.

```typescript
function QueueTester() {
  const [queues, setQueues] = useState([]);
  const [selectedQueue, setSelectedQueue] = useState('');
  const [apiKey, setApiKey] = useState('test-tenant-key');
  const [testResults, setTestResults] = useState({});

  const fetchQueues = async () => {
    const response = await fetch('/api/v1/queues', {
      headers: { 'X-API-Key': apiKey }
    });
    const data = await response.json();
    setQueues(data.queues || []);
  };

  const checkQueueStats = async (queueName: string) => {
    const response = await fetch(`/api/v1/queues/${queueName}/stats`, {
      headers: { 'X-API-Key': apiKey }
    });
    const stats = await response.json();
    setTestResults(prev => ({ ...prev, [queueName]: stats }));
  };

  return <div>...</div>;
}
```

여기서부터는 단순 편의 기능이 아니라, 운영 화면의 최소 조건이 생겼습니다.

- 큐를 선택할 수 있어야 하고
- 현재 메시지 수와 처리 상태가 보여야 하고
- 한 화면에서 send, receive, stats 확인이 이어져야 하고
- 실패했을 때 응답도 같이 보여야 했습니다.

## 3단계: 새로고침을 줄이고, 눈에 띄게 보여주자

다음으로 불편했던 건 상태 확인을 위해 계속 새로고침해야 한다는 점이었습니다. 메시지 보내고 새로고침, 수신하고 새로고침, 또 통계 확인. 이건 관리자 페이지라기보다 "예쁜 curl 모음집"에 가까웠습니다.

### 해결: 폴링 기반 자동 업데이트

```typescript
const useAutoRefresh = (fetchFn, interval = 3000) => {
  const [data, setData] = useState(null);
  const [isEnabled, setIsEnabled] = useState(true);

  useEffect(() => {
    if (!isEnabled) return;

    const poll = async () => {
      const result = await fetchFn();
      setData(result);
    };

    poll();
    const intervalId = setInterval(poll, interval);
    return () => clearInterval(intervalId);
  }, [isEnabled, fetchFn, interval]);

  return { data, isEnabled, setIsEnabled };
};
```

이 기능을 붙이고 나서 느낀 건, 관리자 페이지의 핵심은 액션 버튼보다도 **상태 변화가 저절로 보이는가**에 더 가깝다는 점이었습니다. 사용자는 클릭보다 "지금 큐가 비었는지", "처리 중 메시지가 늘었는지", "DLQ가 쌓였는지"를 먼저 보고 싶어하더라고요.

### UI도 JSON 그대로 두면 의미가 잘 안 보였다

```typescript
// ❌ 개발자에게만 친숙한 UI
<pre>{JSON.stringify(queueStats, null, 2)}</pre>

// ✅ 카드형 요약
const QueueCard = ({ queue }: { queue: QueueInfo }) => {
  return <div>...</div>;
};
```

숫자는 같아도, `messageCount`, `processingCount`, `dlqCount`를 카드로 나눠 보여주니까 어디가 이상한지 훨씬 빨리 보였습니다. 결국 관리자 화면은 데이터를 "많이" 보여주는 게 아니라, **다음 액션이 무엇인지 바로 떠오르게 보여주는 것**이 중요했습니다.

## 4단계: 유저 테스트까지 생각하니 임시 구현의 한계가 보였다

Admin 화면을 조금 그럴듯하게 만들고 나니, 이번에는 멀티 테넌트 관리 쪽이 발목을 잡았습니다. 유저 리스트, 유저 생성, 유저별 토픽 확인 같은 기능도 필요했는데, 처음에는 일단 돌아가게만 만들었습니다.

```typescript
const API_KEY = 'test-api-key';

const api = axios.create({
  baseURL: 'http://localhost:8080',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY,
  },
});
```

이 시점에서 분명히 배운 게 하나 있었습니다. **운영 도구는 하드코딩으로도 시작할 수 있지만, 오래 쓰려면 결국 권한과 컨텍스트를 분리해야 한다**는 점입니다. 개발용 고정 키로는 빠르게 검증할 수 있지만, 실제로 여러 테넌트를 다루기 시작하면 누가 어떤 큐를 보고 있는지부터 분리해서 보여줘야 했습니다.

## 지금 다시 보면 중요했던 설계 포인트

### 1) "API를 잘 만들었다"와 "운영하기 쉽다"는 다르다

백엔드 API가 잘 동작해도, 상태를 확인하는 비용이 높으면 실제 개발 경험은 계속 답답합니다. Admin 페이지는 단순 부가 기능이 아니라, **개발자 피드백 루프를 줄이는 장치**였습니다.

### 2) 관리자 화면은 기능보다 흐름이 더 중요하다

제가 실제로 자주 쓰던 흐름은 거의 고정이었습니다.

1. 큐 목록 확인
2. 특정 큐 선택
3. 메시지 전송
4. 즉시 상태 변화 확인
5. 필요하면 수신 또는 DLQ 확인

그래서 메뉴를 늘리는 것보다, 이 흐름이 한 화면에서 끊기지 않게 만드는 쪽이 훨씬 효과가 컸습니다.

### 3) 다음 단계는 권한, 상태, 액션을 더 분리하는 것이다

지금 구조는 개발용 관리자 화면으로는 충분히 쓸만했지만, 실제 운영용으로 가려면 아래가 더 필요했습니다.

- 테넌트별 필터와 권한 분리
- 실패 응답 표준화
- DLQ, 처리 중 메시지, 재시도 횟수 같은 운영 지표 노출
- 최근 액션 로그와 마지막 갱신 시간 표시

## 간단 체크리스트

Admin 페이지를 만들거나 고칠 때 저는 최소한 아래 항목은 있어야 한다고 봅니다.

- [ ] 큐 목록, 큐 상태, 액션 버튼이 한 화면에서 이어진다.
- [ ] 새로고침 없이 상태 변화를 주기적으로 확인할 수 있다.
- [ ] 성공/실패 응답이 사용자가 이해하기 쉬운 형태로 보인다.
- [ ] 멀티 테넌트 환경이라면 현재 컨텍스트가 명확하다.
- [ ] DLQ, 처리 중 개수, 마지막 갱신 시각처럼 운영용 정보가 있다.

## 다음 편 예고

다음 편인 [3편](/posts/sqs-03-storage-architecture/)에서는 **메시지 큐에서 Redis를 계속 메인 저장소로 쓰는 게 맞는지**, 그리고 성능과 비용 사이에서 어떤 저장소 구조를 고민하게 됐는지를 더 자세히 다뤄보겠습니다.

결국 Admin 페이지를 만들고 나서 오히려 시스템의 약점이 더 잘 보였습니다. 그게 이 화면의 가장 큰 수확이었던 것 같아요. 눈에 보이기 시작하니까, 다음에 어디를 고쳐야 할지도 훨씬 선명해졌습니다.