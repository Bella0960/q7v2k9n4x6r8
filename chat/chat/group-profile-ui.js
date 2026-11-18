/* GROUP-UI-002 · presentation-only group profile.
   Never rewrites group members, role identities, messages or existing controls. */
(function () {
  'use strict';
  var id = typeof roleId === 'string' ? roleId : '';
  if (!id || id.charAt(0) !== 'g' || typeof isGroupSetting === 'undefined' || !isGroupSetting) return;
  var stage = document.querySelector('.cs-stage');
  var groupSection = document.getElementById('groupInfoSection');
  var topbar = document.querySelector('.cs-topbar');
  if (!stage || !groupSection || !topbar || !document.getElementById('gpMembersList')) return;
  stage.classList.add('group-profile-page');
  var title = topbar.querySelector('.cs-title');
  if (title) title.textContent = '群聊资料';

  function el(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
  }
  function labelText(name) {
    return ({BASIC:'聊天与背景',MEMORY:'记录与记忆',INTERACTION:'互动与角色',SOUND:'消息与声音',
      SOCIAL:'社交动态','CHAT TOOLS':'聊天工具',CHAT:'更多管理'})[name] || name;
  }
  function fold(name) {
    var box = el('details','gp-profile-fold');
    var summary = el('summary');
    var heading = el('strong','',name);
    var icon = el('span','gp-fold-chevron');
    icon.setAttribute('aria-hidden','true');
    summary.appendChild(heading);
    summary.appendChild(icon);
    var content = el('div','gp-fold-content');
    box.appendChild(summary);
    box.appendChild(content);
    return {root:box,content:content};
  }
  // Wrap real, already-initialized settings elements rather than cloning
  // their buttons or handlers. Existing IDs and save operations remain intact.
  var oldNodes = Array.from(stage.children);
  var start = oldNodes.indexOf(groupSection);
  if (start === -1) return;
  var visual = el('div','gp-visual');
  stage.insertBefore(visual,groupSection);
  var folds = el('div','gp-profile-folds');
  stage.insertBefore(folds,groupSection);
  var groupFold = fold('群资料与成员');
  groupFold.root.id = 'gpProfileSettings';
  groupFold.content.appendChild(groupSection);
  folds.appendChild(groupFold.root);
  var active = null;
  oldNodes.slice(start+1).forEach(function (node) {
    if (node.classList.contains('cs-footer')) {
      node.style.display = 'none';
      return;
    }
    if (node.classList.contains('section-label')) {
      active = fold(labelText(node.textContent.trim()));
      folds.appendChild(active.root);
    }
    if (active) active.content.appendChild(node);
  });
  // Group-only sections already suppressed by the legacy logic remain hidden.
  Array.from(folds.querySelectorAll('.gp-profile-fold')).forEach(function (detail) {
    if (detail === groupFold.root) return;
    var blocks = Array.from(detail.querySelectorAll('.settings-list'));
    if (blocks.length && blocks.every(function (node) {
      return node.style.display === 'none' || Array.from(node.querySelectorAll('.settings-card')).every(function (card) {
        return card.style.display === 'none';
      });
    })) detail.hidden = true;
  });

  var hero = el('div','gp-cover-hero');
  hero.innerHTML =
    '<img class="gp-cover-photo" alt="">' +
    '<div class="gp-cover-controls">' +
      '<button type="button" class="gp-cover-control" id="gpCoverChoose">更换封面</button>' +
      '<button type="button" class="gp-cover-control" id="gpCoverReset" hidden>恢复默认</button>' +
    '</div>' +
    '<div class="gp-cover-title"><div class="gp-cover-name" id="gpCoverName"></div>' +
      '<div class="gp-cover-count" id="gpCoverCount"></div></div>' +
    '<input id="gpCoverFile" type="file" accept="image/*" hidden>';
  visual.appendChild(hero);
  var photo = hero.querySelector('.gp-cover-photo');
  var pick = hero.querySelector('#gpCoverChoose');
  var reset = hero.querySelector('#gpCoverReset');
  var input = hero.querySelector('#gpCoverFile');
  var previewHeader = el('div','gp-preview-head');
  previewHeader.appendChild(el('strong','','群成员'));
  var counter = el('span');
  previewHeader.appendChild(counter);
  visual.appendChild(previewHeader);
  var rail = el('div','gp-preview-members');
  visual.appendChild(rail);

  var quick = el('div','gp-quick');
  visual.appendChild(quick);
  var icons = {
    notice:'<path d="M4 9a8 8 0 0 1 16 0v7H4z"/><path d="M10 20h4M8 16v2m8-2v2"/>',
    search:'<circle cx="10.8" cy="10.8" r="6.7"/><path d="m16 16 5 5"/>',
    background:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m4 17 5-5 4 4 3-3 4 4"/>',
    settings:'<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="1.5"/><circle cx="15" cy="12" r="1.5"/>'
  };
  function openPanel(actionId, cardId) {
    groupFold.root.open = true;
    var action = document.getElementById(actionId);
    var card = document.getElementById(cardId);
    if (card && !card.classList.contains('is-open') && action) action.click();
    if (card) card.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  [
    ['群公告','notice',function(){openPanel('actionGroupNotice','gpNoticeCard');}],
    ['查找','search',function(){document.getElementById('actionSearchHistory').click();}],
    ['背景','background',function(){document.getElementById('actionBackground').click();}],
    ['群设置','settings',function(){groupFold.root.open=true;groupFold.root.scrollIntoView({behavior:'smooth',block:'nearest'});}]
  ].forEach(function (item) {
    var btn = el('button','gp-quick-button');
    btn.type='button';
    btn.innerHTML='<span class="gp-quick-icon"><svg viewBox="0 0 24 24" aria-hidden="true">'+icons[item[1]]+'</svg></span>';
    btn.appendChild(el('span','',item[0]));
    btn.addEventListener('click',item[2]);
    quick.appendChild(btn);
  });

  function currentGroup() {
    try {
      var list = JSON.parse(localStorage.getItem('phone_groups') || '[]');
      return Array.isArray(list) ? list.find(function(g){return g && String(g.id)===id;}) : null;
    } catch (e) { return null; }
  }
  function safeImage(value) {
    var url = String(value || '');
    return /^(data:image\/(?:png|jpeg|webp|gif);|blob:|https?:\/\/|\.{0,2}\/)/i.test(url) ? url : '';
  }
  function invite() {
    groupFold.root.open=true;
    openPanel('actionGroupManage','gpManageCard');
    var block = document.getElementById('gpInviteBlock');
    if (block && !block.classList.contains('is-open')) document.getElementById('gpInviteToggle').click();
    if (block) block.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  function sync() {
    var group = currentGroup();
    var name = group && group.name || '群聊';
    var members = group && Array.isArray(group.members) ? group.members : [];
    hero.querySelector('#gpCoverName').textContent=name;
    hero.querySelector('#gpCoverCount').textContent=members.length+' 位成员';
    counter.textContent=members.length+' 位';
    rail.replaceChildren();
    members.slice(0,6).forEach(function(member) {
      var person = el('div','gp-preview-person');
      var avatar = el('span','gp-preview-avatar');
      var url = safeImage(member && member.avatar);
      if (url) {
        var img = el('img');
        img.alt='';
        img.loading='lazy';
        img.src=url;
        avatar.appendChild(img);
      } else avatar.textContent=String(member && member.name || '成').slice(0,1);
      person.appendChild(avatar);
      person.appendChild(el('small','',member && member.nickname || member && member.name || '成员'));
      rail.appendChild(person);
    });
    var more = el('button','gp-preview-person gp-add');
    more.type='button';
    more.setAttribute('aria-label','邀请群成员');
    more.appendChild(el('span','gp-preview-avatar','+'));
    more.appendChild(el('small','','邀请'));
    more.addEventListener('click',invite);
    rail.appendChild(more);
  }
  sync();
  var membersList=document.getElementById('gpMembersList');
  var originalName=document.getElementById('gpNameText');
  var observer=new MutationObserver(sync);
  observer.observe(membersList,{childList:true});
  if (originalName) observer.observe(originalName,{childList:true,characterData:true,subtree:true});

  // Existing wallpaper database, separate key per group; IDB-only write.
  // Never put user-supplied cover binaries into localStorage/phone_groups.
  var coverKey='chat_group_profile_cover_v1_'+id;
  function imageStore(mode, data) {
    return new Promise(function(resolve,reject){
      if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
      var request=indexedDB.open('maomao-media-store',2);
      request.onupgradeneeded=function(){
        var db=request.result;
        if(!db.objectStoreNames.contains('wallpapers')) db.createObjectStore('wallpapers');
        if(!db.objectStoreNames.contains('audio')) db.createObjectStore('audio',{keyPath:'id'});
      };
      request.onerror=function(){reject(request.error||new Error('storage unavailable'));};
      request.onblocked=function(){reject(new Error('storage blocked'));};
      request.onsuccess=function(){
        var db=request.result;
        try {
          var tx=db.transaction('wallpapers','readwrite');
          var store=tx.objectStore('wallpapers');
          if(mode==='remove') store.delete(coverKey);
          else store.put({dataUrl:data,updatedAt:Date.now()},coverKey);
          tx.oncomplete=function(){db.close();resolve(true);};
          tx.onabort=tx.onerror=function(){db.close();reject(tx.error||new Error('save failed'));};
        }catch(e){db.close();reject(e);}
      };
    });
  }
  var coverGeneration=0;
  var coverTouched=false;
  var coverBusy=false;
  function setCoverBusy(busy) {
    coverBusy=Boolean(busy);
    pick.disabled=coverBusy;
    reset.disabled=coverBusy;
  }
  function showCover(dataUrl) {
    var generation=++coverGeneration;
    if(!dataUrl){photo.removeAttribute('src');hero.classList.remove('has-photo','tone-dark');reset.hidden=true;return;}
    photo.src=dataUrl;
    hero.classList.add('has-photo');
    reset.hidden=false;
    if(window.MAOMAOWallpaperStore && typeof MAOMAOWallpaperStore.detectTone==='function'){
      MAOMAOWallpaperStore.detectTone(dataUrl).then(function(tone){
        if(generation===coverGeneration) hero.classList.toggle('tone-dark',tone==='dark');
      });
    }
  }
  if(window.MAOMAOWallpaperStore && MAOMAOWallpaperStore.getByKey){
    MAOMAOWallpaperStore.getByKey(coverKey).then(function(value){if(!coverTouched)showCover(value);}).catch(function(){});
  }
  function notify(message){
    if(typeof showToast==='function') showToast(message);
  }
  pick.addEventListener('click',function(){if(!coverBusy) input.click();});
  input.addEventListener('change',function(){
    var file=input.files&&input.files[0];
    input.value='';
    if(!file || coverBusy) return;
    if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type)||file.size>10*1024*1024){notify('请选择10MB以内的 PNG、JPG、WebP 或 GIF 图片');return;}
    coverTouched=true;
    setCoverBusy(true);
    var src;
    try { src=URL.createObjectURL(file); }
    catch(e){setCoverBusy(false);notify('无法读取图片');return;}
    var img=new Image();
    img.onload=function(){
      URL.revokeObjectURL(src);
      try {
        var canvas=document.createElement('canvas');
        var target=2.05,w=960,h=Math.round(w/target);
        canvas.width=w;canvas.height=h;
        var sourceRatio=img.width/img.height;
        var sw=sourceRatio>target?img.height*target:img.width;
        var sh=sourceRatio>target?img.height:img.width/target;
        canvas.getContext('2d').drawImage(img,(img.width-sw)/2,(img.height-sh)/2,sw,sh,0,0,w,h);
        var data=canvas.toDataURL('image/jpeg',.79);
        imageStore('save',data).then(function(){showCover(data);notify('封面已保存');})
          .catch(function(){notify('封面保存失败，请检查存储空间');})
          .finally(function(){setCoverBusy(false);});
      }catch(e){setCoverBusy(false);notify('图片处理失败');}
    };
    img.onerror=function(){URL.revokeObjectURL(src);setCoverBusy(false);notify('图片无法读取');};
    img.src=src;
  });
  reset.addEventListener('click',function(){
    if(coverBusy) return;
    coverTouched=true;
    setCoverBusy(true);
    imageStore('remove').then(function(){showCover('');notify('已恢复默认封面');})
      .catch(function(){notify('恢复失败，请重试');}).finally(function(){setCoverBusy(false);});
  });
})();
