---
title: "상태 관리 (Part 2: Redux Toolkit, 실무 패턴)"
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

---

> 📚 **다음 편:** 준비 중입니다.

---

👈 **[이전 편: 상태 관리 (Part 1: Redux 기초)](/learning/qna/state-management-qna/)**
