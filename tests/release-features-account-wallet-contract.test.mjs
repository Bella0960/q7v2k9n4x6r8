import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');

test('theme store and fictional phone resolve their bundled runtime assets', () => {
  for (const page of ['theme-store/theme-store.html', 'inspect-phone/phone.html']) {
    const html = read(page);
    const references = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)];
    let checked = 0;
    for (const [, reference] of references) {
      if (/^(?:https?:|data:|#|\/\/)/i.test(reference)) continue;
      const filename = reference.split(/[?#]/)[0];
      if (!/\.(?:js|css)$/.test(filename)) continue;
      assert.ok(existsSync(resolve(root, dirname(resolve(root, page)), '..', filename)) ||
        existsSync(resolve(dirname(resolve(root, page)), filename)),
        `${page} references a missing bundled asset: ${reference}`);
      checked++;
    }
    assert.ok(checked >= 5, `${page} should load native local modules`);
  }
});

test('storefront retains four native sections and independently saved collections', () => {
  const page = read('theme-store/theme-store.html');
  for (const section of ['discover', 'themes', 'categories', 'mine']) {
    assert.match(page, new RegExp('data-category="' + section + '"'));
  }
  assert.match(page, /MAOMAOStorefront\.init/);
  assert.match(read('theme-store/collection-store.js'), /requireIDB/);
  assert.match(read('shared/js/wallpaper-store.js'), /options\.requireIDB/);
  assert.match(read('shared/js/chat-beauty.js'), /getThemePreset[\s\S]*atmosphere/);
});

test('fictional-phone context requires a saved real reply and keeps account scope', () => {
  const chat = read('chat/chat/chat-detail.html');
  const guard = read('shared/js/phone/inspect_account_guard.js');
  const phone = read('inspect-phone/phone.html');
  assert.match(phone, /inspect_account_guard\.js/);
  assert.match(phone, /inspect_interaction_bridge\.js/);
  assert.match(chat, /!isGroupChat && !silent && !contextOnly && !isRegen/);
  assert.match(chat, /InspectInteractionBridge\.buildPromptPacket/);
  const saved = chat.indexOf('window.InspectInteractionBridge.markOffered(');
  const rendered = chat.indexOf('var lastVisibleMessage = aiRoleGalleryMessages.length');
  assert.ok(saved > 0 && rendered > saved, 'offered status must follow saved-reply branch');
  assert.match(guard, /scope\.ready!==true/);
  assert.match(guard, /scope\.accountId!==id/);
  assert.match(read('shared/js/phone/inspect_interaction_bridge.js'), /origin:'user_on_fictional_phone'/);
});

test('release shell includes feature modules without weakening account or wallet boundaries', () => {
  const sw = read('sw.js');
  assert.match(sw, /phone-app-pwa-v209/);
  for (const filename of [
    'theme-store/storefront.js',
    'theme-store/collection-store.js',
    'inspect-phone/inspect-native-view.js',
    'inspect-phone/inspect-feature.js',
    'shared/js/phone/inspect_account_guard.js',
    'shared/js/phone/inspect_interaction_bridge.js'
  ]) assert.ok(sw.includes(filename), 'PWA cache missing ' + filename);
  assert.match(sw, /mao-account-scope\.js/);
  const ledger = read('shared/js/phone/wallet-ledger.js');
  assert.match(ledger, /navigator\.locks/);
  assert.match(read('worker/lib/account-auth.js'), /super_admin/);
});
