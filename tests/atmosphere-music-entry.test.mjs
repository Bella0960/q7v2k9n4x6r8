import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const controller=read('shared/js/atmosphere-pages.js');
const styles=read('shared/css/atmosphere-pages.css');
const home=read('chat/chat/chat.html');
const music=read('music/music.html');
const begin=controller.indexOf(' function attachRealMusicEntry(){');
const end=controller.indexOf(' function mount(){',begin);
assert.ok(begin>0&&end>begin,'source exposes real music adapter');
const adapter=controller.slice(begin,end);

function setup(){
 let atmosphere=true, visualTitle='', oldVisual='', playbackToggle=0, routed='';
 const attributes={};
 const listeners={};
 const musicSvg={outerHTML:'<svg id="playIcon"><path d="old"/></svg>',name:'old'};
 const control={
   getAttribute:key=>attributes[key]??null,
   hasAttribute:key=>Object.hasOwn(attributes,key),
   setAttribute:(key,val)=>{attributes[key]=String(val)},
   removeAttribute:key=>{delete attributes[key]},
   querySelector:q=>q==='svg'?musicSvg:null,
   addEventListener:(event,handler,capture)=>{
     (listeners[event]??=[]).push({handler,capture:!!capture});
   },
   click(){
     let stopped=false;
     const event={preventDefault(){},stopImmediatePropagation(){stopped=true;}};
     const handlers=(listeners.click||[]).slice().sort((a,b)=>Number(b.capture)-Number(a.capture));
     for(const item of handlers){
       if(stopped)break;
       item.handler(event);
     }
   }
 };
 control.addEventListener('click',()=>{playbackToggle++;});
 const context={
   document:{getElementById:id=>id==='playToggleBtn'?control:null},
   window:{location:{href:''}},
   isActive:()=>atmosphere,
   setLabel:(_query,text,enabled)=>{if(enabled){visualTitle=text;}else{visualTitle=oldVisual;}},
   iconKit:{apply:(svg,name)=>{svg.name=name;svg.outerHTML='<svg id="playIcon" data-icon="'+name+'"></svg>';return true;}}
 };
 const api=runInNewContext('(function(){ var originalMusicIcon=null;\n'+adapter+'\nreturn {attachRealMusicEntry,syncRealMusicEntry}; })()',context);
 return {api,control,attributes,listeners,musicSvg,context,
   toggle:()=>{atmosphere=!atmosphere},
   playback:()=>playbackToggle,
   visual:()=>visualTitle,
   route:()=>context.window.location.href};
}

test('thin-shadow music card routes to real audio app instead of toggling pretend playback',()=>{
 const h=setup();
 h.api.attachRealMusicEntry();
 h.api.syncRealMusicEntry(true);
 assert.equal(h.attributes.role,'link');
 assert.equal(h.attributes['aria-label'],'打开音乐播放器');
 assert.equal(h.visual(),'MUSIC / OPEN PLAYER');
 assert.equal(h.musicSvg.name,'music');
 h.control.click();
 assert.equal(h.route(),'../../music/music.html');
 assert.equal(h.playback(),0,'legacy fake playing state must not change');
 assert.match(music,/function showFav\(\)/);
});

test('keyboard activates real route without duplicate listeners',()=>{
 const h=setup();
 h.api.attachRealMusicEntry();
 h.api.attachRealMusicEntry();
 assert.equal(h.listeners.click.length,2,'one original toggle and one opt-in intercept');
 let prevented=0;
 h.listeners.keydown[0].handler({key:'Enter',preventDefault(){prevented++}});
 assert.equal(prevented,1);
 assert.equal(h.route(),'../../music/music.html');
 assert.equal(h.playback(),0);
});

test('old themes retain original music control behavior and SVG',()=>{
 const h=setup();
 h.api.attachRealMusicEntry();
 h.api.syncRealMusicEntry(true);
 h.toggle();
 h.api.syncRealMusicEntry(false);
 assert.equal(h.attributes.role,undefined);
 assert.equal(h.attributes['aria-label'],undefined);
 assert.equal(h.musicSvg.outerHTML,'<svg id="playIcon"><path d="old"/></svg>');
 h.control.click();
 assert.equal(h.route(),'');
 assert.equal(h.playback(),1);
});

test('only opted-in theme suppresses counterfeit spin animation and exposes accessible tap target',()=>{
 assert.match(styles,/AT REAL MUSIC ENTRY/);
 assert.match(styles,/\[data-at-surface="chats"\] \.vinyl-disc\.playing/);
 assert.match(styles,/animation:none!important/);
 assert.match(styles,/#playToggleBtn\s*\{[\s\S]*?min-height:42px!important/);
 assert.match(home,/id="playToggleBtn"/);
 assert.doesNotMatch(adapter,/localStorage\.(?:setItem|removeItem)|fetch\(/);
});
