import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
// Test-only offline exporter. No production route or account access.
// Run from the repository: node tests/tabletop-preview/export-ludo-preview.mjs
export const MODULES = [
  'games/tabletop/ludo-rules.js','games/tabletop/ludo-board.js',
  'games/tabletop/room-engine.js','games/tabletop/room-dispatcher.js',
  'games/tabletop/room-lifetime.js','games/tabletop/room-chat-log.js',
  'games/tabletop/ludo-turn-driver.js','games/tabletop/room-speech-queue.js',
  'games/tabletop/room-speech-context.js','games/tabletop/room-speech-runner.js',
  'games/tabletop/ludo-board-view.js','tests/tabletop-preview/ludo-preview-round.js',
  'tests/tabletop-preview/ludo-preview-page.js'
];
export const CSS='games/tabletop/ludo-board.css';
export const HTML='tests/tabletop-preview/ludo.html';
export function buildOfflinePreview(read){
  const seen=new Set(),blocks=[];
  for(const path of MODULES){
    const name=path.split('/').at(-1);
    let body=read(path);
    if(typeof body!=='string'||seen.has(name))throw Error('INVALID_PREVIEW_MODULE');
    const exports=[...body.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)].map(m=>m[1]);
    body=body.replace(/^import \{([^}]+)\} from '([^']+)';$/gm,(_,imports,file)=>{
      const dep=file.split('/').at(-1);
      if(!seen.has(dep))throw Error('PREVIEW_DEPENDENCY_ORDER: '+dep);
      return 'const {'+imports.replace(/(\w+)\s+as\s+(\w+)/g,'$1:$2')+'}=modules['+JSON.stringify(dep)+'];';
    }).replace(/^export /gm,'');
    if(/^\s*(?:import|export)\s/m.test(body)||/<\/script/i.test(body))throw Error('UNSUPPORTED_PREVIEW_MODULE');
    blocks.push('modules['+JSON.stringify(name)+']=(()=>{\n'+body+'\nreturn {'+exports.join(',')+'};\n})();');
    seen.add(name);
  }
  const script="'use strict';\nconst modules=Object.create(null);\n"+blocks.join('\n');
  const css=read(CSS),html=read(HTML);
  if(typeof css!=='string'||/<\/style/i.test(css)||typeof html!=='string')throw Error('INVALID_PREVIEW_TEMPLATE');
  const link='<link rel="stylesheet" href="../../games/tabletop/ludo-board.css">';
  const entry='<script type="module" src="./ludo-preview-page.js"></script>';
  if(!html.includes(link)||!html.includes(entry))throw Error('PREVIEW_TEMPLATE_CHANGED');
  const policy='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">';
  return html.replace('<meta charset="utf-8">','<meta charset="utf-8">\n'+policy)
    .replace(link,()=>'<style>\n'+css+'\n</style>')
    .replace(entry,()=>'<script>\n'+script+'\n</script>')
    .replace('独立开发预览 · 本地测试棋手，不联网、不保存','离线试玩 · 本地测试棋手，不联网、不保存');
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const root=new URL('../../',import.meta.url);
  const out=new URL('./ludo-offline.html',import.meta.url);
  const html=buildOfflinePreview(path=>readFileSync(new URL(path,root),'utf8'));
  if(process.argv.includes('--check')){
    if(readFileSync(out,'utf8')!==html)throw Error('OFFLINE_PREVIEW_OUTDATED');
  }else writeFileSync(out,html,'utf8');
  console.log('Offline preview '+(process.argv.includes('--check')?'verified':'generated'));
}
