import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../shared/js/phone/phone_storage.js',import.meta.url),'utf8');
const backup=readFileSync(new URL('../settings/js/backup.js',import.meta.url),'utf8');

const original={id:'m1',content:'原文',status:'superseded-fixed',sourceRoleId:'A'};
const revision={id:'m2',content:'修订内容',status:'fixed',sourceRoleId:'A',source:'user-correction',sourceMemoryIds:['m1']};
function fixture(initial,drop=false){
 const data=new Map(Object.entries(initial));
 const localStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>{if(!drop)data.set(k,String(v));},removeItem:k=>data.delete(k),clear:()=>data.clear()};
 const window={};new Function('window','localStorage',source)(window,localStorage);
 return {api:window.PhoneStorage,data,localStorage};
}
const list=()=>JSON.stringify([original,revision]);
test('malformed primary does not fall back or accept writes',()=>{
 const f=fixture({chat_memories_A:'{}',phone_data_v2:JSON.stringify({A:{memories:{items:[original]}}})});
 assert.equal(f.api.result.getMemories('A').error.code,'CORRUPT_DATA');
 assert.equal(f.api.getData('A','memories'),null);
 assert.equal(f.api.result.saveMemories('A',[]).error.code,'CORRUPT_DATA');
 assert.equal(f.data.get('chat_memories_A'),'{}');
});
test('non-array input cannot clear existing memories',()=>{
 const f=fixture({chat_memories_A:'[]'});
 assert.equal(f.api.result.saveMemories('A',null).error.code,'VALIDATION_FAILED');
});
test('generic saves cannot delete or alter revision chain',()=>{
 const f=fixture({chat_memories_A:list()});
 assert.equal(f.api.saveMemories('A',[revision]),false);
 assert.equal(f.api.result.saveMemories('A',[original,{...revision,content:'changed'}]).error.code,'CONFLICT');
 assert.equal(f.data.get('chat_memories_A'),list());
});
test('ordinary append preserves revision chain',()=>{
 const f=fixture({chat_memories_A:list()});
 assert.equal(f.api.result.saveMemories('A',[original,revision,{id:'m3',content:'另一条'}]).ok,true);
});
test('dropped write never reports success',()=>{
 const f=fixture({chat_memories_A:'[]'},true);
 assert.equal(f.api.result.saveMemories('A',[{content:'新增'}]).ok,false);
});
test('divergent legacy copy is not deleted',()=>{
 const legacy=JSON.stringify({A:{memories:{items:[{content:'旧资料'}]}}});
 const f=fixture({chat_memories_A:'[]',phone_data_v2:legacy});
 assert.equal(f.api.saveMemories('A',[{content:'新增'}]),true);
 assert.equal(f.data.get('phone_data_v2'),legacy);
});
function backupFixture(){
 const start=backup.indexOf('    function validateMemoryBackup(');
 const end=backup.indexOf('    // Scoped restore',start);
 assert.ok(start>=0&&end>start);
 const make=new Function('localStorage','BACKUP_APP','BACKUP_SCHEMA','CORE_HINTS','backupRegistry',backup.slice(start,end)+'\nreturn {validateBackup,restore};');
 return make({clear(){},setItem(){},getItem(){return null;}},'phone-app',2,['chat_memories_','phone_data_v2'],()=>null);
}
const pack=items=>({__backup:{app:'phone-app',schema:2},data:{chat_memories_A:JSON.stringify(items)}});
test('valid revision backup accepted',()=>assert.equal(backupFixture().validateBackup(pack([original,revision])),''));
test('withdrawn revision backup accepted',()=>assert.equal(backupFixture().validateBackup(pack([{...original,status:'fixed'},{...revision,status:'withdrawn'}])),''));
test('legacy string and object records accepted',()=>assert.equal(backupFixture().validateBackup(pack(['旧记录',{content:'原文'}])),''));
test('missing parent rejected',()=>assert.ok(backupFixture().validateBackup(pack([revision]))));
test('superseded version without active child rejected',()=>assert.ok(backupFixture().validateBackup(pack([original]))));
test('cross-role parent rejected',()=>assert.ok(backupFixture().validateBackup(pack([{...original,sourceRoleId:'B'},revision]))));
test('multiple active children rejected',()=>assert.ok(backupFixture().validateBackup(pack([original,revision,{...revision,id:'m3'}]))));
test('cyclic revision references rejected',()=>assert.ok(backupFixture().validateBackup(pack([{...original,source:'user-correction',sourceMemoryIds:['m2']},{...revision,status:'superseded-fixed'}]))));
test('invalid primary shape rejected',()=>assert.ok(backupFixture().validateBackup(pack({}))));
test('malformed legacy revision rejected',()=>assert.ok(backupFixture().validateBackup({__backup:{app:'phone-app',schema:2},data:{phone_data_v2:JSON.stringify({A:{memories:{items:[revision]}}})}})));
test('full restore detects dropped writes',()=>assert.equal(backupFixture().restore({chat_memories_A:'[]'}),false));
