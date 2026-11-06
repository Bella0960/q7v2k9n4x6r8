(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
var DATA_KEY = 'maomao_luck_room_v1';
var SETTINGS_KEY = 'maomao_luck_room_settings_v1';
var DISCLAIMER = '以上内容均为娱乐体验，不具备预测未来或指导现实决策的作用，请勿当真，一切仅供娱乐参考。';
var DEFAULT_POOLS = [
  { id: 'meal', name: '中午吃什么', items: ['火锅', '寿司', '面条', '汉堡', '盖饭', '饺子'] },
  { id: 'weekend', name: '周末做什么', items: ['看一场电影', '去散步', '逛逛街', '在家休息', '找一家新店'] },
  { id: 'little-task', name: '今天的小任务', items: ['整理一个小角落', '听一张专辑', '给朋友发消息', '读几页书', '早点休息'] }
];
var DEFAULT_WHEELS = [
  { id: 'lunch', name: '中午吃什么', items: ['火锅', '面条', '寿司', '汉堡', '咖喱饭', '饺子'] },
  { id: 'weekend', name: '周末做什么', items: ['看电影', '逛街', '去公园', '宅家', '喝咖啡', '短途走走'] },
  { id: 'watch', name: '今晚看什么', items: ['喜剧', '纪录片', '悬疑片', '动画', '随便挑一部'] }
];
var TAROT = [
  ['0','愚者','新的开始 · 好奇 · 自由','留意冲动与准备不足，给自己一点观察时间。','灵感与探索','轻率与分心','◇'],
  ['I','魔术师','行动力 · 创造 · 专注','你拥有把想法变成小行动的资源。','表达与执行','分散与过度承诺','✧'],
  ['II','女祭司','直觉 · 静观 · 内在','先安静听听自己的想法，不必急着下结论。','观察与倾听','信息不足与猜测','☾'],
  ['III','皇后','滋养 · 创造 · 丰盛','照顾好日常，也给创意留出空间。','温柔与生长','忽略需求与过度付出','❀'],
  ['IV','皇帝','结构 · 边界 · 稳定','把复杂的事分成清楚的小步骤。','秩序与计划','僵化与控制','▣'],
  ['V','教皇','经验 · 学习 · 传统','参考可靠经验，也保留独立判断。','学习与交流','盲从与固守','⌂'],
  ['VI','恋人','连接 · 选择 · 价值','看清自己重视什么，再做小小选择。','坦诚与共识','犹豫与不协调','♡'],
  ['VII','战车','方向 · 推进 · 自律','选定一个方向，稳稳地向前一点。','专注与行动','急躁与失去节奏','➤'],
  ['VIII','力量','耐心 · 勇气 · 温和','温和并不等于软弱，耐心也是一种力量。','韧性与自信','急于证明与消耗','∞'],
  ['IX','隐者','独处 · 反思 · 寻找','给自己一点独处时间，整理真正重要的事。','思考与沉淀','封闭与过度孤立','⌕'],
  ['X','命运之轮','变化 · 周期 · 机会','变化会带来新视角，保持灵活就好。','转机与适应','反复与不确定','◉'],
  ['XI','正义','平衡 · 诚实 · 判断','尽量看完整信息，再做公平的判断。','清晰与平衡','偏见与信息缺口','⚖'],
  ['XII','倒吊人','暂停 · 换位 · 等待','暂时停一停，换个角度也许会有新发现。','换位思考','拖延与停滞','⌁'],
  ['XIII','死神','转变 · 告别 · 更新','某个阶段可以结束了，为新的安排腾出位置。','更新与整理','抗拒改变','✦'],
  ['XIV','节制','协调 · 节奏 · 融合','不用一次做到完美，找到适合自己的节奏。','调和与耐心','失衡与过量','◌'],
  ['XV','恶魔','欲望 · 习惯 · 觉察','注意那些让你分心的习惯，重新拿回主动权。','看见束缚','沉迷与自我限制','⌘'],
  ['XVI','高塔','震动 · 重整 · 真实','计划出现变化时，先确认事实，再慢慢调整。','打破旧框架','慌乱与抗拒','⌂'],
  ['XVII','星星','希望 · 修复 · 灵感','给自己一点恢复空间，继续保留希望。','灵感与信心','疲惫与失望','✧'],
  ['XVIII','月亮','想象 · 情绪 · 未知','信息不完整时先别急着判断，照顾当下感受。','想象与敏感','误解与不安','☽'],
  ['XIX','太阳','明朗 · 活力 · 分享','把简单的快乐留给今天，也分享一点好心情。','活力与表达','疲惫与过度乐观','☼'],
  ['XX','审判','回顾 · 醒悟 · 新阶段','回顾经验，挑一件真正想继续的事。','觉察与重启','自我苛责与犹豫','⌁'],
  ['XXI','世界','完成 · 整合 · 旅程','认可已经走过的路，再开始下一段。','收获与完整','未完成感与分散','◎']
];
var DAILY = [
  { keyword: '慢一点，也很好', headline: '适合把节奏调匀的一天。', description: '先完成眼前的一件小事，不用急着把所有计划一次做完。', categories: [['灵感','慢慢来'],['沟通','真诚表达'],['休息','留一点空白']] },
  { keyword: '新的小发现', headline: '给好奇心留个位置。', description: '熟悉的路线也可能遇见新东西，今天可以试着换个小方法。', categories: [['灵感','值得尝试'],['沟通','多听一点'],['休息','轻松一点']] },
  { keyword: '把注意力还给自己', headline: '适合整理和收尾。', description: '清理一个待办，收好一个角落，让接下来的时间更清楚。', categories: [['灵感','先做一件'],['沟通','说清楚'],['休息','早点放松']] },
  { keyword: '一点点好心情', headline: '今天可以认真享受小事。', description: '一顿喜欢的饭、一段喜欢的音乐，都值得被好好对待。', categories: [['灵感','轻盈开放'],['沟通','分享心情'],['休息','补充能量']] },
  { keyword: '稳稳地向前', headline: '不必赶路，方向更重要。', description: '把注意力放在自己能掌握的部分，慢慢推进就很好。', categories: [['灵感','保持专注'],['沟通','耐心回应'],['休息','适度停顿']] }
];
var state = { pools: clone(DEFAULT_POOLS), wheels: clone(DEFAULT_WHEELS), history: [] };
var roles = [];
var selectedRole = null;
var activePool = 'meal';
var activeWheel = 'lunch';
var wheelRotation = 0;
var wheelBusy = false;
var tarotDraw = null;
var roleRequestToken = 0;
var toastTimer = null;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function randomIndex(length) {
  if (!length) return -1;
  if (window.crypto && window.crypto.getRandomValues) {
    var n = new Uint32Array(1);
    var limit = Math.floor(0x100000000 / length) * length;
    do { window.crypto.getRandomValues(n); } while (n[0] >= limit);
    return n[0] % length;
  }
  return Math.floor(Math.random() * length);
}
function shuffle(list) {
  var copy = list.slice();
  for (var i = copy.length - 1; i > 0; i--) {
    var j = randomIndex(i + 1), temp = copy[i]; copy[i] = copy[j]; copy[j] = temp;
  }
  return copy;
}
function readJSON(key, fallback) {
  try { var value = JSON.parse(localStorage.getItem(key) || 'null'); return value == null ? fallback : value; }
  catch (error) { return fallback; }
}
function saveState() {
  try {
    var serialized = JSON.stringify(state);
    localStorage.setItem(DATA_KEY, serialized);
    return localStorage.getItem(DATA_KEY) === serialized;
  } catch (error) {
    showToast('保存失败：浏览器空间可能不足，原有内容没有被主动清除。');
    return false;
  }
}
function loadState() {
  var saved = readJSON(DATA_KEY, null);
  if (!saved || typeof saved !== 'object') return;
  if (Array.isArray(saved.pools)) state.pools = saved.pools.filter(validTemplate);
  if (Array.isArray(saved.wheels)) state.wheels = saved.wheels.filter(validTemplate);
  if (Array.isArray(saved.history)) state.history = saved.history.slice(-100);
  if (!state.pools.length) state.pools = clone(DEFAULT_POOLS);
  if (!state.wheels.length) state.wheels = clone(DEFAULT_WHEELS);
}
function validTemplate(item) {
  return !!(item && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.items));
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ roleId: selectedRole ? String(selectedRole.id) : '' }));
    return true;
  } catch (error) { return false; }
}
function loadRoles() {
  try {
    if (window.PhoneStorage && typeof PhoneStorage.getCharacters === 'function') roles = PhoneStorage.getCharacters() || [];
  } catch (error) { roles = []; }
  if (!Array.isArray(roles) || !roles.length) roles = readJSON('ai_custom_characters', []);
  roles = (Array.isArray(roles) ? roles : []).filter(function (role) { return role && role.id != null; });
  var settings = readJSON(SETTINGS_KEY, {});
  var currentId = settings.roleId || (window.PhoneStorage && PhoneStorage.getCurrentContactId ? PhoneStorage.getCurrentContactId() : '');
  selectedRole = roles.find(function (role) { return String(role.id) === String(currentId); }) || null;
  renderRoleOptions();
}
function roleName(role) {
  return role ? String(role.name || role.nickname || role.charName || '聊天角色') : '独自体验';
}
function renderRoleOptions() {
  var select = $('roleSelect');
  select.textContent = '';
  var solo = document.createElement('option');
  solo.value = ''; solo.textContent = '独自体验'; select.appendChild(solo);
  roles.forEach(function (role) {
    var option = document.createElement('option');
    option.value = String(role.id);
    option.textContent = roleName(role);
    select.appendChild(option);
  });
  select.value = selectedRole ? String(selectedRole.id) : '';
  $('roleStatus').textContent = selectedRole ? '已邀请 ' + roleName(selectedRole) + ' 一起参与。' : '可以自己玩，也可以叫一个角色来陪你。';
  var avatar = $('companionAvatar'), fallback = $('companionFallback');
  var source = selectedRole ? roleAvatar(selectedRole) : '';
  if (source) {
    avatar.src = source; avatar.hidden = false; fallback.hidden = true;
  } else {
    avatar.removeAttribute('src'); avatar.hidden = true; fallback.hidden = false;
  }
}
function roleAvatar(role) {
  if (!role) return '';
  var source = String(role.avatar || role.avatarUrl || role.avatarData || role.image || role.icon || '').trim();
  if (!source) return '';
  return /^(?:https?:\/\/|data:image\/|blob:|\/|\.\/|\.\.\/)/i.test(source) ? source : '';
}
function showToast(message) {
  var toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 2300);
}
function currentRoleId() { return selectedRole ? String(selectedRole.id) : ''; }
function addHistory(game, result, detail) {
  state.history.push({
    id: 'luck_' + Date.now() + '_' + randomIndex(99999),
    game: game,
    roleId: currentRoleId(),
    roleName: roleName(selectedRole),
    result: String(result || ''),
    detail: String(detail || ''),
    createdAt: Date.now()
  });
  state.history = state.history.slice(-100);
  saveState();
  renderHistory();
}
function roleFallback(game) {
  var name = roleName(selectedRole);
  var lines = [
    '我觉得这个结果挺有意思的。先收下它，剩下的我们慢慢来。',
    '结果已经出来啦。今天就把它当作一个轻松的小提示吧。',
    '嗯，那就这样决定？至少不用再纠结半天了。'
  ];
  var line = lines[randomIndex(lines.length)];
  return selectedRole ? name + '：' + line : '';
}
function askRole(game, detail, target) {
  target = $(target);
  if (!target) return;
  if (!selectedRole) { target.textContent = ''; return; }
  var localLine = roleFallback(game);
  target.textContent = localLine;
  if (!window.PhoneAPI || typeof PhoneAPI.complete !== 'function') return;
  var context = '';
  try {
    if (window.PhoneContext && typeof PhoneContext.buildPhoneRoleContext === 'function') {
      context = PhoneContext.buildPhoneRoleContext(selectedRole.id, 'luck-room');
    }
  } catch (error) { context = ''; }
  var token = ++roleRequestToken;
  target.textContent = roleName(selectedRole) + ' 正在想怎么回应……';
  var system = '你正在 MAOMAO 的轻量娱乐互动应用里与用户一起玩。请严格保持所选角色的人设、语气、称呼和表达习惯。你只是在既定随机结果揭晓后自然回应，不得改变、质疑、重抽或操纵结果。不要把塔罗、运势、抽签说成真实预言，不对健康、法律、财务或重大人生决定作判断或指令。回复简短自然，像真实聊天，不要输出分析报告。\\n\\n' + context;
  PhoneAPI.complete({
    system: system,
    user: '玩法：' + game + '\\n已经由独立随机机制确定的结果：' + detail + '\\n请以角色身份自然接一句话。',
    temperature: 0.85,
    timeoutMs: 12000
  }).then(function (reply) {
    if (token !== roleRequestToken) return;
    var clean = String(reply || '').trim();
    target.textContent = clean || localLine;
  }).catch(function () {
    if (token === roleRequestToken) target.textContent = localLine;
  });
}
function setTab(name) {
  document.querySelectorAll('.play-tab').forEach(function (button) {
    var active = button.dataset.tab === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.play-panel').forEach(function (panel) {
    var active = panel.dataset.panel === name;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  if (name === 'wheel') drawWheel();
}
function activePoolData() {
  return state.pools.find(function (pool) { return pool.id === activePool; }) || state.pools[0];
}
function activeWheelData() {
  return state.wheels.find(function (wheel) { return wheel.id === activeWheel; }) || state.wheels[0];
}
function renderPoolSelect() {
  var select = $('lotPoolSelect');
  select.textContent = '';
  state.pools.forEach(function (pool) {
    var option = document.createElement('option'); option.value = pool.id; option.textContent = pool.name; select.appendChild(option);
  });
  if (!state.pools.some(function (pool) { return pool.id === activePool; })) activePool = state.pools[0].id;
  select.value = activePool;
  $('lotPoolTitleInput').value = activePoolData() ? activePoolData().name : '';
  $('deleteLotPoolBtn').disabled = state.pools.length <= 1;
}
function renderLotItems() {
  var list = $('lotItems'), pool = activePoolData();
  list.textContent = '';
  $('lotPoolTitleInput').value = pool ? pool.name : '';
  if (!pool) return;
  pool.items.forEach(function (item, index) {
    var row = document.createElement('div'); row.className = 'item-row';
    var number = document.createElement('span'); number.className = 'item-index'; number.textContent = String(index + 1).padStart(2, '0');
    var text = document.createElement('input'); text.className = 'item-edit-input'; text.type = 'text'; text.maxLength = 36; text.value = item; text.setAttribute('aria-label', '编辑签文');
    text.addEventListener('change', function () {
      var value = text.value.trim(); if (!value) { text.value = pool.items[index]; return; }
      pool.items[index] = value; saveState(); renderLotItems();
    });
    var remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', '删除签文');
    remove.addEventListener('click', function () {
      pool.items.splice(index, 1); saveState(); renderLotItems(); $('lotResult').hidden = true;
    });
    row.append(number, text, remove); list.appendChild(row);
  });
  if (!pool.items.length) {
    var empty = document.createElement('p'); empty.className = 'history-empty'; empty.textContent = '这个签筒还是空的，添加几条内容再来抽签吧。'; list.appendChild(empty);
  }
}
function createId(prefix) { return prefix + '_' + Date.now() + '_' + randomIndex(99999); }
function renderWheelSelect() {
  var select = $('wheelTemplateSelect'); select.textContent = '';
  state.wheels.forEach(function (wheel) {
    var option = document.createElement('option'); option.value = wheel.id; option.textContent = wheel.name; select.appendChild(option);
  });
  if (!state.wheels.some(function (wheel) { return wheel.id === activeWheel; })) activeWheel = state.wheels[0].id;
  select.value = activeWheel;
  $('deleteWheelBtn').disabled = state.wheels.length <= 1;
  renderWheelEditor();
}
function renderWheelEditor() {
  var wheel = activeWheelData(); if (!wheel) return;
  $('wheelTitleInput').value = wheel.name;
  $('deleteWheelBtn').disabled = state.wheels.length <= 1;
  var list = $('wheelItems'); list.textContent = '';
  wheel.items.forEach(function (item, index) {
    var row = document.createElement('div'); row.className = 'item-row';
    var number = document.createElement('span'); number.className = 'item-index'; number.textContent = String(index + 1).padStart(2, '0');
    var text = document.createElement('input'); text.className = 'item-edit-input'; text.type = 'text'; text.maxLength = 24; text.value = item; text.setAttribute('aria-label', '编辑转盘选项');
    text.addEventListener('change', function () {
      var value = text.value.trim(); if (!value) { text.value = wheel.items[index]; return; }
      wheel.items[index] = value; saveState(); drawWheel();
    });
    var remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', '删除转盘选项');
    remove.addEventListener('click', function () {
      wheel.items.splice(index, 1); saveState(); renderWheelEditor(); drawWheel(); $('wheelResult').hidden = true;
    });
    row.append(number, text, remove); list.appendChild(row);
  });
  drawWheel();
}
function drawWheel() {
  var wheel = activeWheelData(), canvas = $('wheelCanvas');
  if (!wheel || !canvas) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  var size = canvas.width, center = size / 2, radius = size / 2 - 5, count = Math.max(1, wheel.items.length);
  ctx.clearRect(0, 0, size, size);
  ctx.save(); ctx.translate(center, center);
  var shades = ['#f5f5f6', '#e6e6e9', '#d8d8dc', '#eeeeef', '#e0e0e3', '#fafafa'];
  for (var i = 0; i < count; i++) {
    var start = -Math.PI / 2 + i * Math.PI * 2 / count;
    var end = start + Math.PI * 2 / count;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, radius, start, end); ctx.closePath();
    ctx.fillStyle = shades[i % shades.length]; ctx.fill();
    ctx.strokeStyle = '#a5a5aa'; ctx.lineWidth = 2; ctx.stroke();
    var mid = (start + end) / 2;
    ctx.save(); ctx.rotate(mid); ctx.translate(radius * .65, 0); ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#333'; ctx.font = (count > 8 ? '22px' : '26px') + ' sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var label = String(wheel.items[i] || '').slice(0, 8);
    ctx.fillText(label, 0, 0, radius * .46);
    ctx.restore();
  }
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.strokeStyle = '#777'; ctx.lineWidth = 3; ctx.stroke();
  ctx.restore();
  canvas.style.transform = 'rotate(' + wheelRotation + 'deg)';
}
function saveWheelRotation() {
  var canvas = $('wheelCanvas');
  canvas.style.transition = 'none';
  canvas.style.transform = 'rotate(' + wheelRotation + 'deg)';
  void canvas.offsetWidth;
  canvas.style.transition = '';
}
function renderHistory() {
  var records = state.history.filter(function (entry) { return String(entry.roleId || '') === currentRoleId(); }).slice().reverse();
  $('historyCount').textContent = String(records.length);
  var list = $('historyList'); list.textContent = '';
  if (!records.length) {
    var empty = document.createElement('p'); empty.className = 'history-empty'; empty.textContent = '这里还没有记录。每一次小小的随机，都可以留在这里。'; list.appendChild(empty);
    return;
  }
  records.forEach(function (entry) {
    var row = document.createElement('article'); row.className = 'history-entry';
    var title = document.createElement('strong'); title.textContent = entry.game + ' · ' + entry.result;
    var meta = document.createElement('p');
    var date = new Date(entry.createdAt);
    meta.textContent = entry.roleName + ' · ' + date.toLocaleString();
    if (entry.detail) meta.textContent += ' · ' + entry.detail;
    row.append(title, meta); list.appendChild(row);
  });
}
function drawLot() {
  var pool = activePoolData();
  if (!pool || !pool.items.length) { showToast('先往签筒里添加至少一条内容。'); return; }
  var result = pool.items[randomIndex(pool.items.length)];
  $('lotResult').hidden = false;
  $('lotResultText').textContent = result;
  $('lotRoleReaction').textContent = selectedRole ? roleFallback('抽签') : '';
  $('lotVessel').classList.remove('shaking'); void $('lotVessel').offsetWidth; $('lotVessel').classList.add('shaking');
  $('drawLotBtn').disabled = true;
  setTimeout(function () {
    $('lotVessel').classList.remove('shaking'); $('drawLotBtn').disabled = false;
    askRole('抽签', result, 'lotRoleReaction');
  }, 1250);
  addHistory('抽签', result, pool.name);
}
function spinWheel() {
  var wheel = activeWheelData();
  if (!wheel || wheel.items.length < 2) { showToast('转盘至少需要两个选项。'); return; }
  if (wheelBusy) return;
  wheelBusy = true; $('spinWheelBtn').disabled = true; $('wheelResult').hidden = true;
  var index = randomIndex(wheel.items.length), step = 360 / wheel.items.length;
  var center = (index + .5) * step;
  var delta = (360 - ((wheelRotation + center) % 360) + 360) % 360;
  var target = wheelRotation + 360 * 6 + delta;
  var canvas = $('wheelCanvas');
  canvas.style.transition = 'transform 4.7s cubic-bezier(.12,.72,.08,1)';
  void canvas.offsetWidth;
  canvas.style.transform = 'rotate(' + target + 'deg)';
  var result = wheel.items[index];
  var settled = false;
  function finish() {
    if (settled) return; settled = true;
    wheelRotation = target; saveWheelRotation();
    $('wheelResultText').textContent = result; $('wheelResult').hidden = false;
    $('spinWheelBtn').disabled = false; wheelBusy = false;
    addHistory('大转盘', result, wheel.name);
    askRole('大转盘', result, 'wheelRoleReaction');
  }
  canvas.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 5200);
}
function addCardSvg() {
  return '<svg viewBox="0 0 160 270" aria-hidden="true"><polygon points="80,7 137,30 137,210 80,260 23,210 23,30"/><polygon points="80,19 126,38 126,204 80,244 34,204 34,38"/><path d="M80 19V244M34 38l46 52 46-52M34 204l46-61 46 61M80 90v53"/><circle cx="80" cy="132" r="23"/><path d="M80 98l9 34-9 36-9-36z"/></svg>';
}
function tarotPosition(index, count) { return count === 1 ? '此刻' : ['过去','现在','未来'][index]; }
function drawTarot() {
  var button = $('drawTarotBtn');
  if (button.disabled) return;
  button.disabled = true;
  $('tarotDeckScene').hidden = false;
  $('tarotDeckScene').classList.remove('shuffling');
  void $('tarotDeckScene').offsetWidth;
  $('tarotDeckScene').classList.add('shuffling');
  $('tarotHint').textContent = '正在洗牌……';
  setTimeout(function () {
    var count = Number($('tarotSpreadSelect').value) === 3 ? 3 : 1;
    var selected = shuffle(TAROT).slice(0, count).map(function (card) {
      return { roman:card[0], name:card[1], keywords:card[2], upright:card[3], reversed:card[4], glyph:card[5], reversedDraw:randomIndex(100)<30, revealed:false };
    });
    tarotDraw = selected;
    $('tarotDeckScene').classList.remove('shuffling');
    $('tarotDeckScene').hidden = true;
    $('tarotSpread').hidden = false;
    $('tarotReadings').hidden = false;
    $('tarotRoleReaction').hidden = true;
    $('tarotDisclaimer').hidden = false;
    $('tarotHint').textContent = '点击每一枚水晶牌，翻开它。';
    button.textContent = '重新洗牌抽取';
    button.disabled = false;
    renderTarotSpread();
    addHistory('塔罗', selected.map(function (card) { return card.name + (card.reversedDraw ? '（逆位）' : '（正位）'); }).join('、'), count === 1 ? '单张牌' : '过去 / 现在 / 未来');
  }, 780);
}
function renderTarotSpread() {
  var spread = $('tarotSpread'); spread.textContent = ''; spread.dataset.count = String(tarotDraw.length);
  tarotDraw.forEach(function (card, index) {
    var slot = document.createElement('div'); slot.className = 'tarot-card-slot';
    var position = document.createElement('p'); position.className = 'tarot-card-position'; position.textContent = tarotPosition(index, tarotDraw.length);
    var button = document.createElement('button'); button.type = 'button'; button.className = 'tarot-crystal-card' + (card.revealed ? ' is-flipped' : '');
    button.setAttribute('aria-label', card.revealed ? card.name : '翻开' + tarotPosition(index, tarotDraw.length) + '位置的水晶牌');
    var inner = document.createElement('span'); inner.className = 'tarot-flip-inner';
    var back = document.createElement('span'); back.className = 'tarot-face tarot-back'; back.innerHTML = addCardSvg();
    var front = document.createElement('span'); front.className = 'tarot-face tarot-front';
    var roman = document.createElement('span'); roman.className = 'tarot-roman'; roman.textContent = card.roman;
    var glyph = document.createElement('span'); glyph.className = 'tarot-glyph'; glyph.textContent = card.glyph;
    var name = document.createElement('span'); name.className = 'tarot-card-name'; name.textContent = card.name;
    var orientation = document.createElement('span'); orientation.className = 'tarot-orientation'; orientation.textContent = card.reversedDraw ? '逆位' : '正位';
    front.append(roman, glyph, name, orientation); inner.append(back, front); button.appendChild(inner);
    button.addEventListener('click', function () {
      if (card.revealed) return;
      card.revealed = true; renderTarotSpread(); renderTarotReadings();
      if (tarotDraw.every(function (item) { return item.revealed; })) {
        $('tarotHint').textContent = '牌面已经全部翻开。把它当作一个思考角度就好。';
        $('tarotRoleReaction').hidden = false;
        askRole('塔罗牌', tarotDraw.map(function (item, i) { return tarotPosition(i, tarotDraw.length) + '：' + item.name + (item.reversedDraw ? '逆位' : '正位'); }).join('；'), 'tarotRoleReaction');
      }
    });
    slot.append(position, button); spread.appendChild(slot);
  });
}
function renderTarotReadings() {
  var box = $('tarotReadings'); box.textContent = '';
  tarotDraw.forEach(function (card, index) {
    if (!card.revealed) return;
    var section = document.createElement('section'); section.className = 'tarot-reading';
    var kicker = document.createElement('small'); kicker.textContent = tarotPosition(index, tarotDraw.length) + ' · ' + (card.reversedDraw ? '逆位' : '正位');
    var title = document.createElement('h3'); title.textContent = card.name;
    var keywords = document.createElement('p'); keywords.textContent = '关键词：' + card.keywords;
    var meaning = document.createElement('p'); meaning.textContent = card.reversedDraw ? card.reversed : card.upright;
    section.append(kicker, title, keywords, meaning); box.appendChild(section);
  });
}
function drawDaily() {
  var item = DAILY[randomIndex(DAILY.length)];
  var score = 60 + randomIndex(41);
  $('dailyScore').textContent = String(score);
  $('dailyKeyword').textContent = '“' + item.keyword + '”';
  $('dailyHeadline').textContent = item.headline;
  $('dailyDescription').textContent = item.description;
  var categories = $('dailyCategories'); categories.textContent = '';
  item.categories.forEach(function (entry) {
    var node = document.createElement('div'); node.className = 'daily-category';
    var label = document.createElement('span'); label.textContent = entry[0];
    var value = document.createElement('strong'); value.textContent = entry[1];
    node.append(label, value); categories.appendChild(node);
  });
  $('dailyResult').hidden = false;
  $('dailyRoleReaction').textContent = selectedRole ? roleFallback('今日运势') : '';
  var resultText = score + ' · ' + item.keyword;
  addHistory('今日运势', resultText, item.headline);
  askRole('今日运势', resultText + '；趣味提示：' + item.description, 'dailyRoleReaction');
}
function renderInitial() {
  renderPoolSelect(); renderLotItems(); renderWheelSelect(); drawWheel(); renderHistory();
}
function toggleHistory(show) {
  $('historyDrawer').hidden = !show;
  if (show) renderHistory();
}
document.querySelectorAll('.play-tab').forEach(function (button) {
  button.addEventListener('click', function () { setTab(button.dataset.tab); });
});
$('roleSelect').addEventListener('change', function () {
  roleRequestToken++;
  selectedRole = roles.find(function (role) { return String(role.id) === this.value; }, this) || null;
  saveSettings(); renderRoleOptions(); renderHistory();
});
$('lotPoolSelect').addEventListener('change', function () {
  activePool = this.value; renderLotItems(); $('lotResult').hidden = true;
});
$('lotPoolTitleInput').addEventListener('change', function () {
  var pool = activePoolData(), value = this.value.trim();
  if (!pool || !value) { this.value = pool ? pool.name : ''; return; }
  pool.name = value; saveState(); renderPoolSelect();
});
$('deleteLotPoolBtn').addEventListener('click', function () {
  if (state.pools.length <= 1) return;
  state.pools = state.pools.filter(function (pool) { return pool.id !== activePool; });
  activePool = state.pools[0].id; saveState(); renderPoolSelect(); renderLotItems();
  $('lotResult').hidden = true; showToast('签筒已删除。');
});
$('wheelTemplateSelect').addEventListener('change', function () {
  activeWheel = this.value; renderWheelEditor(); $('wheelResult').hidden = true;
});
$('deleteWheelBtn').addEventListener('click', function () {
  if (state.wheels.length <= 1) return;
  state.wheels = state.wheels.filter(function (wheel) { return wheel.id !== activeWheel; });
  activeWheel = state.wheels[0].id; wheelRotation = 0; saveState(); renderWheelSelect();
  $('wheelResult').hidden = true; showToast('转盘模板已删除。');
});
$('addLotForm').addEventListener('submit', function (event) {
  event.preventDefault(); var value = $('newLotItem').value.trim(), pool = activePoolData();
  if (!value || !pool) return;
  pool.items.push(value); $('newLotItem').value = ''; saveState(); renderLotItems();
});
$('newLotPoolForm').addEventListener('submit', function (event) {
  event.preventDefault(); var name = $('newLotPoolName').value.trim();
  if (!name) return;
  var pool = { id:createId('pool'), name:name, items:[] };
  state.pools.push(pool); activePool = pool.id; $('newLotPoolName').value = '';
  saveState(); renderPoolSelect(); renderLotItems(); showToast('新签筒已创建。');
});
$('drawLotBtn').addEventListener('click', drawLot);
$('wheelTitleInput').addEventListener('change', function () {
  var wheel = activeWheelData(); if (!wheel) return;
  var value = this.value.trim(); if (value) wheel.name = value;
  saveState(); renderWheelSelect();
});
$('addWheelForm').addEventListener('submit', function (event) {
  event.preventDefault(); var value = $('newWheelItem').value.trim(), wheel = activeWheelData();
  if (!value || !wheel) return;
  if (wheel.items.length >= 12) { showToast('为了保证转盘标签清晰，最多添加 12 项。'); return; }
  wheel.items.push(value); $('newWheelItem').value = ''; saveState(); renderWheelEditor();
});
$('newWheelForm').addEventListener('submit', function (event) {
  event.preventDefault(); var name = $('newWheelName').value.trim();
  if (!name) return;
  var wheel = { id:createId('wheel'), name:name, items:['选项一','选项二','选项三','选项四'] };
  state.wheels.push(wheel); activeWheel = wheel.id; $('newWheelName').value = '';
  saveState(); renderWheelSelect(); showToast('新转盘模板已创建。');
});
$('spinWheelBtn').addEventListener('click', spinWheel);
$('drawTarotBtn').addEventListener('click', drawTarot);
$('dailyDrawBtn').addEventListener('click', drawDaily);
$('historyToggle').addEventListener('click', function () { toggleHistory(true); });
$('closeHistory').addEventListener('click', function () { toggleHistory(false); });
$('historyDrawer').addEventListener('click', function (event) {
  if (event.target === $('historyDrawer')) toggleHistory(false);
});
$('clearHistoryBtn').addEventListener('click', function () {
  var roleId = currentRoleId();
  state.history = state.history.filter(function (entry) { return String(entry.roleId || '') !== roleId; });
  saveState(); renderHistory(); showToast('当前视图的记录已清除。');
});
loadState(); loadRoles(); renderInitial();
})();