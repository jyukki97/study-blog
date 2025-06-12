// ===== 고급 Service Worker for PWA (Phase 3.1) =====
const CACHE_NAME = "jyukki-blog-v2";
const STATIC_CACHE = "static-v2";
const DYNAMIC_CACHE = "dynamic-v2";
const OFFLINE_CACHE = "offline-v2";
const IMAGE_CACHE = "images-v2";

// 캐시할 정적 리소스 목록 (확장됨)
const STATIC_ASSETS = [
  "/",
  "/offline.html",
  "/manifest.json",
  "/js/fuse.min.js",
  "/js/performance-optimizer.js",
  "/js/search.js",
  "/js/enhanced-theme-toggle.js",
  "/js/post-view-enhancements.js",
  "/js/advanced-comments.js",
  "/js/blog-analytics.js",
  "/css/common/search.css",
  "/css/common/image-optimization.css",
  "/css/advanced-search.css",
  "/css/advanced-theme-toggle.css",
  "/css/analytics-widgets.css",
];

// 오프라인에서 캐시할 포스트 (최신 10개)
const OFFLINE_POSTS = [];

// 캐시 전략 설정
const CACHE_STRATEGIES = {
  static: 'cache-first',      // 정적 자원
  dynamic: 'network-first',   // 동적 콘텐츠
  images: 'cache-first',      // 이미지
  api: 'network-first'        // API 호출
};

// Push 알림 설정
const PUSH_CONFIG = {
  applicationServerKey: null, // VAPID 키 (설정 필요)
  endpoint: null
};

// Service Worker 설치
self.addEventListener("install", (event) => {
  console.log("[SW] Installing enhanced service worker v2...");

  event.waitUntil(
    Promise.all([
      // 정적 자원 캐시
      caches.open(STATIC_CACHE).then((cache) => {
        console.log("[SW] Caching static assets");
        return cache.addAll(STATIC_ASSETS);
      }),
      
      // 오프라인 페이지 캐시
      caches.open(OFFLINE_CACHE).then((cache) => {
        console.log("[SW] Caching offline content");
        return cache.add("/offline.html");
      }),
      
      // 최신 포스트 목록 가져와서 캐시
      fetchAndCacheLatestPosts()
    ])
    .then(() => {
      console.log("[SW] All assets cached successfully");
      return self.skipWaiting();
    })
    .catch((error) => {
      console.error("[SW] Failed to cache assets:", error);
    })
  );
});

// Service Worker 활성화
self.addEventListener("activate", (event) => {
  console.log("[SW] Activating enhanced service worker...");

  event.waitUntil(
    Promise.all([
      // 이전 버전 캐시 정리
      cleanupOldCaches(),
      
      // 클라이언트 제어 시작
      self.clients.claim(),
      
      // 백그라운드 동기화 등록
      self.registration.sync?.register('background-sync')
    ])
    .then(() => {
      console.log("[SW] Service worker activated successfully");
      
      // 모든 클라이언트에게 업데이트 알림
      notifyClientsOfUpdate();
    })
  );
});

// 네트워크 요청 가로채기 (고급 캐시 전략)
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // 외부 도메인 요청은 처리하지 않음
  if (url.origin !== location.origin) {
    return;
  }
  
  event.respondWith(handleRequest(request));
});

// 요청 처리 함수
async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  
  try {
    // 요청 타입별 캐시 전략 적용
    if (isStaticAsset(path)) {
      return await cacheFirst(request, STATIC_CACHE);
    } else if (isImage(path)) {
      return await cacheFirst(request, IMAGE_CACHE);
    } else if (isPost(path)) {
      return await networkFirst(request, DYNAMIC_CACHE);
    } else if (isSearchRequest(path)) {
      return await networkFirst(request, DYNAMIC_CACHE);
    } else {
      return await networkFirst(request, DYNAMIC_CACHE);
    }
  } catch (error) {
    console.error("[SW] Request failed:", error);
    return await getOfflineFallback(request);
  }
}

// Cache-First 전략
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    // 백그라운드에서 업데이트 확인
    updateCacheInBackground(request, cache);
    return cachedResponse;
  }
  
  const networkResponse = await fetch(request);
  if (networkResponse.ok) {
    cache.put(request, networkResponse.clone());
  }
  
  return networkResponse;
}

// Network-First 전략
async function networkFirst(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    throw error;
  }
}

// 백그라운드 캐시 업데이트
async function updateCacheInBackground(request, cache) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
  } catch (error) {
    console.log("[SW] Background update failed:", error);
  }
}

// 오프라인 폴백
async function getOfflineFallback(request) {
  const url = new URL(request.url);
  
  if (request.destination === 'document') {
    // HTML 페이지 요청
    const cache = await caches.open(OFFLINE_CACHE);
    return await cache.match('/offline.html');
  } else if (isImage(url.pathname)) {
    // 이미지 요청 - 기본 이미지 반환
    return new Response(
      '<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f0f0f0"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="#999">오프라인</text></svg>',
      { headers: { 'Content-Type': 'image/svg+xml' } }
    );
  }
  
  return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

// 최신 포스트 가져와서 캐시
async function fetchAndCacheLatestPosts() {
  try {
    const response = await fetch('./searchindex.json');
    const searchIndex = await response.json();
    
    // 최신 10개 포스트 선별
    const latestPosts = searchIndex
      .filter(item => item.url && item.url.includes('/posts/'))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10);
    
    const cache = await caches.open(DYNAMIC_CACHE);
    
    // 각 포스트 캐시
    for (const post of latestPosts) {
      try {
        const postResponse = await fetch(post.url);
        if (postResponse.ok) {
          await cache.put(post.url, postResponse);
          OFFLINE_POSTS.push(post.url);
        }
      } catch (error) {
        console.warn("[SW] Failed to cache post:", post.url);
      }
    }
    
    console.log(`[SW] Cached ${OFFLINE_POSTS.length} posts for offline reading`);
  } catch (error) {
    console.error("[SW] Failed to fetch latest posts:", error);
  }
}

// 이전 캐시 정리
async function cleanupOldCaches() {
  const cacheNames = await caches.keys();
  const validCaches = [STATIC_CACHE, DYNAMIC_CACHE, OFFLINE_CACHE, IMAGE_CACHE];
  
  return Promise.all(
    cacheNames.map((cacheName) => {
      if (!validCaches.includes(cacheName)) {
        console.log("[SW] Deleting old cache:", cacheName);
        return caches.delete(cacheName);
      }
    })
  );
}

// 클라이언트에게 업데이트 알림
function notifyClientsOfUpdate() {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({
        type: 'SW_UPDATED',
        message: 'Service Worker가 업데이트되었습니다.'
      });
    });
  });
}

// 유틸리티 함수들
function isStaticAsset(path) {
  return path.match(/\.(css|js|ico|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$/);
}

function isImage(path) {
  return path.match(/\.(png|jpg|jpeg|gif|svg|webp|avif)$/);
}

function isPost(path) {
  return path.includes('/posts/') && !path.includes('/posts/index');
}

function isSearchRequest(path) {
  return path.includes('searchindex.json') || path.includes('/search');
}

// Push 알림 처리
self.addEventListener('push', (event) => {
  console.log("[SW] Push message received");
  
  if (!event.data) return;
  
  const data = event.data.json();
  const options = {
    body: data.body || '새로운 포스트가 게시되었습니다.',
    icon: '/images/icon-192x192.png',
    badge: '/images/badge-72x72.png',
    tag: 'blog-notification',
    renotify: true,
    requireInteraction: false,
    actions: [
      {
        action: 'view',
        title: '보기',
        icon: '/images/view-icon.png'
      },
      {
        action: 'close',
        title: '닫기',
        icon: '/images/close-icon.png'
      }
    ],
    data: {
      url: data.url || '/',
      timestamp: Date.now()
    }
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || '새 포스트', options)
  );
});

// 알림 클릭 처리
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const action = event.action;
  const notificationData = event.notification.data;
  
  if (action === 'view' || !action) {
    event.waitUntil(
      clients.openWindow(notificationData.url || '/')
    );
  }
  
  // 분석 데이터 전송
  event.waitUntil(
    fetch('/api/analytics/notification-click', {
      method: 'POST',
      body: JSON.stringify({
        action: action || 'view',
        url: notificationData.url,
        timestamp: notificationData.timestamp
      })
    }).catch(() => {}) // 분석 실패해도 무시
  );
});

// 백그라운드 동기화
self.addEventListener('sync', (event) => {
  console.log("[SW] Background sync triggered:", event.tag);
  
  if (event.tag === 'background-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

// 백그라운드 동기화 작업
async function doBackgroundSync() {
  try {
    // 오프라인 중 수집된 분석 데이터 전송
    await syncAnalyticsData();
    
    // 캐시 업데이트
    await updateCriticalCaches();
    
    // 새 포스트 확인
    await checkForNewPosts();
    
    console.log("[SW] Background sync completed");
  } catch (error) {
    console.error("[SW] Background sync failed:", error);
  }
}

// 분석 데이터 동기화
async function syncAnalyticsData() {
  // IndexedDB에서 오프라인 분석 데이터 가져와서 전송
  // (실제 구현에서는 IndexedDB 사용)
  console.log("[SW] Syncing analytics data");
}

// 중요 캐시 업데이트
async function updateCriticalCaches() {
  const cache = await caches.open(STATIC_CACHE);
  
  // 중요한 페이지들 다시 캐시
  const criticalPages = ['/', '/posts/', '/tags/', '/categories/'];
  
  for (const page of criticalPages) {
    try {
      const response = await fetch(page);
      if (response.ok) {
        await cache.put(page, response);
      }
    } catch (error) {
      console.warn("[SW] Failed to update cache for:", page);
    }
  }
}

// 새 포스트 확인 및 알림
async function checkForNewPosts() {
  try {
    const response = await fetch('./searchindex.json');
    const searchIndex = await response.json();
    
    const latestPost = searchIndex
      .filter(item => item.url && item.url.includes('/posts/'))
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    
    if (latestPost) {
      const lastNotifiedPost = await getLastNotifiedPost();
      
      if (!lastNotifiedPost || latestPost.url !== lastNotifiedPost) {
        // 새 포스트 발견 - 알림 전송
        await self.registration.showNotification('새 포스트!', {
          body: latestPost.title,
          icon: '/images/icon-192x192.png',
          tag: 'new-post',
          data: { url: latestPost.url }
        });
        
        await saveLastNotifiedPost(latestPost.url);
      }
    }
  } catch (error) {
    console.error("[SW] Failed to check for new posts:", error);
  }
}

// 마지막 알림 포스트 저장/조회 (간단한 예시)
async function getLastNotifiedPost() {
  // 실제로는 IndexedDB 사용
  return null;
}

async function saveLastNotifiedPost(url) {
  // 실제로는 IndexedDB 사용
  console.log("[SW] Last notified post saved:", url);
}

// 메시지 핸들링 (클라이언트와 통신)
self.addEventListener('message', (event) => {
  const { type, data } = event.data;
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'GET_CACHE_STATS':
      getCacheStats().then(stats => {
        event.ports[0].postMessage({ type: 'CACHE_STATS', data: stats });
      });
      break;
      
    case 'CLEAR_CACHE':
      clearSpecificCache(data.cacheName).then(() => {
        event.ports[0].postMessage({ type: 'CACHE_CLEARED' });
      });
      break;
      
    case 'FORCE_UPDATE':
      forceUpdateCaches().then(() => {
        event.ports[0].postMessage({ type: 'UPDATE_COMPLETE' });
      });
      break;
  }
});

// 캐시 통계 조회
async function getCacheStats() {
  const cacheNames = await caches.keys();
  const stats = {};
  
  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    stats[cacheName] = {
      count: keys.length,
      size: await getCacheSize(cache)
    };
  }
  
  return stats;
}

// 캐시 크기 계산
async function getCacheSize(cache) {
  const keys = await cache.keys();
  let size = 0;
  
  for (const key of keys) {
    const response = await cache.match(key);
    if (response) {
      const blob = await response.blob();
      size += blob.size;
    }
  }
  
  return size;
}

// 특정 캐시 정리
async function clearSpecificCache(cacheName) {
  return await caches.delete(cacheName);
}

// 강제 캐시 업데이트
async function forceUpdateCaches() {
  // 모든 캐시 삭제 후 재구성
  await cleanupOldCaches();
  
  // 정적 자원 다시 캐시
  const cache = await caches.open(STATIC_CACHE);
  await cache.addAll(STATIC_ASSETS);
  
  // 최신 포스트 다시 캐시
  await fetchAndCacheLatestPosts();
}

console.log("[SW] Enhanced Service Worker v2 loaded with PWA features");
            }
          })
        );
      })
      .then(() => {
        console.log("[SW] Service worker activated");
        return self.clients.claim();
      })
  );
});

// 네트워크 요청 가로채기
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 같은 도메인의 요청만 처리
  if (url.origin !== location.origin) return;

  // GET 요청만 처리
  if (request.method !== "GET") return;

  event.respondWith(
    cacheFirst(request)
      .catch(() => networkFirst(request))
      .catch(() => fallback(request))
  );
});

/**
 * Cache First 전략 (정적 리소스용)
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    console.log("[SW] Serving from cache:", request.url);
    return cached;
  }
  throw new Error("Not in cache");
}

/**
 * Network First 전략 (동적 콘텐츠용)
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);

    // 성공적인 응답만 캐시
    if (response.status === 200) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
      console.log("[SW] Cached dynamic content:", request.url);
    }

    return response;
  } catch (error) {
    console.log("[SW] Network failed, trying cache:", request.url);
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

/**
 * 폴백 처리 (오프라인 페이지)
 */
async function fallback(request) {
  const url = new URL(request.url);

  // HTML 페이지 요청 시 오프라인 페이지 반환
  if (request.headers.get("accept").includes("text/html")) {
    const offlinePage = await caches.match("/offline.html");
    if (offlinePage) return offlinePage;
  }

  // 이미지 요청 시 기본 이미지 반환
  if (request.headers.get("accept").includes("image")) {
    return new Response("", {
      status: 200,
      headers: { "Content-Type": "image/svg+xml" },
    });
  }

  throw new Error("No fallback available");
}

// 백그라운드 동기화 (추후 PWA 확장용)
self.addEventListener("sync", (event) => {
  if (event.tag === "background-sync") {
    console.log("[SW] Background sync triggered");
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  // 추후 오프라인 데이터 동기화 구현
  console.log("[SW] Performing background sync...");
}

// 메시지 처리 (클라이언트와 통신)
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  if (event.data && event.data.type === "GET_CACHE_SIZE") {
    getCacheSize().then((size) => {
      event.ports[0].postMessage({ type: "CACHE_SIZE", size });
    });
  }
});

// 캐시 크기 계산
async function getCacheSize() {
  const cacheNames = await caches.keys();
  let totalSize = 0;

  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();

    for (const request of requests) {
      const response = await cache.match(request);
      if (response) {
        const responseClone = response.clone();
        const buffer = await responseClone.arrayBuffer();
        totalSize += buffer.byteLength;
      }
    }
  }

  return Math.round(totalSize / 1024); // KB 단위로 반환
}
