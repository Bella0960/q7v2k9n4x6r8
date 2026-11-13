/*
 * Server-backed real-person conversations in the existing chat home list.
 * No additional contact-list tile, no AI contacts, no localStorage/cache.
 * Use only current session + approved friendships; never restore stale
 * account data after logout, switching accounts, removing or blocking peers.
 */
(function (root) {
  'use strict';
  var ACCOUNT_ID = /^MAO-[A-Z0-9]{12,24}$/;
  var records = [];
  var currentOwner = null;
  var revision = 0;
  var listeners = new Set();

  function changed() {
    listeners.forEach(function (listener) {
      try { listener(); } catch (error) { console.error('[social-chat-list] render failed', error); }
    });
  }

  function reset() {
    currentOwner = null;
    if (records.length) {
      records = [];
      changed();
    }
  }

  function clear() {
    ++revision;
    reset();
  }

  async function request(path, owner) {
    var headers = { accept:'application/json' };
    if (owner) headers['x-mao-account-context'] = owner;
    var response = await fetch(path, {
      method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:headers
    });
    if (!response.ok) throw new Error('Session or conversations unavailable');
    var data = await response.json();
    if (!data || data.ok !== true) throw new Error('Unexpected conversation response');
    return data;
  }

  async function refresh() {
    var ticket = ++revision;
    // Immediately remove previous-account rows while revalidating the session.
    reset();
    try {
      var me = await request('/api/accounts/me');
      var owner = me.account && me.account.id;
      if (!ACCOUNT_ID.test(owner) || me.account.status !== 'active') return;
      var payload = await request('/api/social/e2ee/conversations',owner);
      if (payload.ownerAccountId !== owner || !Array.isArray(payload.conversations))
        throw new Error('Conversation account mismatch');

      var valid = [];
      var unique = new Set();
      payload.conversations.forEach(function (item) {
        if (!item || !ACCOUNT_ID.test(item.id) || item.id === owner || unique.has(item.id)) return;
        if (typeof item.displayName !== 'string' || !item.displayName.trim()) return;
        if (item.lastMessageAt !== null &&
          (!Number.isSafeInteger(item.lastMessageAt) || item.lastMessageAt < 0)) return;
        unique.add(item.id);
        valid.push({
          id:item.id,displayName:item.displayName.slice(0,64),
          lastMessageAt:item.lastMessageAt
        });
      });
      // Do not display a response for a session that changed during fetch.
      var confirm = await request('/api/accounts/me',owner);
      if (ticket !== revision) return;
      if (confirm.account?.id !== owner || confirm.account.status !== 'active') {
        reset();return;
      }
      currentOwner = owner;
      records = valid.slice(0,100);
      changed();
    } catch (error) {
      if (ticket === revision) reset();
      // A missing/expired login must never leave another account's friends
      // visible or interfere with local AI-role conversation entries.
    }
  }

  root.MAOMAORealChatList = Object.freeze({
    getRows: function () { return records.map(function (item) { return Object.assign({},item); }); },
    owner: function () { return currentOwner; },
    subscribe: function (listener) {
      if (typeof listener !== 'function') throw new TypeError('Listener required');
      listeners.add(listener);
      return function () { listeners.delete(listener); };
    },
    refresh: refresh,
    clear: clear
  });
})(window);
