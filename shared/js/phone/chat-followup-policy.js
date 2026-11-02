/* ============================================================
 * chat-followup-policy.js —— 主动追问节奏：纯逻辑模块
 *
 * 职责：
 *   - 计算下一次追问的延迟（轮次递增 + 随机抖动 + 关系系数）
 *   - 判断当前是否应该拦截追问（冷却、连续忽略、时段、刚发过）
 *   - 按轮次挑选语气递进的模板
 *   - 状态迁移：用户回复 / 忽略 后更新状态
 *
 * 纯函数原则：不读 localStorage、不依赖 DOM、不调 fetch。
 * 状态读写由调度侧（chat-notifier.js）负责。
 *
 * 状态结构（按 chat_id 分键存 localStorage）：
 *   {
 *     version: 1,
 *     lastFollowUpAt: number,        // 上次追问发出的时间戳 (ms)
 *     followUpRound: number,         // 当前追问轮次 0..MAX_ROUNDS-1
 *     lastTopic: string,             // 上次追问的模板文本，用于同话题冷却
 *     ignoredCount: number,          // 连续忽略次数（追问发出后用户未回复）
 *     cooldownUntil: number,         // 冷却截止时间戳 (ms)，0 表示无冷却
 *     cooldownReason: string,        // 冷却原因：'' / 'same-topic' / 'no-reply' / 'explicit-reject'
 *     receptivity: number,           // 回应度 0..1，用户回复上升、忽略下降
 *     nextFollowUpAt: number         // 下次可追问的时间戳 (ms)，0 表示暂停（轮次用尽或冷却中）
 *   }
 *
 * 调度方式：持久化 nextFollowUpAt，由 chat-notifier.js 的现有扫描机制
 * （页面加载 + 5min setInterval + visibilitychange）比对当前时间决定是否触发。
 * 不使用 setTimeout 做主线——手机切后台/锁屏/PWA 冻结会丢定时器。
 * ============================================================ */

(function (global) {
    'use strict';

    var NS = global.ChatFollowupPolicy = {};

    /* ---------- 常量 ---------- */

    // 各轮基础间隔（分钟），随轮次递增
    var BASE_DELAY_MINUTES = [30, 45, 60];

    // 随机抖动范围（分钟）
    var JITTER_MINUTES = 15;

    // 延迟下限（分钟），避免抖动后过短
    var MIN_DELAY_MINUTES = 15;

    // 时段限制：23:00–08:00 不追问
    var QUIET_HOUR_START = 23;
    var QUIET_HOUR_END = 8;

    // 距该会话上一条消息不足 15 分钟不追
    var MIN_GAP_SINCE_LAST_MESSAGE_MS = 15 * 60 * 1000;

    // 冷却时长
    var COOLDOWN_SAME_TOPIC_MS = 12 * 60 * 60 * 1000;   // 同话题 12h
    var COOLDOWN_NO_REPLY_MS = 24 * 60 * 60 * 1000;      // 无回复 24h
    var COOLDOWN_EXPLICIT_REJECT_MS = 72 * 60 * 60 * 1000; // 明确拒绝 72h

    // 连续忽略达多少次 → 自动进入冷却
    var AUTO_COOLDOWN_IGNORE_THRESHOLD = 3;

    // 明确拒绝关键词（不区分大小写，匹配用户消息文本）
    var REJECT_KEYWORDS = [
        '别问', '不用问', '不要问', '别追', '别烦', '别纠缠',
        '不想聊', '不想说话', '别打扰', '请别', '不要再',
        'stop', 'don\'t', 'not now', 'leave me'
    ];

    // 回应度变化步长
    var RECEPTIVITY_STEP_ON_REPLY = 0.15;
    var RECEPTIVITY_STEP_ON_IGNORE = 0.1;
    var RECEPTIVITY_MIN = 0.1;
    var RECEPTIVITY_MAX = 1.0;

    // 最大追问轮次
    var MAX_ROUNDS = 3;

    /* ---------- 语气递进模板（第 1/2/3 轮） ---------- */
    // tone: 'curious'（问句好奇）| 'slight'（陈述小失落）| 'farewell'（告别收手）
    // 每个 tone 下多条候选，pickTemplate 会避免与 lastTopic 重复

    var TEMPLATES = {
        curious: [
            '刚才你说到的那件事，后来怎么样了？',
            '你上次说在忙的那个事，现在还顺利吗？',
            '突然想起你之前提到的，后来进展如何？',
            '那个你说想做的事，开始了吗？',
            '之前聊到的，后来有什么变化吗？'
        ],
        slight: [
            '嗯…有点在意你上次说的那件事。',
            '不知道你那边最近怎么样，想说一句。',
            '刚才想到你之前提过的，就来看看。',
            '你之前说在忙的事，不知道还顺利不。',
            '有点想知道你最近的状态。'
        ],
        farewell: [
            '好，那先这样，有空再说。',
            '没事，就是想起了，你忙你的。',
            '不打扰了，有机会再聊。',
            '那就先不追了，顺其自然吧。'
        ]
    };

    /* ---------- 伪随机（便于测试注入） ---------- */

    function defaultRng() { return Math.random(); }

    function clamp(value, min, max) {
        if (!isFinite(value)) return min;
        return Math.max(min, Math.min(max, value));
    }

    /* ---------- 1. computeDelayMinutes ---------- */
    // round: 0-based，0=第一轮，1=第二轮，2=第三轮及以后
    // relationshipMultiplier: 关系系数（当前固定 1.0，预留接入真实关系等级字段）
    // rng: 伪随机函数，默认 Math.random
    NS.computeDelayMinutes = function (round, relationshipMultiplier, rng) {
        var r = Math.max(0, Math.min(MAX_ROUNDS - 1, Math.floor(Number(round) || 0)));
        var base = BASE_DELAY_MINUTES[r] != null ? BASE_DELAY_MINUTES[r] : BASE_DELAY_MINUTES[BASE_DELAY_MINUTES.length - 1];
        var mult = Number(relationshipMultiplier);
        if (!isFinite(mult) || mult <= 0) mult = 1.0;

        var rand = typeof rng === 'function' ? rng() : defaultRng();
        if (!isFinite(rand)) rand = defaultRng();
        // rand ∈ [0, 1) → offset ∈ [-JITTER, +JITTER]，但平均在 0
        var offset = (rand * 2 - 1) * JITTER_MINUTES;

        var total = (base + offset) * mult;
        return Math.max(MIN_DELAY_MINUTES, total);
    };

    /* ---------- 2. shouldBlockFollowUp ---------- */
    // state: 当前追问状态对象（可为 null/undefined 表示全新，尚未开始追问）
    // now: 当前时间戳 ms
    // opts: { lastMessageAt, hasUserRepliedRecently, isQuietHour, explicitReject }
    //   lastMessageAt: 该会话上一条消息的时间戳
    //   hasUserRepliedRecently: boolean，用户是否最近回过任何消息（= true → 本轮取消）
    //   isQuietHour: boolean，是否处于 23:00–08:00 时段（不传则自动从 now 推导）
    //   explicitReject: boolean，本轮是否检测到明确拒绝
    //
    // 返回: { blocked: boolean, reason: string }
    NS.shouldBlockFollowUp = function (state, now, opts) {
        opts = opts || {};
        now = Number(now) || Date.now();

        // 2a. 冷却检查
        if (state && state.cooldownUntil && Number(state.cooldownUntil) > now) {
            return { blocked: true, reason: 'cooldown' };
        }

        // 2b. 连续忽略达阈值 → 自动冷却
        if (state && Number(state.ignoredCount) >= AUTO_COOLDOWN_IGNORE_THRESHOLD) {
            return { blocked: true, reason: 'auto-cooldown-by-ignore' };
        }

        // 2c. 明确拒绝 → 长冷却
        if (opts.explicitReject) {
            return { blocked: true, reason: 'explicit-reject' };
        }

        // 2d. 时段限制（23:00–08:00 本地时间）
        var isQuiet = opts.isQuietHour;
        if (typeof isQuiet !== 'boolean') {
            var hour = new Date(now).getHours();
            isQuiet = hour >= QUIET_HOUR_START || hour < QUIET_HOUR_END;
        }
        if (isQuiet) {
            return { blocked: true, reason: 'quiet-hours' };
        }

        // 2e. 距上一条消息不足 15 分钟
        if (opts.lastMessageAt) {
            var gap = now - Number(opts.lastMessageAt);
            if (gap >= 0 && gap < MIN_GAP_SINCE_LAST_MESSAGE_MS) {
                return { blocked: true, reason: 'too-soon-after-last-message' };
            }
        }

        // 2f. 用户最近回过任何消息 → 本轮取消（立即终止追问链）
        if (opts.hasUserRepliedRecently) {
            return { blocked: true, reason: 'user-replied' };
        }

        return { blocked: false, reason: 'eligible' };
    };

    /* ---------- 3. pickTemplate ---------- */
    // round: 0..MAX_ROUNDS-1
    // lastTopic: 上一次用的模板 key（可选），用于去重
    // tone: 可选，强制指定语气（默认按 round 自动选择）
    NS.pickTemplate = function (round, lastTopic, tone) {
        var r = Math.max(0, Math.min(MAX_ROUNDS - 1, Math.floor(Number(round) || 0)));

        var autoTone;
        if (typeof tone === 'string' && tone.trim()) {
            autoTone = tone.trim();
        } else {
            if (r === 0) autoTone = 'curious';
            else if (r === 1) autoTone = 'slight';
            else autoTone = 'farewell';
        }

        var pool = TEMPLATES[autoTone];
        if (!pool || !pool.length) return '';

        // 去重：避免与 lastTopic 相同
        var last = String(lastTopic || '').trim();
        var candidates = last ? pool.filter(function (t) { return t !== last; }) : pool;
        if (!candidates.length) candidates = pool; // 极端情况：全部相同则退回

        var idx = Math.floor(Math.random() * candidates.length);
        var picked = candidates[idx];

        return {
            text: picked,
            tone: autoTone,
            round: r,
            // 第 3 轮不再用问句（告别收手）
            noQuestionMark: autoTone === 'farewell'
        };
    };

    /* ---------- 4. 状态迁移 ---------- */

    // 用户发消息 → 终止追问链、回应度上升
    NS.applyUserReply = function (state, now) {
        now = Number(now) || Date.now();
        var s = normalizeState(state);
        s.followUpRound = 0;
        s.nextFollowUpAt = 0;
        s.cooldownUntil = 0;
        s.cooldownReason = '';
        s.ignoredCount = 0;
        s.receptivity = clamp(s.receptivity + RECEPTIVITY_STEP_ON_REPLY, RECEPTIVITY_MIN, RECEPTIVITY_MAX);
        // lastFollowUpAt 和 lastTopic 保留（供历史追溯）
        return s;
    };

    // 追问发出后，assistant 再发了一条消息但用户没回复 → 计为忽略
    NS.applyIgnore = function (state, now) {
        now = Number(now) || Date.now();
        var s = normalizeState(state);
        s.ignoredCount = Math.min(s.ignoredCount + 1, AUTO_COOLDOWN_IGNORE_THRESHOLD + 2);
        s.receptivity = clamp(s.receptivity - RECEPTIVITY_STEP_ON_IGNORE, RECEPTIVITY_MIN, RECEPTIVITY_MAX);

        // 终止条件 1：轮次已达 MAX_ROUNDS（3）→ 24h 冷却
        if (s.followUpRound >= MAX_ROUNDS - 1) {
            s.cooldownUntil = Math.max(s.cooldownUntil, now + COOLDOWN_NO_REPLY_MS);
            s.cooldownReason = 'no-reply';
            s.nextFollowUpAt = 0;
        }
        // 终止条件 2：连续忽略 ≥ 阈值 → 24h 冷却
        else if (s.ignoredCount >= AUTO_COOLDOWN_IGNORE_THRESHOLD) {
            s.cooldownUntil = Math.max(s.cooldownUntil, now + COOLDOWN_NO_REPLY_MS);
            s.cooldownReason = 'no-reply';
            s.nextFollowUpAt = 0;
        }
        // 正常推进：下一轮 followUpRound+1，computeDelayMinutes 算出 nextFollowUpAt
        else {
            var nextRound = s.followUpRound + 1;
            var delayMin = NS.computeDelayMinutes(nextRound, 1.0);
            s.nextFollowUpAt = now + delayMin * 60 * 1000;
            s.followUpRound = nextRound;
        }
        s.lastFollowUpAt = now;
        return s;
    };

    // 明确拒绝 → 长冷却
    NS.applyExplicitReject = function (state, now) {
        now = Number(now) || Date.now();
        var s = normalizeState(state);
        s.cooldownUntil = now + COOLDOWN_EXPLICIT_REJECT_MS;
        s.cooldownReason = 'explicit-reject';
        s.nextFollowUpAt = 0;
        s.followUpRound = 0;
        return s;
    };

    // 同话题冷却
    NS.applySameTopicCooldown = function (state, now) {
        now = Number(now) || Date.now();
        var s = normalizeState(state);
        s.cooldownUntil = Math.max(s.cooldownUntil, now + COOLDOWN_SAME_TOPIC_MS);
        s.cooldownReason = 'same-topic';
        return s;
    };

    /* ---------- 5. 辅助：从历史判断"用户最近是否回过消息" ---------- */

    // history: 聊天消息数组，每条带 role / time / text
    // sinceMs: 追溯窗口（ms），默认 10 分钟内有用户消息算"回过"
    NS.hasUserRepliedInWindow = function (history, now, sinceMs) {
        now = Number(now) || Date.now();
        var window = Number(sinceMs);
        if (!isFinite(window) || window <= 0) window = 10 * 60 * 1000;
        var list = Array.isArray(history) ? history : [];
        for (var i = list.length - 1; i >= 0; i--) {
            var m = list[i];
            if (!m || m.silent || m.isError) continue;
            var role = m.role;
            if (role === 'user' || role === 'sent') {
                var t = Number(m.time || m.timestamp) || 0;
                if (t && now - t >= 0 && now - t <= window) return true;
            }
        }
        return false;
    };

    // 检测明确拒绝
    NS.detectExplicitReject = function (history, now) {
        now = Number(now) || Date.now();
        var list = Array.isArray(history) ? history : [];
        // 只看最近 3 条用户消息
        var userMessages = [];
        for (var i = list.length - 1; i >= 0 && userMessages.length < 3; i--) {
            var m = list[i];
            if (m && !m.silent && !m.isError && (m.role === 'user' || m.role === 'sent')) {
                userMessages.push(String(m.text || m.content || ''));
            }
        }
        for (var j = 0; j < userMessages.length; j++) {
            var txt = userMessages[j].toLowerCase();
            for (var k = 0; k < REJECT_KEYWORDS.length; k++) {
                if (txt.indexOf(REJECT_KEYWORDS[k].toLowerCase()) !== -1) return true;
            }
        }
        return false;
    };

    /* ---------- 6. 辅助：normalizeState ---------- */

    function normalizeState(state) {
        var s = state && typeof state === 'object' ? state : {};
        var reason = String(s.cooldownReason == null ? '' : s.cooldownReason).trim();
        // 只接受约定的四种值，其他统一归为空串
        if (reason !== 'same-topic' && reason !== 'no-reply' && reason !== 'explicit-reject') reason = '';
        return {
            version: 1,
            lastFollowUpAt: Number(s.lastFollowUpAt) || 0,
            followUpRound: Number(s.followUpRound) || 0,
            lastTopic: String(s.lastTopic || ''),
            ignoredCount: Number(s.ignoredCount) || 0,
            cooldownUntil: Number(s.cooldownUntil) || 0,
            cooldownReason: reason,
            receptivity: clamp(Number(s.receptivity), RECEPTIVITY_MIN, RECEPTIVITY_MAX) || 0.7,
            nextFollowUpAt: Number(s.nextFollowUpAt) || 0
        };
    }

    NS.normalizeState = normalizeState;

    /* ---------- 7. 常量导出（便于调度侧读取冷却时长等） ---------- */

    NS.CONSTANTS = {
        BASE_DELAY_MINUTES: BASE_DELAY_MINUTES.slice(),
        JITTER_MINUTES: JITTER_MINUTES,
        MIN_DELAY_MINUTES: MIN_DELAY_MINUTES,
        QUIET_HOUR_START: QUIET_HOUR_START,
        QUIET_HOUR_END: QUIET_HOUR_END,
        MIN_GAP_SINCE_LAST_MESSAGE_MS: MIN_GAP_SINCE_LAST_MESSAGE_MS,
        COOLDOWN_SAME_TOPIC_MS: COOLDOWN_SAME_TOPIC_MS,
        COOLDOWN_NO_REPLY_MS: COOLDOWN_NO_REPLY_MS,
        COOLDOWN_EXPLICIT_REJECT_MS: COOLDOWN_EXPLICIT_REJECT_MS,
        AUTO_COOLDOWN_IGNORE_THRESHOLD: AUTO_COOLDOWN_IGNORE_THRESHOLD,
        MAX_ROUNDS: MAX_ROUNDS,
        RECEPTIVITY_MIN: RECEPTIVITY_MIN,
        RECEPTIVITY_MAX: RECEPTIVITY_MAX,
        TEMPLATES: JSON.parse(JSON.stringify(TEMPLATES))
    };

})(typeof window !== 'undefined' ? window : globalThis);
