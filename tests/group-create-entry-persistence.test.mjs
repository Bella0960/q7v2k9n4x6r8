import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chat=readFileSync(path.join(root,'chat/chat/chat.html'),'utf8');
const phoneStorageSource=readFileSync(path.join(root,'shared/js/phone/phone_storage.js'),'utf8');
const atomicSource=readFileSync(path.join(root,'shared/js/phone/chat-history-atomic.js'),'utf8');
const detail=readFileSync(path.join(root,'chat/chat/chat-detail.html'),'utf8');
test('聊天列表所有创建群入口都通向真实创建弹窗',()=>{
  assert.match(chat,/\['groupEntryBtn', 'silverGroupEntryBtn'\]\.forEach/);
  assert.match(chat,/entry\.addEventListener\('click',[\s\S]*?openModal\(\)/);
  assert.match(chat,/getElementById\('menuGroup'\)\.addEventListener[\s\S]*?getElementById\('groupEntryBtn'\)\.click\(\)/);
  assert.match(chat,/function openModal\(\)[\s\S]*?backdrop\.classList\.add\('show'\)/);
});
test('新群不覆盖损坏记录；需要成员；存储读回后才提示成功',()=>{
  assert.match(chat,/if \(!members\.length\)/);
  assert.match(chat,/groups = raw === null \? \[\] : JSON\.parse\(raw\)/);
  assert.match(chat,/if \(!Array\.isArray\(groups\)\) throw new Error/);
  assert.match(chat,/localStorage\.setItem\('phone_groups', JSON\.stringify\(updatedGroups\)\)/);
  assert.match(chat,/var saved = JSON\.parse\(localStorage\.getItem\('phone_groups'\)/);
  assert.match(chat,/window\.location\.href = 'chat-detail\.html\?v=20261028modes1&id=' \+ encodeURIComponent\(groupId\)/);
});

function simulateCreate(scenario, doubleTap = false) {
  const roles = scenario === 'special'
    ? [
        { id: 'r_"unsafe', name: '甲"><img src=x onerror=alert(1)>', avatar: 'javascript:alert(1)' },
        null,
        { id: 'r_two', name: '角色乙', avatar: '' }
      ]
    : [{ id: 'r_one', name: '角色甲', avatar: '' }, { id: 'r_two', name: '角色乙', avatar: '' }];
  const store = new Map([
    ['ai_custom_characters', JSON.stringify(roles)],
    ['phone_groups', scenario === 'corrupt' ? '{{' : '[]']
  ]);
  const elements = Object.create(null), rows = [], notices = [];
  let renderCount = 0;
  function element(id) {
    const item = {
      id, dataset: {}, value: '', style: {}, listeners: {}, visible: false,
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      fire(type = 'click') {
        (this.listeners[type] || []).forEach(fn => fn({
          target: this, currentTarget: this, stopPropagation() {}
        }));
      },
      classList: {
        add(c) { if (c === 'show') item.visible = true; },
        remove(c) { if (c === 'show') item.visible = false; }
      },
      focus() {},
      querySelectorAll() { return rows; }
    };
    return item;
  }
  [
    'groupModalBackdrop', 'groupNameInput', 'groupMembersList',
    'groupEntryBtn', 'silverGroupEntryBtn', 'wechatMenu',
    'groupModalCancel', 'groupModalCreate'
  ].forEach(id => { elements[id] = element(id); });
  let memberMarkup = '';
  Object.defineProperty(elements.groupMembersList, 'innerHTML', {
    get() { return memberMarkup; },
    set(value) {
      memberMarkup = value;
      rows.length = 0;
      for (const role of roles.filter(r => r && r.id != null && String(r.id).trim())) {
        const item = element('member');
        item.dataset.id = role.id;
        rows.push(item);
      }
    }
  });
  const fakeDocument = { getElementById(id) { return elements[id] || null; } };
  const storage = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) {
      if (scenario === 'quota' && key === 'phone_groups') throw new Error('quota');
      store.set(key, String(value));
    }
  };
  const scripts = Array.from(chat.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/g))
    .map(match => match[1]).filter(Boolean);
  const creationScript = scripts.find(src =>
    src.includes('function openModal()') && src.includes("getElementById('groupModalCreate')"));
  assert.ok(creationScript, '真实创建脚本必须存在');
  // Extract the exact page helpers so test execution uses production escaping.
  const helpersStart = chat.indexOf('    function escapeHtml(str) {');
  const helpersEnd = chat.indexOf('    // 生成头像 HTML', helpersStart);
  assert.ok(helpersStart > 0 && helpersEnd > helpersStart);
  const helpers = new Function(chat.slice(helpersStart, helpersEnd) +
    '\nreturn { escapeHtml, safeImgSrc };')();
  const browser = { location: { href: '' } };
  if (scenario === 'navigation-blocked') {
    Object.defineProperty(browser.location, 'href', {
      get() { return ''; },
      set() { throw new Error('navigation rejected'); }
    });
  }
  new Function('document', 'localStorage', 'setTimeout', 'renderChatList', 'showToast',
    'escapeHtml', 'safeImgSrc', 'window', creationScript)(
    fakeDocument, storage, () => 0, () => { if (scenario === 'render-error') throw new Error('bad legacy list'); renderCount++; }, text => notices.push(text),
    helpers.escapeHtml, helpers.safeImgSrc, browser
  );
  elements.silverGroupEntryBtn.fire();
  assert.equal(elements.groupModalBackdrop.visible, true, '点击入口应出现创建弹窗');
  elements.groupNameInput.value = scenario === 'empty-name' ? '' : '周末聊天群';
  rows[0].fire();
  elements.groupModalCreate.fire();
  if (doubleTap) elements.groupModalCreate.fire();
  let saved = null;
  try { saved = JSON.parse(store.get('phone_groups')); } catch { /* 原记录被保护 */ }
  return { saved, notices, renderCount, visible: elements.groupModalBackdrop.visible, memberMarkup, href: browser.location.href };
}

test('模拟用户点击主题入口，选角色后真正创建群', () => {
  const result = simulateCreate('ok');
  assert.equal(result.saved.length, 1);
  assert.equal(result.saved[0].name, '周末聊天群');
  assert.equal(result.saved[0].members[0].id, 'r_one');
  assert.equal(result.renderCount, 0);
  assert.equal(result.visible, false);
  assert.equal(result.href, 'chat-detail.html?v=20261028modes1&id=' + result.saved[0].id);
});
test('模拟旧群数据损坏，不覆盖原始记录也不假报创建成功', () => {
  const result = simulateCreate('corrupt');
  assert.equal(result.saved, null);
  assert.equal(result.renderCount, 0);
  assert.equal(result.visible, true);
  assert.equal(result.href, '');
  assert.match(result.notices.join(' '), /保护数据/);
});
test('模拟浏览器存储空间不足，保持弹窗与成员选择', () => {
  const result = simulateCreate('quota');
  assert.deepEqual(result.saved, []);
  assert.equal(result.renderCount, 0);
  assert.equal(result.visible, true);
  assert.equal(result.href, '');
  assert.match(result.notices.join(' '), /保存失败/);
});

test('导入角色含引号、HTML 或非法头像 URL 不应破坏成员选择，也不改变原始 ID', () => {
  const result = simulateCreate('special');
  assert.equal(result.saved.length, 1);
  assert.equal(result.saved[0].members[0].id, 'r_"unsafe');
  assert.equal(result.saved[0].members[0].name, '甲"><img src=x onerror=alert(1)>');
  assert.match(result.memberMarkup, /data-id="r_&quot;unsafe"/);
  assert.match(result.memberMarkup, /甲&quot;&gt;&lt;img/);
  assert.doesNotMatch(result.memberMarkup, /src="javascript:/);
  assert.equal(result.renderCount, 0);
});

test('群名缺失时显示清楚的错误，而不是点击无响应', () => {
  assert.match(chat, /if \(!name\) \{\s*showToast\('请输入群聊名称'\)/);
  assert.match(chat, /selected = Object\.create\(null\)/);
});

test('保存成功后连点创建不会生成两个群', () => {
  const result = simulateCreate('ok', true);
  assert.equal(result.saved.length, 1);
  assert.equal(result.visible, false);
  assert.match(result.href, /chat-detail\.html\?v=20261028modes1&id=g\d+$/);
});

test('刷新进入群聊详情后仍按 ID 读取持久化群资料', () => {
  const result = simulateCreate('ok');
  const fn = detail.match(/function loadGroupById\(gid\) \{[\s\S]*?\n        \}/);
  assert.ok(fn, '未找到详情页真实群资料读取函数');
  const readOnReload = new Function('localStorage', 'return (' + fn[0] + ');')({
    getItem(key) { return key === 'phone_groups' ? JSON.stringify(result.saved) : null; }
  });
  assert.equal(readOnReload(result.saved[0].id).name, '周末聊天群');
  assert.equal(readOnReload('g_nonexistent'), null);
  assert.match(detail, /const isGroupChat = !!currentRoleId && String\(currentRoleId\)\.indexOf\('g'\) === 0/);
});

test('群名为空时实际点击也明确提示且不会写群记录', () => {
  const result = simulateCreate('empty-name');
  assert.deepEqual(result.saved, []);
  assert.equal(result.visible, true);
  assert.equal(result.href, '');
  assert.match(result.notices.join(' '), /请输入群聊名称/);
});

test('旧聊天列表渲染异常不影响创建完成后的直接进入', () => {
  const result = simulateCreate('render-error');
  assert.equal(result.saved.length, 1);
  assert.equal(result.renderCount, 0);
  assert.match(result.href, /chat-detail\.html\?v=20261028modes1&id=g\d+$/);
});

test('导航被浏览器拦截时已保存群仍在，显示可理解的回退提示', () => {
  const result = simulateCreate('navigation-blocked');
  assert.equal(result.saved.length, 1);
  assert.equal(result.renderCount, 1);
  assert.equal(result.visible, false);
  assert.equal(result.href, '');
  assert.match(result.notices.join(' '), /群聊已创建，请点击群聊进入/);
});

test('新群首次打开初始化历史后才能安全发送，刷新不丢且两个标签不互相覆盖', async () => {
  const group = { id: 'g123', name: '周末群', members: [{ id: 'r1', name: '角色甲' }] };
  const map = new Map([['phone_groups', JSON.stringify([group])]]);
  const storage = {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key,value) { map.set(key,String(value)); },
    removeItem(key) { map.delete(key); }
  };
  const pending = new Map();
  const locks = { request(name, opts, fn) {
    assert.equal(opts.mode, 'exclusive');
    const op = (pending.get(name) || Promise.resolve()).then(fn);
    pending.set(name, op.catch(() => {}));
    return op;
  }};
  const one = { localStorage:storage, navigator:{locks} };
  runInNewContext(phoneStorageSource,{window:one,localStorage:storage,console});
  assert.equal(storage.getItem('chat_history_g123'), null, '新群尚无消息键');
  const welcome = [{role:'received',type:'group_welcome',text:'欢迎来到「周末群」'}];
  assert.equal(one.PhoneStorage.saveChatHistory('g123',welcome), true, '首次进群先持久化欢迎消息');
  runInNewContext(atomicSource,{window:one,localStorage:storage,console});
  const two = { localStorage:storage, navigator:{locks} };
  runInNewContext(atomicSource,{window:two,localStorage:storage,console});
  const [a,b] = await Promise.all([
    one.ChatHistoryAtomic.appendIf('g123',{mid:'u1',role:'user',text:'今天有空吗？'}),
    two.ChatHistoryAtomic.appendIf('g123',{mid:'a1',role:'assistant',memberId:'r1',text:'刚忙完，可以聊'})
  ]);
  assert.equal(a.ok,true,JSON.stringify(a));
  assert.equal(b.ok,true,JSON.stringify(b));
  const refresh = JSON.parse(storage.getItem('chat_history_g123'));
  assert.equal(refresh.length,3);
  assert.deepEqual(refresh.map(m => m.mid || m.type),['group_welcome','u1','a1']);
  assert.equal(JSON.parse(storage.getItem('phone_groups'))[0].members[0].id,'r1');
  const missing = await one.ChatHistoryAtomic.appendIf('g_missing',{mid:'x',text:'勿创建已删除会话'});
  assert.equal(missing.ok,false, '禁止原子写入器静默复活不存在的聊天');
});
