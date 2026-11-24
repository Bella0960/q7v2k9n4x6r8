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
  activeParagraph:target('a',0),paragraphRequest:null,paragraphRoleSelect:{value:'r1'},settings:{commentRoleId:'r1',comments:true},
  state:{book:{id:'a'},ch:0},document:{hidden:false,getElementById:()=>input},
  readerView:{getAttribute:()=> 'false'},sheetBackdrop:{classList:{contains:()=>false}},
  navigator:{locks:{request:async(name,options,fn)=>fn({})}},
  readerRoleById:id=>({id,name:id,worldBookIds:[]}),readerAccountToken:()=>c.account,account:'account-a',
  findBook:id=>({id}),commentKey:(...a)=>a.join('|'),commentCache:cache,
  getParagraphComment:(...a)=>cache[a.join('|')],saveReaderComment:async x=>{saved.push(x);cache[x.id]=x},
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
