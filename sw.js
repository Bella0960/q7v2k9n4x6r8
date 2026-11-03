/* 小手机 PWA Service Worker
 * 页面与静态资源均采用缓存优先+后台更新，断网/慢网时秒开。
 */
const CACHE_NAME = 'phone-app-pwa-v156-shell1';
const APP_SHELL = [
  // 只预缓存手机外壳与启动必需资源；各 App 页面和重型资源在首次访问时再进入运行时缓存。
  './',
  './index.html',
  './manifest.json',
  './desktop/css/styles.css?v=20261025v2',
  './shared/css/mobile-fit.css?v=20261025v1',
  './shared/css/app-shell.css?v=20261103v1',
  './shared/vendor/liquid-glass/liquid-glass.css?v=1.2.0',
  './shared/js/app-shell-runtime.js?v=20261103v1',
  './shared/js/app-shell-legacy-bridge.js?v=20261103v1',
  './shared/js/font-loader.js?v=20261022v1',
  './shared/js/wallpaper-store.js?v=20261026v2',
  './shared/js/native-feel.js?v=20261026-statusbar2',
  './desktop/js/script.js?v=20261022v1',
  './shared/js/statusbar-control.js?v=20261023v2',
  './shared/js/dock-control.js?v=20261023v1',
  './shared/js/liquid-glass-controls.js?v=20261023v11',
  './shared/js/chat-notifier.js?v=20261102v3',
  './shared/vendor/liquid-glass/liquid-glass.js?v=1.2.0',
  './assets/icon-192.png',
  './assets/icon-512.png'
];;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL).catch(() => Promise.all(
        APP_SHELL.map(url => cache.add(url).catch(() => undefined))
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('phone-app-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// 页面发来 SKIP_WAITING 时立刻接管，让 index.html 的 controllerchange 触发自动刷新
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // HTML 导航改为网络优先：先取最新 HTML 并写入缓存，失败时再回退缓存（离线仍可用）。
  // 旧策略是缓存优先 + 后台更新，浏览器当次拿到的是旧 HTML，必须刷新第二次才生效，
  // 这正是「改了 games.html 却像完全没改」的直接原因。
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        }
        return response;
      }).catch(function () {
        return caches.match(req).then(function (cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // 所有历史版本参数的 font-loader 请求统一读取当前版本，避免旧 query URL 命中旧脚本。
  if (url.pathname.endsWith('/shared/js/font-loader.js')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        var currentLoaderUrl = new URL('shared/js/font-loader.js', self.registration.scope).href;
        return cache.match(currentLoaderUrl).then(function (cached) {
          return cached || fetch(req);
        });
      })
    );
    return;
  }

  // 静态文件缓存优先，并在后台更新缓存。
  event.respondWith(
    caches.match(req).then(cached => {
      const fresh = fetch(req).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return response;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
