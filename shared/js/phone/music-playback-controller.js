/* GROUP-MUSIC-001 M04b: one native audio element, injected catalog, no storage writes. */
(function(root){
  'use strict';
  const owners=new WeakMap();
  function create(options){
    const {audio,getTrack,resolveSource,getScope}=options||{};
    if(!audio||typeof audio.play!=='function'||typeof audio.pause!=='function'||typeof audio.load!=='function'||
      typeof getTrack!=='function'||typeof resolveSource!=='function'||typeof getScope!=='function')throw Error('invalid playback dependencies');
    if(owners.has(audio))throw Error('audio element already controlled');
    const readScope=()=>{try{const x=getScope();return typeof x==='string'?x:null;}catch{return null;}};
    const scope=readScope(), listeners=new Set();
    let revision=0,pending=false,trackId=null,sourceUrl=null,blobUrl=null,disposed=false,lost=false;
    function clearSource(){
      trackId=null;sourceUrl=null;
      audio.pause();audio.removeAttribute('src');audio.load();
      if(blobUrl){try{root.URL.revokeObjectURL(blobUrl);}catch{}blobUrl=null;}
    }
    function snapshot(){
      const confirmed=trackId!==null&&sourceUrl!==null&&audio.src===sourceUrl;
      return Object.freeze({revision,trackId:confirmed?trackId:null,pending,playing:confirmed&&!audio.paused&&!audio.ended,
        currentTime:confirmed&&Number.isFinite(audio.currentTime)?audio.currentTime:0,
        duration:confirmed&&Number.isFinite(audio.duration)?audio.duration:0});
    }
    function publish(type,code){
      const event=Object.freeze({type,code:code||null,...snapshot()});
      for(const listener of [...listeners]){try{listener(event);}catch{}}
    }
    function scopeCurrent(){
      if(disposed||lost)return false;
      if(scope!==null&&readScope()===scope)return true;
      lost=true;++revision;pending=false;clearSource();publish('scope-lost','SCOPE_CHANGED');return false;
    }
    function active(ticket){return scopeCurrent()&&ticket===revision;}
    function result(ok,code){return Object.freeze({ok,code:code||null,revision,state:snapshot()});}
    function fail(ticket,code){
      if(!active(ticket))return result(false,'STALE');
      pending=false;
      if(!snapshot().trackId)clearSource();
      const completed=result(false,code);publish('error',code);return completed;
    }
    async function play(id){
      if(!scopeCurrent())return result(false,'SCOPE_CHANGED');
      let track;try{track=getTrack(id);}catch{return result(false,'TRACK_NOT_FOUND');}
      if(!track||track.id!==id||typeof id!=='string'||!id)return result(false,'TRACK_NOT_FOUND');
      if(!scopeCurrent())return result(false,'SCOPE_CHANGED');
      const ticket=++revision;
      if(pending&&trackId===null)clearSource();
      pending=true;
      let source;
      try{source=await resolveSource(track);}catch{return fail(ticket,'SOURCE_FAILED');}
      if(!active(ticket))return result(false,'STALE');
      if(!source)return fail(ticket,'SOURCE_MISSING');
      let nextUrl;
      try{
        if(source.kind==='blob'&&source.blob)nextUrl=root.URL.createObjectURL(source.blob);
        else if(source.kind==='url'&&typeof source.url==='string'&&/^https:\/\//i.test(source.url))nextUrl=source.url;
        else return fail(ticket,'SOURCE_INVALID');
        clearSource();
        if(source.kind==='blob')blobUrl=nextUrl;
        audio.src=nextUrl;
      }catch{return fail(ticket,'SOURCE_FAILED');}
      publish('switching');
      if(!active(ticket))return result(false,'STALE');
      try{await audio.play();}catch{return fail(ticket,'PLAY_REJECTED');}
      if(!active(ticket))return result(false,'STALE');
      if(audio.paused||audio.ended||audio.src!==nextUrl)return fail(ticket,'PLAY_REJECTED');
      trackId=id;sourceUrl=nextUrl;pending=false;
      const completed=result(true);
      publish('play');
      return completed;
    }
    function pause(){
      if(!scopeCurrent())return result(false,'SCOPE_CHANGED');
      ++revision;pending=false;
      if(!snapshot().trackId)clearSource();else audio.pause();
      const completed=result(true);publish('pause');return completed;
    }
    async function resume(){
      if(!scopeCurrent())return result(false,'SCOPE_CHANGED');
      if(!snapshot().trackId||pending)return result(false,'SOURCE_MISSING');
      const ticket=++revision;pending=true;
      try{await audio.play();}catch{return fail(ticket,'PLAY_REJECTED');}
      if(!active(ticket))return result(false,'STALE');
      if(audio.paused||audio.ended||!snapshot().trackId)return fail(ticket,'PLAY_REJECTED');
      pending=false;const completed=result(true);publish('resume');return completed;
    }
    function seek(seconds){
      if(!scopeCurrent())return result(false,'SCOPE_CHANGED');
      if(pending||!snapshot().trackId||!Number.isFinite(seconds)||!Number.isFinite(audio.duration)||audio.duration<=0)return result(false,'SEEK_UNAVAILABLE');
      try{audio.currentTime=Math.min(audio.duration,Math.max(0,seconds));}catch{return result(false,'SEEK_FAILED');}
      const completed=result(true);publish('seek');return completed;
    }
    function release(){
      if(disposed)return result(false,'DISPOSED');
      ++revision;pending=false;clearSource();const completed=result(true);publish('release');return completed;
    }
    function onAudioTick(){scopeCurrent();}
    function onAudioError(){if(!scopeCurrent()||pending||!snapshot().trackId)return;const ticket=++revision;clearSource();fail(ticket,'MEDIA_ERROR');}
    function dispose(){
      if(disposed)return;
      disposed=true;++revision;pending=false;clearSource();listeners.clear();
      audio.removeEventListener('timeupdate',onAudioTick);audio.removeEventListener('playing',onAudioTick);
      audio.removeEventListener('error',onAudioError);owners.delete(audio);
    }
    const api=Object.freeze({version:1,play,pause,resume,seek,release,dispose,
      getState(){scopeCurrent();return snapshot();},isScopeCurrent:scopeCurrent,isCurrent:active,
      subscribe(listener){if(typeof listener!=='function'||disposed)return ()=>{};listeners.add(listener);return ()=>listeners.delete(listener);}});
    owners.set(audio,api);
    audio.addEventListener('timeupdate',onAudioTick);audio.addEventListener('playing',onAudioTick);audio.addEventListener('error',onAudioError);
    return api;
  }
  root.MAOMusicPlaybackController=Object.freeze({version:1,create});
})(window);
