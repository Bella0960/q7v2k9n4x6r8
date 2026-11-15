/* MAOMAO game panel: only shows current game's simple options.
 * The existing group settings IA remains the navigation owner.
 */
(function (root) {
  'use strict';
  function init() {
    var pane=document.querySelector('[data-group-category="games"]');
    var api=root.GroupGameSessions;
    if (!pane || !api || document.getElementById('groupGameSessionPanel')) return;
    var params=new URLSearchParams(root.location.search);
    var gid=params.get('id')||params.get('roleId')||'';
    function currentGroup(){
      try {
        var all=JSON.parse(root.localStorage.getItem('phone_groups')||'[]');
        return Array.isArray(all)?all.find(function(g){return g&&String(g.id)===String(gid);}):null;
      }catch(e){return null;}
    }
    var panel=document.createElement('section');
    panel.id='groupGameSessionPanel';
    panel.className='group-game-settings';
    panel.innerHTML=
      '<div class="group-game-head">猜猜谁是坏人 <span>IDENTITY GAME</span></div>'+
      '<p class="group-game-description">主持人私下分配身份牌。成员在群里猜谁是坏人；身份不会写进群聊消息。</p>'+
      '<div id="groupGameCurrent"></div>'+
      '<form id="groupGameStartForm" class="group-game-form">'+
      '<label for="groupGameBadRole">秘密指定坏人</label>'+
      '<select id="groupGameBadRole" required></select>'+
      '<label class="group-game-check"><span>允许游戏私聊</span><input type="checkbox" id="groupGamePrivate"></label>'+
      '<label class="group-game-check" id="groupGameActivityRow" hidden><span>显示私聊动向（不显示内容）</span><input type="checkbox" id="groupGameActivity"></label>'+
      '<button type="submit" class="group-game-button">发身份牌并开始</button>'+
      '</form>'+
      '<details id="groupGameWhisperPanel" class="group-game-whisper" hidden>'+
      '<summary>本局私聊</summary>'+
      '<p class="group-game-description">只有你和收件人能看到这段游戏私聊。角色之间的秘密不会在这里显示。</p>'+
      '<label for="groupGameWhisperTo">私聊对象</label>'+
      '<select id="groupGameWhisperTo"></select>'+
      '<ol id="groupGameWhisperConversation" class="group-game-conversation"></ol>'+
      '<form id="groupGameWhisperForm" class="group-game-form">'+
      '<label for="groupGameWhisperText">发送游戏私聊</label>'+
      '<textarea id="groupGameWhisperText" maxlength="240" rows="2" placeholder="给这位角色单独说点什么"></textarea>'+
      '<button type="submit" class="group-game-button">发送私聊</button>'+
      '</form>'+
      '</details>'+
      '<button type="button" id="groupGameFinish" class="group-game-button secondary" hidden>结束游戏 · 揭晓身份</button>'+
      '<button type="button" id="groupGameCancel" class="group-game-button secondary" hidden>取消本局（不揭晓）</button>'+
      '<button type="button" id="groupGameCleanup" class="group-game-button secondary" hidden>重试清理临时数据</button>'+
      '<p id="groupGameNotice" class="group-game-notice" role="status" aria-live="polite"></p>';
    var style=document.createElement('style');
    style.id='group-game-panel-style';
    style.textContent=
      '.group-game-settings{border-top:1px solid #efefef;margin-top:24px;padding-top:19px;color:#222}' +
      '.group-game-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font:500 17px/1.5 Georgia,"Songti SC",serif}' +
      '.group-game-head span{font:9px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;color:#aaa;letter-spacing:.1em}' +
      '.group-game-description,.group-game-notice{font:11px/1.8 -apple-system,BlinkMacSystemFont,sans-serif;color:#888;margin:9px 0 16px}' +
      '.group-game-form{display:flex;flex-direction:column;gap:10px}' +
      '.group-game-form>label:not(.group-game-check){font-size:11px;color:#666}' +
      '.group-game-form select{border:1px solid #e5e5e8;border-radius:10px;padding:10px;background:#fff;font:12px sans-serif;color:#222}' +
      '.group-game-check{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;font-size:12px;color:#555;border-bottom:1px solid #efefef}' +
      '.group-game-check[hidden]{display:none!important}.group-game-check input{width:17px;height:17px;accent-color:#111}' +
      '.group-game-button{border:0;background:#111;color:#fff;padding:12px 14px;border-radius:11px;margin-top:8px;font:12px sans-serif;cursor:pointer}' +
      '.group-game-button.secondary{background:#f2f2f4;color:#333;width:100%;margin-top:15px}' +
      '.group-game-state{font-size:12px;color:#555;line-height:1.8;margin:13px 0}' +
      '.group-game-activity{margin:10px 0 0;padding:0;list-style:none;font:10px/2 sans-serif;color:#999}' +
      '.group-game-whisper{border-top:1px solid #ededed;margin-top:18px;padding:10px 0 14px}' +
      '.group-game-whisper[hidden]{display:none!important}.group-game-whisper summary{font:12px/1.6 sans-serif;color:#333;cursor:pointer;padding:9px 0}' +
      '.group-game-whisper select,.group-game-whisper textarea{display:block;width:100%;margin-top:7px;padding:10px;border-radius:10px;border:1px solid #e5e5e8;background:#fff;color:#222;font:12px/1.5 sans-serif}' +
      '.group-game-whisper>label{font:11px/1.8 sans-serif;color:#777}.group-game-conversation{list-style:none;margin:10px 0;padding:0;max-height:210px;overflow-y:auto}' +
      '.group-game-conversation li{padding:8px 0;color:#555;font:11px/1.7 sans-serif;white-space:pre-wrap;overflow-wrap:anywhere}' +
      '.group-game-conversation li[data-direction="sent"]{color:#222}.group-game-conversation li+li{border-top:1px solid #f1f1f1}';
    document.head.appendChild(style);
    pane.appendChild(panel);
    var group=currentGroup(),isOwner=group&&String(group.ownerId||'__user')==='__user';
    var form=panel.querySelector('#groupGameStartForm'), select=panel.querySelector('#groupGameBadRole'),
      allowed=panel.querySelector('#groupGamePrivate'), activity=panel.querySelector('#groupGameActivity'),
      activityRow=panel.querySelector('#groupGameActivityRow'),
      current=panel.querySelector('#groupGameCurrent'), finish=panel.querySelector('#groupGameFinish'),
      cancelButton=panel.querySelector('#groupGameCancel'),
      cleanupButton=panel.querySelector('#groupGameCleanup'),
      notice=panel.querySelector('#groupGameNotice'),
      whisperPanel=panel.querySelector('#groupGameWhisperPanel'),
      whisperTo=panel.querySelector('#groupGameWhisperTo'),
      whisperText=panel.querySelector('#groupGameWhisperText'),
      whisperForm=panel.querySelector('#groupGameWhisperForm'),
      whisperConversation=panel.querySelector('#groupGameWhisperConversation');
    allowed.addEventListener('change',function(){
      activityRow.hidden=!allowed.checked;
      if(!allowed.checked)activity.checked=false;
    });
    function nameFor(id){
      if(String(id)==='__user')return '我';
      var g=currentGroup();
      var member=g&&Array.isArray(g.members)&&g.members.find(function(m){return m&&String(m.id)===String(id);});
      return member?String(member.nickname||member.name||'角色'):'成员';
    }
    function renderPrivateConversation(){
      whisperConversation.textContent='';
      if(!group || !isOwner || whisperPanel.hidden || !whisperTo.value)return;
      var result=api.getHostConversation({
        group:group,groupId:gid,actorId:'__user',peerId:whisperTo.value
      });
      var msgs=result&&result.ok?result.messages:[];
      if(!msgs.length) {
        var empty=document.createElement('li');
        empty.textContent=result&&result.ok?'还没有私聊消息。':'私聊记录读取失败，未显示任何内容。';
        whisperConversation.appendChild(empty);
        return;
      }
      msgs.forEach(function(msg){
        var li=document.createElement('li');
        li.dataset.direction=msg.direction;
        li.textContent=(msg.direction==='sent'?'我':nameFor(msg.senderId))+'：'+msg.text;
        whisperConversation.appendChild(li);
      });
    }
    whisperTo.addEventListener('change',renderPrivateConversation);
    function stateLine(text){
      current.textContent='';
      var p=document.createElement('p');p.className='group-game-state';p.textContent=text;current.appendChild(p);
    }
    function renderTally(game){
      if(!Array.isArray(game.voteTally)||!game.voteTally.length)return;
      var list=document.createElement('ul');
      list.className='group-game-activity';
      game.voteTally.filter(function(row){return row&&Number(row.count)>0;})
        .sort(function(a,b){return Number(b.count)-Number(a.count);})
        .forEach(function(row){
          var li=document.createElement('li');
          li.textContent=nameFor(row.targetId)+' · '+Number(row.count)+'票';
          list.appendChild(li);
        });
      if(list.children.length)current.appendChild(list);
    }
    function render(){
      cleanupButton.hidden=true;
      group=currentGroup();isOwner=group&&String(group.ownerId||'__user')==='__user';
      if(!group){stateLine('群资料已变化，请返回群聊重新打开。');form.hidden=true;finish.hidden=true;cancelButton.hidden=true;whisperPanel.hidden=true;return;}
      var game=api.getPublic(String(group.id));
      select.textContent='';
      (group.members||[]).forEach(function(m){
        if(!m||!m.id)return;
        var o=document.createElement('option');o.value=String(m.id);
        o.textContent=String(m.nickname||m.name||'群成员');select.appendChild(o);
      });
      if(!isOwner){
        form.hidden=true;finish.hidden=true;cancelButton.hidden=true;whisperPanel.hidden=true;
        stateLine(game&&game.status==='active'
          ? '本局猜身份进行中 · 已投 '+game.voteCount+'/'+game.players.length+' 票。'
          : '目前没有进行中的秘密身份游戏。');
        return;
      }
      if(!game||game.status==='finished'||game.status==='cancelled'){
        form.hidden=false;finish.hidden=true;cancelButton.hidden=true;whisperPanel.hidden=true;
        if(game&&game.status==='cancelled')stateLine('上一局已取消，未公布身份。可以重新开始。');
        if(game&&game.status==='finished'){
          stateLine('上一局已揭晓 · 坏人是「'+nameFor(game.revealedRoleId)+
            '」 · '+game.voteCount+'/'+game.players.length+' 人投票，'+game.correctVotes+' 人猜对。');
          renderTally(game);
        }
        else if(!game)stateLine('设置这一局的规则，再由你亲自发放秘密身份牌。');
      }else{
        form.hidden=true;finish.hidden=false;cancelButton.hidden=false;
        finish.disabled=game.voteError===true;
        whisperPanel.hidden=game.rules.allowPrivate!==true;
        if(!whisperPanel.hidden) {
          var prior=whisperTo.value;
          whisperTo.textContent='';
          (group.members||[]).forEach(function(m){
            if(!m||game.players.indexOf(String(m.id))===-1)return;
            var opt=document.createElement('option');
            opt.value=String(m.id);opt.textContent=nameFor(m.id);
            whisperTo.appendChild(opt);
          });
          if(prior && game.players.indexOf(prior)!==-1)whisperTo.value=prior;
          renderPrivateConversation();
        }
        stateLine((game.voteError ? '投票记录异常，请检查本机存储。' :
          '本局进行中 · 已投 '+game.voteCount+'/'+game.players.length+' 票')+
          ' · 游戏私聊'+(game.rules.allowPrivate?'开启':'关闭')+
          ' · 猜测对象揭晓前保密。');
        if(game.rules.showPrivateActivity&&Array.isArray(game.activity)&&game.activity.length){
          var ul=document.createElement('ul');ul.className='group-game-activity';
          game.activity.slice(-4).forEach(function(e){
            var li=document.createElement('li');
            li.textContent=nameFor(e.fromId)+'与'+nameFor(e.toId)+'进行了私聊（仅显示动向）';
            ul.appendChild(li);
          });
          current.appendChild(ul);
        }
      }
      if(game && (game.status==='finished'||game.status==='cancelled')) {
        var temporary=api.getCleanupStatus({group:group,groupId:gid,actorId:'__user'});
        if(temporary && temporary.ok && temporary.cleanupPending>0) {
          cleanupButton.hidden=false;
          var noticeLine=document.createElement('p');
          noticeLine.className='group-game-notice';
          noticeLine.textContent='上一局有 '+temporary.cleanupPending+' 项临时记录尚未清理，不会进入角色回复。';
          current.appendChild(noticeLine);
        }
      }
    }
    form.addEventListener('submit',function(e){
      e.preventDefault();group=currentGroup();
      if(!group||!isOwner){notice.textContent='只有群主可以决定本局规则。';return;}
      var res=api.start({group:group,actorId:'__user',gameId:'mystery',
        badRoleId:select.value,allowPrivate:allowed.checked,showPrivateActivity:activity.checked});
      notice.textContent=res.ok?'秘密身份牌已分别保存。返回群聊即可开始推理。':(res.message||'开始失败');
      if(res.ok)render();
    });
    whisperForm.addEventListener('submit',function(e){
      e.preventDefault();
      group=currentGroup();
      var game=api.getPublic(gid);
      if(!group || String(group.ownerId||'__user')!=='__user' ||
        !game || game.status!=='active' || !game.rules.allowPrivate) {
        notice.textContent='当前不能发送游戏私聊。';return;
      }
      var message=whisperText.value.trim();
      if(!message||!whisperTo.value){notice.textContent='请选择角色并输入消息。';return;}
      var sent=api.sendWhisper({
        groupId:gid,sessionId:game.sessionId,fromId:'__user',toId:whisperTo.value,
        text:message,eventId:'host_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9)
      });
      if(!sent.ok){notice.textContent=sent.message||'私聊没有保存成功';return;}
      whisperText.value='';
      notice.textContent='已发给 '+nameFor(whisperTo.value)+'，仅该角色能收到。'+
        (sent.activitySynced===false?' 私聊动向暂未同步。':'');
      renderPrivateConversation();
    });
    cancelButton.addEventListener('click',function(){
      group=currentGroup();
      if(!group||String(group.ownerId||'__user')!=='__user')return;
      if(!root.confirm('取消本局？未揭晓的身份牌、猜测票和游戏私聊将清除；原群聊消息不变。'))return;
      var ended=api.cancel({group:group,groupId:gid,actorId:'__user'});
      if(!ended.ok){notice.textContent=ended.message||'取消失败';return;}
      notice.textContent='已取消本局，未揭晓身份；可以开启新一局。'+
        (ended.cleanupComplete===false?' 临时记录未完全清除，请重试清理。':'');
      render();
    });
    cleanupButton.addEventListener('click',function(){
      group=currentGroup();
      var cleaned=api.retryCleanup({group:group,groupId:gid,actorId:'__user'});
      notice.textContent=!cleaned.ok ? (cleaned.message||'无法清理') :
        cleaned.cleanupComplete ? '本局临时记录已清理。' :
        '仍有临时记录没有清理成功，请检查本机存储。';
      render();
    });
    finish.addEventListener('click',function(){
      group=currentGroup();
      if(!group||!isOwner)return;
      if(!root.confirm('结束当前游戏并公布坏人身份？'))return;
      var result=api.finish({group:group,groupId:gid,actorId:'__user'});
      if(!result.ok){notice.textContent=result.message||'结束失败';return;}
      if(root.GroupMemoryEvents){
        var remembered=root.GroupMemoryEvents.recordGameClosure({group:group,session:result.session});
        notice.textContent=remembered.ok?'身份已揭晓，结果已写入本群共同记忆。':
          '身份已揭晓，但长期记忆未保存成功：'+(remembered.message||'请检查本机存储');
      }else notice.textContent='身份已揭晓；记忆服务未加载。';
      if(result.cleanupComplete===false)
        notice.textContent += ' 本局临时记录尚未完全清理，请重试。';
      render();
    });
    render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})(window);
