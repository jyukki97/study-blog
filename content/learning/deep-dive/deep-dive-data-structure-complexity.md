---
title: "자료구조 복잡도 한눈에 보기"
date: 2025-12-16
draft: false
topic: "Algorithm"
tags: ["자료구조", "시간복잡도", "공간복잡도", "빅오"]
categories: ["Backend Deep Dive"]
description: "주요 자료구조의 삽입/삭제/탐색 시간복잡도와 사용 시 주의점 정리"
module: "foundation"
study_order: 30
---

## 복잡도 표

| 자료구조 | 접근 | 탐색 | 삽입 | 삭제 | 비고 |
| --- | --- | --- | --- | --- | --- |
| Array | O(1) | O(n) | O(n) | O(n) | 랜덤 접근 빠름 |
| ArrayList | O(1) | O(n) | O(n) | O(n) | 끝 삽입 amortized O(1) |
| LinkedList | O(n) | O(n) | O(1) | O(1) | 양 끝/노드 기준 삽입·삭제 |
| Stack/Queue | O(1) | O(n) | O(1) | O(1) | |
| HashMap | O(1) | O(1) | O(1) | O(1) | 해시 충돌 시 최악 O(n) |
| TreeMap | O(log n) | O(log n) | O(log n) | O(log n) | 정렬 유지 |
| Heap | O(1) | O(n) | O(log n) | O(log n) | 우선순위 큐 |
| Union-Find | - | α(n) | α(n) | α(n) | 거의 O(1), path compression |
| Graph (Adj List) | - | O(V+E) | O(1) | O(1) | BFS/DFS: O(V+E) |

## 사용 가이드

- 순서/정렬이 중요하면 TreeMap/TreeSet, 없으면 HashMap/HashSet
- Top K/스케줄링 → Heap, 실시간 우선순위 작업
- 동적 연결/집합 병합 → Union-Find (path compression + union by rank)
- 큰 입력에서 메모리 예산 확인: Adj Matrix는 O(V^2)

## 실습 아이디어

- [ ] HashMap과 TreeMap으로 1M건 삽입/조회 성능 비교
- [ ] PriorityQueue로 Top K 문제 구현 후 힙 크기 변화 관찰
- [ ] Union-Find로 친구네트워크/섬의 개수 문제 풀이
