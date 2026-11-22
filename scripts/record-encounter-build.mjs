#!/usr/bin/env node
// Only called after Vite and the existing postbuild regression succeed.
// The receipt is generated locally, not checked into Git and not an approval to deploy.
import {readFileSync,writeFileSync,existsSync,statSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const location=name=>resolve(root,name);
const pageManifest=location('dist/pwa-pages.json');
const encounterPage=location('dist/encounter/encounter.html');
if(!existsSync(pageManifest)||!existsSync(encounterPage))
  throw new Error('Vite build 缺少邂逅 HTML 或页面清单，拒绝出具构建回执');
const manifest=JSON.parse(readFileSync(pageManifest,'utf8'));
if(!Array.isArray(manifest)||!manifest.includes('encounter/encounter.html'))
  throw new Error('邂逅未进入 PWA 产物清单，拒绝出具构建回执');
const html=readFileSync(encounterPage,'utf8');
if(!html.includes('frontCard')||!html.includes('encounter-engine'))
  throw new Error('构建后的邂逅页面缺少核心卡片或引擎');
const gitHead=execFileSync('git',['rev-parse','HEAD'],{
  cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']
}).trim();
const receipt={
  schemaVersion:1,gitHead,createdAt:Date.now(),
  files:{
    'dist/pwa-pages.json':{bytes:statSync(pageManifest).size},
    'dist/encounter/encounter.html':{bytes:statSync(encounterPage).size}
  }
};
writeFileSync(location('dist/encounter-build-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log('BUILD RECEIPT '+gitHead+' — 仅证明本地构建产物存在，仍需浏览器与真机验收');
