// ===== 분석 및 통계 시스템 (Phase 3.3) =====

class BlogAnalytics {
  constructor() {
    this.pageViews = this.loadPageViews();
    this.popularPosts = [];
    this.searchKeywords = this.loadSearchKeywords();
    this.init();
  }

  init() {
    this.trackPageView();
    this.createPopularPostsWidget();
    this.createSearchAnalyticsWidget();
    this.setupUserBehaviorTracking();
    this.startPeriodicUpdates();
  }

  // 페이지 뷰 추적
  trackPageView() {
    const currentPage = window.location.pathname;
    const currentTime = Date.now();

    // 페이지 뷰 데이터 업데이트
    if (!this.pageViews[currentPage]) {
      this.pageViews[currentPage] = {
        count: 0,
        title: document.title,
        lastView: currentTime,
        firstView: currentTime,
        totalTime: 0,
        bounceRate: 0,
      };
    }

    this.pageViews[currentPage].count++;
    this.pageViews[currentPage].lastView = currentTime;

    // 로컬 스토리지에 저장
    this.savePageViews();

    // Google Analytics로 전송 (설정된 경우)
    if (typeof gtag !== "undefined") {
      gtag("event", "page_view", {
        page_title: document.title,
        page_location: window.location.href,
        page_path: currentPage,
      });
    }

    // 실시간 조회수 업데이트
    this.updatePopularPosts();
  }

  loadPageViews() {
    try {
      return JSON.parse(localStorage.getItem("blog_page_views") || "{}");
    } catch (e) {
      console.warn("페이지 뷰 데이터 로드 실패:", e);
      return {};
    }
  }

  savePageViews() {
    try {
      localStorage.setItem("blog_page_views", JSON.stringify(this.pageViews));
    } catch (e) {
      console.warn("페이지 뷰 데이터 저장 실패:", e);
    }
  }

  // 인기 포스트 위젯
  createPopularPostsWidget() {
    this.updatePopularPosts();

    const widget = document.createElement("div");
    widget.id = "popular-posts-widget";
    widget.className = "analytics-widget popular-posts";
    widget.innerHTML = `
            <div class="widget-header">
                <h3 class="widget-title">📈 인기 포스트</h3>
                <button class="widget-toggle" aria-label="위젯 토글">−</button>
            </div>
            <div class="widget-content">
                <div class="popular-posts-list">
                    ${this.renderPopularPosts()}
                </div>
                <div class="widget-stats">
                    <small>총 ${
                      Object.keys(this.pageViews).length
                    }개 페이지 추적 중</small>
                </div>
            </div>
        `;

    // 사이드바나 푸터에 위젯 추가
    this.insertWidget(widget);

    // 토글 기능
    this.setupWidgetToggle(widget);
  }

  updatePopularPosts() {
    const postPages = Object.entries(this.pageViews)
      .filter(([path, data]) => path.includes("/posts/"))
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 5);

    this.popularPosts = postPages.map(([path, data]) => ({
      path,
      title: data.title.replace(" | jyukki's Blog", ""),
      count: data.count,
      lastView: data.lastView,
    }));
  }

  renderPopularPosts() {
    if (this.popularPosts.length === 0) {
      return '<p class="no-data">아직 인기 포스트 데이터가 없습니다.</p>';
    }

    return this.popularPosts
      .map(
        (post, index) => `
            <div class="popular-post-item" data-rank="${index + 1}">
                <div class="post-rank">${index + 1}</div>
                <div class="post-info">
                    <a href="${post.path}" class="post-title">${post.title}</a>
                    <div class="post-meta">
                        <span class="view-count">👁️ ${post.count}회</span>
                        <span class="last-view">${this.formatLastView(
                          post.lastView
                        )}</span>
                    </div>
                </div>
            </div>
        `
      )
      .join("");
  }

  formatLastView(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "방금 전";
    if (minutes < 60) return `${minutes}분 전`;
    if (hours < 24) return `${hours}시간 전`;
    if (days < 7) return `${days}일 전`;
    return new Date(timestamp).toLocaleDateString();
  }

  // 검색 키워드 분석
  loadSearchKeywords() {
    try {
      return JSON.parse(localStorage.getItem("blog_search_keywords") || "{}");
    } catch (e) {
      return {};
    }
  }

  saveSearchKeywords() {
    try {
      localStorage.setItem(
        "blog_search_keywords",
        JSON.stringify(this.searchKeywords)
      );
    } catch (e) {
      console.warn("검색 키워드 데이터 저장 실패:", e);
    }
  }

  trackSearchKeyword(keyword, resultsCount) {
    if (!keyword || keyword.length < 2) return;

    const normalizedKeyword = keyword.toLowerCase().trim();
    const currentTime = Date.now();

    if (!this.searchKeywords[normalizedKeyword]) {
      this.searchKeywords[normalizedKeyword] = {
        count: 0,
        lastSearched: currentTime,
        firstSearched: currentTime,
        avgResults: 0,
        totalResults: 0,
      };
    }

    const keywordData = this.searchKeywords[normalizedKeyword];
    keywordData.count++;
    keywordData.lastSearched = currentTime;
    keywordData.totalResults += resultsCount;
    keywordData.avgResults = Math.round(
      keywordData.totalResults / keywordData.count
    );

    this.saveSearchKeywords();

    // Google Analytics 전송
    if (typeof trackSearch !== "undefined") {
      trackSearch(keyword, resultsCount);
    }

    this.updateSearchAnalytics();
  }

  createSearchAnalyticsWidget() {
    const widget = document.createElement("div");
    widget.id = "search-analytics-widget";
    widget.className = "analytics-widget search-analytics";
    widget.innerHTML = `
            <div class="widget-header">
                <h3 class="widget-title">🔍 검색 분석</h3>
                <button class="widget-toggle" aria-label="위젯 토글">−</button>
            </div>
            <div class="widget-content">
                <div class="search-keywords-list">
                    ${this.renderSearchKeywords()}
                </div>
            </div>
        `;

    this.insertWidget(widget);
    this.setupWidgetToggle(widget);
  }

  updateSearchAnalytics() {
    const keywordsList = document.querySelector(".search-keywords-list");
    if (keywordsList) {
      keywordsList.innerHTML = this.renderSearchKeywords();
    }
  }

  renderSearchKeywords() {
    const topKeywords = Object.entries(this.searchKeywords)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 10);

    if (topKeywords.length === 0) {
      return '<p class="no-data">검색 키워드 데이터가 없습니다.</p>';
    }

    return topKeywords
      .map(
        ([keyword, data], index) => `
            <div class="search-keyword-item">
                <div class="keyword-rank">${index + 1}</div>
                <div class="keyword-info">
                    <span class="keyword-text">"${keyword}"</span>
                    <div class="keyword-meta">
                        <span class="search-count">${data.count}회</span>
                        <span class="avg-results">평균 ${
                          data.avgResults
                        }개 결과</span>
                    </div>
                </div>
            </div>
        `
      )
      .join("");
  }

  // 사용자 행동 분석
  setupUserBehaviorTracking() {
    this.behaviorData = {
      scrollDepth: 0,
      timeOnPage: Date.now(),
      clickPattern: [],
      readingSpeed: 0,
    };

    // 스크롤 깊이 추적
    let maxScroll = 0;
    window.addEventListener("scroll", () => {
      const scrollPercent = Math.round(
        (window.scrollY /
          (document.documentElement.scrollHeight - window.innerHeight)) *
          100
      );
      maxScroll = Math.max(maxScroll, scrollPercent);
      this.behaviorData.scrollDepth = maxScroll;
    });

    // 클릭 패턴 추적
    document.addEventListener("click", (e) => {
      this.behaviorData.clickPattern.push({
        element: e.target.tagName,
        className: e.target.className,
        timestamp: Date.now(),
      });

      // 최근 20개 클릭만 유지
      if (this.behaviorData.clickPattern.length > 20) {
        this.behaviorData.clickPattern.shift();
      }
    });

    // 페이지 종료 시 데이터 저장
    window.addEventListener("beforeunload", () => {
      this.saveBehaviorData();
    });

    // 읽기 속도 계산 (대략적)
    this.calculateReadingSpeed();
  }

  calculateReadingSpeed() {
    const content = document.querySelector(".post-content");
    if (content) {
      const wordCount = content.textContent.split(/\s+/).length;
      const startTime = Date.now();

      // 5초 후부터 읽기 속도 계산 시작
      setTimeout(() => {
        const readingTime = (Date.now() - startTime) / 1000 / 60; // 분 단위
        this.behaviorData.readingSpeed = Math.round(wordCount / readingTime);
      }, 5000);
    }
  }

  saveBehaviorData() {
    const currentPage = window.location.pathname;
    const timeSpent = Date.now() - this.behaviorData.timeOnPage;

    const behaviorSummary = {
      page: currentPage,
      timeSpent: Math.round(timeSpent / 1000), // 초 단위
      scrollDepth: this.behaviorData.scrollDepth,
      clickCount: this.behaviorData.clickPattern.length,
      readingSpeed: this.behaviorData.readingSpeed,
      timestamp: Date.now(),
    };

    // 로컬 스토리지에 저장
    const behaviorHistory = JSON.parse(
      localStorage.getItem("user_behavior") || "[]"
    );
    behaviorHistory.push(behaviorSummary);

    // 최근 100개 세션만 유지
    if (behaviorHistory.length > 100) {
      behaviorHistory.shift();
    }

    localStorage.setItem("user_behavior", JSON.stringify(behaviorHistory));

    // Google Analytics로 전송
    if (typeof gtag !== "undefined") {
      gtag("event", "user_behavior", {
        event_category: "engagement",
        scroll_depth: this.behaviorData.scrollDepth,
        time_spent: Math.round(timeSpent / 1000),
        reading_speed: this.behaviorData.readingSpeed,
      });
    }
  }

  // 위젯 관리
  insertWidget(widget) {
    // 우선순위: sidebar > aside > main content 하단
    let targetContainer =
      document.querySelector(".sidebar") ||
      document.querySelector("aside") ||
      document.querySelector("main");

    if (!targetContainer) {
      targetContainer =
        document.querySelector(".post-content") ||
        document.querySelector(".content") ||
        document.body;
    }

    targetContainer.appendChild(widget);
  }

  setupWidgetToggle(widget) {
    const toggle = widget.querySelector(".widget-toggle");
    const content = widget.querySelector(".widget-content");

    toggle.addEventListener("click", () => {
      const isCollapsed = content.style.display === "none";
      content.style.display = isCollapsed ? "block" : "none";
      toggle.textContent = isCollapsed ? "−" : "+";

      // 상태 저장
      const widgetId = widget.id;
      localStorage.setItem(`widget_${widgetId}_collapsed`, !isCollapsed);
    });

    // 저장된 상태 복원
    const widgetId = widget.id;
    const isCollapsed =
      localStorage.getItem(`widget_${widgetId}_collapsed`) === "true";
    if (isCollapsed) {
      content.style.display = "none";
      toggle.textContent = "+";
    }
  }

  // 주기적 업데이트
  startPeriodicUpdates() {
    // 5분마다 인기 포스트 업데이트
    setInterval(() => {
      this.updatePopularPosts();
      const popularPostsList = document.querySelector(".popular-posts-list");
      if (popularPostsList) {
        popularPostsList.innerHTML = this.renderPopularPosts();
      }
    }, 300000);
  }

  // 통계 대시보드 생성
  createAnalyticsDashboard() {
    const dashboard = document.createElement("div");
    dashboard.id = "analytics-dashboard";
    dashboard.className = "analytics-dashboard";
    dashboard.innerHTML = `
            <div class="dashboard-header">
                <h2>📊 블로그 통계</h2>
                <button class="dashboard-close">×</button>
            </div>
            <div class="dashboard-content">
                <div class="stats-grid">
                    <div class="stat-card">
                        <h3>총 페이지 뷰</h3>
                        <div class="stat-value">${this.getTotalPageViews()}</div>
                    </div>
                    <div class="stat-card">
                        <h3>총 검색 횟수</h3>
                        <div class="stat-value">${this.getTotalSearches()}</div>
                    </div>
                    <div class="stat-card">
                        <h3>평균 세션 시간</h3>
                        <div class="stat-value">${this.getAverageSessionTime()}</div>
                    </div>
                    <div class="stat-card">
                        <h3>활성 포스트</h3>
                        <div class="stat-value">${this.getActivePostsCount()}</div>
                    </div>
                </div>
                <div class="charts-section">
                    <div class="chart-container">
                        <h3>페이지별 조회수</h3>
                        <div id="page-views-chart"></div>
                    </div>
                </div>
            </div>
        `;

    document.body.appendChild(dashboard);

    // 대시보드 닫기
    dashboard
      .querySelector(".dashboard-close")
      .addEventListener("click", () => {
        dashboard.remove();
      });

    this.renderPageViewsChart();
  }

  getTotalPageViews() {
    return Object.values(this.pageViews).reduce(
      (sum, page) => sum + page.count,
      0
    );
  }

  getTotalSearches() {
    return Object.values(this.searchKeywords).reduce(
      (sum, keyword) => sum + keyword.count,
      0
    );
  }

  getAverageSessionTime() {
    const behaviorHistory = JSON.parse(
      localStorage.getItem("user_behavior") || "[]"
    );
    if (behaviorHistory.length === 0) return "0분";

    const totalTime = behaviorHistory.reduce(
      (sum, session) => sum + session.timeSpent,
      0
    );
    const avgTime = totalTime / behaviorHistory.length;

    return avgTime > 60
      ? `${Math.round(avgTime / 60)}분`
      : `${Math.round(avgTime)}초`;
  }

  getActivePostsCount() {
    return Object.keys(this.pageViews).filter((path) =>
      path.includes("/posts/")
    ).length;
  }

  renderPageViewsChart() {
    // 간단한 막대 차트 렌더링
    const chartContainer = document.getElementById("page-views-chart");
    const maxViews = Math.max(
      ...Object.values(this.pageViews).map((p) => p.count)
    );

    const chartHTML = Object.entries(this.pageViews)
      .filter(([path]) => path.includes("/posts/"))
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 10)
      .map(([path, data]) => {
        const percentage = (data.count / maxViews) * 100;
        const title = data.title.replace(" | jyukki's Blog", "");
        return `
                    <div class="chart-bar">
                        <div class="bar-label">${title}</div>
                        <div class="bar-container">
                            <div class="bar" style="width: ${percentage}%"></div>
                            <span class="bar-value">${data.count}</span>
                        </div>
                    </div>
                `;
      })
      .join("");

    chartContainer.innerHTML = chartHTML;
  }

  // 데이터 내보내기
  exportAnalyticsData() {
    const data = {
      pageViews: this.pageViews,
      searchKeywords: this.searchKeywords,
      userBehavior: JSON.parse(localStorage.getItem("user_behavior") || "[]"),
      exportDate: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blog-analytics-${
      new Date().toISOString().split("T")[0]
    }.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// 검색 함수와 연동
if (typeof window.performSearch === "function") {
  const originalSearch = window.performSearch;
  window.performSearch = function (query) {
    const results = originalSearch(query);

    // 검색 키워드 추적
    if (window.blogAnalytics) {
      window.blogAnalytics.trackSearchKeyword(query, results.length);
    }

    return results;
  };
}

// 전역 초기화
document.addEventListener("DOMContentLoaded", () => {
  window.blogAnalytics = new BlogAnalytics();
});

// 개발자 도구 함수
window.showAnalyticsDashboard = () => {
  if (window.blogAnalytics) {
    window.blogAnalytics.createAnalyticsDashboard();
  }
};

window.exportAnalytics = () => {
  if (window.blogAnalytics) {
    window.blogAnalytics.exportAnalyticsData();
  }
};
