/**
 * 반응형 네비게이션 및 터치 제스처 지원
 */
class ResponsiveNavigation {
  constructor() {
    this.isMenuOpen = false;
    this.touchStartX = 0;
    this.touchStartY = 0;
    // this.init();
  }

  init() {
    this.createMobileNavigation();
    this.setupEventListeners();
    this.setupTouchGestures();
    this.setupKeyboardNavigation();
  }

  /**
   * 모바일 네비게이션 HTML 생성
   */
  createMobileNavigation() {
    const header =
      document.querySelector(".header") || document.querySelector("header");
    if (!header) return;

    // 모바일 메뉴 토글 버튼
    const mobileToggle = document.createElement("button");
    mobileToggle.className = "mobile-nav-toggle touch-target";
    mobileToggle.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="6" x2="21" y2="6"></line>
        <line x1="3" y1="12" x2="21" y2="12"></line>
        <line x1="3" y1="18" x2="21" y2="18"></line>
      </svg>
    `;
    mobileToggle.setAttribute("aria-label", "메뉴 열기");
    mobileToggle.setAttribute("aria-expanded", "false");

    // 기존 네비게이션 찾기
    const existingNav =
      header.querySelector("nav") || header.querySelector(".nav");

    if (existingNav) {
      // 모바일 메뉴 컨테이너 생성
      const mobileMenu = document.createElement("div");
      mobileMenu.className = "nav-menu";
      mobileMenu.setAttribute("aria-hidden", "true");

      // 닫기 버튼
      const closeButton = document.createElement("button");
      closeButton.className = "nav-menu-close touch-target";
      closeButton.innerHTML = "×";
      closeButton.setAttribute("aria-label", "메뉴 닫기");

      // 네비게이션 링크 복사
      const navContent = existingNav.cloneNode(true);
      navContent.className = "nav-links";

      mobileMenu.appendChild(closeButton);
      mobileMenu.appendChild(navContent);

      // DOM에 추가
      header.appendChild(mobileToggle);
      document.body.appendChild(mobileMenu);

      // 참조 저장
      this.mobileToggle = mobileToggle;
      this.mobileMenu = mobileMenu;
      this.closeButton = closeButton;
    }
  }

  /**
   * 이벤트 리스너 설정
   */
  setupEventListeners() {
    if (this.mobileToggle) {
      this.mobileToggle.addEventListener("click", () => this.toggleMenu());
    }

    if (this.closeButton) {
      this.closeButton.addEventListener("click", () => this.closeMenu());
    }

    // ESC 키로 메뉴 닫기
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isMenuOpen) {
        this.closeMenu();
      }
    });

    // 외부 클릭으로 메뉴 닫기
    document.addEventListener("click", (e) => {
      if (
        this.isMenuOpen &&
        !this.mobileMenu.contains(e.target) &&
        !this.mobileToggle.contains(e.target)
      ) {
        this.closeMenu();
      }
    });

    // 브라우저 리사이즈 대응
    window.addEventListener("resize", () => this.handleResize());
  }

  /**
   * 터치 제스처 설정
   */
  setupTouchGestures() {
    // 스와이프 제스처로 메뉴 제어
    document.addEventListener(
      "touchstart",
      (e) => {
        this.touchStartX = e.touches[0].clientX;
        this.touchStartY = e.touches[0].clientY;
      },
      { passive: true }
    );

    document.addEventListener(
      "touchend",
      (e) => {
        if (!this.touchStartX || !this.touchStartY) return;

        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;

        const deltaX = this.touchStartX - touchEndX;
        const deltaY = this.touchStartY - touchEndY;

        // 수평 스와이프가 수직 스와이프보다 클 때만 처리
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          const minSwipeDistance = 100;

          // 오른쪽에서 왼쪽으로 스와이프 (메뉴 열기)
          if (
            deltaX > minSwipeDistance &&
            !this.isMenuOpen &&
            this.touchStartX > window.innerWidth - 50
          ) {
            this.openMenu();
          }

          // 왼쪽에서 오른쪽으로 스와이프 (메뉴 닫기)
          if (deltaX < -minSwipeDistance && this.isMenuOpen) {
            this.closeMenu();
          }
        }

        this.touchStartX = 0;
        this.touchStartY = 0;
      },
      { passive: true }
    );
  }

  /**
   * 키보드 네비게이션 설정
   */
  setupKeyboardNavigation() {
    if (!this.mobileMenu) return;

    const focusableElements = this.mobileMenu.querySelectorAll(
      'a, button, [tabindex]:not([tabindex="-1"])'
    );

    this.mobileMenu.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          // Shift + Tab
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          // Tab
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    });
  }

  /**
   * 메뉴 토글
   */
  toggleMenu() {
    if (this.isMenuOpen) {
      this.closeMenu();
    } else {
      this.openMenu();
    }
  }

  /**
   * 메뉴 열기
   */
  openMenu() {
    if (!this.mobileMenu) return;

    this.isMenuOpen = true;
    this.mobileMenu.classList.add("open");
    this.mobileMenu.setAttribute("aria-hidden", "false");

    if (this.mobileToggle) {
      this.mobileToggle.setAttribute("aria-expanded", "true");
    }

    // 포커스 트랩
    document.body.style.overflow = "hidden";

    // 첫 번째 포커스 가능한 요소에 포커스
    const firstFocusable = this.mobileMenu.querySelector("a, button");
    if (firstFocusable) {
      setTimeout(() => firstFocusable.focus(), 100);
    }

    // 애니메이션 트리거
    this.mobileMenu.style.transform = "translateX(0)";
  }

  /**
   * 메뉴 닫기
   */
  closeMenu() {
    if (!this.mobileMenu || !this.isMenuOpen) return;

    this.isMenuOpen = false;
    this.mobileMenu.classList.remove("open");
    this.mobileMenu.setAttribute("aria-hidden", "true");

    if (this.mobileToggle) {
      this.mobileToggle.setAttribute("aria-expanded", "false");
      this.mobileToggle.focus(); // 포커스 복원
    }

    // 스크롤 복원
    document.body.style.overflow = "";

    // 애니메이션
    this.mobileMenu.style.transform = "";
  }

  /**
   * 브라우저 리사이즈 처리
   */
  handleResize() {
    // 데스크톱 크기에서는 모바일 메뉴 자동 닫기
    if (window.innerWidth >= 768 && this.isMenuOpen) {
      this.closeMenu();
    }
  }
}

/**
 * 반응형 레이아웃 매니저
 */
class ResponsiveLayoutManager {
  constructor() {
    this.currentBreakpoint = "";
    this.breakpoints = {
      mobile: 0,
      tablet: 768,
      desktop: 1024,
      large: 1440,
    };
    this.init();
  }

  init() {
    this.updateBreakpoint();
    this.setupResizeObserver();
    this.optimizeForViewport();
  }

  /**
   * 현재 브레이크포인트 감지
   */
  updateBreakpoint() {
    const width = window.innerWidth;
    let newBreakpoint = "mobile";

    if (width >= this.breakpoints.large) {
      newBreakpoint = "large";
    } else if (width >= this.breakpoints.desktop) {
      newBreakpoint = "desktop";
    } else if (width >= this.breakpoints.tablet) {
      newBreakpoint = "tablet";
    }

    if (newBreakpoint !== this.currentBreakpoint) {
      const oldBreakpoint = this.currentBreakpoint;
      this.currentBreakpoint = newBreakpoint;

      document.body.className =
        document.body.className.replace(/breakpoint-\w+/g, "") +
        ` breakpoint-${newBreakpoint}`;

      // 브레이크포인트 변경 이벤트 발생
      window.dispatchEvent(
        new CustomEvent("breakpointChange", {
          detail: { from: oldBreakpoint, to: newBreakpoint },
        })
      );
    }
  }

  /**
   * ResizeObserver 설정
   */
  setupResizeObserver() {
    if ("ResizeObserver" in window) {
      const resizeObserver = new ResizeObserver(() => {
        this.updateBreakpoint();
        this.optimizeForViewport();
      });

      resizeObserver.observe(document.body);
    } else {
      // 폴백: resize 이벤트 사용
      let resizeTimeout;
      window.addEventListener("resize", () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          this.updateBreakpoint();
          this.optimizeForViewport();
        }, 250);
      });
    }
  }

  /**
   * 뷰포트에 따른 최적화
   */
  optimizeForViewport() {
    this.adjustFontSizes();
    this.adjustImageSizes();
    this.adjustGridLayout();
  }

  /**
   * 반응형 폰트 크기 조정
   */
  adjustFontSizes() {
    const baseFontSize =
      this.currentBreakpoint === "mobile"
        ? 14
        : this.currentBreakpoint === "tablet"
        ? 16
        : 18;

    document.documentElement.style.setProperty(
      "--base-font-size",
      `${baseFontSize}px`
    );
  }

  /**
   * 반응형 이미지 크기 조정
   */
  adjustImageSizes() {
    const images = document.querySelectorAll("img[data-responsive]");

    images.forEach((img) => {
      const sizes = {
        mobile: img.dataset.mobileSrc,
        tablet: img.dataset.tabletSrc,
        desktop: img.dataset.desktopSrc,
      };

      const appropriateSize = sizes[this.currentBreakpoint] || sizes.mobile;
      if (appropriateSize && img.src !== appropriateSize) {
        img.src = appropriateSize;
      }
    });
  }

  /**
   * 그리드 레이아웃 조정
   */
  adjustGridLayout() {
    const grids = document.querySelectorAll("[data-responsive-grid]");

    grids.forEach((grid) => {
      const columns = {
        mobile: 1,
        tablet: 2,
        desktop: 3,
        large: 4,
      };

      const columnCount = columns[this.currentBreakpoint] || 1;
      grid.style.gridTemplateColumns = `repeat(${columnCount}, 1fr)`;
    });
  }

  /**
   * 현재 브레이크포인트 반환
   */
  getCurrentBreakpoint() {
    return this.currentBreakpoint;
  }

  /**
   * 특정 브레이크포인트인지 확인
   */
  isBreakpoint(breakpoint) {
    return this.currentBreakpoint === breakpoint;
  }

  /**
   * 모바일 여부 확인
   */
  isMobile() {
    return this.currentBreakpoint === "mobile";
  }

  /**
   * 태블릿 여부 확인
   */
  isTablet() {
    return this.currentBreakpoint === "tablet";
  }

  /**
   * 데스크톱 여부 확인
   */
  isDesktop() {
    return ["desktop", "large"].includes(this.currentBreakpoint);
  }
}

// 초기화
let responsiveNavigation, responsiveLayoutManager;

document.addEventListener("DOMContentLoaded", () => {
  responsiveNavigation = new ResponsiveNavigation();
  responsiveLayoutManager = new ResponsiveLayoutManager();

  // 전역 객체로 등록 (디버깅용)
  window.ResponsiveManager = {
    navigation: responsiveNavigation,
    layout: responsiveLayoutManager,
  };
});

// 모듈 내보내기
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ResponsiveNavigation,
    ResponsiveLayoutManager,
  };
}
