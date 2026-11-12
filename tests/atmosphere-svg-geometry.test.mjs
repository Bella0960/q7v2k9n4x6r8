import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const source=read('../shared/js/atmosphere-icons.js');
const composer=read('../shared/js/atmosphere-composer.js');
const controller=read('../shared/js/atmosphere-theme.js');
const styles=read('../shared/css/atmosphere-theme.css');
const detail=read('../chat/chat/chat-detail.html');
const shell={};
runInNewContext(source,{window:shell});

test('all design icons use one 24px view box and the same optical stroke',()=>{
 const lib=shell.MAOMAOAtmosphereIcons;
 assert.ok(lib);
 const icons=['back','menu','close','tone','photo','sticker','microphone','location',
 'more','plus','search','people','moments','clock','diary','person','music','video',
 'send','spark','heart','share','gift','refresh'];
 for(const name of icons){
  assert.ok(lib.paths[name],name+' is available');
  const shape=lib.markup(name);
  assert.match(shape,/viewBox="0 0 24 24"/);
  assert.match(shape,/stroke-width="1.55"/);
  assert.match(shape,/stroke-linecap="round"/);
  assert.match(shape,/stroke-linejoin="round"/);
  assert.doesNotMatch(shape,/<image|<foreignObject|<use\s/i);
 }
 assert.match(lib.paths.tone,/cx="12" cy="12"/);
 assert.match(lib.paths.tone,/M12 3\.9/);
});

test('chat detail loads icon kit before both theme and native composer adapters',()=>{
 const icon=detail.indexOf('atmosphere-icons.js?v=20261112i1');
 const theme=detail.indexOf('atmosphere-theme.js?v=20261112v1');
 const composerScript=detail.indexOf('atmosphere-composer.js?v=20261112c1');
 assert.ok(icon>=0&&icon<theme&&theme<composerScript);
 assert.match(controller,/syncHeaderIcons\(active\(\)\)/);
 assert.match(controller,/headerIconCache\.delete\(button\)/);
 assert.match(composer,/originalNativeIcons\.clear\(\)/);
});

test('header identity is center column and mobile action icons share real center alignment',()=>{
 assert.match(styles,/grid-template-columns:minmax\(0,1fr\) minmax\(85px,130px\) minmax\(0,1fr\)/);
 assert.match(styles,/\.chat-title-box\{[\s\S]*?grid-column:2;position:static!important/);
 assert.match(styles,/grid-template-columns:minmax\\(0,1fr\\) 106px minmax\\(0,1fr\\)/);
 assert.match(styles,/overflow:clip!important/);
 assert.match(styles,/\.chat-header-avatar\{[\s\S]*?place-items:center!important/);
 assert.match(styles,/\.chat-header \.at-quick-tone\{[\s\S]*?place-items:center!important/);
 assert.match(styles,/\.at-rail-action\{[\s\S]*?grid-template-rows:23px 13px!important/);
 assert.match(styles,/\.at-rail-action svg\{[\s\S]*?19px!important/);
});

test('native feature filtering is opt-in and preserves the full action list',()=>{
 assert.match(composer,/\['quick','常用'\]/);
 assert.match(composer,/\['all','全部功能'\]/);
 assert.match(composer,/filterMode=mode==='quick'\?'quick':'all'/);
 assert.match(styles,/\[data-at-filter="quick"\] \.plus-grid \.plus-item:not\(\[data-at-preferred\]\)/);
 assert.match(styles,/@media\(prefers-reduced-motion:reduce\)/);
});
