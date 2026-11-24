/* 小手机 PWA Service Worker
 * 页面与静态资源均采用缓存优先+后台更新，断网/慢网时秒开。
 */
const CACHE_NAME = 'phone-app-pwa-v206';
const FONT_ASSET_CACHE = 'maomao-font-assets-v1';
// v196 release: sweep orphaned role-owned media refs during avatar cleanup.
const APP_SHELL = [
  './',
  './index.html',
  './tutorial/tutorial.html',
  './forum/forum.html',
  './forum/forum-detail.html',
  './forum/forum-settings.html',
  './forum/forum-gossip.js',
  './forum/forum-world-events.js?v=20261111v1',
  './inspect-phone/select.html',
  './inspect-phone/phone.html',
  './inspect-phone/inspect-feature.js?v=20261111v1',
  './tutorial/tutorial.js?v=20261111v3',
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
  './games/js/cooking.js?v=20261124v4',
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
  './settings/cloud-push.html',
  './shared/js/cloud-push-client.js',
  './settings/image-generation.html',
  './settings/js/image-generation.js?v=20261106v1',
  'settings/css/settings.css',
  'shared/css/mobile-fit.css',
  'shared/js/font-loader.js',
  'shared/js/native-feel.js',
  'shared/js/phone/phone_storage.js',
  './shared/js/phone/phone_context.js?v=20261102npc1',
  'shared/js/phone/chat-message-policy.js?v=20261029v5',
  './shared/js/phone/chat-image-vision.js?v=20261113v1',
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
  './shared/js/phone/role-avatar-library.js?v=20261113v1',
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

      // Account-bearing HTML must never enter a cache shared by different users.
      const resources = Array.from(new Set(APP_SHELL.concat(pageEntries))).filter(function (entry) {
        const pathname = new URL(entry, self.registration.scope).pathname;
        return pathname !== '/' && !pathname.endsWith('.html') &&
          !pathname.startsWith('/admin/');
      });
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

  // Account-owned API responses must never enter the shared Service Worker cache.
  // The server verifies the current HttpOnly session for each API request.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  // Administrator pages and diagnostics must always reach the server's session gate.
  if (url.pathname.startsWith('/admin/') || url.pathname === '/api/admin/cloud' ||
      url.pathname.startsWith('/api/admin/cloud/')) return;

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

  // Account-scoped HTML is injected by the Worker: do not serve a previous
  // user's cached document. Fail closed offline without changing local records.
  if (req.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).catch(function () {
        return new Response('当前离线，无法安全验证账号。联网后重试，不会清除本机数据。', {
          status: 503,
          headers: {
            'Content-Type': 'text/plain; charset=UTF-8',
            'Cache-Control': 'no-store'
          }
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


/* ------------------------------------------------------------------
 * Android / iOS installed-PWA Web Push.
 * The encrypted push envelope carries only an account guard, an internal
 * message kind and an opaque role ID. No site URL/deep link is accepted.
 * The OS may independently display the browser's site attribution: the app
 * cannot suppress browser/OS security labels.
 * ------------------------------------------------------------------ */

function pushTargetUrl(data) {
  // Construct a fixed same-origin route only at click time. Never read a
  // server-provided URL, even when an older queued notification contains one.
  var scopeUrl = new URL(self.registration.scope);
  var kind = data && String(data.kind || '');
  if (kind === 'chat_message') {
    var roleId = String(data.roleId || '');
    if (roleId && roleId.length <= 96 &&
        !/[\u0000-\u001f\u007f]/.test(roleId)) {
      return new URL('./chat/chat/chat-detail.html?id=' +
        encodeURIComponent(roleId), scopeUrl).href;
    }
  }
  if (kind === 'test') {
    return new URL('./settings/cloud-push.html', scopeUrl).href;
  }
  return new URL('./index.html', scopeUrl).href;
}

async function authorizedPushAccount(accountId) {
  if (!/^MAO-[A-Z0-9]{12,24}$/.test(accountId)) return false;
  var response;
  try {
    response = await fetch('/api/accounts/me', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'accept': 'application/json',
        'x-mao-account-context': accountId
      }
    });
  } catch (error) { return false; }
  if (!response || !response.ok) return false;
  var payload;
  try { payload = await response.json(); }
  catch (error) { return false; }
  var account = payload && payload.account;
  return !!account && account.id === accountId &&
    account.status === 'active';
}

self.addEventListener('push', event => {
  var payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch (error) { payload = {}; }

  event.waitUntil((async function () {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    var accountId = String(payload.accountId || '');
    var kind = String(payload.type || '');
    if (kind !== 'chat_message' && kind !== 'test') return;
    // Do not render an unvalidated envelope or leak chat content to lock screen.
    if (!await authorizedPushAccount(accountId)) return;
    var roleId = kind === 'chat_message' ? String(payload.roleId || '') : '';
    if (kind === 'chat_message' && (!roleId || roleId.length > 96 ||
        /[\u0000-\u001f\u007f]/.test(roleId))) return;

    // Never let remote content supply notification text or external links.
    // Generic text protects role names, user names, chat bodies and URLs.
    var title = kind === 'test' ? '推送测试' : '新消息';
    var body = kind === 'test'
      ? '测试通知已送达，打开小手机查看。'
      : '你有一条新消息，打开小手机查看。';
    var tagValue = String(payload.tag || '');
    var tag = /^[A-Za-z0-9_-]{1,64}$/.test(tagValue)
      ? tagValue : (kind === 'test' ? 'maomao-test' : 'maomao-message');

    await self.registration.showNotification(title, {
      body: body,
      tag: tag,
      // Only opaque route metadata is stored; no URL, API endpoint,
      // user profile, chat excerpt, or site origin is attached by the app.
      data: {
        accountId: accountId,
        kind: kind,
        roleId: roleId
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
  var notice = event.notification.data || {};
  var accountId = String(notice.accountId || '');

  event.waitUntil((async function () {
    // Lock-screen notifications can outlive a login. Never switch a stale
    // notification into another account's chat after a session change.
    if (!await authorizedPushAccount(accountId)) return;
    var targetUrl = pushTargetUrl(notice);

    var windowClients = await self.clients.matchAll({
      type: 'window', includeUncontrolled: true
    });
    for (var i = 0; i < windowClients.length; i += 1) {
      var same = windowClients[i];
      if (same.url === targetUrl && 'focus' in same) return same.focus();
    }
    for (var j = 0; j < windowClients.length; j += 1) {
      var client = windowClients[j];
      // Reuse the installed PWA's existing window when possible.
      // Always navigate to a fixed same-origin URL computed above.
      if (client.url.indexOf(self.registration.scope) === 0 &&
          'navigate' in client) {
        try {
          await client.navigate(targetUrl);
          return client.focus ? client.focus() : undefined;
        } catch (error) {
          // Navigating a suspended iOS/Android page can fail. Open a PWA
          // window as a safe fallback; do not expose remote deep links.
        }
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    return undefined;
  })());
});
