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
  var tab = 'list', scope = 'global', noticeTimer;
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
  function loadBubble() {
    var beauty=window.ChatBeauty;
    var config=beauty && beauty.resolve ? beauty.resolve(scope==='global'?null:scope) : {};
    drafts.bubble=cleanBubble(config);
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
      input.addEventListener('input',function(){
        var value=field[2]==='color'?input.value:Number(input.value);
        drafts[tab][field[0]]=value;output.textContent=input.value+(field[6]||'');drawPreview();
      });
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
  function renderPresets() {
    var box=$('presetList');box.replaceChildren();
    var presets=state.presets.filter(function(p){return p.tab===tab;});
    if(!presets.length){var p=document.createElement('p');p.textContent='还没有保存方案';box.appendChild(p);return;}
    presets.forEach(function(p){
      var wrap=document.createElement('div');wrap.className='preset-entry';
      var use=document.createElement('button');use.type='button';use.textContent=p.name;
      use.addEventListener('click',function(){
        drafts[tab]=tab==='bubble'?cleanBubble(p.values):api.clean(tab,p.values);
        drawFields();drawPreview();toast('已载入草稿，点应用后生效');
      });
      var remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.className='remove';remove.setAttribute('aria-label','删除 '+p.name);
      remove.addEventListener('click',function(){
        if(!window.confirm('删除方案「'+p.name+'」？'))return;
        var next=api.read();next.presets=next.presets.filter(function(item){return item.id!==p.id;});
        next.updatedAt=Date.now();
        if(!api.save(next)){toast('删除失败，请检查存储空间');return;}
        state=api.read();renderPresets();toast('方案已删除');
      });
      wrap.appendChild(use);wrap.appendChild(remove);box.appendChild(wrap);
    });
  }
  function setTab(next) {
    tab=next;
    document.querySelectorAll('[data-tab]').forEach(function(btn){
      var selected=btn.dataset.tab===next;
      btn.classList.toggle('selected',selected);btn.setAttribute('aria-pressed',String(selected));
    });
    $('panelTitle').textContent=next==='list'?'聊天列表':next==='detail'?'聊天详情':'聊天气泡';
    $('panelSubtitle').textContent=next==='bubble'?'全局或角色独立':next==='list'?'卡片与布局':'顶部、聊天区与输入栏';
    $('bubbleScopeRow').hidden=next!=='bubble';
    $('disableButton').textContent=next==='bubble'?'清除气泡覆盖':'停用当前定制';
    $('editor').scrollTop=0;drawFields();drawPreview();renderPresets();
  }
  function saveCurrent() {
    if(tab==='bubble'){
      if(!window.ChatBeauty||!window.ChatBeauty.save){toast('聊天美化模块未加载');return;}
      if(!window.ChatBeauty.save(scope,cleanBubble(drafts.bubble))){toast('气泡保存失败，请检查存储空间');return;}
    }else{
      var next=api.read();next[tab]=api.clean(tab,drafts[tab]);
      next.enabled[tab]=true;next.updatedAt=Date.now();
      if(!api.save(next)){toast('保存失败，请检查存储空间');return;}
      state=api.read();
    }
    toast('已应用，重新打开聊天即可查看');
    try{window.dispatchEvent(new CustomEvent('maomao:chat-theme-change',{detail:{source:'theme-studio',tab:tab,scope:scope}}));}catch(e){}
  }
  function disableCurrent() {
    if(tab==='bubble'){
      if(!window.ChatBeauty||!window.ChatBeauty.save){toast('聊天美化模块未加载');return;}
      var cleared={};BUBBLE.forEach(function(field){cleared[field[0]]=null;});
      if(!window.ChatBeauty.save(scope,cleared)){toast('恢复失败，请检查存储空间');return;}
      loadBubble();drawFields();drawPreview();toast(scope==='global'?'已恢复原有气泡默认值':'已恢复跟随全局气泡');
    }else{
      var next=api.read();next.enabled[tab]=false;next.updatedAt=Date.now();
      if(!api.save(next)){toast('停用失败，请检查存储空间');return;}
      state=api.read();toast('已停用，原有聊天样式会恢复');
    }
  }
  function storePreset() {
    var name=window.prompt('给当前方案起个名字');
    if(!name||!name.trim())return;
    name=name.trim().slice(0,24);
    var next=api.read();
    if(next.presets.length>=20){toast('最多保存 20 个方案');return;}
    next.presets.push({id:'ts-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),
      name:name,tab:tab,values:JSON.parse(JSON.stringify(drafts[tab]))});
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
    if (/\.css$/i.test(filename)) {
      var pending = parseCssImport(text);
      drafts.list = Object.assign({}, drafts.list, pending.list);
      drafts.detail = Object.assign({}, drafts.detail, pending.detail);
      drafts.bubble = Object.assign({}, drafts.bubble, pending.bubble);
    } else {
      var data = parseJsonImport(text);
      if (data.list) drafts.list = data.list;
      if (data.detail) drafts.detail = data.detail;
      if (data.bubble) drafts.bubble = data.bubble;
    }
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
    scope=this.value;loadBubble();drawFields();drawPreview();
  });
  $('applyButton').addEventListener('click',saveCurrent);
  $('disableButton').addEventListener('click',disableCurrent);
  $('savePreset').addEventListener('click',storePreset);
  $('restoreDraft').addEventListener('click',function(){
    var saved=api.read();
    if(tab==='bubble')loadBubble();else drafts[tab]=api.clean(tab,saved[tab]);
    drawFields();drawPreview();toast('已还原到最后保存的配置');
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
    return { tab: tab, scope: scope,
      list: api.clean('list', drafts.list), detail: api.clean('detail', drafts.detail),
      bubble: cleanBubble(drafts.bubble) };
  };
  populateScopes();loadBubble();setTab('list');
})();
