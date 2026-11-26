import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const page=readFileSync(new URL('../music/music.html',import.meta.url),'utf8');
const moduleSource=readFileSync(new URL('../shared/js/phone/music-playback-controller.js',import.meta.url),'utf8');
const helpers=page.slice(page.indexOf('  const musicController = window.MAOMusicPlaybackController.create('),page.indexOf('  // ===== IndexedDB：audio store'));
const restore=page.slice(page.indexOf('  function loadState()'),page.indexOf("  window.addEventListener('pagehide', function() {\n    musicPauseNative"));
const player=page.slice(page.indexOf('  async function playTrack(trackId)'),page.indexOf('  // 音频事件：进度更新'));
assert.ok(helpers.includes('function musicPlaybackMessage') && player.includes('async function togglePlay'));
function fakeLocks(){
 let held=false;
 return {async request(name,options,callback){
   assert.equal(name,'maomao-native-music-playback-v1');
   assert.deepEqual(options,{mode:'exclusive',ifAvailable:true});
   if(held)return callback(null);
   held=true;try{return await callback({name});}finally{held=false;}
 },get held(){return held;}};
}
function fixture(locks=fakeLocks(),initialScope='test-account',initialProgress=null){
 const tracks=[{id:'a',name:'A',artist:'a',source:'local'},{id:'b',name:'B',artist:'b',source:'local'},{id:'c',name:'C',artist:'c',source:'local'}];
 const revokes=[],saved=[],events=[],toasts=[],elements=new Map();
 let nextUrl=0,read=async id=>({id}),start=async()=>{audio.paused=false},scope=initialScope;
 const audio={src:'',paused:true,ended:false,currentTime:0,duration:12,pause(){this.paused=true},removeAttribute(k){if(k==='src')this.src=''},load(){this.currentTime=0;this.ended=false;this.paused=true},play(){return start()},addEventListener(){},removeEventListener(){}};
 const document={getElementById(id){if(!elements.has(id))elements.set(id,{style:{}});return elements.get(id)}};
 const values=new Map();if(initialProgress!==null)values.set('music_state',JSON.stringify(initialProgress));
 const store={getItem(k){return values.get(k)??null},setItem(k,v){values.set(k,String(v));}};
 const env={window:{audio,isShuffle:false},tracks,document,URL:{createObjectURL:()=> 'blob:'+ ++nextUrl,revokeObjectURL:url=>revokes.push(url)},getAudioBlob:id=>read(id),getTrackById:id=>tracks.find(t=>t.id===id),toast:m=>toasts.push(m),updatePlayIcon(){},renderAlbum(){},updateHeartIcon(){},closeImportSheet(){},renderTrackLyrics(){},musicDisplayArtist:t=>t.artist,readRecentIds:()=>[],saveRecentIds(){},localStorage:store,musicWarnOnce(){},showNP(){},musicApplyCurrentCover:async()=>{},musicEmitPlayback:type=>events.push({type,paused:audio.paused}),navigator:{},setTimeout(){}};
 env.window.MAOGroupWriteGuard={account:()=>scope};env.window.URL=env.URL;env.window.navigator={locks};
 new Function('window',moduleSource)(env.window);
 const api=new Function('e',`const {window,tracks,document,URL,getAudioBlob,getTrackById,toast,updatePlayIcon,renderAlbum,updateHeartIcon,closeImportSheet,renderTrackLyrics,musicDisplayArtist,readRecentIds,saveRecentIds,localStorage,musicWarnOnce,showNP,musicApplyCurrentCover,musicEmitPlayback,navigator,setTimeout}=e;
 let currentIdx=0,playing=false;
 function saveState(){e.saved(tracks[currentIdx].id);localStorage.setItem('music_state',JSON.stringify({id:tracks[currentIdx].id,idx:currentIdx,time:window.audio.currentTime,playing}));return true;}
 `+helpers+player+restore+`
 return {playTrack,togglePlay,loadState,musicSaveOwnedState,musicPauseNative,musicDiscardAudioSource,controller:musicController,state:()=>({id:tracks[currentIdx].id,source:musicController.getState().trackId,pending:musicController.getState().pending,playing,confirmed:musicHasConfirmedSource(tracks[currentIdx])})};`)({...env,saved:id=>saved.push(id)});
 return {api,audio,revokes,saved,events,toasts,store,read(fn){read=fn},start(fn){start=fn},scope(value){scope=value},factory:env.window.MAOMusicPlaybackController};
}
test('failed native switch cannot label rejected bytes as previous track; retry reopens original',async()=>{
 const h=fixture();assert.equal(await h.api.playTrack('a'),true);
 const prior=h.audio.src;
 h.start(async()=>{throw Error('NotAllowedError')});
 assert.equal(await h.api.playTrack('b'),false);
 assert.equal(h.api.state().id,'a');assert.equal(h.api.state().confirmed,false);
 assert.equal(h.audio.src,'');assert.equal(h.audio.paused,true);
 assert.deepEqual(h.saved,['a']);assert.ok(h.revokes.includes(prior));assert.equal(h.revokes.length,2);
 assert.deepEqual(h.events.slice(-2),[{type:'switching',paused:true},{type:'error',paused:true}]);
 h.start(async()=>{h.audio.paused=false});await h.api.togglePlay();
 assert.equal(h.api.state().source,'a');assert.equal(h.api.state().playing,true);
});
test('missing new Blob keeps currently confirmed song intact',async()=>{
 const h=fixture();await h.api.playTrack('a');const src=h.audio.src;
 h.read(async()=>null);assert.equal(await h.api.playTrack('b'),false);
 assert.equal(h.api.state().source,'a');assert.equal(h.audio.src,src);assert.equal(h.audio.paused,false);assert.equal(h.revokes.length,0);
 assert.deepEqual(h.events.at(-1),{type:'error',paused:false});
});
test('pause during pending file read cancels the later source mutation',async()=>{
 const h=fixture();await h.api.playTrack('a');const src=h.audio.src;let release;
 h.read(()=>new Promise(resolve=>{release=resolve}));const work=h.api.playTrack('b');
 await h.api.togglePlay();release({id:'b'});assert.equal(await work,false);
 assert.equal(h.audio.src,src);assert.equal(h.audio.paused,true);assert.deepEqual(h.saved,['a']);
});
test('latest fast switch wins and obsolete deferred request cannot revoke active URL',async()=>{
 const h=fixture();await h.api.playTrack('a');let release;
 h.read(id=>id==='b'?new Promise(resolve=>{release=resolve}):Promise.resolve({id}));
 const first=h.api.playTrack('b');assert.equal(await h.api.playTrack('c'),true);const src=h.audio.src;
 release({id:'b'});assert.equal(await first,false);assert.equal(h.api.state().id,'c');assert.equal(h.audio.src,src);assert.ok(!h.revokes.includes(src));assert.deepEqual(h.saved,['a','c']);
 assert.deepEqual(h.events.at(-1),{type:'play',paused:false});
});
test('pause during pending native play discards unconfirmed URL; late reject cannot change state',async()=>{
 const h=fixture();await h.api.playTrack('a');let reject;
 h.start(()=>new Promise((_,no)=>{reject=no}));const work=h.api.playTrack('b');for(let i=0;i<40&&!reject;i++)await Promise.resolve();assert.equal(typeof reject,'function');
 const unconfirmed=h.audio.src;await h.api.togglePlay();reject(Error('AbortError'));assert.equal(await work,false);
 assert.equal(h.audio.src,'');assert.equal(h.api.state().source,null);assert.ok(h.revokes.includes(unconfirmed));assert.deepEqual(h.saved,['a']);
});
test('page teardown cancels pending work and revokes current URL',async()=>{
 const h=fixture();await h.api.playTrack('a');const url=h.audio.src;
 h.api.musicPauseNative();h.api.musicDiscardAudioSource();assert.equal(h.audio.src,'');assert.ok(h.revokes.includes(url));assert.equal(h.api.state().playing,false);
 assert.match(page,/window\.addEventListener\('pagehide', function\(\) \{\s*musicPauseNative\(\);\s*musicEmitPlayback\('pause'\);\s*musicDiscardAudioSource\(\)/);
});

test('an obsolete failed read cannot publish an error over a newer confirmed song',async()=>{
 const h=fixture();await h.api.playTrack('a');let reject;
 h.read(id=>id==='b'?new Promise((_,no)=>{reject=no}):Promise.resolve({id}));
 const pending=h.api.playTrack('b');assert.equal(await h.api.playTrack('c'),true);const count=h.events.length;
 reject(Error('stale read'));assert.equal(await pending,false);
 assert.equal(h.events.length,count);assert.equal(h.api.state().id,'c');assert.equal(h.api.state().playing,true);
});

test('shared controller rejects a second owner for the same native audio element',async()=>{
 const h=fixture();assert.throws(()=>h.factory.create({audio:h.audio,getTrack:()=>null,resolveSource:async()=>null,getScope:()=>''}),/already controlled/);
 h.api.controller.dispose();const newOwner=h.factory.create({audio:h.audio,getTrack:()=>null,resolveSource:async()=>null,getScope:()=>''});newOwner.dispose();
});
test('scope changes during read stop current audio and prevent stale data from playing',async()=>{
 const h=fixture();await h.api.playTrack('a');const src=h.audio.src;let release;
 h.read(()=>new Promise(resolve=>{release=resolve}));const pending=h.api.playTrack('b');h.scope('other-account');release({id:'b'});
 assert.equal(await pending,false);assert.equal(h.audio.paused,true);assert.equal(h.audio.src,'');assert.ok(h.revokes.includes(src));assert.deepEqual(h.saved,['a']);assert.equal(h.api.controller.getState().trackId,null);
});
test('shared seek clamps native time and refuses invalid values',async()=>{
 const h=fixture();await h.api.playTrack('a');assert.equal(h.api.controller.seek(100).ok,true);assert.equal(h.audio.currentTime,12);assert.equal(h.api.controller.seek(-1).ok,true);assert.equal(h.audio.currentTime,0);assert.equal(h.api.controller.seek(NaN).ok,false);
});

test('two controllers share a single origin lock even when accounts differ',async()=>{
 const locks=fakeLocks(),a=fixture(locks),b=fixture(locks,'other-account');
 assert.equal(await a.api.playTrack('a'),true);
 assert.equal(await b.api.playTrack('b'),false);assert.equal(b.audio.src,'');assert.equal(b.audio.paused,true);
 assert.equal(a.api.controller.getState().playing,true);assert.equal(locks.held,true);
 await a.api.togglePlay();assert.equal(a.audio.paused,true);
 assert.equal(await b.api.playTrack('b'),true);
 assert.equal(await a.api.controller.resume().then(r=>r.code),'PLAYBACK_BUSY');
 assert.equal(a.audio.paused,true);assert.equal(b.api.controller.getState().playing,true);
 b.api.controller.dispose();assert.equal(await a.api.controller.resume().then(r=>r.ok),true);
 a.api.controller.dispose();
});
test('missing reliable lock support fails closed',async()=>{
 const h=fixture(null);let calls=0;h.start(async()=>{calls++});
 const result=await h.api.controller.play('a');assert.equal(result.code,'LOCK_UNAVAILABLE');assert.equal(calls,0);assert.equal(h.audio.src,'');
});
test('failed native play releases lease',async()=>{
 const locks=fakeLocks(),a=fixture(locks),b=fixture(locks);
 a.start(async()=>{throw Error('rejected')});assert.equal(await a.api.playTrack('a'),false);
 assert.equal(await b.api.playTrack('b'),true);b.api.controller.dispose();
});
test('cancel pending lock cannot start native audio later',async()=>{
 let grant;const locks={request(name,opts,fn){return new Promise(resolve=>{grant=()=>Promise.resolve(fn({name})).then(resolve);});}};
 const h=fixture(locks);let calls=0;h.start(async()=>{calls++});
 const pending=h.api.playTrack('a');for(let i=0;i<40&&!grant;i++)await Promise.resolve();
 assert.equal(typeof grant,'function');await h.api.togglePlay();grant();
 assert.equal(await pending,false);assert.equal(calls,0);assert.equal(h.audio.src,'');
});

test('legacy index restore is read-only until confirmed playback and keeps the saved time',async()=>{
 const legacy={idx:1,time:7,playing:true};const h=fixture(fakeLocks(),'test-account',legacy);
 h.api.loadState();assert.equal(h.api.state().id,'b');assert.equal(h.audio.paused,true);
 assert.equal(h.store.getItem('music_state'),JSON.stringify(legacy));assert.deepEqual(h.saved,[]);
 assert.equal(h.api.musicSaveOwnedState(),false);
 await h.api.togglePlay();assert.equal(h.audio.currentTime,7);
 assert.equal(JSON.parse(h.store.getItem('music_state')).id,'b');assert.equal(JSON.parse(h.store.getItem('music_state')).time,7);
 h.api.controller.dispose();
});
test('unknown stable ID must not restore a different song from an old index',async()=>{
 const original={id:'deleted',idx:1,time:7};const h=fixture(fakeLocks(),'test-account',original);
 h.api.loadState();assert.equal(h.api.state().id,'a');assert.equal(h.store.getItem('music_state'),JSON.stringify(original));
 await h.api.togglePlay();assert.equal(h.audio.currentTime,0);assert.equal(h.api.state().id,'a');h.api.controller.dispose();
});
test('paused non-owner may not persist progress even if its source is still loaded',async()=>{
 const locks=fakeLocks(),a=fixture(locks),b=fixture(locks);
 await a.api.playTrack('a');await a.api.togglePlay();const previous=a.store.getItem('music_state');
 await b.api.playTrack('b');assert.equal(a.api.musicSaveOwnedState(),false);
 assert.equal(a.store.getItem('music_state'),previous);b.api.controller.dispose();
});
