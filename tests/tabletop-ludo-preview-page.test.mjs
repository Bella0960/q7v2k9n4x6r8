import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mountLudoPreview} from './tabletop-preview/ludo-preview-page.js';

class El {
  constructor(doc){this.ownerDocument=doc;this.children=[];this.style={};this.events={};this.hidden=false;this.value='';this.classList={add:c=>{this.className+=' '+c;}};}
  setAttribute(){} append(...items){this.children.push(...items);for(const x of items)x.parent=this;}
  replaceChildren(...items){this.children=[];this.append(...items);}
  addEventListener(k,fn){this.events[k]=fn;}
  remove(){this.parent.children=this.parent.children.filter(x=>x!==this);}
  emit(k){if(k==='click'&&this.disabled)return;return this.events[k]?.({preventDefault(){}});}
}
function fixture(){
  const ids='setup game start end resume preview-status chat messages message-form message chat-status selection-count board discuss stop-speech speaker'.split(' ');
  const doc={createElement:()=>new El(doc),getElementById:id=>elements[id]},elements=Object.fromEntries(ids.map(id=>[id,new El(doc)]));
  const selected=[{value:'fixture-1',checked:true},{value:'fixture-2',checked:false}];
  elements.setup.querySelectorAll=()=>selected.filter(x=>x.checked);
  elements.game.hidden=true;let confirmations=0;
  const win={confirm:()=>{confirmations++;return true;},addEventListener(){}};
  return {doc,win,elements,selected,confirmations:()=>confirmations};
}
const all=(e,cls)=>[...(e.className?.split(' ').includes(cls)?[e]:[]),...e.children.flatMap(c=>all(c,cls))];
const tick=()=>new Promise(r=>setImmediate(r));
test('preview selection, start, real roll, chat feedback and reset work together',async()=>{
  const f=fixture(),e=f.elements;mountLudoPreview({doc:f.doc,win:f.win,delay:0,rollDie:()=>6});
  assert.match(e['selection-count'].textContent,/2 人局/);
  f.selected[0].checked=false;e.setup.emit('change');assert.equal(e.start.disabled,true);
  f.selected[1].checked=true;e.setup.emit('change');assert.equal(e.start.disabled,false);
  e.start.emit('click');assert.equal(e.game.hidden,false);assert.equal(e.setup.hidden,true);
  all(e.board,'mao-ludo__action')[0].emit('click');await tick();
  assert.equal(all(e.board,'mao-ludo__action').length,4);
  e['preview-status'].textContent='回合提示';e['message-form'].emit('submit');
  assert.match(e['chat-status'].textContent,/未发送/);assert.equal(e['preview-status'].textContent,'回合提示');
  e.message.value='本局测试';e['message-form'].emit('submit');assert.equal(e.messages.children.length,1);assert.equal(e['chat-status'].textContent,'');
  e.end.emit('click');assert.equal(f.confirmations(),1);assert.equal(e.game.hidden,true);assert.equal(e.messages.children.length,0);assert.equal(e.start.disabled,false);
  e.start.emit('click');assert.equal(e.game.hidden,false);assert.equal(e.messages.children.length,0);
  assert.equal(all(e.board,'mao-ludo__action').length,1);
});

test('preview discussion button shows multiple local speaker identities and does not require AI',async()=>{
  const f=fixture(),e=f.elements;f.selected[1].checked=true;
  mountLudoPreview({doc:f.doc,win:f.win,delay:0,rollDie:()=>6});e.start.emit('click');
  e.discuss.emit('click');
  for(let i=0;i<20&&e.discuss.disabled;i++)await tick();
  assert.equal(e.discuss.disabled,false);assert.equal(e['stop-speech'].hidden,true);
  assert.equal(e.messages.children.length,2);
  assert.match(e.messages.children[0].textContent,/测试棋手 1：/);assert.match(e.messages.children[1].textContent,/测试棋手 2：/);
  e.end.emit('click');assert.equal(e.messages.children.length,0);
});
