import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext, Script } from 'node:vm';

const music = readFileSync(new URL('../music/music.html', import.meta.url), 'utf8');
function section(start, end) {
  const a = music.indexOf(start), b = music.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'missing current production code: ' + start);
  return music.slice(a, b);
}
function wavFile(name='000913', type='') {
  const wav = Buffer.alloc(44 + 8000);
  wav.write('RIFF',0); wav.writeUInt32LE(wav.length - 8,4); wav.write('WAVE',8);
  wav.write('fmt ',12); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20);
  wav.writeUInt16LE(1,22); wav.writeUInt32LE(8000,24);
  wav.writeUInt32LE(16000,28); wav.writeUInt16LE(2,32);
  wav.writeUInt16LE(16,34); wav.write('data',36);
  wav.writeUInt32LE(wav.length - 44,40);
  const file = new Blob([wav], {type});
  Object.defineProperty(file, 'name', {value:name});
  return file;
}
const resolverSource = section('  // Android/SAF/cloud-drive pickers often give audio files numeric names',
  "  document.getElementById('musicImport').addEventListener('change'");
const resolver = runInNewContext(resolverSource + '\n({musicAudioTypeFromSignature,musicResolveAudioFormat})',
  {Uint8Array});
const importSource = section("  document.getElementById('musicImport').addEventListener('change'",
  '  // ===== 断点续播');

test('SAF numeric filename with empty type is recognized by WAV signature', async () => {
  const result=await resolver.musicResolveAudioFormat(wavFile());
  assert.equal(result.ok,true);
  assert.equal(result.mimeType,'audio/wav');
  assert.equal(result.fromHeader,true);
});
test('file header wins over wrong application/octet-stream or misleading extension', async () => {
  const result=await resolver.musicResolveAudioFormat(wavFile('not-mp3.mp3','application/octet-stream'));
  assert.equal(result.mimeType,'audio/wav');
  assert.equal(result.fromHeader,true);
});
test('ID3 MP3 without extension is recognized and empty/non-audio inputs are rejected', async () => {
  const mp3=new Blob([Buffer.from([73,68,51,4,0,0,0,0,0,0,0,0])], {type:''});
  Object.defineProperty(mp3,'name',{value:'619031'});
  assert.equal((await resolver.musicResolveAudioFormat(mp3)).mimeType,'audio/mpeg');
  assert.equal((await resolver.musicResolveAudioFormat(new Blob([]))).ok,false);
  const other=new Blob([Buffer.from('unrecognized')],{type:''});
  Object.defineProperty(other,'name',{value:'not-a-song'});
  assert.equal((await resolver.musicResolveAudioFormat(other)).ok,false);
});
function importFixture({failCatalog=false, autoPlayWorks=false}={}) {
  const input={value:'selected', handler:null,
    addEventListener(event,fn){if(event==='change')this.handler=fn;}};
  const blobs=[],deleted=[],catalog=[],tracks=[],messages=[],autoplay=[];
  const saveLocalTracksMeta=list=>{
    if(failCatalog)throw new Error('QuotaExceededError');
    catalog.splice(0,catalog.length,...list);
  };
  const doc={getElementById(id){assert.equal(id,'musicImport');return input;}};
  const boot=runInNewContext(resolverSource+'\n'+importSource+
    '\n({handler:document.getElementById("musicImport").handler})',
    {Uint8Array,Blob,document:doc,
      readLocalTracksMeta:()=>catalog.slice(),saveLocalTracksMeta,
      musicMetaReadFailure:null,
      putAudioBlob:async record=>{blobs.push(record);},
      deleteAudioBlob:async id=>{deleted.push(id);},
      tracks,toast:message=>messages.push(message),
      renderAlbum(){},renderRecent(){},renderSearch(){},
      playTrack:id=>{autoplay.push(id);return Promise.resolve(autoPlayWorks);}
    });
  return {boot,input,blobs,deleted,catalog,tracks,messages,autoplay};
}
test('actual multi-file import persists normalized binary, catalog and clear user feedback', async () => {
  const f=importFixture();
  f.input.files=[wavFile('91337','application/octet-stream'),wavFile('a.wav','audio/wav')];
  await f.boot.handler({target:f.input});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.catalog.length,2);
  assert.equal(f.blobs.length,2);
  assert.ok(f.blobs.every(item=>item.mimeType==='audio/wav' && item.blob.type==='audio/wav'));
  assert.equal(f.input.value,'');
  assert.match(f.messages.join(' '),/已保存 2 首本地歌曲/);
  assert.match(f.messages.join(' '),/再次播放/);
  assert.equal(f.deleted.length,0);
  assert.equal(f.autoplay.length,1);
});
test('catalog quota failure rolls back only this new track and never reports import success', async () => {
  const f=importFixture({failCatalog:true});
  f.input.files=[wavFile()];
  await f.boot.handler({target:f.input});
  assert.equal(f.catalog.length,0);
  assert.equal(f.tracks.length,0);
  assert.equal(f.blobs.length,1);
  assert.deepEqual(f.deleted,[f.blobs[0].id]);
  assert.doesNotMatch(f.messages.join(' '),/已保存/);
});
const seekSource=section('  let musicResumeCheckpoint = null;',
  '  // ===== 渲染最近播放');
function seekFixture(request=3) {
  const listeners=new Map(),saved=[];
  const audio={readyState:0,duration:NaN,currentTime:0,
    addEventListener(event,callback){listeners.set(event,callback);},
    removeEventListener(event,callback){if(listeners.get(event)===callback)listeners.delete(event);},
    emit(event){const cb=listeners.get(event);if(cb)cb();}
  };
  const code=seekSource+
    '\n({setPending(v){musicResumeCheckpoint=v;},getPending(){return musicResumeCheckpoint;},musicApplyPendingResume,musicCancelPendingResumeListener})';
  const api=runInNewContext(code,{window:{audio},saveState:()=>saved.push(audio.currentTime),playbackRevision:request});
  return {api,audio,saved};
}
test('local restore waits for real metadata, seeks once and saves exact checkpoint',()=>{
  const f=seekFixture();
  f.api.setPending({id:'local-1',time:37.5});
  f.api.musicApplyPendingResume({id:'local-1'},3);
  assert.equal(f.audio.currentTime,0);
  assert.equal(f.saved.length,0);
  f.audio.duration=60;
  f.audio.readyState=1;
  f.audio.emit('loadedmetadata');
  assert.equal(f.audio.currentTime,37.5);
  assert.deepEqual(f.saved,[37.5]);
  assert.equal(f.api.getPending(),null);
});
test('interrupted previous-track metadata cannot seek the newly selected track',()=>{
  const f=seekFixture(5);
  f.api.setPending({id:'old',time:44});
  f.api.musicApplyPendingResume({id:'old'},4);
  f.audio.duration=50;f.audio.emit('loadedmetadata');
  assert.equal(f.audio.currentTime,0);
  assert.equal(f.saved.length,0);
  assert.equal(f.api.getPending().time,44);
});
test('saveState preserves a pending checkpoint instead of writing zero at playback start',()=>{
  const stateSource=section('  function saveState() {','  function loadState() {');
  const data=new Map();
  const tracks=[{id:'local1',name:'User WAV',source:'local'}];
  const current=runInNewContext(
    'let musicResumeCheckpoint={id:"local1",time:42};\n'+stateSource+'\n({saveState})',
    {window:{audio:{currentTime:0}},tracks,currentIdx:0,playing:true,musicPlaybackQueue:null,
      localStorage:{
        getItem:key=>data.get(key)||null,
        setItem:(key,val)=>data.set(key,String(val))
      },
      musicWarnOnce:()=>{}
    });
  assert.equal(current.saveState(),true);
  assert.equal(JSON.parse(data.get('music_state')).time,42);
});
test('loading a persisted local track arms the checkpoint without fake autoplay',()=>{
  const state=JSON.stringify({id:'local-1',time:21.5});
  const t={id:'local-1',name:'WAV',artist:'Local',source:'local'};
  const audio={src:'',currentTime:0};
  const code='let musicResumeCheckpoint=null;let musicPlaybackQueue=null;let currentIdx=0;\n'+
    section('  function loadState() {','  // ===== Now Playing 三点菜单')+
    '\n({loadState,getPending(){return musicResumeCheckpoint;}})';
  const view=runInNewContext(code,{
    localStorage:{getItem:key=>key==='music_state'?state:null},
    getTrackById:id=>id===t.id?t:null,
    tracks:[t],document:{getElementById:()=>({textContent:''})},window:{audio,MAOMAOMusicPlaylists:{getTrackIds:()=>[]}},
    renderTrackLyrics(){},updateHeartIcon(){},renderAlbum(){},musicQueuePublish(){},saveState(){}
  });
  view.loadState();
  assert.equal(view.getPending()?.id,'local-1');
  assert.equal(view.getPending()?.time,21.5);
  assert.equal(audio.src,'');
});
test('queue accepts imported song names with quotes and HTML without changing their text',()=>{
  const escapeSource=section('  function musicSafeText(value) {','  function musicReadMap(key) {');
  const queueSource=section('  function renderQueue() {','  // ===== 睡眠定时');
  const unsafe={id:"local_O'Neil",name:"O'Neil <img src=x onerror=alert(1)>",
    artist:'用户上传 & 合辑',dur:'本地',source:'local'};
  const body={innerHTML:''};
  const api=runInNewContext(escapeSource+'\n'+queueSource+'\n({renderQueue})',
    {document:{getElementById(id){assert.equal(id,'queueBody');return body;}},
      tracks:[unsafe],currentIdx:0});
  api.renderQueue();
  assert.match(body.innerHTML,/O&#39;Neil &lt;img/);
  assert.doesNotMatch(body.innerHTML,/<img src=x|onerror=alert/);
  assert.match(body.innerHTML,/用户上传 &amp; 合辑/);
  assert.ok(body.innerHTML.includes('playTrack(&quot;local_O&#39;Neil&quot;)'));
  assert.equal(unsafe.name,"O'Neil <img src=x onerror=alert(1)>");
});
test('queue uses escaped JSON string IDs rather than composing single-quoted JavaScript',()=>{
  const queueSource=section('  function renderQueue() {','  // ===== 睡眠定时');
  assert.match(queueSource,/musicSafeText\(JSON\.stringify\(t\.id\)\)/);
  assert.doesNotMatch(queueSource,/playTrack\('\\$\{t\.id\}'\)/);
});

test('full music inline script and official test are syntactically valid',()=>{
  const scripts=[...music.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(m=>m[1]).filter(s=>s.trim());
  scripts.forEach(s=>new Script(s));
  assert.ok(scripts.length>0);
});
