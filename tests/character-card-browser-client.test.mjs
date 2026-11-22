import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { issueCharacterCard, verifyCharacterCard } from '../worker/lib/character-card-signature.js';

const clientSource = readFileSync(new URL('../shared/js/phone/character-card-client.js', import.meta.url), 'utf8');
const owner = 'MAO-ENCOUNTERQA0001';
const stranger = 'MAO-OTHERACCOUNT123';
const key = 'test-only-signing-value-not-for-workers-123456789';
const character = { name: '测试角色', persona: '这是测试用的人设', tone: '自然', appearanceDescription: '', styleKeywords: ['克制'] };

function clientFixture({ authenticated = true, accountId = owner, active = true, scopedAccountId = '' } = {}) {
  const requests = [];
  const window = { __MAO_ACCOUNT_SCOPE__: scopedAccountId ? { ready: true, accountId: scopedAccountId } : undefined };
  const request = async (path, options = {}) => {
    requests.push({ path, options });
    let status = 404;
    let body = { ok: false, error: { message: 'not found' } };
    if (!authenticated) {
      status = 401;
      body = { ok: false, error: { message: 'session required' } };
    } else if (path === '/api/accounts/me') {
      status = 200;
      body = { ok: true, account: { id: accountId, status: active ? 'active' : 'disabled' } };
    } else if (path.startsWith('/api/character-cards/') && options.method === 'POST') {
      if (options.headers?.['x-mao-account-context'] !== accountId) {
        status = 403;
        body = { ok: false, error: { message: 'account mismatch' } };
      } else {
        const input = JSON.parse(options.body);
        try {
          if (path.endsWith('/sign')) {
            body = { ok: true, card: issueCharacterCard(input.character, accountId, key) };
          } else {
            body = { ok: true, character: verifyCharacterCard(input.card, accountId, key) };
          }
          status = 200;
        } catch {
          status = 400;
          body = { ok: false, error: { message: 'invalid signed character card' } };
        }
      }
    }
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  runInNewContext(clientSource, { window, fetch: request });
  return { bridge: window.MAOMAOCharacterCards, requests };
}

test('browser card bridge signs through account-bound Worker and imports the issued v2 envelope', async () => {
  const { bridge, requests } = clientFixture();
  const issued = await bridge.sign(character);
  assert.equal(issued.version, 2);
  assert.equal(issued.ownerId, owner);
  assert.match(issued.proof.signature, /^[a-f0-9]{64}$/);
  const imported = await bridge.verify(issued);
  assert.deepEqual(JSON.parse(JSON.stringify(imported)), character);
  assert.deepEqual(requests.map(x => x.path), [
    '/api/accounts/me', '/api/character-cards/sign',
    '/api/accounts/me', '/api/character-cards/verify'
  ]);
  assert.ok(requests.every(x => x.options.credentials === 'same-origin'));
  assert.ok(requests.filter(x => x.options.method === 'POST').every(x =>
    x.options.headers['x-mao-account-context'] === owner));
});

test('unsigned or tampered role cards are rejected before any import data is returned', async () => {
  const { bridge } = clientFixture();
  await assert.rejects(bridge.verify({ format: 'maomao-character', version: 1 }), /invalid signed character card/);
  const card = await bridge.sign(character);
  card.character.persona += '伪造';
  await assert.rejects(bridge.verify(card), /invalid signed character card/);
});

test('a card cannot be imported under a different authenticated account', async () => {
  const own = await clientFixture().bridge.sign(character);
  await assert.rejects(clientFixture({accountId: stranger}).bridge.verify(own), /invalid signed character card/);
});

test('anonymous or disabled account cannot sign even an otherwise valid role', async () => {
  const anonymous = clientFixture({authenticated: false});
  await assert.rejects(anonymous.bridge.sign(character), /需要已登录/);
  assert.equal(anonymous.requests.some(x => x.path.endsWith('/sign')), false);
  const disabled = clientFixture({active: false});
  await assert.rejects(disabled.bridge.sign(character), /需要已登录/);
  assert.equal(disabled.requests.some(x => x.path.endsWith('/sign')), false);
});

test('a stale account-scoped page cannot sign or verify on a newly signed-in account', async () => {
  const fixture = clientFixture({ scopedAccountId: stranger });
  await assert.rejects(fixture.bridge.sign(character), /账号已切换/);
  assert.equal(fixture.requests.some(x => x.path.endsWith('/sign')), false);
});
