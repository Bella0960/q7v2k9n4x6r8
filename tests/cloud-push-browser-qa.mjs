// Synthetic only: Chromium account namespace + push inbox durability.
// No real accounts, devices, push providers, paid APIs or private data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const A = 'MAO-ABCDEFGHIJKL';
const B = 'MAO-MNOPQRSTUVWX';
const origin = 'http://127.0.0.1';
const fixture = ['shared/js/mao-account-scope.js', 'shared/js/cloud-outbound-inbox.js'];

function serve(request, response) {
  const url = new URL(request.url, origin);
  const pathname = url.pathname;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (pathname === '/api/accounts/me') {
    const account = String(request.headers['x-mao-account-context'] || '');
    if (account !== A && account !== B) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: false }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ account: { id: account, role: 'user', status: 'active' } }));
    return;
  }
  if (pathname === '/qa' || pathname === '/plain') {
    const account = url.searchParams.get('account');
    if (account !== A && account !== B) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const scripts = pathname === '/qa'
      ? '<script src="/shared/js/mao-account-scope.js?v=2"></script>' +
        '<script src="/shared/js/cloud-outbound-inbox.js"></script>'
      : '<script src="/shared/js/cloud-outbound-inbox.js"></script>';
    response.end('<!doctype html><html lang="zh"><head><meta charset="utf-8">' +
      '<meta name="mao-account-id" content="' + account + '">' +
      '<meta name="mao-account-role" content="user">' + scripts +
      '</head><body><main>synthetic QA</main></body></html>');
    return;
  }
  const asset = fixture.find(name => pathname === '/' + name);
  if (asset) {
    const bytes = readFileSync(new URL('../dist/' + asset, import.meta.url));
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    response.end(bytes);
    return;
  }
  response.writeHead(404);
  response.end('not found');
}

const server = createServer(serve);
await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
const address = server.address();
const base = 'http://127.0.0.1:' + address.port;
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [375, 390, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const jsErrors = [];
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    pageA.on('pageerror', err => jsErrors.push('a:' + err.name));
    pageB.on('pageerror', err => jsErrors.push('b:' + err.name));

    console.log('CLOUD_BROWSER_QA_STAGE:' + width + ':1');
    await pageA.goto(base + '/qa?account=' + A);
    await pageB.goto(base + '/qa?account=' + B);
    assert.equal(await pageA.evaluate(() => window.__MAO_ACCOUNT_SCOPE__?.ready), true);
    assert.equal(await pageB.evaluate(() => window.__MAO_ACCOUNT_SCOPE__?.ready), true);
    console.log('CLOUD_BROWSER_QA_STAGE:' + width + ':2');
    await pageA.evaluate(() => localStorage.setItem('chat_history_common', 'account-A'));
    await pageB.evaluate(() => localStorage.setItem('chat_history_common', 'account-B'));
    assert.equal(await pageA.evaluate(() => localStorage.getItem('chat_history_common')), 'account-A');
    assert.equal(await pageB.evaluate(() => localStorage.getItem('chat_history_common')), 'account-B');

    console.log('CLOUD_BROWSER_QA_STAGE:' + width + ':3');
    const saved = await pageA.evaluate(async account => {
      const roleId = 'role-synthetic';
      const key = 'chat_history_' + roleId;
      localStorage.setItem(key, JSON.stringify([{ mid: 'local-user', role: 'user', text: 'synthetic hello' }]));
      const envelope = {
        serverMessageId: 'synthetic_cloud_0000001',
        characterId: roleId,
        createdAt: 1732200000000
      };
      let successfulACK = 0;
      let writes = 0;
      const cloud = {
        _internal: { readDevice() { return { deviceId: 'qa-device' }; } },
        async receiveCharacterOutboundMessages(role, persist, limit) {
          if (role !== roleId || limit !== 10) throw Error('wrong routing');
          if (await persist({ type: 'text', text: 'synthetic cloud reply' }, envelope)) successfulACK++;
          return { successfulACK };
        }
      };
      const inbox = window.MaomaoCloudInbox.create({
        accountId: account, roleId, cloud,
        readHistory() { return JSON.parse(localStorage.getItem(key)); },
        saveHistory(rows) {
          writes++;
          localStorage.setItem(key, JSON.stringify(rows));
          return localStorage.getItem(key) === JSON.stringify(rows);
        },
        verifySession: async requested => {
          const response = await fetch('/api/accounts/me', {
            credentials: 'same-origin',
            headers: { 'x-mao-account-context': requested }
          });
          const body = await response.json();
          return response.ok && body.account?.id === requested;
        }
      });
      await inbox.sync();
      await inbox.sync();
      const rows = JSON.parse(localStorage.getItem(key));
      return { count: rows.length, writes, successfulACK,
        id: rows[1]?.serverMessageId, prior: rows[0]?.mid };
    }, A);
    console.log('CLOUD_BROWSER_QA_STAGE:' + width + ':4');
    assert.deepEqual(saved, {
      count: 2, writes: 1, successfulACK: 2,
      id: 'synthetic_cloud_0000001', prior: 'local-user'
    });
    assert.equal(await pageB.evaluate(() => localStorage.getItem('chat_history_role-synthetic')), null);

    console.log('CLOUD_BROWSER_QA_STAGE:' + width + ':5');
    const unscoped = await context.newPage();
    unscoped.on('pageerror', err => jsErrors.push('unscoped:' + err.name));
    await unscoped.goto(base + '/plain?account=' + A);
    const blocked = await unscoped.evaluate(async account => {
      const inbox = window.MaomaoCloudInbox.create({
        accountId: account, roleId: 'role-synthetic',
        cloud: { _internal: { readDevice: () => ({}) },
          async receiveCharacterOutboundMessages() { throw Error('unscoped cloud request'); } },
        readHistory: () => [], saveHistory: () => true,
        verifySession: async () => true
      });
      return inbox.isAccountReady() === false && await inbox.sync() === null;
    }, A);
    console.log('CLOUD_BROWSER_QA_STAGE:' + width + ':6');
    assert.equal(blocked, true);
    console.log('CLOUD_BROWSER_QA_STAGE:' + width + ':7');
    assert.deepEqual(jsErrors, []);
    await context.close();
    console.log('CLOUD_BROWSER_QA:PASS:' + width);
  }
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
