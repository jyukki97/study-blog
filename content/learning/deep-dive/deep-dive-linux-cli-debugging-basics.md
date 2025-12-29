---
title: "리눅스/CLI 기본: 장애를 빠르게 좁히는 디버깅 루틴"
date: 2025-12-16
draft: false
topic: "Ops"
tags: ["Linux", "CLI", "Debugging", "Logs", "Networking"]
categories: ["Backend Deep Dive"]
description: "프로세스/리소스/로그/네트워크를 ps/top/journalctl/ss/curl/dig로 확인하며 장애 범위를 좁히는 방법"
module: "foundation"
study_order: 10
quizzes:
  - question: "서버가 'connection refused' 에러를 내뱉고 있습니다. 가장 먼저 확인해야 할 사항은?"
    options:
      - "디스크 용량이 부족한지 확인한다 (df -h)"
      - "해당 포트가 리슨(LISTEN) 중인지 확인한다 (ss -lntp)"
      - "CPU 사용량이 100%인지 확인한다 (top)"
      - "DNS 설정이 올바른지 확인한다 (dig)"
    answer: 1
    explanation: "connection refused는 주로 포트가 열려있지 않거나 방화벽에 막혔을 때 발생합니다."

  - question: "특정 프로세스(예: java)가 현재 사용 중인 CPU와 메모리 점유율을 확인하려 합니다. 적절한 명령어 조합은?"
    options:
      - "df -h"
      - "ps aux | grep java"
      - "journalctl -u java"
      - "curl localhost:8080"
    answer: 1
    explanation: "ps aux 명령어는 프로세스 목록과 함께 CPU(%CPU), 메모리(%MEM) 사용률을 보여줍니다."

  - question: "로그를 실시간으로 계속해서 모니터링하고 싶을 때 사용하는 파일 로그 명령어 옵션은?"
    options:
      - "tail -n 100 logfile"
      - "cat logfile"
      - "tail -f logfile"
      - "vi logfile"
    answer: 2
    explanation: "-f (follow) 옵션을 사용하면 파일에 계속 추가되는 내용을 실시간으로 볼 수 있습니다."

  - question: "systemd로 관리되는 서비스(my-app)의 최근 로그를 확인하는 올바른 명령어는?"
    options:
      - "tail -f /var/log/my-app"
      - "systemctl status my-app"
      - "journalctl -u my-app"
      - "ps -ef | grep my-app"
    answer: 2
    explanation: "systemd 서비스의 로그는 journalctl 명령어로 확인합니다."

  - question: "서버에는 문제가 없는데 클라이언트(브라우저)에서만 접속이 안 될 때, DNS 문제를 의심해볼 수 있습니다. 도메인 IP를 확인할 때 쓰는 도구는?"
    options:
      - "ping"
      - "dig"
      - "telnet"
      - "netstat"
    answer: 1
    explanation: "dig(Domain Information Groper)는 DNS 네임서버에 쿼리하여 도메인 정보를 조회하는 도구입니다."

  - question: "특정 포트(8080)를 어떤 프로세스가 점유하고 있는지 확인하는 명령어는?"
    options:
      - "lsof -i :8080"
      - "ps -ef"
      - "top"
      - "free -h"
    answer: 0
    explanation: "lsof (list open files) 명령어로 특정 포트를 리슨하는 프로세스를 찾을 수 있습니다."

  - question: "디스크 공간이 가득 차서(Full) 로그를 쓸 수 없는 장애가 발생했습니다. 현재 디스크 사용량을 확인하는 명령어는?"
    options:
      - "free -h"
      - "du -sh"
      - "df -h"
      - "mount"
    answer: 2
    explanation: "df (disk free) 명령어는 파일 시스템의 남은 용량을 보여줍니다."

  - question: "CURL 명령어로 DNS를 거치지 않고 특정 IP(1.2.3.4)로 강제 요청을 보내려 합니다. 올바른 옵션은?"
    options:
      - "curl -H 'Host: example.com' http://1.2.3.4"
      - "curl --resolve example.com:80:1.2.3.4 http://example.com"
      - "curl -d 1.2.3.4 http://example.com"
      - "curl -X IP=1.2.3.4 http://example.com"
    answer: 1
    explanation: "--resolve 옵션을 사용하면 /etc/hosts 파일을 수정하지 않고도 특정 도메인을 지정한 IP로 매핑해서 요청할 수 있습니다."
---

## 이 글에서 얻는 것

- “요청이 안 된다/느리다” 상황에서 **어디부터 확인해야 하는지**(프로세스→로그→네트워크→의존성) 순서가 생깁니다.
- 운영에서 자주 쓰는 최소 명령어(`ps/top/journalctl/ss/lsof/curl/dig/df`)로 문제 범위를 빠르게 좁힐 수 있습니다.
- “애플리케이션 문제”로 보이던 이슈가 사실은 **DNS/포트/리소스/디스크**일 수 있음을 감각적으로 이해합니다.

## 0) 백엔드 장애는 보통 이렇게 시작한다

대표 증상:

- `timeout`(연결은 되는데 응답이 없다)
- `connection refused`(포트가 안 열렸거나 프로세스가 없다)
- 5xx(특히 502/504) 증가(업스트림/프록시/LB/타임아웃 계층 가능)
- CPU/메모리 급등, OOMKilled, 디스크 꽉 참

이 글은 “원인을 바로 맞추는” 게 아니라, **원인 후보를 빠르게 줄이는 루틴**을 만드는 게 목표입니다.

## 1) 프로세스/자원: “서버가 살아있는가?”

### 1-1) CPU/메모리/로드 확인

- `top` / `htop`(있다면): CPU, 메모리, load average
- `top -H`: 스레드 단위로 확인(스레드 폭주/락 경합 짐작)
- `free -h`: 메모리 여유(캐시 포함 해석 필요)
- `vmstat 1`: run queue, swap, IO wait 같은 흐름 확인

실무 감각:

- CPU 100%가 “연산”인지 “스핀락/바쁜 대기”인지 구분이 필요합니다(스레드 덤프와 연결).
- 메모리가 부족해 swap이 치면, 레이턴시가 갑자기 나빠질 수 있습니다.

### 1-2) 프로세스가 떠 있는지 / 어디를 리슨하는지

- `ps aux | rg <process>`: 프로세스 존재 확인
- `ps -o pid,ppid,cmd,%cpu,%mem -p <pid>`: 특정 PID 상태 확인

컨테이너라면 “호스트가 아니라 컨테이너 내부”에서 확인해야 하는 경우가 많습니다.

## 2) 로그: “무슨 에러가 나는가?”

### 2-1) systemd(journalctl) 기반일 때

- `journalctl -u <service> -n 200 --no-pager`: 최근 200줄
- `journalctl -u <service> -f`: 실시간 follow
- `journalctl -u <service> --since \"10 minutes ago\"`: 시간 범위

### 2-2) 파일 로그일 때

- `tail -n 200 -f /var/log/...`
- `rg \"ERROR|Exception\" -n <logfile>`

실무 팁:

- “스택트레이스가 없고 타임아웃만 있다”면, 애플리케이션이 아니라 네트워크/의존성/풀 고갈일 가능성도 큽니다.
- 반드시 traceId/correlationId를 같이 보는 습관을 들이면 디버깅 속도가 크게 빨라집니다.

## 3) 포트/연결: “요청이 어디까지 도달하나?”

### 3-1) 포트 리슨 확인

- `ss -lntp`: TCP 리슨 소켓 확인(프로세스까지)
- `lsof -iTCP -sTCP:LISTEN -nP | rg <port>`: 특정 포트 리슨 확인

`connection refused`는 보통:

- 포트가 열려 있지 않거나
- 방화벽/보안그룹/NACL이 차단하거나
- 잘못된 IP/포트로 붙고 있을 때

중 하나입니다.

### 3-2) 연결이 쌓이는지 확인

- `ss -antp | head`: ESTABLISHED, SYN-SENT, TIME-WAIT 등 상태를 봅니다.

실무 감각:

- `TIME-WAIT`이 과도하면 짧은 커넥션을 너무 많이 만들고 있을 수 있습니다(keep-alive, 커넥션 풀).
- `SYN-SENT`가 많으면 대상이 응답하지 않거나 네트워크가 막혔을 가능성이 큽니다.

## 4) DNS/HTTP: “이 도메인이 어디로 가는가?”

### 4-1) DNS 확인

- `dig <domain> A +short`
- `dig <domain> AAAA +short`(IPv6 이슈 확인)
- `dig +trace <domain>`(권한/전파/라우팅 문제 추적)

### 4-2) 실제 호출을 재현(curl)

- `curl -v https://api.example.com/health`
- `curl -I https://api.example.com/`(헤더만)
- `curl --resolve api.example.com:443:1.2.3.4 https://api.example.com/health`(DNS를 우회해 특정 IP로 강제)

포인트:

- “서버는 정상인데 브라우저/클라이언트만 실패”면 DNS/프록시/인증 헤더 같은 계층일 수 있습니다.

## 5) 디스크/파일: “로그가 쌓여서 죽는” 사고를 막기

- `df -h`: 디스크 사용량
- `df -i`: inode 고갈(파일이 너무 많아도 터짐)
- `du -sh * | sort -h`: 무엇이 공간을 먹는지

실무에서 자주 터지는 패턴:

- 로그/덤프 파일이 무한히 쌓여 디스크 100% → 애플리케이션이 쓰기 실패 → 장애

## 6) 10분 디버깅 루틴(추천)

1) 증상 분류: `refused` vs `timeout` vs 5xx  
2) 프로세스/리소스: `top`, `ps`로 “살아있는가/포화인가”  
3) 로그: `journalctl`/파일 로그에서 에러/스택트레이스 확인  
4) 포트/연결: `ss -lntp`(리슨) → `ss -antp`(연결 상태)  
5) DNS/HTTP 재현: `dig`, `curl -v`로 “어디까지 가는지” 확인  
6) 의존성(DB/외부 API): 타임아웃/커넥션 풀/레이트리밋 확인(애플리케이션 지표와 연결)  

## 연습(추천)

- 간단한 서버를 띄운 뒤(로컬/컨테이너), 포트를 바꿔 `connection refused`를 만들고 `ss/lsof/curl`로 원인을 찾아보기
- DNS를 잘못된 레코드로 가정하고 `dig`와 `curl --resolve`로 문제를 분리해보기
- 디스크를 일부러 채우는 테스트 환경에서 로그가 쌓일 때 어떤 장애가 나는지(쓰기 실패/에러 로그) 재현해보기
