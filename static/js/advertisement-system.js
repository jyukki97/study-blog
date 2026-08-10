/**
 * Advertisement System for Hugo Blog
 * Implements Google AdSense and other ad networks integration
 * Part of Phase 3.3 - 분석 및 통계
 */

class AdvertisementManager {
  constructor() {
    this.adNetworks = {
      adsense: {
        enabled: true,
        publisherId: "ca-pub-4944031426200690", // ca-pub-xxxxxxxxxx
        slots: [],
      },
      custom: {
        enabled: true,
        slots: [],
      },
    };

    this.adPositions = {
      header: false,
      sidebar: true,
      content: true,
      footer: true,
      popup: false,
    };

    this.init();
  }

  init() {
    this.loadAdSenseScript();
    this.createAdSlots();
    this.initCustomAds();
    this.addAdStyles();
    this.initAdBlockDetection();
  }

  // Google AdSense 스크립트 로드
  loadAdSenseScript() {
    // AdSense 퍼블리셔 ID 확인
    const publisherId = this.getAdSensePublisherId();
    if (!publisherId) {
      console.warn("[Ads] AdSense Publisher ID가 설정되지 않았습니다");
      return;
    }

    // AdSense 스크립트 로드
    const script = document.createElement("script");
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisherId}`;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      console.log("[Ads] Google AdSense 로드 완료");
      this.adNetworks.adsense.enabled = true;
    };
    document.head.appendChild(script);
  }

  getAdSensePublisherId() {
    // 메타 태그나 설정에서 퍼블리셔 ID 가져오기
    const metaTag = document.querySelector(
      'meta[name="google-adsense-account"]'
    );
    return metaTag ? metaTag.content : null;
  }

  // 광고 슬롯 생성
  createAdSlots() {
    this.createSidebarAd();
    this.createContentAds();
    this.createFooterAd();
  }

  // 사이드바 광고
  createSidebarAd() {
    if (!this.adPositions.sidebar) return;

    const sidebar = document.querySelector(".sidebar, aside, .widget-area");
    if (!sidebar) return;

    const adContainer = document.createElement("div");
    adContainer.className = "ad-container sidebar-ad";
    adContainer.innerHTML = `
            <div class="ad-label">광고</div>
            <div class="ad-slot" id="sidebar-ad-1">
                ${this.generateAdContent("sidebar", 300, 250)}
            </div>
        `;

    sidebar.appendChild(adContainer);
  }

  // 본문 내 광고 (포스트 중간)
  createContentAds() {
    if (!this.adPositions.content) return;

    const postContent = document.querySelector(
      ".post-content, .content, article"
    );
    if (!postContent) return;

    const paragraphs = postContent.querySelectorAll("p");
    if (paragraphs.length < 5) return; // 짧은 글에는 광고 표시 안함

    // 본문 중간에 광고 삽입
    const middleIndex = Math.floor(paragraphs.length / 2);
    const targetParagraph = paragraphs[middleIndex];

    const adContainer = document.createElement("div");
    adContainer.className = "ad-container content-ad";
    adContainer.innerHTML = `
            <div class="ad-label">스폰서 콘텐츠</div>
            <div class="ad-slot" id="content-ad-1">
                ${this.generateAdContent("content", 728, 90)}
            </div>
        `;

    targetParagraph.parentNode.insertBefore(
      adContainer,
      targetParagraph.nextSibling
    );

    // 포스트 끝에도 광고 추가
    const endAdContainer = document.createElement("div");
    endAdContainer.className = "ad-container content-ad-end";
    endAdContainer.innerHTML = `
            <div class="ad-label">관련 광고</div>
            <div class="ad-slot" id="content-ad-2">
                ${this.generateAdContent("content-end", 336, 280)}
            </div>
        `;

    postContent.appendChild(endAdContainer);
  }

  // 푸터 광고
  createFooterAd() {
    if (!this.adPositions.footer) return;

    const footer = document.querySelector("footer, .footer");
    if (!footer) return;

    const adContainer = document.createElement("div");
    adContainer.className = "ad-container footer-ad";
    adContainer.innerHTML = `
            <div class="ad-label">후원 광고</div>
            <div class="ad-slot" id="footer-ad-1">
                ${this.generateAdContent("footer", 970, 90)}
            </div>
        `;

    footer.prepend(adContainer);
  }

  // 광고 콘텐츠 생성
  generateAdContent(position, width, height) {
    // AdSense가 활성화된 경우
    if (this.adNetworks.adsense.enabled) {
      return this.generateAdSenseAd(position, width, height);
    }

    // 커스텀 광고 (플레이스홀더 또는 직접 광고)
    return this.generateCustomAd(position, width, height);
  }

  // Google AdSense 광고 생성
  generateAdSenseAd(position, width, height) {
    const slotId = `ad-slot-${position}-${Date.now()}`;

    return `
            <ins class="adsbygoogle"
                 style="display:inline-block;width:${width}px;height:${height}px"
                 data-ad-client="${this.adNetworks.adsense.publisherId}"
                 data-ad-slot="${this.getAdSlotId(position)}"
                 data-ad-format="auto"
                 data-full-width-responsive="true"></ins>
            <script>
                (adsbygoogle = window.adsbygoogle || []).push({});
            </script>
        `;
  }

  // 커스텀 광고 생성
  generateCustomAd(position, width, height) {
    const customAds = this.getCustomAds(position);

    if (customAds.length === 0) {
      return this.generatePlaceholderAd(width, height);
    }

    const randomAd = customAds[Math.floor(Math.random() * customAds.length)];
    return `
            <div class="custom-ad" style="width:${width}px;height:${height}px;">
                <a href="${randomAd.url}" target="_blank" rel="noopener noreferrer sponsored">
                    <img src="${randomAd.image}" alt="${randomAd.title}" 
                         style="width:100%;height:100%;object-fit:cover;border-radius:8px;">
                </a>
            </div>
        `;
  }

  // 플레이스홀더 광고 생성
  generatePlaceholderAd(width, height) {
    return `
            <div class="placeholder-ad" style="width:${width}px;height:${height}px;">
                <div class="placeholder-content">
                    <div class="placeholder-icon">📢</div>
                    <div class="placeholder-text">
                        <h4>광고 자리</h4>
                        <p>이 공간에 광고가 표시됩니다</p>
                    </div>
                </div>
            </div>
        `;
  }

  // AdSense 슬롯 ID 매핑
  getAdSlotId(position) {
    const slotMapping = {
      sidebar: "1234567890",
      content: "2345678901",
      "content-end": "3456789012",
      footer: "4567890123",
    };
    return slotMapping[position] || "1234567890";
  }

  // 커스텀 광고 데이터
  getCustomAds(position) {
    const customAdsData = {
      sidebar: [
        {
          title: "개발 도서 추천",
          image: "/images/ads/book-ad.jpg",
          url: "https://example.com/books",
          type: "affiliate",
        },
        {
          title: "온라인 강의",
          image: "/images/ads/course-ad.jpg",
          url: "https://example.com/courses",
          type: "affiliate",
        },
      ],
      content: [
        {
          title: "개발 툴 추천",
          image: "/images/ads/tools-banner.jpg",
          url: "https://example.com/tools",
          type: "sponsored",
        },
      ],
      footer: [
        {
          title: "호스팅 서비스",
          image: "/images/ads/hosting-banner.jpg",
          url: "https://example.com/hosting",
          type: "affiliate",
        },
      ],
    };

    return customAdsData[position] || [];
  }

  // 커스텀 광고 초기화
  initCustomAds() {
    this.trackAdViews();
    this.trackAdClicks();
  }

  // 광고 조회 추적
  trackAdViews() {
    const adSlots = document.querySelectorAll(".ad-slot");

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const adId = entry.target.id;
            this.trackAdEvent("view", adId);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.5 }
    );

    adSlots.forEach((slot) => observer.observe(slot));
  }

  // 광고 클릭 추적
  trackAdClicks() {
    document.addEventListener("click", (event) => {
      const adLink = event.target.closest(".custom-ad a, .ad-slot a");
      if (adLink) {
        const adContainer = adLink.closest(".ad-container");
        const adId = adContainer
          ? adContainer.querySelector(".ad-slot").id
          : "unknown";
        this.trackAdEvent("click", adId);
      }
    });
  }

  // 광고 이벤트 추적
  trackAdEvent(eventType, adId) {
    // Google Analytics로 이벤트 전송
    if (typeof gtag !== "undefined") {
      gtag("event", "ad_" + eventType, {
        event_category: "advertisement",
        event_label: adId,
        custom_parameter_1: "ad_interaction",
      });
    }

    // 내부 분석 시스템으로 전송
    if (window.blogAnalytics) {
      window.blogAnalytics.trackCustomEvent("ad_" + eventType, {
        ad_id: adId,
        position: this.getAdPosition(adId),
        timestamp: Date.now(),
      });
    }

    console.log(`[Ads] ${eventType.toUpperCase()} tracked for ${adId}`);
  }

  // 광고 위치 식별
  getAdPosition(adId) {
    if (adId.includes("sidebar")) return "sidebar";
    if (adId.includes("content")) return "content";
    if (adId.includes("footer")) return "footer";
    return "unknown";
  }

  // 광고 차단 감지
  initAdBlockDetection() {
    // 광고 차단기 감지
    setTimeout(() => {
      const testAd = document.createElement("div");
      testAd.innerHTML = "&nbsp;";
      testAd.className = "adsbox";
      testAd.style.position = "absolute";
      testAd.style.left = "-10000px";
      document.body.appendChild(testAd);

      setTimeout(() => {
        if (testAd.offsetHeight === 0) {
          this.handleAdBlockDetected();
        }
        document.body.removeChild(testAd);
      }, 100);
    }, 1000);
  }

  // 광고 차단 감지 시 처리
  handleAdBlockDetected() {
    console.log("[Ads] AdBlock 감지됨");

    // 광고 차단 메시지 표시 (선택적)
    if (this.shouldShowAdBlockMessage()) {
      this.showAdBlockMessage();
    }

    // Analytics에 기록
    this.trackAdEvent("adblock_detected", "system");
  }

  shouldShowAdBlockMessage() {
    // 로컬 스토리지에서 메시지 표시 여부 확인
    const lastShown = localStorage.getItem("adblock_message_shown");
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    return !lastShown || now - parseInt(lastShown) > oneDay;
  }

  showAdBlockMessage() {
    const message = document.createElement("div");
    message.className = "adblock-notice";
    message.innerHTML = `
            <div class="adblock-notice-content">
                <h4>광고 차단 프로그램이 감지되었습니다</h4>
                <p>이 블로그는 광고 수익으로 운영됩니다. 광고를 허용해주시면 더 나은 콘텐츠를 제공할 수 있습니다.</p>
                <button onclick="this.parentElement.parentElement.style.display='none'">확인</button>
            </div>
        `;

    document.body.appendChild(message);

    // 24시간 후 다시 표시
    localStorage.setItem("adblock_message_shown", Date.now().toString());

    // 자동 닫기
    setTimeout(() => {
      if (message.parentElement) {
        message.remove();
      }
    }, 10000);
  }

  // 광고 성능 분석
  getAdPerformance() {
    return {
      views: this.getAdViews(),
      clicks: this.getAdClicks(),
      ctr: this.calculateCTR(),
      revenue: this.estimateRevenue(),
    };
  }

  getAdViews() {
    // 로컬 스토리지나 분석 시스템에서 조회수 가져오기
    return parseInt(localStorage.getItem("ad_views_total") || "0");
  }

  getAdClicks() {
    return parseInt(localStorage.getItem("ad_clicks_total") || "0");
  }

  calculateCTR() {
    const views = this.getAdViews();
    const clicks = this.getAdClicks();
    return views > 0 ? ((clicks / views) * 100).toFixed(2) : 0;
  }

  estimateRevenue() {
    // 추정 수익 계산 (실제로는 AdSense 대시보드에서 확인)
    const clicks = this.getAdClicks();
    const estimatedCPC = 0.5; // 예상 클릭당 단가 (USD)
    return (clicks * estimatedCPC).toFixed(2);
  }

  // 스타일 추가
  addAdStyles() {
    const style = document.createElement("style");
    style.textContent = `
            /* 광고 컨테이너 기본 스타일 */
            .ad-container {
                margin: 24px 0;
                text-align: center;
                position: relative;
            }
            
            .ad-label {
                font-size: 12px;
                color: var(--text-secondary, #666);
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 8px;
                opacity: 0.7;
            }
            
            .ad-slot {
                display: inline-block;
                position: relative;
                border-radius: 8px;
                overflow: hidden;
                background: var(--bg-secondary, #f8f9fa);
                border: 1px solid var(--border-color, #e9ecef);
            }
            
            /* 사이드바 광고 */
            .sidebar-ad {
                margin: 20px 0;
                max-width: 300px;
            }
            
            .sidebar-ad .ad-slot {
                width: 100%;
                max-width: 300px;
                height: 250px;
            }
            
            /* 본문 내 광고 */
            .content-ad {
                margin: 32px auto;
                max-width: 100%;
            }
            
            .content-ad .ad-slot {
                width: 100%;
                max-width: 728px;
                height: 90px;
            }
            
            .content-ad-end {
                margin-top: 48px;
                padding-top: 24px;
                border-top: 1px solid var(--border-color, #e9ecef);
            }
            
            .content-ad-end .ad-slot {
                width: 100%;
                max-width: 336px;
                height: 280px;
            }
            
            /* 푸터 광고 */
            .footer-ad {
                margin: 32px auto 16px;
                max-width: 100%;
            }
            
            .footer-ad .ad-slot {
                width: 100%;
                max-width: 970px;
                height: 90px;
            }
            
            /* 커스텀 광고 */
            .custom-ad {
                display: block;
                transition: all 0.3s ease;
                border-radius: 8px;
                overflow: hidden;
            }
            
            .custom-ad:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            }
            
            .custom-ad img {
                transition: transform 0.3s ease;
            }
            
            .custom-ad:hover img {
                transform: scale(1.05);
            }
            
            /* 플레이스홀더 광고 */
            .placeholder-ad {
                display: flex;
                align-items: center;
                justify-content: center;
                background: linear-gradient(135deg, #f8f9fa, #e9ecef);
                border: 2px dashed var(--border-color, #dee2e6);
                border-radius: 8px;
                color: var(--text-secondary, #666);
            }
            
            .placeholder-content {
                text-align: center;
                padding: 20px;
            }
            
            .placeholder-icon {
                font-size: 32px;
                margin-bottom: 12px;
                opacity: 0.6;
            }
            
            .placeholder-text h4 {
                margin: 0 0 8px 0;
                font-size: 16px;
                color: var(--text-color, #333);
            }
            
            .placeholder-text p {
                margin: 0;
                font-size: 14px;
                opacity: 0.8;
            }
            
            /* AdBlock 감지 메시지 */
            .adblock-notice {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.8);
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            
            .adblock-notice-content {
                background: var(--bg-primary, white);
                padding: 32px;
                border-radius: 12px;
                max-width: 500px;
                text-align: center;
                box-shadow: 0 20px 40px rgba(0,0,0,0.3);
            }
            
            .adblock-notice-content h4 {
                margin: 0 0 16px 0;
                color: var(--text-color, #333);
                font-size: 20px;
            }
            
            .adblock-notice-content p {
                margin: 0 0 24px 0;
                color: var(--text-secondary, #666);
                line-height: 1.6;
            }
            
            .adblock-notice-content button {
                background: var(--primary-color, #007bff);
                color: white;
                border: none;
                padding: 12px 24px;
                border-radius: 6px;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
                transition: background 0.3s ease;
            }
            
            .adblock-notice-content button:hover {
                background: var(--primary-dark, #0056b3);
            }
            
            /* 반응형 광고 */
            @media (max-width: 768px) {
                .content-ad .ad-slot {
                    height: 120px;
                }
                
                .footer-ad .ad-slot {
                    max-width: 320px;
                    height: 100px;
                }
                
                .sidebar-ad {
                    max-width: 100%;
                    margin: 16px 0;
                }
                
                .sidebar-ad .ad-slot {
                    max-width: 320px;
                    height: 200px;
                }
            }
            
            @media (max-width: 480px) {
                .ad-container {
                    margin: 16px 0;
                }
                
                .content-ad .ad-slot,
                .footer-ad .ad-slot {
                    max-width: 300px;
                    height: 100px;
                }
                
                .content-ad-end .ad-slot {
                    max-width: 300px;
                    height: 250px;
                }
            }
            
            /* 다크 모드 지원 */
            [data-theme="dark"] .ad-slot {
                background: var(--bg-secondary-dark, #2d3748);
                border-color: var(--border-color-dark, #4a5568);
            }
            
            [data-theme="dark"] .placeholder-ad {
                background: linear-gradient(135deg, #2d3748, #4a5568);
                border-color: var(--border-color-dark, #4a5568);
            }
            
            [data-theme="dark"] .adblock-notice-content {
                background: var(--bg-primary-dark, #1a202c);
            }
            
            /* 접근성 개선 */
            .ad-container:focus-within {
                outline: 2px solid var(--primary-color, #007bff);
                outline-offset: 2px;
            }
            
            /* 인쇄 시 광고 숨김 */
            @media print {
                .ad-container {
                    display: none !important;
                }
            }
        `;

    document.head.appendChild(style);
  }
}

// 전역 변수로 설정
let advertisementManager;

// DOM 로드 완료 시 초기화
document.addEventListener("DOMContentLoaded", () => {
  advertisementManager = new AdvertisementManager();

  // 개발자 도구에서 광고 성능 확인 가능
  window.adPerformance = () => advertisementManager.getAdPerformance();
});
