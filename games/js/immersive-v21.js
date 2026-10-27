/* ============================================================
   immersive-v21.js
   沉浸式多人侦探查案流程 V.21
   步骤链：开场 → 现场 → 证物 → 人物 → 盘问 → 推理板 → 指认 → 结案
   不修改现有自由调查逻辑，独立挂载入口
   ============================================================ */
(function () {
  if (window.__imm_v21_loaded) return;
  window.__imm_v21_loaded = true;

  /* ---------- 样式注入 ---------- */
  var STYLE = '' +
  '.imm-root{position:absolute;top:0;left:0;width:100%;height:100%;overflow-y:auto;background:#1a1a1f;color:#f2f1ee;font-family:var(--sans,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-overflow-scrolling:smooth;z-index:50;}' +
  '.imm-root *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}' +
  '.imm-kicker{font-size:9px;letter-spacing:.35em;color:#9a9aa2;text-transform:uppercase;font-weight:400;}' +
  '.imm-title{font-family:var(--serif,Georgia,"Songti SC","Noto Serif CJK SC",serif);font-size:24px;line-height:1.25;font-weight:500;margin:10px 0 6px;letter-spacing:-.01em;}' +
  '.imm-sub{font-size:12px;line-height:1.8;color:#9a9aa2;}' +
  '.imm-btn{display:block;width:100%;padding:15px 16px;background:#f2f1ee;color:#1a1a1f;border:0;font-size:12px;letter-spacing:.2em;cursor:pointer;text-align:center;font-weight:500;}' +
  '.imm-btn:active{opacity:.85;}' +
  '.imm-btn.ghost{background:transparent;color:#f2f1ee;border:1px solid rgba(255,255,255,.25);}' +
  '.imm-btn.danger{background:#8b3a3a;color:#fff;}' +
  '.imm-back{font-size:11px;color:#9a9aa2;background:rgba(0,0,0,.25);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.15);cursor:pointer;padding:7px 14px;letter-spacing:.05em;}' +

  /* 顶部栏 */
  '.imm-topbar{position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;padding:calc(12px + env(safe-area-inset-top)) 16px 10px;background:rgba(26,26,31,.7);backdrop-filter:blur(12px);z-index:15;border-bottom:1px solid rgba(255,255,255,.08);}' +
  '.imm-topbar .t{font-size:11px;letter-spacing:.25em;color:rgba(255,255,255,.85);}' +

  /* 底部步骤导航 */
  '.imm-stepnav{position:sticky;bottom:0;background:rgba(20,20,28,.85);backdrop-filter:blur(12px);border-top:1px solid rgba(255,255,255,.1);padding:10px 16px calc(10px + env(safe-area-inset-bottom));display:flex;align-items:center;justify-content:space-between;z-index:20;}' +
  '.imm-stepnav .dots{display:flex;gap:6px;align-items:center;}' +
  '.imm-stepnav .dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.2);}' +
  '.imm-stepnav .dot.on{background:#e8c9a0;width:20px;border-radius:3px;}' +
  '.imm-stepnav .dot.done{background:rgba(255,255,255,.5);}' +
  '.imm-stepnav .label{font-size:10px;color:#9a9aa2;letter-spacing:.15em;}' +

  /* 01 开场 */
  '.imm-opening{background:radial-gradient(ellipse at 50% 20%,#2e2a35,#13131a 80%);color:#f2f1ee;display:flex;flex-direction:column;justify-content:space-between;padding:calc(40px + env(safe-area-inset-top)) 28px calc(40px + env(safe-area-inset-bottom));min-height:100%;min-height:100vh;}' +
  '.imm-opening .top{display:flex;justify-content:space-between;align-items:center;}' +
  '.imm-opening .case-no{font-size:10px;letter-spacing:.35em;color:#9a9aa2;}' +
  '.imm-opening .middle{flex:1;display:flex;flex-direction:column;justify-content:center;}' +
  '.imm-opening h1{font-family:var(--serif,Georgia,"Songti SC",serif);font-size:38px;line-height:1.15;font-weight:500;margin:18px 0 24px;letter-spacing:-.02em;}' +
  '.imm-opening h1 em{font-style:normal;color:#e8c9a0;}' +
  '.imm-opening .meta{font-size:11px;line-height:2.2;color:#9a9aa2;}' +
  '.imm-opening .atmosphere{margin-top:36px;padding-top:24px;border-top:1px solid rgba(255,255,255,.1);font-size:13px;line-height:2.1;color:#b0b0b8;font-style:italic;}' +
  '.imm-opening .enter{background:#f2f1ee;color:#1a1a1f;border:0;padding:16px;font-size:12px;letter-spacing:.3em;cursor:pointer;width:100%;font-weight:500;}' +

  /* 现场线索底部抽屉 */
  '.imm-sheet{position:sticky;bottom:0;background:rgba(20,20,28,.92);backdrop-filter:blur(16px);border-top:1px solid rgba(255,255,255,.15);padding:18px 20px calc(18px + env(safe-area-inset-bottom));z-index:30;}' +
  '.imm-sheet .sheet-kicker{font-size:9px;letter-spacing:.25em;color:#e8c9a0;text-transform:uppercase;}' +
  '.imm-sheet h3{font-family:var(--serif,Georgia,"Songti SC",serif);font-size:18px;margin:8px 0 10px;line-height:1.4;font-weight:500;}' +
  '.imm-sheet p{font-size:12px;line-height:1.9;color:#b0b0b8;margin:0 0 14px;}' +
  '.imm-sheet .found-badge{display:inline-block;font-size:9px;letter-spacing:.2em;color:#e8c9a0;border:1px solid #e8c9a0;padding:4px 10px;margin-bottom:8px;}' +

  /* 02 现场 */
  '.imm-scene-wrap{padding:0 16px 16px;}' +
  '.imm-scene-top{display:flex;justify-content:space-between;align-items:center;margin:14px 0 10px;}' +
  '.imm-scene-art{position:relative;width:100%;aspect-ratio:4/5;max-height:460px;overflow:hidden;border:1px solid rgba(255,255,255,.15);background:#0a0e18;}' +
  '.imm-scene-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;}' +
  '.imm-scene-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#4a4a55;font-size:11px;letter-spacing:.2em;}' +
  '.imm-hot{position:absolute;width:34px;height:34px;border-radius:50%;border:1.5px solid #f2f1ee;background:rgba(10,10,20,.6);backdrop-filter:blur(4px);color:#f2f1ee;font-size:10px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:5;}' +
  '.imm-hot.found{background:#e8c9a0;border-color:#e8c9a0;color:#1a1a1f;}' +
  '.imm-scene-foot{display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:11px;color:#9a9aa2;}' +

  /* 03 证物 */
  '.imm-ev-list{padding:16px;display:flex;flex-direction:column;gap:10px;}' +
  '.imm-ev-card{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);padding:16px;cursor:pointer;}' +
  '.imm-ev-card.found{border-left:3px solid #e8c9a0;}' +
  '.imm-ev-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;}' +
  '.imm-ev-num{font-size:10px;color:#9a9aa2;letter-spacing:.2em;}' +
  '.imm-ev-title{font-family:var(--serif,Georgia,"Songti SC",serif);font-size:15px;font-weight:500;margin-top:5px;line-height:1.4;}' +
  '.imm-ev-status{font-size:10px;color:#9a9aa2;white-space:nowrap;letter-spacing:.1em;}' +
  '.imm-ev-card.found .imm-ev-status{color:#e8c9a0;}' +
  '.imm-ev-detail{display:none;margin-top:12px;padding-top:12px;border-top:1px dashed rgba(255,255,255,.12);font-size:12px;line-height:1.9;color:#b0b0b8;}' +
  '.imm-ev-card.open .imm-ev-detail{display:block;}' +

  /* 04 人物 */
  '.imm-su-list{padding:16px;display:flex;flex-direction:column;gap:10px;}' +
  '.imm-su-card{display:flex;gap:14px;align-items:center;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);padding:16px;cursor:pointer;}' +
  '.imm-su-card:active{border-color:rgba(255,255,255,.4);}' +
  '.imm-su-avatar{width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#3a3540,#1a1a24);display:flex;align-items:center;justify-content:center;font-family:var(--serif,Georgia,serif);font-size:18px;font-weight:500;color:#e8c9a0;flex-shrink:0;border:1px solid rgba(255,255,255,.15);}' +
  '.imm-su-name{font-family:var(--serif,Georgia,"Songti SC",serif);font-size:16px;font-weight:500;}' +
  '.imm-su-job{font-size:10px;color:#9a9aa2;margin-top:4px;letter-spacing:.1em;}' +
  '.imm-su-tag{margin-left:auto;font-size:9px;letter-spacing:.15em;color:#e8c9a0;}' +
  '.imm-su-tag.muted{color:#9a9aa2;}' +

  /* 05 盘问 */
  '.imm-intro-head{margin:16px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);padding:16px;display:flex;align-items:center;gap:14px;}' +
  '.imm-dialogue{padding:0 16px;display:flex;flex-direction:column;gap:12px;min-height:200px;}' +
  '.imm-bubble{max-width:85%;padding:13px 15px;font-size:13px;line-height:1.8;}' +
  '.imm-bubble.them{align-self:flex-start;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);}' +
  '.imm-bubble.me{align-self:flex-end;background:rgba(232,201,160,.15);border:1px solid rgba(232,201,160,.3);color:#f2f1ee;}' +
  '.imm-bubble .who{font-size:9px;letter-spacing:.15em;color:#9a9aa2;margin-bottom:6px;}' +
  '.imm-opts{padding:16px;display:flex;flex-direction:column;gap:8px;}' +
  '.imm-opt{text-align:left;background:rgba(20,20,28,.92);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.2);padding:14px 16px;font-size:13px;cursor:pointer;color:#f2f1ee;line-height:1.5;}' +
  '.imm-opt:active{background:#f2f1ee;color:#1a1a1f;}' +

  /* 06 推理板 */
  '.imm-board{margin:16px;border:1px solid rgba(255,255,255,.15);background:linear-gradient(180deg,#2a2420,#1e1a16);min-height:340px;padding:18px;position:relative;}' +
  '.imm-board-hint{font-size:10px;color:#9a9aa2;letter-spacing:.15em;margin-bottom:14px;}' +
  '.imm-pin{position:relative;background:#f2f1ee;color:#1c1b18;padding:12px 14px;margin-bottom:10px;font-size:11px;line-height:1.6;box-shadow:2px 3px 8px rgba(0,0,0,.3);transform:rotate(-.5deg);}' +
  '.imm-pin:before{content:"";position:absolute;top:-5px;left:50%;transform:translateX(-50%);width:10px;height:10px;border-radius:50%;background:#8b3a3a;box-shadow:0 2px 4px rgba(0,0,0,.3);}' +
  '.imm-pin .t{font-weight:600;font-size:12px;display:block;margin-bottom:4px;font-family:var(--serif,Georgia,serif);}' +
  '.imm-board-figs{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;}' +
  '.imm-fig{width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-family:var(--serif,Georgia,serif);font-size:14px;font-weight:500;color:#e8c9a0;}' +

  /* 07 指认 */
  '.imm-accuse-wrap{padding:16px;}' +
  '.imm-accuse-q{font-size:13px;margin:20px 0 10px;color:#9a9aa2;}' +
  '.imm-accuse-opt{display:block;width:100%;text-align:left;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);padding:16px;margin-bottom:8px;cursor:pointer;color:#f2f1ee;}' +
  '.imm-accuse-opt.sel{border:2px solid #e8c9a0;background:rgba(232,201,160,.1);}' +
  '.imm-accuse-opt .n{font-size:10px;color:#9a9aa2;letter-spacing:.2em;}' +
  '.imm-accuse-opt .nm{font-family:var(--serif,Georgia,"Songti SC",serif);font-size:16px;font-weight:500;margin-top:5px;}' +
  '.imm-accuse-opt .jb{font-size:10px;color:#9a9aa2;margin-top:3px;}' +

  /* 08 结案 */
  '.imm-verdict{padding:40px 24px 60px;background:linear-gradient(180deg,#1a1a24,#0a0a10);min-height:100%;}' +
  '.imm-verdict .verdict-badge{display:inline-block;padding:6px 14px;border:1px solid #e8c9a0;color:#e8c9a0;font-size:10px;letter-spacing:.3em;margin-bottom:20px;}' +
  '.imm-verdict h2{font-family:var(--serif,Georgia,"Songti SC",serif);font-size:28px;margin:10px 0 20px;font-weight:500;}' +
  '.imm-verdict p{font-size:13px;line-height:2.1;color:#b0b0b8;margin-bottom:16px;}' +
  '.imm-verdict .truth{background:rgba(255,255,255,.05);border-left:3px solid #e8c9a0;padding:16px;margin:20px 0;font-size:12px;line-height:2;color:#b0b0b8;}' +

  /* 档案室入口模式标签 */
  '.case-imm-mode-tag{display:block;margin-top:10px;font-size:9px;letter-spacing:.2em;color:#9a9aa2;text-align:right;cursor:pointer;}' +
  '.case-imm-mode-tag:hover{color:#e8c9a0;}' +

  /* ===== 动画 ===== */
  '@keyframes immFadeUp{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}' +
  '@keyframes immPulse{0%,100%{box-shadow:0 0 0 0 rgba(232,201,160,.5);}50%{box-shadow:0 0 0 8px rgba(232,201,160,0);}}' +
  '@keyframes immSheetUp{from{transform:translateY(100%);}to{transform:translateY(0);}}' +
  '@keyframes immFadeIn{from{opacity:0;}to{opacity:1;}}' +
  '@keyframes immShake{0%,100%{transform:rotate(-1.2deg);}50%{transform:rotate(1deg);}}' +

  '.imm-root>*{animation:immFadeUp .45s cubic-bezier(.2,.8,.2,1) both;}' +
  '.imm-root>*:nth-child(2){animation-delay:.06s;}' +
  '.imm-root>*:nth-child(3){animation-delay:.12s;}' +
  '.imm-root>*:nth-child(4){animation-delay:.18s;}' +
  '.imm-root>*:nth-child(5){animation-delay:.24s;}' +

  /* 现场未发现的热点呼吸 */
  '.imm-hot{animation:immPulse 2s ease-in-out infinite;transition:transform .15s,background .2s;}' +
  '.imm-hot:active{transform:scale(.88);}' +
  '.imm-hot.found{animation:none;}' +

  /* 所有按钮按下去 */
  '.imm-root button{transition:transform .12s,opacity .15s;}' +
  '.imm-root button:active{transform:scale(.97);opacity:.85;}' +

  /* 对话气泡滑入 */
  '.imm-bubble{animation:immFadeUp .35s ease-out both;}' +

  /* 便签轻微晃动 */
  '.imm-pin{animation:immShake 4s ease-in-out infinite;}' +
  '';

  function injectStyle() {
    var s = document.createElement('style');
    s.id = 'imm-v21-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  /* ---------- 状态 ---------- */
  var IMM = {
    caseIndex: 0,
    step: 0,
    revealed: {},
    interviewed: {},
    asked: {},
    openPins: {},
    activeSuspect: -1,
    dialogue: [],
    accusation: -1,
    accused: false,
    currentHotspot: -1,
    corkOpen: false
  };

  var STEPS = ['开场', '现场', '证物', '人物', '盘问', '推理', '指认', '结案'];

  function c() { return window.CASES[IMM.caseIndex]; }
  function esc(t) {
    if (window.esc) return window.esc(t);
    return String(t == null ? '' : t).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ---------- 入口：从档案室打开沉浸式 ---------- */
  function openImmersive(idx) {
    try {
      IMM.caseIndex = idx;
      IMM.step = 0;
      IMM.revealed = {};
      IMM.interviewed = {};
      IMM.asked = {};
      IMM.openPins = {};
      IMM.activeSuspect = -1;
      IMM.dialogue = [];
      IMM.accusation = -1;
      IMM.accused = false;
      IMM.currentHotspot = -1;
      IMM.corkOpen = false;
      document.body.classList.add('detective-case-mode');
      // 隐藏旧游戏外壳元素（标题/搭档行/底部按钮/角色台词）
      ['detectiveVersionBadge','roleQuote','gameHeadingWrap','partnerLineWrap'].forEach(function(id){
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      // 隐藏 game-heading 和 partner-line 和底部 btn-row（它们没有固定id，用选择器找）
      document.querySelectorAll('.game-heading,.partner-line,.role-quote').forEach(function(el){
        el.style.display = 'none';
      });
      // 底部再玩一局/换一款游戏按钮行
      document.querySelectorAll('#gameContent + .btn-row, section .btn-row').forEach(function(el){
        if (el.querySelector('#restartGame,#toLobbyFromGame')) el.style.display = 'none';
      });
      render();
    } catch (err) {
      alert('沉浸式启动失败：' + err.message + '\n\n' + err.stack);
    }
  }

  // 退出沉浸式时恢复旧游戏外壳
  function restoreShell() {
    document.body.classList.remove('detective-case-mode');
    ['detectiveVersionBadge','roleQuote','gameHeadingWrap','partnerLineWrap'].forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    document.querySelectorAll('.game-heading,.partner-line,.role-quote').forEach(function(el){
      el.style.display = '';
    });
    document.querySelectorAll('section .btn-row').forEach(function(el){
      if (el.querySelector('#restartGame,#toLobbyFromGame')) el.style.display = '';
    });
  }

  /* ---------- 搭档对话条 ---------- */
  function getPartner() {
    try {
      if (typeof window.detectiveParty !== 'function') return null;
      var team = window.detectiveParty();
      if (!team || !team.length) return null;
      var p = team[0];
      var name = (typeof window.roleName === 'function') ? window.roleName(p) : (p.name || p.roleName || '搭档');
      return { name: name, color: p.color || p.hex || '#e8c9a0' };
    } catch (e) { return null; }
  }

  function getTeam() {
    try {
      if (typeof window.detectiveParty !== 'function') return [];
      var team = window.detectiveParty() || [];
      return team.slice(0, 3).map(function(p){
        var name = (typeof window.roleName === 'function') ? window.roleName(p) : (p.name || p.roleName || '队员');
        return { name: name, color: p.color || p.hex || '#e8c9a0' };
      });
    } catch (e) { return []; }
  }

  function partnerLine() {
    var cc = c();
    var found = Object.keys(IMM.revealed).length;
    var inter = Object.keys(IMM.interviewed).length;
    // 根据当前步骤和进度给一句台词
    var lines = {
      1: found === 0 ? '现场我已经初步看过了，你点那些发光的位置，咱们挨个查。'
        : found < cc.evidence.length ? '已经找到' + found + '条了，继续点剩下的位置。'
        : '现场线索都齐了，去见相关的人吧。',
      2: '证物都在这了，点卡片看细节。我们交叉核对一下时间。',
      3: inter === 0 ? '选一个人，先聊聊看。别急着下结论。'
        : inter < cc.suspects.length ? '已经问过' + inter + '个人了，还有没问的。'
        : '人都问过了，去推理板把线索拼起来。',
      4: '他说的话你注意听，有矛盾的地方后面拿证物对质。',
      5: '把时间线和人物对照着看，哪里对不上，就是突破口。',
      6: '想清楚再指认，证据链要闭合。'
    };
    return lines[IMM.step] || '嗯。';
  }

  function renderPartnerBar() {
    var p = getPartner();
    if (!p) return document.createTextNode('');
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:10px;align-items:flex-start;padding:12px 16px;background:rgba(0,0,0,.35);border-bottom:1px solid rgba(255,255,255,.06);;backdrop-filter:blur(8px);animation:immFadeUp .4s ease-out both;';
    bar.innerHTML =
      '<div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,' + p.color + ',#1a1a24);border:1px solid rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#1a1a1f;flex-shrink:0;">' + esc(p.name.charAt(0)) + '</div>' +
      '<div style="flex:1;min-width:0;">' +
      '  <div style="font-size:10px;color:' + p.color + ';letter-spacing:.1em;margin-bottom:2px;">' + esc(p.name) + ' · 搭档</div>' +
      '  <div style="font-size:12px;line-height:1.7;color:#c8c8d0;">' + esc(partnerLine()) + '</div>' +
      '</div>';
    return bar;
  }

  /* ---------- 主渲染 ---------- */
  function render() {
    var root = document.createElement('div');
    root.id = 'immRoot';
    root.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;overflow-y:auto;overflow-x:hidden;background:#13131a;color:#f2f1ee;font-family:Georgia,"Songti SC",serif;-webkit-font-smoothing:antialiased;';
    if (IMM.step !== 0) root.appendChild(renderPartnerBar());
    root.appendChild(renderStep());

    // 底部步骤导航（开场页不显示，因为是全屏氛围）
    if (IMM.step !== 0) {
      root.appendChild(renderStepNav());
    }

    var gc = document.getElementById('gameContent');
    gc.innerHTML = '';
    gc.appendChild(root);
    bind();
    root.scrollTop = 0;
  }

  function renderStepNav() {
    var nav = document.createElement('div');
    nav.style.cssText = 'position:sticky;bottom:0;background:rgba(20,20,28,.92);backdrop-filter:blur(12px);border-top:1px solid rgba(255,255,255,.1);padding:10px 16px 10px;display:flex;align-items:center;justify-content:space-between;z-index:20;';
    var dots = '';
    for (var i = 0; i < STEPS.length; i++) {
      var bg = i === IMM.step ? '#e8c9a0' : (i < IMM.step ? 'rgba(255,255,255,.5)' : 'rgba(255,255,255,.2)');
      var w = i === IMM.step ? '20px' : '6px';
      dots += '<span style="width:' + w + ';height:6px;border-radius:3px;background:' + bg + ';display:inline-block;"></span>';
    }
    nav.innerHTML =
      '<span style="font-size:10px;color:#9a9aa2;letter-spacing:.15em;">' + STEPS[IMM.step] + ' · ' + (IMM.step + 1) + '/' + STEPS.length + '</span>' +
      '<div style="display:flex;gap:6px;align-items:center;">' + dots + '</div>';
    return nav;
  }

  function renderStep() {
    switch (IMM.step) {
      case 0: return tplOpening();
      case 1: return tplScene();
      case 2: return tplEvidence();
      case 3: return tplSuspects();
      case 4: return tplInterrogate();
      case 5: return tplDeduction();
      case 6: return tplAccuse();
      case 7: return tplVerdict();
    }
    return document.createElement('div');
  }

  /* ---------- 01 开场 ---------- */
  function tplOpening() {
    var caseNo = String(IMM.caseIndex + 1).padStart(2, '0');
    var cc = c();
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;top:0;left:0;width:100%;min-height:100%;color:#f2f1ee;display:flex;flex-direction:column;justify-content:space-between;padding:40px 28px 40px;box-sizing:border-box;background:linear-gradient(180deg,rgba(10,10,16,.55) 0%,rgba(10,10,16,.75) 50%,rgba(10,10,16,.92) 100%),url("assets/tidal-archive-room-v21.jpg") center/cover no-repeat fixed;';
    wrap.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
      '  <span style="font-size:10px;letter-spacing:.35em;color:#9a9aa2;">CASE FILE / NO.' + caseNo + '</span>' +
      '  <span style="font-size:10px;letter-spacing:.35em;color:#9a9aa2;">IMMERSIVE</span>' +
      '</div>' +
      '<div style="flex:1;display:flex;flex-direction:column;justify-content:center;">' +
      '  <div style="font-size:9px;letter-spacing:.4em;color:#9a9aa2;text-transform:uppercase;margin-bottom:14px;">INVESTIGATION BRIEF</div>' +
      '  <h1 style="font-family:Georgia,\'Songti SC\',serif;font-size:38px;line-height:1.15;font-weight:500;margin:18px 0 24px;letter-spacing:-.02em;">' + esc(cc.title) + '</h1>' +
      '  <div style="font-size:11px;line-height:2.2;color:#9a9aa2;">' +
      '    案发地点 · 见案件简介<br>' +
      '    死亡时间 · 见现场勘查<br>' +
      '    相关人员 · ' + cc.suspects.length + ' 人<br>' +
      '    现场线索 · ' + cc.evidence.length + ' 条' +
      '  </div>' +
      '  <div style="margin-top:36px;padding-top:24px;border-top:1px solid rgba(255,255,255,.1);font-size:13px;line-height:2.1;color:#b0b0b8;font-style:italic;">"' + esc(cc.intro) + '"</div>' +
      '</div>' +
      '<div>' +
      '  <button data-act="enter" style="width:100%;padding:16px;background:#f2f1ee;color:#1a1a1f;border:0;font-size:12px;letter-spacing:.3em;cursor:pointer;font-weight:500;">踏 入 现 场 →</button>' +
      '  <button data-act="back-archive" style="color:#9a9aa2;margin-top:12px;background:none;border:0;cursor:pointer;width:100%;font-size:11px;letter-spacing:.1em;padding:8px;">返回档案室</button>' +
      '</div>';
    return wrap;
  }

  /* ---------- 共用内联样式片段 ---------- */
  var S = {
    back: 'font-size:11px;color:#9a9aa2;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.15);cursor:pointer;padding:7px 14px;margin:16px 16px 0;font-family:inherit;',
    kicker: 'font-size:9px;letter-spacing:.35em;color:#e8c9a0;text-transform:uppercase;',
    h: 'font-family:Georgia,"Songti SC",serif;font-size:22px;font-weight:500;margin:10px 0 6px;letter-spacing:-.01em;',
    sub: 'font-size:12px;line-height:1.8;color:#9a9aa2;',
    btn: 'display:block;width:100%;padding:15px 16px;background:#f2f1ee;color:#1a1a1f;border:0;font-size:12px;letter-spacing:.2em;cursor:pointer;text-align:center;font-weight:500;font-family:inherit;box-sizing:border-box;',
    btnGhost: 'display:block;width:100%;padding:14px 16px;background:transparent;color:#f2f1ee;border:1px solid rgba(255,255,255,.25);font-size:12px;letter-spacing:.2em;cursor:pointer;text-align:center;font-family:inherit;box-sizing:border-box;',
    btnDanger: 'display:block;width:100%;padding:15px 16px;background:#8b3a3a;color:#fff;border:0;font-size:12px;letter-spacing:.2em;cursor:pointer;text-align:center;font-weight:500;font-family:inherit;box-sizing:border-box;',
    page: 'padding:0 0 30px;min-height:100%;box-sizing:border-box;'
  };

  /* ---------- 02 现场 ---------- */
  function tplScene() {
    var cc = c();
    var found = Object.keys(IMM.revealed).length;
    var spots = [[18, 22], [68, 18], [40, 45], [78, 52], [25, 68], [55, 75], [85, 30]];
    var imgHtml = IMM.caseIndex === 0
      ? '<img src="assets/tidal-archive-room-v21.jpg" alt="现场" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;">'
      : '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#4a4a55;font-size:11px;letter-spacing:.2em;">CRIME SCENE · 现场已封存</div>';
    var wrap = document.createElement('div');
    wrap.style.cssText = S.page;
    var allFound = found >= cc.evidence.length;
    wrap.innerHTML =
      '<button style="' + S.back + '" data-act="back-step">‹ 返回</button>' +
      '<div style="margin:14px 16px 10px;display:flex;justify-content:space-between;align-items:center;">' +
      '  <div><div style="' + S.kicker + '">SCENE / 01</div><div style="' + S.h + ';font-size:18px;">案发现场</div></div>' +
      '  <div style="' + S.kicker + '">' + esc(cc.title) + '</div>' +
      '</div>' +
      '<div style="margin:0 16px;position:relative;width:calc(100% - 32px);aspect-ratio:4/5;max-height:460px;overflow:hidden;border:1px solid rgba(255,255,255,.15);background:#0a0e18;">' + imgHtml +
      cc.evidence.map(function (ev, i) {
        var p = spots[i % spots.length];
        var f = IMM.revealed[i];
        return '<button data-hot="' + i + '" style="position:absolute;width:34px;height:34px;border-radius:50%;border:1.5px solid ' + (f ? '#e8c9a0' : '#f2f1ee') + ';background:' + (f ? '#e8c9a0' : 'rgba(10,10,20,.6)') + ';color:' + (f ? '#1a1a1f' : '#f2f1ee') + ';font-size:10px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:5;font-family:inherit;left:' + p[0] + '%;top:' + p[1] + '%;">' +
          (f ? '✓' : String(i + 1).padStart(2, '0')) + '</button>';
      }).join('') +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin:12px 16px;font-size:11px;color:#9a9aa2;">' +
      '  <span>点击发光编号 · 勘查对应位置</span>' +
      '  <strong style="color:#e8c9a0;">' + found + ' / ' + cc.evidence.length + ' 已确认</strong>' +
      '</div>';

    if (IMM.currentHotspot >= 0) {
      var ev = cc.evidence[IMM.currentHotspot];
      wrap.innerHTML +=
        '<div style="position:sticky;bottom:0;background:rgba(20,20,28,.95);backdrop-filter:blur(16px);border-top:1px solid rgba(255,255,255,.15);padding:18px 20px 20px;z-index:30;margin-top:16px;animation:immSheetUp .35s cubic-bezier(.2,.8,.2,1) both;">' +
        '  <span style="display:inline-block;font-size:9px;letter-spacing:.2em;color:#e8c9a0;border:1px solid #e8c9a0;padding:4px 10px;margin-bottom:8px;">已发现线索 0' + (IMM.currentHotspot + 1) + '</span>' +
        '  <div style="' + S.kicker + '">EVIDENCE FOUND</div>' +
        '  <h3 style="font-family:Georgia,serif;font-size:18px;margin:8px 0 10px;line-height:1.4;font-weight:500;">' + esc(ev.title) + '</h3>' +
        '  <p style="font-size:12px;line-height:1.9;color:#b0b0b8;margin:0 0 14px;">' + esc(ev.detail) + '</p>' +
        '  <button style="' + S.btn + '" data-act="close-sheet">继续勘查现场 →</button>' +
        '</div>';
    } else if (allFound) {
      wrap.innerHTML +=
        '<div style="position:sticky;bottom:0;background:rgba(20,20,28,.95);backdrop-filter:blur(16px);border-top:1px solid rgba(255,255,255,.15);padding:18px 20px 20px;z-index:30;margin-top:16px;animation:immSheetUp .35s cubic-bezier(.2,.8,.2,1) both;">' +
        '  <div style="' + S.kicker + '">SCENE CLEAR</div>' +
        '  <h3 style="font-family:Georgia,serif;font-size:18px;margin:8px 0 10px;font-weight:500;">现场已勘查完毕</h3>' +
        '  <p style="font-size:12px;line-height:1.9;color:#b0b0b8;margin:0 0 14px;">所有位置都检查过了。带着这些线索，去见相关人员吧。</p>' +
        '  <button style="' + S.btn + '" data-act="goto-suspects">见相关人员 →</button>' +
        '</div>';
    }
    return wrap;
  }

  /* ---------- 03 证物 ---------- */
  function tplEvidence() {
    var cc = c();
    var wrap = document.createElement('div');
    wrap.style.cssText = S.page;
    wrap.innerHTML =
      '<button style="' + S.back + '" data-act="back-step">‹ 返回</button>' +
      '<div style="margin:14px 16px 0;"><div style="' + S.kicker + '">EVIDENCE / 02</div>' +
      '<div style="' + S.h + '">证物档案</div>' +
      '<div style="' + S.sub + ';margin-bottom:14px;">点击卡片展开检验细节。</div></div>' +
      '<div style="padding:0 16px;display:flex;flex-direction:column;gap:10px;">' +
      cc.evidence.map(function (ev, i) {
        var f = IMM.revealed[i];
        return '<div data-ev="' + i + '" style="border:1px solid rgba(255,255,255,.12);border-left:' + (f ? '3px solid #e8c9a0' : '1px solid rgba(255,255,255,.12)') + ';background:rgba(255,255,255,.04);padding:16px;cursor:pointer;box-sizing:border-box;">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">' +
          '  <div><div style="font-size:10px;color:#9a9aa2;letter-spacing:.2em;">证物 0' + (i + 1) + '</div>' +
          '  <div style="font-family:Georgia,serif;font-size:15px;font-weight:500;margin-top:5px;line-height:1.4;">' + esc(ev.title) + '</div></div>' +
          '  <span style="font-size:10px;color:' + (f ? '#e8c9a0' : '#9a9aa2') + ';white-space:nowrap;letter-spacing:.1em;">' + (f ? '已确认' : '待勘查') + '</span>' +
          '</div>' +
          (f ? '<div style="margin-top:12px;padding-top:12px;border-top:1px dashed rgba(255,255,255,.12);font-size:12px;line-height:1.9;color:#b0b0b8;">' + esc(ev.detail) + '</div>' : '') +
          '</div>';
      }).join('') +
      '</div>' +
      '<div style="padding:20px 16px 0;"><button style="' + S.btn + '" data-act="goto-suspects">继续 · 见相关人员 →</button></div>';
    return wrap;
  }

  /* ---------- 04 人物 ---------- */
  function tplSuspects() {
    var cc = c();
    var wrap = document.createElement('div');
    wrap.style.cssText = S.page;
    wrap.innerHTML =
      '<button style="' + S.back + '" data-act="back-step">‹ 返回</button>' +
      '<div style="margin:14px 16px 0;"><div style="' + S.kicker + '">PERSONS / 03</div>' +
      '<div style="' + S.h + '">相关人员</div>' +
      '<div style="' + S.sub + ';margin-bottom:14px;">选择一人，进入盘问。</div></div>' +
      '<div style="padding:0 16px;display:flex;flex-direction:column;gap:10px;">' +
      cc.suspects.map(function (s, i) {
        var inter = IMM.interviewed[i];
        return '<div data-su="' + i + '" style="display:flex;gap:14px;align-items:center;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);padding:16px;cursor:pointer;box-sizing:border-box;">' +
          '<div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#3a3540,#1a1a24);display:flex;align-items:center;justify-content:center;font-family:Georgia,serif;font-size:18px;font-weight:500;color:#e8c9a0;flex-shrink:0;border:1px solid rgba(255,255,255,.15);">' + esc(s.name.charAt(0)) + '</div>' +
          '<div><div style="font-family:Georgia,serif;font-size:16px;font-weight:500;">' + esc(s.name) + '</div>' +
          '<div style="font-size:10px;color:#9a9aa2;margin-top:4px;letter-spacing:.1em;">' + esc(s.job) + '</div></div>' +
          '<span style="margin-left:auto;font-size:9px;letter-spacing:.15em;color:' + (inter ? '#e8c9a0' : '#9a9aa2') + ';">' + (inter ? '已盘问' : '待盘问') + '</span>' +
          '</div>';
      }).join('') +
      '</div>' +
      '<div style="padding:20px 16px 0;"><button style="' + S.btnGhost + '" data-act="goto-deduction">进入推理板 →</button></div>';
    return wrap;
  }

  /* ---------- 05 盘问 ---------- */
  function tplInterrogate() {
    var cc = c();
    var si = IMM.activeSuspect;
    if (si < 0) return tplSuspects();
    var s = cc.suspects[si];
    var interviews = (typeof window.CASE_INTERVIEWS !== 'undefined' && window.CASE_INTERVIEWS[IMM.caseIndex]) ? window.CASE_INTERVIEWS[IMM.caseIndex] : [];
    var baseText = (interviews[si] && interviews[si].text) ? interviews[si].text : '（暂无证词记录）';
    if (!IMM.interviewed[si]) {
      IMM.interviewed[si] = true;
      IMM.dialogue = [{ who: s.name, me: false, text: baseText }];
    } else if (IMM.dialogue.length === 0) {
      IMM.dialogue = [{ who: s.name, me: false, text: baseText }];
    }
    var wrap = document.createElement('div');
    wrap.style.cssText = S.page;
    wrap.innerHTML =
      '<button style="' + S.back + '" data-act="exit-interview">‹ 返回人物</button>' +
      '<div style="margin:14px 16px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);padding:16px;display:flex;align-items:center;gap:14px;box-sizing:border-box;">' +
      '<div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#3a3540,#1a1a24);display:flex;align-items:center;justify-content:center;font-family:Georgia,serif;font-size:18px;font-weight:500;color:#e8c9a0;border:1px solid rgba(255,255,255,.15);">' + esc(s.name.charAt(0)) + '</div>' +
      '<div><div style="' + S.kicker + '">INTERROGATION</div>' +
      '<div style="font-family:Georgia,serif;font-size:16px;font-weight:500;margin-top:2px;">' + esc(s.name) + ' · ' + esc(s.job) + '</div></div>' +
      '</div>' +
      '<div style="padding:16px;display:flex;flex-direction:column;gap:12px;min-height:200px;">' +
      IMM.dialogue.map(function (b) {
        return '<div style="max-width:85%;padding:13px 15px;font-size:13px;line-height:1.8;align-self:' + (b.me ? 'flex-end' : 'flex-start') + ';background:' + (b.me ? 'rgba(232,201,160,.15)' : 'rgba(255,255,255,.06)') + ';border:1px solid ' + (b.me ? 'rgba(232,201,160,.3)' : 'rgba(255,255,255,.12)') + ';box-sizing:border-box;">' +
          '<div style="font-size:9px;letter-spacing:.15em;color:#9a9aa2;margin-bottom:6px;">' + (b.me ? '你' : esc(b.who)) + '</div>' +
          esc(b.text) + '</div>';
      }).join('') +
      '</div>' +
      (function(){
        var qs = [
          {q:0, t:'「请再说明一遍你当晚的行踪。」'},
          {q:1, t:'「你最后一次见到死者是什么时候？」'},
          {q:2, t:'「关于三年前那次事故，你知道多少？」'}
        ];
        var btns = qs.filter(function(it){ return !IMM.asked[si + '_' + it.q]; }).map(function(it){
          return '<button data-q="' + it.q + '" style="text-align:left;background:rgba(20,20,28,.92);border:1px solid rgba(255,255,255,.2);padding:14px 16px;font-size:13px;cursor:pointer;color:#f2f1ee;line-height:1.5;font-family:inherit;">' + it.t + '</button>';
        }).join('');
        if (btns === '') btns = '<div style="padding:14px 16px;font-size:11px;color:#666;line-height:1.7;text-align:center;">该人可问的都问完了。</div>';
        return '<div style="padding:0 16px 20px;display:flex;flex-direction:column;gap:8px;">' + btns + '</div>';
      })();
    return wrap;
  }

  /* ---------- 06 推理板 ---------- */
  function tplDeduction() {
    var cc = c();
    var revealedKeys = Object.keys(IMM.revealed).map(Number).sort(function(a,b){return a-b;});
    var interviewedCount = Object.keys(IMM.interviewed).length;
    var totalEv = cc.evidence.length;
    var totalSu = cc.suspects.length;

    function extractTime(text) {
      var m = text.match(/(?:[^0-9])([0-2]?\d:[0-5]\d)/);
      return m ? m[1] : null;
    }

    // 时间线
    var timelineItems = revealedKeys.map(function(i){
      var ev = cc.evidence[i];
      return { t: extractTime(ev.detail) || '···', title: ev.title, i: i };
    }).sort(function(a,b){
      var ta = (a.t === '···') ? '99:99' : a.t;
      var tb = (b.t === '···') ? '99:99' : b.t;
      return ta.localeCompare(tb);
    });

    var timelineHtml = timelineItems.length
      ? timelineItems.map(function(it, idx){
          var isLast = idx === timelineItems.length - 1;
          var isOpen = IMM.openPins[it.i];
          return '<div style="display:flex;gap:12px;padding-bottom:' + (isLast ? '0' : '14px') + ';">' +
            '<div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;width:38px;">' +
            '  <div style="font-size:11px;color:#e8c9a0;font-weight:600;font-family:Georgia,serif;margin-bottom:6px;">' + it.t + '</div>' +
            '  <div style="width:10px;height:10px;border-radius:50%;background:' + (isOpen ? '#f2f1ee' : '#e8c9a0') + ';box-shadow:0 0 0 3px rgba(232,201,160,.2);flex-shrink:0;"></div>' +
            (isLast ? '' : '<div style="width:1px;flex:1;background:rgba(232,201,160,.25);margin-top:4px;"></div>') +
            '</div>' +
            '<div style="flex:1;padding-top:1px;">' +
            '  <button data-pin="' + it.i + '" style="text-align:left;background:none;border:0;padding:0;margin:0;cursor:pointer;color:#f2f1ee;font-family:Georgia,serif;font-size:12px;line-height:1.5;width:100%;">' + esc(it.title) + (isOpen ? ' ▾' : ' ▸') + '</button>' +
            (isOpen ? '<div style="margin-top:6px;padding:10px 12px;background:rgba(232,201,160,.06);border-left:2px solid #e8c9a0;font-size:11px;line-height:1.8;color:#b0b0b8;">' + esc(cc.evidence[it.i].detail) + '</div>' : '') +
            '</div>' +
            '</div>';
        }).join('')
      : '<div style="font-size:11px;color:#666;line-height:1.8;padding:6px 0;">还没有时间线。先去现场勘查线索。</div>';

    // 团队讨论：每个队员根据已掌握线索给一句
    var team = getTeam();
    var suspectSuspicion = {}; // 每个人被怀疑次数
    cc.suspects.forEach(function(_, i){ suspectSuspicion[i] = 0; });

    var teamComments = team.map(function(m, mi){
      // 每个队员轮流对当前时间线做一句评论
      var lines;
      if (revealedKeys.length === 0) {
        lines = [m.name + '：现场还没开始查，先别下结论。'];
      } else if (revealedKeys.length < totalEv) {
        lines = [
          m.name + '：目前手里的线索还拼不全，时间线上有断点。',
          m.name + '：这条记录对得上，但还缺关键那一环。',
          m.name + '：我注意到时间对不上，先记下来。'
        ];
      } else {
        // 所有线索齐了，队员指向真凶
        var ans = cc.answer;
        var ansName = cc.suspects[ans].name;
        lines = [
          m.name + '：把门禁、服务器、巡查记录放在一起，指向的只有' + ansName + '。',
          m.name + '：其他人的时间线都说得通，唯独' + ansName + '的说法对不上。',
          m.name + '：证据链闭合了，我同意——是' + ansName + '。'
        ];
        suspectSuspicion[ans] += 1;
      }
      var line = lines[mi % lines.length];
      return '<div style="display:flex;gap:10px;margin-bottom:10px;animation:immFadeUp .4s ease-out both;animation-delay:' + (mi * .1) + 's;">' +
        '<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,' + m.color + ',#1a1a24);border:1px solid rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#1a1a1f;flex-shrink:0;">' + esc(m.name.charAt(0)) + '</div>' +
        '<div style="flex:1;padding:8px 12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);font-size:12px;line-height:1.7;color:#d0d0d8;border-radius:2px;">' + esc(line) + '</div>' +
        '</div>';
    }).join('');

    // 人物卡片（优化：显示被怀疑数）
    var peopleHtml = cc.suspects.map(function(s, i){
      var inter = IMM.interviewed[i];
      var susp = suspectSuspicion[i] || 0;
      var highlight = revealedKeys.length === totalEv && i === cc.answer;
      return '<button data-su-ask="' + i + '" style="flex:1;min-width:0;border:1px solid ' + (highlight ? '#e8c9a0' : (inter ? 'rgba(232,201,160,.35)' : 'rgba(255,255,255,.12)')) + ';background:' + (highlight ? 'rgba(232,201,160,.12)' : (inter ? 'rgba(232,201,160,.06)' : 'rgba(255,255,255,.04)')) + ';padding:12px 8px;text-align:center;box-sizing:border-box;cursor:pointer;color:inherit;font-family:inherit;">' +
        '<div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#3a3540,#1a1a24);border:1px solid ' + (highlight ? '#e8c9a0' : 'rgba(232,201,160,.4)') + ';display:flex;align-items:center;justify-content:center;margin:0 auto 8px;font-family:Georgia,serif;font-size:16px;color:#e8c9a0;' + (highlight ? 'box-shadow:0 0 12px rgba(232,201,160,.4);' : '') + '">' + esc(s.name.charAt(0)) + '</div>' +
        '<div style="font-size:12px;font-weight:500;font-family:Georgia,serif;">' + esc(s.name) + '</div>' +
        '<div style="font-size:9px;color:#9a9aa2;margin-top:3px;line-height:1.4;">' + esc(s.job) + '</div>' +
        '<div style="margin-top:6px;font-size:9px;letter-spacing:.05em;color:' + (highlight ? '#e8c9a0' : (inter ? '#e8c9a0' : '#666')) + ';">' + (highlight ? '⚠ 全队怀疑' : (inter ? '● 已盘问' : '○ 点此盘问')) + '</div>' +
        '</button>';
    }).join('');

    // cork board 便签（可点击展开）
    var pinsHtml = revealedKeys.length
      ? revealedKeys.map(function(i, idx){
          var ev = cc.evidence[i];
          var rot = (idx % 2 === 0 ? -1.2 : 1.0);
          var isOpen = IMM.openPins[i];
          return '<button data-pin="' + i + '" style="display:block;width:100%;background:#f2e8c9;color:#2a2418;padding:12px 14px;margin-bottom:10px;font-size:11px;line-height:1.6;box-shadow:2px 3px 8px rgba(0,0,0,.4);transform:rotate(' + rot + 'deg);position:relative;cursor:pointer;text-align:left;border:0;font-family:Georgia,serif;">' +
            '<div style="position:absolute;top:-5px;left:50%;transform:translateX(-50%);width:8px;height:8px;border-radius:50%;background:#8b3a3a;box-shadow:0 1px 2px rgba(0,0,0,.4);pointer-events:none;"></div>' +
            '<div style="font-weight:600;font-size:11px;display:block;margin-bottom:4px;color:#1a1a1f;">' + esc(ev.title) + '</div>' +
            (isOpen
              ? '<span style="color:#4a4438;">' + esc(ev.detail) + '</span>'
              : '<span style="color:#4a4438;">' + esc(ev.detail.slice(0, 55)) + (ev.detail.length > 55 ? '… 展开' : '') + '</span>') +
            '</button>';
        }).join('')
      : '<div style="font-size:11px;color:#666;line-height:1.8;">回到现场勘查，线索会钉在这里。</div>';

    // 证据链完成度
    var pct = Math.round(revealedKeys.length / totalEv * 100);

    var wrap = document.createElement('div');
    wrap.style.cssText = S.page;
    wrap.innerHTML =
      '<button style="' + S.back + '" data-act="back-step">‹ 返回</button>' +
      '<div style="margin:14px 16px 0;"><div style="' + S.kicker + '">DEDUCTION / 04</div>' +
      '<div style="' + S.h + '">推理板</div>' +
      '<div style="' + S.sub + ';margin-bottom:12px;">点时间线或便签看详情，点人物卡直接盘问。</div></div>' +

      // 证据链进度
      '<div style="margin:0 16px 16px;padding:12px 14px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.1);">' +
      '  <div style="display:flex;justify-content:space-between;font-size:10px;color:#9a9aa2;letter-spacing:.1em;margin-bottom:8px;">' +
      '    <span>证据链 PROGRESS</span>' +
      '    <span style="color:#e8c9a0;">' + revealedKeys.length + ' / ' + totalEv + ' 线索 · ' + interviewedCount + ' / ' + totalSu + ' 人盘问</span>' +
      '  </div>' +
      '  <div style="width:100%;height:4px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden;">' +
      '    <div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#8b3a3a,#e8c9a0);"></div>' +
      '  </div>' +
      '</div>' +

      // 时间线
      '<div style="margin:0 16px 16px;border:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.25);padding:16px;box-sizing:border-box;">' +
      '  <div style="font-size:9px;letter-spacing:.25em;color:#9a9aa2;margin-bottom:14px;">TIMELINE / 当晚时间线</div>' +
      timelineHtml +
      '</div>' +

      // 小队讨论
      '<div style="margin:0 16px 16px;border:1px solid rgba(232,201,160,.2);background:rgba(232,201,160,.04);padding:16px;box-sizing:border-box;">' +
      '  <div style="font-size:9px;letter-spacing:.25em;color:#e8c9a0;margin-bottom:14px;">TEAM DISCUSSION / 小队讨论</div>' +
      teamComments +
      (revealedKeys.length === totalEv ? '<div style="margin-top:12px;padding:10px 12px;background:rgba(139,58,58,.15);border:1px solid rgba(139,58,58,.4);font-size:11px;color:#e8c9a0;line-height:1.7;">📋 全队意见一致：证据链已闭合，可以指认。</div>' : '') +
      '</div>' +

      // 人物
      '<div style="margin:0 16px 16px;">' +
      '  <div style="font-size:9px;letter-spacing:.25em;color:#9a9aa2;margin-bottom:10px;">PERSONS / 相关人员</div>' +
      '  <div style="display:flex;gap:8px;">' + peopleHtml + '</div>' +
      '</div>' +

      '<div style="padding:20px 16px 0;"><button style="' + S.btnDanger + '" data-act="goto-accuse">指认凶手 →</button></div>' +

      // 右下角浮动便签按钮
      '<button data-act="toggle-cork" style="position:fixed;right:16px;bottom:80px;z-index:40;width:52px;height:52px;border-radius:50%;background:#8b3a3a;color:#fff;border:2px solid #e8c9a0;font-size:20px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;">📌</button>' +

      // 便签弹层
      (IMM.corkOpen ?
        '<div data-act="toggle-cork" style="position:fixed;inset:0;z-index:45;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);" data-cork-bg>' +
          '<div data-cork-panel style="position:absolute;bottom:0;left:0;right:0;max-height:70vh;overflow-y:auto;background:linear-gradient(180deg,#3a2e24,#2a2018);padding:20px 18px calc(20px + env(safe-area-inset-bottom));animation:immSheetUp .3s cubic-bezier(.2,.8,.2,1) both;border-top:1px solid rgba(232,201,160,.3);">' +
          '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
          '    <div style="font-size:10px;letter-spacing:.25em;color:#c9a96a;">CORK BOARD / 证物便签</div>' +
          '    <button data-act="toggle-cork" style="background:none;border:1px solid rgba(255,255,255,.2);color:#9a9aa2;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:14px;">×</button>' +
          '  </div>' +
          pinsHtml +
          '</div>' +
        '</div>'
      : '');
    return wrap;
  }

  /* ---------- 07 指认 ---------- */
  function tplAccuse() {
    var cc = c();
    var wrap = document.createElement('div');
    wrap.style.cssText = S.page;
    wrap.innerHTML =
      '<button style="' + S.back + '" data-act="back-step">‹ 返回</button>' +
      '<div style="margin:14px 16px 0;"><div style="' + S.kicker + '">ACCUSATION / 05</div>' +
      '<div style="' + S.h + '">最终指认</div>' +
      '<div style="' + S.sub + ';margin-bottom:14px;">你认为谁是真凶？</div></div>' +
      '<div style="padding:0 16px;">' +
      cc.suspects.map(function (s, i) {
        var sel = IMM.accusation === i;
        return '<button data-acc="' + i + '" style="display:block;width:100%;text-align:left;background:' + (sel ? 'rgba(232,201,160,.1)' : 'rgba(255,255,255,.04)') + ';border:' + (sel ? '2px solid #e8c9a0' : '1px solid rgba(255,255,255,.12)') + ';padding:16px;margin-bottom:8px;cursor:pointer;color:#f2f1ee;box-sizing:border-box;font-family:inherit;">' +
          '<div style="font-size:10px;color:#9a9aa2;letter-spacing:.2em;">嫌疑人 0' + (i + 1) + '</div>' +
          '<div style="font-family:Georgia,serif;font-size:16px;font-weight:500;margin-top:5px;">' + esc(s.name) + '</div>' +
          '<div style="font-size:10px;color:#9a9aa2;margin-top:3px;">' + esc(s.job) + '</div>' +
          '</button>';
      }).join('') +
      '<div style="font-size:13px;margin:20px 0 10px;color:#9a9aa2;">作案动机（骨架）：</div>' +
      '<button data-motive="0" style="display:block;width:100%;text-align:left;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);padding:14px;margin-bottom:6px;cursor:pointer;color:#f2f1ee;box-sizing:border-box;font-family:inherit;"><div style="font-size:10px;color:#9a9aa2;letter-spacing:.2em;">MOTIVE A</div><div style="font-family:Georgia,serif;font-size:14px;font-weight:500;margin-top:4px;">隐瞒过往失职</div></button>' +
      '<button data-motive="1" style="display:block;width:100%;text-align:left;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);padding:14px;margin-bottom:6px;cursor:pointer;color:#f2f1ee;box-sizing:border-box;font-family:inherit;"><div style="font-size:10px;color:#9a9aa2;letter-spacing:.2em;">MOTIVE B</div><div style="font-family:Georgia,serif;font-size:14px;font-weight:500;margin-top:4px;">掩盖真实行踪</div></button>' +
      '<button data-motive="2" style="display:block;width:100%;text-align:left;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);padding:14px;margin-bottom:6px;cursor:pointer;color:#f2f1ee;box-sizing:border-box;font-family:inherit;"><div style="font-size:10px;color:#9a9aa2;letter-spacing:.2em;">MOTIVE C</div><div style="font-family:Georgia,serif;font-size:14px;font-weight:500;margin-top:4px;">销毁关键证据</div></button>' +
      '</div>' +
      '<div style="padding:20px 16px 0;"><button style="' + S.btnDanger + '" data-act="submit-accusation" ' + (IMM.accusation < 0 ? 'disabled' : '') + '>提交指控' + (IMM.accusation < 0 ? '（请先选嫌疑人）' : '') + '</button></div>';
    return wrap;
  }

  /* ---------- 08 结案 ---------- */
  function tplVerdict() {
    var cc = c();
    var correct = IMM.accusation === cc.answer;

    // 注入盖章动画
    if (!document.getElementById('immStampStyle')) {
      var st = document.createElement('style');
      st.id = 'immStampStyle';
      st.textContent =
        '@keyframes immStampDrop { 0% { transform: translateY(-260px) rotate(-30deg) scale(1.6); opacity: 0; } 60% { transform: translateY(0) rotate(-14deg) scale(.95); opacity: 1; } 75% { transform: translateY(-8px) rotate(-14deg) scale(1.02); } 100% { transform: translateY(0) rotate(-14deg) scale(1); opacity: 1; } }' +
        '@keyframes immStampRing { 0% { box-shadow: 0 0 0 0 rgba(139,58,58,.6); } 100% { box-shadow: 0 0 0 16px rgba(139,58,58,0); } }';
      document.head.appendChild(st);
    }

    // 记录已结案
    try {
      var done = JSON.parse(localStorage.getItem('immCasesDone') || '[]');
      if (done.indexOf(IMM.caseIndex) < 0) { done.push(IMM.caseIndex); localStorage.setItem('immCasesDone', JSON.stringify(done)); }
    } catch (e) {}

    var wrap = document.createElement('div');
    wrap.style.cssText = 'padding:40px 24px 60px;background:linear-gradient(180deg,#1a1a24,#0a0a10);min-height:100%;box-sizing:border-box;position:relative;';
    wrap.innerHTML =
      // 盖章：右上角 absolute，从天而降，盖完停住
      '<div style="position:absolute;top:70px;right:20px;z-index:5;pointer-events:none;">' +
      '  <div style="width:100px;height:100px;border:4px solid #8b3a3a;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#8b3a3a;font-family:Georgia,"Songti SC",serif;animation:immStampDrop .7s cubic-bezier(.3,1.5,.5,1) .4s both, immStampRing .5s ease-out .7s both;opacity:0;">' +
      '    <div style="font-size:16px;font-weight:700;letter-spacing:.2em;">已结案</div>' +
      '    <div style="width:32px;height:1px;background:#8b3a3a;margin:5px 0;"></div>' +
      '    <div style="font-size:8px;letter-spacing:.1em;">' + (correct ? '指认正确' : '指认有误') + '</div>' +
      '  </div>' +
      '</div>' +

      '<span style="display:inline-block;padding:6px 14px;border:1px solid #e8c9a0;color:#e8c9a0;font-size:10px;letter-spacing:.3em;margin-bottom:20px;">' + (correct ? 'CASE CLOSED / 指认正确' : 'CASE CLOSED / 指认有误') + '</span>' +
      '<div style="' + S.kicker + '">VERDICT / 最终报告</div>' +
      '<h2 style="font-family:Georgia,serif;font-size:26px;margin:10px 0 20px;font-weight:500;color:#f2f1ee;">' + esc(cc.title) + '</h2>' +
      '<p style="font-size:13px;line-height:2.1;color:#b0b0b8;margin-bottom:16px;">' + esc(cc.story || cc.intro) + '</p>' +
      '<div style="background:rgba(255,255,255,.05);border-left:3px solid #e8c9a0;padding:16px;margin:20px 0;font-size:12px;line-height:2;color:#b0b0b8;">' +
      '  <div style="' + S.kicker + ';margin-bottom:8px;">TRUTH / 真相</div>' +
      esc(cc.truth || cc.explain || '') +
      '</div>' +
      '<p style="font-size:13px;line-height:2.1;color:#b0b0b8;margin-bottom:16px;">' + esc(cc.motive || '') + '</p>' +
      '<p style="font-size:13px;line-height:2.1;color:#b0b0b8;margin-bottom:24px;">' + esc(cc.aftermath || '') + '</p>' +
      '<button style="' + S.btn + '" data-act="back-archive">返回档案室</button>' +
      '<button style="' + S.btnGhost + ';margin-top:10px;" data-act="replay">重新调查本案</button>';
    return wrap;
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    var root = document.getElementById('immRoot');
    if (!root) return;

    // 事件委托
    root.onclick = function (e) {
      var t = e.target;
      var act = t.getAttribute('data-act');
      if (act) { handleAct(act); return; }
      // 点便签弹层内部不关闭
      var corkPanel = t.closest ? t.closest('[data-cork-panel]') : null;
      if (corkPanel) {
        // 但点便签本身要展开收起
        var pin = t.closest ? t.closest('[data-pin]') : null;
        if (pin) {
          var pi = Number(pin.getAttribute('data-pin'));
          IMM.openPins[pi] = !IMM.openPins[pi];
          render();
        }
        return;
      }
      // 推理板：点便签/时间线展开收起
      var pin = t.closest ? t.closest('[data-pin]') : null;
      if (pin) {
        var pi = Number(pin.getAttribute('data-pin'));
        IMM.openPins[pi] = !IMM.openPins[pi];
        render();
        return;
      }
      // 推理板：点人物卡直接盘问
      var suAsk = t.closest ? t.closest('[data-su-ask]') : null;
      if (suAsk) {
        IMM.activeSuspect = Number(suAsk.getAttribute('data-su-ask'));
        IMM.step = 4;
        render();
        return;
      }
      var hot = t.getAttribute('data-hot');
      if (hot != null) {
        IMM.revealed[Number(hot)] = true;
        IMM.currentHotspot = Number(hot);
        render();
        return;
      }
      var ev = t.closest('[data-ev]');
      if (ev) {
        var i = Number(ev.getAttribute('data-ev'));
        IMM.revealed[i] = true;
        ev.classList.toggle('open');
        return;
      }
      var su = t.closest('[data-su]');
      if (su) {
        IMM.activeSuspect = Number(su.getAttribute('data-su'));
        IMM.step = 4;
        render();
        return;
      }
      var q = t.getAttribute('data-q');
      if (q != null) { handleQuestion(Number(q)); return; }
      var acc = t.closest('[data-acc]');
      if (acc) { IMM.accusation = Number(acc.getAttribute('data-acc')); render(); return; }
      if (t.getAttribute('data-motive')) { t.classList.toggle('sel'); return; }
    };
  }

  function handleAct(act) {
    switch (act) {
      case 'enter': IMM.step = 1; break;
      case 'back-step': IMM.step = Math.max(0, IMM.step - 1); IMM.currentHotspot = -1; break;
      case 'toggle-cork': IMM.corkOpen = !IMM.corkOpen; break;
      case 'close-sheet': IMM.currentHotspot = -1; break;
      case 'goto-evidence': IMM.step = 2; break;
      case 'goto-suspects': IMM.step = 3; break;
      case 'goto-deduction': IMM.step = 5; break;
      case 'goto-accuse': IMM.step = 6; break;
      case 'exit-interview': IMM.step = 3; break;
      case 'submit-accusation': IMM.step = 7; break;
      case 'replay': openImmersive(IMM.caseIndex); return;
      case 'back-archive': restoreShell(); window.startCase(); return;
    }
    render();
  }

  function handleQuestion(q) {
    var cc = c();
    var s = cc.suspects[IMM.activeSuspect];
    var safeReplies = [
      '「我当时一直在自己的位置上，没有离开。」' + s.name + '低声说。',
      '「死者？最后一次见是在傍晚，一切看起来都正常。」',
      '「三年前的事……我以为早就结案了。」',
      '「我没什么可说的，你们去查别的人吧。」'
    ];
    IMM.dialogue.push({ who: '你', me: true, text: ['请再说明一遍你当晚的行踪。', '你最后一次见到死者是什么时候？', '关于三年前那次事故，你知道多少？', '拿出证物对质'][q] });
    IMM.dialogue.push({ who: s.name, me: false, text: safeReplies[q] });
    IMM.asked[IMM.activeSuspect + '_' + q] = true;
    render();
    // 滚动到底部
    var root = document.getElementById('immRoot');
    if (root) root.scrollTop = root.scrollHeight;
  }

  /* ---------- 档案室入口注入 ---------- */
  function injectArchiveEntry() {
    var list = document.getElementById('caseArchiveList');
    if (!list) return;
    // 清理旧注入
    $all('.case-imm-mode-tag,.imm-done-badge', list).forEach(function (b) { b.remove(); });
    var done = [];
    try { done = JSON.parse(localStorage.getItem('immCasesDone') || '[]'); } catch (e) {}
    $all('.case-archive-item', list).forEach(function (item) {
      if (item.disabled) return;
      var idx = Number(item.getAttribute('data-open-case'));
      // 在卡片底部加一个"自由调查模式"的小字链接，保留旧入口
      var oldLink = document.createElement('span');
      oldLink.className = 'case-imm-mode-tag';
      oldLink.setAttribute('data-old-case', idx);
      oldLink.textContent = '自由调查模式 ›';
      item.appendChild(oldLink);
      // 已结案标记
      if (done.indexOf(idx) >= 0) {
        var badge = document.createElement('span');
        badge.className = 'imm-done-badge';
        badge.textContent = '已结案';
        badge.style.cssText = 'position:absolute;top:10px;right:10px;padding:3px 9px;border:1.5px solid #8b3a3a;color:#8b3a3a;font-size:9px;letter-spacing:.2em;border-radius:2px;transform:rotate(6deg);background:rgba(255,255,255,.85);font-weight:600;';
        item.style.position = item.style.position || 'relative';
        item.appendChild(badge);
      }
    });
  }

  /* ---------- 初始化 ---------- */
  function init() {
    injectStyle();
    console.log('[immersive-v21] init');

    // openCase 是 IIFE 内部局部函数，window.openCase 覆盖无效。
    // 用 document 捕获阶段拦截：点卡片进沉浸式，点"自由调查模式"小字走旧逻辑。
    document.addEventListener('click', function (e) {
      var oldTag = e.target.closest ? e.target.closest('.case-imm-mode-tag') : null;
      if (oldTag) return; // 不拦截，让事件冒泡到卡片按钮 → 触发旧 openCase
      var card = e.target.closest ? e.target.closest('.case-archive-item[data-open-case]') : null;
      if (card && !card.disabled) {
        e.stopPropagation();
        e.preventDefault();
        console.log('[immersive-v21] 拦截案件卡片，进沉浸式', card.getAttribute('data-open-case'));
        openImmersive(Number(card.getAttribute('data-open-case')));
      }
    }, true);

    // 档案室渲染后，给每个案件卡片加"自由调查模式"小字和"已结案"标
    function tagArchive() {
      var list = document.getElementById('caseArchiveList');
      if (!list) return;
      var done = [];
      try { done = JSON.parse(localStorage.getItem('immCasesDone') || '[]'); } catch (e) {}
      var items = list.querySelectorAll('.case-archive-item');
      items.forEach(function (item) {
        if (item.disabled) return;
        if (!item.querySelector('.case-imm-mode-tag')) {
          var oldLink = document.createElement('span');
          oldLink.className = 'case-imm-mode-tag';
          oldLink.textContent = '自由调查模式 ›';
          item.appendChild(oldLink);
        }
        var idx = Number(item.getAttribute('data-open-case'));
        if (done.indexOf(idx) >= 0 && !item.querySelector('.imm-done-badge')) {
          item.style.position = item.style.position || 'relative';
          var badge = document.createElement('span');
          badge.className = 'imm-done-badge';
          badge.textContent = '已结案';
          badge.style.cssText = 'position:absolute;top:10px;right:10px;padding:3px 9px;border:1.5px solid #8b3a3a;color:#8b3a3a;font-size:9px;letter-spacing:.2em;border-radius:2px;transform:rotate(6deg);background:rgba(255,255,255,.85);font-weight:600;';
          item.appendChild(badge);
        }
      });
    }

    var gc = document.getElementById('gameContent');
    if (gc && window.MutationObserver) {
      var mo = new MutationObserver(function () { tagArchive(); });
      mo.observe(gc, { childList: true, subtree: true });
    }
    setInterval(tagArchive, 800);

    window.openImmersiveCase = openImmersive;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
