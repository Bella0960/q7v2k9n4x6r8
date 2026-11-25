import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const files=['../shared/js/phone/group-write-guard.js','../shared/js/group-governance.js','../shared/js/phone/music-playback-controller.js','../shared/js/phone/group-listening-session.js'];
const sources=files.map(path=>readFileSync(new URL(path,import.meta.url),'utf8'));
const contextSource=readFileSync(new URL('../shared/js/phone/group-listening-context.js',import.meta.url),'utf8');
function fixture(){
 let account='MAO-AAAAAAAAAAAA',role='member',identity={ready:true,accountId:account,role},gid='g1',uuid=0,writes=0,monitor;
 const groups=[{id:'g1',ownerId:'__user',members:[{id:'r1',name:'同名'},{id:'r2',name:'同名'}]},{id:'g2',members:[{id:'r3'}]}];
 const data=new Map([['phone_groups',JSON.stringify(groups)]]),events=new Map(),roles=new Set(['r1','r2','r3']),tracks=new Map(['a','b'].map(id=>[id,{id,name:id}]));
 let held=false,seq=0,delay=null,reject=false;
 const storage={getItem:k=>data.get(k)??null,setItem(){writes++;throw Error('read only');},removeItem(){writes++;throw Error('read only');}};
 const root={location:{hostname:'preview.mao520.com'},document:{querySelector:s=>({content:s.includes('mao-account-id')?account:role})},localStorage:storage,
 get __MAO_ACCOUNT_SCOPE__(){return identity;},crypto:{randomUUID:()=> 'session-'+ ++uuid},
 setInterval(fn){monitor=fn;return 1},clearInterval(){monitor=null},
 addEventListener(k,fn){if(!events.has(k))events.set(k,new Set());events.get(k).add(fn);},
 removeEventListener(k,fn){events.get(k)?.delete(fn);},
 URL:{createObjectURL:()=> 'blob:'+ ++seq,revokeObjectURL(){}},
 navigator:{locks:{async request(n,o,fn){if(held)return fn(null);held=true;try{return await fn({name:n});}finally{held=false;}}}}};
 for(const src of sources)new Function('window',src)(root);
 const audio={src:'',paused:true,ended:false,currentTime:0,duration:12,pause(){this.paused=true},removeAttribute(){this.src=''},load(){this.paused=true;this.currentTime=0;this.ended=false},
 async play(){if(reject)throw Error('denied');this.paused=false;},addEventListener(){},removeEventListener(){}};
 const catalog={getTrack:id=>tracks.has(id)?{ok:true,track:tracks.get(id)}:{ok:false,code:'TRACK_NOT_FOUND'}};
 const player=root.MAOMusicPlaybackController.create({audio,getTrack:id=>tracks.get(id),getScope:()=>root.MAOGroupWriteGuard.account(),resolveSource:async t=>{if(delay)await delay;return {kind:'blob',blob:{id:t.id}};}});
 root.MAOMusicCatalogAdapter={...catalog,async resolveSource(id){if(delay)await delay;return {ok:true,track:tracks.get(id),source:{kind:'blob',blob:{id}}};}};
 const opts={player,catalog,getGroupId:()=>gid,hasRole:id=>roles.has(id)};
 const api=root.MAOGroupListeningSession.create(opts);
 return {api,player,root,opts,audio,data,roles,tracks,groups,events,writeCount:()=>writes,held:()=>held,
 change(fn){const next=JSON.parse(data.get('phone_groups'));fn(next);data.set('phone_groups',JSON.stringify(next));},
 switchGroup(v){gid=v;},switchAccount(){account='MAO-BBBBBBBBBBBB';identity={ready:true,accountId:account,role};},replaceScope(){identity={...identity};},
 tick(){monitor?.();},exit(){for(const fn of events.get('pagehide')||[])fn();},reject(v){reject=v;},
 defer(){let resolve;delay=new Promise(r=>resolve=r);return ()=>{delay=null;resolve();};}};
}
const start=h=>{const r=h.api.start();assert.equal(r.ok,true);return r.snapshot;};
const ready=h=>{const r=h.api.selectTrack(start(h),'a');assert.equal(r.ok,true);return r.snapshot;};
test('full session select queue join play seek pause resume leave end, no writes',async()=>{
 const h=fixture();let s=start(h);s=h.api.setQueue(s,['a','b']).snapshot;s=h.api.selectTrack(s,'a').snapshot;
 s=h.api.join(s,'r2').snapshot;assert.deepEqual(s.participants,['__user','r2']);assert.deepEqual(s.queue,['a','b']);
 s=(await h.api.play(s)).snapshot;assert.equal(s.playing,true);assert.equal(h.audio.paused,false);assert.equal(s.roleAudioDelivered,false);assert.equal(s.remoteSynchronized,false);
 s=h.api.seek(s,8).snapshot;assert.equal(s.currentTime,8);s=h.api.pause(s).snapshot;assert.equal(s.status,'paused');
 s=(await h.api.play(s)).snapshot;assert.equal(s.currentTime,8);s=h.api.leave(s,'r2').snapshot;assert.deepEqual(s.participants,['__user']);
 s=h.api.end(s).snapshot;assert.equal(s.status,'ended');assert.equal(h.audio.src,'');assert.equal(h.writeCount(),0);h.api.destroy();
});
test('stale commands cannot affect new revision and caller cannot cross group',async()=>{
 const h=fixture();const s=start(h),q=h.api.selectTrack(s,'a').snapshot;
 assert.equal((await h.api.play(s)).code,'STALE_COMMAND');assert.equal((await h.api.play({...q,groupId:'g2'})).code,'STALE_COMMAND');
 assert.equal(h.audio.paused,true);h.api.destroy();
});
test('exact member IDs, duplicate names not identities, muted/deleted members denied',()=>{
 const h=fixture();let s=ready(h);assert.equal(h.api.join(s,'同名').ok,false);assert.equal(h.api.join(s,'r3').ok,false);
 h.change(g=>g[0].members[0].muted=true);assert.equal(h.api.join(s,'r1').ok,false);
 h.roles.delete('r2');assert.equal(h.api.join(s,'r2').ok,false);h.api.destroy();
});
test('duplicate group or member records fail closed before create',()=>{
 const h=fixture();h.change(g=>g.push({...g[0]}));assert.equal(h.api.start().ok,false);h.api.destroy();
 const b=fixture();b.change(g=>g[0].members.push({id:'r1'}));assert.equal(b.api.start().ok,false);b.api.destroy();
});
test('scope switch, same-account scope replacement and group switch stop audio',async()=>{
 for(const change of [h=>h.switchAccount(),h=>h.replaceScope(),h=>h.switchGroup('g2')]){
  const h=fixture();assert.equal((await h.api.play(ready(h))).ok,true);change(h);h.tick();assert.equal(h.api.getSnapshot(),null);assert.equal(h.audio.src,'');h.api.destroy();
 }
});
test('member removal, mute of participant, role deletion, leave and disband invalidate',async()=>{
 for(const change of [h=>h.change(g=>g[0].members.pop()),h=>h.change(g=>g[0].members[0].muted=true),h=>h.roles.delete('r1'),h=>h.change(g=>g[0].userMembership='left'),h=>h.change(g=>g.shift())]){
  const h=fixture();let s=h.api.join(ready(h),'r1').snapshot;assert.equal((await h.api.play(s)).ok,true);
  change(h);h.tick();assert.equal(h.api.getSnapshot(),null);assert.equal(h.audio.paused,true);assert.equal(h.audio.src,'');h.api.destroy();
 }
});
test('delayed audio read after account switch cannot play',async()=>{
 const h=fixture(),s=ready(h),release=h.defer();const pending=h.api.play(s);h.switchAccount();h.tick();release();
 assert.equal((await pending).ok,false);assert.equal(h.audio.src,'');assert.equal(h.api.getSnapshot(),null);h.api.destroy();
});
test('pause pending read using fresh token; obsolete completion cannot restart',async()=>{
 const h=fixture(),s=ready(h),release=h.defer();const pending=h.api.play(s);const loading=h.api.getSnapshot();
 assert.equal(loading.status,'loading');assert.equal(h.api.pause(loading).ok,true);release();
 assert.equal((await pending).ok,false);assert.equal(h.audio.paused,true);assert.equal(h.api.getSnapshot().status,'ready');h.api.destroy();
});
test('new selection cancels pending old track and end is terminal',async()=>{
 const h=fixture(),s=ready(h),release=h.defer();const pending=h.api.play(s);const b=h.api.selectTrack(h.api.getSnapshot(),'b').snapshot;release();
 assert.equal((await pending).ok,false);assert.equal(h.api.getSnapshot().trackId,'b');assert.equal(h.audio.src,'');
 assert.equal((await h.api.play(b)).ok,true);const ended=h.api.end(h.api.getSnapshot()).snapshot;
 assert.equal((await h.api.play(ended)).code,'SESSION_ENDED');h.api.destroy();
});
test('playback rejection does not claim playing, explicit retry can succeed',async()=>{
 const h=fixture();h.reject(true);const denied=await h.api.play(ready(h));assert.equal(denied.ok,false);assert.equal(denied.snapshot.status,'error');assert.equal(denied.snapshot.playing,false);
 h.reject(false);assert.equal((await h.api.play(denied.snapshot)).ok,true);h.api.destroy();
});
test('pagehide releases, rejects late actions, exposes no old snapshot',async()=>{
 const h=fixture(),s=(await h.api.play(ready(h))).snapshot;const seen=[];h.api.subscribe(e=>seen.push(e));h.exit();
 assert.equal(h.api.getSnapshot(),null);assert.equal(h.audio.src,'');assert.equal((await h.api.play(s)).ok,false);
 assert.equal(seen.at(-1).snapshot,null);h.api.destroy();
});
test('second session on same controller denied, bad queue rejected, snapshots immutable',()=>{
 const h=fixture();assert.throws(()=>h.root.MAOGroupListeningSession.create(h.opts),/already assigned/);
 const s=ready(h);assert.equal(h.api.setQueue(s,['a','a']).ok,false);assert.equal(h.api.setQueue(s,['b']).ok,false);
 assert.equal(Object.isFrozen(s.queue),true);assert.equal(Object.isFrozen(s),true);h.api.destroy();
});

test('product composition blocks native play when membership changes during source read, even without timer',async()=>{
 const h=fixture();h.api.destroy();h.player.dispose();
 const api=h.root.MAOGroupListeningSession.createForGroup({audio:h.audio,getGroupId:h.opts.getGroupId,hasRole:h.opts.hasRole});
 const s=api.selectTrack(api.start().snapshot,'a').snapshot;let nativeCalls=0;
 h.audio.play=async()=>{nativeCalls++;h.audio.paused=false;};
 const release=h.defer(),pending=api.play(s);h.change(g=>g[0].members.pop());release();
 assert.equal((await pending).ok,false);assert.equal(nativeCalls,0);assert.equal(api.getSnapshot(),null);assert.equal(h.audio.src,'');
 api.destroy();
});
test('product composition rejects replacement scope and allows fresh controller only after destroy',async()=>{
 const h=fixture();h.api.destroy();h.player.dispose();
 const opts={audio:h.audio,getGroupId:h.opts.getGroupId,hasRole:h.opts.hasRole};
 const api=h.root.MAOGroupListeningSession.createForGroup(opts);
 const s=api.selectTrack(api.start().snapshot,'a').snapshot;
 assert.equal((await api.play(s)).ok,true);h.replaceScope();assert.equal(api.getSnapshot(),null);assert.equal(h.audio.src,'');
 assert.equal(api.start().ok,false);api.destroy();const replacement=h.root.MAOGroupListeningSession.createForGroup(opts);
 assert.equal(replacement.start().ok,true);replacement.destroy();
});

test('cancelling first load returns ready and does not expose paused music context',async()=>{
 const h=fixture();new Function('window',contextSource)(h.root);
 const s=h.api.join(ready(h),'r1').snapshot,release=h.defer(),pending=h.api.play(s);
 const cancelled=h.api.pause(h.api.getSnapshot());release();
 assert.equal((await pending).ok,false);assert.equal(cancelled.snapshot.status,'ready');
 const options={groupId:'g1',roleId:'r1',readSnapshot:()=>h.api.getSnapshot(),hasRole:id=>h.roles.has(id)};
 assert.equal(h.root.MAOGroupListeningContext.project(options),null);
 assert.equal((await h.api.play(h.api.getSnapshot())).ok,true);h.api.destroy();
});
test('lost native source after a real pause becomes error and is not projected as paused',async()=>{
 const h=fixture();new Function('window',contextSource)(h.root);
 const s=h.api.join(ready(h),'r1').snapshot;
 await h.api.play(s);const paused=h.api.pause(h.api.getSnapshot()).snapshot;
 assert.equal(paused.status,'paused');
 h.player.release();const lost=h.api.getSnapshot();
 assert.equal(lost.status,'error');assert.equal(lost.error,'SOURCE_LOST');assert.equal(lost.playing,false);
 assert.equal(h.root.MAOGroupListeningContext.project({groupId:'g1',roleId:'r1',readSnapshot:()=>h.api.getSnapshot(),hasRole:id=>h.roles.has(id)}),null);
 assert.equal((await h.api.play(lost)).ok,true);h.api.destroy();
});

test('batch queue validates through one catalog scan and rejects unavailable tracks',()=>{
 const h=fixture();let scans=0,lookups=0,broken=false;
 const original=h.opts.catalog.getTrack;
 h.opts.catalog.getTrack=id=>{lookups++;return original(id);};
 h.opts.catalog.listTracks=()=>{scans++;return broken?{ok:false}:{ok:true,tracks:[...h.tracks.values()]};};
 for(let i=0;i<99;i++)h.tracks.set('t'+i,{id:'t'+i,name:'track'});
 const s=ready(h);lookups=0;const queue=['a',...Array.from({length:99},(_,i)=>'t'+i)];
 const result=h.api.setQueue(s,queue);
 assert.equal(result.ok,true);assert.equal(scans,1);assert.equal(lookups,0);assert.equal(result.snapshot.queue.length,100);
 h.tracks.delete('t1');assert.equal(h.api.setQueue(result.snapshot,queue).code,'INVALID_QUEUE');
 broken=true;assert.equal(h.api.setQueue(result.snapshot,['a']).code,'INVALID_QUEUE');
 assert.deepEqual(h.api.getSnapshot().queue,queue);h.api.destroy();
});
