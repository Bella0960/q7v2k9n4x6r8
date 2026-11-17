/**
 * 无浏览器依赖的「邂逅」交互事件回归。
 * 执行：node --test tests/encounter-ui-contract.test.mjs
 * 这是模拟 DOM 事件测试；真实浏览器视觉仍需 tests/encounter-browser.mjs。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const engineSource=fs.readFileSync(new URL('../encounter/encounter-engine.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../encounter/encounter.html',import.meta.url),'utf8');
const match=html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match,'抽卡页面必须保留实际的内联交互脚本');
const uiSource=match[1];

test('全局禁用假状态栏：邂逅不能自绘系统时间、信号、电量', () => {
  assert.doesNotMatch(html, /\b(?:deviceTime|status-bar|status-marks)\b/,
    '页面源码不应保留隐藏的模拟系统状态栏');
  assert.doesNotMatch(uiSource, /setInterval\(clock|function clock\(/,
    '不应继续运行绘制假时间的计时器');
  assert.match(html, /env\(safe-area-inset-top,0px\)/,
    '手机顶部必须为真正的系统安全区预留空间');
  assert.match(html, /env\(safe-area-inset-bottom,0px\)/,
    '底部操作区必须兼容真实系统手势安全区');
});

test('邂逅浏览器冒烟测试与正式账号发布门禁分离', () => {
  const browserSource=fs.readFileSync(new URL('./encounter-browser.mjs',import.meta.url),'utf8');
  const gateSource=fs.readFileSync(new URL('../scripts/verify-encounter-release.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(browserSource, /for\(const required of \[[^\]]*account\/index\.html/,
    'localhost 冒烟测试不得因账号页尚未整合而提前退出');
  assert.match(gateSource, /requireFile\('account\/index\.html'/,
    '正式发布门禁必须继续验证账号页');
  assert.match(gateSource, /requireFile\('account\/account\.js'/,
    '正式发布门禁必须继续验证账号脚本');
});

test('发布门禁识别安全账号注入脚本 v2 和 v3，拒绝缺失保护标记', () => {
  const gateSource=fs.readFileSync(new URL('../scripts/verify-encounter-release.mjs',import.meta.url),'utf8');
  const workerSource=fs.readFileSync(new URL('../worker.js',import.meta.url),'utf8');
  const line=gateSource.split('\n').find(row=>row.startsWith("requirePattern('worker.js',"));
  assert.ok(line,'发布门禁必须包含 Worker 账号作用域检查');
  const from=line.indexOf("requirePattern('worker.js',")+"requirePattern('worker.js',".length;
  const to=line.indexOf(",'Worker",from);
  assert.ok(to>from,'发布门禁必须保留明确的 Worker 注入检查描述');
  const pattern=vm.runInThisContext(line.slice(from,to));
  assert.match(workerSource,pattern,'原账号注入代码必须匹配发布检查');
  const nextVersion=workerSource.replace(/scope\.js\?v=[1-9]\d*/, 'scope.js?v=3');
  assert.match(nextVersion,pattern,'账号版本升级到 v3 不能错误拦截已保护的页面');
  assert.doesNotMatch(nextVersion.replace(' data-mao-account-scope',''),pattern,
    '缺少账号保护标记必须拒绝');
  assert.doesNotMatch(nextVersion.replace('scope.js?v=3','scope.js?v=invalid'),pattern,
    '无效账号脚本版本必须拒绝');
});

function setup(initial={}) {
  const rows=new Map(Object.entries(initial));
  const localStorage={
    get length(){return rows.size;},
    key(index){return [...rows.keys()][index]??null;},
    getItem(key){return rows.has(key)?rows.get(key):null;},
    setItem(key,value){rows.set(key,String(value));},
    removeItem(key){rows.delete(key);}
  };
  const window={
    localStorage, innerWidth:390, location:{},listeners:{},
    dispatchEvent(){},
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  };
  let document;
  class FakeEl {
    constructor(id){
      this.id=id;this.handlers={};this.style={};this.attrs={};this.dataset={};
      this.textContent='';this.innerHTML='';this.value='';
      const c=new Set();
      this.classList={add(...names){names.forEach(n=>c.add(n));},remove(...names){names.forEach(n=>c.delete(n));},contains(n){return c.has(n);}};
    }
    addEventListener(type,fn){(this.handlers[type]??=[]).push(fn);}
    fire(type,props={}){
      const event={button:0,pointerId:1,clientX:100,clientY:200,preventDefault(){},...props};
      for(const fn of (this.handlers[type]||[]))fn.call(this,event);
    }
    setAttribute(k,v){this.attrs[k]=String(v);}
    getAttribute(k){return this.attrs[k];}
    setPointerCapture(){}
    querySelector(selector){
      if(['[data-return-collection]','[data-reunion-profile]','[data-reunion-chat]'].includes(selector)){
        if(!this.reunionActionCache || this.reunionActionHtml!==this.innerHTML){
          this.reunionActionHtml=this.innerHTML;this.reunionActionCache={};
        }
        if(!this.reunionActionCache[selector])this.reunionActionCache[selector]=new FakeEl(selector);
        return this.reunionActionCache[selector];
      }
      if(selector==='[data-mask-next]'||selector==='[data-mask-reveal]'){
        if(!this.maskActions || this.maskActionSource!==this.innerHTML){
          this.maskActionSource=this.innerHTML;this.maskActions={};
        }
        if(!this.maskActions[selector])this.maskActions[selector]=
          this.innerHTML.includes(selector==='[data-mask-next]'?'data-mask-next':'data-mask-reveal')
          ? new FakeEl(selector):null;
        return this.maskActions[selector];
      }
      if(selector==='[data-object-reveal]'){
        if(this.objectRevealSource!==this.innerHTML){
          this.objectRevealSource=this.innerHTML;
          this.objectRevealButton=new FakeEl('object-reveal');
        }
        return this.objectRevealButton;
      }
      if(selector==='[data-blind-reveal]'){
        if(this.blindRevealSource!==this.innerHTML){
          this.blindRevealSource=this.innerHTML;
          this.blindRevealButton=new FakeEl('blind-reveal');
        }
        return this.blindRevealButton;
      }
      return new FakeEl('close');
    }
    querySelectorAll(selector){
      if(selector==='[data-preview]'||selector==='[data-fate]'){
        if(!this.storyCache || this.storyCacheHtml!==this.innerHTML){
          this.storyCacheHtml=this.innerHTML;this.storyCache={};
        }
        if(!this.storyCache[selector]){
          const attr=selector==='[data-preview]'?'preview':'fate';
          const re=new RegExp('data-'+attr+'="([^"]+)"','g');
          this.storyCache[selector]=[...this.innerHTML.matchAll(re)].map(m=>{
            const el=new FakeEl(attr);
            if(attr==='preview')el.dataset.preview=m[1];
            else el.dataset.fate=m[1];
            return el;
          });
        }
        return this.storyCache[selector];
      }
      if(selector==='[data-reunion]' || selector==='[data-reunion-scene]'){
        // 相同 HTML 片段返回同一批节点，才能真实模拟 addEventListener。
        if(!this.reunionCache || this.reunionCacheHtml!==this.innerHTML){
          this.reunionCacheHtml=this.innerHTML;this.reunionCache={};
        }
        if(!this.reunionCache[selector]){
          const attr=selector==='[data-reunion]'?'reunion':'reunion-scene';
          const re=new RegExp('data-'+attr+'="([^"]+)"','g');
          this.reunionCache[selector]=[...this.innerHTML.matchAll(re)].map(m=>{
            const item=new FakeEl(attr);
            if(attr==='reunion')item.dataset.reunion=m[1];
            else item.dataset.reunionScene=m[1];
            return item;
          });
        }
        return this.reunionCache[selector];
      }
      if(selector==='[data-object-choice]'){
        if(this.objectChoicesSource!==this.innerHTML){
          this.objectChoicesSource=this.innerHTML;
          this.objectChoiceButtons=[...this.innerHTML.matchAll(/data-object-choice="([^"]+)"/g)].map(m=>{
            const item=new FakeEl('object-choice');item.dataset.objectChoice=m[1];return item;
          });
        }
        return this.objectChoiceButtons;
      }
      if(selector==='[data-blind-choice]'){
        // 模拟真正 DOM：同一轮 innerHTML 的查询必须返回同一批已绑定事件的节点。
        if(this.blindChoicesSource!==this.innerHTML){
          this.blindChoicesSource=this.innerHTML;
          this.blindChoiceButtons=[...this.innerHTML.matchAll(/data-blind-choice="([^"]+)"/g)].map(m=>{
            const item=new FakeEl('choice');item.dataset.blindChoice=m[1];return item;
          });
        }
        return this.blindChoiceButtons;
      }
      return [];
    }
    focus(){document.activeElement=this;}
  }
  const elements=new Map();
  document={
    activeElement:null,
    getElementById(id){if(!elements.has(id))elements.set(id,new FakeEl(id));return elements.get(id);},
    contains(){return true;}
  };
  let timers=[];
  const setTimeoutMock=fn=>{timers.push(fn);return timers.length;};
  const clearTimeoutMock=()=>{};
  const flush=()=>{const pending=timers;timers=[];for(const fn of pending)fn();};
  const globals={window,document,HTMLElement:FakeEl,Math,Set,Date,JSON,String,Array,Object,Number,Uint32Array,
    CustomEvent:class{},setTimeout:setTimeoutMock,clearTimeout:clearTimeoutMock,setInterval:()=>1};
  vm.runInNewContext(engineSource,globals);
  vm.runInNewContext(uiSource,globals);
  return {window,document,rows,localStorage,el:id=>elements.get(id),flush};
}

test('轻滑回弹不能触发人物档案，下一次真实点击应立刻可用',()=>{
  const h=setup();
  const card=h.el('frontCard'),overlay=h.el('overlay');
  const before=card.innerHTML;
  card.fire('pointerdown');
  card.fire('pointermove',{clientX:144,clientY:202});
  card.fire('pointerup',{clientX:144,clientY:202});
  card.fire('click'); // 浏览器补发的合成 click
  assert.equal(overlay.classList.contains('open'),false,'不可误开详情');
  assert.equal(card.innerHTML,before,'轻滑回弹不换人物');
  card.fire('pointerdown'); // 新的一次正常点击，必须清理滑动抑制
  card.fire('pointerup');
  card.fire('click');
  assert.equal(overlay.classList.contains('open'),true,'下一次正常点击不得被 480ms 阻挡');
});

test('点收藏才生成候选且换卡，不修改原角色列表',async ()=>{
  const original='[{"id":"old","name":"原角色","persona":"保留原文"}]';
  const h=setup({'ai_custom_characters':original});
  assert.match(h.el('frontCard').innerHTML,/class="name"/);
  h.el('likeButton').fire('click');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.window.MAOMAOEncounter.getCandidates().value.length,1);
  assert.equal(h.rows.get('ai_custom_characters'),original);
  h.flush();
  assert.equal(h.el('savedCount').textContent,'01');
});

test('候选保存失败不假成功，也不偷偷换掉当前卡片',async ()=>{
  const h=setup();
  const before=h.el('frontCard').innerHTML;
  h.localStorage.setItem=()=>{throw new Error('QuotaExceededError');};
  h.el('likeButton').fire('click');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.window.MAOMAOEncounter.getCandidates().value.length,0);
  assert.equal(h.el('frontCard').innerHTML,before);
  assert.match(h.el('notice').textContent,/收藏失败/);
});


test('两位候选都是真实独立卡片，切换不会丢失任何一位',async ()=>{
  const h=setup({'maomao_encounter_preferences_v1':'{"type":"普通相遇"}'});
  const card=h.el('frontCard');
  function shownName(){
    const matched=card.innerHTML.match(/<h2 class="name">([^<]+)<\/h2>/);
    return matched?matched[1]:'';
  }
  const first=shownName();
  assert.ok(first,'第一张人物卡应有真实姓名');
  assert.match(h.el('swapButton').textContent,/另一位/);
  h.el('swapButton').fire('click');
  const second=shownName();
  assert.ok(second && first!==second,'另一位候选的姓名必须不同');
  h.el('likeButton').fire('click');
  await new Promise(resolve=>setImmediate(resolve));
  h.flush();
  assert.equal(shownName(),first,'收藏第二位后第一位应仍然存在');
  const saved=h.window.MAOMAOEncounter.getCandidates();
  assert.equal(saved.ok,true);
  assert.equal(saved.value.length,1);
  assert.equal(saved.value[0].name,second);
  h.el('likeButton').fire('click');
  await new Promise(resolve=>setImmediate(resolve));
  h.flush();
  const both=h.window.MAOMAOEncounter.getCandidates().value;
  assert.equal(both.length,2,'两位可以分别收藏');
  assert.ok(both.some(c=>c.name===first));
  assert.ok(both.some(c=>c.name===second));
});

test('左滑只跳过人物，不创建收藏',()=>{
  const h=setup();
  const card=h.el('frontCard');
  card.fire('pointerdown');
  card.fire('pointermove',{clientX:-20,clientY:200});
  card.fire('pointerup',{clientX:-20,clientY:200});
  h.flush();
  assert.equal(h.window.MAOMAOEncounter.getCandidates().value.length,0);
  assert.equal(h.el('cardSequence').textContent,'02 / ∞');
});

test('性格盲测先猜再揭晓，未选前不泄露姓名，猜测不更改收藏或正式角色',()=>{
  const existing = '[{"id":"existing","name":"原角色","persona":"原样保留"}]';
  const h=setup({
    'ai_custom_characters':existing,
    'maomao_encounter_preferences_v1':'{"type":"性格盲测"}'
  });
  const card=h.el('frontCard');
  assert.match(card.innerHTML,/一段陌生的声音/);
  card.fire('click');
  const sheet=h.el('sheet');
  assert.match(sheet.innerHTML,/选择你的第一印象/);
  assert.doesNotMatch(sheet.innerHTML,/姓名<\/span>/,'盲测前不能直接显示姓名');
  const choices=sheet.querySelectorAll('[data-blind-choice]');
  assert.equal(choices.length,3);
  choices[0].fire('click');
  assert.match(sheet.innerHTML,/人物档案/);
  assert.match(sheet.innerHTML,/你的第一印象|你原以为/);
  assert.match(sheet.innerHTML,/内在反差/);
  assert.equal(h.localStorage.getItem('ai_custom_characters'),existing);
  assert.equal(h.window.MAOMAOEncounter.getCandidates().value.length,0);
});



test('已相识人物支持再次相遇的三条分支，主动选择才进入原聊天，保存内容不动',()=>{
  const met={id:'role_enc_memo',name:'顾清越',persona:'旧人设不得改写',encounterOrigin:{
    version:1,sourceCandidateId:'enc_memo',era:'西方奇幻',
    job:'档案员',object:'一本旧书',originalFate:'正在寻找旧友'
  }};
  const value=JSON.stringify([{id:'old',name:'旧角色',persona:'保留'},met]);
  const h=setup({'ai_custom_characters':value});
  h.el('savedButton').fire('click');
  const sheet=h.el('sheet');
  assert.match(sheet.innerHTML,/已相识/);
  const reopen=sheet.querySelectorAll('[data-reunion]');
  assert.equal(reopen.length,1,'已相识只应列出一位符合来源的角色');
  reopen[0].fire('click');
  assert.match(sheet.innerHTML,/再次相遇/);
  assert.match(sheet.innerHTML,/档案员/,'默认先展示日常偶遇');
  const options=sheet.querySelectorAll('[data-reunion-scene]');
  assert.equal(options.length,3);
  options[1].fire('click');
  assert.match(sheet.innerHTML,/旧书/,'明确选择旧物线索后展示人物物件');
  sheet.querySelectorAll('[data-reunion-scene]')[2].fire('click');
  assert.match(sheet.innerHTML,/命运回声/);
  assert.match(sheet.innerHTML,/寻找旧友/);
  assert.match(sheet.innerHTML,/aria-pressed="true">命运回声/);
  assert.equal(h.window.location.href,undefined,'预览不得自动打开聊天');
  assert.equal(h.localStorage.getItem('ai_custom_characters'),value);
  assert.equal(h.window.MAOMAOEncounter.getCandidates().value.length,0);
  sheet.querySelector('[data-reunion-chat]').fire('click');
  assert.match(h.window.location.href,/chat-detail\.html\?v=.*&id=role_enc_memo$/);
  assert.equal(h.localStorage.getItem('ai_custom_characters'),value);
});

test('再遇界面打开后角色被删除或当前账号不可读，点击聊天应拒绝旧入口',()=>{
  const met={id:'role_enc_gone',name:'原角色',encounterOrigin:{
    version:1,sourceCandidateId:'enc_gone'
  }};
  const h=setup({'ai_custom_characters':JSON.stringify([met])});
  h.el('savedButton').fire('click');
  const sheet=h.el('sheet');
  sheet.querySelectorAll('[data-reunion]')[0].fire('click');
  h.localStorage.setItem('ai_custom_characters','[]');
  sheet.querySelector('[data-reunion-chat]').fire('click');
  assert.equal(h.window.location.href,undefined,'删除角色后不能继续进入失效聊天');
  assert.match(h.el('notice').textContent,/当前角色库/);
});


test('以物识人先猜职业后揭晓，失败不篡改旧角色或候选收藏',()=>{
  const original='[{"id":"old","name":"原角色","persona":"全部保留"}]';
  const h=setup({'ai_custom_characters':original,
    'maomao_encounter_preferences_v1':'{"type":"以物识人"}'});
  const cover=h.el('frontCard'),sheet=h.el('sheet');
  assert.match(cover.innerHTML,/失主未详/);
  cover.fire('click');
  assert.match(sheet.innerHTML,/以物识人/);
  assert.match(sheet.innerHTML,/你猜 TA 的身份是/);
  assert.doesNotMatch(sheet.innerHTML,/class="sheet-row"/,'猜测前不得泄露姓名或身份');
  const options=sheet.querySelectorAll('[data-object-choice]');
  assert.equal(options.length,3);
  options[0].fire('click');
  assert.match(sheet.innerHTML,/人物档案/);
  assert.match(sheet.innerHTML,/class="sheet-row"/);
  assert.match(sheet.innerHTML,/你猜对了|你猜 TA 是/);
  assert.equal(h.localStorage.getItem('ai_custom_characters'),original);
  assert.equal(h.window.MAOMAOEncounter.getCandidates().value.length,0);
});
test('以物识人可以直接揭晓，不要求猜测也不改角色',()=>{
  const h=setup({'maomao_encounter_preferences_v1':'{"type":"以物识人"}'});
  h.el('frontCard').fire('click');
  const sheet=h.el('sheet');
  assert.match(sheet.innerHTML,/直接揭晓/);
  sheet.querySelector('[data-object-reveal]').fire('click');
  assert.match(sheet.innerHTML,/人物档案/);
  assert.doesNotMatch(sheet.innerHTML,/你猜对了|你猜 TA 是/);
  assert.equal(h.window.MAOMAOEncounter.getCandidates().value.length,0);
});


test('蒙面档案逐条展开线索，最后手动揭晓，未揭晓前不泄露完整身份',()=>{
  const original='[{"id":"old","name":"旧角色","persona":"保持不变"}]';
  const h=setup({'ai_custom_characters':original,
    'maomao_encounter_preferences_v1':'{"type":"蒙面档案"}'});
  const cover=h.el('frontCard'),sheet=h.el('sheet');
  assert.match(cover.innerHTML,/未署名的旅人/);
  assert.match(cover.innerHTML,/逐步寻迹/);
  cover.fire('click');
  assert.match(sheet.innerHTML,/线索 00 \/ 03/);
  assert.doesNotMatch(sheet.innerHTML,/class="sheet-row"/);
  for(let i=1;i<=3;i++){
    const next=sheet.querySelector('[data-mask-next]');
    assert.ok(next,'第 '+i+' 次仍能展开');
    next.fire('click');
    assert.match(sheet.innerHTML,new RegExp('线索 0'+i+' / 03'));
    assert.doesNotMatch(sheet.innerHTML,/class="sheet-row"/,'展开线索不能揭晓人设');
  }
  assert.equal(sheet.querySelector('[data-mask-next]'),null);
  assert.match(sheet.innerHTML,/随身之物/);
  assert.match(sheet.innerHTML,/身份轮廓/);
  sheet.querySelector('[data-mask-reveal]').fire('click');
  assert.match(sheet.innerHTML,/人物档案/);
  assert.match(sheet.innerHTML,/姓名<\/span>/);
  assert.equal(h.localStorage.getItem('ai_custom_characters'),original);
  assert.equal(h.window.MAOMAOEncounter.getCandidates().value.length,0);
});
test('蒙面档案可直接揭晓，不强制展开三个线索',()=>{
  const h=setup({'maomao_encounter_preferences_v1':'{"type":"蒙面档案"}'});
  h.el('frontCard').fire('click');
  const sheet=h.el('sheet');
  sheet.querySelector('[data-mask-reveal]').fire('click');
  assert.match(sheet.innerHTML,/姓名<\/span>/);
  assert.equal(h.window.MAOMAOEncounter.getCandidates().value.length,0);
});


test('收藏命运分支连续双击不同选项仅保存一次，成功后重新打开仍是确认的选项',async()=>{
  const h=setup({'maomao_encounter_preferences_v1':'{"type":"命运分支"}'});
  const api=h.window.MAOMAOEncounter;
  const card=api.generate().value;
  assert.equal(card.type,'命运分支');
  assert.equal(api.saveCandidate(card).ok,true);
  h.el('savedButton').fire('click');
  const sheet=h.el('sheet');
  const preview=sheet.querySelectorAll('[data-preview]');
  assert.equal(preview.length,1);
  preview[0].fire('click');
  const options=sheet.querySelectorAll('[data-fate]');
  assert.equal(options.length,2);
  let resume,requests=0;
  h.window.navigator={locks:{request(name,params,fn){
    requests++;
    return new Promise(resolve=>{resume=()=>resolve(fn());});
  }}};
  options[0].fire('click');
  options[1].fire('click');
  assert.equal(requests,1,'未完成的保存期间另一条选择不得再次排队');
  assert.ok(options.every(b=>b.disabled),'等待时应禁用全部分支按钮');
  resume();
  await new Promise(resolve=>setImmediate(resolve));
  const persisted=api.getCandidates().value.find(c=>c.id===card.id);
  assert.equal(persisted.selectedChoice,options[0].dataset.fate);
  assert.match(sheet.innerHTML,/selected/);
  h.el('savedButton').fire('click');
  sheet.querySelectorAll('[data-preview]')[0].fire('click');
  assert.match(sheet.innerHTML,/故事起点/);
  assert.equal(api.getCandidates().value.find(c=>c.id===card.id).selectedChoice,
    options[0].dataset.fate,'重新进入收藏仍应显示刚确认的命运分支');
});

test('收藏命运保存排队时关闭弹层，旧回调不得重新弹出已关闭的档案',async()=>{
  const h=setup({'maomao_encounter_preferences_v1':'{"type":"命运分支"}'});
  const api=h.window.MAOMAOEncounter;
  const card=api.generate().value;
  assert.equal(api.saveCandidate(card).ok,true);
  h.el('savedButton').fire('click');
  const sheet=h.el('sheet');
  sheet.querySelectorAll('[data-preview]')[0].fire('click');
  let resume;
  h.window.navigator={locks:{request(name,options,fn){
    return new Promise(resolve=>{resume=()=>resolve(fn());});
  }}};
  sheet.querySelectorAll('[data-fate]')[0].fire('click');
  for(const fn of (h.window.listeners.keydown||[]))
    fn({key:'Escape',preventDefault(){}});
  assert.equal(h.el('overlay').classList.contains('open'),false);
  resume();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.el('overlay').classList.contains('open'),false,
    '保存完成不能把用户主动关闭的档案再次打开');
  assert.ok(api.getCandidates().value.some(c=>c.id===card.id),
    '成功保存的候选仍可从收藏重新打开');
});
