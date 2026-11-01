/* MAOMAO Follow-up Policy
 * Pure scheduling helpers shared by private and group follow-up chains.
 * Sending, persistence and API calls are owned by chat-notifier.js.
 */
(function (global) {
  'use strict';

  var BASE_INTERVAL_MINUTES = [30, 45, 60];
  var RELATIONSHIP_MULTIPLIERS = {
    stranger: 1.5,
    friend: 1,
    close: 0.75,
    lover: 0.5
  };
  var MIN_DELAY_MINUTES = 15;
  var MAX_JITTER_MINUTES = 15;
  var QUIET_START_HOUR = 9;
  var QUIET_END_HOUR = 23;

  function clamp(value, min, max, fallback) {
    var number = Number(value);
    if (!isFinite(number)) number = fallback;
    return Math.max(min, Math.min(max, number));
  }

  function calculateDelay(round, relationship, randomValue) {
    var index = Math.max(0, Math.min(2, Math.floor(Number(round) || 1) - 1));
    var base = BASE_INTERVAL_MINUTES[index];
    var random = clamp(randomValue, 0, 0.999999, 0.5);
    var jitter = Math.floor(random * (MAX_JITTER_MINUTES * 2 + 1)) - MAX_JITTER_MINUTES;
    var multiplier = RELATIONSHIP_MULTIPLIERS[String(relationship || 'friend').toLowerCase()] || 1;
    return Math.max(MIN_DELAY_MINUTES, Math.round((base + jitter) * multiplier));
  }

  function isQuietTime(timestamp, quietStartHour, quietEndHour) {
    var date = new Date(Number(timestamp) || Date.now());
    var hour = date.getHours();
    var start = clamp(quietStartHour == null ? QUIET_START_HOUR : quietStartHour, 0, 23, QUIET_START_HOUR);
    var end = clamp(quietEndHour == null ? QUIET_END_HOUR : quietEndHour, 1, 24, QUIET_END_HOUR);
    return hour < start || hour >= end;
  }

  function nextAllowedTime(timestamp, quietStartHour, quietEndHour) {
    var date = new Date(Number(timestamp) || Date.now());
    var start = clamp(quietStartHour == null ? QUIET_START_HOUR : quietStartHour, 0, 23, QUIET_START_HOUR);
    var end = clamp(quietEndHour == null ? QUIET_END_HOUR : quietEndHour, 1, 24, QUIET_END_HOUR);
    var hour = date.getHours();
    if (hour >= end) date.setDate(date.getDate() + 1);
    if (hour >= end || hour < start) {
      date.setHours(start, 0, 0, 0);
    }
    return date.getTime();
  }

  function normalizeTopic(text) {
    return String(text || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\[[^\]]{1,120}\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase()
      .slice(0, 80);
  }

  function classifyUserIntent(text) {
    var value = String(text || '').replace(/\s+/g, '');
    if (/(别再发|别发了|不要再发|别主动联系|暂停追问|不要追问|先别联系)/.test(value)) return 'pause';
    if (/(恢复主动联系|可以继续主动联系|继续主动联系|可以继续联系|继续追问|重新开启追问|可以再联系)/.test(value)) return 'resume';
    return 'normal';
  }

  function shouldBlock(state, now) {
    state = state && typeof state === 'object' ? state : {};
    var timestamp = Number(now) || Date.now();
    var cooldownUntil = Number(state.cooldownUntil) || 0;
    if (cooldownUntil > timestamp) return { blocked: true, reason: 'cooldown', cooldownUntil: cooldownUntil };
    if (Number(state.ignoredCount) >= 3) {
      state.cooldownUntil = timestamp + 24 * 60 * 60 * 1000;
      state.ignoredCount = 0;
      return { blocked: true, reason: 'repeated-no-reply', cooldownUntil: state.cooldownUntil };
    }
    return { blocked: false, reason: 'ready' };
  }

  function applyUserIntent(state, text, now) {
    state = state && typeof state === 'object' ? state : {};
    var timestamp = Number(now) || Date.now();
    var intent = classifyUserIntent(text);
    if (intent === 'pause') {
      state.cooldownUntil = timestamp + 72 * 60 * 60 * 1000;
      state.pausedByUser = true;
      state.dueAt = 0;
    } else if (intent === 'resume') {
      state.cooldownUntil = 0;
      state.pausedByUser = false;
      state.ignoredCount = 0;
      state.followUpCount = 0;
      state.dueAt = 0;
    }
    return { intent: intent, state: state };
  }

  function noteUserReply(state) {
    state = state && typeof state === 'object' ? state : {};
    state.ignoredCount = 0;
    state.followUpCount = 0;
    state.dueAt = 0;
    state.anchorMessageAt = 0;
    state.userReceptivityScore = Math.min(1, clamp(state.userReceptivityScore, 0, 1, 0.7) + 0.1);
    return state;
  }

  function noteFollowUpSent(state, round, timestamp, topic) {
    state = state && typeof state === 'object' ? state : {};
    state.followUpCount = Math.max(0, Math.min(3, Number(round) || 0));
    state.lastFollowUpAt = Number(timestamp) || Date.now();
    state.lastFollowUpTopic = normalizeTopic(topic);
    state.ignoredCount = Math.max(0, Number(state.ignoredCount) || 0) + 1;
    state.userReceptivityScore = Math.max(0.1, clamp(state.userReceptivityScore, 0, 1, 0.7) - 0.15);
    state.dueAt = 0;
    return state;
  }

  function buildPrompt(options) {
    options = options || {};
    var round = Math.max(1, Math.min(3, Number(options.round) || 1));
    var name = String(options.name || '角色').slice(0, 40);
    var persona = String(options.persona || '').slice(0, 1200);
    var context = String(options.context || '').slice(0, 3600);
    var relationship = String(options.relationship || '普通朋友').slice(0, 40);
    var tone = round === 1
      ? '第一次：自然、轻松地接续上一轮话题，可以简单确认对方是否方便。'
      : round === 2
        ? '第二次：简短表达先把话题放一放，不埋怨、不施压。'
        : '第三次：自然收尾，给对方留出空间，不再要求回应。';
    return [
      '你正在为角色「' + name + '」生成一条线上聊天追问。',
      '角色设定：' + (persona || '按最近聊天中呈现的性格说话。'),
      '关系阶段：' + relationship + '。关系只影响语气熟悉程度，不使用恋爱暗示、占有欲或情绪施压。',
      '最近对话：',
      context,
      '这是第 ' + round + ' 次追问。' + tone,
      '要求：只写一句自然、简短的微信消息，最多20个汉字；尽量沿用上一轮具体话题，不凭空添加事实或新事件；不要重复上一条消息；不责备、不质问、不制造内疚，不说“你怎么不理我”；第三次只收尾。',
      '如果上下文不适合追问，返回 {"send":false,"text":""}；否则返回 {"send":true,"text":"..."}。只返回 JSON。'
    ].join('\n');
  }

  global.ChatFollowUpPolicy = {
    calculateDelay: calculateDelay,
    isQuietTime: isQuietTime,
    nextAllowedTime: nextAllowedTime,
    normalizeTopic: normalizeTopic,
    classifyUserIntent: classifyUserIntent,
    shouldBlock: shouldBlock,
    applyUserIntent: applyUserIntent,
    noteUserReply: noteUserReply,
    noteFollowUpSent: noteFollowUpSent,
    buildPrompt: buildPrompt,
    baseIntervals: BASE_INTERVAL_MINUTES.slice(),
    quietStartHour: QUIET_START_HOUR,
    quietEndHour: QUIET_END_HOUR
  };
})(typeof window !== 'undefined' ? window : globalThis);
