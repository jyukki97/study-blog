(function () {
  const cleanupVersion = "2026-06-11-sw-cache-cleanup-v1";
  const cleanupKey = "jyukki-site-cleanup-version";
  const cachePrefixes = [
    "jyukki-blog-",
    "static-",
    "dynamic-",
    "offline-",
    "images-",
  ];

  function getStoredVersion() {
    try {
      return window.localStorage.getItem(cleanupKey);
    } catch (_) {
      return null;
    }
  }

  function setStoredVersion() {
    try {
      window.localStorage.setItem(cleanupKey, cleanupVersion);
    } catch (_) {
      // Ignore storage failures; cleanup still ran for this page load.
    }
  }

  function isSiteCache(cacheName) {
    return cachePrefixes.some((prefix) => cacheName.startsWith(prefix));
  }

  if (getStoredVersion() === cleanupVersion) {
    return;
  }

  window.addEventListener(
    "load",
    function () {
      const cleanupTasks = [];

      if ("serviceWorker" in navigator) {
        cleanupTasks.push(
          navigator.serviceWorker
            .getRegistrations()
            .then((registrations) =>
              Promise.all(registrations.map((registration) => registration.unregister())),
            ),
        );
      }

      if ("caches" in window) {
        cleanupTasks.push(
          caches
            .keys()
            .then((cacheNames) =>
              Promise.all(cacheNames.filter(isSiteCache).map((cacheName) => caches.delete(cacheName))),
            ),
        );
      }

      Promise.allSettled(cleanupTasks).then(function () {
        setStoredVersion();

        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          window.location.reload();
        }
      });
    },
    { once: true },
  );
})();
