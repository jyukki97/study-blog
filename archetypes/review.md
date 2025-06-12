---
title: "{{ replace .File.ContentBaseName "-" " " | title }}"
date: {{ .Date }}
lastmod: {{ .Date }}
draft: false
author: "jyukki"
description: "{{ replace .File.ContentBaseName "-" " " }} 리뷰"

# 카테고리 및 태그
categories: ["리뷰"]
tags: ["review", "evaluation"]
series: [""]

# SEO 최적화
keywords: ["리뷰", "평가", "후기"]
summary: "{{ replace .File.ContentBaseName "-" " " }}에 대한 상세 리뷰입니다."

# 포스트 메타데이터
showToc: true
TocOpen: false
hidemeta: false
disableShare: false
disableHLJS: false
hideSummary: false
searchHidden: false
ShowReadingTime: true
ShowBreadCrumbs: true
ShowPostNavLinks: true
ShowWordCount: true
UseHugoToc: true

# 리뷰 메타데이터
review:
    product: "제품/서비스 이름"
    version: "버전"
    rating: 4.5  # 5점 만점
    pros: ["장점 1", "장점 2", "장점 3"]
    cons: ["단점 1", "단점 2"]
    recommendation: true  # 추천 여부
    price: "가격 정보"
    tested_period: "테스트 기간"

# 커버 이미지 설정
cover:
    image: ""
    alt: "{{ replace .File.ContentBaseName "-" " " }} 리뷰"
    caption: ""
    relative: false
    hidden: false
---

# {{ replace .File.ContentBaseName "-" " " }} 리뷰

## 📊 종합 평가

<div class="review-summary">
<div class="rating-box">
<h3>총점</h3>
<div class="rating-score">{{ .Params.review.rating | default "0.0" }}/5.0</div>
<div class="rating-stars">
<!-- 별점 표시 영역 -->
⭐⭐⭐⭐⭐
</div>
</div>

<div class="recommendation-box">
<h3>추천도</h3>
<div class="recommendation">
{{ if (.Params.review.recommendation | default true) }}
✅ **추천합니다**
{{ else }}
❌ **추천하지 않습니다**
{{ end }}
</div>
</div>
</div>

### 📋 기본 정보

- **제품/서비스**: {{ .Params.review.product | default "제품명" }}
- **버전**: {{ .Params.review.version | default "최신" }}
- **가격**: {{ .Params.review.price | default "가격 정보 없음" }}
- **테스트 기간**: {{ .Params.review.tested_period | default "1주" }}
- **리뷰 작성일**: {{ .Date.Format "2006년 1월 2일" }}

## 🎯 첫인상

첫 사용 경험과 초기 인상을 작성하세요.

## ✨ 주요 기능

### 기능 1
기능에 대한 상세 설명과 사용 경험

### 기능 2
또 다른 주요 기능에 대한 리뷰

### 기능 3
추가 기능들에 대한 평가

## 📈 성능 테스트

### 속도
성능에 대한 객관적인 측정 결과

### 안정성
안정성 테스트 결과

### 호환성
다양한 환경에서의 호환성 테스트

## 👍 장점

{{ range (.Params.review.pros | default (slice "장점을 작성하세요")) }}
- **{{ . }}**: 상세 설명
{{ end }}

## 👎 단점

{{ range (.Params.review.cons | default (slice "단점을 작성하세요")) }}
- **{{ . }}**: 상세 설명과 개선 제안
{{ end }}

## 🆚 경쟁 제품 비교

### vs 경쟁제품 A
비교 분석 내용

### vs 경쟁제품 B
비교 분석 내용

## 💰 가격 대비 만족도

가격 대비 효용성에 대한 평가를 작성하세요.

## 📱 사용 시나리오

### 시나리오 1: 개인 사용자
개인 사용자 관점에서의 평가

### 시나리오 2: 비즈니스 사용
비즈니스 환경에서의 활용도

### 시나리오 3: 고급 사용자
파워 유저 관점에서의 평가

## 🔧 설정 및 사용법

### 초기 설정
```bash
# 설정 예제
npm install package-name
```

### 기본 사용법
```javascript
// 사용법 예제
const example = new Product();
example.use();
```

## 📊 상세 평가

| 항목 | 점수 | 평가 |
|------|------|------|
| 사용성 | 4.5/5 | 직관적이고 사용하기 쉬움 |
| 성능 | 4.0/5 | 빠르고 안정적 |
| 디자인 | 4.5/5 | 모던하고 깔끔한 UI |
| 지원 | 4.0/5 | 충분한 문서와 커뮤니티 |
| 가격 | 3.5/5 | 약간 비싸지만 합리적 |

## 🎯 최종 평가

### 이런 분들에게 추천
- 추천 대상 1
- 추천 대상 2
- 추천 대상 3

### 이런 분들에게는 비추천
- 비추천 대상 1
- 비추천 대상 2

## 🔮 향후 전망

제품의 로드맵과 향후 발전 가능성에 대한 의견

## 🔗 관련 링크

- [공식 웹사이트](https://example.com)
- [문서](https://docs.example.com)
- [커뮤니티](https://community.example.com)
- [가격 정보](https://pricing.example.com)

---

**이 리뷰가 도움이 되셨나요? 댓글로 여러분의 경험도 공유해주세요!** 💬

<style>
.review-summary {
    display: flex;
    gap: 2rem;
    margin: 2rem 0;
    padding: 1.5rem;
    background: var(--code-bg);
    border-radius: 8px;
}

.rating-box, .recommendation-box {
    flex: 1;
    text-align: center;
}

.rating-score {
    font-size: 2rem;
    font-weight: bold;
    color: var(--primary);
    margin: 0.5rem 0;
}

.rating-stars {
    font-size: 1.2rem;
    margin-top: 0.5rem;
}

.recommendation {
    font-size: 1.1rem;
    font-weight: bold;
    margin-top: 0.5rem;
}

@media (max-width: 768px) {
    .review-summary {
        flex-direction: column;
        gap: 1rem;
    }
}
</style>
