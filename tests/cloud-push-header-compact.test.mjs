import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'settings/cloud-push.html'), 'utf8');

test('Cloud push hides only its simulated top strip and compacts the real page header', () => {
  assert.match(html, /\.phone-mockup\s*>\s*\.status-bar\s*\{\s*display:\s*none\s*!important\s*;?\s*\}/);
  assert.match(html, /\.header\s*\{[^}]*padding:\s*max\(12px,\s*env\(safe-area-inset-top,[^)]*\)\)/s);
  assert.match(html, /\.header-left\s*\{[^}]*flex-direction:\s*row\s*;/s);
  assert.match(html, /<h1 class="header-title">云端推送<\/h1>/);
});

test('Cloud push moves verbose explanation into a native collapsed disclosure', () => {
  assert.match(html, /<details class="cloud-intro-disclosure">\s*<summary>关于云端推送<\/summary>/);
  assert.doesNotMatch(html, /<details class="cloud-intro-disclosure"\s+open\b/);
  assert.match(html, /当前 QA 已有设备订阅、测试推送与角色作息接口/);
  assert.match(html, /\.cloud-intro-disclosure summary\s*\{[^}]*min-height:\s*36px/s);
});

test('Cloud push keeps the connection, notification, role-activity and schedule controls', () => {
  for (const id of ['cloudStatusText', 'cloudPushToggle', 'cloudAutonomyToggle', 'cloudRoleSelect', 'cloudCharacterAutonomyMode', 'cloudRoleAutonomySave', 'cloudRoleTimezone']) {
    assert.ok(html.includes('id="' + id + '"'), 'required setting missing: ' + id);
  }
  assert.match(html, /<details class="cloud-details">/);
  assert.match(html, /<script[^>]+cloud-push-client/);
});

test('Cloud push description markup is balanced and avoids a second fake device header', () => {
  assert.equal((html.match(/<details\b/g)||[]).length, (html.match(/<\/details>/g)||[]).length);
  assert.equal((html.match(/<header class="header">/g)||[]).length, 1);
  assert.ok(html.includes('class="phone-mockup"'));
});
