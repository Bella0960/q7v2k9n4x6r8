import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const settings = fs.readFileSync('chat/chat/chat-settings.html', 'utf8');
const page = fs.readFileSync('chat/chat/avatar-manager.html', 'utf8');
const controller = fs.readFileSync('chat/chat/avatar-manager.js', 'utf8');
const worker = fs.readFileSync('sw.js', 'utf8');

test('single-chat settings exposes one role-scoped portrait entry and hides it in groups', () => {
  assert.equal((settings.match(/id="actionAvatarManage"/g) || []).length, 1);
  assert.equal((settings.match(/id="avatarManageCard"/g) || []).length, 1);
  assert.match(settings, /var hideIds = \[[^\]]*'avatarManageCard'/);
  assert.match(settings, /if \(!roleId \|\| isGroupSetting \|\| !getRoleById\(roleId\)\)/);
  assert.match(settings,
    /window\.location\.href = 'avatar-manager\.html\?roleId=' \+ encodeURIComponent\(roleId\)/);
});

test('portrait editor is an original minimal second-level mobile page with no external decorative imagery', () => {
  assert.match(page, /<h1>头像管理<\/h1>/);
  assert.doesNotMatch(page, /CHAT \/ PORTRAITS|PRIVATE COLLECTION|Portraits\./);
  assert.doesNotMatch(page, /calc\((?:27|48)px \+ env\(safe-area-inset-top/);
  assert.match(page, /min-height:64px/);
  assert.match(page, /id="currentPicture"/);
  assert.match(page, /id="album"/);
  assert.match(page, /id="pairList"/);
  assert.match(page, /id="actionOverlay"/);
  assert.match(page, /id="advancedMenu"/);
  assert.match(page, /id="autonomyToggle"/);
  assert.match(page, /@media\(max-width:480px\)/);
  assert.match(page, /env\(safe-area-inset-bottom/);
  assert.match(page, /:focus-visible/);
  assert.match(page, /prefers-reduced-motion/);
  assert.match(page, /\.pickbar \{ display:none; position:sticky;/);
  assert.ok(page.indexOf('id="pairBuilder"') < page.indexOf('id="album"'),
    'pairing confirmation stays above the scrollable collection');
  assert.doesNotMatch(page, /(?:linear|radial)-gradient\s*\(/i);
  assert.doesNotMatch(page, /cdn\.|unsplash|picsum|emoji|<iframe/i);
  assert.ok(!page.includes('Mao.')); // No logo decoration.
});

test('portrait media scripts load in proper order before archive controller', () => {
  const media = page.indexOf('storage/media-repository.js');
  const library = page.indexOf('role-avatar-library.js');
  const ui = page.indexOf('./avatar-manager.js');
  assert.ok(media >= 0 && media < library && library < ui);
  assert.match(page, /<input id="avatarFiles" type="file" accept="image\/\*" multiple/);
  assert.match(controller, /lib\.add\(roleId, file/);
  assert.match(controller, /lib\.toObjectUrl\(assetId\)/);
  assert.match(controller, /releaseImages\(\)/);
  assert.match(controller, /window\.addEventListener\('pagehide'/);
});

test('editor routes all mutations to existing role-scoped library APIs, not new image storage', () => {
  for (const action of [
    'applyToCharacter', 'applyPairToChat', 'linkPair', 'renamePair',
    'swapPair', 'unlinkPair', 'remove', 'addAsset', 'setActive'
  ]) {
    assert.ok(controller.includes('lib.' + action + '('), action);
  }
  assert.match(controller, /new URLSearchParams\(window\.location\.search\)\.get\('roleId'\)/);
  assert.match(controller, /String\(role\.id\) === roleId/);
  assert.match(controller, /STORAGE_FAILED/);
  assert.match(controller, /PAIR_CONFLICT/);
  assert.match(controller, /CORRUPT_DATA/);
  assert.match(controller, /PARTIAL_ROLLBACK/);
  assert.match(controller, /if \(busy\) return/);
  assert.match(controller, /function confirmInSheet\(/);
  assert.doesNotMatch(controller, /window\.confirm\(/);
  assert.doesNotMatch(controller, /localStorage\.setItem\(['"](?:myProfile|maomao_chat_pair_user_avatar_v1_)/);
  assert.doesNotMatch(controller, /localStorage\.setItem\(['"](?:maomao_role_avatar_library_v1_)/);
});

test('advanced controls are hidden, role-specific, and do not override private chats', () => {
  assert.match(page, /<details class="more" id="advancedMenu">/);
  assert.match(controller, /target\.avatarAutonomyEnabled = toggle\.checked/);
  assert.match(controller, /localStorage\.setItem\('ai_custom_characters', JSON\.stringify\(roles\)\)/);
});

test('existing service worker caches the new route without introducing a second PWA', () => {
  assert.match(worker, /'\.\/chat\/chat\/avatar-manager\.html'/);
  assert.match(worker, /'\.\/chat\/chat\/avatar-manager\.js\?v=20261117v1'/);
});

test('page and controller syntax are valid and user-facing actions remain scoped', () => {
  new vm.Script(controller, { filename: 'avatar-manager.js' });
  assert.match(controller, /if \(!exists\(\)\)/);
  assert.match(controller, /if \(event\.key === null \|\| event\.key === 'ai_custom_characters'/);
  assert.match(controller, /role\.avatarAssetId/);
  assert.match(controller, /const|var/);
});


test('real editor controller mounts a scoped UI and calls the existing media library for upload/pair/autonomy', async () => {
  const nodes = new Map();
  const saved = [];
  const added = [];
  const linked = [];
  const images = [];
  const revoked = [];
  const removedPairs = [];
  const portraits = [];
  const pairs = [];
  let rawRoles = JSON.stringify([
    { id: 'role-A', name: '角色 A', avatar: '', avatarAutonomyEnabled: true },
    { id: 'role-B', name: '角色 B', avatar: '', avatarAutonomyEnabled: true }
  ]);
  function fakeNode(name) {
    const handlers = {};
    const classes = new Set();
    return {
      name, tagName: 'DIV', isConnected: true, children: [], textContent: '',
      value: '', disabled: false, checked: false, className: '', style: {},
      classList: {
        add(k) { classes.add(k); },
        remove(k) { classes.delete(k); },
        contains(k) { return classes.has(k); },
        toggle(k, on) { if (on) classes.add(k); else classes.delete(k); }
      },
      appendChild(child) { this.children.push(child); return child; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k]; },
      addEventListener(k, fn) { (handlers[k] ||= []).push(fn); },
      scrollIntoView() {},
      focus() {},
      click() { return Promise.all((handlers.click || []).map(fn => fn({ target: this }))); },
      dispatch(k, e) { return Promise.all((handlers[k] || []).map(fn => fn(e || { target: this }))); }
    };
  }
  const document = {
    hidden: false,
    getElementById(name) {
      if (!nodes.has(name)) nodes.set(name, fakeNode(name));
      return nodes.get(name);
    },
    createElement(tag) {
      const item = fakeNode('created');
      item.tagName = tag.toUpperCase();
      return item;
    },
    addEventListener() {}
  };
  const library = {
    list() { return portraits; },
    getPairs() { return pairs; },
    getPairForAvatar(_, id) { return pairs.find(p => p.avatarIds.includes(id)) || null; },
    getChatPairUserSelection() { return null; },
    find(_, id) { return portraits.find(p => p.id === id) || null; },
    toObjectUrl: async assetId => {
      images.push(assetId);
      return { ok: true, value: {
        url: 'blob:' + assetId,
        revoke() { revoked.push(assetId); }
      } };
    },
    async add(roleId, file, opts) {
      added.push({ roleId, file: file.name });
      const item = {
        id: 'avatar_' + added.length,
        assetId: 'as_' + (added.length === 1 ? 'A' : 'B').repeat(32),
        label: opts.label, active: false
      };
      portraits.push(item);
      return { ok: true, value: item };
    },
    linkPair(roleId, first, second) {
      linked.push({ roleId, first, second });
      const pair = { id: 'pair_ab', avatarIds: [first, second], label: '我的情头' };
      pairs.push(pair);
      return { ok: true, value: pair };
    },
    renamePair() { return { ok: true }; },
    swapPair() { return { ok: true }; },
    unlinkPair(roleId, id) {
      removedPairs.push({ roleId, id });
      const at = pairs.findIndex(p => p.id === id);
      if (at >= 0) pairs.splice(at, 1);
      return { ok: true };
    },
    async remove() { return { ok: true }; },
    setActive() { return { ok: true }; },
    async addAsset() { return { ok: true }; },
    async applyToCharacter() { return { ok: true }; },
    async applyPairToChat() { return { ok: true }; }
  };
  const localStorage = {
    getItem(key) { return key === 'ai_custom_characters' ? rawRoles : null; },
    setItem(key, value) {
      saved.push(key);
      if (key === 'ai_custom_characters') rawRoles = value;
    }
  };
  const window = {
    location: { search: '?roleId=role-A' }, RoleAvatarLibrary: library,
    addEventListener() {}, confirm() { return true; }
  };
  vm.runInNewContext(controller, {
    window, document, localStorage, URLSearchParams,
    setTimeout() { return 1; }, clearTimeout() {}
  }, { filename: 'avatar-manager.js' });

  const input = document.getElementById('avatarFiles');
  await input.dispatch('change', {
    target: { files: [
      { name: '秋天.jpg', type: 'image/jpeg', size: 1600 },
      { name: '雨天.jpg', type: 'image/jpeg', size: 1700 }
    ], value: '' }
  });
  assert.deepEqual(added.map(x => x.roleId), ['role-A', 'role-A']);
  assert.equal(document.getElementById('album').children.length, 2);
  await Promise.resolve();
  const beforePairReads = images.length;
  assert.equal(beforePairReads, 2, 'initial gallery reads each unique image once');

  await document.getElementById('startPair').click();
  const card = document.getElementById('album').children;
  await card[0].click();
  await card[1].click();
  assert.equal(document.getElementById('createPair').disabled, false);
  assert.equal(card[0].getAttribute('aria-pressed'), 'true');
  assert.equal(card[1].getAttribute('aria-pressed'), 'true');
  // Merely selecting photos must preserve DOM nodes and not reload media URLs.
  assert.equal(document.getElementById('album').children[0], card[0]);
  assert.equal(document.getElementById('album').children[1], card[1]);
  assert.equal(images.length, beforePairReads, 'pair picks must not fetch images again');
  await document.getElementById('createPair').click();
  await Promise.resolve();
  assert.equal(images.length, beforePairReads + 2,
    'the gallery and newly linked pair must share one URL per unique asset');
  assert.equal(revoked.length, 2,
    'an updated render must release the prior gallery URLs');
  assert.deepEqual(linked, [{ roleId: 'role-A', first: 'avatar_1', second: 'avatar_2' }]);
  assert.equal(document.getElementById('pairList').children.length, 1);

  const toggle = document.getElementById('autonomyToggle');
  toggle.checked = false;
  await toggle.dispatch('change');
  const next = JSON.parse(rawRoles);
  assert.equal(next[0].avatarAutonomyEnabled, false);
  assert.equal(next[1].avatarAutonomyEnabled, true);

  // Destructive actions require a second, in-page confirmation. Opening
  // the action must never silently remove the previously applied pair.
  await document.getElementById('pairList').children[0].click();
  const actionSheet = document.getElementById('sheetActions');
  const unlink = actionSheet.children.find(x => x.textContent.includes('解除配对'));
  assert.ok(unlink, 'unlink action should exist for a saved pair');
  await unlink.click();
  assert.equal(removedPairs.length, 0, 'first tap only asks for confirmation');
  const cancel = actionSheet.children.find(x => x.textContent === '取消');
  assert.ok(cancel);
  await cancel.click();
  assert.equal(removedPairs.length, 0, 'cancellation must not mutate a pair');
  await document.getElementById('pairList').children[0].click();
  const secondUnlink = actionSheet.children.find(x => x.textContent.includes('解除配对'));
  await secondUnlink.click();
  const confirm = actionSheet.children.find(x => x.textContent === '确认解除');
  assert.ok(confirm, 'confirmation remains inside the designed bottom sheet');
  await confirm.click();
  assert.deepEqual(removedPairs, [{ roleId: 'role-A', id: 'pair_ab' }]);

  assert.deepEqual(saved, ['ai_custom_characters'],
    'the editor must not write new image blobs or cross-role keys');
});


test('legacy media-only role photo displays from its assetId without a Base64 source', () => {
  const start = controller.indexOf('  function renderCurrent(role, version) {');
  const end = controller.indexOf('\n  function makeEmpty(', start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const nodes = {
    roleName: { textContent: '' },
    currentPicture: { children: [], replaceChildren(...items) { this.children = items; }, appendChild(item) { this.children.push(item); } },
    currentState: { textContent: '' },
    autonomyToggle: { checked: false }
  };
  const view = new Function('byId', 'document', 'placeholder', 'drawAsset',
    controller.slice(start, end) + '\nreturn renderCurrent;')(
    name => nodes[name],
    { createElement: () => ({ src: '', alt: '' }) },
    () => ({ placeholder: true }),
    (assetId, node, version) => { calls.push({ assetId, node, version }); }
  );
  const assetId = 'as_' + 'A'.repeat(32);
  view({ id: 'role-A', name: '旧角色', avatar: 'idb-image:old', avatarAssetId: assetId }, 12);
  assert.equal(nodes.currentState.textContent, '已应用');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].assetId, assetId);
  assert.equal(calls[0].node, nodes.currentPicture);
  assert.equal(calls[0].version, 12);

  view({ id: 'role-B', name: '有图片地址', avatar: 'data:image/png;base64,ZGF0YQ==', avatarAssetId: assetId }, 13);
  assert.equal(calls.length, 1, 'usable image src must not duplicate an IndexedDB preview');
});

test('autonomy setting restores previous role value on quota/write failure without touching another role', () => {
  const start = controller.indexOf('  function saveAutonomy() {');
  const end = controller.indexOf('\n  function scheduleRefresh()', start);
  assert.ok(start >= 0 && end > start);
  const current = { id: 'role-A', name: '角色A', avatarAutonomyEnabled: true };
  const raw = JSON.stringify([current, { id: 'role-B', avatarAutonomyEnabled: false }]);
  const toggle = { checked: false };
  const feedback = [];
  const save = new Function('byId', 'readRole', 'localStorage', 'roleId', 'busy', 'hint',
    controller.slice(start, end) + '\nreturn saveAutonomy;')(
    () => toggle, () => current, {
      getItem: key => key === 'ai_custom_characters' ? raw : null,
      setItem() { throw new Error('quota'); }
    }, 'role-A', false,
    (message, error) => feedback.push({ message, error })
  );
  save();
  assert.equal(toggle.checked, true, 'failed writes restore old checked state');
  assert.equal(JSON.parse(raw)[1].avatarAutonomyEnabled, false, 'other roles stay unchanged');
  assert.equal(feedback.at(-1).error, true);
});
