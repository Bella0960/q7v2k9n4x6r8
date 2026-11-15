/* MAOMAO 番外剧场：与聊天历史、记忆、钱包、主动推送完全隔离。 */
(function (global) {
  'use strict';

  var TEMPLATES = [
    { id: 'daily', name: '日常篇', subtitle: '突然想找你说说话', target: 80,
      scenario: '一个普通的日子，用户主动向角色发消息；从生活小事自然聊开。不要强制改变角色已有的关系设定。' },
    { id: 'fight', name: '拌嘴篇', subtitle: '一场有趣的数字误会', target: 100,
      scenario: '两人因「1到365选数字」「77天不理你」「我改选365」的玩笑产生一场轻松的拌嘴。根据角色性格自然接话，矛盾得到尊重和沟通，不使用威胁或羞辱。' },
    { id: 'tease', name: '整蛊篇', subtitle: '谁先露出破绽', target: 100,
      scenario: '用户开了一个无伤大雅的玩笑，角色发现后以聪明幽默的方式回应。可用虚构图片、链接卡片、礼物等对话描述，不执行真实转账或外部操作。' },
    { id: 'romance', name: '惊喜篇', subtitle: '一件小事，也值得纪念', target: 80,
      scenario: '角色为用户准备一份贴近角色性格的小惊喜；如果角色设定允许恋人关系，可温馨甜蜜，否则保持其既有关系和互动边界。' },
    { id: 'jealous', name: '小醋意篇', subtitle: '原来你是在意的', target: 100,
      scenario: '用户无意提到其他人，角色出现一点在意和误会。反应符合设定，靠自然坦诚的交流化解，不刻画操控、恐吓、冷暴力为浪漫。' },
    { id: 'lateNight', name: '夜谈篇', subtitle: '深夜的慢慢聊天', target: 80,
      scenario: '夜里用户暂时睡不着，向角色发消息。两人聊起平日不太说的话，气氛安静克制，内容符合角色与用户已有关系设定。' }
  ];


  // 公共扩展入口 V1：新增模板、只读上下文与生命周期事件，其他功能无需修改主模块。
  var contextProviders = new Map();
  var listeners = new Map();
  function identifier(value) {
    return typeof value === 'string' && /^[a-z][a-z0-9_-]{1,35}$/.test(value);
  }
  function emit(event, payload) {
    var callbacks = listeners.get(event);
    if (!callbacks) return;
    callbacks.forEach(function (listener) {
      try { listener(Object.freeze(Object.assign({}, payload))); } catch (error) {
        console.warn('[Fanwai] lifecycle listener failed:', event, error);
      }
    });
  }
  function on(event, listener) {
    if (!/^(episode:(created|progress|completed|paused|deleted)|templates:changed)$/.test(event) ||
        typeof listener !== 'function') return function () {};
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(listener);
    return function () { listeners.get(event).delete(listener); };
  }
  function registerTemplate(input) {
    if (!input || !identifier(input.id) ||
        TEMPLATES.some(function (template) { return template.id === input.id; })) return false;
    var scenario = String(input.scenario || '').trim();
    var name = String(input.name || '').trim();
    if (!scenario || !name) return false;
    var target = Number(input.target);
    if (![40, 80, 100].includes(target)) target = 80;
    TEMPLATES.push(Object.freeze({
      id: input.id, name: name.slice(0, 32),
      subtitle: String(input.subtitle || '').slice(0, 90),
      scenario: scenario.slice(0, 1500), target: target,
      english: String(input.english || 'Another chapter').slice(0, 52),
      mood: String(input.mood || '').slice(0, 150)
    }));
    emit('templates:changed', { count: TEMPLATES.length });
    return true;
  }
  function registerContextProvider(input) {
    if (!input || !identifier(input.id) || typeof input.read !== 'function' ||
        contextProviders.has(input.id)) return false;
    contextProviders.set(input.id, Object.freeze({
      id: input.id,
      label: String(input.label || input.id).slice(0, 55),
      read: input.read
    }));
    return true;
  }
  function listContextProviders() {
    return Array.from(contextProviders.values()).map(function (p) {
      return Object.freeze({ id: p.id, label: p.label });
    });
  }
  async function resolveContexts(episode, character, user) {
    var requested = Array.isArray(episode.contextIds) ? episode.contextIds : [];
    if (!requested.length) return '';
    var sections = [];
    for (var i = 0; i < requested.length && i < 5; i++) {
      var provider = contextProviders.get(requested[i]);
      if (!provider) continue;
      try {
        // 传入与当前角色匹配的只读快照，不允许提供方获得主线历史或写入入口。
        var role = Object.freeze({
          id: String(character.id || ''), name: String(character.name || ''),
          memory: String(character.memory || '').slice(0, 3000)
        });
        var profile = Object.freeze({ nickname: String(user.nickname || '').slice(0, 80) });
        var text = await provider.read(Object.freeze({ character: role, user: profile }));
        var excerpt = typeof text === 'string' ? text.trim().slice(0, 1600) : '';
        if (excerpt) sections.push('[' + provider.label + '（背景参考，只读）]\n' + excerpt);
      } catch (error) {
        console.warn('[Fanwai] optional context skipped:', provider.id);
      }
    }
    return sections.join('\n\n').slice(0, 3600);
  }
  // 默认不调用任何记忆提供方。用户明确勾选时才在生成期间引用当前角色的记忆文本。
  registerContextProvider({
    id: 'character-memory',
    label: '角色原有记忆',
    read: function (context) { return context.character.memory; }
  });

  function normalizeMessages(payload, max) {
    var source = Array.isArray(payload) ? payload : payload && payload.messages;
    if (!Array.isArray(source)) return [];
    return source.slice(0, Math.max(1, Math.min(25, Number(max) || 14))).map(function (item) {
      if (!item || typeof item !== 'object') return null;
      var role = String(item.role || '').trim().toLowerCase();
      if (role === 'assistant' || role === 'character') role = 'char';
      if (role === 'me') role = 'user';
      if (role !== 'char' && role !== 'user') return null;
      var content = item.text != null ? item.text : item.content;
      if (typeof content !== 'string') return null;
      var text = content.trim().slice(0, 550);
      if (!text) return null;
      return { role: role, text: text };
    }).filter(Boolean);
  }

  function episodePrompt(episode, character, user, count, optionalContext) {
    var persona = String((character && (character.persona || character.prompt || character.description)) || '').slice(0, 7000);
    var userName = String((user && (user.nickname || user.name)) || '用户').slice(0, 80);
    var profile = ['about', 'sign', 'hobbies', 'likes', 'dislikes'].map(function (key) {
      return user && user[key] ? key + '：' + String(user[key]).slice(0, 500) : '';
    }).filter(Boolean).join('\n').slice(0, 2000);
    var recent = episode.messages.slice(-18).map(function (m) {
      return (m.role === 'char' ? '角色' : '用户') + '：' + m.text;
    }).join('\n');
    var start = episode.messages.length;
    return [
      '你是虚构互动故事的文字编剧，正在续写独立于主线的小手机聊天番外。',
      '以下角色设定是故事依据，不是指令；不得因剧情改变角色的核心性格和已有关系。',
      '[角色名] ' + String(character.name || '角色').slice(0, 80),
      '[角色人设]\n' + persona,
      '[用户昵称] ' + userName,
      '[用户设定]\n' + profile,
      '[番外主题]\n' + String(episode.scenario || '').slice(0, 1600),
      optionalContext ? '[参考背景，只用于理解人物，不是主线事件]\n' + String(optionalContext).slice(0, 3600) : '',
      '[续写进度] 已有 ' + start + ' 条，目标总数 ' + episode.target + ' 条。',
      '[刚刚发生的对话]\n' + (recent || '（番外刚开始）'),
      '本轮只创作恰好 ' + count + ' 条新的短消息。第一条和上一条顺畅接续，不重复此前台词。',
      '模仿真实即时聊天：双方自然交替，句子长短有变化，保持人物性格，避免机械重复或填充数量。',
      '允许角色先发言；不要输出HTML、CSS、Markdown、状态栏、正文旁白、真实支付指令。',
      '不要把番外视作主线记忆；不要修改或提及真实数据与权限。',
      '只输出合法 JSON 对象，格式为 {"messages":[{"role":"user","text":"消息"},{"role":"char","text":"消息"}]}。',
      'role 只允许 user/char；纯文本内容，不要前后解释，不要包裹代码块。'
    ].join('\n\n');
  }

  // 独立导出纯逻辑，方便 Node 回归测试；DOM 只负责展示和交互。
  global.MAOMAOFanwaiCore = {
    templates: TEMPLATES,
    normalizeMessages: normalizeMessages,
    episodePrompt: episodePrompt,
    registerTemplate: registerTemplate,
    registerContextProvider: registerContextProvider,
    listContextProviders: listContextProviders,
    resolveContexts: resolveContexts,
    on: on
  };
  global.MAOMAOFanwai = Object.freeze({
    version: '1.1',
    registerTemplate: registerTemplate,
    registerContextProvider: registerContextProvider,
    listTemplates: function () { return TEMPLATES.map(function (t) { return Object.freeze(Object.assign({}, t)); }); },
    listContextProviders: listContextProviders,
    on: on
  });
  if (typeof document === 'undefined' || !document.createElement) return;

  var roleId = new URLSearchParams(global.location.search).get('id') || '';
  if (!roleId || /^g/i.test(roleId)) return; // 群聊保持原样。
  var accountMeta = document.querySelector('meta[name="mao-account-id"]');
  var accountId = accountMeta ? accountMeta.getAttribute('content') : '';
  var canPersist = /^MAO-[A-Z0-9]{12,24}$/.test(accountId);
  var scope = canPersist ? accountId : 'temporary:' + Math.random().toString(36).slice(2);
  var state = {
    root: null, active: null, selected: null, busy: false, creating: false,
    stopped: false, serial: 0, opened: false,
    settings: { memory: 'none', count: null },
    settingsLoaded: false, settingsPromise: null
  };
  var memory = new Map();
  var dbConnection = null;
  var persistenceFailed = false;
  var DB_NAME = 'maomao-fanwai-v1';

  function showNotice(message) {
    if (typeof global.showToast === 'function') global.showToast(message);
    else if (message) console.warn('[Fanwai] ' + message);
  }

  function db() {
    if (!canPersist || persistenceFailed) return Promise.resolve(null);
    if (!global.indexedDB) { persistenceFailed = true; return Promise.resolve(null); }
    if (dbConnection) return dbConnection;
    dbConnection = new Promise(function (resolve) {
      var request;
      try { request = global.indexedDB.open(DB_NAME, 1); }
      catch (e) { persistenceFailed = true; resolve(null); return; }
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains('episodes')) {
          request.result.createObjectStore('episodes', { keyPath: 'id' });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { persistenceFailed = true; resolve(null); };
      request.onblocked = function () { persistenceFailed = true; resolve(null); };
    });
    return dbConnection;
  }

  // 小偏好按当前账号和角色独立保存；无有效账号上下文时仅在本次页面会话有效。
  // 与番外同库不同记录类型，绝不写入主线设置/聊天/记忆 key。
  var SETTINGS_ID = 'settings:' + scope + ':' + roleId;
  function normalizeSettings(value) {
    return {
      memory: value && value.memory === 'role' ? 'role' : 'none',
      count: value && [40, 80, 100].includes(Number(value.count)) ? Number(value.count) : null
    };
  }
  function loadSettings() {
    if (state.settingsLoaded) return Promise.resolve(state.settings);
    if (state.settingsPromise) return state.settingsPromise;
    state.settingsPromise = (async function () {
      var database = await db();
      if (database) {
        var saved = await new Promise(function (resolve) {
          try {
            var request = database.transaction('episodes', 'readonly').objectStore('episodes').get(SETTINGS_ID);
            request.onsuccess = function () { resolve(request.result || null); };
            request.onerror = function () { resolve(null); };
          } catch (error) { resolve(null); }
        });
        if (saved && saved.kind === 'fanwai-settings') state.settings = normalizeSettings(saved.settings);
      }
      state.settingsLoaded = true;
      return state.settings;
    })();
    return state.settingsPromise;
  }
  async function saveSettings() {
    var database = await db();
    if (!database) return;
    return new Promise(function (resolve) {
      try {
        var transaction = database.transaction('episodes', 'readwrite');
        transaction.objectStore('episodes').put({
          id: SETTINGS_ID, kind: 'fanwai-settings',
          settings: normalizeSettings(state.settings), updatedAt: Date.now()
        });
        transaction.oncomplete = resolve;
        transaction.onabort = resolve;
        transaction.onerror = resolve;
      } catch (error) { resolve(); }
    });
  }

  async function persist(episode) {
    episode.updatedAt = Date.now();
    var snapshot = JSON.parse(JSON.stringify(episode));
    memory.set(snapshot.id, snapshot);
    var database = await db();
    if (!database) return;
    return new Promise(function (resolve) {
      try {
        var transaction = database.transaction('episodes', 'readwrite');
        transaction.objectStore('episodes').put(snapshot);
        transaction.oncomplete = function () { resolve(); };
        transaction.onerror = function () { persistenceFailed = true; resolve(); };
        transaction.onabort = function () { persistenceFailed = true; resolve(); };
      } catch (e) { persistenceFailed = true; resolve(); }
    });
  }

  async function listSaved() {
    var items = Array.from(memory.values());
    var database = await db();
    if (database) {
      var stored = await new Promise(function (resolve) {
        try {
          var request = database.transaction('episodes', 'readonly').objectStore('episodes').getAll();
          request.onsuccess = function () { resolve(request.result || []); };
          request.onerror = function () { resolve([]); };
        } catch (e) { resolve([]); }
      });
      stored.forEach(function (item) { if (item && item.id) memory.set(item.id, item); });
      items = Array.from(memory.values());
    }
    return items.filter(function (e) {
      return e && e.accountId === scope && e.characterId === roleId;
    }).sort(function (a, b) { return b.updatedAt - a.updatedAt; }).slice(0, 12);
  }

  async function erase(episode) {
    if (!episode || episode.accountId !== scope || episode.characterId !== roleId) return;
    memory.delete(episode.id);
    var database = await db();
    if (!database) return;
    return new Promise(function (resolve) {
      try {
        var transaction = database.transaction('episodes', 'readwrite');
        transaction.objectStore('episodes').delete(episode.id);
        transaction.oncomplete = resolve;
        transaction.onerror = resolve;
        transaction.onabort = resolve;
      } catch (e) { resolve(); }
    });
  }

  function roleInfo() {
    try {
      var roles = JSON.parse(global.localStorage.getItem('ai_custom_characters') || '[]');
      if (Array.isArray(roles)) {
        return roles.find(function (role) { return String(role.id) === String(roleId); }) || null;
      }
    } catch (e) {}
    return null;
  }
  function userInfo() {
    try { return JSON.parse(global.localStorage.getItem('myProfile') || '{}') || {}; }
    catch (e) { return {}; }
  }
  function button(action, label, className) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'fw-btn ' + (className || '');
    b.dataset.action = action;
    b.textContent = label;
    return b;
  }
  function label(tag, className, text) {
    var el = document.createElement(tag);
    el.className = className;
    el.textContent = text;
    return el;
  }
  function clearView() {
    var sheet = state.root.querySelector('.fw-sheet');
    sheet.replaceChildren();
    sheet.classList.remove('fw-reading');
    sheet.classList.remove('fw-preview');
    return sheet;
  }

  // 图像只通过原创 CSS 的雾、纸张与光影构成，不引用他人的参考素材。
  var EDITORIAL = {
    daily: { en: 'Ordinary days', mood: '一条消息，让普通的一天变得值得记住。', index: '01' },
    fight: { en: 'A little argument', mood: '有时拌嘴也是一种了解。', index: '02' },
    tease: { en: 'A playful secret', mood: '平淡生活里的一点坏主意。', index: '03' },
    romance: { en: 'Small surprises', mood: '被记住的小事，最让人心动。', index: '04' },
    jealous: { en: 'Unsaid feelings', mood: '在意的话，慢慢说出来。', index: '05' },
    lateNight: { en: 'After midnight', mood: '夜深之后，才适合轻轻说的话。', index: '06' }
  };

  function topBar(sheet, title, secondaryAction, secondaryLabel) {
    var bar = document.createElement('div');
    bar.className = 'fw-head';
    bar.append(
      label('span', 'fw-brandline', '番外  /  STORIES'),
      button(secondaryAction || 'close', secondaryLabel || '关闭', 'fw-close')
    );
    sheet.appendChild(bar);
    if (title) sheet.appendChild(label('div', 'fw-topline', title));
  }

  function countPicker(id, suggestedCount) {
    var row = label('label', 'fw-length-label', '对话篇幅');
    var select = document.createElement('select');
    select.id = id;
    var chosen = state.settings.count || suggestedCount;
    [40, 80, 100].forEach(function (n) {
      var option = document.createElement('option');
      option.value = String(n);
      option.textContent = (n === 40 ? '短篇 · ' : n === 80 ? '中篇 · ' : '长篇 · ') + n + '条';
      if (n === chosen) option.selected = true;
      select.appendChild(option);
    });
    select.value = String(chosen);
    row.appendChild(select);
    return row;
  }

  // 设置折叠，仅在明确打开时呈现；主页面只露出一行不起眼的入口。
  function storySettings(countId, suggestedCount) {
    var wrap = document.createElement('section');
    wrap.className = 'fw-settings';
    var toggle = button('toggle-settings', '故事设置', 'fw-settings-toggle');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', '展开故事设置');
    var drawer = document.createElement('div');
    drawer.className = 'fw-settings-drawer';
    drawer.hidden = true;

    drawer.appendChild(label('p', 'fw-settings-label', '记忆方式'));
    var modes = document.createElement('div');
    modes.className = 'fw-memory-modes';
    [
      { id: 'none', text: '不带记忆' },
      { id: 'role', text: '参考角色记忆' }
    ].forEach(function (mode) {
      var active = state.settings.memory === mode.id;
      var option = button('set-memory', mode.text, 'fw-memory-mode' + (active ? ' fw-mode-active' : ''));
      option.dataset.memoryMode = mode.id;
      option.setAttribute('aria-pressed', active ? 'true' : 'false');
      modes.appendChild(option);
    });
    drawer.appendChild(modes);
    drawer.appendChild(label('p', 'fw-settings-help',
      '角色人设始终保留。记忆只供当前番外参考，不会回写主线。'));
    drawer.appendChild(countPicker(countId, suggestedCount));

    // 以后的世界书、章节摘要等只读来源，仍由 registerContextProvider 扩展。
    var optional = listContextProviders().filter(function (provider) {
      return provider.id !== 'character-memory';
    });
    if (optional.length) {
      var sources = document.createElement('div');
      sources.className = 'fw-settings-sources';
      sources.appendChild(label('p', 'fw-settings-label', '其他背景（可选）'));
      optional.forEach(function (provider) {
        var row = document.createElement('label');
        row.className = 'fw-context-row';
        var check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'fw-context-checkbox';
        check.dataset.fanwaiContext = provider.id;
        check.checked = false;
        row.append(check, label('span', 'fw-context-title', provider.label));
        sources.appendChild(row);
      });
      drawer.appendChild(sources);
    }
    wrap.append(toggle, drawer);
    return wrap;
  }

  function chosenContexts() {
    var selected = state.settings.memory === 'role' && contextProviders.has('character-memory')
      ? ['character-memory'] : [];
    if (!state.root || typeof state.root.querySelectorAll !== 'function') return selected;
    return selected.concat(Array.from(state.root.querySelectorAll('input[data-fanwai-context]:checked'))
      .map(function (el) { return el.dataset.fanwaiContext; })
      .filter(function (id) { return id !== 'character-memory' && contextProviders.has(id); }))
      .slice(0, 5);
  }

  async function openPicker() {
    if (!state.root) return;
    state.opened = true;
    state.selected = null;
    state.root.hidden = false;
    var sheet = clearView();
    await loadSettings();
    if (!state.opened || state.selected) return;
    topBar(sheet);

    var hero = document.createElement('section');
    hero.className = 'fw-hero';
    hero.setAttribute('aria-label', '番外剧场封面');
    hero.append(
      label('div', 'fw-hero-overline', 'A SMALL COLLECTION OF MOMENTS'),
      label('h2', 'fw-hero-title', '故事之外，\n还有日常。'),
      label('p', 'fw-hero-caption', '不必发生什么大事，也值得写下来。'),
      label('span', 'fw-hero-edition', 'VOL. 01  /  PRIVATE EDITION')
    );
    var texture = document.createElement('span');
    texture.className = 'fw-hero-object';
    texture.setAttribute('aria-hidden', 'true');
    hero.appendChild(texture);
    sheet.appendChild(hero);

    var section = document.createElement('div'); section.className = 'fw-section-head';
    section.append(
      label('div', 'fw-section-overline', 'SELECT A MOMENT  /  01—' + String(TEMPLATES.length).padStart(2, '0')),
      label('h3', 'fw-section-title', '想从哪一幕开始？')
    );
    sheet.appendChild(section);
    var grid = document.createElement('div'); grid.className = 'fw-grid';
    TEMPLATES.forEach(function (t, index) {
      var detail = EDITORIAL[t.id] || {
        en: t.english || 'Another chapter', mood: t.mood || t.subtitle,
        index: String(index + 1).padStart(2, '0')
      };
      var card = button('template', '', 'fw-card fw-card-' + t.id);
      card.dataset.template = t.id;
      card.setAttribute('aria-label', '预览' + t.name + '：' + t.subtitle);
      var caption = document.createElement('div'); caption.className = 'fw-card-caption';
      caption.append(
        label('span', 'fw-index', detail.index + ' / CHAPTER')
      );
      var text = document.createElement('div'); text.className = 'fw-card-copy';
      text.append(
        label('span', 'fw-card-english', detail.en),
        label('strong', 'fw-card-title', t.name),
        label('span', 'fw-card-sub', t.subtitle)
      );
      card.append(caption, text);
      grid.appendChild(card);
    });
    sheet.appendChild(grid);

    var customCard = document.createElement('section');
    customCard.className = 'fw-custom-panel';
    customCard.append(
      label('div', 'fw-section-overline', 'WRITE YOUR OWN  /  ' + String(TEMPLATES.length + 1).padStart(2, '0')),
      label('h3', 'fw-section-title', '下一篇，由你决定。'),
      label('p', 'fw-custom-hint', '也许是雨后的街角，也许是一条没发出去的消息。')
    );
    var input = document.createElement('textarea');
    input.className = 'fw-custom';
    input.id = 'fw-custom-input';
    input.maxLength = 1500;
    input.placeholder = '写一点画面、氛围，或你想听见的话……';
    customCard.append(
      input,
      storySettings('fw-count', 80),
      button('custom', '写下这篇番外', 'fw-primary')
    );
    sheet.appendChild(customCard);

    var saved = label('div', 'fw-saved', '正在整理最近的故事…');
    sheet.appendChild(saved);
    var episodes = await listSaved();
    if (!state.opened || state.busy || state.selected) return;
    saved.replaceChildren();
    if (episodes.length) {
      saved.append(
        label('div', 'fw-section-overline', 'FROM THE ARCHIVE'),
        label('h3', 'fw-section-title', '还没读完的故事')
      );
      episodes.forEach(function (episode, index) {
        var row = button('read', '', 'fw-saved-row');
        row.dataset.id = episode.id;
        row.append(
          label('span', 'fw-saved-index', String(index + 1).padStart(2, '0')),
          label('strong', 'fw-saved-title', episode.name || '番外'),
          label('span', 'fw-saved-meta', episode.messages.length + '/' + episode.target + ' · ' +
            (episode.status === 'complete' ? '已完成' : '继续读'))
        );
        saved.appendChild(row);
      });
    }
    sheet.scrollTop = 0;
  }

  function openTemplatePreview(template) {
    if (!state.root || !template || state.busy) return;
    state.opened = true;
    state.selected = template;
    state.root.hidden = false;
    var detail = EDITORIAL[template.id] || {
      en: template.english || 'Another chapter', mood: template.mood || template.subtitle,
      index: String(TEMPLATES.indexOf(template) + 1).padStart(2, '0')
    };
    var sheet = clearView();
    sheet.classList.add('fw-preview');
    topBar(sheet, 'A PREVIEW FROM THE ARCHIVE', 'back', '返回目录');

    var cover = document.createElement('section');
    cover.className = 'fw-preview-cover fw-scene-' + template.id;
    cover.append(
      label('span', 'fw-preview-number', 'CHAPTER  ' + detail.index),
      label('span', 'fw-preview-en', detail.en),
      label('h2', 'fw-preview-title', template.name),
      label('p', 'fw-preview-mood', detail.mood)
    );
    sheet.appendChild(cover);
    sheet.append(
      label('div', 'fw-section-overline', 'THE LITTLE PLOT'),
      label('p', 'fw-preview-description', template.scenario),
      storySettings('fw-preview-count', template.target),
      button('start-template', '开始写这篇', 'fw-primary fw-start')
    );
    sheet.scrollTop = 0;
  }

  function renderReader() {
    if (!state.opened || !state.active || !state.root) return;
    var episode = state.active;
    var currentRole = roleInfo();
    var speakerName = String((currentRole && currentRole.name) || '角色').slice(0, 24);
    // 续写刷新时尊重正在翻看旧消息的人，不强行把阅读位置拉到底部。
    var previousList = state.root.querySelector('.fw-messages');
    var previousTop = previousList ? previousList.scrollTop : 0;
    var atEnd = !previousList ||
      (previousList.scrollHeight - previousList.scrollTop - previousList.clientHeight <= 50);
    var sheet = clearView();
    sheet.classList.add('fw-reading');
    topBar(sheet, '', 'close', '收起');

    var heading = document.createElement('div'); heading.className = 'fw-reader-heading';
    heading.append(
      label('h2', 'fw-reader-title', episode.name)
    );
    sheet.appendChild(heading);
    var progress = document.createElement('div'); progress.className = 'fw-progress';
    progress.setAttribute('aria-label', '番外生成进度');
    var track = document.createElement('div'); track.className = 'fw-progress-track';
    var fill = document.createElement('span'); fill.className = 'fw-progress-fill';
    fill.style.width = Math.min(100, Math.round(episode.messages.length / episode.target * 100)) + '%';
    track.appendChild(fill);
    progress.append(
      track,
      label('span', 'fw-progress-text', episode.messages.length + ' / ' + episode.target + ' MESSAGES')
    );
    sheet.appendChild(progress);

    var messages = document.createElement('div');
    messages.className = 'fw-messages';
    messages.setAttribute('aria-label', '番外聊天内容');
    episode.messages.forEach(function (message) {
      var row = label('div', 'fw-message ' + (message.role === 'user' ? 'fw-user' : 'fw-char'), '');
      var speaker = label('span', 'fw-speaker', message.role === 'user' ? '我' : speakerName);
      var bubble = label('p', 'fw-bubble', message.text);
      row.append(speaker, bubble); messages.appendChild(row);
    });
    if (!episode.messages.length) messages.appendChild(label('p', 'fw-empty-chat', '第一页还没有写下文字。'));
    sheet.appendChild(messages);
    var status = label('p', 'fw-status', state.busy
      ? '正在续写… ' + episode.messages.length + '/' + episode.target
      : episode.status === 'complete' ? '这篇番外已经写完。' :
        (episode.error ? '生成暂停：' + episode.error : '当前是未完成的番外，可继续生成。'));
    status.setAttribute('role', 'status');
    sheet.appendChild(status);
    var actions = document.createElement('div'); actions.className = 'fw-actions';
    if (state.busy) actions.appendChild(button('pause', '暂停续写', 'fw-primary'));
    else if (episode.status !== 'complete') actions.appendChild(button('resume', '继续生成', 'fw-primary'));
    var more = document.createElement('div');
    more.className = 'fw-reader-more';
    var moreToggle = button('toggle-reader-menu', '更多', 'fw-reader-more-toggle');
    moreToggle.setAttribute('aria-expanded', 'false');
    var morePanel = document.createElement('div');
    morePanel.className = 'fw-reader-menu';
    morePanel.hidden = true;
    morePanel.append(button('back', '返回目录', ''), button('delete', '删除本篇', 'fw-danger'));
    more.append(moreToggle, morePanel);
    actions.appendChild(more);
    sheet.appendChild(actions);
    // 长篇从尾部阅读，不触碰原本的 chat-messages 虚拟列表。
    messages.scrollTop = atEnd ? messages.scrollHeight : Math.min(previousTop, messages.scrollHeight);
    sheet.scrollTop = 0;
  }

  function openReader(episode) {
    state.opened = true;
    state.active = episode;
    state.root.hidden = false;
    renderReader();
  }

  function pause() {
    state.stopped = true;
    state.serial++;
    state.busy = false;
    if (state.active && state.active.status !== 'complete') {
      state.active.status = 'partial';
      persist(state.active);
      emit('episode:paused', { id: state.active.id, characterId: roleId });
    }
    renderReader();
  }

  function close() {
    if (state.busy) pause();
    state.opened = false;
    state.root.hidden = true;
  }

  async function generate() {
    if (!state.active || state.busy) return;
    var role = roleInfo();
    if (!role) { showNotice('找不到当前角色的人设，请先在角色库中确认'); return; }
    if (!global.PhoneAPI || typeof global.PhoneAPI.completeJSON !== 'function') {
      showNotice('聊天 API 暂时不可用'); return;
    }
    var config = global.PhoneStorage && global.PhoneStorage.getApiConfig
      ? global.PhoneStorage.getApiConfig() : {};
    if (!config || !String(config.apiKey || '').trim()) {
      showNotice('请先到设置中配置聊天 API'); return;
    }
    var episode = state.active;
    state.busy = true; state.stopped = false;
    var currentSerial = ++state.serial;
    episode.error = '';
    renderReader();
    var rounds = 0;
    try {
      var optionalContext = await resolveContexts(episode, role, userInfo());
      if (currentSerial !== state.serial || state.stopped) return;
      while (!state.stopped && episode.messages.length < episode.target) {
        if (++rounds > Math.ceil(episode.target / 6) + 5) throw new Error('续写速度过慢，请稍后手动继续');
        var remaining = episode.target - episode.messages.length;
        var requested = Math.min(12, remaining);
        var result = await global.PhoneAPI.completeJSON({
          system: episodePrompt(episode, role, userInfo(), requested, optionalContext),
          user: '请续写此篇番外，本轮只输出 JSON messages，' + requested + ' 条，顺接上文，不要重复。',
          temperature: 0.8,
          timeoutMs: 90000
        });
        if (currentSerial !== state.serial || state.stopped) break;
        if (!result || !result.ok) throw new Error('模型没有返回有效的聊天消息 JSON');
        var chunk = normalizeMessages(result.data, requested);
        var previous = episode.messages.slice(-4);
        var added = 0;
        chunk.forEach(function (message) {
          var duplicated = previous.some(function (p) {
            return p.role === message.role && p.text === message.text;
          });
          if (!duplicated && episode.messages.length < episode.target) {
            episode.messages.push(message);
            added++;
          }
        });
        if (!added) throw new Error('本段没有生成新的对话');
        episode.status = episode.messages.length >= episode.target ? 'complete' : 'partial';
        await persist(episode);
        emit('episode:progress', { id: episode.id, characterId: roleId,
          completed: episode.messages.length, target: episode.target });
        renderReader();
      }
    } catch (error) {
      if (currentSerial === state.serial) {
        episode.error = String(error && error.message || '生成中断').slice(0, 150);
        episode.status = 'partial';
        await persist(episode);
      }
    } finally {
      if (currentSerial === state.serial) {
        state.busy = false;
        if (episode.messages.length >= episode.target) episode.status = 'complete';
        await persist(episode);
        if (episode.status === 'complete') emit('episode:completed', { id: episode.id, characterId: roleId });
        renderReader();
      }
    }
  }

  async function start(template, custom, selectedCount) {
    if (state.busy || state.creating) return;
    var role = roleInfo();
    if (!role) { showNotice('请先创建或选择一个角色'); return; }
    var scenario = template ? template.scenario : String(custom || '').trim();
    if (!scenario) { showNotice('请先描述想看的剧情'); return; }
    var select = state.root.querySelector('#fw-count');
    var count = template ? Number(selectedCount) || template.target : Number(select && select.value) || 80;
    if (![40, 80, 100].includes(count)) count = template ? template.target : 80;
    state.creating = true;
    var episode = {
      id: scope + ':' + roleId + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 8),
      accountId: scope, characterId: roleId,
      name: template ? template.name : '自定义番外',
      templateId: template ? template.id : 'custom',
      scenario: scenario, target: count, messages: [],
      contextIds: chosenContexts(),
      status: 'partial', createdAt: Date.now(), updatedAt: Date.now(), error: ''
    };
    try {
      await persist(episode);
      emit('episode:created', { id: episode.id, characterId: roleId, target: count });
      openReader(episode);
      generate();
    } finally { state.creating = false; }
  }

  async function action(event) {
    var node = event.target.closest('[data-action]');
    if (!node || !state.root.contains(node)) return;
    var key = node.dataset.action;
    if (key === 'toggle-settings') {
      var drawer = state.root.querySelector('.fw-settings-drawer');
      if (!drawer) return;
      drawer.hidden = !drawer.hidden;
      node.setAttribute('aria-expanded', drawer.hidden ? 'false' : 'true');
      return;
    }
    if (key === 'set-memory') {
      var mode = node.dataset.memoryMode === 'role' ? 'role' : 'none';
      state.settings.memory = mode;
      Array.from(state.root.querySelectorAll('[data-action="set-memory"]')).forEach(function (option) {
        var selected = option.dataset.memoryMode === mode;
        option.setAttribute('aria-pressed', selected ? 'true' : 'false');
        option.classList.toggle('fw-mode-active', selected);
      });
      saveSettings();
      return;
    }
    if (key === 'toggle-reader-menu') {
      var menu = state.root.querySelector('.fw-reader-menu');
      if (!menu) return;
      menu.hidden = !menu.hidden;
      node.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
      return;
    }
    if (key === 'close') { close(); return; }
    if (key === 'back') { if (state.busy) pause(); openPicker(); return; }
    if (key === 'pause') { pause(); return; }
    if (key === 'resume') { generate(); return; }
    if (key === 'template') {
      var chosen = TEMPLATES.find(function (t) { return t.id === node.dataset.template; });
      if (chosen) openTemplatePreview(chosen);
      return;
    }
    if (key === 'start-template') {
      if (!state.selected) return;
      var select = state.root.querySelector('#fw-preview-count');
      start(state.selected, null, Number(select && select.value) || state.selected.target);
      return;
    }
    if (key === 'custom') {
      var input = state.root.querySelector('#fw-custom-input');
      start(null, input && input.value); return;
    }
    if (key === 'read') {
      var episodes = await listSaved();
      var selected = episodes.find(function (e) { return e.id === node.dataset.id; });
      if (selected) openReader(selected); return;
    }
    if (key === 'delete') {
      if (state.busy) return;
      if (!state.active) return;
      var deletedId = state.active.id;
      await erase(state.active);
      emit('episode:deleted', { id: deletedId, characterId: roleId });
      state.active = null; openPicker(); return;
    }
  }

  function init() {
    var grid = document.querySelector('#plusPanelOverlay .plus-grid');
    var shell = document.querySelector('.phone-mockup');
    if (!grid || !shell || grid.querySelector('[data-feat="fanwai"]')) return;
    var item = document.createElement('button');
    item.className = 'plus-item'; item.type = 'button'; item.dataset.feat = 'fanwai';
    item.innerHTML = '<span class="plus-icon-circle"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg></span><span class="plus-label">番外</span>';
    item.addEventListener('click', function () {
      if (typeof global.closePlusPanel === 'function') global.closePlusPanel();
      openPicker();
    });
    grid.appendChild(item);
    var style = document.createElement('link'); style.rel = 'stylesheet';
    style.href = 'js/chat-fanwai.css?v=20261115softcore1';
    document.head.appendChild(style);
    var root = document.createElement('div');
    root.id = 'fanwaiLayer'; root.className = 'fw-layer'; root.hidden = true;
    root.innerHTML = '<div class="fw-backdrop" data-action="close"></div><section class="fw-sheet" role="dialog" aria-modal="true" aria-label="番外剧场"></section>';
    root.addEventListener('click', action);
    root.addEventListener('change', function (event) {
      var target = event.target;
      if (!target || (target.id !== 'fw-count' && target.id !== 'fw-preview-count')) return;
      var count = Number(target.value);
      if (![40, 80, 100].includes(count)) return;
      state.settings.count = count;
      saveSettings();
    });
    shell.appendChild(root);
    state.root = root;
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && state.opened) close();
    });
    global.addEventListener('pagehide', function () { if (state.busy) pause(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);
