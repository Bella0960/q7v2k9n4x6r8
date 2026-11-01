/* MAOMAO Group Chat Policy
 * Pure selection and timing rules for the existing local-first group chat.
 * No DOM, storage, network access, or API calls.
 */
(function (global) {
  'use strict';

  function asId(value) {
    return value == null ? '' : String(value);
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

  function relationshipFor(relationships, idA, idB) {
    if (!relationships || typeof relationships !== 'object') return null;
    var key = JSON.stringify([asId(idA), asId(idB)].sort());
    var value = relationships[key];
    return value && typeof value === 'object' ? value : null;
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

  function selectSpeaker(options) {
    options = options || {};
    var available = Array.isArray(options.availableMembers) ? options.availableMembers.filter(function (member) {
      return member && member.id != null;
    }) : [];
    if (!available.length) return null;

    var candidates = available.slice();
    var previousId = asId(options.previousSpeakerId);
    if (options.isFollowup && previousId && candidates.length > 1) {
      var different = candidates.filter(function (member) { return asId(member.id) !== previousId; });
      if (different.length) candidates = different;
    }

    // When several people are mentioned, successive turns pick the next
    // available name rather than letting the first mentioned member repeat.
    var queue = Array.isArray(options.mentionQueueIds)
      ? options.mentionQueueIds.map(asId).filter(Boolean)
      : extractMentionedMemberIds(options.text, options.members || available);
    var mentioned = queue.find(function (id) {
      return candidates.some(function (member) { return asId(member.id) === id; });
    });
    if (mentioned) {
      var namedMember = candidates.find(function (member) { return asId(member.id) === mentioned; });
      return { member: namedMember, isMentioned: true, mentionId: mentioned };
    }

    var random = typeof options.random === 'function' ? options.random : Math.random;
    var weights = candidates.map(function (member) {
      var relation = previousId
        ? relationshipFor(options.relationships, previousId, member.id)
        : null;
      var familiarity = relation ? Math.max(0, Math.min(100, parseInt(relation.familiarity, 10) || 0)) : 0;
      var interactions = relation ? Math.max(0, parseInt(relation.interactions, 10) || 0) : 0;
      // Familiar pairs are more likely to pick up one another's thread,
      // without turning the choice into a deterministic lock.
      return 1 + familiarity / 25 + Math.min(1.5, Math.log(interactions + 1) * 0.35);
    });
    return { member: chooseWeighted(candidates, weights, random), isMentioned: false, mentionId: '' };
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

  global.GroupChatPolicy = {
    extractMentionedMemberIds: extractMentionedMemberIds,
    selectSpeaker: selectSpeaker,
    isDuplicateWithinWindow: isDuplicateWithinWindow,
    getReplyDelayMs: getReplyDelayMs
  };
})(typeof window !== 'undefined' ? window : globalThis);
