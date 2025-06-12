/**
 * 포스트 뷰 개선 기능
 * Phase 2.3: 읽기 진행률, 북마크, 소셜 공유, 관련 포스트 애니메이션
 */

class PostViewEnhancements {
  constructor() {
    this.bookmarkedPosts = JSON.parse(
      localStorage.getItem("bookmarkedPosts") || "[]"
    );
    this.currentPostUrl = window.location.pathname;
    this.readingProgress = document.getElementById("reading-progress");
    this.progressBar = document.querySelector(".reading-progress-bar");
    this.postContent = document.getElementById("post-content");

    this.init();
  }

  init() {
    // 읽기 진행률 초기화
    this.initReadingProgress();

    // 북마크 기능 초기화
    this.initBookmark();

    // 소셜 공유 기능 초기화
    this.initSocialShare();

    // 태그 더보기 기능 초기화
    this.initTagsToggle();

    // 스크롤 애니메이션 초기화
    this.initScrollAnimations();

    // 키보드 단축키 초기화
    this.initKeyboardShortcuts();

    console.log("Post View Enhancements initialized");
  }

  // 읽기 진행률 기능
  initReadingProgress() {
    if (!this.readingProgress || !this.postContent) return;

    const updateProgress = () => {
      const contentRect = this.postContent.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const contentHeight = this.postContent.offsetHeight;
      const contentTop = contentRect.top;

      // 컨텐츠가 뷰포트에 들어왔을 때만 진행률 표시
      if (contentTop < windowHeight && contentTop + contentHeight > 0) {
        this.readingProgress.classList.add("visible");

        // 읽기 진행률 계산
        const scrolled = Math.max(0, -contentTop);
        const maxScroll = Math.max(0, contentHeight - windowHeight);
        const progress =
          maxScroll > 0 ? Math.min(100, (scrolled / maxScroll) * 100) : 0;

        this.progressBar.style.width = `${progress}%`;
      } else {
        this.readingProgress.classList.remove("visible");
      }
    };

    // 스크롤 이벤트 리스너 (스로틀링 적용)
    let ticking = false;
    window.addEventListener("scroll", () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          updateProgress();
          ticking = false;
        });
        ticking = true;
      }
    });

    // 초기 진행률 설정
    updateProgress();
  }

  // 북마크 기능
  initBookmark() {
    const bookmarkBtn = document.getElementById("bookmark-btn");
    if (!bookmarkBtn) return;

    // 현재 포스트의 북마크 상태 확인
    const isBookmarked = this.bookmarkedPosts.includes(this.currentPostUrl);
    this.updateBookmarkButton(bookmarkBtn, isBookmarked);

    // 북마크 토글 이벤트
    bookmarkBtn.addEventListener("click", () => {
      this.toggleBookmark(bookmarkBtn);
    });
  }

  updateBookmarkButton(button, isBookmarked) {
    if (isBookmarked) {
      button.classList.add("bookmarked");
      button.setAttribute("aria-label", "북마크 해제");
      button.title = "북마크 해제";
    } else {
      button.classList.remove("bookmarked");
      button.setAttribute("aria-label", "북마크");
      button.title = "북마크";
    }
  }

  toggleBookmark(button) {
    const isCurrentlyBookmarked = this.bookmarkedPosts.includes(
      this.currentPostUrl
    );

    if (isCurrentlyBookmarked) {
      // 북마크 제거
      this.bookmarkedPosts = this.bookmarkedPosts.filter(
        (url) => url !== this.currentPostUrl
      );
      this.showNotification("북마크가 해제되었습니다");
    } else {
      // 북마크 추가
      this.bookmarkedPosts.push(this.currentPostUrl);
      this.showNotification("북마크에 추가되었습니다");
    }

    // 로컬 스토리지 업데이트
    localStorage.setItem(
      "bookmarkedPosts",
      JSON.stringify(this.bookmarkedPosts)
    );

    // 버튼 상태 업데이트
    this.updateBookmarkButton(button, !isCurrentlyBookmarked);

    // 애니메이션 효과
    button.style.transform = "scale(0.9)";
    setTimeout(() => {
      button.style.transform = "";
    }, 150);
  }

  // 소셜 공유 기능
  initSocialShare() {
    const shareButtons = document.querySelectorAll(".share-btn");
    if (!shareButtons.length) return;

    shareButtons.forEach((button) => {
      button.addEventListener("click", (e) => {
        const platform = button.dataset.platform;
        this.shareToSocial(platform);
      });
    });
  }

  shareToSocial(platform) {
    const url = window.location.href;
    const title = document.title;
    const text =
      document.querySelector('meta[name="description"]')?.content || title;

    let shareUrl = "";

    switch (platform) {
      case "twitter":
        shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
          title
        )}&url=${encodeURIComponent(url)}`;
        break;
      case "facebook":
        shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
          url
        )}`;
        break;
      case "linkedin":
        shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
          url
        )}`;
        break;
      case "kakao":
        // KakaoTalk 공유는 SDK가 필요하므로 기본 공유 API 사용
        if (navigator.share) {
          navigator
            .share({
              title: title,
              text: text,
              url: url,
            })
            .catch(console.error);
          return;
        } else {
          this.copyToClipboard(url);
          return;
        }
        break;
      case "copy":
        this.copyToClipboard(url);
        return;
    }

    if (shareUrl) {
      window.open(
        shareUrl,
        "_blank",
        "width=600,height=400,scrollbars=yes,resizable=yes"
      );
    }
  }

  copyToClipboard(text) {
    if (navigator.clipboard) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          this.showNotification("링크가 클립보드에 복사되었습니다");
        })
        .catch(() => {
          this.fallbackCopyToClipboard(text);
        });
    } else {
      this.fallbackCopyToClipboard(text);
    }
  }

  fallbackCopyToClipboard(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      document.execCommand("copy");
      this.showNotification("링크가 클립보드에 복사되었습니다");
    } catch (err) {
      this.showNotification("복사에 실패했습니다");
    }

    document.body.removeChild(textArea);
  }

  // 태그 더보기 기능
  initTagsToggle() {
    const showMoreBtn = document.getElementById("show-more-tags");
    const tagList = document.getElementById("tag-list");

    if (!showMoreBtn || !tagList) return;

    showMoreBtn.addEventListener("click", () => {
      const isExpanded = tagList.classList.contains("expanded");

      if (isExpanded) {
        tagList.classList.remove("expanded");
        showMoreBtn.textContent = "더 보기";
      } else {
        tagList.classList.add("expanded");
        showMoreBtn.textContent = "접기";
      }
    });
  }

  // 스크롤 애니메이션
  initScrollAnimations() {
    const animatedElements = document.querySelectorAll(
      ".related-posts, .enhanced-share-section"
    );

    if (!animatedElements.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("fade-in-on-scroll", "visible");
          }
        });
      },
      {
        threshold: 0.1,
        rootMargin: "0px 0px -50px 0px",
      }
    );

    animatedElements.forEach((el) => {
      el.classList.add("fade-in-on-scroll");
      observer.observe(el);
    });
  }

  // 키보드 단축키
  initKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
      // Ctrl/Cmd + B: 북마크 토글
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        const bookmarkBtn = document.getElementById("bookmark-btn");
        if (bookmarkBtn) {
          this.toggleBookmark(bookmarkBtn);
        }
      }

      // Ctrl/Cmd + Shift + C: 링크 복사
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "C") {
        e.preventDefault();
        this.copyToClipboard(window.location.href);
      }
    });
  }

  // 알림 표시
  showNotification(message) {
    // 기존 알림이 있으면 제거
    const existingNotification = document.querySelector(".post-notification");
    if (existingNotification) {
      existingNotification.remove();
    }

    // 새 알림 생성
    const notification = document.createElement("div");
    notification.className = "post-notification";
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #b19cd9;
      color: white;
      padding: 1rem 1.5rem;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      z-index: 10000;
      font-size: 0.9rem;
      font-weight: 500;
      transform: translateX(100%);
      transition: transform 0.3s ease;
    `;

    document.body.appendChild(notification);

    // 애니메이션
    requestAnimationFrame(() => {
      notification.style.transform = "translateX(0)";
    });

    // 3초 후 제거
    setTimeout(() => {
      notification.style.transform = "translateX(100%)";
      setTimeout(() => {
        if (notification.parentNode) {
          notification.remove();
        }
      }, 300);
    }, 3000);
  }

  // 북마크된 포스트 목록 반환 (외부에서 사용 가능)
  getBookmarkedPosts() {
    return [...this.bookmarkedPosts];
  }

  // 특정 포스트의 북마크 상태 확인
  isPostBookmarked(url = this.currentPostUrl) {
    return this.bookmarkedPosts.includes(url);
  }
}

// DOM이 로드되면 초기화
document.addEventListener("DOMContentLoaded", () => {
  // single 페이지에서만 실행
  if (document.querySelector(".post-single")) {
    window.postViewEnhancements = new PostViewEnhancements();
  }
});

// 개발자 도구용 API
window.PostViewAPI = {
  getBookmarks: () => window.postViewEnhancements?.getBookmarkedPosts() || [],
  isBookmarked: (url) =>
    window.postViewEnhancements?.isPostBookmarked(url) || false,
  toggleBookmark: () => {
    const btn = document.getElementById("bookmark-btn");
    if (btn && window.postViewEnhancements) {
      window.postViewEnhancements.toggleBookmark(btn);
    }
  },
  copyLink: () => {
    if (window.postViewEnhancements) {
      window.postViewEnhancements.copyToClipboard(window.location.href);
    }
  },
};
