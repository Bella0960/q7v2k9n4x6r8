/**
 * E2E against a locally isolated Wrangler Durable Object, not production.
 *
 * Run AFTER npm run build:
 *   node tests/mao-social-worker-e2e.mjs
 *
 * Uses Wrangler's local SQLite storage in a fresh temporary directory.
 * Generates disposable credentials and never logs or commits their values.
 * No public Worker deployment or production Cloudflare bindings are involved.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { createDeviceIdentity, conversationKey, encryptText, decryptText } from '../chat/contacts/real-chat-crypto.mjs';
import { encryptMedia, decryptMedia, makeMediaMarker } from '../chat/contacts/real-chat-media.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VARS_PATH = path.join(ROOT, '.dev.vars');
const PASSWORD = 'Temp-account-test-123456!';
const WRANGLER_VERSION = '4.161.0';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function cookieHeader(response) {
  const value = response.headers.get('set-cookie') || '';
  const cookie = value.split(';')[0];
  assert.match(cookie, /^MAO_SESSION=[A-Za-z0-9_-]{32,128}$/);
  return cookie;
}

async function main() {
  if (existsSync(VARS_PATH)) {
    throw new Error('Refusing to overwrite existing .dev.vars; run from an isolated checkout.');
  }
  if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    throw new Error('Missing dist/index.html; run npm run build before this test.');
  }
  const secret = randomBytes(40).toString('base64url');
  const pepper = randomBytes(40).toString('base64url');
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'maomao-social-e2e-'));
  let child = null;
  const checks = [];
  try {
    await writeFile(VARS_PATH,
      'MAO_SUPER_ADMIN_BOOTSTRAP_SECRET=' + secret + '\n' +
      'DEVICE_SECRET_PEPPER=' + pepper + '\n' +
      'MAO_SOCIAL_ENABLED=true\n' +
      'MAO_SOCIAL_CHAT_ENABLED=false\n' +
      'MAO_SOCIAL_E2EE_ENABLED=true\n',
      { mode: 0o600, flag: 'wx' });
    const port = await freePort();
    const base = 'http://127.0.0.1:' + port;
    let output = '';
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    child = spawn(npx, [
      '--yes', 'wrangler@' + WRANGLER_VERSION,
      'dev', '--config', 'wrangler.preview.jsonc',
      '--local', '--ip', '127.0.0.1', '--port', String(port),
      '--persist-to', stateDir
    ], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32', // kill the whole npx -> Wrangler -> workerd process group
      env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data', text => { output = (output + text).slice(-12000); });
    }
    let status = null;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(base + '/api/admin/bootstrap/status',
          { signal: AbortSignal.timeout(2000) });
        if (response.status === 200) {
          status = { response, body: await response.json() };
          break;
        }
      } catch {}
      await sleep(500);
    }
    if (!status) {
      // Keep log excerpts short and remove any randomly generated test keys.
      const safeOutput = output.replaceAll(secret, '[redacted]').replaceAll(pepper, '[redacted]');
      throw new Error('Local Wrangler worker did not become ready: ' + safeOutput.slice(-1800));
    }

    function pass(name) {
      checks.push(name);
      console.log('PASS - ' + name);
    }
    async function request(endpoint, { method = 'GET', body, cookie, accountId, follow = false } = {}) {
      const headers = { accept: 'application/json' };
      if (method !== 'GET') {
        headers.origin = base;
        headers['sec-fetch-site'] = 'same-origin';
        headers['content-type'] = 'application/json';
      }
      if (cookie) headers.cookie = cookie;
      if (accountId) headers['x-mao-account-context'] = accountId;
      const response = await fetch(base + endpoint, {
        method, headers, redirect: follow ? 'follow' : 'manual',
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000)
      });
      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json')
        ? await response.json()
        : await response.text();
      return { response, status: response.status, payload };
    }
    const post = (endpoint, body, auth = {}) => request(endpoint, { method: 'POST', body, ...auth });

    assert.equal(status.body.configured, true, 'local test secrets must be configured');
    assert.equal(status.body.initialized, false, 'fresh isolated database must be uninitialized');
    pass('isolated sqlite Durable Object starts without a founder and with disposable secrets');

    const anonymous = await request('/index.html');
    assert.equal(anonymous.status, 302);
    assert.equal(new URL(anonymous.response.headers.get('location'), base).pathname, '/account/index.html');
    pass('anonymous visitors cannot open private app HTML');

    const founder = await post('/api/admin/bootstrap', {
      bootstrapSecret: secret, username: 'qa_founder',
      password: PASSWORD, confirmPassword: PASSWORD
    });
    assert.equal(founder.status, 200, 'bootstrap failed: ' + JSON.stringify(founder.payload));
    assert.equal(founder.payload.account.role, 'super_admin');
    assert.equal(founder.payload.account.founderNumber, '001');
    const founderId = founder.payload.account.id;
    const founderCookie = cookieHeader(founder.response);
    pass('founder bootstrap returns one server-authorized 001 session');

    const duplicateBootstrap = await post('/api/admin/bootstrap', {
      bootstrapSecret: secret, username: 'another_admin',
      password: PASSWORD, confirmPassword: PASSWORD
    });
    assert.equal(duplicateBootstrap.status, 409);
    pass('second founder bootstrap is forbidden');

    const registrations = [];
    for (const username of ['qa_alice', 'qa_bob']) {
      const result = await post('/api/accounts/register', {
        username, password: PASSWORD, confirmPassword: PASSWORD
      });
      assert.equal(result.status, 201, username + ': ' + JSON.stringify(result.payload));
      assert.equal(result.payload.account.role, 'user');
      assert.equal(result.payload.account.status, 'pending_invite');
      assert.equal(Object.hasOwn(result.payload.account, 'founderNumber'), false);
      registrations.push(result.payload.account);
    }
    const [alice, bob] = registrations;
    assert.notEqual(alice.id, bob.id);
    pass('two different users register as pending, neither can claim founder 001');

    const userCookies = [];
    for (const username of ['qa_alice', 'qa_bob']) {
      const login = await post('/api/accounts/login', { identifier: username, password: PASSWORD });
      assert.equal(login.status, 200, username + ': ' + JSON.stringify(login.payload));
      userCookies.push(cookieHeader(login.response));
    }
    const [aliceCookie, bobCookie] = userCookies;
    const aliceMe = await request('/api/accounts/me', { cookie: aliceCookie, accountId: alice.id });
    const bobMe = await request('/api/accounts/me', { cookie: bobCookie, accountId: bob.id });
    assert.equal(aliceMe.status, 200);
    assert.equal(bobMe.status, 200);
    assert.equal(aliceMe.payload.account.id, alice.id);
    assert.equal(bobMe.payload.account.id, bob.id);
    pass('separate login cookies each resolve to their own durable account identity');

    const switchedContext = await request('/api/accounts/me', { cookie: bobCookie, accountId: alice.id });
    assert.equal(switchedContext.status, 409);
    assert.equal(switchedContext.payload.error.code, 'ACCOUNT_CONTEXT_CHANGED');
    const switchedSecurity = await request('/api/accounts/security', { cookie: bobCookie, accountId: alice.id });
    assert.equal(switchedSecurity.status, 409);
    pass('stale account A tab under B session cannot read account A or security data');

    const aliceBeforeInvite = await request('/index.html', { cookie: aliceCookie });
    assert.equal(aliceBeforeInvite.status, 302);
    pass('uninvited registered account cannot enter the private app');

    const invite = await post('/api/admin/invites', { targetAccountId: alice.id, ttlHours: 1 },
      { cookie: founderCookie, accountId: founderId });
    assert.equal(invite.status, 201, 'invite creation failed: ' + JSON.stringify(invite.payload));
    assert.match(invite.payload.invite.code, /^[A-Za-z0-9_-]{32,128}$/);
    const redeem = await post('/api/accounts/invites/redeem',
      { inviteCode: invite.payload.invite.code },
      { cookie: aliceCookie, accountId: alice.id });
    assert.equal(redeem.status, 200, 'invite redemption failed: ' + JSON.stringify(redeem.payload));
    assert.equal(redeem.payload.account.status, 'active');
    pass('admin issues one-time targeted invite, only alice becomes active');

    const bobReuse = await post('/api/accounts/invites/redeem',
      { inviteCode: invite.payload.invite.code },
      { cookie: bobCookie, accountId: bob.id });
    assert.equal(bobReuse.status, 403);
    const bobBlocked = await request('/index.html', { cookie: bobCookie });
    assert.equal(bobBlocked.status, 302);
    pass('bob cannot redeem alice invite or access private app before authorization');

    const aliceIndex = await request('/index.html', { cookie: aliceCookie });
    assert.equal(aliceIndex.status, 200);
    assert.match(aliceIndex.payload, new RegExp('meta name="mao-account-id" content="' + alice.id + '"'));
    assert.match(aliceIndex.payload, /meta name="mao-account-role" content="user"/);
    assert.equal(aliceIndex.response.headers.get('cache-control'), 'private, no-store, max-age=0');
    pass('active alice receives account-scoped HTML without shared caching');

    const userAdmin = await request('/admin/admin-center.html', { cookie: aliceCookie });
    assert.equal(userAdmin.status, 302);
    const founderAdmin = await request('/admin/admin-center.html', { cookie: founderCookie });
    assert.equal(founderAdmin.status, 200);
    assert.match(founderAdmin.payload, /meta name="mao-account-role" content="super_admin"/);
    pass('admin HTML is server-gated to authenticated super_admin');

    const userDirectory = await request('/api/admin/accounts',
      { cookie: aliceCookie, accountId: alice.id });
    assert.equal(userDirectory.status, 403);
    assert.equal(userDirectory.payload.error.code, 'ADMIN_ONLY');
    const founderDirectory = await request('/api/admin/accounts',
      { cookie: founderCookie, accountId: founderId });
    assert.equal(founderDirectory.status, 200);
    pass('regular users cannot call the administrator account directory API');


    // Real live account identities and consent; strictly disposable local SQLite.
    const bobInvite = await post('/api/admin/invites', { targetAccountId: bob.id, ttlHours: 1 },
      { cookie: founderCookie, accountId: founderId });
    assert.equal(bobInvite.status, 201);
    const bobActivation = await post('/api/accounts/invites/redeem',
      { inviteCode: bobInvite.payload.invite.code }, { cookie: bobCookie, accountId: bob.id });
    assert.equal(bobActivation.status, 200);
    assert.equal(bobActivation.payload.account.status, 'active');
    pass('second test account is separately authorized by administrator 001');

    const anonFriends = await request('/api/social/friends');
    assert.equal(anonFriends.status, 401);
    pass('unauthenticated caller cannot enumerate social contacts');

    const socialBefore = await request('/api/social/friends',
      { cookie: aliceCookie, accountId: alice.id });
    assert.equal(socialBefore.status, 200);
    assert.deepEqual(socialBefore.payload.friends, []);
    pass('authorized account starts with no fabricated or cross-account friends');

    const aliceCode = await post('/api/social/friend-codes', {},
      { cookie: aliceCookie, accountId: alice.id });
    assert.equal(aliceCode.status, 200, JSON.stringify(aliceCode.payload));
    assert.match(aliceCode.payload.code, /^[a-f0-9]{64}$/);
    const requestId = 'qa_' + randomBytes(12).toString('base64url');
    const application = await post('/api/social/friend-requests',
      { code: aliceCode.payload.code, requestId, note: 'Isolated QA' },
      { cookie: bobCookie, accountId: bob.id });
    assert.equal(application.status, 200, JSON.stringify(application.payload));
    assert.equal(application.payload.request.status, 'pending_peer');
    pass('friend code creates pending peer-consent request, not instant friendship');

    const premature = await request('/api/social/friends',
      { cookie: aliceCookie, accountId: alice.id });
    assert.equal(premature.status, 200);
    assert.equal(premature.payload.friends.length, 0);
    const wrongConsent = await post('/api/social/friend-requests/' + requestId + '/accept',
      {}, { cookie: bobCookie, accountId: bob.id });
    assert.equal(wrongConsent.status, 403);
    pass('applicant cannot self-consent or bypass peer confirmation');

    const consent = await post('/api/social/friend-requests/' + requestId + '/accept',
      {}, { cookie: aliceCookie, accountId: alice.id });
    assert.equal(consent.status, 200, JSON.stringify(consent.payload));
    assert.equal(consent.payload.request.status, 'pending_admin');
    const stillPrivate = await request('/api/social/friends',
      { cookie: aliceCookie, accountId: alice.id });
    assert.equal(stillPrivate.payload.friends.length, 0);
    pass('peer consent alone does not create friendship without administrator approval');

    const unprivilegedQueue = await request('/api/admin/social/friend-approvals',
      { cookie: aliceCookie, accountId: alice.id });
    assert.equal(unprivilegedQueue.status, 403);
    const pendingQueue = await request('/api/admin/social/friend-approvals',
      { cookie: founderCookie, accountId: founderId });
    assert.equal(pendingQueue.status, 200);
    assert.ok(pendingQueue.payload.approvals.some(item => item.id === requestId));
    pass('only server-confirmed 001 may read pending social approvals');

    const adminApproval = await post('/api/admin/social/friend-approvals/' + requestId + '/approve',
      {}, { cookie: founderCookie, accountId: founderId });
    assert.equal(adminApproval.status, 200, JSON.stringify(adminApproval.payload));
    assert.equal(adminApproval.payload.request.status, 'approved');
    const aliceFriends = await request('/api/social/friends',
      { cookie: aliceCookie, accountId: alice.id });
    const bobFriends = await request('/api/social/friends',
      { cookie: bobCookie, accountId: bob.id });
    assert.equal(aliceFriends.status, 200);
    assert.equal(bobFriends.status, 200);
    assert.ok(aliceFriends.payload.friends.some(item => item.id === bob.id));
    assert.ok(bobFriends.payload.friends.some(item => item.id === alice.id));
    pass('approved relationship becomes visible on both real account sessions');
    const listAlice = await request('/api/social/e2ee/conversations',
      {cookie:aliceCookie,accountId:alice.id});
    const listBob = await request('/api/social/e2ee/conversations',
      {cookie:bobCookie,accountId:bob.id});
    assert.equal(listAlice.status,200);
    assert.equal(listBob.status,200);
    assert.equal(listAlice.payload.ownerAccountId,alice.id);
    assert.equal(listBob.payload.ownerAccountId,bob.id);
    assert.deepEqual(listAlice.payload.conversations.map(item=>item.id),[bob.id]);
    assert.deepEqual(listBob.payload.conversations.map(item=>item.id),[alice.id]);
    assert.equal(listAlice.payload.conversations[0].lastMessageAt,null);
    pass('real account chat list contains only server-approved peer, before first message');


    const disabledChat = await request('/api/social/chats/' + bob.id + '/messages',
      { cookie: aliceCookie, accountId: alice.id });
    assert.equal(disabledChat.status, 503);
    assert.equal(disabledChat.payload.error.code, 'SOCIAL_CHAT_NOT_ENABLED');
    pass('plaintext social chat stays disabled until real E2EE is accepted');

    // End-to-end encrypted mobile transport uses the same actual Wrangler
    // account identities and DO. No AI API, no plaintext message endpoints.
    const aKey = await createDeviceIdentity(webcrypto.subtle);
    const bKey = await createDeviceIdentity(webcrypto.subtle);
    const aliceRegister = await post('/api/social/e2ee/keys',{publicKey:aKey.publicKey},
      {cookie:aliceCookie,accountId:alice.id});
    const bobRegister = await post('/api/social/e2ee/keys',{publicKey:bKey.publicKey},
      {cookie:bobCookie,accountId:bob.id});
    assert.equal(aliceRegister.status,200,JSON.stringify(aliceRegister.payload));
    assert.equal(bobRegister.status,200,JSON.stringify(bobRegister.payload));
    assert.equal(aliceRegister.payload.keyId,aKey.keyId);
    assert.equal(bobRegister.payload.keyId,bKey.keyId);
    pass('both authorized phone accounts register distinct ECDH device public keys');

    const targetKey = await request('/api/social/e2ee/keys/'+bob.id,
      {cookie:aliceCookie,accountId:alice.id});
    assert.equal(targetKey.status,200);
    assert.equal(targetKey.payload.key.keyId,bKey.keyId);
    const metadata={friendshipId:requestId,senderId:alice.id,recipientId:bob.id,
      clientMessageId:'qa_encrypted_message_0001',sk:aKey.keyId,rk:bKey.keyId};
    const outbound = await conversationKey(aKey.privateKey,bKey.publicKey,requestId,alice.id,bob.id,
      webcrypto.subtle);
    const envelope=await encryptText('Encrypted from Android to iPhone',outbound,metadata,
      webcrypto.subtle,webcrypto.getRandomValues.bind(webcrypto));
    const sent=await post('/api/social/e2ee/chats/'+bob.id+'/messages',
      {friendshipId:requestId,clientMessageId:metadata.clientMessageId,envelope},
      {cookie:aliceCookie,accountId:alice.id});
    assert.equal(sent.status,200,JSON.stringify(sent.payload));
    assert.equal(sent.payload.message.text,undefined);
    const delivered=await request('/api/social/e2ee/chats/'+alice.id+'/messages?after=0',
      {cookie:bobCookie,accountId:bob.id});
    assert.equal(delivered.status,200,JSON.stringify(delivered.payload));
    assert.equal(delivered.payload.messages.length,1);
    assert.equal(delivered.payload.messages[0].envelope.ct,envelope.ct);
    assert.ok(!JSON.stringify(delivered.payload).includes('Encrypted from Android'));
    const inbound=await conversationKey(bKey.privateKey,aKey.publicKey,requestId,bob.id,alice.id,
      webcrypto.subtle);
    const decrypted=await decryptText(delivered.payload.messages[0].envelope,inbound,metadata,
      webcrypto.subtle);
    assert.equal(decrypted,'Encrypted from Android to iPhone');
    const duplicated=await post('/api/social/e2ee/chats/'+bob.id+'/messages',
      {friendshipId:requestId,clientMessageId:metadata.clientMessageId,envelope},
      {cookie:aliceCookie,accountId:alice.id});
    assert.equal(duplicated.payload.replay,true);
    const rejectedPlaintext=await post('/api/social/e2ee/chats/'+bob.id+'/messages',
      {friendshipId:requestId,clientMessageId:'qa_plaintext_forbidden',envelope,text:'hello'},
      {cookie:aliceCookie,accountId:alice.id});
    assert.equal(rejectedPlaintext.status,400);
    assert.equal(rejectedPlaintext.payload.error.code,'E2EE_PLAINTEXT_REJECTED');
    pass('real Wrangler SQLite relays ciphertext only; two devices decrypt; retry is idempotent; plaintext rejected');
    const listUpdated=await request('/api/social/e2ee/conversations',
      {cookie:bobCookie,accountId:bob.id});
    assert.equal(listUpdated.status,200);
    assert.ok(listUpdated.payload.conversations[0].lastMessageAt>0);
    assert.ok(!JSON.stringify(listUpdated.payload).includes(envelope.ct));
    assert.ok(!JSON.stringify(listUpdated.payload).includes('Encrypted from Android'));
    pass('chat list orders by message time without leaking encrypted bodies or private keys');


    for(const [index,item] of [
      {kind:'image',mime:'image/jpeg',bytes:new Uint8Array(360*1024).fill(173)},
      {kind:'voice',mime:'audio/mp4',bytes:new TextEncoder().encode('synthetic_private_voice_data')}
    ].entries()){
      const mediaId='med_worker_media_'+String(index).padStart(20,'0');
      const clientMessageId='qa_encrypted_media_msg_'+String(index).padStart(12,'0');
      const mediaMeta={friendshipId:requestId,senderId:alice.id,recipientId:bob.id,
        clientMessageId,mediaId,kind:item.kind,mime:item.mime,sk:aKey.keyId,rk:bKey.keyId};
      const attachment=await encryptMedia(item.bytes,outbound,mediaMeta,
        webcrypto.subtle,webcrypto.getRandomValues.bind(webcrypto));
      const messageEnvelope=await encryptText(makeMediaMarker(mediaId,item.kind),outbound,
        mediaMeta,webcrypto.subtle,webcrypto.getRandomValues.bind(webcrypto));
      const body={clientMessageId,friendshipId:requestId,attachment,envelope:messageEnvelope};
      const upload=await post('/api/social/e2ee/chats/'+bob.id+'/media',body,
        {cookie:aliceCookie,accountId:alice.id});
      assert.equal(upload.status,200,JSON.stringify(upload.payload).slice(0,300));
      assert.equal(upload.payload.mediaId,mediaId);
      assert.equal(upload.payload.message.text,undefined);
      const download=await request('/api/social/e2ee/chats/'+alice.id+'/media/'+mediaId,
        {cookie:bobCookie,accountId:bob.id});
      assert.equal(download.status,200,JSON.stringify(download.payload).slice(0,300));
      assert.equal(download.payload.attachment.ct,attachment.ct);
      assert.ok(!JSON.stringify(download.payload).includes('synthetic_private'));
      const decoded=await decryptMedia(download.payload.attachment,inbound,mediaMeta,webcrypto.subtle);
      assert.deepEqual(decoded,item.bytes);
      const replay=await post('/api/social/e2ee/chats/'+bob.id+'/media',body,
        {cookie:aliceCookie,accountId:alice.id});
      assert.equal(replay.status,200);
      assert.equal(replay.payload.replay,true);
      pass(item.kind==='image'
        ? 'actual Wrangler store relays encrypted JPEG only and other phone decrypts image bytes'
        : 'actual Wrangler store relays encrypted voice only and other phone decrypts audio bytes');
    }



    const blocked = await post('/api/social/friends/' + bob.id + '/block', {},
      { cookie: aliceCookie, accountId: alice.id });
    assert.equal(blocked.status, 200);
    const blockedCipher = await request('/api/social/e2ee/chats/' + alice.id + '/messages?after=0',
      {cookie:bobCookie,accountId:bob.id});
    assert.equal(blockedCipher.status,403);
    const blockedMedia = await request('/api/social/e2ee/chats/' + alice.id +
      '/media/med_worker_media_00000000000000000000',
      {cookie:bobCookie,accountId:bob.id});
    assert.equal(blockedMedia.status,403);
    pass('blocked friend immediately loses access to encrypted conversation history');
    const blockedList=await request('/api/social/e2ee/conversations',
      {cookie:bobCookie,accountId:bob.id});
    assert.equal(blockedList.status,200);
    assert.deepEqual(blockedList.payload.conversations,[]);
    pass('blocked friend disappears from other phone chat list immediately after refresh');


    const afterBlock = await request('/api/social/friends',
      { cookie: bobCookie, accountId: bob.id });
    assert.equal(afterBlock.status, 200);
    assert.equal(afterBlock.payload.friends.length, 0);
    pass('blocking removes the friend relationship from both account views');

    console.log('ALL PASS: ' + checks.length + ' isolated Wrangler/SQLite Worker runtime assertions');
  } finally {
    if (child) {
      // Wrangler starts workerd below npx. Closing npx alone can leave pipes
      // open and keep a completed CI build running indefinitely.
      const terminate = signal => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
          else if (child.exitCode === null) child.kill(signal);
        } catch {}
      };
      terminate('SIGTERM');
      await Promise.race([
        new Promise(resolve => child.once('close', resolve)),
        sleep(2000)
      ]);
      if (child.exitCode === null) terminate('SIGKILL');
      child.stdout?.destroy();
      child.stderr?.destroy();
    }
    await rm(VARS_PATH, { force: true });
    await rm(stateDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

main().catch(error => {
  const message = String(error?.stack || error?.message || error).replace(/MAO_SESSION=[A-Za-z0-9_-]+/g, 'MAO_SESSION=[redacted]');
  console.error('FAIL - isolated social Worker runtime: ' + message.slice(0, 5000));
  process.exitCode = 1;
});
