---
title: "[2편] Admin 페이지 구현"
date: 2025-06-18
draft: false
tags: ["React", "프론트엔드",]
categories: ["Development", "Learning"]
description: "curl 명령어가 귀찮아서 만든 도구를 쓸만하게 만드는 방법"
project: "Simple Queue Service"
series: "Simple Queue Service"
---

> "매번 curl로 API 테스트하기 귀찮아서 만들기 시작했는데..."

여러 API들을 구현하고 나니, 큐 상태를 확인하거나 테스트할 때마다 매번 curl 명령어를 치고 있더라고요. 

```bash
# 매일매일 반복하던 명령어들...
curl -X GET "http://localhost:8080/api/v1/queues" -H "X-API-Key: test-tenant-key"
curl -X POST "http://localhost:8080/api/v1/queues/test-queue/messages" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: test-tenant-key" \
  -d '{"messageBody": "test message"}'
curl -X GET "http://localhost:8080/api/v1/queue"
  -H "X-API-Key: test-tenant-key"
```

이건 아니다 싶더라구요... Admin 페이지를 만들어야 겠다고 생각했습니다.

이번 포스트에서는 **curl 안치기 위해 시작된 간단한 도구가 쓸만하게 변한 내용**을 공유해보겠습니다.

## 🤦‍♂️ 1단계: "curl 치기 너무 귀찮다..."

### 처음의 솔직한 동기
개발하면서 큐를 테스트하려면 매번 이런 과정을 거쳐야 했어요

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

**몇 번 하다 보니:** "이거 버튼 클릭으로 할 수 없나?" 하는 생각이 들더라고요.

### 첫 번째 버전: 정말 단순한 테스트 도구

```typescript
// 정말로 이렇게 시작했습니다... 테스트용 도구
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

  const receiveMessage = async () => {
    try {
      const res = await fetch(`/api/v1/queues/${queueName}/messages`, {
        headers: { 'X-API-Key': apiKey }
      });
      const data = await res.text();
      setResponse(data);
    } catch (error) {
      setResponse(`Error: ${error}`);
    }
  };

  return (
    <div>
      ...
    </div>
  );
}
```

**결과:** 확실히 curl보다는 편했어요!

### 첫 번째 문제: "큐가 여러 개인데 하나씩 테스트하기 번거롭다"

테스트 도구를 쓰다 보니 또 다른 불편함이...

```
큐 목록:
- test-queue
- test-queue2
- test-queue3
- ...
- ...
```

큐마다 일일이 이름을 바꿔서 테스트하기 귀찮더라고요.

### 두 번째 버전: 큐 목록도 보여주자

```typescript
// 조금 더 발전된 형태
function QueueTester() {
  const [queues, setQueues] = useState([]);
  const [selectedQueue, setSelectedQueue] = useState('');
  const [apiKey, setApiKey] = useState('test-tenant-key');
  const [testResults, setTestResults] = useState({});

  // 큐 목록 가져오기
  const fetchQueues = async () => {
    try {
      const response = await fetch('/api/v1/queues', {
        headers: { 'X-API-Key': apiKey }
      });
      const data = await response.json();
      setQueues(data.queues || []);
    } catch (error) {
      console.error('큐 목록 조회 실패:', error);
    }
  };

  // 큐 상태 확인
  const checkQueueStats = async (queueName) => {
    try {
      const response = await fetch(`/api/v1/queues/${queueName}/stats`, {
        headers: { 'X-API-Key': apiKey }
      });
      const stats = await response.json();
      setTestResults(prev => ({
        ...prev,
        [queueName]: stats
      }));
    } catch (error) {
      console.error('큐 상태 조회 실패:', error);
    }
  };

  return (
    <div>
      ...
    </div>
  );
}
```

어라?... 재밌을지도?...

## 2단계: "좀 더 해볼까?..."

### 문제: "매번 새로고침하기 귀찮다"

테스트 도구를 쓰다 보니 이런 패턴이 반복되더라고요:

1. 메시지 보내기
2. 브라우저 새로고침 (큐 상태 확인)
3. 메시지 받기 
4. 브라우저 새로고침 (큐 상태 확인)

**생각:** "이거 자동으로 업데이트되면 좋겠는데?"

### 해결: 폴링으로 자동 업데이트

```typescript
// 자동 새로고침 기능 추가
const useAutoRefresh = (fetchFn, interval = 3000) => {
  const [data, setData] = useState(null);
  const [isEnabled, setIsEnabled] = useState(true);
  
  useEffect(() => {
    if (!isEnabled) return;
    
    const poll = async () => {
      try {
        const result = await fetchFn();
        setData(result);
      } catch (error) {
        console.error('폴링 에러:', error);
      }
    };
    
    poll(); // 즉시 실행
    const intervalId = setInterval(poll, interval);
    
    return () => clearInterval(intervalId);
  }, [isEnabled, fetchFn, interval]);
  
  return { data, isEnabled, setIsEnabled };
};

// 사용
function QueueDashboard() {
  const [apiKey, setApiKey] = useState('test-tenant-key');
  
  const fetchQueues = useCallback(() => 
    fetch('/api/v1/queues', {
      headers: { 'X-API-Key': apiKey }
    }).then(res => res.json())
  , [apiKey]);
  
  const { data: queuesData, isEnabled, setIsEnabled } = useAutoRefresh(fetchQueues);
  
  return (
    <div>
      ...
    </div>
  );
}
```

## 🎨 3단계: "안 이뻐~~ ㅜㅜ"

### 문제: "디자인이 구리다"

JSON 그대로 보여줬더니 내가 보기가 싫다

```typescript
// ❌ 개발자에게만 친숙한 UI
<div>
  <pre>{JSON.stringify(queueStats, null, 2)}</pre>
</div>

// 결과:
// {
//   "messageCount": 1542,
//   "dlqCount": 23,
//   "processingCount": 8
// }
```
### 해결: 이쁜 디자인으로 변경

```typescript
// ✅ 보기 좋은 카드 형태
const QueueCard = ({ queue }: { queue: QueueInfo }) => {
  return (
    <div>
      ...
    </div>
  );
};
```

### 두 번째 깨달음: "색이 문제여.."

**메인 화면 색 변경:**
- **배경 색**: linear-gradient(135deg, #667eea 0%, #764ba2 100%)
- **버튼 색**: background-color: #3b82f6;
- **활성 색**: background-color: #d1fae5;
- **비활성 색**: background-color: #fee2e2;

## 4단계: "유저 테스트도 해야하는데..."

### 문제: "유저도 잘 만들어지나 테스트 해봐야하는데..."

**문제점들:**
- 유저 리스트 출력
- 유저 생성
- 유저 별 토픽 리스트 출력?

### 해결: 하드코딩이지만 일단 동작하는 형태

1번 2번은 구현 => 큐에서 만들었던 디자인 비슷하게 구현
3번은 귀찮아서 하드코딩 => 첫번째 유저의 토픽만 출력

```typescript
// 실제 구현: 간단한 하드코딩 방식
const API_KEY = 'test-api-key'; // 개발용 고정 키

const api = axios.create({
  baseURL: 'http://localhost:8080',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY, // 고정된 API 키 사용
  },
});

export const sqsApi = {
  listQueues: async () => {
    const response = await api.get('/api/v1/queues');
    return response.data;
  },
  
  sendMessage: async (queueName: string, message: any) => {
    const response = await api.post(`/api/v1/queues/${queueName}/messages`, message);
    return response.data;
  }
  // ... 나머지 API들
};
```

## 🚀 다음 편 예고

다음 편에서는 **큐에서 Redis를 쓰는게 맞을지...** 고민했던 순간과 이를 해결하기 위해 생각했던 과정을 자세히 다뤄보겠습니다.

**Admin 페이지도 계속 발전시켜 볼까나..**
- 더 편리한 테스트 기능들
- 간단한 모니터링 개선
- 사용자 경험 향상 (조금씩...)