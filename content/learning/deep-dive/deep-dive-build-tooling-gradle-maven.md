---
title: "빌드 기본: Gradle/Maven 의존성과 멀티모듈 감각"
date: 2025-12-16
draft: false
topic: "Build"
tags: ["Gradle", "Maven", "Dependencies", "Multi-module", "Build"]
categories: ["Backend Deep Dive"]
description: "의존성 해석/버전 충돌, 빌드·테스트 파이프라인, 멀티모듈 분리의 기준을 잡는 글"
module: "foundation"
study_order: 12
quizzes:
  - question: "Maven/Gradle을 사용하는 가장 핵심적인 이유는 무엇인가요?"
    options:
      - "코드를 컴파일하기 위해서"
      - "복잡한 의존성 그래프와 전이 의존성을 자동으로 관리하기 위해서"
      - "IDE를 실행하기 위해서"
      - "자바를 설치하기 위해서"
    answer: 1
    explanation: "빌드 도구의 핵심 가치는 수많은 라이브러리 간의 의존 관계(그래프)를 해결해주는 것입니다."

  - question: "라이브러리 A가 B를 사용하고, B가 C를 사용할 때, 내 프로젝트에 자동으로 C가 포함되는 현상을 무엇이라 하나요?"
    options:
      - "직접 의존성 (Direct Dependency)"
      - "전이 의존성 (Transitive Dependency)"
      - "순환 의존성 (Circular Dependency)"
      - "선택적 의존성 (Optional Dependency)"
    answer: 1
    explanation: "전이 의존성 덕분에 필요한 라이브러리가 의존하는 다른 라이브러리들까지 자동으로 가져올 수 있습니다."

  - question: "Gradle에서 의존성 충돌이나 트리를 확인하기 위해 사용하는 명령어는?"
    options:
      - "./gradlew build"
      - "./gradlew dependencies"
      - "./gradlew clean"
      - "./gradlew test"
    answer: 1
    explanation: "dependencies 태스크를 실행하면 프로젝트의 의존성 트리를 계층적으로 볼 수 있습니다."

  - question: "자바 런타임에서 'NoSuchMethodError'나 'ClassNotFoundException'이 발생하는 가장 흔한 원인은?"
    options:
      - "디스크 용량 부족"
      - "의존성 버전 충돌 (Dependency Conflict)"
      - "네트워크 연결 끊김"
      - "자바 문법 오류"
    answer: 1
    explanation: "서로 다른 라이브러리가 같은 클래스의 다른 버전을 요구할 때, 런타임에 예상치 못한 버전이 로드되어 발생합니다."

  - question: "Spring Boot에서 여러 의존성의 버전을 하나하나 명시하지 않아도 서로 호환되는 버전으로 맞춰주는 기능(개념)은?"
    options:
      - "BOM (Bill of Materials)"
      - "DOM (Document Object Model)"
      - "DTO (Data Transfer Object)"
      - "ORM (Object Relational Mapping)"
    answer: 0
    explanation: "BOM을 사용하면 프로젝트 전체에서 사용하는 라이브러리들의 버전을 중앙에서 일관되게 관리할 수 있습니다."

  - question: "CI(지속적 통합) 서버에서 빌드할 때 '재현 가능한 빌드'를 위해 중요한 것은?"
    options:
      - "로컬에 있는 라이브러리를 그대로 복사해서 쓴다."
      - "항상 최신 버전(latest)을 다운로드 받는다."
      - "의존성 버전과 실행 환경(JDK)을 고정한다."
      - "빌드 캐시를 절대 사용하지 않는다."
    answer: 2
    explanation: "어디서 언제 빌드하든 같은 결과가 나오려면 환경과 의존성 버전이 명확히 고정되어야 합니다."

  - question: "멀티모듈 프로젝트 도입을 고려해야 하는 신호로 적절하지 않은 것은?"
    options:
      - "빌드 시간이 너무 길어져서 병렬 빌드가 필요할 때"
      - "코드가 적지만 그냥 멋있어 보일 때"
      - "특정 도메인/기능 간의 의존성 방향을 강제하고 싶을 때"
      - "공통 코드를 여러 서비스에서 명확히 분리해 쓰고 싶을 때"
    answer: 1
    explanation: "멀티모듈은 복잡도를 수반하므로, 명확한 문제 해결 목적(빌드 속도, 격리 등) 없이 도입하면 오버엔지니어링이 될 수 있습니다."

  - question: "테스트 환경에서만 필요한 라이브러리(예: JUnit)를 런타임 배포에 포함시키지 않기 위해 사용하는 Scope/Configuration은?"
    options:
      - "implementation"
      - "api"
      - "testImplementation"
      - "runtimeOnly"
    answer: 2
    explanation: "testImplementation으로 선언된 의존성은 테스트 컴파일/실행 시에만 사용되며 실 배포물에는 제외됩니다."
---

## 이 글에서 얻는 것

- Gradle/Maven을 “명령어만 치는 도구”가 아니라, **의존성 그래프를 관리하는 시스템**으로 이해합니다.
- 버전 충돌(전이 의존성)과 ‘왜 저 라이브러리가 들어왔지?’ 문제를 추적하는 기본 루틴이 생깁니다.
- 멀티모듈 분리를 언제 해야 하는지, 그리고 분리했을 때 무엇이 좋아지고 무엇이 어려워지는지 감각을 잡습니다.

## 0) 빌드 도구를 알아야 하는 이유(백엔드 실무)

실무에서 자주 만나는 문제:

- “어제는 되던 빌드가 오늘 깨졌다”(의존성/캐시/환경)
- “취약점 패치하려고 올렸더니 다른 게 깨졌다”(전이 의존성 충돌)
- “테스트는 통과하는데 배포에서만 실패한다”(프로파일/리소스/환경 차이)

이런 문제는 코드보다 “빌드/의존성/환경”에서 터지는 경우가 많습니다.

## 1) 의존성 그래프: 직접 의존성과 전이 의존성

대부분의 문제는 전이 의존성에서 시작합니다.

- 내가 추가한 건 A 하나인데,
- A가 B/C/D를 끌고 오고,
- 그중 하나가 기존 버전과 충돌합니다.

그래서 빌드 도구를 쓸 때의 기본 습관은:

- “최종적으로 어떤 버전이 선택됐는지”를 확인하고,
- “왜 그 버전이 선택됐는지”를 설명할 수 있어야 합니다.

## 2) 버전 충돌을 추적하는 기본 커맨드

Gradle(자주 쓰는 것):

- `./gradlew dependencies`
- `./gradlew dependencyInsight --dependency <name> --configuration runtimeClasspath`

Maven(자주 쓰는 것):

- `mvn dependency:tree -Dincludes=<groupId>:<artifactId>`

팁:

- 문제가 런타임에서만 터지면 `runtimeClasspath`(또는 runtime scope)를 보세요.
- 테스트에서만 터지면 test scope 의존성도 확인해야 합니다.

## 3) BOM/Dependency Management: 버전은 ‘중앙에서’ 관리하는 편이 안전하다

버전이 여기저기 흩어지면 결국 꼬입니다.

- Spring Boot는 BOM을 통해 권장 버전을 정해줍니다.
- 조직/프로젝트도 “의존성 버전 정책”을 한 곳에 모으는 편이 운영이 쉽습니다.

실무 감각:

- “각 모듈이 각자 버전을 들고 있는 구조”는 시간이 갈수록 충돌과 취약점 대응 비용이 급증합니다.

## 4) 재현 가능한 빌드: CI가 기준이다

로컬에서만 되는 빌드는 결국 사고로 이어집니다.

- JDK 버전 고정(예: toolchain)
- 의존성 고정(락파일/버전 정책)
- 캐시가 깨져도 다시 만들 수 있어야 함(클린 빌드가 돌아야 함)

## 5) 멀티모듈: “코드가 커질 때”가 아니라 “경계를 강제해야 할 때”

멀티모듈이 유리해지는 신호:

- 빌드/테스트 시간이 너무 길어졌다
- 모듈 간 순환 의존이 자주 생긴다(구조로 막고 싶다)
- 팀이 커져서 같은 코드에서 충돌이 잦다
- 도메인/기능 경계를 강제하고 싶다(캡슐화)

하지만 대가도 있습니다.

- 설정/빌드 복잡도 증가
- 공통 코드 분리/의존성 방향 관리 필요

“무조건 멀티모듈”이 아니라, 문제를 해결하는 수단으로 도입하는 편이 좋습니다.

## 6) 운영에서 자주 터지는 포인트

- 의존성 충돌: 런타임에 `NoSuchMethodError`, `ClassNotFoundException`
- 리소스/프로파일: 로컬과 서버의 설정 로딩 차이
- 테스트 격리: 테스트가 서로 상태를 공유해 flaky해짐
- CI 캐시: 캐시가 오염돼 “깨졌다/됐다” 반복(캐시 키/무효화 전략 필요)

## 연습(추천)

- 프로젝트에서 임의로 버전 충돌을 만들어보고(의존성 2개가 같은 라이브러리를 다른 버전으로 요구), `dependencyInsight`/`dependency:tree`로 원인을 찾아 해결해보기
- “빌드는 되는데 런타임 에러”를 가정하고, runtimeClasspath 기준으로 의존성을 점검하는 루틴을 만들어보기
- 작은 모듈을 하나 분리해 멀티모듈로 바꿔보고, 빌드 속도/의존성 규칙이 어떻게 달라지는지 비교해보기
