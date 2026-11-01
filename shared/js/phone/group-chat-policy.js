/* MAOMAO Group Chat Policy
 * Pure selection and timing rules for the existing local-first group chat.
 * No DOM, storage, network access, or API calls.
 */
(function (global) {
  'use strict';

  function asId(value) {
    return value == null ? '' : String(value);
  }

  function clamp(value, min, max, fallback) {
    var number = Number(value);
    if (!isFinite(number)) number = fallback;
    return Math.max(min, Math.min(max, number));
  }

  function memberAliases(member) {
    if (!member) return [];
    return [member.nickname, member.name, member.id]
      .map(function (value) { return String(value == null ? '' : value).trim(); })
      .filter(Boolean);
  }

  // Supports explicit @nickname, @character-name, or @member-id references.
  // The returned IDs preserve the order in which members were mentioned.
  function extractMentionedMemberIds(text, members) {
    var source = String(text || '');
    var list = Array.isArray(members) ? members : [];
    var result = [];
    var seen = Object.create(null);
    var pattern = /@([^\s,，。！？!?；;：:、()[\]{}<>]+)/g;
    var match;
    while ((match = pattern.exec(source))) {
      var token = String(match[1] || '').trim().replace(/[，。！？!?；;：:、]+$/, '');
      if (!token) continue;
      var target = null;
      for (var i = 0; i < list.length; i++) {
        var member = list[i];
        var aliases = memberAliases(member);
        if (aliases.some(function (alias) { return alias.toLocaleLowerCase() === token.toLocaleLowerCase(); })) {
          target = member;
          break;
        }
      }
      if (!target || target.id == null) continue;
      var id = asId(target.id);
      if (!seen[id]) {
        seen[id] = true;
        result.push(id);
      }
    }
    return result;
  }

  function relationshipKey(idA, idB) {
    return JSON.stringify([asId(idA), asId(idB)].sort());
  }

  // Direction means "fromId's attitude toward toId". Legacy symmetric records
  // are read as a compatibility fallback until the settings page migrates them.
  function getDirectionalRelationship(relationships, fromId, toId) {
    if (asId(fromId) === asId(toId) || !relationships || typeof relationships !== 'object') return null;
    var record = relationships[relationshipKey(fromId, toId)];
    if (!record || typeof record !== 'object') return null;
    var directions = record.directions && typeof record.directions === 'object' ? record.directions : null;
    var directional = directions && directions[asId(fromId)];
    if (directional && typeof directional === 'object') {
      return directional;
    }
    var legacyEvents = Array.isArray(record.memories) ? record.memories : [];
    var sharedEvents = legacyEvents.filter(function (item) {
      if (!item || typeof item !== 'object') return false;
      return (!item.fromId || asId(item.fromId) === asId(fromId)) &&
        (!item.toId || asId(item.toId) === asId(toId));
    }).map(function (item) {
      return { summary: String(item.summary || ''), time: Number(item.time) || 0 };
    });
    return {
      fromId: asId(fromId),
      toId: asId(toId),
      intimacy: clamp(record.familiarity != null ? record.familiarity : record.intimacy, 0, 100, 0),
      trust: clamp(record.trust, 0, 100, 50),
      type: String(record.type || '未设定'),
      moodToward: String(record.moodToward || 'neutral'),
      note: String(record.note || ''),
      sharedEvents: sharedEvents
    };
  }

  function getPendingMentionIds(history, members, availableMembers, fallbackText) {
    var messages = Array.isArray(history) ? history : [];
    var memberList = Array.isArray(members) ? members : [];
    var available = Array.isArray(availableMembers) ? availableMembers : [];
    var lastUserIndex = -1;
    var sourceText = String(fallbackText || '');
    for (var i = messages.length - 1; i >= 0; i--) {
      var message = messages[i];
      if (message && (message.role === 'user' || message.role === 'sent')) {
        lastUserIndex = i;
        sourceText = String(message.text || message.content || '');
        break;
      }
    }
    var mentionedIds = extractMentionedMemberIds(sourceText, memberList);
    if (!mentionedIds.length) return [];

    var spoken = Object.create(null);
    for (var j = lastUserIndex + 1; j < messages.length; j++) {
      var reply = messages[j];
      if (!reply || reply.type || (reply.role !== 'assistant' && reply.role !== 'received')) continue;
      var speakerId = asId(reply.memberId);
      if (!speakerId && reply.name) {
        var matched = memberList.find(function (member) {
          return memberAliases(member).some(function (alias) {
            return alias.toLocaleLowerCase() === String(reply.name).trim().toLocaleLowerCase();
          });
        });
        if (matched) speakerId = asId(matched.id);
      }
      if (speakerId) spoken[speakerId] = true;
    }

    var availableIds = Object.create(null);
    available.forEach(function (member) {
      if (member && member.id != null) availableIds[asId(member.id)] = true;
    });
    return mentionedIds.filter(function (id) {
      return !!availableIds[id] && !spoken[id];
    });
  }

  // Small local synonym groups keep topic matching explainable and API-free.
  // Tags remain user-editable; this dictionary only bridges common wording variants.
  var TOPIC_SYNONYMS = {
    programming: ['编程', '代码', '写代码', '敲代码', '写程序', '开发', '软件开发', '程序设计', '前端', '后端', '调试'],
    basketball: ['篮球', '打球', 'NBA', '投篮', '三分球', '球场'],
    coffee: ['咖啡', '拿铁', '美式', '手冲', '咖啡豆', '咖啡馆'],
    music: ['音乐', '听歌', '歌曲', '乐队', '演唱会', '作曲', '乐器'],
    film: ['电影', '影片', '观影', '电影院', '电影节'],
    mystery: ['悬疑', '推理', '侦探', '谜题', '案件', '破案'],
    travel: ['旅行', '旅游', '出游', '旅途', '行程', '旅行攻略'],
    fitness: ['运动', '健身', '跑步', '游泳', '锻炼', '训练'],
    reading: ['阅读', '看书', '读书', '小说', '书籍'],
    photography: ['摄影', '拍照', '相机', '镜头', '修图'],
    food: ['美食', '做饭', '烹饪', '菜谱', '餐厅', '探店'],
    drawing: ['绘画', '画画', '插画', '素描', '绘图'],
    games: ['游戏', '打游戏', '开黑', '电竞', '主机游戏'],
    anime: ['动漫', '动画', '漫画', '番剧', '追番'],
    pets: ['宠物', '猫咪', '小猫', '狗狗', '小狗', '养宠'],
    technology: ['科技', '数码', '手机', '电脑', '硬件', '人工智能'],
    history: ['历史', '朝代', '古代', '文物', '考古'],
    science: ['科学', '实验', '物理', '化学', '生物', '天文'],
    study: ['学习', '考试', '作业', '复习', '上课', '论文', '课程'],
    emotionalSupport: ['情绪支持', '安慰', '倾听', '陪伴', '心理支持', '心理学', '关心', '共情', '治愈', '情绪', '压力', '疲惫', '难过', '委屈', '焦虑', '心情不好', '不开心', '失落', '心烦', '好累'],
    planning: ['规划', '计划', '安排', '组织', '行程管理', '时间管理']
  };

  function normalizeTagList(member, fields) {
    if (!member) return [];
    var source = null;
    for (var i = 0; i < fields.length; i++) {
      var candidate = member[fields[i]];
      if (candidate == null || candidate === '') continue;
      var candidateList = Array.isArray(candidate) ? candidate : String(candidate).split(/[，,、;；|]/);
      var cleaned = candidateList.map(function (item) {
        return String(item == null ? '' : item).trim().toLocaleLowerCase();
      }).filter(Boolean);
      if (cleaned.length) {
        source = cleaned;
        break;
      }
    }
    if (!source) return [];
    var seen = Object.create(null);
    return source.filter(function (item) {
      if (item.length < 2 || seen[item]) return false;
      seen[item] = true;
      return true;
    }).slice(0, 12);
  }

  function resolveTopicAliases(tag) {
    var normalized = String(tag || '').trim().toLocaleLowerCase();
    if (!normalized) return [];
    var groups = Object.keys(TOPIC_SYNONYMS);
    for (var i = 0; i < groups.length; i++) {
      var aliases = TOPIC_SYNONYMS[groups[i]].map(function (value) { return value.toLocaleLowerCase(); });
      if (aliases.some(function (alias) {
        return alias === normalized ||
          (normalized.length >= 2 && (normalized.indexOf(alias) !== -1 || alias.indexOf(normalized) !== -1));
      })) return aliases;
    }
    return [normalized];
  }

  function tagMatchesTopic(tag, messageText) {
    var normalized = String(tag || '').trim().toLocaleLowerCase();
    if (!normalized || !messageText) return false;
    if (messageText.indexOf(normalized) !== -1) return true;
    var aliases = resolveTopicAliases(normalized);
    return aliases.some(function (alias) {
      return alias.length >= 2 && messageText.indexOf(alias) !== -1;
    });
  }

  function analyzeMessageContext(text) {
    var source = String(text || '').replace(/[\r\n]+/g, ' ').trim();
    if (/难过|伤心|委屈|心情不好|不开心|焦虑|压力大|好累|累死|疲惫|烦死|崩溃|害怕|担心|失落|心烦|想哭/.test(source)) {
      return {
        type: 'emotional',
        label: '情绪分享',
        guidance: '先自然地接住对方的情绪，认真倾听或给予具体关心，不急着说教，也不要把普通疲惫过度解读。'
      };
    }
    if (/吵架|争吵|生气|误会|冲突|背叛|欺骗|不信任|不同意|反对|讨厌|伤害/.test(source)) {
      return {
        type: 'conflict',
        label: '分歧或冲突',
        guidance: '结合角色自己的立场和彼此关系回应，允许不同意见，不默认所有人站在同一边，也不要刻意升级矛盾。'
      };
    }
    if (/一起|要不要|来不来|约一下|陪我去|出来玩|吃饭吗|打球吗|玩不玩|有空吗/.test(source)) {
      return {
        type: 'invitation',
        label: '邀请或活动',
        guidance: '优先考虑角色的真实兴趣和关系，可以自然接受、婉拒或追问细节，不要让所有成员机械排队表态。'
      };
    }
    if (/计划|打算|准备|安排|行程|规划|下周|周末|明天|方案/.test(source)) {
      return {
        type: 'planning',
        label: '计划讨论',
        guidance: '优先考虑相关专长、背景和共同经历，回应具体安排或提出可执行建议，不必无端扩展话题。'
      };
    }
    if (/怎么|如何|怎么办|为什么|能不能|可不可以|有没有办法|求助|帮我|请教|教教我|解释一下|[?？]/.test(source)) {
      return {
        type: 'help',
        label: '提问或求助',
        guidance: '优先考虑真正具备相关专长的成员，先回应问题核心；不确定的内容要说明，不要为了显得专业而编造。'
      };
    }
    return {
      type: 'casual',
      label: '日常闲聊',
      guidance: '像真实群聊一样自然接话，可以分享、追问或轻松回应，不必每条消息都给建议或制造戏剧性。'
    };
  }

  function calculateTopicRelevance(member, text, context) {
    var source = String(text || '').toLocaleLowerCase();
    if (!source) return 45;
    context = context && typeof context === 'object' ? context : analyzeMessageContext(text);

    var categories = [
      { fields: ['interestTags', 'interests', 'interestsText'], weight: 1 },
      { fields: ['expertiseTags'], weight: 1.35 },
      { fields: ['backgroundTags'], weight: 0.85 }
    ];
    if (context.type === 'emotional') {
      categories[0].weight = 1.1;
      categories[2].weight = 1.2;
    } else if (context.type === 'conflict') {
      categories[2].weight = 1.2;
    } else if (context.type === 'invitation') {
      categories[0].weight = 1.4;
    } else if (context.type === 'planning') {
      categories[1].weight = 1.55;
      categories[2].weight = 1.05;
    } else if (context.type === 'help') {
      categories[1].weight = 1.8;
    }

    var weightedHits = 0;
    var configuredWeight = 0;
    categories.forEach(function (category) {
      var tags = normalizeTagList(member, category.fields);
      if (!tags.length) return;
      configuredWeight += category.weight;
      var hits = tags.filter(function (tag) { return tagMatchesTopic(tag, source); }).length;
      weightedHits += category.weight * (hits / tags.length);
    });
    // A member with no profile tags stays neutral instead of being excluded.
    if (!configuredWeight) return 45;
    return Math.max(0, Math.min(100, Math.round(weightedHits / configuredWeight * 100)));
  }

  function getRecentSpeakingPenalty(memberId, recentSpeakerIds) {
    var id = asId(memberId);
    var recent = Array.isArray(recentSpeakerIds) ? recentSpeakerIds : [];
    var penalty = 0;
    var seen = false;
    for (var i = 0; i < recent.length && i < 5; i++) {
      if (asId(recent[i]) !== id) continue;
      // The most recent speaker receives the strongest cooldown penalty.
      penalty += i === 0 ? 8 : (i === 1 ? 4 : (i === 2 ? 2 : 1));
      seen = true;
    }
    return seen ? Math.min(15, penalty) : 0;
  }

  function chooseWeighted(candidates, weights, random) {
    if (!candidates.length) return null;
    var total = weights.reduce(function (sum, weight) {
      return sum + Math.max(0, Number(weight) || 0);
    }, 0);
    if (!total) return candidates[0];
    var roll = Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * total;
    for (var i = 0; i < candidates.length; i++) {
      roll -= Math.max(0, Number(weights[i]) || 0);
      if (roll < 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  function scoreCandidate(member, options, relationshipTargetId) {
    var relation = relationshipTargetId
      ? getDirectionalRelationship(options.relationships, member.id, relationshipTargetId)
      : null;
    var intimacy = relation
      ? clamp(relation.intimacy != null ? relation.intimacy : relation.familiarity, 0, 100, 0)
      : 0;
    var context = options.context && typeof options.context === 'object' ? options.context : analyzeMessageContext(options.text);
    var relevance = calculateTopicRelevance(member, options.text, context);
    var talkativeness = clamp(member.talkativeness, 0, 1, 0.5);
    var cooldown = getRecentSpeakingPenalty(member.id, options.recentSpeakerIds);
    var score = intimacy * 0.4 + relevance * 0.25 + talkativeness * 20 + (15 - cooldown);
    var threshold;
    if (member.replyThreshold != null && member.replyThreshold !== '') {
      threshold = clamp(member.replyThreshold, 30, 85, 55);
    } else if (talkativeness >= 0.7) {
      threshold = 45;
    } else if (talkativeness <= 0.3) {
      threshold = 75;
    } else {
      threshold = 55;
    }
    return {
      score: Math.round(score * 10) / 10,
      threshold: threshold,
      intimacy: intimacy,
      topicRelevance: relevance,
      talkativeness: talkativeness,
      cooldownPenalty: cooldown,
      relationship: relation,
      contextType: context.type
    };
  }

  function selectSpeaker(options) {
    options = options || {};
    var available = Array.isArray(options.availableMembers) ? options.availableMembers.filter(function (member) {
      return member && member.id != null;
    }) : [];
    if (!available.length) return null;

    // Explicit @mentions always win, including when that member spoke last.
    var mentionQueue = Array.isArray(options.mentionQueueIds)
      ? options.mentionQueueIds.map(asId).filter(Boolean)
      : extractMentionedMemberIds(options.text, options.members || available);
    var mention = mentionQueue.find(function (id) {
      return available.some(function (member) { return asId(member.id) === id; });
    }) || '';
    if (mention) {
      var namedMember = available.find(function (member) { return asId(member.id) === mention; });
      if (namedMember) {
        return {
          member: namedMember,
          isMentioned: true,
          mentionId: mention,
          score: 100,
          threshold: 0,
          fallback: false
        };
      }
    }

    var candidates = available.slice();
    var previousId = asId(options.previousSpeakerId);
    if (options.isFollowup && previousId && candidates.length > 1) {
      var different = candidates.filter(function (member) { return asId(member.id) !== previousId; });
      if (different.length) candidates = different;
    }

    var relationshipTargetId = options.relationshipTargetId != null ? asId(options.relationshipTargetId) : previousId;
    var scored = candidates.map(function (member) {
      return { member: member, details: scoreCandidate(member, options, relationshipTargetId) };
    });
    var eligible = scored.filter(function (entry) {
      return entry.details.score >= entry.details.threshold;
    });
    var random = typeof options.random === 'function' ? options.random : Math.random;
    var selected;
    var fallback = false;

    if (eligible.length) {
      selected = chooseWeighted(
        eligible,
        eligible.map(function (entry) { return Math.max(1, entry.details.score); }),
        random
      );
    } else {
      // Keep the group alive without forcing every quiet member to speak.
      fallback = true;
      selected = scored.slice().sort(function (a, b) {
        return b.details.talkativeness - a.details.talkativeness ||
          b.details.score - a.details.score;
      })[0];
    }

    return selected ? {
      member: selected.member,
      isMentioned: false,
      mentionId: '',
      score: selected.details.score,
      threshold: selected.details.threshold,
      topicRelevance: selected.details.topicRelevance,
      cooldownPenalty: selected.details.cooldownPenalty,
      relationship: selected.details.relationship,
      contextType: selected.details.contextType,
      fallback: fallback
    } : null;
  }

  function isDuplicateWithinWindow(previousText, previousAt, nextText, now, windowMs) {
    var previous = String(previousText == null ? '' : previousText).replace(/\s+/g, ' ').trim();
    var next = String(nextText == null ? '' : nextText).replace(/\s+/g, ' ').trim();
    var timestamp = Number(now) || Date.now();
    var lastAt = Number(previousAt) || 0;
    var limit = Number(windowMs);
    if (!isFinite(limit) || limit < 0) limit = 3000;
    return !!previous && !!next && previous === next && timestamp >= lastAt && timestamp - lastAt < limit;
  }

  function getReplyDelayMs(random) {
    var source = typeof random === 'function' ? random : Math.random;
    var value = Number(source());
    if (!isFinite(value)) value = 0;
    value = Math.max(0, Math.min(0.999999999, value));
    return 1000 + Math.floor(value * 4001);
  }

  // AI-suggested relationship changes are bounded by event severity.
  // Ordinary chat should not produce a marker at all.
  function normalizeRelationshipEvent(event) {
    event = event && typeof event === 'object' ? event : {};
    var level = String(event.level || '').toLowerCase();
    var caps = { micro: 2, moderate: 5, major: 10, turning: 18 };
    if (!Object.prototype.hasOwnProperty.call(caps, level)) return null;
    var summary = String(event.summary || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (summary.length < 3) return null;
    function delta(value) {
      var n = Number(value);
      if (!isFinite(n)) return 0;
      n = Math.round(n);
      return Math.max(-caps[level], Math.min(caps[level], n));
    }
    var intimacyDelta = delta(event.intimacyDelta);
    var trustDelta = delta(event.trustDelta);
    if (!intimacyDelta && !trustDelta) return null;
    return {
      level: level,
      intimacyDelta: intimacyDelta,
      trustDelta: trustDelta,
      summary: summary
    };
  }

  // Negative trust changes accumulate repair debt. Positive trust changes
  // gradually pay it down, so reconciliation is possible but slower.
  function applyRelationshipEvent(direction, event, now) {
    if (!direction || typeof direction !== 'object') return null;
    var normalized = normalizeRelationshipEvent(event);
    if (!normalized) return null;

    var timestamp = Number(now);
    if (!isFinite(timestamp) || timestamp <= 0) timestamp = Date.now();
    var currentIntimacy = clamp(direction.intimacy, 0, 100, 0);
    var currentTrust = clamp(direction.trust, 0, 100, 50);
    var currentDebt = clamp(direction.trustRecoveryDebt, 0, 60, 0);

    var nextIntimacy = clamp(currentIntimacy + normalized.intimacyDelta, 0, 100, currentIntimacy);
    var appliedIntimacyDelta = Math.round(nextIntimacy - currentIntimacy);
    var appliedTrustDelta = 0;
    var recoveryFactor = 1;

    if (normalized.trustDelta < 0) {
      appliedTrustDelta = -Math.min(currentTrust, Math.abs(normalized.trustDelta));
      currentDebt = clamp(currentDebt + Math.abs(appliedTrustDelta) * 1.5, 0, 60, currentDebt);
    } else if (normalized.trustDelta > 0) {
      recoveryFactor = Math.max(0.2, 1 - currentDebt / 80);
      appliedTrustDelta = Math.min(100 - currentTrust, Math.round(normalized.trustDelta * recoveryFactor));
      currentDebt = clamp(currentDebt - appliedTrustDelta * 0.5, 0, 60, currentDebt);
    }

    direction.intimacy = nextIntimacy;
    direction.trust = clamp(currentTrust + appliedTrustDelta, 0, 100, currentTrust);
    direction.trustRecoveryDebt = currentDebt;
    direction.lastInteractionAt = timestamp;

    if (!Array.isArray(direction.eventHistory)) direction.eventHistory = [];
    var record = {
      time: timestamp,
      level: normalized.level,
      intimacyDelta: appliedIntimacyDelta,
      trustDelta: appliedTrustDelta,
      proposedIntimacyDelta: normalized.intimacyDelta,
      proposedTrustDelta: normalized.trustDelta,
      trustRecoveryFactor: Math.round(recoveryFactor * 100) / 100,
      summary: normalized.summary
    };
    direction.eventHistory.push(record);
    direction.eventHistory = direction.eventHistory.filter(function (item) {
      return item && String(item.summary || '').trim();
    }).slice(-20);

    return record;
  }

  global.GroupChatPolicy = {
    extractMentionedMemberIds: extractMentionedMemberIds,
    getPendingMentionIds: getPendingMentionIds,
    getDirectionalRelationship: getDirectionalRelationship,
    calculateTopicRelevance: calculateTopicRelevance,
    analyzeMessageContext: analyzeMessageContext,
    getRecentSpeakingPenalty: getRecentSpeakingPenalty,
    selectSpeaker: selectSpeaker,
    isDuplicateWithinWindow: isDuplicateWithinWindow,
    getReplyDelayMs: getReplyDelayMs,
    normalizeRelationshipEvent: normalizeRelationshipEvent,
    applyRelationshipEvent: applyRelationshipEvent
  };
})(typeof window !== 'undefined' ? window : globalThis);
