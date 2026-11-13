/* 小手机 PWA Service Worker
 * 页面与静态资源均采用缓存优先+后台更新，断网/慢网时秒开。
 */
const CACHE_NAME = 'phone-app-pwa-v233';
const FONT_ASSET_CACHE = 'maomao-font-assets-v1';
// v196 release: sweep orphaned role-owned media refs during avatar cleanup.
const APP_SHELL = [
  './settings/cloud-push.html',
  './shared/js/cloud-push-client.js?v=20261114v8',
  './',
  './index.html',
  './shared/js/mao-account-scope.js?v=2',
  './account/manage.css',
  './account/manage.js',
  './account/settings-link.js?v=1',
  './admin/admin-center.css',
  './admin/admin-center.js',
  './account/index.html',
  './account/bootstrap.html',
  './account/bootstrap.js',
  './account/account.css',
  './account/ivory-entry.css',
  './account/account.js',
  './tutorial/tutorial.html',
  './forum/forum.html',
  './forum/forum-detail.html',
  './forum/forum-settings.html',
  './forum/forum-gossip.js',
  './forum/forum-world-events.js?v=20261111v1',
  './inspect-phone/select.html',
  './inspect-phone/phone.html',
  './inspect-phone/inspect-feature.js?v=20261111v1',
  './tutorial/tutorial.js?v=20261113chats1',
  './beauty/beauty.html',
  './theme-store/theme-store.html',
  './chat/chat/chat.html',
  './shared/js/chat-action-menu.js?v=20261113v1',
  './shared/js/social-chat-list.js?v=20261113v1',
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
  './chat/chat/chat-settings.html',
  './chat/chat/js/chat-extras.js?t=20261107imagevision1',
  './worldbook/characters/characters.html',
  './worldbook/characters/js/characters-manager.js?v=20261107v11',
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
  './shared/js/phone/chat-image-vision.js?v=20261107v5',
  'shared/js/phone/chat-send-policy.js?v=20261029v2',
  'shared/js/phone/chat-context-policy.js?v=20261107vision1',
  './shared/js/phone/chat-presence-policy.js?v=20261102v17',
  './shared/js/phone/role-public-timeline.js?v=20261102v1',
  './shared/js/phone/group-chat-policy.js?v=20261102v5',
  './shared/js/phone/chat-followup-policy.js?v=20261102v1',
  'shared/js/phone/phone_stream.js',
  'shared/js/phone/memory_recall.js?v=20261024v2',
  'shared/js/phone/memory_space_v2.js?v=20261024v1',
  './shared/js/chat-notifier.js?v=20261102v3',
  'shared/js/phone/storage/repository.js',
  'shared/js/phone/storage/media-repository.js?v=20261107v2',
  './shared/js/phone/role-sticker-library.js?v=20261107v2',
  './shared/js/phone/role-avatar-library.js?v=20261107v14',
  'shared/js/phone/phone_api.js?v=20261106v1',
  'shared/js/phone/image-generation.js?v=20261106v1',
  './shared/js/phone/role-gallery-image-autonomy.js?v=20261111v2',
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

      // Only public sign-in/first-time setup HTML may be cached.
      // Private app documents must always pass the Worker identity gate.
      const resources = Array.from(new Set(APP_SHELL.concat(pageEntries)))
        .filter(url => url === './account/index.html' || url === './account/bootstrap.html' ||
          (url !== './' && url !== '/' && !/\.html(?:\?|$)/i.test(url)));
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

  // Authenticated API responses are account-private; never store them in the shared origin cache.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  // User-imported fonts are cached once by font-loader.js and served as same-origin
  // font resources. Keep this cache separate from the versioned app-shell cache.
  const fontAssetPrefix = new URL('__maomao_fonts/', self.registration.scope).pathname;
  if (url.pathname.startsWith(fontAssetPrefix)) {
    // CSS font requests do not carry custom fetch headers. The account ID is
    // therefore part of ordinary-account font URLs and is matched against the
    // current HttpOnly session before opening any account's CacheStorage.
    event.respondWith((async function () {
      try {
        const relativeFontPath = url.pathname.slice(fontAssetPrefix.length);
        const firstSegment = relativeFontPath.split('/')[0] || '';
        let requestedAccountId = '';
        try { requestedAccountId = decodeURIComponent(firstSegment); } catch (error) {
          return new Response('', { status: 404, headers: { 'Cache-Control': 'no-store' } });
        }
        const hasAccountPath = /^MAO-[A-Z0-9]{12,24}$/.test(requestedAccountId);
        const authHeaders = new Headers({ 'accept': 'application/json' });
        const pageAccountContext = req.headers.get('x-mao-account-context');
        if (pageAccountContext) authHeaders.set('x-mao-account-context', pageAccountContext);
        if (hasAccountPath) authHeaders.set('x-mao-account-context', requestedAccountId);

        const authResponse = await fetch('/api/accounts/me', {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: authHeaders
        });
        if (!authResponse.ok) {
          return new Response('', {
            status: 404,
            headers: { 'Cache-Control': 'no-store' }
          });
        }
        const payload = await authResponse.json();
        const account = payload && payload.account;
        if (!account || !/^MAO-[A-Z0-9]{12,24}$/.test(String(account.id || ''))) {
          return new Response('', {
            status: 404,
            headers: { 'Cache-Control': 'no-store' }
          });
        }

        let cacheName;
        if (account.role === 'super_admin') {
          // Preserve the creator's existing unqualified font URLs and cache.
          if (hasAccountPath) {
            return new Response('', { status: 404, headers: { 'Cache-Control': 'no-store' } });
          }
          cacheName = FONT_ASSET_CACHE;
        } else {
          // A stale tab A must never resolve its font URL through account B's cookie.
          if (!hasAccountPath || requestedAccountId !== account.id) {
            return new Response('', { status: 404, headers: { 'Cache-Control': 'no-store' } });
          }
          cacheName = '__mao_account_v1__' + encodeURIComponent(account.id) + '__' + FONT_ASSET_CACHE;
        }

        const cache = await caches.open(cacheName);
        return await cache.match(req) || new Response('', {
          status: 404,
          headers: { 'Cache-Control': 'no-store' }
        });
      } catch (error) {
        return new Response('', {
          status: 503,
          headers: { 'Cache-Control': 'no-store' }
        });
      }
    })());
    return;
  }

  // Protected app documents must reach the Worker on every navigation so
  // account disable/revocation cannot be bypassed by a stale offline HTML cache.
  // On network loss, fall back only to the public account entry, never cached app pages.
  const accountPath = new URL('account/', self.registration.scope).pathname;
  const isPublicAccountPage = url.pathname === accountPath ||
    url.pathname === accountPath + 'index.html' ||
    url.pathname === accountPath + 'bootstrap.html';
  if (req.mode === 'navigate' && !isPublicAccountPage) {
    event.respondWith((async function () {
      try {
        return await fetch(req);
      } catch {
        const entry = new URL('account/index.html', self.registration.scope);
        const cachedEntry = await caches.match(entry.href).catch(function () { return null; });
        return cachedEntry || new Response('当前处于离线状态，请联网验证 MAO 账号后继续。', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'no-store' }
        });
      }
    })());
    return;
  }

  // The public sign-in pages are network-first to prevent stale layouts after
  // an update. Offline fallback is limited to these public pages; never app HTML.
  if (req.mode === 'navigate' && isPublicAccountPage) {
    event.respondWith((async function () {
      var cacheWritePromise = null;
      var networkPromise = fetch(req, { cache: 'no-store' }).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          cacheWritePromise = caches.open(CACHE_NAME)
            .then(function (cache) { return cache.put(req, copy); })
            .catch(function () { return undefined; });
        }
        return response;
      }).catch(function () { return null; });

      // Keep a successful cache write alive, but show fresh HTML immediately.
      event.waitUntil(networkPromise.then(function () { return cacheWritePromise; })
        .then(function () { return undefined; }));

      var fresh = await networkPromise;
      if (fresh) return fresh;

      // Only when the network genuinely fails, show a cached public sign-in.
      var cached = await caches.match(req).catch(function () { return null; });
      if (cached) return cached;

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

// Cloud Web Push: account-scoped notification receipt and click routing.
function pushTargetUrl(value) {
  var scopeUrl = new URL(self.registration.scope);
  var fallback = new URL('./index.html', scopeUrl).href;
  var raw = String(value || '').trim();
  if (!raw) return fallback;
  try {
    var target = new URL(raw, scopeUrl);
    // 既要同源，也必须留在当前 Service Worker scope 的路径内。
    // 只检查 origin 会放行同域名下其他应用或站点目录的地址。
    var scopePath = scopeUrl.pathname.endsWith('/')
      ? scopeUrl.pathname
      : scopeUrl.pathname + '/';
    var insideScope = target.pathname === scopeUrl.pathname ||
      target.pathname.startsWith(scopePath);
    if (target.origin !== scopeUrl.origin ||
        target.username || target.password ||
        !insideScope) return fallback;
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

  event.waitUntil((async function () {
    // An empty Web Push has no encrypted content, so it isolates FCM -> Chrome
    // delivery from aes128gcm decryption. Only this generic string is shown.
    if (!event.data) {
      await self.registration.showNotification('MAOMAO · 远程空载通知', {
        body: 'FCM 已唤醒 Chrome；这条通知不包含加密消息。',
        tag: 'maomao-remote-empty-' + Date.now(),
        data: { url: pushTargetUrl('./settings/cloud-push.html'), type: 'test' },
        silent: false
      });
      return;
    }
    // This button sends only an explicit, non-sensitive diagnostic. Never
    // require an HttpOnly session fetch to display this harmless test message:
    // Android may have stopped the page/session while Chrome delivers a push.
    // Personal role messages still require a current active account below.
    if (payload.type === 'test') {
      await self.registration.showNotification('MAOMAO · 云端测试通知', {
        body: '这条通知由云端推送到当前浏览器。',
        tag: 'maomao-test-' + String(payload.dedupeKey || Date.now()).slice(-36),
        data: { url: pushTargetUrl('./settings/cloud-push.html'), type: 'test' },
        silent: false
      });
      return;
    }
    // Notifications are private to the MAO account that owns the target device.
    // Re-check the HttpOnly session at display time so a logged-out or switched
    // browser cannot show another account's previously queued push.
    const accountId = String(payload.accountId || '');
    if (!/^MAO-[A-Z0-9]{12,24}$/.test(accountId)) return;
    let authResponse;
    try {
      authResponse = await fetch('/api/accounts/me', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'accept': 'application/json',
          'x-mao-account-context': accountId
        }
      });
    } catch (error) {
      return;
    }
    if (!authResponse || !authResponse.ok) return;
    let authPayload = {};
    try { authPayload = await authResponse.json(); } catch (error) { return; }
    const currentAccount = authPayload && authPayload.account;
    if (!currentAccount ||
        currentAccount.id !== accountId ||
        currentAccount.status !== 'active') return;

    const title = String(payload.title || 'MAOMAO');
    const body = String(payload.body || '你有一条新消息。');
    const targetUrl = pushTargetUrl(payload.url);
    // 相同 tag 的通知会在系统里合并，避免多端/重试造成重复提醒。
    const tag = String(payload.tag || payload.dedupeKey || 'maomao-cloud').slice(0, 64);
    await self.registration.showNotification(title, {
      body,
      tag,
      data: {
        url: targetUrl,
        accountId,
        dedupeKey: String(payload.dedupeKey || '').slice(0, 96),
        type: String(payload.type || 'message').slice(0, 32)
      },
      icon: './assets/mao-bunny-192.png',
      badge: './assets/icon-192.png',
      renotify: false,
      silent: false
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const notificationData = event.notification.data || {};
  const targetUrl = pushTargetUrl(notificationData.url);
  const accountId = String(notificationData.accountId || '');

  event.waitUntil((async function () {
    // Diagnostic notifications contain no private content and can be opened
    // without an active MAO session; the destination still enforces login.
    if (notificationData.type === 'test') {
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return;
    }
    // A notification may remain in the OS tray after logout or account switch.
    // Re-validate the account when clicked; old unbound notifications fail closed.
    if (!/^MAO-[A-Z0-9]{12,24}$/.test(accountId)) return;
    let authResponse;
    try {
      authResponse = await fetch('/api/accounts/me', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'accept': 'application/json',
          'x-mao-account-context': accountId
        }
      });
    } catch (error) {
      return;
    }
    if (!authResponse || !authResponse.ok) return;
    let authPayload = {};
    try { authPayload = await authResponse.json(); } catch (error) { return; }
    const currentAccount = authPayload && authPayload.account;
    if (!currentAccount ||
        currentAccount.id !== accountId ||
        currentAccount.status !== 'active') return;

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
