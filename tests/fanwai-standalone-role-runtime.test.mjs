import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../fanwai/fanwai-app.js', import.meta.url), 'utf8');

class FakeNode {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.children = [];
    this.attributes = {};
    this.textContent = '';
    this.href = '';
    this.hidden = false;
  }
  append(...items) { this.children.push(...items); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...items) { this.children = [...items]; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] || null; }
}
const descendants = node => [node, ...node.children.flatMap(descendants)];

function mount({ account = '', scopeId = '', roles = [], groups = [], selected = '' } = {}) {
  const body = new FakeNode('body');
  const picker = new FakeNode('section');
  const meta = account ? { content: account, getAttribute: () => account } : null;
  const readKeys = [];
  const timers = [];
  const storage = {
    getItem(key) {
      readKeys.push(key);
      if (key === 'ai_custom_characters') return JSON.stringify(roles);
      if (key === 'phone_groups') return JSON.stringify(groups);
      return null;
    }
  };
  const document = {
    body,
    createElement: tag => new FakeNode(tag),
    getElementById: id => {
      if (id === 'fanwaiRolePicker') return picker;
      return descendants(body).find(el => el.id === id) || null;
    },
    querySelector: selector => selector === 'meta[name="mao-account-id"]' ? meta : null
  };
  const window = {
    localStorage: storage,
    location: { search: selected ? '?id=' + encodeURIComponent(selected) : '' },
    setTimeout(callback) { timers.push(callback); return timers.length; },
    clearTimeout() {},
    ...(scopeId ? { __MAO_ACCOUNT_SCOPE__: { accountId: scopeId, ready: true } } : {})
  };
  runInNewContext(script, { window, document, URLSearchParams, console }, { filename: 'fanwai-app.js' });
  return { picker, body, window, readKeys, timers, all: descendants };
}

test('role picker excludes actual groups but keeps g-prefixed characters', () => {
  const view = mount({
    roles: [
      { id: 'g-bookworm', name: '小书' },
      { id: 'person-2', name: '小雨' },
      { id: 'group-77', name: '群组' }
    ],
    groups: [{ id: 'group-77' }]
  });
  const rows = view.all(view.picker).filter(el => el.className === 'fw-role-row');
  assert.equal(rows.length, 2);
  assert.ok(rows.some(row => row.href.includes('g-bookworm')));
  assert.ok(rows.every(row => !row.href.includes('group-77')));
});

test('mismatched account refuses all role data reads', () => {
  const view = mount({
    account: 'MAO-AAAAAAAAAAAA',
    scopeId: 'MAO-BBBBBBBBBBBB',
    roles: [{ id: 'hidden-character', name: '私有角色' }]
  });
  assert.deepEqual(view.readKeys, []);
  const heading = view.all(view.picker).find(el => el.className === 'fw-role-title');
  assert.match(heading.textContent, /暂时无法打开番外/);
  assert.equal(view.all(view.picker).filter(el => el.className === 'fw-role-row').length, 0);
});

test('valid authenticated deep link loads original fanwai engine only for own role', () => {
  const view = mount({
    account: 'MAO-AAAAAAAAAAAA',
    scopeId: 'MAO-AAAAAAAAAAAA',
    selected: 'g-bookworm',
    roles: [{ id: 'g-bookworm', name: '小书' }]
  });
  assert.equal(view.picker.hidden, true);
  const scripts = view.all(view.body).filter(el => el.tagName === 'SCRIPT');
  assert.equal(scripts.length, 1);
  assert.match(scripts[0].src, /chat\/chat\/js\/chat-fanwai\.js/);
});

test('deleted or foreign role deep link is blocked and offers recovery', () => {
  const view = mount({
    account: 'MAO-AAAAAAAAAAAA',
    scopeId: 'MAO-AAAAAAAAAAAA',
    selected: 'foreign-character',
    roles: [{ id: 'own-character', name: '自己的角色' }]
  });
  assert.equal(view.all(view.body).filter(el => el.tagName === 'SCRIPT').length, 0);
  assert.ok(view.all(view.picker).some(el => el.className === 'fw-role-retry'));
});

test('generation errors are shown visibly with safe text content', () => {
  const view = mount();
  const payload = '<img src=x onerror=alert(1)> 存储失败';
  view.window.showToast(payload);
  const notice = view.all(view.body).find(el => el.id === 'fanwaiNotice');
  assert.ok(notice);
  assert.equal(notice.textContent, payload);
  assert.equal(notice.hidden, false);
  assert.equal(notice.attributes.role, 'status');
  view.window.showToast('第二次提醒');
  assert.equal(notice.textContent, '第二次提醒');
});
