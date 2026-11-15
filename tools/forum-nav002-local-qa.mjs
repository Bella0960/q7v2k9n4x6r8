/**
 * NAV-002 original PR #245: local-only quality gate.
 * Run on a clean, complete MAOMAO checkout without GitHub Actions,
 * Workers Builds, staging deployments, or production access.
 * Usage: node tools/forum-nav002-local-qa.mjs [--root PATH] [--expect-head SHA] [--install] [--install-browser]
 * Exit 0=PASS, 1=actual test failure, 2=environment BLOCKED.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const known = new Set(['--root','--expect-head','--install','--install-browser','--help']);
if(args.includes('--help')){
  console.log('Usage: node tools/forum-nav002-local-qa.mjs [--root PATH] [--expect-head SHA] [--install] [--install-browser]');
  console.log('Runs native Node regressions, forum Chromium/browser regressions and Vite build. Does not deploy.');
  process.exit(0);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'maomao-nav002-qa-'));
const report = { task:'NAV-002', pr:245, startedAt:new Date().toISOString(), head:null,
  root:null, sourcePages:null, clean:null, stages:[], result:'BLOCKED',
  caveat:'Local evidence only; not a QA deployment, full device acceptance or production release.' };
function finish(result,exitCode){
  report.result=result; report.finishedAt=new Date().toISOString();
  const filename=path.join(dir,'summary.json');
  fs.writeFileSync(filename,JSON.stringify(report,null,2)+'\n');
  console.log('RESULT '+result+' | report '+filename);
  process.exit(exitCode);
}
function block(reason){
  console.error('BLOCKED: '+reason);
  report.stages.push({name:'preflight',result:'BLOCKED',reason});
  finish('BLOCKED',2);
}
for(let i=0;i<args.length;i++){
  if(!known.has(args[i]))block('unknown argument: '+args[i]);
  if(args[i]==='--root'||args[i]==='--expect-head'){
    if(!args[i+1]||args[i+1].startsWith('--'))block(args[i]+' requires a value');
    i++;
  }
}
function value(flag){
  const i=args.indexOf(flag);
  return i<0?null:args[i+1];
}
const root=path.resolve(value('--root')||path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));
report.root=root;
const required=['package.json','package-lock.json','forum/forum-detail.html',
  'shared/js/home-indicator.js','shared/css/mobile-fit.css',
  'tests/forum-reply-upload-race.test.mjs','tests/home-indicator-hit-area.test.mjs',
  'tests/forum-media.test.mjs','tests/forum-seed-comments.test.mjs',
  'tests/forum-chat-blockers.test.mjs','tests/forum-media-mobile.mjs'];
const missing=required.filter(f=>!fs.existsSync(path.join(root,f)));
if(missing.length)block('incomplete MAOMAO checkout: '+missing.join(', '));
let pkg;
try{pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));}
catch(error){block('cannot read package.json: '+error.message);}
if(pkg.name!=='phone-simulator'||pkg.scripts?.build!=='vite build')block('wrong project or build script');
const excluded=new Set(['.git','node_modules','dist','.wrangler','tests','test-results','coverage']);
function pageCount(folder){
  return fs.readdirSync(folder,{withFileTypes:true}).reduce((n,x)=>{
    if(x.name.startsWith('.')||excluded.has(x.name))return n;
    const file=path.join(folder,x.name);
    return n+(x.isDirectory()?pageCount(file):x.isFile()&&x.name.endsWith('.html')?1:0);
  },0);
}
report.sourcePages=pageCount(root);
if(report.sourcePages<80)block('only '+report.sourcePages+' HTML pages; incomplete app snapshot');
const git=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',timeout:15000});
if(git.status!==0||!/^[a-f0-9]{40}\s*$/i.test(git.stdout))block('cannot verify Git commit');
report.head=git.stdout.trim();
const status=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',timeout:15000});
if(status.status!==0)block('cannot inspect Git worktree');
report.clean=!status.stdout.trim();
if(!report.clean)block('dirty worktree; evidence cannot be attributed to a commit');
if(value('--expect-head')&&!report.head.startsWith(value('--expect-head')))
  block('expected commit '+value('--expect-head')+', found '+report.head);
const npm=process.platform==='win32'?'npm.cmd':'npm';
const npx=process.platform==='win32'?'npx.cmd':'npx';
function run(name,bin,argv,timeout=480000){
  const processResult=spawnSync(bin,argv,{cwd:root,encoding:'utf8',timeout,maxBuffer:12*1024*1024,
    env:{...process.env,CI:'1',NO_COLOR:'1'},shell:process.platform==='win32'});
  const logfile=path.join(dir,String(report.stages.length+1).padStart(2,'0')+'-'+name+'.log');
  fs.writeFileSync(logfile,(processResult.stdout||'')+'\n'+(processResult.stderr||'')+'\n');
  const result=processResult.error?'BLOCKED':processResult.status===0?'PASS':'FAIL';
  report.stages.push({name,command:[bin,...argv],exitCode:processResult.status,
    signal:processResult.signal||null,error:processResult.error?.message||null,result,logfile});
  console.log(result+' '+name+' | '+logfile);
  return result;
}
if(args.includes('--install')){
  const r=run('npm-ci',npm,['ci'],600000);
  if(r!=='PASS')finish(r,r==='BLOCKED'?2:1);
}
const vite=path.join(root,'node_modules','.bin',process.platform==='win32'?'vite.cmd':'vite');
if(!fs.existsSync(vite))block('missing dependencies; run --install where npm registry is available');
if(args.includes('--install-browser')){
  const r=run('playwright-chromium',npx,['--no-install','playwright','install','chromium'],600000);
  if(r!=='PASS')finish(r,r==='BLOCKED'?2:1);
}
const steps=[
  ['forum-upload-ai-node',process.execPath,['--test','tests/forum-reply-upload-race.test.mjs']],
  ['forum-core-node',process.execPath,['--test','tests/forum-media.test.mjs',
    'tests/forum-seed-comments.test.mjs','tests/forum-chat-blockers.test.mjs']],
  ['forum-home-browser',process.execPath,['tests/home-indicator-hit-area.test.mjs']],
  ['forum-media-mobile-browser',process.execPath,['tests/forum-media-mobile.mjs']],
  ['vite-build',npm,['run','build']]
];
for(const [name,bin,cmd] of steps)run(name,bin,cmd);
const failures=report.stages.filter(x=>x.result!=='PASS');
const finalResult=!failures.length?'PASS':failures.some(x=>x.result==='FAIL')?'FAIL':'BLOCKED';
finish(finalResult,finalResult==='PASS'?0:finalResult==='FAIL'?1:2);
