/**
 * 이미지 성능 최적화 및 고급 레이지 로딩
 * Intersection Observer API를 활용한 최적화된 로딩
 */

class ImageOptimizer {
  constructor() {
    this.isWebPSupported = this.checkWebPSupport();
    this.lazyImages = [];
    this.imageObserver = null;
    this.init();
  }

  init() {
    // DOM 로딩 완료 후 초기화
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () =>
        this.setupLazyLoading()
      );
    } else {
      this.setupLazyLoading();
    }
  }

  /**
   * WebP 지원 확인
   */
  checkWebPSupported() {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL("image/webp").indexOf("data:image/webp") === 0;
  }

  /**
   * Intersection Observer를 사용한 레이지 로딩 설정
   */
  setupLazyLoading() {
    // 레이지 로딩 대상 이미지 선택
    this.lazyImages = document.querySelectorAll('img[loading="lazy"]');

    if (this.lazyImages.length === 0) return;

    // Intersection Observer 설정
    const observerOptions = {
      root: null,
      rootMargin: "50px 0px", // 50px 미리 로딩
      threshold: 0.01,
    };

    this.imageObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          this.loadImage(entry.target);
          this.imageObserver.unobserve(entry.target);
        }
      });
    }, observerOptions);

    // 각 이미지에 옵저버 적용
    this.lazyImages.forEach((img) => {
      this.imageObserver.observe(img);

      // 로딩 에러 처리
      img.addEventListener("error", () => this.handleImageError(img));
    });

    // WebP 지원 시 body에 클래스 추가
    if (this.isWebPSupported) {
      document.body.classList.add("webp");
    }
  }

  /**
   * 이미지 로딩 및 최적화
   */
  loadImage(img) {
    // 로딩 시작 표시
    img.style.transition =
      "opacity 0.5s ease-in-out, transform 0.5s ease-in-out";

    // 이미지 로딩 완료 처리
    const handleLoad = () => {
      img.classList.add("loaded");
      img.style.willChange = "auto"; // 성능 최적화
      img.removeEventListener("load", handleLoad);
    };

    img.addEventListener("load", handleLoad);

    // src 속성이 이미 있는 경우 바로 로딩 처리
    if (img.complete && img.naturalHeight !== 0) {
      handleLoad();
    }
  }

  /**
   * 이미지 로딩 에러 처리
   */
  handleImageError(img) {
    img.classList.add("error");
    console.warn("Image loading failed:", img.src);

    // 대체 이미지 또는 플레이스홀더 표시
    const fallback = img.dataset.fallback;
    if (fallback && img.src !== fallback) {
      img.src = fallback;
    }
  }

  /**
   * 이미지 프리로딩 (중요한 이미지용)
   */
  preloadCriticalImages() {
    const criticalImages = document.querySelectorAll('img[loading="eager"]');

    criticalImages.forEach((img) => {
      if (!img.complete) {
        const preloadLink = document.createElement("link");
        preloadLink.rel = "preload";
        preloadLink.as = "image";
        preloadLink.href = img.src;
        document.head.appendChild(preloadLink);
      }
    });
  }

  /**
   * 동적으로 추가된 이미지 처리
   */
  observeNewImages(container) {
    const newImages = container.querySelectorAll(
      'img[loading="lazy"]:not(.observed)'
    );

    newImages.forEach((img) => {
      img.classList.add("observed");
      this.imageObserver.observe(img);
      img.addEventListener("error", () => this.handleImageError(img));
    });
  }

  /**
   * 옵저버 정리
   */
  disconnect() {
    if (this.imageObserver) {
      this.imageObserver.disconnect();
    }
  }
}

/**
 * CSS 및 JavaScript 번들 최적화
 */
class AssetOptimizer {
  constructor() {
    this.init();
  }

  init() {
    this.optimizeCSS();
    this.optimizeJavaScript();
    this.setupResourceHints();
  }

  /**
   * CSS 최적화
   */
  optimizeCSS() {
    // 미사용 CSS 클래스 감지 및 정리 (개발 모드에서만)
    if (window.location.hostname === "localhost") {
      this.detectUnusedCSS();
    }

    // 중요하지 않은 CSS 비동기 로딩
    this.loadNonCriticalCSS();
  }

  /**
   * 미사용 CSS 감지
   */
  detectUnusedCSS() {
    const stylesheets = Array.from(document.styleSheets);
    const usedClasses = new Set();

    // DOM에서 사용된 클래스 수집
    document.querySelectorAll("*").forEach((el) => {
      el.classList.forEach((cls) => usedClasses.add(cls));
    });

    // 콘솔에 미사용 클래스 보고 (개발용)
    stylesheets.forEach((sheet) => {
      try {
        const rules = Array.from(sheet.cssRules || []);
        rules.forEach((rule) => {
          if (rule.type === CSSRule.STYLE_RULE) {
            const selectors = rule.selectorText.split(",");
            selectors.forEach((selector) => {
              const className = selector.trim().match(/\.([a-zA-Z0-9_-]+)/);
              if (className && !usedClasses.has(className[1])) {
                console.log("Unused CSS class detected:", className[1]);
              }
            });
          }
        });
      } catch (e) {
        // Cross-origin 스타일시트는 무시
      }
    });
  }

  /**
   * 비중요 CSS 비동기 로딩
   */
  loadNonCriticalCSS() {
    const nonCriticalCSS = [
      // 소셜 공유 관련 CSS
      // 인쇄 관련 CSS
      // 애니메이션 CSS
    ];

    nonCriticalCSS.forEach((href) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.media = "print";
      link.onload = () => {
        link.media = "all";
      };
      document.head.appendChild(link);
    });
  }

  /**
   * JavaScript 최적화
   */
  optimizeJavaScript() {
    // 스크롤 이벤트 최적화
    this.optimizeScrollEvents();

    // 리사이즈 이벤트 최적화
    this.optimizeResizeEvents();
  }

  /**
   * 스크롤 이벤트 최적화 (쓰로틀링)
   */
  optimizeScrollEvents() {
    let scrollTimeout;
    let lastScrollTime = 0;

    const optimizedScrollHandler = (callback) => {
      return function (...args) {
        const now = Date.now();
        if (now - lastScrollTime > 16) {
          // 60fps 제한
          lastScrollTime = now;
          callback.apply(this, args);
        }
      };
    };

    // 기존 스크롤 이벤트 최적화 적용
    const scrollElements = document.querySelectorAll("[data-scroll-optimize]");
    scrollElements.forEach((el) => {
      const originalHandler = el.onscroll;
      if (originalHandler) {
        el.onscroll = optimizedScrollHandler(originalHandler);
      }
    });
  }

  /**
   * 리사이즈 이벤트 최적화 (디바운싱)
   */
  optimizeResizeEvents() {
    let resizeTimeout;

    const optimizedResizeHandler = (callback) => {
      return function (...args) {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          callback.apply(this, args);
        }, 250);
      };
    };

    // 글로벌 리사이즈 이벤트 최적화
    if (window.onresize) {
      const originalHandler = window.onresize;
      window.onresize = optimizedResizeHandler(originalHandler);
    }
  }

  /**
   * 리소스 힌트 설정
   */
  setupResourceHints() {
    // DNS 프리페치
    const dnsPrefetch = [
      "picsum.photos", // 예제 이미지
      "fonts.googleapis.com",
      "fonts.gstatic.com",
    ];

    dnsPrefetch.forEach((domain) => {
      const link = document.createElement("link");
      link.rel = "dns-prefetch";
      link.href = `//${domain}`;
      document.head.appendChild(link);
    });

    // 중요 리소스 프리로드
    this.preloadCriticalResources();
  }

  /**
   * 중요 리소스 프리로드
   */
  preloadCriticalResources() {
    const criticalResources = [
      { href: "/js/fuse.min.js", as: "script" },
      { href: "/assets/css/common/search.css", as: "style" },
    ];

    criticalResources.forEach((resource) => {
      const link = document.createElement("link");
      link.rel = "preload";
      link.href = resource.href;
      link.as = resource.as;
      if (resource.as === "style") {
        link.onload = () => {
          const stylesheet = document.createElement("link");
          stylesheet.rel = "stylesheet";
          stylesheet.href = resource.href;
          document.head.appendChild(stylesheet);
        };
      }
      document.head.appendChild(link);
    });
  }
}

/**
 * Web Vitals 모니터링
 */
class WebVitalsMonitor {
  constructor() {
    this.metrics = {};
    this.init();
  }

  init() {
    this.measureCLS();
    this.measureFID();
    this.measureLCP();
    this.measureFCP();
    this.measureTTFB();
  }

  /**
   * Cumulative Layout Shift 측정
   */
  measureCLS() {
    let cls = 0;

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          cls += entry.value;
        }
      }
      this.metrics.cls = cls;
    });

    observer.observe({ type: "layout-shift", buffered: true });
  }

  /**
   * First Input Delay 측정
   */
  measureFID() {
    const observer = new PerformanceObserver((list) => {
      const firstInput = list.getEntries()[0];
      if (firstInput) {
        this.metrics.fid = firstInput.processingStart - firstInput.startTime;
      }
    });

    observer.observe({ type: "first-input", buffered: true });
  }

  /**
   * Largest Contentful Paint 측정
   */
  measureLCP() {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1];
      this.metrics.lcp = lastEntry.startTime;
    });

    observer.observe({ type: "largest-contentful-paint", buffered: true });
  }

  /**
   * First Contentful Paint 측정
   */
  measureFCP() {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === "first-contentful-paint") {
          this.metrics.fcp = entry.startTime;
        }
      }
    });

    observer.observe({ type: "paint", buffered: true });
  }

  /**
   * Time to First Byte 측정
   */
  measureTTFB() {
    const navigation = performance.getEntriesByType("navigation")[0];
    if (navigation) {
      this.metrics.ttfb = navigation.responseStart - navigation.requestStart;
    }
  }

  /**
   * 메트릭 보고 (개발 모드에서만)
   */
  reportMetrics() {
    if (window.location.hostname === "localhost") {
      console.group("Web Vitals Metrics");
      console.log("CLS (Cumulative Layout Shift):", this.metrics.cls);
      console.log("FID (First Input Delay):", this.metrics.fid);
      console.log("LCP (Largest Contentful Paint):", this.metrics.lcp);
      console.log("FCP (First Contentful Paint):", this.metrics.fcp);
      console.log("TTFB (Time to First Byte):", this.metrics.ttfb);
      console.groupEnd();
    }
  }

  /**
   * 성능 등급 계산
   */
  getPerformanceGrade() {
    const grades = {
      cls: this.metrics.cls < 0.1 ? "A" : this.metrics.cls < 0.25 ? "B" : "C",
      fid: this.metrics.fid < 100 ? "A" : this.metrics.fid < 300 ? "B" : "C",
      lcp: this.metrics.lcp < 2500 ? "A" : this.metrics.lcp < 4000 ? "B" : "C",
    };

    return grades;
  }
}

// 초기화
let imageOptimizer, assetOptimizer, webVitalsMonitor;

document.addEventListener("DOMContentLoaded", () => {
  imageOptimizer = new ImageOptimizer();
  assetOptimizer = new AssetOptimizer();
  webVitalsMonitor = new WebVitalsMonitor();

  // 페이지 로딩 완료 후 메트릭 보고
  window.addEventListener("load", () => {
    setTimeout(() => {
      webVitalsMonitor.reportMetrics();
    }, 2000);
  });

  // Service Worker 등록 (프로덕션 환경에서만)
  if ("serviceWorker" in navigator && window.location.protocol === "https:") {
    registerServiceWorker();
  }
});

/**
 * Service Worker 등록 및 관리
 */
async function registerServiceWorker() {
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });

    console.log(
      "[PWA] Service Worker registered successfully:",
      registration.scope
    );

    // Service Worker 업데이트 확인
    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing;
      console.log("[PWA] New Service Worker found, installing...");

      newWorker.addEventListener("statechange", () => {
        if (
          newWorker.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          // 새 버전이 설치되었음을 사용자에게 알림
          showUpdateNotification();
        }
      });
    });

    // Service Worker 메시지 처리
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data && event.data.type === "CACHE_SIZE") {
        console.log("[PWA] Cache size:", event.data.size, "KB");
      }
    });
  } catch (error) {
    console.error("[PWA] Service Worker registration failed:", error);
  }
}

/**
 * Service Worker 업데이트 알림
 */
function showUpdateNotification() {
  // 간단한 업데이트 알림 (추후 더 세련된 UI로 교체 가능)
  if (confirm("새로운 버전이 있습니다. 페이지를 새로고침하시겠습니까?")) {
    window.location.reload();
  }
}

/**
 * 캐시 관리 유틸리티
 */
const CacheManager = {
  // 캐시 크기 확인
  async getCacheSize() {
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      return new Promise((resolve) => {
        const messageChannel = new MessageChannel();
        messageChannel.port1.onmessage = (event) => {
          if (event.data && event.data.type === "CACHE_SIZE") {
            resolve(event.data.size);
          }
        };

        navigator.serviceWorker.controller.postMessage(
          { type: "GET_CACHE_SIZE" },
          [messageChannel.port2]
        );
      });
    }
    return 0;
  },

  // 캐시 정리
  async clearCache() {
    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => caches.delete(cacheName))
      );
      console.log("[Cache] All caches cleared");
    }
  },
};

// 전역 객체에 캐시 관리자 추가 (디버깅용)
window.CacheManager = CacheManager;

// 모듈 내보내기 (필요시)
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ImageOptimizer,
    AssetOptimizer,
    WebVitalsMonitor,
    CacheManager,
    registerServiceWorker,
  };
}
