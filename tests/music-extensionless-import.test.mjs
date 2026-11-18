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
    'renderAlbum','renderRecent','renderSearch','playTrack','Blob',
    html.slice(listenerStart, listenerEnd)
  )(doc,detect,ports.readMeta,false,ports.toast,ports.putBlob,ports.saveMeta,ports.deleteBlob,
    ports.tracks,()=>{},()=>{},()=>{},ports.play,Blob);
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
