// QA-001: theme isolation regression matrix.
// Verifies that switching between the six built-in presets leaves no residual
// variables, headers or scope attributes on either the chat list or detail page.
// Runs against the Vite dev server (cross-platform; no static file server).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = 4192;
const origin = 'http://127.0.0.1:' + port;
const vite = spawn(process.execPath, [
  resolve(root, 'node_modules/vite/bin/vite.js'),
  '--host', '127.0.0.1',
  '--port', String(port),
  '--strictPort'
], { cwd: root, stdio: 'ignore' });

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error('Vite exited before ready');
    try {
      const response = await fetch(origin + '/index.html');
      if (response.ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error('Vite server did not become ready');
}

// [preset, list-theme] expected per page; list-theme is null when the editorial
// Messages list preset must not be attached.
const expected = {
  wechat:           { list: ['wechat', null],           detail: ['wechat', null],           green: '#07C160' },
  qq:               { list: ['qq', null],             detail: ['qq', null],             green: '' },
  'silver-butterfly': { list: ['silver-butterfly', null], detail: ['silver-butterfly', null], green: '' },
  atmosphere:       { list: ['atmosphere', null],      detail: ['atmosphere', null],      green: '' },
  imessage:         { list: ['default', 'editorial'],    detail: ['imessage', null],        green: '' },
  default:          { list: ['default', 'editorial'],  detail: ['default', null],          green: '' }
};

const pages = [
  ['list', '/chat/chat/chat.html'],
  ['detail', '/chat/chat/chat-detail.html?id=isolation-matrix']
];

async function readTheme(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('.phone-mockup');
    const cs = getComputedStyle(shell);
    const wxHead = document.querySelector('.wechat-home-header');
    return {
      preset: shell.getAttribute('data-chat-theme-preset'),
      listTheme: shell.getAttribute('data-chat-list-theme'),
      green: cs.getPropertyValue('--wechat-green').trim(),
      wxHeadDisplay: wxHead ? getComputedStyle(wxHead).display : 'absent',
      docWidth: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth
    };
  });
}

async function bootContext(browser, width, preset) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  await context.addInitScript((t) => {
    localStorage.setItem('maomao_chat_theme_preset', t);
    localStorage.setItem('maomao_chat_list_theme_preset_v1', 'editorial');
    localStorage.setItem('ai_custom_characters', JSON.stringify([
      { id: 'mx_a', name: '林舟' },
      { id: 'mx_b', name: '晚风' }
    ]));
    localStorage.setItem('chat_history_mx_a', JSON.stringify([
      { role: 'assistant', text: '今天的风很轻。', time: 1794500000000, mid: 'm1' }
    ]));
  }, preset);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return { context, page, errors };
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [375, 390, 430]) {
      for (const [theme, exp] of Object.entries(expected)) {
        const { context, page, errors } = await bootContext(browser, width, theme);
        try {
          for (const [label, path] of pages) {
            await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('.phone-mockup', { timeout: 15000 });
            await page.waitForFunction(() => {
              const root = document.documentElement;
              return !root.classList.contains('nf-enter') && !root.classList.contains('nf-hide');
            }, null, { timeout: 2000 }).catch(() => {});
            const m = await readTheme(page);
            const [preset, listTheme] = exp[label];
            assert.equal(m.preset, preset, `${theme} ${label} @ ${width}px preset`);
            assert.equal(m.listTheme, listTheme, `${theme} ${label} @ ${width}px list-theme`);
            assert.equal(m.green, exp.green, `${theme} ${label} @ ${width}px wechat green variable`);
            assert.ok(m.docWidth <= m.viewport + 1, `${theme} ${label} @ ${width}px horizontal overflow: ${JSON.stringify(m)}`);
            if (theme !== 'wechat') {
              assert.notEqual(m.wxHeadDisplay, 'flex', `${theme} ${label} @ ${width}px keeps the WeChat header hidden`);
            }
            process.stdout.write(`PASS ${theme.padEnd(18)} ${label.padEnd(6)} @ ${width}px\n`);
          }
          assert.deepEqual(errors, [], `${theme} @ ${width}px should not throw runtime errors`);
        } finally {
          await context.close();
        }
      }

      // Re-entry / residual check on the detail page: wechat -> qq -> default -> wechat.
      // Each switch must fully overwrite the previous preset's variables and attributes.
      const { context, page, errors } = await bootContext(browser, width, 'wechat');
      try {
        await page.goto(origin + pages[1][1], { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.phone-mockup', { timeout: 15000 });
        const cycle = ['wechat', 'qq', 'default', 'wechat'];
        for (const next of cycle) {
          await page.evaluate((t) => {
            localStorage.setItem('maomao_chat_theme_preset', t);
            window.dispatchEvent(new Event('maomao:chat-theme-change'));
          }, next);
          await page.waitForFunction((t) => {
            const shell = document.querySelector('.phone-mockup');
            return shell?.getAttribute('data-chat-theme-preset') === t;
          }, next, { timeout: 5000 });
          const m = await readTheme(page);
          assert.equal(m.preset, next, `re-entry ${next} detail preset`);
          const expectedGreen = next === 'wechat' ? '#07C160' : '';
          assert.equal(m.green, expectedGreen, `re-entry ${next} detail green residual`);
          assert.ok(m.docWidth <= m.viewport + 1, `re-entry ${next} detail overflow`);
        }
        assert.deepEqual(errors, [], `re-entry cycle @ ${width}px should not throw runtime errors`);
        process.stdout.write(`PASS re-entry cycle wechat>qq>default>wechat @ ${width}px\n`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  vite.kill('SIGTERM');
}
