import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL(process.env.MAO_ARCHIVE_ENGINE||'../shared/js/phone/storage/indexeddb-archive-lab.js',import.meta.url),'utf8');
const fake={};new Function('window',source)(fake);const api=fake.MaoArchiveLab;
const scope={accountId:'account-a',kind:'role',conversationId:'same',generation:'generation-1',domain:'messages'};
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code);
test('scope immutable, copied, explicit account and generation',()=>{const input={...scope};const bound=api.normalizeScope(input);input.accountId='account-b';assert.equal(bound.accountId,'account-a');assert.ok(Object.isFrozen(bound));assert.deepEqual(bound,scope)});
test('missing, blank or ambiguous scope fails closed',()=>{for(const [key,v] of [['accountId',''],['conversationId',null],['generation',' ']])rejects(()=>api.normalizeScope({...scope,[key]:v}),'INVALID_ID');rejects(()=>api.normalizeScope({...scope,kind:'npc'}),'INVALID_SCOPE');rejects(()=>api.normalizeScope({...scope,domain:'diary'}),'INVALID_SCOPE')});
test('production names and missing explicit factory or authorizer refused before open',()=>{let opened=0;const fakeIDB={open(){opened++}};const valid={name:'maomao-storage-lab-test',indexedDB:fakeIDB,keyRange:{},authorize:()=>true};for(const patch of [{name:'maomao-core'},{authorize:null},{keyRange:null},{indexedDB:null}])rejects(()=>api.open({...valid,...patch}),'LAB_OPTIONS_REQUIRED');assert.equal(opened,0)});
test('rich message extension fields remain exactly JSON-compatible',()=>{const payload={mid:'m',role:'assistant',mode:'date',scene:{i:1},memberId:'x',assetId:'a',text:'中文',card:{foo:[false,null,1]}};const batch=api.prepareBatch([{id:'stable',payload}]);assert.deepEqual(JSON.parse(batch[0].encoded),payload);assert.equal(batch[0].id,'stable')});
test('payload is captured before asynchronous writing',()=>{const payload={nested:{text:'original'}};const batch=api.prepareBatch([{id:'stable',payload}]);payload.nested.text='changed';assert.equal(JSON.parse(batch[0].encoded).nested.text,'original')});
test('duplicate input ID rejected rather than silently deduped',()=>rejects(()=>api.prepareBatch([{id:'x',payload:{}},{id:'x',payload:{}}]),'DUPLICATE_BATCH_ID'));
test('missing, invalid and oversized batch rejected',()=>{for(const batch of [[],null,Array.from({length:201},(_,i)=>({id:String(i),payload:{}}))])rejects(()=>api.prepareBatch(batch),'INVALID_BATCH');rejects(()=>api.prepareBatch([{id:'',payload:{}}]),'INVALID_ID')});
test('non-JSON payloads cannot be silently dropped or rewritten',()=>{const cyclic={};cyclic.self=cyclic;for(const value of [undefined,NaN,Infinity,1n,()=>{},new Date(),new Map(),new Set(),new Uint8Array(3),cyclic])rejects(()=>api.prepareBatch([{id:'x',payload:{value}}]),'INVALID_PAYLOAD')});
test('invalid top-level record rejected',()=>{for(const value of [null,[],1,'text'])rejects(()=>api.prepareBatch([{id:'x',payload:value}]),'INVALID_PAYLOAD')});
test('single record size guard is explicit',()=>rejects(()=>api.prepareBatch([{id:'x',payload:{text:'a'.repeat(4*1024*1024)}}]),'PAYLOAD_TOO_LARGE'));
test('aggregate batch size guard does not truncate',()=>rejects(()=>api.prepareBatch([{id:'x',payload:{text:'a'.repeat(2200000)}},{id:'y',payload:{text:'b'.repeat(2200000)}}]),'BATCH_TOO_LARGE'));
test('loading script is inert: no IndexedDB opened, registry frozen',()=>{assert.deepEqual(api.stores,['records','partitions']);assert.equal(api.version,1);assert.ok(Object.isFrozen(api));assert.ok(Object.isFrozen(api.stores))});

test('hidden fields, accessors, sparse arrays, extra array fields, negative zero and deep nesting cannot be lost',()=>{
 const hidden={x:1};Object.defineProperty(hidden,'secret',{value:2});
 let calls=0;const getter={};Object.defineProperty(getter,'x',{enumerable:true,get(){calls++;return 2}});
 const arr=[1];arr.extra=2;const deep={};let tail=deep;for(let i=0;i<130;i++){tail.x={};tail=tail.x}
 for(const payload of [hidden,getter,{arr},{arr:Array(2)},{n:-0},deep])rejects(()=>api.prepareBatch([{id:'x',payload}]),'INVALID_PAYLOAD');
 assert.equal(calls,0);rejects(()=>api.prepareBatch(Array(2)),'INVALID_PAYLOAD');
 const shared={i:1};assert.deepEqual(JSON.parse(api.prepareBatch([{id:'x',payload:{a:shared,b:shared}}])[0].encoded),{a:{i:1},b:{i:1}});
});
const inspection={};
new Function('window',source.replace('open,normalizeScope,prepareBatch,version:VERSION','open,normalizeScope,prepareBatch,validatePartition,decodeRow,version:VERSION'))(inspection);
const {validatePartition,decodeRow}=inspection.MaoArchiveLab;
test('corrupt active partition metadata rejected',()=>{
 const p='scope',good={partition:p,count:10,revision:2};
 assert.equal(validatePartition(good,p,'active-lab'),good);
 for(const count of [-1,1.1,NaN,Infinity,Number.MAX_SAFE_INTEGER,'3'])rejects(()=>validatePartition({...good,count},p,'active-lab'),'CORRUPT_PARTITION');
 for(const patch of [{partition:'foreign'},{revision:11}])rejects(()=>validatePartition({...good,...patch},p,'active-lab'),'CORRUPT_PARTITION');
});
test('invalid shadow counts, verification markers and source hashes rejected',()=>{
 const p='scope',good={partition:p,count:10,total:10,verifiedCount:10,status:'verified-shadow',sourceHash:'a'.repeat(64)};
 assert.equal(validatePartition(good,p,'shadow'),good);
 for(const patch of [{total:9},{verifiedCount:9},{status:'unknown'},{sourceHash:'bad'},{count:11}])rejects(()=>validatePartition({...good,...patch},p,'shadow'),'CORRUPT_PARTITION');
});
test('corrupt rows and foreign partition data cannot be decoded',()=>{
 const p='scope',row={partition:p,sequence:1,id:'m1',encoded:'{"role":"sent","text":"test"}'};
 assert.equal(decodeRow(row,p,10).payload.text,'test');
 for(const patch of [{partition:'wrong'},{sequence:11},{id:''},{encoded:'null'},{encoded:'{"x":1e400}'},{encoded:'{'}])rejects(()=>decodeRow({...row,...patch},p,10),'CORRUPT_RECORD');
});

const transactionInspection={};
new Function('window',source.replace('open,normalizeScope,prepareBatch,version:VERSION','open,normalizeScope,prepareBatch,beginTransaction,acknowledgeFailure,version:VERSION'))(transactionInspection);
const {beginTransaction,acknowledgeFailure}=transactionInspection.MaoArchiveLab;
test('strict durability requested; only unsupported options TypeError permits fallback',()=>{
 const calls=[];
 const db={transaction(...args){calls.push(args);if(args.length===3)throw new TypeError('unsupported');return 'tx'}};
 assert.equal(beginTransaction(db,'readwrite'),'tx');
 assert.equal(calls[0][2].durability,'strict');assert.equal(calls.length,2);assert.equal(calls[1].length,2);
 const err=new Error('QuotaExceededError');let n=0;
 assert.throws(()=>beginTransaction({transaction(){n++;throw err}},'readwrite'),e=>e===err);assert.equal(n,1);
 beginTransaction(db,'readonly');assert.equal(calls[2].length,2);
});
test('committed but withheld acknowledgement is not reported as rollback',()=>{
 const err=new Error('SCOPE_DENIED');
 assert.equal(acknowledgeFailure('readwrite',false,err),err);
 const result=acknowledgeFailure('readwrite',true,err);
 assert.equal(result.code,'COMMITTED_ACK_WITHHELD');assert.equal(result.committed,true);
 assert.equal(acknowledgeFailure('readonly',true,err),err);
});
