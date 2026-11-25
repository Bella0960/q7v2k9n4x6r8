/* GROUP-MUSIC-001 M05: local in-memory group listening session.
 * No storage writes, API calls, audio transport or simulated delivery claims.
 * A dedicated instance of the existing native playback controller is required.
 */
(function(root){
  'use strict';
  const owners=new WeakSet();
  const validId=id=>typeof id==='string'&&id.length>0&&id.length<=256&&id===id.trim()&&!/[\u0000-\u001f\u007f]/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
  function create(options){
    const {player,catalog,getGroupId,hasRole}=options||{};
    const guard=root.MAOGroupWriteGuard,gov=root.GroupGovernance;
    if(!guard||!gov||!player||!catalog||
      ['getState','play','pause','resume','seek','release','subscribe'].some(k=>typeof player[k]!=='function')||
      typeof catalog.getTrack!=='function'||typeof getGroupId!=='function'||typeof hasRole!=='function')throw Error('invalid group listening dependencies');
    if(owners.has(player))throw Error('player already assigned to a listening session');
    owners.add(player);
    const listeners=new Set();
    let session=null,scope=null,disposed=false,busy=false,notifying=false,timer=null;
    const fail=code=>Object.freeze({ok:false,code});
    function fresh(){
      try{
        const id=getGroupId(),account=guard.account();
        if(!validId(id)||!/^g.+/.test(id)||typeof account!=='string')return null;
        const snapshot=guard.read(id);
        if(!snapshot||snapshot.account!==account||snapshot.id!==id||!gov.userIsInGroup(snapshot.group)||!Array.isArray(snapshot.group.members))return null;
        const rows=snapshot.group.members;
        const ids=rows.map(m=>m&&m.id!=null?String(m.id):'');
        if(ids.some(x=>!validId(x)||x==='__user'||x===id)||new Set(ids).size!==ids.length)return null;
        return {id,account,identity:root.__MAO_ACCOUNT_SCOPE__,storage:root.localStorage,
          members:ids.slice().sort(),rows};
      }catch{return null;}
    }
    function sameScope(f){
      return !!(f&&scope&&f.id===scope.id&&f.account===scope.account&&f.identity===scope.identity&&f.storage===scope.storage&&
        f.members.length===scope.members.length&&f.members.every((id,i)=>id===scope.members[i]));
    }
    function eligible(f,id){
      try{return id==='__user'||(validId(id)&&f.rows.some(m=>String(m.id)===id&&!gov.isMuted(m))&&hasRole(id)===true);}
      catch{return false;}
    }
    function project(){
      if(!session)return null;
      return Object.freeze({version:1,accountId:scope.account,groupId:scope.id,sessionId:session.id,revision:session.revision,
        status:session.status,trackId:session.trackId,queue:Object.freeze(session.queue.slice()),
        participants:Object.freeze(session.participants.slice()),currentTime:session.time,duration:session.duration,
        playing:session.status==='playing',error:session.error,roleAudioDelivered:false,remoteSynchronized:false});
    }
    function publish(type,value){
      const event=Object.freeze({type,snapshot:value});
      notifying=true;
      try{for(const fn of [...listeners]){try{fn(event);}catch{}}}finally{notifying=false;}
    }
    function ok(type){
      const value=project();
      publish(type,value);
      return Object.freeze({ok:true,snapshot:value});
    }
    function stopTimer(){if(timer!==null){root.clearInterval(timer);timer=null;}}
    function invalidate(code){
      if(!session)return;
      // Clear before releasing: synchronous media callbacks cannot expose old data.
      session=null;scope=null;busy=false;stopTimer();
      try{player.release();}catch{}
      publish('invalidated',null);
      return fail(code);
    }
    function ensure(){
      if(disposed||!session)return false;
      const f=fresh();
      if(!sameScope(f)||session.participants.some(id=>!eligible(f,id))||
        (typeof player.isScopeCurrent==='function'&&!player.isScopeCurrent())){
        invalidate('SCOPE_CHANGED');return false;
      }
      return true;
    }
    function authorize(token,allowBusy=false){
      if(notifying)return fail('REENTRANT');
      if(!ensure())return fail('SESSION_UNAVAILABLE');
      if(!token||token.groupId!==scope.id||token.accountId!==scope.account||
        token.sessionId!==session.id||token.revision!==session.revision)return fail('STALE_COMMAND');
      if(session.status==='ended')return fail('SESSION_ENDED');
      if(busy&&!allowBusy)return fail('PLAY_PENDING');
      return null;
    }
    function getTrack(id){
      try{if(!validId(id))return null;const r=catalog.getTrack(id);return r?.ok===true&&r.track?.id===id?r.track:null;}catch{return null;}
    }
    function native(){
      try{return player.getState();}catch{return null;}
    }
    function updateNative(n){
      const same=n&&n.trackId===session.trackId;
      session.time=same&&Number.isFinite(n.currentTime)?Math.max(0,n.currentTime):0;
      session.duration=same&&Number.isFinite(n.duration)?Math.max(0,n.duration):0;
    }
    function reconcile(){
      if(!ensure())return null;
      if(busy||session.status==='ended')return project();
      const n=native();
      if(!ensure())return null;
      if(n&&n.playing&&n.trackId!==session.trackId){invalidate('UNEXPECTED_AUDIO');return null;}
      if(session.status==='playing'&&(!n||!n.playing||n.trackId!==session.trackId)){
        session.status=n?.trackId===session.trackId?'paused':'error';
        session.error=session.status==='error'?'SOURCE_LOST':null;
        updateNative(n);session.revision++;return ok('reconciled').snapshot;
      }
      if(session.status==='paused'&&(!n||n.trackId!==session.trackId)){
        session.status='error';session.error='SOURCE_LOST';updateNative(n);session.revision++;
        return ok('reconciled').snapshot;
      }
      if(session.status==='playing'||session.status==='paused')updateNative(n);
      return project();
    }
    function start(){
      if(disposed||notifying)return fail('SESSION_UNAVAILABLE');
      if(session&&ensure()&&session.status!=='ended')return fail('SESSION_EXISTS');
      const f=fresh(),n=native();
      if(!f)return fail('GROUP_UNAVAILABLE');
      if(typeof player.isScopeCurrent==='function'&&!player.isScopeCurrent())return fail('SCOPE_CHANGED');
      if(!n||n.playing||n.pending||n.trackId!==null)return fail('PLAYER_NOT_IDLE');
      let id;try{id=root.crypto.randomUUID();}catch{return fail('ID_UNAVAILABLE');}
      if(!validId(id))return fail('ID_UNAVAILABLE');
      scope=f;session={id,revision:1,status:'selecting',trackId:null,queue:[],participants:['__user'],time:0,duration:0,error:null};
      if(!ensure())return fail('SCOPE_CHANGED');
      try{stopTimer();timer=root.setInterval(()=>reconcile(),500);}catch{return invalidate('MONITOR_UNAVAILABLE');}
      return ok('created');
    }
    function selectTrack(token,id){
      const denied=authorize(token,true);if(denied)return denied;
      if(!getTrack(id))return fail('TRACK_UNAVAILABLE');
      if(!ensure())return fail('SCOPE_CHANGED');
      return applySelection(id,session.queue.includes(id)?session.queue.slice():[id]);
    }
    // Validate the whole picker transaction before releasing the current source.
    // Expose one revision and one notification, never an intermediate queue.
    function applySelection(id,queue){
      busy=true;session.revision++;
      try{player.release();}catch{return invalidate('PLAYER_RELEASE_FAILED');}
      if(!ensure())return fail('SCOPE_CHANGED');
      const n=native();if(!n||n.playing||n.pending||n.trackId!==null)return invalidate('PLAYER_RELEASE_FAILED');
      if(!ensure())return fail('SCOPE_CHANGED');
      session.trackId=id;session.status='ready';session.error=null;session.time=0;session.duration=0;
      session.queue=queue;
      busy=false;return ok('selected');
    }
    function validQueueTracks(ids){
      if(ids.some(id=>!validId(id)))return false;
      try{
        if(typeof catalog.listTracks!=='function')return ids.every(id=>!!getTrack(id));
        const snapshot=catalog.listTracks();
        if(!snapshot?.ok||!Array.isArray(snapshot.tracks))return false;
        const available=new Set(snapshot.tracks.map(t=>t.id));
        return ids.every(id=>available.has(id));
      }catch{return false;}
    }
    function selectQueue(token,ids){
      const denied=authorize(token,true);if(denied)return denied;
      if(!Array.isArray(ids)||!ids.length||ids.length>100)return fail('INVALID_QUEUE');
      const queue=Array.from(ids);
      if(new Set(queue).size!==queue.length||!validQueueTracks(queue))return fail('INVALID_QUEUE');
      if(!ensure())return fail('SCOPE_CHANGED');
      return applySelection(queue[0],queue);
    }
    function setQueue(token,ids){
      const denied=authorize(token);if(denied)return denied;
      if(!Array.isArray(ids)||ids.length>100)return fail('INVALID_QUEUE');
      // Densify before validation: Array#some/every skip sparse slots.
      const queue=Array.from(ids);
      if(new Set(queue).size!==queue.length||!validQueueTracks(queue)||
        (session.trackId!==null&&!queue.includes(session.trackId)))return fail('INVALID_QUEUE');
      if(!ensure())return fail('SCOPE_CHANGED');
      session.queue=queue;session.revision++;return ok('queue');
    }
    function join(token,id){
      const denied=authorize(token);if(denied)return denied;
      const f=fresh();if(!sameScope(f)||!eligible(f,id)||id==='__user')return fail('MEMBER_UNAVAILABLE');
      if(session.participants.includes(id))return Object.freeze({ok:true,snapshot:project()});
      session.participants.push(id);session.revision++;return ok('joined');
    }
    function leave(token,id){
      const denied=authorize(token);if(denied)return denied;
      if(id==='__user')return end(token);
      if(!session.participants.includes(id))return fail('MEMBER_NOT_JOINED');
      session.participants=session.participants.filter(x=>x!==id);session.revision++;return ok('left');
    }
    async function play(token){
      const denied=authorize(token);if(denied)return denied;
      if(!['ready','paused','error'].includes(session.status)||!session.trackId||!getTrack(session.trackId))return fail('TRACK_UNAVAILABLE');
      if(!ensure())return fail('SCOPE_CHANGED');
      const target=session,track=target.trackId,ticket=++target.revision;
      const n=native();if(!ensure())return fail('SCOPE_CHANGED');
      busy=true;target.status='loading';target.error=null;
      publish('loading',project());
      if(!ensure()||session!==target||target.revision!==ticket)return fail('STALE_COMMAND');
      let result;
      try{result=await (n?.trackId===track&&!n.playing&&!n.pending?player.resume():player.play(track));}catch{result=null;}
      if(!ensure()||session!==target||target.revision!==ticket)return fail('STALE_COMMAND');
      const actual=native();if(!ensure()||session!==target||target.revision!==ticket)return fail('STALE_COMMAND');
      busy=false;target.revision++;
      if(!result?.ok||!actual?.playing||actual.trackId!==track||actual.pending){
        // Never label another source or a rejected request as playing.
        if(actual?.playing||actual?.pending){busy=true;try{player.release();}catch{return invalidate('PLAYER_RELEASE_FAILED');}busy=false;}
        if(!ensure())return fail('SCOPE_CHANGED');
        target.status='error';target.error=typeof result?.code==='string'?result.code:'PLAY_NOT_CONFIRMED';
        updateNative(native());
        const value=project();publish('error',value);return Object.freeze({ok:false,code:target.error,snapshot:value});
      }
      target.status='playing';target.error=null;updateNative(actual);return ok('playing');
    }
    function pause(token){
      const denied=authorize(token,true);if(denied)return denied;
      if(!['playing','loading','paused'].includes(session.status))return fail('INVALID_STATE');
      busy=true;session.revision++;
      let r;try{r=player.pause();}catch{return invalidate('PLAYER_PAUSE_FAILED');}
      if(!ensure())return fail('SCOPE_CHANGED');
      const n=native();if(!n||n.playing||n.pending||!r?.ok)return invalidate('PLAYER_PAUSE_FAILED');
      if(!ensure())return fail('SCOPE_CHANGED');
      // Cancelling the initial load is not pausing a confirmed source.
      busy=false;session.status=n.trackId===session.trackId?'paused':'ready';session.error=null;
      updateNative(n);return ok(session.status==='paused'?'paused':'load-cancelled');
    }
    function seek(token,seconds){
      const denied=authorize(token);if(denied)return denied;
      if(!['playing','paused'].includes(session.status)||!Number.isFinite(seconds))return fail('INVALID_SEEK');
      const n=native();if(!ensure())return fail('SCOPE_CHANGED');
      if(!n||n.trackId!==session.trackId||n.pending)return fail('SEEK_UNAVAILABLE');
      let r;busy=true;try{r=player.seek(seconds);}catch{r=null;}busy=false;
      if(!ensure())return fail('SCOPE_CHANGED');
      if(!r?.ok)return fail(r?.code||'SEEK_FAILED');
      session.revision++;updateNative(native());if(!ensure())return fail('SCOPE_CHANGED');return ok('seek');
    }
    function end(token){
      const denied=authorize(token,true);if(denied)return denied;
      busy=true;session.revision++;
      try{player.release();}catch{return invalidate('PLAYER_RELEASE_FAILED');}
      if(!ensure())return fail('SCOPE_CHANGED');
      const n=native();if(!n||n.playing||n.pending||n.trackId!==null)return invalidate('PLAYER_RELEASE_FAILED');
      if(!ensure())return fail('SCOPE_CHANGED');
      busy=false;session.status='ended';session.time=0;session.duration=0;session.error=null;stopTimer();return ok('ended');
    }
    function onPlayer(event){
      if(!session)return;
      if(event?.type==='scope-lost'){invalidate('SCOPE_CHANGED');return;}
      if(busy||!ensure()||!session||session.status==='ended')return;
      if(event?.playing&&event.trackId!==session.trackId){invalidate('UNEXPECTED_AUDIO');return;}
      if(['pause','ended','release','error'].includes(event?.type))reconcile();
    }
    const unsubscribe=player.subscribe(onPlayer);
    function onStorage(){reconcile();}
    function onExit(){invalidate('PAGE_EXIT');}
    root.addEventListener('storage',onStorage);
    root.addEventListener('pagehide',onExit);
    function destroy(){
      if(disposed)return;
      disposed=true;invalidate('DISPOSED');stopTimer();
      root.removeEventListener('storage',onStorage);root.removeEventListener('pagehide',onExit);
      if(typeof unsubscribe==='function')unsubscribe();listeners.clear();owners.delete(player);
    }
    return Object.freeze({version:1,start,selectTrack,selectQueue,setQueue,join,leave,play,pause,seek,end,reconcile,getSnapshot:reconcile,destroy,
      subscribe(fn){if(disposed||typeof fn!=='function')return ()=>{};listeners.add(fn);return ()=>listeners.delete(fn);}});
  }
  // Product composition: both source lookup and native start are guarded by
  // the same immutable account/group/membership binding. Recreate after scope loss.
  function createForGroup(options){
    const {audio,getGroupId,hasRole}=options||{};
    const guard=root.MAOGroupWriteGuard,gov=root.GroupGovernance,catalog=root.MAOMusicCatalogAdapter,controller=root.MAOMusicPlaybackController;
    if(!guard||!gov||!catalog||!controller||typeof getGroupId!=='function'||typeof hasRole!=='function')
      throw Error('missing group listening dependencies');
    function read(){
      try{
        const groupId=getGroupId(),account=guard.account(),f=guard.read(groupId);
        if(typeof account!=='string'||!validId(groupId)||!/^g.+/.test(groupId)||!f||f.account!==account||
          !gov.userIsInGroup(f.group)||!Array.isArray(f.group.members))return null;
        const ids=f.group.members.map(m=>m&&m.id!=null?String(m.id):'');
        if(ids.some(id=>!validId(id)||id==='__user'||id===groupId)||new Set(ids).size!==ids.length)return null;
        const members=f.group.members.map(m=>[String(m.id),gov.isMuted(m),hasRole(String(m.id))===true]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
        return {key:JSON.stringify([account,groupId,members]),scope:root.__MAO_ACCOUNT_SCOPE__,storage:root.localStorage,idb:root.indexedDB};
      }catch{return null;}
    }
    const initial=read();
    if(!initial)throw Error('group listening scope unavailable');
    function current(){
      const f=read();
      return f&&f.key===initial.key&&f.scope===initial.scope&&f.storage===initial.storage&&f.idb===initial.idb?initial.key:null;
    }
    const player=controller.create({audio,getScope:current,
      getTrack(id){const r=catalog.getTrack(id);return current()&&r?.ok?r.track:null;},
      async resolveSource(t){if(!current())return null;const r=await catalog.resolveSource(t.id);return current()&&r?.ok&&r.track?.id===t.id?r.source:null;}
    });
    let api;
    try{api=create({player,catalog,getGroupId,hasRole});}catch(e){player.dispose();throw e;}
    return Object.freeze({...api,destroy(){api.destroy();player.dispose();}});
  }
  root.MAOGroupListeningSession=Object.freeze({version:1,create,createForGroup});
})(window);
