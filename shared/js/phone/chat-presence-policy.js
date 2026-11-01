/* MAOMAO Chat Presence Policy
 * Phase 1: concrete conversational behavior, role-specific voice habits and bubble pacing.
 * Pure calculations only. The chat page owns role-scoped localStorage persistence.
 */
(function (global) {
  'use strict';

  var NS = global.ChatPresencePolicy = {};
  var PARTICLES = ['嗯', '啊', '呢', '吧', '哦', '呀', '哎', '诶', '欸', '嘛', '啦', '呗', '啧', '唉', '哈', '嘿'];

  function cleanSampleText(value, maxChars) {
    var text = String(value == null ? '' : value);
    text = text
      .replace(/<(think|reasoning|analysis)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
      .replace(/<narratage\b[^>]*>[\s\S]*?(?:<\/narratage\s*>|$)/gi, ' ')
      .replace(/\[中译[:：][^\]]{0,800}\]/g, ' ')
      .replace(/\[(?:记住|心声|红包|转账|图片|亲属卡|亲密付|调整亲属卡|撤销亲属卡|群关系互动|群关系变化|群私聊|群动作|群投票|群接龙)[^\]]*\]/g, ' ')
      .replace(/\[发起语音通话\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) return '';
    var limit = Math.max(12, Number(maxChars) || 72);
    var chars = Array.from(text);
    if (chars.length > limit) {
      text = chars.slice(0, limit).join('').replace(/\s+$/, '') + '…';
    }
    return text;
  }

  function extractHabitText(value) {
    return String(value == null ? '' : value)
      .replace(/<(think|reasoning|analysis)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
      .replace(/<narratage\b[^>]*>[\s\S]*?(?:<\/narratage\s*>|$)/gi, ' ')
      .replace(/<narratage\b[^>]*>/gi, ' ')
      .replace(/<\/narratage\s*>/gi, ' ')
      .replace(/\[中译[:：][^\]]{0,800}\]/g, ' ')
      .replace(/\[(?:记住|心声|红包|转账|图片|亲属卡|亲密付|调整亲属卡|撤销亲属卡|群关系互动|群关系变化|群私聊|群动作|群投票|群接龙)[^\]]*\]/g, ' ')
      .replace(/\[发起语音通话\]/g, ' ')
      .replace(/\r\n?/g, '\n')
      .trim();
  }

  function isUsableAssistantMessage(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.isError || message.role === 'system_error' || message.silent ||
        message.mode === 'date' || message.mode === 'narration' || message.mode === 'offline') return false;
    if (message.type && message.type !== 'text') return false;
    return message.role === 'assistant' || message.role === 'received';
  }

  function matchesSpeaker(message, options) {
    if (options.isGroupChat !== true) return true;
    var speakerId = options.speakerId == null ? '' : String(options.speakerId);
    var speakerName = String(options.speakerName || '').trim();
    if (speakerId) {
      var messageId = message.memberId == null ? '' : String(message.memberId);
      if (messageId) return messageId === speakerId;
      return !!speakerName && String(message.name || '').trim() === speakerName;
    }
    return !!speakerName && String(message.name || '').trim() === speakerName;
  }

  function collectHabitMessages(history, options) {
    options = options || {};
    var list = Array.isArray(history) ? history : [];
    var requested = options.maxMessages == null ? 80 : parseInt(options.maxMessages, 10);
    if (!isFinite(requested)) requested = 80;
    var limit = Math.max(10, Math.min(160, requested));
    var selected = [];

    for (var i = list.length - 1; i >= 0 && selected.length < limit; i--) {
      var message = list[i];
      if (!isUsableAssistantMessage(message) || !matchesSpeaker(message, options)) continue;
      var source = extractHabitText(message.text || message.content || '');
      var compactLength = Array.from(source.replace(/\s/g, '')).length;
      if (!source || compactLength < 2) continue;
      selected.push({
        text: source.slice(0, 800),
        identity: String(message.mid || '') + '|' +
          String(message.time || message.timestamp || '') + '|' +
          String(message.memberId == null ? '' : message.memberId)
      });
    }

    selected.reverse();
    return selected;
  }

  function buildSourceSignature(items) {
    var source = items.map(function (item) {
      return item.identity + '\u001f' + item.text;
    }).join('\u001e');
    var hash = 2166136261;
    for (var i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36) + ':' + source.length + ':' + items.length;
  }

  function normalizeCachedProfile(profile, signature) {
    if (!profile || typeof profile !== 'object' ||
        profile.schemaVersion !== 1 ||
        profile.sourceSignature !== signature) return null;
    var count = Number(profile.sampleCount);
    if (!isFinite(count) || count < 4 || count > 160) return null;

    function rate(value) {
      var n = Number(value);
      return isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
    }

    var particles = Array.isArray(profile.particles) ? profile.particles : [];
    particles = particles.filter(function (item) {
      return item && PARTICLES.indexOf(String(item.word || '')) !== -1;
    }).slice(0, 4).map(function (item) {
      return { word: String(item.word), count: Math.max(0, Math.min(999, Number(item.count) || 0)) };
    });

    return {
      schemaVersion: 1,
      sourceSignature: signature,
      sampleCount: Math.floor(count),
      avgChars: Math.max(0, Math.min(800, Number(profile.avgChars) || 0)),
      avgSentenceChars: Math.max(0, Math.min(300, Number(profile.avgSentenceChars) || 0)),
      shortReplyRate: rate(profile.shortReplyRate),
      questionRate: rate(profile.questionRate),
      exclamationRate: rate(profile.exclamationRate),
      emojiRate: rate(profile.emojiRate),
      splitRate: rate(profile.splitRate),
      ellipsisRate: rate(profile.ellipsisRate),
      particles: particles,
      generatedAt: Number(profile.generatedAt) || 0
    };
  }

  function buildVoiceHabitProfile(history, options, previousProfile) {
    var items = collectHabitMessages(history, options);
    if (items.length < 4) return null;

    var signature = buildSourceSignature(items);
    var cached = normalizeCachedProfile(previousProfile, signature);
    if (cached) return cached;

    var totalChars = 0;
    var totalSentences = 0;
    var totalSentenceChars = 0;
    var shortReplies = 0;
    var questions = 0;
    var exclamations = 0;
    var emojiReplies = 0;
    var splitReplies = 0;
    var ellipsisReplies = 0;
    var particleCounts = {};

    var emojiPattern;
    try {
      emojiPattern = new RegExp('[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]', 'u');
    } catch (e) {
      emojiPattern = /[\uD83C-\uDBFF][\uDC00-\uDFFF]|[♥♡★☆♪]/;
    }

    items.forEach(function (item) {
      var text = item.text;
      var compact = text.replace(/\s/g, '');
      var chars = Array.from(compact).length;
      totalChars += chars;
      if (chars <= 22) shortReplies += 1;
      if (/[?？]["'”’）)\]}]*$/.test(text)) questions += 1;
      if (/[!！]["'”’）)\]}]*$/.test(text)) exclamations += 1;
      if (emojiPattern.test(text)) emojiReplies += 1;
      if (/\n\s*\n/.test(text)) splitReplies += 1;
      if (/(?:…|\.{2,}|。{2,})/.test(text)) ellipsisReplies += 1;

      var sentences = text.split(/[。！？!?；;\n]+/).map(function (part) {
        return part.replace(/\s/g, '');
      }).filter(Boolean);
      if (!sentences.length) sentences = [compact];
      totalSentences += sentences.length;
      sentences.forEach(function (sentence) {
        totalSentenceChars += Array.from(sentence).length;
      });

      PARTICLES.forEach(function (particle) {
        var matches = text.match(new RegExp(particle, 'g'));
        if (matches && matches.length) {
          particleCounts[particle] = (particleCounts[particle] || 0) + matches.length;
        }
      });
    });

    var rankedParticles = Object.keys(particleCounts).map(function (word) {
      return { word: word, count: particleCounts[word] };
    }).filter(function (item) {
      return item.count >= 2;
    }).sort(function (a, b) {
      return b.count - a.count || PARTICLES.indexOf(a.word) - PARTICLES.indexOf(b.word);
    }).slice(0, 4);

    var count = items.length;
    return {
      schemaVersion: 1,
      sourceSignature: signature,
      sampleCount: count,
      avgChars: Math.round(totalChars / count),
      avgSentenceChars: Math.round(totalSentenceChars / Math.max(1, totalSentences)),
      shortReplyRate: Number((shortReplies / count).toFixed(2)),
      questionRate: Number((questions / count).toFixed(2)),
      exclamationRate: Number((exclamations / count).toFixed(2)),
      emojiRate: Number((emojiReplies / count).toFixed(2)),
      splitRate: Number((splitReplies / count).toFixed(2)),
      ellipsisRate: Number((ellipsisReplies / count).toFixed(2)),
      particles: rankedParticles,
      generatedAt: Date.now()
    };
  }

  function buildVoiceHabitPrompt(profile) {
    profile = normalizeCachedProfile(profile, profile && profile.sourceSignature);
    if (!profile) return '';

    var lines = [
      '【角色长期表达习惯档案】',
      '以下倾向由当前角色近期 ' + profile.sampleCount + ' 条实际文字回复归纳，仅用于保持表达连续性，不是硬性模板；角色人设与当前语境始终优先。'
    ];

    if (profile.avgChars <= 22) lines.push('· 常见回复偏短，通常简洁地表达一个重点。');
    else if (profile.avgChars <= 48) lines.push('· 常见回复长度适中，通常先说重点，再视情况补充。');
    else lines.push('· 常见回复相对完整，通常会自然补足必要细节。');

    if (profile.avgSentenceChars > 0 && profile.avgSentenceChars <= 15) {
      lines.push('· 句子通常较短，节奏偏口语。');
    } else if (profile.avgSentenceChars >= 32) {
      lines.push('· 句子有时会稍长，适合连贯表达，不必刻意切碎。');
    }

    if (profile.questionRate >= 0.42) lines.push('· 近期较常用问句接话，但不要为了延续对话而每次追问。');
    else if (profile.questionRate <= 0.12) lines.push('· 近期较少用问句收尾，可以自然陈述，不必每轮反问。');

    if (profile.splitRate >= 0.32) lines.push('· 有时会把两个自然表达节点分开发成多条消息。');
    else if (profile.splitRate <= 0.08) lines.push('· 多数时候倾向一条消息说完，不必刻意拆成多个气泡。');

    if (profile.emojiRate >= 0.32) lines.push('· 近期偶尔会使用表情符号，但应按具体语境使用。');
    else if (profile.emojiRate <= 0.05) lines.push('· 近期很少使用表情符号，不需要为了显得亲切而添加。');

    if (profile.ellipsisRate >= 0.28) lines.push('· 偶尔使用省略号或停顿表达语气，不要每句话都加。');

    if (profile.particles.length) {
      lines.push('· 较常出现的语气词：' + profile.particles.map(function (item) {
        return '“' + item.word + '”';
      }).join('、') + '；只在自然时使用，不要刻意堆叠。');
    }

    lines.push('不要复制旧回复的句子，也不要为了匹配统计结果而改变当前情绪、立场或角色性格。');
    return lines.join('\n');
  }

  function collectVoiceSamples(history, options) {
    options = options || {};
    var list = Array.isArray(history) ? history : [];
    var requestedSamples = options.maxSamples == null ? 2 : parseInt(options.maxSamples, 10);
    if (!isFinite(requestedSamples)) requestedSamples = 2;
    var maxSamples = Math.max(0, Math.min(4, requestedSamples));
    if (!maxSamples) return [];

    var samples = [];
    for (var i = list.length - 1; i >= 0 && samples.length < maxSamples; i--) {
      var message = list[i];
      if (!isUsableAssistantMessage(message) || !matchesSpeaker(message, options)) continue;
      var sample = cleanSampleText(message.text || message.content || '', options.maxSampleChars);
      if (!sample || samples.indexOf(sample) !== -1) continue;
      samples.push(sample);
    }
    samples.reverse();
    return samples;
  }

  function getBubbleDelayMs(previousText) {
    var chars = Array.from(String(previousText == null ? '' : previousText).trim()).length;
    return Math.max(520, Math.min(920, 440 + chars * 16));
  }

  function buildPrompt(options) {
    options = options && typeof options === 'object' ? options : {};
    var mode = String(options.mode || 'online').toLowerCase();
    if (mode === 'narration' || mode === 'offline' || mode === 'date' || mode === 'face-to-face') return '';

    var samples = collectVoiceSamples(options.history, options);
    var lines = [
      '【本轮对话行为】',
      '角色档案、既有关系和已发生的经历是表达依据；本规则只帮助你把它们表现得自然，不得覆盖角色原有性格。',
      '先抓住对方这条消息里最具体、最值得回应的一点。对方提出问题时先直接回答；分享日常时回应具体细节，不要只给通用感想。',
      '根据语境选择一两种自然反应：回答、表达真实感受、追问一个关键点，或分享与话题有关的自身细节。不必每轮把这些动作全部做完。',
      '关心应当具体且符合人设，不套用统一安慰话术；可以有自己的偏好和判断，也可以自然地不同意，但不要为了制造冲突而刻意冒犯。',
      '不要每条消息都以提问收尾，也不要每次都安慰、总结、夸奖或主动延展话题。允许简短回应、停顿和自然换题。',
      '',
      '【消息节奏】',
      '默认简短，能用一两句说清就不扩写。确实有两个自然的表达节点时，可用一个空行分成两条独立消息，界面会将它们显示为不同气泡。',
      '不固定消息条数、不设统一字数配额，也不要为了拆气泡把完整的一句话硬切开。每条拆出的消息都应像角色真的会单独发出的一条聊天。',
      '口头禅、标点和表情符号沿用角色自己的习惯，不要统一套用某一组语气词。',
      '',
      '【情绪连续性】',
      '结合最近几轮真实对话判断情绪是否已经被回应、解释或自然缓和。若冲突、失望、担心或脆弱时刻尚未过去，可在后续约两到三轮保留适度余韵，再随互动自然变化。',
      '情绪余韵表现为语气、主动程度或回应方式的细微变化，不等于固定冷战、惩罚性沉默、追问或突然改变核心性格。用户主动转场或事情已经说开时，不要强行延续。',
      '短暂情绪属于当前互动状态，不要把它直接变成永久性格，也不要仅凭一次情绪反应写入长期记忆。',
      '',
      '【生活细节与边界】',
      '可以自然提及角色设定、世界书、记忆或近期聊天中确实存在的生活细节；不要为了显得真实而编造已发生的共同经历、实时设备信息或现实中已经替对方完成的动作。',
      '如果要表达照顾或行动，只能写成当前角色扮演场景中合理的表达，不要声称自己真的接触了用户的设备或现实环境。'
    ];

    if (samples.length) {
      lines.push('');
      lines.push('【角色过往语言参考】');
      lines.push('以下仅用于保持角色自己的措辞、句长和语气，不是本轮要复述的内容，也不能把其中的旧话题当成当前事实：');
      samples.forEach(function (sample) {
        lines.push('·「' + sample + '」');
      });
    }

    return lines.join('\n');
  }

  NS.collectVoiceSamples = collectVoiceSamples;
  NS.buildVoiceHabitProfile = buildVoiceHabitProfile;
  NS.buildVoiceHabitPrompt = buildVoiceHabitPrompt;
  NS.getBubbleDelayMs = getBubbleDelayMs;
  NS.buildPrompt = buildPrompt;
})(window);
