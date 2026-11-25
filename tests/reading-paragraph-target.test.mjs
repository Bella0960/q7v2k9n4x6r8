import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../library/library.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('  function coReadKey('),html.indexOf('  var readingVisibleKey='));
const target=(bookId,paragraphIndex)=>({bookId,bookName:bookId,chapterIndex:0,chapterTitle:'Chapter',paragraphIndex,paragraph:'Original '+paragraphIndex,previous:'Earlier',next:'DO_NOT_SEND_FUTURE'});
function harness(){
 let resolve,reject,started,calls=0,denyWrite=false;
 const stored=new Map(),saved=[],toasts=[],requests=[],cache={};
 const input={value:''};
 const c=vm.createContext({
  activeParagraph:target('a',0),paragraphRequest:null,readerPublishing:false,paragraphRoleSelect:{value:'r1'},settings:{commentRoleId:'r1',comments:true},
  state:{book:{id:'a'},ch:0},document:{hidden:false,getElementById:()=>input},
  readerView:{getAttribute:()=> 'false'},sheetBackdrop:{classList:{contains:()=>false}},
  navigator:{locks:{request:async(name,options,fn)=>fn({})}},
  readerRoleById:id=>({id,name:id,worldBookIds:[]}),readerAccountToken:()=>c.account,account:'account-a',
  findBook:id=>({id}),commentKey:(...a)=>a.join('|'),commentCache:cache,
  ownReadingKey:(t,token)=>[t.bookId,t.chapterIndex,t.paragraphIndex,'@reader:'+encodeURIComponent(token)].join('|'),getParagraphComment:(...a)=>cache[a.join('|')],saveReaderComment:async x=>{saved.push(x);cache[x.id]=x},
  renderParagraphCommentThread:()=>{},showToast:x=>toasts.push(x),
  localStorage:{getItem:k=>stored.has(k)?stored.get(k):null,setItem:(k,v)=>{if(denyWrite)throw Error('quota');stored.set(k,v);}},
  PhoneStorage:{getApiConfig:()=>({apiKey:'mock'}),getWorldbooks:()=>[]},
  PhoneAPI:{complete:opts=>{calls++;requests.push(opts);return new Promise((a,b)=>{resolve=a;reject=b;started?.();})}},
  Date,
 });
 c.window=c;
 vm.runInContext(source,c);
 c.syncCoReadControls=()=>{};
 c.updateReadingPreview=()=>{};
 c.loadCurrentReadingComment=async key=>cache[key]||null;
 function start(options){return c.generateParagraphComment(options);}
 async function waitForCall(){if(resolve)return;await new Promise(r=>{started=r;});}
 return {c,stored,saved,toasts,requests,cache,start,waitForCall,resolve:x=>{let r=resolve;resolve=null;r(x)},reject:x=>{let r=reject;resolve=null;r(x)},calls:()=>calls,deny:()=>{denyWrite=true}};
}
test('delayed reply stays bound to original book, paragraph and role',async()=>{
 const h=harness(),p=h.start();await h.waitForCall();
 h.c.activeParagraph=target('b',7);h.c.paragraphRoleSelect.value='r2';h.c.settings.commentRoleId='r2';
 await h.start();assert.equal(h.calls(),1);h.resolve('comment');await p;
 assert.equal(h.saved[0].id,'a|0|0|r1');assert.equal(h.c.paragraphRequest,null);
 assert.ok(!h.requests[0].user.includes('DO_NOT_SEND_FUTURE'));
});
test('account switch discards pending result',async()=>{
 const h=harness(),p=h.start();await h.waitForCall();h.c.account='account-b';h.resolve('comment');await p;
 assert.equal(h.saved.length,0);assert.equal(h.c.paragraphRequest,null);
});
test('budget write failure never calls API',async()=>{
 const h=harness();h.deny();await h.start();assert.equal(h.calls(),0);assert.equal(h.c.paragraphRequest,null);
});
test('failed requests consume budget and limit prevents further calls',async()=>{
 const h=harness(),key=h.c.coReadKey('coread',h.c.account);
 h.stored.set(key,JSON.stringify({auto:false,interval:180,limit:5}));
 for(let i=0;i<5;i++){const p=h.start();await h.waitForCall();h.reject(Error('offline'));await p;}
 await h.start();assert.equal(h.calls(),5);assert.equal(h.saved.length,0);
 assert.equal(h.c.coReadLedger(h.c.account,Date.now()).count,5);
});
test('automatic calls are opt-in, SKIP consumes budget and cannot repeat',async()=>{
 const h=harness(),opts={auto:true,target:target('a',0)};
 await h.start(opts);assert.equal(h.calls(),0);
 h.stored.set(h.c.coReadKey('coread',h.c.account),JSON.stringify({auto:true,interval:60,limit:5}));
 const p=h.start(opts);await h.waitForCall();h.resolve('SKIP');await p;
 await h.start(opts);assert.equal(h.calls(),1);assert.equal(h.saved.length,0);
});
test('discussion appends user and assistant turns without losing old comment',async()=>{
 const h=harness();let p=h.start();await h.waitForCall();h.resolve('first');await p;
 p=h.start({reply:'my view'});await h.waitForCall();h.resolve('reply');await p;
 assert.deepEqual(Array.from(h.saved[1].thread,m=>m.text),['first','my view','reply']);
});
test('worldbook context selects only current role bindings',()=>{
 const h=harness(),c=h.c;c.ChatContextPolicy={buildWorldbookInjectionText:books=>books.map(b=>b.id).join(',')};
 c.PhoneStorage.getWorldbooks=()=>[{id:'allowed'},{id:'other'}];
 assert.equal(c.readingWorldbook({id:'r1',worldBookIds:['allowed']},target('a',0),''),'allowed');
 h.stored.set('chat_worldbooks_r1',JSON.stringify([]));
 assert.equal(c.readingWorldbook({id:'r1',worldBookIds:['allowed']},target('a',0),''),'');
});

test('AI reads a saved personal comment without duplicating it in the role thread',async()=>{
 const h=harness();
 const key=h.c.ownReadingKey(h.c.activeParagraph,h.c.account);
 h.cache[key]={id:key,thread:[{role:'user',text:'我的段评',createdAt:1}]};
 const p=h.start();await h.waitForCall();
 assert.ok(h.requests[0].user.includes('我的段评'));
 h.resolve('角色回复');await p;
 assert.deepEqual(Array.from(h.saved[0].thread,m=>m.text),['角色回复']);
 assert.equal(h.cache[key].thread[0].text,'我的段评');
});
test('failed AI reply leaves independently saved personal comment untouched',async()=>{
 const h=harness();
 const key=h.c.ownReadingKey(h.c.activeParagraph,h.c.account);
 h.cache[key]={id:key,thread:[{role:'user',text:'离线也要保留',createdAt:1}]};
 const p=h.start();await h.waitForCall();h.reject(Error('offline'));await p;
 assert.equal(h.saved.length,0);assert.equal(h.cache[key].thread[0].text,'离线也要保留');
});

test('auto and manual comments use novel-reader context, never unrelated life history',async()=>{
 for(const automatic of [true,false]){
  const h=harness();
  h.c.PhoneStorage.getChatHistory=()=>{throw Error('unrelated chat must not be read');};
  h.c.PhoneStorage.getMemories=()=>{throw Error('unrelated memory must not be read');};
  h.stored.set(h.c.coReadKey('coread',h.c.account),JSON.stringify({auto:true,interval:60,limit:5}));
  const t={...target('a',0),bookName:'Fixture novel',chapterTitle:'Winter chapter',paragraph:'The snow fell outside the fictional inn.'};
  const p=h.start({auto:automatic,target:t});await h.waitForCall();
  const {system,user}=h.requests[0];
  assert.match(system,/一起阅读同一本小说/);
  assert.match(system,/不是小说中的人物/);
  assert.match(system,/禁止虚构自己的生活经历/);
  assert.match(system,/禁止剧透/);
  assert.match(user,/Fixture novel/);
  assert.match(user,/Winter chapter/);
  assert.match(user,/fictional inn/);
  assert.doesNotMatch(user,/DO_NOT_SEND_FUTURE|近期聊天：|角色记忆：/);
  h.resolve(automatic?'SKIP':'The setting feels bleak.');await p;
  assert.equal(h.calls(),1);
 }
});

test('recent bookshelf prioritizes the last opened imported or default book, preserves legacy progress, and omits deleted books',()=>{
 const start=html.indexOf('  function recentBookPicks('),end=html.indexOf('  function renderHome()',start);
 assert.ok(start>0&&end>start);
 const pick=vm.runInNewContext(html.slice(start,end)+'\nrecentBookPicks');
 const books=[{id:'b1'},{id:'b2'},{id:'b3'},{id:'imported'}];
 const progress={b1:{chapter:0,paragraph:0},b3:{lastReadAt:20},imported:{lastReadAt:30}};
 assert.deepEqual(Array.from(pick(books,id=>progress[id]),b=>b.id),['imported','b3','b1']);
 progress.b2={lastReadAt:40};
 assert.deepEqual(Array.from(pick(books,id=>progress[id]),b=>b.id),['b2','imported','b3']);
 assert.deepEqual(Array.from(pick(books.filter(b=>b.id!=='b2'),id=>progress[id]),b=>b.id),['imported','b3','b1']);
});
test('default book overrides preserve seed text, persist tombstones and isolate account tokens',()=>{
 const start=html.indexOf('  function seedShelfOverrideId('),end=html.indexOf('  function restoreLocalBooks()',start);
 assert.ok(start>0&&end>start);
 const seedBooks=[{id:'b1',chapters:[{paras:['original']}]},{id:'b2',chapters:[{paras:['keep']}]},{id:'b3',chapters:[]}];
 const c=vm.createContext({seedBooks});vm.runInContext(html.slice(start,end),c);
 const a='account-a',b='account-b';
 const records=[{id:c.seedShelfOverrideId(a,'b1'),readerShelfOverride:1,seedBookId:'b1',accountToken:a,hidden:true},{id:c.seedShelfOverrideId(a,'b2'),readerShelfOverride:1,seedBookId:'b2',accountToken:a,coverImage:'data:image/jpeg;base64,AAAA'}];
 const owned=c.applySeedShelfOverrides(records,a);
 assert.deepEqual(Array.from(owned,book=>book.id),['b2','b3']);
 assert.equal(owned[0].coverImage,records[1].coverImage);
 assert.equal(owned[0].chapters[0].paras[0],'keep');
 assert.deepEqual(Array.from(c.applySeedShelfOverrides(records,b),book=>book.id),['b1','b2','b3']);
 assert.equal(seedBooks[1].coverImage,undefined);
});

test('native touch swipe hides chrome and a stationary tap restores it without a synthesized click',()=>{
 const chrome=html.slice(html.indexOf('  function setReadingChrome('),html.indexOf('  function closeSheets()'));
 const touch=html.slice(html.indexOf('  var readerTouchStart=null,lastReadingTouchReveal=0;'),html.indexOf("  readerBody.addEventListener('wheel'"));
 let hidden=false,controls=false,now=10000;
 const handlers={};
 const c=vm.createContext({state:{book:{id:'b1'}},settings:{mode:'scroll'},readerView:{getAttribute:()=> 'false',classList:{toggle:(k,v)=>hidden=v,contains:()=>hidden}},readerControls:{classList:{toggle:(k,v)=>controls=v,contains:()=>controls}},sheetBackdrop:{classList:{contains:()=>false}},readerBody:{addEventListener:(k,fn)=>handlers[k]=fn},readingGestureMoved:false,paragraphHoldOpenedAt:0,Date:{now:()=>now},cancelParagraphHold:()=>{}});
 vm.runInContext(chrome+touch,c);
 const evt=(x,y,interactive=false)=>({touches:[{clientX:x,clientY:y}],changedTouches:[{clientX:x,clientY:y}],target:{closest:()=>interactive?{}:null}});
 for(const mode of ['scroll','smooth']){
  c.settings.mode=mode;
  handlers.touchstart(evt(100,150));handlers.touchmove(evt(70,100));handlers.touchend(evt(70,100));
  assert.equal(hidden,true);assert.equal(controls,false);
  now+=700;handlers.touchstart(evt(40,45));now+=70;handlers.touchend(evt(40,45));
  assert.equal(hidden,false);assert.equal(controls,true);
 }
 handlers.touchstart(evt(100,150));handlers.touchmove(evt(70,100));handlers.touchend(evt(70,100));
 now+=700;handlers.touchstart(evt(40,45,true));now+=70;handlers.touchend(evt(40,45,true));assert.equal(hidden,true);
 handlers.touchstart(evt(40,45));now+=600;handlers.touchend(evt(40,45));assert.equal(hidden,true);
});
