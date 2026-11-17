/**
 * UI-CLOUD-HEADER-001. Run: node tests/cloud-push-css-order.browser.mjs
 * Browser verification for both stylesheet orders, including Vite extracting
 * the shared settings.css after the page's inline CSS.
 * No real account or push API is accessed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const cloudHTML = read('settings/cloud-push.html');
const pageCSS = cloudHTML.match(/<style>([\s\S]*?)<\/style>/i)?.[1];
const bodyHTML = cloudHTML.match(/<body\b[^>]*>[\s\S]*<\/body>/i)?.[0];
assert.ok(pageCSS, 'cloud push page style missing');
assert.ok(bodyHTML, 'cloud push body missing');
const body = bodyHTML.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const settingsCSS = read('settings/css/settings.css');
const mobileCSS = read('shared/css/mobile-fit.css');
const viewports = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 661, height: 935 }
];

const browser = await chromium.launch({
  headless: true,
  ...(process.env.MAOMAO_BROWSER_EXECUTABLE
    ? { executablePath: process.env.MAOMAO_BROWSER_EXECUTABLE }
    : {})
});

try {
  for (const ordering of ['shared-first', 'shared-last']) {
    const styles = ordering === 'shared-last'
      ? [pageCSS, settingsCSS, mobileCSS]
      : [settingsCSS, mobileCSS, pageCSS];

    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport,
        isMobile: viewport.width <= 430,
        hasTouch: viewport.width <= 430,
        deviceScaleFactor: 1,
        serviceWorkers: 'block'
      });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.setContent(
          '<!doctype html><html><head><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
          '<style>' + styles.join('\n') + '</style></head>' + body + '</html>',
          { waitUntil: 'domcontentloaded' }
        );
        const actual = await page.evaluate(() => {
          const shell = document.querySelector('body.cloud-push-page > .phone-mockup');
          const header = shell?.querySelector(':scope > .header');
          const title = header?.querySelector('.header-title');
          const card = shell?.querySelector('.cloud-panel');
          const disclosure = shell?.querySelector('.cloud-intro-disclosure');
          if (!shell || !header || !title || !card || !disclosure) return null;
          return {
            paddingTop: parseFloat(getComputedStyle(header).paddingTop),
            headerHeight: header.getBoundingClientRect().height,
            titleGap: title.getBoundingClientRect().top - shell.getBoundingClientRect().top,
            shellRadius: parseFloat(getComputedStyle(shell).borderTopLeftRadius),
            firstCardTop: card.getBoundingClientRect().top - shell.getBoundingClientRect().top,
            overflowX: document.documentElement.scrollWidth > innerWidth,
            fakeStatusCount: document.querySelectorAll('.status-bar').length,
            aboutPushInSummary: disclosure.querySelector('summary')?.textContent.includes('关于云端推送')
          };
        });
        const label = ordering + ' ' + viewport.width + 'px';
        assert.ok(actual, label + ': page structure');
        assert.ok(actual.paddingTop <= 20, label + ': old top padding restored: ' + actual.paddingTop);
        assert.ok(actual.titleGap < 36, label + ': excessive gap above title: ' + actual.titleGap);
        assert.ok(actual.headerHeight <= 75, label + ': header too tall: ' + actual.headerHeight);
        assert.ok(actual.shellRadius < 1, label + ': rounded phone frame restored: ' + actual.shellRadius);
        assert.ok(actual.firstCardTop < 170, label + ': first card too low: ' + actual.firstCardTop);
        assert.equal(actual.overflowX, false, label + ': horizontal overflow');
        assert.equal(actual.fakeStatusCount, 0, label + ': fake status bar returned');
        assert.equal(actual.aboutPushInSummary, true, label + ': cloud information link missing');
        assert.deepEqual(errors, [], label + ': browser console errors');
        console.log('PASS cloud-push CSS ordering', label, JSON.stringify(actual));
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
