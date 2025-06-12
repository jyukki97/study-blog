// ===== 동적 기능 추가 시스템 (Phase 5.1) =====

class DynamicFeatures {
  constructor() {
    this.tocHighlighter = null;
    this.infiniteScroll = null;
    this.lightbox = null;
    this.codeThemeSelector = null;
    this.bookmarkManager = null;

    this.init();
  }

  async init() {
    console.log("[Dynamic] 동적 기능 초기화 시작...");

    // 실시간 목차 하이라이팅
    this.initTOCHighlighting();

    // 무한 스크롤 (포스트 목록 페이지)
    if (this.isPostListPage()) {
      this.initInfiniteScroll();
    }

    // 이미지 갤러리/라이트박스
    this.initLightbox();

    // 코드 하이라이팅 테마 선택
    this.initCodeThemeSelector();

    // 포스트 즐겨찾기
    this.initBookmarkSystem();

    console.log("[Dynamic] 동적 기능 초기화 완료");
  }

  // 실시간 목차 하이라이팅
  initTOCHighlighting() {
    const toc = document.querySelector(".toc, #TableOfContents");
    const headings = document.querySelectorAll("h1, h2, h3, h4, h5, h6");

    if (!toc || headings.length === 0) return;

    this.tocHighlighter = new TOCHighlighter(toc, headings);
  }

  // 페이지 타입 확인
  isPostListPage() {
    return (
      window.location.pathname === "/posts/" ||
      window.location.pathname.includes("/page/") ||
      window.location.pathname.includes("/categories/") ||
      window.location.pathname.includes("/tags/")
    );
  }

  // 무한 스크롤
  initInfiniteScroll() {
    const postsContainer = document.querySelector(
      ".post-list, .posts-container, .main"
    );
    if (!postsContainer) return;

    this.infiniteScroll = new InfiniteScroll(postsContainer);
  }

  // 라이트박스
  initLightbox() {
    const images = document.querySelectorAll("img:not(.no-lightbox)");
    if (images.length === 0) return;

    this.lightbox = new ImageLightbox(images);
  }

  // 코드 테마 선택기
  initCodeThemeSelector() {
    const codeBlocks = document.querySelectorAll("pre code, .highlight");
    if (codeBlocks.length === 0) return;

    this.codeThemeSelector = new CodeThemeSelector(codeBlocks);
  }

  // 북마크 시스템
  initBookmarkSystem() {
    if (!document.querySelector("article, .post")) return;

    this.bookmarkManager = new BookmarkManager();
  }
}

// TOC 하이라이팅 클래스
class TOCHighlighter {
  constructor(toc, headings) {
    this.toc = toc;
    this.headings = Array.from(headings);
    this.tocLinks = {};
    this.activeHeading = null;

    this.setup();
    this.startObserving();
  }

  setup() {
    // TOC 링크와 헤딩 매핑
    const tocLinks = this.toc.querySelectorAll('a[href^="#"]');

    tocLinks.forEach((link) => {
      const href = link.getAttribute("href");
      const targetId = href.substring(1);
      const targetHeading = document.getElementById(targetId);

      if (targetHeading) {
        this.tocLinks[targetId] = link;

        // 스무스 스크롤 추가
        link.addEventListener("click", (e) => {
          e.preventDefault();
          this.scrollToHeading(targetHeading);
        });
      }
    });

    // TOC 스타일 개선
    this.enhanceTOCStyles();
  }

  enhanceTOCStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .toc, #TableOfContents {
        position: sticky;
        top: 100px;
        max-height: calc(100vh - 200px);
        overflow-y: auto;
        padding: 20px;
        background: white;
        border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        transition: all 0.3s ease;
      }

      .toc ul, #TableOfContents ul {
        list-style: none;
        padding-left: 0;
        margin: 0;
      }

      .toc li, #TableOfContents li {
        margin: 8px 0;
      }

      .toc a, #TableOfContents a {
        display: block;
        padding: 8px 12px;
        color: #666;
        text-decoration: none;
        border-radius: 6px;
        transition: all 0.2s ease;
        position: relative;
        overflow: hidden;
      }

      .toc a:hover, #TableOfContents a:hover {
        background: #f0f0f0;
        color: #b19cd9;
        transform: translateX(4px);
      }

      .toc a.active, #TableOfContents a.active {
        background: linear-gradient(135deg, #b19cd9, #9a7bc8);
        color: white;
        font-weight: 600;
        transform: translateX(8px);
        box-shadow: 0 2px 10px rgba(177, 156, 217, 0.3);
      }

      .toc a.active::before, #TableOfContents a.active::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background: #fff;
        opacity: 0.8;
      }

      .toc ul ul a, #TableOfContents ul ul a {
        padding-left: 24px;
        font-size: 0.9em;
      }

      .toc ul ul ul a, #TableOfContents ul ul ul a {
        padding-left: 36px;
        font-size: 0.85em;
      }

      /* 다크모드 지원 */
      [data-theme="dark"] .toc,
      [data-theme="dark"] #TableOfContents {
        background: #2d3748;
        color: #e2e8f0;
      }

      [data-theme="dark"] .toc a,
      [data-theme="dark"] #TableOfContents a {
        color: #a0aec0;
      }

      [data-theme="dark"] .toc a:hover,
      [data-theme="dark"] #TableOfContents a:hover {
        background: #4a5568;
        color: #b19cd9;
      }

      /* 모바일 대응 */
      @media (max-width: 768px) {
        .toc, #TableOfContents {
          position: static;
          max-height: none;
          margin: 20px 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  startObserving() {
    const observerOptions = {
      rootMargin: "-100px 0px -66%",
      threshold: 0,
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const headingId = entry.target.id;
        const tocLink = this.tocLinks[headingId];

        if (entry.isIntersecting) {
          this.setActiveHeading(tocLink);
        }
      });
    }, observerOptions);

    this.headings.forEach((heading) => {
      if (heading.id) {
        observer.observe(heading);
      }
    });
  }

  setActiveHeading(activeLink) {
    // 이전 활성 링크 제거
    if (this.activeHeading) {
      this.activeHeading.classList.remove("active");
    }

    // 새 활성 링크 설정
    if (activeLink) {
      activeLink.classList.add("active");
      this.activeHeading = activeLink;

      // TOC 스크롤 조정
      this.scrollTOCToActive(activeLink);
    }
  }

  scrollTOCToActive(activeLink) {
    const tocContainer = this.toc;
    const linkRect = activeLink.getBoundingClientRect();
    const tocRect = tocContainer.getBoundingClientRect();

    if (linkRect.top < tocRect.top || linkRect.bottom > tocRect.bottom) {
      activeLink.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }

  scrollToHeading(heading) {
    const headerOffset = 100; // 고정 헤더 높이 고려
    const headingPosition = heading.offsetTop - headerOffset;

    window.scrollTo({
      top: headingPosition,
      behavior: "smooth",
    });
  }
}

// 무한 스크롤 클래스
class InfiniteScroll {
  constructor(container) {
    this.container = container;
    this.currentPage = 1;
    this.isLoading = false;
    this.hasMorePages = true;
    this.posts = [];

    this.setup();
  }

  setup() {
    // 기존 포스트 수집
    this.collectExistingPosts();

    // 로딩 인디케이터 생성
    this.createLoadingIndicator();

    // 무한 스크롤 관찰자 시작
    this.startObserving();

    console.log("[InfiniteScroll] 무한 스크롤 초기화 완료");
  }

  collectExistingPosts() {
    const postElements = this.container.querySelectorAll(
      ".post-entry, article, .post-item"
    );
    this.posts = Array.from(postElements).map((post) => ({
      element: post,
      title: post.querySelector("h1, h2, h3, .post-title")?.textContent,
      url: post.querySelector("a")?.href,
      excerpt: post.querySelector(".post-excerpt, .summary")?.textContent,
    }));
  }

  createLoadingIndicator() {
    this.loadingIndicator = document.createElement("div");
    this.loadingIndicator.className = "infinite-scroll-loading";
    this.loadingIndicator.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <p>더 많은 포스트를 불러오는 중...</p>
      </div>
    `;

    this.container.appendChild(this.loadingIndicator);
    this.hideLoadingIndicator();

    // CSS 스타일 추가
    this.addLoadingStyles();
  }

  addLoadingStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .infinite-scroll-loading {
        display: none;
        text-align: center;
        padding: 40px 20px;
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .infinite-scroll-loading.visible {
        display: block;
        opacity: 1;
      }

      .loading-spinner {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
      }

      .spinner {
        width: 40px;
        height: 40px;
        border: 3px solid #f3f3f3;
        border-top: 3px solid #b19cd9;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      .loading-spinner p {
        color: #666;
        margin: 0;
        font-size: 14px;
      }

      .end-of-posts {
        text-align: center;
        padding: 40px 20px;
        color: #666;
        font-style: italic;
      }

      .end-of-posts::before {
        content: '📝';
        display: block;
        font-size: 2em;
        margin-bottom: 10px;
      }
    `;
    document.head.appendChild(style);
  }

  startObserving() {
    const observerOptions = {
      rootMargin: "100px",
      threshold: 0.1,
    };

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && this.hasMorePages && !this.isLoading) {
          this.loadMorePosts();
        }
      });
    }, observerOptions);

    this.observer.observe(this.loadingIndicator);
  }

  async loadMorePosts() {
    if (this.isLoading || !this.hasMorePages) return;

    this.isLoading = true;
    this.showLoadingIndicator();

    try {
      const nextPage = this.currentPage + 1;
      const response = await fetch(`/page/${nextPage}/`);

      if (response.ok) {
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        const newPosts = doc.querySelectorAll(
          ".post-entry, article, .post-item"
        );

        if (newPosts.length > 0) {
          this.appendNewPosts(newPosts);
          this.currentPage = nextPage;
        } else {
          this.hasMorePages = false;
          this.showEndMessage();
        }
      } else {
        this.hasMorePages = false;
        this.showEndMessage();
      }
    } catch (error) {
      console.error("[InfiniteScroll] 포스트 로딩 오류:", error);
      this.showErrorMessage();
    } finally {
      this.isLoading = false;
      this.hideLoadingIndicator();
    }
  }

  appendNewPosts(newPosts) {
    const fragment = document.createDocumentFragment();

    Array.from(newPosts).forEach((post, index) => {
      // 포스트 요소 복제
      const clonedPost = post.cloneNode(true);

      // 애니메이션 효과
      clonedPost.style.opacity = "0";
      clonedPost.style.transform = "translateY(20px)";

      fragment.appendChild(clonedPost);

      // 애니메이션 적용
      setTimeout(() => {
        clonedPost.style.transition = "opacity 0.5s ease, transform 0.5s ease";
        clonedPost.style.opacity = "1";
        clonedPost.style.transform = "translateY(0)";
      }, index * 100);
    });

    this.container.insertBefore(fragment, this.loadingIndicator);
  }

  showLoadingIndicator() {
    this.loadingIndicator.classList.add("visible");
  }

  hideLoadingIndicator() {
    this.loadingIndicator.classList.remove("visible");
  }

  showEndMessage() {
    this.loadingIndicator.innerHTML = `
      <div class="end-of-posts">
        더 이상 불러올 포스트가 없습니다.
      </div>
    `;
    this.loadingIndicator.classList.add("visible");
  }

  showErrorMessage() {
    this.loadingIndicator.innerHTML = `
      <div class="error-message" style="color: #ff6b6b; text-align: center; padding: 20px;">
        ❌ 포스트를 불러오는 중 오류가 발생했습니다.
        <button onclick="location.reload()" style="margin-left: 10px; padding: 5px 10px; background: #b19cd9; color: white; border: none; border-radius: 5px; cursor: pointer;">
          새로고침
        </button>
      </div>
    `;
    this.loadingIndicator.classList.add("visible");
  }
}

// 코드 테마 선택기 클래스
class CodeThemeSelector {
  constructor(codeBlocks) {
    this.codeBlocks = Array.from(codeBlocks);
    this.themes = {
      "github-light": {
        name: "깃허브 라이트",
        url: "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.8.0/build/styles/github.min.css",
      },
      "github-dark": {
        name: "깃허브 다크",
        url: "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.8.0/build/styles/github-dark.min.css",
      },
      vs: {
        name: "Visual Studio",
        url: "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.8.0/build/styles/vs.min.css",
      },
      vs2015: {
        name: "Visual Studio 2015",
        url: "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.8.0/build/styles/vs2015.min.css",
      },
      "atom-one-light": {
        name: "Atom One Light",
        url: "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.8.0/build/styles/atom-one-light.min.css",
      },
      "atom-one-dark": {
        name: "Atom One Dark",
        url: "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.8.0/build/styles/atom-one-dark.min.css",
      },
      dracula: {
        name: "Dracula",
        url: "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.8.0/build/styles/dracula.min.css",
      },
      monokai: {
        name: "Monokai",
        url: "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.8.0/build/styles/monokai.min.css",
      },
    };

    this.currentTheme = localStorage.getItem("code-theme") || "github-light";
    this.setup();
  }

  setup() {
    this.createThemeSelector();
    this.applyTheme(this.currentTheme);
    console.log("[CodeTheme] 코드 테마 선택기 초기화 완료");
  }

  createThemeSelector() {
    const selector = document.createElement("div");
    selector.className = "code-theme-selector";
    selector.innerHTML = `
      <div class="theme-selector-header">
        <span class="theme-icon">🎨</span>
        <span>코드 테마</span>
        <button class="theme-toggle-btn">▼</button>
      </div>
      <div class="theme-selector-dropdown">
        ${Object.entries(this.themes)
          .map(
            ([key, theme]) => `
          <div class="theme-option ${
            key === this.currentTheme ? "active" : ""
          }" data-theme="${key}">
            <span class="theme-name">${theme.name}</span>
            <div class="theme-preview">
              <span class="preview-keyword">function</span>
              <span class="preview-string">"hello"</span>
              <span class="preview-comment">// world</span>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    `;

    // 첫 번째 코드 블록 근처에 삽입
    if (this.codeBlocks.length > 0) {
      const firstCodeBlock = this.codeBlocks[0];
      const container =
        firstCodeBlock.closest("article, .content, .post") || document.body;
      container.insertBefore(selector, firstCodeBlock);
    }

    this.addThemeSelectorStyles();
    this.attachThemeSelectorListeners(selector);
  }

  addThemeSelectorStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .code-theme-selector {
        position: relative;
        display: inline-block;
        margin: 20px 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        user-select: none;
      }

      .theme-selector-header {
        background: #f8f9fa;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        padding: 12px 16px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: all 0.2s ease;
        min-width: 200px;
      }

      .theme-selector-header:hover {
        background: #e9ecef;
        transform: translateY(-1px);
      }

      .theme-icon {
        font-size: 16px;
      }

      .theme-toggle-btn {
        background: none;
        border: none;
        margin-left: auto;
        color: #666;
        transition: transform 0.2s ease;
      }

      .code-theme-selector.open .theme-toggle-btn {
        transform: rotate(180deg);
      }

      .theme-selector-dropdown {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: white;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        z-index: 1000;
        opacity: 0;
        transform: translateY(-10px);
        visibility: hidden;
        transition: all 0.3s ease;
        max-height: 300px;
        overflow-y: auto;
      }

      .code-theme-selector.open .theme-selector-dropdown {
        opacity: 1;
        transform: translateY(0);
        visibility: visible;
      }

      .theme-option {
        padding: 12px 16px;
        cursor: pointer;
        border-bottom: 1px solid #f0f0f0;
        transition: background 0.2s ease;
      }

      .theme-option:hover {
        background: #f8f9fa;
      }

      .theme-option.active {
        background: #b19cd9;
        color: white;
      }

      .theme-option:last-child {
        border-bottom: none;
      }

      .theme-name {
        display: block;
        font-weight: 500;
        margin-bottom: 4px;
      }

      .theme-preview {
        font-family: 'Monaco', 'Consolas', monospace;
        font-size: 12px;
        opacity: 0.8;
      }

      .preview-keyword {
        color: #0066cc;
        font-weight: bold;
      }

      .preview-string {
        color: #009900;
      }

      .preview-comment {
        color: #999;
        font-style: italic;
      }

      .theme-option.active .preview-keyword,
      .theme-option.active .preview-string,
      .theme-option.active .preview-comment {
        color: rgba(255,255,255,0.9);
      }

      /* 다크모드 지원 */
      [data-theme="dark"] .theme-selector-header {
        background: #374151;
        border-color: #4b5563;
        color: #e5e7eb;
      }

      [data-theme="dark"] .theme-selector-header:hover {
        background: #4b5563;
      }

      [data-theme="dark"] .theme-selector-dropdown {
        background: #374151;
        border-color: #4b5563;
      }

      [data-theme="dark"] .theme-option {
        color: #e5e7eb;
        border-color: #4b5563;
      }

      [data-theme="dark"] .theme-option:hover {
        background: #4b5563;
      }
    `;
    document.head.appendChild(style);
  }

  attachThemeSelectorListeners(selector) {
    const header = selector.querySelector(".theme-selector-header");
    const dropdown = selector.querySelector(".theme-selector-dropdown");

    // 헤더 클릭으로 드롭다운 토글
    header.addEventListener("click", () => {
      selector.classList.toggle("open");
    });

    // 외부 클릭으로 드롭다운 닫기
    document.addEventListener("click", (e) => {
      if (!selector.contains(e.target)) {
        selector.classList.remove("open");
      }
    });

    // 테마 옵션 클릭
    dropdown.addEventListener("click", (e) => {
      const option = e.target.closest(".theme-option");
      if (!option) return;

      const theme = option.dataset.theme;
      this.changeTheme(theme);

      // 활성 옵션 업데이트
      dropdown.querySelectorAll(".theme-option").forEach((opt) => {
        opt.classList.remove("active");
      });
      option.classList.add("active");

      // 드롭다운 닫기
      selector.classList.remove("open");
    });
  }

  applyTheme(themeName) {
    // 기존 테마 스타일 제거
    const existingTheme = document.querySelector("#code-theme-style");
    if (existingTheme) {
      existingTheme.remove();
    }

    // 새 테마 스타일 적용
    if (this.themes[themeName]) {
      const link = document.createElement("link");
      link.id = "code-theme-style";
      link.rel = "stylesheet";
      link.href = this.themes[themeName].url;
      document.head.appendChild(link);
    }
  }

  changeTheme(themeName) {
    this.currentTheme = themeName;
    localStorage.setItem("code-theme", themeName);
    this.applyTheme(themeName);

    // GA 이벤트 전송
    if (typeof gtag !== "undefined") {
      gtag("event", "code_theme_change", {
        event_category: "customization",
        event_label: themeName,
      });
    }
  }
}

// 북마크 시스템 클래스
class BookmarkManager {
  constructor() {
    this.bookmarks = this.loadBookmarks();
    this.currentPage = {
      url: window.location.pathname,
      title: document.title,
      timestamp: Date.now(),
    };

    this.setup();
  }

  setup() {
    this.createBookmarkButton();
    this.createBookmarkPanel();
    this.updateBookmarkButton();
    console.log("[Bookmark] 북마크 시스템 초기화 완료");
  }

  createBookmarkButton() {
    const button = document.createElement("button");
    button.className = "bookmark-btn";
    button.innerHTML = `
      <span class="bookmark-icon">🔖</span>
      <span class="bookmark-text">북마크</span>
    `;

    // 포스트 헤더나 적절한 위치에 삽입
    const target =
      document.querySelector(".post-header, .entry-header, h1") ||
      document.querySelector("article, main");

    if (target) {
      target.appendChild(button);
    }

    this.addBookmarkStyles();
    this.attachBookmarkListeners(button);
  }

  addBookmarkStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .bookmark-btn {
        background: linear-gradient(135deg, #b19cd9, #9a7bc8);
        color: white;
        border: none;
        border-radius: 25px;
        padding: 10px 20px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: all 0.3s ease;
        margin: 10px 0;
        box-shadow: 0 2px 10px rgba(177, 156, 217, 0.3);
      }

      .bookmark-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 15px rgba(177, 156, 217, 0.4);
      }

      .bookmark-btn.bookmarked {
        background: linear-gradient(135deg, #ff6b6b, #ee5a52);
      }

      .bookmark-btn.bookmarked .bookmark-icon::before {
        content: '❤️';
      }

      .bookmark-panel {
        position: fixed;
        top: 50%;
        right: -400px;
        width: 350px;
        height: 60%;
        background: white;
        border-radius: 15px 0 0 15px;
        box-shadow: -5px 0 25px rgba(0,0,0,0.2);
        z-index: 10000;
        transition: right 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        transform: translateY(-50%);
        display: flex;
        flex-direction: column;
      }

      .bookmark-panel.open {
        right: 0;
      }

      .bookmark-panel-header {
        background: linear-gradient(135deg, #b19cd9, #9a7bc8);
        color: white;
        padding: 20px;
        border-radius: 15px 0 0 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .bookmark-panel-title {
        font-size: 18px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .bookmark-close-btn {
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }

      .bookmark-close-btn:hover {
        background: rgba(255,255,255,0.3);
      }

      .bookmark-list {
        flex: 1;
        overflow-y: auto;
        padding: 0;
        margin: 0;
        list-style: none;
      }

      .bookmark-item {
        padding: 15px 20px;
        border-bottom: 1px solid #f0f0f0;
        cursor: pointer;
        transition: background 0.2s;
        position: relative;
      }

      .bookmark-item:hover {
        background: #f8f9fa;
      }

      .bookmark-item-title {
        font-weight: 500;
        color: #333;
        text-decoration: none;
        display: block;
        margin-bottom: 5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .bookmark-item-date {
        font-size: 12px;
        color: #666;
      }

      .bookmark-item-remove {
        position: absolute;
        top: 50%;
        right: 15px;
        transform: translateY(-50%);
        background: #ff6b6b;
        color: white;
        border: none;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 12px;
        display: none;
        align-items: center;
        justify-content: center;
      }

      .bookmark-item:hover .bookmark-item-remove {
        display: flex;
      }

      .bookmark-empty {
        text-align: center;
        padding: 40px 20px;
        color: #666;
        font-style: italic;
      }

      .bookmark-empty::before {
        content: '📚';
        display: block;
        font-size: 3em;
        margin-bottom: 10px;
      }

      .bookmark-toggle {
        position: fixed;
        top: 50%;
        right: 10px;
        transform: translateY(-50%);
        background: #b19cd9;
        color: white;
        border: none;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 1.5rem;
        z-index: 10001;
        box-shadow: 0 4px 15px rgba(177, 156, 217, 0.3);
        transition: all 0.3s ease;
      }

      .bookmark-toggle:hover {
        background: #9a7bc8;
        transform: translateY(-50%) scale(1.1);
      }

      /* 다크모드 지원 */
      [data-theme="dark"] .bookmark-panel {
        background: #2d3748;
        color: #e2e8f0;
      }

      [data-theme="dark"] .bookmark-item {
        border-color: #4a5568;
      }

      [data-theme="dark"] .bookmark-item:hover {
        background: #374151;
      }

      [data-theme="dark"] .bookmark-item-title {
        color: #e2e8f0;
      }

      [data-theme="dark"] .bookmark-item-date {
        color: #a0aec0;
      }

      /* 모바일 대응 */
      @media (max-width: 768px) {
        .bookmark-panel {
          width: 90%;
          right: -90%;
        }

        .bookmark-toggle {
          right: 20px;
          bottom: 20px;
          top: auto;
          transform: none;
        }

        .bookmark-toggle:hover {
          transform: scale(1.1);
        }
      }
    `;
    document.head.appendChild(style);
  }

  createBookmarkPanel() {
    const panel = document.createElement("div");
    panel.className = "bookmark-panel";
    panel.innerHTML = `
      <div class="bookmark-panel-header">
        <div class="bookmark-panel-title">
          <span>📚</span>
          북마크 목록
        </div>
        <button class="bookmark-close-btn">×</button>
      </div>
      <ul class="bookmark-list">
        ${this.renderBookmarkList()}
      </ul>
    `;

    document.body.appendChild(panel);

    // 토글 버튼 생성
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "bookmark-toggle";
    toggleBtn.innerHTML = "📚";
    toggleBtn.title = "북마크 목록";
    document.body.appendChild(toggleBtn);

    this.attachPanelListeners(panel, toggleBtn);
  }

  attachBookmarkListeners(button) {
    button.addEventListener("click", () => {
      this.toggleBookmark();
    });
  }

  attachPanelListeners(panel, toggleBtn) {
    // 패널 토글
    toggleBtn.addEventListener("click", () => {
      panel.classList.toggle("open");
    });

    // 닫기 버튼
    panel.querySelector(".bookmark-close-btn").addEventListener("click", () => {
      panel.classList.remove("open");
    });

    // 북마크 항목 클릭
    panel.addEventListener("click", (e) => {
      if (e.target.classList.contains("bookmark-item-remove")) {
        // 삭제 버튼
        const item = e.target.closest(".bookmark-item");
        const url = item.dataset.url;
        this.removeBookmark(url);
        this.updateBookmarkPanel();
      } else if (e.target.closest(".bookmark-item")) {
        // 북마크 항목
        const item = e.target.closest(".bookmark-item");
        const url = item.dataset.url;
        window.location.href = url;
      }
    });
  }

  toggleBookmark() {
    const isBookmarked = this.isBookmarked(this.currentPage.url);

    if (isBookmarked) {
      this.removeBookmark(this.currentPage.url);
    } else {
      this.addBookmark(this.currentPage);
    }

    this.updateBookmarkButton();
    this.updateBookmarkPanel();
  }

  addBookmark(page) {
    this.bookmarks[page.url] = {
      title: page.title,
      timestamp: page.timestamp,
    };

    this.saveBookmarks();

    // GA 이벤트 전송
    if (typeof gtag !== "undefined") {
      gtag("event", "bookmark_add", {
        event_category: "engagement",
        event_label: page.url,
      });
    }
  }

  removeBookmark(url) {
    delete this.bookmarks[url];
    this.saveBookmarks();

    // GA 이벤트 전송
    if (typeof gtag !== "undefined") {
      gtag("event", "bookmark_remove", {
        event_category: "engagement",
        event_label: url,
      });
    }
  }

  isBookmarked(url) {
    return !!this.bookmarks[url];
  }

  updateBookmarkButton() {
    const button = document.querySelector(".bookmark-btn");
    if (!button) return;

    const isBookmarked = this.isBookmarked(this.currentPage.url);
    const text = button.querySelector(".bookmark-text");

    button.classList.toggle("bookmarked", isBookmarked);
    text.textContent = isBookmarked ? "북마크됨" : "북마크";
  }

  updateBookmarkPanel() {
    const list = document.querySelector(".bookmark-list");
    if (!list) return;

    list.innerHTML = this.renderBookmarkList();
  }

  renderBookmarkList() {
    const bookmarkEntries = Object.entries(this.bookmarks).sort(
      ([, a], [, b]) => b.timestamp - a.timestamp
    );

    if (bookmarkEntries.length === 0) {
      return '<li class="bookmark-empty">저장된 북마크가 없습니다.</li>';
    }

    return bookmarkEntries
      .map(
        ([url, data]) => `
      <li class="bookmark-item" data-url="${url}">
        <a href="${url}" class="bookmark-item-title">${data.title}</a>
        <div class="bookmark-item-date">${this.formatDate(data.timestamp)}</div>
        <button class="bookmark-item-remove">×</button>
      </li>
    `
      )
      .join("");
  }

  formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return "오늘";
    } else if (diffDays === 1) {
      return "어제";
    } else if (diffDays < 7) {
      return `${diffDays}일 전`;
    } else {
      return date.toLocaleDateString("ko-KR");
    }
  }

  saveBookmarks() {
    localStorage.setItem("blog_bookmarks", JSON.stringify(this.bookmarks));
  }

  loadBookmarks() {
    const saved = localStorage.getItem("blog_bookmarks");
    return saved ? JSON.parse(saved) : {};
  }
}

// 이미지 라이트박스 클래스
class ImageLightbox {
  constructor(images) {
    this.images = Array.from(images);
    this.currentIndex = 0;
    this.lightboxElement = null;

    this.setup();
  }

  setup() {
    this.createLightbox();
    this.attachImageListeners();
    console.log("[Lightbox] 이미지 라이트박스 초기화 완료");
  }

  createLightbox() {
    this.lightboxElement = document.createElement("div");
    this.lightboxElement.className = "image-lightbox";
    this.lightboxElement.innerHTML = `
      <div class="lightbox-backdrop"></div>
      <div class="lightbox-container">
        <button class="lightbox-close">&times;</button>
        <button class="lightbox-prev">‹</button>
        <button class="lightbox-next">›</button>
        <img class="lightbox-image" src="" alt="">
        <div class="lightbox-caption"></div>
        <div class="lightbox-counter">
          <span class="current-index">1</span> / <span class="total-images">${this.images.length}</span>
        </div>
      </div>
    `;

    document.body.appendChild(this.lightboxElement);
    this.addLightboxStyles();
    this.attachLightboxListeners();
  }

  addLightboxStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .image-lightbox {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 10000;
        display: none;
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .image-lightbox.active {
        display: flex;
        opacity: 1;
      }

      .lightbox-backdrop {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.9);
        backdrop-filter: blur(5px);
      }

      .lightbox-container {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        padding: 20px;
        box-sizing: border-box;
      }

      .lightbox-image {
        max-width: 90%;
        max-height: 80%;
        object-fit: contain;
        border-radius: 8px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        transition: transform 0.3s ease;
      }

      .lightbox-image:hover {
        transform: scale(1.02);
      }

      .lightbox-close {
        position: absolute;
        top: 20px;
        right: 20px;
        background: rgba(255,255,255,0.1);
        border: none;
        color: white;
        font-size: 2rem;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s ease;
        backdrop-filter: blur(10px);
      }

      .lightbox-close:hover {
        background: rgba(255,255,255,0.2);
        transform: scale(1.1);
      }

      .lightbox-prev,
      .lightbox-next {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        background: rgba(255,255,255,0.1);
        border: none;
        color: white;
        font-size: 2rem;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s ease;
        backdrop-filter: blur(10px);
      }

      .lightbox-prev {
        left: 20px;
      }

      .lightbox-next {
        right: 20px;
      }

      .lightbox-prev:hover,
      .lightbox-next:hover {
        background: rgba(255,255,255,0.2);
        transform: translateY(-50%) scale(1.1);
      }

      .lightbox-caption {
        color: white;
        text-align: center;
        margin-top: 20px;
        font-size: 16px;
        max-width: 80%;
        text-shadow: 0 2px 4px rgba(0,0,0,0.5);
      }

      .lightbox-counter {
        position: absolute;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        color: white;
        background: rgba(0,0,0,0.5);
        padding: 8px 16px;
        border-radius: 20px;
        font-size: 14px;
        backdrop-filter: blur(10px);
      }

      /* 모바일 대응 */
      @media (max-width: 768px) {
        .lightbox-prev,
        .lightbox-next {
          width: 50px;
          height: 50px;
          font-size: 1.5rem;
        }

        .lightbox-prev {
          left: 10px;
        }

        .lightbox-next {
          right: 10px;
        }

        .lightbox-close {
          top: 10px;
          right: 10px;
          width: 40px;
          height: 40px;
          font-size: 1.5rem;
        }

        .lightbox-image {
          max-width: 95%;
          max-height: 70%;
        }
      }
    `;
    document.head.appendChild(style);
  }

  attachImageListeners() {
    this.images.forEach((img, index) => {
      img.style.cursor = "zoom-in";
      img.addEventListener("click", () => {
        this.openLightbox(index);
      });
    });
  }

  attachLightboxListeners() {
    // 닫기 버튼
    this.lightboxElement
      .querySelector(".lightbox-close")
      .addEventListener("click", () => {
        this.closeLightbox();
      });

    // 배경 클릭으로 닫기
    this.lightboxElement
      .querySelector(".lightbox-backdrop")
      .addEventListener("click", () => {
        this.closeLightbox();
      });

    // 이전/다음 버튼
    this.lightboxElement
      .querySelector(".lightbox-prev")
      .addEventListener("click", () => {
        this.showPrevious();
      });

    this.lightboxElement
      .querySelector(".lightbox-next")
      .addEventListener("click", () => {
        this.showNext();
      });

    // 키보드 이벤트
    document.addEventListener("keydown", (e) => {
      if (!this.lightboxElement.classList.contains("active")) return;

      switch (e.key) {
        case "Escape":
          this.closeLightbox();
          break;
        case "ArrowLeft":
          this.showPrevious();
          break;
        case "ArrowRight":
          this.showNext();
          break;
      }
    });
  }

  openLightbox(index) {
    this.currentIndex = index;
    this.updateLightboxContent();
    this.lightboxElement.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  closeLightbox() {
    this.lightboxElement.classList.remove("active");
    document.body.style.overflow = "";
  }

  showPrevious() {
    this.currentIndex =
      (this.currentIndex - 1 + this.images.length) % this.images.length;
    this.updateLightboxContent();
  }

  showNext() {
    this.currentIndex = (this.currentIndex + 1) % this.images.length;
    this.updateLightboxContent();
  }

  updateLightboxContent() {
    const currentImage = this.images[this.currentIndex];
    const lightboxImage = this.lightboxElement.querySelector(".lightbox-image");
    const caption = this.lightboxElement.querySelector(".lightbox-caption");
    const counter = this.lightboxElement.querySelector(".current-index");

    lightboxImage.src = currentImage.src;
    lightboxImage.alt = currentImage.alt;
    caption.textContent = currentImage.alt || currentImage.title || "";
    counter.textContent = this.currentIndex + 1;

    // 이전/다음 버튼 표시/숨김
    const prevBtn = this.lightboxElement.querySelector(".lightbox-prev");
    const nextBtn = this.lightboxElement.querySelector(".lightbox-next");

    prevBtn.style.display = this.images.length > 1 ? "flex" : "none";
    nextBtn.style.display = this.images.length > 1 ? "flex" : "none";
  }
}

// DOM 로드 완료 후 초기화
let dynamicFeatures;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    dynamicFeatures = new DynamicFeatures();
  });
} else {
  dynamicFeatures = new DynamicFeatures();
}

// 전역 함수로 노출 (디버깅용)
window.DynamicFeatures = {
  instance: () => dynamicFeatures,
  TOCHighlighter,
  InfiniteScroll,
  ImageLightbox,
};

console.log("[Dynamic] 동적 기능 시스템 로드 완료");
