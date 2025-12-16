---
title: "React 성능 최적화 정리"
date: 2025-01-23
topic: "Frontend"
topic_icon: "💬"
topic_description: "React 성능 최적화, Virtual DOM, memo, useCallback 관련 핵심 개념과 실전 예제 정리"
tags: ["React", "Performance", "Virtual DOM", "Hooks"]
categories: ["Frontend"]
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

## Q4. 리스트 렌더링 최적화 방법은?

### 답변

**대량의 리스트를 효율적으로 렌더링**하는 방법입니다.

### 1. key 올바르게 사용하기

**❌ 잘못된 key 사용**:

```jsx
// Anti-pattern 1: index를 key로 사용
{items.map((item, index) => (
  <li key={index}>{item.name}</li>
))}

// 문제: 순서가 바뀌면 리렌더링 발생
// Before: [A, B, C]
// After:  [C, A, B]  (C를 맨 앞으로 이동)
// → React는 모든 항목이 변경된 것으로 판단! ⚠️

// Anti-pattern 2: random을 key로 사용
{items.map((item) => (
  <li key={Math.random()}>{item.name}</li>
))}
// → 매번 새 key 생성 → 전체 리렌더링! ⚠️
```

**✅ 올바른 key 사용**:

```jsx
// ✅ 고유 ID를 key로 사용
{items.map((item) => (
  <li key={item.id}>{item.name}</li>
))}

// 순서가 바뀌어도 React가 정확히 추적 ✅
// Before: [A(id:1), B(id:2), C(id:3)]
// After:  [C(id:3), A(id:1), B(id:2)]
// → C만 이동, A와 B는 재사용
```

### 2. Virtualization (가상 스크롤)

**문제**: 10,000개 항목 렌더링 → 느림

```jsx
// ❌ 10,000개 DOM 노드 생성 (느림)
function List({ items }) {
  return (
    <ul>
      {items.map(item => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  );
}
// → 초기 렌더링: 3초
// → 스크롤: 버벅임
```

**해결: react-window 사용**:

```jsx
// ✅ 화면에 보이는 항목만 렌더링 (빠름)
import { FixedSizeList } from 'react-window';

function VirtualList({ items }) {
  const Row = ({ index, style }) => (
    <div style={style}>
      {items[index].name}
    </div>
  );

  return (
    <FixedSizeList
      height={600}        // 리스트 높이
      itemCount={items.length}  // 전체 항목 수: 10,000개
      itemSize={50}       // 항목 높이: 50px
      width="100%"
    >
      {Row}
    </FixedSizeList>
  );
}

// 동작:
// 화면에 보이는 항목만 렌더링 (약 12개)
// 스크롤 시 동적으로 렌더링/제거
// → 초기 렌더링: 0.1초 (30배 빠름!)
```

**성능 비교**:

| 항목 수 | 일반 렌더링 | Virtualization |
|---------|-------------|----------------|
| 100개 | 50ms | 20ms |
| 1,000개 | 500ms | 30ms |
| 10,000개 | 3000ms | 40ms |

### 3. Lazy Loading (지연 로딩)

**문제**: 모든 이미지를 한 번에 로드 → 느림

```jsx
// ❌ 100개 이미지를 한 번에 로드
{products.map(product => (
  <div key={product.id}>
    <img src={product.imageUrl} alt={product.name} />
  </div>
))}
// → 네트워크 요청 100개
// → 초기 로딩: 10초
```

**해결: Intersection Observer**:

```jsx
// ✅ 화면에 보일 때만 이미지 로드
function LazyImage({ src, alt }) {
  const [imageSrc, setImageSrc] = useState(null);
  const imgRef = useRef();

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setImageSrc(src);
          observer.disconnect();
        }
      },
      { rootMargin: '50px' }  // 50px 전에 미리 로드
    );

    observer.observe(imgRef.current);

    return () => observer.disconnect();
  }, [src]);

  return (
    <img
      ref={imgRef}
      src={imageSrc || 'placeholder.png'}
      alt={alt}
    />
  );
}

// 동작:
// 1. 처음에는 placeholder 표시
// 2. 화면에 50px 가까워지면 실제 이미지 로드
// 3. 로드 완료 후 이미지 표시
```

### 4. Pagination (페이지네이션)

```jsx
function ProductList() {
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState([]);
  const itemsPerPage = 20;

  useEffect(() => {
    fetchProducts(page, itemsPerPage).then(setProducts);
  }, [page]);

  return (
    <div>
      <ul>
        {products.map(product => (
          <li key={product.id}>{product.name}</li>
        ))}
      </ul>

      <button onClick={() => setPage(page - 1)} disabled={page === 1}>
        Previous
      </button>
      <button onClick={() => setPage(page + 1)}>
        Next
      </button>
    </div>
  );
}

// → 한 번에 20개만 렌더링
// → 메모리 효율적
```

### 꼬리 질문: Infinite Scroll vs Pagination?

**Infinite Scroll**:

```jsx
function InfiniteList() {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const loaderRef = useRef();

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore) {
          setPage(prev => prev + 1);
        }
      }
    );

    observer.observe(loaderRef.current);
    return () => observer.disconnect();
  }, [hasMore]);

  useEffect(() => {
    fetchItems(page).then(newItems => {
      setItems(prev => [...prev, ...newItems]);
      setHasMore(newItems.length > 0);
    });
  }, [page]);

  return (
    <div>
      {items.map(item => <div key={item.id}>{item.name}</div>)}
      <div ref={loaderRef}>Loading...</div>
    </div>
  );
}
```

**비교**:

| 특징 | Infinite Scroll | Pagination |
|------|-----------------|------------|
| UX | 부드러운 스크롤 | 명확한 경계 |
| 성능 | 메모리 증가 | 일정한 메모리 |
| SEO | 어려움 | 쉬움 |
| 적합 | SNS, 피드 | 검색 결과, 카탈로그 |

---

## Q5. 실무에서 React 성능 최적화 경험은?

### 답변

**프로젝트: 대용량 상품 목록 최적화**

### 문제 상황

```jsx
// Before: 10,000개 상품 렌더링
function ProductList() {
  const [products, setProducts] = useState([]);
  const [filters, setFilters] = useState({});

  // ❌ 문제점들
  // 1. 10,000개 DOM 노드 생성 (3초 소요)
  // 2. 필터 변경 시 전체 리렌더링
  // 3. 모든 이미지 한 번에 로드

  return (
    <div>
      <FilterPanel onFilterChange={setFilters} />
      <ul>
        {products.map(product => (
          <ProductItem
            key={product.id}
            product={product}
            onAddToCart={handleAddToCart}  // 매번 새 함수!
          />
        ))}
      </ul>
    </div>
  );
}
```

**성능 지표 (Before)**:
- 초기 렌더링: 3초
- 필터 변경: 1.5초
- 메모리 사용: 500MB

### 최적화 적용

**1. Virtualization (react-window)**:

```jsx
import { FixedSizeList } from 'react-window';

function ProductList() {
  const [products, setProducts] = useState([]);
  const filteredProducts = useFilteredProducts(products, filters);

  const Row = ({ index, style }) => (
    <div style={style}>
      <ProductItem product={filteredProducts[index]} />
    </div>
  );

  return (
    <FixedSizeList
      height={800}
      itemCount={filteredProducts.length}
      itemSize={120}
      width="100%"
    >
      {Row}
    </FixedSizeList>
  );
}

// 결과: 10,000개 → 화면에 보이는 7개만 렌더링
```

**2. useMemo로 필터링 최적화**:

```jsx
function useFilteredProducts(products, filters) {
  return useMemo(() => {
    console.log('필터링 중...');
    return products
      .filter(p => !filters.category || p.category === filters.category)
      .filter(p => p.price >= (filters.minPrice || 0))
      .filter(p => p.price <= (filters.maxPrice || Infinity))
      .sort((a, b) => {
        if (filters.sortBy === 'price') return a.price - b.price;
        if (filters.sortBy === 'name') return a.name.localeCompare(b.name);
        return 0;
      });
  }, [products, filters]);
  // → filters 변경 시에만 재계산
}
```

**3. React.memo + useCallback**:

```jsx
// ProductItem 메모이제이션
const ProductItem = React.memo(function ProductItem({ product, onAddToCart }) {
  return (
    <div>
      <h3>{product.name}</h3>
      <p>${product.price}</p>
      <button onClick={() => onAddToCart(product.id)}>Add to Cart</button>
    </div>
  );
});

// 부모 컴포넌트
function ProductList() {
  const handleAddToCart = useCallback((productId) => {
    // 장바구니에 추가
    addToCart(productId);
  }, []);

  return (
    <FixedSizeList>
      {({ index, style }) => (
        <div style={style}>
          <ProductItem
            product={products[index]}
            onAddToCart={handleAddToCart}  // 재사용됨!
          />
        </div>
      )}
    </FixedSizeList>
  );
}
```

**4. 이미지 Lazy Loading**:

```jsx
function ProductImage({ src, alt }) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef();

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setLoaded(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' }
    );

    observer.observe(imgRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <img
      ref={imgRef}
      src={loaded ? src : 'data:image/svg+xml,...'}  // Placeholder
      alt={alt}
      loading="lazy"
    />
  );
}
```

### 최적화 결과

| 항목 | Before | After | 개선율 |
|------|--------|-------|--------|
| 초기 렌더링 | 3초 | 0.2초 | 93% 감소 |
| 필터 변경 | 1.5초 | 0.1초 | 93% 감소 |
| 메모리 사용 | 500MB | 50MB | 90% 감소 |
| 렌더링 DOM 노드 | 10,000개 | 7개 | 99% 감소 |

---

## 요약

### Virtual DOM
- **동작 원리**: 실제 DOM의 가벼운 복사본으로 Diffing 후 변경사항만 적용
- **Reconciliation**: O(n³) → O(n) 최적화
- **key**: 리스트 렌더링 시 고유한 key 사용 필수

### React.memo
- **용도**: 컴포넌트 메모이제이션으로 불필요한 리렌더링 방지
- **얕은 비교**: 기본적으로 props를 얕게 비교
- **Custom Comparison**: 깊은 비교가 필요하면 비교 함수 제공

### useCallback vs useMemo
- **useCallback**: 함수 메모이제이션 (이벤트 핸들러)
- **useMemo**: 값 메모이제이션 (무거운 계산 결과)
- **사용 시점**: React.memo와 함께, useEffect 의존성, 무거운 계산

### 리스트 최적화
- **key**: 고유 ID 사용 (index, random 금지)
- **Virtualization**: react-window로 대량 리스트 최적화
- **Lazy Loading**: Intersection Observer로 지연 로딩
- **Pagination**: 페이지 단위로 데이터 로드
