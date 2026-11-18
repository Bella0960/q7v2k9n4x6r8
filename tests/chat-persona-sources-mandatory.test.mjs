import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const detail = read('chat/chat/chat-detail.html');
const settings = read('worldbook/settings/rp-protocol.html');
const sandbox = { window: {} };
vm.runInNewContext(read('shared/js/phone/chat-role-context.js'), sandbox);
vm.runInNewContext(read('shared/js/phone/chat-context-policy.js'), sandbox);

function extract(after, before) {
  const start = detail.indexOf(after);
  const end = detail.indexOf(before, start + after.length);
  assert.ok(start >= 0 && end > start, 'real request assembly block must exist');
  return detail.slice(start, end);
}

const protocolSource = extract("            let rpProtocol = '';", '            // 世界书：');
const loreSource = extract('            // 世界书：', '            // 协议变量替换：');
const protocolRead = new Function('localStorage', 'window', 'aliasRoleId', 'currentCharacter', 'roleId', 'showToast',
  protocolSource + '\nreturn rpProtocol;');
const loreRead = new Function('localStorage', 'window', 'aliasRoleId', 'roleForTurn', 'isGroupChat',
  'historyList', 'roleModelHistory', 'text', 'showToast', 'groupReplyPick', 'getRoleById',
  loreSource + '\nreturn worldbookText;');

function storage(values) {
  const map = new Map(Object.entries(values || {}));
  return { getItem: key => map.get(key) ?? null, setItem: (key, val) => map.set(key, val),
    snapshot: () => JSON.stringify([...map.entries()]) };
}
function getLore({ books, mount = [], speaker = { id: 'a', worldBookIds: ['local_a'] },
                   group = false, text = '深圳的地铁', faults = {}, alerts = [] } = {}) {
  const raw = faults.raw ?? JSON.stringify(books || []);
  const db = storage({ phone_worldbooks: raw, ['chat_worldbooks_' + (group ? 'group' : 'a')]: JSON.stringify(mount) });
  const policyWindow = faults.moduleMissing ? { MAOMAOChatRoleContext: sandbox.window.MAOMAOChatRoleContext } : sandbox.window;
  const result = loreRead(db, policyWindow, group ? 'group' : 'a', speaker, group,
    [], [], text, msg => alerts.push(msg), group ? { id: speaker.id } : null,
    id => String(id) === String(speaker.id) ? speaker : null);
  return { result, alerts, before: db.snapshot(), after: db.snapshot() };
}

test('the saved global protocol is loaded verbatim and used for every role', () => {
  assert.match(settings, /var STORAGE_KEY = 'chat_rp_protocol_';/);
  const raw = '用户保存的协议\n' + '遵照人设。'.repeat(1700) + '\n{{persona}} {{worldbook}}';
  const db = storage({ chat_rp_protocol_: raw });
  const alerts = [];
  const resultA = protocolRead(db, { MAOMAO_RP_DEFAULT_PROTOCOL: '系统默认' }, 'a', { id: 'a' }, 'a', x => alerts.push(x));
  const resultB = protocolRead(db, { MAOMAO_RP_DEFAULT_PROTOCOL: '系统默认' }, 'b', { id: 'b' }, 'b', x => alerts.push(x));
  assert.equal(resultA, raw);
  assert.equal(resultB, raw);
  assert.deepEqual(alerts, []);
  assert.match(detail, /systemPrompt = applyProtocolVars\(rpProtocol\)/);
  assert.match(detail, /turnSpeakerPersona \|\| '该成员尚未填写具体人设/);
});

test('missing protocol or blocked local storage stops generation instead of silently using an unrelated default', () => {
  const alerts = [];
  const broken = { getItem() { throw new Error('storage blocked'); } };
  const result = protocolRead(broken, { MAOMAO_RP_DEFAULT_PROTOCOL: 'fallback' }, 'a',
    { id: 'a' }, 'a', m => alerts.push(m));
  assert.equal(result, undefined);
  assert.match(alerts[0], /协议读取失败/);
  const missing = [];
  const none = protocolRead(storage({}), {}, 'a', { id: 'a' }, 'a', m => missing.push(m));
  assert.equal(none, undefined);
  assert.match(missing[0], /协议未加载/);
});

test('single-chat persona is never shortened; group speaking member has its own full persona', () => {
  // The speaking role must retain its full authored persona. The group
  // roster may be limited, but never silently clip the selected speaker.
  assert.match(detail, /const rawSpeakerPersona = isGroupChat && groupReplyPick/);
  assert.match(detail, /const turnSpeakerPersona = \(window\.MAOMAOChatRoleContext/);
  assert.match(detail, /rolePersona\.length > 24000/);
  assert.match(detail, /const roleForTurn = !isGroupChat[\s\S]*?resolveRole\(currentCharacter\.id, currentCharacter, getRoleById\)/);
  assert.match(detail, /const turnSpeakerPersona = isGroupChat && groupReplyPick[\s\S]*?relationshipRole\.persona \|\| relationshipRole\.prompt/);
  assert.match(detail, /const charName = turnSpeakerName/);
  const activePersona = '深圳生活背景。'.repeat(2000);
  assert.ok(activePersona.length > 5000);
  assert.match(detail, /validateFinalApiMessages/);
  assert.doesNotMatch(detail, /rolePersona = isGroupChat \? capText\(rolePersona, CTX_CAP\.persona\) : rolePersona/);
});

test('every eligible global and attached local worldbook entry reaches the same turn', () => {
  const books = [
    { id: 'global', scope: 'global', title: '公共深圳背景',
      entries: [
        { name: '常驻', content: '深圳在广东省', injectMode: 'always' },
        { name: '关键词', content: '地铁正在运营', injectMode: 'keyword', keywords: ['地铁'] },
        { name: '未触发', content: '隐藏剧情', injectMode: 'keyword', keywords: ['外星飞船'] }
      ] },
    { id: 'local_a', scope: 'local', title: 'A的私有世界书', content: 'A经营花店' },
    { id: 'local_b', scope: 'local', title: 'B的私有世界书', content: 'B住在山上' }
  ];
  const a = getLore({ books });
  assert.match(a.result, /深圳在广东省/);
  assert.match(a.result, /地铁正在运营/);
  assert.match(a.result, /A经营花店/);
  assert.doesNotMatch(a.result, /B住在山上|隐藏剧情/);
  const b = getLore({ books, speaker: { id: 'b', worldBookIds: [] },
    text: '今天好热', mount: [] });
  assert.match(b.result, /深圳在广东省/);
  assert.doesNotMatch(b.result, /A经营花店|B住在山上|地铁正在运营/);
  const group = getLore({ books, group: true, mount: ['local_b'] });
  assert.match(group.result, /深圳在广东省|地铁正在运营/);
  assert.match(group.result, /B住在山上/);
  // Group speaker A may use A's own local book; a group-mounted B
  // book is also explicitly visible. Unmounted unrelated books remain hidden.
  assert.match(group.result, /A经营花店/);
});

test('worldbook parse and activation errors block a turn; overbudget lore is reported instead of clipped', () => {
  const books = [{ id: 'global', scope: 'global', title: '长篇设定', content: '字'.repeat(33000) }];
  const alerts = [];
  const badJson = getLore({ books, faults: { raw: '{invalid json' }, alerts });
  assert.equal(badJson.result, undefined);
  assert.match(alerts[0], /世界书读取失败/);
  const missing = getLore({ books: [{ id: 'g', scope: 'global', content: '存在内容' }],
    faults: { moduleMissing: true } });
  assert.equal(missing.result, undefined);
  assert.match(missing.alerts[0], /世界书读取失败/);
  const tooLong = getLore({ books });
  assert.equal(tooLong.result, undefined);
  assert.match(tooLong.alerts[0], /世界书过长/);
  assert.match(detail, /maxEntries: Math\.max\(1, wbList\.reduce/);
  assert.doesNotMatch(detail, /worldbookText = capText\(worldbookText, CTX_CAP\.worldbook\)/);
});

test('all affected inline scripts still parse without changing the storage schema', () => {
  const scripts = [...detail.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]);
  const main = scripts.find(src => src.includes('async function sendMsg(opts)'));
  assert.ok(main);
  assert.doesNotThrow(() => new vm.Script(main));
});
