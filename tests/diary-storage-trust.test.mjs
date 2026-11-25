import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-DIARY-001 · 日记应用写入可信性契约
 * 从 diary/diary.html 截取真实实现，在隔离上下文跑真实函数：
 * 置顶/收藏、角色自动涂鸦、角色自己写日记、偷看开关都必须「写成功才算完成」。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const page = readFileSync(resolve(root, 'diary/diary.html'), 'utf8');

function slice(from, to) {
  const start = page.indexOf(from);
  const end = page.indexOf(to, start);
  assert.ok(start > 0 && end > start, `cannot slice ${from}`);
  return page.slice(start, end);
}

const identityBlock = slice('  function diaryAuthorKind(', '  function diaryCharacters(');
const personaBlock = slice('  function diaryRoleContext(', '  function openAnnotation()');
const manualBlock = slice('  function generateCharComment(){', '  function renderReader(){');
const persistBlock = slice('  function diaryArchiveIsCurrent(){', '  function hydratePhotos(');
const flagBlock = slice('  function toggleEntryFlag(', '  function renderPhotoPreview(');
const autoWriteBlock = slice('  function diaryRecentOwnWriting(', '  setTimeout(maybeAutoWriteCharEntry,3000);');
const autoPeekBlock = slice('  function maybeAutoPeek(){', '  setTimeout(maybeAutoPeek,1800);');

function makeStore(seed = {}) {
  const raw = { ...seed };
  let quota = false;
  return {
    getItem: (k) => (k in raw ? raw[k] : null),
    setItem: (k, v) => {
      if (quota) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
      raw[k] = String(v);
    },
    removeItem: (k) => { delete raw[k]; },
    failWrites: (flag) => { quota = flag; },
    raw,
  };
}

function makeLocks(){
 const held=new Set();return {request(name,options,fn){if(held.has(name)){try{return Promise.resolve(fn(null));}catch(e){return Promise.reject(e);}}held.add(name);try{return Promise.resolve(fn({name})).finally(()=>held.delete(name));}catch(e){held.delete(name);return Promise.reject(e);}}};
}
function makeSandbox({ store, locks=makeLocks(), entries = [], role = { id: 'roleA', name: '阿岚', persona:'从事植物研究，记录自然观察。', tone:'简练、克制' }, aiText = '今天风很大，窗台上的绿植被吹得一直点头。我把咖啡放在窗边，看它慢慢凉掉，忽然很想跟你说一句没什么用的废话。' }) {
  const toasts = [];
  const sandbox = {
    localStorage: store,
    STORAGE_KEY: 'maomao_diary_entries_v1',
    diaryArchiveSnapshot:store.getItem('maomao_diary_entries_v1'),
    diaryPageAccount:JSON.stringify(['fixture-account',null]),
    navigator:{locks},
    entries,
    peekBusy: false,
    showToast: (m) => toasts.push(m),
    render: () => {},
    todayKey: () => '2026-11-23',
    peekEnabled: () => true,
    peekCurrentRole: () => role,
    diaryCharacters: () => [role],
    document: {querySelector: () => ({getAttribute: () => sandbox.account})},
    account: 'fixture-account',
    location: {hostname:'localhost'},
    annotationBusy:false, readerId:null,
    $: id => (sandbox.ui[id] ||= {value:'',textContent:'',disabled:false}),
    ui:{annotationCharacter:{value:String(role.id)},annotationPrompt:{value:''}},
    renderReader:()=>{}, renderAnnotationHistory:()=>{},
    sorted: (list) => list.slice(),
    console,
    JSON,
    Object,
    String,
    Number,
    Array,
    Date,
    Math,
    Promise,
    Error,
  };
  sandbox.window = sandbox;
  sandbox.PhoneAPI = { complete: () => Promise.resolve(aiText) };
  vm.createContext(sandbox);
  for(const file of ['chat-role-context.js','chat-context-policy.js','role-worldbook-bindings.js']){
    vm.runInContext(readFileSync(resolve(root,'shared/js/phone',file),'utf8'),sandbox);
  }
  vm.runInContext(identityBlock + '\n' + personaBlock + '\n' + persistBlock + '\n' + flagBlock + '\n' + autoWriteBlock + '\n' + autoPeekBlock + '\n' + manualBlock, sandbox);
  return { sb: sandbox, toasts };
}

test('persist：成功返回 true 且不把照片写进文字存档', () => {
  const store = makeStore();
  const entries = [{ id: 'd1', date: '2026-11-23', title: '标题', photo: 'data:image/png;base64,AA', photos: ['x'] }];
  const { sb } = makeSandbox({ store, entries });
  assert.equal(sb.persist(), true);
  const saved = JSON.parse(store.raw.maomao_diary_entries_v1);
  assert.equal(saved[0].title, '标题');
  assert.equal('photo' in saved[0], false, 'photos must stay out of the text store');
  assert.equal('photos' in saved[0], false);
});

test('置顶：写成功才生效并提示', () => {
  const store = makeStore();
  const entries = [{ id: 'd1', date: '2026-11-23', pinned: false }];
  const { sb, toasts } = makeSandbox({ store, entries });
  sb.togglePinned('d1');
  assert.equal(sb.entries[0].pinned, true);
  assert.equal(JSON.parse(store.raw.maomao_diary_entries_v1)[0].pinned, true);
  assert.ok(toasts.some((t) => t.includes('已置顶')));
});

test('置顶写失败：标记翻回去，updatedAt 也还原，并明说没保存', () => {
  const store = makeStore();
  const entries = [{ id: 'd1', date: '2026-11-23', pinned: false, updatedAt: '2026-11-20T00:00:00.000Z' }];
  const { sb, toasts } = makeSandbox({ store, entries });
  store.failWrites(true);

  sb.togglePinned('d1');
  assert.equal(sb.entries[0].pinned, false, 'flag must not look pinned when save failed');
  assert.equal(sb.entries[0].updatedAt, '2026-11-20T00:00:00.000Z', 'timestamp must roll back too');
  assert.ok(toasts.some((t) => t.includes('没能保存')), 'failure must be explained');
});

test('收藏写失败同样回滚', () => {
  const store = makeStore();
  const entries = [{ id: 'd1', date: '2026-11-23', favorite: true }];
  const { sb } = makeSandbox({ store, entries });
  store.failWrites(true);
  sb.toggleFavorite('d1');
  assert.equal(sb.entries[0].favorite, true);
});

test('角色自动写日记：写失败时这条日记被收回，不留在内存里', async () => {
  const store = makeStore();
  const { sb } = makeSandbox({ store, entries: [] });
  store.failWrites(true);

  sb.maybeAutoWriteCharEntry();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sb.entries.length, 0, 'failed char entry must be rolled back');
});

test('角色自动写日记：写成功时入库并记录时间戳', async () => {
  const store = makeStore();
  const { sb } = makeSandbox({ store, entries: [] });

  sb.maybeAutoWriteCharEntry();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sb.entries.length, 1);
  assert.equal(sb.entries[0].author, 'roleA');
  assert.equal(JSON.parse(store.raw.maomao_diary_entries_v1).length, 1);
  assert.ok(store.raw['char_last_wrote_roleA'], 'write timestamp must be recorded');
});

test('角色自动涂鸦：写失败时批注被收回，不污染下一次保存', async () => {
  const store = makeStore();
  const entries = [{ id: 'd1', date: '2026-11-23', content: '今天很累', charComments: [] }];
  const { sb } = makeSandbox({ store, entries });
  store.failWrites(true);

  sb.maybeAutoPeek();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sb.entries[0].charComments.length, 0, 'failed annotation must not stay in memory');
});

test('角色自动涂鸦：写成功才留下批注', async () => {
  const store = makeStore();
  const entries = [{ id: 'd1', date: '2026-11-23', content: '今天很累', charComments: [] }];
  const { sb } = makeSandbox({ store, entries });

  sb.maybeAutoPeek();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sb.entries[0].charComments.length, 1);
  assert.equal(sb.entries[0].charComments[0].characterId, 'roleA');
  assert.equal(JSON.parse(store.raw.maomao_diary_entries_v1)[0].charComments.length, 1);
});

test('源码守卫：偷看开关检查写入结果，失败不再假装切换成功', () => {
  const at = page.indexOf("localStorage.setItem('char_peek_enabled'");
  assert.ok(at > 0, 'peek switch write must exist');
  const block = page.slice(at, at + 400);
  assert.equal(/catch\(err\)\{\s*\}/.test(block), false, 'peek switch write must not be silently swallowed');
  assert.ok(block.includes('peekSaved'), 'peek switch must branch on the write result');
});

test('旧照片迁移未完成时，更新文字标记保留原照片字段', () => {
  const entry = { id: 'legacy', date: '2026-11-23', photo: 'data:image/png;base64,fixture' };
  const store = makeStore({ maomao_diary_entries_v1: JSON.stringify([entry]) });
  const { sb } = makeSandbox({ store, entries: [{ ...entry, pinned: true }] });
  assert.equal(sb.persist(), true);
  const saved = JSON.parse(store.getItem('maomao_diary_entries_v1'))[0];
  assert.equal(saved.photo, entry.photo);
  assert.equal(saved.pinned, true);
});

test('author classification: legacy user, explicit user, character and restored legacy character IDs',()=>{
 const {sb}=makeSandbox({store:makeStore()});
 for(const entry of [{id:'d_old'},{id:'d_new',author:'me'}]) assert.equal(sb.diaryAuthorKind(entry),'user');
 for(const entry of [{id:'d_char_old'},{id:'d_1',author:'roleB'},{id:'d_2',author:'me',charWritten:true}]) assert.equal(sb.diaryAuthorKind(entry),'character');
 assert.equal(sb.diaryAuthorKind({id:'d_unknown',authorName:'Lost author'}),'unknown');
});
test('auto comment never sends another role diary or an author-ambiguous diary to AI',async()=>{
 const entries=[{id:'d_char_legacy',date:'2026-11-25',content:'ROLE_PRIVATE'},{id:'d_role',author:'roleB',date:'2026-11-25',content:'ROLE_PRIVATE'},{id:'d_unknown',authorName:'Lost',date:'2026-11-25',content:'ROLE_PRIVATE'}];
 const {sb}=makeSandbox({store:makeStore(),entries});
 let calls=0;
 sb.PhoneAPI.complete=()=>{calls++;return Promise.resolve('reply')};
 sb.maybeAutoPeek(); await new Promise(r=>setTimeout(r,10));
 assert.equal(calls,0);
 assert.equal(entries.some(e=>e.charComments?.length),false);
 entries.push({id:'d_user',author:'me',date:'2026-11-24',content:'USER_TEXT'});
 sb.PhoneAPI.complete=opts=>{calls++;assert.match(opts.user,/USER_TEXT/);assert.doesNotMatch(opts.user,/ROLE_PRIVATE/);return Promise.resolve('reply')};
 sb.maybeAutoPeek();await new Promise(r=>setTimeout(r,10));
 assert.equal(calls,1);assert.equal(entries[3].charComments[0].characterId,'roleA');
 assert.equal(entries.slice(0,3).some(e=>e.charComments?.length),false);
});
test('manual comment rejects role-authored entries before any paid call',()=>{
 const {sb}=makeSandbox({store:makeStore(),entries:[{id:'d_char_1',author:'roleB',date:'2026-11-25'}]});
 sb.readerId='d_char_1';let calls=0;sb.PhoneAPI.complete=()=>{calls++;return Promise.resolve('reply')};
 sb.generateCharComment();assert.equal(calls,0);
});
test('manual/automatic delayed replies are discarded if author, role, or account changes',async()=>{
 for(const manual of [false,true])for(const change of ['author','role','account','record-kind']){
  const entry={id:'d_user',author:'me',date:'2026-11-25',content:'user'};
  const {sb}=makeSandbox({store:makeStore(),entries:[entry]});
  sb.readerId=entry.id;let resolve;sb.PhoneAPI.complete=()=>new Promise(r=>resolve=r);
  if(manual)sb.generateCharComment();else sb.maybeAutoPeek();
  assert.equal(typeof resolve,'function');
  if(change==='author')entry.author='roleB';else if(change==='role')sb.diaryCharacters=()=>[];else if(change==='record-kind')entry.noteType='备忘';else sb.account='other';
  resolve('reply');await new Promise(r=>setTimeout(r,10));
  assert.equal(entry.charComments?.length||0,0);
 }
});
test('manual comment selection uses the stable role ID, not array index',async()=>{
 const entry={id:'d_user',author:'me',date:'2026-11-25',content:'user'};
 const {sb}=makeSandbox({store:makeStore(),entries:[entry]});sb.readerId=entry.id;
 sb.diaryCharacters=()=>[{id:'roleB',name:'Same name'},{id:'roleA',name:'Same name'}];
 sb.PhoneAPI.complete=()=>Promise.resolve('reply');
 sb.generateCharComment();await new Promise(r=>setTimeout(r,10));
 assert.equal(entry.charComments[0].characterId,'roleA');
});
test('backup import keeps the author fields instead of treating role diary as user diary',()=>{
 const importer=slice('  function importBackup(file){','  function openMenu()');
 assert.match(importer,/clean\.author=e\.author/);
 assert.match(importer,/clean\.authorName=e\.authorName/);
 assert.match(importer,/clean\.charWritten=e\.charWritten/);
});

test('diary request contains full canonical persona and tone, not another role context',async()=>{
 const role={id:'roleA',name:'Same name',persona:'ROLE_A_START '+ '自然观察。'.repeat(800)+' ROLE_A_END',tone:'ROLE_A_TONE',worldBookIds:['a']};
 const store=makeStore({phone_worldbooks:JSON.stringify([{id:'a',name:'A lore',entries:[{name:'A note',content:'ROLE_A_LORE',enabled:true,constant:true}]},{id:'b',name:'B lore',entries:[{name:'B note',content:'ROLE_B_PRIVATE',enabled:true,constant:true}]}])});
 const {sb}=makeSandbox({store,role});
 sb.PhoneStorage={getMemories:id=>{assert.equal(id,'roleA');return [{status:'confirmed',content:'ROLE_A_MEMORY'},{status:'pending',content:'PENDING_MEMORY'}]}};
 let request;sb.PhoneAPI.complete=opts=>{request=opts;return Promise.resolve('记录今天的植物生长情况，叶片在日光下有了新的变化。')};
 await sb.maybeAutoWriteCharEntry();
 assert.ok(request);
 assert.ok(request.system.includes(role.persona));
 assert.match(request.system,/ROLE_A_TONE/);
 assert.match(request.system,/ROLE_A_LORE/);
 assert.match(request.system,/ROLE_A_MEMORY/);
 assert.doesNotMatch(request.system,/ROLE_B_PRIVATE|PENDING_MEMORY/);
 assert.equal(sb.entries[0].author,'roleA');
});
test('incomplete persona or unreadable worldbook binding prevents automatic paid diary generation',()=>{
 for(const [role,seed] of [[{id:'roleA',name:'Same name'},{}],[{id:'roleA',name:'Same name',persona:'观察自然。'},{chat_worldbooks_roleA:'broken'}]]){
  const {sb}=makeSandbox({role,store:makeStore(seed)});let calls=0;
  sb.PhoneAPI.complete=()=>{calls++;return Promise.resolve('reply')};sb.maybeAutoWriteCharEntry();assert.equal(calls,0);
 }
});
test('clear or disabled role worldbook mount never resurrects old character bindings',()=>{
 const role={id:'roleA',name:'A',persona:'自然研究员',worldBookIds:['a']};
 const store=makeStore({chat_worldbooks_roleA:JSON.stringify({worldbookIds:['a'],enabled:false}),phone_worldbooks:JSON.stringify([{id:'a',name:'A',content:'PRIVATE_LORE'}])});
 const {sb}=makeSandbox({store,role});
 assert.doesNotMatch(sb.diaryRoleContext(role,'日记',true),/PRIVATE_LORE/);
});

test('auto diary generation shares one in-flight request on the same page',async()=>{
 const {sb}=makeSandbox({store:makeStore()});
 let calls=0,resolve;
 sb.PhoneAPI.complete=()=>{calls++;return new Promise(r=>resolve=r);};
 const p=sb.maybeAutoWriteCharEntry();sb.maybeAutoWriteCharEntry();
 await Promise.resolve();assert.equal(calls,1);
 resolve('记录植物的生长，叶片在日光中舒展开，今天有新的观察结果。');
 await p;assert.equal(sb.entries.length,1);assert.equal(sb.maybeAutoWriteCharEntry.inFlight,false);
});

test('too-short model diary is not persisted and does not mark the cooldown',async()=>{
 const store=makeStore(),{sb}=makeSandbox({store,aiText:'观察植物生长记录，今天叶片有新的变化。'});
 await sb.maybeAutoWriteCharEntry();
 assert.equal(sb.entries.length,0);
 assert.equal(store.getItem('char_last_wrote_roleA'),null);
 assert.equal(sb.maybeAutoWriteCharEntry.inFlight,false);
});

test('personal remark is independent of diary body, role comments and memo records, with rollback on quota error',()=>{
 const roleEntry={id:'d_char_1',author:'roleA',date:'2026-11-25',content:'ROLE_BODY',charComments:[{text:'old historical comment'}],noteType:'日记'};
 const memo={id:'m1',author:'me',date:'2026-11-25',content:'MEMO_BODY',noteType:'备忘'};
 const store=makeStore(),{sb}=makeSandbox({store,entries:[roleEntry,memo]});
 const token=sb.diaryAccountToken();
 assert.equal(sb.savePersonalRemark(roleEntry.id,token,'PRIVATE_REMARK'),true);
 assert.equal(roleEntry.personalRemark.text,'PRIVATE_REMARK');
 assert.equal(roleEntry.content,'ROLE_BODY');
 assert.equal(roleEntry.charComments[0].text,'old historical comment');
 assert.equal(sb.savePersonalRemark(memo.id,token,'no'),false);
 assert.equal(memo.personalRemark,undefined);
 assert.equal(sb.savePersonalRemark(roleEntry.id,'wrong-account','no'),false);
 store.failWrites(true);
 assert.equal(sb.savePersonalRemark(roleEntry.id,token,'failed edit'),false);
 assert.equal(roleEntry.personalRemark.text,'PRIVATE_REMARK');
 assert.equal(sb.savePersonalRemark(roleEntry.id,token,''),false);
 assert.equal(roleEntry.personalRemark.text,'PRIVATE_REMARK');
 store.failWrites(false);
 assert.equal(sb.savePersonalRemark(roleEntry.id,token,''),true);
 assert.equal(roleEntry.personalRemark,undefined);
 assert.equal(JSON.parse(store.getItem('maomao_diary_entries_v1'))[0].personalRemark,undefined);
});
test('natural writing prompt includes only the selected role own prior diaries and not personal remarks, other roles, or memo bodies',()=>{
 const entries=[
 {id:'d_char_a',date:'2026-11-24',author:'roleA',diaryWritingVersion:2,content:'OWN_PRIOR_LIFE',personalRemark:{text:'PRIVATE_REMARK'},charComments:[{text:'OLD_COMMENT'}]},
 {id:'d_char_b',date:'2026-11-24',author:'roleB',diaryWritingVersion:2,content:'OTHER_ROLE_LIFE'},
 {id:'d_char_old',date:'2026-11-24',author:'roleA',content:'OLD_GENERIC_TEMPLATE'},
 {id:'d_char_memo',date:'2026-11-24',author:'roleA',noteType:'备忘',content:'MEMO_PRIVATE'},
 {id:'d_user',date:'2026-11-25',author:'me',content:'USER_PRIVATE',personalRemark:{text:'USER_REMARK'}}
 ];
 const {sb}=makeSandbox({store:makeStore(),entries});
 const prompt=sb.diaryWritingPrompt(sb.peekCurrentRole());
 assert.match(prompt,/OWN_PRIOR_LIFE/);
 assert.match(prompt,/不要求起承转合/);
 assert.match(prompt,/不默认上班、喝咖啡、加班、通勤/);
 assert.doesNotMatch(prompt,/200-400字|PRIVATE_REMARK|OLD_COMMENT|OTHER_ROLE_LIFE|MEMO_PRIVATE|USER_PRIVATE|USER_REMARK|OLD_GENERIC_TEMPLATE/);
});
test('automatic and manual role comments never include private remark fields and label memo distinctly',async()=>{
 for(const noteType of ['日记','备忘']){
  const entry={id:'u',author:'me',date:'2026-11-25',content:'BODY_TEXT',noteType,personalRemark:{text:'REMARK_SECRET'}};
  const {sb}=makeSandbox({store:makeStore(),entries:[entry]});
  let calls=[];sb.PhoneAPI.complete=opts=>{calls.push(opts);return Promise.resolve('留言')};
  sb.maybeAutoPeek();await new Promise(r=>setTimeout(r,10));
  sb.readerId='u';sb.generateCharComment();await new Promise(r=>setTimeout(r,10));
  assert.equal(calls.length,2);
  for(const opts of calls){assert.ok(opts.user.includes('BODY_TEXT'));assert.ok(opts.user.includes(noteType==='备忘'?'备忘录':'日记'));assert.doesNotMatch(opts.user+opts.system,/REMARK_SECRET/);}
 }
});
test('backup import and export preserve the dedicated private remark field',()=>{
 const importer=slice('  function importBackup(file){','  function openMenu()');
 assert.match(importer,/clean\.personalRemark=\{text:e\.personalRemark\.text/);
 const exporter=slice('  function exportBackup(){','  function importBackup(file){');
 assert.match(exporter,/Object\.assign\(\{\},entry/);
});

test('stale page cannot overwrite another tab archive or a newly switched account',()=>{
 const entry={id:'u',author:'me',date:'2026-11-25',content:'old'};
 const store=makeStore({maomao_diary_entries_v1:JSON.stringify([entry])});
 const {sb}=makeSandbox({store,entries:[{...entry}]});
 const newest=JSON.stringify([{...entry,content:'newest'}]);store.setItem('maomao_diary_entries_v1',newest);
 assert.equal(sb.savePersonalRemark('u',sb.diaryAccountToken(),'stale'),false);
 assert.equal(store.getItem('maomao_diary_entries_v1'),newest);
 sb.diaryArchiveSnapshot=newest;sb.account='other';
 assert.equal(sb.persist(),false);assert.equal(store.getItem('maomao_diary_entries_v1'),newest);
});
test('in-flight comments are not stored after content or persona changes',async()=>{
 for(const manual of [false,true])for(const change of ['content','persona']){
  const role={id:'roleA',name:'A',persona:'研究植物，喜欢自然观察。',tone:'简练'};
  const entry={id:'u',author:'me',date:'2026-11-25',content:'original'};
  const {sb}=makeSandbox({store:makeStore(),entries:[entry],role});
  let finish;sb.PhoneAPI.complete=()=>new Promise(r=>finish=r);sb.readerId='u';
  if(manual)sb.generateCharComment();else sb.maybeAutoPeek();
  assert.equal(typeof finish,'function');
  if(change==='content')entry.content='changed';else role.persona='研究音乐，喜欢作曲。';
  finish('测试留言');await new Promise(r=>setTimeout(r,10));
  assert.equal(entry.charComments?.length||0,0);
 }
});
test('in-flight role diary is discarded after saved role context changes',async()=>{
 const role={id:'roleA',name:'A',persona:'从事植物研究，记录自然观察。',tone:'简练'};
 const {sb}=makeSandbox({store:makeStore(),role});let finish;
 sb.PhoneAPI.complete=()=>new Promise(r=>finish=r);
 const pending=sb.maybeAutoWriteCharEntry();await Promise.resolve();
 assert.equal(typeof finish,'function');role.persona='从事音乐研究，记录作曲过程。';
 finish('今天记录了植物叶片的变化，正在整理观察记录。');await pending;
 assert.equal(sb.entries.length,0);
});
test('current-role selector refuses invalid contacts, ambiguous roles and duplicate IDs',()=>{
 const code=slice('  function diaryCharacters(){','  // A read-only, diary-specific adapter')+'\n'+slice('  function peekCurrentRole(){','  function maybeAutoPeek(){');
 let roles=[{id:'a',name:'A'},{id:'b',name:'B'}],contact='missing';
 const context=vm.createContext({PhoneStorage:{getCharacters:()=>roles,getCurrentContactId:()=>contact}});context.window=context;
 vm.runInContext(code,context);
 assert.equal(context.peekCurrentRole(),null);
 contact=null;assert.equal(context.peekCurrentRole(),null);
 contact='b';assert.equal(context.peekCurrentRole().id,'b');
 roles.push({id:'b',name:'Duplicate'});assert.equal(context.peekCurrentRole(),null);
 contact=null;assert.equal(context.peekCurrentRole().id,'a');
});

test('shared browser lock prevents duplicate paid writes from two tabs',async()=>{
 const store=makeStore(),locks=makeLocks();
 const a=makeSandbox({store,locks}).sb,b=makeSandbox({store,locks}).sb;
 let calls=0,finish;
 a.PhoneAPI.complete=b.PhoneAPI.complete=()=>{calls++;return new Promise(r=>finish=r)};
 const p=a.maybeAutoWriteCharEntry(),q=b.maybeAutoWriteCharEntry();
 await Promise.resolve();assert.equal(calls,1);
 finish('植物叶片出现了新的变化，今天把观察记录整理了一遍。');
 await Promise.all([p,q]);
 assert.equal(JSON.parse(store.getItem('maomao_diary_entries_v1')).length,1);
 b.maybeAutoWriteCharEntry();await Promise.resolve();assert.equal(calls,1);
});
test('missing browser request lock fails closed without paid request',async()=>{
 const {sb}=makeSandbox({store:makeStore()});
 sb.navigator={};let calls=0;sb.PhoneAPI.complete=()=>{calls++;return Promise.resolve('fixture')};
 await sb.maybeAutoWriteCharEntry();assert.equal(calls,0);
});
test('failed backup import never leaves staged entries in memory',()=>{
 const original={id:'u',date:'2026-11-25',content:'original'};
 const store=makeStore({maomao_diary_entries_v1:JSON.stringify([original])});
 const {sb}=makeSandbox({store,entries:[original]});
 sb.confirm=()=>true;sb.FileReader=class {readAsText(file){this.result=file;this.onload();}};
 vm.runInContext(slice('  function importBackup(file){','  function openMenu()'),sb);
 store.failWrites(true);
 sb.importBackup(JSON.stringify({entries:[{id:'new',date:'2026-11-25',content:'incoming'}]}));
 assert.equal(sb.entries.length,1);assert.equal(sb.entries[0].id,'u');
 assert.equal(JSON.parse(store.getItem('maomao_diary_entries_v1')).length,1);
});

test('explicit generation uses the selected role ID and selected kind without changing active chat contact or requiring auto-write enabled',async()=>{
 const roleA={id:'roleA',name:'同名',persona:'植物研究员，平时观察植物。',tone:'简练'};
 const roleB={id:'roleB',name:'同名',persona:'音乐研究员，平时整理乐谱。',tone:'直接'};
 const entries=[{id:'old',date:'2026-11-24',author:'roleB',diaryWritingVersion:2,content:'DIARY_ONLY'},{id:'memo',date:'2026-11-24',author:'roleB',noteType:'备忘',diaryWritingVersion:2,content:'MEMO_ONLY',personalRemark:{text:'PRIVATE_REMARK'}},{id:'other',date:'2026-11-24',author:'roleA',noteType:'备忘',diaryWritingVersion:2,content:'OTHER_ROLE_ONLY'}];
 const {sb}=makeSandbox({store:makeStore(),role:roleA,entries});
 sb.diaryCharacters=()=>[roleA,roleB];sb.peekEnabled=()=>false;
 const calls=[];sb.PhoneAPI.complete=opts=>{calls.push(opts);return Promise.resolve('整理乐谱')};
 assert.equal(await sb.generatePersonRecord('roleB','备忘',true),true);
 assert.equal(calls.length,1);
 assert.match(calls[0].system,/音乐研究员/);
 assert.match(calls[0].system,/MEMO_ONLY/);
 assert.doesNotMatch(calls[0].system,/植物研究员|DIARY_ONLY|OTHER_ROLE_ONLY|PRIVATE_REMARK/);
 const saved=sb.entries.at(-1);
 assert.equal(saved.author,'roleB');assert.equal(saved.noteType,'备忘');assert.equal(saved.charWritten,true);assert.equal(saved.personalRemark,undefined);
 assert.equal(sb.peekCurrentRole().id,'roleA');
 assert.equal(sb.localStorage.getItem('char_last_wrote_roleB'),null);
 assert.equal(await sb.generatePersonRecord('missing','日记',true),false);
 assert.equal(await sb.generatePersonRecord('roleB','invalid',true),false);
 assert.equal(calls.length,1);
 sb.PhoneAPI.complete=opts=>{calls.push(opts);return Promise.resolve('整理新收集的乐谱时发现了一些有趣的节奏变化。')};
 assert.equal(await sb.generatePersonRecord('roleB','日记',true),true);
 assert.equal(sb.entries.at(-1).noteType,'日记');
 assert.match(calls[1].system,/DIARY_ONLY/);assert.doesNotMatch(calls[1].system,/MEMO_ONLY|PRIVATE_REMARK|OTHER_ROLE_ONLY/);
});
test('manual person generation and automatic generation share a write lock',async()=>{
 const {sb}=makeSandbox({store:makeStore()});let calls=0,finish;
 sb.PhoneAPI.complete=()=>{calls++;return new Promise(r=>finish=r)};
 const p=sb.generatePersonRecord('roleA','备忘',true),q=sb.maybeAutoWriteCharEntry();
 await Promise.resolve();assert.equal(calls,1);
 finish('整理今天的植物观察记录，记录叶片变化。');await Promise.all([p,q]);
 assert.equal(sb.entries.length,1);assert.equal(sb.entries[0].noteType,'备忘');
});
