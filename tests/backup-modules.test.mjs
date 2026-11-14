import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const registrySource=readFileSync(new URL('../settings/js/backup-modules.js',import.meta.url),'utf8');
const backupSource=readFileSync(new URL('../settings/js/backup.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../settings/settings.html',import.meta.url),'utf8');
const injection='    // 新功能使用 MAOMAOBackupRegistry.register()';
assert.ok(backupSource.includes(injection),'test hook must match the real settings backup script');

function makeLocalStorage(initial={}) {
  const storage=Object.assign(Object.create(null),initial);
  Object.defineProperties(storage,{
    getItem:{value(k){return Object.hasOwn(this,k)?this[k]:null}},
    setItem:{value(k,v){this[k]=String(v)}},
    removeItem:{value(k){delete this[k]}},
    clear:{value(){for(const k of Object.keys(this))delete this[k]}},
    key:{value(i){return Object.keys(this)[i]||null}},
  });
  return storage;
}
function browser(initial={}) {
  const storage=makeLocalStorage(initial);
  const win={};
  const ctx={window:win,document:{getElementById:()=>null},localStorage:storage,
    console,Date,Promise,Blob,setTimeout,clearTimeout,URL,confirm:()=>true};
  runInNewContext(registrySource,ctx,{filename:'backup-modules.js'});
  const source=backupSource.replace(injection,
    '    window.__probe = { snapshot, validateBackup, restoreScoped, restoreStore, backupTargets, neverBackupKey };\n'+injection);
  runInNewContext(source,ctx,{filename:'backup.js'});
  return {reg:win.MAOMAOBackupRegistry,tools:win.__probe,storage};
}
function validPackage(scope,data,indexedDB={}) {
  return {__backup:{app:'phone-app',schema:2,scope,exportedAt:'2026-11-15T00:00:00Z'},
    data,indexedDB};
}
test('settings preserve the existing full backup UI and load modular registry first',()=>{
  assert.ok(html.includes('id="rowExportData"'));
  assert.ok(html.includes('id="rowImportData"'));
  assert.ok(html.includes('id="rowExportModule"'));
  assert.ok(html.includes('id="rowImportModule"'));
  assert.ok(html.indexOf('src="js/backup-modules.js"')<html.indexOf('src="js/backup.js"'));
  assert.ok(html.includes('非常非常机密，一定要妥善保存'));
});
test('each built-in category owns keys and IndexedDB while cloud identity remains outside browser backup',()=>{
  const {reg,tools}=browser();
  for(const id of ['chats','themes','characters','reading','diary','wallet','media','settings'])
    assert.ok(reg.get(id),'missing module '+id);
  assert.equal(reg.belongsTo('chats','chat_history_001'),true);
  assert.equal(reg.belongsTo('chats','beauty_presets'),false);
  assert.equal(reg.belongsTo('themes','beauty_presets'),true);
  assert.equal(reg.belongsTo('wallet','wallet_ledger_v1'),true);
  assert.equal(reg.belongsTo('chats','mao_session_token'),false);
  assert.equal(reg.belongsTo('settings','api_settings'),false);
  const chatDbs=tools.backupTargets('chats').map(x=>x.db);
  assert.ok(chatDbs.includes('maomao-assets'));
  assert.ok(chatDbs.includes('maomao-media-store'));
  assert.ok(!chatDbs.includes('maomao-reading-library'));
});
test('future feature installs only a registry entry, no edits to the whole-backup engine',()=>{
  const {reg,tools}=browser({dream_notes_v1:'{"one":true}'});
  reg.register({id:'dream-journal',label:'触梦手账',keys:['dream_notes_v1'],prefixes:['dream_'],
    databases:['maomao-dreams']});
  reg.registerDatabase({db:'maomao-dreams',version:1,
    stores:[{store:'memories',keyPath:'id'}]});
  assert.equal(reg.belongsTo('dream-journal','dream_notes_v1'),true);
  assert.equal(reg.selectSnapshot('dream-journal',{dream_notes_v1:'ok',chat_history_a:'private'}).dream_notes_v1,'ok');
  assert.deepEqual(Object.keys(reg.selectSnapshot('dream-journal',{dream_notes_v1:'ok',chat_history_a:'private'})),['dream_notes_v1']);
  assert.ok(tools.backupTargets('dream-journal').some(x=>x.db==='maomao-dreams'));
  assert.ok(tools.backupTargets().some(x=>x.db==='maomao-dreams'));
  assert.throws(()=>reg.register({id:'dream-journal',keys:['repeat']}),/already registered/i);
  assert.throws(()=>reg.register({id:'credentials',keys:['mao_session_token']}),/invalid/i);
});
test('scope backup validates payload boundaries and rejects injected credentials',()=>{
  const {tools}=browser();
  assert.equal(tools.validateBackup(validPackage('chats',{chat_history_a:'[]'})),'');
  assert.match(tools.validateBackup(validPackage('themes',{chat_history_a:'[]'})),/不属于该模块/);
  assert.match(tools.validateBackup(validPackage('chats',{mao_session_token:'stolen'})),/敏感凭据|不属于该模块/);
  assert.match(tools.validateBackup(validPackage('chats',{chat_history_a:'[]'},{unknown_db:{messages:[]}})),/媒体库/);
  assert.equal(tools.validateBackup(validPackage('reading',{},{
    'maomao-reading-library':{books:[{id:'book_a'}]}
  })),'');
  assert.equal(tools.validateBackup({__backup:{app:'phone-app',schema:2},data:{ai_custom_characters:'[]'}}),'');
});
test('scoped restore cannot delete another module or the active login',()=>{
  const {tools,storage}=browser({
    chat_history_a:'old',chat_history_b:'remain?',beauty_presets:'theme',
    mao_session_token:'current-login',api_settings:'private-api'
  });
  assert.equal(tools.restoreScoped({chat_history_a:'new'},'chats'),true);
  assert.equal(storage.getItem('chat_history_a'),'new');
  assert.equal(storage.getItem('chat_history_b'),null);
  assert.equal(storage.getItem('beauty_presets'),'theme');
  assert.equal(storage.getItem('mao_session_token'),'current-login');
  assert.equal(storage.getItem('api_settings'),'private-api');
});
test('downloadable snapshots exclude secret tokens by default and even when API credentials option is enabled',()=>{
  const {tools}=browser({
    chat_history_a:'keep',
    api_settings:'api-key',
    mao_session_token:'secret-session',
    refresh_token:'refresh-secret'
  });
  const safe=tools.snapshot(true,true);
  assert.equal(safe.chat_history_a,'keep');
  assert.equal(safe.api_settings,undefined);
  assert.equal(safe.mao_session_token,undefined);
  assert.equal(safe.refresh_token,undefined);
  const apiAllowed=tools.snapshot(true,false);
  assert.equal(apiAllowed.api_settings,'api-key');
  assert.equal(apiAllowed.mao_session_token,undefined);
  assert.equal(apiAllowed.refresh_token,undefined);
  // Browser-only internal rollback may snapshot active login, but file export cannot.
  const localRecovery=tools.snapshot(false,false,true);
  assert.equal(localRecovery.mao_session_token,'secret-session');
});
test('separate music backup captures audio blobs while old full-backup format stays compatible',()=>{
  const {tools}=browser();
  const full=tools.backupTargets().find(x=>x.db==='maomao-media-store');
  const music=tools.backupTargets('music').find(x=>x.db==='maomao-media-store');
  const fullAudio=full.stores.find(x=>x.store==='audio');
  const musicAudio=music.stores.find(x=>x.store==='audio');
  assert.ok(fullAudio.excludeFields.includes('blob'));
  assert.deepEqual(Array.from(musicAudio.blobFields),['blob']);
  assert.ok(musicAudio.blobMaxBytes>0);
  assert.ok(musicAudio.blobStoreMaxBytes>=musicAudio.blobMaxBytes);
});
test('new modules include forum, moments, café, games and unclassified local keys',()=>{
  const {reg}=browser();
  assert.ok(reg.belongsTo('forum','forum_config'));
  assert.ok(reg.belongsTo('cafe','maomao_cafe_state_v1'));
  assert.ok(reg.belongsTo('games','maomao_detective_progress_v1'));
  assert.ok(reg.belongsTo('moments','moments_notifications'));
  assert.ok(reg.belongsTo('music','music_recent'));
  assert.ok(reg.belongsTo('other','future_feature_v42'));
  assert.ok(!reg.belongsTo('other','mao_session_token'));
});
test('scoped IndexedDB restore merges without deleting other media, while full restore retains old clear behavior',async()=>{
  const {tools}=browser();
  async function restore(mergeOnly) {
    const rows=new Map([['existing',{id:'existing',kind:'photo'}]]);
    let clears=0;
    const db={
      transaction(){
        const tx={objectStore(){return {
          clear(){rows.clear();clears++},
          put(value){rows.set(value.id,value)}
        }}};
        setTimeout(()=>tx.oncomplete?.(),0);
        return tx;
      }
    };
    const result=await tools.restoreStore(db,{store:'photos',keyPath:'id'},[
      {id:'imported',kind:'photo'}
    ],true,mergeOnly);
    return {keys:Array.from(rows.keys()),clears,written:result.written};
  }
  const merge=await restore(true);
  assert.deepEqual(merge.keys,['existing','imported']);
  assert.equal(merge.clears,0);
  const full=await restore(false);
  assert.deepEqual(full.keys,['imported']);
  assert.equal(full.clears,1);
});

test('real forum, chat and theme storage keys round-trip separately without wiping unrelated modules',()=>{
  const forumValue=JSON.stringify([
    {id:'post-1',title:'测试帖子',comments:[{id:'reply-1',text:'测试回复'}]},
    {id:'post-2',title:'第二篇',comments:[]}
  ]);
  const chatValue=JSON.stringify([{id:'msg-1',text:'聊天备份测试'}]);
  const themeValue=JSON.stringify({name:'Monochrome',version:1});
  const original={
    forum_posts:forumValue,forum_config:'{"sort":"new"}',
    chat_history_001:chatValue,beauty_presets:themeValue,
    diary_entry_001:'{"text":"should not change"}',
    mao_session_token:'keep-this-login'
  };
  const {reg,tools,storage}=browser(original);
  const exported=tools.snapshot(true,true);
  const archives={};
  for(const name of ['forum','chats','themes']){
    archives[name]=reg.selectSnapshot(name,exported);
    assert.ok(Object.keys(archives[name]).length>0,name+' archive unexpectedly empty');
  }
  assert.equal(archives.forum.forum_posts,forumValue);
  assert.equal(archives.chats.chat_history_001,chatValue);
  assert.equal(archives.themes.beauty_presets,themeValue);
  assert.ok(!Object.hasOwn(archives.forum,'chat_history_001'));
  assert.ok(!Object.hasOwn(archives.chats,'beauty_presets'));
  storage.setItem('forum_posts','[]');
  storage.setItem('chat_history_001','[]');
  storage.setItem('beauty_presets','{}');
  assert.equal(tools.restoreScoped(archives.forum,'forum'),true);
  assert.equal(storage.getItem('forum_posts'),forumValue);
  assert.equal(storage.getItem('chat_history_001'),'[]');
  assert.equal(storage.getItem('beauty_presets'),'{}');
  assert.equal(tools.restoreScoped(archives.chats,'chats'),true);
  assert.equal(storage.getItem('chat_history_001'),chatValue);
  assert.equal(tools.restoreScoped(archives.themes,'themes'),true);
  assert.equal(storage.getItem('beauty_presets'),themeValue);
  assert.equal(storage.getItem('diary_entry_001'),original.diary_entry_001);
  assert.equal(storage.getItem('mao_session_token'),original.mao_session_token);
});
