import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../worldbook/characters/characters.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('character profile scripts and PWA shell use the same cache-busted URLs', () => {
  const cache = Number(sw.match(/^const CACHE_NAME = 'phone-app-pwa-v(\d+)'/m)?.[1] || 0);
  assert.ok(cache >= 287, 'this release must invalidate the previous PWA shell');
  const manager = html.match(/<script src="(js\/characters-manager\.js\?v=[^"]+)"><\/script>/);
  const ai = html.match(/<script src="(js\/character-ai-drafts\.js\?v=[^"]+)"><\/script>/);
  assert.ok(manager && ai, 'both role archive runtimes must be included');
  assert.ok(sw.includes("'./worldbook/characters/" + manager[1] + "'"));
  assert.ok(sw.includes("'./worldbook/characters/" + ai[1] + "'"));
});
test('PWA protected navigations remain network-first and do not serve cached login redirects', () => {
  assert.match(sw, /req\.mode === 'navigate' && !isPublicAccountPage/);
  assert.match(sw, /return await fetch\(req, \{ cache: 'no-store' \}\)/);
});
