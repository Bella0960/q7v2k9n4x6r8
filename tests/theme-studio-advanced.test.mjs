import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const source = read('shared/js/theme-studio-runtime.js');
const assetSource = read('shared/js/theme-studio-assets.js');
const css = read('shared/css/theme-studio-runtime.css');
const studioHTML = read('theme-studio/theme-studio.html');
const studioJS = read('theme-studio/studio.js');
function boot(path='/chat/chat/chat.html',raw=null){
  const memory=new Map();
  if(raw!==null)memory.set('maomao_theme_studio_v1',JSON.stringify(raw));
  const attributes=new Map(),styles=new Map(),shell={
    setAttribute(k,v){attributes.set(k,v);},
    removeAttribute(k){attributes.delete(k);},
    style:{setProperty(k,v){styles.set(k,v);},removeProperty(k){styles.delete(k);}}
  };
  const global={location:{pathname:path},localStorage:{
    getItem(k){return memory.get(k)??null;},
    setItem(k,v){memory.set(k,String(v));}
  },document:{readyState:'complete',querySelector(s){return s==='.phone-mockup'?shell:null;}},
  addEventListener(){}};
  global.window=global;
  vm.runInNewContext(source,global);
  return {api:global.MAOMAOThemeStudio,attributes,styles,memory,global};
}
test('legacy v1 presets and opt-in flags survive expanded schema without destructive migration',()=>{
  const baseline={v:1,enabled:{list:true,detail:false},list:{headerBg:'#f0f0f0',itemRadius:12},detail:{chatBg:'#eeeeee'},presets:[],updatedAt:100};
  const app=boot('/chat/chat/chat.html',baseline);
  assert.equal(app.api.read().list.headerBg,'#f0f0f0');
  assert.equal(app.api.read().list.itemRadius,12);
  assert.equal(app.api.read().list.coverImage,'');
  assert.equal(app.api.read().detail.chatImage,'');
  assert.equal(app.attributes.get('data-ts-list'),'1');
  assert.equal(app.attributes.has('data-ts-detail'),false);
  assert.equal(app.api.save(app.api.read()),true);
  assert.equal(JSON.parse(app.memory.get(app.api.KEY)).v,1);
});
test('media is stored as IDB asset ID only and unsafe image URLs are rejected',()=>{
  const app=boot(),state=app.api.read();
  state.enabled.list=true;state.enabled.detail=true;
  const valid='as_'+'A'.repeat(32);
  state.list.coverImage=valid;state.list.listImage='data:image/png;base64,AAAAAAAA';
  state.detail.chatImage='https://example.test/image.png';
  assert.equal(app.api.save(state),true);
  const saved=app.api.read();
  assert.equal(saved.list.coverImage,valid);
  assert.equal(saved.list.listImage,'');
  assert.equal(saved.detail.chatImage,'');
  assert.ok(!app.memory.get(app.api.KEY).includes('data:image'));
  assert.equal(app.styles.has('--ts-list-cover-image'),false,'no media IDs may be written directly as CSS');
});
test('extended list/detail controls are clamped and remain opt-in to current chat surfaces',()=>{
  const app=boot(),state=app.api.read();
  state.enabled.list=true;state.enabled.detail=true;
  state.list.avatarSize=200;state.list.coverOpacity=31;state.list.coverPosition=75;
  state.detail.chatPadding=16;state.detail.headerHeight=60;
  assert.ok(app.api.save(state));
  const list=boot('/chat/chat/chat.html',JSON.parse(app.memory.get(app.api.KEY)));
  const detail=boot('/chat/chat/chat-detail.html',JSON.parse(app.memory.get(app.api.KEY)));
  assert.equal(list.styles.get('--ts-list-avatar-size'),'60px');
  assert.equal(list.styles.get('--ts-list-cover-opacity'),'31%');
  assert.equal(list.styles.get('--ts-list-cover-position'),'75%');
  assert.equal(detail.styles.get('--ts-detail-chat-padding'),'16px');
  assert.equal(detail.styles.get('--ts-detail-header-height'),'60px');
  assert.equal(list.styles.has('--ts-detail-chat-padding'),false);
});
test('registerField offers a versioned opt-in extension without changing stored legacy fields',()=>{
  const app=boot();
  assert.equal(app.api.registerField('list',{key:'futureDensity',label:'扩展密度',type:'number',default:12,min:3,max:30,section:'扩展'}),true);
  assert.equal(app.api.registerField('list',{key:'futureDensity',type:'number',default:9,min:1,max:12}),false);
  assert.equal(app.api.registerField('list',{key:'unsafeCss',type:'color',default:'url(javascript:1)'}),false);
  assert.equal(app.api.read().list.futureDensity,12);
  const draft=app.api.read();draft.list.futureDensity=70;
  assert.equal(app.api.save(draft),true);
  assert.equal(app.api.read().list.futureDensity,30);
  assert.equal(app.api.EXTENSION_FIELDS.list.length,1);
});
test('image adapter rejects scripts, oversized and non-image files before hitting any database',async()=>{
  const w={URL,Promise};w.window=w;vm.runInNewContext(assetSource,w);
  const service=w.MAOMAOThemeStudioAssets;
  assert.equal(service.valid('as_'+'B'.repeat(32)),true);
  assert.equal(service.valid('data:image/png;base64,bad'),false);
  await assert.rejects(service.upload({type:'image/svg+xml',size:100},'list.coverImage'),/PNG/);
  await assert.rejects(service.upload({type:'image/png',size:9000000},'list.coverImage'),/8MB/);
  await assert.rejects(service.upload({type:'image/png',size:100},'list.unknown'),/未知/);
});
test('native chat structures and preview share semantics; image scopes never affect group settings',()=>{
  const real=read('chat/chat/chat.html');
  assert.match(real,/class="cover-gradient-banner" id="coverBox"/);
  assert.match(real,/class="white-profile-stage"/);
  assert.match(real,/class="floating-music-card"/);
  assert.match(real,/class="chat-slim-card"/);
  for(const fragment of ['mock-cover','mock-profile-stage','mock-music-card','mock-card chat-slim-card','chat-title-row','chat-last-msg','mock-detail-header chat-header','mock-messages chat-stage'])
    assert.ok(studioHTML.includes(fragment),'preview missing real feature: '+fragment);
  assert.match(studioHTML,/id="imageSlots"/);
  assert.match(studioHTML,/id="imageFile"/);
  assert.match(studioHTML,/id="previewMode"/);
  assert.match(studioJS,/assets\.upload\(file,/);
  assert.match(css,/data-ts-list-cover="1"/);
  assert.match(css,/data-ts-list-paper="1"/);
  assert.match(css,/data-ts-detail-image="1"/);
  assert.doesNotMatch(css,/(group-settings|group-composer|groupModal)/);
});
test('new picture adapter is loaded only by chat list, detail and studio',()=>{
  for(const file of ['chat/chat/chat.html','chat/chat/chat-detail.html','theme-studio/theme-studio.html']){
    const html=read(file);
    assert.match(html,/theme-studio-assets\.js/);
    assert.match(html,/storage\/media-repository\.js/);
  }
  // SW cache can advance, but may not regress to the pre-signing build.
  const workerCache = read('sw.js');
  const version = Number(workerCache.match(/const CACHE_NAME = 'phone-app-pwa-v(\d+)'/)?.[1] || 0);
  assert.ok(version >= 285, 'signed-card runtime requires a cache generation newer than v284');
  // Compare the actual profile script references with the SW shell instead of
  // pinning an obsolete query suffix: every UI revision must update both.
  const rolePage = read('worldbook/characters/characters.html');
  const signerVersion = rolePage.match(/character-card-client\.js\?v=([^"]+)/)?.[1];
  const managerVersion = rolePage.match(/characters-manager\.js\?v=([^"]+)/)?.[1];
  assert.ok(signerVersion && managerVersion, 'role editor must declare both versioned modules');
  assert.ok(workerCache.includes("'./shared/js/phone/character-card-client.js?v=" + signerVersion + "'"));
  assert.ok(workerCache.includes("'./worldbook/characters/js/characters-manager.js?v=" + managerVersion + "'"));
  assert.doesNotMatch(read('theme-studio/studio.js'),/localStorage\.setItem\([^)]*data:image/);
});
