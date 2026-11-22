/* MAOMAO signed character card bridge.
 * Signing and verification are server-side only; no secret is shipped to PWA.
 * Designed as a small independent hook so future card versions do not modify
 * existing role storage or avatar/worldbook behavior.
 */
(function (global) {
  'use strict';

  function fail(message) { throw new Error(message); }

  async function accountId() {
    const response = await fetch('/api/accounts/me', {
      credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' }
    });
    const body = await response.json().catch(() => null);
    const account = body && body.account;
    if (!response.ok || !account || account.status !== 'active' ||
        !/^MAO-[A-Z0-9]{12,24}$/.test(String(account.id || ''))) {
      return fail('需要已登录且已授权的 MAO 账号，才能使用签名角色卡。');
    }
    const scope = global.__MAO_ACCOUNT_SCOPE__;
    const scopedId = scope && scope.ready === true ? String(scope.accountId || '') : '';
    if (scopedId && scopedId !== account.id) {
      return fail('账号已切换，请重新打开角色档案。');
    }
    return account.id;
  }

  async function send(action, data) {
    const id = await accountId();
    const response = await fetch('/api/character-cards/' + action, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-mao-account-context': id
      },
      body: JSON.stringify(data)
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.ok === false) {
      const reason = body && body.error && body.error.message;
      return fail(reason || '签名服务暂时不可用，角色资料未更改。');
    }
    return body;
  }

  global.MAOMAOCharacterCards = Object.freeze({
    async sign(character) {
      const result = await send('sign', { character });
      if (!result.card || result.card.version !== 2 || !result.card.proof) {
        return fail('签名服务器没有返回有效的 MAOMAO 卡片。');
      }
      return result.card;
    },
    async verify(card) {
      const result = await send('verify', { card });
      if (!result.character || typeof result.character.name !== 'string') {
        return fail('角色卡没有通过服务器验证。');
      }
      return result.character;
    }
  });
})(window);
