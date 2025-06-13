// ===== 고급 분석 및 통계 시스템 (Phase 3.3) =====
// Cache version: v2.1 - Updated 2025-06-13

class BlogAnalytics {
  constructor() {
    this.pageViews = this.loadPageViews();
    this.sessionData = this.initSession();
    this.searchKeywords = this.loadSearchKeywords();
    this.userBehavior = this.loadUserBehavior();
    this.realTimeVisitors = new Set();
    this.popularPosts = [];
    this.isInitialized = false;

    this.init();
  }

  async init() {
    console.log("[Analytics] 초기화 시작...");

    // Google Analytics 4 초기화
    await this.initializeGA4();

    // 페이지 뷰 추적
    this.trackPageView();

    // 사용자 행동 추적
    this.setupUserBehaviorTracking();

    // 실시간 방문자 추적
    this.startRealTimeTracking();

    // 주기적 업데이트
    this.startPeriodicUpdates();

    this.isInitialized = true;
    console.log("[Analytics] 초기화 완료");
  }

  // Google Analytics 4 초기화
  async initializeGA4() {
    const gaId = this.getGAMeasurementID();
    if (!gaId) {
      console.warn("[Analytics] Google Analytics ID가 설정되지 않았습니다");
      return;
    }

    try {
      // GA4 스크립트 로드
      if (!window.gtag) {
        await this.loadGA4Script(gaId);
      }

      // GA4 설정
      gtag("config", gaId, {
        page_title: document.title,
        page_location: window.location.href,
        custom_map: {
          custom_parameter_1: "blog_category",
          custom_parameter_2: "reading_time",
        },
        anonymize_ip: true,
        allow_google_signals: false,
        send_page_view: false, // 수동으로 처리
      });

      console.log("[Analytics] Google Analytics 4 초기화 완료");
    } catch (error) {
      console.error("[Analytics] GA4 초기화 실패:", error);
    }
  }

  // GA4 스크립트 로드
  loadGA4Script(gaId) {
    return new Promise((resolve, reject) => {
      // gtag 스크립트
      const gtagScript = document.createElement("script");
      gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
      gtagScript.async = true;
      gtagScript.onload = () => {
        // gtag 함수 초기화
        window.dataLayer = window.dataLayer || [];
        window.gtag = function () {
          dataLayer.push(arguments);
        };
        gtag("js", new Date());
        resolve();
      };
      gtagScript.onerror = reject;
      document.head.appendChild(gtagScript);
    });
  }

  // GA Measurement ID 가져오기
  getGAMeasurementID() {
    // hugo.toml에서 설정된 ID 확인
    const metaTag = document.querySelector('meta[name="google-analytics"]');
    return metaTag ? metaTag.content : null;
  }

  // 세션 초기화
  initSession() {
    const sessionId = this.generateSessionId();
    const sessionData = {
      id: sessionId,
      startTime: Date.now(),
      pageViews: 0,
      totalScrollDepth: 0,
      totalTimeOnSite: 0,
      referrer: document.referrer,
      userAgent: navigator.userAgent,
      screenResolution: `${screen.width}x${screen.height}`,
      language: navigator.language,
    };

    sessionStorage.setItem("analytics_session", JSON.stringify(sessionData));
    return sessionData;
  }

  // 세션 ID 생성
  generateSessionId() {
    return (
      "session_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9)
    );
  }

  // 페이지 뷰 추적
  trackPageView() {
    const currentPage = window.location.pathname;
    const currentTime = Date.now();

    // 세션 업데이트
    this.sessionData.pageViews++;
    this.updateSession();

    // 페이지 뷰 데이터 업데이트
    if (!this.pageViews[currentPage]) {
      this.pageViews[currentPage] = {
        count: 0,
        title: document.title,
        category: this.getPageCategory(),
        readingTime: this.estimateReadingTime(),
        firstView: currentTime,
        lastView: currentTime,
        totalTime: 0,
        bounceCount: 0,
        exitCount: 0,
        tags: this.getPageTags(),
      };
    }

    this.pageViews[currentPage].count++;
    this.pageViews[currentPage].lastView = currentTime;
    this.pageViews[currentPage].title = document.title;

    // 로컬 스토리지에 저장
    this.savePageViews();

    // Google Analytics로 전송
    this.sendPageViewToGA(currentPage);

    // 실시간 조회수 업데이트
    this.updateRealTimeViews();
  }

  // GA로 페이지뷰 전송
  sendPageViewToGA(currentPage) {
    if (typeof gtag !== "undefined") {
      gtag("event", "page_view", {
        page_title: document.title,
        page_location: window.location.href,
        page_path: currentPage,
        blog_category: this.getPageCategory(),
        reading_time: this.estimateReadingTime(),
        custom_parameter_1: this.getPageCategory(),
        custom_parameter_2: this.estimateReadingTime(),
      });
    }
  }

  // 페이지 카테고리 감지
  getPageCategory() {
    const path = window.location.pathname;
    if (path.includes("/posts/")) {
      const categoryMeta = document.querySelector('meta[name="category"]');
      return categoryMeta ? categoryMeta.content : "blog";
    }
    if (path.includes("/categories/")) return "categories";
    if (path.includes("/tags/")) return "tags";
    if (path === "/") return "home";
    return "page";
  }

  // 페이지 태그 가져오기
  getPageTags() {
    const tagsMeta = document.querySelector('meta[name="keywords"]');
    return tagsMeta ? tagsMeta.content.split(",").map((tag) => tag.trim()) : [];
  }

  // 읽기 시간 추정
  estimateReadingTime() {
    const content = document.querySelector(".post-content, .content, main");
    if (!content) return 0;

    const text = content.textContent || content.innerText || "";
    const wordsPerMinute = 200; // 한국어 기준
    const wordCount = text.trim().split(/\s+/).length;
    return Math.ceil(wordCount / wordsPerMinute);
  }

  // 세션 업데이트
  updateSession() {
    this.sessionData.totalTimeOnSite = Date.now() - this.sessionData.startTime;
    sessionStorage.setItem(
      "analytics_session",
      JSON.stringify(this.sessionData)
    );
  }

  // 사용자 행동 추적 설정
  setupUserBehaviorTracking() {
    // 스크롤 깊이 추적
    this.trackScrollDepth();

    // 클릭 이벤트 추적
    this.trackClickEvents();

    // 체류 시간 추적
    this.trackTimeOnPage();

    // 이탈 추적
    this.trackBounceRate();

    // 검색 이벤트 추적
    this.trackSearchEvents();
  }

  // 스크롤 깊이 추적
  trackScrollDepth() {
    let maxScrollDepth = 0;
    let scrollCheckpoints = [25, 50, 75, 100];
    let triggeredCheckpoints = new Set();

    const updateScrollDepth = () => {
      const scrollPercent = Math.round(
        (window.scrollY /
          (document.documentElement.scrollHeight - window.innerHeight)) *
          100
      );

      maxScrollDepth = Math.max(maxScrollDepth, scrollPercent);

      // 체크포인트 이벤트 전송
      scrollCheckpoints.forEach((checkpoint) => {
        if (
          scrollPercent >= checkpoint &&
          !triggeredCheckpoints.has(checkpoint)
        ) {
          triggeredCheckpoints.add(checkpoint);
          this.sendScrollEvent(checkpoint);
        }
      });

      this.sessionData.totalScrollDepth = maxScrollDepth;
      this.updateSession();
    };

    window.addEventListener("scroll", this.throttle(updateScrollDepth, 100));
  }

  // 스크롤 이벤트 전송
  sendScrollEvent(percentage) {
    if (typeof gtag !== "undefined") {
      gtag("event", "scroll", {
        event_category: "engagement",
        event_label: `${percentage}%`,
        value: percentage,
      });
    }
  }

  // 클릭 이벤트 추적
  trackClickEvents() {
    document.addEventListener("click", (event) => {
      const target = event.target.closest("a, button, .clickable");
      if (!target) return;

      const eventData = {
        element_type: target.tagName.toLowerCase(),
        element_class: target.className,
        element_id: target.id,
        element_text: target.textContent?.trim().substring(0, 50),
        page_path: window.location.pathname,
      };

      // 외부 링크 추적
      if (target.tagName === "A" && target.href) {
        const isExternal = !target.href.startsWith(window.location.origin);
        if (isExternal) {
          eventData.link_domain = new URL(target.href).hostname;
          this.sendClickEvent("outbound_link", eventData);
        } else {
          this.sendClickEvent("internal_link", eventData);
        }
      } else {
        this.sendClickEvent("element_click", eventData);
      }
    });
  }

  // 클릭 이벤트 전송
  sendClickEvent(eventName, data) {
    if (typeof gtag !== "undefined") {
      gtag("event", eventName, {
        event_category: "interaction",
        ...data,
      });
    }
  }

  // 페이지 체류 시간 추적
  trackTimeOnPage() {
    const startTime = Date.now();

    const sendTimeEvent = () => {
      const timeOnPage = Math.round((Date.now() - startTime) / 1000);

      if (typeof gtag !== "undefined") {
        gtag("event", "timing_complete", {
          event_category: "engagement",
          name: "time_on_page",
          value: timeOnPage,
        });
      }
    };

    // 페이지 떠날 때 시간 전송
    window.addEventListener("beforeunload", sendTimeEvent);
    window.addEventListener("pagehide", sendTimeEvent);
  }

  // 이탈률 추적
  trackBounceRate() {
    const currentPage = window.location.pathname;
    const sessionPageViews = this.sessionData.pageViews;
    const timeOnPage = Date.now() - this.sessionData.startTime;

    // 30초 이상 머물거나 2페이지 이상 방문시 non-bounce
    if (sessionPageViews > 1 || timeOnPage > 30000) {
      // Non-bounce 이벤트
      if (typeof gtag !== "undefined") {
        gtag("event", "engagement", {
          event_category: "user_behavior",
          event_label: "non_bounce",
        });
      }
    }
  }

  // 검색 이벤트 추적
  trackSearchEvents() {
    // 검색 폼 감지
    const searchInputs = document.querySelectorAll(
      'input[type="search"], .search-input, #search'
    );

    searchInputs.forEach((input) => {
      input.addEventListener("keyup", (event) => {
        if (event.key === "Enter" && input.value.trim()) {
          this.trackSearchKeyword(input.value.trim());
        }
      });
    });

    // 검색 버튼 감지
    const searchButtons = document.querySelectorAll(
      ".search-btn, .search-button, [data-search]"
    );
    searchButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const searchInput =
          button.closest("form")?.querySelector("input") ||
          document.querySelector('input[type="search"]');
        if (searchInput && searchInput.value.trim()) {
          this.trackSearchKeyword(searchInput.value.trim());
        }
      });
    });
  }

  // 검색 키워드 추적
  trackSearchKeyword(keyword) {
    const currentTime = Date.now();

    // 로컬 데이터 업데이트
    if (!this.searchKeywords[keyword]) {
      this.searchKeywords[keyword] = {
        count: 0,
        firstSearch: currentTime,
        lastSearch: currentTime,
      };
    }

    this.searchKeywords[keyword].count++;
    this.searchKeywords[keyword].lastSearch = currentTime;

    this.saveSearchKeywords();

    // GA 이벤트 전송
    if (typeof gtag !== "undefined") {
      gtag("event", "search", {
        event_category: "engagement",
        search_term: keyword,
      });
    }
  }

  // 실시간 방문자 추적 시작
  startRealTimeTracking() {
    // 방문자 ID 생성 또는 기존 ID 사용
    let visitorId = localStorage.getItem("visitor_id");
    if (!visitorId) {
      visitorId =
        "visitor_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
      localStorage.setItem("visitor_id", visitorId);
    }

    // 실시간 방문자 목록에 추가
    this.realTimeVisitors.add(visitorId);

    // 주기적으로 실시간 데이터 업데이트
    this.updateRealTimeViews();

    // 5분마다 방문자 상태 갱신
    setInterval(() => {
      this.updateRealTimeViews();
    }, 5 * 60 * 1000);
  }

  // 실시간 조회수 업데이트
  updateRealTimeViews() {
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    // 5분 이내 방문자 수 계산 (로컬 데이터 기반)
    const recentViewers = Object.values(this.pageViews).filter(
      (page) => page.lastView > fiveMinutesAgo
    ).length;

    // 실시간 위젯 업데이트
    this.updateRealTimeWidget(Math.max(recentViewers, 1));
  }

  // 실시간 위젯 업데이트
  updateRealTimeWidget(viewerCount) {
    const countElement = document.querySelector(
      ".realtime-count .count-number"
    );
    const todayViewsElement = document.getElementById("today-views");
    const totalViewsElement = document.getElementById("total-views");

    if (countElement) {
      countElement.textContent = viewerCount;

      // 애니메이션 효과
      countElement.classList.add("updated");
      setTimeout(() => countElement.classList.remove("updated"), 500);
    }

    if (todayViewsElement) {
      const todayViews = this.getTodayViews();
      todayViewsElement.textContent = todayViews.toLocaleString();
    }

    if (totalViewsElement) {
      const totalViews = this.getTotalViews();
      totalViewsElement.textContent = totalViews.toLocaleString();
    }
  }

  // 위젯 삽입
  insertWidget(widget) {
    // 사이드바나 푸터에 위젯 삽입
    let container =
      document.querySelector(".analytics-container") ||
      document.querySelector(".sidebar") ||
      document.querySelector(".widget-area") ||
      document.querySelector("footer");

    if (!container) {
      // 컨테이너가 없으면 body 하단에 생성
      container = document.createElement("div");
      container.className = "analytics-container";
      document.body.appendChild(container);
    }

    container.appendChild(widget);
  }

  // 유틸리티 메서드들
  getPopularPosts() {
    return Object.entries(this.pageViews)
      .filter(([path]) => path.includes("/posts/"))
      .map(([path, data]) => ({
        path,
        title: data.title,
        count: data.count,
        trend: this.getViewTrend(data),
        trendIcon: this.getTrendIcon(data),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  getTopSearchKeywords() {
    const keywords = Object.entries(this.searchKeywords)
      .map(([term, data]) => ({ term, count: data.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const maxCount = keywords[0]?.count || 1;
    return keywords.map((keyword) => ({
      ...keyword,
      percentage: (keyword.count / maxCount) * 100,
    }));
  }

  getTodayViews() {
    const today = new Date().toDateString();
    return Object.values(this.pageViews)
      .filter((page) => new Date(page.lastView).toDateString() === today)
      .reduce((sum, page) => sum + page.count, 0);
  }

  getTotalViews() {
    return Object.values(this.pageViews).reduce(
      (sum, page) => sum + page.count,
      0
    );
  }

  getUserBehaviorData() {
    const sessions = Object.values(this.pageViews);
    const totalSessions = sessions.length || 1;

    return {
      avgTimeOnPage: this.formatTime(
        sessions.reduce((sum, page) => sum + page.totalTime, 0) / totalSessions
      ),
      bounceRate: Math.round(
        (sessions.filter((page) => page.bounceCount > 0).length /
          totalSessions) *
          100
      ),
      pagesPerSession: (this.sessionData.pageViews / totalSessions).toFixed(1),
      avgScrollDepth: Math.round(this.sessionData.totalScrollDepth),
    };
  }

  getViewTrend(pageData) {
    // 최근 7일과 이전 7일 비교
    const now = Date.now();
    const week = 7 * 24 * 60 * 60 * 1000;
    const recentViews = pageData.lastView > now - week ? pageData.count : 0;

    return recentViews > pageData.count * 0.7 ? "up" : "down";
  }

  getTrendIcon(pageData) {
    const trend = this.getViewTrend(pageData);
    return trend === "up" ? "📈" : "📉";
  }

  formatTime(milliseconds) {
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    return `${minutes}분 ${seconds}초`;
  }

  // 주기적 업데이트
  startPeriodicUpdates() {
    // 1분마다 위젯 업데이트
    setInterval(() => {
      this.updateRealTimeViews();
    }, 60000);

    // 5분마다 데이터 저장
    setInterval(() => {
      this.saveAllData();
    }, 5 * 60000);
  }

  // 데이터 저장 메서드들
  savePageViews() {
    localStorage.setItem("blog_page_views", JSON.stringify(this.pageViews));
  }

  loadPageViews() {
    const saved = localStorage.getItem("blog_page_views");
    return saved ? JSON.parse(saved) : {};
  }

  saveSearchKeywords() {
    localStorage.setItem(
      "blog_search_keywords",
      JSON.stringify(this.searchKeywords)
    );
  }

  loadSearchKeywords() {
    const saved = localStorage.getItem("blog_search_keywords");
    return saved ? JSON.parse(saved) : {};
  }

  saveUserBehavior() {
    localStorage.setItem(
      "blog_user_behavior",
      JSON.stringify(this.userBehavior)
    );
  }

  loadUserBehavior() {
    const saved = localStorage.getItem("blog_user_behavior");
    return saved
      ? JSON.parse(saved)
      : {
          sessions: [],
          totalTimeOnSite: 0,
          totalPageViews: 0,
        };
  }

  saveAllData() {
    this.savePageViews();
    this.saveSearchKeywords();
    this.saveUserBehavior();
  }

  // 유틸리티 함수
  throttle(func, limit) {
    let inThrottle;
    return function () {
      const args = arguments;
      const context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  }

  // 디버그 정보
  getDebugInfo() {
    return {
      pageViews: Object.keys(this.pageViews).length,
      searchKeywords: Object.keys(this.searchKeywords).length,
      sessionData: this.sessionData,
      realTimeVisitors: this.realTimeVisitors.size,
      isInitialized: this.isInitialized,
    };
  }
}

// CSS 스타일 추가
const analyticsCSS = `
  .analytics-container {
    position: fixed;
    top: 50%;
    right: 20px;
    transform: translateY(-50%);
    z-index: 1000;
    max-width: 300px;
  }

  .analytics-widget {
    background: white;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    margin-bottom: 16px;
    overflow: hidden;
    transition: all 0.3s ease;
  }

  .analytics-widget:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(0,0,0,0.15);
  }

  .widget-header {
    background: linear-gradient(135deg, #b19cd9 0%, #9a7bc8 100%);
    color: white;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .widget-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    flex: 1;
  }

  .widget-icon {
    font-size: 16px;
  }

  .pulse-indicator {
    width: 8px;
    height: 8px;
    background: #4CAF50;
    border-radius: 50%;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.2); }
  }

  .widget-content {
    padding: 16px;
  }

  .realtime-count {
    text-align: center;
    margin-bottom: 16px;
  }

  .count-number {
    display: block;
    font-size: 2em;
    font-weight: bold;
    color: #4CAF50;
    transition: all 0.3s ease;
  }

  .count-number.updated {
    transform: scale(1.2);
    color: #ff9800;
  }

  .count-label {
    font-size: 12px;
    color: #666;
  }

  .realtime-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .stat-item {
    text-align: center;
    padding: 8px;
    background: #f8f9fa;
    border-radius: 6px;
  }

  .stat-value {
    display: block;
    font-weight: bold;
    color: #333;
  }

  .stat-label {
    font-size: 11px;
    color: #666;
  }

  .popular-posts-list, .search-keywords-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .popular-post-item, .keyword-item {
    display: flex;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid #eee;
  }

  .popular-post-item:last-child, .keyword-item:last-child {
    border-bottom: none;
  }

  .post-rank {
    background: #b19cd9;
    color: white;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: bold;
    margin-right: 8px;
  }

  .post-info {
    flex: 1;
    min-width: 0;
  }

  .post-title {
    display: block;
    color: #333;
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .post-stats, .keyword-stats {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 10px;
    color: #666;
  }

  .keyword-text {
    flex: 1;
    font-size: 12px;
    color: #333;
  }

  .keyword-bar {
    width: 40px;
    height: 4px;
    background: #eee;
    border-radius: 2px;
    overflow: hidden;
  }

  .keyword-progress {
    height: 100%;
    background: #b19cd9;
    transition: width 0.3s ease;
  }

  .behavior-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .behavior-item {
    text-align: center;
    padding: 8px;
    background: #f8f9fa;
    border-radius: 6px;
  }

  .behavior-label {
    display: block;
    font-size: 10px;
    color: #666;
    margin-bottom: 4px;
  }

  .behavior-value {
    display: block;
    font-weight: bold;
    color: #333;
    font-size: 12px;
  }

  /* 다크모드 지원 */
  [data-theme="dark"] .analytics-widget {
    background: #2d3748;
    color: #e2e8f0;
  }

  [data-theme="dark"] .post-title,
  [data-theme="dark"] .keyword-text,
  [data-theme="dark"] .behavior-value {
    color: #e2e8f0;
  }

  [data-theme="dark"] .stat-item,
  [data-theme="dark"] .behavior-item {
    background: #4a5568;
  }

  [data-theme="dark"] .stat-label,
  [data-theme="dark"] .behavior-label {
    color: #a0aec0;
  }

  /* 모바일 대응 */
  @media (max-width: 768px) {
    .analytics-container {
      position: static;
      right: auto;
      top: auto;
      transform: none;
      max-width: 100%;
      margin: 20px;
    }

    .analytics-widget {
      margin-bottom: 12px;
    }

    .realtime-stats,
    .behavior-stats {
      grid-template-columns: 1fr;
    }
  }

  /* 인쇄시 숨김 */
  @media print {
    .analytics-container {
      display: none;
    }
  }
`;

// CSS 주입
const style = document.createElement("style");
style.textContent = analyticsCSS;
document.head.appendChild(style);

// Analytics 초기화
let blogAnalytics;

// DOM 로드 완료 후 초기화
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    blogAnalytics = new BlogAnalytics();
  });
} else {
  blogAnalytics = new BlogAnalytics();
}

// 전역 함수로 노출 (디버깅용)
window.BlogAnalytics = {
  instance: () => blogAnalytics,
  getDebugInfo: () => blogAnalytics?.getDebugInfo(),
  forceUpdate: () => blogAnalytics?.updateRealTimeViews(),
};

console.log("[Analytics] Blog Analytics 시스템 로드 완료");
