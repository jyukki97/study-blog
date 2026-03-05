---
title: "React 성능 (Part 1: 렌더링 최적화)"
study_order: 714
date: 2025-12-01
topic: "Frontend"
topic_icon: "💬"
topic_description: "React 성능 최적화, Virtual DOM, memo, useCallback 관련 핵심 개념과 실전 예제 정리"
tags: ["React", "Performance", "Virtual DOM", "Hooks"]
categories: ["Frontend"]
description: "React 렌더링 최적화, Virtual DOM 동작, memo/useCallback 활용법 Q&A"
draft: false
module: "qna"
---

# React 성능 최적화 정리

## Q1. Virtual DOM은 어떻게 동작하나요?

### 답변

**Virtual DOM**은 **실제 DOM의 가벼운 복사본**으로, React가 UI 업데이트를 효율적으로 처리하기 위한 메커니즘입니다.

### 동작 원리

**1. 렌더링 과정**:

```jsx
// 1. 초기 렌더링
function App() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <h1>Count: {count}</h1>
      <button onClick={() => setCount(count + 1)}>+1</button>
    </div>
  );
}

// Virtual DOM (JavaScript 객체)
{
  type: 'div',
  props: {},
  children: [
    {
      type: 'h1',
      props: {},
      children: ['Count: 0']
    },
    {
      type: 'button',
      props: { onClick: [Function] },
      children: ['+1']
    }
  ]
}
```

**2. 업데이트 과정**:

```
State 변경 (count: 0 → 1)
  ↓
새로운 Virtual DOM 생성
  ↓
이전 Virtual DOM과 비교 (Diffing)
  ↓
변경된 부분만 찾기
  ↓
실제 DOM에 변경사항 적용 (Reconciliation)
```

**3. Diffing Algorithm**:

```jsx
// Before
<div>
  <h1>Count: 0</h1>
  <button>+1</button>
</div>

// After (count: 0 → 1)
<div>
  <h1>Count: 1</h1>  ← 변경됨
  <button>+1</button>
</div>

// Diffing 결과:
// - h1의 텍스트만 변경됨
// - button은 변경 없음

// 실제 DOM 업데이트 (최소한의 변경)
document.querySelector('h1').textContent = 'Count: 1';
// → button은 건드리지 않음!
```

### Virtual DOM vs 실제 DOM 성능 비교

**실제 DOM 직접 조작** (느림):

```javascript
// ❌ 실제 DOM 10번 업데이트
for (let i = 0; i < 10; i++) {
  document.getElementById('list').innerHTML += `<li>${i}</li>`;
  // → 매번 Reflow/Repaint 발생 (10번)
}
```

**Virtual DOM 사용** (빠름):

```jsx
// ✅ Virtual DOM으로 10개 업데이트 → 1번에 적용
function List() {
  const [items, setItems] = useState([]);

  const addItems = () => {
    const newItems = [];
    for (let i = 0; i < 10; i++) {
      newItems.push(i);
    }
    setItems(newItems);
    // → Virtual DOM에서 Diffing
    // → 실제 DOM은 1번만 업데이트
  };

  return (
    <ul>
      {items.map(item => <li key={item}>{item}</li>)}
    </ul>
  );
}
```

**성능 측정**:

| 방식 | 100개 업데이트 | 1000개 업데이트 |
|------|----------------|-----------------|
| 실제 DOM 직접 | 150ms | 1500ms |
| Virtual DOM | 30ms | 200ms |
| 차이 | 5배 빠름 | 7.5배 빠름 |

### 꼬리 질문 1: Reconciliation 알고리즘은?

**React의 Reconciliation**은 **O(n³) → O(n)**으로 최적화:

**일반적인 Diffing**: O(n³)

```
트리 A와 트리 B의 최소 편집 거리
→ 모든 노드 쌍 비교
→ O(n³) 복잡도
```

**React의 Diffing**: O(n)

```
1. 다른 타입의 엘리먼트 → 전체 교체
2. 같은 타입의 엘리먼트 → props만 비교
3. 자식 리스트 → key로 식별
```

**예시**:

```jsx
// ❌ key 없이 리스트 업데이트 (느림)
<ul>
  <li>A</li>
  <li>B</li>
</ul>

// 맨 앞에 추가
<ul>
  <li>C</li>  ← 추가
  <li>A</li>
  <li>B</li>
</ul>

// React가 보는 것:
// li[0]: 없음 → C (생성)
// li[1]: A → A (변경 없음)
// li[2]: B → B (변경 없음)
// → 실제로는 C만 추가하면 되는데, 전체 재생성! ⚠️

// ✅ key로 리스트 업데이트 (빠름)
<ul>
  <li key="a">A</li>
  <li key="b">B</li>
</ul>

// 맨 앞에 추가
<ul>
  <li key="c">C</li>  ← 추가
  <li key="a">A</li>
  <li key="b">B</li>
</ul>

// React가 보는 것:
// key="c": 새로운 요소 (추가)
// key="a": 이미 존재 (재사용)
// key="b": 이미 존재 (재사용)
// → C만 추가! ✅
```

### 꼬리 질문 2: Virtual DOM이 항상 빠른가요?

**아니요**. 간단한 업데이트는 실제 DOM이 더 빠를 수 있습니다.

```jsx
// ❌ Virtual DOM 오버헤드 (간단한 업데이트)
function Counter() {
  const [count, setCount] = useState(0);

  return <div>{count}</div>;
  // 1. Virtual DOM 생성
  // 2. Diffing
  // 3. 실제 DOM 업데이트
  // → 3단계 (오버헤드)
}

// ✅ 실제 DOM 직접 조작 (더 빠를 수 있음)
const div = document.createElement('div');
div.textContent = count;
// → 1단계 (직접 업데이트)
```

**Virtual DOM의 장점**:
- 복잡한 UI 업데이트 시 최적화
- 선언적 프로그래밍 (가독성)
- 크로스 플랫폼 (React Native)

---

## Q2. React.memo는 어떻게 사용하나요?

### 답변

**React.memo**는 **컴포넌트를 메모이제이션**하여 불필요한 리렌더링을 방지합니다.

### 기본 사용법

**문제 상황**:

```jsx
function Parent() {
  const [count, setCount] = useState(0);
  const [name, setName] = useState('John');

  return (
    <div>
      <button onClick={() => setCount(count + 1)}>Count: {count}</button>
      <Child name={name} />  {/* count 변경 시에도 리렌더링! ⚠️ */}
    </div>
  );
}

function Child({ name }) {
  console.log('Child 렌더링');  // count 변경 시마다 실행됨!
  return <div>Name: {name}</div>;
}

// 동작:
// count 변경 → Parent 리렌더링 → Child도 리렌더링 (name은 안 변했는데!)
```

**해결: React.memo 사용**:

```jsx
// ✅ React.memo로 최적화
const Child = React.memo(function Child({ name }) {
  console.log('Child 렌더링');
  return <div>Name: {name}</div>;
});

// 동작:
// count 변경 → Parent 리렌더링 → Child는 리렌더링 안 함 (name 변경 없음)
// name 변경 → Parent 리렌더링 → Child도 리렌더링 (name 변경됨)
```

### Custom Comparison Function

**얕은 비교의 한계**:

```jsx
function Parent() {
  const [count, setCount] = useState(0);
  const user = { name: 'John', age: 30 };  // 매번 새 객체!

  return (
    <div>
      <button onClick={() => setCount(count + 1)}>Count: {count}</button>
      <Child user={user} />  {/* user는 매번 새 객체라 리렌더링! ⚠️ */}
    </div>
  );
}

const Child = React.memo(function Child({ user }) {
  console.log('Child 렌더링');
  return <div>{user.name}</div>;
});

// React.memo는 기본적으로 얕은 비교 (shallow comparison)
// user !== user (참조가 다름) → 리렌더링 발생!
```

**해결 1: useMemo 사용**:

```jsx
function Parent() {
  const [count, setCount] = useState(0);
  const user = useMemo(() => ({ name: 'John', age: 30 }), []);
  // → user 객체 메모이제이션 (재생성 안 함)

  return (
    <div>
      <button onClick={() => setCount(count + 1)}>Count: {count}</button>
      <Child user={user} />  {/* user 참조 동일 → 리렌더링 안 함 ✅ */}
    </div>
  );
}
```

**해결 2: Custom Comparison**:

```jsx
const Child = React.memo(
  function Child({ user }) {
    console.log('Child 렌더링');
    return <div>{user.name}</div>;
  },
  (prevProps, nextProps) => {
    // true 반환 → 리렌더링 스킵
    // false 반환 → 리렌더링
    return prevProps.user.name === nextProps.user.name;
  }
);
```

### React.memo 사용 시 주의사항

**1. 무분별한 사용 금지**:

```jsx
// ❌ 모든 컴포넌트에 memo 적용 (오히려 성능 저하)
const TinyComponent = React.memo(function TinyComponent() {
  return <div>Hello</div>;
});
// → memo 비교 비용 > 리렌더링 비용

// ✅ 무거운 컴포넌트에만 적용
const HeavyComponent = React.memo(function HeavyComponent({ data }) {
  // 복잡한 계산이나 많은 자식 컴포넌트
  return <ExpensiveChart data={data} />;
});
```

**2. Props 변경이 잦으면 무의미**:

```jsx
// ❌ props가 매번 변경되면 memo 무의미
function Parent() {
  const [time, setTime] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return <Child time={time} />;  // time은 1초마다 변경
}

const Child = React.memo(function Child({ time }) {
  return <div>{time}</div>;
  // → 1초마다 리렌더링되므로 memo 효과 없음!
});
```

### 꼬리 질문: memo vs PureComponent 차이는?

**React.memo**: 함수형 컴포넌트용
**PureComponent**: 클래스형 컴포넌트용

```jsx
// React.memo (함수형)
const MyComponent = React.memo(function MyComponent({ value }) {
  return <div>{value}</div>;
});

// PureComponent (클래스형)
class MyComponent extends React.PureComponent {
  render() {
    return <div>{this.props.value}</div>;
  }
}

// 둘 다 얕은 비교 (shallow comparison) 수행
```

---


---

👉 **[다음 편: React 성능 (Part 2: useCallback/useMemo, 심화)](/learning/qna/react-performance-qna-part2/)**
