import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../settings/js/backup.js',import.meta.url),'utf8');

function makeFixture(initial,opts={}){
 let live=JSON.parse(JSON.stringify(initial)),aborts=0,commits=0,closed=0,opened=0,transactions=0,queued=0;
 const db={close(){closed++;},transaction(input){
   transactions++;const names=Array.isArray(input)?input:[input];
   const staged=JSON.parse(JSON.stringify(live));let stopped=false,complete;
   const tx={objectStore(name){
    if(stopped||!names.includes(name))throw Error('inactive or wrong store');
    return {clear(){if(opts.clearFail===name)throw Error('clear failed');staged[name]=[];},put(value,key){
      if(stopped)throw Error('aborted');
      if(opts.failStore===name)throw Error('put failed');
      queued++;staged[name].push(value);
    }};
   },abort(){if(stopped)return;stopped=true;aborts++;if(tx.onabort)tx.onabort();}};
   Object.defineProperty(tx,'oncomplete',{set(cb){complete=cb;Promise.resolve().then(()=>Promise.resolve()).then(()=>{
    if(stopped)return;
    if(opts.asyncFail){tx.abort();return;}
    live=staged;commits++;complete();
   });}});
   return tx;
 }};
 const defs=[{store:'assets',keyPath:'assetId'},{store:'blobs',keyPath:'assetId',blobFields:['blob']},{store:'refs',keyPath:'assetId'}];
 const start=source.indexOf('    function restoreStore('),end=source.indexOf('    // 导入兜底',start);
 assert.ok(start>=0&&end>start);
 const restore=new Function('idbOpen','backupTargets','base64ToBlob',source.slice(start,end)+'\nreturn restoreDatabase;')(
  async()=>{opened++;return db;},()=>[{db:'maomao-assets',clearOnRestore:true}],(b,m)=>{if(b==='bad')throw Error('bad encoding');return {type:m,bytes:b};});
 return {restore:(incoming,merge=false)=>restore('maomao-assets',2,defs,incoming,merge),live:()=>live,aborts:()=>aborts,commits:()=>commits,closed:()=>closed,opened:()=>opened,transactions:()=>transactions,queued:()=>queued};
}
const old={assets:[{assetId:'old'}],blobs:[{assetId:'old',blob:'old'}],refs:[{assetId:'old'}]};
const next={assets:[{assetId:'new'}],blobs:[{assetId:'new',blob:'YWJj'}],refs:[{assetId:'new'}]};
async function rejects(p){let failed=false;try{await p;}catch(_){failed=true;}assert.equal(failed,true);}
test('related stores commit together in one transaction',async()=>{const f=makeFixture(old);const r=await f.restore(next);assert.equal(r.written,3);assert.equal(f.transactions(),1);assert.equal(f.commits(),1);assert.equal(f.closed(),1);assert.equal(f.live().assets[0].assetId,'new');assert.equal(f.live().blobs[0].blob.bytes,'YWJj');});
test('later store decode failure restores prior stores',async()=>{const f=makeFixture(old);await rejects(f.restore({...next,blobs:[{assetId:'new',blob:'bad'}]}));assert.deepEqual(f.live(),old);assert.equal(f.aborts(),1);assert.equal(f.commits(),0);});
test('later store put failure rolls back entire database',async()=>{const f=makeFixture(old,{failStore:'refs'});await rejects(f.restore(next));assert.deepEqual(f.live(),old);assert.equal(f.commits(),0);});
test('later clear failure rolls back earlier writes',async()=>{const f=makeFixture(old,{clearFail:'refs'});await rejects(f.restore(next));assert.deepEqual(f.live(),old);assert.equal(f.commits(),0);});
test('asynchronous transaction abort is not success',async()=>{const f=makeFixture(old,{asyncFail:true});await rejects(f.restore(next));assert.deepEqual(f.live(),old);assert.equal(f.commits(),0);});
test('scoped import failure leaves all old stores untouched',async()=>{const f=makeFixture(old,{failStore:'refs'});await rejects(f.restore(next,true));assert.deepEqual(f.live(),old);});
test('empty included stores clear together',async()=>{const f=makeFixture(old);const r=await f.restore({assets:[],blobs:[],refs:[]});assert.equal(r.written,0);assert.deepEqual(f.live(),{assets:[],blobs:[],refs:[]});assert.equal(f.transactions(),1);});
test('empty scoped stores do not open database',async()=>{const f=makeFixture(old);await f.restore({assets:[],blobs:[]},true);assert.equal(f.opened(),0);assert.deepEqual(f.live(),old);});
test('unknown store blocked before opening database',async()=>{const f=makeFixture(old);await rejects(f.restore({...next,unknown:[]}));assert.equal(f.opened(),0);});
test('wrong store shape blocked before opening database',async()=>{const f=makeFixture(old);await rejects(f.restore({assets:{}}));assert.equal(f.opened(),0);});
const unique=new Function(source.slice(source.indexOf('    function validateUniqueBackupKeys('),source.indexOf('    function handleImportFile('))+'\nreturn validateUniqueBackupKeys;')();
function scan(raw){JSON.parse(raw);return unique(raw);}
test('normal JSON with escaped punctuation in strings passes',()=>assert.equal(scan('{"data":{"note":"{\\"a\\":1,\\"a\\":2}"},"list":[{"x":1},{"x":2}]}'),''));
test('duplicate envelope property rejected',()=>assert.ok(scan('{"data":{},"data":{}}')));
test('duplicate nested media field rejected',()=>assert.ok(scan('{"indexedDB":{"assets":[{"id":"a","id":"b"}]}}')));
test('unicode escaped key aliases detected',()=>assert.ok(scan('{"data":{"a":"one","\\u0061":"two"}}')));
test('same key across different objects is valid',()=>assert.equal(scan('{"a":{"x":1},"b":{"x":2}}'),''));
test('overdeep envelope rejected',()=>assert.ok(scan('['.repeat(130)+'0'+']'.repeat(130))));
test('actual import checks duplicate keys before backup validator',()=>{const start=source.indexOf('    function handleImportFile(');assert.ok(source.indexOf('validateUniqueBackupKeys(rawText)',start)<source.indexOf('validateBackup(obj)',start));});
