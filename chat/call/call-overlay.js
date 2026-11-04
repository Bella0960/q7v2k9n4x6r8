/* MAOMAO call overlay. Reuses the existing chat send pipeline and chat-history contract. */
(function (global) {
  'use strict';

  if (global.MAOMAOCallExperience) return;

  var activeSession = null;

  function safeImageSource(value) {
    var source = String(value || '').trim();
    if (!source || /^\s*(?:javascript|vbscript):/i.test(source)) return '';
    return source;
  }

  function readProfile() {
    try {
      var raw = global.localStorage.getItem('myProfile');
      return raw ? JSON.parse(raw) || {} : {};
    } catch (error) {
      return {};
    }
  }

  function readHistory() {
    try {
      return typeof loadMessages === 'function' ? loadMessages() : [];
    } catch (error) {
      return [];
    }
  }

  function formatTime(totalSeconds) {
    var seconds = Math.max(0, Number(totalSeconds) || 0);
    var minutes = Math.floor(seconds / 60);
    var rest = seconds % 60;
    return (minutes < 10 ? '0' : '') + minutes + ':' + (rest < 10 ? '0' : '') + rest;
  }

  function messageText(message) {
    if (!message) return '';
    var text = typeof message.text === 'string' ? message.text : (typeof message.content === 'string' ? message.content : '');
    if (text.trim()) return text.trim();
    if (message.type === 'image') return '发送了一张图片';
    if (message.type === 'voice') return '发送了一条语音消息';
    if (message.type === 'sticker') return '发送了一个表情';
    if (message.type === 'location') return '分享了一个位置';
    return '';
  }

  function createAvatar(target, source, name) {
    target.replaceChildren();
    var safeSource = safeImageSource(source);
    if (safeSource) {
      var image = document.createElement('img');
      image.src = safeSource;
      image.alt = '';
      image.loading = 'eager';
      image.referrerPolicy = 'no-referrer';
      target.appendChild(image);
      return;
    }
    target.textContent = Array.from(String(name || '聊'))[0] || '聊';
  }

  function start(mode, character) {
    var type = mode === 'video' ? 'video' : 'voice';
    if (!character || !character.id) return false;

    if (activeSession) {
      activeSession.open();
      return true;
    }

    var host = document.querySelector('.phone-mockup') || document.body;
    var fixedLayer = host === document.body;
    var profile = readProfile();
    var displayName = String(character.name || '联系人');
    var roleAvatar = character.avatar || character.avatarUrl || '';
    var myName = String(profile.nickname || '我');
    var myAvatar = profile.avatar || '';
    var historyStart = readHistory().length;
    var connected = false;
    var finished = false;
    var sending = false;
    var hiddenSelfView = false;
    var flippedSelfView = false;
    var startedAt = Date.now();
    var connectedAt = 0;
    var duration = 0;
    var connectTimer = null;
    var tickTimer = null;
    var callType = type;

    var layer = document.createElement('section');
    layer.className = 'maomao-call-layer' + (fixedLayer ? ' is-fixed' : '') + (type === 'video' ? ' is-video' : '');
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-label', type === 'video' ? '视频通话' : '语音通话');
    layer.innerHTML = [
      '<header class="maomao-call-topbar">',
        '<button class="maomao-call-icon-button" type="button" data-call-action="minimize" aria-label="收起通话">',
          '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
        '</button>',
        '<div class="maomao-call-heading">',
          '<span class="maomao-call-kicker">MAOMAO / CALL</span>',
          '<strong class="maomao-call-title" data-call-title>语音通话</strong>',
        '</div>',
        '<span class="maomao-call-timer" data-call-timer>00:00</span>',
      '</header>',
      '<section class="maomao-call-stage">',
        '<div class="maomao-call-voice-view">',
          '<div class="maomao-call-avatar-wrap">',
            '<span class="maomao-call-ripple"></span><span class="maomao-call-ripple r2"></span>',
            '<div class="maomao-call-avatar" data-role-avatar></div>',
          '</div>',
          '<div class="maomao-call-voice-name" data-role-name></div>',
          '<div class="maomao-call-state" data-call-state>正在连接…</div>',
          '<div class="maomao-call-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>',
        '</div>',
        '<div class="maomao-call-video-view">',
          '<div class="maomao-call-video-image" data-role-video></div>',
          '<span class="maomao-call-video-label">VIDEO CALL</span>',
          '<span class="maomao-call-video-caption" data-video-caption></span>',
          '<div class="maomao-call-self-pip" data-self-pip>',
            '<div class="maomao-call-self-avatar" data-self-avatar></div>',
            '<span class="maomao-call-self-label">我</span>',
          '</div>',
        '</div>',
      '</section>',
      '<section class="maomao-call-conversation">',
        '<div class="maomao-call-conversation-head">',
          '<strong class="maomao-call-conversation-title">通话文字</strong>',
          '<span class="maomao-call-conversation-note">同步保存到当前聊天</span>',
        '</div>',
        '<div class="maomao-call-transcript" data-call-transcript role="log" aria-live="polite">',
          '<div class="maomao-call-empty">连线后，直接在这里打字。<br>你和 TA 的消息会同步进入原聊天记录。</div>',
        '</div>',
      '</section>',
      '<form class="maomao-call-composer" data-call-form>',
        '<textarea class="maomao-call-input" data-call-input rows="1" maxlength="2000" placeholder="正在接通…" disabled></textarea>',
        '<button class="maomao-call-send" type="submit" data-call-send aria-label="发送消息" disabled>',
          '<svg viewBox="0 0 24 24"><path d="M4 12 20 4l-5 16-3-7-8-1Z"/><path d="m12 13 8-9"/></svg>',
        '</button>',
      '</form>',
      '<footer class="maomao-call-actions">',
        '<button class="maomao-call-action" type="button" data-call-action="switch-mode">',
          '<span class="maomao-call-action-icon"><svg viewBox="0 0 24 24"><rect x="2" y="5" width="14" height="14" rx="2"/><path d="m16 10 6-4v12l-6-4"/></svg></span>',
          '<span data-switch-label>切换视频</span>',
        '</button>',
        '<button class="maomao-call-action maomao-call-video-only" type="button" data-call-action="self-view">',
          '<span class="maomao-call-action-icon"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8M8 13h5"/></svg></span>',
          '<span data-self-label>关闭小窗</span>',
        '</button>',
        '<button class="maomao-call-action" type="button" data-call-action="minimize">',
          '<span class="maomao-call-action-icon"><svg viewBox="0 0 24 24"><path d="M4 12h16"/></svg></span>',
          '<span>收起</span>',
        '</button>',
        '<button class="maomao-call-action is-end" type="button" data-call-action="end">',
          '<span class="maomao-call-action-icon"><svg viewBox="0 0 24 24"><path d="M4 12h16"/><path d="m7 8-3 4 3 4M17 8l3 4-3 4"/></svg></span>',
          '<span>结束</span>',
        '</button>',
      '</footer>'
    ].join('');

    var mini = document.createElement('div');
    mini.className = 'maomao-call-mini' + (fixedLayer ? ' is-fixed' : '');
    mini.hidden = true;
    mini.innerHTML = [
      '<div class="maomao-call-mini-copy">',
        '<strong class="maomao-call-mini-name" data-mini-name></strong>',
        '<span class="maomao-call-mini-meta" data-mini-meta>通话中 · 00:00</span>',
      '</div>',
      '<button type="button" data-call-action="open">返回通话</button>',
      '<button type="button" data-call-action="end" aria-label="结束通话">',
        '<svg viewBox="0 0 24 24"><path d="M4 12h16"/><path d="m7 8-3 4 3 4M17 8l3 4-3 4"/></svg>',
      '</button>'
    ].join('');

    host.appendChild(layer);
    host.appendChild(mini);

    var titleEl = layer.querySelector('[data-call-title]');
    var timerEl = layer.querySelector('[data-call-timer]');
    var stateEl = layer.querySelector('[data-call-state]');
    var roleNameEl = layer.querySelector('[data-role-name]');
    var videoCaptionEl = layer.querySelector('[data-video-caption]');
    var transcriptEl = layer.querySelector('[data-call-transcript]');
    var form = layer.querySelector('[data-call-form]');
    var input = layer.querySelector('[data-call-input]');
    var sendButton = layer.querySelector('[data-call-send]');
    var switchLabel = layer.querySelector('[data-switch-label]');
    var selfPip = layer.querySelector('[data-self-pip]');
    var selfLabel = layer.querySelector('[data-self-label]');
    var miniName = mini.querySelector('[data-mini-name]');
    var miniMeta = mini.querySelector('[data-mini-meta]');

    roleNameEl.textContent = displayName;
    videoCaptionEl.textContent = displayName;
    miniName.textContent = displayName;
    createAvatar(layer.querySelector('[data-role-avatar]'), roleAvatar, displayName);
    createAvatar(layer.querySelector('[data-role-video]'), roleAvatar, displayName);
    createAvatar(layer.querySelector('[data-self-avatar]'), myAvatar, myName);

    function currentMessages() {
      return readHistory().slice(historyStart).filter(function (item) {
        return item && !item.silent && item.type !== 'call';
      });
    }

    function renderTranscript() {
      var messages = currentMessages().slice(-36);
      transcriptEl.replaceChildren();
      if (!messages.length) {
        var empty = document.createElement('div');
        empty.className = 'maomao-call-empty';
        empty.textContent = '你们的通话文字会显示在这里。';
        transcriptEl.appendChild(empty);
        return;
      }
      messages.forEach(function (message) {
        var text = messageText(message);
        if (!text && !message.isError) return;
        var mine = message.role === 'user' || message.role === 'sent';
        var row = document.createElement('div');
        row.className = 'maomao-call-message' + (mine ? ' is-mine' : '') + (message.isError ? ' is-error' : '');
        var meta = document.createElement('span');
        meta.className = 'maomao-call-message-meta';
        meta.textContent = message.isError ? '系统提示' : (mine ? '我' : displayName);
        var bubble = document.createElement('div');
        bubble.className = 'maomao-call-message-bubble';
        bubble.textContent = text || '暂时无法显示这条消息';
        row.appendChild(meta);
        row.appendChild(bubble);
        transcriptEl.appendChild(row);
      });
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }

    function updateMode(nextType) {
      callType = nextType === 'video' ? 'video' : 'voice';
      layer.classList.toggle('is-video', callType === 'video');
      titleEl.textContent = callType === 'video' ? '视频通话' : '语音通话';
      switchLabel.textContent = callType === 'video' ? '切换语音' : '切换视频';
      layer.setAttribute('aria-label', titleEl.textContent);
      if (connected) stateEl.textContent = '已连接 · 文字交流';
    }

    function updateTimer() {
      if (connectedAt) duration = Math.max(0, Math.floor((Date.now() - connectedAt) / 1000));
      var shown = formatTime(duration);
      timerEl.textContent = shown;
      miniMeta.textContent = (connected ? '通话中 · ' : '正在连接 · ') + shown;
    }

    function open() {
      if (finished) return;
      layer.hidden = false;
      mini.hidden = true;
      if (connected) {
        try { input.focus({ preventScroll: true }); } catch (error) { input.focus(); }
      }
    }

    function minimize() {
      if (finished) return;
      layer.hidden = true;
      mini.hidden = false;
    }

    function addCallRecord() {
      var visibleMessages = currentMessages();
      var record = {
        role: 'user',
        type: 'call',
        time: Date.now(),
        call: {
          type: callType,
          connected: !!connected,
          duration: connected ? duration : 0,
          messageCount: visibleMessages.length,
          text: connected
            ? '通话时长 ' + formatTime(duration) + ' · 文字交流 ' + visibleMessages.length + ' 条'
            : '已取消'
        }
      };
      try {
        var history = readHistory();
        history.push(record);
        if (typeof saveMessages === 'function') saveMessages(history);
        if (typeof appendMessageToDOM === 'function') appendMessageToDOM(record);
        else global.dispatchEvent(new CustomEvent('maomao:followup-message', {
          detail: { contactId: String(character.id) }
        }));
        var chatList = global.document.getElementById('chat-messages');
        if (chatList) chatList.scrollTop = chatList.scrollHeight;
      } catch (error) {
        if (global.console && typeof global.console.warn === 'function') {
          global.console.warn('[MAOMAO call] call record was not saved', error);
        }
      }
    }

    function finish() {
      if (finished) return;
      finished = true;
      if (connectTimer) global.clearTimeout(connectTimer);
      if (tickTimer) global.clearInterval(tickTimer);
      duration = connected ? Math.max(0, Math.floor((Date.now() - connectedAt) / 1000)) : 0;
      addCallRecord();
      layer.remove();
      mini.remove();
      global.document.removeEventListener('keydown', onKeydown);
      activeSession = null;
    }

    function onKeydown(event) {
      if (event.key === 'Escape' && !layer.hidden) minimize();
    }

    layer.addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('[data-call-action]') : null;
      if (!button || !layer.contains(button)) return;
      var action = button.getAttribute('data-call-action');
      if (action === 'minimize') minimize();
      else if (action === 'end') finish();
      else if (action === 'switch-mode') updateMode(callType === 'video' ? 'voice' : 'video');
      else if (action === 'self-view') {
        hiddenSelfView = !hiddenSelfView;
        selfPip.classList.toggle('is-hidden', hiddenSelfView);
        selfLabel.textContent = hiddenSelfView ? '打开小窗' : '关闭小窗';
      }
    });

    mini.addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('[data-call-action]') : null;
      if (!button) return;
      var action = button.getAttribute('data-call-action');
      if (action === 'open') open();
      else if (action === 'end') finish();
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var text = input.value.trim();
      if (!connected || !text || sending || finished) return;
      if (typeof global.sendMsg !== 'function') {
        stateEl.textContent = '聊天服务暂不可用';
        return;
      }
      sending = true;
      sendButton.disabled = true;
      input.disabled = true;
      stateEl.textContent = '对方正在回复…';
      var beforeSendCount = readHistory().length;
      var chatDraftInput = global.document.getElementById('chat-input');
      var savedChatDraft = chatDraftInput ? chatDraftInput.value : '';
      var request;
      try {
        request = global.sendMsg({ text: text });
      } catch (error) {
        request = Promise.reject(error);
      }
      input.value = '';
      input.style.height = 'auto';
      var pending = request && typeof request.then === 'function' ? request : Promise.resolve();
      pending.then(function () {
        if (chatDraftInput && savedChatDraft && !chatDraftInput.value) {
          chatDraftInput.value = savedChatDraft;
          chatDraftInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (finished) return;
        var nextHistory = readHistory().slice(beforeSendCount);
        var accepted = nextHistory.some(function (item) {
          return item && (item.role === 'user' || item.role === 'sent') && String(item.text || '').trim() === text;
        });
        var hasError = nextHistory.some(function (item) { return item && item.isError; });
        renderTranscript();
        if (accepted) stateEl.textContent = '已连接 · 文字交流';
        else if (hasError) {
          stateEl.textContent = '聊天服务暂不可用，消息已保留';
          input.value = text;
          input.style.height = 'auto';
        } else {
          stateEl.textContent = 'TA 正在回复中，请稍后再发';
          input.value = text;
          input.style.height = 'auto';
        }
      }).catch(function (error) {
        if (chatDraftInput && savedChatDraft && !chatDraftInput.value) {
          chatDraftInput.value = savedChatDraft;
          chatDraftInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (finished) return;
        stateEl.textContent = '回复暂时中断';
        if (global.console && typeof global.console.warn === 'function') {
          global.console.warn('[MAOMAO call] message send failed', error);
        }
        renderTranscript();
      }).finally(function () {
        sending = false;
        if (!finished && connected) {
          input.disabled = false;
          sendButton.disabled = !input.value.trim();
          try { input.focus(); } catch (error) {}
        }
      });
    });

    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 76) + 'px';
      sendButton.disabled = !connected || !input.value.trim() || sending;
    });

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else sendButton.click();
      }
    });

    global.document.addEventListener('keydown', onKeydown);
    activeSession = { open: open, minimize: minimize, finish: finish, element: layer };

    connectTimer = global.setTimeout(function () {
      if (finished) return;
      connected = true;
      connectedAt = Date.now();
      layer.classList.add('is-connected');
      stateEl.textContent = '已连接 · 文字交流';
      input.disabled = false;
      input.placeholder = '输入消息，和 TA 继续聊…';
      sendButton.disabled = !input.value.trim();
      updateTimer();
      try { input.focus({ preventScroll: true }); } catch (error) {}
    }, 1400);

    tickTimer = global.setInterval(updateTimer, 1000);
    updateTimer();
    return true;
  }

  global.MAOMAOCallExperience = { start: start };
})(window);
