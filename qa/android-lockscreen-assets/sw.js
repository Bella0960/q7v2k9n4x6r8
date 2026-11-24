/* Synthetic Android lockscreen QA only. No account, chat or production routes. */
'use strict';
function cleanVisible(value, max) {
  if (typeof value !== 'string') return '';
  return Array.from(value
    .replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, ' ')
    .replace(/\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|app|dev|cn|me|xyz)(?:\/[^\s]*)?/gi, ' ')
    .replace(/\bMAO-[A-Z0-9]{12,24}\b/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F<>\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ').trim()).slice(0, max).join('');
}
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data ? event.data.json() : null; } catch { payload = null; }
    if (!payload || payload.type !== 'test_chat' || payload.roleId !== 'role-fox') return;
    await self.registration.showNotification(cleanVisible(payload.title, 48) || '新消息', {
      body: cleanVisible(payload.body, 120) || '发来一条新消息',
      tag: 'maomao-android-qa-lockscreen',
      icon: '/icon.svg',
      badge: '/icon.svg',
      renotify: false,
      data: { roleId: 'role-fox' }
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const roleId = event.notification.data?.roleId;
    if (roleId !== 'role-fox') return;
    const target = new URL('/chat.html?role=role-fox', self.registration.scope).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url === target && client.focus) return client.focus();
    }
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope) && client.navigate) {
        try {
          const next = await client.navigate(target);
          if (next && next.focus) return next.focus();
        } catch {}
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});