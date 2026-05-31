---
title: "React Hooks 기초"
date: 2025-11-03
draft: false
topic: "React"
topic_icon: "⚛️"
topic_description: "React 라이브러리 학습 노트"
tags: ["React", "Hooks", "Frontend"]
categories: ["Development", "Learning"]
description: "React Hooks의 기본 개념과 사용법 정리"
module: "frontend"
study_order: 705
key_takeaways:
  - "Hook은 함수형 컴포넌트에서 상태, 생명주기, 재사용 로직을 표현하는 규칙이다."
  - "useState는 화면에 반영되는 값, useEffect는 렌더링 이후 외부 세계와 동기화할 작업에 둔다."
  - "의존성 배열은 최적화 옵션이 아니라 effect가 참조하는 값의 계약으로 이해해야 한다."
operator_checklist:
  - "상태로 둘 값과 단순 계산으로 둘 값을 구분했는가?"
  - "effect 안에서 구독, 타이머, 요청을 만들었다면 cleanup 또는 취소 처리가 있는가?"
  - "성능 최적화 전 React DevTools Profiler로 실제 리렌더링 원인을 확인했는가?"
learning_refs:
  - title: "React 성능 Part 1"
    href: "/learning/qna/react-performance-qna/"
    description: "렌더링, memo, Virtual DOM 관점에서 Hook 이후 성능 문제를 점검합니다."
  - title: "React 성능 Part 2"
    href: "/learning/qna/react-performance-qna-part2/"
    description: "useCallback/useMemo를 언제 써야 하는지 심화 기준을 정리합니다."
  - title: "상태 관리 Part 1"
    href: "/learning/qna/state-management-qna/"
    description: "컴포넌트 상태가 전역 상태로 커질 때 Redux, Context API 선택 기준을 연결합니다."
faqs:
  - question: "useEffect는 컴포넌트가 렌더링될 때마다 항상 실행되나요?"
    answer: "의존성 배열을 생략하면 렌더링마다 실행되고, 빈 배열을 주면 마운트 이후 한 번 실행됩니다. 배열에 값을 넣으면 그 값이 바뀐 렌더링 이후에 실행됩니다."
  - question: "useState 값은 바로 바뀌나요?"
    answer: "setState 호출은 다음 렌더링을 예약합니다. 같은 이벤트 안에서 이전 값을 기준으로 갱신해야 한다면 함수형 업데이트를 사용하는 편이 안전합니다."
---

## 이 글에서 얻는 것

- `useState`와 `useEffect`를 “문법”이 아니라 **렌더링 모델**과 연결해서 이해할 수 있습니다.
- effect 의존성 배열, cleanup, 비동기 요청 취소처럼 실무에서 자주 터지는 실수를 미리 점검할 수 있습니다.
- 상태가 커질 때 컴포넌트 내부 상태, Context, 외부 상태 관리 도구 중 어디로 옮길지 판단할 수 있습니다.

## Hook을 배우기 전에 잡아야 할 관점

Hook은 클래스 컴포넌트의 생명주기 메서드를 함수형 컴포넌트로 옮긴 “문법 설탕” 정도로만 보면 자주 헷갈립니다. 더 정확히는 **렌더링마다 함수가 다시 실행되는 환경에서 상태와 외부 동기화를 안전하게 표현하는 규칙**입니다.

React 컴포넌트 함수는 화면을 그리기 위해 여러 번 호출될 수 있습니다. 그래서 일반 변수에 값을 넣어두면 다음 렌더링에서 유지되지 않습니다. 렌더링 사이에 유지되어야 하고, 값이 바뀌면 화면도 다시 그려야 하는 값은 `useState`로 둡니다. 반대로 서버 요청, 타이머, DOM 이벤트 구독, 브라우저 API 호출처럼 React 바깥 세계와 맞춰야 하는 작업은 `useEffect`로 분리합니다.

간단한 기준:

- 화면에 직접 보이거나 렌더링 결과를 바꾸는 값: `useState`
- props/state에서 계산 가능한 값: 일반 변수 또는 `useMemo` 후보
- 외부 시스템과 동기화하는 작업: `useEffect`
- 렌더링과 무관하게 값을 보관해야 하는 경우: `useRef`

## useState 기초

useState는 함수형 컴포넌트에서 상태를 관리할 수 있게 해주는 Hook입니다.

```jsx
import { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>증가</button>
    </div>
  );
}
```

### 함수형 업데이트가 필요한 순간

상태 갱신이 이전 상태를 기준으로 이뤄진다면 `setCount(count + 1)`보다 함수형 업데이트가 더 안전합니다. 이벤트 핸들러 안에서 한 번만 올리는 예제는 둘 다 비슷해 보이지만, 여러 번 연속 갱신하거나 비동기 콜백 안에서 이전 값을 참조할 때 차이가 드러납니다.

```jsx
function Counter() {
  const [count, setCount] = useState(0);

  const increaseTwice = () => {
    setCount(prev => prev + 1);
    setCount(prev => prev + 1);
  };

  return <button onClick={increaseTwice}>{count}</button>;
}
```

`prev => prev + 1` 형태는 React가 큐에 쌓인 상태 갱신을 순서대로 적용할 수 있게 합니다. 특히 “현재 값에서 하나 더하기”, “배열에 항목 추가하기”, “객체의 일부 필드만 바꾸기”처럼 이전 상태가 입력이 되는 경우에는 이 패턴을 기본값으로 두는 편이 좋습니다.

객체 상태를 다룰 때는 기존 값을 직접 수정하지 말고 새 객체를 만들어야 합니다.

```jsx
function ProfileForm() {
  const [profile, setProfile] = useState({ name: '', role: 'frontend' });

  const changeName = event => {
    setProfile(prev => ({
      ...prev,
      name: event.target.value,
    }));
  };

  return <input value={profile.name} onChange={changeName} />;
}
```

여기서 `profile.name = ...`처럼 직접 바꾸면 React가 변경을 안정적으로 감지하기 어렵고, 디버깅도 힘들어집니다. “상태는 교체한다”는 감각을 유지하면 배열/객체 상태에서 생기는 버그가 줄어듭니다.

## useEffect 기초

useEffect는 컴포넌트의 사이드 이펙트를 처리하는 Hook입니다.

```jsx
import { useEffect, useState } from 'react';

function DataFetcher() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/data')
      .then(res => res.json())
      .then(setData);
  }, []); // 빈 배열 = 마운트 시 한 번만 실행

  return <div>{data ? JSON.stringify(data) : 'Loading...'}</div>;
}
```

### cleanup과 요청 취소

실무에서 `useEffect`는 “마운트 시 한 번 실행”보다 **외부 작업을 시작하고 정리하는 경계**로 보는 게 더 유용합니다. 이벤트 리스너, 타이머, 웹소켓, 요청처럼 컴포넌트 생명주기와 연결되는 작업은 정리 함수가 있어야 합니다.

```jsx
import { useEffect, useState } from 'react';

function UserProfile({ userId }) {
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadUser() {
      try {
        const response = await fetch(`/api/users/${userId}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('사용자 정보를 불러오지 못했습니다.');
        }

        setUser(await response.json());
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err.message);
        }
      }
    }

    loadUser();

    return () => controller.abort();
  }, [userId]);

  if (error) return <p>{error}</p>;
  if (!user) return <p>Loading...</p>;
  return <p>{user.name}</p>;
}
```

이 예제에서 `userId`가 바뀌면 이전 요청은 취소되고 새 요청이 시작됩니다. 컴포넌트가 사라진 뒤 늦게 도착한 응답이 `setUser`를 호출하는 상황도 줄일 수 있습니다. 의존성 배열에 `userId`를 넣는 이유는 “이 effect가 userId라는 외부 값을 참조한다”는 계약을 명시하기 위해서입니다.

## 의존성 배열을 다루는 기준

의존성 배열은 “몇 번 실행할지 조절하는 옵션”으로만 보면 빠르게 꼬입니다. effect 안에서 참조하는 props, state, 함수가 있다면 원칙적으로 의존성에 들어가야 합니다. 빠진 값이 있으면 오래된 값을 바라보는 stale closure 문제가 생길 수 있습니다.

자주 쓰는 판단법:

- effect 안에서 읽는 props/state는 의존성 후보입니다.
- 의존성에 함수를 넣어서 매번 effect가 돈다면, 그 함수가 꼭 effect 밖에 있어야 하는지 먼저 봅니다.
- 단순 계산은 effect로 옮기지 말고 렌더링 중 계산합니다.
- 구독/요청/타이머처럼 외부 동기화가 아니라면 effect가 필요 없는 경우가 많습니다.

예를 들어 검색어를 입력할 때마다 필터링된 배열을 만드는 정도라면 `useEffect`와 별도 상태를 둘 필요가 없습니다.

```jsx
function ProductList({ products, keyword }) {
  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(keyword.toLowerCase())
  );

  return (
    <ul>
      {filteredProducts.map(product => (
        <li key={product.id}>{product.name}</li>
      ))}
    </ul>
  );
}
```

이런 계산을 effect로 만들면 상태가 하나 더 생기고, “원본 상태와 파생 상태가 어긋나는 문제”가 생길 수 있습니다. 성능이 실제로 문제가 될 때만 `useMemo`를 검토하면 됩니다.

## 실무 체크리스트

- 상태 이름은 화면의 의미를 드러내는가? (`isOpen`, `selectedUserId`, `filters`처럼)
- 이전 상태 기반 갱신은 함수형 업데이트를 쓰고 있는가?
- 배열/객체 상태를 직접 수정하지 않고 새 값으로 교체하는가?
- effect 안의 비동기 요청, 타이머, 이벤트 구독은 cleanup이 있는가?
- effect 의존성 경고를 끄기 전에 구조를 단순화할 방법을 먼저 봤는가?
- `useMemo`/`useCallback`은 “느낌상 최적화”가 아니라 실제 리렌더링 비용을 확인한 뒤 적용했는가?

## 학습 메모

- useState는 초기값을 함수로 전달할 수 있음 (lazy initialization)
- useEffect의 cleanup 함수는 컴포넌트 언마운트 시 실행됨
- 의존성 배열을 잘 관리해야 무한 루프를 방지할 수 있음
- 상태가 컴포넌트 여러 곳으로 퍼지면 Context 또는 전역 상태 관리가 필요한지 검토
- 렌더링 성능은 Hook 사용 여부보다 상태 위치, props 안정성, 컴포넌트 분리의 영향을 더 크게 받음
