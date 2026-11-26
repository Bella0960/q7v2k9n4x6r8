import test from 'node:test';

// Standard QA discovers *.test.mjs after provisioning Chromium. Keep the
// standalone browser command as well so M03 can be verified independently.
test('group listening catalog: real IndexedDB and account isolation', { timeout: 120000 }, async () => {
  await import('./group-listening-catalog.browser.mjs');
});
