/* ============================================================
 * tests/chat-followup-policy.test.mjs
 *
 * 覆盖边界说明：
 *   - computeDelayMinutes：各轮基础间隔 + 固定 rng 的抖动边界，MIN_DELAY_MINUTES 下限
 *   - shouldBlockFollowUp：冷却（同话题/无回复/明确拒绝）、连续忽略自动冷却、
 *     时段限制（23-08）、15 分钟内刚发过、用户已回复
 *   - pickTemplate：三轮语气递进互不重复，farewell 轮 noQuestionMark=true
 *   - applyUserReply / applyIgnore / applyExplicitReject：状态迁移正确性
 *   - hasUserRepliedInWindow / detectExplicitReject：辅助函数
 *
 * 风格参照 storage-contract.test.mjs：
 *   node --test + node:assert/strict，VM 沙箱加载源码，无第三方依赖。
 * ============================================================ */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

const src = read('shared/js/phone/chat-followup-policy.js');

function freshSandbox() {
    const sandbox = {
        Math, Date, Object, Array, Number, String, Boolean, JSON,
        console: { warn() {}, log() {}, error() {} },
        globalThis: null
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    return sandbox;
}

function loadPolicy() {
    const sandbox = freshSandbox();
    runInNewContext(src, sandbox, { filename: 'chat-followup-policy.js' });
    return sandbox.ChatFollowupPolicy;
}

/* =====================================================================
 * 1. computeDelayMinutes
 * ===================================================================== */

test('computeDelayMinutes: round 0 base ~30min, round 1 ~45min, round 2 ~60min', () => {
    const policy = loadPolicy();
    // rng = 0.5 → offset = 0 → 精确 base
    const rngHalf = () => 0.5;
    assert.equal(policy.computeDelayMinutes(0, 1.0, rngHalf), 30);
    assert.equal(policy.computeDelayMinutes(1, 1.0, rngHalf), 45);
    assert.equal(policy.computeDelayMinutes(2, 1.0, rngHalf), 60);
});

test('computeDelayMinutes: relationshipMultiplier scales the delay', () => {
    const policy = loadPolicy();
    const rngHalf = () => 0.5;
    assert.equal(policy.computeDelayMinutes(0, 2.0, rngHalf), 60); // 30 * 2
    assert.equal(policy.computeDelayMinutes(1, 0.5, rngHalf), 22.5); // 45 * 0.5
});

test('computeDelayMinutes: fixed rng=0 gives minimum jitter (-15min off base)', () => {
    const policy = loadPolicy();
    const rngZero = () => 0;
    // round 0 base=30, offset = (0*2-1)*15 = -15 → 15
    assert.equal(policy.computeDelayMinutes(0, 1.0, rngZero), 15);
    // round 1 base=45 → 30
    assert.equal(policy.computeDelayMinutes(1, 1.0, rngZero), 30);
});

test('computeDelayMinutes: fixed rng=1 gives maximum jitter (+15min off base)', () => {
    const policy = loadPolicy();
    const rngOne = () => 1;
    // round 0 base=30, offset = (1*2-1)*15 = +15 → 45
    assert.equal(policy.computeDelayMinutes(0, 1.0, rngOne), 45);
    assert.equal(policy.computeDelayMinutes(1, 1.0, rngOne), 60);
});

test('computeDelayMinutes: MIN_DELAY_MINUTES floor protects against negative result', () => {
    const policy = loadPolicy();
    // multiplier=0.01 + rng=0 → (30-15)*0.01 = 0.15 → floored to 15
    assert.equal(policy.computeDelayMinutes(0, 0.01, () => 0), 15);
});

test('computeDelayMinutes: round clamps to valid range (negative / too large)', () => {
    const policy = loadPolicy();
    const rngHalf = () => 0.5;
    assert.equal(policy.computeDelayMinutes(-1, 1.0, rngHalf), 30);   // clamps to 0
    assert.equal(policy.computeDelayMinutes(99, 1.0, rngHalf), 60);   // clamps to 2 (last)
});

test('computeDelayMinutes: invalid relationshipMultiplier falls back to 1.0', () => {
    const policy = loadPolicy();
    const rngHalf = () => 0.5;
    assert.equal(policy.computeDelayMinutes(0, NaN, rngHalf), 30);
    assert.equal(policy.computeDelayMinutes(0, -5, rngHalf), 30);
    assert.equal(policy.computeDelayMinutes(0, 0, rngHalf), 30);
});

/* =====================================================================
 * 2. shouldBlockFollowUp
 * ===================================================================== */

test('shouldBlockFollowUp: allows follow-up when no blockers present', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const result = policy.shouldBlockFollowUp(null, now, {
        lastMessageAt: now - 30 * 60 * 1000,
        isQuietHour: false,
        hasUserRepliedRecently: false
    });
    assert.equal(result.blocked, false);
    assert.equal(result.reason, 'eligible');
});

test('shouldBlockFollowUp: cooldownUntil in the future blocks', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const state = { cooldownUntil: now + 60 * 60 * 1000 };
    const result = policy.shouldBlockFollowUp(state, now, {
        lastMessageAt: now - 30 * 60 * 1000,
        isQuietHour: false,
        hasUserRepliedRecently: false
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'cooldown');
});

test('shouldBlockFollowUp: cooldownUntil in the past does NOT block', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const state = { cooldownUntil: now - 60 * 60 * 1000 };
    const result = policy.shouldBlockFollowUp(state, now, {
        lastMessageAt: now - 30 * 60 * 1000,
        isQuietHour: false,
        hasUserRepliedRecently: false
    });
    assert.equal(result.blocked, false);
});

test('shouldBlockFollowUp: ignoredCount >= 3 auto-blocks', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const state = { ignoredCount: 3, cooldownUntil: 0 };
    const result = policy.shouldBlockFollowUp(state, now, {
        lastMessageAt: now - 30 * 60 * 1000,
        isQuietHour: false,
        hasUserRepliedRecently: false
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'auto-cooldown-by-ignore');
});

test('shouldBlockFollowUp: explicitReject blocks', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const result = policy.shouldBlockFollowUp(null, now, {
        lastMessageAt: now - 30 * 60 * 1000,
        isQuietHour: false,
        hasUserRepliedRecently: false,
        explicitReject: true
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'explicit-reject');
});

test('shouldBlockFollowUp: quiet hour (23:00) auto-detected blocks', () => {
    const policy = loadPolicy();
    // 构造一个 23:30 的时间戳
    const quietNow = new Date(2026, 10, 2, 23, 30, 0).getTime();
    const result = policy.shouldBlockFollowUp(null, quietNow, {
        lastMessageAt: quietNow - 30 * 60 * 1000,
        hasUserRepliedRecently: false
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'quiet-hours');
});

test('shouldBlockFollowUp: quiet hour (07:00) auto-detected blocks', () => {
    const policy = loadPolicy();
    const quietNow = new Date(2026, 10, 2, 7, 0, 0).getTime();
    const result = policy.shouldBlockFollowUp(null, quietNow, {
        lastMessageAt: quietNow - 30 * 60 * 1000,
        hasUserRepliedRecently: false
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'quiet-hours');
});

test('shouldBlockFollowUp: 15 minute window after last message blocks', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const result = policy.shouldBlockFollowUp(null, now, {
        lastMessageAt: now - 10 * 60 * 1000,
        isQuietHour: false,
        hasUserRepliedRecently: false
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'too-soon-after-last-message');
});

test('shouldBlockFollowUp: user-replied-recently blocks (terminates chain)', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const result = policy.shouldBlockFollowUp(null, now, {
        lastMessageAt: now - 30 * 60 * 1000,
        isQuietHour: false,
        hasUserRepliedRecently: true
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'user-replied');
});

/* =====================================================================
 * 3. pickTemplate
 * ===================================================================== */

test('pickTemplate: round 0 uses curious tone', () => {
    const policy = loadPolicy();
    const t = policy.pickTemplate(0, '');
    assert.ok(t.text.length > 0);
    assert.equal(t.tone, 'curious');
    assert.equal(t.round, 0);
});

test('pickTemplate: round 1 uses slight tone', () => {
    const policy = loadPolicy();
    const t = policy.pickTemplate(1, '');
    assert.equal(t.tone, 'slight');
    assert.equal(t.round, 1);
});

test('pickTemplate: round 2 uses farewell tone', () => {
    const policy = loadPolicy();
    const t = policy.pickTemplate(2, '');
    assert.equal(t.tone, 'farewell');
    assert.equal(t.round, 2);
    assert.equal(t.noQuestionMark, true);
    // 告别收手，不应含问号
    assert.ok(!/\?|？/.test(t.text), 'farewell 轮不应含问号');
});

test('pickTemplate: noQuestionMark is false for curious/slight rounds', () => {
    const policy = loadPolicy();
    assert.equal(policy.pickTemplate(0, '').noQuestionMark, false);
    assert.equal(policy.pickTemplate(1, '').noQuestionMark, false);
});

test('pickTemplate: avoids lastTopic when possible', () => {
    const policy = loadPolicy();
    const pool = policy.CONSTANTS.TEMPLATES.curious;
    // 强制用 Math.random 固定，让 pickTemplate 选 index=0
    const sandbox = freshSandbox();
    runInNewContext(src, sandbox);
    // 但这里的 Math.random 是沙箱的，所以直接用 loadPolicy 然后检查
    // 实际上 pickTemplate 用的是 Math.random（沙箱里的），不太好固定
    // 换一种方式：传一个 lastTopic 等于 pool 中某个，看返回不是那条
    const t = policy.pickTemplate(0, pool[0]);
    assert.notEqual(t.text, pool[0], '应避免返回与 lastTopic 相同的模板');
});

test('pickTemplate: explicit tone parameter overrides round-based selection', () => {
    const policy = loadPolicy();
    const t = policy.pickTemplate(0, '', 'farewell');
    assert.equal(t.tone, 'farewell');
    assert.equal(t.noQuestionMark, true);
});

/* =====================================================================
 * 4. 状态迁移
 * ===================================================================== */

test('applyUserReply: resets round and cooldown, raises receptivity', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const state = policy.normalizeState({
        followUpRound: 2,
        nextFollowUpAt: now + 3600 * 1000,
        cooldownUntil: now + 7200 * 1000,
        ignoredCount: 2,
        receptivity: 0.5
    });
    const next = policy.applyUserReply(state, now);
    assert.equal(next.followUpRound, 0);
    assert.equal(next.nextFollowUpAt, 0);
    assert.equal(next.cooldownUntil, 0);
    assert.equal(next.ignoredCount, 0);
    assert.ok(next.receptivity > state.receptivity, 'receptivity 应上升');
});

test('applyUserReply: receptivity has upper bound 1.0', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const state = policy.normalizeState({ receptivity: 0.95 });
    const next = policy.applyUserReply(state, now);
    assert.ok(next.receptivity <= 1.0);
});

test('applyIgnore: increments ignoredCount, lowers receptivity', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const state = policy.normalizeState({
        followUpRound: 0,
        receptivity: 0.7
    });
    const next = policy.applyIgnore(state, now);
    assert.equal(next.ignoredCount, 1);
    assert.ok(next.receptivity < state.receptivity, 'receptivity 应下降');
    assert.ok(next.nextFollowUpAt > now, '应计算下一轮时间');
    assert.equal(next.followUpRound, 1);
});

test('applyIgnore: receptivity has lower bound', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const state = policy.normalizeState({ receptivity: 0.12 });
    const next = policy.applyIgnore(state, now);
    assert.ok(next.receptivity >= policy.CONSTANTS.RECEPTIVITY_MIN);
});

test('applyIgnore: reaching threshold triggers auto cooldown', () => {
    const policy = loadPolicy();
    const now = Date.now();
    // ignoredCount 已经是 2，再忽略一次 → 3 → 触发
    const state = policy.normalizeState({
        followUpRound: 1,
        ignoredCount: 2,
        cooldownUntil: 0
    });
    const next = policy.applyIgnore(state, now);
    assert.equal(next.ignoredCount, 3);
    assert.ok(next.cooldownUntil > now, 'cooldownUntil 应被设置');
    assert.equal(next.nextFollowUpAt, 0);
});

test('applyExplicitReject: sets long cooldown', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const next = policy.applyExplicitReject(null, now);
    assert.ok(next.cooldownUntil >= now + policy.CONSTANTS.COOLDOWN_EXPLICIT_REJECT_MS);
    assert.equal(next.followUpRound, 0);
    assert.equal(next.nextFollowUpAt, 0);
});

test('applySameTopicCooldown: pushes cooldown forward', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const next = policy.applySameTopicCooldown(null, now);
    assert.ok(next.cooldownUntil >= now + policy.CONSTANTS.COOLDOWN_SAME_TOPIC_MS);
});

/* =====================================================================
 * 5. 辅助函数
 * ===================================================================== */

test('hasUserRepliedInWindow: detects user message within window', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const history = [
        { role: 'assistant', text: '好的', time: now - 5 * 60 * 1000 },
        { role: 'user', text: '嗯嗯', time: now - 3 * 60 * 1000 }
    ];
    assert.equal(policy.hasUserRepliedInWindow(history, now, 10 * 60 * 1000), true);
});

test('hasUserRepliedInWindow: ignores messages outside window', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const history = [
        { role: 'assistant', text: '好的', time: now - 30 * 60 * 1000 },
        { role: 'user', text: '嗯嗯', time: now - 25 * 60 * 1000 }
    ];
    assert.equal(policy.hasUserRepliedInWindow(history, now, 10 * 60 * 1000), false);
});

test('hasUserRepliedInWindow: treats sent role as user', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const history = [
        { role: 'sent', text: '嗯嗯', time: now - 2 * 60 * 1000 }
    ];
    assert.equal(policy.hasUserRepliedInWindow(history, now, 10 * 60 * 1000), true);
});

test('detectExplicitReject: catches Chinese reject keywords', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const history = [
        { role: 'assistant', text: '在吗？', time: now - 60000 },
        { role: 'user', text: '别问了，我现在不想聊', time: now - 30000 }
    ];
    assert.equal(policy.detectExplicitReject(history, now), true);
});

test('detectExplicitReject: catches English reject keywords', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const history = [
        { role: 'user', text: 'stop messaging me', time: now - 30000 }
    ];
    assert.equal(policy.detectExplicitReject(history, now), true);
});

test('detectExplicitReject: does not flag normal conversation', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const history = [
        { role: 'assistant', text: '今天天气不错', time: now - 60000 },
        { role: 'user', text: '嗯嗯，是挺好的', time: now - 30000 }
    ];
    assert.equal(policy.detectExplicitReject(history, now), false);
});

/* =====================================================================
 * 6. normalizeState edge cases
 * ===================================================================== */

test('normalizeState: returns valid defaults from null', () => {
    const policy = loadPolicy();
    const s = policy.normalizeState(null);
    assert.equal(s.version, 1);
    assert.equal(s.followUpRound, 0);
    assert.ok(s.receptivity >= 0.1 && s.receptivity <= 1.0);
});

test('normalizeState: clamps receptivity', () => {
    const policy = loadPolicy();
    const s = policy.normalizeState({ receptivity: 1.5 });
    assert.ok(s.receptivity <= 1.0);
    const s2 = policy.normalizeState({ receptivity: -99 });
    assert.ok(s2.receptivity >= policy.CONSTANTS.RECEPTIVITY_MIN);
});

/* =====================================================================
 * 7. cooldownReason 字段
 * ===================================================================== */

test('applyIgnore: advancing round sets cooldownReason="" and nextFollowUpAt in future', () => {
    const policy = loadPolicy();
    const now = Date.now();
    // followUpRound=0, ignoredCount=0 → 还没到任何终止条件
    const state = policy.normalizeState({ followUpRound: 0, ignoredCount: 0 });
    const next = policy.applyIgnore(state, now);
    assert.equal(next.followUpRound, 1, '应推进到第 2 轮');
    assert.ok(next.nextFollowUpAt > now, 'nextFollowUpAt 应在未来');
    assert.ok(next.cooldownUntil <= now, '不应该有冷却');
    assert.equal(next.cooldownReason, '');
});

test('applyIgnore: round reaches MAX_ROUNDS-1 triggers 24h cooldown with reason=no-reply', () => {
    const policy = loadPolicy();
    const now = Date.now();
    // followUpRound=2 (MAX_ROUNDS-1)，再调 applyIgnore 应终止
    const state = policy.normalizeState({ followUpRound: 2, ignoredCount: 0 });
    const next = policy.applyIgnore(state, now);
    assert.equal(next.followUpRound, 2, '轮次不再推进');
    assert.equal(next.nextFollowUpAt, 0);
    assert.ok(next.cooldownUntil >= now + policy.CONSTANTS.COOLDOWN_NO_REPLY_MS - 1000);
    assert.equal(next.cooldownReason, 'no-reply');
});

test('applyIgnore: ignoredCount threshold also sets reason=no-reply', () => {
    const policy = loadPolicy();
    const now = Date.now();
    // 轮次还低但忽略次数达阈值
    const state = policy.normalizeState({ followUpRound: 0, ignoredCount: 3 });
    const next = policy.applyIgnore(state, now);
    assert.equal(next.cooldownReason, 'no-reply');
    assert.equal(next.nextFollowUpAt, 0);
});

test('applyExplicitReject: sets cooldownReason=explicit-reject', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const next = policy.applyExplicitReject(null, now);
    assert.equal(next.cooldownReason, 'explicit-reject');
});

test('applySameTopicCooldown: sets cooldownReason=same-topic', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const next = policy.applySameTopicCooldown(null, now);
    assert.equal(next.cooldownReason, 'same-topic');
});

test('applyUserReply: clears cooldownReason', () => {
    const policy = loadPolicy();
    const now = Date.now();
    const state = policy.normalizeState({
        cooldownUntil: now + 3600 * 1000,
        cooldownReason: 'no-reply'
    });
    const next = policy.applyUserReply(state, now);
    assert.equal(next.cooldownReason, '');
    assert.equal(next.cooldownUntil, 0);
    assert.equal(next.nextFollowUpAt, 0);
    assert.equal(next.followUpRound, 0);
});

test('normalizeState: rejects invalid cooldownReason and falls back to empty', () => {
    const policy = loadPolicy();
    const s = policy.normalizeState({ cooldownReason: 'some-gibberish' });
    assert.equal(s.cooldownReason, '');
    // 四个合法值全部保留
    assert.equal(policy.normalizeState({ cooldownReason: 'no-reply' }).cooldownReason, 'no-reply');
    assert.equal(policy.normalizeState({ cooldownReason: 'same-topic' }).cooldownReason, 'same-topic');
    assert.equal(policy.normalizeState({ cooldownReason: 'explicit-reject' }).cooldownReason, 'explicit-reject');
});

/* =====================================================================
 * 8. 完整链路：发第1轮 → 推进到第2轮有 nextFollowUpAt → 再发 → 推进到第3轮 → 再发 → 冷却
 * ===================================================================== */

test('full chain: three rounds then auto cooldown, user reply terminates state', () => {
    const policy = loadPolicy();
    const now = Date.now();

    // --- 第 1 轮发出，状态从 round=0 推进到 round=1 ---
    let s1 = policy.normalizeState({ followUpRound: 0, ignoredCount: 0 });
    assert.equal(s1.nextFollowUpAt, 0, '初始没有 nextFollowUpAt');
    s1 = policy.applyIgnore(s1, now);  // 模拟"发出追问后"
    assert.equal(s1.followUpRound, 1);
    assert.ok(s1.nextFollowUpAt > now, '发完第 1 轮后应有下一个时间点');
    // 合理范围：computeDelayMinutes 下限 15min、正常 30min±15min → 15–120min 都合理
    assert.ok(s1.nextFollowUpAt >= now + 15 * 60 * 1000);
    assert.ok(s1.nextFollowUpAt <= now + 120 * 60 * 1000);
    assert.equal(s1.cooldownReason, '');

    // --- 第 2 轮发出，round=1 → round=2 ---
    let s2 = policy.applyIgnore(s1, now + 5000);
    assert.equal(s2.followUpRound, 2);
    assert.ok(s2.nextFollowUpAt > 0, '发完第 2 轮仍应有下一轮时间');
    assert.equal(s2.cooldownReason, '');

    // --- 第 3 轮发出，round=2 已是 MAX_ROUNDS-1 → 触发冷却 ---
    let s3 = policy.applyIgnore(s2, now + 10000);
    assert.equal(s3.followUpRound, 2, '第 3 轮后轮次不再推进');
    assert.equal(s3.nextFollowUpAt, 0);
    assert.equal(s3.cooldownReason, 'no-reply');
    assert.ok(s3.cooldownUntil > now + 10000);

    // --- 冷却期过了也不再自动复活（用户回复才重置） ---
    // 让冷却过去，但没 applyUserReply 的话 shouldBlockFollowUp 里 ignoredCount 还 ≥3
    const futureNow = s3.cooldownUntil + 1000;
    const block = policy.shouldBlockFollowUp(s3, futureNow, {
        lastMessageAt: futureNow - 30 * 60 * 1000,
        hasUserRepliedRecently: false,
        isQuietHour: false
    });
    // 此时 cooldownUntil 已过期，但 ignoredCount≥3 仍会被拦截
    assert.equal(block.blocked, true);
    assert.equal(block.reason, 'auto-cooldown-by-ignore');

    // --- 用户回复 → 状态完全重置 ---
    const s4 = policy.applyUserReply(s3, futureNow);
    assert.equal(s4.followUpRound, 0);
    assert.equal(s4.nextFollowUpAt, 0);
    assert.equal(s4.cooldownUntil, 0);
    assert.equal(s4.cooldownReason, '');
    assert.equal(s4.ignoredCount, 0);
});
