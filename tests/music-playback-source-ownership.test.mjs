import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const page=readFileSync(new URL('../music/music.html',import.meta.url),'utf8');
const helpers=page.slice(page.indexOf('  let currentBlobUrl = null;'),page.indexOf('  // ===== IndexedDB：audio store'));
const player=page.slice(page.indexOf('  async function playTrack(trackId)'),page.indexOf('  // 音频事件：进度更新'));
assert.ok(helpers.includes('function musicPlaybackFailure') && player.includes('async function togglePlay'));
function fixture(){
 const tracks=[{id:'a',name:'A',artist:'a',source:'local'},{id:'b',name:'B',artist:'b',source:'local'},{id:'c',name:'C',artist:'c',source:'local'}];
 const revokes=[],saved=[],events=[],toasts=[],elements=new Map();
 let nextUrl=0,read=async id=>({id}),start=async()=>{audio.paused=false};
 const audio={src:'',paused:true,ended:false,currentTime:0,duration:12,pause(){this.paused=true},removeAttribute(k){if(k==='src')this.src=''},load(){this.currentTime=0;this.ended=false;this.paused=true},play(){return start()}};
 const document={getElementById(id){if(!elements.has(id))elements.set(id,{style:{}});return elements.get(id)}};
 const store={getItem(){return null},setItem(){},};
 const env={window:{audio,isShuffle:false},tracks,document,URL:{createObjectURL:()=> 'blob:'+ ++nextUrl,revokeObjectURL:url=>revokes.push(url)},getAudioBlob:id=>read(id),getTrackById:id=>tracks.find(t=>t.id===id),toast:m=>toasts.push(m),updatePlayIcon(){},renderAlbum(){},updateHeartIcon(){},closeImportSheet(){},renderTrackLyrics(){},musicDisplayArtist:t=>t.artist,readRecentIds:()=>[],saveRecentIds(){},localStorage:store,musicWarnOnce(){},showNP(){},musicApplyCurrentCover:async()=>{},musicEmitPlayback:type=>events.push({type,paused:audio.paused}),navigator:{},setTimeout(){}};
 const api=new Function('e',`const {window,tracks,document,URL,getAudioBlob,getTrackById,toast,updatePlayIcon,renderAlbum,updateHeartIcon,closeImportSheet,renderTrackLyrics,musicDisplayArtist,readRecentIds,saveRecentIds,localStorage,musicWarnOnce,showNP,musicApplyCurrentCover,musicEmitPlayback,navigator,setTimeout}=e;
 let playbackRevision=0,pendingPlayback=false,playbackSourceTrackId=null,currentIdx=0,playing=false;
 function saveState(){e.saved(tracks[currentIdx].id)}
 `+helpers+player+`
 return {playTrack,togglePlay,musicPauseNative,musicDiscardAudioSource,state:()=>({id:tracks[currentIdx].id,source:playbackSourceTrackId,pending:pendingPlayback,playing,confirmed:musicHasConfirmedSource(tracks[currentIdx])})};`)({...env,saved:id=>saved.push(id)});
 return {api,audio,revokes,saved,events,toasts,read(fn){read=fn},start(fn){start=fn}};
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
 h.start(()=>new Promise((_,no)=>{reject=no}));const work=h.api.playTrack('b');await Promise.resolve();
 const unconfirmed=h.audio.src;await h.api.togglePlay();reject(Error('AbortError'));assert.equal(await work,false);
 assert.equal(h.audio.src,'');assert.equal(h.api.state().source,null);assert.ok(h.revokes.includes(unconfirmed));assert.deepEqual(h.saved,['a']);
});
test('page teardown cancels pending work and revokes current URL',async()=>{
 const h=fixture();await h.api.playTrack('a');const url=h.audio.src;
 h.api.musicPauseNative();h.api.musicDiscardAudioSource();assert.equal(h.audio.src,'');assert.ok(h.revokes.includes(url));assert.equal(h.api.state().playing,false);
 assert.match(page,/window\.addEventListener\('pagehide', function\(\) \{\s*musicPauseNative\(\);\s*musicDiscardAudioSource\(\)/);
});

test('an obsolete failed read cannot publish an error over a newer confirmed song',async()=>{
 const h=fixture();await h.api.playTrack('a');let reject;
 h.read(id=>id==='b'?new Promise((_,no)=>{reject=no}):Promise.resolve({id}));
 const pending=h.api.playTrack('b');assert.equal(await h.api.playTrack('c'),true);const count=h.events.length;
 reject(Error('stale read'));assert.equal(await pending,false);
 assert.equal(h.events.length,count);assert.equal(h.api.state().id,'c');assert.equal(h.api.state().playing,true);
});
