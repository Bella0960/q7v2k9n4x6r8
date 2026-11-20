import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const detail = read('chat/chat/chat-detail.html');
const settings = read('worldbook/settings/rp-protocol.html');
const roleScript = read('shared/js/phone/chat-role-context.js');
const contextScript = read('shared/js/phone/chat-context-policy.js');
const sandbox = { window: {} };
vm.runInNewContext(roleScript, sandbox);
vm.runInNewContext(contextScript, sandbox);
const roles = sandbox.window.MAOMAOChatRoleContext;
const context = sandbox.window.ChatContextPolicy;

function actualProtocolRenderer({ name, persona, memory, worldbook, user = '用户' }) {
  // Compile the same template substitution function used by the actual send path.
  const start = detail.indexOf('            function applyProtocolVars(text) {');
  const end = detail.indexOf('\n            let systemPrompt;', start);
  assert.ok(start >= 0 && end > start);
  const body = detail.slice(start, end);
  const compile = new Function('turnSpeakerName', 'userName', 'turnSpeakerPersona', 'roleMemory', 'worldbookText',
    body + '\nreturn applyProtocolVars;');
  return compile(name, user, persona, memory, worldbook);
}

test('one global protocol key is shared by settings, direct chat, and group chat', () => {
  assert.match(settings, /var STORAGE_KEY = 'chat_rp_protocol_';/);
  assert.match(detail, /const globalRpKey = 'chat_rp_protocol_';/);
  assert.match(detail, /rpProtocol = localStorage\.getItem\(globalRpKey\) \|\| ''/);
  assert.match(detail, /rpProtocol = rpProtocol\.trim\(\) \|\| String\(window\.MAOMAO_RP_DEFAULT_PROTOCOL \|\| ''\)/);
  assert.match(detail, /const turnSpeakerName = isGroupChat && groupReplyPick/);
  assert.match(detail, /const roleForTurn = !isGroupChat/);
});

test('all role-specific values are expanded from the same saved protocol without silent truncation', () => {
  const protocol = '我的保存协议：说话按我要求，不能用统一客服语气。\n' +
    'P'.repeat(7100) + '\n{{char}} | {{user}} | {{persona}} | {{memory}} | {{worldbook}}';
  const applyA = actualProtocolRenderer({ name: '阮映雪', persona: '独立经营书店', memory: '搬家到深圳', worldbook: '现代深圳街道', user: '喵喵' });
  const applyB = actualProtocolRenderer({ name: '顾清', persona: '喜欢安静，少言', memory: '开了咖啡馆', worldbook: '架空海滨城', user: '喵喵' });
  const a = applyA(protocol);
  const b = applyB(protocol);
  assert.ok(a.length > 7100 && b.length > 7100);
  assert.ok(a.startsWith('我的保存协议：'));
  assert.ok(a.includes('阮映雪 | 喵喵 | 独立经营书店 | 搬家到深圳 | 现代深圳街道'));
  assert.ok(b.includes('顾清 | 喵喵 | 喜欢安静，少言 | 开了咖啡馆 | 架空海滨城'));
  assert.ok(!a.includes('顾清') && !b.includes('阮映雪'), 'all characters must retain separate personas');
  assert.match(detail, /systemPrompt = applyProtocolVars\(rpProtocol\);/);
  assert.doesNotMatch(detail, /capText\(applyProtocolVars\(rpProtocol\)/);
  assert.doesNotMatch(detail, /capText\(rpProtocol\.trim\(\)/);
});

test('custom protocol without a {{worldbook}} placeholder still gets activated lore, not duplicate lore', () => {
  assert.match(detail, /worldbookText && !rpProtocol\.includes\('\{\{worldbook\}\}'\)/);
  assert.match(detail, /systemPrompt \+= '[^']*【世界书 \/ 角色生活背景】/);
  assert.match(detail, /personaPolicy\.MINIMAL_PERSONA_PROMPT/);
  assert.match(detail, /【最终设定优先级】/);
  assert.match(detail, /以用户保存的协议为准/);
  assert.match(detail, /const apiMessages = \[[\s\S]*?role: 'system', content: systemPrompt/);
});

test('even global lore requires an explicit mount before it can enter a chat', () => {
  const books = [
    { id: 'global', scope: 'global', title: '全局设定', content: '城市有高架桥' },
    { id: 'local_a', scope: 'local', title: '角色A的秘密', content: '不该让B看见' },
    { id: 'local_b', scope: 'local', title: '角色B的设定', content: '经营一家小店' },
    { id: 'legacy', title: '旧世界', content: '兼容旧数据' }
  ];
  const before = JSON.stringify(books);
  const singleA = Array.from(roles.selectWorldbooksForRole(books, { worldBookIds: ['local_a'] }, []), b => b.id);
  const singleB = Array.from(roles.selectWorldbooksForRole(books, { worldBookIds: ['local_b'] }, []), b => b.id);
  const groupNone = Array.from(roles.selectWorldbooksForGroup(books, []), b => b.id);
  const groupMounted = Array.from(roles.selectWorldbooksForGroup(books, ['local_b']), b => b.id);
  assert.deepEqual(singleA, ['local_a']);
  assert.deepEqual(singleB, ['local_b']);
  assert.deepEqual(groupNone, []);
  assert.deepEqual(groupMounted, ['local_b']);
  assert.equal(JSON.stringify(books), before);
});

test('worldbook activation settings still decide which entries enter an AI turn', () => {
  const books = [
    { id: 'global', scope: 'global', title: '全局世界书',
      entries: [
        { name: '常驻', content: '城里有雨', injectMode: 'always' },
        { name: '关键词', content: '地铁终点', injectMode: 'keyword', keywords: ['地铁'] },
        { name: '禁用', content: '隐藏的怪物', enabled: false }
      ] },
    { id: 'local', scope: 'local', title: '未绑定私有书', content: '不能出现在群里' }
  ];
  const safe = Array.from(roles.selectWorldbooksForGroup(books, ['global']));
  const initial = context.buildWorldbookInjectionText(safe, { currentText: '今天好热', recentMessages: [] });
  const triggered = context.buildWorldbookInjectionText(safe, { currentText: '地铁什么时候来', recentMessages: [] });
  assert.ok(initial.includes('城里有雨'));
  assert.ok(!initial.includes('地铁终点') && !initial.includes('不能出现在群里'));
  assert.ok(triggered.includes('地铁终点'));
  assert.ok(!triggered.includes('隐藏的怪物'));
  assert.match(detail, /roleBookPolicy\.selectWorldbooksForGroupSpeaker\(/);
  assert.match(detail, /roleBookPolicy\.selectWorldbooksForRole\([\s\S]*?selected\.books, roleForTurn, mountedBookIds/);
});

test('inline chat message pipeline still compiles after the unified prompt fix', () => {
  const main = [...detail.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).find(s => s.includes('async function sendMsg(opts)'));
  assert.ok(main);
  assert.doesNotThrow(() => new vm.Script(main));
});

test('source-first system stack preserves complete protocol, selected persona and lore without repeat copies', () => {
  const start = detail.indexOf('            let systemPrompt;');
  const end = detail.indexOf('            // 角色主动邀请只针对确实退出过的群。', start);
  assert.ok(start >= 0 && end > start, 'real top-of-system assembly must be present');
  const builder = new Function(
    'rpProtocol', 'applyProtocolVars', 'turnSpeakerName', 'turnSpeakerPersona',
    'rolePersona', 'userName', 'userPersona', 'roleMemory', 'memoryContext', 'worldbookText',
    detail.slice(start, end) + '\nreturn systemPrompt;'
  );
  const persona = '深圳本地花店经营者，喜欢直接说话。'.repeat(240);
  const lore = '这座城市的花市每周三开门。';
  const protocol = '用户自己写的全局协议：角色自由表达；{{char}}；{{persona}}；{{worldbook}}';
  const expand = text => text
    .replace(/\{\{char\}\}/g, '阮映雪')
    .replace(/\{\{persona\}\}/g, persona)
    .replace(/\{\{worldbook\}\}/g, lore);
  const a = builder(protocol, expand, '阮映雪', persona, persona, '用户', '', '', '', lore);
  assert.ok(a.startsWith('用户自己写的全局协议：'), 'user protocol must precede generated mechanic rules');
  assert.ok(a.includes(persona));
  assert.ok(a.includes(lore));
  assert.equal(a.split(persona).length - 1, 1, 'expanded persona must not be duplicated');
  assert.equal(a.split(lore).length - 1, 1, 'expanded worldbook must not be duplicated');
  assert.ok(a.indexOf('【本轮角色档案') > a.indexOf('用户自己写的全局协议'));
  const customProtocol = '用户自定义协议：不要所有角色都使用一个模板。';
  const b = builder(customProtocol, () => customProtocol, '陆昭辰', persona,
    persona, '用户', '', '', '', lore);
  assert.ok(b.indexOf('【本轮角色档案') >= 0);
  assert.ok(b.includes(persona), 'protocol without {{persona}} must still get saved persona');
  assert.ok(b.includes(lore), 'protocol without {{worldbook}} must still get activated lore');
  assert.ok(b.indexOf(persona) < b.indexOf(lore), 'persona and worldbook enter before feature sections');
  assert.equal(b.split(lore).length - 1, 1);
});

test('enabled regex formatting prefixes final System; invalid rules fail without sending', () => {
  const policySource = read('shared/js/phone/chat-regex-policy.js');
  const global = {window:{}};
  vm.runInNewContext(policySource,global);
  const regexPolicy=global.window.ChatRegexPolicy;
  const start=detail.indexOf("            let regexSystemHead = '';");
  const end=detail.indexOf('            // Mandatory preflight for every single/group/continue/regenerate AI turn.',start);
  assert.ok(start>0 && end>start, 'actual regex preflight section must exist');
  const render = new Function('window','localStorage','systemPrompt','stopForMissingRoleSource','console',
    detail.slice(start,end)+'\nreturn {systemPrompt,regexSystemHead};');
  const stored = JSON.stringify([
    {id:'format',name:'输出前缀',enabled:true,pattern:'^\\[output\\]',replacement:''},
    {id:'disabled',name:'禁用规则',enabled:false,pattern:'secret',replacement:'[hidden]'}
  ]);
  const enabledStore={getItem:key=>key==='regex_rules'?stored:null};
  const notices=[];
  const got=render({ChatRegexPolicy:regexPolicy},enabledStore,'【全局伴侣协议】\n用户自己的原文',
    (reason,message)=>notices.push([reason,message]),console);
  assert.ok(got.systemPrompt.startsWith('【启用的全局正则'));
  assert.ok(got.systemPrompt.includes('输出前缀'));
  assert.ok(!got.systemPrompt.includes('禁用规则'));
  assert.ok(got.systemPrompt.includes('【全局伴侣协议】\n用户自己的原文'));
  assert.deepEqual(notices,[]);
  assert.equal(regexPolicy.applySaved('[output]内容',enabledStore),'内容',
    'deterministic reply cleanup still executes actual regex');
  const malformedStore={getItem:key=>key==='regex_rules'?'{"bad":true}':null};
  const errors=[];
  const denied=render({ChatRegexPolicy:regexPolicy},malformedStore,'【全局伴侣协议】',
    (reason,message)=>errors.push(reason), {error(){}});
  assert.equal(denied,undefined,'corrupt saved regex cannot silently send incomplete prompt');
  assert.deepEqual(errors,['regex-read']);
});

test('final outbound audit fails safely, and long built-in character lectures are not reintroduced', () => {
  assert.match(detail,/const missingRegex = regexSystemHead/);
  assert.match(detail,/stopForMissingRoleSource\('final-source-audit'/);
  assert.match(detail,/stopForMissingRoleSource\('protocol-recheck'/);
  assert.match(detail,/stopForMissingRoleSource\('protocol-updated'/);
  assert.doesNotMatch(detail,/【活人感世界书使用原则】/);
  assert.doesNotMatch(detail,/【发送前的角色一致性核对】/);
  assert.match(detail,/const IDENTITY_LOCK = \[/);
  assert.match(detail,/【本轮输出形式】/);
  const a=detail.indexOf('            // Persona/protocol/worldbook are all placed');
  const b=detail.indexOf('            // 角色主动邀请只针对确实退出过的群。',a);
  assert.ok(a>0 && b>a);
  assert.match(detail.slice(a,b),/【最终设定优先级】/);
});
