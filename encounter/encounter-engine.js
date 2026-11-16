/* 邂逅 / Encounter — 本地角色候选引擎 v1
 * 仅存轻量候选，不写聊天/记忆/正式角色；不得触发 API。
 * 扩展：registerCardDecorator(fn)、subscribe(fn)、window.MAOMAOEncounter。
 */
(function (global) {
  'use strict';
  var KEY = 'maomao_encounter_candidates_v1'; // 旧候选数组，仅保留只读兼容
  var ITEM_PREFIX = 'maomao_encounter_card_v2:';
  var REMOVED_PREFIX = 'maomao_encounter_removed_v2:';
  var MAX = 80;
  var listeners = [];
  var decorators = [];
  var sessionNames = new Set();
  var surnames = ['沈','江','谢','裴','宋','闻','陆','温','顾','许','程','林','季','苏','黎','纪','叶','陈','秦','孟','贺','傅','唐','阮','白','洛','周','夏'];
  var given = ['知序','见山','听澜','叙白','予安','今朝','清越','时屿','星野','望舒','南枝','书言','云深','观澜','行舟','景辞','照影','晚晴','之遥','鹤归','知微','怀瑾','初晴','青禾','雨眠','朝暮','明月','昭宁','言川','映雪','晏舟','长宁','流光','朔风','初弦','执玉','栖迟','扶摇','南乔','景行'];
  var givenMen = ['知序','见山','叙白','云深','观澜','行舟','景辞','怀瑾','晏舟','朔风','景行','言川','时屿','长宁'];
  var givenWomen = ['望舒','南枝','晚晴','知微','初晴','青禾','雨眠','昭宁','映雪','南乔','明月','清越','照影','初弦'];
  var western = ['Aster Vale','Elian Voss','Rowan Grey','Iris Solen','Celia Maren','Noa Vey','Rhea Arden','Silas North','Vera Lys','Luca Wren'];
  // 补充可组合名字片段，避免长期抽卡只在几十个固定名字间循环。
  var nameStarts = ['知','清','望','行','景','书','怀','思','楚','林','霁','庭','君','云','秋','安','时','言','宁','予','明','朝','希','初','闻','苏','北','昭'];
  var nameEnds = ['川','月','舟','宁','辞','岚','微','野','安','白','屿','衡','竹','然','瑾','音','澜','晴','霜','禾','言','之','汐','远','修','澈','辰','棠'];
  var archetypes = [
    {trait:'温柔克制',hidden:'有自己的原则，从不轻易许诺',quote:'有些事情，值得慢慢说。'},
    {trait:'阳光直率',hidden:'偶尔也需要一个安静的角落',quote:'走吧，今天适合认识新朋友。'},
    {trait:'清冷寡言',hidden:'对喜欢的事物异常认真',quote:'你也对这个感兴趣？'},
    {trait:'慵懒随性',hidden:'面对重要的选择十分坚定',quote:'我只是看起来不太在意。'},
    {trait:'理性敏锐',hidden:'私下喜欢收集没有用的小物件',quote:'比答案更有趣的，是你的问题。'},
    {trait:'古灵精怪',hidden:'观察力比表面更细腻',quote:'我猜你会喜欢这个故事。'},
    {trait:'优雅疏离',hidden:'对老朋友格外珍重',quote:'人和人之间，总需要一点时间。'},
    {trait:'毒舌幽默',hidden:'总会悄悄记住别人喜欢的东西',quote:'别太认真，我也有说错的时候。'},
    {trait:'阴郁慢热',hidden:'喜欢在清晨给植物浇水',quote:'这里很安静，我喜欢。'},
    {trait:'傲娇倔强',hidden:'其实很欣赏坦率的人',quote:'我可不是特地来找你的。'},
    {trait:'洒脱勇敢',hidden:'对故乡有一份难以割舍的牵挂',quote:'世界这么大，先从今天开始。'},
    {trait:'温和神秘',hidden:'藏着一段未说出口的往事',quote:'我们以前，见过吗？'}
  ];
  var worlds = [
    {era:'现代都市',species:'人类',jobs:['书店店主','建筑设计师','医生','摄影师','花艺师','律师','编辑','音乐制作人','咖啡师','研究员']},
    {era:'架空古代',species:'人类',jobs:['游医','将军','女官','书院先生','画师','镖师','古籍修复师','商行掌柜']},
    {era:'东方幻想',species:'狐族',jobs:['药师','山野旅人','藏书人','灵植师','云游术师']},
    {era:'东方幻想',species:'龙族',jobs:['山海守护者','人间花店店主','古物收藏家','占星师']},
    {era:'西方奇幻',species:'精灵',jobs:['森林引路人','魔法学院教师','星象研究者','游吟诗人']},
    {era:'西方奇幻',species:'血族',jobs:['夜间档案员','古堡馆长','钟表匠','药剂研究员']},
    {era:'未来纪元',species:'仿生人',jobs:['星际导航员','记忆修复师','生态观察员','博物馆讲解员']},
    {era:'未来纪元',species:'人类',jobs:['星舰工程师','时间研究员','深空植物学家','虚拟建筑师']},
    {era:'现代异闻',species:'人鱼',jobs:['海洋纪录片导演','水族馆研究员','海边民宿主人']},
    {era:'现代异闻',species:'狼族',jobs:['野生动物摄影师','山地向导','救援队员']},
    {era:'神话时代',species:'神族',jobs:['星河记录者','旧约守护者','梦境织造者']}
  ];
  var secrets = ['一张从未寄出的明信片','一枚停在凌晨三点的怀表','一本字迹不同的旅行笔记','一把没有标记的旧钥匙','一卷褪色的胶片','一封没有署名的信','一本被反复翻阅的旧书','一枚刻着陌生日期的胸针'];
  var fates = ['曾经离开故乡多年','正在寻找一位失联的故人','曾意外卷入一段时间错位','一直守护某个秘密的约定','在人间隐居多年','刚从漫长的旅程归来','经历过一次重生，保留模糊记忆','偶尔梦见另一个时空'];
  var uncommonFates = ['一直保留着不属于这个时代的记忆碎片','曾立下只允许履行一次的古老约定','偶然发现祖辈留下的第二份人生记录','拥有一幅描绘尚未发生之事的画','一封信改变了原本确定的命运'];
  var styles = ['普通相遇','普通相遇','普通相遇','普通相遇','普通相遇','普通相遇','蒙面档案','以物识人','命运分支','性格盲测'];
  var PREFERENCES_KEY = 'maomao_encounter_preferences_v1';

  // 尊重项目已有的 MAO 账号作用域：正式站点必须使用 Worker 注入的
  // __MAO_ACCOUNT_SCOPE__ + 账号 meta。此处绝不自建另一套登录/账号键。
  // 普通用户的 localStorage 已由原作用域代理隔离，001 管理员沿用原存储。
  function checkAccountScope() {
    var host = '';
    try { host = String(global.location && global.location.hostname || '').toLowerCase(); }
    catch (e) { return fail('无法确认站点位置，已停止读取角色候选'); }
    var localDev = !host || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
    var idNode, roleNode;
    try {
      var doc = global.document;
      if (doc && typeof doc.querySelector === 'function') {
        idNode = doc.querySelector('meta[name="mao-account-id"]');
        roleNode = doc.querySelector('meta[name="mao-account-role"]');
      }
    } catch (e) { return fail('无法检查当前账号上下文，已停止访问候选'); }
    var pageId = String(idNode && idNode.content || '').trim();
    var pageRole = String(roleNode && roleNode.content || '').trim();
    var scope = global.__MAO_ACCOUNT_SCOPE__;
    if (pageId || pageRole || !localDev) {
      if (!/^MAO-[A-Z0-9]{12,24}$/.test(pageId) ||
          (pageRole !== 'super_admin' && pageRole !== 'user') ||
          !scope || scope.ready !== true ||
          scope.accountId !== pageId || scope.role !== pageRole) {
        return fail('账号隔离尚未就绪。已停止抽卡和收藏，请先通过正式账号入口登录。');
      }
    }
    return ok({id:pageId || 'local-development', role:pageRole || 'local-development'});
  }

  async function verifyLiveAccountContext() {
    var scopeResult = checkAccountScope();
    if (!scopeResult.ok) return scopeResult;
    if (scopeResult.value.id === 'local-development') return scopeResult;
    if (typeof global.fetch !== 'function') return fail('无法核验当前登录账号，已停止可能计费的操作');
    try {
      var response = await global.fetch('/api/accounts/me', {
        method:'GET', credentials:'same-origin', cache:'no-store',
        headers:{accept:'application/json'}
      });
      var data = await response.json();
      var account = data && data.account;
      if (!response.ok || !account || account.id !== scopeResult.value.id ||
          account.role !== scopeResult.value.role || account.status !== 'active') {
        return fail('当前账号会话已变化或失效，请重新登录后再使用付费 AI');
      }
      return scopeResult;
    } catch (error) {
      return fail('暂时无法确认登录会话，已停止 API 请求以保护账号');
    }
  }

  function random(max) {
    if (global.crypto && global.crypto.getRandomValues) {
      var bytes = new Uint32Array(1);
      global.crypto.getRandomValues(bytes);
      return bytes[0] % max;
    }
    return Math.floor(Math.random() * max);
  }
  function pick(list) { return list[random(list.length)]; }
  function normalizeName(name) { return String(name || '').normalize('NFKC').toLowerCase().replace(/[\s·•._-]/g, ''); }
  function ok(value) { return {ok:true,value:value}; }
  function fail(message) { return {ok:false,error:message}; }
  function getRaw(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      if (raw === null) return ok(fallback);
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) && key === KEY) return fail('候选收藏格式异常，已保留原数据');
      return ok(parsed);
    } catch (e) { return fail('无法读取本地资料，请检查浏览器存储状态'); }
  }
  // V2：每张候选独立 key，标签页新增不同人物不会再互相覆盖整个收藏数组。
  // V1 历史数组保留只读，删除旧候选时仅写对应墓碑，不主动改写旧数据。
  function getCandidates() {
    var access = checkAccountScope();
    if (!access.ok) return access;
    var legacy = getRaw(KEY, []);
    if (!legacy.ok) return legacy;
    if (!Array.isArray(legacy.value)) return fail('旧候选收藏格式异常，已保留原数据');
    var cards = new Map(), removed = new Set();
    for (var old of legacy.value) {
      if (!old || typeof old !== 'object' || typeof old.id !== 'string' ||
          typeof old.name !== 'string') return fail('旧候选收藏含有无法识别的角色，未修改原数据');
      if (cards.has(old.id)) return fail('旧候选收藏存在重复 ID，已停止写入以保护原数据');
      cards.set(old.id,old);
    }
    try {
      var store = global.localStorage;
      if (!store || typeof store.key !== 'function' ||
          !Number.isSafeInteger(store.length) || store.length < 0) {
        return fail('当前浏览器不支持安全的候选逐条存储，已暂停收藏');
      }
      var keys = [];
      for (var i = 0, length = store.length; i < length; i++) {
        var key = store.key(i);
        if (typeof key === 'string' &&
            (key.indexOf(ITEM_PREFIX) === 0 || key.indexOf(REMOVED_PREFIX) === 0)) keys.push(key);
      }
      // 先扫描删除标记，再合并候选；即使旧标签页有未完成的写入，也不会复活被删人物。
      keys.forEach(function(key) {
        if (key.indexOf(REMOVED_PREFIX) === 0) removed.add(key.slice(REMOVED_PREFIX.length));
      });
      for (var key of keys) {
        if (key.indexOf(ITEM_PREFIX) !== 0) continue;
        var raw = store.getItem(key);
        if (raw === null) continue; // 跨标签页刚刚删除
        var item = JSON.parse(raw);
        var id = key.slice(ITEM_PREFIX.length);
        if (!item || typeof item !== 'object' || Array.isArray(item) ||
            typeof item.id !== 'string' || item.id !== id ||
            typeof item.name !== 'string' || !item.name) {
          return fail('候选人物存储异常，未覆盖任何已有资料');
        }
        cards.set(id,item);
      }
    } catch (error) { return fail('候选资料读取失败，已停止写入，原始数据保留'); }
    var result = [];
    cards.forEach(function(card,id) { if (!removed.has(id)) result.push(card); });
    result.sort(function(a,b) { return Number(b.savedAt||b.createdAt||0)-Number(a.savedAt||a.createdAt||0); });
    return ok(result);
  }
  function getPreferencesResult() {
    var access = checkAccountScope();
    if (!access.ok) return access;
    try {
      var raw = global.localStorage.getItem(PREFERENCES_KEY);
      if (raw === null) return ok({});
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object' || Array.isArray(o)) {
        return fail('抽卡偏好数据异常，原始内容已保留');
      }
      return ok(o);
    } catch (e) { return fail('抽卡偏好读取失败，未修改原始存储'); }
  }
  function getPreferences() {
    var r = getPreferencesResult();
    return r.ok ? r.value : {};
  }
  function savePreferences(patch) {
    var current = getPreferencesResult();
    if (!current.ok) return current;
    var allowed = ['type','world','similarity','gender'];
    var preferences = current.value;
    allowed.forEach(function(key) {
      if (Object.prototype.hasOwnProperty.call(patch,key)) preferences[key] = String(patch[key]).slice(0,50);
    });
    try {
      global.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
      var confirmed = JSON.parse(global.localStorage.getItem(PREFERENCES_KEY) || 'null');
      if (!confirmed || allowed.some(function(key) { return String(confirmed[key] || '') !== String(preferences[key] || ''); })) {
        return fail('偏好写入后校验失败，请检查存储空间或多标签页冲突');
      }
      return ok(preferences);
    } catch (e) { return fail('偏好保存失败，请检查存储空间'); }
  }
  function getRoleNames() {
    var access = checkAccountScope();
    if (!access.ok) return access;
    try {
      var roles = null;
      if (global.PhoneStorage && global.PhoneStorage.result && global.PhoneStorage.result.getCharacters) {
        var result = global.PhoneStorage.result.getCharacters();
        if (result.ok && Array.isArray(result.value)) roles = result.value;
        else if (!result || !result.error || result.error.code !== 'NOT_FOUND') {
          return fail('角色库暂时无法读取，已停止抽卡以避免撞名和覆盖资料');
        }
      }
      if (roles === null) {
        var raw = global.localStorage.getItem('ai_custom_characters');
        roles = raw == null ? [] : JSON.parse(raw);
      }
      if (!Array.isArray(roles)) return fail('角色库数据异常，无法安全检查姓名');
      var set = new Set();
      function includeNames(person) {
        if (!person || typeof person !== 'object') return;
        if (person.name) set.add(normalizeName(person.name));
        if (Array.isArray(person.aliases)) {
          person.aliases.forEach(function(n) { if (n) set.add(normalizeName(n)); });
        }
      }
      roles.forEach(function(role) {
        includeNames(role);
        // 角色档案里还会有家人、朋友等独立人物档案；也要避免与这些姓名撞名。
        if (role && Array.isArray(role.npcCharacters)) role.npcCharacters.forEach(includeNames);
      });
      return ok(set);
    } catch (e) { return fail('角色库读取失败，暂时不能抽卡'); }
  }
  // 「已相识」直接检索现有角色库的 encounterOrigin，不创建第二份正式角色数据。
  // 账号/存储异常时明确失败，不能把读失败伪装成“没有相识的人”。
  function getEncounteredRoles() {
    var scope = checkAccountScope();
    if (!scope.ok) return scope;
    try {
      var roles = null;
      if (global.PhoneStorage && global.PhoneStorage.result &&
          typeof global.PhoneStorage.result.getCharacters === 'function') {
        var result = global.PhoneStorage.result.getCharacters();
        if (result && result.ok && Array.isArray(result.value)) {
          roles = result.value;
        } else if (!result || !result.error || result.error.code !== 'NOT_FOUND') {
          return fail('暂时无法读取已创建角色，原人物资料保持不变');
        }
      }
      if (roles === null) {
        var raw = global.localStorage.getItem('ai_custom_characters');
        roles = raw === null ? [] : JSON.parse(raw);
      }
      if (!Array.isArray(roles)) return fail('角色列表格式异常，暂时无法查看已相识人物');
      var seen = new Set();
      var records = [];
      roles.forEach(function(role) {
        if (!role || typeof role !== 'object' ||
            typeof role.id !== 'string' || !role.id ||
            typeof role.name !== 'string' || !role.name ||
            !role.encounterOrigin || role.encounterOrigin.version !== 1) return;
        var sourceId = String(role.encounterOrigin.sourceCandidateId || '');
        if (!/^enc_[a-z0-9_-]{3,80}$/i.test(sourceId) || seen.has(role.id)) return;
        seen.add(role.id);
        records.push({
          id: role.id,
          name: role.name,
          sourceCandidateId: sourceId,
          era: String(role.encounterOrigin.era || ''),
          trait: String(role.encounterOrigin.trait || ''),
          storyChoice: String(role.encounterOrigin.storyChoice || '')
        });
      });
      return ok(records);
    } catch (error) {
      return fail('已相识人物读取失败，原角色档案未修改');
    }
  }

  function getReservedNames() {
    var roles = getRoleNames(), saved = getCandidates();
    if (!roles.ok) return roles;
    if (!saved.ok) return saved;
    saved.value.forEach(function(c) { roles.value.add(normalizeName(c.name)); });
    sessionNames.forEach(function(n) { roles.value.add(n); });
    return roles;
  }
  function chooseName(world, taken, gender) {
    var isFantasy = world.era === '西方奇幻';
    var pool = gender === '女' ? givenWomen.concat(given) : givenMen.concat(given);
    for (var i = 0; i < 160; i++) {
      var compound = random(5) === 0 ? pick(nameStarts) + pick(nameEnds) : pick(pool);
      var name = isFantasy && random(3) === 0 ? pick(western) : pick(surnames) + compound;
      if (!taken.has(normalizeName(name))) return name;
    }
    return null;
  }
  function chooseWorld(preferences) {
    var options = worlds.filter(function(w) {
      return !preferences.world || preferences.world === '全部' || w.era === preferences.world;
    });
    return pick(options.length ? options : worlds);
  }
  function generate() {
    var reserved = getReservedNames();
    if (!reserved.ok) return reserved;
    var prefs = getPreferences();
    var savedResult = getCandidates();
    var saved = savedResult.ok ? savedResult.value : [];
    var w = chooseWorld(prefs);
    if ((!prefs.world || prefs.world === '全部') && saved.length &&
        prefs.similarity === '多来喜欢的类型' && random(100) < 55) {
      var preferred = pick(saved);
      var wMatch = worlds.find(function(x) { return x.era === preferred.era && x.species === preferred.species; });
      if (wMatch) w = wMatch;
    } else if ((!prefs.world || prefs.world === '全部') && saved.length &&
               prefs.similarity === '尽量探索不同类型' && random(100) < 60) {
      var favorites = new Set(saved.map(function(x) { return x.species + ':' + x.era; }));
      var discoveries = worlds.filter(function(x) { return !favorites.has(x.species + ':' + x.era); });
      if (discoveries.length) w = pick(discoveries);
    }
    var gender = prefs.gender === '男' || prefs.gender === '女' ? prefs.gender : (random(2) === 0 ? '男' : '女');
    var name = chooseName(w, reserved.value, gender);
    if (!name) return fail('可用姓名不足，稍后再试');
    var a = pick(archetypes);
    if (saved.length && prefs.similarity === '多来喜欢的类型' && random(100) < 65) {
      var liked = pick(saved);
      var matched = archetypes.find(function(x) { return x.trait === liked.trait; });
      if (matched) a = matched;
    }
    if (saved.length && prefs.similarity === '尽量探索不同类型' && random(100) < 65) {
      var traits = new Set(saved.map(function(x) { return x.trait; }));
      var alternatives = archetypes.filter(function(x) { return !traits.has(x.trait); });
      if (alternatives.length) a = pick(alternatives);
    }
    var age = w.species === '人类' ? 22 + random(21) : (w.species === '仿生人' ? 23 + random(20) : 80 + random(1800));
    var type = prefs.type === '普通相遇' ? '普通相遇' : (styles.indexOf(prefs.type) >= 0 ? prefs.type : pick(styles));
    var rarity = random(100) < 8 ? '特别邂逅' : '普通';
    var card = {
      id:'enc_' + Date.now().toString(36) + '_' + random(99999999).toString(36),
      name:name, gender:gender, age:age, species:w.species, era:w.era, job:pick(w.jobs),
      relationVibe:pick(['年上感','年下感','同龄感','自由发展']),
      trait:a.trait, contrast:a.hidden, quote:a.quote,
      object:pick(secrets), fate:rarity === '特别邂逅' ? pick(uncommonFates) : pick(fates), type:type, rarity:rarity,
      choices:['留在熟悉的地方','踏上一段未知旅程'],
      selectedChoice:'', createdAt:Date.now(), schemaVersion:1
    };
    var protectedIdentity = { id:card.id, createdAt:card.createdAt, schemaVersion:card.schemaVersion };
    for (var i = 0; i < decorators.length; i++) {
      try {
        var output = decorators[i](Object.assign({},card));
        if (output && typeof output === 'object' && !Array.isArray(output)) card = Object.assign({},card,output);
      } catch (e) { /* 扩展玩法异常不能破坏默认卡片 */ }
    }
    // 扩展模块可增加故事内容，但不能替换主键或存储版本，避免候选串线。
    card.id=protectedIdentity.id;
    card.createdAt=protectedIdentity.createdAt;
    card.schemaVersion=protectedIdentity.schemaVersion;
    if (typeof card.name !== 'string' || !card.name.trim() ||
        reserved.value.has(normalizeName(card.name))) card.name = name;
    sessionNames.add(normalizeName(card.name));
    return ok(card);
  }
  function notify(event, payload) {
    listeners.slice().forEach(function(fn) { try { fn(event,payload); } catch (e) {} });
    try { global.dispatchEvent(new CustomEvent('maomao:encounter', {detail:{event:event,payload:payload}})); } catch (e) {}
  }
  function saveCandidate(card) {
    if (!card || !card.id || !/^enc_[a-z0-9_-]{3,80}$/i.test(card.id) ||
        typeof card.name !== 'string' || !card.name) return fail('人物卡无效');
    var names = getRoleNames();
    var current = getCandidates();
    if (!names.ok) return names;
    if (!current.ok) return current;
    if (current.value.some(function(c) { return c.id === card.id; })) return ok(current.value);
    if (names.value.has(normalizeName(card.name)) ||
        current.value.some(function(c) { return normalizeName(c.name) === normalizeName(card.name); })) {
      return fail('这位人物与现有角色撞名，请重新抽取');
    }
    if (current.value.length >= MAX) return fail('候选收藏已满（80 位），可以先整理后再收藏');
    var key = ITEM_PREFIX+card.id;
    var value = Object.assign({},card,{savedAt:Date.now()});
    try {
      // 删除墓碑优先于旧页面随后发出的相同 ID 保存。
      if (global.localStorage.getItem(REMOVED_PREFIX+card.id) !== null) {
        return fail('该候选已经被删除，不能在其他标签页恢复。请重新抽取');
      }
      global.localStorage.setItem(key,JSON.stringify(value));
      var raw = global.localStorage.getItem(key);
      if (!raw || JSON.parse(raw).id !== card.id) return fail('收藏写入后校验失败，请检查浏览器存储');
      var verified = getCandidates();
      if (!verified.ok || !verified.value.some(function(c) { return c.id === card.id; })) {
        return fail('收藏写入后校验失败，请检查浏览器空间或其他标签页');
      }
    } catch (e) { return fail('收藏失败，浏览器存储空间可能不足；卡片仍在当前页面'); }
    notify('saved',card);
    return ok(verified.value);
  }
  function removeCandidate(id) {
    var state = getCandidates();
    if (!state.ok) return state;
    if (!state.value.some(function(c) { return c.id === id; })) return fail('找不到候选角色');
    try {
      // 先写墓碑：删旧数组里的候选也不必覆盖整包历史数据。
      global.localStorage.setItem(REMOVED_PREFIX+id,'1');
      if (global.localStorage.getItem(REMOVED_PREFIX+id) !== '1') {
        return fail('删除标记写入失败，原收藏已保留');
      }
      global.localStorage.removeItem(ITEM_PREFIX+id);
      var verified = getCandidates();
      if (!verified.ok || verified.value.some(function(c) { return c.id === id; })) {
        return fail('删除后校验失败，请重新进入收藏确认结果');
      }
    } catch (e) { return fail('删除失败，原收藏已保留'); }
    notify('removed',id);
    return ok(verified.value);
  }
  // 原生 Web Locks 存在时把同账号内跨标签页的候选写入串行化。
  // 无 Web Locks 的旧浏览器仍保持 V2 的独立人物键，不回退至整包数组覆盖。
  async function withCandidateLock(operation) {
    var scope = checkAccountScope();
    if (!scope.ok) return scope;
    var manager = global.navigator && global.navigator.locks;
    try {
      if (manager && typeof manager.request === 'function') {
        return await manager.request('maomao:encounter:v2:' + scope.value.id,
          {mode:'exclusive'}, operation);
      }
      return operation();
    } catch (error) {
      return fail('候选跨标签页操作失败，已保留现有资料，请重新尝试');
    }
  }
  function saveCandidateSafe(card) { return withCandidateLock(function(){return saveCandidate(card);}); }
  function removeCandidateSafe(id) { return withCandidateLock(function(){return removeCandidate(id);}); }
  // 收藏的人物并非只读卡片：允许用户日后重新选择命运分支。
  // 仅更新一张候选自己的 V2 key，绝不写角色库、覆盖其他候选或修改原有 ID。
  function updateCandidateStoryChoice(id, choice) {
    if (typeof id !== 'string' || !/^enc_[a-z0-9_-]{3,80}$/i.test(id)) return fail('候选 ID 无效');
    var before = getCandidates();
    if (!before.ok) return before;
    var card = before.value.find(function(item) { return item.id === id; });
    if (!card) return fail('这位候选已不在收藏中，请重新打开收藏查看');
    if (card.type !== '命运分支' || !Array.isArray(card.choices) ||
        typeof choice !== 'string' || card.choices.indexOf(choice) === -1) {
      return fail('该人物不支持此故事选项');
    }
    var key = ITEM_PREFIX + id;
    var updated = Object.assign({}, card, {selectedChoice:choice});
    try {
      if (global.localStorage.getItem(REMOVED_PREFIX + id) !== null) {
        return fail('这位人物已经被移除，无法修改故事');
      }
      global.localStorage.setItem(key, JSON.stringify(updated));
      var raw = global.localStorage.getItem(key);
      var saved = raw && JSON.parse(raw);
      if (!saved || saved.id !== id || saved.selectedChoice !== choice) {
        return fail('故事选择保存后校验失败，请检查存储空间');
      }
      var verified = getCandidates();
      if (!verified.ok || !verified.value.some(function(item) {
        return item.id === id && item.selectedChoice === choice;
      })) {
        return fail('故事选择未能确认保存，请重新打开档案检查');
      }
    } catch (error) {
      return fail('故事选择保存失败，原人物档案已保留');
    }
    notify('story-choice', {id:id, selectedChoice:choice});
    return ok(updated);
  }
  function updateCandidateStoryChoiceSafe(id, choice) {
    return withCandidateLock(function() { return updateCandidateStoryChoice(id,choice); });
  }
  // 选故事不请求 AI：同一个人物和选项始终给出稳定的开场，正式角色设定也可继承。

  // 性格盲测只展示基于原人设的固定三选一；不增加存储键、不改人物 ID，也不调用 AI。
  // 同一候选的选项顺序稳定，返回值不暴露为新的“性格评判”或角色修改指令。
  function getBlindOptions(card) {
    if (!card || typeof card.trait !== 'string' || !card.trait.trim()) return [];
    var others = archetypes.map(function(item) { return item.trait; })
      .filter(function(trait) { return trait !== card.trait; });
    if (others.length < 2) return [];
    var seed = String(card.id || '');
    var hash = 2166136261;
    for (var i = 0; i < seed.length && i < 96; i++) {
      hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619) >>> 0;
    }
    var first = others.splice(hash % others.length, 1)[0];
    var second = others[(hash >>> 8) % others.length];
    var choices = [first, second];
    choices.splice((hash >>> 16) % 3, 0, card.trait);
    return choices;
  }
  function storyOpening(card, choice) {
    if (!card || !Array.isArray(card.choices) || card.choices.indexOf(choice) === -1) return '';
    var name = String(card.name || '这位陌生人');
    var era = String(card.era || '这个世界');
    var job = String(card.job || '旅人');
    var object = String(card.object || '一件旧物');
    if (choice === card.choices[0]) {
      return '在' + era + '，' + name + '选择守住熟悉的生活。作为' + job +
        '，TA 从「' + object + '」发现了一条牵动往事的线索。';
    }
    return name + '离开了熟悉的落脚处，开始追寻「' + object +
      '」背后的故事。' + era + '之外的旅途，将让' + job + '的身份面临新的选择。';
  }
  function formatBrief(card) {
    if (!card) return '';
    var age = card.species === '人类' ? String(card.age) + '岁' : '年龄 ' + String(card.age) + '年';
    return [
      '【基础资料】' + card.name + '｜' + (card.gender || '') + '｜' + age + '｜' + card.species,
      '【关系气质】' + (card.relationVibe || '自由发展') + '（仅是人物气质，不预设用户与 TA 的关系）',
      '【世界背景】' + card.era + '；身份：' + card.job,
      '【外在性格】' + card.trait,
      '【内在反差】' + card.contrast,
      '【重要物件】' + card.object,
      '【命运线索】' + card.fate,
      ...(card.selectedChoice && Array.isArray(card.choices) && card.choices.indexOf(card.selectedChoice) !== -1
        ? ['【故事起点】' + card.selectedChoice, '【开场片段】' + storyOpening(card, card.selectedChoice)] : []),
      '【相遇类型】' + (card.rarity || '普通') + '（稀有仅表示故事线索较特别，不代表人物等级）',
      '【说话气质】' + card.quote,
      '【创作说明】以上为简要原创设定。正式聊天前可在角色档案补全经历、习惯、动机与表达方式。'
    ].join('\n');
  }
  global.MAOMAOEncounter = Object.freeze({
    version:2, generate:generate, getCandidates:getCandidates, saveCandidate:saveCandidate,
    removeCandidate:removeCandidate, saveCandidateSafe:saveCandidateSafe,
    removeCandidateSafe:removeCandidateSafe, updateCandidateStoryChoiceSafe:updateCandidateStoryChoiceSafe,
    getPreferences:getPreferences, savePreferences:savePreferences,
    formatBrief:formatBrief, storyOpening:storyOpening, getBlindOptions:getBlindOptions,
    getEncounteredRoles:getEncounteredRoles, normalizeName:normalizeName,
    checkAccountScope:checkAccountScope, verifyLiveAccountContext:verifyLiveAccountContext,
    registerCardDecorator:function(fn) {
      if (typeof fn !== 'function') return function(){};
      decorators.push(fn);
      return function() { var idx=decorators.indexOf(fn); if(idx>=0) decorators.splice(idx,1); };
    },
    subscribe:function(fn) {
      if(typeof fn !== 'function') return function(){};
      listeners.push(fn);
      return function(){ var idx=listeners.indexOf(fn); if(idx>=0) listeners.splice(idx,1); };
    }
  });
})(window);
