/* 小手机 PWA Service Worker
 * 页面与静态资源均采用缓存优先+后台更新，断网/慢网时秒开。
 */
const CACHE_NAME = 'phone-app-pwa-v126';
const APP_SHELL = [
  './',
  './index.html',
  './beauty/beauty.html',
  './chat/footprint/footprint.html',
  './wallet/takeout.html',
  './assets/takeout/s1-noodle.jpg',
  './assets/takeout/s2-milktea.jpg',
  './assets/takeout/s3-bbq.jpg',
  './assets/takeout/s4-salad.jpg',
  './assets/takeout/s5-coffee.jpg',
  './assets/takeout/s6-bento.jpg',
  './assets/takeout/d1-noodle.jpg',
  './assets/takeout/d2-beef.jpg',
  './assets/takeout/d4-bingfen.jpg',
  './assets/takeout/d5-boba.jpg',
  './assets/takeout/d6-matcha.jpg',
  './assets/takeout/d7-taro.jpg',
  './assets/takeout/d8-skewer.jpg',
  './assets/takeout/d9-eggplant.jpg',
  './assets/takeout/d10-chive.jpg',
  './assets/takeout/d11-salad.jpg',
  './assets/takeout/d12-bowl.jpg',
  './assets/takeout/d13-americano.jpg',
  './assets/takeout/d14-latte.jpg',
  './assets/takeout/d15-croissant.jpg',
  './assets/takeout/d16-bento.jpg',
  './shared/js/chat-beauty.js?v=20261026v11',
  './shared/js/wallpaper-store.js?v=20261026v2',
  './shared/css/chat-beauty-runtime.css?v=20261031v1',
  './games/games.html',
  './games/cooking.html',
  './games/css/cooking.css?v=20261025v3',
  './games/js/cooking.js?v=20261025v3',
  './games/js/interrogation-v20.js?v=20',
  './games/assets/tidal-archive-room-v18.webp',
  './cafe/cafe.html',
  './diary/diary.html',
  './chat/date/date.html',
  './chat/date/journey.html',
  './chat/chat/chat-detail.html',
  './travel/dream-travel.html',
  './novel/novel.html',
  './novel/novel-detail.html',
  './novel/novel-stats.html',
  './novel/novel-achievements.html',
  './novel/novel-live-room.html',
  './novel/novel-me.html',
  './novel/novel-setup.html',
  './novel/novel-bible.html',
  './novel/novel-planning.html',
  './novel/novel-editor.html',
  './novel/novel-continuity.html',
  './novel/novel-readers.html',
  './manifest.json',
  'desktop/css/styles.css',
  'settings/css/settings.css',
  'shared/css/mobile-fit.css',
  'shared/js/font-loader.js',
  'shared/js/native-feel.js',
  'shared/js/phone/phone_storage.js',
  'shared/js/phone/chat-message-policy.js?v=20261029v5',
  'shared/js/phone/chat-send-policy.js?v=20261029v2',
  'shared/js/phone/chat-context-policy.js?v=20261029v5',
  'shared/js/phone/phone_stream.js',
  'shared/js/phone/memory_recall.js?v=20261024v2',
  'shared/js/phone/memory_space_v2.js?v=20261024v1',
  'shared/js/phone/phone_api.js',
  'desktop/js/script.js',
  'shared/js/statusbar-control.js',
  'shared/js/nav.js',
  'shared/js/sound-system.js',
  'shared/js/memory.js',
  'shared/js/mask.js',
  'settings/js/settings.js',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

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
