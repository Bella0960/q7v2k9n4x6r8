import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const page = readFileSync(new URL('../chat/contacts/real-chat.html', import.meta.url), 'utf8');
const client = page.slice(page.indexOf('const $=id'), page.indexOf('async function setupDevice'));

function session(fetch) {
  const nodes = new Map();
  const revoked = [];
  const document = {getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, {textContent:'', classList:{toggle(){}}});
    return nodes.get(id);
  }};
  const api = runInNewContext(client + `
    owner={id:'MAO-AAAAAAAAAAAA'};
    $('peerTitle').textContent='好友';
    $('log').textContent='已解密消息';
    activeUrls.add('blob:private');
    ({api,stop});
  `, {
    document, fetch, AbortController, setTimeout, clearTimeout, location:{search:''}, URLSearchParams,
    URL:{revokeObjectURL(url){revoked.push(url);}}, discardRecording(){}
  });
  return {...api, nodes, revoked};
}

test('authoritative session and friendship failures clear decrypted content', async () => {
  for (const [status, code] of [[401,'SOCIAL_LOGIN_REQUIRED'], [403,'IDENTITY_AUTHORITY_CHANGED'],
    [409,'SOCIAL_FRIENDSHIP_CHANGED'], [409,'E2EE_KEY_CHANGED']]) {
    const client = session(async () => Response.json({ok:false,error:{code}}, {status}));
    await assert.rejects(client.api('/api/social/e2ee/keys'));
    assert.equal(client.nodes.get('log').textContent, '');
    assert.equal(client.nodes.get('peerTitle').textContent, '私人对话');
    assert.deepEqual(client.revoked, ['blob:private']);
    await assert.rejects(client.api('/api/social/e2ee/keys'), /会话已关闭/);
  }
});

test('a transient failure can be retried, and a response arriving after close is discarded', async () => {
  let respond;
  const client = session(() => new Promise(resolve => {respond=resolve;}));
  const first = client.api('/api/social/e2ee/keys');
  respond(Response.json({ok:false}, {status:503}));
  await assert.rejects(first, error => error.retryable === true);
  assert.equal(client.nodes.get('log').textContent, '已解密消息');

  const retry = client.api('/api/social/e2ee/keys');
  client.stop();
  respond(Response.json({ok:true}));
  await assert.rejects(retry, /会话已关闭/);
});

test('visible online recovery retries initial setup or resumes the current conversation', () => {
  const start = page.indexOf('function synchronize()');
  const end = page.indexOf("\n$('back')", start);
  assert.ok(start > 0 && end > start);
  const calls = [];
  const context = {
    closed:false, device:null, document:{visibilityState:'visible'},
    navigator:{onLine:false}, start(){calls.push('initialize');},
    fetchMessages(){calls.push('sync');}
  };
  const sync = runInNewContext(page.slice(start, end) + '\nsynchronize', context);
  sync();
  context.navigator.onLine = true;
  sync();
  context.device = {};
  sync();
  context.document.visibilityState = 'hidden';
  sync();
  context.document.visibilityState = 'visible';
  context.closed = true;
  sync();
  assert.deepEqual(calls, ['initialize', 'sync']);
});

test('received media offers a scoped retry only for transient errors', async () => {
  const start = page.indexOf('async function loadMediaForBubble(');
  const end = page.indexOf('function mediaReady()', start);
  assert.ok(start >= 0 && end > start);
  let attempts = 0;
  let retry;
  const context = {
    closed:false, identityEpoch:1, friendshipId:'friendship', peer:'peer',
    async api() {
      attempts++;
      throw Object.assign(new Error('fixture'), {retryable: attempts === 1});
    },
    document:{createElement(){return {addEventListener(_event, listener){retry=listener;}};}}
  };
  const bubble = {appendChild(button){this.button=button;}};
  const load = runInNewContext(page.slice(start,end) + '\nloadMediaForBubble',context);
  await load({id:'image1',kind:'image'}, {}, bubble, 1, 'friendship', {});
  assert.equal(bubble.button.textContent,'重新加载图片');
  const original = retry;
  context.identityEpoch = 2;
  retry();
  assert.equal(attempts,1);
  context.identityEpoch = 1;
  retry();
  await Promise.resolve();
  assert.equal(attempts,2);
  assert.equal(retry,original);
});
