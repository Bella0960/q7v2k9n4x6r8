import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../settings/js/backup.js',import.meta.url),'utf8');

const target={db:'media',stores:[{store:'assets',keyPath:'id'},{store:'audio',keyPath:'id',blobFields:['blob']}]};
const saved={existed:true,version:2,stores:{assets:[{id:'a'}],audio:[{id:'a',blob:'YWJj',__blobMime_blob:'audio/mpeg'}]}};
function fixture(opts={}){
 let live=opts.live||{assets:[],audio:[]},aborts=0,commits=0,opened=0,closed=0,active=true;
 const db={version:opts.version||2,objectStoreNames:{contains:n=>Object.hasOwn(live,n)},close(){closed++;},transaction(names){
  const staged=Object.fromEntries(Object.entries(live).map(([n,rows])=>[n,rows.slice()]));
  let stopped=false,pending=0;
  const tx={objectStore(name){return {keyPath:'id',count(){
   pending++;const req={};Promise.resolve().then(()=>{
    if(stopped)return;
    req.result=staged[name].length;if(opts.change)active=false;req.onsuccess();
    if(--pending===0&&!stopped){if(opts.asyncFail){tx.abort();return;}live=staged;commits++;tx.oncomplete();}
   });return req;
  },add(row){if(opts.fail===name)throw Error('add failure');if(staged[name].some(x=>x.id===row.id))throw Error('duplicate');staged[name].push(row);}};},
  abort(){if(stopped)return;stopped=true;aborts++;tx.onabort();}};
  return tx;
 }};
 const indexedDB={open(){opened++;const req={result:db};Promise.resolve().then(()=>{
  if(opts.missing){req.transaction={abort(){req.onerror();}};req.onupgradeneeded();}
  else req.onsuccess();
 });return req;}};
 const a=source.indexOf('    function recoverEmptyMediaDatabase('),b=source.indexOf('    // Export requests',a);
 const start=source.indexOf('    function sameRecoveryPoint('),end=source.indexOf('    function recoveryScope(',start);
 const record={role:'pre-import',createdAt:1,snap:{},media:JSON.stringify({media:saved})};
 const params={indexedDB,base64ToBlob:(b,m)=>{if(b==='bad')throw Error('bad');return {bytes:b,type:m};},
  makeRecoveryArchive:r=>({media:JSON.parse(r.media)}),backupTargets:()=>[target],validateRestorePayload:()=>opts.invalid?'bad':'',
  verifyBackupAssetHashes:async()=>opts.badHash?'bad':'',confirm:()=>!opts.cancel,
  rpReadSnapshot:async()=>opts.replaced?{...record,createdAt:2}:record,RP_ROLE_PRE:'pre-import'};
 const api=new Function(...Object.keys(params),source.slice(start,end)+source.slice(a,b)+'\nreturn {recoverEmptyMediaDatabase,recoverMissingMedia};')(...Object.values(params));
 return {api,run:(snapshot=saved,t=target)=>api.recoverEmptyMediaDatabase(t,snapshot,()=>active),recover:()=>api.recoverMissingMedia(record,()=>active),live:()=>live,aborts:()=>aborts,commits:()=>commits,opened:()=>opened,closed:()=>closed};
}
test('empty stores restore together without clear or overwrite',async()=>{const f=fixture(),r=await f.run();assert.equal(r.state,'recovered');assert.equal(r.written,2);assert.equal(f.commits(),1);assert.equal(f.live().audio[0].blob.type,'audio/mpeg');});
test('any occupied store skips entire database',async()=>{const live={assets:[],audio:[{id:'new'}]},f=fixture({live});const r=await f.run();assert.equal(r.state,'occupied');assert.equal(r.written,0);assert.deepEqual(f.live(),live);assert.equal(f.commits(),0);});
test('write failure aborts all staged additions',async()=>{const f=fixture({fail:'audio'}),r=await f.run();assert.equal(r.state,'failed');assert.equal(f.commits(),0);assert.deepEqual(f.live(),{assets:[],audio:[]});});
test('async abort cannot report success',async()=>{const f=fixture({asyncFail:true}),r=await f.run();assert.equal(r.state,'failed');assert.equal(r.written,0);});
test('changed account aborts transaction',async()=>{const f=fixture({change:true}),r=await f.run();assert.equal(r.state,'changed');assert.equal(f.commits(),0);});
test('missing database is not created',async()=>{const f=fixture({missing:true}),r=await f.run();assert.equal(r.state,'missing-db');assert.equal(f.commits(),0);});
test('schema version changed skips database',async()=>{const f=fixture({version:3}),r=await f.run();assert.equal(r.state,'changed');assert.equal(f.closed(),1);});
test('asset database must include all registered stores',async()=>{const f=fixture(),r=await f.run(saved,{...target,db:'maomao-assets',stores:[...target.stores,{store:'refs',keyPath:'id'}]});assert.equal(r.state,'incomplete');assert.equal(f.opened(),0);});
test('original point reports recovered count',async()=>{const f=fixture(),r=await f.recover();assert.equal(r.state,'media-recovery-result');assert.equal(r.written,2);assert.equal(r.failed,0);});
test('invalid payload prevents opening target',async()=>{const f=fixture({invalid:true}),r=await f.recover();assert.equal(r.state,'invalid-media');assert.equal(f.opened(),0);});
test('invalid hash prevents opening target',async()=>{const f=fixture({badHash:true}),r=await f.recover();assert.equal(r.state,'invalid-media');assert.equal(f.opened(),0);});
test('cancel prevents opening target',async()=>{const f=fixture({cancel:true}),r=await f.recover();assert.equal(r.state,'cancelled');assert.equal(f.opened(),0);});
test('changed recovery point prevents opening target',async()=>{const f=fixture({replaced:true}),r=await f.recover();assert.equal(r.state,'changed');assert.equal(f.opened(),0);});
test('actual management uses shared lock for recovery',()=>{assert.ok(source.includes("action==='release'||action==='recover-media'"));assert.ok(source.includes("runRecoveryAction('recover-media')"));});
