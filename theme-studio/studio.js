/* Mobile-first workbench: drafts are never persisted until Apply. */
(function () {
  'use strict';
  var api = window.MAOMAOThemeStudio;
  var BUBBLE = [
    ['myBubbleBg','我的气泡颜色','color','#111111',null,null,'','我的气泡'],
    ['myBubbleColor','我的文字颜色','color','#FFFFFF',null,null,'','我的气泡'],
    ['myBubbleFontSize','我的文字字号','number',12,9,22,'px','我的气泡'],
    ['myBubbleRadiusSize','我的气泡圆角','number',15,0,35,'px','我的气泡'],
    ['myBubblePadding','我的气泡内边距','number',10,4,28,'px','我的气泡'],
    ['myBubbleTailSize','我的气泡尾巴','number',0,0,16,'px','我的气泡'],
    ['myBubbleBorderColor','我的气泡描边','color','#111111',null,null,'','我的气泡'],
    ['myBubbleBorderWidth','我的描边粗细','number',0,0,5,'px','我的气泡'],
    ['myBubbleOpacity','我的气泡透明度','number',100,30,100,'%','我的气泡'],
    ['partnerBubbleBg','对方气泡颜色','color','#FFFFFF',null,null,'','对方气泡'],
    ['partnerBubbleColor','对方文字颜色','color','#111111',null,null,'','对方气泡'],
    ['partnerBubbleFontSize','对方文字字号','number',12,9,22,'px','对方气泡'],
    ['partnerBubbleRadiusSize','对方气泡圆角','number',15,0,35,'px','对方气泡'],
    ['partnerBubblePadding','对方气泡内边距','number',10,4,28,'px','对方气泡'],
    ['partnerBubbleTailSize','对方气泡尾巴','number',0,0,16,'px','对方气泡'],
    ['partnerBubbleBorderColor','对方气泡描边','color','#DADAE0',null,null,'','对方气泡'],
    ['partnerBubbleBorderWidth','对方描边粗细','number',1,0,5,'px','对方气泡'],
    ['partnerBubbleOpacity','对方气泡透明度','number',100,30,100,'%','对方气泡'],
    ['bubbleMaxWidth','气泡最大宽度','number',86,45,95,'%','整体布局'],
    ['bubbleGap','气泡上下间距','number',13,0,28,'px','整体布局'],
    ['avatarSize','头像大小','number',30,20,54,'px','整体布局']
  ];
  var LIST = [
    ['headerBg','顶部背景','标题与封面'],
    ['headerText','顶部标题颜色','标题与封面'],
    ['headerSubText','顶部副标题颜色','标题与封面'],
    ['headerTitleSize','顶部标题字号','标题与封面'],
    ['coverOpacity','封面显示浓度','标题与封面'],
    ['coverPosition','封面上下位置','标题与封面'],
    ['stageBg','卡片底纸颜色','主页结构'],
    ['listBg','列表底色','主页结构'],
    ['musicBg','音乐舱背景','音乐舱'],
    ['musicText','歌曲标题颜色','音乐舱'],
    ['itemBg','聊天卡片背景','聊天卡片'],
    ['itemRadius','聊天卡片圆角','聊天卡片'],
    ['itemGap','卡片之间距离','聊天卡片'],
    ['itemPadding','卡片内边距','聊天卡片'],
    ['itemBorderWidth','卡片描边宽度','聊天卡片'],
    ['itemBorderColor','卡片描边颜色','聊天卡片'],
    ['avatarRadius','头像圆角','头像与文字'],
    ['avatarSize','头像尺寸','头像与文字'],
    ['textColor','昵称颜色','头像与文字'],
    ['titleSize','昵称字号','头像与文字'],
    ['previewColor','消息摘要颜色','头像与文字'],
    ['previewSize','消息摘要字号','头像与文字'],
    ['timeColor','时间文字颜色','头像与文字']
  ];
  var DETAIL = [
    ['headerBg','顶部背景','顶部栏'],
    ['headerText','角色名称颜色','顶部栏'],
    ['headerSize','角色名称字号','顶部栏'],
    ['headerHeight','顶部栏高度','顶部栏'],
    ['chatBg','对话背景颜色','消息区域'],
    ['chatPadding','消息两侧留白','消息区域'],
    ['chatImagePosition','聊天背景上下位置','消息区域'],
    ['dateColor','时间戳颜色','消息区域'],
    ['composerBg','底部输入栏背景','底部输入'],
    ['composerPadding','输入栏两侧间距','底部输入'],
    ['inputBg','输入框背景','底部输入'],
    ['inputText','输入框提示颜色','底部输入'],
    ['inputRadius','输入框圆角','底部输入'],
    ['sendBg','发送按钮颜色','底部输入']
  ];
  var state = api.read();
  var drafts = { list: api.clean('list',state.list), detail: api.clean('detail',state.detail), bubble: {} };
  var tab = 'list', scope = 'global', noticeTimer, chosenImageSlot = null;
  var photoLeases = Object.create(null);
  var imageFields = {list:[['coverImage','聊天主页封面','封面图片'],['listImage','聊天卡片底纸','列表图片']], detail:[['chatImage','聊天背景图','背景图片']]};
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
    var pairs=(group==='list'?LIST:DETAIL).concat(api.EXTENSION_FIELDS[group]||[]);
    return pairs.filter(function(pair){
      var spec=api.SPECS[group][pair[0]];return spec&&spec[0]!=='asset';
    }).map(function(pair){
      var spec=api.SPECS[group][pair[0]];
      var unit=pair[3]||(pair[0]==='avatarRadius'||pair[0]==='coverPosition'||
        pair[0]==='coverOpacity'||pair[0]==='chatImagePosition'?'%':spec[0]==='number'?'px':'');
      return [pair[0],pair[1],spec[0],spec[1],spec[2],spec[3],unit,pair[2]];
    });
  }
  function drawFields() {
    $('editorFields').replaceChildren();
    var lastSection='';
    fieldsFor(tab).forEach(function(field){
      if(field[7] && field[7]!==lastSection){
        var section=document.createElement('p');section.className='field-section';
        section.textContent=field[7];$('editorFields').appendChild(section);
        lastSection=field[7];
      }
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
    return value+(item[0]==='number'?
      (key==='avatarRadius'||key==='coverPosition'||key==='chatImagePosition'||key==='coverOpacity'?'%':'px'):'');
  }
  function applyPhotoPreview(slot,cssName,id){
    var stage=$('previewSurface'),old=photoLeases[slot];
    if(old && old.id===id)return;
    if(old && old.asset)old.asset.revoke();
    var current={id:id||''};photoLeases[slot]=current;
    stage.style.removeProperty(cssName);
    if(!id || !window.MAOMAOThemeStudioAssets)return;
    window.MAOMAOThemeStudioAssets.resolve(id).then(function(asset){
      if(photoLeases[slot]!==current){if(asset)asset.revoke();return;}
      if(!asset)return;
      current.asset=asset;
      stage.style.setProperty(cssName,'url("'+asset.url.replace(/["\\]/g,'')+'")');
    });
  }
  function previewStyles() {
    var stage=$('previewSurface');
    ['list','detail'].forEach(function(group){
      Object.keys(api.SPECS[group]).forEach(function(key){
        if(api.SPECS[group][key][0]==='asset')return;
        var value=drafts[group][key];
        if(key==='coverOpacity')value=Number(value)/100;
        else if(key==='avatarRadius'||key==='coverPosition'||key==='chatImagePosition')value+='%';
        else if(api.SPECS[group][key][0]==='number')value+='px';
        stage.style.setProperty('--p-'+group+'-'+api.cssKey(key),value);
      });
    });
    applyPhotoPreview('list.coverImage','--p-list-cover-image',drafts.list.coverImage);
    applyPhotoPreview('list.listImage','--p-list-paper-image',drafts.list.listImage);
    applyPhotoPreview('detail.chatImage','--p-detail-chat-image',drafts.detail.chatImage);
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
    stage.style.setProperty('--p-my-border-width',bubble.myBubbleBorderWidth+'px');
    stage.style.setProperty('--p-my-border-color',bubble.myBubbleBorderColor);
    stage.style.setProperty('--p-partner-border-width',bubble.partnerBubbleBorderWidth+'px');
    stage.style.setProperty('--p-partner-border-color',bubble.partnerBubbleBorderColor);
    stage.style.setProperty('--p-my-font-size',bubble.myBubbleFontSize+'px');
    stage.style.setProperty('--p-partner-font-size',bubble.partnerBubbleFontSize+'px');
    $('mockMessages').style.gap=bubble.bubbleGap+'px';
    document.querySelector('.mock-bubble-row.mine .mock-bubble').style.opacity=bubble.myBubbleOpacity/100;
    document.querySelector('.mock-bubble-row.partner .mock-bubble').style.opacity=bubble.partnerBubbleOpacity/100;
    document.querySelectorAll('.mock-bubble-avatar').forEach(function(el){
      el.style.width=Math.round(bubble.avatarSize*.72)+'px';
      el.style.height=Math.round(bubble.avatarSize*.72)+'px';
    });
  }
  function renderImageSlots(){
    var panel=$('imagePanel'),box=$('imageSlots');
    panel.hidden=tab==='bubble';
    box.querySelectorAll('.image-thumb').forEach(function(el){if(el._asset)el._asset.revoke();});
    box.replaceChildren();
    if(tab==='bubble')return;
    imageFields[tab].forEach(function(row){
      var key=row[0],slot=tab+'.'+key,id=drafts[tab][key];
      var wrap=document.createElement('div');wrap.className='image-slot';
      var thumb=document.createElement('div');thumb.className='image-thumb';thumb.textContent=id?'素材':'空';
      if(id && window.MAOMAOThemeStudioAssets){
        window.MAOMAOThemeStudioAssets.resolve(id).then(function(asset){
          if(!asset)return;
          if(!thumb.isConnected){asset.revoke();return;}
          var previous=thumb._asset;
          if(previous)previous.revoke();
          thumb._asset=asset;thumb.style.backgroundImage='url("'+asset.url+'")';thumb.textContent='';
        });
      }
      var copy=document.createElement('div');copy.className='image-copy';
      var name=document.createElement('b');name.textContent=row[1];
      var status=document.createElement('small');status.textContent=id?'已选择本机图片':'尚未设置，沿用当前主题';
      copy.append(name,status);
      var actions=document.createElement('div');actions.className='image-actions';
      var upload=document.createElement('button');upload.type='button';upload.textContent=id?'更换图片':'选择图片';
      upload.addEventListener('click',function(){chosenImageSlot={tab:tab,key:key};$('imageFile').click();});
      var clear=document.createElement('button');clear.type='button';clear.textContent='移除';
      clear.disabled=!id;
      clear.addEventListener('click',function(){drafts[tab][key]='';renderImageSlots();drawPreview();toast('已从草稿移除，点击应用才生效');});
      actions.append(upload,clear);wrap.append(thumb,copy,actions);box.appendChild(wrap);
    });
  }
  function drawPreview() {
    previewStyles();
    var showList=tab==='list';
    $('mockList').hidden=!showList;$('mockDetail').hidden=showList;
    $('previewLabel').textContent=showList?'聊天主页 · 当前结构':tab==='detail'?'聊天详情':'聊天气泡';
    $('previewSwitch').hidden=!showList;
    $('mockNativeHeader').hidden=$('previewMode').value==='wechat';
    $('mockWechatHeader').hidden=$('previewMode').value!=='wechat';
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
        drawFields();drawPreview();renderImageSlots();toast('已载入草稿，点应用后生效');
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
    $('panelTitle').textContent=next==='list'?'聊天主页':next==='detail'?'聊天详情':'聊天气泡';
    $('panelSubtitle').textContent=next==='bubble'?'全局或角色独立':next==='list'?'封面 · 音乐舱 · 卡片 · 图片':'顶部 · 对话 · 背景 · 输入栏';
    $('bubbleScopeRow').hidden=next!=='bubble';
    $('disableButton').textContent=next==='bubble'?'清除气泡覆盖':'停用当前定制';
    $('editor').scrollTop=0;drawFields();drawPreview();renderImageSlots();renderPresets();
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
        if(api.SPECS[group][key][0]==='asset')return; // Blob bytes never exported as CSS.
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
  function fieldSpec(group, key) {
    if (group === 'bubble') {
      var f = BUBBLE.filter(function (p) { return p[0] === key; })[0];
      if (!f) return null;
      return { type: f[2], min: f[4], max: f[5], unit: f[6] };
    }
    var spec = api.SPECS[group] && api.SPECS[group][key];
    if (!spec) return null;
    return { type: spec[0], min: spec[2], max: spec[3], unit: ['avatarRadius','coverPosition','coverOpacity','chatImagePosition'].includes(key) ? '%' : (((api.EXTENSION_FIELDS[group]||[]).find(function(f){return f[0]===key;})||[])[3] || 'px') };
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
      if (spec.type === 'asset') throw new Error('图片素材不能从 CSS 变量导入，请在工作台选择图片');
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
      } else if (spec.type === 'asset') {
        if (typeof value !== 'string' || !(value === '' || /^as_[A-Z2-7]{32}$/.test(value))) throw new Error('图片素材引用格式无效：'+key);
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
    if (parsed.list !== undefined) pending.list = strictValidateSection('list', parsed.list, '列表');
    if (parsed.detail !== undefined) pending.detail = strictValidateSection('detail', parsed.detail, '详情');
    if (parsed.bubble !== undefined) pending.bubble = strictValidateSection('bubble', parsed.bubble, '气泡');
    return pending;
  }
  function unpackImport(text, filename) {
    if (text.length > 65536) throw new Error('文件过大（最多 64KB）');
    var isCSS=/\.css$/i.test(filename),pending=isCSS?parseCssImport(text):parseJsonImport(text);
    // Preserve any field omitted from a partial import, especially existing IDB image IDs.
    var nextList=api.clean('list',Object.assign({},drafts.list,pending.list||{}));
    var nextDetail=api.clean('detail',Object.assign({},drafts.detail,pending.detail||{}));
    var nextBubble=cleanBubble(Object.assign({},drafts.bubble,pending.bubble||{}));
    drafts.list=nextList;drafts.detail=nextDetail;drafts.bubble=nextBubble;
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
    drawFields();drawPreview();renderImageSlots();toast('已还原到最后保存的配置');
  });
  $('exportButton').addEventListener('click',exportJSON);
  $('exportCssButton').addEventListener('click',exportCSS);
  $('importButton').addEventListener('click',function(){$('importFile').click();});
  $('importFile').addEventListener('change',function(){
    var file=this.files&&this.files[0];if(!file)return;
    if(file.size>65536){toast('文件过大（最多 64KB）');this.value='';return;}
    var capturedTab=tab,capturedScope=scope;
    file.text().then(function(text){
      if(tab!==capturedTab||scope!==capturedScope){toast('导入已过期，请重新选择文件');return;}
      unpackImport(text,file.name);drawFields();drawPreview();renderImageSlots();toast('导入成功，请分别检查并应用各区域');
    }).catch(function(error){toast(error && error.message ? error.message : '导入失败');});
    this.value='';
  });
  $('previewMode').addEventListener('change',drawPreview);
  $('imageFile').addEventListener('change',function(){
    var file=this.files&&this.files[0],target=chosenImageSlot;
    this.value='';
    if(!file||!target)return;
    var assets=window.MAOMAOThemeStudioAssets;
    if(!assets){toast('图片仓库未加载，请刷新再试');return;}
    toast('正在处理并保存图片…');
    assets.upload(file,target.tab+'.'+target.key).then(function(id){
      drafts[target.tab][target.key]=id;
      if(tab===target.tab)renderImageSlots();
      drawPreview();
      toast('图片已导入本机，请点「应用到聊天」');
    }).catch(function(error){toast(error&&error.message||'图片导入失败');});
  });
  window.addEventListener('pagehide',function(){
    Object.keys(photoLeases).forEach(function(key){if(photoLeases[key].asset)photoLeases[key].asset.revoke();});
    document.querySelectorAll('.image-thumb').forEach(function(el){if(el._asset)el._asset.revoke();});
  });
  // Read-only QA inspection hook; never persists user data.
  api._draftSnapshot=function(){return {tab:tab,scope:scope,
    list:api.clean('list',drafts.list),detail:api.clean('detail',drafts.detail),
    bubble:cleanBubble(drafts.bubble)};};
  populateScopes();loadBubble();setTab('list');
})();
