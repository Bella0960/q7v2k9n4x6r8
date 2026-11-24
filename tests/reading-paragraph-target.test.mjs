import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../library/library.html',import.meta.url),'utf8');
const fn=html.slice(html.indexOf('  async function generateParagraphComment()'),html.indexOf('  /* ===== 阅读器：章节渲染'));
const target=(bookId,paragraphIndex)=>({bookId,bookName:bookId,chapterIndex:0,chapterTitle:'Chapter',paragraphIndex,paragraph:'Original '+paragraphIndex,previous:'',next:''});
function harness(){
 let resolve,reject,calls=0; const saved=[],toasts=[];
 const c=vm.createContext({activeParagraph:target('a',0),paragraphRequest:null,paragraphRoleSelect:{value:'r1'},rsCommentRole:{},settings:{},generateParagraphCommentBtn:{},state:{book:{id:'a'},ch:0},paragraphSheet:{classList:{contains:()=>true}},readerRoleById:id=>({name:id}),readerAccountToken:()=>c.account,account:'a',findBook:id=>({id}),commentKey:(...a)=>a.join('|'),saveReaderSettings:()=>true,saveReaderComment:async x=>{saved.push(x)},renderParagraphCommentThread:()=>{},refreshReaderParagraphs:()=>{},showToast:x=>toasts.push(x),PhoneStorage:{getApiConfig:()=>({apiKey:'mock'})},PhoneAPI:{complete:()=>{calls++;return new Promise((a,b)=>{resolve=a;reject=b;})}},Date});
 c.window=c;
 vm.runInContext(fn,c);
 return {c,saved,toasts,resolve:x=>resolve(x),reject:x=>reject(x),calls:()=>calls};
}
test('switch paragraph, book and role while request pending; duplicate request blocked',async()=>{
 const h=harness(), p=h.c.generateParagraphComment();
 h.c.activeParagraph=target('b',7); h.c.paragraphRoleSelect.value='r2'; h.c.settings.commentRoleId='r2';
 await h.c.generateParagraphComment(); assert.equal(h.calls(),1);
 h.resolve('comment'); await p;
 assert.equal(h.saved.length,1); assert.equal(h.saved[0].id,'a|0|0|r1'); assert.equal(h.c.paragraphRequest,null);
});
test('account switch discards pending result',async()=>{
 const h=harness(),p=h.c.generateParagraphComment();h.c.account='b';h.resolve('comment');await p;
 assert.equal(h.saved.length,0);assert.equal(h.c.paragraphRequest,null);
});
test('failure releases request lock and preserves old comments',async()=>{
 const h=harness(),p=h.c.generateParagraphComment();h.reject(new Error('offline'));await p;
 assert.equal(h.saved.length,0);assert.equal(h.c.paragraphRequest,null);
 const retry=h.c.generateParagraphComment();h.resolve('retry');await retry;assert.equal(h.saved.length,1);
});
