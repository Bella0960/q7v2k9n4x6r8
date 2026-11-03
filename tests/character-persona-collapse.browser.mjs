import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/**
 * 角色档案页「顶部人设折叠」真实浏览器验证。
 * 使用本机 Edge（channel: 'msedge'），在 390×844 与 1280×900 各跑一次。
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

const LONG_PERSONA = [
  '她叫林见夏，二十七岁，在城南的一家旧书店做店主。',
  '书店只有两层，一楼卖书，二楼是她自己整理出来的阅览室，靠窗的位置永远留着。',
  '她习惯早起，煮一壶茶，把前一天翻乱的书重新按颜色排好。',
  '她不太擅长寒暄，但记得每位常客买过什么，也记得他们上次读到第几页。',
  '下雨天她会把门口的牌子收进来，因为木头上写了字，淋湿了会褪色。',
  '她说话很慢，遇到喜欢的话题会忽然变得话多，然后自己先不好意思。',
  '她对数字不敏感，账本常常记错，但书的位置从来不会。',
  '夜里关店以后，她会留一盏灯，说这样回家的路看起来没那么长。'
].join('\n');

const ROLES = [
  { id: 'role-long', name: '林见夏', persona: LONG_PERSONA },
  { id: 'role-short', name: '短句角色', persona: '她安静，喜欢下雨天。' },
  { id: 'role-empty', name: '空人设角色', persona: '' }
];

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = urlPath === '/' ? '/index.html' : urlPath;
      const filePath = path.join(root, rel);
      if (!filePath.startsWith(root)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const data = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => resolvePromise(server));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readMetrics(page) {
  return page.evaluate(() => {
    const body = document.querySelector('.profile-persona-body');
    const toggle = document.querySelector('[data-persona-toggle]');
    const kicker = document.querySelector('.profile-section-kicker');
    const hero = document.querySelector('.profile-hero');
    return {
      bodyHeight: body ? Math.round(body.getBoundingClientRect().height) : -1,
      bodyScrollHeight: body ? body.scrollHeight : -1,
      toggleHidden: toggle ? toggle.hasAttribute('hidden') : true,
      toggleText: toggle ? toggle.textContent.trim() : '',
      ariaExpanded: toggle ? toggle.getAttribute('aria-expanded') : null,
      personaText: body ? body.textContent : '',
      kickerTop: kicker ? Math.round(kicker.getBoundingClientRect().top) : -1,
      heroBottom: hero ? Math.round(hero.getBoundingClientRect().bottom) : -1,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      bodyTextClipped: body ? body.scrollHeight > body.clientHeight + 1 : false
    };
  });
}

async function openRole(page, roleId) {
  await page.click(`.role-slim-bar[data-id="${roleId}"]`);
  await page.waitForSelector('.profile-persona-body');
  await sleep(60);
}

async function runViewport(browser, viewport, label) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((roles) => {
    localStorage.setItem('ai_custom_characters', JSON.stringify(roles));
  }, ROLES);
  const page = await context.newPage();
  await page.goto(baseUrl + '/worldbook/characters/characters.html', { waitUntil: 'load' });
  await page.waitForSelector('.role-slim-bar[data-id="role-long"]');

  const out = { label, viewport };
  const failures = [];
  const check = (name, ok, detail) => {
    out[name] = { ok, detail };
    if (!ok) failures.push(`${name}: ${JSON.stringify(detail)}`);
  };

  // 1) 长人设：默认折叠
  await openRole(page, 'role-long');
  const collapsed = await readMetrics(page);
  check('长人设默认折叠高度固定', collapsed.bodyHeight === 84 && collapsed.bodyScrollHeight > collapsed.bodyHeight,
    { height: collapsed.bodyHeight, scrollHeight: collapsed.bodyScrollHeight });
  check('长人设默认显示展开入口', collapsed.toggleHidden === false && collapsed.toggleText === '展开全文',
    { hidden: collapsed.toggleHidden, text: collapsed.toggleText });
  check('折叠时原文无横向溢出', collapsed.overflowX <= 0, { overflowX: collapsed.overflowX });

  // 2) 展开
  await page.click('[data-persona-toggle]');
  await sleep(300);
  const expanded = await readMetrics(page);
  check('展开后完整显示原文', expanded.bodyHeight >= collapsed.bodyScrollHeight && expanded.bodyTextClipped === false,
    { height: expanded.bodyHeight, scrollHeight: expanded.bodyScrollHeight, clipped: expanded.bodyTextClipped });
  check('展开后入口变为收起', expanded.toggleText === '收起' && expanded.ariaExpanded === 'true',
    { text: expanded.toggleText, ariaExpanded: expanded.ariaExpanded });
  check('展开推动下方分区下移', expanded.kickerTop > collapsed.kickerTop,
    { before: collapsed.kickerTop, after: expanded.kickerTop });
  check('展开后原文内容未被改写', expanded.personaText.replace(/\s+/g, '') === LONG_PERSONA.replace(/\s+/g, ''),
    { length: expanded.personaText.length });

  // 3) 再次收起
  await page.click('[data-persona-toggle]');
  await sleep(300);
  const recollapsed = await readMetrics(page);
  check('再次收起恢复预览高度', recollapsed.bodyHeight === 84 && recollapsed.toggleText === '展开全文' &&
    recollapsed.ariaExpanded === 'false',
    { height: recollapsed.bodyHeight, text: recollapsed.toggleText, ariaExpanded: recollapsed.ariaExpanded });
  check('收起后下方分区回到原位', recollapsed.kickerTop === collapsed.kickerTop,
    { before: collapsed.kickerTop, after: recollapsed.kickerTop });

  // 4) 短人设：无展开入口，内容不被裁剪
  await page.click('#btnBackProfile');
  await page.waitForSelector('.role-slim-bar[data-id="role-short"]');
  await openRole(page, 'role-short');
  const shortRole = await readMetrics(page);
  check('短人设不显示展开入口', shortRole.toggleHidden === true,
    { hidden: shortRole.toggleHidden, text: shortRole.toggleText });
  check('短人设内容完整可见', shortRole.bodyHeight === shortRole.bodyScrollHeight && shortRole.bodyTextClipped === false,
    { height: shortRole.bodyHeight, scrollHeight: shortRole.bodyScrollHeight });

  // 5) 空人设：明确空态，无空壳展开
  await page.click('#btnBackProfile');
  await page.waitForSelector('.role-slim-bar[data-id="role-empty"]');
  await openRole(page, 'role-empty');
  const emptyRole = await readMetrics(page);
  check('空人设显示明确空态', emptyRole.personaText.includes('还没有填写人物背景'),
    { text: emptyRole.personaText.slice(0, 40) });
  check('空人设不显示展开入口', emptyRole.toggleHidden === true,
    { hidden: emptyRole.toggleHidden, text: emptyRole.toggleText });
  check('空人设无横向溢出', emptyRole.overflowX <= 0, { overflowX: emptyRole.overflowX });

  await context.close();
  return { out, failures };
}

const server = await startServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let browser;
let failed = false;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = [];
  for (const [viewport, label] of [[{ width: 390, height: 844 }, '390x844'], [{ width: 1280, height: 900 }, '1280x900']]) {
    const { out, failures } = await runViewport(browser, viewport, label);
    results.push(out);
    if (failures.length) {
      failed = true;
      console.error(`[${label}] FAIL`);
      failures.forEach(f => console.error('  - ' + f));
    } else {
      console.log(`[${label}] PASS`);
    }
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
if (failed) process.exitCode = 1;
