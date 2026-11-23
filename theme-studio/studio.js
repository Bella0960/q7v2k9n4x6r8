/* Mobile-first workbench: drafts are never persisted until Apply. */
(function () {
  'use strict';
  var api = window.MAOMAOThemeStudio;
  var BUBBLE = [
    ['myBubbleBg','我的气泡颜色','color','#111111'],
    ['myBubbleColor','我的文字颜色','color','#FFFFFF'],
    ['partnerBubbleBg','对方气泡颜色','color','#FFFFFF'],
    ['partnerBubbleColor','对方文字颜色','color','#111111'],
    ['bubbleMaxWidth','气泡最大宽度','number',86,45,95,'%'],
    ['myBubbleRadiusSize','我的气泡圆角','number',15,0,35,'px'],
    ['partnerBubbleRadiusSize','对方气泡圆角','number',15,0,35,'px'],
    ['myBubblePadding','我的气泡间距','number',10,4,28,'px'],
    ['partnerBubblePadding','对方气泡间距','number',10,4,28,'px'],
    ['myBubbleTailSize','我的气泡尾巴','number',0,0,16,'px'],
    ['partnerBubbleTailSize','对方气泡尾巴','number',0,0,16,'px'],
    ['avatarSize','头像大小','number',30,20,54,'px']
  ];
  var LIST = [
    ['headerBg','顶部背景'],['listBg','列表背景'],['itemBg','卡片背景'],
    ['textColor','昵称颜色'],['itemRadius','卡片圆角'],['itemGap','卡片间距'],
    ['avatarRadius','头像圆角'],['titleSize','昵称字号']
  ];
  var DETAIL = [
    ['headerBg','顶部背景'],['headerText','标题颜色'],['headerSize','标题字号'],
    ['chatBg','聊天背景'],['composerBg','底部背景'],['inputBg','输入框背景'],
    ['inputRadius','输入框圆角'],['sendBg','发送按钮颜色']
  ];
  var state = api.read();
  var drafts = { list: api.clean('list',state.list), detail: api.clean('detail',state.detail), bubble: {} };
  // Per-scope in-memory bubble drafts: switching role never silently discards an
  // unsaved draft for the previous role, and it is never written to the other role's
  // applied ChatBeauty config.
  var bubbleDrafts = {};
  // Last successfully applied values — the baseline for dirty comparison. Saving a
  // preset does not clear it; a failed apply does not clear it either.
  var applied = { list: api.clean('list',state.list), detail: api.clean('detail',state.detail), bubble: {} };
  var tab = 'list', scope = 'global', noticeTimer;
  var HISTORY_LIMIT = 30;
  var history = {};
  var pendingBefore = null;
  var $ = function (id) { return document.getElementById(id); };
  function toast(message) {
    var el = $('notice');
    el.textContent = message; el.classList.add('show');
    clearTimeout(noticeTimer); noticeTimer = setTimeout(function(){el.classList.remove('show');},2600);
  }
  function bubbleValue(field, input) {
    var fallback=field[3], value=input && input[field[0]];
    if (field[2]==='color') return typeof value==='string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
    if (value === null || value === '' || !Number.isFinite(Number(value))) return fallback;
    return Math.min(field[5],Math.max(field[4],Number(value)));
  }
  function cleanBubble(raw) {
    var obj={}; BUBBLE.forEach(function(field){obj[field[0]]=bubbleValue(field,raw);}); return obj;
  }
  function resolveBubbleApplied(scopeId) {
    var beauty=window.ChatBeauty;
    var config=beauty && beauty.resolve ? beauty.resolve(scopeId==='global'?null:scopeId) : {};
    return cleanBubble(config);
  }
  function loadBubble() {
    drafts.bubble = bubbleDrafts[scope] ? cleanBubble(bubbleDrafts[scope]) : resolveBubbleApplied(scope);
  }
  function fieldsFor(group) {
    if(group==='bubble')return BUBBLE;
    var pairs=group==='list'?LIST:DETAIL;
    return pairs.map(function(pair){
      var def=api.SPECS[group][pair[0]];
      return [pair[0],pair[1],def[0],def[1],def[2],def[3],
        pair[0]==='avatarRadius'?'%':def[0]==='number'?'px':''];
    });
  }
  function drawFields() {
    $('editorFields').replaceChildren();
    fieldsFor(tab).forEach(function(field){
      var wrap=document.createElement('div');wrap.className='field';
      var label=document.createElement('label');label.htmlFor='edit-'+field[0];label.textContent=field[1];
      var output=document.createElement('output');label.appendChild(output);
      var input=document.createElement('input');input.id='edit-'+field[0];
      input.dataset.key=field[0];input.type=field[2]==='color'?'color':'range';
      if(field[2]==='number'){input.min=field[4];input.max=field[5];input.step='1';}
      input.value=String(drafts[tab][field[0]]); output.textContent=input.value+(field[6]||'');
      input.addEventListener('focus',function(){ pendingBefore=currentSnapshot(); });
      input.addEventListener('input',function(){
        if(pendingBefore==null) pendingBefore=currentSnapshot();
        var value=field[2]==='color'?input.value:Number(input.value);
        drafts[tab][field[0]]=value;output.textContent=input.value+(field[6]||'');drawPreview();refreshDirty();
      });
      input.addEventListener('change',commitFieldEdit);
      input.addEventListener('blur',commitFieldEdit);
      wrap.appendChild(label);wrap.appendChild(input);$('editorFields').appendChild(wrap);
    });
  }
  function cssValue(group,key) {
    var item=api.SPECS[group][key],value=drafts[group][key];
    return value+(item[0]==='number'?(key==='avatarRadius'?'%':'px'):'');
  }
  function previewStyles() {
    var stage=$('previewSurface');
    ['list','detail'].forEach(function(group){
      Object.keys(api.SPECS[group]).forEach(function(key){
        stage.style.setProperty('--p-'+group+'-'+api.cssKey(key),cssValue(group,key));
      });
    });
    var bubble=drafts.bubble;
    stage.style.setProperty('--p-my-bg',bubble.myBubbleBg);
    stage.style.setProperty('--p-my-text',bubble.myBubbleColor);
    stage.style.setProperty('--p-partner-bg',bubble.partnerBubbleBg);
    stage.style.setProperty('--p-partner-text',bubble.partnerBubbleColor);
    stage.style.setProperty('--p-bubble-width',bubble.bubbleMaxWidth+'%');
    stage.style.setProperty('--p-my-radius',bubble.myBubbleRadiusSize+'px');
    stage.style.setProperty('--p-partner-radius',bubble.partnerBubbleRadiusSize+'px');
    stage.style.setProperty('--p-my-pad',(bubble.myBubblePadding-2)+'px '+(bubble.myBubblePadding+1)+'px');
    stage.style.setProperty('--p-partner-pad',(bubble.partnerBubblePadding-2)+'px '+(bubble.partnerBubblePadding+1)+'px');
    stage.style.setProperty('--p-my-tail-size',bubble.myBubbleTailSize+'px');
    stage.style.setProperty('--p-partner-tail-size',bubble.partnerBubbleTailSize+'px');
    document.querySelectorAll('.msg-avatar').forEach(function(el){
      el.style.width=Math.round(bubble.avatarSize*.72)+'px';
      el.style.height=Math.round(bubble.avatarSize*.72)+'px';
    });
  }
  function drawPreview() {
    previewStyles();
    var showList=tab==='list';
    $('mockList').hidden=!showList;$('mockDetail').hidden=showList;
    $('previewLabel').textContent=showList?'聊天列表':tab==='detail'?'聊天详情':'聊天气泡';
  }
  function roleNameById(id) {
    try {
      var roles=JSON.parse(localStorage.getItem('ai_custom_characters')||'[]');
      if(!Array.isArray(roles))return null;
      var hit=roles.find(function(r){return r&&String(r.id)===String(id);});
      return hit?String(hit.name||'未命名角色'):null;
    } catch(e){return null;}
  }
  // Bubble presets carry an allowlisted source scope; legacy presets without one
  // are labelled as generic and never silently bound to a role.
  function scopeLabel(p) {
    if(p.tab!=='bubble')return '';
    if(p.scope==null)return '旧版通用方案';
    if(p.scope==='global')return '全局';
    return roleNameById(p.scope)||('角色 '+String(p.scope).slice(0,8));
  }
  function persistPresets(next) {
    next.updatedAt=Date.now();
    if(!api.save(next)){toast('操作失败，请检查存储空间');return false;}
    state=api.read();renderPresets();return true;
  }
  function presetId() {
    return 'ts-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }
  // A bubble preset owned by another role (or a legacy generic one) must never be
  // overwritten from this scope: update creates a new entry for the current scope
  // instead, leaving the original id/values/scope untouched.
  function isCrossScopeBubble(p) {
    return p.tab === 'bubble' && (p.scope == null || p.scope !== scope);
  }
  function scopeName(value) {
    if (value === 'global') return '全局';
    return roleNameById(value) || '当前角色';
  }
  // --- Undo/redo history and dirty state (memory only; no persistence) ---
  function ctxKey() { return tab === 'bubble' ? 'bubble:' + scope : tab; }
  function histFor(key) { if (!history[key]) history[key] = { undo: [], redo: [] }; return history[key]; }
  function currentSnapshot() {
    if (tab === 'bubble') return cleanBubble(drafts.bubble);
    return api.clean(tab, drafts[tab]);
  }
  function snapshotKey(key) {
    if (key === 'list') return api.clean('list', drafts.list);
    if (key === 'detail') return api.clean('detail', drafts.detail);
    var s = key.slice(7);
    if (s === scope) return cleanBubble(drafts.bubble);
    return cleanBubble(bubbleDrafts[s] || resolveBubbleApplied(s));
  }
  function appliedFor(key) {
    if (key === 'list') return applied.list;
    if (key === 'detail') return applied.detail;
    var s = key.slice(7);
    if (!applied.bubble[s]) applied.bubble[s] = resolveBubbleApplied(s);
    return applied.bubble[s];
  }
  function sameValue(a, b) {
    var ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every(function (k) { return String(a[k]) === String(b[k]); });
  }
  function isDirty(key) { return !sameValue(snapshotKey(key), appliedFor(key)); }
  function anyDirty() {
    if (isDirty('list') || isDirty('detail') || isDirty(ctxKey())) return true;
    return Object.keys(bubbleDrafts).some(function (s) { return isDirty('bubble:' + s); });
  }
  function pushHistory(key, before) {
    var h = histFor(key);
    h.undo.push(before);
    if (h.undo.length > HISTORY_LIMIT) h.undo.shift();
    h.redo.length = 0;
  }
  function restoreSnapshot(key, snap) {
    if (key.indexOf('bubble:') === 0) {
      drafts.bubble = cleanBubble(snap);
      bubbleDrafts[scope] = cleanBubble(snap);
    } else {
      drafts[key] = api.clean(key, snap);
    }
    drawFields(); drawPreview(); refreshDirty(); refreshHistoryButtons();
  }
  function undo() {
    var key = ctxKey(), h = histFor(key);
    if (!h.undo.length) return;
    h.redo.push(currentSnapshot());
    restoreSnapshot(key, h.undo.pop());
  }
  function redo() {
    var key = ctxKey(), h = histFor(key);
    if (!h.redo.length) return;
    h.undo.push(currentSnapshot());
    restoreSnapshot(key, h.redo.pop());
  }
  function commitFieldEdit() {
    if (pendingBefore) {
      pushHistory(ctxKey(), pendingBefore);
      pendingBefore = null;
      refreshHistoryButtons();
      refreshDirty();
    }
  }
  function refreshHistoryButtons() {
    var h = histFor(ctxKey());
    $('undoButton').disabled = !h.undo.length;
    $('redoButton').disabled = !h.redo.length;
  }
  function refreshDirty() { $('dirtyTag').hidden = !isDirty(ctxKey()); }
  function applyPresetToDraft(p) {
    if(p.tab==='bubble'){
      if(isCrossScopeBubble(p)){
        var from=p.scope==null?'旧版通用方案':scopeLabel(p);
        var to=scopeName(scope);
        if(!window.confirm('该方案来自「'+from+'」，载入到「'+to+'」草稿？仅作模板，不会自动应用。'))return;
      }
      pushHistory('bubble:'+scope, currentSnapshot());
      drafts.bubble=cleanBubble(p.values);
      bubbleDrafts[scope]=cleanBubble(drafts.bubble);
    } else {
      pushHistory(p.tab, currentSnapshot());
      drafts[p.tab]=api.clean(p.tab,p.values);
    }
    drawFields();drawPreview();refreshDirty();refreshHistoryButtons();toast('已载入草稿，点应用后生效');
  }
  function renamePreset(p) {
    var input=window.prompt('重命名方案',p.name);
    if(input==null)return;
    var nextName=input.trim().slice(0,24);
    if(!nextName){toast('方案名称不能为空');return;}
    var next=api.read();
    var target=next.presets.find(function(item){return item.id===p.id;});
    if(!target){toast('方案不存在或已被删除');return;}
    target.name=nextName;
    if(!persistPresets(next))return;
    toast('方案已重命名');
  }
  function updatePresetFromDraft(p) {
    if (isCrossScopeBubble(p)) {
      var from = p.scope == null ? '旧版通用方案' : scopeLabel(p);
      var to = scopeName(scope);
      var copy = window.confirm('该方案来自「' + from + '」，不能在「' + to + '」下直接覆盖原方案。\n点确定将当前草稿另存为「' + to + '」的新方案；点取消放弃，原方案保持不变。');
      if (!copy) return;
      var asked = window.prompt('另存为新方案的名字', p.name + '（' + to + '）');
      if (asked == null) return;
      var newName = asked.trim().slice(0, 24);
      if (!newName) { toast('方案名称不能为空'); return; }
      var next = api.read();
      if (next.presets.length >= 20) { toast('最多保存 20 个方案'); return; }
      var entry = { id: presetId(), name: newName, tab: p.tab,
        values: JSON.parse(JSON.stringify(drafts[p.tab])) };
      if (p.tab === 'bubble') entry.scope = scope;
      next.presets.push(entry);
      if (!persistPresets(next)) return;
      toast('已另存为「' + to + '」的新方案，原方案未改动');
      return;
    }
    if(!window.confirm('用当前草稿更新方案「'+p.name+'」？'))return;
    var next=api.read();
    var target=next.presets.find(function(item){return item.id===p.id;});
    if(!target){toast('方案不存在或已被删除');return;}
    target.values=JSON.parse(JSON.stringify(drafts[p.tab]));
    if(target.tab==='bubble')target.scope=scope;
    if(!persistPresets(next))return;
    toast('方案已更新（未自动应用）');
  }
  function deletePreset(p) {
    var label=scopeLabel(p);
    var source=label?'（来源：'+label+'）':'';
    if(!window.confirm('删除方案「'+p.name+'」'+source+'？此操作不可撤销。'))return;
    var next=api.read();
    next.presets=next.presets.filter(function(item){return item.id!==p.id;});
    if(!persistPresets(next))return;
    toast('方案已删除');
  }
  function renderPresets() {
    var box=$('presetList');box.replaceChildren();
    var presets=state.presets.filter(function(p){return p.tab===tab;});
    if(!presets.length){var empty=document.createElement('p');empty.textContent='还没有保存方案';box.appendChild(empty);return;}
    presets.forEach(function(p){
      var wrap=document.createElement('div');wrap.className='preset-entry';
      var main=document.createElement('button');main.type='button';main.className='preset-use';
      var name=document.createElement('span');name.className='preset-name';name.textContent=p.name;
      main.appendChild(name);
      var label=scopeLabel(p);
      if(label){var tag=document.createElement('span');tag.className='preset-scope';tag.textContent=label;main.appendChild(tag);}
      main.addEventListener('click',function(){applyPresetToDraft(p);});

      var menuBtn=document.createElement('button');menuBtn.type='button';menuBtn.className='preset-menu-btn';
      menuBtn.setAttribute('aria-label','管理方案「'+p.name+'」');
      menuBtn.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';
      var menu=document.createElement('div');menu.className='preset-menu';
      var rename=document.createElement('button');rename.type='button';rename.textContent='重命名';
      rename.addEventListener('click',function(){renamePreset(p);});
      var update=document.createElement('button');update.type='button';
      update.textContent=isCrossScopeBubble(p)?'另存为…':'更新草稿';
      update.addEventListener('click',function(){updatePresetFromDraft(p);});
      var remove=document.createElement('button');remove.type='button';remove.className='danger';remove.textContent='删除';
      remove.addEventListener('click',function(){deletePreset(p);});
      menu.appendChild(rename);menu.appendChild(update);menu.appendChild(remove);

      menuBtn.addEventListener('click',function(){
        var willOpen=!wrap.classList.contains('menu-open');
        box.querySelectorAll('.preset-entry.menu-open').forEach(function(el){el.classList.remove('menu-open');});
        if(willOpen)wrap.classList.add('menu-open');
      });

      wrap.appendChild(main);wrap.appendChild(menuBtn);wrap.appendChild(menu);
      box.appendChild(wrap);
    });
  }
  function setTab(next) {
    pendingBefore=null;
    tab=next;
    document.querySelectorAll('[data-tab]').forEach(function(btn){
      var selected=btn.dataset.tab===next;
      btn.classList.toggle('selected',selected);btn.setAttribute('aria-pressed',String(selected));
    });
    $('panelTitle').textContent=next==='list'?'聊天列表':next==='detail'?'聊天详情':'聊天气泡';
    $('panelSubtitle').textContent=next==='bubble'?'全局或角色独立':next==='list'?'卡片与布局':'顶部、聊天区与输入栏';
    $('bubbleScopeRow').hidden=next!=='bubble';
    $('disableButton').textContent=next==='bubble'?'清除气泡覆盖':'停用当前定制';
    $('editor').scrollTop=0;drawFields();drawPreview();renderPresets();refreshDirty();refreshHistoryButtons();
  }
  function saveCurrent() {
    if(tab==='bubble'){
      if(!window.ChatBeauty||!window.ChatBeauty.save){toast('聊天美化模块未加载');return;}
      if(!window.ChatBeauty.save(scope,cleanBubble(drafts.bubble))){toast('气泡保存失败，请检查存储空间');return;}
      applied.bubble[scope]=cleanBubble(drafts.bubble);
      bubbleDrafts[scope]=cleanBubble(drafts.bubble);
    }else{
      var next=api.read();next[tab]=api.clean(tab,drafts[tab]);
      next.enabled[tab]=true;next.updatedAt=Date.now();
      if(!api.save(next)){toast('保存失败，请检查存储空间');return;}
      state=api.read();
      applied[tab]=api.clean(tab,drafts[tab]);
    }
    refreshDirty();refreshHistoryButtons();
    toast('已应用，重新打开聊天即可查看');
    try{window.dispatchEvent(new CustomEvent('maomao:chat-theme-change',{detail:{source:'theme-studio',tab:tab,scope:scope}}));}catch(e){}
  }
  function disableCurrent() {
    if(tab==='bubble'){
      if(!window.ChatBeauty||!window.ChatBeauty.save){toast('聊天美化模块未加载');return;}
      var cleared={};BUBBLE.forEach(function(field){cleared[field[0]]=null;});
      if(!window.ChatBeauty.save(scope,cleared)){toast('恢复失败，请检查存储空间');return;}
      // Drop this scope's stale in-memory draft and rebuild from the real applied
      // value resolved by ChatBeauty (default for global, inherited for a role).
      // Only the current scope is touched; other roles' unsaved drafts stay put.
      delete bubbleDrafts[scope];
      var restored=resolveBubbleApplied(scope);
      drafts.bubble=restored;
      bubbleDrafts[scope]=cleanBubble(restored);
      applied.bubble[scope]=cleanBubble(restored);
      drawFields();drawPreview();refreshDirty();refreshHistoryButtons();
      toast(scope==='global'?'已恢复原有气泡默认值':'已恢复跟随全局气泡');
    }else{
      var next=api.read();next.enabled[tab]=false;next.updatedAt=Date.now();
      if(!api.save(next)){toast('停用失败，请检查存储空间');return;}
      state=api.read();
      drafts[tab]=api.clean(tab,state[tab]);
      applied[tab]=api.clean(tab,state[tab]);
      drawFields();drawPreview();refreshDirty();refreshHistoryButtons();
      toast('已停用，原有聊天样式会恢复');
    }
  }
  function storePreset() {
    var name=window.prompt('给当前方案起个名字');
    if(!name||!name.trim())return;
    name=name.trim().slice(0,24);
    var next=api.read();
    if(next.presets.length>=20){toast('最多保存 20 个方案');return;}
    var entry={id:presetId(),
      name:name,tab:tab,values:JSON.parse(JSON.stringify(drafts[tab]))};
    if(tab==='bubble')entry.scope=scope;
    next.presets.push(entry);
    next.updatedAt=Date.now();
    if(!api.save(next)){toast('方案保存失败，请检查存储空间');return;}
    state=api.read();renderPresets();toast('方案已保存（未自动应用）');
  }
  function exportObject() {
    return {format:'maomao-theme-studio',version:1,
      list:api.clean('list',drafts.list),detail:api.clean('detail',drafts.detail),
      bubble:cleanBubble(drafts.bubble)};
  }
  function makeDownload(filename,content,type) {
    try{
      var blob=new Blob([content],{type:type});
      var url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
      setTimeout(function(){URL.revokeObjectURL(url);},5000);
      toast('已生成文件');return true;
    }catch(e){toast('导出失败，请检查浏览器下载权限');return false;}
  }
  function exportJSON() {
    makeDownload('theme-studio.json',JSON.stringify(exportObject(),null,2),'application/json');
  }
  function exportCSS() {
    var rows=['/* 主题工作台可重新导入的变量配置；不会执行陌生 CSS。 */',':root {'];
    ['list','detail'].forEach(function(group){
      Object.keys(api.SPECS[group]).forEach(function(key){
        rows.push('  --ts-'+group+'-'+api.cssKey(key)+': '+cssValue(group,key)+';');
      });
    });
    BUBBLE.forEach(function(field){
      var value=drafts.bubble[field[0]];
      rows.push('  --ts-bubble-'+api.cssKey(field[0])+': '+value+(field[2]==='number'?(field[6]||''):'')+';');
    });
    rows.push('}');
    makeDownload('theme-studio.css',rows.join('\n'),'text/css');
  }
  // Parse an imported file into a pending draft. Nothing in `drafts` is touched
  // until parsing and validation fully succeed, so a rejected import leaves the
  // three drafts, current tab/scope and the applied theme untouched (no half-new
  // half-old state).
  // Strict field spec: type, numeric bounds and the exact unit the field exports.
  function fieldSpec(group, key) {
    if (group === 'bubble') {
      var f = BUBBLE.filter(function (p) { return p[0] === key; })[0];
      if (!f) return null;
      return { type: f[2], min: f[4], max: f[5], unit: f[6] };
    }
    var spec = api.SPECS[group] && api.SPECS[group][key];
    if (!spec) return null;
    return { type: spec[0], min: spec[2], max: spec[3], unit: key === 'avatarRadius' ? '%' : 'px' };
  }
  function parseCssImport(text) {
    var pending = { list: {}, detail: {}, bubble: {} };
    var KNOWN = ['list', 'detail', 'bubble'];
    var found = 0, match;
    // Scan every --ts-* declaration, including a last rule that legally omits the
    // trailing semicolon. An unknown group or unknown key rejects the whole file;
    // no declaration may be silently skipped. The value stops at ; { or }.
    var regex = /--ts-([a-z0-9]+(?:-[a-z0-9]+)*)\s*:\s*([^;{}]+)/gi;
    while ((match = regex.exec(text))) {
      var name = match[1].toLowerCase();
      var group = KNOWN.find(function (g) { return name === g || name.indexOf(g + '-') === 0; });
      if (!group) throw new Error('不支持的配置组 --ts-' + name);
      var rest = name === group ? '' : name.slice(group.length + 1);
      var rawKey = rest;
      var key = rest.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
      var spec = fieldSpec(group, key);
      // Unknown --ts-* item rejects the whole file; it is not silently skipped.
      if (!spec) throw new Error('不支持的配置项 --ts-' + name);
      var value = match[2].trim();
      if (spec.type === 'color') {
        if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error('颜色格式不正确：' + key + ' 需为 6 位十六进制色值');
        pending[group][key] = value;
      } else if (spec.type === 'number') {
        var unitRe = spec.unit === '%' ? /^(-?\d+(?:\.\d+)?)%$/ : /^(-?\d+(?:\.\d+)?)px$/;
        var m = unitRe.exec(value);
        if (!m) throw new Error('单位不正确：' + key + ' 需使用 ' + spec.unit);
        var number = Number(m[1]);
        if (!Number.isFinite(number) || number < spec.min || number > spec.max) {
          throw new Error('数值越界：' + key + ' 需在 ' + spec.min + '–' + spec.max + ' ' + spec.unit);
        }
        pending[group][key] = number;
      }
      found++;
    }
    if (!found) throw new Error('未找到兼容的 --ts-* 变量，请使用 JSON 或工作台导出的 CSS');
    return pending;
  }
  // Validate one section strictly before any tolerant clean/clamp runs. Returns
  // only allowlisted, already-valid fields; the caller fills defaults for the rest.
  function strictValidateSection(group, raw, label) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(label + '配置格式不正确');
    var out = {};
    Object.keys(raw).forEach(function (key) {
      var spec = fieldSpec(group, key);
      if (!spec) throw new Error(label + '包含不支持的配置项：' + key);
      var value = raw[key];
      if (spec.type === 'color') {
        if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('颜色格式不正确：' + key + ' 需为 6 位十六进制色值');
        out[key] = value;
      } else if (spec.type === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('数值类型不正确：' + key + ' 需为数字');
        if (value < spec.min || value > spec.max) throw new Error('数值越界：' + key + ' 需在 ' + spec.min + '–' + spec.max + ' ' + spec.unit);
        out[key] = value;
      }
    });
    return out;
  }
  function parseJsonImport(text) {
    var parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { throw new Error('JSON 解析失败：文件不是有效的 JSON'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('主题格式不兼容：根节点必须是对象');
    if (parsed.format !== 'maomao-theme-studio' || parsed.version !== 1) throw new Error('主题格式不兼容：仅支持 maomao-theme-studio v1');
    var hasSection = parsed.list !== undefined || parsed.detail !== undefined || parsed.bubble !== undefined;
    if (!hasSection) throw new Error('配置为空：未包含列表、详情或气泡任一段');
    var pending = { list: null, detail: null, bubble: null };
    if (parsed.list !== undefined) pending.list = api.clean('list', strictValidateSection('list', parsed.list, '列表'));
    if (parsed.detail !== undefined) pending.detail = api.clean('detail', strictValidateSection('detail', parsed.detail, '详情'));
    if (parsed.bubble !== undefined) pending.bubble = cleanBubble(strictValidateSection('bubble', parsed.bubble, '气泡'));
    return pending;
  }
  function unpackImport(text, filename) {
    if (text.length > 65536) throw new Error('文件过大（最多 64KB）');
    var pending;
    if (/\.css$/i.test(filename)) {
      pending = parseCssImport(text);
    } else {
      var data = parseJsonImport(text);
      pending = { list: data.list, detail: data.detail, bubble: data.bubble };
    }
    // Compute the next drafts locally first; an undo node is recorded only for a
    // section that actually changes. An unchanged section keeps its redo stack and
    // gains no phantom history entry. Rejected parsing never reaches here.
    var nextList, nextDetail, nextBubble;
    if (/\.css$/i.test(filename)) {
      nextList = Object.assign({}, drafts.list, pending.list);
      nextDetail = Object.assign({}, drafts.detail, pending.detail);
      nextBubble = Object.assign({}, drafts.bubble, pending.bubble);
    } else {
      nextList = pending.list || drafts.list;
      nextDetail = pending.detail || drafts.detail;
      nextBubble = pending.bubble || drafts.bubble;
    }
    if (!sameValue(api.clean('list', drafts.list), api.clean('list', nextList))) {
      pushHistory('list', api.clean('list', drafts.list));
    }
    if (!sameValue(api.clean('detail', drafts.detail), api.clean('detail', nextDetail))) {
      pushHistory('detail', api.clean('detail', drafts.detail));
    }
    if (!sameValue(cleanBubble(drafts.bubble), cleanBubble(nextBubble))) {
      pushHistory('bubble:' + scope, cleanBubble(drafts.bubble));
    }
    drafts.list = api.clean('list', nextList);
    drafts.detail = api.clean('detail', nextDetail);
    drafts.bubble = cleanBubble(nextBubble);
    bubbleDrafts[scope] = cleanBubble(drafts.bubble);
  }
  function populateScopes() {
    try {
      var roles=JSON.parse(localStorage.getItem('ai_custom_characters')||'[]');
      if(!Array.isArray(roles))return;
      var used=new Set(['global']);
      roles.forEach(function(role){
        if(!role||role.id==null||role.id==='')return;
        var id=String(role.id);if(used.has(id))return;used.add(id);
        var opt=document.createElement('option');opt.value=id;opt.textContent=String(role.name||'未命名角色').slice(0,35);
        $('bubbleScope').appendChild(opt);
      });
    } catch(e){}
  }
  $('editorTabs').addEventListener('click',function(event){
    var button=event.target.closest('[data-tab]');if(button)setTab(button.dataset.tab);
  });
  $('bubbleScope').addEventListener('change',function(){
    pendingBefore=null;
    bubbleDrafts[scope]=cleanBubble(drafts.bubble);
    scope=this.value;loadBubble();drawFields();drawPreview();refreshDirty();refreshHistoryButtons();
  });
  $('applyButton').addEventListener('click',saveCurrent);
  $('disableButton').addEventListener('click',disableCurrent);
  $('savePreset').addEventListener('click',storePreset);
  $('restoreDraft').addEventListener('click',function(){
    pushHistory(ctxKey(),currentSnapshot());
    if(tab==='bubble'){
      drafts.bubble=cleanBubble(applied.bubble[scope]||resolveBubbleApplied(scope));
      bubbleDrafts[scope]=cleanBubble(drafts.bubble);
    } else {
      drafts[tab]=api.clean(tab,applied[tab]);
    }
    drawFields();drawPreview();refreshDirty();refreshHistoryButtons();toast('已还原到最后保存的配置');
  });
  $('undoButton').addEventListener('click',undo);
  $('redoButton').addEventListener('click',redo);
  var backLink=document.querySelector('.back');
  if(backLink){
    backLink.addEventListener('click',function(event){
      if(anyDirty() && !window.confirm('有未应用的改动，离开工作台将丢失这些草稿。确定离开吗？')){
        event.preventDefault();
      }
    });
  }
  window.addEventListener('beforeunload',function(event){
    if(anyDirty()){ event.preventDefault(); event.returnValue=''; }
  });
  $('exportButton').addEventListener('click',exportJSON);
  $('exportCssButton').addEventListener('click',exportCSS);
  $('importButton').addEventListener('click',function(){$('importFile').click();});
  $('importFile').addEventListener('change',function(){
    var file=this.files&&this.files[0];if(!file)return;
    if(file.size>65536){toast('文件过大（最多 64KB）');this.value='';return;}
    // Snapshot the editing context before the async read; if the user switches
    // tab/scope while the file is being read, reject the stale result so the
    // draft for role A is never mistaken for role B.
    var capturedTab=tab,capturedScope=scope;
    file.text().then(function(text){
      if(tab!==capturedTab||scope!==capturedScope){toast('导入已过期，请重新选择文件');return;}
      unpackImport(text,file.name);drawFields();drawPreview();toast('导入成功，请分别检查并应用各区域');
    }).catch(function(error){toast(error && error.message ? error.message : '导入失败');});
    this.value='';
  });
  // Read-only snapshot for focused regression tests; the page never writes it back.
  api._draftSnapshot = function () {
    var h = histFor(ctxKey());
    var stacks = {};
    Object.keys(history).forEach(function (k) {
      stacks[k] = { undo: history[k].undo.length, redo: history[k].redo.length };
    });
    return { tab: tab, scope: scope, dirty: anyDirty(), contextDirty: isDirty(ctxKey()),
      undo: h.undo.length, redo: h.redo.length, stacks: stacks,
      list: api.clean('list', drafts.list), detail: api.clean('detail', drafts.detail),
      bubble: cleanBubble(drafts.bubble) };
  };
  populateScopes();loadBubble();applied.bubble[scope]=cleanBubble(drafts.bubble);setTab('list');
})();
