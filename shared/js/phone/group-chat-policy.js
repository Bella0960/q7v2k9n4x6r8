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

  function normalizeInterestList(member) {
    if (!member) return [];
    var source = member.interests;
    if (source == null) source = member.interestsText;
    var list = Array.isArray(source) ? source : String(source || '').split(/[，,、;；|]/);
    var seen = Object.create(null);
    return list.map(function (item) {
      return String(item == null ? '' : item).trim().toLocaleLowerCase();
    }).filter(function (item) {
      if (!item || item.length < 2 || seen[item]) return false;
      seen[item] = true;
      return true;
    }).slice(0, 12);
  }

  function calculateTopicRelevance(member, text) {
    var interests = normalizeInterestList(member);
    // No configured interests means neutral relevance, not a penalty.
    if (!interests.length) return 45;
    var source = String(text || '').toLocaleLowerCase();
    if (!source) return 45;
    var matches = interests.filter(function (interest) { return source.indexOf(interest) !== -1; });
    return Math.round(matches.length / interests.length * 100);
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
    var relevance = calculateTopicRelevance(member, options.text);
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
      relationship: relation
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
    getRecentSpeakingPenalty: getRecentSpeakingPenalty,
    selectSpeaker: selectSpeaker,
    isDuplicateWithinWindow: isDuplicateWithinWindow,
    getReplyDelayMs: getReplyDelayMs,
    normalizeRelationshipEvent: normalizeRelationshipEvent,
    applyRelationshipEvent: applyRelationshipEvent
  };
})(typeof window !== 'undefined' ? window : globalThis);
