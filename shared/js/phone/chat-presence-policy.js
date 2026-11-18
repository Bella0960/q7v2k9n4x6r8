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
        message.mode === 'date' || message.mode === 'narration' || message.mode === 'offline' ||
        message.voiceMode === 'date' || message.voiceMode === 'narration' || message.voiceMode === 'offline') return false;
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
      // Old rows without memberId may use an obsolete display nickname.
      // Never learn the wrong character's voice from an ambiguous nickname.
      var savedName = String(message.name || '').trim();
      if (!speakerName || savedName !== speakerName) return false;
      var members = Array.isArray(options.groupMembers) ? options.groupMembers : [];
      if (members.length) {
        var matched = members.filter(function (member) {
          return member && (String(member.nickname || '').trim() === savedName ||
            String(member.name || '').trim() === savedName);
        });
        if (matched.length !== 1 || String(matched[0].id) !== speakerId) return false;
      }
      return true;
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


  var EMOTION_CUES = [
    { kind: 'hurt', label: '委屈或难过', words: ['不开心', '不高兴', '难过', '伤心', '委屈', '失落', '心酸', '难受', '受伤', '被忽略', '不被理解'] },
    { kind: 'anger', label: '生气或烦躁', words: ['生气', '火大', '恼火', '烦死', '烦躁', '不爽', '讨厌'] },
    { kind: 'worry', label: '担心或不安', words: ['担心', '害怕', '紧张', '焦虑', '不安', '慌张', '怕'] },
    { kind: 'affection', label: '想念或在意', words: ['想你', '想念', '舍不得', '吃醋', '喜欢你', '在意你'] },
    { kind: 'joy', label: '开心或期待', words: ['开心', '高兴', '幸福', '兴奋', '期待'] },
    { kind: 'embarrassment', label: '害羞或尴尬', words: ['尴尬', '不好意思', '害羞', '难为情'] }
  ];

  function isUsableEmotionMessage(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.silent || message.isError || message.role === 'system_error') return false;
    if (message.type && message.type !== 'text') return false;
    if (message.mode === 'date' || message.mode === 'narration' || message.mode === 'offline' ||
        message.voiceMode === 'date' || message.voiceMode === 'narration' || message.voiceMode === 'offline') return false;
    return message.role === 'user' || message.role === 'sent' ||
      message.role === 'assistant' || message.role === 'received';
  }

  function classifyExplicitEmotion(value) {
    var text = extractHabitText(value).replace(/\s+/g, ' ').trim();
    if (!text) return null;

    var best = null;
    EMOTION_CUES.forEach(function (group) {
      group.words.forEach(function (word) {
        var cueIndex = text.indexOf(word);
        while (cueIndex !== -1) {
          var prefix = text.slice(Math.max(0, cueIndex - 22), cueIndex);
          var anchor = /(?:我|自己|让我|使我)(?:现在|今天|最近|其实|真的|有点|有些|很|特别|太|一直|已经|觉得|感觉)?[^，。！？!?；;\n]{0,14}$/.exec(prefix);
          if (anchor) {
            var bridge = anchor[0];
            var afterCue = text.slice(cueIndex + word.length).split(/[，。！？!?；;\n]/)[0];
            var negated = /(?:不|没|不是|并非|并不|没有|不算|谈不上|不再)(?:太|很|怎么|那么|特别)?\s*$/.test(bridge);
            var questionLike = /(?:是不是|是否|难道|会不会|究竟|到底)$/.test(bridge) ||
              /^(?:吗|么)/.test(afterCue);
            if (!negated && !questionLike) {
              var intensity = /特别|非常|真的|很|太|气死|受不了/.test(bridge) ? 'strong' : 'moderate';
              var candidate = { kind: group.kind, label: group.label, intensity: intensity };
              if (!best || intensity === 'strong') best = candidate;
            }
          }
          cueIndex = text.indexOf(word, cueIndex + word.length);
        }
      });
    });
    return best;
  }

  function findRecentEmotionalSignal(history, options) {
    options = options || {};
    var mode = String(options.mode || 'online').toLowerCase();
    if (mode === 'narration' || mode === 'offline' || mode === 'date' || mode === 'face-to-face') return null;

    var list = Array.isArray(history) ? history : [];
    var maxScan = Math.max(4, Math.min(40, parseInt(options.maxScan, 10) || 24));
    var scanned = 0;

    for (var i = list.length - 1; i >= 0 && scanned < maxScan; i--) {
      var message = list[i];
      if (!isUsableEmotionMessage(message)) continue;
      if (message.role === 'assistant' || message.role === 'received') {
        if (!matchesSpeaker(message, options)) continue;
      }
      scanned += 1;

      var signal = classifyExplicitEmotion(message.text || message.content || '');
      if (!signal) continue;

      var turnsSince = 0;
      var signalIsFromAssistant = message.role === 'assistant' || message.role === 'received';
      for (var j = i + 1; j < list.length; j++) {
        var later = list[j];
        if (!isUsableEmotionMessage(later)) continue;
        if (signalIsFromAssistant) {
          // A role-authored signal stays relevant until the user responds.
          if (later.role === 'user' || later.role === 'sent') turnsSince += 1;
        } else if (later.role === 'assistant' || later.role === 'received') {
          // A user-authored signal ages only when this target role actually replies.
          // In a group, other members' replies must not consume this role's continuity window.
          if (!matchesSpeaker(later, options)) continue;
          turnsSince += 1;
        }
      }
      if (turnsSince > 2) return null;

      signal.speaker = signalIsFromAssistant ? 'self' : 'other';
      signal.turnsSince = turnsSince;
      signal.messageTime = Number(message.time || message.timestamp) || 0;
      return signal;
    }
    return null;
  }

  function buildEmotionContinuityPrompt(history, options) {
    options = options || {};
    var signal = findRecentEmotionalSignal(history, options);
    if (!signal) return '';

    var subject = signal.speaker === 'self' ? '你此前' : '对方此前';
    var timing = signal.turnsSince === 0
      ? '就在当前这条消息中'
      : '距今大约经过了 ' + signal.turnsSince + ' 次对方发言';
    var intensity = signal.intensity === 'strong' ? '较强烈地' : '明确地';

    return [
      '【短期情绪连续性｜动态线索】',
      subject + intensity + '表达过「' + signal.label + '」相关感受，' + timing + '。这只是最近互动中的一条线索，不代表这种情绪此刻仍然存在，也不构成角色的长期性格。',
      '先结合这条线索之后的完整对话，判断是否已经得到回应、解释、道歉、安抚、解决，或被双方自然放下；如果已经缓和或话题已经转开，就正常交流，不要重新翻出旧情绪。',
      '如果它仍未被回应，当前优先具体回应真正重要的部分，不使用套话，也不急着替对方下结论。回应后最多在接下来一到两轮保留轻微余韵，并根据对方实际反应更新；不要固定冷战、惩罚性沉默、反复追问或将情绪永久化。',
      '若无法确定情绪是否仍在，宁可保持自然，不要臆测、夸大或主动制造情绪事件。'
    ].join('\n');
  }


  var LIFE_TIME_CUES = /(?:现在|正在|目前|此刻|还在|在忙|在做|今天|今晚|明天|后天|这周|本周|周末|下周|最近|等会儿|一会儿|待会儿|晚点|之后|回头|过几天|接下来|这两天)/;
  var LIFE_ACTION_CUES = /(?:准备|打算|计划|安排|还得|需要|正在|还在|在忙|在做|约了|答应了|参加|去|回|看|学|练|读|写|听|吃|买|订|交|加班|忙|照顾|排队|预约|做饭|运动|散步|逛|打扫|整理|工作|休息|追剧|玩|完成|处理|收拾|复习|开会|上班|上课|考试|面试|排练|训练|旅行|出差|见面|聚会|赶稿|交稿)/;

  function isConversationTextMessage(message) {
    if (!message || typeof message !== 'object' || message.silent || message.isError) return false;
    if (message.type && message.type !== 'text') return false;
    return message.role === 'user' || message.role === 'sent' ||
      message.role === 'assistant' || message.role === 'received';
  }

  function isLifeInterestSentence(sentence) {
    if (!/(?:我(?:(?:一直|平时|最近|其实|很|特别|比较|挺|最|都)\s*){0,3}(?:喜欢|爱好|热衷于|感兴趣|最喜欢|最爱)|我对.{1,24}感兴趣|我最近迷上)/.test(sentence)) return false;
    return !/(?:喜欢你|爱你|想你|在意你|舍不得|吃醋)/.test(sentence);
  }

  function isLifeActivitySentence(sentence) {
    if (!LIFE_TIME_CUES.test(sentence) || !LIFE_ACTION_CUES.test(sentence)) return false;
    if (/(?:昨天|前天|上周|上个月|去年)/.test(sentence) &&
        !/(?:今天|现在|目前|正在|还在|接下来)/.test(sentence)) return false;
    if (/(?:不要|不打算|不准备|不想|不去|没打算|不用|无需)/.test(sentence)) return false;
    var futureOrOngoing = /(?:正在|目前|现在|此刻|还在|在忙|在做|还得|准备|打算|计划|安排|需要|约了|答应了|明天|后天|这周|本周|周末|下周|等会儿|一会儿|待会儿|晚点|之后|回头|过几天|接下来|这两天|想(?:去|做|看|学|练|读|写|听|吃|买|订|参加|复习|旅行|出差)|要(?:去|做|回|看|学|练|读|写|听|吃|买|订|交|参加|复习|开会|上班|上课|考试|面试|排练|训练|旅行|出差|见面|聚会|赶稿|交稿))/.test(sentence);
    if (!futureOrOngoing && /(?:已经|刚刚|刚才|做完了|完成了|结束了|忙完了|搞定了|回来了|去过|看过|学会了|上完了|做了|去了|看了|读了|写了|吃了|买了)/.test(sentence)) return false;
    return true;
  }

  function extractLifeNoteSentences(value) {
    var source = extractHabitText(value).replace(/\s+/g, ' ').trim();
    if (!source) return [];
    var sentences = (source.match(/[^。！？!?；;\n]+[。！？!?；;\n]?/g) || []).map(function (part) {
      return part.trim();
    }).filter(Boolean);
    var result = [];

    sentences.forEach(function (sentence) {
      if (sentence.length < 7 || sentence.length > 120) return;
      if (/[?？]$/.test(sentence)) return;
      if (!/(?:我|自己)/.test(sentence)) return;
      if (/^(?:你|对方|用户)/.test(sentence)) return;
      if (!isLifeActivitySentence(sentence) && !isLifeInterestSentence(sentence)) return;
      result.push(sentence);
    });
    return result;
  }

  function collectLifeContinuityNotes(history, options) {
    options = options || {};
    var mode = String(options.mode || 'online').toLowerCase();
    if (mode === 'narration' || mode === 'offline' || mode === 'date' || mode === 'face-to-face') return [];

    var list = Array.isArray(history) ? history : [];
    var maxScan = Math.max(12, Math.min(100, parseInt(options.maxScan, 10) || 60));
    var maxNotes = Math.max(1, Math.min(4, parseInt(options.maxNotes, 10) || 3));
    var maxTurns = Math.max(1, Math.min(8, parseInt(options.maxTurns, 10) || 4));
    var speakerId = options.speakerId == null ? '' : String(options.speakerId);
    var speakerName = String(options.speakerName || '').trim();
    var notes = [];
    var turnsSince = 0;
    var scanned = 0;
    var seen = Object.create(null);

    for (var i = list.length - 1; i >= 0 && scanned < maxScan && notes.length < maxNotes; i--) {
      var message = list[i];
      if (!isConversationTextMessage(message)) continue;
      scanned += 1;

      var isAssistant = message.role === 'assistant' || message.role === 'received';
      var belongsToSpeaker = !options.isGroupChat || !isAssistant || matchesSpeaker(message, {
        isGroupChat: true,
        speakerId: speakerId,
        speakerName: speakerName,
        groupMembers: options.groupMembers
      });

      if (!isAssistant) {
        turnsSince += 1;
        if (turnsSince > maxTurns) break;
        continue;
      }
      if (!belongsToSpeaker) {
        turnsSince += 1;
        if (turnsSince > maxTurns) break;
        continue;
      }
      if (!isUsableAssistantMessage(message)) continue;
      if (turnsSince > maxTurns) break;

      var sentences = extractLifeNoteSentences(message.text || message.content || '');
      for (var j = 0; j < sentences.length && notes.length < maxNotes; j++) {
        var sentence = sentences[j];
        var key = sentence.replace(/\s+/g, '');
        if (seen[key]) continue;
        seen[key] = true;
        notes.push({
          text: sentence,
          kind: isLifeInterestSentence(sentence) ? 'interest' : 'activity',
          turnsSince: turnsSince,
          time: Number(message.time || message.timestamp) || 0
        });
      }
    }

    return notes;
  }

  function buildAutonomyPrompt(history, options) {
    options = options || {};
    var mode = String(options.mode || 'online').toLowerCase();
    if (mode === 'narration' || mode === 'offline' || mode === 'date' || mode === 'face-to-face') return '';
    var notes = collectLifeContinuityNotes(history, options);
    var lines = [
      '【角色自主性与生活连续性】',
      '你有自己的注意力、兴趣、习惯和生活节奏；聊天不是每轮都必须围绕用户提问展开。角色档案、世界书、明确的长期记忆和你自己此前说过的话，是生活细节的依据。',
      '先自然回应对方当前真正表达的内容。只有在话题出现空隙、确实想到相关事情，或有合适的分享时，才主动带出一个自己的观察、兴趣、近况或后续安排；不是每轮都要主动发起新话题。',
      '主动分享一次只带出一个重点即可。可以分享一件小事、一个偏好、一个正在关注的话题，或顺着双方共同谈过的事情继续；不要连续抛出多个话题，也不要每次都用问题结尾。',
      '生活安排必须有来源：优先沿用角色设定、世界书和下方自己说过的近期安排。若后续对话显示事情已完成、取消、改期或不再相关，就不要再当作待办；不确定时不要装作记得准确进度。',
      '同一条近况已经在当前对话中说过后，不要连续重复；只有出现新进展、变化或对方问起时再自然续上。',
      '没有已知安排时，不要编造已经发生的日常、现实地点、工作进展、他人邀约或具体时间。可以在符合人设的角色故事中自然形成一个小打算，但要让它成为当前叙事里的新发展，而不是伪称早已发生。',
      '不要声称真的操作了用户设备、发送了现实消息、完成了现实付款或在现实世界执行了动作。不要用“我一直在等你”“你不来我就……”制造压力；对方不接话题时自然放下。'
    ];

    if (notes.length) {
      lines.push('');
      lines.push('【近期由角色本人提过的安排／正在做的事】');
      lines.push('以下是历史表达摘录，不保证现在仍有效。先检查其后的聊天是否已完成、取消或改变；只有仍然相关时才自然延续，不要逐条汇报：');
      notes.forEach(function (note) {
        var age = note.turnsSince === 0 ? '最近刚提到' : '之后约经过 ' + note.turnsSince + ' 次交流';
        var label = note.kind === 'interest' ? '近期兴趣线索' : '近期安排／正在做的事';
        lines.push('·' + label + '：「' + note.text + '」（' + age + '）');
      });
    }

    return lines.join('\n');
  }


  function evaluateProactiveContact(history, options) {
    options = options || {};
    var now = Number(options.now) || Date.now();
    var enabled = options.enabled === true;
    if (!enabled) return { eligible: false, reason: 'disabled' };
    if (options.blocked === true) return { eligible: false, reason: 'blocked' };
    if (options.pageVisible === false) return { eligible: false, reason: 'page-hidden' };

    var hour = options.localHour == null ? new Date(now).getHours() : Number(options.localHour);
    var quietStart = Math.max(0, Math.min(23, Number(options.quietStartHour == null ? 9 : options.quietStartHour)));
    var quietEnd = Math.max(1, Math.min(24, Number(options.quietEndHour == null ? 22 : options.quietEndHour)));
    if (!isFinite(hour) || hour < quietStart || hour >= quietEnd) {
      return { eligible: false, reason: 'quiet-hours' };
    }

    var globalCooldownMs = Math.max(1, Number(options.globalCooldownMs) || 24 * 60 * 60 * 1000);
    var roleCooldownMs = Math.max(globalCooldownMs, Number(options.roleCooldownMs) || globalCooldownMs);
    var minIdleMs = Math.max(1, Number(options.minIdleMs) || 8 * 60 * 60 * 1000);
    var maxInactiveMs = Math.max(minIdleMs, Number(options.maxInactiveMs) || 30 * 24 * 60 * 60 * 1000);
    var globalLastAttemptAt = Number(options.globalLastAttemptAt) || 0;
    var roleLastAttemptAt = Number(options.roleLastAttemptAt) || 0;

    if (globalLastAttemptAt && now - globalLastAttemptAt >= 0 && now - globalLastAttemptAt < globalCooldownMs) {
      return { eligible: false, reason: 'global-cooldown' };
    }
    if (roleLastAttemptAt && now - roleLastAttemptAt >= 0 && now - roleLastAttemptAt < roleCooldownMs) {
      return { eligible: false, reason: 'role-cooldown' };
    }

    var list = Array.isArray(history) ? history : [];
    var meaningful = [];
    for (var i = 0; i < list.length; i++) {
      var message = list[i];
      if (!message || message.silent || message.isError || message.role === 'system_error') continue;
      if (message.type && message.type !== 'text') continue;
      if (message.mode === 'date' || message.mode === 'narration' || message.mode === 'offline' ||
          message.voiceMode === 'date' || message.voiceMode === 'narration' || message.voiceMode === 'offline') continue;
      if (message.role !== 'user' && message.role !== 'sent' &&
          message.role !== 'assistant' && message.role !== 'received') continue;
      var text = String(message.text || message.content || '').trim();
      if (text.length < 2) continue;
      meaningful.push({
        role: message.role === 'user' || message.role === 'sent' ? 'user' : 'assistant',
        text: text,
        time: Number(message.time || message.timestamp) || 0,
        proactive: message.proactiveContact === true
      });
    }

    if (meaningful.length < 4) return { eligible: false, reason: 'insufficient-history' };
    var last = meaningful[meaningful.length - 1];
    if (last.role !== 'assistant') return { eligible: false, reason: 'awaiting-reply' };
    if (/[?？]\s*$/.test(last.text)) return { eligible: false, reason: 'awaiting-answer' };

    var userCount = 0;
    var assistantCount = 0;
    var lastUser = null;
    meaningful.forEach(function (item) {
      if (item.role === 'user') {
        userCount += 1;
        lastUser = item;
      } else {
        assistantCount += 1;
      }
    });
    if (userCount < 2 || assistantCount < 2 || !lastUser) {
      return { eligible: false, reason: 'insufficient-exchange' };
    }
    if (last.proactive && (!lastUser || lastUser.time <= last.time)) {
      return { eligible: false, reason: 'awaiting-user-after-proactive-message' };
    }
    if (!last.time || !lastUser.time) return { eligible: false, reason: 'missing-timestamps' };

    var idleMs = now - last.time;
    var userIdleMs = now - lastUser.time;
    if (idleMs < minIdleMs) return { eligible: false, reason: 'not-idle-long-enough', idleMs: idleMs };
    if (userIdleMs > maxInactiveMs) return { eligible: false, reason: 'inactive-too-long', idleMs: idleMs };

    return {
      eligible: true,
      reason: 'eligible',
      idleMs: idleMs,
      lastMessageAt: last.time,
      lastUserMessageAt: lastUser.time,
      historyCount: meaningful.length
    };
  }

  function buildProactiveContactPrompt(contact, history, options) {
    options = options || {};
    var name = String(contact && contact.name || '角色').trim() || '角色';
    var persona = String(contact && (contact.persona || contact.prompt) || '').trim().slice(0, 5000);
    var lines = [
      '【MAOMAO 主动联系时机判断】',
      '你是「' + name + '」，现在不是在回复一条新消息，而是在考虑是否值得主动发一条简短的线上聊天消息。',
      '只有当你确实想到一件与自己有关、符合人设、且有上下文依据的事情时才发送；可以是对近期安排的小更新、一个自然想到的兴趣话题，或与之前谈话有关的补充。',
      '如果没有值得分享的内容、上次对话已经自然结束、对方可能正在忙，或你只是为了刷存在感，就选择不发送。宁可跳过，也不要凑消息。',
      '禁止责备、催促、制造愧疚或要求对方立即回复；不要说「为什么不理我」「你怎么不找我」等施压内容。不要伪称正在现实地点、已完成现实行动或已操作用户设备。',
      '一次最多发一条自然短消息，不连续追发，不强行制造问题，不输出动作旁白、隐藏机器标记、红包/转账/通话/图片指令或 Markdown。',
      '若确实适合发送，只输出 JSON：{"send":true,"text":"一条自然的消息"}；若不适合，输出 {"send":false,"text":""}。不要在 JSON 外添加任何文字。'
    ];
    if (persona) lines.push('', '【角色设定】', persona);
    var voicePrompt = buildPrompt({ mode: 'online', history: history, maxSamples: 2, maxSampleChars: 72 });
    if (voicePrompt) lines.push('', voicePrompt);
    var habitPrompt = buildVoiceHabitPrompt(options.voiceProfile);
    if (habitPrompt) lines.push('', habitPrompt);
    var autonomyPrompt = buildAutonomyPrompt(history, { mode: 'online', maxScan: 60, maxNotes: 2, maxTurns: 4 });
    if (autonomyPrompt) lines.push('', autonomyPrompt);
    if (options.localTime) lines.push('', '【当前本地时间】' + String(options.localTime) + '。只能将其用于理解时间语境，不得声称在未知地点。');
    return lines.join('\n');
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
      '只根据明确表达或连续上下文中的可靠线索判断情绪，不要把普通语气、玩笑或一次简短不悦放大成事件；判断之前先确认事情是否已经被回应或自然放下。',
      '如果情绪确实尚未解决，只在接下来少数几轮保留轻微、可变化的余韵；用户主动转场、事情已经说开或缺乏把握时，不要强行延续。',
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
  NS.classifyExplicitEmotion = classifyExplicitEmotion;
  NS.findRecentEmotionalSignal = findRecentEmotionalSignal;
  NS.buildEmotionContinuityPrompt = buildEmotionContinuityPrompt;
  NS.extractLifeNoteSentences = extractLifeNoteSentences;
  NS.collectLifeContinuityNotes = collectLifeContinuityNotes;
  NS.buildAutonomyPrompt = buildAutonomyPrompt;
  NS.evaluateProactiveContact = evaluateProactiveContact;
  NS.buildProactiveContactPrompt = buildProactiveContactPrompt;
  NS.getBubbleDelayMs = getBubbleDelayMs;
  NS.buildPrompt = buildPrompt;
})(window);
