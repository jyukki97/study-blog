---
title: "React 성능 (Part 2: useCallback/useMemo, 심화)"
study_order: 714
date: 2025-12-01
topic: "Frontend"
topic_icon: "💬"
topic_description: "React 성능 최적화, Virtual DOM, memo, useCallback 관련 핵심 개념과 실전 예제 정리"
tags: ["React", "Performance", "Virtual DOM", "Hooks"]
categories: ["Frontend"]
draft: false
module: "qna"
---

## Q3. useCallback과 useMemo의 차이는?

### 답변

**useCallback**: 함수를 메모이제이션
**useMemo**: 값을 메모이제이션

### useCallback

**문제 상황**:

```jsx
function Parent() {
  const [count, setCount] = useState(0);
  const [name, setName] = useState('John');

  // ❌ 매번 새로운 함수 생성
  const handleClick = () => {
    console.log(name);
  };

  return (
    <div>
      <button onClick={() => setCount(count + 1)}>Count: {count}</button>
      <Child onClick={handleClick} />
      {/* count 변경 → handleClick 재생성 → Child 리렌더링! ⚠️ */}
    </div>
  );
}

const Child = React.memo(function Child({ onClick }) {
  console.log('Child 렌더링');
  return <button onClick={onClick}>Click me</button>;
});
```

**해결: useCallback**:

```jsx
function Parent() {
  const [count, setCount] = useState(0);
  const [name, setName] = useState('John');

  // ✅ 함수 메모이제이션
  const handleClick = useCallback(() => {
    console.log(name);
  }, [name]);  // name이 변경될 때만 재생성

  return (
    <div>
      <button onClick={() => setCount(count + 1)}>Count: {count}</button>
      <Child onClick={handleClick} />
      {/* count 변경 → handleClick 재사용 → Child 리렌더링 안 함 ✅ */}
    </div>
  );
}
```

### useMemo

**문제 상황**:

```jsx
function ExpensiveComponent({ items }) {
  // ❌ 매번 재계산 (부모가 리렌더링될 때마다)
  const total = items.reduce((sum, item) => sum + item.price, 0);

  return <div>Total: ${total}</div>;
}

function Parent() {
  const [count, setCount] = useState(0);
  const items = [
    { price: 100 },
    { price: 200 },
    { price: 300 }
  ];

  return (
    <div>
      <button onClick={() => setCount(count + 1)}>Count: {count}</button>
      <ExpensiveComponent items={items} />
      {/* count 변경 → total 재계산 (items는 안 변했는데!) ⚠️ */}
    </div>
  );
}
```

**해결: useMemo**:

```jsx
function ExpensiveComponent({ items }) {
  // ✅ 값 메모이제이션
  const total = useMemo(() => {
    console.log('계산 중...');
    return items.reduce((sum, item) => sum + item.price, 0);
  }, [items]);  // items가 변경될 때만 재계산

  return <div>Total: ${total}</div>;
}
```

### useCallback vs useMemo

**동일한 동작**:

```jsx
// useCallback
const memoizedCallback = useCallback(() => {
  doSomething(a, b);
}, [a, b]);

// useMemo로 동일하게 구현
const memoizedCallback = useMemo(() => {
  return () => {
    doSomething(a, b);
  };
}, [a, b]);

// useCallback = useMemo의 함수 특화 버전
```

**비교표**:

| 특징 | useCallback | useMemo |
|------|-------------|---------|
| 반환 | 함수 | 값 |
| 용도 | 함수를 자식에게 전달 | 무거운 계산 결과 캐싱 |
| 예시 | 이벤트 핸들러 | 필터링, 정렬, 계산 |

### 실무 사용 예시

**useCallback 사용**:

```jsx
function SearchComponent() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  // ✅ useCallback으로 검색 함수 메모이제이션
  const handleSearch = useCallback(
    debounce(async (searchQuery) => {
      const data = await fetch(`/api/search?q=${searchQuery}`);
      setResults(data);
    }, 300),
    []
  );

  useEffect(() => {
    if (query) {
      handleSearch(query);
    }
  }, [query, handleSearch]);

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ResultList results={results} />
    </div>
  );
}
```

**useMemo 사용**:

```jsx
function ProductList({ products, filters }) {
  // ✅ useMemo로 필터링/정렬 결과 캐싱
  const filteredProducts = useMemo(() => {
    console.log('필터링 중...');
    return products
      .filter(p => p.category === filters.category)
      .filter(p => p.price >= filters.minPrice)
      .sort((a, b) => a.price - b.price);
  }, [products, filters]);

  return (
    <ul>
      {filteredProducts.map(product => (
        <li key={product.id}>{product.name}</li>
      ))}
    </ul>
  );
}
```

### 꼬리 질문: 언제 useCallback/useMemo를 사용해야 하나요?

**사용해야 할 때**:

```jsx
// ✅ 1. React.memo와 함께 사용
const Child = React.memo(function Child({ onClick }) {
  return <button onClick={onClick}>Click</button>;
});

function Parent() {
  const handleClick = useCallback(() => {
    console.log('clicked');
  }, []);

  return <Child onClick={handleClick} />;
}

// ✅ 2. 무거운 계산
const expensiveValue = useMemo(() => {
  let result = 0;
  for (let i = 0; i < 1000000; i++) {
    result += Math.sqrt(i);
  }
  return result;
}, [dependency]);

// ✅ 3. useEffect 의존성 배열
useEffect(() => {
  fetchData(memoizedValue);
}, [memoizedValue]);  // 메모이제이션 안 하면 무한 루프!
```

**사용하지 말아야 할 때**:

```jsx
// ❌ 1. 가벼운 계산
const sum = useMemo(() => a + b, [a, b]);
// → 그냥 계산이 더 빠름

// ❌ 2. 매번 변하는 값
const value = useMemo(() => Math.random(), []);
// → 의미 없음

// ❌ 3. 컴포넌트 최상위
const Component = useMemo(() => <div>Hello</div>, []);
// → 잘못된 사용법
```

---

---

> 📚 **다음 편:** 준비 중입니다.

---

👈 **[이전 편: React 성능 (Part 1: 렌더링 최적화)](/learning/qna/react-performance-qna/)**
