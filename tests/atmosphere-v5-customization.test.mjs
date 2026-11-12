import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const js=readFileSync(new URL('../theme-store/atmosphere-v5-custom.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../theme-store/atmosphere-v5-custom.css',import.meta.url),'utf8');
const assembler=readFileSync(new URL('../scripts/build-atmosphere-v5-custom.mjs',import.meta.url),'utf8');

test('V5 remains the sole visual baseline: the add-on cannot replace or rebuild a page',()=>{
 assert.match(assembler,/original\.byteLength!==108145/);
 assert.match(assembler,/v5-horizontal-album/);
 assert.match(assembler,/sha\(stripped\),sha\(raw\)/);
 assert.match(assembler,/onlyAdditiveTags:true/);
 assert.doesNotMatch(js,/document\.body\.innerHTML\s*=|\.pages\.innerHTML\s*=|\.page\.replaceChildren\(/);
 assert.doesNotMatch(css,/\.page\s*\{|\.hero\s*\{\s*display|\.phone\s*\{\s*background/);
});

test('all imports are local and namespaced; no live account storage/API access',()=>{
 assert.match(js,/thin-shadow-v5-custom-media/);
 assert.match(js,/indexedDB\.open\(ns,1\)/);
 assert.match(js,/const imageLimit=8\*1024\*1024, audioLimit=25\*1024\*1024/);
 assert.match(js,/state\.db\.transaction\(storeName,'readwrite'\)/);
 assert.doesNotMatch(js,/localStorage\.setItem|fetch\(|XMLHttpRequest|chat_history_|myProfile/);
 assert.doesNotMatch(js,/navigator\.sendBeacon|window\.location\.href/);
});

test('image uploads are separate for self, current contact, home card, profile, music and drawer',()=>{
 const keys=['image:me','image:contact:','image:home','image:profile-cover',
  'image:drawer','image:music-cover','sticker:'];
 for(const k of keys)assert.ok(js.includes(k),k+' must have its own media key');
 assert.match(js,/const name=\$\('#chat-name'\)/);
 assert.match(js,/decorate\(row\.querySelector\('\.avatar'\),'image:contact:'\+row\.dataset\.contact\)/);
 assert.match(js,/window\.__atV5DemoAddImage\('表情包/);
});

test('custom imported audio actually plays rather than simulating waveform only',()=>{
 assert.match(js,/state\.audio\.play\(\)/);
 assert.match(js,/state\.audio\.pause\(\)/);
 assert.match(js,/music:track:/);
 assert.match(js,/state\.audio\.addEventListener\('ended'/);
 assert.match(js,/event\.stopImmediatePropagation\(\)/);
 assert.match(js,/if\(!selected\(\)\)return; \/\/ preserve the V5 original ambient option/);
});

test('file guards enforce image/audio MIME and local size limits',()=>{
 const start=js.indexOf(' function validate(file,kind){');
 const end=js.indexOf(' function decorate(',start);
 assert.ok(start>0&&end>start);
 const snippet=js.slice(start,end);
 const messages=[];
 const validate=runInNewContext('(function(){'+snippet+'return validate;})()',{
  imageLimit:8*1024*1024,audioLimit:25*1024*1024,
  toast:msg=>messages.push(msg)
 });
 assert.equal(validate({type:'image/png',name:'avatar.png',size:12},'self-avatar'),true);
 assert.equal(validate({type:'audio/mpeg',name:'song.mp3',size:32000},'music'),true);
 assert.equal(validate({type:'image/png',name:'song.png',size:12},'music'),false);
 assert.equal(validate({type:'text/html',name:'a.html',size:12},'self-avatar'),false);
 assert.equal(validate({type:'image/jpeg',name:'huge.jpg',size:9*1024*1024},'home-cover'),false);
 assert.equal(validate({type:'audio/mp4',name:'huge.m4a',size:26*1024*1024},'music'),false);
 assert.ok(messages.length>=4);
});

test('addon registers without interfering with the preexisting V5 event lifecycle',()=>{
 const events={};
 class AudioStub{
  constructor(){this.paused=true;this.src='';}
  addEventListener(){}
  pause(){this.paused=true}
 }
 const doc={readyState:'loading',addEventListener:(name,fn)=>{events[name]=fn}};
 assert.doesNotThrow(()=>runInNewContext(js,{
  document:doc,window:{},Audio:AudioStub
 }));
 assert.equal(typeof events.DOMContentLoaded,'function');
 assert.doesNotMatch(js,/\.hero\.replaceChildren\(|\.dock\.replaceChildren\(|\.messages\.replaceChildren\(/);
});

test('home card and personal-home copy are editable without rewriting V5 structure',()=>{
 const entries=['home-title','home-meta','home-note','profile-title','profile-id'];
 for(const id of entries)assert.ok(js.includes("'"+id+"'"),id+' editor is present');
 assert.match(js,/function addTextEditors\(container\)/);
 assert.match(js,/input\.maxLength=max/);
 assert.match(js,/state\.records\.get\('text:'\+id\)/);
 assert.match(js,/await save\(\{key:'text:'\+id,value,createdAt:Date\.now\(\)\}\)/);
 assert.match(js,/applyTexts\(\);renderTracks\(\)/);
 assert.doesNotMatch(js,/\.hero\.innerHTML\s*=|\.profile-center\.innerHTML\s*=/);
 assert.match(css,/\.v5-custom-text-editor input/);
});

test('approved V5 source is byte-for-byte identical after removing only the two additive resource tags',()=>{
 const base=readFileSync(new URL('../theme-store/atmosphere-v5-original.html',import.meta.url),'utf8');
 const upgraded=readFileSync(new URL('../theme-store/atmosphere-v5-preserved-custom-preview.html',import.meta.url),'utf8');
 const cssRef='<link rel="stylesheet" href="./atmosphere-v5-custom.css?v=20261113v1">';
 const jsRef='<script defer src="./atmosphere-v5-custom.js?v=20261113v1"></script>';
 assert.equal(Buffer.byteLength(base,'utf8'),108145);
 assert.equal(base.split('v5-horizontal-album').length,2);
 assert.equal(upgraded.split(cssRef).length,2);
 assert.equal(upgraded.split(jsRef).length,2);
 assert.equal(upgraded.replace(cssRef,'').replace(jsRef,''),base,
  'V5 must never be redesigned as a side effect of new features');
});

test('theme-store links to approved V5 instead of the rejected V4 preview',()=>{
 const store=readFileSync(new URL('../theme-store/theme-store.html',import.meta.url),'utf8');
 const vite=readFileSync(new URL('../vite.config.js',import.meta.url),'utf8');
 const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 assert.match(store,/href="\.\/atmosphere-v5-preserved-custom-preview\.html"/);
 assert.doesNotMatch(store,/href="\.\/atmosphere-live-preview\.html"/);
 assert.match(vite,/const htmlFiles = \{\}/);
 for(const name of ['atmosphere-v5-original.html','atmosphere-v5-preserved-custom-preview.html',
 'atmosphere-v5-custom.js','atmosphere-v5-custom.css'])
  assert.ok(sw.includes('./theme-store/'+name),name+' missing from offline shell');
});
