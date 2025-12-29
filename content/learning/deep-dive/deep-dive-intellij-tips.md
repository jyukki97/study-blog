---
title: "IntelliJ IDEA 필수 단축키 및 디버깅 활용"
date: 2025-12-29
draft: false
topic: "DevOps"
tags: ["IntelliJ", "Debugging", "Productivity"]
categories: ["Backend Deep Dive"]
description: "개발 생산성을 2배로 올려주는 IntelliJ 단축키와 디버깅 기능 정복하기"
module: "foundation"
study_order: 13
quizzes:
  - question: "IntelliJ에서 파일, 클래스, 액션, 설정 등 모든 것을 검색할 수 있는 만능 단축키는?"
    options:
      - "Ctrl + F"
      - "Shift + Shift (Double Shift)"
      - "Cmd + O"
      - "Alt + F7"
    answer: 1
    explanation: "Shift 키를 두 번 연타하면 'Search Everywhere' 창이 열려 무엇이든 찾을 수 있습니다."

  - question: "메서드의 리턴 타입이나 복잡한 수식의 결과를 자동으로 변수로 추출해주는 단축키는?"
    options:
      - "Cmd + C"
      - "Cmd + Option + V (Refactor -> Extract Variable)"
      - "Ctrl + Space"
      - "Shift + F6"
    answer: 1
    explanation: "Extract Variable 기능을 쓰면 타입을 직접 치지 않고도 변수를 선언할 수 있어 매우 편리합니다."

  - question: "디버깅 모드에서 브레이크포인트에 멈췄을 때, 현재 컨텍스트에서 임의의 코드를 실행하거나 값을 확인해보는 기능은?"
    options:
      - "Evaluate Expression"
      - "Run to Cursor"
      - "Step Over"
      - "Resume Program"
    answer: 0
    explanation: "Evaluate Expression 창을 띄워 현재 스냅샷 상태에서 변수 값을 조작하거나 메서드를 호출해볼 수 있습니다."

  - question: "특정 반복문에서 'i가 100일 때'만 멈추고 싶습니다. 이때 사용하는 기능은?"
    options:
      - "Mute Breakpoints"
      - "Conditional Breakpoint"
      - "Method Breakpoint"
      - "Field Watchpoint"
    answer: 1
    explanation: "브레이크포인트에 우클릭하여 조건을(Condition) 입력하면 해당 조건이 참일 때만 실행이 중단됩니다."

  - question: "현재 커서가 위치한 변수나 클래스의 이름을 안전하게 변경(Rename)하는 단축키는?"
    options:
      - "Delete"
      - "Shift + F6"
      - "Ctrl + C"
      - "Cmd + R"
    answer: 1
    explanation: "Shift + F6 (Rename)을 사용하면 참조된 모든 곳의 이름이 안전하게 함께 변경됩니다."
---

## 이 글에서 얻는 것

- 마우스를 쓰지 않고 코드를 작성/수정하는 **키보드 중심 워크플로우**를 익힙니다.
- `System.out.println` 대신 **디버거의 강력한 기능(Evaluate, Condition)**을 활용해 문제 해결 속도를 높입니다.
- 단순한 에디터를 넘어 **IDE가 대신 해주는 일(리팩토링, 코드 생성)**을 적극적으로 활용하게 됩니다.

## 1. 검색은 생산성의 시작 (Navigation)

개발 시간의 70%는 코드를 읽고 찾는 데 쓰입니다. 검색만 빨라져도 퇴근 시간이 빨라집니다.

### 1-1) Shift + Shift (Search Everywhere)
가장 강력한 단축키입니다. 파일명, 클래스명, 액션(기능), 설정까지 모든 것을 찾습니다.
- "Git"이라고 치면 Git 관련 메뉴가 나오고, "Theme"라고 치면 테마 설정이 나옵니다.
- 단축키가 기억나지 않을 때 액션 이름으로 검색해서 실행할 수 있습니다. (예: `Reformat Code`)

### 1-2) 최근 파일 열기 (Cmd + E / Ctrl + E)
방금 닫은 파일이나 직전에 작업하던 파일로 돌아갈 때 탭을 클릭하지 마세요.
- `Cmd + E`를 누르면 최근 열었던 파일 목록이 팝업으로 뜹니다.
- 엔터만 치면 바로 이동합니다.

### 1-3) 선언부로 이동 / 사용처 찾기
- **Cmd + B (Ctrl + B)**: 해당 클래스나 메서드의 정의(Declaration)로 이동하거나, 사용되는 곳(Usages)을 보여줍니다.
- **Cmd + Shift + F (Ctrl + Shift + F)**: 프로젝트 전체(Global)에서 문자열을 검색합니다.

## 2. 코딩 속도 2배 올리기 (Edit & Refactor)

코드를 직접 타이핑하는 것을 최소화하세요.

### 2-1) 변수 추출 (Extract Variable)
매번 `String name = person.getName();` 처럼 타입을 치지 마세요.
- `person.getName()` 뒤에서 **Cmd + Option + V (Ctrl + Alt + V)**를 누르면, `String variableName = ...` 코드를 자동으로 완성해줍니다.

### 2-2) 안전한 이름 변경 (Rename)
변수나 메서드 이름을 바꿀 때, 단순 텍스트 치환을 하면 큰일 납니다.
- **Shift + F6**을 누르면 해당 변수가 사용된 모든 곳을 찾아 안전하게 이름을 변경해줍니다.

### 2-3) 퀵 픽스 (Quick Fix)
코드가 빨간 줄이 뜨거나 노란색 경고가 뜰 때, 고민하지 말고 **Opt + Enter (Alt + Enter)**를 누르세요.
- 임포트 추가, 예외 처리(try-catch), 인터페이스 메서드 구현 등 IDE가 해결책을 제안하고 대신 코드를 짜줍니다.

## 3. 디버깅: 로그 찍지 말고 멈추세요

`System.out.println`은 빌드하고 재시작하는 시간이 듭니다. 디버거는 런타임에 즉시 확인 가능합니다.

### 3-1) Breakpoint & Resume
- 줄 번호 옆(Gutter)을 클릭하면 빨간 점(Breakpoint)이 생깁니다.
- 디버그 모드로 실행하면 여기서 멈춥니다.
- **F8 (Step Over)**: 한 줄씩 실행
- **F7 (Step Into)**: 메서드 내부로 진입
- **F9 (Resume)**: 다음 브레이크포인트까지 진행

### 3-2) Evaluate Expression (Opt + F8 / Alt + F8)
가장 사기적인 기능입니다. 프로그램이 멈춘 상태에서, **현재 메모리에 있는 변수들을 조합해 코드를 실행**해볼 수 있습니다.
- "이 리스트에 이 값이 들어있나?" -> `list.contains("value")`를 그 자리에서 실행해 확인 가능.
- DB를 조회하거나 데이터를 조작해보는 것도 가능합니다.

### 3-3) Conditional Breakpoint
반복문이 10,000번 도는데, 특정 상황(예: id=5000)에서만 멈추고 싶다면?
- 브레이크포인트를 우클릭하고 Condition에 `id == 5000`이라고 입력하세요.
- 조건이 `true`일 때만 멈춥니다. 로그 홍수에 빠지지 않을 수 있습니다.

## 4. 추천 플러그인 (Best Plugins)

- **Key Promoter X**: 마우스로 버튼을 누르면, "이건 단축키 이거야"라고 끈질기게 알려줍니다. 단축키 습관화에 최고입니다.
- **Rainbow Brackets**: 괄호 `(( ))` 짝을 색깔별로 맞춰줘서 가독성을 높여줍니다.
- **String Manipulation**: 문자열 변환(CamelCase <-> snake_case, 인코딩/디코딩 등)을 쉽게 해줍니다.

---
**Tip**: 처음부터 다 외우려 하지 말고, "검색(Shift+Shift)"과 "퀵 픽스(Opt+Enter)" 두 개만이라도 손에 익혀보세요. 그것만으로도 충분히 빨라집니다.
