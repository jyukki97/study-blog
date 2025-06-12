// 컨텐츠 관리 시스템 (Phase 4.1)
// 포스트 템플릿, 태그/카테고리 추천, 메타데이터 자동 생성

class ContentManager {
  constructor() {
    this.templates = this.loadTemplates();
    this.tagsDatabase = this.loadTagsDatabase();
    this.categoriesDatabase = this.loadCategoriesDatabase();
    this.metadata = new Map();

    this.init();
  }

  async init() {
    console.log("[ContentManager] 컨텐츠 관리 시스템 초기화...");

    // 관리자 패널에서만 실행
    if (this.isAdminPage()) {
      this.initAdminPanel();
    }

    // 포스트 작성 페이지에서 실행
    if (this.isPostEditor()) {
      this.initPostEditor();
    }

    // 태그/카테고리 추천 시스템 초기화
    this.initRecommendationSystem();

    // 메타데이터 자동 생성 시스템
    this.initMetadataGenerator();

    console.log("[ContentManager] 초기화 완료");
  }

  // 관리자 페이지 감지
  isAdminPage() {
    return (
      window.location.pathname.includes("/admin") ||
      window.location.search.includes("admin=true")
    );
  }

  // 포스트 에디터 감지
  isPostEditor() {
    return (
      document.querySelector('form[action*="post"]') ||
      document.querySelector(".post-editor") ||
      window.location.pathname.includes("/write")
    );
  }

  // 포스트 템플릿 시스템
  loadTemplates() {
    return {
      default: {
        name: "기본 포스트",
        description: "일반적인 블로그 포스트 템플릿",
        frontmatter: {
          title: "",
          date: new Date().toISOString(),
          tags: [],
          categories: [],
          draft: false,
          summary: "",
          showToc: true,
          TocOpen: false,
        },
        content: `## 개요

여기에 포스트 요약을 작성하세요.

## 본문

### 소제목 1

내용을 작성하세요.

### 소제목 2

추가 내용을 작성하세요.

## 결론

마무리 내용을 작성하세요.
`,
      },
      tutorial: {
        name: "튜토리얼",
        description: "단계별 가이드 형식의 튜토리얼",
        frontmatter: {
          title: "",
          date: new Date().toISOString(),
          tags: ["tutorial"],
          categories: ["가이드"],
          draft: false,
          summary: "",
          showToc: true,
          TocOpen: true,
          difficulty: "beginner", // beginner, intermediate, advanced
          estimatedTime: "10분",
        },
        content: `## 시작하기 전에

### 준비물
- 항목 1
- 항목 2

### 사전 지식
- 필요한 지식 1
- 필요한 지식 2

## 단계별 가이드

### 1단계: 제목

설명과 함께 단계를 진행하세요.

\`\`\`bash
# 예시 코드
echo "Hello World"
\`\`\`

### 2단계: 제목

다음 단계를 진행하세요.

### 3단계: 제목

마지막 단계입니다.

## 문제 해결

### 자주 발생하는 문제

**문제**: 설명
**해결**: 해결 방법

## 다음 단계

- 추가로 학습할 내용 1
- 추가로 학습할 내용 2

## 참고 자료

- [링크 1](url)
- [링크 2](url)
`,
      },
      review: {
        name: "리뷰",
        description: "제품, 서비스, 책 등의 리뷰",
        frontmatter: {
          title: "",
          date: new Date().toISOString(),
          tags: ["review"],
          categories: ["리뷰"],
          draft: false,
          summary: "",
          showToc: true,
          rating: 0, // 1-5 별점
          pros: [],
          cons: [],
          recommendation: true,
        },
        content: `## 한줄 요약

리뷰 대상에 대한 간단한 요약을 작성하세요.

## 개요

### 기본 정보
- **이름**: 
- **제작사**: 
- **가격**: 
- **출시일**: 

## 상세 리뷰

### 장점 👍
- 장점 1
- 장점 2
- 장점 3

### 단점 👎
- 단점 1
- 단점 2

### 사용 경험

실제 사용해본 경험을 자세히 작성하세요.

## 평가

### 별점 ⭐
**[별점]/5**

### 추천 여부
- **추천 대상**: 누구에게 추천하는지
- **비추천 대상**: 누구에게는 맞지 않는지

## 결론

최종 평가와 추천 의견을 작성하세요.
`,
      },
      project: {
        name: "프로젝트 소개",
        description: "개발 프로젝트나 작업물 소개",
        frontmatter: {
          title: "",
          date: new Date().toISOString(),
          tags: ["project"],
          categories: ["프로젝트"],
          draft: false,
          summary: "",
          showToc: true,
          githubUrl: "",
          demoUrl: "",
          techStack: [],
          status: "completed", // planning, development, completed, maintenance
        },
        content: `## 프로젝트 개요

### 📝 설명
프로젝트에 대한 간단한 설명을 작성하세요.

### 🎯 목표
- 목표 1
- 목표 2

### 🔧 기술 스택
- Frontend: 
- Backend: 
- Database: 
- Deployment: 

## 주요 기능

### 핵심 기능
1. **기능 1**: 설명
2. **기능 2**: 설명
3. **기능 3**: 설명

### 스크린샷
![스크린샷](image-url)

## 개발 과정

### 기획 단계
개발 동기와 기획 과정을 설명하세요.

### 구현 단계
주요 구현 내용과 어려웠던 점을 설명하세요.

\`\`\`javascript
// 핵심 코드 예시
function example() {
    console.log("Hello World");
}
\`\`\`

### 배포 단계
배포 과정과 사용된 도구를 설명하세요.

## 배운 점 & 아쉬운 점

### ✅ 배운 점
- 학습한 내용 1
- 학습한 내용 2

### 🤔 아쉬운 점
- 개선할 점 1
- 개선할 점 2

## 다음 계획

향후 개선 계획이나 새로운 기능 추가 계획을 작성하세요.

## 링크

- [GitHub 저장소](github-url)
- [데모 사이트](demo-url)
- [관련 문서](docs-url)
`,
      },
      retrospective: {
        name: "회고",
        description: "프로젝트나 기간에 대한 회고",
        frontmatter: {
          title: "",
          date: new Date().toISOString(),
          tags: ["retrospective"],
          categories: ["회고"],
          draft: false,
          summary: "",
          period: "", // 회고 기간
          mood: "positive", // positive, negative, neutral
        },
        content: `## 개요

### 기간
**YYYY년 MM월 ~ YYYY년 MM월**

### 주요 활동
이 기간 동안의 주요 활동이나 프로젝트를 나열하세요.

## 성과 및 성장

### ✅ 잘한 점
- 성과 1
- 성과 2
- 성과 3

### 📈 성장한 부분
- 성장 영역 1: 구체적인 설명
- 성장 영역 2: 구체적인 설명

## 아쉬운 점 및 개선사항

### 😅 아쉬웠던 점
- 아쉬운 점 1
- 아쉬운 점 2

### 🎯 개선해야 할 점
- 개선 사항 1: 구체적인 개선 방법
- 개선 사항 2: 구체적인 개선 방법

## 배운 교훈

### 💡 핵심 깨달음
가장 중요하게 배운 점을 작성하세요.

### 📚 새로 학습한 것들
- 학습 내용 1
- 학습 내용 2

## 앞으로의 계획

### 단기 목표 (1-3개월)
- 목표 1
- 목표 2

### 장기 목표 (6개월-1년)
- 목표 1
- 목표 2

## 마무리

회고를 통해 느낀 점이나 다짐을 작성하세요.
`,
      },
    };
  }

  // 태그 데이터베이스 로드
  loadTagsDatabase() {
    const saved = localStorage.getItem("content-tags-db");
    return saved
      ? JSON.parse(saved)
      : {
          // 인기 태그들
          popular: [
            "javascript",
            "react",
            "vue",
            "node.js",
            "python",
            "tutorial",
            "review",
            "project",
            "retrospective",
            "web development",
            "frontend",
            "backend",
            "full-stack",
          ],
          // 카테고리별 태그
          categories: {
            development: ["javascript", "python", "react", "vue", "node.js"],
            tutorial: ["beginner", "intermediate", "advanced", "step-by-step"],
            review: ["product", "book", "course", "tool", "service"],
            project: ["portfolio", "open-source", "side-project", "work"],
          },
          // 사용 빈도
          frequency: {},
        };
  }

  // 카테고리 데이터베이스 로드
  loadCategoriesDatabase() {
    const saved = localStorage.getItem("content-categories-db");
    return saved
      ? JSON.parse(saved)
      : {
          main: [
            "개발",
            "튜토리얼",
            "리뷰",
            "프로젝트",
            "회고",
            "일상",
            "생각",
            "번역",
            "뉴스",
            "도구",
          ],
          subcategories: {
            개발: ["Frontend", "Backend", "Mobile", "DevOps", "Design"],
            튜토리얼: ["기초", "중급", "고급", "팁"],
            리뷰: ["책", "강의", "도구", "서비스"],
            프로젝트: ["개인", "팀", "오픈소스", "포트폴리오"],
          },
        };
  }

  // 관리자 패널 초기화
  initAdminPanel() {
    console.log("[ContentManager] 관리자 패널 초기화");
    this.createContentManagementPanel();
  }

  // 포스트 에디터 초기화
  initPostEditor() {
    console.log("[ContentManager] 포스트 에디터 개선 기능 초기화");
    this.enhancePostEditor();
  }

  // 컨텐츠 관리 패널 생성
  createContentManagementPanel() {
    const panel = document.createElement("div");
    panel.className = "content-management-panel";
    panel.innerHTML = `
            <div class="panel-header">
                <h2>📝 컨텐츠 관리</h2>
                <button class="panel-toggle" aria-label="패널 토글">−</button>
            </div>
            
            <div class="panel-content">
                <div class="panel-section">
                    <h3>🎨 포스트 템플릿</h3>
                    <div class="template-grid">
                        ${Object.entries(this.templates)
                          .map(
                            ([key, template]) => `
                            <div class="template-card" data-template="${key}">
                                <h4>${template.name}</h4>
                                <p>${template.description}</p>
                                <button class="use-template-btn" data-template="${key}">
                                    사용하기
                                </button>
                            </div>
                        `
                          )
                          .join("")}
                    </div>
                </div>
                
                <div class="panel-section">
                    <h3>🏷️ 태그 관리</h3>
                    <div class="tag-management">
                        <div class="popular-tags">
                            <h4>인기 태그</h4>
                            <div class="tag-list">
                                ${this.tagsDatabase.popular
                                  .map(
                                    (tag) => `
                                    <span class="tag-item">${tag}</span>
                                `
                                  )
                                  .join("")}
                            </div>
                        </div>
                        
                        <div class="tag-input-section">
                            <input type="text" id="new-tag-input" placeholder="새 태그 추가...">
                            <button id="add-tag-btn">추가</button>
                        </div>
                    </div>
                </div>
                
                <div class="panel-section">
                    <h3>📊 통계</h3>
                    <div class="content-stats">
                        <div class="stat-item">
                            <span class="stat-label">총 포스트</span>
                            <span class="stat-value">-</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">인기 태그</span>
                            <span class="stat-value">-</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">최근 업데이트</span>
                            <span class="stat-value">-</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

    // 스타일 추가
    this.addPanelStyles();

    // 페이지에 추가
    document.body.appendChild(panel);

    // 이벤트 리스너 설정
    this.setupPanelEvents(panel);
  }

  // 포스트 에디터 개선
  enhancePostEditor() {
    // 에디터 찾기
    const editor = document.querySelector(
      "textarea, .editor, [contenteditable]"
    );
    if (!editor) return;

    // 자동완성 기능 추가
    this.addAutoCompletion(editor);

    // 실시간 메타데이터 생성
    this.addRealTimeMetadata(editor);

    // 태그 추천 시스템
    this.addTagRecommendations(editor);
  }

  // 추천 시스템 초기화
  initRecommendationSystem() {
    this.recommendationEngine = new RecommendationEngine(
      this.tagsDatabase,
      this.categoriesDatabase
    );
  }

  // 메타데이터 자동 생성 시스템
  initMetadataGenerator() {
    this.metadataGenerator = new MetadataGenerator();
  }

  // 자동완성 기능
  addAutoCompletion(editor) {
    const suggestions = document.createElement("div");
    suggestions.className = "editor-suggestions";
    suggestions.style.display = "none";

    editor.parentNode.insertBefore(suggestions, editor.nextSibling);

    let currentWord = "";
    let suggestionIndex = -1;

    editor.addEventListener("input", (e) => {
      const cursorPos = editor.selectionStart;
      const text = editor.value.substring(0, cursorPos);
      const words = text.split(/\s+/);
      currentWord = words[words.length - 1];

      if (currentWord.startsWith("#") && currentWord.length > 1) {
        // 태그 자동완성
        const query = currentWord.substring(1);
        const matchingTags = this.tagsDatabase.popular.filter((tag) =>
          tag.toLowerCase().includes(query.toLowerCase())
        );

        this.showSuggestions(suggestions, matchingTags, editor);
      } else {
        this.hideSuggestions(suggestions);
      }
    });

    editor.addEventListener("keydown", (e) => {
      const suggestionItems = suggestions.querySelectorAll(".suggestion-item");

      if (suggestionItems.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          suggestionIndex = Math.min(
            suggestionIndex + 1,
            suggestionItems.length - 1
          );
          this.highlightSuggestion(suggestionItems, suggestionIndex);
          break;

        case "ArrowUp":
          e.preventDefault();
          suggestionIndex = Math.max(suggestionIndex - 1, 0);
          this.highlightSuggestion(suggestionItems, suggestionIndex);
          break;

        case "Tab":
        case "Enter":
          if (suggestionIndex >= 0) {
            e.preventDefault();
            const selectedSuggestion = suggestionItems[suggestionIndex];
            this.applySuggestion(
              editor,
              selectedSuggestion.textContent,
              currentWord
            );
            this.hideSuggestions(suggestions);
            suggestionIndex = -1;
          }
          break;

        case "Escape":
          this.hideSuggestions(suggestions);
          suggestionIndex = -1;
          break;
      }
    });
  }

  // 실시간 메타데이터 생성
  addRealTimeMetadata(editor) {
    const metadataPanel = document.createElement("div");
    metadataPanel.className = "realtime-metadata";
    metadataPanel.innerHTML = `
            <h4>📋 자동 생성 메타데이터</h4>
            <div class="metadata-content">
                <div class="metadata-item">
                    <label>예상 읽기 시간:</label>
                    <span id="reading-time">0분</span>
                </div>
                <div class="metadata-item">
                    <label>단어 수:</label>
                    <span id="word-count">0</span>
                </div>
                <div class="metadata-item">
                    <label>추천 태그:</label>
                    <div id="suggested-tags"></div>
                </div>
                <div class="metadata-item">
                    <label>SEO 점수:</label>
                    <span id="seo-score">0/100</span>
                </div>
            </div>
        `;

    editor.parentNode.appendChild(metadataPanel);

    // 실시간 업데이트
    let updateTimeout;
    editor.addEventListener("input", () => {
      clearTimeout(updateTimeout);
      updateTimeout = setTimeout(() => {
        this.updateRealTimeMetadata(editor, metadataPanel);
      }, 500);
    });
  }

  // 실시간 메타데이터 업데이트
  updateRealTimeMetadata(editor, panel) {
    const content = editor.value;

    // 읽기 시간 계산
    const readingTime = this.calculateReadingTime(content);
    panel.querySelector("#reading-time").textContent = `${readingTime}분`;

    // 단어 수 계산
    const wordCount = content.trim().split(/\s+/).length;
    panel.querySelector("#word-count").textContent = wordCount;

    // 추천 태그 생성
    const suggestedTags = this.generateSuggestedTags(content);
    const tagsContainer = panel.querySelector("#suggested-tags");
    tagsContainer.innerHTML = suggestedTags
      .map(
        (tag) => `<span class="suggested-tag" data-tag="${tag}">${tag}</span>`
      )
      .join("");

    // SEO 점수 계산
    const seoScore = this.calculateSEOScore(content);
    panel.querySelector("#seo-score").textContent = `${seoScore}/100`;
  }

  // 태그 추천
  generateSuggestedTags(content) {
    const words = content
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((word) => word.length > 2);

    const wordFreq = {};
    words.forEach((word) => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });

    // 기존 태그와 매칭
    const suggestions = [];
    this.tagsDatabase.popular.forEach((tag) => {
      const tagWords = tag.toLowerCase().split(/[-\s]/);
      const score = tagWords.reduce((acc, tagWord) => {
        return acc + (wordFreq[tagWord] || 0);
      }, 0);

      if (score > 0) {
        suggestions.push({ tag, score });
      }
    });

    return suggestions
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((item) => item.tag);
  }

  // SEO 점수 계산
  calculateSEOScore(content) {
    let score = 0;

    // 최소 단어 수 (300단어 이상)
    const wordCount = content.trim().split(/\s+/).length;
    if (wordCount >= 300) score += 20;
    else score += Math.floor((wordCount / 300) * 20);

    // 헤딩 구조 (H1, H2, H3 사용)
    const headings = content.match(/^#{1,3}\s/gm);
    if (headings && headings.length >= 3) score += 20;

    // 코드 블록 포함
    const codeBlocks = content.match(/```[\s\S]*?```/g);
    if (codeBlocks && codeBlocks.length > 0) score += 15;

    // 링크 포함
    const links = content.match(/\[.*?\]\(.*?\)/g);
    if (links && links.length > 0) score += 15;

    // 이미지 포함
    const images = content.match(/!\[.*?\]\(.*?\)/g);
    if (images && images.length > 0) score += 15;

    // 리스트 사용
    const lists = content.match(/^[-*+]\s/gm);
    if (lists && lists.length > 0) score += 15;

    return Math.min(100, score);
  }

  // 읽기 시간 계산
  calculateReadingTime(content) {
    const wordsPerMinute = 200;
    const words = content.trim().split(/\s+/).length;
    return Math.max(1, Math.ceil(words / wordsPerMinute));
  }

  // 자동완성 UI 관련 메서드들
  showSuggestions(container, suggestions, editor) {
    if (suggestions.length === 0) {
      this.hideSuggestions(container);
      return;
    }

    container.innerHTML = suggestions
      .map((suggestion) => `<div class="suggestion-item">${suggestion}</div>`)
      .join("");

    container.style.display = "block";

    // 클릭 이벤트
    container.querySelectorAll(".suggestion-item").forEach((item) => {
      item.addEventListener("click", () => {
        this.applySuggestion(
          editor,
          item.textContent,
          editor.value.substring(0, editor.selectionStart).split(/\s+/).pop()
        );
        this.hideSuggestions(container);
      });
    });
  }

  hideSuggestions(container) {
    container.style.display = "none";
    container.innerHTML = "";
  }

  highlightSuggestion(items, index) {
    items.forEach((item, i) => {
      item.classList.toggle("highlighted", i === index);
    });
  }

  applySuggestion(editor, suggestion, currentWord) {
    const cursorPos = editor.selectionStart;
    const beforeCursor = editor.value.substring(
      0,
      cursorPos - currentWord.length
    );
    const afterCursor = editor.value.substring(cursorPos);

    editor.value = beforeCursor + suggestion + " " + afterCursor;
    editor.focus();

    const newCursorPos = beforeCursor.length + suggestion.length + 1;
    editor.setSelectionRange(newCursorPos, newCursorPos);
  }

  // 패널 이벤트 설정
  setupPanelEvents(panel) {
    // 템플릿 사용 버튼
    panel.querySelectorAll(".use-template-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const templateKey = e.target.dataset.template;
        this.applyTemplate(templateKey);
      });
    });

    // 태그 추가
    const addTagBtn = panel.querySelector("#add-tag-btn");
    const tagInput = panel.querySelector("#new-tag-input");

    addTagBtn.addEventListener("click", () => {
      this.addNewTag(tagInput.value.trim());
      tagInput.value = "";
    });

    tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.addNewTag(tagInput.value.trim());
        tagInput.value = "";
      }
    });

    // 패널 토글
    panel.querySelector(".panel-toggle").addEventListener("click", () => {
      panel.classList.toggle("collapsed");
    });
  }

  // 템플릿 적용
  applyTemplate(templateKey) {
    const template = this.templates[templateKey];
    if (!template) return;

    // 에디터 찾기
    const editor = document.querySelector("textarea, .editor");
    if (!editor) {
      // 새 창에서 템플릿 표시
      this.openTemplateInNewWindow(template);
      return;
    }

    // frontmatter 생성
    const frontmatter = this.generateFrontmatter(template.frontmatter);
    const content = `---\n${frontmatter}\n---\n\n${template.content}`;

    editor.value = content;
    editor.focus();

    // 성공 알림
    this.showNotification(
      `${template.name} 템플릿이 적용되었습니다!`,
      "success"
    );
  }

  // frontmatter 생성
  generateFrontmatter(data) {
    return Object.entries(data)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          return `${key}: [${value.map((v) => `"${v}"`).join(", ")}]`;
        } else if (typeof value === "string") {
          return `${key}: "${value}"`;
        } else {
          return `${key}: ${value}`;
        }
      })
      .join("\n");
  }

  // 새 창에서 템플릿 열기
  openTemplateInNewWindow(template) {
    const frontmatter = this.generateFrontmatter(template.frontmatter);
    const content = `---\n${frontmatter}\n---\n\n${template.content}`;

    const newWindow = window.open("", "_blank");
    newWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>템플릿: ${template.name}</title>
                <style>
                    body { font-family: monospace; padding: 20px; }
                    textarea { width: 100%; height: 80vh; font-family: monospace; }
                    .header { margin-bottom: 20px; }
                    .copy-btn { padding: 10px 20px; background: #007cba; color: white; border: none; cursor: pointer; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h2>${template.name}</h2>
                    <p>${template.description}</p>
                    <button class="copy-btn" onclick="copyContent()">클립보드에 복사</button>
                </div>
                <textarea id="content" readonly>${content}</textarea>
                <script>
                    function copyContent() {
                        document.getElementById('content').select();
                        document.execCommand('copy');
                        alert('클립보드에 복사되었습니다!');
                    }
                </script>
            </body>
            </html>
        `);
  }

  // 새 태그 추가
  addNewTag(tag) {
    if (!tag || this.tagsDatabase.popular.includes(tag)) return;

    this.tagsDatabase.popular.push(tag);
    this.saveTagsDatabase();

    this.showNotification(`태그 "${tag}"가 추가되었습니다!`, "success");

    // UI 업데이트
    this.updateTagsList();
  }

  // 태그 목록 업데이트
  updateTagsList() {
    const tagList = document.querySelector(".tag-list");
    if (!tagList) return;

    tagList.innerHTML = this.tagsDatabase.popular
      .map((tag) => `<span class="tag-item">${tag}</span>`)
      .join("");
  }

  // 데이터 저장 메서드들
  saveTagsDatabase() {
    localStorage.setItem("content-tags-db", JSON.stringify(this.tagsDatabase));
  }

  saveCategoriesDatabase() {
    localStorage.setItem(
      "content-categories-db",
      JSON.stringify(this.categoriesDatabase)
    );
  }

  // 알림 표시
  showNotification(message, type = "info") {
    const notification = document.createElement("div");
    notification.className = `content-notification ${type}`;
    notification.textContent = message;

    Object.assign(notification.style, {
      position: "fixed",
      top: "20px",
      right: "20px",
      padding: "12px 20px",
      borderRadius: "8px",
      color: "white",
      fontSize: "14px",
      zIndex: "10001",
      opacity: "0",
      transform: "translateY(-20px)",
      transition: "all 0.3s ease",
    });

    const colors = {
      success: "#4CAF50",
      error: "#f44336",
      warning: "#ff9800",
      info: "#2196F3",
    };
    notification.style.background = colors[type] || colors.info;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.opacity = "1";
      notification.style.transform = "translateY(0)";
    }, 100);

    setTimeout(() => {
      notification.style.opacity = "0";
      notification.style.transform = "translateY(-20px)";
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  // CSS 스타일 추가
  addPanelStyles() {
    const style = document.createElement("style");
    style.textContent = `
            .content-management-panel {
                position: fixed;
                top: 50%;
                right: 20px;
                transform: translateY(-50%);
                width: 400px;
                max-height: 80vh;
                background: white;
                border-radius: 15px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                z-index: 10000;
                overflow: hidden;
                transition: all 0.3s ease;
            }
            
            .content-management-panel.collapsed .panel-content {
                display: none;
            }
            
            .panel-header {
                background: linear-gradient(135deg, #b19cd9, #9a7bc8);
                color: white;
                padding: 15px 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .panel-header h2 {
                margin: 0;
                font-size: 1.2rem;
            }
            
            .panel-toggle {
                background: none;
                border: none;
                color: white;
                font-size: 1.5rem;
                cursor: pointer;
                width: 30px;
                height: 30px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .panel-toggle:hover {
                background: rgba(255,255,255,0.2);
            }
            
            .panel-content {
                max-height: calc(80vh - 60px);
                overflow-y: auto;
                padding: 20px;
            }
            
            .panel-section {
                margin-bottom: 25px;
            }
            
            .panel-section h3 {
                margin: 0 0 15px 0;
                color: #333;
                font-size: 1.1rem;
                border-bottom: 2px solid #e0e0e0;
                padding-bottom: 5px;
            }
            
            .template-grid {
                display: grid;
                gap: 10px;
            }
            
            .template-card {
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                padding: 15px;
                background: #f8f9fa;
            }
            
            .template-card h4 {
                margin: 0 0 8px 0;
                color: #333;
                font-size: 1rem;
            }
            
            .template-card p {
                margin: 0 0 10px 0;
                color: #666;
                font-size: 0.9rem;
            }
            
            .use-template-btn {
                background: #b19cd9;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 5px;
                cursor: pointer;
                font-size: 0.9rem;
                transition: background 0.2s;
            }
            
            .use-template-btn:hover {
                background: #9a7bc8;
            }
            
            .tag-list {
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
                margin-bottom: 10px;
            }
            
            .tag-item {
                background: #e9ecef;
                padding: 4px 8px;
                border-radius: 12px;
                font-size: 0.8rem;
                color: #495057;
            }
            
            .tag-input-section {
                display: flex;
                gap: 10px;
            }
            
            .tag-input-section input {
                flex: 1;
                padding: 8px;
                border: 1px solid #ddd;
                border-radius: 5px;
            }
            
            .tag-input-section button {
                background: #28a745;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 5px;
                cursor: pointer;
            }
            
            .content-stats {
                display: grid;
                gap: 10px;
            }
            
            .stat-item {
                display: flex;
                justify-content: space-between;
                padding: 10px;
                background: #f8f9fa;
                border-radius: 5px;
            }
            
            .stat-label {
                font-weight: 500;
                color: #666;
            }
            
            .stat-value {
                font-weight: 600;
                color: #333;
            }
            
            .editor-suggestions {
                position: absolute;
                background: white;
                border: 1px solid #ddd;
                border-radius: 5px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                max-height: 200px;
                overflow-y: auto;
                z-index: 1000;
            }
            
            .suggestion-item {
                padding: 8px 12px;
                cursor: pointer;
                border-bottom: 1px solid #f0f0f0;
            }
            
            .suggestion-item:hover,
            .suggestion-item.highlighted {
                background: #f8f9fa;
            }
            
            .realtime-metadata {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 300px;
                background: white;
                border-radius: 10px;
                box-shadow: 0 5px 20px rgba(0,0,0,0.1);
                padding: 15px;
                z-index: 1000;
            }
            
            .realtime-metadata h4 {
                margin: 0 0 10px 0;
                color: #333;
            }
            
            .metadata-item {
                display: flex;
                justify-content: space-between;
                margin-bottom: 8px;
                font-size: 0.9rem;
            }
            
            .metadata-item label {
                font-weight: 500;
                color: #666;
            }
            
            .suggested-tag {
                display: inline-block;
                background: #e7f3ff;
                color: #0066cc;
                padding: 2px 8px;
                border-radius: 10px;
                font-size: 0.8rem;
                margin: 2px;
                cursor: pointer;
            }
            
            .suggested-tag:hover {
                background: #cce7ff;
            }
            
            @media (max-width: 768px) {
                .content-management-panel {
                    right: 10px;
                    left: 10px;
                    width: auto;
                    max-height: 70vh;
                }
                
                .realtime-metadata {
                    right: 10px;
                    left: 10px;
                    width: auto;
                }
            }
        `;
    document.head.appendChild(style);
  }
}

// 추천 엔진 클래스
class RecommendationEngine {
  constructor(tagsDB, categoriesDB) {
    this.tagsDB = tagsDB;
    this.categoriesDB = categoriesDB;
  }

  // 컨텐츠 기반 태그 추천
  recommendTags(content, limit = 5) {
    // 키워드 추출 및 빈도 분석
    const keywords = this.extractKeywords(content);
    const recommendations = [];

    // 기존 태그와 매칭
    this.tagsDB.popular.forEach((tag) => {
      const score = this.calculateTagScore(tag, keywords);
      if (score > 0) {
        recommendations.push({ tag, score });
      }
    });

    return recommendations
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.tag);
  }

  // 키워드 추출
  extractKeywords(content) {
    const words = content
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((word) => word.length > 2);

    const frequency = {};
    words.forEach((word) => {
      frequency[word] = (frequency[word] || 0) + 1;
    });

    return frequency;
  }

  // 태그 점수 계산
  calculateTagScore(tag, keywords) {
    const tagWords = tag.toLowerCase().split(/[-\s]/);
    return tagWords.reduce((score, word) => {
      return score + (keywords[word] || 0);
    }, 0);
  }
}

// 메타데이터 생성기 클래스
class MetadataGenerator {
  constructor() {
    this.patterns = {
      title: /^#\s+(.+)$/m,
      headings: /^#{1,6}\s+(.+)$/gm,
      links: /\[([^\]]+)\]\(([^)]+)\)/g,
      images: /!\[([^\]]*)\]\(([^)]+)\)/g,
      codeBlocks: /```[\s\S]*?```/g,
    };
  }

  // 자동 요약 생성
  generateSummary(content, maxLength = 160) {
    // 첫 번째 문단에서 요약 추출
    const paragraphs = content.split("\n\n");
    const firstParagraph = paragraphs.find(
      (p) => p.trim().length > 50 && !p.startsWith("#")
    );

    if (firstParagraph) {
      const cleaned = firstParagraph
        .replace(/[#*`]/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .trim();

      return cleaned.length > maxLength
        ? cleaned.substring(0, maxLength) + "..."
        : cleaned;
    }

    return "";
  }

  // 제목 추출
  extractTitle(content) {
    const match = content.match(this.patterns.title);
    return match ? match[1].trim() : "";
  }

  // 구조 분석
  analyzeStructure(content) {
    const headings = [];
    let match;

    while ((match = this.patterns.headings.exec(content)) !== null) {
      const level = match[0].indexOf(" ");
      headings.push({
        level: level,
        text: match[1],
        position: match.index,
      });
    }

    return {
      headings,
      hasGoodStructure: headings.length >= 3,
      maxDepth: Math.max(...headings.map((h) => h.level), 0),
    };
  }
}

// 전역 초기화
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    window.contentManager = new ContentManager();
  });
} else {
  window.contentManager = new ContentManager();
}

// 개발자 도구 API
window.ContentAPI = {
  getTemplates: () => window.contentManager?.templates || {},
  applyTemplate: (key) => window.contentManager?.applyTemplate(key),
  generateTags: (content) =>
    window.contentManager?.recommendationEngine?.recommendTags(content),
  generateSummary: (content) =>
    window.contentManager?.metadataGenerator?.generateSummary(content),
};

console.log("[ContentManager] 컨텐츠 관리 시스템 로드 완료");
