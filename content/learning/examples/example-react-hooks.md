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
---

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

## 학습 메모

- useState는 초기값을 함수로 전달할 수 있음 (lazy initialization)
- useEffect의 cleanup 함수는 컴포넌트 언마운트 시 실행됨
- 의존성 배열을 잘 관리해야 무한 루프를 방지할 수 있음
