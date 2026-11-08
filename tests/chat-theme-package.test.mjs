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
function fixture(overrides={}){return{format:F.FORMAT,schemaVersion:F.VERSION,target:'maomao-chat',id:'test-theme',name:'测试聊天主题',pages:{chatList:[{id:'statusBar'},{id:'bottomNav'}],chatDetail:[{id:'detailHeader'},{id:'sentBubble'},{id:'inputDock'}]},styles:{chatList:{bottomNav:{background:'#fff',radius:22,opacity:92}},chatDetail:{sentBubble:{background:'#111',color:'#fff',fontSize:14,letterSpacing:.4}}},blocks:{chatList:[{id:'custom-card',type:'card',title:'卡片',text:'内容',slot:'top-of-content'}],chatDetail:[{id:'custom-text',type:'text',text:'说明',slot:'before-input'}]},layerOrder:{chatList:['statusBar','custom-card','bottomNav'],chatDetail:['detailHeader','sentBubble','custom-text','inputDock']},motions:[{id:'nav-collapse-scroll',enabled:true,duration:330,threshold:30,compactScale:.82}],assetIndex:[],...overrides}}
function makePackage(theme=fixture(),css='.msg-row.sent .msg-bubble{letter-spacing:.2px}',extra=[]){const m={format:F.FORMAT,schemaVersion:F.VERSION,target:'maomao-chat'};return zip([{name:'manifest.json',data:JSON.stringify(m)},{name:'theme.json',data:JSON.stringify(theme)},{name:'custom.css',data:css},...extra])}
test('valid chat theme parses with layout, CSS and motion settings',()=>{const p=F.readPackage(F.parseStoredZip(makePackage()));assert.equal(p.theme.name,'测试聊天主题');assert.equal(p.theme.blocks.chatList[0].slot,'top-of-content');assert.equal(p.theme.motions[0].duration,330);assert.match(F.buildScopedCss(p.theme,p.customCss),/data-maomao-chat-theme-active/);assert.match(F.buildScopedCss(p.theme,p.customCss),/letter-spacing:0?\.4px/);assert.match(F.scopeCss('.phone-mockup .msg-bubble{color:#111}','.phone-mockup[data-maomao-chat-theme-active="1"]'),/data-maomao-chat-theme-active="1"\] \.msg-bubble/);});

test('CSS scoping preserves braces in comments and strings and handles escaped group selectors',()=>{
  const prefix='.phone-mockup[data-maomao-chat-theme-active="1"]';
  const css='/* { fake block } */ .sample::after{content:"{ literal }";color:red}'+
    '@media (max-width:600px){/* } { */ .nested:is(.a,.b), [data-x="a,b"]{content:"}";color:#222}}';
  const scoped=F.scopeCss(css,prefix);
  assert.ok(scoped.includes(prefix+' /* { fake block } */ .sample::after{'),'注释中的花括号不能被误识别为规则边界');
  assert.ok(scoped.includes('content:"{ literal }";color:red}'),'字符串中的花括号必须保持原样');
  assert.ok(scoped.includes('@media (max-width:600px){'+prefix+' /* } { */ .nested:is(.a,.b),'+prefix+' [data-x="a,b"]{'),'分组规则内的注释和选择器列表必须正确保留');
  assert.ok(scoped.includes('content:"}";color:#222}}'),'嵌套规则体中的字符串和闭合括号必须保持原样');

  const escaped=F.scopeCss(String.raw`@m\65 dia (max-width:600px){h\74 ml .nested{color:red}}`,prefix);
  assert.ok(escaped.includes('@m\\65 dia (max-width:600px){'+prefix+' .nested{'),'转义写法的 @media 与 html 选择器也必须保持聊天页作用域');
  const escapedShell=F.scopeCss(String.raw` .\70 hone-mockup .child{color:red}`,prefix);
  assert.ok(escapedShell.includes(prefix+' .child{'),'转义写法的 phone-mockup 根选择器必须正确替换');
  let deeplyNested=' .sample{color:red}';
  for(let i=0;i<34;i++)deeplyNested='@media (min-width:1px){'+deeplyNested+'}';
  assert.throws(()=>F.scopeCss(deeplyNested,prefix),/分组规则嵌套过深/);
});

test('stored ZIP validates its EOCD, central directory and matching local headers',()=>{
  const valid=Buffer.from(makePackage());
  assert.doesNotThrow(()=>F.parseStoredZip(valid));

  const missingEnd=Buffer.from(valid);
  missingEnd[missingEnd.length-22]=0;
  assert.throws(()=>F.parseStoredZip(missingEnd),/结束记录/);

  const badCount=Buffer.from(valid);
  const countView=new DataView(badCount.buffer,badCount.byteOffset,badCount.byteLength);
  countView.setUint16(badCount.length-22+8,2,true);
  countView.setUint16(badCount.length-22+10,2,true);
  assert.throws(()=>F.parseStoredZip(badCount),/中央目录长度不正确/);

  const mismatchedHeader=Buffer.from(valid);
  const headerView=new DataView(mismatchedHeader.buffer,mismatchedHeader.byteOffset,mismatchedHeader.byteLength);
  const centralOffset=headerView.getUint32(mismatchedHeader.length-22+16,true);
  headerView.setUint32(centralOffset+16,(headerView.getUint32(centralOffset+16,true)+1)>>>0,true);
  assert.throws(()=>F.parseStoredZip(mismatchedHeader),/本地文件头与中央目录不一致/);
});

test('stored ZIP permits a valid archive comment but rejects trailing unregistered bytes',()=>{
  const valid=Buffer.from(makePackage());
  const trailing=Buffer.concat([valid,Buffer.from([0x41])]);
  assert.throws(()=>F.parseStoredZip(trailing),/结束记录/);

  const commented=Buffer.concat([valid,Buffer.from('ok')]);
  const view=new DataView(commented.buffer,commented.byteOffset,commented.byteLength);
  view.setUint16(valid.length-2,2,true);
  assert.doesNotThrow(()=>F.parseStoredZip(commented));

  const trickyComment=Buffer.alloc(24,0x41);
  trickyComment.writeUInt32LE(0x06054b50,2);
  trickyComment.writeUInt16LE(0,22);
  const signatureInComment=Buffer.concat([valid,trickyComment]);
  const signatureView=new DataView(signatureInComment.buffer,signatureInComment.byteOffset,signatureInComment.byteLength);
  signatureView.setUint16(valid.length-2,trickyComment.length,true);
  assert.doesNotThrow(()=>F.parseStoredZip(signatureInComment),'注释中的结束签名不能遮蔽真正的 ZIP 结束记录');

  const zip64LikeComment=Buffer.alloc(22,0);
  zip64LikeComment.writeUInt32LE(0x06054b50,0);
  zip64LikeComment.writeUInt16LE(0xffff,8);
  zip64LikeComment.writeUInt16LE(0xffff,10);
  zip64LikeComment.writeUInt32LE(0xffffffff,12);
  zip64LikeComment.writeUInt32LE(0xffffffff,16);
  const zip64SignatureInComment=Buffer.concat([valid,zip64LikeComment]);
  const zip64SignatureView=new DataView(zip64SignatureInComment.buffer,zip64SignatureInComment.byteOffset,zip64SignatureInComment.byteLength);
  zip64SignatureView.setUint16(valid.length-2,zip64LikeComment.length,true);
  assert.doesNotThrow(()=>F.parseStoredZip(zip64SignatureInComment),'ZIP64 伪结束记录也不能遮蔽注释前的真实结束记录');
});
test('image/font assets must be registered in assetIndex',()=>{const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);const t=fixture({assetIndex:[{path:'assets/bg.png',name:'bg.png',type:'image',mimeType:'image/png'}]});const p=F.readPackage(F.parseStoredZip(makePackage(t,'',[{name:'assets/bg.png',data:bytes}])));assert.deepEqual(Array.from(p.assets['assets/bg.png'].bytes),Array.from(bytes));});
test('exported theme packages round-trip CSS, custom blocks and binary assets through the importer',()=>{
  const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);
  const theme=fixture({
    id:'round-trip-theme',
    assetIndex:[{path:'assets/photo.png',name:'photo.png',type:'image',mimeType:'image/png'}],
    blocks:{chatList:[{id:'custom-photo',type:'image',assetPath:'assets/photo.png',slot:'top-of-content'}],chatDetail:[]}
  });
  const css='.phone-mockup .sample{color:#111}';
  const exported=F.createPackage(theme,css,{'assets/photo.png':bytes});
  const imported=F.readPackage(F.parseStoredZip(exported));
  assert.equal(imported.theme.name,theme.name);
  assert.equal(imported.theme.blocks.chatList[0].assetPath,'assets/photo.png');
  assert.equal(imported.customCss,css);
  assert.deepEqual(Array.from(imported.assets['assets/photo.png'].bytes),Array.from(bytes));
  assert.throws(()=>F.createPackage(theme,css,{}),/导出主题缺少素材/);
  assert.throws(()=>F.createPackage(theme,'@import url(https://example.invalid/a.css)',{'assets/photo.png':bytes}),/不允许/);
});
test('CSS package references must resolve to registered package assets',()=>{
  const theme=fixture();
  assert.throws(()=>F.createPackage(theme,'.sample{background-image:url("assets/missing.png")}',{}),/CSS 引用了未登记的主题素材/);
  const hiddenReferences=[
    String.raw`.sample{background-image:u/**/rl("assets/missing.png")}`,
    String.raw`.sample{background-image:u\72l("assets/missing.png")}`,
    '.sample{background-image:url/**/("assets/missing.png")}'
  ];
  hiddenReferences.forEach(css=>assert.throws(()=>F.createPackage(theme,css,{}),/CSS 引用了未登记的主题素材/));
  assert.doesNotThrow(()=>F.createPackage(theme,'.sample{content:"url(assets/missing.png)"}',{}),'CSS 字符串里的普通文本不是真实素材引用');
  const withAsset=fixture({
    assetIndex:[{path:'assets/bg.png',name:'bg.png',type:'image',mimeType:'image/png'}]
  });
  assert.doesNotThrow(()=>F.createPackage(withAsset,'.sample{background-image:url("assets/bg.png")}',{'assets/bg.png':new Uint8Array([1,2,3])}));
});


test('runtime CSS asset rewriting follows package CSS escape and comment rules',()=>{
  const theme=fixture({
    assetIndex:[{path:'assets/bg.png',name:'bg.png',type:'image',mimeType:'image/png'}]
  });
  const bytes=new Uint8Array([1,2,3]);
  const urls={'assets/bg.png':'blob:maomao/theme-bg'};
  const cases=[
    String.raw`.sample{background-image:u/**/rl(assets/bg.png)}`,
    String.raw`.sample{background-image:u\72l(assets/bg.png)}`,
    String.raw`.sample{background-image:url("assets/b\67.png")}`,
    `.sample{content:"url(assets/bg.png)";background-image:url(assets/bg.png)}`
  ];
  for(const css of cases){
    assert.doesNotThrow(()=>F.createPackage(theme,css,{'assets/bg.png':bytes}));
    assert.ok(F.rewriteCssAssetUrls(css,urls).includes('url("blob:maomao/theme-bg")'));
  }
  const escapedSelector=String.raw`.f\6f o{background-image:url(assets/bg.png)}`;
  const rewrittenSelector=F.rewriteCssAssetUrls(escapedSelector,urls);
  assert.ok(rewrittenSelector.startsWith(String.raw`.f\6f o{`),'替换素材地址不能改写 CSS 中其他合法转义');
  const contentOnly='.sample{content:"url(assets/bg.png)"}';
  assert.equal(F.rewriteCssAssetUrls(contentOnly,urls),contentOnly,'普通文本中的 url 字样不能被当成素材引用替换');
  const runtime=readFileSync(new URL('../shared/js/chat-theme-package-runtime.js',import.meta.url),'utf8');
  assert.ok(runtime.includes('FORMAT.rewriteCssAssetUrls(css,assetUrls)'),'运行时必须使用主题格式模块提供的共享 CSS URL 替换器');
});

test('chat beauty exports only global CSS presets as chat theme packages',()=>{
  const beauty=readFileSync(new URL('../beauty/beauty.html',import.meta.url),'utf8');
  assert.ok(beauty.includes('../shared/js/chat-theme-package-format.js?v=20261109theme5'));
  assert.match(beauty,/function exportCssPreset\(i\)/);
  assert.match(beauty,/preset\.target !== 'all'/);
  assert.match(beauty,/p\.target === 'all'/);
  assert.match(beauty,/format\.createPackage\(theme, preset\.css \|\| '', \{\}\)/);
  assert.match(beauty,/角色专属预设保持独立/);
});
test('global CSS preset export creates an importable package and keeps role presets isolated',()=>{
  const beauty=readFileSync(new URL('../beauty/beauty.html',import.meta.url),'utf8');
  const start=beauty.indexOf('function exportCssPreset(i){');
  const end=beauty.indexOf('\n\nfunction esc(s){',start);
  assert.ok(start>=0&&end>start,'beauty page must expose the CSS preset exporter');
  const source=beauty.slice(start,end);
  let preset={name:'CSS / Global: Test?',target:'all',css:'.msg-bubble{color:#111}'};
  const downloads=[],revoked=[],toasts=[],links=[];
  const body={
    children:[],
    appendChild(node){this.children.push(node);node.parentNode=this},
    removeChild(node){this.children=this.children.filter(item=>item!==node);node.parentNode=null}
  };
  const document={
    body,
    createElement(tag){
      const node={tagName:tag,style:{},click(){this.clicked=true}};
      links.push(node);
      return node;
    }
  };
  const windowMock={
    MAOMAOChatThemeFormat:F,
    URL:{
      createObjectURL(blob){downloads.push(blob);return 'blob:global-css-theme'},
      revokeObjectURL(url){revoked.push(url)}
    }
  };
  class BlobStub{
    constructor(parts,options){this.parts=parts;this.type=options.type}
  }
  const context={
    getPresets(){return[preset]},
    showToast(message){toasts.push(message)},
    window:windowMock,Blob:BlobStub,document,
    setTimeout(callback){callback();return 1}
  };
  vm.runInNewContext(source+'\nthis.exportCssPreset=exportCssPreset;',context);
  context.exportCssPreset(0);
  assert.equal(downloads.length,1,'global CSS preset should generate one package download');
  assert.equal(links[0].download,'CSS _ Global_ Test_.maomaotheme','unsafe filename characters must be replaced');
  assert.equal(links[0].clicked,true,'download link should be activated');
  assert.equal(body.children.length,0,'temporary download link should be removed');
  assert.deepEqual(revoked,['blob:global-css-theme'],'temporary object URL should be released');
  const archive=downloads[0].parts[0];
  const imported=F.readPackage(F.parseStoredZip(archive));
  assert.equal(imported.theme.name,preset.name);
  assert.equal(imported.customCss,preset.css);
  assert.equal(imported.theme.pages.chatList.length,7);
  assert.equal(imported.theme.pages.chatDetail.length,11);

  preset={name:'Role-only preset',target:'role_123',css:'.msg-bubble{color:#f00}'};
  context.exportCssPreset(0);
  assert.equal(downloads.length,1,'role-scoped preset must not create a global package');
  assert.match(toasts[toasts.length-1],/角色专属/);
});
test('custom block slots are normalized to supported positions for their own page',()=>{
  const theme=fixture({
    blocks:{
      chatList:[{id:'custom-list-slot',type:'text',text:'列表',slot:'before-list'}],
      chatDetail:[{id:'custom-detail-slot',type:'text',text:'详情',slot:'above-nav'}]
    }
  });
  const normalized=F.readPackage(F.parseStoredZip(makePackage(theme))).theme;
  assert.equal(normalized.blocks.chatList[0].slot,'top-of-content','列表页未知位置应回退到顶部安全插槽');
  assert.equal(normalized.blocks.chatDetail[0].slot,'before-input','详情页不能使用列表页插槽');
});

test('image custom blocks must reference a registered image asset',()=>{
  const missing=fixture({blocks:{chatList:[{id:'custom-photo',type:'image',assetPath:'assets/missing.png'}],chatDetail:[]}});
  assert.throws(()=>F.readPackage(F.parseStoredZip(makePackage(missing))),/图片组件必须引用已登记的图片素材/);

  const fontAsset=fixture({
    assetIndex:[{path:'assets/font.woff2',name:'font.woff2',type:'font',mimeType:'font/woff2'}],
    blocks:{chatList:[{id:'custom-photo',type:'image',assetPath:'assets/font.woff2'}],chatDetail:[]}
  });
  assert.throws(()=>F.readPackage(F.parseStoredZip(makePackage(fontAsset,'',[{name:'assets/font.woff2',data:new Uint8Array([1,2,3])}]))),/图片组件必须引用已登记的图片素材/);

  const imageAsset=fixture({
    assetIndex:[{path:'assets/photo.png',name:'photo.png',type:'image',mimeType:'image/png'}],
    blocks:{chatList:[{id:'custom-photo',type:'image',assetPath:'assets/photo.png'}],chatDetail:[]}
  });
  const parsed=F.readPackage(F.parseStoredZip(makePackage(imageAsset,'',[{name:'assets/photo.png',data:new Uint8Array([137,80,78,71])}])));
  assert.equal(parsed.theme.blocks.chatList[0].assetPath,'assets/photo.png');
});
test('rejects wrong target, unsafe paths, external CSS and malformed CSS',()=>{assert.throws(()=>F.readPackage(F.parseStoredZip(makePackage(fixture({target:'desktop'})))),/目标不兼容/);assert.throws(()=>F.parseStoredZip(zip([{name:'../x',data:'x'}])),/不安全路径/);assert.throws(()=>F.parseStoredZip(zip([{name:'assets\\\\..\\\\secret',data:'x'}])),/不安全路径/);assert.throws(()=>F.validateCss('@import url(https://example.invalid/a.css)'),/不允许/);assert.throws(()=>F.validateCss('.x{background:url(https://example.invalid/a.png)}'),/只能引用主题 assets/);assert.throws(()=>F.validateCss('.x{color:red'),/不完整/);});
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
  assert.deepEqual(p.theme.layerOrder.chatList,['statusBar','custom-card']);
  const css=F.buildScopedCss(p.theme,p.customCss);
  assert.doesNotMatch(css,/body\s*\{\s*color:red/i);
  assert.doesNotMatch(css,/custom-x/);
  assert.ok(css.includes('.phone-mockup[data-maomao-chat-theme-active="1"]'));
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
  const revision='20261109theme5';
  const importer=readFileSync(new URL('../beauty/theme-import.html',import.meta.url),'utf8');
  const beauty=readFileSync(new URL('../beauty/beauty.html',import.meta.url),'utf8');
  const chatList=readFileSync(new URL('../chat/chat/chat.html',import.meta.url),'utf8');
  const chatDetail=readFileSync(new URL('../chat/chat/chat-detail.html',import.meta.url),'utf8');
  assert.ok(importer.includes('../shared/js/chat-theme-package-format.js?v='+revision));
  assert.ok(beauty.includes('../shared/js/chat-theme-package-format.js?v='+revision));
  for(const html of [chatList,chatDetail]){
    assert.ok(html.includes('chat-theme-package-format.js?v='+revision));
    assert.ok(html.includes('chat-theme-package-runtime.js?v='+revision));
    assert.ok(!html.includes('chat-theme-package-format.js?v=20261107theme1'));
    assert.ok(!html.includes('chat-theme-package-runtime.js?v=20261107theme1'));
  }
});


test('runtime releases partial asset URLs before falling back from a broken package',async()=>{
  const runtimeSource=readFileSync(new URL('../shared/js/chat-theme-package-runtime.js',import.meta.url),'utf8');
  const working={id:'partial-working-theme'};
  const broken={
    id:'partial-broken-theme',
    assetRefs:{
      'assets/first.png':'first-asset',
      'assets/missing.png':'missing-asset'
    }
  };
  const values=new Map([
    ['maomao_chat_theme_packages_v1',JSON.stringify([working,broken])],
    ['maomao_chat_theme_active_v1',broken.id],
    ['maomao_chat_theme_last_good_v1',working.id]
  ]);
  const localStorage={
    getItem(key){return values.has(key)?values.get(key):null},
    setItem(key,value){values.set(key,String(value))},
    removeItem(key){values.delete(key)}
  };
  let firstRead=0,missingRead=0,firstRevoke=0;
  const media={toObjectUrl(id){
    if(id==='first-asset'){
      firstRead++;
      return Promise.resolve({ok:true,value:{url:'blob:first-partial',revoke(){firstRevoke++}}});
    }
    if(id==='missing-asset'){
      missingRead++;
      return Promise.reject(new Error('第二项素材不存在'));
    }
    return Promise.reject(new Error('未知素材'));
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
  function CustomEvent(type){this.type=type}
  const phoneStorage={repository:{media(){return media}}};
  const windowMock={
    MAOMAOChatThemeFormat:{buildScopedCss(theme){return '/* '+theme.id+' */'}},
    PhoneStorage:phoneStorage,
    location:{pathname:'/chat/chat.html'},
    requestAnimationFrame(callback){callback()},
    addEventListener(type,callback){listeners[type]=callback},
    dispatchEvent(event){if(event.type==='maomao:chat-theme-change'&&listeners[event.type])listeners[event.type]()}
  };
  vm.runInNewContext(runtimeSource,{window:windowMock,document,localStorage,PhoneStorage:phoneStorage,CustomEvent,console:{error(){}},setTimeout});
  await new Promise(resolve=>setTimeout(resolve,0));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(firstRead,1,'第一项素材只应读取一次');
  assert.equal(missingRead,1,'缺失素材只应读取一次');
  assert.equal(firstRevoke,1,'第二项失败时必须释放第一项已创建的对象 URL');
  assert.equal(localStorage.getItem('maomao_chat_theme_active_v1'),working.id,'部分素材失败后应恢复最后成功主题');
  assert.equal(localStorage.getItem('maomao_chat_theme_last_good_v1'),working.id,'回退后应保留最后成功主题记录');
  assert.match(styleNodes.get('maomao-chat-theme-package-style').textContent,/partial-working-theme/,'回退后应恢复旧主题样式');
});

test('style values reject comment and escape obfuscation of dangerous CSS',()=>{
  const t=fixture({
    styles:{
      chatList:{bottomNav:{background:'u/**/rl(javascript:alert(1))',color:'#222'}},
      chatDetail:{sentBubble:{background:'u\\\\72l(javascript:alert(1))',position:'fi\\\\78 ed',color:'#111'}}
    }
  });
  const p=F.readPackage(F.parseStoredZip(makePackage(t)));
  const css=F.stylesToCss(p.theme);
  assert.doesNotMatch(css,/javascript:/i);
  assert.doesNotMatch(css,/position:fixed/i);
  assert.match(css,/color:#222/);
  assert.match(css,/color:#111/);
});



test('import rejects oversized files before allocating their ArrayBuffer',async()=>{
  const html=readFileSync(new URL('../beauty/theme-import.html',import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match=>match[1].trim()).filter(Boolean);
  const script=scripts[scripts.length-1];
  function makeNode(){
    const node={handlers:{},textContent:'',disabled:false,hidden:false,value:'',className:'',
      classList:{add(){},remove(){}},addEventListener(type,callback){this.handlers[type]=callback},
      appendChild(){},setAttribute(){}};
    let inner='';
    Object.defineProperty(node,'innerHTML',{get(){return inner},set(value){inner=String(value)}});
    return node;
  }
  const ids={};
  ['toast','status','installedList','chooseFile','themeFile','importApply','clearFile','packagePreview','fileName',
   'previewName','previewVersion','previewCss','previewList','previewDetail','previewSummary'].forEach(id=>ids[id]=makeNode());
  const document={querySelector(selector){return selector.charAt(0)==='#'?(ids[selector.slice(1)]||null):null},createElement:makeNode};
  let readCalled=false;
  const windowMock={PhoneStorage:null,MAOMAOChatThemeFormat:{parseStoredZip(){throw new Error('不应读取超限文件')},readPackage(){}},dispatchEvent(){}};
  function CustomEvent(type){this.type=type}
  vm.runInNewContext(script,{window:windowMock,document,localStorage:{getItem(){return null}},CustomEvent,setTimeout(){},console});
  ids.themeFile.handlers.change({target:{files:[{
    name:'oversized.maomaotheme',size:48*1024*1024+1,
    arrayBuffer(){readCalled=true;return Promise.resolve(new ArrayBuffer(0))}
  }]}});
  for(let i=0;i<4;i++)await Promise.resolve();
  assert.equal(readCalled,false,'超过 48 MB 的文件不能先被读入内存');
  assert.equal(ids.packagePreview.hidden,true,'超限文件不能显示可导入的预览');
  assert.equal(ids.importApply.disabled,true,'超限文件不能进入导入流程');
  assert.match(ids.status.textContent,/超过 48 MB/,'应明确告知主题包体积超限');
});

test('installed chat themes export with CSS and MediaRepository assets',async()=>{
  const html=readFileSync(new URL('../beauty/theme-import.html',import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match=>match[1].trim()).filter(Boolean);
  const script=scripts[scripts.length-1];
  const links=[];
  function makeNode(tag){
    const node={tagName:tag,children:[],handlers:{},className:'',textContent:'',disabled:false,hidden:false,value:'',style:{},
      classList:{add(){},remove(){}},
      addEventListener(type,callback){this.handlers[type]=callback},
      appendChild(child){this.children.push(child);child.parentNode=this;return child},
      removeChild(child){this.children=this.children.filter(item=>item!==child);child.parentNode=null},
      setAttribute(){},click(){this.clicked=true}
    };
    if(tag==='a')links.push(node);
    let inner='';
    Object.defineProperty(node,'innerHTML',{get(){return inner},set(value){inner=String(value);if(value==='')node.children.length=0}});
    return node;
  }
  const ids={};
  ['toast','status','installedList','chooseFile','themeFile','importApply','clearFile','packagePreview','fileName',
   'previewName','previewVersion','previewCss','previewList','previewDetail','previewSummary'].forEach(id=>ids[id]=makeNode('div'));
  const assetBytes=new Uint8Array([137,80,78,71,13,10,26,10]);
  const theme={
    id:'installed-export-theme',sourceId:'source-theme',name:'Round / Trip: Theme?',version:'1.0.0',
    format:F.FORMAT,schemaVersion:F.VERSION,target:'maomao-chat',
    pages:{chatList:[{id:'statusBar'}],chatDetail:[{id:'detailHeader'}]},
    styles:{chatList:{},chatDetail:{}},
    blocks:{chatList:[{id:'custom-photo',type:'image',assetPath:'assets/photo.png',slot:'top-of-content'}],chatDetail:[]},
    layerOrder:{chatList:['statusBar','custom-photo'],chatDetail:['detailHeader']},motions:[],
    assetIndex:[{path:'assets/photo.png',name:'photo.png',type:'image',mimeType:'image/png'}],
    assetRefs:{'assets/photo.png':'asset-photo'},customCss:'.sample{color:#111}'
  };
  const values=new Map([['maomao_chat_theme_packages_v1',JSON.stringify([theme])],['maomao_chat_theme_active_v1',theme.id]]);
  const localStorage={getItem(key){return values.has(key)?values.get(key):null},setItem(key,value){values.set(key,String(value))},removeItem(key){values.delete(key)}};
  const body=makeNode('body'),downloads=[],revoked=[];
  const document={body,querySelector(selector){return selector.charAt(0)==='#'?(ids[selector.slice(1)]||null):null},createElement:makeNode};
  const media={getBlob(id){assert.equal(id,'asset-photo');return Promise.resolve({ok:true,value:{arrayBuffer(){return Promise.resolve(assetBytes.buffer.slice(0))}}})}};
  const phoneStorage={repository:{media(){return media}}};
  const windowMock={
    PhoneStorage:phoneStorage,MAOMAOChatThemeFormat:F,dispatchEvent(){},
    URL:{createObjectURL(blob){downloads.push({blob,url:'blob:theme-export'});return 'blob:theme-export'},revokeObjectURL(url){revoked.push(url)}}
  };
  function CustomEvent(type){this.type=type}
  vm.runInNewContext(script,{window:windowMock,PhoneStorage:phoneStorage,document,localStorage,CustomEvent,Blob,setTimeout(callback){callback();return 1},console});
  const row=ids.installedList.children[0];
  const exportButton=row.children[1].children[0];
  assert.equal(exportButton.textContent,'导出','每套已安装主题都应提供导出操作');
  exportButton.handlers.click();
  for(let i=0;i<12;i++)await Promise.resolve();
  assert.equal(downloads.length,1,'成功导出时应触发一个文件下载');
  assert.equal(exportButton.disabled,false,'导出结束后按钮应恢复可用');
  assert.equal(exportButton.textContent,'导出','导出结束后按钮文案应恢复');
  const download=downloads[0];
  const link=body.children.find(node=>node.tagName==='a');
  assert.equal(link,undefined,'下载链接点击后应从页面移除');
  assert.equal(links[0].download,'Round _ Trip_ Theme_.maomaotheme','下载文件名必须清理系统不允许的字符');
  assert.deepEqual(revoked,['blob:theme-export'],'下载后应释放临时对象 URL');
  const bytes=new Uint8Array(await download.blob.arrayBuffer());
  const parsed=F.readPackage(F.parseStoredZip(bytes));
  assert.equal(parsed.theme.name,theme.name);
  assert.equal(parsed.customCss,theme.customCss);
  assert.deepEqual(Array.from(parsed.assets['assets/photo.png'].bytes),Array.from(assetBytes));
});
test('full import then export preserves image assets and the imported manifest',async()=>{
  const html=readFileSync(new URL('../beauty/theme-import.html',import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match=>match[1].trim()).filter(Boolean);
  const script=scripts[scripts.length-1];
  function makeNode(tag){
    const node={tagName:tag,children:[],handlers:{},className:'',textContent:'',disabled:false,hidden:false,value:'',style:{},
      classList:{add(){},remove(){}},
      addEventListener(type,callback){this.handlers[type]=callback},
      appendChild(child){this.children.push(child);child.parentNode=this;return child},
      removeChild(child){this.children=this.children.filter(item=>item!==child);child.parentNode=null},
      setAttribute(){},click(){this.clicked=true}
    };
    let inner='';
    Object.defineProperty(node,'innerHTML',{get(){return inner},set(value){inner=String(value);if(value==='')node.children.length=0}});
    return node;
  }
  const ids={};
  ['toast','status','installedList','chooseFile','themeFile','importApply','clearFile','packagePreview','fileName',
   'previewName','previewVersion','previewCss','previewList','previewDetail','previewSummary'].forEach(id=>ids[id]=makeNode('div'));
  const values=new Map();
  const LIST_KEY='maomao_chat_theme_packages_v1',ACTIVE_KEY='maomao_chat_theme_active_v1';
  const localStorage={getItem(key){return values.has(key)?values.get(key):null},setItem(key,value){values.set(key,String(value))},removeItem(key){values.delete(key)}};
  const bytes=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3,4]);
  const blobs=new Map();
  const media={
    putBlob(blob,options){
      const id='asset-imported-image';
      blobs.set(id,blob);
      assert.equal(options.ownerType,'chat-theme-package','导入素材必须使用主题包 owner 类型');
      return Promise.resolve({ok:true,value:{assetId:id}});
    },
    getBlob(id){
      assert.ok(blobs.has(id),'导出只能读取本次导入保存的素材');
      return Promise.resolve({ok:true,value:blobs.get(id)});
    }
  };
  const phoneStorage={repository:{media(){return media}}};
  const theme={
    format:F.FORMAT,schemaVersion:F.VERSION,target:'maomao-chat',
    id:'round-trip-theme',name:'导入再导出主题',version:'1.0.0',
    pages:{chatList:[{id:'statusBar'},{id:'custom-photo'}],chatDetail:[{id:'detailHeader'}]},
    styles:{chatList:{},chatDetail:{}},
    blocks:{chatList:[{id:'custom-photo',type:'image',title:'',text:'',assetPath:'assets/photo.png',slot:'top-of-content',visible:true}],chatDetail:[]},
    layerOrder:{chatList:['statusBar','custom-photo'],chatDetail:['detailHeader']},
    motions:[],
    assetIndex:[{path:'assets/photo.png',name:'photo.png',mimeType:'image/png',type:'image'}]
  };
  const windowMock={
    PhoneStorage:phoneStorage,MAOMAOChatThemeFormat:{
      parseStoredZip(buffer){return buffer},
      readPackage(){return{theme,customCss:'.sample{background:url("assets/photo.png")}',assets:{
        'assets/photo.png':{bytes,mimeType:'image/png',type:'image'}
      }}}
    },
    dispatchEvent(){},
    URL:{createObjectURL(blob){windowMock.download=blob;return 'blob:round-trip'},revokeObjectURL(){}}
  };
  const body=makeNode('body');
  const document={body,querySelector(selector){return selector.charAt(0)==='#'?(ids[selector.slice(1)]||null):null},createElement:makeNode};
  function CustomEvent(type){this.type=type}
  vm.runInNewContext(script,{window:windowMock,PhoneStorage:phoneStorage,document,localStorage,CustomEvent,Blob,setTimeout(callback){callback();return 1},console});
  ids.themeFile.handlers.change({target:{files:[{name:'round-trip.maomaotheme',arrayBuffer(){return Promise.resolve('package')}}]}});
  for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(ids.importApply.disabled,false,'有效主题包必须允许导入');
  ids.importApply.handlers.click();
  for(let i=0;i<24;i++)await Promise.resolve();
  const installed=JSON.parse(localStorage.getItem(LIST_KEY)||'[]');
  assert.equal(installed.length,1,'导入应只安装一套主题');
  assert.ok(Array.isArray(installed[0].assetIndex),'导入保存后必须继续保留 assetIndex');
  assert.deepEqual(installed[0].assetIndex,[{path:'assets/photo.png',name:'photo.png',mimeType:'image/png',type:'image'}]);
  assert.equal(installed[0].assetRefs['assets/photo.png'],'asset-imported-image','导入后应保存素材 assetId 引用');
  const exportButton=ids.installedList.children[0].children[1].children[0];
  exportButton.handlers.click();
  for(let i=0;i<24;i++)await Promise.resolve();
  assert.ok(windowMock.download,'导入后的已安装主题应能直接导出');
  const archive=new Uint8Array(await windowMock.download.arrayBuffer());
  const parsed=F.readPackage(F.parseStoredZip(archive));
  assert.equal(parsed.theme.name,theme.name,'导出包应保留主题信息');
  assert.deepEqual(parsed.theme.assetIndex,[{path:'assets/photo.png',name:'photo.png',mimeType:'image/png',type:'image'}]);
  assert.deepEqual(Array.from(parsed.assets['assets/photo.png'].bytes),Array.from(bytes),'真实导入后再导出必须保留图片二进制');
  assert.match(parsed.customCss,/url\("assets\/photo\.png"\)/,'主题 CSS 中的素材 URL 应随图片一起保留');
  assert.equal(exportButton.disabled,false,'完成导出后按钮应恢复');
});

test('legacy installed themes recover missing asset manifests from owner-scoped MediaRepository metadata',async()=>{
  const html=readFileSync(new URL('../beauty/theme-import.html',import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match=>match[1].trim()).filter(Boolean);
  const script=scripts[scripts.length-1];
  const links=[];
  function makeNode(tag){
    const node={tagName:tag,children:[],handlers:{},className:'',textContent:'',disabled:false,hidden:false,value:'',style:{},
      classList:{add(){},remove(){}},
      addEventListener(type,callback){this.handlers[type]=callback},
      appendChild(child){this.children.push(child);child.parentNode=this;return child},
      removeChild(child){this.children=this.children.filter(item=>item!==child);child.parentNode=null},
      setAttribute(){},click(){this.clicked=true}
    };
    if(tag==='a')links.push(node);
    let inner='';
    Object.defineProperty(node,'innerHTML',{get(){return inner},set(value){inner=String(value);if(value==='')node.children.length=0}});
    return node;
  }
  const ids={};
  ['toast','status','installedList','chooseFile','themeFile','importApply','clearFile','packagePreview','fileName',
   'previewName','previewVersion','previewCss','previewList','previewDetail','previewSummary'].forEach(id=>ids[id]=makeNode('div'));
  const fontBytes=new Uint8Array([0,1,2,3,4,5]);
  const theme={
    id:'legacy-installed-theme',name:'旧版已安装主题',version:'1.0.0',
    format:F.FORMAT,schemaVersion:F.VERSION,target:'maomao-chat',
    pages:{chatList:[],chatDetail:[]},styles:{chatList:{},chatDetail:{}},
    blocks:{chatList:[],chatDetail:[]},layerOrder:{chatList:[],chatDetail:[]},motions:[],
    assetRefs:{'assets/legacy-font.woff2':'asset-legacy-font'},customCss:'.sample{color:#111}'
  };
  assert.equal(Object.prototype.hasOwnProperty.call(theme,'assetIndex'),false,'测试对象应模拟旧版本已丢失 assetIndex 的已安装主题');
  const values=new Map([['maomao_chat_theme_packages_v1',JSON.stringify([theme])]]);
  const localStorage={getItem(key){return values.has(key)?values.get(key):null},setItem(key,value){values.set(key,String(value))},removeItem(key){values.delete(key)}};
  const downloads=[];
  const body=makeNode('body');
  const document={body,querySelector(selector){return selector.charAt(0)==='#'?(ids[selector.slice(1)]||null):null},createElement:makeNode};
  const calls={listByOwner:0,getBlob:0};
  const media={
    listByOwner(ownerType,ownerId){
      calls.listByOwner++;
      assert.equal(ownerType,'chat-theme-package','恢复素材时必须限制在主题包 owner 类型');
      assert.equal(ownerId,theme.id,'恢复素材时必须限制在当前主题 ID');
      return Promise.resolve({ok:true,value:[{assetId:'asset-legacy-font',mimeType:'font/woff2',type:'file'}]});
    },
    getBlob(assetId){
      calls.getBlob++;
      assert.equal(assetId,'asset-legacy-font','必须通过旧主题保留的 assetId 读取素材');
      return Promise.resolve({ok:true,value:{arrayBuffer(){return Promise.resolve(fontBytes.buffer.slice(0))}}});
    }
  };
  const phoneStorage={repository:{media(){return media}}};
  const windowMock={
    PhoneStorage:phoneStorage,MAOMAOChatThemeFormat:F,dispatchEvent(){},
    URL:{createObjectURL(blob){downloads.push(blob);return 'blob:legacy-theme-export'},revokeObjectURL(){}}
  };
  function CustomEvent(type){this.type=type}
  vm.runInNewContext(script,{window:windowMock,PhoneStorage:phoneStorage,document,localStorage,CustomEvent,Blob,setTimeout(callback){callback();return 1},console});
  const row=ids.installedList.children[0];
  const exportButton=row.children[1].children[0];
  exportButton.handlers.click();
  for(let i=0;i<24;i++)await Promise.resolve();
  assert.equal(calls.listByOwner,1,'旧版记录应只读取当前主题 owner 的素材元数据');
  assert.equal(calls.getBlob,1,'恢复元数据后应读取对应素材二进制');
  assert.equal(downloads.length,1,'旧版已安装主题应能成功重新导出');
  const archive=new Uint8Array(await downloads[0].arrayBuffer());
  const parsed=F.readPackage(F.parseStoredZip(archive));
  assert.deepEqual(parsed.theme.assetIndex,[{
    path:'assets/legacy-font.woff2',name:'legacy-font.woff2',mimeType:'font/woff2',type:'font'
  }],'导出包应补回旧记录缺失的素材清单');
  assert.deepEqual(Array.from(parsed.assets['assets/legacy-font.woff2'].bytes),Array.from(fontBytes),'导出包必须包含旧主题原来的字体二进制');
  assert.equal(Object.prototype.hasOwnProperty.call(theme,'assetIndex'),false,'恢复过程不能修改或迁移用户已安装主题记录');
  assert.equal(exportButton.disabled,false,'导出完成后按钮应恢复可用');
});
test('import preview ignores stale file reads after a newer selection or clear',async()=>{
  const html=readFileSync(new URL('../beauty/theme-import.html',import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match=>match[1].trim()).filter(Boolean);
  const script=scripts[scripts.length-1];
  function makeNode(tag){
    const node={tagName:tag,children:[],handlers:{},className:'',textContent:'',disabled:false,hidden:false,value:'',style:{},
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
  ['toast','status','installedList','chooseFile','themeFile','importApply','clearFile','packagePreview','fileName',
   'previewName','previewVersion','previewCss','previewList','previewDetail','previewSummary'].forEach(id=>ids[id]=makeNode('div'));
  const document={querySelector(selector){return selector.charAt(0)==='#'?(ids[selector.slice(1)]||null):null},createElement:makeNode};
  const localStorage={getItem(){return null},setItem(){},removeItem(){}};
  const windowMock={
    PhoneStorage:null,
    MAOMAOChatThemeFormat:{
      parseStoredZip(buffer){return buffer},
      readPackage(marker){return{
        theme:{name:'主题 '+marker,version:'1.0.0',pages:{chatList:[],chatDetail:[]},motions:[]},
        customCss:'',assets:{}
      }}
    },
    dispatchEvent(){}
  };
  function CustomEvent(type){this.type=type}
  vm.runInNewContext(script,{window:windowMock,document,localStorage,CustomEvent,setTimeout(){},console});
  function deferredFile(name){
    let resolve,reject;
    const promise=new Promise((yes,no)=>{resolve=yes;reject=no});
    return{name,arrayBuffer(){return promise},resolve,reject};
  }
  async function flush(){for(let i=0;i<6;i++)await Promise.resolve()}
  const older=deferredFile('旧文件.maomaotheme');
  const newer=deferredFile('新文件.maomaotheme');
  ids.themeFile.handlers.change({target:{files:[older]}});
  ids.themeFile.handlers.change({target:{files:[newer]}});
  newer.resolve('新文件');
  await flush();
  assert.equal(ids.previewName.textContent,'主题 新文件','较新的选择应先显示自己的预览');
  older.resolve('旧文件');
  await flush();
  assert.equal(ids.previewName.textContent,'主题 新文件','较早完成的文件读取不能覆盖新预览');
  assert.equal(ids.fileName.textContent,'新文件.maomaotheme','文件名必须与当前预览一致');
  assert.equal(ids.importApply.disabled,false,'当前有效预览应保持可导入');

  const cancelled=deferredFile('已取消.maomaotheme');
  ids.themeFile.handlers.change({target:{files:[cancelled]}});
  ids.clearFile.handlers.click();
  cancelled.reject(new Error('取消前的文件读取失败'));
  await flush();
  assert.equal(ids.packagePreview.hidden,true,'清空选择后，迟到的读取不能重新显示预览');
  assert.equal(ids.importApply.disabled,true,'清空选择后必须保持不可导入');
  assert.equal(ids.fileName.textContent,'尚未选择文件','清空选择后不能恢复旧文件名');
  assert.match(ids.status.textContent,/可以重新选择一个主题包/,'过期读取错误不能覆盖清空状态');
});


test('import rollback reports failed MediaRepository cleanup without deleting shared assets',async()=>{
  const html=readFileSync(new URL('../beauty/theme-import.html',import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match=>match[1].trim()).filter(Boolean);
  const script=scripts[scripts.length-1];
  function makeNode(tag){
    const node={tagName:tag,children:[],handlers:{},className:'',textContent:'',disabled:false,hidden:false,value:'',style:{},
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
  ['toast','status','installedList','chooseFile','themeFile','importApply','clearFile','packagePreview','fileName',
   'previewName','previewVersion','previewCss','previewList','previewDetail','previewSummary'].forEach(id=>ids[id]=makeNode('div'));
  const document={querySelector(selector){return selector.charAt(0)==='#'?(ids[selector.slice(1)]||null):null},createElement:makeNode};
  const values=new Map();
  const LIST_KEY='maomao_chat_theme_packages_v1',ACTIVE_KEY='maomao_chat_theme_active_v1';
  const localStorage={
    getItem(key){return values.has(key)?values.get(key):null},
    setItem(key,value){if(key===ACTIVE_KEY)throw new Error('模拟活动主题写入失败');values.set(key,String(value))},
    removeItem(key){values.delete(key)}
  };
  const calls={putBlob:[],removeRef:[],removeAsset:[]};
  const media={
    putBlob(blob,options){
      const index=calls.putBlob.length;
      calls.putBlob.push({blob,options});
      return Promise.resolve({ok:true,value:{assetId:index===0?'asset-shared':'asset-cleanup-failed'}});
    },
    removeRef(id,ownerType,ownerId){
      calls.removeRef.push({id,ownerType,ownerId});
      if(id==='asset-shared')return Promise.resolve({ok:true,value:{removed:true,refCount:1}});
      return Promise.resolve({ok:false,error:{code:'STORAGE_ERROR',message:'模拟引用删除失败'}});
    },
    removeAsset(id){calls.removeAsset.push(id);return Promise.resolve({ok:true,value:{removed:true}})}
  };
  const phoneStorage={repository:{media(){return media}}};
  const windowMock={
    PhoneStorage:phoneStorage,
    MAOMAOChatThemeFormat:{
      parseStoredZip(buffer){return buffer},
      readPackage(){return{
        theme:{id:'rollback-theme',name:'回滚测试主题',version:'1.0.0',pages:{chatList:[],chatDetail:[]},motions:[]},
        customCss:'',assets:{
          'assets/shared.png':{bytes:new Uint8Array([1,2,3]),mimeType:'image/png',type:'image'},
          'assets/second.png':{bytes:new Uint8Array([4,5,6]),mimeType:'image/png',type:'image'}
        }
      }}
    },
    dispatchEvent(){}
  };
  function CustomEvent(type){this.type=type}
  vm.runInNewContext(script,{window:windowMock,PhoneStorage:phoneStorage,document,localStorage,CustomEvent,Blob,setTimeout(){},console});
  ids.themeFile.handlers.change({target:{files:[{name:'rollback.maomaotheme',arrayBuffer(){return Promise.resolve('package')}}]}});
  for(let i=0;i<6;i++)await Promise.resolve();
  assert.equal(ids.importApply.disabled,false,'有效主题包应允许开始导入');
  ids.importApply.handlers.click();
  for(let i=0;i<24;i++)await Promise.resolve();
  assert.equal(JSON.parse(localStorage.getItem(LIST_KEY)||'[]').length,0,'活动主题写入失败后必须恢复原主题列表');
  assert.equal(localStorage.getItem(ACTIVE_KEY),null,'活动主题写入失败后不能留下半应用状态');
  assert.equal(calls.removeRef.length,2,'必须逐项尝试清理本次新增引用');
  assert.deepEqual(calls.removeAsset,[],'共享资产仍有其他引用时不能删除；引用清理失败时也不能贸然删素材');
  assert.match(ids.status.textContent,/主题设置已回滚/,'应明确说明主题设置已回滚');
  assert.match(ids.status.textContent,/1 项新增素材清理未能确认完成/,'MediaRepository 返回 ok:false 时必须报告清理未完成');
  assert.doesNotMatch(ids.status.textContent,/新增素材已回滚/,'清理未确认时不能宣称所有素材都已回滚');
});


test('import locks file selection and uses one immutable package snapshot',async()=>{
  const html=readFileSync(new URL('../beauty/theme-import.html',import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match=>match[1].trim()).filter(Boolean);
  const script=scripts[scripts.length-1];
  function makeNode(tag){
    const node={tagName:tag,children:[],handlers:{},className:'',textContent:'',disabled:false,hidden:false,value:'',style:{},
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
  ['toast','status','installedList','chooseFile','themeFile','importApply','clearFile','packagePreview','fileName',
   'previewName','previewVersion','previewCss','previewList','previewDetail','previewSummary'].forEach(id=>ids[id]=makeNode('div'));
  const document={querySelector(selector){return selector.charAt(0)==='#'?(ids[selector.slice(1)]||null):null},createElement:makeNode};
  const values=new Map();
  const LIST_KEY='maomao_chat_theme_packages_v1',ACTIVE_KEY='maomao_chat_theme_active_v1';
  const localStorage={
    getItem(key){return values.has(key)?values.get(key):null},
    setItem(key,value){values.set(key,String(value))},
    removeItem(key){values.delete(key)}
  };
  let finishFirstPut;
  const firstPut=new Promise(resolve=>{finishFirstPut=resolve});
  const writes=[];
  const media={
    putBlob(blob,options){
      writes.push({blob,options});
      return writes.length===1?firstPut:Promise.resolve({ok:true,value:{assetId:'asset-from-package-A-2'}});
    },
    removeRef(){return Promise.resolve({ok:true,value:{removed:true,refCount:0}})},
    removeAsset(){return Promise.resolve({ok:true,value:{removed:true}})}
  };
  const phoneStorage={repository:{media(){return media}}};
  const windowMock={
    PhoneStorage:phoneStorage,
    MAOMAOChatThemeFormat:{
      parseStoredZip(buffer){return buffer},
      readPackage(marker){return{
        theme:{id:marker,name:'主题 '+marker,version:'1.0.0',pages:{chatList:[],chatDetail:[]},motions:[],assetIndex:[
          {path:'assets/first.png',name:'first.png',mimeType:'image/png',type:'image'},
          {path:'assets/second.png',name:'second.png',mimeType:'image/png',type:'image'}
        ]},
        customCss:'.msg-bubble{color:'+(marker==='A'?'#111':'#222')+'}',
        assets:{
          'assets/first.png':{bytes:new Uint8Array([1,2,3]),mimeType:'image/png',type:'image'},
          'assets/second.png':{bytes:new Uint8Array([4,5,6]),mimeType:'image/png',type:'image'}
        }
      }}
    },
    dispatchEvent(){}
  };
  function CustomEvent(type){this.type=type}
  vm.runInNewContext(script,{window:windowMock,PhoneStorage:phoneStorage,document,localStorage,CustomEvent,Blob,setTimeout(){},console});
  let secondFileRead=false;
  const fileA={name:'主题A.maomaotheme',arrayBuffer(){return Promise.resolve('A')}};
  const fileB={name:'主题B.maomaotheme',arrayBuffer(){secondFileRead=true;return Promise.resolve('B')}};
  ids.themeFile.handlers.change({target:{files:[fileA]}});
  for(let i=0;i<6;i++)await Promise.resolve();
  assert.equal(ids.previewName.textContent,'主题 A','应先预览用户选择的主题 A');

  ids.importApply.handlers.click();
  assert.equal(ids.chooseFile.disabled,true,'导入期间应锁定选择文件按钮');
  assert.equal(ids.clearFile.disabled,true,'导入期间应锁定重新选择按钮');
  assert.equal(ids.themeFile.disabled,true,'导入期间应锁定文件输入');
  ids.themeFile.handlers.change({target:{files:[fileB]}}); 
  ids.clearFile.handlers.click();
  assert.equal(secondFileRead,false,'导入期间的新文件选择必须被忽略');
  assert.equal(ids.fileName.textContent,'主题A.maomaotheme','导入期间不能更换当前文件');

  for(let i=0;i<6;i++)await Promise.resolve();
  assert.equal(writes.length,1,'首个素材写入应处于等待状态');
  finishFirstPut({ok:true,value:{assetId:'asset-from-package-A-1'}});
  for(let i=0;i<24;i++)await Promise.resolve();

  const installed=JSON.parse(localStorage.getItem(LIST_KEY)||'[]');
  assert.equal(installed.length,1,'导入结束后只应保存一套主题');
  assert.equal(installed[0].sourceId,'A','保存的主题必须来自原始快照 A');
  assert.match(installed[0].customCss,/color:#111/,'CSS 必须来自原始快照 A，不能混入主题 B');
  assert.deepEqual(installed[0].assetRefs,{
    'assets/first.png':'asset-from-package-A-1',
    'assets/second.png':'asset-from-package-A-2'
  },'素材引用必须全部来自同一套原始主题包');
  assert.deepEqual(installed[0].assetIndex,[
    {path:'assets/first.png',name:'first.png',mimeType:'image/png',type:'image'},
    {path:'assets/second.png',name:'second.png',mimeType:'image/png',type:'image'}
  ],'导入后必须保留素材清单元数据，供重新导出时按 assetId 找回二进制文件');
  assert.equal(writes.length,2,'两项素材都应按快照 A 写入');
  assert.equal(writes[0].options.ownerId,writes[1].options.ownerId,'同一主题的所有素材必须使用同一个 ownerId');
  assert.equal(ids.chooseFile.disabled,false,'导入完成后应重新启用文件选择');
  assert.equal(ids.clearFile.disabled,false,'导入完成后应重新启用重新选择');
  assert.equal(ids.themeFile.disabled,false,'导入完成后应重新启用文件输入');
  assert.equal(ids.packagePreview.hidden,true,'成功导入后应关闭预览');
});


test('theme CSS rejects global keyframes including comment and escape obfuscation',()=>{
  const blocked=[
    '@keyframes fadeIn{from{opacity:0}to{opacity:1}}',
    '@-webkit-keyframes fadeIn{from{opacity:0}to{opacity:1}}',
    '@key/**/frames fadeIn{from{opacity:0}to{opacity:1}}',
    String.raw`@k\65 yframes fadeIn{from{opacity:0}to{opacity:1}}`
  ];
  blocked.forEach(css=>assert.throws(()=>F.validateCss(css),/不允许/));
  assert.doesNotThrow(()=>F.validateCss('.msg-bubble{transition:opacity .2s ease-out}'));
});


test('imported font faces are namespaced to the active chat theme',()=>{
  const theme=fixture({
    id:'font-theme-42',
    styles:{chatList:{statusBar:{fontFamily:'Shared Font'}},chatDetail:{}}
  });
  const css=F.buildScopedCss(theme,
    '@font-face{font-family:"Shared Font";src:url("assets/shared-font.woff2");font-weight:400}'+
    '.sample{font-family:"Shared Font",sans-serif}'
  );
  const family=(css.match(/@font-face\s*\{[^}]*font-family:\s*"([^"]+)"/i)||[])[1];
  assert.ok(family,'主题包字体必须保留可用的 font-face 定义');
  assert.match(family,/^MAOMAOChatTheme_font-theme-42_/,'字体名称必须附带当前主题命名空间');
  assert.ok(css.includes('font-family:'+family+' !important'),'主题组件的字体引用也必须同步命名');
  assert.ok(css.includes('font-family:"'+family+'", sans-serif'),'自定义 CSS 字体引用必须同步命名');
  assert.doesNotMatch(css,/font-family:\s*"Shared Font"/,'不能把原始字体族名称注册到全局');
  assert.match(css,/url\("assets\/shared-font\.woff2"\)/,'字体素材 URL 必须保留给运行时替换');
});

test('theme CSS rejects global at-rules outside the grouping and namespaced-font allowlist',()=>{
  assert.throws(()=>F.validateCss('@property --unsafe{syntax:"*";inherits:false}'),/白名单/);
  assert.throws(()=>F.validateCss('@layer app{.sample{color:#111}}'),/白名单/);
  assert.doesNotThrow(()=>F.validateCss('@media (max-width:600px){.sample{font-size:14px}}'));
});


test('custom component IDs are isolated between chat list and chat detail styles',()=>{
  const sameId='custom-shared-card';
  const theme=fixture({
    pages:{
      chatList:[{id:'statusBar'},{id:sameId}],
      chatDetail:[{id:'detailHeader'},{id:sameId}]
    },
    styles:{
      chatList:{[sameId]:{color:'#111',background:'#fff'}},
      chatDetail:{[sameId]:{color:'#fff',background:'#111'}}
    },
    blocks:{
      chatList:[{id:sameId,type:'card',title:'列表卡片',slot:'top-of-content'}],
      chatDetail:[{id:sameId,type:'card',title:'详情卡片',slot:'before-header'}]
    },
    layerOrder:{
      chatList:[sameId],
      chatDetail:[sameId]
    }
  });
  const css=F.stylesToCss(F.readPackage(F.parseStoredZip(makePackage(theme))).theme);
  const listSelector='[data-maomao-theme-page="chatList"][data-maomao-theme-block="'+sameId+'"]';
  const detailSelector='[data-maomao-theme-page="chatDetail"][data-maomao-theme-block="'+sameId+'"]';
  assert.ok(css.includes(listSelector),'聊天列表自定义组件样式必须带 chatList 页面标记');
  assert.ok(css.includes(detailSelector),'聊天详情自定义组件样式必须带 chatDetail 页面标记');
  assert.ok(css.includes(listSelector+'{background:#fff !important;color:#111 !important}'),'聊天列表样式不能被详情页同 ID 组件覆盖');
  assert.ok(css.includes(detailSelector+'{background:#111 !important;color:#fff !important}'),'聊天详情样式不能被列表页同 ID 组件覆盖');
});

test('runtime marks each mounted custom block with its owning chat page',async()=>{
  const runtimeSource=readFileSync(new URL('../shared/js/chat-theme-package-runtime.js',import.meta.url),'utf8');
  const theme={
    id:'page-tag-theme',
    blocks:{chatList:[{id:'custom-shared-card',type:'text',text:'列表',slot:'top-of-content'}],chatDetail:[]},
    motions:[]
  };
  const values=new Map([
    ['maomao_chat_theme_packages_v1',JSON.stringify([theme])],
    ['maomao_chat_theme_active_v1',theme.id]
  ]);
  const localStorage={
    getItem(key){return values.has(key)?values.get(key):null},
    setItem(key,value){values.set(key,String(value))},
    removeItem(key){values.delete(key)}
  };
  const nodes=[],main={
    firstElementChild:null,
    insertBefore(node){nodes.push(node);node.parentNode=this;return node}
  };
  const attributes=new Map();
  function makeNode(tag){
    return{
      tagName:tag,children:[],style:{setProperty(){},removeProperty(){}},
      classList:{add(){},remove(){}},
      attributes,
      setAttribute(name,value){attributes.set(name,String(value))},
      appendChild(child){this.children.push(child);child.parentNode=this;return child},
      remove(){this.removed=true}
    };
  }
  const styleNodes=new Map();
  const shell={
    classList:{add(){},remove(){}},
    style:{setProperty(){},removeProperty(){}},
    setAttribute(){},removeAttribute(){},
    querySelector(selector){return selector==='.main-stage'?main:null},
    querySelectorAll(){return[]}
  };
  const document={
    readyState:'complete',
    querySelector(selector){return selector==='.phone-mockup'?shell:null},
    getElementById(id){return styleNodes.get(id)||null},
    createElement:makeNode,
    head:{appendChild(node){styleNodes.set(node.id,node)}}
  };
  const phoneStorage={repository:{media(){return{}}}};
  const windowMock={
    MAOMAOChatThemeFormat:{buildScopedCss(){return''}},
    PhoneStorage:phoneStorage,
    location:{pathname:'/chat/chat.html'},
    requestAnimationFrame(callback){callback()},
    addEventListener(){},
    dispatchEvent(){}
  };
  vm.runInNewContext(runtimeSource,{window:windowMock,document,localStorage,PhoneStorage:phoneStorage,console:{error(){}},setTimeout});
  for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(nodes.length,1,'当前页面应只挂载聊天列表自己的自定义组件');
  assert.equal(attributes.get('data-maomao-theme-page'),'chatList','运行时组件必须携带所属页面标记');
  assert.equal(attributes.get('data-maomao-theme-block'),'custom-shared-card','运行时组件 ID 应保持不变');
});


test('package normalization deduplicates page components, custom blocks and layer order per page',()=>{
  const theme=fixture({
    pages:{
      chatList:[
        {id:'statusBar'},
        {id:'statusBar'},
        {id:'custom-duplicate'},
        {id:'custom-duplicate'}
      ],
      chatDetail:[
        {id:'detailHeader'},
        {id:'custom-duplicate'}
      ]
    },
    blocks:{
      chatList:[
        {id:'custom-duplicate',type:'text',text:'第一次'},
        {id:'custom-duplicate',type:'text',text:'重复项不应挂载'}
      ],
      chatDetail:[
        {id:'custom-duplicate',type:'card',title:'详情页独立组件'}
      ]
    },
    styles:{
      chatList:{'custom-duplicate':{color:'#111'}},
      chatDetail:{'custom-duplicate':{color:'#fff'}}
    },
    layerOrder:{
      chatList:['statusBar','custom-duplicate','custom-duplicate'],
      chatDetail:['custom-duplicate','custom-duplicate']
    }
  });
  const normalized=F.readPackage(F.parseStoredZip(makePackage(theme))).theme;
  assert.deepEqual(normalized.pages.chatList.map(x=>x.id),['statusBar','custom-duplicate'],'同一页面的布局 ID 必须去重');
  assert.deepEqual(normalized.pages.chatDetail.map(x=>x.id),['detailHeader','custom-duplicate'],'另一页面可以独立使用相同自定义 ID');
  assert.equal(normalized.blocks.chatList.length,1,'同一页面重复自定义块只能保留一份');
  assert.equal(normalized.blocks.chatList[0].text,'第一次','去重应保留首次出现的定义');
  assert.equal(normalized.blocks.chatDetail.length,1,'详情页的同名块不能被列表页去重影响');
  assert.deepEqual(normalized.layerOrder.chatList,['statusBar','custom-duplicate'],'同一页面图层顺序不能重复同一 ID');
  assert.deepEqual(normalized.layerOrder.chatDetail,['custom-duplicate'],'详情页图层顺序应独立去重');
});
