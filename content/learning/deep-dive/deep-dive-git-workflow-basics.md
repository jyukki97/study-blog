---
title: "Git 실무 기본: PR을 안전하게 만드는 커밋/리베이스/리버트"
date: 2025-12-16
draft: false
topic: "Git"
tags: ["Git", "Commit", "Rebase", "Merge", "Revert"]
categories: ["Backend Deep Dive"]
description: "좋은 커밋 단위, rebase/merge 선택, revert/reset 차이까지: 팀 개발에서 사고를 줄이는 Git 루틴"
module: "foundation"
study_order: 25
---

## 이 글에서 얻는 것

- “커밋 = 되돌릴 수 있는 변화 단위”라는 관점으로 PR을 구성할 수 있습니다.
- `merge` vs `rebase`, `revert` vs `reset`을 상황별로 구분하고, **히스토리를 망치지 않는 안전한 선택**을 할 수 있습니다.
- 충돌(conflict) 해결을 두려워하지 않게, 최소한의 루틴(자주/작게/명확하게)이 생깁니다.

## 0) Git에서 제일 중요한 건 ‘되돌릴 수 있음’이다

실무에서 Git은 “코드 저장”이 아니라 **변경 관리 도구**입니다.

- 작은 단위로 바꾸고(작은 PR)
- 리뷰로 확인하고(품질/공유)
- 문제가 나면 빠르게 되돌린다(rollback)

커밋을 잘 쪼개면, “원인 찾기/되돌리기”가 쉬워집니다.

## 1) 좋은 커밋 단위(Atomic commit)

좋은 커밋의 기준:

- 하나의 의도만 담는다(리팩터링과 기능 변경을 섞지 않기)
- 테스트가 통과하는 상태를 유지한다(가능하면)
- 커밋 메시지가 “무엇/왜”를 설명한다

권장 커밋 메시지(예시):

- `fix: handle null userId in order lookup`
- `refactor: extract OrderValidator`
- `docs: add rollback steps for migration`

## 2) 브랜치/PR 흐름(가장 무난한 형태)

대부분의 팀에서 무난한 흐름:

1) `main`(또는 `master`)는 항상 배포 가능한 상태  
2) 작업은 feature 브랜치에서 한다  
3) PR로 리뷰 후 merge한다  

팁:

- PR은 작을수록 리뷰가 잘 되고, 충돌도 줄어듭니다.
- “코드는 배포됐지만 기능은 꺼진 상태”(피처 플래그)는 큰 변경을 안전하게 쪼개는 데 유용합니다.

## 3) merge vs rebase: 무엇을 선택할까

### 3-1) `merge`(히스토리 보존)

- 장점: 실제 합쳐진 흐름이 보인다(브랜치 히스토리 유지)
- 단점: merge commit이 늘어나면 로그가 복잡해질 수 있음

### 3-2) `rebase`(히스토리 정리)

- 장점: 깔끔한 선형 히스토리(리뷰/추적이 편함)
- 단점: “히스토리 재작성”이므로 공유된 브랜치에서 함부로 하면 위험

실무 결론:

- **PR 전에는** `rebase`로 정리해도 좋다(아직 공유되지 않은 브랜치라면)
- **PR 후에는** `main`의 히스토리는 보존하는 편이 안전하다(팀 정책에 따름)

## 4) revert vs reset: 사고를 줄이는 핵심

### 4-1) `git revert`(안전한 되돌리기)

`revert`는 “되돌리는 커밋을 추가”합니다.

- 장점: 공유된 브랜치에서도 안전(히스토리 유지)
- 운영에서 문제가 났을 때 가장 자주 쓰는 방식

### 4-2) `git reset`(히스토리 재작성)

`reset`은 커밋 자체를 되돌립니다.

- `--soft`: 커밋만 되돌리고 스테이지 유지
- `--mixed`: 커밋+스테이지 되돌리고 워킹 디렉토리 유지(기본)
- `--hard`: 전부 되돌림(로컬에서만 신중히)

실무 원칙:

- 공유된 브랜치(`main`, 이미 push된 브랜치)에서는 `reset --hard`를 거의 쓰지 않습니다.
- “되돌리기”는 기본적으로 `revert`가 안전합니다.

## 5) 자주 쓰는 실무 커맨드(필수만)

- 변경 확인: `git status`, `git diff`, `git log --oneline --graph`
- 임시 저장: `git stash -u` / `git stash pop`
- 특정 커밋만 가져오기: `git cherry-pick <sha>`
- 커밋 정리(로컬): `git rebase -i HEAD~N`(squash, reorder)

## 6) 충돌(conflict) 대응 루틴

충돌은 “실패”가 아니라, 동시에 같은 줄을 건드린 자연스러운 결과입니다.

- 자주 `main`을 당겨서 충돌을 작게 만든다(충돌이 작아야 해결이 쉽다)
- 충돌 해결 후 테스트를 돌린다(충돌 해결은 버그를 만들기 쉬움)
- 의미가 불명확하면 “누가 무엇을 의도했는지” 커뮤니케이션한다

## 연습(추천)

- 의도적으로 같은 파일의 같은 줄을 두 브랜치에서 수정하고 충돌을 만들어, `merge`와 `rebase`에서 해결 흐름이 어떻게 다른지 체험해보기
- `revert`로 되돌리는 PR을 직접 만들어보고(새 커밋이 생김), 운영에서 왜 이 방식이 안전한지 정리해보기
- 작은 작업을 3개의 atomic commit으로 쪼개고, `rebase -i`로 squash/reword 하며 “좋은 히스토리”를 만들어보기
