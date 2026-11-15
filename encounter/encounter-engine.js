/* 邂逅 / Encounter — 本地角色候选引擎 v1
 * 仅存轻量候选，不写聊天/记忆/正式角色；不得触发 API。
 * 扩展：registerCardDecorator(fn)、subscribe(fn)、window.MAOMAOEncounter。
 */
(function (global) {
  'use strict';
  var KEY = 'maomao_encounter_candidates_v1';
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
  function getCandidates() {
    var access = checkAccountScope();
    if (!access.ok) return access;
    var r = getRaw(KEY, []);
    if (!r.ok) return r;
    if (!Array.isArray(r.value)) return fail('候选收藏格式异常');
    if (r.value.some(function(x) { return !x || typeof x !== 'object' || typeof x.id !== 'string'; })) return fail('候选收藏有无法识别的记录，未更改原始数据');
    return ok(r.value);
  }
  function getPreferences() {
    if (!checkAccountScope().ok) return {};
    try {
      var o = JSON.parse(global.localStorage.getItem(PREFERENCES_KEY) || '{}');
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    } catch (e) { return {}; }
  }
  function savePreferences(patch) {
    var access = checkAccountScope();
    if (!access.ok) return access;
    var allowed = ['type','world','similarity','gender'];
    var preferences = getPreferences();
    allowed.forEach(function(key) {
      if (Object.prototype.hasOwnProperty.call(patch,key)) preferences[key] = String(patch[key]).slice(0,50);
    });
    try { global.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); return ok(preferences); }
    catch (e) { return fail('偏好保存失败，请检查存储空间'); }
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
    for (var i = 0; i < decorators.length; i++) {
      try { var output = decorators[i](Object.assign({},card)); if (output && typeof output === 'object') card = Object.assign(card,output); }
      catch (e) { /* 第三方玩法故障不影响原始卡 */ }
    }
    if (!card.name || reserved.value.has(normalizeName(card.name))) card.name = name;
    sessionNames.add(normalizeName(card.name));
    return ok(card);
  }
  function notify(event, payload) {
    listeners.slice().forEach(function(fn) { try { fn(event,payload); } catch (e) {} });
    try { global.dispatchEvent(new CustomEvent('maomao:encounter', {detail:{event:event,payload:payload}})); } catch (e) {}
  }
  function saveCandidate(card) {
    if (!card || !card.id || !card.name) return fail('人物卡无效');
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
    var newList = [Object.assign({},card,{savedAt:Date.now()})].concat(current.value);
    try { global.localStorage.setItem(KEY,JSON.stringify(newList)); }
    catch (e) { return fail('收藏失败，浏览器存储空间可能不足；卡片仍在当前页面'); }
    notify('saved',card);
    return ok(newList);
  }
  function removeCandidate(id) {
    var state = getCandidates();
    if (!state.ok) return state;
    if (!state.value.some(function(c) { return c.id === id; })) return fail('找不到候选角色');
    var next = state.value.filter(function(c) { return c.id !== id; });
    try { global.localStorage.setItem(KEY,JSON.stringify(next)); }
    catch (e) { return fail('删除失败，原收藏已保留'); }
    notify('removed',id);
    return ok(next);
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
      '【命运线索】' + (card.selectedChoice || card.fate),
      '【相遇类型】' + (card.rarity || '普通') + '（稀有仅表示故事线索较特别，不代表人物等级）',
      '【说话气质】' + card.quote,
      '【创作说明】以上为简要原创设定。正式聊天前可在角色档案补全经历、习惯、动机与表达方式。'
    ].join('\n');
  }
  global.MAOMAOEncounter = Object.freeze({
    version:1, generate:generate, getCandidates:getCandidates, saveCandidate:saveCandidate,
    removeCandidate:removeCandidate, getPreferences:getPreferences, savePreferences:savePreferences,
    formatBrief:formatBrief, normalizeName:normalizeName, checkAccountScope:checkAccountScope,
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
