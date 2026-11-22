import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const music = readFileSync(new URL('../music/music.html', import.meta.url), 'utf8');
function slice(start,end){
  const a=music.indexOf(start),b=music.indexOf(end,a);
  assert.ok(a>=0 && b>a, 'missing real music source '+start);
  return music.slice(a,b);
}
const saveSource=slice('  function saveState() {','  // A phone may suspend');
const lifecycleSource=slice('  // A phone may suspend','  function loadState() {');
const eventTime=slice("  window.audio.addEventListener('timeupdate', () => {", '  // 点击"词"按钮切换歌词显示');
const eventSeek=slice("  window.audio.addEventListener('seeked', function () {",'  // 播完自动切下一首');
const eventEnded=slice("  window.audio.addEventListener('ended', async function () {",'  function updatePlayIcon() {');

function saveHarness(initialTime=41){
  const saved=new Map([['music_state', JSON.stringify({id:'old',time:initialTime})]]);
  let pending=false, audioTime=0, warning=0, calls=0;
  const localStorage={
    getItem:key=>saved.get(key)||null,
    setItem(key,value){calls++;saved.set(key,String(value));}
  };
  const window={audio:{get currentTime(){return audioTime;}}};
  const run=runInNewContext(
    'let musicResumeCheckpoint=null,musicPlaybackQueue=null,currentIdx=0,playing=true;\n'+
    'let musicPlaybackPending=false;\n'+saveSource+
    '\n({saveState,setPending(value){musicPlaybackPending=value;}})',
    {localStorage,window,tracks:[{id:'old'}],
      musicWarnOnce(){warning++;}}
  );
  return {run,saved,get writes(){return calls;},get warnings(){return warning;},
    setTime(v){audioTime=v;}};
}
test('a tentative replacement cannot overwrite the old saved progress with zero',()=>{
  const h=saveHarness(41);
  h.run.setPending(true);
  h.setTime(0);
  assert.equal(h.run.saveState(),false);
  assert.equal(h.writes,0);
  assert.equal(JSON.parse(h.saved.get('music_state')).time,41);
  assert.equal(h.warnings,0);
});
test('successful playback may persist the confirmed time after the transaction ends',()=>{
  const h=saveHarness(41);
  h.run.setPending(true);
  h.setTime(0);
  h.run.saveState();
  h.run.setPending(false);
  h.setTime(45);
  assert.equal(h.run.saveState(),true);
  assert.equal(JSON.parse(h.saved.get('music_state')).time,45);
  assert.equal(h.writes,1);
});
function eventHarness(){
  const listeners=new Map(),writes=[],published=[],navigations=[],renders=[];
  const audio={
    currentTime:0,duration:100,paused:false,ended:false,src:'blob:old',
    addEventListener(name,fn){listeners.set(name,fn);},
    async play(){this.paused=false;},
  };
  const ui=new Map();
  const document={
    getElementById(id){if(!ui.has(id))ui.set(id,{textContent:'',style:{}});return ui.get(id);},
    querySelector(){return {style:{}};},
    querySelectorAll(){return [];}
  };
  const scope={window:{audio,lastLyricLine:-1,loopState:0},document,
    tracks:[{id:'old'}],
    saveState(){writes.push(audio.currentTime);},
    musicEmitPlayback(name){published.push(name);},
    updatePlayIcon(){renders.push('play');},
    nextTrack(flag){navigations.push(flag);}};
  const run=runInNewContext(
    'let musicPlaybackPending=false,musicConfirmedSource={src:"blob:old",time:34};\n'+
    'let musicLastPersistedProgressKey="",currentIdx=0,playing=true;\n'+
    eventTime+'\n'+eventSeek+'\n'+eventEnded+
    '\n({setPending(v){musicPlaybackPending=v;},confirmedTime(){return musicConfirmedSource.time;}})',
    scope
  );
  return {run,audio,ui,writes,published,navigations,renders,
    emit:name=>{assert.ok(listeners.has(name));return listeners.get(name)();}};
}
test('timeupdate and seeked from a staged new source do not mutate old UI or checkpoint',async()=>{
  const h=eventHarness();
  h.run.setPending(true);
  h.audio.src='blob:candidate';
  h.audio.currentTime=0;
  await h.emit('timeupdate');
  await h.emit('seeked');
  assert.deepEqual(h.writes,[]);
  assert.equal(h.run.confirmedTime(),34);
  assert.equal(h.ui.size,0);
});
test('speculative ended event cannot advance the existing playlist',async()=>{
  const h=eventHarness();
  h.run.setPending(true);
  await h.emit('ended');
  assert.deepEqual(h.navigations,[]);
  assert.deepEqual(h.published,[]);
  assert.deepEqual(h.renders,[]);
  assert.deepEqual(h.writes,[]);
});
test('normal confirmed media events still update progress and seek immediately',async()=>{
  const h=eventHarness();
  h.run.setPending(false);
  h.audio.currentTime=35;
  await h.emit('timeupdate');
  assert.deepEqual(h.writes,[35]);
  assert.equal(h.run.confirmedTime(),35);
  h.audio.currentTime=36.25;
  await h.emit('seeked');
  assert.deepEqual(h.writes,[35,36.25]);
  assert.equal(h.ui.get('curTime').textContent,'0:35');
});
test('confirmed ended event still advances playlist just once',async()=>{
  const h=eventHarness();
  h.run.setPending(false);
  await h.emit('ended');
  assert.deepEqual(h.navigations,[true]);
  assert.deepEqual(h.published,['ended']);
});
test('phone hidden state and pagehide persist once each without forcing pause',()=>{
  const handlers={};let paused=false;const calls=[];
  runInNewContext(lifecycleSource,{
    document:{visibilityState:'visible',addEventListener(name,fn){handlers[name]=fn;}},
    window:{addEventListener(name,fn){handlers[name]=fn;}},
    saveState(){calls.push('save');}
  });
  handlers.visibilitychange();
  assert.deepEqual(calls,[]);
  const document={};
  // A second production-source run models the phone becoming hidden.
  const hiddenHandlers={};
  runInNewContext(lifecycleSource,{
    document:{visibilityState:'hidden',addEventListener(name,fn){hiddenHandlers[name]=fn;}},
    window:{addEventListener(name,fn){hiddenHandlers[name]=fn;}},
    saveState(){calls.push('hidden');}
  });
  hiddenHandlers.visibilitychange();
  hiddenHandlers.pagehide();
  assert.deepEqual(calls,['hidden','hidden']);
  assert.equal(paused,false);
});
test('complete production snippet includes background and pending safeguards',()=>{
  assert.match(music,/if \(musicPlaybackPending\) return false;\s*try \{\s*var oldState/);
  assert.match(music,/if \(musicPlaybackPending\) return;\s*if \(musicConfirmedSource/);
  assert.match(music,/if \(!musicPlaybackPending && Number\.isFinite\(window\.audio\.currentTime\)\) saveState\(\)/);
  assert.match(music,/if \(musicPlaybackPending\) return;\s*playing = false/);
  assert.match(lifecycleSource,/visibilitychange/);
  assert.match(lifecycleSource,/pagehide/);
});
