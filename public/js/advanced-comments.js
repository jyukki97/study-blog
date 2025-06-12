// ===== 고급 댓글 시스템 (Phase 3.2) =====

class AdvancedComments {
  constructor() {
    this.init();
    this.setupSpamFilter();
    this.setupCommentPreview();
    this.setupNotifications();
    this.setupReplySystem();
  }

  init() {
    // 댓글 로딩 상태 표시
    this.showLoadingState();

    // Giscus 이벤트 리스너
    window.addEventListener("message", (event) => {
      if (event.origin !== "https://giscus.app") return;
      this.handleGiscusMessage(event.data);
    });
  }

  showLoadingState() {
    const container = document.querySelector(".giscus-container");
    if (container) {
      container.innerHTML = `
                <div class="comments-loading">
                    <div class="comments-spinner"></div>
                    <p>댓글을 불러오는 중...</p>
                </div>
            `;
    }
  }

  handleGiscusMessage(data) {
    if (data.giscus?.discussion) {
      this.hideLoadingState();
      this.updateCommentCount(data.giscus.discussion);
      this.enableAdvancedFeatures();
    }
  }

  hideLoadingState() {
    const loading = document.querySelector(".comments-loading");
    if (loading) {
      loading.remove();
    }
  }

  updateCommentCount(discussion) {
    const count = discussion.totalCommentCount || 0;
    const header = document.querySelector(".comments-title");

    if (header && !header.querySelector(".comments-count")) {
      const counter = document.createElement("span");
      counter.className = "comments-count";
      counter.textContent = count;
      header.appendChild(counter);
    }
  }

  // 스팸 필터링 시스템
  setupSpamFilter() {
    this.spamKeywords = [
      "광고",
      "홍보",
      "클릭",
      "바로가기",
      "추천",
      "카지노",
      "대출",
      "무료",
      "이벤트",
      "혜택",
      "할인",
      "수익",
    ];

    this.spamPatterns = [
      /https?:\/\/[^\s]+/gi, // URL 패턴
      /\d{3}-\d{3,4}-\d{4}/g, // 전화번호 패턴
      /[가-힣]{2,}\s*\d+/g, // 업체명+숫자 패턴
    ];
  }

  isSpamContent(text) {
    // 키워드 기반 검사
    const hasSpamKeyword = this.spamKeywords.some((keyword) =>
      text.toLowerCase().includes(keyword.toLowerCase())
    );

    // 패턴 기반 검사
    const hasSpamPattern = this.spamPatterns.some((pattern) =>
      pattern.test(text)
    );

    // 반복 문자/단어 검사
    const hasRepeatedChars = /(.)\1{5,}/.test(text);
    const hasRepeatedWords = /(\b\w+\b)(\s+\1){3,}/gi.test(text);

    return (
      hasSpamKeyword || hasSpamPattern || hasRepeatedChars || hasRepeatedWords
    );
  }

  // 댓글 미리보기 시스템
  setupCommentPreview() {
    // 미리보기 모달 이벤트
    document.addEventListener("click", (e) => {
      if (e.target.matches(".close-preview-btn")) {
        this.closePreview();
      }
    });

    // ESC 키로 미리보기 닫기
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.closePreview();
      }
    });
  }

  showPreview(content) {
    const preview = document.getElementById("comments-preview");
    const previewContent = preview.querySelector(".preview-content");

    previewContent.innerHTML = this.formatPreviewContent(content);
    preview.style.display = "block";

    // 포커스 관리
    preview.querySelector(".close-preview-btn").focus();
  }

  closePreview() {
    const preview = document.getElementById("comments-preview");
    preview.style.display = "none";
  }

  formatPreviewContent(content) {
    // 마크다운 기본 렌더링
    return content
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/`(.*?)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br>");
  }

  // 알림 시스템
  setupNotifications() {
    this.notificationQueue = [];
    this.isShowingNotification = false;
  }

  showNotification(message, type = "info", duration = 3000) {
    this.notificationQueue.push({ message, type, duration });
    this.processNotificationQueue();
  }

  processNotificationQueue() {
    if (this.isShowingNotification || this.notificationQueue.length === 0) {
      return;
    }

    this.isShowingNotification = true;
    const { message, type, duration } = this.notificationQueue.shift();

    const notification = document.getElementById("comment-notification");
    const notificationText = notification.querySelector(".notification-text");
    const notificationIcon = notification.querySelector(".notification-icon");

    // 타입별 아이콘 설정
    const icons = {
      info: "📢",
      success: "✅",
      warning: "⚠️",
      error: "❌",
    };

    notificationIcon.textContent = icons[type] || icons.info;
    notificationText.textContent = message;
    notification.style.display = "block";

    // 자동 숨김
    setTimeout(() => {
      notification.style.display = "none";
      this.isShowingNotification = false;

      // 큐에 남은 알림 처리
      setTimeout(() => this.processNotificationQueue(), 300);
    }, duration);
  }

  // 대댓글 시스템 지원
  setupReplySystem() {
    // GitHub Discussions 대댓글 기능 활용
    this.observeCommentChanges();
  }

  observeCommentChanges() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "childList") {
          this.processNewComments(mutation.addedNodes);
        }
      });
    });

    // Giscus iframe 로드 후 관찰 시작
    setTimeout(() => {
      const giscusFrame = document.querySelector("iframe.giscus-frame");
      if (giscusFrame) {
        try {
          observer.observe(giscusFrame.contentDocument.body, {
            childList: true,
            subtree: true,
          });
        } catch (e) {
          // Cross-origin 제한으로 직접 관찰 불가능
          console.log("댓글 변경 감지를 위해 메시지 기반 통신을 사용합니다.");
        }
      }
    }, 2000);
  }

  processNewComments(nodes) {
    nodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        // 새 댓글에 대한 추가 기능 적용
        this.enhanceComment(node);
      }
    });
  }

  enhanceComment(commentElement) {
    // 스팸 검사
    const textContent = commentElement.textContent || "";
    if (this.isSpamContent(textContent)) {
      this.markAsSpam(commentElement);
    }

    // 대댓글 표시 개선
    this.improveReplyDisplay(commentElement);
  }

  markAsSpam(element) {
    const indicator = document.createElement("div");
    indicator.className = "spam-indicator";
    indicator.textContent = "스팸 의심";
    element.prepend(indicator);
  }

  improveReplyDisplay(element) {
    // 대댓글 들여쓰기 및 연결선 추가
    if (element.querySelector("[data-reply-to]")) {
      element.classList.add("reply-comment");
    }
  }

  enableAdvancedFeatures() {
    this.showNotification("댓글 시스템이 준비되었습니다.", "success");

    // 댓글 상호작용 분석
    this.trackCommentInteractions();

    // 키보드 단축키 설정
    this.setupKeyboardShortcuts();
  }

  trackCommentInteractions() {
    // 댓글 영역 스크롤 추적
    const commentsContainer = document.getElementById("comments");
    if (commentsContainer) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.logCommentView();
          }
        });
      });

      observer.observe(commentsContainer);
    }
  }

  logCommentView() {
    // 분석 데이터 수집 (개인정보 보호 준수)
    const viewData = {
      timestamp: Date.now(),
      page: window.location.pathname,
      referrer: document.referrer,
      userAgent: navigator.userAgent.substring(0, 100), // 제한된 정보만
    };

    // 로컬 스토리지에 저장 (서버 전송 없음)
    const views = JSON.parse(localStorage.getItem("comment_views") || "[]");
    views.push(viewData);

    // 최근 100개만 유지
    if (views.length > 100) {
      views.splice(0, views.length - 100);
    }

    localStorage.setItem("comment_views", JSON.stringify(views));
  }

  setupKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
      // Ctrl+Shift+C: 댓글로 이동
      if (e.ctrlKey && e.shiftKey && e.key === "C") {
        e.preventDefault();
        this.scrollToComments();
      }

      // Ctrl+Shift+N: 새 댓글 작성
      if (e.ctrlKey && e.shiftKey && e.key === "N") {
        e.preventDefault();
        this.focusCommentInput();
      }
    });
  }

  scrollToComments() {
    const commentsSection = document.getElementById("comments");
    if (commentsSection) {
      commentsSection.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });

      this.showNotification("댓글 섹션으로 이동했습니다.", "info", 2000);
    }
  }

  focusCommentInput() {
    // Giscus 입력창에 포커스 (iframe 내부이므로 메시지 전송)
    const giscusFrame = document.querySelector("iframe.giscus-frame");
    if (giscusFrame) {
      giscusFrame.contentWindow.postMessage(
        {
          giscus: { focus: true },
        },
        "https://giscus.app"
      );

      this.showNotification("댓글 작성창에 포커스했습니다.", "info", 2000);
    }
  }

  // 댓글 검색 기능
  setupCommentSearch() {
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "댓글 검색...";
    searchInput.className = "comment-search";

    const header = document.querySelector(".comments-header");
    if (header) {
      header.appendChild(searchInput);
    }

    searchInput.addEventListener("input", (e) => {
      this.searchComments(e.target.value);
    });
  }

  searchComments(query) {
    if (!query.trim()) {
      this.clearSearchHighlight();
      return;
    }

    // 검색 결과 하이라이트 (iframe 제한으로 메시지 기반)
    const giscusFrame = document.querySelector("iframe.giscus-frame");
    if (giscusFrame) {
      giscusFrame.contentWindow.postMessage(
        {
          giscus: { search: query },
        },
        "https://giscus.app"
      );
    }
  }

  clearSearchHighlight() {
    const giscusFrame = document.querySelector("iframe.giscus-frame");
    if (giscusFrame) {
      giscusFrame.contentWindow.postMessage(
        {
          giscus: { clearSearch: true },
        },
        "https://giscus.app"
      );
    }
  }

  // 댓글 통계
  getCommentStats() {
    const views = JSON.parse(localStorage.getItem("comment_views") || "[]");
    const today = new Date().toDateString();

    return {
      totalViews: views.length,
      todayViews: views.filter(
        (view) => new Date(view.timestamp).toDateString() === today
      ).length,
      uniquePages: [...new Set(views.map((view) => view.page))].length,
    };
  }
}

// 댓글 시스템 초기화
document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("comments")) {
    window.advancedComments = new AdvancedComments();
  }
});

// 전역 함수로 노출 (개발자 도구에서 사용 가능)
window.showCommentStats = () => {
  if (window.advancedComments) {
    console.table(window.advancedComments.getCommentStats());
  }
};

window.commentNotify = (message, type = "info") => {
  if (window.advancedComments) {
    window.advancedComments.showNotification(message, type);
  }
};
