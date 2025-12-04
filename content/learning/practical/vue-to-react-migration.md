---
title: "Vue.js → React 전환기"
date: 2025-11-03
topic: "Frontend"
topic_icon: "⚛️"
topic_description: "Frontend 개발 및 UI 라이브러리"
tags: ["React", "Vue", "Migration", "Frontend", "Hooks"]
categories: ["Development", "Learning"]
description: "상태관리, 공통 훅 구조화, NCUI 컴포넌트 통합, 렌더링 최적화"
draft: true
---

> **학습 목표**: Vue.js에서 React로의 마이그레이션 과정에서 마주한 패러다임 차이를 이해하고, React의 효율적인 상태관리 및 최적화 패턴을 학습한다.

## 🔄 왜 Vue → React인가?

### 전환 배경

회사 내부 디자인 시스템이 React 기반(NCUI)으로 전환되면서, Vue로 개발된 관리 콘솔도 React로 재작성하게 되었습니다.

| 기존 (Vue 2.x) | 전환 후 (React 18) |
|----------------|-------------------|
| Options API | Hooks + Functional Components |
| Vuex | Zustand + React Query |
| Vue Router | React Router v6 |
| 자체 컴포넌트 | NCUI Design System |

---

## 🧩 개념적 차이

### 1. 반응성 시스템

#### Vue: 자동 반응성

```vue
<template>
  <div>
    <p>{{ count }}</p>
    <button @click="increment">+</button>
  </div>
</template>

<script>
export default {
  data() {
    return {
      count: 0
    }
  },
  methods: {
    increment() {
      this.count++  // 자동으로 UI 업데이트!
    }
  }
}
</script>
```

#### React: 명시적 상태 관리

```jsx
import { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);

  const increment = () => {
    setCount(count + 1);  // setState 호출 필수!
  };

  return (
    <div>
      <p>{count}</p>
      <button onClick={increment}>+</button>
    </div>
  );
}
```

**핵심 차이**:
- Vue: `this.count++` 만으로 반응
- React: `setState` 호출 필요 (불변성 유지)

---

### 2. 컴포넌트 라이프사이클

#### Vue Lifecycle

```javascript
export default {
  created() {
    // 컴포넌트 생성 직후
    console.log('Component created');
  },
  mounted() {
    // DOM 마운트 후
    console.log('Component mounted');
  },
  beforeDestroy() {
    // 파괴 직전
    console.log('Component will unmount');
  }
}
```

#### React Hooks Lifecycle

```javascript
import { useEffect } from 'react';

function MyComponent() {
  // componentDidMount + componentDidUpdate
  useEffect(() => {
    console.log('Component mounted or updated');

    // componentWillUnmount
    return () => {
      console.log('Component will unmount');
    };
  }, []);  // 빈 배열 = mounted/unmounted만

  return <div>My Component</div>;
}
```

**변환 가이드**:
| Vue | React Hooks |
|-----|-------------|
| `created()` | `useEffect(..., [])` |
| `mounted()` | `useEffect(..., [])` |
| `beforeDestroy()` | `useEffect`의 cleanup function |
| `watch` | `useEffect(..., [dep])` |
| `computed` | `useMemo` |

---

## 🎯 상태관리 전환

### Vuex → Zustand

#### Vuex (기존)

```javascript
// store/user.js
export default {
  state: {
    user: null,
    isAuthenticated: false,
  },
  mutations: {
    SET_USER(state, user) {
      state.user = user;
      state.isAuthenticated = true;
    },
  },
  actions: {
    async login({ commit }, credentials) {
      const user = await api.login(credentials);
      commit('SET_USER', user);
    },
  },
  getters: {
    userName: (state) => state.user?.name,
  },
};
```

```vue
<!-- Component.vue -->
<template>
  <div>{{ userName }}</div>
</template>

<script>
import { mapGetters, mapActions } from 'vuex';

export default {
  computed: {
    ...mapGetters(['userName']),
  },
  methods: {
    ...mapActions(['login']),
  },
};
</script>
```

#### Zustand (전환 후)

```javascript
// store/useUserStore.js
import { create } from 'zustand';

export const useUserStore = create((set, get) => ({
  user: null,
  isAuthenticated: false,

  login: async (credentials) => {
    const user = await api.login(credentials);
    set({ user, isAuthenticated: true });
  },

  logout: () => {
    set({ user: null, isAuthenticated: false });
  },

  // Computed value (getter)
  userName: () => get().user?.name,
}));
```

```jsx
// Component.jsx
import { useUserStore } from '@/store/useUserStore';

function UserProfile() {
  const user = useUserStore((state) => state.user);
  const login = useUserStore((state) => state.login);

  return (
    <div>
      <p>{user?.name}</p>
      <button onClick={() => login(credentials)}>Login</button>
    </div>
  );
}
```

**Zustand 선택 이유**:
- ✅ Boilerplate 최소 (mutations, actions 불필요)
- ✅ DevTools 지원
- ✅ TypeScript 친화적
- ✅ 번들 크기 작음 (1KB)

---

### Server State: React Query

**기존 Vue 방식** (Vuex에 API 응답 저장):

```javascript
// ❌ Anti-pattern: 서버 데이터를 전역 상태로
actions: {
  async fetchProducts({ commit }) {
    const products = await api.getProducts();
    commit('SET_PRODUCTS', products);
  }
}
```

**React Query 방식**:

```jsx
import { useQuery } from '@tanstack/react-query';

function ProductList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['products'],
    queryFn: () => api.getProducts(),
    staleTime: 5 * 60 * 1000,  // 5분간 fresh
  });

  if (isLoading) return <Spinner />;
  if (error) return <Error message={error.message} />;

  return (
    <div>
      {data.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
```

**장점**:
- ✅ 자동 캐싱
- ✅ 백그라운드 refetch
- ✅ Loading/Error 상태 자동 관리
- ✅ Optimistic Updates

---

## 🔧 공통 Hooks 구조화

### Custom Hooks 패턴

#### useAsync (데이터 fetching)

```javascript
// hooks/useAsync.js
import { useState, useEffect } from 'react';

export function useAsync(asyncFn, dependencies = []) {
  const [state, setState] = useState({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let isMounted = true;

    setState({ data: null, loading: true, error: null });

    asyncFn()
      .then((data) => {
        if (isMounted) {
          setState({ data, loading: false, error: null });
        }
      })
      .catch((error) => {
        if (isMounted) {
          setState({ data: null, loading: false, error });
        }
      });

    return () => {
      isMounted = false;  // cleanup
    };
  }, dependencies);

  return state;
}

// 사용 예시
function UserProfile({ userId }) {
  const { data: user, loading, error } = useAsync(
    () => api.getUser(userId),
    [userId]
  );

  if (loading) return <Spinner />;
  if (error) return <Error />;

  return <div>{user.name}</div>;
}
```

#### useDebounce (검색 최적화)

```javascript
// hooks/useDebounce.js
import { useState, useEffect } from 'react';

export function useDebounce(value, delay = 500) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// 사용 예시
function SearchInput() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);

  const { data } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () => api.search(debouncedQuery),
    enabled: debouncedQuery.length > 0,
  });

  return (
    <input
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="Search..."
    />
  );
}
```

#### useLocalStorage (상태 영속화)

```javascript
// hooks/useLocalStorage.js
import { useState, useEffect } from 'react';

export function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : initialValue;
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}

// 사용 예시
function Settings() {
  const [theme, setTheme] = useLocalStorage('theme', 'light');

  return (
    <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
      Toggle Theme ({theme})
    </button>
  );
}
```

---

## 🎨 NCUI 디자인 시스템 통합

### 컴포넌트 래핑 전략

기존 Vue 컴포넌트를 NCUI 컴포넌트로 교체:

```jsx
// 기존 (자체 Button)
<MyButton
  type="primary"
  @click="handleClick"
>
  Click Me
</MyButton>

// 전환 (NCUI Button)
import { Button } from '@ncsoft/ncui';

<Button
  variant="primary"
  onClick={handleClick}
>
  Click Me
</Button>
```

### Theme Provider 통합

```jsx
// App.jsx
import { ThemeProvider } from '@ncsoft/ncui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme="light">
        <Router>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/users" element={<UserList />} />
          </Routes>
        </Router>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
```

---

## ⚡ 렌더링 최적화

### 1. React.memo (컴포넌트 memoization)

```jsx
// ❌ 매번 리렌더링
function UserCard({ user }) {
  console.log('UserCard rendered');
  return <div>{user.name}</div>;
}

// ✅ props 변경 시에만 리렌더링
const UserCard = React.memo(function UserCard({ user }) {
  console.log('UserCard rendered');
  return <div>{user.name}</div>;
});
```

### 2. useMemo (값 memoization)

```jsx
function ExpensiveComputation({ items }) {
  // ❌ 매 렌더링마다 계산
  const total = items.reduce((sum, item) => sum + item.price, 0);

  // ✅ items 변경 시에만 재계산
  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.price, 0),
    [items]
  );

  return <div>Total: ${total}</div>;
}
```

### 3. useCallback (함수 memoization)

```jsx
function ParentComponent() {
  const [count, setCount] = useState(0);

  // ❌ 매 렌더링마다 새 함수 생성
  const handleClick = () => {
    console.log('Clicked');
  };

  // ✅ 함수 재사용
  const handleClick = useCallback(() => {
    console.log('Clicked');
  }, []);

  return <ChildComponent onClick={handleClick} />;
}
```

### 4. Code Splitting (lazy loading)

```jsx
import { lazy, Suspense } from 'react';

// ❌ 모든 컴포넌트를 초기 번들에 포함
import Dashboard from './Dashboard';
import UserList from './UserList';

// ✅ 필요할 때만 로드
const Dashboard = lazy(() => import('./Dashboard'));
const UserList = lazy(() => import('./UserList'));

function App() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/users" element={<UserList />} />
      </Routes>
    </Suspense>
  );
}
```

---

## 🚨 마이그레이션 중 발견한 문제들

### 문제 1: 무한 리렌더링

**원인**:
```jsx
function BadComponent() {
  const [count, setCount] = useState(0);

  // ❌ useEffect 의존성 배열 없음
  useEffect(() => {
    setCount(count + 1);  // 무한 루프!
  });

  return <div>{count}</div>;
}
```

**해결**:
```jsx
function GoodComponent() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    // 특정 조건에서만 실행
    if (count < 10) {
      setCount(count + 1);
    }
  }, [count]);  // 의존성 명시

  return <div>{count}</div>;
}
```

### 문제 2: 클로저 문제 (Stale Closure)

**원인**:
```jsx
function Timer() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setCount(count + 1);  // ❌ 항상 초기 count 값 (0) 참조
    }, 1000);

    return () => clearInterval(id);
  }, []);  // 빈 배열 → 클로저 생성

  return <div>{count}</div>;
}
```

**해결**:
```jsx
function Timer() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setCount((prevCount) => prevCount + 1);  // ✅ 함수형 업데이트
    }, 1000);

    return () => clearInterval(id);
  }, []);

  return <div>{count}</div>;
}
```

### 문제 3: 불필요한 API 호출

**원인**:
```jsx
function UserProfile({ userId }) {
  const [user, setUser] = useState(null);

  // ❌ userId 변경 시마다 호출
  useEffect(() => {
    api.getUser(userId).then(setUser);
  }, [userId]);

  // ...
}
```

**해결** (React Query 사용):
```jsx
function UserProfile({ userId }) {
  const { data: user } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => api.getUser(userId),
    staleTime: 5 * 60 * 1000,  // 5분간 캐시
  });

  // ...
}
```

---

## 📊 마이그레이션 성과

### Before (Vue 2.x)

| 지표 | 값 |
|------|-----|
| 초기 번들 크기 | 850KB |
| 초기 로딩 시간 (3G) | 4.2s |
| Lighthouse 점수 | 68/100 |
| 리렌더링 최적화 | 미흡 |

### After (React 18)

| 지표 | 값 | 개선율 |
|------|-----|---------|
| 초기 번들 크기 | 420KB | **-50%** |
| 초기 로딩 시간 (3G) | 2.1s | **-50%** |
| Lighthouse 점수 | 92/100 | **+35%** |
| 리렌더링 최적화 | useMemo/useCallback 적용 | ✅ |

**주요 개선 사항**:
- Code Splitting으로 번들 크기 감소
- React Query로 불필요한 API 호출 제거
- React.memo로 리렌더링 최소화

---

## 💡 배운 교훈

### 1. 불변성이 중요하다

Vue는 반응성 시스템이 변경을 감지하지만, React는 불변성 유지 필수:

```jsx
// ❌ 직접 수정
const newState = state;
newState.count++;
setState(newState);

// ✅ 새 객체 생성
setState({ ...state, count: state.count + 1 });
```

### 2. useEffect는 신중하게

- 의존성 배열 필수
- cleanup 함수 작성
- 무한 루프 방지

### 3. 상태 관리 분리

- Client State: Zustand
- Server State: React Query
- UI State: useState

---

## 📋 학습 체크리스트

- [ ] Vue와 React의 반응성 차이 이해
- [ ] React Hooks 주요 5개 사용 가능 (useState, useEffect, useMemo, useCallback, useRef)
- [ ] Custom Hooks 작성 가능
- [ ] React Query로 서버 상태 관리
- [ ] 렌더링 최적화 기법 3가지 이상 적용

---

## 🔗 참고 자료

- [React Official Docs](https://react.dev/)
- [Zustand Documentation](https://docs.pmnd.rs/zustand)
- [TanStack Query](https://tanstack.com/query/latest)

---

> **다음 학습**: JPA와 MyBatis 병행 전략 - ORM과 Native SQL 혼용 기준
