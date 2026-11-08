import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const F=require('../shared/js/chat-theme-package-format.js');
function crc32(b){let c=~0;for(let i=0;i<b.length;i++){c^=b[i];for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^~0)>>>0}
function u16(v){return[v&255,v>>>8&255]}function u32(v){return[v&255,v>>>8&255,v>>>16&255,v>>>24&255]}
function zip(files){const e=new TextEncoder(),parts=[],central=[];let offset=0;for(const f of files){const n=e.encode(f.name),d=f.data instanceof Uint8Array?f.data:e.encode(String(f.data)),c=crc32(d);const l=new Uint8Array([...u32(0x04034b50),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0),...u32(c),...u32(d.length),...u32(d.length),...u16(n.length),...u16(0),...n]);parts.push(l,d);central.push(new Uint8Array([...u32(0x02014b50),...u16(20),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0),...u32(c),...u32(d.length),...u32(d.length),...u16(n.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset),...n]));offset+=l.length+d.length}const size=central.reduce((n,x)=>n+x.length,0),end=new Uint8Array([...u32(0x06054b50),...u16(0),...u16(0),...u16(central.length),...u16(central.length),...u32(size),...u32(offset),...u16(0)]);return Buffer.concat([...parts,...central,end].map(Buffer.from))}
function fixture(overrides={}){return{format:F.FORMAT,schemaVersion:F.VERSION,target:'maomao-chat',id:'test-theme',name:'测试聊天主题',pages:{chatList:[{id:'statusBar'},{id:'bottomNav'}],chatDetail:[{id:'detailHeader'},{id:'sentBubble'},{id:'inputDock'}]},styles:{chatList:{bottomNav:{background:'#fff',radius:22,opacity:92}},chatDetail:{sentBubble:{background:'#111',color:'#fff',fontSize:14,letterSpacing:.4}}},blocks:{chatList:[{id:'custom-card',type:'card',title:'卡片',text:'内容',slot:'before-list'}],chatDetail:[{id:'custom-text',type:'text',text:'说明',slot:'before-input'}]},layerOrder:{chatList:['statusBar','custom-card','bottomNav'],chatDetail:['detailHeader','sentBubble','custom-text','inputDock']},motions:[{id:'nav-collapse-scroll',enabled:true,duration:330,threshold:30,compactScale:.82}],assetIndex:[],...overrides}}
function makePackage(theme=fixture(),css='.msg-row.sent .msg-bubble{letter-spacing:.2px}',extra=[]){const m={format:F.FORMAT,schemaVersion:F.VERSION,target:'maomao-chat'};return zip([{name:'manifest.json',data:JSON.stringify(m)},{name:'theme.json',data:JSON.stringify(theme)},{name:'custom.css',data:css},...extra])}
test('valid chat theme parses with layout, CSS and motion settings',()=>{const p=F.readPackage(F.parseStoredZip(makePackage()));assert.equal(p.theme.name,'测试聊天主题');assert.equal(p.theme.blocks.chatList[0].slot,'before-list');assert.equal(p.theme.motions[0].duration,330);assert.match(F.buildScopedCss(p.theme,p.customCss),/data-maomao-chat-theme-active/);assert.match(F.buildScopedCss(p.theme,p.customCss),/letter-spacing:.4px/);assert.match(F.scopeCss('.phone-mockup .msg-bubble{color:#111}','.phone-mockup[data-maomao-chat-theme-active="1"]'),/data-maomao-chat-theme-active="1" \.msg-bubble/);});
test('image/font assets must be registered in assetIndex',()=>{const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);const t=fixture({assetIndex:[{path:'assets/bg.png',name:'bg.png',type:'image',mimeType:'image/png'}]});const p=F.readPackage(F.parseStoredZip(makePackage(t,'',[{name:'assets/bg.png',data:bytes}])));assert.deepEqual(Array.from(p.assets['assets/bg.png'].bytes),Array.from(bytes));});
test('rejects wrong target, unsafe paths, external CSS and malformed CSS',()=>{assert.throws(()=>F.readPackage(F.parseStoredZip(makePackage(fixture({target:'desktop'})))),/目标不兼容/);assert.throws(()=>F.parseStoredZip(zip([{name:'../x',data:'x'}])),/不安全路径/);assert.throws(()=>F.validateCss('@import url(https://example.invalid/a.css)'),/不允许/);assert.throws(()=>F.validateCss('.x{background:url(https://example.invalid/a.png)}'),/不允许/);assert.throws(()=>F.validateCss('.x{color:red'),/不完整/);});
test('CSS property values are sanitized and cannot inject declarations',()=>{const t=fixture({styles:{chatList:{bottomNav:{background:'url(javascript:alert(1))',color:'#222'}},chatDetail:{}}});const p=F.readPackage(F.parseStoredZip(makePackage(t)));const css=F.stylesToCss(p.theme);assert.doesNotMatch(css,/javascript:/i);assert.match(css,/color:#222/);});

test('hidden components stay hidden when the package is applied',()=>{const t=fixture({pages:{chatList:[{id:'statusBar'},{id:'bottomNav',visible:false}],chatDetail:[{id:'detailHeader'}]}});const p=F.readPackage(F.parseStoredZip(makePackage(t)));assert.match(F.stylesToCss(p.theme),/\.floating-nav\{display:none !important\}/);});

test('custom component IDs are strictly validated and cannot escape the chat CSS scope',()=>{
  const maliciousId='custom-x"],body{color:red}/*';
  const t=fixture({
    pages:{
      chatList:[{id:'statusBar'},{id:maliciousId}],
      chatDetail:[{id:'detailHeader'}]
    },
    styles:{
      chatList:{
        'custom-card':{color:'#111'},
        [maliciousId]:{color:'#f00'}
      },
      chatDetail:{}
    },
    blocks:{
      chatList:[
        {id:'custom-card',type:'card',title:'安全卡片',text:'保留'},
        {id:maliciousId,type:'text',text:'不应导入'}
      ],
      chatDetail:[]
    },
    layerOrder:{
      chatList:['statusBar',maliciousId,'custom-card'],
      chatDetail:['detailHeader']
    }
  });
  const p=F.readPackage(F.parseStoredZip(makePackage(t)));
  assert.deepEqual(p.theme.pages.chatList.map(x=>x.id),['statusBar']);
  assert.deepEqual(p.theme.blocks.chatList.map(x=>x.id),['custom-card']);
  assert.deepEqual(Object.keys(p.theme.styles.chatList),['custom-card']);
  assert.deepEqual(p.theme.layerOrder.chatList,['custom-card']);
  const css=F.buildScopedCss(p.theme,p.customCss);
  assert.doesNotMatch(css,/body\\s*\\{\\s*color:red/);
  assert.doesNotMatch(css,/custom-x/);
  assert.match(css,/\\.phone-mockup\\[data-maomao-chat-theme-active="1"\\]/);
});


test('CSS safety validation checks comments and escaped syntax after normalization',()=>{
  const blocked=[
    '@im/**/port "https://example.invalid/theme.css"',
    String.raw`@im\70 ort "https://example.invalid/theme.css"`,
    '.x{background:u/**/rl("https://example.invalid/a.png")}',
    String.raw`.x{background:u\72l("https://example.invalid/a.png")}`,
    String.raw`.x{background:url("https\3a //example.invalid/a.png")}`,
    '.x{posi/**/tion:fixed}',
    String.raw`.x{position:fi\78 ed}`,
    String.raw`.x{posi\74 ion:fixed}`,
    String.raw`.x{width:e\78 pression(alert(1))}`
  ];
  blocked.forEach((css,index)=>{
    assert.throws(()=>F.validateCss(css),undefined,'必须拒绝被注释或转义隐藏的危险 CSS，第 '+(index+1)+' 例');
  });
});

test('CSS safety validation ignores harmless comments and ordinary quoted text',()=>{
  assert.doesNotThrow(()=>F.validateCss('/* @import url(https://example.invalid/a.css) */ .x::after{content:"@import javascript: https://example.invalid";}'));
  assert.doesNotThrow(()=>F.validateCss('.x{background:url("assets/background.png");content:"普通文本";}'));
});


test('runtime deactivation removes mounted custom blocks and clears package styling',()=>{
  const runtimeSource=readFileSync(new URL('../shared/js/chat-theme-package-runtime.js',import.meta.url),'utf8');
  const customBlock={removed:false,remove(){this.removed=true}};
  const attributes=new Set(['data-maomao-chat-theme-active']);
  const styleNodes=new Map();
  const shell={
    classList:{remove(){}},
    style:{removeProperty(){}},
    removeAttribute(name){attributes.delete(name)},
    querySelector(){return null},
    querySelectorAll(selector){return selector==='.maomao-theme-custom-block'?[customBlock]:[]}
  };
  const document={
    readyState:'complete',
    querySelector(selector){return selector==='.phone-mockup'?shell:null},
    getElementById(id){return styleNodes.get(id)||null},
    createElement(){return{id:'',textContent:'',style:{}}},
    head:{appendChild(node){styleNodes.set(node.id,node)}}
  };
  const localStorage={getItem(){return null}};
  const windowMock={
    MAOMAOChatThemeFormat:{},
    location:{pathname:'/chat/chat/chat.html'},
    requestAnimationFrame(callback){callback()},
    addEventListener(){}
  };
  vm.runInNewContext(runtimeSource,{window:windowMock,document,localStorage,console,setTimeout});
  assert.equal(customBlock.removed,true,'停用主题后必须移除已挂载自定义组件');
  assert.equal(attributes.has('data-maomao-chat-theme-active'),false,'必须移除主题激活标记');
  assert.equal(styleNodes.get('maomao-chat-theme-package-style').textContent,'','必须清空主题样式');
  assert.equal(styleNodes.get('maomao-chat-theme-motion-style').textContent,'','必须清空动效样式');
});

test('import page can restore the original theme without deleting installed package data',()=>{
  const html=readFileSync(new URL('../beauty/theme-import.html',import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match=>match[1].trim()).filter(Boolean);
  const script=scripts[scripts.length-1];
  assert.ok(script,'导入页必须包含可执行的主题管理脚本');
  const LIST_KEY='maomao_chat_theme_packages_v1',ACTIVE_KEY='maomao_chat_theme_active_v1';
  const theme={id:'installed-theme-1',name:'回退测试主题',version:'1.0.0',assetRefs:{'assets/bg.png':'asset-1'}};
  const values=new Map([[LIST_KEY,JSON.stringify([theme])],[ACTIVE_KEY,theme.id]]);
  const localStorage={
    getItem(key){return values.has(key)?values.get(key):null},
    setItem(key,value){values.set(key,String(value))},
    removeItem(key){values.delete(key)}
  };
  function makeNode(tag){
    const node={tagName:tag,children:[],handlers:{},className:'',textContent:'',disabled:false,style:{},
      classList:{add(){},remove(){}},
      addEventListener(type,callback){this.handlers[type]=callback},
      appendChild(child){this.children.push(child);child.parentNode=this;return child},
      setAttribute(){}
    };
    let inner='';
    Object.defineProperty(node,'innerHTML',{get(){return inner},set(value){inner=String(value);if(value==='')node.children.length=0}});
    return node;
  }
  const ids={};
  ['toast','status','installedList','chooseFile','themeFile','importApply','clearFile','packagePreview','fileName'].forEach(id=>ids[id]=makeNode('div'));
  const events=[];
  const document={querySelector(selector){return selector.charAt(0)==='#'?(ids[selector.slice(1)]||null):null},createElement:makeNode};
  function CustomEvent(type){this.type=type}
  const windowMock={dispatchEvent(event){events.push(event)},PhoneStorage:null};
  vm.runInNewContext(script,{window:windowMock,document,localStorage,CustomEvent,setTimeout(){},console});
  let row=ids.installedList.children[0];
  assert.equal(row.children[1].textContent,'恢复原主题','当前主题必须显示恢复入口');
  row.children[1].handlers.click();
  assert.equal(localStorage.getItem(ACTIVE_KEY),null,'恢复原主题只清空活动主题 ID');
  assert.equal(localStorage.getItem(LIST_KEY),JSON.stringify([theme]),'恢复原主题不能删除已安装主题包或素材引用');
  assert.ok(events.some(event=>event.type==='maomao:chat-theme-change'),'恢复时必须通知聊天页运行时');
  assert.match(ids.status.textContent,/原有聊天主题已恢复/);
  row=ids.installedList.children[0];
  assert.equal(row.children[1].textContent,'应用','停用后仍应允许重新应用');
});


test('runtime releases asset URLs that resolve after theme deactivation',async()=>{
  const runtimeSource=readFileSync(new URL('../shared/js/chat-theme-package-runtime.js',import.meta.url),'utf8');
  let resolveObjectUrl,revoked=0;
  const pending=new Promise(resolve=>{resolveObjectUrl=resolve});
  const media={toObjectUrl(){return pending}};
  const theme={id:'delayed-theme',assetRefs:{'assets/bg.png':'asset-delayed'}};
  const values=new Map([
    ['maomao_chat_theme_packages_v1',JSON.stringify([theme])],
    ['maomao_chat_theme_active_v1',theme.id]
  ]);
  const localStorage={
    getItem(key){return values.has(key)?values.get(key):null},
    removeItem(key){values.delete(key)}
  };
  const attributes=new Set();
  const styleNodes=new Map();
  const shell={
    classList:{remove(){}},style:{removeProperty(){}},
    removeAttribute(name){attributes.delete(name)},
    setAttribute(name){attributes.add(name)},
    querySelector(){return null},
    querySelectorAll(){return[]}
  };
  const document={
    readyState:'complete',
    querySelector(){return shell},
    getElementById(id){return styleNodes.get(id)||null},
    createElement(){return{id:'',textContent:'',style:{}}},
    head:{appendChild(node){styleNodes.set(node.id,node)}}
  };
  const listeners={};
  const phoneStorage={repository:{media(){return media}}};
  const windowMock={
    MAOMAOChatThemeFormat:{buildScopedCss(){return''}},
    PhoneStorage:phoneStorage,
    location:{pathname:'/chat/chat/chat.html'},
    requestAnimationFrame(callback){callback()},
    addEventListener(type,callback){listeners[type]=callback}
  };
  vm.runInNewContext(runtimeSource,{window:windowMock,document,localStorage,PhoneStorage:phoneStorage,console,setTimeout});
  localStorage.removeItem('maomao_chat_theme_active_v1');
  listeners['maomao:chat-theme-change']();
  resolveObjectUrl({ok:true,value:{url:'blob:late-theme-asset',revoke(){revoked++}}});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(revoked,1,'停用后才完成加载的对象 URL 也必须立即释放');
  assert.equal(attributes.has('data-maomao-chat-theme-active'),false,'迟到的资源加载不能重新激活主题');
  assert.equal(styleNodes.get('maomao-chat-theme-package-style').textContent,'','迟到的资源加载不能重新写回主题 CSS');
});


test('runtime clears temporary navigation tap styles when deactivated',async()=>{
  const runtimeSource=readFileSync(new URL('../shared/js/chat-theme-package-runtime.js',import.meta.url),'utf8');
  const timers=new Map();let timerId=0,cleared=0,clickHandler=null;
  const timeout=(callback)=>{const id=++timerId;timers.set(id,callback);return id};
  const clear=(id)=>{if(timers.delete(id))cleared++};
  const tapStyles=new Map();
  const tapClasses=new Set();
  const navTab={
    style:{
      setProperty(key,value){tapStyles.set(key,value)},
      removeProperty(key){tapStyles.delete(key)}
    },
    classList:{
      add(name){tapClasses.add(name)},
      remove(name){tapClasses.delete(name)}
    }
  };
  const nav={classList:{remove(){}},style:{removeProperty(){}}};
  const shell={
    classList:{add(){},remove(){}},style:{removeProperty(){}},
    setAttribute(){},removeAttribute(){},
    querySelector(selector){return selector==='.floating-nav'?nav:null},
    querySelectorAll(){return[]},
    addEventListener(type,handler){if(type==='click')clickHandler=handler},
    removeEventListener(type,handler){if(type==='click'&&clickHandler===handler)clickHandler=null}
  };
  const theme={
    id:'tap-theme',
    motions:[{id:'nav-elastic-tap',enabled:true,duration:360,scale:1.12,lift:4}]
  };
  const values=new Map([
    ['maomao_chat_theme_packages_v1',JSON.stringify([theme])],
    ['maomao_chat_theme_active_v1',theme.id]
  ]);
  const localStorage={getItem(key){return values.has(key)?values.get(key):null},removeItem(key){values.delete(key)}};
  const styleNodes=new Map();
  const document={
    readyState:'complete',querySelector(){return shell},
    getElementById(id){return styleNodes.get(id)||null},
    createElement(){return{id:'',textContent:'',style:{}}},
    head:{appendChild(node){styleNodes.set(node.id,node)}}
  };
  const listeners={};
  const windowMock={
    MAOMAOChatThemeFormat:{buildScopedCss(){return''}},
    location:{pathname:'/chat/chat/chat.html'},
    requestAnimationFrame(callback){callback()},
    addEventListener(type,callback){listeners[type]=callback}
  };
  vm.runInNewContext(runtimeSource,{window:windowMock,document,localStorage,console,setTimeout:timeout,clearTimeout:clear});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(typeof clickHandler,'function','主题应用后应安装导航点击监听');
  clickHandler({target:{closest(){return navTab}}});
  assert.equal(tapClasses.has('maomao-theme-nav-tapped'),true,'点击后应启用动效 class');
  assert.equal(tapStyles.size,4,'点击后应写入四个临时动效变量');
  localStorage.removeItem('maomao_chat_theme_active_v1');
  listeners['maomao:chat-theme-change']();
  assert.equal(clickHandler,null,'停用后应移除点击监听');
  assert.equal(tapClasses.size,0,'停用后应移除点击动效 class');
  assert.equal(tapStyles.size,0,'停用后应清除按钮临时 CSS 变量');
  assert.ok(cleared>=1,'停用后应取消未完成的动效定时器');
});


test('runtime records the last successfully applied package after refresh',async()=>{
  const runtimeSource=readFileSync(new URL('../shared/js/chat-theme-package-runtime.js',import.meta.url),'utf8');
  const theme={id:'refresh-theme',customCss:'.refresh-theme{color:#111}'};
  const values=new Map([
    ['maomao_chat_theme_packages_v1',JSON.stringify([theme])],
    ['maomao_chat_theme_active_v1',theme.id]
  ]);
  const localStorage={
    getItem(key){return values.has(key)?values.get(key):null},
    setItem(key,value){values.set(key,String(value))},
    removeItem(key){values.delete(key)}
  };
  const styleNodes=new Map();
  const shell={
    classList:{add(){},remove(){}},style:{removeProperty(){}},
    setAttribute(){},removeAttribute(){},querySelector(){return null},querySelectorAll(){return[]}
  };
  const document={
    readyState:'complete',querySelector(){return shell},
    getElementById(id){return styleNodes.get(id)||null},
    createElement(){return{id:'',textContent:'',style:{}}},
    head:{appendChild(node){styleNodes.set(node.id,node)}}
  };
  const listeners={};
  const windowMock={
    MAOMAOChatThemeFormat:{buildScopedCss(theme){return '/* '+theme.id+' */'}},
    location:{pathname:'/chat/chat/chat.html'},
    requestAnimationFrame(callback){callback()},
    addEventListener(type,callback){listeners[type]=callback}
  };
  vm.runInNewContext(runtimeSource,{window:windowMock,document,localStorage,console,setTimeout});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(localStorage.getItem('maomao_chat_theme_last_good_v1'),theme.id,'刷新后正常应用应记录最后成功主题');
  assert.match(styleNodes.get('maomao-chat-theme-package-style').textContent,/refresh-theme/,'刷新后应重新应用持久化活动主题');
});

test('runtime falls back to the last working theme when the newly selected theme assets fail',async()=>{
  const runtimeSource=readFileSync(new URL('../shared/js/chat-theme-package-runtime.js',import.meta.url),'utf8');
  const first={id:'working-theme',assetRefs:{'assets/a.png':'asset-a'}};
  const broken={id:'broken-theme',assetRefs:{'assets/b.png':'asset-b'}};
  const values=new Map([
    ['maomao_chat_theme_packages_v1',JSON.stringify([first,broken])],
    ['maomao_chat_theme_active_v1',first.id]
  ]);
  const localStorage={
    getItem(key){return values.has(key)?values.get(key):null},
    setItem(key,value){values.set(key,String(value))},
    removeItem(key){values.delete(key)}
  };
  let aReads=0,bReads=0,aRevokes=0;
  const media={toObjectUrl(id){
    if(id==='asset-b'){bReads++;return Promise.reject(new Error('模拟素材读取失败'))}
    aReads++;return Promise.resolve({ok:true,value:{url:'blob:working-theme',revoke(){aRevokes++}}});
  }};
  const styleNodes=new Map(),listeners={};
  const shell={
    classList:{add(){},remove(){}},style:{removeProperty(){}},
    setAttribute(){},removeAttribute(){},querySelector(){return null},querySelectorAll(){return[]}
  };
  const document={
    readyState:'complete',querySelector(){return shell},
    getElementById(id){return styleNodes.get(id)||null},
    createElement(){return{id:'',textContent:'',style:{}}},
    head:{appendChild(node){styleNodes.set(node.id,node)}}
  };
  const phoneStorage={repository:{media(){return media}}};
  const windowMock={
    MAOMAOChatThemeFormat:{buildScopedCss(theme){return '/* '+theme.id+' */'}},
    PhoneStorage:phoneStorage,
    location:{pathname:'/chat/chat/chat.html'},
    requestAnimationFrame(callback){callback()},
    addEventListener(type,callback){listeners[type]=callback},
    dispatchEvent(event){if(event.type==='maomao:chat-theme-change'&&listeners[event.type])listeners[event.type]()}
  };
  function CustomEvent(type){this.type=type}
  vm.runInNewContext(runtimeSource,{window:windowMock,document,localStorage,PhoneStorage:phoneStorage,CustomEvent,console:{error(){}},setTimeout});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(localStorage.getItem('maomao_chat_theme_last_good_v1'),first.id,'首次成功应用应记住可回退主题');
  localStorage.setItem('maomao_chat_theme_active_v1',broken.id);
  listeners['maomao:chat-theme-change']();
  await new Promise(resolve=>setTimeout(resolve,0));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(bReads,1,'新主题素材失败应只尝试一次，不能在回退时无限重试');
  assert.equal(localStorage.getItem('maomao_chat_theme_active_v1'),first.id,'新主题加载失败应恢复先前成功主题');
  assert.equal(localStorage.getItem('maomao_chat_theme_last_good_v1'),first.id,'回退后应保留最后成功主题标记');
  assert.match(styleNodes.get('maomao-chat-theme-package-style').textContent,/working-theme/,'回退后应重新加载并显示原先可用主题');
  assert.ok(aRevokes>=1,'切换和回退时应释放已替换的旧对象 URL');
});


test('runtime ignores stale asset loads after a rapid theme switch',async()=>{
  const runtimeSource=readFileSync(new URL('../shared/js/chat-theme-package-runtime.js',import.meta.url),'utf8');
  let resolveSlow,slowRevoked=0;
  const slowPending=new Promise(resolve=>{resolveSlow=resolve});
  const slow={id:'slow-theme',assetRefs:{'assets/slow.png':'slow-asset'}};
  const fast={id:'fast-theme',assetRefs:{'assets/fast.png':'fast-asset'}};
  const values=new Map([
    ['maomao_chat_theme_packages_v1',JSON.stringify([slow,fast])],
    ['maomao_chat_theme_active_v1',slow.id]
  ]);
  const localStorage={
    getItem(key){return values.has(key)?values.get(key):null},
    setItem(key,value){values.set(key,String(value))},
    removeItem(key){values.delete(key)}
  };
  const media={toObjectUrl(id){
    if(id==='slow-asset')return slowPending;
    return Promise.resolve({ok:true,value:{url:'blob:fast-theme',revoke(){}}});
  }};
  const styleNodes=new Map(),listeners={};
  const shell={
    classList:{add(){},remove(){}},style:{removeProperty(){}},
    setAttribute(){},removeAttribute(){},querySelector(){return null},querySelectorAll(){return[]}
  };
  const document={
    readyState:'complete',querySelector(){return shell},
    getElementById(id){return styleNodes.get(id)||null},
    createElement(){return{id:'',textContent:'',style:{}}},
    head:{appendChild(node){styleNodes.set(node.id,node)}}
  };
  const phoneStorage={repository:{media(){return media}}};
  const windowMock={
    MAOMAOChatThemeFormat:{buildScopedCss(theme){return '/* '+theme.id+' */'}},
    PhoneStorage:phoneStorage,
    location:{pathname:'/chat/chat.html'},
    requestAnimationFrame(callback){callback()},
    addEventListener(type,callback){listeners[type]=callback}
  };
  vm.runInNewContext(runtimeSource,{window:windowMock,document,localStorage,PhoneStorage:phoneStorage,console,setTimeout});
  await Promise.resolve();
  await Promise.resolve();
  values.set('maomao_chat_theme_active_v1',fast.id);
  listeners['maomao:chat-theme-change']();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(styleNodes.get('maomao-chat-theme-package-style').textContent,/fast-theme/,'快速切换后应先应用最新选择');
  resolveSlow({ok:true,value:{url:'blob:slow-theme',revoke(){slowRevoked++}}});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(styleNodes.get('maomao-chat-theme-package-style').textContent,/fast-theme/,'旧请求迟到后不能覆盖新主题样式');
  assert.equal(localStorage.getItem('maomao_chat_theme_active_v1'),fast.id,'活动主题 ID 应保持最新选择');
  assert.equal(localStorage.getItem('maomao_chat_theme_last_good_v1'),fast.id,'最后成功主题不能被旧请求覆盖');
  assert.equal(slowRevoked,1,'迟到的旧主题素材 URL 必须释放');
});


test('runtime clears failed first-use selection when no successful theme exists',async()=>{
  const runtimeSource=readFileSync(new URL('../shared/js/chat-theme-package-runtime.js',import.meta.url),'utf8');
  const theme={id:'first-use-broken',assetRefs:{'assets/broken.png':'broken-asset'}};
  const values=new Map([
    ['maomao_chat_theme_packages_v1',JSON.stringify([theme])],
    ['maomao_chat_theme_active_v1',theme.id]
  ]);
  const localStorage={
    getItem(key){return values.has(key)?values.get(key):null},
    setItem(key,value){values.set(key,String(value))},
    removeItem(key){values.delete(key)}
  };
  const media={toObjectUrl(){return Promise.reject(new Error('首次素材读取失败'))}};
  const styleNodes=new Map();
  const shell={
    classList:{add(){},remove(){}},style:{removeProperty(){}},
    setAttribute(){},removeAttribute(){},querySelector(){return null},querySelectorAll(){return[]}
  };
  const document={
    readyState:'complete',querySelector(){return shell},
    getElementById(id){return styleNodes.get(id)||null},
    createElement(){return{id:'',textContent:'',style:{}}},
    head:{appendChild(node){styleNodes.set(node.id,node)}}
  };
  const phoneStorage={repository:{media(){return media}}};
  const windowMock={
    MAOMAOChatThemeFormat:{buildScopedCss(){return'.broken{color:red}'}},
    PhoneStorage:phoneStorage,
    location:{pathname:'/chat/chat.html'},
    requestAnimationFrame(callback){callback()},
    addEventListener(){}
  };
  vm.runInNewContext(runtimeSource,{window:windowMock,document,localStorage,PhoneStorage:phoneStorage,console:{error(){}},setTimeout});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(localStorage.getItem('maomao_chat_theme_active_v1'),null,'没有成功主题可回退时应清空失败活动 ID');
  assert.equal(localStorage.getItem('maomao_chat_theme_last_good_v1'),null,'无可用回退主题时不能留下陈旧 last-good');
  assert.equal(styleNodes.get('maomao-chat-theme-package-style').textContent,'','首次应用失败后应保持原生主题样式');
});

test('reapplying the same active package is idempotent and does not duplicate motion listeners',async()=>{
  const runtimeSource=readFileSync(new URL('../shared/js/chat-theme-package-runtime.js',import.meta.url),'utf8');
  const theme={id:'idempotent-theme',motions:[{id:'nav-elastic-tap',enabled:true,duration:300}]};
  const values=new Map([
    ['maomao_chat_theme_packages_v1',JSON.stringify([theme])],
    ['maomao_chat_theme_active_v1',theme.id]
  ]);
  const localStorage={
    getItem(key){return values.has(key)?values.get(key):null},
    setItem(key,value){values.set(key,String(value))},
    removeItem(key){values.delete(key)}
  };
  const listeners={click:0},styleNodes=new Map();
  const shell={
    classList:{add(){},remove(){}},style:{removeProperty(){}},
    setAttribute(){},removeAttribute(){},querySelector(){return null},querySelectorAll(){return[]},
    addEventListener(type){if(type==='click')listeners.click++},
    removeEventListener(){}
  };
  const document={
    readyState:'complete',querySelector(){return shell},
    getElementById(id){return styleNodes.get(id)||null},
    createElement(){return{id:'',textContent:'',style:{}}},
    head:{appendChild(node){styleNodes.set(node.id,node)}}
  };
  const runtimeEvents={};
  const windowMock={
    MAOMAOChatThemeFormat:{buildScopedCss(){return''}},
    location:{pathname:'/chat/chat.html'},
    requestAnimationFrame(callback){callback()},
    addEventListener(type,callback){runtimeEvents[type]=callback}
  };
  vm.runInNewContext(runtimeSource,{window:windowMock,document,localStorage,console,setTimeout});
  await new Promise(resolve=>setTimeout(resolve,0));
  runtimeEvents['maomao:chat-theme-change']();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(listeners.click,1,'重复应用同一主题不能重复注册点击监听');
  assert.equal(localStorage.getItem('maomao_chat_theme_last_good_v1'),theme.id,'重复应用后 last-good 应稳定');
});

  
test('theme package scripts use a shared cache-busting revision across chat and importer pages',()=>{
  const revision='20261109theme2';
  const importer=readFileSync(new URL('../beauty/theme-import.html',import.meta.url),'utf8');
  const chatList=readFileSync(new URL('../chat/chat/chat.html',import.meta.url),'utf8');
  const chatDetail=readFileSync(new URL('../chat/chat/chat-detail.html',import.meta.url),'utf8');
  assert.ok(importer.includes('../shared/js/chat-theme-package-format.js?v='+revision));
  for(const html of [chatList,chatDetail]){
    assert.ok(html.includes('chat-theme-package-format.js?v='+revision));
    assert.ok(html.includes('chat-theme-package-runtime.js?v='+revision));
    assert.ok(!html.includes('chat-theme-package-format.js?v=20261107theme1'));
    assert.ok(!html.includes('chat-theme-package-runtime.js?v=20261107theme1'));
  }
});
