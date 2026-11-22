import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { issueCharacterCard, verifyCharacterCard, normalizeCharacterCard } from '../worker/lib/character-card-signature.js';

const owner = 'MAO-ABCDEF123456';
const stranger = 'MAO-ZYXWVU654321';
const key = 'only-in-test-32-bytes-unique-character-signing-key';
const original = {
  name: '测试角色',
  persona: '这是本地测试使用的人设，不包含真实个人信息。',
  tone: '语气自然',
  appearanceDescription: '黑色外套',
  styleKeywords: ['温和', '安静']
};
const clone = x => JSON.parse(JSON.stringify(x));

test('signed MAOMAO v2 character card imports for its authenticated owner', () => {
  const card = issueCharacterCard(original, owner, key, 1780000000000);
  assert.equal(card.version, 2);
  assert.equal(card.format, 'maomao-character');
  assert.deepEqual(verifyCharacterCard(card, owner, key, 1780000100000), original);
  assert.equal(card.proof.algorithm, 'HMAC-SHA256');
  assert.match(card.proof.signature, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(card).includes(key));
});

test('unsigned legacy v1, arbitrary text and simulated third-party JSON cannot masquerade as MAOMAO', () => {
  assert.throws(() => verifyCharacterCard({format:'maomao-character',version:1,character:original},owner,key), /CHARACTER_CARD_SIGNATURE_INVALID/);
  assert.throws(() => verifyCharacterCard({format:'other-card',version:2,character:original},owner,key), /CHARACTER_CARD_SIGNATURE_INVALID/);
  assert.throws(() => verifyCharacterCard('name\npersona',owner,key), /CHARACTER_CARD_SIGNATURE_INVALID/);
});

test('tampering any signed role field, timestamp or owner is rejected', () => {
  const good = issueCharacterCard(original,owner,key,1780000000000);
  for (const path of ['name','persona','tone','appearanceDescription','styleKeywords']) {
    const x=clone(good);
    x.character[path] = path === 'styleKeywords' ? ['伪造'] : '伪造';
    assert.throws(() => verifyCharacterCard(x,owner,key,1780000100000), /SIGNATURE_INVALID/);
  }
  const expiredOwner=clone(good);
  assert.throws(() => verifyCharacterCard(expiredOwner,stranger,key,1780000100000), /SIGNATURE_INVALID/);
  const changedTime=clone(good); changedTime.issuedAt++;
  assert.throws(() => verifyCharacterCard(changedTime,owner,key,1780000100000), /SIGNATURE_INVALID/);
  const fakeProof=clone(good); fakeProof.proof.signature='f'.repeat(64);
  assert.throws(() => verifyCharacterCard(fakeProof,owner,key,1780000100000), /SIGNATURE_INVALID/);
});

test('future timestamps, unknown fields, invalid arrays and absent signing key fail closed', () => {
  const card=issueCharacterCard(original,owner,key,1780000000000);
  assert.throws(() => verifyCharacterCard(card,owner,key,1700000000000), /SIGNATURE_INVALID/);
  const extra=clone(card); extra.privateData='no';
  assert.throws(() => verifyCharacterCard(extra,owner,key,1780000100000), /SIGNATURE_INVALID/);
  assert.throws(() => normalizeCharacterCard({...original,prototypeKey:'bad'}), /INVALID_CHARACTER_CARD/);
  assert.throws(() => normalizeCharacterCard({...original,styleKeywords:[42]}), /INVALID_CHARACTER_CARD/);
  assert.throws(() => normalizeCharacterCard({...original,persona:' '}), /INVALID_CHARACTER_CARD/);
  assert.throws(() => issueCharacterCard(original,owner,'weak'), /SIGNING_NOT_CONFIGURED/);
  assert.throws(() => verifyCharacterCard(card,owner,'weak',1780000100000), /SIGNING_NOT_CONFIGURED/);
});

test('editor only applies imported fields AFTER trusted Worker verification', () => {
  const manager=readFileSync(new URL('../worldbook/characters/js/characters-manager.js',import.meta.url),'utf8');
  const document=readFileSync(new URL('../worldbook/characters/characters.html',import.meta.url),'utf8');
  const handler=manager.slice(manager.indexOf("document.getElementById('roleImportFile').addEventListener"));
  assert.ok(handler.includes('const item = await window.MAOMAOCharacterCards.verify(data);'));
  assert.ok(handler.indexOf('await window.MAOMAOCharacterCards.verify(data)') < handler.indexOf("document.getElementById('editRoleName').value = name"));
  assert.ok(!handler.includes("setSaveStatus('已导入 txt，检查后点保存'"));
  assert.match(manager,/MAOMAOCharacterCards\.sign\(file\.character\)/);
  assert.match(document,/character-card-client\.js/);
  assert.ok(document.indexOf('character-card-client.js') < document.indexOf('js/characters-manager.js'));
});

test('backend authorizes signing and verification through account session, never client UID', () => {
  const backend=readFileSync(new URL('../worker/lib/account-auth.js',import.meta.url),'utf8');
  const code=backend.slice(backend.indexOf('async function handleCharacterCard('),backend.indexOf('async function requireActiveAdmin('));
  assert.match(code,/await getAuthenticatedAccount\(request\)/);
  assert.match(code,/session\.account_id/);
  assert.match(code,/env\.MAO_CHARACTER_CARD_SIGNING_SECRET/);
  assert.doesNotMatch(code,/body\.accountId|body\.uid|body\.ownerId/);
  assert.match(backend,/\/api\/character-cards\/sign/);
  assert.match(backend,/\/api\/character-cards\/verify/);
});


test('long role personas use the explicitly bounded 64KiB signed-card endpoint rather than the default 8KiB body reader', async () => {
  const { readJsonBody } = await import('../worker/lib/http.js');
  const accountAuthSource = readFileSync(new URL('../worker/lib/account-auth.js', import.meta.url), 'utf8');
  const start = accountAuthSource.indexOf('async function handleCharacterCard(');
  const end = accountAuthSource.indexOf('async function requireActiveAdmin(', start);
  assert.ok(start >= 0 && end > start, 'signed-card handler must exist');
  assert.match(accountAuthSource.slice(start, end), /readJsonBody\(request, 65536\)/);

  const longCard = { ...original, persona: '详细人设'.repeat(3000) };
  const raw = JSON.stringify({ character: longCard });
  assert.ok(raw.length > 8192 && raw.length < 65536, 'fixture must exercise former 8KiB rejection');
  const request = () => new Request('https://localhost/api/character-cards/sign', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: raw
  });
  await assert.rejects(readJsonBody(request()), error => error.code === 'PAYLOAD_TOO_LARGE',
    'the old default reader would reject the same legitimate persona');
  const accepted = await readJsonBody(request(), 65536);
  const signed = issueCharacterCard(accepted.character, owner, key);
  assert.equal(verifyCharacterCard(signed, owner, key).persona, longCard.persona);
  const huge = new Request('https://localhost/api/character-cards/sign', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ character: { ...original, persona: '文'.repeat(70000) } })
  });
  await assert.rejects(readJsonBody(huge, 65536), error => error.code === 'PAYLOAD_TOO_LARGE',
    'requests past the 64KiB ceiling must still fail closed');
});
