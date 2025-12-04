---
title: "학습 노트 작성 가이드"
date: 2025-11-03
draft: true
---

# Learning 섹션 사용 가이드

이 가이드는 학습 노트를 작성하는 방법을 설명합니다.

## 📝 학습 노트 작성하기

### 1. 새 파일 생성

`content/learning/` 디렉토리에 새 마크다운 파일을 생성합니다.

```bash
# 예시
content/learning/react-hooks-basic.md
content/learning/spring-ioc-container.md
content/learning/mysql-index-optimization.md
```

### 2. Front Matter 작성

파일 상단에 다음과 같은 메타데이터를 추가합니다:

```yaml
---
title: "학습 노트 제목"
date: 2025-11-03
draft: false                    # true: 비공개, false: 공개
topic: "React"                  # 주제 (필수) - 같은 주제끼리 묶임
topic_icon: "⚛️"               # 주제 아이콘 (선택)
topic_description: "React 학습" # 주제 설명 (선택, 첫 포스트에만)
tags: ["React", "Hooks"]        # 태그 (선택)
categories: ["Development", "Learning"]
description: "짧은 요약 설명"
---
```

### 3. 주요 필드 설명

#### `topic` (필수)
- **역할**: 학습 노트를 주제별로 묶는 핵심 필드
- **예시**: "React", "Spring", "Database", "Algorithm" 등
- **팁**:
  - 대소문자를 일관되게 사용하세요
  - 같은 주제는 정확히 같은 이름으로 작성 (예: "react" ❌, "React" ✅)

#### `topic_icon` (선택)
- **역할**: 주제 카드에 표시될 이모지
- **예시**: "⚛️", "🍃", "🗄️", "🧮" 등
- **팁**: 같은 주제의 첫 번째 포스트에만 설정하면 됩니다

#### `topic_description` (선택)
- **역할**: 주제 카드에 표시될 설명
- **예시**: "React 라이브러리 학습 노트"
- **팁**: 같은 주제의 첫 번째 포스트에만 설정하면 됩니다

## 🎨 주제별 아이콘 추천

```
⚛️ React
🍃 Spring / Java
🗄️ Database / MySQL / PostgreSQL
🐍 Python
📊 Data Structure / Algorithm
🌐 Network / HTTP
🔐 Security
🎨 CSS / Design
📱 Mobile
🐳 Docker / DevOps
☁️ Cloud / AWS
```

## 📂 주제 예시

### Frontend
- React
- Vue
- JavaScript
- TypeScript
- CSS

### Backend
- Spring
- Node.js
- Database
- API Design

### Computer Science
- Algorithm
- Data Structure
- Operating System
- Network

### DevOps
- Docker
- Kubernetes
- CI/CD
- AWS

## ✍️ 작성 팁

1. **제목은 구체적으로**
   - ❌ "React 공부"
   - ✅ "React Hooks - useState와 useEffect 이해하기"

2. **코드 예시 포함**
   - 학습한 내용을 코드로 표현하면 이해가 쉬움
   - 주석으로 핵심 포인트 강조

3. **학습 메모 섹션 활용**
   - 나중에 다시 볼 때 유용한 핵심 포인트만 정리
   - 실수했던 부분, 헷갈렸던 개념 기록

4. **정기적으로 작성**
   - 매일 조금씩 작성하는 것이 나중에 몰아서 쓰는 것보다 좋음
   - TIL(Today I Learned) 형식으로 가볍게 시작

## 🔍 확인하기

작성한 학습 노트는:
1. `/learning` 페이지에서 주제별 카드로 표시됩니다
2. 주제 카드를 클릭하면 해당 주제의 모든 노트를 볼 수 있습니다
3. 최근 학습 노트 섹션에 최신순으로 표시됩니다

## 📌 예시 파일

`content/learning/` 디렉토리의 `example-*.md` 파일들을 참고하세요!

- `example-react-hooks.md` - React 주제 예시
- `example-spring-ioc.md` - Spring 주제 예시

---

궁금한 점이 있다면 기존 포스트를 참고하거나 직접 실험해보세요! 🚀
