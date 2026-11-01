/* MAOMAO Role Public Timeline
 * A privacy-aware shared layer built only from role-authored public/friends Moments.
 * Private one-to-one messages and private/group-only transcripts are never read here.
 * Pure functions: callers provide the already-loaded Moments array.
 */
(function (global) {
  'use strict';

  var NS = global.RolePublicTimeline = {};
  var DEFAULT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

  function normalizeTimestamp(value) {
    if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) {
      var parsed = Date.parse(value);
      return isFinite(parsed) ? parsed : 0;
    }
    var time = Number(value) || 0;
    if (time > 0 && time < 1000000000000) time *= 1000;
    return time > 0 && isFinite(time) ? time : 0;
  }

  function cleanPublicText(value, maxChars) {
    var text = String(value == null ? '' : value)
      .replace(/<(think|reasoning|analysis)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
      .replace(/<narratage\b[^>]*>[\s\S]*?(?:<\/narratage\s*>|$)/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\[(?:记住|心声|红包|转账|图片|亲属卡|亲密付|调整亲属卡|撤销亲属卡|群关系互动|群关系变化|群私聊|群动作|群投票|群接龙)[^\]]*\]/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return '';
    var limit = Math.max(20, Math.min(180, Number(maxChars) || 120));
    var chars = Array.from(text);
    return chars.length > limit ? chars.slice(0, limit).join('').replace(/\s+$/, '') + '…' : text;
  }

  function describeAge(timestamp, now) {
    var elapsed = Math.max(0, now - timestamp);
    if (elapsed < 60 * 60 * 1000) {
      var minutes = Math.max(1, Math.floor(elapsed / 60000));
      return minutes < 5 ? '刚刚' : minutes + '分钟前';
    }
    if (elapsed < 24 * 60 * 60 * 1000) {
      return Math.max(1, Math.floor(elapsed / (60 * 60 * 1000))) + '小时前';
    }
    return Math.max(1, Math.floor(elapsed / (24 * 60 * 60 * 1000))) + '天前';
  }

  function collectRolePublicMoments(roleId, moments, options) {
    options = options && typeof options === 'object' ? options : {};
    var id = String(roleId == null ? '' : roleId).trim();
    if (!id || id === 'me') return [];

    var now = normalizeTimestamp(options.now) || Date.now();
    var maxAge = Number(options.maxAgeMs);
    if (!isFinite(maxAge) || maxAge <= 0) maxAge = DEFAULT_MAX_AGE_MS;
    var maxEntries = Math.max(1, Math.min(8, parseInt(options.maxEntries, 10) || 3));
    var maxChars = Math.max(20, Math.min(180, parseInt(options.maxChars, 10) || 120));
    var source = Array.isArray(moments) ? moments : [];
    var entries = [];
    var seen = Object.create(null);

    source.forEach(function (post, index) {
      if (!post || typeof post !== 'object') return;
      if (String(post.authorId == null ? '' : post.authorId) !== id) return;

      // Only content visible to friends or the public is a cross-scene source.
      var visibility = String(post.visibility || 'public').toLowerCase();
      if (visibility !== 'public' && visibility !== 'friends') return;

      var time = normalizeTimestamp(post.time || post.timestamp || post.createdAt);
      if (!time || time > now + 5 * 60 * 1000 || now - time > maxAge) return;

      var content = cleanPublicText(post.content, maxChars);
      if (Array.from(content).length < 2 || seen[content]) return;
      seen[content] = true;
      entries.push({
        roleId: id,
        text: content,
        time: time,
        ageLabel: describeAge(time, now),
        _index: index
      });
    });

    entries.sort(function (a, b) {
      return b.time - a.time || b._index - a._index;
    });
    return entries.slice(0, maxEntries).map(function (entry) {
      return {
        roleId: entry.roleId,
        text: entry.text,
        time: entry.time,
        ageLabel: entry.ageLabel
      };
    });
  }

  function buildRolePrompt(roleId, moments, options) {
    var entries = collectRolePublicMoments(roleId, moments, options);
    if (!entries.length) return '';
    return [
      '【角色跨场景公开近况】',
      '以下只来自角色本人发布、公开或好友可见的动态，是聊天、群聊和社交动态创作可以共用的公开线索；不包含一对一私聊、私密动态或其他成员的发言。',
      '请结合发布时间判断是否仍然有效。过去的活动不要说成正在发生；不要机械复述，也不要为了提及而强行引入。',
      entries.map(function (entry) {
        return '· ' + entry.ageLabel + '：「' + entry.text + '」';
      }).join('\n')
    ].join('\n');
  }

  function buildGroupPrompt(members, moments, options) {
    options = options && typeof options === 'object' ? options : {};
    var list = Array.isArray(members) ? members : [];
    var maxMembers = Math.max(1, Math.min(12, parseInt(options.maxMembers, 10) || 8));
    var lines = [];
    list.slice(0, maxMembers).forEach(function (member) {
      if (!member || member.id == null) return;
      var entries = collectRolePublicMoments(member.id, moments, {
        now: options.now,
        maxAgeMs: options.maxAgeMs,
        maxEntries: 1,
        maxChars: options.maxChars || 100
      });
      if (!entries.length) return;
      var name = String(member.nickname || member.name || '群成员').trim() || '群成员';
      lines.push('· ' + name + '（' + entries[0].ageLabel + '）：「' + entries[0].text + '」');
    });
    if (!lines.length) return '';
    return [
      '【群成员共享的公开动态】',
      '以下仅是群成员本人发布、公开或好友可见的动态。它们可以成为自然聊天话题，但不要假设每个人都看过，也不要把过去的活动说成正在发生；不包含任何私聊或群内私密内容。',
      lines.join('\n')
    ].join('\n');
  }

  NS.collectRolePublicMoments = collectRolePublicMoments;
  NS.buildRolePrompt = buildRolePrompt;
  NS.buildGroupPrompt = buildGroupPrompt;
})(typeof window !== 'undefined' ? window : globalThis);
