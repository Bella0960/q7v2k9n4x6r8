import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('single origin contains all user-facing QA routes', () => {
  const desktop = read('index.html');
  for (const route of ['tutorial/tutorial.html', 'chat/chat/chat.html', 'forum/forum.html', 'settings/settings.html', 'chat/contacts/real-friends.html']) {
    assert.ok(read(route).length > 200, route + ' missing from unified preview');
  }
  assert.match(desktop, /data-href="tutorial\/tutorial\.html"/);
  assert.match(desktop, /data-href="forum\/forum\.html"/);
});
test('chat and forum read the same browser API config', () => {
  const storage = read('settings/js/settings.js');
  const chat = read('chat/chat/chat-detail.html');
  const forum = read('forum/forum.html');
  assert.match(storage, /API_STORAGE_KEY = 'api_settings'/);
  assert.match(chat, /API_STORAGE_KEY = 'api_settings'/);
  assert.match(forum, /PhoneStorage\.getApiConfig/);
});
test('API handbook is on the same origin with actual settings and founder tutorial intact', () => {
  const html = read('tutorial/tutorial.html');
  const script = read('tutorial/tutorial.js');
  const settings = read('settings/settings.html');
  for (const id of ['api-first','api-url-v1','api-errors','api-params','api-images','minimax-voice-guide']) {
    assert.ok(html.includes('data-open-guide="'+id+'"'),id);
    assert.ok(script.includes('"id": "'+id+'"'),id);
  }
  assert.ok(script.includes("id:'account-access'"));
  assert.ok(script.includes("id:'app-admin'"));
  assert.ok(script.includes("founderRole.content === 'super_admin'"));
  assert.ok(settings.includes('../account/settings-link.js'));
  assert.ok(settings.includes('tutorial.html#guide=api-first'));
  assert.ok(read('settings/minimax-tts.html').includes('tutorial.html#guide=minimax-voice-guide'));
  assert.doesNotThrow(() => new Function(script));
});
