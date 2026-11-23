/** ADMIN-CLOUD-001 iPhone WebKit mobile-engine acceptance entry point.
 * Executes the same 10 browser assertions as Android Chromium, under WebKit.
 * This is engine emulation on Linux, not an assertion of physical iOS Safari QA.
 */
process.env.ADMIN_BROWSER_ENGINE = 'webkit';
await import('./admin-cloud-mobile.browser.mjs');
