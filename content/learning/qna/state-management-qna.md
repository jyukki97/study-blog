---
title: "상태 관리 (Part 1: Redux 기초)"
study_order: 719
date: 2025-12-01
topic: "Frontend"
topic_icon: "💬"
topic_description: "Redux, Zustand, Context API 비교 및 상태관리 패턴 관련 핵심 개념과 실전 예제 정리"
tags: ["React", "Redux", "Zustand", "Context API", "State Management"]
categories: ["Frontend"]
draft: false
module: "qna"
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


---

👉 **[다음 편: 상태 관리 (Part 2: Redux Toolkit, 실무 패턴)](/learning/qna/state-management-qna-part2/)**
