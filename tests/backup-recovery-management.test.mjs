import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../settings/js/backup.js',import.meta.url),'utf8');

const point={role:'pre-import',createdAt:1700000000000,snap:{chat_history_A:'[]',api_settings:'private',auth_token:'private',__mao_account_v1__other__key:'private'},media:JSON.stringify({media:{existed:true,version:2,stores:{audio:[{id:'a',blob:'YWJj'}]}}})};
function fixture(opts={}){
 let current=JSON.parse(JSON.stringify(point)),downloads=[],deletes=0,confirmations=0,busy=false,aborts=0;
 const account={ready:true,accountId:'fixture'};
 const window={__MAO_ACCOUNT_SCOPE__:account,navigator:opts.noLocks?{}:{locks:{async request(name,config,callback){
  assert.equal(name,'maomao-restore-v1:fixture');assert.equal(config.ifAvailable,true);
  if(busy||opts.lockBusy)return callback(null);
  busy=true;try{return await callback({name});}finally{busy=false;}
 }}}};
 const document={querySelector:()=>({content:'fixture'})};
 const db={close(){},transaction(){
  let staged=current,stopped=false;const tx={objectStore(){return {
   get(){const req={};Promise.resolve().then(()=>{req.result=opts.race?{...staged,createdAt:1}:staged;req.onsuccess();if(!stopped){current=staged;tx.oncomplete();}});return req;},
   delete(){deletes++;staged=null;}
  };},abort(){stopped=true;aborts++;tx.onabort();}};
  return tx;
 }};
 const start=source.indexOf('    function sameRecoveryPoint('),end=source.indexOf('    function handleImportFile(',start);
 assert.ok(start>=0&&end>start);
 let code=source.slice(start,end);
 // Stub only the browser download bridge, retaining actual archive/lock/CAS logic.
 const d=code.indexOf('    function downloadRecoveryArchive('),e=code.indexOf('    function deleteExactRecoveryPoint(',d);
 code=code.slice(0,d)+code.slice(e);
 const params={window,document,RP_ROLE_PRE:'pre-import',BACKUP_APP:'phone-app',RP_STORE_NAME:'restores',
  SECRET_KEYS:['api_settings'],neverBackupKey:k=>k==='auth_token',backupTargets:()=>[{db:'media',stores:[{store:'audio'}]}],
  rpReadSnapshot:async()=>current,rpOpen:async()=>db,
  confirm:()=>{confirmations++;if(opts.switchAccount)window.__MAO_ACCOUNT_SCOPE__={...account,accountId:'other'};return !opts.cancel;},
  downloadRecoveryArchive:a=>downloads.push(a)
 };
 const api=new Function(...Object.keys(params),code+'\nreturn {manageRecoveryPoint,makeRecoveryArchive,withRecoveryLock};')(...Object.values(params));
 return {api,window,downloads,deletes:()=>deletes,aborts:()=>aborts,confirmations:()=>confirmations,replace:x=>{current=x;},current:()=>current,verified:()=>({account:window.__MAO_ACCOUNT_SCOPE__,text:JSON.stringify(downloads[0])})};
}
async function rejects(p){let failed=false;try{await p;}catch(_){failed=true;}assert.equal(failed,true);}
test('recovery view exposes counts not private payload',async()=>{const f=fixture(),r=await f.api.manageRecoveryPoint('view');assert.equal(r.state,'available');assert.equal(r.counts.local,1);assert.equal(r.counts.media,1);assert.equal(r.record,undefined);assert.equal(f.deletes(),0);});
test('export excludes known secrets and uses non-importable archive envelope',async()=>{const f=fixture(),r=await f.api.manageRecoveryPoint('export');assert.equal(r.state,'export-requested');const a=f.downloads[0];assert.equal(a.__backup,undefined);assert.equal(a.__recovery.automaticRestore,false);assert.equal(a.__recovery.knownCredentialKeysOmitted,3);assert.deepEqual(Object.keys(a.data),['chat_history_A']);assert.equal(a.media.media.stores.audio[0].blob,'YWJj');assert.equal(f.deletes(),0);});
test('legacy recovery point can be archived without claiming media coverage',()=>{const f=fixture(),r=f.api.makeRecoveryArchive({...point,media:undefined});assert.equal(r.__recovery.mediaCaptured,false);assert.equal(r.media,null);});
test('malformed recovery media is rejected',()=>{const f=fixture();let failed=false;try{f.api.makeRecoveryArchive({...point,media:'{"unknown":{"existed":false,"stores":{}}}'});}catch(_){failed=true;}assert.equal(failed,true);});
test('release without export never deletes',async()=>{const f=fixture(),r=await f.api.manageRecoveryPoint('release');assert.equal(r.state,'export-required');assert.equal(f.deletes(),0);});
test('confirmed release deletes only exact reselected recovery archive',async()=>{const f=fixture();await f.api.manageRecoveryPoint('export');assert.equal((await f.api.manageRecoveryPoint('release',f.verified())).state,'released');assert.equal(f.deletes(),1);assert.equal(f.current(),null);});
test('changed recovery point cannot be released using old archive',async()=>{const f=fixture();await f.api.manageRecoveryPoint('export');f.replace({...point,createdAt:2});assert.equal((await f.api.manageRecoveryPoint('release',f.verified())).state,'archive-mismatch');assert.equal(f.deletes(),0);});
test('transaction rechecks exact point before delete',async()=>{const f=fixture({race:true});await f.api.manageRecoveryPoint('export');assert.equal((await f.api.manageRecoveryPoint('release',f.verified())).state,'changed');assert.equal(f.deletes(),0);assert.equal(f.aborts(),1);});
test('release without shared lock fails closed',async()=>{const f=fixture({noLocks:true});await f.api.manageRecoveryPoint('export');await rejects(f.api.manageRecoveryPoint('release',f.verified()));assert.equal(f.deletes(),0);});
test('active shared lock blocks archive management',async()=>{const f=fixture({lockBusy:true});await rejects(f.api.manageRecoveryPoint('release'));assert.equal(f.deletes(),0);});
test('cancelled export keeps point intact',async()=>{const f=fixture({cancel:true});assert.equal((await f.api.manageRecoveryPoint('export')).state,'cancelled');assert.equal(f.downloads.length,0);assert.equal(f.deletes(),0);});
test('account switch during confirm blocks export',async()=>{const f=fixture({switchAccount:true});await rejects(f.api.manageRecoveryPoint('export'));assert.equal(f.downloads.length,0);});
test('ordinary import rejects recovery archive before normal validation',()=>{const a=source.indexOf('    function handleImportFile(');assert.ok(source.indexOf('obj && obj.__recovery',a)<source.indexOf('var err = validateBackup(obj)',a));});

test('download request alone never authorizes release',async()=>{const f=fixture(),r=await f.api.manageRecoveryPoint('export');assert.equal((await f.api.manageRecoveryPoint('release',r)).state,'export-required');assert.equal(f.deletes(),0);});
test('modified archive bytes block release before confirmation',async()=>{const f=fixture();await f.api.manageRecoveryPoint('export');const r=await f.api.manageRecoveryPoint('release',{...f.verified(),text:f.verified().text+' '});assert.equal(r.state,'archive-mismatch');assert.equal(f.confirmations(),1);assert.equal(f.deletes(),0);});
test('saved archive can be reselected after page reload',async()=>{const f=fixture();await f.api.manageRecoveryPoint('export');const reopened=fixture();assert.equal((await reopened.api.manageRecoveryPoint('release',{account:reopened.window.__MAO_ACCOUNT_SCOPE__,text:f.verified().text})).state,'released');});
test('release confirmation cancellation preserves recovery point',async()=>{const f=fixture({cancel:true}),r=await f.api.manageRecoveryPoint('release',{account:f.window.__MAO_ACCOUNT_SCOPE__,text:JSON.stringify(f.api.makeRecoveryArchive(point))});assert.equal(r.state,'cancelled');assert.equal(f.deletes(),0);});
test('selected archive account changes are rejected',async()=>{const f=fixture();await f.api.manageRecoveryPoint('export');assert.equal((await f.api.manageRecoveryPoint('release',{...f.verified(),account:{ready:true,accountId:'other'}})).state,'export-required');assert.equal(f.deletes(),0);});
test('settings binds release to reselecting local archive',()=>{assert.ok(source.includes("recoveryFile.addEventListener('change'"));assert.ok(source.includes('var content=await file.text()'));assert.ok(source.includes('verified.text !== JSON.stringify(makeRecoveryArchive(rec))'));});
