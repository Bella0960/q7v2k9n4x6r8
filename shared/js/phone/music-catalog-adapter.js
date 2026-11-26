/* GROUP-MUSIC-001 M03: read-only existing local music catalog. */
(function installMusicCatalogAdapter(root) {
  'use strict';
  const CATALOG='music_local_tracks', COVERS='music_cover_assets_v1', DB='maomao-media-store', STORE='audio';
  const fail=code=>({ok:false,code});
  function account(){try{const guard=root.MAOGroupWriteGuard,id=guard&&guard.account();return typeof id==='string'?id:null;}catch{return null;}}
  function capture(){try{const id=account();return id===null?null:{account:id,scope:root.__MAO_ACCOUNT_SCOPE__,storage:root.localStorage,idb:root.indexedDB};}catch{return null;}}
  function current(s){try{return !!s&&account()===s.account&&root.__MAO_ACCOUNT_SCOPE__===s.scope&&root.localStorage===s.storage&&root.indexedDB===s.idb;}catch{return false;}}
  function validId(id){return typeof id==='string'&&id.length>0&&id.length<=256&&id===id.trim()&&!/[\u0000-\u001f\u007f]/.test(id)&&!['__proto__','constructor','prototype','__user'].includes(id);}
  function read(s){
    if(!current(s))return fail('SCOPE_CHANGED');
    try{
      const raw=s.storage.getItem(CATALOG),rows=JSON.parse(raw===null?'[]':raw);
      if(!Array.isArray(rows))return fail('INVALID_CATALOG');
      const coverRaw=s.storage.getItem(COVERS),warnings=[];let covers={};
      if(coverRaw!==null){try{covers=JSON.parse(coverRaw);if(!covers||typeof covers!=='object'||Array.isArray(covers))throw Error('cover');}catch{covers={};warnings.push('INVALID_COVERS');}}
      const seen=new Set(),duplicates=new Set();
      for(const row of rows){if(row&&validId(row.id)){if(seen.has(row.id))duplicates.add(row.id);seen.add(row.id);}}
      if(duplicates.size)warnings.push('DUPLICATE_TRACK_ID');
      const tracks=[];let invalid=0;
      for(const row of rows){
        if(!row||!validId(row.id)||typeof row.name!=='string'||!row.name.trim()||(row.source!=null&&row.source!=='local')){invalid++;continue;}
        if(duplicates.has(row.id))continue;
        const cover=Object.prototype.hasOwnProperty.call(covers,row.id)?covers[row.id]:null;
        tracks.push({id:row.id,name:row.name,artist:typeof row.artist==='string'&&row.artist.trim()&&row.artist!=='本地导入'?row.artist:'未知歌手',durationSeconds:typeof row.durSec==='number'&&Number.isFinite(row.durSec)&&row.durSec>0?row.durSec:null,source:'local',coverAssetId:typeof cover==='string'&&/^as_[A-Z2-7]{32}$/.test(cover)?cover:null});
      }
      if(invalid)warnings.push('INVALID_TRACK');
      if(!current(s)||s.storage.getItem(CATALOG)!==raw||s.storage.getItem(COVERS)!==coverRaw||!current(s))return fail('STALE_CATALOG');
      return {ok:true,tracks,warnings,raw,duplicates};
    }catch{return fail('CATALOG_READ_FAILED');}
  }
  function listTracks(){const s=capture();if(!s)return fail('SCOPE_UNAVAILABLE');const r=read(s);return r.ok?{ok:true,tracks:r.tracks,warnings:r.warnings}:r;}
  function lookup(s,id){if(!validId(id))return fail('INVALID_TRACK_ID');const r=read(s);if(!r.ok)return r;if(r.duplicates.has(id))return fail('DUPLICATE_TRACK_ID');const track=r.tracks.find(t=>t.id===id);return track?{ok:true,track,raw:r.raw}:fail('TRACK_NOT_FOUND');}
  function getTrack(id){const s=capture();if(!s)return fail('SCOPE_UNAVAILABLE');const r=lookup(s,id);return r.ok?{ok:true,track:r.track}:r;}
  function readRecord(s,id){return new Promise(resolve=>{
    let request,db=null,tx=null,done=false,timer=null;
    function finish(result){if(done)return;done=true;if(timer!==null)root.clearTimeout(timer);if(!result.ok&&tx){try{tx.abort();}catch{}}if(db){try{db.close();}catch{}}resolve(result);}
    if(!current(s)){finish(fail('SCOPE_CHANGED'));return;}
    if(!s.idb||typeof s.idb.open!=='function'){finish(fail('AUDIO_DB_UNAVAILABLE'));return;}
    // Install the deadline before opening so a timer setup failure cannot leave
    // an unhandled DB request. Late success must close without reading data.
    try{timer=root.setTimeout(()=>finish(fail('AUDIO_READ_TIMEOUT')),10000);request=s.idb.open(DB);}catch{finish(fail('AUDIO_DB_UNAVAILABLE'));return;}
    request.onupgradeneeded=()=>{try{request.transaction.abort();}catch{}finish(fail('AUDIO_DB_MISSING'));};
    request.onblocked=()=>finish(fail('AUDIO_DB_BLOCKED'));
    request.onerror=()=>finish(fail('AUDIO_DB_UNAVAILABLE'));
    request.onsuccess=()=>{
      db=request.result;if(done){try{db.close();}catch{}return;}
      if(!current(s)){finish(fail('SCOPE_CHANGED'));return;}
      try{
        if(!db.objectStoreNames.contains(STORE)){finish(fail('AUDIO_STORE_MISSING'));return;}
        db.onversionchange=()=>finish(fail('AUDIO_DB_CHANGED'));
        tx=db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).get(id);let value;
        req.onsuccess=()=>{if(!done)value=req.result;};req.onerror=()=>finish(fail('AUDIO_READ_FAILED'));
        tx.onabort=tx.onerror=()=>finish(fail('AUDIO_READ_FAILED'));
        tx.oncomplete=()=>finish(current(s)?{ok:true,record:value}:fail('SCOPE_CHANGED'));
      }catch{finish(fail('AUDIO_READ_FAILED'));}
    };
  });}
  async function resolveSource(id){
    const s=capture();if(!s)return fail('SCOPE_UNAVAILABLE');const found=lookup(s,id);if(!found.ok)return found;
    const record=await readRecord(s,id);if(!current(s))return fail('SCOPE_CHANGED');if(!record.ok)return record;
    const latest=lookup(s,id);if(!latest.ok||latest.raw!==found.raw)return fail('STALE_CATALOG');
    const row=record.record,blob=row&&row.blob;if(!row)return fail('AUDIO_MISSING');
    if(row.id!==id||!root.Blob||!(blob instanceof root.Blob)||blob.size<=0||(row.size!=null&&row.size!==blob.size))return fail('INVALID_AUDIO_RECORD');
    const mimeType=String(blob.type||row.mimeType||'').toLowerCase();
    if(mimeType&&!/^audio\/[a-z0-9.+-]+$/.test(mimeType)&&mimeType!=='application/octet-stream')return fail('INVALID_AUDIO_TYPE');
    if(!current(s))return fail('SCOPE_CHANGED');
    return {ok:true,track:latest.track,source:{kind:'blob',blob,mimeType}};
  }
  root.MAOMusicCatalogAdapter=Object.freeze({version:1,listTracks,getTrack,resolveSource});
})(window);
