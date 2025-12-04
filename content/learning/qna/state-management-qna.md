---
title: "상태관리 비교 정리"
date: 2025-01-28
topic: "Frontend"
topic_icon: "💬"
topic_description: "Redux, Zustand, Context API 비교 및 상태관리 패턴 관련 핵심 개념과 실전 예제 정리"
tags: ["React", "Redux", "Zustand", "Context API", "State Management"]
categories: ["Frontend"]
draft: true
---

# 상태관리 비교 정리

## Q1. Redux와 Context API의 차이는 무엇인가요?

### 답변

**Redux**와 **Context API**는 모두 전역 상태 관리를 위한 도구이지만, **철학과 복잡도가 다릅니다**.

### Context API

**Context API**: React 내장 기능으로 **간단한 전역 상태 공유**

```jsx
// ✅ Context API (간단)
import { createContext, useContext, useState } from 'react';

// 1. Context 생성
const ThemeContext = createContext();

// 2. Provider 컴포넌트
function ThemeProvider({ children }) {
  const [theme, setTheme] = useState('light');

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// 3. 사용
function Button() {
  const { theme, setTheme } = useContext(ThemeContext);

  return (
    <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
      Current theme: {theme}
    </button>
  );
}

// 4. App
function App() {
  return (
    <ThemeProvider>
      <Button />
    </ThemeProvider>
  );
}
```

**장점**:
- 간단하고 직관적
- 추가 라이브러리 불필요
- 작은 앱에 적합

**단점**:
- 성능 최적화 어려움
- DevTools 없음
- 미들웨어 없음

### Redux

**Redux**: **예측 가능한 상태 관리**를 위한 라이브러리

```jsx
// Redux (복잡하지만 강력)
import { createStore } from 'redux';
import { Provider, useSelector, useDispatch } from 'react-redux';

// 1. Action Types
const SET_THEME = 'SET_THEME';

// 2. Action Creators
const setTheme = (theme) => ({ type: SET_THEME, payload: theme });

// 3. Reducer
const initialState = { theme: 'light' };

function themeReducer(state = initialState, action) {
  switch (action.type) {
    case SET_THEME:
      return { ...state, theme: action.payload };
    default:
      return state;
  }
}

// 4. Store
const store = createStore(themeReducer);

// 5. 사용
function Button() {
  const theme = useSelector(state => state.theme);
  const dispatch = useDispatch();

  return (
    <button onClick={() => dispatch(setTheme(theme === 'light' ? 'dark' : 'light'))}>
      Current theme: {theme}
    </button>
  );
}

// 6. App
function App() {
  return (
    <Provider store={store}>
      <Button />
    </Provider>
  );
}
```

**장점**:
- 예측 가능한 상태 변경
- Redux DevTools (시간 여행 디버깅)
- 미들웨어 (redux-thunk, redux-saga)
- 대규모 앱에 적합

**단점**:
- 보일러플레이트 코드 많음
- 학습 곡선 높음
- 단순한 기능에는 과함

### 비교표

| 특징 | Context API | Redux |
|------|-------------|-------|
| 설치 | 내장 | 외부 라이브러리 |
| 보일러플레이트 | 적음 | 많음 |
| DevTools | 없음 | Redux DevTools |
| 미들웨어 | 없음 | redux-thunk, saga |
| 성능 최적화 | 어려움 | Selector 최적화 |
| 학습 곡선 | 낮음 | 높음 |
| 적합한 규모 | 소규모 | 대규모 |

### 꼬리 질문 1: Context API의 성능 문제는?

**문제**: Context 값이 변경되면 **모든 Consumer가 리렌더링**됩니다.

```jsx
// ❌ 성능 문제
const AppContext = createContext();

function AppProvider({ children }) {
  const [user, setUser] = useState({ name: 'John' });
  const [theme, setTheme] = useState('light');

  return (
    <AppContext.Provider value={{ user, setUser, theme, setTheme }}>
      {children}
    </AppContext.Provider>
  );
}

// Theme만 사용하는 컴포넌트
function ThemeButton() {
  const { theme, setTheme } = useContext(AppContext);

  console.log('ThemeButton 렌더링');
  return <button onClick={() => setTheme('dark')}>{theme}</button>;
}

// User만 사용하는 컴포넌트
function UserProfile() {
  const { user } = useContext(AppContext);

  console.log('UserProfile 렌더링');
  return <div>{user.name}</div>;
}

// 문제:
// user 변경 → ThemeButton도 리렌더링! ⚠️
// theme 변경 → UserProfile도 리렌더링! ⚠️
```

**해결 1: Context 분리**:

```jsx
// ✅ Context 분리
const UserContext = createContext();
const ThemeContext = createContext();

function AppProvider({ children }) {
  const [user, setUser] = useState({ name: 'John' });
  const [theme, setTheme] = useState('light');

  return (
    <UserContext.Provider value={{ user, setUser }}>
      <ThemeContext.Provider value={{ theme, setTheme }}>
        {children}
      </ThemeContext.Provider>
    </UserContext.Provider>
  );
}

// Theme만 사용
function ThemeButton() {
  const { theme, setTheme } = useContext(ThemeContext);
  // user 변경 시 리렌더링 안 됨! ✅
}

// User만 사용
function UserProfile() {
  const { user } = useContext(UserContext);
  // theme 변경 시 리렌더링 안 됨! ✅
}
```

**해결 2: useMemo로 value 최적화**:

```jsx
// ✅ useMemo로 최적화
function AppProvider({ children }) {
  const [user, setUser] = useState({ name: 'John' });
  const [theme, setTheme] = useState('light');

  const userValue = useMemo(() => ({ user, setUser }), [user]);
  const themeValue = useMemo(() => ({ theme, setTheme }), [theme]);

  return (
    <UserContext.Provider value={userValue}>
      <ThemeContext.Provider value={themeValue}>
        {children}
      </ThemeContext.Provider>
    </UserContext.Provider>
  );
}
```

### 꼬리 질문 2: Redux의 단방향 데이터 플로우란?

**Redux의 데이터 플로우**:

```
┌─────────────────────────────────────────┐
│                                         │
│  Action                                 │
│  { type: 'INCREMENT', payload: 1 }     │
│         ↓                               │
│  Dispatch                               │
│  dispatch(action)                       │
│         ↓                               │
│  Middleware (optional)                  │
│  redux-thunk, redux-saga                │
│         ↓                               │
│  Reducer                                │
│  (state, action) => newState            │
│         ↓                               │
│  Store                                  │
│  { count: 1 }                           │
│         ↓                               │
│  Component (re-render)                  │
│  useSelector(state => state.count)      │
│                                         │
└─────────────────────────────────────────┘
```

**예시**:

```jsx
// 1. Action 발생
dispatch({ type: 'INCREMENT', payload: 1 });

// 2. Reducer 실행
function counterReducer(state = { count: 0 }, action) {
  switch (action.type) {
    case 'INCREMENT':
      return { ...state, count: state.count + action.payload };
    default:
      return state;
  }
}

// 3. Store 업데이트
// Before: { count: 0 }
// After:  { count: 1 }

// 4. Component 리렌더링
function Counter() {
  const count = useSelector(state => state.count);
  return <div>{count}</div>;  // 1로 업데이트됨
}
```

---

## Q2. Redux Toolkit은 무엇이고, 왜 사용하나요?

### 답변

**Redux Toolkit (RTK)**은 **Redux의 공식 추천 도구**로, 보일러플레이트를 대폭 줄입니다.

### 기존 Redux의 문제점

```jsx
// ❌ 기존 Redux (보일러플레이트 많음)

// 1. Action Types (상수 정의)
const INCREMENT = 'counter/INCREMENT';
const DECREMENT = 'counter/DECREMENT';

// 2. Action Creators
const increment = (amount) => ({ type: INCREMENT, payload: amount });
const decrement = (amount) => ({ type: DECREMENT, payload: amount });

// 3. Reducer
const initialState = { count: 0 };

function counterReducer(state = initialState, action) {
  switch (action.type) {
    case INCREMENT:
      return { ...state, count: state.count + action.payload };
    case DECREMENT:
      return { ...state, count: state.count - action.payload };
    default:
      return state;
  }
}

// 4. Store
const store = createStore(counterReducer);
```

### Redux Toolkit 사용

```jsx
// ✅ Redux Toolkit (간결)
import { createSlice, configureStore } from '@reduxjs/toolkit';

// 1. Slice 생성 (Action + Reducer 자동 생성)
const counterSlice = createSlice({
  name: 'counter',
  initialState: { count: 0 },
  reducers: {
    increment: (state, action) => {
      state.count += action.payload;  // Immer로 불변성 자동 처리
    },
    decrement: (state, action) => {
      state.count -= action.payload;
    }
  }
});

// 2. Action Creators 자동 생성
export const { increment, decrement } = counterSlice.actions;

// 3. Store
export const store = configureStore({
  reducer: {
    counter: counterSlice.reducer
  }
});

// 4. 사용
function Counter() {
  const count = useSelector(state => state.counter.count);
  const dispatch = useDispatch();

  return (
    <div>
      <button onClick={() => dispatch(increment(1))}>+</button>
      <span>{count}</span>
      <button onClick={() => dispatch(decrement(1))}>-</button>
    </div>
  );
}
```

**코드 비교**:

| 기존 Redux | Redux Toolkit |
|-----------|---------------|
| 50줄 | 20줄 |
| Action Types 수동 정의 | 자동 생성 |
| Immutable 업데이트 수동 | Immer로 자동 |
| 여러 파일 필요 | 1개 파일 |

### Redux Toolkit의 주요 기능

**1. createSlice (Slice 생성)**:

```jsx
const todoSlice = createSlice({
  name: 'todos',
  initialState: [],
  reducers: {
    addTodo: (state, action) => {
      state.push({  // Immer 덕분에 push 사용 가능!
        id: Date.now(),
        text: action.payload,
        completed: false
      });
    },
    toggleTodo: (state, action) => {
      const todo = state.find(t => t.id === action.payload);
      if (todo) {
        todo.completed = !todo.completed;  // 직접 수정 가능!
      }
    },
    removeTodo: (state, action) => {
      return state.filter(t => t.id !== action.payload);
    }
  }
});
```

**2. createAsyncThunk (비동기 처리)**:

```jsx
// ✅ 비동기 액션 생성
import { createAsyncThunk } from '@reduxjs/toolkit';

const fetchUsers = createAsyncThunk(
  'users/fetch',
  async () => {
    const response = await fetch('/api/users');
    return response.json();
  }
);

const userSlice = createSlice({
  name: 'users',
  initialState: {
    data: [],
    loading: false,
    error: null
  },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchUsers.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchUsers.fulfilled, (state, action) => {
        state.loading = false;
        state.data = action.payload;
      })
      .addCase(fetchUsers.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message;
      });
  }
});

// 사용
dispatch(fetchUsers());
```

**3. configureStore (Store 설정)**:

```jsx
import { configureStore } from '@reduxjs/toolkit';

const store = configureStore({
  reducer: {
    counter: counterSlice.reducer,
    todos: todoSlice.reducer,
    users: userSlice.reducer
  },
  // DevTools 자동 활성화
  // Redux Thunk 자동 포함
  // Immutability 체크 자동 포함
});
```

### 꼬리 질문: Immer는 어떻게 동작하나요?

**Immer**: 불변성을 유지하면서 **"변경하는 것처럼"** 코드 작성 가능

```jsx
// ❌ 기존 Redux (불변성 수동 유지)
function todoReducer(state, action) {
  switch (action.type) {
    case 'ADD_TODO':
      return [...state, action.payload];  // 새 배열 생성

    case 'UPDATE_TODO':
      return state.map(todo =>
        todo.id === action.payload.id
          ? { ...todo, ...action.payload }  // 새 객체 생성
          : todo
      );

    case 'REMOVE_TODO':
      return state.filter(todo => todo.id !== action.payload);
  }
}

// ✅ Redux Toolkit (Immer 사용)
const todoSlice = createSlice({
  name: 'todos',
  initialState: [],
  reducers: {
    addTodo: (state, action) => {
      state.push(action.payload);  // 직접 push! (내부적으로 불변성 유지)
    },
    updateTodo: (state, action) => {
      const todo = state.find(t => t.id === action.payload.id);
      Object.assign(todo, action.payload);  // 직접 수정!
    },
    removeTodo: (state, action) => {
      const index = state.findIndex(t => t.id === action.payload);
      state.splice(index, 1);  // 직접 splice!
    }
  }
});
```

**Immer 동작 원리**:

```
1. Proxy 객체 생성 (Draft State)
2. 변경사항 기록
3. 변경사항 기반으로 새 객체 생성
4. 원본 유지 (불변성 보장)
```

---

## Q3. Zustand는 무엇이고, Redux와의 차이는?

### 답변

**Zustand**는 **초경량 상태 관리 라이브러리**로, Redux보다 훨씬 간단합니다.

### Zustand 기본 사용법

```jsx
// ✅ Zustand (매우 간단)
import create from 'zustand';

// 1. Store 생성
const useStore = create((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
  decrement: () => set((state) => ({ count: state.count - 1 })),
  reset: () => set({ count: 0 })
}));

// 2. 사용 (Provider 불필요!)
function Counter() {
  const count = useStore((state) => state.count);
  const increment = useStore((state) => state.increment);
  const decrement = useStore((state) => state.decrement);

  return (
    <div>
      <button onClick={decrement}>-</button>
      <span>{count}</span>
      <button onClick={increment}>+</button>
    </div>
  );
}

// App
function App() {
  return <Counter />;  // Provider 없이 바로 사용!
}
```

### Redux Toolkit vs Zustand 비교

**동일한 기능 구현**:

```jsx
// Redux Toolkit (20줄)
import { createSlice, configureStore } from '@reduxjs/toolkit';
import { Provider, useSelector, useDispatch } from 'react-redux';

const counterSlice = createSlice({
  name: 'counter',
  initialState: { count: 0 },
  reducers: {
    increment: (state) => { state.count += 1; },
    decrement: (state) => { state.count -= 1; }
  }
});

const store = configureStore({ reducer: { counter: counterSlice.reducer } });

function Counter() {
  const count = useSelector(state => state.counter.count);
  const dispatch = useDispatch();
  return (
    <div>
      <button onClick={() => dispatch(counterSlice.actions.decrement())}>-</button>
      <span>{count}</span>
      <button onClick={() => dispatch(counterSlice.actions.increment())}>+</button>
    </div>
  );
}

function App() {
  return <Provider store={store}><Counter /></Provider>;
}

// Zustand (10줄)
import create from 'zustand';

const useStore = create((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
  decrement: () => set((state) => ({ count: state.count - 1 }))
}));

function Counter() {
  const { count, increment, decrement } = useStore();
  return (
    <div>
      <button onClick={decrement}>-</button>
      <span>{count}</span>
      <button onClick={increment}>+</button>
    </div>
  );
}
```

### Zustand 고급 기능

**1. Selector 최적화**:

```jsx
// ❌ 매번 리렌더링
function Component() {
  const store = useStore();  // store 전체 구독
  return <div>{store.count}</div>;
  // store의 어떤 값이든 변경되면 리렌더링!
}

// ✅ 필요한 값만 구독
function Component() {
  const count = useStore((state) => state.count);  // count만 구독
  return <div>{count}</div>;
  // count 변경 시에만 리렌더링!
}
```

**2. 비동기 처리**:

```jsx
const useStore = create((set) => ({
  users: [],
  loading: false,
  error: null,

  fetchUsers: async () => {
    set({ loading: true });
    try {
      const response = await fetch('/api/users');
      const users = await response.json();
      set({ users, loading: false });
    } catch (error) {
      set({ error: error.message, loading: false });
    }
  }
}));

// 사용
function UserList() {
  const { users, loading, fetchUsers } = useStore();

  useEffect(() => {
    fetchUsers();
  }, []);

  if (loading) return <div>Loading...</div>;
  return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}
```

**3. 미들웨어**:

```jsx
import { devtools, persist } from 'zustand/middleware';

// DevTools + LocalStorage
const useStore = create(
  devtools(
    persist(
      (set) => ({
        count: 0,
        increment: () => set((state) => ({ count: state.count + 1 }))
      }),
      { name: 'counter-storage' }  // localStorage key
    )
  )
);

// → Redux DevTools 사용 가능
// → 새로고침해도 상태 유지
```

### 비교표

| 특징 | Redux Toolkit | Zustand |
|------|---------------|---------|
| 번들 크기 | 10KB | 1KB |
| 보일러플레이트 | 중간 | 매우 적음 |
| Provider | 필요 | 불필요 |
| DevTools | 기본 제공 | 미들웨어 |
| 학습 곡선 | 중간 | 낮음 |
| 적합한 규모 | 중~대규모 | 소~중규모 |

### 꼬리 질문: 언제 Redux를, 언제 Zustand를 사용해야 하나요?

**Redux를 선택**:

```
✅ 대규모 앱 (100+ 컴포넌트)
✅ 복잡한 상태 로직
✅ 시간 여행 디버깅 필수
✅ 엄격한 패턴 필요
✅ 팀 규모가 큼

예시:
- 전사 ERP 시스템
- 복잡한 대시보드
- 금융 거래 플랫폼
```

**Zustand를 선택**:

```
✅ 중소규모 앱 (< 100 컴포넌트)
✅ 간단한 상태 로직
✅ 빠른 개발 필요
✅ 번들 크기 중요
✅ 작은 팀

예시:
- 스타트업 MVP
- 개인 프로젝트
- 간단한 대시보드
```

---

## Q4. 전역 상태와 로컬 상태는 어떻게 구분하나요?

### 답변

**상태 배치 원칙**: 가능한 한 **로컬 상태**를 우선하고, 필요할 때만 전역 상태 사용

### 로컬 상태 (Local State)

**정의**: 컴포넌트 내부에서만 사용되는 상태

```jsx
// ✅ 로컬 상태 예시
function SearchBox() {
  const [query, setQuery] = useState('');  // 이 컴포넌트에서만 사용

  return (
    <input
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="Search..."
    />
  );
}
```

**사용 시기**:
- UI 상태 (열림/닫힘, 포커스)
- 폼 입력값 (임시)
- 애니메이션 상태
- 다른 컴포넌트와 공유 불필요

### 전역 상태 (Global State)

**정의**: 여러 컴포넌트에서 공유되는 상태

```jsx
// ✅ 전역 상태 예시 (Zustand)
const useStore = create((set) => ({
  user: null,  // 여러 곳에서 사용
  theme: 'light',  // 여러 곳에서 사용
  setUser: (user) => set({ user }),
  setTheme: (theme) => set({ theme })
}));

// Header에서 사용
function Header() {
  const user = useStore((state) => state.user);
  return <div>Welcome, {user?.name}</div>;
}

// Sidebar에서 사용
function Sidebar() {
  const user = useStore((state) => state.user);
  return <div>Role: {user?.role}</div>;
}
```

**사용 시기**:
- 인증 정보 (user, token)
- 테마 설정
- 언어 설정
- 장바구니
- 여러 페이지에서 공유

### 판단 기준

**결정 트리**:

```
이 상태가 다른 컴포넌트에서도 필요한가?
  ↓ Yes
  이 상태가 페이지 이동 후에도 유지되어야 하나?
    ↓ Yes
    → 전역 상태 (Redux, Zustand)
    ↓ No
    → URL 상태 (Query String, Route Params)
  ↓ No
  이 상태가 자식 컴포넌트에 전달되나?
    ↓ Yes
    → 부모 상태 (Prop Drilling) 또는 Composition
    ↓ No
    → 로컬 상태 (useState)
```

### Anti-pattern: 불필요한 전역 상태

```jsx
// ❌ 모달 상태를 전역으로 (불필요)
const useStore = create((set) => ({
  isModalOpen: false,
  setIsModalOpen: (open) => set({ isModalOpen: open })
}));

function MyComponent() {
  const { isModalOpen, setIsModalOpen } = useStore();
  return (
    <div>
      <button onClick={() => setIsModalOpen(true)}>Open Modal</button>
      {isModalOpen && <Modal onClose={() => setIsModalOpen(false)} />}
    </div>
  );
}
// → 다른 컴포넌트에서 사용하지 않으면 로컬 상태로 충분!

// ✅ 로컬 상태로 충분
function MyComponent() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setIsModalOpen(true)}>Open Modal</button>
      {isModalOpen && <Modal onClose={() => setIsModalOpen(false)} />}
    </div>
  );
}
```

### Server State vs Client State

**Server State**: 서버에서 가져온 데이터 (React Query, SWR 사용)

```jsx
// ✅ Server State (React Query)
import { useQuery } from 'react-query';

function UserProfile() {
  const { data: user, isLoading } = useQuery('user', fetchUser);

  if (isLoading) return <div>Loading...</div>;
  return <div>{user.name}</div>;
}
// → 캐싱, 자동 재검증, Optimistic Update 등 자동 처리
```

**Client State**: 클라이언트에서만 관리하는 상태 (Redux, Zustand)

```jsx
// ✅ Client State (Zustand)
const useStore = create((set) => ({
  theme: 'light',
  language: 'en',
  setTheme: (theme) => set({ theme }),
  setLanguage: (language) => set({ language })
}));
```

### 꼬리 질문: Prop Drilling 문제는?

**Prop Drilling**: Props를 여러 레벨로 전달하는 문제

```jsx
// ❌ Prop Drilling (3단계)
function App() {
  const [user, setUser] = useState({ name: 'John' });

  return <Layout user={user} />;
}

function Layout({ user }) {
  return <Sidebar user={user} />;  // 사용하지 않지만 전달
}

function Sidebar({ user }) {
  return <UserProfile user={user} />;  // 사용하지 않지만 전달
}

function UserProfile({ user }) {
  return <div>{user.name}</div>;  // 여기서야 사용
}
```

**해결 1: Context API**:

```jsx
// ✅ Context API
const UserContext = createContext();

function App() {
  const [user, setUser] = useState({ name: 'John' });

  return (
    <UserContext.Provider value={user}>
      <Layout />  {/* user 전달 불필요 */}
    </UserContext.Provider>
  );
}

function UserProfile() {
  const user = useContext(UserContext);  // 직접 접근
  return <div>{user.name}</div>;
}
```

**해결 2: Component Composition**:

```jsx
// ✅ Composition
function App() {
  const [user, setUser] = useState({ name: 'John' });

  return (
    <Layout>
      <Sidebar>
        <UserProfile user={user} />  {/* 직접 전달 */}
      </Sidebar>
    </Layout>
  );
}

function Layout({ children }) {
  return <div className="layout">{children}</div>;
}

function Sidebar({ children }) {
  return <aside>{children}</aside>;
}
```

---

## Q5. 실무에서 상태관리 마이그레이션 경험은?

### 답변

**프로젝트: Redux → Zustand 마이그레이션**

### 마이그레이션 이유

**Before (Redux)**:
- 보일러플레이트 코드 과다 (Action Types, Creators, Reducers)
- 간단한 기능에도 여러 파일 필요
- 팀원들의 Redux 학습 곡선 높음
- 번들 크기 증가 (10KB)

**목표**:
- 코드 단순화 (50% 감소)
- 번들 크기 감소
- 개발 속도 향상

### 마이그레이션 과정

**1. Redux Store 분석**:

```jsx
// Before: Redux (50줄)
// store/userSlice.js
import { createSlice } from '@reduxjs/toolkit';

const userSlice = createSlice({
  name: 'user',
  initialState: { data: null, loading: false, error: null },
  reducers: {
    setUser: (state, action) => { state.data = action.payload; },
    setLoading: (state, action) => { state.loading = action.payload; },
    setError: (state, action) => { state.error = action.payload; }
  }
});

export const { setUser, setLoading, setError } = userSlice.actions;
export default userSlice.reducer;

// store/themeSlice.js
const themeSlice = createSlice({
  name: 'theme',
  initialState: { current: 'light' },
  reducers: {
    setTheme: (state, action) => { state.current = action.payload; }
  }
});

export const { setTheme } = themeSlice.actions;
export default themeSlice.reducer;

// store/index.js
import { configureStore } from '@reduxjs/toolkit';
import userReducer from './userSlice';
import themeReducer from './themeSlice';

export const store = configureStore({
  reducer: {
    user: userReducer,
    theme: themeReducer
  }
});
```

**2. Zustand로 변환**:

```jsx
// After: Zustand (20줄, 60% 감소)
// store/index.js
import create from 'zustand';
import { devtools, persist } from 'zustand/middleware';

const useStore = create(
  devtools(
    persist(
      (set) => ({
        // User state
        user: null,
        userLoading: false,
        userError: null,
        setUser: (user) => set({ user }),
        setUserLoading: (loading) => set({ userLoading: loading }),
        setUserError: (error) => set({ userError: error }),

        // Theme state
        theme: 'light',
        setTheme: (theme) => set({ theme })
      }),
      { name: 'app-storage' }
    )
  )
);

export default useStore;
```

**3. 컴포넌트 수정**:

```jsx
// Before: Redux (복잡)
import { useSelector, useDispatch } from 'react-redux';
import { setUser } from './store/userSlice';

function UserProfile() {
  const user = useSelector(state => state.user.data);
  const loading = useSelector(state => state.user.loading);
  const dispatch = useDispatch();

  const handleUpdate = (newUser) => {
    dispatch(setUser(newUser));
  };

  if (loading) return <div>Loading...</div>;
  return <div>{user?.name}</div>;
}

// After: Zustand (간단)
import useStore from './store';

function UserProfile() {
  const { user, userLoading, setUser } = useStore();

  const handleUpdate = (newUser) => {
    setUser(newUser);
  };

  if (userLoading) return <div>Loading...</div>;
  return <div>{user?.name}</div>;
}
```

### 마이그레이션 결과

| 항목 | Before (Redux) | After (Zustand) | 개선율 |
|------|----------------|-----------------|--------|
| 총 코드 줄 수 | 250줄 | 120줄 | 52% 감소 |
| Store 파일 수 | 5개 | 1개 | 80% 감소 |
| 번들 크기 | 95KB | 86KB | 9KB 감소 |
| 평균 개발 시간 | 30분 | 10분 | 67% 감소 |

---

## 요약 체크리스트

### Context API vs Redux
- [ ] **Context API**: 간단한 전역 상태, 작은 앱에 적합
- [ ] **Redux**: 예측 가능한 상태 관리, 대규모 앱에 적합
- [ ] **Context 성능**: Context 분리, useMemo로 최적화

### Redux Toolkit
- [ ] **createSlice**: Action + Reducer 자동 생성
- [ ] **Immer**: 불변성 자동 유지 (직접 수정 가능)
- [ ] **createAsyncThunk**: 비동기 처리 간소화

### Zustand
- [ ] **초경량**: 1KB, Provider 불필요
- [ ] **간결함**: 보일러플레이트 최소
- [ ] **Selector**: 필요한 값만 구독하여 최적화

### 상태 배치 원칙
- [ ] **로컬 우선**: 가능한 한 로컬 상태 사용
- [ ] **전역 최소**: 여러 곳에서 공유 시에만 전역 상태
- [ ] **Server State**: React Query, SWR로 분리
