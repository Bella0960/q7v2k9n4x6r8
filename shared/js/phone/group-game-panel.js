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
      '<button type="button" id="groupGameFinish" class="group-game-button secondary" hidden>结束游戏 · 揭晓身份</button>'+
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
      '.group-game-activity{margin:10px 0 0;padding:0;list-style:none;font:10px/2 sans-serif;color:#999}';
    document.head.appendChild(style);
    pane.appendChild(panel);
    var group=currentGroup(),isOwner=group&&String(group.ownerId||'__user')==='__user';
    var form=panel.querySelector('#groupGameStartForm'), select=panel.querySelector('#groupGameBadRole'),
      allowed=panel.querySelector('#groupGamePrivate'), activity=panel.querySelector('#groupGameActivity'),
      activityRow=panel.querySelector('#groupGameActivityRow'),
      current=panel.querySelector('#groupGameCurrent'), finish=panel.querySelector('#groupGameFinish'),
      notice=panel.querySelector('#groupGameNotice');
    allowed.addEventListener('change',function(){
      activityRow.hidden=!allowed.checked;
      if(!allowed.checked)activity.checked=false;
    });
    function nameFor(id){
      var g=currentGroup();
      var member=g&&Array.isArray(g.members)&&g.members.find(function(m){return m&&String(m.id)===String(id);});
      return member?String(member.nickname||member.name||'角色'):'成员';
    }
    function stateLine(text){
      current.textContent='';
      var p=document.createElement('p');p.className='group-game-state';p.textContent=text;current.appendChild(p);
    }
    function render(){
      group=currentGroup();isOwner=group&&String(group.ownerId||'__user')==='__user';
      if(!group){stateLine('群资料已变化，请返回群聊重新打开。');form.hidden=true;finish.hidden=true;return;}
      var game=api.getPublic(String(group.id));
      select.textContent='';
      (group.members||[]).forEach(function(m){
        if(!m||!m.id)return;
        var o=document.createElement('option');o.value=String(m.id);
        o.textContent=String(m.nickname||m.name||'群成员');select.appendChild(o);
      });
      if(!isOwner){
        form.hidden=true;finish.hidden=true;
        stateLine(game&&game.status==='active'?'一局猜身份正在进行中。只有群主能调整玩法规则。':'目前没有进行中的秘密身份游戏。');
        return;
      }
      if(!game||game.status==='finished'){
        form.hidden=false;finish.hidden=true;
        if(game&&game.status==='finished')stateLine('上一局已结束，坏人是「'+nameFor(game.revealedRoleId)+'」。可开始新的一局。');
        else stateLine('设置这一局的规则，再由你亲自发放秘密身份牌。');
      }else{
        form.hidden=true;finish.hidden=false;
        stateLine('本局进行中 · 玩家私聊'+(game.rules.allowPrivate?'开启':'关闭')+
          ' · 身份在揭晓前不会显示给其他角色。');
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
    }
    form.addEventListener('submit',function(e){
      e.preventDefault();group=currentGroup();
      if(!group||!isOwner){notice.textContent='只有群主可以决定本局规则。';return;}
      var res=api.start({group:group,actorId:'__user',gameId:'mystery',
        badRoleId:select.value,allowPrivate:allowed.checked,showPrivateActivity:activity.checked});
      notice.textContent=res.ok?'秘密身份牌已分别保存。返回群聊即可开始推理。':(res.message||'开始失败');
      if(res.ok)render();
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
      render();
    });
    render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})(window);
