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
const chatExtras=readFileSync(path.join(root,'chat/chat/js/chat-extras.js'),'utf8');
const groupPlay=readFileSync(path.join(root,'chat/chat/group-play.html'),'utf8');
const chatSettings=readFileSync(path.join(root,'chat/chat/chat-settings.html'),'utf8');
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


// Test the page's actual list functions, not a reimplementation.
// One broken imported group must never make all healthy chats disappear.
function renderGroupListFixture(raw, options = {}) {
  const saved = new Map();
  if (raw !== undefined) saved.set('phone_groups', raw);
  const container = {
    innerHTML: '',
    listeners: [],
    querySelectorAll(selector) {
      if (selector !== '.chat-group-card') return [];
      const matches = [...this.innerHTML.matchAll(/class="chat-slim-card chat-group-card" data-gid="([^"]+)"/g)];
      return matches.map(match => ({
        getAttribute(name) { return name === 'data-gid' ? match[1] : null; },
        addEventListener(event, fn) {
          if (event === 'click') container.listeners.push(fn);
        }
      }));
    }
  };
  let writes = 0;
  const local = {
    getItem(key) {
      if (options.throwOnRead && key === 'phone_groups') throw new Error('storage blocked');
      return saved.has(key) ? saved.get(key) : null;
    },
    setItem(key, value) {
      writes++;
      saved.set(key, String(value));
    }
  };
  const document = { getElementById(id) { return id === 'chatListContainer' ? container : null; } };
  const browser = {
    GroupGovernance: { pendingInvitations() { return []; }, userIsInGroup() { return true; } },
    location: { href: '' }
  };
  const start = chat.indexOf('var _groupListReadError = false;');
  const end = chat.indexOf('    /* 轻提示（本页自用', start);
  const helperStart = chat.indexOf('function escapeHtml(str) {');
  const helperEnd = chat.indexOf('    // 生成头像 HTML', helperStart);
  const listStart = chat.indexOf('function renderChatList()');
  const listEnd = chat.indexOf('    /* ================= 初始化', listStart);
  assert.ok(start >= 0 && end > start && helperEnd > helperStart && listEnd > listStart);
  const source = chat.slice(start, end) + chat.slice(helperStart, helperEnd) +
    chat.slice(listStart, listEnd) + '\nreturn renderChatList;';
  const render = new Function(
    'window', 'document', 'localStorage', 'getHiddenChatIds',
    'loadCharacters', 'getConversationMeta', 'formatConversationTime', 'USER_SVG_SMALL', source
  )(
    browser, document, local, () => [],
    () => options.roles || [], () => ({time:0, preview:''}), () => '', '<svg></svg>'
  );
  render();
  return {
    html: container.innerHTML,
    writes,
    original: saved.get('phone_groups'),
    clickFirstGroup() { if (container.listeners.length) container.listeners[0](); return browser.location.href; }
  };
}

test('群聊存储损坏不再冒充暂无聊天，也不修改原始数据', () => {
  const out = renderGroupListFixture('{');
  assert.match(out.html, /group-data-warning/);
  assert.doesNotMatch(out.html, /暂无聊天消息/);
  assert.equal(out.original, '{');
  assert.equal(out.writes, 0);
});
test('正常缺失群数据仍显示原空列表，不误报损坏', () => {
  const out = renderGroupListFixture(undefined);
  assert.match(out.html, /暂无聊天消息/);
  assert.doesNotMatch(out.html, /group-data-warning/);
});
test('异常群列表不影响原角色显示', () => {
  const out = renderGroupListFixture('{', {roles:[{id:'r_keep',name:'旧角色',avatar:''}]});
  assert.match(out.html, /旧角色/);
  assert.match(out.html, /group-data-warning/);
});
test('混合异常与有效群时有效群可显示、点击并进入', () => {
  const raw = JSON.stringify([null, 'broken', {id:'g_healthy',name:'保留的群',members:[{id:'r1',name:'角色甲'}]}]);
  const out = renderGroupListFixture(raw);
  assert.match(out.html, /保留的群/);
  assert.match(out.html, /group-data-warning/);
  assert.match(out.clickFirstGroup(), /chat-detail\.html\?v=20261028modes1&id=g_healthy$/);
  assert.equal(out.original, raw);
  assert.equal(out.writes, 0);
});
test('旧群成员异常不让整个群列表崩溃', () => {
  const raw = JSON.stringify([{id:'g_legacy',name:'旧群',members:[null,{id:'r1',name:'角色甲'}]}]);
  const out = renderGroupListFixture(raw);
  assert.match(out.html, /旧群/);
  assert.match(out.html, /group-data-warning/);
  assert.match(out.clickFirstGroup(), /id=g_legacy$/);
});
test('旧群 members 不是数组时，列表仍能显示且不会改存储', () => {
  const raw = JSON.stringify([{id:'g_legacy',name:'旧群',members:{bad:true}}]);
  const out = renderGroupListFixture(raw);
  assert.match(out.html, /旧群/);
  assert.match(out.html, /group-data-warning/);
  assert.equal(out.writes, 0);
});
test('群名含 HTML 字符被安全转义，正常群无误报', () => {
  const raw = JSON.stringify([{id:'g_safe',name:'<img src=x onerror=alert(1)>',members:[]}]);
  const out = renderGroupListFixture(raw);
  assert.match(out.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(out.html, /group-data-warning/);
});
test('浏览器存储读取受阻时可见提示，不伪装无聊天', () => {
  const out = renderGroupListFixture(undefined,{throwOnRead:true});
  assert.match(out.html, /group-data-warning/);
  assert.doesNotMatch(out.html, /暂无聊天消息/);
  assert.equal(out.writes, 0);
});


test('接龙逐级返回不会直接离开群聊，工具弹层每层有独立历史入口', () => {
  assert.match(chatExtras, /history\.pushState\(state, '', window\.location\.href\)/);
  assert.match(chatExtras, /pushChatLayer\('plus'\)/);
  assert.match(chatExtras, /pushChatLayer\('modal'\)/);
  assert.match(chatExtras, /pushChatLayer\('pay'\)/);
  assert.match(chatExtras, /window\.addEventListener\('popstate', function \(\) \{[\s\S]*?activeChatLayer\(\)/);
  assert.match(detail, /ChatBackLayers\.push\('group-composer'\)/);
  assert.match(detail, /ChatBackLayers\.isTop\('group-composer'\)/);
  assert.match(detail, /window\.addEventListener\('popstate', function \(\) \{[\s\S]*?closeComposer\(\)/);
  assert.match(detail, /openComposer\('chain'\)/);
  assert.match(detail, /openComposer\('poll'\)/);
  assert.match(detail, /openComposer\('join',/);
});

function getReturnClick(source, start, end, environment) {
  const begin=source.indexOf(start), finish=source.indexOf(end, begin);
  assert.ok(begin>=0 && finish>begin, '原页面返回处理不存在');
  let listener;
  const doc={
    referrer:environment.referrer||'',
    getElementById() {
      return {addEventListener(type, fn) { if (type==='click') listener=fn; }};
    }
  };
  const destination={
    replaced:null, href:null, wentBack:0
  };
  const address={href:environment.address};
  const browser={
    history:{length:environment.historyLength,back(){destination.wentBack++;}},
    location:{replace(value){destination.replaced=value;},set href(value){destination.href=value;}}
  };
  const code=source.slice(begin,finish);
  if (environment.groupPlay) {
    new Function('document','location','window','groupId',code)(doc,address,browser,environment.id);
  } else {
    new Function('document','window','roleId','isGroupSetting',code)(
      doc,browser,environment.id,String(environment.id).startsWith('g')
    );
  }
  assert.equal(typeof listener,'function');
  listener();
  return destination;
}

test('高级群管理从本群设置进入时，返回只回上一层而不是再创建设置页面', () => {
  const result=getReturnClick(
    groupPlay,
    "  document.getElementById('backBtn').addEventListener('click',function(){",
    '\n})();',
    {groupPlay:true,id:'g123',historyLength:4,
      address:'https://preview.mao520.com/chat/chat/group-play.html?id=g123',
      referrer:'https://preview.mao520.com/chat/chat/chat-settings.html?roleId=g123'}
  );
  assert.equal(result.wentBack,1);
  assert.equal(result.replaced,null);
});

test('高级群管理深链接和跨群来源只替换页面，不产生设置与高级页死循环', () => {
  for(const referrer of ['', 'https://another.example/chat-settings.html?roleId=g123',
    'https://preview.mao520.com/chat/chat/chat-settings.html?roleId=g999']) {
    const result=getReturnClick(
      groupPlay,
      "  document.getElementById('backBtn').addEventListener('click',function(){",
      '\n})();',
      {groupPlay:true,id:'g123',historyLength:4,
        address:'https://preview.mao520.com/chat/chat/group-play.html?id=g123',referrer}
    );
    assert.equal(result.wentBack,0);
    assert.equal(result.replaced,'chat-settings.html?roleId=g123');
  }
});

test('群设置返回本群，普通私聊仍保留原生历史返回', () => {
  const prefix="  document.getElementById('btnBack').addEventListener('click', function () {";
  const end="  // ================= 社交媒体自动化";
  const group=getReturnClick(chatSettings,prefix,end,{
    id:'g123',historyLength:4,address:'https://preview.mao520.com/chat/chat/chat-settings.html?roleId=g123'
  });
  assert.equal(group.replaced,'chat-detail.html?id=g123');
  const privateChat=getReturnClick(chatSettings,prefix,end,{
    id:'r123',historyLength:4,address:'https://preview.mao520.com/chat/chat/chat-settings.html?roleId=r123'
  });
  assert.equal(privateChat.wentBack,1);
});
