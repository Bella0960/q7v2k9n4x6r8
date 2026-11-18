import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url),'utf8');
const html = read('worldbook/settings/regex-settings.html');
const css = read('worldbook/settings/regex-editor.css');
const uiSource = read('worldbook/settings/regex-editor.js');
const engine = read('shared/js/phone/chat-regex-policy.js');
const bridge = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(m=>m[1]).find(s=>s.includes('var DEFAULT_RULES = ['));
assert.ok(bridge,'legacy storage contract remains available');

function fakeStorage(raw, failed = false) {
  const m=new Map();
  if(raw!==undefined)m.set('regex_rules',raw);
  return {
    getItem:k=>m.has(k)?m.get(k):null,
    setItem(k,v){
      if(failed)throw Error('QuotaExceededError');
      m.set(k,String(v));
    },
    removeItem:k=>m.delete(k),
    raw:()=>m.get('regex_rules')
  };
}
class Element {
  constructor(tag='div',id='') {
    this.tagName=tag.toUpperCase();this.id=id;this.children=[];
    this.events={};this.attributes={};this.className='';this.textContent='';
    this.value='';this.checked=false;this.disabled=false;
    this.style={};this.focused=false;
    const tokens = new Set();
    this.classList = {
      add:key=>tokens.add(key),remove:key=>tokens.delete(key),
      contains:key=>tokens.has(key),
      toggle:(key,force)=>{if(force===undefined? !tokens.has(key):force)tokens.add(key);else tokens.delete(key);}
    };
  }
  addEventListener(type,fn){this.events[type]=fn;}
  dispatch(type){if(this.events[type])return this.events[type]({target:this});}
  appendChild(node){this.children.push(node);return node;}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(k,v){this.attributes[k]=String(v);}
  getAttribute(k){return this.attributes[k]??null;}
  focus(){this.focused=true;}
}
function fixture(raw) {
  const localStorage=fakeStorage(raw),ids=new Map(),document={
    body:{style:{}},activeElement:null,
    getElementById(id) {
      if(!ids.has(id)) ids.set(id,new Element('div',id));
      return ids.get(id);
    },
    createElement(tag){return new Element(tag);},
    addEventListener(){},
    querySelectorAll(){return []}
  };
  const window={localStorage,confirm(){return true;},addEventListener(){}};
  new Function('window',engine)(window);
  const saved=new Function('window','localStorage',bridge+
    '\nreturn {DEFAULT_RULES,loadRules,saveRules};')(window,localStorage);
  new Function('window','document','localStorage','DEFAULT_RULES','loadRules','saveRules',
    uiSource)(window,document,localStorage,saved.DEFAULT_RULES,saved.loadRules,saved.saveRules);
  return {window,localStorage,document,saved,ui:window.RegexEditorUI,
    el:id=>document.getElementById(id)};
}
function switchFor(list,index=0){
  return list.children[index].children[0].children[1];
}
function editDeleteButtons(list,index=0) {
  const row=list.children[index],detail=row.children[1],inner=detail.children[1];
  const actions=inner.children[inner.children.length-1];
  return actions.children;
}

test('no saved rules: honest zero active status and uninstalled preset switches',()=>{
  const f=fixture();
  assert.deepEqual(f.ui.getStatus(),{invalid:false,active:0,raw:null});
  assert.match(f.el('statusText').textContent,/还没有保存任何规则/);
  assert.equal(f.el('customCount').textContent,'0');
  assert.equal(f.el('presetRules').children.length,7);
  assert.equal(switchFor(f.el('presetRules')).attributes['aria-checked'],'false');
  assert.equal(f.localStorage.raw(),undefined);
});
test('enabling one available preset persists only that preset',()=>{
  const f=fixture(),preset=f.el('presetRules');
  switchFor(preset).dispatch('click');
  const saved=JSON.parse(f.localStorage.raw());
  assert.equal(saved.length,1);
  assert.equal(saved[0].id,'r_builtin_codeblock');
  assert.equal(saved[0].enabled,true);
  assert.equal(f.ui.getStatus().active,1);
});
test('create custom rule does not silently enable seven built-ins',()=>{
  const f=fixture();
  f.ui.openEditor(null);
  f.el('editName').value='调整招呼';
  f.el('editPattern').value='你好';
  f.el('editReplacement').value='您好';
  f.el('editEnabled').checked=true;
  f.el('sheetSave').dispatch('click');
  const saved=JSON.parse(f.localStorage.raw());
  assert.equal(saved.length,1);
  assert.equal(saved[0].name,'调整招呼');
  assert.equal(saved[0].builtin,false);
  assert.equal(f.ui.getStatus().active,1);
});
test('editing custom rule preserves id and unknown legacy data fields',()=>{
  const initial=[{id:'legacy',name:'旧名称',pattern:'a',replacement:'b',
    enabled:true,builtin:false,legacyExtra:{source:'old'}}];
  const f=fixture(JSON.stringify(initial));
  f.ui.openEditor('legacy');
  f.el('editName').value='新名称';
  f.el('editPattern').value='你好';
  f.el('editReplacement').value='您好';
  f.el('sheetSave').dispatch('click');
  const saved=JSON.parse(f.localStorage.raw());
  assert.equal(saved[0].id,'legacy');
  assert.equal(saved[0].name,'新名称');
  assert.deepEqual(saved[0].legacyExtra,{source:'old'});
});
test('custom deletion requires confirmation and cannot remove unrelated rules',()=>{
  const original=[
    {id:'a',name:'一',pattern:'a',replacement:'x',enabled:true,builtin:false},
    {id:'b',name:'二',pattern:'b',replacement:'y',enabled:true,builtin:false}
  ];
  const f=fixture(JSON.stringify(original));
  const buttons=editDeleteButtons(f.el('customRules'));
  buttons[1].dispatch('click');
  assert.deepEqual(JSON.parse(f.localStorage.raw()).map(r=>r.id),['b']);
});
test('another tab changing storage cancels stale edit and retains new data',()=>{
  const initial=[{id:'x',name:'x',pattern:'x',replacement:'y',enabled:true,builtin:false}];
  const f=fixture(JSON.stringify(initial));
  const elsewhere=[...initial,{id:'remote',name:'remote',pattern:'a',enabled:true}];
  f.localStorage.setItem('regex_rules',JSON.stringify(elsewhere));
  switchFor(f.el('customRules')).dispatch('click');
  assert.deepEqual(JSON.parse(f.localStorage.raw()),elsewhere);
  assert.match(f.el('notify').textContent,/另一个窗口/);
});
test('preview uses saved active rules and explains changed rules',()=>{
  const initial=[{id:'name',name:'替换称呼',pattern:'你好',replacement:'您好',
    enabled:true,builtin:false}];
  const f=fixture(JSON.stringify(initial));
  f.el('previewInput').value='你好，今天怎么样？';
  f.el('previewRun').dispatch('click');
  assert.equal(f.el('previewOutput').textContent,'您好，今天怎么样？');
  assert.match(f.el('previewTrace').textContent,/替换称呼/);
  assert.equal(f.localStorage.raw(),JSON.stringify(initial));
});
test('unreadable saved JSON blocks add/toggle and never overwrites raw bytes',()=>{
  const f=fixture('{invalid');
  assert.equal(f.ui.getStatus().invalid,true);
  assert.equal(f.el('createRuleBtn').disabled,true);
  assert.equal(f.localStorage.raw(),'{invalid');
  assert.equal(f.el('presetRules').children.length,7);
  assert.equal(switchFor(f.el('presetRules')).disabled,true);
});
test('UI syntax, direct native viewport and no simulated phone/statusbar',()=>{
  new Script(uiSource);
  new Script(engine);
  new Script(bridge);
  assert.match(html,/<main class="shell">/);
  assert.match(html,/id="previewInput"/);
  assert.match(html,/id="customRules"/);
  assert.match(html,/id="presetRules"/);
  assert.match(html,/id="createRuleBtn"/);
  assert.match(html,/regex-editor\.css/);
  assert.match(html,/regex-editor\.js/);
  assert.doesNotMatch(html,/class="phone-mockup"|class="status-bar"/);
  assert.doesNotMatch(css,/\.phone-mockup\s*\{|\.status-bar\s*\{/);
  assert.match(css,/@media \(max-width:375px\)/);
});
