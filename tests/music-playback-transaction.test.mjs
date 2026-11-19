import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const music = readFileSync(new URL('../music/music.html', import.meta.url), 'utf8');
const start = music.indexOf('  async function playTrack(trackId, options) {');
const end = music.indexOf('  function musicNavigateTrack(direction, fromEnded) {', start);
assert.ok(start >= 0 && end > start, 'actual music playback source available');
const playSource = music.slice(start, end);
const tracks = [
  {id:'old',name:'Old WAV',artist:'本地',source:'local'},
  {id:'new',name:'New WAV',artist:'本地',source:'local'},
  {id:'bad',name:'Bad audio',artist:'本地',source:'local'},
  {id:'remote',name:'Remote',source:'remote',url:'https://audio.example/ok.mp3'},
  {id:'no-url',name:'No URL',source:'remote'}
];

function environment(opts={}) {
  const logs={revoked:[],plays:[],toasts:[],events:[],saved:0,queue:[],recent:['old'],
    cover:0,render:0,ui:{}};
  const audio={
    src:'blob:old',paused:false,currentTime:42,readyState:4,
    async play() {
      logs.plays.push(this.src);
      if (typeof opts.playDecision === 'function') await opts.playDecision(this.src);
      this.paused=false;
      return true;
    },
    removeAttribute(name){assert.equal(name,'src');this.src='';this.paused=true;},
    load(){this.paused=true;}
  };
  const Url={
    createObjectURL(blob){return 'blob:'+blob.id;},
    revokeObjectURL(url){logs.revoked.push(url);}
  };
  const record=new Map([['old',{id:'old'}],['new',{id:'new'}],['bad',{id:'bad'}]]);
  if(opts.missingBlob)record.delete(opts.missingBlob);
  const document={getElementById(id){
    if(!logs.ui[id])logs.ui[id]={textContent:'',style:{}};
    return logs.ui[id];
  }};
  const scope={
    getTrackById:id=>tracks.find(t=>t.id===id)||null,
    getAudioBlob:async id=>{
      if(typeof opts.getBlob === 'function')return opts.getBlob(id);
      return record.get(id)||null;
    },
    URL:Url,window:{audio},tracks,
    musicCancelPendingResumeListener(){},
    musicApplyPendingResume(){},
    updatePlayIcon(){logs.render++;},
    musicQueueAssign(id,options){logs.queue.push(id);},
    renderTrackLyrics(){},
    renderAlbum(){},updateHeartIcon(){},closeImportSheet(){},
    readRecentIds(){return logs.recent.slice();},
    saveRecentIds(values){logs.recent=values;},
    musicWarnOnce(){},
    saveState(){logs.saved++;},
    showNP(){logs.cover++;},
    musicApplyCurrentCover(){return Promise.resolve();},
    musicEmitPlayback(event){logs.events.push(event);},
    toast(message){logs.toasts.push(message);},
    localStorage:{
      getItem(){return '0';},
      setItem(){}
    },document
  };
  const factory=new Function(...Object.keys(scope),
    'let currentIdx=0, playing=true, playbackRevision=0;\n'+
    'let currentBlobUrl="blob:old", musicStagedBlobUrl=null;\n'+
    'let musicConfirmedSource={src:"blob:old",blobUrl:"blob:old",trackId:"old",time:42,wasPlaying:true};\n'+
    'let musicResumeCheckpoint=null;\n'+
    playSource+
    '\nreturn {playTrack,getState(){return {id:tracks[currentIdx].id,currentBlobUrl,musicStagedBlobUrl,playing,confirmedId:musicConfirmedSource?.trackId};}};');
  const api=factory(...Object.values(scope));
  return { ...api, audio,logs };
}
function unsupported(src) {
  if(src==='blob:bad'){
    const err=new Error('media decode error');err.name='NotSupportedError';throw err;
  }
}
test('failed switch rolls back to working old WAV, keeps its Blob and previous UI',async()=>{
  const f=environment({playDecision:unsupported});
  assert.equal(await f.playTrack('bad'),false);
  assert.equal(f.audio.src,'blob:old');
  assert.equal(f.audio.currentTime,42);
  assert.equal(f.getState().id,'old');
  assert.equal(f.getState().currentBlobUrl,'blob:old');
  assert.equal(f.getState().confirmedId,'old');
  assert.ok(f.logs.revoked.includes('blob:bad'));
  assert.ok(!f.logs.revoked.includes('blob:old'));
  assert.deepEqual(f.logs.recent,['old']);
  assert.deepEqual(f.logs.events,[]);
  assert.deepEqual(f.logs.queue,[]);
  assert.match(f.logs.toasts.join(' '),/已保留上一首/);
});
test('successful local switch commits new track then retires old Blob once',async()=>{
  const f=environment();
  assert.equal(await f.playTrack('new'),true);
  assert.equal(f.audio.src,'blob:new');
  assert.equal(f.getState().id,'new');
  assert.equal(f.getState().currentBlobUrl,'blob:new');
  assert.deepEqual(f.logs.revoked,['blob:old']);
  assert.deepEqual(f.logs.recent,['new','old']);
  assert.deepEqual(f.logs.events,['play']);
});
test('missing or unreadable new Blob never releases original playable source',async()=>{
  const f=environment({missingBlob:'new'});
  assert.equal(await f.playTrack('new'),false);
  assert.equal(f.getState().id,'old');
  assert.equal(f.audio.src,'blob:old');
  assert.deepEqual(f.logs.revoked,[]);
  assert.deepEqual(f.logs.events,[]);
});
test('missing remote source is visibly rejected; accepted remote retires old local URL',async()=>{
  const f=environment();
  assert.equal(await f.playTrack('no-url'),false);
  assert.equal(f.audio.src,'blob:old');
  assert.match(f.logs.toasts.join(' '),/没有可播放的音源/);
  assert.equal(await f.playTrack('remote'),true);
  assert.equal(f.audio.src,'https://audio.example/ok.mp3');
  assert.equal(f.getState().currentBlobUrl,null);
  assert.deepEqual(f.logs.revoked,['blob:old']);
});
test('autoplay denial restores previous track instead of claiming the new song played',async()=>{
  const f=environment({playDecision:src=>{
    if(src==='blob:new'){const err=new Error('blocked');err.name='NotAllowedError';throw err;}
  }});
  assert.equal(await f.playTrack('new'),false);
  assert.equal(f.audio.src,'blob:old');
  assert.equal(f.getState().id,'old');
  assert.ok(!f.logs.events.includes('play'));
  assert.match(f.logs.toasts.join(' '),/手机阻止了自动播放/);
});
test('a newer failed switch wins over an older pending play without stale commit',async()=>{
  let releaseOld;
  let waiting;
  const deferred=new Promise(resolve=>{releaseOld=resolve;});
  const entered=new Promise(resolve=>{waiting=resolve;});
  const f=environment({playDecision:async src=>{
    if(src==='blob:new'){waiting();await deferred;}
  },missingBlob:'bad'});
  const first=f.playTrack('new');
  await entered;
  const second=f.playTrack('bad');
  assert.equal(await second,false);
  releaseOld();
  assert.equal(await first,false);
  assert.equal(f.getState().id,'old');
  assert.equal(f.audio.src,'blob:old');
  assert.deepEqual(f.logs.events,[]);
  assert.ok(f.logs.revoked.includes('blob:new'));
  assert.ok(!f.logs.revoked.includes('blob:old'));
});
test('no failing switch emits successful playback or touches favorites/playlist context',async()=>{
  const f=environment({playDecision:unsupported});
  await f.playTrack('bad',{playlistName:'我的歌单'});
  assert.equal(f.logs.saved,0);
  assert.equal(f.logs.cover,0);
  assert.equal(f.logs.queue.length,0);
  assert.deepEqual(f.logs.recent,['old']);
  assert.equal(f.getState().id,'old');
});
test('last confirmed source is kept until successful audio play returns',()=>{
  assert.match(playSource,/const oldBlobUrl = currentBlobUrl;/);
  assert.match(playSource,/await window\.audio\.play\(\);/);
  assert.ok(playSource.indexOf('const oldBlobUrl = currentBlobUrl;')>
    playSource.indexOf('await window.audio.play();'));
});
