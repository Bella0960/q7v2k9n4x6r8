/** Focused DOM/CSS check, not full-app, QA, or iOS Safari E2E. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'shared/js/statusbar-control.js'), 'utf8');
const inspectHtml = fs.readFileSync(path.join(root, 'inspect-phone/phone.html'), 'utf8');
const inspectCss = inspectHtml.match(/<style>([\s\S]*?)<\/style>/i)?.[1];
assert.ok(inspectCss, 'inspect phone page CSS missing');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MAOMAO_BROWSER_EXECUTABLE ? { executablePath: process.env.MAOMAO_BROWSER_EXECUTABLE } : {})
});

try {
  for (const width of [375, 390, 430]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<style>.status-bar,.statusbar{display:flex;height:40px}.gesture-bar{display:block;height:4px}</style></head><body>' +
        '<header id="top" class="status-bar">09:41</header>' +
        '<header id="custom" class="statusbar" data-maomao-system-statusbar>08:00</header>' +
        '<header id="unmarked" class="statusbar">Ordinary UI</header>' +
        '<div id="bottom" class="gesture-bar">Home Indicator</div>' +
        '<button id="accessibleHome" class="gesture-bar" role="button" aria-label="返回桌面"></button></body></html>');
      // The about:blank fixture uses stub storage. No real app origin is exercised.
      await page.evaluate(() => {
        window.__testPrefs = new Map([
          ['settings_statusbar', '0'], ['settings_home_indicator_visible', '1']
        ]);
        Object.defineProperty(window, 'localStorage', {
          configurable: true,
          value: {
            getItem(key) { return window.__testPrefs.get(key) ?? null; },
            setItem(key, value) { window.__testPrefs.set(key, value); }
          }
        });
      });
      await page.addScriptTag({ content: source });
      assert.equal(await page.locator('#accessibleHome').getAttribute('aria-hidden'), null,
        width + 'px interactive Home Indicator is not aria-hidden');
      const initial = await page.evaluate(() => ({
        top: getComputedStyle(document.querySelector('#top')).display,
        custom: getComputedStyle(document.querySelector('#custom')).display,
        unmarked: getComputedStyle(document.querySelector('#unmarked')).display,
        bottom: getComputedStyle(document.querySelector('#bottom')).display
      }));
      assert.deepEqual(initial, { top: 'none', custom: 'none', unmarked: 'flex', bottom: 'block' }, width + 'px initial');
      await page.evaluate(() => {
        const bar = document.createElement('header');
        bar.id = 'late';
        bar.className = 'status-bar';
        document.body.appendChild(bar);
        const custom = document.createElement('header');
        custom.id = 'late-custom';
        custom.className = 'statusbar';
        custom.setAttribute('data-maomao-system-statusbar', '');
        document.body.appendChild(custom);
      });
      assert.equal(await page.locator('#late').evaluate(el => getComputedStyle(el).display), 'none', width + 'px dynamic');
      assert.equal(await page.locator('#late-custom').evaluate(el => getComputedStyle(el).display), 'none', width + 'px dynamic custom');
      await page.evaluate(() => {
        localStorage.setItem('settings_statusbar', '1');
        window.__statusbarControlApply();
      });
      const restored = await page.evaluate(() => ({
        top: getComputedStyle(document.querySelector('#top')).display,
        late: getComputedStyle(document.querySelector('#late')).display,
        custom: getComputedStyle(document.querySelector('#custom')).display,
        lateCustom: getComputedStyle(document.querySelector('#late-custom')).display,
        unmarked: getComputedStyle(document.querySelector('#unmarked')).display,
        bottom: getComputedStyle(document.querySelector('#bottom')).display
      }));
      assert.deepEqual(restored, { top: 'flex', late: 'flex', custom: 'flex', lateCustom: 'flex', unmarked: 'flex', bottom: 'block' }, width + 'px restore');
      await page.evaluate(() => {
        localStorage.setItem('settings_home_indicator_visible', '0');
        window.__statusbarControlApply();
      });
      assert.equal(await page.locator('#bottom').evaluate(el => getComputedStyle(el).display), 'none', width + 'px bottom');
      assert.equal(await page.locator('#accessibleHome').getAttribute('aria-hidden'), 'true',
        width + 'px hidden interactive Home Indicator has correct ARIA state');
      await page.evaluate(() => {
        localStorage.setItem('settings_home_indicator_visible', '1');
        window.__statusbarControlApply();
      });
      assert.equal(await page.locator('#accessibleHome').getAttribute('aria-hidden'), null,
        width + 'px restored interactive Home Indicator is accessible');
      assert.equal(await page.locator('#top').evaluate(el => getComputedStyle(el).display), 'flex', width + 'px top');
      // Use the real inspect-phone CSS, not a hand-written height fixture.
      // Verify that hiding the system bar removes its formerly reserved 34px grid row.
      const inspectPage = await context.newPage();
      try {
        await inspectPage.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<style>' + inspectCss + '</style></head><body><div class="device">' +
          '<section id="phone" class="phone show">' +
          '<header id="inspectBar" class="statusbar" data-maomao-system-statusbar>08:00</header>' +
          '<div id="inspectMain" class="main">Content</div></section></div></body></html>');
        await inspectPage.evaluate(() => {
          window.__inspectPrefs = new Map([
            ['settings_statusbar', '0'], ['settings_home_indicator_visible', '1']
          ]);
          Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: { getItem(key) { return window.__inspectPrefs.get(key) ?? null; } }
          });
        });
        await inspectPage.addScriptTag({ content: source });
        const gridMetrics = () => inspectPage.evaluate(() => ({
          status: getComputedStyle(document.querySelector('#inspectBar')).display,
          phone: document.querySelector('#phone').getBoundingClientRect().height,
          main: document.querySelector('#inspectMain').getBoundingClientRect().height
        }));
        const hidden = await gridMetrics();
        assert.equal(hidden.status, 'none', width + 'px inspect hidden');
        assert.ok(Math.abs(hidden.phone - hidden.main) < 2, width + 'px inspect grid should fill hidden row');
        await inspectPage.evaluate(() => {
          window.__inspectPrefs.set('settings_statusbar', '1');
          window.__statusbarControlApply();
        });
        const shown = await gridMetrics();
        assert.equal(shown.status, 'flex', width + 'px inspect restored');
        assert.ok(Math.abs(shown.phone - shown.main - 34) < 2,
          width + 'px inspect should restore its 34px system row');
      } finally {
        await inspectPage.close();
      }
      assert.deepEqual(errors, [], width + 'px browser errors');
      console.log('statusbar browser DOM contract PASS: ' + width + 'px');
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
