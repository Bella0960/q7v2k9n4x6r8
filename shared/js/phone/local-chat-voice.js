/* Device speech for role replies. Only local system voices are eligible. */
(function (global) {
  'use strict';

  var presets = {
    bright: { pitch: 1.2, rate: 1.06 },
    soft: { pitch: 1.04, rate: 0.92 },
    deep: { pitch: 0.78, rate: 0.94 }
  };
  var samples = {
    zh: '今天过得怎么样？有空的话，跟我聊一会儿吧。',
    en: 'How was your day? Let’s talk for a little while.',
    ja: '今日はどうだった？よかったら、少し話そうよ。',
    ko: '오늘 하루 어땠어? 괜찮으면 우리 잠깐 얘기하자.'
  };
  var active = null;
  var cooldownMs = 90 * 1000;

  function normalizePreset(value) {
    return Object.prototype.hasOwnProperty.call(presets, value) ? value : 'soft';
  }

  function normalizeLanguage(value) {
    return Object.prototype.hasOwnProperty.call(samples, value) ? value : 'zh';
  }

  function preferencesKey(roleId) {
    return 'chat_local_voice_' + String(roleId);
  }

  function readPreferences(roleId) {
    try {
      var value = JSON.parse(global.localStorage.getItem(preferencesKey(roleId)) || '{}') || {};
      return { preset: normalizePreset(value.preset), auto: value.auto === true };
    } catch (e) {
      return { preset: 'soft', auto: false };
    }
  }

  function savePreferences(roleId, value) {
    if (!roleId) return false;
    try {
      var key = preferencesKey(roleId);
      var encoded = JSON.stringify({ preset: normalizePreset(value.preset), auto: value.auto === true });
      global.localStorage.setItem(key, encoded);
      return global.localStorage.getItem(key) === encoded;
    } catch (e) {
      return false;
    }
  }

  function findVoice(language) {
    try {
      var synth = global.speechSynthesis;
      if (!synth || typeof global.SpeechSynthesisUtterance !== 'function') return null;
      var target = normalizeLanguage(language);
      var voices = synth.getVoices().filter(function (voice) {
        return voice.localService === true && String(voice.lang || '').toLowerCase().split(/[-_]/)[0] === target;
      });
      if (target === 'zh') {
        var mandarin = voices.find(function (voice) { return /^zh[-_](?:cn|hans)(?:[-_]|$)/i.test(voice.lang); });
        if (mandarin) return mandarin;
      }
      return voices.find(function (voice) { return voice.default; }) || voices[0] || null;
    } catch (e) {
      return null;
    }
  }

  function stop() {
    if (!active) return;
    var current = active;
    active = null;
    try { global.speechSynthesis.cancel(); } catch (e) {}
    current.onFinish(false);
  }

  function speak(text, preset, language, onFinish) {
    var voice = findVoice(language);
    if (!voice || !String(text || '').trim()) return false;
    stop();
    var config = presets[normalizePreset(preset)];
    var finish = typeof onFinish === 'function' ? onFinish : function () {};
    var utterance;
    try {
      utterance = new global.SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.pitch = config.pitch;
      utterance.rate = config.rate;
      active = { utterance: utterance, onFinish: finish };
      function done(failed) {
        if (!active || active.utterance !== utterance) return;
        active = null;
        finish(failed);
      }
      utterance.onend = function () { done(false); };
      utterance.onerror = function () { done(true); };
      global.speechSynthesis.speak(utterance);
      return true;
    } catch (e) {
      active = null;
      return false;
    }
  }

  function maybeApplyToReply(messages, history, roleId, language, now) {
    var preferences = readPreferences(roleId);
    if (!preferences.auto || !findVoice(language)) return false;
    var lastVoice = history.some(function (item) {
      return item && item.role === 'assistant' && item.localSpeech &&
        now - Number(item.time) < cooldownMs;
    });
    if (lastVoice || Math.random() >= 0.22) return false;
    // Pick one short, complete bubble. Keep its text and translation in the original fields.
    var message = messages.slice().reverse().find(function (item) {
      var text = String(item.text || '').trim();
      return text.length >= 2 && text.length <= 120 && !/[\n<>\[\]]/.test(text);
    });
    if (!message) return false;
    message.type = 'voice';
    message.localSpeech = { preset: preferences.preset, language: normalizeLanguage(language) };
    return true;
  }

  global.LocalChatVoice = {
    readPreferences: readPreferences,
    savePreferences: savePreferences,
    findVoice: findVoice,
    sample: function (language) { return samples[normalizeLanguage(language)]; },
    speak: speak,
    stop: stop,
    maybeApplyToReply: maybeApplyToReply
  };

  findVoice('zh'); // Prime asynchronously populated system voice lists.
})(window);
