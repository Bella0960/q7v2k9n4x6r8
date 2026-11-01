/* MAOMAO Chat Presence Policy
 * Phase 1: concrete conversational behavior and role-specific voice continuity.
 * Pure prompt composition only: no DOM, storage, timers, or API calls.
 */
(function (global) {
  'use strict';

  var NS = global.ChatPresencePolicy = {};

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

  function isUsableAssistantMessage(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.isError || message.role === 'system_error' || message.silent) return false;
    if (message.type && message.type !== 'text') return false;
    return message.role === 'assistant' || message.role === 'received';
  }

  function collectVoiceSamples(history, options) {
    options = options || {};
    var list = Array.isArray(history) ? history : [];
    var maxSamples = Math.max(0, Math.min(4, parseInt(options.maxSamples, 10) || 2));
    if (!maxSamples) return [];

    var isGroupChat = options.isGroupChat === true;
    var speakerId = options.speakerId == null ? '' : String(options.speakerId);
    var speakerName = String(options.speakerName || '').trim();
    var samples = [];

    for (var i = list.length - 1; i >= 0 && samples.length < maxSamples; i--) {
      var message = list[i];
      if (!isUsableAssistantMessage(message)) continue;

      if (isGroupChat && speakerId) {
        var messageId = message.memberId == null ? '' : String(message.memberId);
        var messageName = String(message.name || '').trim();
        if (messageId) {
          if (messageId !== speakerId) continue;
        } else if (!speakerName || messageName !== speakerName) {
          continue;
        }
      } else if (isGroupChat && speakerName && message.name && String(message.name) !== speakerName) {
        continue;
      }

      var sample = cleanSampleText(message.text || message.content || '', options.maxSampleChars);
      if (!sample || samples.indexOf(sample) !== -1) continue;
      samples.push(sample);
    }

    samples.reverse();
    return samples;
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
  NS.buildPrompt = buildPrompt;
})(window);
