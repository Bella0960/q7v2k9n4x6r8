/* 小手机 PWA Service Worker
 * 页面与静态资源均采用缓存优先+后台更新，断网/慢网时秒开。
 */
const CACHE_NAME = 'phone-app-pwa-v295';
const FONT_ASSET_CACHE = 'maomao-font-assets-v1';
function cacheablePublicResponse(response) {
  return !!(response && response.ok && !response.redirected &&
    !/(?:^|[,\s])(?:no-store|private)(?:[,\s]|$)/i.test(
      String(response.headers && response.headers.get('cache-control') || '')));
}
// Navigation HTML must not cache a JSON/API/error payload with a 200 status.
// Keep static image, script and style caching on its existing independent path.
// Do not retain a stale HTML fallback in a JavaScript, CSS or image cache entry.
function cacheableStaticAsset(response, request) {
  if (!cacheablePublicResponse(response)) return false;
  const path = new URL(request.url).pathname.toLowerCase();
  const type = String(response.headers && response.headers.get('content-type') || '').toLowerCase();
  if (/\.css$/.test(path) || request.destination === 'style') return /^text\/css(?:;|\s|$)/.test(type);
  if (/\.(?:js|mjs)$/.test(path) || request.destination === 'script') {
    return /^(?:text|application)\/(?:javascript|ecmascript)(?:;|\s|$)/.test(type);
  }
  if (/\.(?:png|jpe?g|webp|gif|svg|avif|ico)$/.test(path) || request.destination === 'image') {
    return /^image\//.test(type);
  }
  return true;
}
function cacheablePublicNavigationHtml(response) {
  return cacheablePublicResponse(response) && /^\s*text\/html\s*(?:;|$)/i.test(
    String(response.headers && response.headers.get('content-type') || ''));
}
// v196 release: sweep orphaned role-owned media refs during avatar cleanup.
const APP_SHELL = [
  './',
  './index.html',
  './account/account.js',
  './account/ivory-entry.css',
  './account/account.css',
  './account/bootstrap.js',
  './account/bootstrap.html',
  './account/index.html',
  './admin/admin-center.js?v=20261117-ui3',
  './admin/admin-center.css?v=20261117-ui1',
  './account/settings-link.js?v=1',
  './account/manage.js',
  './account/manage.css',
  './shared/js/mao-account-scope.js?v=3',
  './tutorial/tutorial.html',
  './forum/forum.html',
  './forum/forum-detail.html',
  './forum/forum-settings.html',
  './forum/forum-gossip.js',
  './forum/forum-world-events.js?v=20261111v1',
  './inspect-phone/select.html',
  './inspect-phone/phone.html',
  './inspect-phone/inspect-feature.js?v=20261121v11',
  './inspect-phone/inspect-native.css?v=20261121v6',
  './tutorial/tutorial.js?v=20261118book2',
  './beauty/beauty.html',
  './theme-store/theme-store.html',
  './chat/chat/chat.html',
  './chat/contacts/contacts.html',
  './chat/contacts/npc-friends.html',
  './shared/js/phone/npc-social.js?v=20261108i',
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
  './chat/chat/avatar-manager.html',
  './chat/chat/avatar-manager.js?v=20261117v1',
  './chat/chat/js/chat-extras.js?t=20261122cards3',
  './worldbook/characters/characters.html',
  './shared/js/phone/character-card-client.js?v=20261122-neutral-v1',
  './worldbook/characters/js/characters-manager.js?v=20261122-inline-v2',
  './worldbook/characters/js/character-ai-json.js?v=20261122-json-v3',
  './worldbook/characters/js/character-ai-drafts.js?v=20261122-budget-v4',
  './shared/js/phone/role-worldbook-bindings.js?v=20261119-qa1',
  './shared/js/phone/chat-regex-policy.js?v=20261119regex1',
  './shared/js/phone/chat-history-atomic.js?v=20261118v3',
  './worldbook/settings/regex-editor.css?v=20261119regex1',
  './worldbook/settings/regex-editor.js?v=20261119regex1',
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
  'shared/js/phone/phone_storage.js?v=20261121memory1',
  './shared/js/phone/phone_context.js?v=20261102npc1',
  'shared/js/phone/chat-message-policy.js?v=20261029v5',
  'shared/js/phone/chat-message-policy.js?v=20261122search1',
  './shared/js/phone/chat-image-vision.js?v=20261113v1',
  'shared/js/phone/chat-send-policy.js?v=20261122-draftfix1',
  'shared/js/phone/chat-context-policy.js?v=20261118historybudget1',
  './shared/js/phone/chat-presence-policy.js?v=20261119scheduled1',
  './shared/js/phone/role-public-timeline.js?v=20261102v1',
  './shared/js/phone/group-chat-policy.js?v=20261118groupvoice1',
  './shared/js/phone/rp-default-protocol.js?v=20261120identity2',
  './shared/js/phone/chat-role-context.js?v=20261120identity2',
  './shared/js/phone/chat-scheduled-role-context.js?v=20261119scheduled1',
  './shared/js/group-governance.js?v=20261121group1',
  './shared/js/phone/group-game-session.js?v=20261116game11',
  './shared/js/phone/group-turn-effects.js?v=20261115gte2',
  './shared/js/phone/group-private-receipt-recovery.js?v=20261115gpr1',
  './shared/js/phone/group-memory-events.js?v=20261116gme4',
  './shared/js/phone/group-game-panel.js?v=20261116gpanel6',
  './shared/js/phone/group-game-chat-receipts.js?v=20261116receipt2',
  './shared/js/group-settings-layout.js?v=20261121group1',
  './shared/js/group-settings-home.js?v=20261121group1',
  './shared/css/group-settings-home.css?v=20261121group1',
  './shared/js/phone/group_memory_view.js?v=20261121memory1',
  './shared/js/phone/chat-followup-policy.js?v=20261122stop1',
  'shared/js/phone/phone_stream.js',
  'shared/js/phone/phone_api_monitor.js',
  'shared/css/phone-api-monitor.css',
  'shared/js/phone/memory_recall.js?v=20261118groupmemory1',
  'shared/js/phone/memory_space_v2.js?v=20261121v2',
  './shared/js/chat-notifier.js?v=20261119scheduled1',
  'shared/js/phone/storage/repository.js',
  'shared/js/phone/storage/media-repository.js?v=20261107v2',
  './shared/js/phone/role-sticker-library.js?v=20261107v2',
  './shared/js/phone/role-avatar-library.js?v=20261121avatar1',
  './shared/js/phone/role-avatar-choice.js?v=20261113v1',
  'shared/js/phone/phone_api.js?v=20261106v1',
  'shared/js/phone/phone_api.js?v=20261121inspect1',
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
      await Promise.all(resources.map(function (url) {
        if (url === './account/index.html' || url === './account/bootstrap.html') {
          return fetch(url, { cache: 'no-store' }).then(function (response) {
            return cacheablePublicResponse(response) ? cache.put(url, response) : undefined;
          }).catch(function () { return undefined; });
        }
        return cache.add(url).catch(function () { return undefined; });
      }));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  // Remove every obsolete app-shell generation before controlling any page.
  // Leave imported user media, font assets and account-scoped caches untouched.
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME &&
        (key.startsWith('phone-app-') || key.startsWith('maomao-app-shell-')))
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
  // Never replace a protected URL with a cached login page when the network drops:
  // that impersonates a logout and breaks relative resource resolution.
  const accountPath = new URL('account/', self.registration.scope).pathname;
  const isPublicAccountPage = url.pathname === accountPath ||
    url.pathname === accountPath + 'index.html' ||
    url.pathname === accountPath + 'bootstrap.html';
  if (req.mode === 'navigate' && !isPublicAccountPage) {
    event.respondWith((async function () {
      try {
        // Always reach the Worker account guard; never reuse a previous 302.
        return await fetch(req, { cache: 'no-store' });
      } catch {
        // No private HTML may be read from CacheStorage. Equally, do not inject
        // public sign-in HTML into a private route just because fetch failed.
        return new Response(
          '<!doctype html><html lang="zh-CN"><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
          '<title>暂时无法连接</title><body style="margin:0;padding:12vh 8vw;background:#fafafa;color:#333;' +
          'font:15px/1.8 -apple-system,BlinkMacSystemFont,sans-serif">' +
          '<h1 style="font-size:19px;font-weight:500">连接暂时中断</h1>' +
          '<p>登录状态尚未确认，没有退出账号。请恢复网络后重新打开当前页面。</p>' +
          '<button onclick="location.reload()" style="padding:9px 20px;border:1px solid #bbb;' +
          'border-radius:9px;background:#fff;color:#333">重新连接</button></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=UTF-8',
            'Cache-Control': 'no-store', 'Retry-After': '5' } }
        );
      }
    })());
    return;
  }

  // The public sign-in pages are network-first to prevent stale layouts after
  // an update. Offline fallback is limited to these public pages; never app HTML.
  // Non-navigation HTML must still pass the Worker account gate. A script
  // may fetch app HTML without a navigation, and cached account-injected meta
  // tags from a different login must never be reused across users.
  if (!isPublicAccountPage && (url.pathname === '/' || /\.html$/i.test(url.pathname))) {
    event.respondWith(fetch(req));
    return;
  }

  if (req.mode === 'navigate' && isPublicAccountPage) {
    event.respondWith((async function () {
      var cacheWritePromise = null;
      var networkPromise = fetch(req, { cache: 'no-store' }).then(function (response) {
        if (cacheablePublicNavigationHtml(response)) {
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
      var cached = await caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(req);
      }).catch(function () { return null; });
      if (cacheablePublicNavigationHtml(cached)) return cached;

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

  // Welcome page artwork/styles only: network-first, cached fallback when offline.
  // All other app assets keep the existing cache-first strategy below.
  // The welcome page's Vite CSS may be emitted under /assets with a content hash,
  // so scope that stylesheet by its SAME-ORIGIN welcome document referrer.
  const welcomePagePath = accountPath + 'index.html';
  let fromWelcomePage = false;
  if (req.destination === 'style' && req.referrer) {
    try {
      const referringPage = new URL(req.referrer);
      fromWelcomePage = referringPage.origin === self.location.origin &&
        (referringPage.pathname === welcomePagePath ||
          referringPage.pathname === accountPath);
    } catch (error) {
      fromWelcomePage = false;
    }
  }
  const isWelcomeStyle = (url.pathname === accountPath + 'account.css' ||
    url.pathname === accountPath + 'ivory-entry.css') ||
    (req.destination === 'style' && fromWelcomePage && /\.css$/i.test(url.pathname));
  const welcomeArtPath = new URL('assets/ivory-mao/', self.registration.scope).pathname;
  const isWelcomeArtwork = url.pathname === welcomeArtPath + 'hero.webp' ||
    url.pathname === welcomeArtPath + 'ornament.webp' ||
    url.pathname === welcomeArtPath + 'leafshadow.webp';
  if (isWelcomeStyle || isWelcomeArtwork) {
    event.respondWith((async function () {
      var cacheWritePromise = null;
      var networkPromise = fetch(req, { cache: 'no-store' }).then(function (response) {
        const type = String(response.headers && response.headers.get('content-type') || '');
        const correctType = isWelcomeStyle
          ? /^\s*text\/css\s*(?:;|$)/i.test(type)
          : /^\s*image\/webp\s*(?:;|$)/i.test(type);
        if (correctType && cacheablePublicResponse(response)) {
          const copy = response.clone();
          cacheWritePromise = caches.open(CACHE_NAME)
            .then(function (cache) { return cache.put(req, copy); })
            .catch(function () { return undefined; });
        }
        return response;
      }).catch(function () { return null; });
      event.waitUntil(networkPromise.then(function () { return cacheWritePromise; })
        .then(function () { return undefined; }));

      const fresh = await networkPromise;
      if (fresh) return fresh;
      const cached = await caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(req).then(function (hit) {
          // Welcome-only offline compatibility for previous versioned asset URLs.
          return hit || cache.match(req, { ignoreSearch: true });
        });
      }).catch(function () { return null; });
      const cachedType = String(cached && cached.headers && cached.headers.get('content-type') || '');
      if (cacheablePublicResponse(cached) && (isWelcomeStyle
        ? /^\s*text\/css\s*(?:;|$)/i.test(cachedType)
        : /^\s*image\/webp\s*(?:;|$)/i.test(cachedType))) return cached;
      return new Response('', { status: 503, headers: { 'Cache-Control': 'no-store' } });
    })());
    return;
  }

  // Read only this SW generation, not other CacheStorage namespaces: an older
  // image/CSS response must never hijack a newer asset URL.
  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      let cached = await cache.match(req).catch(() => null);
      if (cached && !cacheableStaticAsset(cached, req)) {
        await cache.delete(req).catch(() => undefined);
        cached = null;
      }
      const fresh = fetch(req).then(response => {
        if (cacheableStaticAsset(response, req)) {
          cache.put(req, response.clone()).catch(() => undefined);
        }
        return response;
      }).catch(() => cached || new Response('', {
        status: 503, headers: { 'Cache-Control': 'no-store' }
      }));
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
      await self.registration.showNotification('远程连接提醒', {
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
      await self.registration.showNotification('云端推送测试', {
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

    const title = String(payload.title || '新消息').replace(/MAOMAO/gi, '消息');
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
