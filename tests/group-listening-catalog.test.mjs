import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const install=new Function('window',readFileSync(new URL('../shared/js/phone/music-catalog-adapter.js',import.meta.url),'utf8'));
// Require the actual repository guard; never fall back to a mock identity implementation.
const guard=new Function('window',readFileSync(new URL('../shared/js/phone/group-write-guard.js',import.meta.url),'utf8'));
const track=(id='local_1',extra={})=>({id,name:'测试曲目',source:'local',artist:'本地导入',durSec:12,...extra});
const audio=new Blob(['fixture'],{type:'audio/mpeg'});
const rec=(id='local_1',extra={})=>({id,blob:audio,size:audio.size,mimeType:'audio/mpeg',...extra});
function fixture(rows=[],opts={}){
 let id='MAO-AAAAAAAAAAAA',role='member',scope={ready:true,accountId:id,role},writes=0,closed=0,aborted=0,reads=0,releaseOpen,releaseRead,deadline,txAborts=0;
 const data=new Map([['music_local_tracks',JSON.stringify(rows)],['music_cover_assets_v1',JSON.stringify(opts.covers||{})]]),records=new Map(opts.records||[]);
 const storage={getItem:k=>data.get(k)??null,setItem(){writes++;throw Error('read only');},removeItem(){writes++;throw Error('read only');}};
 const idb={open(name,...versions){assert.equal(name,'maomao-media-store');assert.equal(versions.length,0);const q={};const deliver=()=>{
  if(opts.missingDB){q.transaction={abort(){aborted++;}};q.onupgradeneeded();return;}
  if(opts.blocked){q.onblocked();return;}
  q.result={objectStoreNames:{contains:k=>k==='audio'&&!opts.missingStore},close(){closed++;},transaction(k,mode){assert.equal(k,'audio');assert.equal(mode,'readonly');const tx={abort(){txAborts++;tx.onabort?.()},objectStore(){return{get(id){reads++;const rq={};const deliver=()=>{rq.result=records.get(id);rq.onsuccess();tx.oncomplete();};if(opts.deferRead)releaseRead=deliver;else queueMicrotask(deliver);return rq;}};}};return tx;}};q.onsuccess();};if(opts.deferOpen)releaseOpen=deliver;else queueMicrotask(deliver);return q;}};
 const win={localStorage:storage,indexedDB:idb,Blob,location:{hostname:'preview.mao520.com'},document:{querySelector(sel){return sel.includes('mao-account-id')?id&&{content:id}:role&&{content:role}}},setTimeout(fn){deadline=fn;return 1},clearTimeout(){deadline=null},get __MAO_ACCOUNT_SCOPE__(){return scope;}};guard(win);install(win);
 return {api:win.MAOMusicCatalogAdapter,data,records,stats:()=>({writes,closed,aborted,reads,txAborts}),switchAccount(){id='MAO-BBBBBBBBBBBB';scope={ready:true,accountId:id,role}},replaceScope(){scope={...scope}},invalidate(){scope={...scope,ready:false}},changeRole(){role='other'},hideMetadata(){id=null;role=null},timeout(){deadline?.()},releaseOpen(){releaseOpen?.()},async releaseRead(){while(!releaseRead)await Promise.resolve();releaseRead();}};
}
test('existing and legacy catalog, covers, no writes',()=>{const h=fixture([track(),{id:'old',name:'旧曲'}],{covers:{local_1:'as_'+'A'.repeat(32)}});const r=h.api.listTracks();assert.equal(r.ok,true);assert.equal(r.tracks.length,2);assert.equal(r.tracks[0].coverAssetId,'as_'+'A'.repeat(32));assert.equal(r.tracks[0].artist,'未知歌手');assert.equal(r.tracks[1].durationSeconds,null);assert.equal(h.stats().reads,0);assert.equal(h.stats().writes,0);});
test('duplicate and malformed rows fail safely',()=>{const h=fixture([track(),track(),track('valid'),{id:'bad',name:''},track('demo',{source:'remote'})]);const r=h.api.listTracks();assert.deepEqual(r.tracks.map(t=>t.id),['valid']);assert.ok(r.warnings.includes('DUPLICATE_TRACK_ID'));assert.ok(r.warnings.includes('INVALID_TRACK'));assert.equal(h.api.getTrack('local_1').code,'DUPLICATE_TRACK_ID');h.data.set('music_local_tracks','{bad');assert.equal(h.api.listTracks().code,'CATALOG_READ_FAILED');assert.equal(h.stats().writes,0);});
test('corrupt covers fall back',()=>{const h=fixture([track()]);h.data.set('music_cover_assets_v1','{bad');const r=h.api.listTracks();assert.equal(r.tracks[0].coverAssetId,null);assert.ok(r.warnings.includes('INVALID_COVERS'));assert.equal(h.stats().writes,0);});
test('original Blob resolves without writes',async()=>{const h=fixture([track()],{records:[['local_1',rec()]]});const r=await h.api.resolveSource('local_1');assert.equal(r.ok,true);assert.equal(r.source.blob,audio);assert.equal(h.stats().closed,1);assert.equal(h.stats().writes,0);});
test('missing, invalid identity, size and MIME',async()=>{const h=fixture([track()]);assert.equal((await h.api.resolveSource('local_1')).code,'AUDIO_MISSING');h.records.set('local_1',rec('other'));assert.equal((await h.api.resolveSource('local_1')).code,'INVALID_AUDIO_RECORD');h.records.set('local_1',rec('local_1',{size:99}));assert.equal((await h.api.resolveSource('local_1')).code,'INVALID_AUDIO_RECORD');const blob=new Blob(['x'],{type:'text/html'});h.records.set('local_1',rec('local_1',{blob,size:blob.size}));assert.equal((await h.api.resolveSource('local_1')).code,'INVALID_AUDIO_TYPE');});
test('no database creation and explicit unavailable store',async()=>{const h=fixture([track()],{missingDB:true});assert.equal((await h.api.resolveSource('local_1')).code,'AUDIO_DB_MISSING');assert.equal(h.stats().aborted,1);const i=fixture([track()],{missingStore:true});assert.equal((await i.api.resolveSource('local_1')).code,'AUDIO_STORE_MISSING');const j=fixture([track()],{blocked:true});assert.equal((await j.api.resolveSource('local_1')).code,'AUDIO_DB_BLOCKED');});
test('unready scope denied',async()=>{const h=fixture([track()]);h.invalidate();assert.equal(h.api.listTracks().code,'SCOPE_UNAVAILABLE');assert.equal((await h.api.resolveSource('local_1')).code,'SCOPE_UNAVAILABLE');assert.equal(h.stats().reads,0);});
test('switch before opening DB',async()=>{const h=fixture([track()],{records:[['local_1',rec()]],deferOpen:true});const p=h.api.resolveSource('local_1');h.switchAccount();h.releaseOpen();assert.equal((await p).code,'SCOPE_CHANGED');assert.equal(h.stats().reads,0);});
test('replace scope during transaction',async()=>{const h=fixture([track()],{records:[['local_1',rec()]],deferRead:true});const p=h.api.resolveSource('local_1');await Promise.resolve();h.replaceScope();await h.releaseRead();assert.equal((await p).code,'SCOPE_CHANGED');assert.equal(h.stats().closed,1);});
test('catalog changes during transaction',async()=>{const h=fixture([track()],{records:[['local_1',rec()]],deferRead:true});const p=h.api.resolveSource('local_1');await Promise.resolve();h.data.set('music_local_tracks','[]');await h.releaseRead();assert.equal((await p).code,'STALE_CATALOG');assert.equal(h.stats().writes,0);});
test('metadata and role mismatch are denied',async()=>{const h=fixture([track()]);h.changeRole();assert.equal(h.api.listTracks().code,'SCOPE_UNAVAILABLE');h.hideMetadata();assert.equal((await h.api.resolveSource('local_1')).code,'SCOPE_UNAVAILABLE');assert.equal(h.stats().reads,0);});
test('late database open after timeout closes without reading',async()=>{const h=fixture([track()],{deferOpen:true});const p=h.api.resolveSource('local_1');h.timeout();assert.equal((await p).code,'AUDIO_READ_TIMEOUT');h.releaseOpen();assert.equal(h.stats().closed,1);assert.equal(h.stats().reads,0);});
test('timeout during readonly transaction aborts and never returns old Blob',async()=>{const h=fixture([track()],{records:[['local_1',rec()]],deferRead:true});const p=h.api.resolveSource('local_1');await Promise.resolve();h.timeout();assert.equal((await p).code,'AUDIO_READ_TIMEOUT');assert.equal(h.stats().txAborts,1);assert.equal(h.stats().closed,1);await h.releaseRead();assert.equal(h.stats().writes,0);});
test('late upgrade after timeout still aborts creation',async()=>{const h=fixture([track()],{deferOpen:true,missingDB:true});const p=h.api.resolveSource('local_1');h.timeout();assert.equal((await p).code,'AUDIO_READ_TIMEOUT');h.releaseOpen();assert.equal(h.stats().aborted,1);});

// Canonical MediaRepository IDs use 160-bit uppercase Base32, not hex or mixed case.
test('cover references use the actual MediaRepository alphabet',()=>{
  for(const id of ['as_'+'a'.repeat(32),'as_'+'0'.repeat(32),'as_'+'8'.repeat(32),'as_'+'A'.repeat(31)]){
    const h=fixture([track()],{covers:{local_1:id}});
    assert.equal(h.api.getTrack('local_1').track.coverAssetId,null);
    assert.equal(h.stats().writes,0);
  }
  const id='as_'+'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const h=fixture([track()],{covers:{local_1:id}});
  assert.equal(h.api.getTrack('local_1').track.coverAssetId,id);
});
test('cover update while resolving source returns current canonical reference',async()=>{
  const h=fixture([track()],{records:[['local_1',rec()]],deferRead:true});
  const p=h.api.resolveSource('local_1');
  await Promise.resolve();
  const cover='as_'+'B'.repeat(32);
  h.data.set('music_cover_assets_v1',JSON.stringify({local_1:cover}));
  await h.releaseRead();
  const result=await p;assert.equal(result.ok,true);assert.equal(result.track.coverAssetId,cover);assert.equal(h.stats().writes,0);
});
