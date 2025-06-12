/**
 * 향상된 네비게이션 시스템
 * Phase 2.2: 네비게이션 개선
 */

class EnhancedNavigation {
  constructor() {
    this.mobileBreakpoint = 768;
    this.isMobile = window.innerWidth <= this.mobileBreakpoint;
    this.mobileMenuOpen = false;
    this.currentHighlight = null;

    // this.init();
    // this.setupEventListeners();
    // this.setupKeyboardNavigation();
    // this.setupMobileMenu();
    // this.setupActiveHighlighting();
  }

  init() {
    // 현재 페이지 표시
    this.highlightCurrentPage();

    // 모바일 메뉴 토글 버튼 생성
    this.createMobileMenuToggle();

    // 네비게이션 하이라이트 요소 생성
    this.createNavHighlight();

    // 접근성 개선
    this.enhanceAccessibility();

    console.log("Enhanced Navigation initialized");
  }

  setupEventListeners() {
    // 윈도우 리사이즈 이벤트
    window.addEventListener("resize", this.handleResize.bind(this));

    // 스크롤 이벤트 (헤더 숨김/표시)
    let lastScrollY = window.scrollY;
    let scrollTimeout;

    window.addEventListener("scroll", () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const currentScrollY = window.scrollY;
        const header = document.querySelector(".header");

        if (header) {
          if (currentScrollY > lastScrollY && currentScrollY > 100) {
            // 아래로 스크롤 시 헤더 숨김
            header.style.transform = "translateY(-100%)";
          } else {
            // 위로 스크롤 시 헤더 표시
            header.style.transform = "translateY(0)";
          }
        }

        lastScrollY = currentScrollY;
      }, 10);
    });

    // 메뉴 아이템 호버 이벤트
    const menuItems = document.querySelectorAll("#menu a");
    menuItems.forEach((item) => {
      item.addEventListener("mouseenter", this.handleMenuHover.bind(this));
      item.addEventListener("mouseleave", this.handleMenuLeave.bind(this));
    });
  }

  setupKeyboardNavigation() {
    // 키보드 단축키
    document.addEventListener("keydown", (e) => {
      // Alt + M: 메인 메뉴로 포커스
      if (e.altKey && e.key === "m") {
        e.preventDefault();
        const firstMenuItem = document.querySelector("#menu a");
        if (firstMenuItem) {
          firstMenuItem.focus();
        }
      }

      // Escape: 모바일 메뉴 닫기
      if (e.key === "Escape" && this.mobileMenuOpen) {
        this.closeMobileMenu();
      }

      // 메뉴 내에서 화살표 키 네비게이션
      if (document.activeElement && document.activeElement.closest("#menu")) {
        this.handleMenuKeyNavigation(e);
      }
    });

    // Skip link 생성
    this.createSkipLink();
  }

  setupMobileMenu() {
    const mobileToggle = document.querySelector(".mobile-menu-toggle");
    const menu = document.querySelector("#menu");
    const overlay = document.querySelector(".mobile-menu-overlay");

    if (mobileToggle) {
      mobileToggle.addEventListener("click", this.toggleMobileMenu.bind(this));
    }

    if (overlay) {
      overlay.addEventListener("click", this.closeMobileMenu.bind(this));
    }

    // 메뉴 아이템 클릭 시 모바일 메뉴 닫기
    const menuItems = document.querySelectorAll("#menu a");
    menuItems.forEach((item) => {
      item.addEventListener("click", () => {
        if (this.isMobile && this.mobileMenuOpen) {
          setTimeout(() => this.closeMobileMenu(), 150);
        }
      });
    });
  }

  setupActiveHighlighting() {
    // 현재 위치 기반 메뉴 하이라이팅
    const currentPath = window.location.pathname;
    const menuItems = document.querySelectorAll("#menu a");

    menuItems.forEach((item) => {
      const itemPath = new URL(item.href).pathname;
      if (
        currentPath === itemPath ||
        (currentPath !== "/" &&
          currentPath.startsWith(itemPath) &&
          itemPath !== "/")
      ) {
        item.querySelector("span")?.classList.add("active");
      }
    });
  }

  createMobileMenuToggle() {
    const nav = document.querySelector(".nav");
    const menu = document.querySelector("#menu");

    if (!nav || !menu) return;

    // 모바일 토글 버튼이 이미 있는지 확인
    if (document.querySelector(".mobile-menu-toggle")) return;

    const toggle = document.createElement("button");
    toggle.className = "mobile-menu-toggle";
    toggle.setAttribute("aria-label", "메뉴 열기/닫기");
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = `
            <div class="hamburger">
                <span></span>
                <span></span>
                <span></span>
            </div>
        `;

    // 검색 컨테이너 앞에 삽입
    const searchContainer = document.querySelector(".search-container");
    if (searchContainer) {
      nav.insertBefore(toggle, searchContainer);
    } else {
      nav.appendChild(toggle);
    }

    // 오버레이 생성
    this.createMobileOverlay();
  }

  createMobileOverlay() {
    if (document.querySelector(".mobile-menu-overlay")) return;

    const overlay = document.createElement("div");
    overlay.className = "mobile-menu-overlay";
    document.body.appendChild(overlay);
  }

  createNavHighlight() {
    const menu = document.querySelector("#menu");
    if (!menu || document.querySelector(".nav-highlight")) return;

    const highlight = document.createElement("div");
    highlight.className = "nav-highlight";
    menu.appendChild(highlight);
  }

  createSkipLink() {
    if (document.querySelector(".nav-skip-link")) return;

    const skipLink = document.createElement("a");
    skipLink.className = "nav-skip-link";
    skipLink.href = "#main";
    skipLink.textContent = "메인 콘텐츠로 바로가기";

    const header = document.querySelector(".header");
    if (header) {
      header.appendChild(skipLink);
    }
  }

  highlightCurrentPage() {
    const currentPath = window.location.pathname;
    const menuItems = document.querySelectorAll("#menu a");

    menuItems.forEach((item) => {
      const span = item.querySelector("span");
      if (span) {
        span.classList.remove("active");

        const itemPath = new URL(item.href).pathname;
        if (currentPath === itemPath) {
          span.classList.add("active");
        }
      }
    });
  }

  enhanceAccessibility() {
    // ARIA 속성 추가
    const menu = document.querySelector("#menu");
    if (menu) {
      menu.setAttribute("role", "navigation");
      menu.setAttribute("aria-label", "주 메뉴");
    }

    // 외부 링크에 알림 추가
    const externalLinks = document.querySelectorAll('#menu a[href*="://"]');
    externalLinks.forEach((link) => {
      link.setAttribute("aria-label", `${link.textContent} (새 창에서 열림)`);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    });
  }

  handleResize() {
    const wasMobile = this.isMobile;
    this.isMobile = window.innerWidth <= this.mobileBreakpoint;

    if (wasMobile !== this.isMobile) {
      if (!this.isMobile && this.mobileMenuOpen) {
        this.closeMobileMenu();
      }
    }
  }

  handleMenuHover(e) {
    if (this.isMobile) return;

    const item = e.currentTarget;
    const rect = item.getBoundingClientRect();
    const menu = document.querySelector("#menu");
    const menuRect = menu.getBoundingClientRect();
    const highlight = document.querySelector(".nav-highlight");

    if (highlight) {
      highlight.style.width = `${rect.width}px`;
      highlight.style.left = `${rect.left - menuRect.left}px`;
      highlight.style.opacity = "1";
      highlight.style.transform = "scale(1)";
    }
  }

  handleMenuLeave() {
    if (this.isMobile) return;

    const highlight = document.querySelector(".nav-highlight");
    if (highlight) {
      highlight.style.opacity = "0";
      highlight.style.transform = "scale(0.8)";
    }
  }

  handleMenuKeyNavigation(e) {
    const menuItems = Array.from(document.querySelectorAll("#menu a"));
    const currentIndex = menuItems.indexOf(document.activeElement);

    let newIndex = currentIndex;

    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        newIndex = (currentIndex + 1) % menuItems.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        newIndex = currentIndex === 0 ? menuItems.length - 1 : currentIndex - 1;
        break;
      case "Home":
        e.preventDefault();
        newIndex = 0;
        break;
      case "End":
        e.preventDefault();
        newIndex = menuItems.length - 1;
        break;
    }

    if (newIndex !== currentIndex && menuItems[newIndex]) {
      menuItems[newIndex].focus();
    }
  }

  toggleMobileMenu() {
    if (this.mobileMenuOpen) {
      this.closeMobileMenu();
    } else {
      this.openMobileMenu();
    }
  }

  openMobileMenu() {
    const toggle = document.querySelector(".mobile-menu-toggle");
    const menu = document.querySelector("#menu");
    const overlay = document.querySelector(".mobile-menu-overlay");

    this.mobileMenuOpen = true;

    if (toggle) {
      toggle.classList.add("active");
      toggle.setAttribute("aria-expanded", "true");
    }

    if (menu) {
      menu.classList.add("active");
    }

    if (overlay) {
      overlay.classList.add("active");
    }

    // 첫 번째 메뉴 아이템에 포커스
    const firstMenuItem = document.querySelector("#menu a");
    if (firstMenuItem) {
      setTimeout(() => firstMenuItem.focus(), 150);
    }

    // 바디 스크롤 방지
    document.body.style.overflow = "hidden";
  }

  closeMobileMenu() {
    const toggle = document.querySelector(".mobile-menu-toggle");
    const menu = document.querySelector("#menu");
    const overlay = document.querySelector(".mobile-menu-overlay");

    this.mobileMenuOpen = false;

    if (toggle) {
      toggle.classList.remove("active");
      toggle.setAttribute("aria-expanded", "false");
      toggle.focus(); // 토글 버튼으로 포커스 복귀
    }

    if (menu) {
      menu.classList.remove("active");
    }

    if (overlay) {
      overlay.classList.remove("active");
    }

    // 바디 스크롤 복원
    document.body.style.overflow = "";
  }

  // 프로그래매틱 API
  focusMenu() {
    const firstMenuItem = document.querySelector("#menu a");
    if (firstMenuItem) {
      firstMenuItem.focus();
    }
  }

  highlightMenuItem(index) {
    const menuItems = document.querySelectorAll("#menu a");
    if (menuItems[index]) {
      this.handleMenuHover({ currentTarget: menuItems[index] });
    }
  }

  updateActiveItem(path) {
    const menuItems = document.querySelectorAll("#menu a");
    menuItems.forEach((item) => {
      const span = item.querySelector("span");
      if (span) {
        span.classList.remove("active");
        const itemPath = new URL(item.href).pathname;
        if (path === itemPath) {
          span.classList.add("active");
        }
      }
    });
  }
}

// 초기화
document.addEventListener("DOMContentLoaded", () => {
  window.enhancedNavigation = new EnhancedNavigation();
});

// Hot Module Replacement 지원 (개발 환경)
if (module && module.hot) {
  module.hot.accept();
}
