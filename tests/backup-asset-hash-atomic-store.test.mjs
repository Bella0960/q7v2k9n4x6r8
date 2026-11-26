import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
const source=readFileSync(new URL('../settings/js/backup.js',import.meta.url),'utf8');

const digestBytes=Uint8Array.from([186,120,22,191,143,1,207,234,65,65,64,222,93,174,34,35,176,3,97,163,150,23,122,156,180,16,255,97,242,0,21,173]);
const assetId='as_XJ4BNP4PAHH6UQKBIDPF3LRCEOYAGYND';
const payload=(blob='YWJj',id=assetId)=>({indexedDB:{'maomao-assets':{blobs:[{assetId:id,blob}]}}});
function verifier(window){
 const start=source.indexOf('    async function verifyBackupAssetHashes('),end=source.indexOf('    function captureRestoreBaseline(',start);
 assert.ok(start>=0&&end>start);
 return new Function('window',source.slice(start,end)+'\nreturn verifyBackupAssetHashes;')(window);
}
const stub={crypto:{subtle:{digest:async(algo,input)=>{
 assert.equal(algo,'SHA-256');assert.deepEqual(Array.from(input),[97,98,99]);return digestBytes.buffer;
}}},atob:s=>{if(s!=='YWJj')throw Error('decode');return 'abc';}};
test('content ID encoding matches known SHA-256 vector',async()=>assert.equal(await verifier(stub)(payload()),''));
test('mismatched fingerprint blocks restore',async()=>assert.ok(await verifier(stub)(payload('YWJj','as_'+'A'.repeat(32)))));
test('missing browser crypto fails closed',async()=>assert.ok(await verifier({atob:stub.atob})(payload())));
test('invalid asset ID blocks hash',async()=>assert.ok(await verifier(stub)(payload('YWJj','legacy-id'))));
test('decode failure blocks hash',async()=>assert.ok(await verifier(stub)(payload('!!!!'))));
test('backup without image blobs remains compatible',async()=>assert.equal(await verifier({})({}),''));
function storeFixture(initial,opts={}){
 let live=initial.slice(),aborted=0,cleared=0,committed=0;
 const db={transaction(){
   let staged=live.slice(),stopped=false,complete;
   const tx={objectStore(){return {clear(){cleared++;staged=[];},put(value,key){
     if(opts.failPut&&value.id==='fail')throw Error('put failure');
     staged.push(value);
   }};},abort(){stopped=true;aborted++;if(tx.onabort)tx.onabort();}};
   Object.defineProperty(tx,'oncomplete',{set(cb){complete=cb;Promise.resolve().then(()=>{if(!stopped){live=staged;committed++;complete();}});}});
   return tx;
 }};
 const begin=source.indexOf('    function restoreStore('),end=source.indexOf('    // 恢复一个 DB：',begin);
 assert.ok(begin>=0&&end>begin);
 const restore=new Function('base64ToBlob',source.slice(begin,end)+'\nreturn restoreStore;')((b,m)=>{if(b==='bad')throw Error('bad encoding');return {type:m,bytes:b};});
 return {db,restore,live:()=>live,aborted:()=>aborted,cleared:()=>cleared,committed:()=>committed};
}
const old={id:'old',blob:'existing'};
const def={store:'assets',keyPath:'id',blobFields:['blob']};
async function rejected(promise){let failed=false;try{await promise;}catch(_){failed=true;}assert.equal(failed,true);}
test('strict decode failure aborts entire store and keeps prior records',async()=>{
 const f=storeFixture([old]);await rejected(f.restore(f.db,def,[{id:'new',blob:'YWJj'},{id:'bad',blob:'bad'}],true,false,true));
 assert.deepEqual(f.live(),[old]);assert.equal(f.aborted(),1);assert.equal(f.committed(),0);
});
test('strict synchronous put failure aborts instead of committing clear',async()=>{
 const f=storeFixture([old],{failPut:true});await rejected(f.restore(f.db,def,[{id:'new',blob:'YWJj'},{id:'fail',blob:'YWJj'}],true,false,true));
 assert.deepEqual(f.live(),[old]);assert.equal(f.aborted(),1);
});
test('strict missing blob rejected',async()=>{
 const f=storeFixture([old]);await rejected(f.restore(f.db,def,[{id:'new'}],true,false,true));assert.deepEqual(f.live(),[old]);
});
test('strict valid store commits and does not mutate incoming encoded record',async()=>{
 const f=storeFixture([old]),row={id:'new',blob:'YWJj',__blobMime_blob:'image/png'};
 const r=await f.restore(f.db,def,[row],true,false,true);assert.equal(r.written,1);assert.equal(r.skipped,0);assert.equal(f.committed(),1);
 assert.equal(f.live()[0].blob.type,'image/png');assert.equal(row.blob,'YWJj');assert.equal(row.__blobMime_blob,'image/png');
});
test('strict scoped restore abort preserves other records',async()=>{
 const f=storeFixture([old]);await rejected(f.restore(f.db,def,[{id:'new',blob:'bad'}],false,true,true));assert.deepEqual(f.live(),[old]);assert.equal(f.cleared(),0);
});
test('out-of-line arrays retain their original shape',async()=>{
 const f=storeFixture([]);await f.restore(f.db,{store:'legacy',keyPath:null},[{__key:'k',__value:[1,2]}],true,false,true);
 assert.deepEqual(f.live(),[[1,2]]);
});
test('actual restoreDatabase requests strict store transaction',()=>assert.ok(source.includes('restoreStore(db, def, records, clearOnRestore, mergeOnly, true)')));
test('actual import performs hash check before confirmation or recovery point',()=>{
 const h=source.indexOf('var hashError = await verifyBackupAssetHashes(obj)');const c=source.indexOf('if (!confirm(promptText)) return;',h);const r=source.indexOf('await rpWriteSnapshot(current, RP_ROLE_PRE, mediaSnapshot)',c);
 assert.ok(h>=0&&c>h&&r>c);
});

test('real Web Crypto validates known content and rejects flipped bytes',async()=>{
 const window={crypto:webcrypto,atob:s=>Buffer.from(s,'base64').toString('binary')};
 const verify=verifier(window);
 assert.equal(await verify(payload()),'');
 assert.ok(await verify(payload('YWJk')));
});

function assetReferenceFixture(){
 const start=source.indexOf('    function validateRestorePayload('),end=source.indexOf('    // Match MediaRepository',start);
 const defs=[{db:'maomao-assets',stores:[{store:'assets',keyPath:'assetId'},{store:'blobs',keyPath:'assetId',blobFields:['blob']},{store:'refs',keyPath:'assetId'},{store:'image_records',keyPath:'id'}]}];
 const validate=new Function('backupTargets',source.slice(start,end)+'\nreturn validateRestorePayload;')(()=>defs);
 const obj={__backup:{schema:2},data:{chat_history_A:'[]'},indexedDB:{'maomao-assets':{assets:[{assetId}],blobs:[{assetId,blob:'YWJj'}],refs:[],image_records:[{id:'img',characterId:'A',assetId}]}}};
 return {validate,obj,media:obj.indexedDB['maomao-assets']};
}
test('valid generated image reference accepted',()=>{const f=assetReferenceFixture();assert.equal(f.validate(f.obj,''),'');});
test('generated image reference without original rejected',()=>{const f=assetReferenceFixture();f.media.image_records[0].assetId='missing';assert.ok(f.validate(f.obj,''));});
test('generated image with missing metadata rejected',()=>{const f=assetReferenceFixture();f.media.assets=[];assert.ok(f.validate(f.obj,''));});
