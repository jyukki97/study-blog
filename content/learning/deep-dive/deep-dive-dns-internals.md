---
title: "DNS 내부: 주소창에 google.com을 치면?"
date: 2025-12-28
draft: false
topic: "Network"
tags: ["DNS", "Network", "Infra", "GSLB"]
categories: ["Backend Deep Dive"]
description: "단순해 보이는 도메인 이름 풀이(Resolution) 과정에 숨겨진 재귀적 질의, 캐싱 전략, 그리고 GSLB의 원리를 다룹니다."
module: "security"
study_order: 802
quizzes:
  - question: "DNS의 Recursive Lookup에서 Local DNS 서버가 거치는 순서는?"
    options:
      - "Client → Authoritative → TLD → Root"
      - "Root Server → TLD Server → Authoritative Server 순으로 질의"
      - "캐시만 확인"
      - "바로 IP를 반환"
    answer: 1
    explanation: "Local DNS는 Root에게 '.com 관리자 위치'를 물어보고, TLD에게 'naver.com 관리자'를, 최종적으로 Authoritative에게 실제 IP를 물어봅니다."

  - question: "DNS 캐싱에서 TTL(Time To Live)의 역할은?"
    options:
      - "서버를 종료하는 시간"
      - "DNS 응답을 캐시에 저장하는 기간을 지정하여, 매번 재귀 질의를 하지 않도록 함"
      - "네트워크 지연 시간"
      - "도메인 만료 기간"
    answer: 1
    explanation: "TTL이 300초면 5분 동안 캐시된 결과를 사용합니다. TTL이 길면 DNS 변경 후 반영이 느리고, 짧으면 DNS 서버 부하가 증가합니다."

  - question: "GSLB(Global Server Load Balancing)가 DNS를 활용하는 방식은?"
    options:
      - "모든 사용자에게 같은 IP를 반환"
      - "사용자의 위치(IP)를 보고 가장 가까운 서버의 IP를 반환하여 지연을 최소화"
      - "랜덤 IP를 반환"
      - "가장 바쁜 서버 IP를 반환"
    answer: 1
    explanation: "한국 사용자에게는 한국 서버 IP, 미국 사용자에게는 미국 서버 IP를 반환하여 지연(latency)을 줄입니다."

  - question: "배포 후 DNS 반영이 느린 경우 원인으로 가장 가능성이 높은 것은?"
    options:
      - "서버가 느려서"
      - "기존 DNS 레코드의 TTL이 길어서 클라이언트/ISP가 캐시된 이전 IP를 계속 사용"
      - "도메인이 만료됨"
      - "방화벽 문제"
    answer: 1
    explanation: "TTL이 86400초(1일)라면 변경 후 하루 동안 이전 IP로 접속하는 사용자가 있을 수 있습니다. 배포 전 TTL을 낮추는 것이 좋습니다."

  - question: "'dig' 명령어로 DNS 문제를 진단할 때 '+trace' 옵션의 용도는?"
    options:
      - "네트워크 속도 측정"
      - "Root부터 Authoritative까지 전체 질의 경로를 추적하여 어디서 막히는지 확인"
      - "TTL 연장"
      - "캐시 삭제"
    answer: 1
    explanation: "`dig +trace example.com`은 재귀 질의의 전체 경로를 보여줍니다. 특정 단계에서 응답이 없으면 그 서버에 문제가 있는 것입니다."
---

## 🌍 1. 인터넷의 전화번호부

우리는 `223.130.195.200`을 외울 수 없습니다. 그래서 `naver.com`을 씁니다.
이 변환 과정을 담당하는 시스템이 **DNS (Domain Name System)**입니다.

단순해 보이지만, 전 세계 수십억 개의 도메인을 **계층적(Hierarchy)**으로 관리하는 거대한 분산 데이터베이스입니다.

---

## 🔄 2. Recursive Lookup (재귀적 질의)

브라우저가 "naver.com IP가 뭐야?"라고 물어보면, Local DNS 서버는 탐정 놀이를 시작합니다.

```mermaid
graph TD
    Client[User] -->|"1. naver.com?"| LDNS["Local DNS (ISP)"]
    
    LDNS -->|"2. .com이 어디있니?"| Root["Root Server (Top)"]
    Root -.->|3. .com은 저기로 가| ComServer[.com TLD Server]
    
    LDNS -->|4. naver.com 어딨니?| ComServer
    ComServer -.->|5. 그건 네이버가 관리해| NaverNS[Naver Authoritative NS]
    
    LDNS -->|6. www IP가 뭐야?| NaverNS
    NaverNS -.->|7. 223.130.195.200| LDNS
    
    LDNS -->|8. 여기 있어| Client
```

1. **Root Server**: 전 세계에 몇 개 없는 최상위 서버. `.com`, `.net` 관리자를 알려줍니다.
2. **TLD Server**: `.com` 관리 서버. `naver.com` 관리자를 알려줍니다.
3. **Authoritative Server**: 실제 네이버가 운영하는 서버. 여기서 최종 IP를 알려줍니다.

> **캐싱(Caching)**: 매번 이렇게 물어보면 인터넷이 마비됩니다. 그래서 `TTL(Time To Live)` 동안 결과를 저장해둡니다.

---

## 🌐 3. GSLB (Global Server Load Balancing)

DNS는 단순히 IP만 알려주는 게 아닙니다. **가장 가까운 서버**를 알려줍니다.
넷플릭스를 켜면 미국 서버가 아니라 한국 서버에 붙는 이유입니다.

1. DNS 서버가 사용자의 IP를 봅니다. ("어? 한국에서 왔네?")
2. 한국 리전의 IP (`1.1.1.1`)를 반환합니다.
3. 미국 유저에게는 미국 IP (`2.2.2.2`)를 반환합니다.

## 🛠️ 4. 트러블슈팅 도구

백엔드 개발자라면 `dig` 명령어를 쓸 줄 알아야 합니다.

```bash
# 전체 경로 추적 (어디서 막히는지 확인)
dig +trace google.com

# 특정 DNS 서버에게 물어보기
dig @8.8.8.8 google.com
```

## 요약

- **Recursive Query**: 뿌리(Root)부터 잎(Leaf)까지 찾아가는 과정.
- **TTL**: 캐싱 시간. 배포 후 DNS 반영이 느리다면 TTL이 긴 것이다.
- **GSLB**: DNS 레벨에서 트래픽을 전 세계로 분산시키는 기술.
