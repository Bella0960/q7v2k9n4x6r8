/* 小手机 PWA Service Worker
 * 页面与静态资源均采用缓存优先+后台更新，断网/慢网时秒开。
 */
const CACHE_NAME = 'phone-app-pwa-v174';
const FONT_ASSET_CACHE = 'maomao-font-assets-v1';
// v173 release: serve imported fonts from a persistent same-origin cache to avoid per-page IndexedDB Blob reads.
const APP_SHELL = [
  './',
  './index.html',
  './beauty/beauty.html',
  './theme-store/theme-store.html',
  './chat/chat/chat.html',
  './chat/contacts/contacts.html',
  './chat/moments/moments.html',
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
  './shared/js/chat-beauty.js?v=20261102v3',
  './shared/js/chat-page-theme.js?v=20261102v1',
  './shared/js/wallpaper-store.js?v=20261026v2',
  './shared/css/chat-beauty-runtime.css?v=20261031v1',
  './shared/css/silver-butterfly-theme.css?v=20261102v5',
  './shared/css/wechat-theme-refinements.css?v=20261105v2',
  './shared/css/chat-list-editorial-theme.css?v=20261104v2',
  './shared/js/chat-list-theme.js?v=20261104v2',
  './shared/assets/silver-butterfly-photo.webp',
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
  './settings/font-settings.html',
  './settings/image-generation.html',
  './settings/js/image-generation.js?v=20261106v1',
  'settings/css/settings.css',
  'shared/css/mobile-fit.css',
  'shared/js/font-loader.js',
  'shared/js/native-feel.js',
  'shared/js/phone/phone_storage.js',
  './shared/js/phone/phone_context.js?v=20261102npc1',
  'shared/js/phone/chat-message-policy.js?v=20261029v5',
  'shared/js/phone/chat-send-policy.js?v=20261029v2',
  'shared/js/phone/chat-context-policy.js?v=20261031v1',
  './shared/js/phone/chat-presence-policy.js?v=20261102v17',
  './shared/js/phone/role-public-timeline.js?v=20261102v1',
  './shared/js/phone/group-chat-policy.js?v=20261102v5',
  './shared/js/phone/chat-followup-policy.js?v=20261102v1',
  'shared/js/phone/phone_stream.js',
  'shared/js/phone/memory_recall.js?v=20261024v2',
  'shared/js/phone/memory_space_v2.js?v=20261024v1',
  './shared/js/chat-notifier.js?v=20261102v3',
  './shared/js/cloud-push-client.js',
  'shared/js/phone/storage/repository.js',
  'shared/js/phone/storage/media-repository.js?v=20261106v1',
  'shared/js/phone/phone_api.js?v=20261106v1',
  'shared/js/phone/image-generation.js?v=20261106v1',
  'desktop/js/script.js',
  'shared/js/statusbar-control.js',
  'shared/js/nav.js',
  'shared/js/sound-system.js',
  'shared/js/memory.js',
  'shared/js/mask.js',
  'settings/js/settings.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/mao-bunny-192.png',
  './assets/mao-bunny-512.png',
  './assets/avatar-bunny.svg',
  './assets/avatar-cat.svg',
  './assets/avatar-cat-dark.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Vite 在构建时生成全部 HTML 页面清单，避免手机端只缓存少数入口。
      let pageEntries = [];
      try {
        const response = await fetch('./pwa-pages.json', { cache: 'no-store' });
        if (response.ok) {
          const entries = await response.json();
          if (Array.isArray(entries)) {
            pageEntries = entries.filter(entry => typeof entry === 'string' && entry.endsWith('.html'));
          }
        }
      } catch (error) {
        // 清单不可用时仍继续安装已有核心资源，不阻塞整个 PWA。
      }

      const resources = Array.from(new Set(APP_SHELL.concat(pageEntries)));
      await Promise.all(resources.map(url => cache.add(url).catch(() => undefined)));
    }).then(() => self.skipWaiting())
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

  // User-imported fonts are cached once by font-loader.js and served as same-origin
  // font resources. Keep this cache separate from the versioned app-shell cache.
  const fontAssetPrefix = new URL('__maomao_fonts/', self.registration.scope).pathname;
  if (url.pathname.startsWith(fontAssetPrefix)) {
    event.respondWith(
      caches.open(FONT_ASSET_CACHE).then(function (cache) {
        return cache.match(req).then(function (cached) {
          return cached || new Response('', {
            status: 404,
            headers: { 'Cache-Control': 'no-store' }
          });
        });
      })
    );
    return;
  }

  // 页面导航采用“缓存优先、后台更新”：
  // 已缓存的应用立即打开，不让慢网络/VPN 阻塞页面；缓存未命中时才等待网络。
  // 绝不把 index.html 当作其他应用的兜底页面，避免点开应用却重新显示桌面。
  if (req.mode === 'navigate') {
    event.respondWith((async function () {
      var cachedPromise = caches.match(req).catch(function () { return null; });
      var cacheWritePromise = null;
      var networkPromise = fetch(req).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          // 写回缓存单独成 Promise：失败只影响缓存，不影响已成功的网络响应。
          cacheWritePromise = caches.open(CACHE_NAME)
            .then(function (cache) { return cache.put(req, copy); })
            .catch(function () { return undefined; });
        }
        return response;
      }).catch(function () {
        return null;
      });

      // 后台生命周期必须覆盖“取网络 + 打开缓存 + 写入缓存”的完整异步过程。
      var updatePromise = networkPromise.then(function () { return cacheWritePromise; });
      event.waitUntil(updatePromise.then(function () { return undefined; }));

      var cached = await cachedPromise;
      if (cached) return cached;

      var fresh = await networkPromise;
      if (fresh) return fresh;

      return new Response('此页面暂时无法连接，请检查网络后重试。', {
        status: 503,
        headers: {
          'Content-Type': 'text/plain; charset=UTF-8',
          'Cache-Control': 'no-store'
        }
      });
    })());
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

/* ------------------------------------------------------------------
 * Web Push（Milestone 1）
 * 上面的缓存与离线导航逻辑保持不变；这里只新增推送展示与点击路由。
 * 风险控制：通知里的跳转地址只接受本站 scope 内的相对路径，防止被外站劫持。
 * ------------------------------------------------------------------ */

function pushTargetUrl(value) {
  var fallback = new URL('./index.html', self.registration.scope).href;
  var raw = String(value || '').trim();
  if (!raw) return fallback;
  try {
    var target = new URL(raw, self.registration.scope);
    // 只允许本站源：外部 URL、mailto:、javascript: 等一律回退到首页。
    if (target.origin !== self.location.origin) return fallback;
    return target.href;
  } catch (error) {
    return fallback;
  }
}

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = {};
  }
  const title = String(payload.title || 'MAOMAO');
  const body = String(payload.body || '你有一条新消息。');
  const targetUrl = pushTargetUrl(payload.url);
  // 相同 tag 的通知会在系统里合并，避免多端/重试造成重复提醒。
  const tag = String(payload.tag || payload.dedupeKey || 'maomao-cloud').slice(0, 64);

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: {
        url: targetUrl,
        dedupeKey: String(payload.dedupeKey || '').slice(0, 96),
        type: String(payload.type || 'message').slice(0, 32)
      },
      icon: './assets/mao-bunny-192.png',
      badge: './assets/icon-192.png',
      renotify: false,
      silent: false
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = pushTargetUrl(event.notification.data && event.notification.data.url);

  event.waitUntil((async function () {
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windowClients) {
      if (client.url === targetUrl && 'focus' in client) return client.focus();
    }
    for (const client of windowClients) {
      // 已有本站窗口时，直接在该窗口内跳到目标聊天页，避免重复开窗。
      if (client.url.indexOf(self.registration.scope) === 0 && 'navigate' in client) {
        try {
          await client.navigate(targetUrl);
          return client.focus ? client.focus() : undefined;
        } catch (error) {
          // navigate 失败（例如页面正在卸载）时退回 openWindow。
        }
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    return undefined;
  })());
});
