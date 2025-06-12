// PWA 관리자 - Progressive Web App 기능 통합 관리
// jyukki's Blog PWA 구현 (Phase 3.1)

class PWAManager {
  constructor() {
    this.isStandalone = false;
    this.deferredPrompt = null;
    this.registration = null;
    this.isOnline = navigator.onLine;
    this.installButton = null;
    this.updateButton = null;

    this.init();
  }

  async init() {
    console.log("[PWA] 초기화 시작...");

    // PWA 감지
    this.detectStandaloneMode();

    // Service Worker 등록
    await this.registerServiceWorker();

    // 설치 배너 설정
    this.setupInstallPrompt();

    // 오프라인/온라인 상태 감지
    this.setupConnectionMonitoring();

    // 업데이트 관리
    this.setupUpdateManagement();

    // 푸시 알림 설정
    this.setupPushNotifications();

    // UI 업데이트
    this.updateUI();

    console.log("[PWA] 초기화 완료");
  }

  // PWA 독립 실행 모드 감지
  detectStandaloneMode() {
    this.isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone ||
      document.referrer.includes("android-app://");

    console.log("[PWA] 독립 실행 모드:", this.isStandalone);

    if (this.isStandalone) {
      document.documentElement.classList.add("pwa-standalone");

      // PWA 전용 스타일 적용
      this.addPWAStyles();
    }
  }

  // PWA 전용 스타일 추가
  addPWAStyles() {
    const style = document.createElement("style");
    style.textContent = `
            .pwa-standalone .header {
                padding-top: env(safe-area-inset-top, 0);
                background: rgba(177, 156, 217, 0.95);
                backdrop-filter: blur(10px);
            }
            
            .pwa-standalone .main-content {
                padding-bottom: env(safe-area-inset-bottom, 0);
            }
            
            .pwa-install-banner {
                display: none;
            }
            
            .pwa-standalone .pwa-install-banner {
                display: none !important;
            }
        `;
    document.head.appendChild(style);
  }

  // Service Worker 등록
  async registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      try {
        this.registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        console.log("[PWA] Service Worker 등록 성공:", this.registration.scope);

        // 업데이트 확인
        this.registration.addEventListener("updatefound", () => {
          this.handleServiceWorkerUpdate();
        });

        // 활성 Service Worker에서 메시지 수신
        navigator.serviceWorker.addEventListener("message", (event) => {
          this.handleServiceWorkerMessage(event);
        });
      } catch (error) {
        console.error("[PWA] Service Worker 등록 실패:", error);
      }
    }
  }

  // Service Worker 업데이트 처리
  handleServiceWorkerUpdate() {
    const installingWorker = this.registration.installing;

    installingWorker.onstatechange = () => {
      if (installingWorker.state === "installed") {
        if (navigator.serviceWorker.controller) {
          // 새 업데이트 사용 가능
          this.showUpdateAvailable();
        } else {
          // 첫 설치
          console.log("[PWA] Service Worker 첫 설치 완료");
        }
      }
    };
  }

  // Service Worker 메시지 처리
  handleServiceWorkerMessage(event) {
    const { type, data } = event.data;

    switch (type) {
      case "CACHE_UPDATED":
        this.showCacheUpdatedNotification();
        break;
      case "OFFLINE_READY":
        this.showOfflineReadyNotification();
        break;
      case "NEW_CONTENT":
        this.showNewContentNotification(data);
        break;
    }
  }

  // 앱 설치 프롬프트 설정
  setupInstallPrompt() {
    // beforeinstallprompt 이벤트 캐치
    window.addEventListener("beforeinstallprompt", (event) => {
      console.log("[PWA] 설치 프롬프트 준비됨");

      // 기본 프롬프트 방지
      event.preventDefault();

      // 나중에 사용할 수 있도록 저장
      this.deferredPrompt = event;

      // 커스텀 설치 버튼 표시
      this.showInstallButton();
    });

    // 앱 설치 완료 감지
    window.addEventListener("appinstalled", (event) => {
      console.log("[PWA] 앱 설치 완료");
      this.hideInstallButton();
      this.showInstallSuccessNotification();

      // 설치 이벤트 추적
      if (window.gtag) {
        gtag("event", "app_install", {
          event_category: "PWA",
          event_label: "jyukki_blog",
        });
      }
    });
  }

  // 설치 버튼 표시
  showInstallButton() {
    if (this.isStandalone) return; // 이미 설치된 경우 숨김

    // 설치 배너 생성
    const installBanner = this.createInstallBanner();
    document.body.appendChild(installBanner);

    // 애니메이션으로 표시
    setTimeout(() => {
      installBanner.classList.add("show");
    }, 1000);
  }

  // 설치 배너 생성
  createInstallBanner() {
    const banner = document.createElement("div");
    banner.className = "pwa-install-banner";
    banner.innerHTML = `
            <div class="pwa-banner-content">
                <div class="pwa-banner-icon">📱</div>
                <div class="pwa-banner-text">
                    <h3>앱으로 설치하기</h3>
                    <p>jyukki's Blog를 앱으로 설치하여 더 나은 경험을 해보세요!</p>
                </div>
                <div class="pwa-banner-actions">
                    <button class="pwa-install-btn" data-action="install">설치</button>
                    <button class="pwa-dismiss-btn" data-action="dismiss">나중에</button>
                </div>
                <button class="pwa-close-btn" data-action="close">×</button>
            </div>
        `;

    // CSS 스타일 추가
    const style = document.createElement("style");
    style.textContent = `
            .pwa-install-banner {
                position: fixed;
                bottom: -100px;
                left: 20px;
                right: 20px;
                max-width: 500px;
                margin: 0 auto;
                background: linear-gradient(135deg, #b19cd9 0%, #9a7bc8 100%);
                color: white;
                border-radius: 15px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                z-index: 10000;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                backdrop-filter: blur(10px);
            }
            
            .pwa-install-banner.show {
                bottom: 20px;
            }
            
            .pwa-banner-content {
                padding: 20px;
                display: flex;
                align-items: center;
                gap: 15px;
                position: relative;
            }
            
            .pwa-banner-icon {
                font-size: 2.5rem;
                flex-shrink: 0;
            }
            
            .pwa-banner-text h3 {
                margin: 0 0 5px 0;
                font-size: 1.1rem;
                font-weight: 600;
            }
            
            .pwa-banner-text p {
                margin: 0;
                font-size: 0.9rem;
                opacity: 0.9;
            }
            
            .pwa-banner-actions {
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin-left: auto;
            }
            
            .pwa-install-btn, .pwa-dismiss-btn {
                padding: 8px 16px;
                border: none;
                border-radius: 8px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
                font-size: 0.9rem;
            }
            
            .pwa-install-btn {
                background: white;
                color: #b19cd9;
            }
            
            .pwa-install-btn:hover {
                background: #f8f9fa;
                transform: translateY(-1px);
            }
            
            .pwa-dismiss-btn {
                background: rgba(255,255,255,0.2);
                color: white;
                border: 1px solid rgba(255,255,255,0.3);
            }
            
            .pwa-dismiss-btn:hover {
                background: rgba(255,255,255,0.3);
            }
            
            .pwa-close-btn {
                position: absolute;
                top: 10px;
                right: 10px;
                background: none;
                border: none;
                color: white;
                font-size: 1.2rem;
                cursor: pointer;
                width: 30px;
                height: 30px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s;
            }
            
            .pwa-close-btn:hover {
                background: rgba(255,255,255,0.2);
            }
            
            @media (max-width: 768px) {
                .pwa-install-banner {
                    left: 10px;
                    right: 10px;
                    bottom: -120px;
                }
                
                .pwa-install-banner.show {
                    bottom: 10px;
                }
                
                .pwa-banner-content {
                    padding: 15px;
                    flex-direction: column;
                    text-align: center;
                }
                
                .pwa-banner-actions {
                    flex-direction: row;
                    justify-content: center;
                    width: 100%;
                }
            }
        `;
    document.head.appendChild(style);

    // 이벤트 리스너 추가
    banner.addEventListener("click", (event) => {
      const action = event.target.dataset.action;

      switch (action) {
        case "install":
          this.promptInstall();
          break;
        case "dismiss":
          this.dismissInstallBanner(banner);
          break;
        case "close":
          this.closeInstallBanner(banner);
          break;
      }
    });

    return banner;
  }

  // 앱 설치 실행
  async promptInstall() {
    if (!this.deferredPrompt) return;

    try {
      // 설치 프롬프트 표시
      this.deferredPrompt.prompt();

      // 사용자 응답 대기
      const choiceResult = await this.deferredPrompt.userChoice;

      console.log("[PWA] 설치 선택:", choiceResult.outcome);

      if (choiceResult.outcome === "accepted") {
        console.log("[PWA] 사용자가 설치를 수락했습니다");
      } else {
        console.log("[PWA] 사용자가 설치를 거부했습니다");
      }

      // 프롬프트는 한 번만 사용 가능
      this.deferredPrompt = null;

      // 배너 숨김
      this.hideInstallButton();
    } catch (error) {
      console.error("[PWA] 설치 프롬프트 오류:", error);
    }
  }

  // 설치 배너 나중에 닫기
  dismissInstallBanner(banner) {
    banner.classList.remove("show");
    setTimeout(() => {
      banner.remove();
    }, 300);

    // 하루 동안 표시하지 않음
    localStorage.setItem("pwa-install-dismissed", Date.now());
  }

  // 설치 배너 완전 닫기
  closeInstallBanner(banner) {
    this.dismissInstallBanner(banner);

    // 일주일 동안 표시하지 않음
    localStorage.setItem("pwa-install-closed", Date.now());
  }

  // 설치 버튼 숨김
  hideInstallButton() {
    const banner = document.querySelector(".pwa-install-banner");
    if (banner) {
      banner.classList.remove("show");
      setTimeout(() => {
        banner.remove();
      }, 300);
    }
  }

  // 연결 상태 모니터링
  setupConnectionMonitoring() {
    // 온라인/오프라인 상태 변경 감지
    window.addEventListener("online", () => {
      this.isOnline = true;
      this.handleOnlineStateChange();
    });

    window.addEventListener("offline", () => {
      this.isOnline = false;
      this.handleOfflineStateChange();
    });

    // 초기 상태 설정
    this.updateConnectionStatus();
  }

  // 온라인 상태 변경 처리
  handleOnlineStateChange() {
    console.log("[PWA] 온라인 상태로 변경됨");

    // 연결 상태 UI 업데이트
    this.updateConnectionStatus();

    // 백그라운드 동기화 트리거
    this.triggerBackgroundSync();

    // 알림 표시
    this.showConnectionNotification("연결이 복구되었습니다", "success");
  }

  // 오프라인 상태 변경 처리
  handleOfflineStateChange() {
    console.log("[PWA] 오프라인 상태로 변경됨");

    // 연결 상태 UI 업데이트
    this.updateConnectionStatus();

    // 알림 표시
    this.showConnectionNotification(
      "오프라인 모드입니다. 캐시된 콘텐츠를 이용할 수 있습니다.",
      "warning"
    );
  }

  // 연결 상태 UI 업데이트
  updateConnectionStatus() {
    document.documentElement.classList.toggle("offline", !this.isOnline);
    document.documentElement.classList.toggle("online", this.isOnline);

    // 상태 표시기 업데이트
    this.updateConnectionIndicator();
  }

  // 연결 상태 표시기 업데이트
  updateConnectionIndicator() {
    let indicator = document.querySelector(".connection-indicator");

    if (!indicator) {
      indicator = document.createElement("div");
      indicator.className = "connection-indicator";
      document.body.appendChild(indicator);

      // CSS 스타일 추가
      const style = document.createElement("style");
      style.textContent = `
                .connection-indicator {
                    position: fixed;
                    top: 10px;
                    right: 10px;
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    z-index: 9999;
                    transition: all 0.3s;
                    opacity: 0;
                }
                
                .online .connection-indicator {
                    background: #4CAF50;
                    opacity: 0.7;
                }
                
                .offline .connection-indicator {
                    background: #ff9800;
                    opacity: 1;
                    animation: pulse 2s infinite;
                }
                
                @keyframes pulse {
                    0%, 100% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.2); opacity: 0.7; }
                }
            `;
      document.head.appendChild(style);
    }
  }

  // 업데이트 관리 설정
  setupUpdateManagement() {
    // 페이지 로드 시 업데이트 확인
    this.checkForUpdates();

    // 주기적 업데이트 확인 (1시간마다)
    setInterval(() => {
      this.checkForUpdates();
    }, 60 * 60 * 1000);
  }

  // 업데이트 확인
  async checkForUpdates() {
    if (!this.registration) return;

    try {
      await this.registration.update();
      console.log("[PWA] 업데이트 확인 완료");
    } catch (error) {
      console.error("[PWA] 업데이트 확인 실패:", error);
    }
  }

  // 업데이트 사용 가능 알림
  showUpdateAvailable() {
    const notification = this.createUpdateNotification();
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.classList.add("show");
    }, 100);
  }

  // 업데이트 알림 생성
  createUpdateNotification() {
    const notification = document.createElement("div");
    notification.className = "pwa-update-notification";
    notification.innerHTML = `
            <div class="update-content">
                <div class="update-icon">🚀</div>
                <div class="update-text">
                    <h4>업데이트 사용 가능</h4>
                    <p>새로운 기능과 개선사항이 포함되어 있습니다.</p>
                </div>
                <div class="update-actions">
                    <button class="update-btn" data-action="update">업데이트</button>
                    <button class="later-btn" data-action="later">나중에</button>
                </div>
            </div>
        `;

    // CSS 스타일 추가
    const style = document.createElement("style");
    style.textContent = `
            .pwa-update-notification {
                position: fixed;
                top: -100px;
                left: 20px;
                right: 20px;
                max-width: 400px;
                margin: 0 auto;
                background: white;
                border-radius: 12px;
                box-shadow: 0 8px 25px rgba(0,0,0,0.15);
                z-index: 10001;
                transition: all 0.3s ease;
                border: 1px solid #e0e0e0;
            }
            
            .pwa-update-notification.show {
                top: 20px;
            }
            
            .update-content {
                padding: 20px;
                display: flex;
                align-items: center;
                gap: 15px;
            }
            
            .update-icon {
                font-size: 2rem;
                flex-shrink: 0;
            }
            
            .update-text h4 {
                margin: 0 0 5px 0;
                color: #333;
                font-size: 1rem;
            }
            
            .update-text p {
                margin: 0;
                color: #666;
                font-size: 0.9rem;
            }
            
            .update-actions {
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin-left: auto;
            }
            
            .update-btn, .later-btn {
                padding: 8px 16px;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 0.9rem;
                font-weight: 500;
                transition: all 0.2s;
            }
            
            .update-btn {
                background: #b19cd9;
                color: white;
            }
            
            .update-btn:hover {
                background: #9a7bc8;
            }
            
            .later-btn {
                background: #f5f5f5;
                color: #666;
            }
            
            .later-btn:hover {
                background: #e0e0e0;
            }
        `;
    document.head.appendChild(style);

    // 이벤트 리스너 추가
    notification.addEventListener("click", (event) => {
      const action = event.target.dataset.action;

      if (action === "update") {
        this.applyUpdate();
        this.hideUpdateNotification(notification);
      } else if (action === "later") {
        this.hideUpdateNotification(notification);
      }
    });

    return notification;
  }

  // 업데이트 적용
  async applyUpdate() {
    if (!this.registration || !this.registration.waiting) return;

    // Service Worker에게 업데이트 신호 전송
    this.registration.waiting.postMessage({ type: "SKIP_WAITING" });

    // 페이지 새로고침
    window.location.reload();
  }

  // 업데이트 알림 숨김
  hideUpdateNotification(notification) {
    notification.classList.remove("show");
    setTimeout(() => {
      notification.remove();
    }, 300);
  }

  // 푸시 알림 설정
  async setupPushNotifications() {
    if (!("PushManager" in window) || !this.registration) {
      console.log("[PWA] 푸시 알림이 지원되지 않습니다");
      return;
    }

    try {
      // 알림 권한 확인
      const permission = await Notification.requestPermission();

      if (permission === "granted") {
        console.log("[PWA] 알림 권한 승인됨");

        // 푸시 구독 설정 (VAPID 키가 있을 때)
        if (PUSH_CONFIG.applicationServerKey) {
          await this.subscribeToPush();
        }
      } else {
        console.log("[PWA] 알림 권한 거부됨");
      }
    } catch (error) {
      console.error("[PWA] 푸시 알림 설정 오류:", error);
    }
  }

  // 푸시 구독
  async subscribeToPush() {
    try {
      const subscription = await this.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: PUSH_CONFIG.applicationServerKey,
      });

      console.log("[PWA] 푸시 구독 성공:", subscription);

      // 서버에 구독 정보 전송
      await this.sendSubscriptionToServer(subscription);
    } catch (error) {
      console.error("[PWA] 푸시 구독 실패:", error);
    }
  }

  // 서버에 구독 정보 전송
  async sendSubscriptionToServer(subscription) {
    // 실제 서버가 있을 때 구현
    console.log("[PWA] 구독 정보:", subscription);
  }

  // 백그라운드 동기화 트리거
  triggerBackgroundSync() {
    if (
      "serviceWorker" in navigator &&
      "sync" in window.ServiceWorkerRegistration.prototype
    ) {
      navigator.serviceWorker.ready
        .then((registration) => {
          return registration.sync.register("background-sync");
        })
        .catch((error) => {
          console.error("[PWA] 백그라운드 동기화 등록 실패:", error);
        });
    }
  }

  // 연결 알림 표시
  showConnectionNotification(message, type = "info") {
    const notification = document.createElement("div");
    notification.className = `connection-notification ${type}`;
    notification.textContent = message;

    // CSS 스타일 추가
    const style = document.createElement("style");
    style.textContent = `
            .connection-notification {
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                padding: 12px 20px;
                border-radius: 8px;
                color: white;
                font-weight: 500;
                z-index: 10002;
                animation: slideDown 0.3s ease;
            }
            
            .connection-notification.success {
                background: #4CAF50;
            }
            
            .connection-notification.warning {
                background: #ff9800;
            }
            
            .connection-notification.info {
                background: #2196F3;
            }
            
            @keyframes slideDown {
                from {
                    transform: translateX(-50%) translateY(-100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(-50%) translateY(0);
                    opacity: 1;
                }
            }
        `;
    document.head.appendChild(style);

    document.body.appendChild(notification);

    // 3초 후 자동 제거
    setTimeout(() => {
      notification.style.animation = "slideDown 0.3s ease reverse";
      setTimeout(() => {
        notification.remove();
      }, 300);
    }, 3000);
  }

  // 알림 메서드들
  showCacheUpdatedNotification() {
    this.showConnectionNotification("콘텐츠가 업데이트되었습니다", "info");
  }

  showOfflineReadyNotification() {
    this.showConnectionNotification(
      "오프라인에서도 사용할 수 있습니다",
      "success"
    );
  }

  showNewContentNotification(data) {
    this.showConnectionNotification(`새 포스트: ${data.title}`, "info");
  }

  showInstallSuccessNotification() {
    this.showConnectionNotification("앱 설치가 완료되었습니다!", "success");
  }

  // UI 업데이트
  updateUI() {
    // PWA 상태에 따른 UI 클래스 추가
    if (this.isStandalone) {
      document.documentElement.classList.add("pwa-installed");
    }

    if ("serviceWorker" in navigator) {
      document.documentElement.classList.add("pwa-supported");
    }

    // 연결 상태 초기화
    this.updateConnectionStatus();
  }

  // 디버그 정보
  getDebugInfo() {
    return {
      isStandalone: this.isStandalone,
      isOnline: this.isOnline,
      hasServiceWorker: !!this.registration,
      hasDeferredPrompt: !!this.deferredPrompt,
      pushSupported: "PushManager" in window,
      notificationPermission: Notification.permission,
    };
  }
}

// PWA Manager 전역 초기화
const PUSH_CONFIG = {
  applicationServerKey: null, // VAPID 키 설정 필요
  endpoint: null,
};

// DOM 로드 완료 후 PWA 초기화
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    window.pwaManager = new PWAManager();
  });
} else {
  window.pwaManager = new PWAManager();
}

// 개발자 도구용 전역 함수
window.PWA = {
  getInfo: () => window.pwaManager?.getDebugInfo(),
  forceUpdate: () => window.pwaManager?.checkForUpdates(),
  triggerSync: () => window.pwaManager?.triggerBackgroundSync(),
  installApp: () => window.pwaManager?.promptInstall(),
};

console.log("[PWA] PWA Manager 로드 완료");
