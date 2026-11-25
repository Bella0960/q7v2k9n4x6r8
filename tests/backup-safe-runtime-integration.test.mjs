import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../settings/js/backup.js',import.meta.url),'utf8');

const defs=[{db:'media',version:1,stores:[{store:'audio',keyPath:'id',blobFields:['blob']}]},{db:'maomao-assets',stores:[{store:'assets',keyPath:'assetId'},{store:'blobs',keyPath:'assetId',blobFields:['blob']},{store:'refs',keyPath:'assetId'}]}];
const pack=(data={chat_history_A:'[]'},idb,meta)=>({__backup:{app:'phone-app',schema:2,indexedDB:meta},data,indexedDB:idb});
const media=()=>pack(undefined,{media:{audio:[{id:'a',blob:'YWJj'}]}},{media:1});
function fixture(opts={}){
 const data=Object.assign(Object.create(null),{chat_history_A:'[{"text":"原文"}]',api_settings:'fixture-config'});
 let writes=0,confirmed=0,created=0,deleted=0,task,prompt='',rp;
 const attempted=[];
 const alerts=[],toasts=[];
 const localStorage=new Proxy(data,{get(t,k){if(k==='getItem')return id=>Object.hasOwn(t,id)?t[id]:null;if(k==='setItem')return (id,v)=>{writes++;t[id]=String(v);};return t[k];}});
 const account={ready:true,accountId:'fixture'};
 const window={__MAO_ACCOUNT_SCOPE__:opts.notReady?undefined:account};
 const document={querySelector:()=>({content:'fixture'})};
 const snapshot=()=>Object.assign({},data);
 const neverBackupKey=k=>k==='auth_token';
 const registry={belongsTo:(scope,key)=>key.startsWith('chat_history_'),get:()=>({label:'聊天'})};
 const start=source.indexOf('    function validateRestorePayload('),end=source.indexOf('    // 新功能使用 MAOMAOBackupRegistry.register()',start);
 assert.ok(start>=0&&end>start);
 const params={
  window,document,localStorage,backupTargets:()=>defs,backupRegistry:()=>registry,neverBackupKey,SECRET_KEYS:['api_settings'],
  FileReader:class{readAsText(file){task=this.onload({target:{result:file}});}},
  validateBackup:()=>'',backupMissingMusicBytes:()=>false,backupMissingMusicImages:()=>false,
  toast:x=>toasts.push(x),alert:x=>alerts.push(x),confirm:x=>{confirmed++;prompt=x;return !opts.cancel;},
  snapshot,RP_ROLE_PRE:'pre-import',
  rpWriteSnapshot:async snap=>{created++;rp=Object.assign({},snap);if(opts.stale)data.chat_history_A='[]';},
  rpReadSnapshot:async()=>({snap:rp}),verifyRestore:()=>({ok:true}),
  downloadSnapshot:()=>{},restore:snap=>{writes++;Object.keys(data).forEach(k=>delete data[k]);Object.assign(data,snap);return true;},
  restoreScoped:()=>true,carryOverSecrets:(incoming,old)=>{if(!Object.hasOwn(incoming,'api_settings'))data.api_settings=old.api_settings;return {written:1,failed:0,failedKeys:[]};},
  restoreDatabase:async(name)=>{attempted.push(name);if(opts.dbFail)throw Error('fixture');return {written:opts.countMismatch?0:1,skipped:opts.skip?1:0};},
  checkFontPresetOrphan:async()=>false,rpDeleteRole:()=>{deleted++;},setTimeout:()=>{},location:{reload(){}}
 };
 const api=new Function(...Object.keys(params),source.slice(start,end)+'\nreturn {validateRestorePayload,restoreOutcomeComplete,handleImportFile};')(...Object.values(params));
 return {api,data,alerts,toasts,writes:()=>writes,confirmed:()=>confirmed,created:()=>created,deleted:()=>deleted,prompt:()=>prompt,attempted:()=>attempted,async run(obj){api.handleImportFile(JSON.stringify(obj));await task;},async runRaw(raw){api.handleImportFile(raw);await task;}};
}
test('valid legacy text accepted',()=>assert.equal(fixture().api.validateRestorePayload(pack(),''),''));
test('invalid history rejected',()=>assert.ok(fixture().api.validateRestorePayload(pack({chat_history_A:'{}'}),'')));
test('physical account namespace rejected',()=>assert.ok(fixture().api.validateRestorePayload(pack({__mao_account_v1__other__key:'x'}),'')));
test('valid media accepted',()=>assert.equal(fixture().api.validateRestorePayload(media(),''),''));
test('invalid blob rejected',()=>assert.ok(fixture().api.validateRestorePayload(pack(undefined,{media:{audio:[{id:'a',blob:'!'}]}}),'')));
test('duplicate media key rejected',()=>assert.ok(fixture().api.validateRestorePayload(pack(undefined,{media:{audio:[{id:'a',blob:'YWJj'},{id:'a',blob:'YWJj'}]}}),'')));
test('missing declared payload rejected',()=>assert.ok(fixture().api.validateRestorePayload(pack(undefined,undefined,{media:1}),'')));
test('manifest mismatch rejected',()=>assert.ok(fixture().api.validateRestorePayload(pack(undefined,{media:{audio:[]}},{media:1}),'')));
test('missing referenced image bytes rejected',()=>assert.ok(fixture().api.validateRestorePayload(pack(undefined,{'maomao-assets':{assets:[{assetId:'a'}],blobs:[],refs:[]}}),'')));
test('actual import handler blocks invalid before confirm or mutation',async()=>{const f=fixture();await f.run(pack({chat_history_A:'{}'}));assert.equal(f.confirmed(),0);assert.equal(f.created(),0);assert.equal(f.writes(),0);});
test('actual import handler blocks unready injected account',async()=>{const f=fixture({notReady:true});await f.run(media());assert.equal(f.confirmed(),0);assert.equal(f.writes(),0);assert.equal(f.created(),0);});
test('actual import cancellation leaves storage alone',async()=>{const f=fixture({cancel:true});await f.run(media());assert.equal(f.confirmed(),1);assert.ok(f.prompt().includes('覆盖 1 项'));assert.equal(f.created(),0);assert.equal(f.writes(),0);});
test('actual import rejects changed baseline after recovery point',async()=>{const f=fixture({stale:true});await f.run(media());assert.equal(f.created(),1);assert.equal(f.writes(),0);assert.equal(f.deleted(),0);});
test('actual full import preserves recovery point on database failure',async()=>{const f=fixture({dbFail:true});await f.run(media());assert.equal(f.created(),1);assert.equal(f.deleted(),0);assert.ok(f.alerts.some(x=>x.includes('未完整完成')));assert.ok(!f.toasts.some(x=>x.includes('导入成功')));});
test('actual full import preserves recovery point on count mismatch',async()=>{const f=fixture({countMismatch:true});await f.run(media());assert.equal(f.deleted(),0);assert.ok(f.alerts.length);});
test('actual full import preserves recovery point on skipped record',async()=>{const f=fixture({skip:true});await f.run(media());assert.equal(f.deleted(),0);assert.ok(f.alerts.length);});
test('actual successful import clears recovery point and retains config',async()=>{const f=fixture();await f.run(media());assert.equal(f.deleted(),1);assert.equal(f.data.api_settings,'fixture-config');assert.ok(f.toasts.some(x=>x.includes('导入成功')));});
test('final outcome detects retained local config mismatch',()=>{const f=fixture();assert.equal(f.api.restoreOutcomeComplete({}, {api_settings:'other'},'',{},{},{failed:0},[],0),false);});

test('actual import blocks duplicate envelope before any restore action',async()=>{
 const f=fixture();await f.runRaw('{"__backup":{"app":"phone-app","schema":2},"data":{"chat_history_A":"[]","chat_history_A":"[]"}}');
 assert.equal(f.writes(),0);assert.equal(f.created(),0);assert.equal(f.confirmed(),0);
 assert.ok(f.toasts.some(x=>x.includes('重复字段')));
});
test('actual import stops subsequent database restores after first failure',async()=>{
 const f=fixture({dbFail:true});
 const obj=media();obj.indexedDB['maomao-assets']={assets:[],blobs:[],refs:[]};obj.__backup.indexedDB['maomao-assets']=0;
 await f.run(obj);assert.equal(f.attempted().length,1);assert.equal(f.attempted()[0],'media');assert.equal(f.deleted(),0);
});
