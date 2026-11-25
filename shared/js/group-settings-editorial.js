/* QA-001: group-only layout adapter. No new storage keys or duplicated write handlers. */
(function () {
  'use strict';
  if (typeof isGroupSetting === 'undefined' || !isGroupSetting ||
      typeof loadCurrentGroup !== 'function' || !loadCurrentGroup()) return;
  var byId = function (id) { return document.getElementById(id); };
  var home = byId('groupInfoSection');
  var stage = home && home.closest('.cs-stage');
  var list = home && home.querySelector('.settings-list');
  var info = byId('gpInfoCard'), alias = byId('gpAliasCard'), notice = byId('gpNoticeCard');
  var manage = byId('gpManageCard'), advanced = byId('gpAdvancedCard');
  var search = byId('actionSearchHistory'), background = byId('actionBackground');
  var pin = byId('actionPin'), time = byId('actionTimeAware'), sound = byId('actionSound');
  if (!stage || !list || !info || !alias || !notice || !manage || !advanced ||
      !search || !background || !pin || !time || !sound ||
      home.classList.contains('gp-editorial-home')) return;
  function el(tag, cls, label) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (label != null) n.textContent = label;
    return n;
  }
  function btn(cls, label, handler) {
    var n = el('button', cls, label);
    n.type = 'button';
    n.addEventListener('click', handler);
    return n;
  }
  function english(label) {
    var n = el('span', 'gp-english', label);
    n.lang = 'en';
    n.setAttribute('aria-hidden','true');
    return n;
  }
  function bilingual(node, label) {
    if (node) node.append(english(label));
  }
  function safePhoto(value) {
    return typeof value === 'string' &&
      /^(?:data:image\/(?:png|jpeg|jpg|webp|gif);|https?:\/\/|blob:|\.{1,2}\/)/i.test(value);
  }
  function portrait(member, group) {
    var box = el('span', 'gp-portrait');
    var name = String(member.name || '成员');
    var fallback = el('span', '', Array.from(name)[0] || '·');
    box.append(fallback);
    if (safePhoto(member.avatar)) {
      var photo = el('img');
      photo.alt = '';
      photo.decoding = 'async';
      photo.addEventListener('load', function () { fallback.hidden = true; });
      photo.addEventListener('error', function () { photo.remove(); fallback.hidden = false; });
      photo.src = member.avatar;
      box.append(photo);
    }
    if(group && member.id != null && window.MAOGroupPortraits){
      window.MAOGroupPortraits.resolve(group,String(member.id)).then(function(url){
        if(!url||!box.isConnected)return;
        var image=el('img');image.alt='';image.decoding='async';
        image.addEventListener('load',function(){if(box.isConnected){box.replaceChildren(image);}});
        image.src=url;
      });
    }
    return box;
  }
  var cover = btn('gp-cover', '', function () { background.click(); });
  cover.setAttribute('aria-label', '预览并更换本群聊天背景');
  var photo = el('img');
  photo.alt = '';
  photo.hidden = true;
  photo.decoding = 'async';
  var empty = el('span', 'gp-cover-empty', '+');
  empty.setAttribute('aria-hidden', 'true');
  cover.append(photo, empty);
  var coverRequest = 0;
  var activePhoto = '';
  function clearPhoto() {
    activePhoto = '';
    photo.hidden = true;
    photo.removeAttribute('src');
    cover.classList.remove('has-photo');
  }
  photo.addEventListener('load', function () {
    if (!activePhoto) return;
    photo.hidden = false;
    cover.classList.add('has-photo');
  });
  photo.addEventListener('error', clearPhoto);
  function refreshCover() {
    var request = ++coverRequest;
    if (typeof readBackgroundImage !== 'function') return;
    Promise.resolve().then(readBackgroundImage).then(function (value) {
      if (request !== coverRequest) return;
      if (!safePhoto(value)) { clearPhoto(); return; }
      if (value === activePhoto) return;
      activePhoto = value;
      photo.src = value;
    }).catch(function () { if (request === coverRequest) clearPhoto(); });
  }

  var preview = el('span', 'gp-preview');
  var summary = el('span', 'gp-member-summary');
  var drawer = el('div', 'gp-drawer');
  drawer.id = 'gpEditorialMemberDrawer';
  drawer.setAttribute('aria-hidden', 'true');
  drawer.setAttribute('inert', '');
  var inner = el('div', 'gp-drawer-inner');
  var strip = el('div', 'gp-member-strip');
  strip.setAttribute('aria-label', '群成员');
  inner.append(strip);
  drawer.append(inner);
  var expanded = false;
  var collapsedLabel = '';
  function setExpanded(next) {
    if (!next && drawer.contains(document.activeElement)) toggle.focus();
    expanded = next;
    drawer.classList.toggle('is-expanded', next);
    drawer.setAttribute('aria-hidden', String(!next));
    if (next) drawer.removeAttribute('inert');
    else drawer.setAttribute('inert', '');
    toggle.setAttribute('aria-expanded', String(next));
    summary.textContent = next ? '收起' : collapsedLabel;
  }
  var toggle = btn('gp-member-toggle', '', function () { setExpanded(!expanded); });
  toggle.setAttribute('aria-controls', drawer.id);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.append(preview, summary);

  var own = el('div', 'gp-own-name');
  var ownValue = el('span', 'gp-own-value');
  var ownLabel = el('span', 'gp-setting-label', '我的显示名称');
  bilingual(ownLabel,'MY NAME');
  own.append(ownLabel, ownValue);
  function profile() {
    try {
      var value = JSON.parse(localStorage.getItem('myProfile') || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (error) { return {}; }
  }
  var viewParams = new URLSearchParams(location.search);
  var memberView = viewParams.get('view') === 'members';
  var memoryView = viewParams.get('view') === 'memory';
  function managementUrl(section) {
    var group = loadCurrentGroup();
    return group ? 'group-play.html?id='+encodeURIComponent(String(group.id))+(section?'&section='+encodeURIComponent(section):'') : '';
  }
  function openManagement(invite) {
    if (!memberView) {
      var group=loadCurrentGroup();
      if (group) location.href='chat-settings.html?roleId='+encodeURIComponent(String(group.id))+'&view=members'+(invite?'&intent=invite':'');
      return;
    }
    var action = byId('actionGroupManage');
    if (!manage.classList.contains('is-open')) action.click();
    var inviteBlock = byId('gpInviteBlock');
    var inviteToggle = byId('gpInviteToggle');
    if (inviteBlock && inviteToggle) {
      if (invite && typeof renderInviteCandidates === 'function') renderInviteCandidates();
      if (inviteBlock.classList.contains('is-open') !== invite) inviteToggle.click();
    }
    requestAnimationFrame(function(){
      (invite && inviteToggle ? inviteToggle : action).scrollIntoView({block:'nearest',behavior:'auto'});
    });
  }
  function memberTile(member,group) {
    var tile = el('div', 'gp-member-tile');
    tile.append(portrait(member,group), el('span', '', member.name));
    return tile;
  }
  function actionTile(symbol, label, handler) {
    var tile = btn('gp-member-tile', '', handler);
    tile.setAttribute('aria-label', label + '群成员');
    var caption = el('span','gp-action-caption',label);
    bilingual(caption, label === '邀请' ? 'INVITE' : 'REMOVE');
    tile.append(el('span','gp-action-square',symbol),caption);
    return tile;
  }
  function renderMembers() {
    var group = loadCurrentGroup();
    if (!group) return;
    var me = profile();
    var prefs = group.preferences || {};
    var selfName = String(prefs.myNickname || me.nickname || me.name || '我');
    ownValue.textContent = selfName;
    var others = Array.isArray(group.members) ? group.members.filter(function(m){return m && m.id != null && String(m.id) !== '__user';}) : [];
    var members = [{id:'__user',name:selfName,avatar:me.avatar}].concat(others.map(function(m){
      return {id:String(m.id),name:String(m.nickname || m.name || '成员'),avatar:m.avatar};
    }));
    preview.replaceChildren();
    members.slice(0,3).forEach(function(m){preview.append(portrait(m,group));});
    collapsedLabel = members.slice(0,2).map(function(m){return m.name;}).join('、') +
      ' · 共 ' + members.length + ' 人 · 展开';
    summary.textContent = expanded ? '收起' : collapsedLabel;
    strip.replaceChildren();
    members.forEach(function(m){strip.append(memberTile(m,group));});
    var invite = actionTile('+','邀请',function(){openManagement(true);});
    var remove = actionTile('−','移除',function(){openManagement(false);});
    remove.disabled = !others.length;
    strip.append(invite,remove);
  }

  function openPortraits(){
    var api=window.MAOGroupPortraits, group=loadCurrentGroup(), state;
    if(!api||!group){showToast('群内头像暂不可用');return;}
    try{state=api.snapshot(String(group.id));}catch(error){showToast(error.message);return;}
    var dialog=el('dialog','gp-portrait-dialog');
    dialog.setAttribute('aria-label','群内头像');
    var heading=el('h2','gp-portrait-heading','群内头像');heading.prepend(english('GROUP PORTRAITS'));
    var desc=el('p','gp-portrait-desc','仅用于这个群聊，不改变原个人头像。');
    var grid=el('div','gp-portrait-grid'), status=el('p','gp-portrait-status','');
    status.setAttribute('role','status');
    var changes=new Map(), urls=new Map(), busy=false, pending=0;
    var me=profile();
    var members=[{id:'__user',name:me.nickname||me.name||'我',avatar:me.avatar}].concat((state.group.members||[]).filter(function(m){return m&&m.id!=null&&String(m.id)!=='__user';}).map(function(m){return {id:String(m.id),name:m.nickname||m.name||'成员',avatar:m.avatar};}));
    function refreshButtons(){saveButton.disabled=busy||pending>0||!changes.size;cancel.disabled=busy;resetAll.disabled=busy||pending>0;}
    function close(){
      if(busy)return;
      dialog.close();
    }
    async function compress(file){
      if(!file||!/^image\/(?:jpeg|png|webp)$/.test(file.type)||file.size>12*1024*1024)throw Error('请选择 12 MB 以内的 JPG、PNG 或 WebP');
      var url=URL.createObjectURL(file);
      try{
        var img=new Image();
        await new Promise(function(resolve,reject){img.onload=resolve;img.onerror=function(){reject(Error('图片无法打开'));};img.src=url;});
        var size=Math.min(img.naturalWidth,img.naturalHeight);
        if(!size||img.naturalWidth*img.naturalHeight>40000000)throw Error('图片尺寸过大');
        var canvas=document.createElement('canvas');canvas.width=canvas.height=Math.min(512,size);
        var ctx=canvas.getContext('2d');if(!ctx)throw Error('图片处理失败');
        ctx.drawImage(img,(img.naturalWidth-size)/2,(img.naturalHeight-size)/2,size,size,0,0,canvas.width,canvas.height);
        return await new Promise(function(resolve,reject){canvas.toBlob(function(b){if(b)resolve(b);else reject(Error('图片处理失败'));},'image/webp',.88);});
      }finally{URL.revokeObjectURL(url);}
    }
    function setDraft(member,blob){
      var old=urls.get(member.id);if(old)URL.revokeObjectURL(old);
      urls.delete(member.id);
      changes.set(member.id,blob);
      if(blob)urls.set(member.id,URL.createObjectURL(blob));
      draw();refreshButtons();
    }
    function draw(){
      grid.replaceChildren();
      members.forEach(function(member){
        var cell=el('div','gp-portrait-cell'), chosen=changes.has(member.id);
        var draft={id:member.id,name:member.name,avatar:urls.get(member.id)||member.avatar};
        var choose=btn('gp-portrait-choose','',function(){if(!busy&&!pending)input.click();});
        choose.setAttribute('aria-label','更换'+member.name+'的群内头像');
        choose.append(portrait(draft,chosen?null:state.group),el('span','',member.name));
        var input=el('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.hidden=true;
        input.addEventListener('change',async function(){
          if(!input.files[0]||busy||pending)return;
          pending++;refreshButtons();status.textContent='正在处理图片';
          try{var blob=await compress(input.files[0]);if(dialog.open){setDraft(member,blob);status.textContent='已选中，保存后生效';}}
          catch(error){status.textContent=error.message;}
          finally{pending--;refreshButtons();}
        });
        var reset=btn('gp-portrait-reset','恢复默认',function(){if(!busy&&!pending)setDraft(member,null);});
        cell.append(choose,input,reset);grid.append(cell);
      });
    }
    var resetAll=btn('gp-portrait-resetall','全部恢复默认',function(){if(busy||pending)return;members.forEach(function(m){var old=urls.get(m.id);if(old)URL.revokeObjectURL(old);changes.set(m.id,null);});urls.clear();draw();refreshButtons();});
    var cancel=btn('gp-portrait-cancel','取消',close);
    var saveButton=btn('gp-portrait-save','保存搭配',async function(){
      if(busy||pending||!changes.size)return;
      busy=true;refreshButtons();status.textContent='正在保存';
      try{await api.save(state,changes);busy=false;renderMembers();dialog.close();showToast('群内头像已保存');}
      catch(error){status.textContent=error.message||'保存失败，请重试';}
      finally{busy=false;refreshButtons();}
    });
    var footer=el('div','gp-portrait-footer');footer.append(cancel,saveButton);
    dialog.append(heading,desc,grid,resetAll,status,footer);
    dialog.addEventListener('cancel',function(event){if(busy)event.preventDefault();});
    dialog.addEventListener('close',function(){urls.forEach(function(url){URL.revokeObjectURL(url);});urls.clear();dialog.remove();avatarButton.focus();},{once:true});
    stage.append(dialog);draw();refreshButtons();dialog.showModal();
  }

  // Move the actual nodes, never clone interactive elements or register a second write handler.
  var shortcuts = el('div', 'gp-shortcuts');
  var noticeButton = btn('gp-shortcut','群公告',function(){byId('actionGroupNotice').click();});
  noticeButton.setAttribute('aria-controls','gpNoticePanel');
  noticeButton.setAttribute('aria-expanded','false');
  var avatarButton = btn('gp-shortcut','群内头像',openPortraits);
  var searchCard = search.closest('.settings-card');
  var bgCard = background.closest('.settings-card');
  search.querySelector('.action-title').textContent = '查找';
  background.querySelector('.action-title').textContent = '背景';
  bilingual(noticeButton,'NOTICE');
  bilingual(avatarButton,'PORTRAITS');
  bilingual(search.querySelector('.action-title'),'SEARCH');
  bilingual(background.querySelector('.action-title'),'BACKGROUND');
  shortcuts.append(noticeButton,avatarButton,searchCard,bgCard);
  notice.classList.add('gp-notice-slot');
  var basicList = pin.closest('.settings-list');
  var basicLabel = basicList && basicList.previousElementSibling;
  pin.querySelector('.action-title').textContent = '置顶聊天';
  var pinToggle = byId('pinToggle');
  if (pinToggle) pinToggle.tabIndex = -1;
  var pinCard = pin.closest('.settings-card');
  pinCard.classList.add('gp-pin-card');
  pinCard.remove();
  // Move only the real pin row; keep time awareness and sound in their original sections.
  if (basicList && basicLabel && basicLabel.classList.contains('section-label') &&
      Array.from(basicList.children).every(function(n){return n.style.display === 'none';})) {
    basicLabel.style.display = 'none';
    basicList.style.display = 'none';
  }
  info.classList.add('gp-name-card');
  alias.classList.add('gp-alias-card');
  manage.classList.add('gp-manage-card');
  // The original inline management handler remains available on the member subpage.
  // On the overview the same entry navigates to the directory instead.
  byId('actionGroupManage').addEventListener('click',function(event){
    if(memberView)return;
    event.preventDefault();event.stopImmediatePropagation();
    var url=managementUrl('');
    if(url)location.href=url;
  },true);
  byId('gpAdvancedEntry').addEventListener('click',function(event){
    event.preventDefault();event.stopImmediatePropagation();
    var url=managementUrl('behavior');
    if(url)location.href=url;
  },true);
  byId('actionGroupInfo').prepend(el('span','gp-setting-label','群聊名称'));
  byId('actionGroupAlias').prepend(el('span','gp-setting-label','备注'));
  byId('actionGroupManage').querySelector('.action-title').textContent='群组管理';
  bilingual(byId('actionGroupManage').querySelector('.action-title'),'MANAGE');
  bilingual(byId('actionGroupInfo').querySelector('.gp-setting-label'),'NAME');
  bilingual(byId('actionGroupAlias').querySelector('.gp-setting-label'),'NOTE');
  bilingual(pin.querySelector('.action-title'),'PIN');
  bilingual(advanced.querySelector('.action-title'),'PLAY');
  bilingual(time.querySelector('.action-title'),'TIME');
  bilingual(sound.querySelector('.action-title'),'SOUND');
  list.classList.add('gp-settings-list');
  list.replaceChildren(manage,info,alias,own,pinCard,advanced);
  home.insertBefore(cover,list);
  home.insertBefore(toggle,list);
  home.insertBefore(drawer,list);
  home.insertBefore(shortcuts,list);
  home.insertBefore(notice,list);
  stage.classList.add('gp-editorial');
  home.classList.add('gp-editorial-home');
  var title = stage.querySelector('.cs-title');
  title.textContent='群聊设置';
  title.prepend(english('GROUP SETTINGS'));
  var fakeStatus = stage.parentElement.querySelector('.status-bar');
  if(fakeStatus) fakeStatus.hidden=true;
  if(memberView || memoryView){
    stage.classList.add('gp-subpage');
    var subpage=el('section','gp-subpage-content');
    subpage.id='gpSubpageContent';
    if(memberView){
      title.textContent='成员管理';title.prepend(english('MEMBERS'));
      subpage.append(manage);
      manage.classList.add('is-open');
      if(viewParams.get('intent')==='invite') requestAnimationFrame(function(){openManagement(true);});
    }else{
      title.textContent='记忆空间';title.prepend(english('MEMORY'));
      subpage.append(byId('memCard'));
    }
    stage.append(subpage);
    byId('btnBack').addEventListener('click',function(event){
      event.preventDefault();event.stopImmediatePropagation();
      var url=managementUrl(memoryView?'memory':'');
      if(memberView&&viewParams.get('intent')==='invite')url='chat-settings.html?roleId='+encodeURIComponent(String(roleId));
      if(url)location.href=url;
    },true);
  }
  renderMembers();
  refreshCover();
  new MutationObserver(renderMembers).observe(byId('gpMembersList'),{childList:true});
  new MutationObserver(refreshCover).observe(byId('bgSub'),{childList:true,characterData:true,subtree:true});
  new MutationObserver(function(){
    noticeButton.setAttribute('aria-expanded',String(notice.classList.contains('is-open')));
  }).observe(notice,{attributes:true,attributeFilter:['class']});
})();
