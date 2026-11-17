import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chat = readFileSync(resolve(root, 'chat/chat/chat-detail.html'), 'utf8');
const block = chat.match(/\/\* ENCOUNTER_CHAT_POLICY_BEGIN \*\/([\s\S]*?)\/\* ENCOUNTER_CHAT_POLICY_END \*\//);
assert.ok(block, '邂逅角色策略应保留独立可测试入口');
const policy = runInNewContext('(function(){' + block[1] +
    ';return { getEncounterRoleGreeting, buildEncounterIdentityContext };})()');

test('首次邂逅消息依据性格生成，旧角色不受影响', () => {
    const cold = { encounterOrigin: { version: 1, trait: '清冷寡言' } };
    const sunny = { encounterOrigin: { version: 1, trait: '阳光直率' } };
    assert.equal(policy.getEncounterRoleGreeting(cold), '嗯，是你。');
    assert.notEqual(policy.getEncounterRoleGreeting(sunny), policy.getEncounterRoleGreeting(cold));
    assert.equal(policy.getEncounterRoleGreeting({ name: '老角色' }), '');
    assert.match(chat, /encounterGreeting \|\| `你好，我是/);
});

test('邂逅每轮对话保留职业、背景、命运线索，不泄露到普通角色', () => {
    const role = {
        persona: '用户自行补充的人设',
        encounterOrigin: { version: 1, trait: '清冷寡言', era: '现代都市',
            job: '书店店主', originalFate: '曾经离开故乡多年',
            contrast: '对旧书异常认真', object: '一张明信片', storyOpening: '刚从店里收工' }
    };
    const context = policy.buildEncounterIdentityContext(role);
    for (const item of ['清冷寡言', '现代都市', '书店店主', '曾经离开故乡多年',
        '一张明信片', '用户之后手动修改的人设']) assert.ok(context.includes(item), item);
    assert.equal(policy.buildEncounterIdentityContext({ name: '老角色' }), '');
    assert.match(chat, /!isGroupChat \? buildEncounterIdentityContext\(roleForTurn\) : ''/);
});

test('手机端顶部紧凑且不再展示虚拟状态栏，桌面样式保留', () => {
    assert.match(chat, /@media \(max-width: 600px\)[\s\S]*?\.phone-mockup > \.status-bar \{ display: none !important; \}/);
    assert.match(chat, /\.phone-mockup > \.chat-header \{\s*padding: calc\(8px \+ env\(safe-area-inset-top, 0px\)\) 14px 8px !important;/);
    assert.match(chat, /\.chat-header \{\s*padding: 48px 14px 10px 14px;/);
});
