// PWA 백그라운드 동기화 및 푸시 알림 유틸리티
// jyukki's Blog PWA 고급 기능 (Phase 3.1)

class PWANotificationManager {
  constructor() {
    this.isSupported = "Notification" in window && "serviceWorker" in navigator;
    this.permission = this.isSupported ? Notification.permission : "denied";
    this.vapidPublicKey = null; // VAPID 공개키 (설정 필요)
    this.subscription = null;

    this.init();
  }

  async init() {
    if (!this.isSupported) {
      console.log("[PWA Notifications] 알림이 지원되지 않습니다");
      return;
    }

    console.log("[PWA Notifications] 알림 매니저 초기화...");

    // 기존 구독 확인
    await this.checkExistingSubscription();

    // 알림 권한 상태 모니터링
    this.monitorPermissionChanges();
  }

  // 기존 푸시 구독 확인
  async checkExistingSubscription() {
    try {
      const registration = await navigator.serviceWorker.ready;
      this.subscription = await registration.pushManager.getSubscription();

      if (this.subscription) {
        console.log(
          "[PWA Notifications] 기존 구독 발견:",
          this.subscription.endpoint
        );
        await this.sendSubscriptionToServer(this.subscription);
      }
    } catch (error) {
      console.error("[PWA Notifications] 기존 구독 확인 실패:", error);
    }
  }

  // 알림 권한 요청
  async requestPermission() {
    if (!this.isSupported) {
      throw new Error("알림이 지원되지 않습니다");
    }

    if (this.permission === "granted") {
      return true;
    }

    try {
      const permission = await Notification.requestPermission();
      this.permission = permission;

      if (permission === "granted") {
        console.log("[PWA Notifications] 알림 권한 승인됨");
        await this.setupPushSubscription();
        return true;
      } else {
        console.log("[PWA Notifications] 알림 권한 거부됨");
        return false;
      }
    } catch (error) {
      console.error("[PWA Notifications] 권한 요청 실패:", error);
      return false;
    }
  }

  // 푸시 구독 설정
  async setupPushSubscription() {
    if (!this.vapidPublicKey) {
      console.log("[PWA Notifications] VAPID 키가 설정되지 않았습니다");
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(this.vapidPublicKey),
      });

      this.subscription = subscription;
      console.log("[PWA Notifications] 푸시 구독 성공:", subscription.endpoint);

      // 서버에 구독 정보 전송
      await this.sendSubscriptionToServer(subscription);
    } catch (error) {
      console.error("[PWA Notifications] 푸시 구독 실패:", error);
    }
  }

  // VAPID 키 변환 유틸리티
  urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  // 서버에 구독 정보 전송
  async sendSubscriptionToServer(subscription) {
    try {
      // 실제 서버 엔드포인트가 있을 때 구현
      console.log("[PWA Notifications] 구독 정보 저장:", {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: btoa(
            String.fromCharCode.apply(
              null,
              new Uint8Array(subscription.getKey("p256dh"))
            )
          ),
          auth: btoa(
            String.fromCharCode.apply(
              null,
              new Uint8Array(subscription.getKey("auth"))
            )
          ),
        },
      });

      // localStorage에 임시 저장
      localStorage.setItem(
        "pwa-push-subscription",
        JSON.stringify({
          endpoint: subscription.endpoint,
          keys: {
            p256dh: btoa(
              String.fromCharCode.apply(
                null,
                new Uint8Array(subscription.getKey("p256dh"))
              )
            ),
            auth: btoa(
              String.fromCharCode.apply(
                null,
                new Uint8Array(subscription.getKey("auth"))
              )
            ),
          },
          subscribeDate: new Date().toISOString(),
        })
      );
    } catch (error) {
      console.error("[PWA Notifications] 구독 정보 전송 실패:", error);
    }
  }

  // 알림 권한 상태 모니터링
  monitorPermissionChanges() {
    // 권한 상태 변경 감지
    if ("permissions" in navigator) {
      navigator.permissions
        .query({ name: "notifications" })
        .then((permission) => {
          permission.addEventListener("change", () => {
            this.permission = permission.state;
            console.log(
              "[PWA Notifications] 권한 상태 변경:",
              permission.state
            );

            if (permission.state === "granted" && !this.subscription) {
              this.setupPushSubscription();
            }
          });
        });
    }
  }

  // 로컬 알림 표시
  showLocalNotification(title, options = {}) {
    if (this.permission !== "granted") {
      console.log("[PWA Notifications] 알림 권한이 없습니다");
      return;
    }

    const defaultOptions = {
      icon: "/android-chrome-192x192.png",
      badge: "/android-chrome-192x192.png",
      vibrate: [200, 100, 200],
      timestamp: Date.now(),
      requireInteraction: false,
      silent: false,
      ...options,
    };

    try {
      const notification = new Notification(title, defaultOptions);

      notification.onclick = (event) => {
        event.preventDefault();
        window.focus();
        notification.close();

        if (options.url) {
          window.open(options.url);
        }
      };

      return notification;
    } catch (error) {
      console.error("[PWA Notifications] 로컬 알림 실패:", error);
    }
  }

  // 푸시 구독 해제
  async unsubscribe() {
    if (!this.subscription) {
      console.log("[PWA Notifications] 활성 구독이 없습니다");
      return;
    }

    try {
      await this.subscription.unsubscribe();
      this.subscription = null;

      // 로컬 스토리지에서 제거
      localStorage.removeItem("pwa-push-subscription");

      console.log("[PWA Notifications] 구독 해제 완료");
    } catch (error) {
      console.error("[PWA Notifications] 구독 해제 실패:", error);
    }
  }

  // 구독 상태 확인
  isSubscribed() {
    return !!this.subscription;
  }

  // 권한 상태 확인
  getPermissionStatus() {
    return this.permission;
  }
}

// 백그라운드 동기화 매니저
class PWABackgroundSync {
  constructor() {
    this.isSupported =
      "serviceWorker" in navigator &&
      "sync" in window.ServiceWorkerRegistration.prototype;
    this.pendingActions = [];

    this.init();
  }

  async init() {
    if (!this.isSupported) {
      console.log("[PWA Sync] 백그라운드 동기화가 지원되지 않습니다");
      return;
    }

    console.log("[PWA Sync] 백그라운드 동기화 매니저 초기화...");

    // 대기 중인 작업 로드
    this.loadPendingActions();

    // 온라인 상태 복구 시 동기화
    window.addEventListener("online", () => {
      this.processPendingActions();
    });
  }

  // 대기 중인 작업 로드
  loadPendingActions() {
    try {
      const stored = localStorage.getItem("pwa-pending-actions");
      this.pendingActions = stored ? JSON.parse(stored) : [];
      console.log("[PWA Sync] 대기 중인 작업:", this.pendingActions.length);
    } catch (error) {
      console.error("[PWA Sync] 대기 작업 로드 실패:", error);
      this.pendingActions = [];
    }
  }

  // 대기 중인 작업 저장
  savePendingActions() {
    try {
      localStorage.setItem(
        "pwa-pending-actions",
        JSON.stringify(this.pendingActions)
      );
    } catch (error) {
      console.error("[PWA Sync] 대기 작업 저장 실패:", error);
    }
  }

  // 백그라운드 동기화 등록
  async registerBackgroundSync(tag = "background-sync") {
    if (!this.isSupported) {
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register(tag);
      console.log("[PWA Sync] 백그라운드 동기화 등록:", tag);
      return true;
    } catch (error) {
      console.error("[PWA Sync] 백그라운드 동기화 등록 실패:", error);
      return false;
    }
  }

  // 작업 추가
  addAction(action) {
    const actionWithId = {
      id: Date.now() + Math.random(),
      timestamp: Date.now(),
      ...action,
    };

    this.pendingActions.push(actionWithId);
    this.savePendingActions();

    // 온라인 상태면 즉시 처리
    if (navigator.onLine) {
      this.processPendingActions();
    } else {
      // 오프라인이면 백그라운드 동기화 등록
      this.registerBackgroundSync();
    }
  }

  // 대기 중인 작업 처리
  async processPendingActions() {
    if (this.pendingActions.length === 0) {
      return;
    }

    console.log(
      "[PWA Sync] 대기 중인 작업 처리 시작:",
      this.pendingActions.length
    );

    const processedActions = [];

    for (const action of this.pendingActions) {
      try {
        await this.processAction(action);
        processedActions.push(action.id);
        console.log("[PWA Sync] 작업 처리 완료:", action.type);
      } catch (error) {
        console.error("[PWA Sync] 작업 처리 실패:", action.type, error);
      }
    }

    // 처리된 작업 제거
    this.pendingActions = this.pendingActions.filter(
      (action) => !processedActions.includes(action.id)
    );
    this.savePendingActions();

    console.log(
      "[PWA Sync] 대기 중인 작업 처리 완료, 남은 작업:",
      this.pendingActions.length
    );
  }

  // 개별 작업 처리
  async processAction(action) {
    switch (action.type) {
      case "post_view":
        await this.trackPostView(action.data);
        break;
      case "search_query":
        await this.trackSearchQuery(action.data);
        break;
      case "user_interaction":
        await this.trackUserInteraction(action.data);
        break;
      case "error_report":
        await this.sendErrorReport(action.data);
        break;
      default:
        console.warn("[PWA Sync] 알 수 없는 작업 타입:", action.type);
    }
  }

  // 포스트 조회 추적
  async trackPostView(data) {
    // Google Analytics나 다른 분석 도구로 전송
    if (window.gtag) {
      gtag("event", "page_view", {
        page_title: data.title,
        page_location: data.url,
        custom_parameter: "offline_sync",
      });
    }
    console.log("[PWA Sync] 포스트 조회 추적:", data.title);
  }

  // 검색 쿼리 추적
  async trackSearchQuery(data) {
    if (window.gtag) {
      gtag("event", "search", {
        search_term: data.query,
        custom_parameter: "offline_sync",
      });
    }
    console.log("[PWA Sync] 검색 쿼리 추적:", data.query);
  }

  // 사용자 상호작용 추적
  async trackUserInteraction(data) {
    if (window.gtag) {
      gtag("event", data.event_name, {
        event_category: data.category,
        event_label: data.label,
        custom_parameter: "offline_sync",
      });
    }
    console.log("[PWA Sync] 사용자 상호작용 추적:", data.event_name);
  }

  // 오류 보고서 전송
  async sendErrorReport(data) {
    // 실제 오류 수집 서비스로 전송
    console.log("[PWA Sync] 오류 보고서 전송:", data);
  }

  // 대기 중인 작업 개수
  getPendingCount() {
    return this.pendingActions.length;
  }

  // 모든 대기 작업 삭제
  clearPendingActions() {
    this.pendingActions = [];
    this.savePendingActions();
    localStorage.removeItem("pwa-pending-actions");
  }
}

// PWA 기능 추적기
class PWAAnalytics {
  constructor() {
    this.startTime = Date.now();
    this.interactions = [];
    this.errors = [];

    this.init();
  }

  init() {
    console.log("[PWA Analytics] 분석 추적기 초기화...");

    // PWA 설치 추적
    this.trackPWAInstallation();

    // 사용 패턴 추적
    this.trackUsagePatterns();

    // 오류 추적
    this.trackErrors();

    // 성능 추적
    this.trackPerformance();
  }

  // PWA 설치 추적
  trackPWAInstallation() {
    window.addEventListener("appinstalled", () => {
      this.trackEvent("pwa_installed", {
        timestamp: Date.now(),
        user_agent: navigator.userAgent,
        display_mode: window.matchMedia("(display-mode: standalone)").matches
          ? "standalone"
          : "browser",
      });
    });

    window.addEventListener("beforeinstallprompt", () => {
      this.trackEvent("pwa_install_prompt_shown", {
        timestamp: Date.now(),
      });
    });
  }

  // 사용 패턴 추적
  trackUsagePatterns() {
    // 페이지 방문 시간 추적
    let pageStartTime = Date.now();

    window.addEventListener("beforeunload", () => {
      const timeSpent = Date.now() - pageStartTime;
      this.trackEvent("page_time_spent", {
        url: window.location.href,
        time_spent: timeSpent,
        timestamp: Date.now(),
      });
    });

    // 스크롤 깊이 추적
    let maxScroll = 0;
    window.addEventListener("scroll", () => {
      const scrollPercent = Math.round(
        (window.scrollY / (document.body.scrollHeight - window.innerHeight)) *
          100
      );
      if (scrollPercent > maxScroll) {
        maxScroll = scrollPercent;
      }
    });

    window.addEventListener("beforeunload", () => {
      this.trackEvent("scroll_depth", {
        max_scroll_percent: maxScroll,
        url: window.location.href,
        timestamp: Date.now(),
      });
    });
  }

  // 오류 추적
  trackErrors() {
    window.addEventListener("error", (event) => {
      this.trackError({
        type: "javascript_error",
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack,
        timestamp: Date.now(),
      });
    });

    window.addEventListener("unhandledrejection", (event) => {
      this.trackError({
        type: "unhandled_promise_rejection",
        reason: event.reason?.toString(),
        timestamp: Date.now(),
      });
    });
  }

  // 성능 추적
  trackPerformance() {
    window.addEventListener("load", () => {
      setTimeout(() => {
        const perfData = performance.getEntriesByType("navigation")[0];
        if (perfData) {
          this.trackEvent("performance_metrics", {
            dns_lookup: perfData.domainLookupEnd - perfData.domainLookupStart,
            tcp_connect: perfData.connectEnd - perfData.connectStart,
            request_response: perfData.responseEnd - perfData.requestStart,
            dom_loading:
              perfData.domContentLoadedEventEnd - perfData.domLoading,
            page_load: perfData.loadEventEnd - perfData.navigationStart,
            timestamp: Date.now(),
          });
        }
      }, 1000);
    });
  }

  // 이벤트 추적
  trackEvent(eventName, data) {
    const event = {
      name: eventName,
      data: data,
      timestamp: Date.now(),
      session_id: this.getSessionId(),
    };

    this.interactions.push(event);

    // 온라인 상태면 즉시 전송, 아니면 백그라운드 동기화에 추가
    if (navigator.onLine) {
      this.sendEventToAnalytics(event);
    } else if (window.pwaBackgroundSync) {
      window.pwaBackgroundSync.addAction({
        type: "user_interaction",
        data: event,
      });
    }
  }

  // 오류 추적
  trackError(errorData) {
    const error = {
      ...errorData,
      session_id: this.getSessionId(),
      url: window.location.href,
      user_agent: navigator.userAgent,
    };

    this.errors.push(error);

    // 오류는 우선순위가 높으므로 즉시 전송 시도
    if (navigator.onLine) {
      this.sendErrorToService(error);
    } else if (window.pwaBackgroundSync) {
      window.pwaBackgroundSync.addAction({
        type: "error_report",
        data: error,
      });
    }
  }

  // 분석 데이터 전송
  sendEventToAnalytics(event) {
    if (window.gtag) {
      gtag("event", event.name, event.data);
    }
    console.log("[PWA Analytics] 이벤트 전송:", event.name, event.data);
  }

  // 오류 데이터 전송
  sendErrorToService(error) {
    // 실제 오류 수집 서비스로 전송
    console.error("[PWA Analytics] 오류 수집:", error);
  }

  // 세션 ID 생성/관리
  getSessionId() {
    let sessionId = sessionStorage.getItem("pwa-session-id");
    if (!sessionId) {
      sessionId = Date.now() + "-" + Math.random().toString(36).substr(2, 9);
      sessionStorage.setItem("pwa-session-id", sessionId);
    }
    return sessionId;
  }

  // 통계 데이터 반환
  getAnalyticsData() {
    return {
      session_id: this.getSessionId(),
      session_duration: Date.now() - this.startTime,
      interactions_count: this.interactions.length,
      errors_count: this.errors.length,
      interactions: this.interactions,
      errors: this.errors,
    };
  }
}

// 전역 인스턴스 생성
window.pwaNotificationManager = new PWANotificationManager();
window.pwaBackgroundSync = new PWABackgroundSync();
window.pwaAnalytics = new PWAAnalytics();

// 개발자 도구용 전역 함수 확장
Object.assign(window.PWA, {
  // 알림 관리
  requestNotificationPermission: () =>
    window.pwaNotificationManager.requestPermission(),
  showNotification: (title, options) =>
    window.pwaNotificationManager.showLocalNotification(title, options),
  getNotificationStatus: () =>
    window.pwaNotificationManager.getPermissionStatus(),

  // 백그라운드 동기화
  addSyncAction: (action) => window.pwaBackgroundSync.addAction(action),
  processPendingActions: () => window.pwaBackgroundSync.processPendingActions(),
  getPendingActionsCount: () => window.pwaBackgroundSync.getPendingCount(),

  // 분석 데이터
  getAnalytics: () => window.pwaAnalytics.getAnalyticsData(),
  trackEvent: (name, data) => window.pwaAnalytics.trackEvent(name, data),
});

console.log("[PWA Utils] PWA 유틸리티 로드 완료");
