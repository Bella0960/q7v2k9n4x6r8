import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../settings/js/backup.js',import.meta.url),'utf8');

function fixture(opts={}){
 const data=opts.data||{assets:[{key:'a',value:{assetId:'a',meta:{name:'photo'}}}],blobs:[{key:'a',value:{assetId:'a',blob:new FakeBlob('abc','image/png')}}],refs:[]};
 let reads=0,closed=0,opened=0,aborted=0,active=true;
 const names=Object.keys(data);
 const db={version:2,objectStoreNames:{contains:n=>names.includes(n)},close(){closed++;},transaction(stores,mode){
  assert.equal(mode,'readonly');let stopped=false,remaining=stores.length;
  const tx={objectStore(name){return {openCursor(){
   reads++;const req={};let i=0;
   function next(){Promise.resolve().then(()=>{
    if(stopped)return;
    const row=data[name][i++];req.result=row?{primaryKey:row.key,value:row.value,continue:next}:null;
    req.onsuccess();
    if(!row&&!stopped&&--remaining===0)tx.oncomplete();
   });}
   next();return req;
  }};},abort(){if(stopped)return;stopped=true;aborted++;tx.onabort();}};
  return tx;
 }};
 const indexedDB={open(name){opened++;const req={result:db};Promise.resolve().then(()=>{
  if(opts.absent){req.transaction={abort(){req.onerror();}};req.onupgradeneeded({oldVersion:0});}
  else req.onsuccess();
 });return req;}};
 const start=source.indexOf('    async function captureMediaRestorePoint('),end=source.indexOf('    function validateRestorePayload(',start);
 assert.ok(start>=0&&end>start);
 const run=new Function('indexedDB','backupTargets','Blob','blobToBase64',source.slice(start,end)+'\nreturn captureMediaRestorePoint;')(
  indexedDB,()=>[{db:'media',clearOnRestore:true,stores:[{store:'assets',keyPath:'assetId'},{store:'blobs',keyPath:'assetId',blobFields:['blob']},{store:'refs',keyPath:'assetId'}]}],FakeBlob,
  async b=>{if(opts.stale)active=false;return opts.badEncoding?'x':'YWJj';});
 return {run:(payload={assets:[{}],blobs:[{}],refs:[]},scope='')=>run({indexedDB:{media:payload}},scope,()=>active),data,reads:()=>reads,closed:()=>closed,opened:()=>opened,aborted:()=>aborted};
}
class FakeBlob{constructor(raw,type){this.raw=raw;this.size=raw.length;this.type=type;}}
async function rejects(p){let failed=false;try{await p}catch(_){failed=true}assert.equal(failed,true);}
test('snapshot includes selected original metadata, blobs and empty store',async()=>{const f=fixture(),r=JSON.parse(await f.run());assert.equal(r.media.existed,true);assert.equal(r.media.stores.blobs[0].blob,'YWJj');assert.equal(r.media.stores.blobs[0].__blobMime_blob,'image/png');assert.deepEqual(r.media.stores.refs,[]);assert.equal(f.reads(),3);assert.equal(f.closed(),1);assert.ok(f.data.blobs[0].value.blob instanceof FakeBlob);});
test('missing database recorded without creating it',async()=>{const f=fixture({absent:true}),r=JSON.parse(await f.run());assert.equal(r.media.existed,false);assert.equal(f.reads(),0);});
test('scoped import excludes empty store and unselected table',async()=>{const f=fixture(),r=JSON.parse(await f.run({assets:[{}],refs:[]},'music'));assert.deepEqual(Object.keys(r.media.stores),['assets']);assert.equal(f.reads(),1);});
test('missing selected store aborts snapshot',async()=>{const f=fixture({data:{assets:[]}});await rejects(f.run());assert.equal(f.closed(),1);});
test('missing original media blocks snapshot',async()=>{const f=fixture({data:{assets:[],blobs:[{key:'a',value:{assetId:'a'}}],refs:[]}});await rejects(f.run());assert.equal(f.aborted(),1);});
test('unsupported native value blocks rather than silently serializes',async()=>{const f=fixture({data:{assets:[{key:'a',value:{assetId:'a',map:new Map()}}],blobs:[],refs:[]}});await rejects(f.run());assert.equal(f.aborted(),1);});
test('primary key mismatch rejected',async()=>{const f=fixture({data:{assets:[{key:'a',value:{assetId:'b'}}],blobs:[],refs:[]}});await rejects(f.run());});
test('scope change during encoding blocks snapshot',async()=>{const f=fixture({stale:true});await rejects(f.run());});
test('incomplete base64 encoding blocks snapshot',async()=>{const f=fixture({badEncoding:true});await rejects(f.run());});
test('oversize native blob rejected before encoding',async()=>{const b=new FakeBlob('abc','');b.size=60*1024*1024;const f=fixture({data:{assets:[],blobs:[{key:'a',value:{assetId:'a',blob:b}}],refs:[]}});await rejects(f.run());assert.equal(f.aborted(),1);});
test('restore point writer uses atomic add not overwrite',()=>{const a=source.indexOf('    function rpWriteSnapshot('),b=source.indexOf('    function rpReadSnapshot(',a);assert.ok(source.slice(a,b).includes('.add({ role: role, snap: snap, media: media'));assert.ok(!source.slice(a,b).includes('.put('));});
