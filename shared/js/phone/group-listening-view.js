/* GROUP-MUSIC-001 M06. Group-only view; original catalog and native controller. */
(function(root){
  'use strict';
  const d=root.document, mounted=new WeakMap();
  const glyph={music:'<path d="M9 18V5l11-2v13M9 18c0 2-5 3-5 0s5-4 5 0M20 16c0 2-5 3-5 0s5-4 5 0"/>',play:'<path d="M9 5l11 7-11 7z"/>',pause:'<path d="M9 5v14M15 5v14"/>',close:'<path d="M6 6l12 12M18 6L6 18"/>',next:'<path d="M5 5l11 7-11 7zM19 5v14"/>',prev:'<path d="M19 5L8 12l11 7zM5 5v14"/>'};
  const icon=k=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+glyph[k]+'</svg>';
  const labels={selecting:'选歌中',ready:'等待播放',loading:'正在加载',playing:'一起听歌',paused:'已暂停',error:'播放未成功'};
  const errors={PLAYBACK_BUSY:'另一个窗口正在播放，请先暂停后重试',LOCK_UNAVAILABLE:'当前浏览器不支持安全播放协调',SOURCE_MISSING:'歌曲文件暂时无法读取，请检查原音乐库',PLAY_REJECTED:'无法播放，请重试或检查手机播放权限',TRACK_UNAVAILABLE:'歌曲不可用，请重新选歌',GROUP_UNAVAILABLE:'群聊已变化，请重新进入',SCOPE_CHANGED:'群聊或账号已变化，请重新进入',SESSION_UNAVAILABLE:'听歌会话已失效，请重新开始'};
  function el(tag,cls,text){const e=d.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function button(text,cls,action){const e=el('button',cls,text);e.type='button';e.addEventListener('click',action);return e;}
  function mount(o){
    const {host,menu,header,getGroupScope,hasRole,memberName,paintAvatar,notify}=o||{};
    if(!host||!menu||!header||typeof getGroupScope!=='function'||typeof hasRole!=='function'||!root.MAOGroupListeningSession||!root.MAOMusicCatalogAdapter)return null;
    if(mounted.has(host))return mounted.get(host);
    const catalog=root.MAOMusicCatalogAdapter,initial=getGroupScope();
    if(!initial)return null;
    const account=initial.account,groupId=initial.id,identity=root.__MAO_ACCOUNT_SCOPE__,storage=root.localStorage,idb=root.indexedDB;
    let dead=false,api=null,unsubscribe=null,audio=null,mode='',selected=new Set(),rows=[],page=0,lastKey='',pendingRender=false,coverTicket=0,coverUrl=null,coverKey='',lastFocus=null,searchValue='',listEpoch=0,timer=null;
    let media=null;const listUrls=new Set();
    function scope(){
      try{const f=getGroupScope();return !dead&&f&&f.id===groupId&&f.account===account&&root.__MAO_ACCOUNT_SCOPE__===identity&&root.localStorage===storage&&root.indexedDB===idb?f:null;}catch{return null;}
    }
    function warn(code){if(scope()&&typeof notify==='function')notify(errors[code]||'操作未完成，请重试');}
    const entry=button('', 'plus-item',()=>open());entry.dataset.groupListeningEntry='1';entry.innerHTML='<span class="plus-icon-circle">'+icon('music')+'</span><span class="plus-label">一起听歌</span>';menu.append(entry);
    const strip=el('section','glisten-strip');strip.id='groupListeningStrip';strip.hidden=true;
    strip.innerHTML='<button type="button" class="glisten-open" aria-label="打开一起听歌详情"><span class="glisten-cover"></span><span class="glisten-text"><strong></strong><small></small></span><span class="glisten-faces"></span></button><button type="button" class="glisten-icon glisten-toggle" aria-label="播放"></button>';
    header.after(strip);
    const dialog=el('dialog','glisten-dialog');dialog.id='groupListeningDialog';dialog.setAttribute('aria-labelledby','groupListeningHeading');
    dialog.innerHTML='<div class="glisten-sheet"><div class="glisten-head"><h2 id="groupListeningHeading">一起听歌</h2><button type="button" class="glisten-icon glisten-close" aria-label="关闭">'+icon('close')+'</button></div><p class="glisten-hint"></p><div class="glisten-body"></div><div class="glisten-foot"></div></div>';
    host.append(dialog);
    const $=s=>dialog.querySelector(s),body=$('.glisten-body'),foot=$('.glisten-foot'),hint=$('.glisten-hint'),title=$('h2'),stripCover=strip.querySelector('.glisten-cover'),toggle=strip.querySelector('.glisten-toggle');
    strip.querySelector('.glisten-open').onclick=()=>openDetail();toggle.onclick=()=>void togglePlay();
    $('.glisten-close').onclick=()=>dialog.close();
    dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
    dialog.addEventListener('close',()=>{if(dialog.open||dead)return;mode='';body.replaceChildren();foot.replaceChildren();clearListUrls();lastKey='';if(lastFocus?.isConnected&&!lastFocus.closest('[hidden]'))lastFocus.focus();lastFocus=null;syncTimer();});
    function clearListUrls(){listEpoch++;for(const url of listUrls)root.URL.revokeObjectURL(url);listUrls.clear();}
    function clearCover(){coverTicket++;coverKey='';if(coverUrl)root.URL.revokeObjectURL(coverUrl);coverUrl=null;stripCover.innerHTML=icon('music');}
    function get(id){try{const result=scope()&&catalog.getTrack(id);return result?.ok?result.track:null;}catch{return null;}}
    function getMedia(){if(!media&&root.PhoneStorage?.MediaRepository)media=new root.PhoneStorage.MediaRepository();return media;}
    async function thumbnail(node,track,epoch){
      if(!track?.coverAssetId||!scope())return;
      try{const repo=getMedia();if(!repo)return;const v=await repo.getBlob(track.coverAssetId);
        if(!scope()||epoch!==listEpoch||!node.isConnected||!v?.ok||!/^image\//.test(v.value?.type||''))return;
        const url=root.URL.createObjectURL(v.value);listUrls.add(url);const image=el('img');image.alt='';image.src=url;node.replaceChildren(image);
      }catch{}
    }
    function paintCover(node,url){if(!node)return;if(!url){node.innerHTML=icon('music');return;}const img=el('img');img.alt='';img.src=url;node.replaceChildren(img);}
    function currentCover(track){
      const key=track?track.id+'|'+(track.coverAssetId||''):'';
      if(key===coverKey)return;
      clearCover();coverKey=key;const ticket=coverTicket;
      if(!track?.coverAssetId)return;
      void(async()=>{try{const repo=getMedia();if(!repo)return;const v=await repo.getBlob(track.coverAssetId);
        if(ticket!==coverTicket||!scope()||!v?.ok||!/^image\//.test(v.value?.type||''))return;
        coverUrl=root.URL.createObjectURL(v.value);paintCover(stripCover,coverUrl);paintCover(body.querySelector('.glisten-now .glisten-cover'),coverUrl);
      }catch{}})();
    }
    function disposeSession(){const old=api;api=null;if(unsubscribe)unsubscribe();unsubscribe=null;if(old)old.destroy();if(audio)audio.remove();audio=null;clearCover();}
    function snapshot(){if(!scope())return null;return api?.getSnapshot()||null;}
    function ensureSession(){
      if(!scope())return false;
      if(api){const s=snapshot();if(s&&s.status!=='ended')return true;disposeSession();}
      try{
        audio=el('audio');audio.hidden=true;audio.preload='metadata';audio.dataset.groupListeningAudio='1';host.append(audio);
        api=root.MAOGroupListeningSession.createForGroup({audio,getGroupId:()=>scope()?.id||null,hasRole});
        unsubscribe=api.subscribe(e=>{if(e.type==='invalidated'){strip.hidden=true;clearCover();if(dialog.open)dialog.close();}schedule();});
        const r=api.start();if(!r.ok){warn(r.code);disposeSession();return false;}syncTimer();return true;
      }catch{disposeSession();warn('GROUP_UNAVAILABLE');return false;}
    }
    function schedule(){if(dead||pendingRender)return;pendingRender=true;root.setTimeout(()=>{pendingRender=false;render();},0);}
    function displayDialog(which){
      if(!scope()||typeof dialog.showModal!=='function'){warn('GROUP_UNAVAILABLE');return false;}
      if(!dialog.open){lastFocus=strip.hidden?d.getElementById('plus-action-btn'):strip.querySelector('.glisten-open');try{dialog.showModal();}catch{return false;}}
      mode=which;lastKey='';syncTimer();return true;
    }
    function open(){
      if(typeof root.closePlusPanel==='function')root.closePlusPanel();
      if(!scope()){warn('GROUP_UNAVAILABLE');return;}
      const s=snapshot();
      if(s?.trackId&&s.status!=='ended')openDetail();else openPicker();
    }
    function openPicker(){
      if(!displayDialog('picker'))return;
      const s=snapshot(),result=catalog.listTracks();
      rows=result?.ok?result.tracks:[];selected=new Set(s?.queue||[]);page=0;searchValue='';
      title.textContent='选择歌曲';hint.textContent=result?.ok?(rows.length?'来自你的音乐库 · 最多选择100首':'音乐库还没有歌曲，请先在音乐应用中导入'):'音乐库暂时无法读取，请稍后重试';
      renderPicker();
    }
    function renderPicker(){
      clearListUrls();body.replaceChildren();foot.replaceChildren();
      const search=el('input','glisten-search');search.type='search';search.placeholder='搜索曲名或歌手';search.value=searchValue;search.setAttribute('aria-label','搜索歌曲');
      const list=el('div','glisten-list'),count=el('small','glisten-count'),paging=el('div','glisten-paging'),position=el('small','glisten-count'),previous=button('上一页','glisten-secondary',()=>{page--;draw();}),more=button('下一页','glisten-secondary',()=>{page++;draw();});paging.append(previous,position,more);
      const confirm=button('开始播放','glisten-primary',()=>void confirmSelection());confirm.dataset.glistenStart='1';
      function draw(){
        clearListUrls();const epoch=listEpoch;list.replaceChildren();
        const query=searchValue.trim().toLocaleLowerCase(),filtered=rows.filter(t=>!query||(t.name+' '+t.artist).toLocaleLowerCase().includes(query));
        const pages=Math.max(1,Math.ceil(filtered.length/24));page=Math.min(pages-1,Math.max(0,page));const shown=filtered.slice(page*24,(page+1)*24);
        for(const track of shown){
          const row=el('label','glisten-track'),cover=el('span','glisten-cover');cover.innerHTML=icon('music');
          const words=el('span','glisten-text');words.append(el('strong','',track.name),el('small','',track.artist));
          const box=el('input');box.type='checkbox';box.checked=selected.has(track.id);box.dataset.glistenTrack=track.id;box.setAttribute('aria-label','选择 '+track.name);
          box.onchange=()=>{if(box.checked&&selected.size>=100){box.checked=false;return;}if(box.checked)selected.add(track.id);else selected.delete(track.id);updateCount();};
          row.append(cover,words,box);list.append(row);void thumbnail(cover,track,epoch);
        }
        if(!shown.length)list.append(el('p','glisten-empty',rows.length?'没有匹配的歌曲':'暂无歌曲'));
        paging.hidden=pages<=1;previous.disabled=page===0;more.disabled=page>=pages-1;position.textContent=(page+1)+' / '+pages;updateCount();
      }
      function updateCount(){count.textContent='已选 '+selected.size+' 首';confirm.disabled=!selected.size;}
      search.oninput=()=>{searchValue=search.value;page=0;draw();};
      body.append(search,list,paging);foot.append(count,confirm);draw();
    }
    async function confirmSelection(){
      if(!scope()||!dialog.open||mode!=='picker'||!selected.size)return;
      const ids=[...selected];if(ids.some(id=>!get(id))){warn('TRACK_UNAVAILABLE');return;}
      if(!ensureSession())return;const s=snapshot();if(!s)return;
      const picked=api.selectTrack(s,ids[0]);if(!picked.ok){warn(picked.code);return;}
      const queued=api.setQueue(picked.snapshot,ids);if(!queued.ok){warn(queued.code);return;}
      dialog.close();render();await play(queued.snapshot);
    }
    async function play(s){
      const active=api;if(!s||!active)return;
      const r=await active.play(s);if(api!==active||!scope())return;
      if(!r.ok&&!['STALE_COMMAND','SESSION_UNAVAILABLE'].includes(r.code))warn(r.code);render();
    }
    async function togglePlay(){
      const s=snapshot();if(!s||!api)return;
      if(s.playing||s.status==='loading'){const r=api.pause(s);if(!r.ok)warn(r.code);render();}
      else await play(s);
    }
    async function changeTrack(id){
      const s=snapshot();if(!s||!api)return;
      const r=api.selectTrack(s,id);if(!r.ok){warn(r.code);return;}render();await play(r.snapshot);
    }
    function adjacent(delta){
      const s=snapshot();if(!s)return;const i=s.queue.indexOf(s.trackId)+delta;
      if(i>=0&&i<s.queue.length)void changeTrack(s.queue[i]);
    }
    function showMember(node,id){
      const f=scope(),row=id==='__user'?null:f?.group.members.find(m=>String(m.id)===id);
      const name=id==='__user'?'我':row?String(memberName?.(row)||row.name||'成员'):'成员';
      node.title=name;node.textContent=[...name][0]||'';
      if(typeof paintAvatar==='function'&&f&&(id==='__user'||row))try{paintAvatar(node,id,row);}catch{}
      return name;
    }
    function openDetail(){if(!snapshot()?.trackId)return;if(displayDialog('detail'))render();}
    function makeIcon(k,label,fn){const e=button('','glisten-icon',fn);e.innerHTML=icon(k);e.setAttribute('aria-label',label);return e;}
    function detail(s,track){
      clearListUrls();body.replaceChildren();foot.replaceChildren();title.textContent='一起听歌';
      hint.textContent='本机播放 · 角色参与为聊天互动，不会接收音频';
      const now=el('div','glisten-now'),cover=el('span','glisten-cover'),words=el('span','glisten-text');
      paintCover(cover,coverUrl);words.append(el('strong','',track?.name||'歌曲不可用'),el('small','',track?.artist||''));now.append(cover,words);
      const seek=el('input','glisten-seek');seek.type='range';seek.min='0';seek.step='0.1';seek.setAttribute('aria-label','播放进度');seek.dataset.glistenSeek='1';
      let dragging=false;seek.addEventListener('pointerdown',()=>{dragging=true;seek.dataset.dragging='1';});for(const ev of ['pointerup','pointercancel','blur'])seek.addEventListener(ev,()=>{dragging=false;delete seek.dataset.dragging;});
      seek.onchange=()=>{const live=snapshot();if(seek.isConnected&&live&&api&&live.sessionId===s.sessionId&&live.trackId===s.trackId&&live.revision===s.revision){const r=api.seek(live,Number(seek.value));if(!r.ok)warn(r.code);render();}if(dragging)delete seek.dataset.dragging;};
      const times=el('div','glisten-times');times.append(el('span'),el('span'));
      const controls=el('div','glisten-controls'),prev=makeIcon('prev','上一首',()=>adjacent(-1)),playBtn=makeIcon(s.playing||s.status==='loading'?'pause':'play',s.playing||s.status==='loading'?'暂停':'播放',()=>void togglePlay()),next=makeIcon('next','下一首',()=>adjacent(1));playBtn.classList.add('glisten-main');prev.disabled=s.queue.indexOf(s.trackId)<=0;next.disabled=s.queue.indexOf(s.trackId)>=s.queue.length-1;controls.append(prev,playBtn,next);
      const people=el('div','glisten-members'),f=scope();
      people.append(el('span','glisten-person','我'));
      for(const m of f?.group.members||[]){const id=String(m.id),joined=s.participants.includes(id);
        if(!hasRole(id)||root.GroupGovernance.isMuted(m))continue;
        const name=String(memberName?.(m)||m.name||'成员'),btn=button(name+(joined?' · 已加入':' · 加入'),'glisten-person',()=>{
          const live=snapshot();if(!live||!api)return;const r=live.participants.includes(id)?api.leave(live,id):api.join(live,id);if(!r.ok)warn(r.code);render();
        });btn.dataset.glistenMember=id;btn.setAttribute('aria-pressed',String(joined));btn.disabled=s.status==='loading';people.append(btn);
      }
      const queue=el('div','glisten-queue');
      const catalogResult=catalog.listTracks(),queueTracks=new Map((catalogResult?.ok?catalogResult.tracks:[]).map(t=>[t.id,t]));
      for(const id of s.queue){const t=queueTracks.get(id);const row=button(t?.name||'歌曲不可用','glisten-queue-item',()=>void changeTrack(id));row.dataset.glistenQueue=id;row.disabled=!t;row.setAttribute('aria-current',id===s.trackId?'true':'false');queue.append(row);}
      const edit=button('重新选歌','glisten-secondary',openPicker),end=button('结束一起听歌','glisten-end',()=>{
        const live=snapshot();if(live&&api){const r=api.end(live);if(!r.ok){warn(r.code);return;}}disposeSession();if(dialog.open)dialog.close();render();syncTimer();
      });end.dataset.glistenEnd='1';
      body.append(now,seek,times,controls,el('h3','','参与成员'),people,el('h3','','播放队列'),queue);foot.append(edit,end);
      updateProgress(s);
    }
    function time(v){const n=Math.floor(Math.max(0,Number(v)||0));return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
    function updateProgress(s){const seek=body.querySelector('.glisten-seek'),times=body.querySelector('.glisten-times');if(!seek||!times)return;
      seek.disabled=!s.duration||!['playing','paused'].includes(s.status);seek.max=String(s.duration||0);if(!seek.dataset.dragging)seek.value=String(s.currentTime||0);
      times.firstChild.textContent=time(s.currentTime);times.lastChild.textContent=time(s.duration);
    }
    function render(){
      if(dead)return;
      if(!scope()){destroy();return;}
      const s=snapshot();if(!s||s.status==='ended'){if(api)disposeSession();strip.hidden=true;clearCover();if(mode==='detail'&&dialog.open)dialog.close();lastKey='';syncTimer();return;}
      if(!s.trackId){strip.hidden=true;lastKey='';return;}
      strip.hidden=false;const key=s.sessionId+':'+s.revision;
      if(key!==lastKey){
        const track=get(s.trackId);
        strip.querySelector('strong').textContent=track?.name||'歌曲不可用';
        strip.querySelector('small').textContent=labels[s.status]||'一起听歌';
        toggle.innerHTML=icon(s.playing||s.status==='loading'?'pause':'play');toggle.setAttribute('aria-label',s.playing||s.status==='loading'?'暂停':'播放');
        const faces=strip.querySelector('.glisten-faces');faces.replaceChildren();for(const id of s.participants.slice(0,3)){const av=el('span','glisten-avatar');showMember(av,id);faces.append(av);}
        faces.setAttribute('aria-label',s.participants.length+' 位参与成员');
        currentCover(track);
        if(mode==='detail'&&dialog.open)detail(s,track);
        lastKey=key;
      }
      if(mode==='detail'&&dialog.open)updateProgress(s);
    }
    function tick(){if(!scope()){destroy();return;}if(api)render();}
    function syncTimer(){const needed=!dead&&(!!api||dialog.open);if(needed&&timer===null)timer=root.setInterval(tick,1000);else if(!needed&&timer!==null){root.clearInterval(timer);timer=null;}}
    function destroy(){if(dead)return;dead=true;if(timer!==null)root.clearInterval(timer);timer=null;root.removeEventListener('pagehide',destroy);root.removeEventListener('storage',tick);disposeSession();clearListUrls();if(dialog.open)dialog.close();entry.remove();strip.remove();dialog.remove();mounted.delete(host);}
    root.addEventListener('pagehide',destroy);root.addEventListener('storage',tick);
    const out=Object.freeze({destroy,getSnapshot:snapshot});mounted.set(host,out);return out;
  }
  root.MAOGroupListeningView=Object.freeze({version:1,mount});
})(window);
