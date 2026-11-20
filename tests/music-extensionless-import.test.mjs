import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../music/music.html', import.meta.url), 'utf8');
const detectorStart = html.indexOf('  function musicAudioTypeFromSignature(bytes) {');
const detectorEnd = html.indexOf("  document.getElementById('musicImport').addEventListener('change'", detectorStart);
assert.ok(detectorStart >= 0 && detectorEnd > detectorStart, 'real audio detection implementation missing');
const detect = new Function(html.slice(detectorStart, detectorEnd) +
  '\nreturn musicResolveAudioFormat;')();

function selectedFile(bytes, name, type = '') {
  const blob = new Blob([Uint8Array.from(bytes)], { type });
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}
const mp3 = [73,68,51,4,0,0,0,0,0,0,0,0];
const mp3Frame = [255,251,144,100,0,0,0,0];
const wav = Array.from(Buffer.from('RIFF\x10\x00\x00\x00WAVEfmt ', 'latin1'));
const m4a = Array.from(Buffer.from('\x00\x00\x00\x20ftypM4A \x00\x00\x00\x00', 'latin1'));
const ogg = Array.from(Buffer.from('OggS\x00\x00\x00\x00', 'latin1'));
const flac = Array.from(Buffer.from('fLaC\x00\x00\x00\x00', 'latin1'));
const aac = [255,241,80,128,0,31,252,0];

test('Android numeric filenames without MIME or extension are recognized by their actual headers', async () => {
  for (const [bytes, expected] of [
    [mp3, 'audio/mpeg'], [mp3Frame, 'audio/mpeg'],
    [wav, 'audio/wav'], [m4a, 'audio/mp4'],
    [ogg, 'audio/ogg'], [flac, 'audio/flac'],
    [aac, 'audio/aac']
  ]) {
    const result = await detect(selectedFile(bytes, '1000245123', 'application/octet-stream'));
    assert.deepEqual(result, { ok:true, mimeType:expected, fromHeader:true });
  }
});

test('signature wins over incorrect Android picker MIME; unknown bytes are not silently accepted', async () => {
  assert.equal((await detect(selectedFile(mp3, 'no-extension', 'application/pdf'))).mimeType, 'audio/mpeg');
  assert.equal((await detect(selectedFile(wav, 'song.mp3', 'audio/mpeg'))).mimeType, 'audio/wav');
  assert.equal((await detect(selectedFile([1,2,3,4], '1234567', 'application/octet-stream'))).ok, false);
  assert.equal((await detect(selectedFile([], 'empty.mp3'))).reason, 'empty');
  assert.equal((await detect({size:30, name:'bad',
    slice(){return {arrayBuffer(){throw new Error('SAF permission lost')}};}})).reason, 'read');
});

function installImport(ports) {
  const listenerStart=html.indexOf("  document.getElementById('musicImport').addEventListener('change'");
  const listenerEnd=html.indexOf('  // ===== 断点续播 =====', listenerStart);
  assert.ok(listenerStart>0&&listenerEnd>listenerStart, 'actual import listener missing');
  let handler;
  const input={addEventListener(name, fn){assert.equal(name,'change'); handler=fn;}};
  const doc={getElementById(id){assert.equal(id,'musicImport');return input;}};
  new Function('document','musicResolveAudioFormat','readLocalTracksMeta','musicMetaReadFailure',
    'toast','putAudioBlob','saveLocalTracksMeta','deleteAudioBlob','tracks',
    'renderAlbum','renderRecent','renderSearch','playTrack','Blob','window',
    html.slice(listenerStart, listenerEnd)
  )(doc,ports.detect || detect,ports.readMeta,false,ports.toast,ports.putBlob,ports.saveMeta,ports.deleteBlob,
    ports.tracks,()=>{},()=>{},()=>{},ports.play,Blob,
    { alert: ports.alert || ports.toast });
  return handler;
}

test('real import handler saves a numeric-name MP3 with normalized Blob MIME and the original name', async () => {
  let storage=[],savedRecord=null, played=[],warnings=[];
  const listener=installImport({
    readMeta:()=>storage.slice(), tracks:[],
    toast:s=>warnings.push(s),
    putBlob:async r=>{savedRecord=r;},
    saveMeta:newTracks=>{storage=newTracks.slice();},
    deleteBlob:async()=>{throw new Error('should not delete imported audio');},
    play:async id=>played.push(id)
  });
  const input={files:[selectedFile(mp3,'1000245123','application/octet-stream')],value:'selected'};
  await listener({target:input});
  assert.equal(input.value,'');
  assert.equal(savedRecord.mimeType,'audio/mpeg');
  assert.equal(savedRecord.blob.type,'audio/mpeg');
  assert.equal(storage.length,1);
  assert.equal(storage[0].name,'1000245123');
  assert.equal(storage[0].source,'local');
  assert.equal(played[0],storage[0].id);
  assert.deepEqual(warnings,[]);
});

test('unsupported files and failed storage do not overwrite or delete prior tracks', async () => {
  let saved=[{id:'old',name:'Original',source:'local'}], tracks=saved.slice(),messages=[],deleted=[];
  const listener=installImport({
    readMeta:()=>saved.slice(), tracks,
    toast:message=>messages.push(message),
    putBlob:async()=>{throw Error('storage full');},
    saveMeta:meta=>{saved=meta.slice();},
    deleteBlob:async id=>deleted.push(id),
    play:async()=>{throw Error('should not play invalid file');}
  });
  await listener({target:{files:[
    selectedFile([1,2,3],'1000245123','application/octet-stream'),
    selectedFile(mp3,'another-mp3','')
  ],value:'selected'}});
  assert.deepEqual(saved,[{id:'old',name:'Original',source:'local'}]);
  assert.equal(tracks.length,1);
  assert.deepEqual(deleted,[]);
  assert.ok(messages.some(x=>x.includes('无法识别音频文件格式')));
  assert.ok(messages.some(x=>x.includes('音频未导入')));
});


test('Android SAF false-zero and missing size are recovered from actual bytes', async () => {
  for (const reportedSize of [0, undefined]) {
    const picked = {
      name: '1000245123', type: 'application/octet-stream', size: reportedSize,
      slice() { return new Blob([]); },
      async arrayBuffer() { return Uint8Array.from(mp3).buffer; }
    };
    const result = await detect(picked);
    assert.equal(result.ok, true);
    assert.equal(result.mimeType, 'audio/mpeg');
    assert.equal(result.fromHeader, true);
    assert.equal(result.sourceBlob.size, mp3.length, 'recover actual bytes, not the empty picker wrapper');
  }
});

test('temporary file read error is retried once before rejecting permission', async () => {
  let attempts = 0;
  const picked = {
    name: '1000245123', type: '', size: 0,
    async arrayBuffer() {
      if (++attempts === 1) throw new Error('SAF unavailable briefly');
      return Uint8Array.from(mp3).buffer;
    }
  };
  const result = await detect(picked);
  assert.equal(result.ok, true);
  assert.equal(result.sourceBlob.size, mp3.length);
  assert.equal(attempts, 2);
});

test('FileReader is used when the first arrayBuffer read is denied', async () => {
  let readerReads = 0;
  class SimulatedFileReader {
    readAsArrayBuffer(source) {
      readerReads++;
      Promise.resolve().then(() => {
        this.result = Uint8Array.from(source.realBytes).buffer;
        this.onload();
      });
    }
  }
  const withReader = new Function('FileReader', html.slice(detectorStart, detectorEnd) +
    '\nreturn musicResolveAudioFormat;')(SimulatedFileReader);
  const chosen = {
    name: '1000245123', type: '', size: 0, realBytes: mp3,
    async arrayBuffer() { throw new Error('Android content read permission transient'); }
  };
  const result = await withReader(chosen);
  assert.equal(result.ok, true);
  assert.equal(result.mimeType, 'audio/mpeg');
  assert.equal(result.sourceBlob.size, mp3.length);
  assert.equal(readerReads, 1);
});

test('persist repaired bytes and real size for numeric-name zero-size Android audio', async () => {
  let saved=[], record=null, played=[], messages=[];
  const listener=installImport({
    readMeta:()=>saved.slice(), tracks:[],
    toast:message=>messages.push(message),
    putBlob:async data=>{record=data;},
    saveMeta:list=>{saved=list.slice();},
    deleteBlob:async()=>{throw Error('must not delete any prior audio');},
    play:async id=>played.push(id)
  });
  const picker={files:[{
    name:'1000245123', type:'application/octet-stream', size:0,
    slice(){return new Blob([]);},
    async arrayBuffer(){return Uint8Array.from(mp3).buffer;}
  }],value:'selected'};
  await listener({target:picker});
  assert.equal(picker.value,'');
  assert.equal(record?.size,mp3.length);
  assert.equal(record?.blob?.size,mp3.length);
  assert.equal(record?.mimeType,'audio/mpeg');
  assert.equal(record?.blob?.type,'audio/mpeg');
  assert.deepEqual(Array.from(new Uint8Array(await record.blob.arrayBuffer())),mp3);
  assert.equal(saved.length,1);
  assert.equal(saved[0].name,'1000245123');
  assert.equal(played[0],saved[0].id);
  assert.deepEqual(messages,[]);
});

test('genuine empty file and unreadable file have distinct errors and do not overwrite old tracks', async () => {
  const empty = {name:'1000245123',size:0,type:'',
    async arrayBuffer(){return new ArrayBuffer(0);}};
  let deniedCount = 0;
  const denied = {name:'1000245123',size:0,type:'',
    async arrayBuffer(){deniedCount++; throw new Error('permission denied');}};
  assert.equal((await detect(empty)).reason,'empty');
  assert.equal((await detect(denied)).reason,'read');
  assert.equal(deniedCount,2);
  const old = {id:'local_previous',source:'local',name:'Existing song'};
  let stored=[old], trackList=[old], notices=[], putCalls=0;
  const listener=installImport({
    readMeta:()=>stored.slice(), tracks:trackList,
    toast:s=>notices.push(s),
    putBlob:async()=>{putCalls++;},
    saveMeta:meta=>{stored=meta.slice();},
    deleteBlob:async()=>{throw Error('must not touch saved music');},
    play:async()=>{throw Error('must not attempt playback');}
  });
  await listener({target:{files:[empty,denied],value:'selected'}});
  assert.equal(putCalls,0);
  assert.deepEqual(stored,[old]);
  assert.deepEqual(trackList,[old]);
  assert.ok(notices.some(s=>s.includes('音频内容为空')));
  assert.ok(notices.some(s=>s.includes('可能受手机系统保护')));
});

test('positive-size picker with unreadable slice recovers original bytes, never saves the empty slice', async () => {
  let savedRecord=null, catalog=[], warnings=[];
  const listener=installImport({
    readMeta:()=>catalog.slice(), tracks:[],
    toast:s=>warnings.push(s), putBlob:async r=>{savedRecord=r;},
    saveMeta:items=>{catalog=items.slice();},
    deleteBlob:async()=>{throw Error('must not delete previous music');},
    play:async()=>{}
  });
  const file={
    name:'1000245123',type:'',size:mp3.length,
    slice(){return new Blob([]);},
    async arrayBuffer(){return Uint8Array.from(mp3).buffer;}
  };
  await listener({target:{files:[file],value:'selected'}});
  assert.equal(savedRecord?.size,mp3.length);
  assert.deepEqual(Array.from(new Uint8Array(await savedRecord.blob.arrayBuffer())),mp3);
  assert.equal(catalog.length,1);
  assert.deepEqual(warnings,[]);
});


test('protected Android file prompts once and continues to next readable MP3 in same selection', async () => {
  const notices = [], saved = [], played = [], records = [];
  const original = { id:'local_prior', source:'local', name:'之前的歌曲' };
  let meta = [original];
  const listener = installImport({
    tracks: [original],
    readMeta: () => meta.slice(),
    saveMeta: next => { meta = next.slice(); },
    putBlob: async data => { records.push(data); },
    deleteBlob: async () => { throw Error('Never delete existing files'); },
    play: async id => { played.push(id); },
    toast: message => { notices.push('toast:' + message); },
    alert: message => { notices.push('alert:' + message); }
  });
  const denied = {
    name: '1000133976', size: 0, type: '',
    async arrayBuffer() { throw Error('NotReadableError: Permission denied'); }
  };
  const picker = {
    value:'selected',
    files:[denied, denied, selectedFile(mp3,'downloaded.mp3','audio/mpeg')]
  };
  await listener({target:picker});
  assert.equal(picker.value,'', 'picker must be reset for a future selection');
  assert.equal(notices.length, 1, 'one friendly prompt for the blocked files');
  assert.match(notices[0], /^alert:当前音频文件可能受手机系统保护/);
  assert.match(notices[0], /下载/);
  assert.doesNotMatch(notices[0], /NotReadableError|1000133976|Permission denied/);
  assert.equal(records.length, 1, 'the following accessible file must import');
  assert.equal(meta.length, 2);
  assert.equal(meta[0].id, original.id, 'existing music cannot be discarded');
  assert.equal(meta[1].name, 'downloaded');
  assert.equal(played.length, 1);
});

test('unexpected picker read rejection is handled and does not block another selection', async () => {
  const notices = [], played = [];
  let meta = [];
  const listener = installImport({
    readMeta: () => meta.slice(), tracks:[],
    saveMeta: next => { meta = next.slice(); },
    putBlob: async () => {},
    deleteBlob: async () => {},
    play: async id => { played.push(id); },
    toast: message => { notices.push(message); },
    alert: message => { notices.push(message); },
    detect: async file => {
      if (file.name === 'unavailable') throw Error('Android file provider internal exception');
      return detect(file);
    }
  });
  await listener({target:{files:[{ name:'unavailable' }],value:'selected'}});
  assert.equal(meta.length,0);
  assert.equal(notices.length,1);
  await listener({target:{files:[selectedFile(mp3,'second.mp3','audio/mpeg')],value:'selected'}});
  assert.equal(meta.length,1);
  assert.equal(meta[0].name,'second');
  assert.equal(played.length,1);
});

test('a file provider that never resolves eventually exits the read state', async () => {
  const api = new Function(html.slice(detectorStart, detectorEnd) +
    '\nreturn musicReadAudioBytes;')();
  const stuck = {
    async arrayBuffer() { return new Promise(() => {}); }
  };
  const started = Date.now();
  const result = await api(stuck, 20);
  assert.equal(result.ok,false);
  assert.equal(result.reason,'read');
  assert.ok(Date.now() - started < 1500, 'bounded retries must not hang');
});
