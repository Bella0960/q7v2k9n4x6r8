import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {buildConflictReport,hotspotKey,moduleScope,normalizeRepoPath,runConflictAudit} from '../scripts/engineering-pr-conflicts.mjs';
const pull=(number,branch,files,extra={})=>({number,title:'Task '+number,state:'open',branch,files,...extra});

test('normalizes repository paths and rejects traversal or absolute paths',()=>{
 assert.equal(normalizeRepoPath('chat/chat/detail.html'),'chat/chat/detail.html');
 assert.equal(normalizeRepoPath(' chat/中文.html '),' chat/中文.html ');
 assert.equal(normalizeRepoPath('chat/line\nnext'),'chat/line\nnext');
 for(const x of ['/tmp/x','../x','chat/../../x','chat//x','./chat/x','chat/\0x'])assert.equal(normalizeRepoPath(x),null);
});
test('classifies shared runtime, worker, workflow, build and release hotspots',()=>{
 assert.equal(hotspotKey('shared/js/phone/context.js'),'shared');assert.equal(hotspotKey('worker/index.js'),'worker');
 assert.equal(hotspotKey('.github/workflows/qa.yml'),'github-workflows');assert.equal(hotspotKey('package.json'),'build-config');
 assert.equal(hotspotKey('scripts/qa-direct-release.mjs'),'qa-release-core');assert.equal(hotspotKey('chat/chat/detail.html'),null);
});
test('exact path overlap is reported as a blocking conflict',()=>{
 const r=buildConflictReport({currentPaths:['chat/chat/detail.html'],pullRequests:[pull(1,'CHAT/fix',['chat/chat/detail.html'])]});
 assert.equal(r.exactOverlapCount,1);assert.equal(r.findings[0].severity,'file-overlap');
});
test('different files in the same cross-cutting hotspot are warnings, not exact conflicts',()=>{
 const r=buildConflictReport({currentPaths:['shared/js/phone/context.js','worker/routes/a.js'],pullRequests:[pull(2,'CORE/a',['shared/js/phone/storage.js']),pull(3,'WORKER/a',['worker/routes/b.js'])]});
 assert.equal(r.exactOverlapCount,0);assert.equal(r.sharedHotspotCount,2);
});
test('same feature submodule is a review warning while separate submodules stay independent',()=>{
 assert.equal(moduleScope('chat/chat/detail.html'),'chat/chat');assert.equal(moduleScope('chat/moments/feed.html'),'chat/moments');
 const r=buildConflictReport({currentPaths:['chat/chat/detail.html'],pullRequests:[pull(4,'CHAT/search',['chat/chat/search.html']),pull(5,'MOMENTS/feed',['chat/moments/feed.html'])]});
 assert.equal(r.moduleOverlapCount,1);assert.equal(r.findings.length,1);
});
test('disjoint modules and distinct hotspot domains do not overlap',()=>{
 const r=buildConflictReport({currentPaths:['shared/js/phone/context.js','chat/chat/detail.html'],pullRequests:[pull(6,'WORKER/a',['worker/routes/a.js']),pull(7,'MUSIC/a',['music/music.html'])]});
 assert.equal(r.findings.length,0);
});
test('ignores current branch and closed PRs',()=>{
 const r=buildConflictReport({currentBranch:'GOV/current',currentPaths:['docs/engineering/EXECUTION_LOG.md'],pullRequests:[pull(8,'GOV/current',['docs/engineering/EXECUTION_LOG.md'],{headRepository:'Bella0960/q7v2k9n4x6r8'}),pull(9,'OLD/closed',['docs/engineering/EXECUTION_LOG.md'],{state:'closed'})]});
 assert.equal(r.findings.length,0);
});
test('renamed PR files include old and new paths; empty scans are not called clean',()=>{
 const r=buildConflictReport({currentPaths:['chat/chat/old.html','chat/chat/new.html'],pullRequests:[pull(10,'CHAT/rename',[{filename:'chat/chat/new.html',previous_filename:'chat/chat/old.html'}])]});
 assert.equal(r.exactOverlapCount,2);
 const empty=buildConflictReport({currentPaths:[],pullRequests:[pull(11,'X',['chat/chat/a.html'])]});
 assert.equal(empty.scanPerformed,false);assert.equal(empty.openPullRequestCount,null);
});

test('keeps PRs on a fork even when they have the current branch name',()=>{
 const result=buildConflictReport({
  currentBranch:'GOV/current',
  currentPaths:['package.json'],
  pullRequests:[pull(12,'GOV/current',['package.json'],{headRepository:'contributor/q7v2k9n4x6r8'})]
 });
 assert.equal(result.exactOverlapCount,1);
});

test('command line scans exact Git paths across committed and working-tree changes',t=>{
 const directory=mkdtempSync(join(tmpdir(),'maomao-conflicts-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:directory,stdio:'pipe'});
 const write=(path,content='change')=>writeFileSync(join(directory,path),content);
 git('init','-q','-b','main');
 git('config','user.email','test@example.invalid');
 git('config','user.name','Test');
 write('原名称.txt');
 write('unstaged.txt');
 git('add','.');
 git('commit','-qm','Base');
 git('update-ref','refs/remotes/origin/main','HEAD');
 const base=git('rev-parse','HEAD').toString().trim();
 const expected=['原名称.txt','新名称.txt',' staged.txt ','unstaged.txt','untracked\nfile.txt'];
 git('switch','-qc','other');
 rmSync(join(directory,'原名称.txt'));
 for(const path of expected.slice(1))write(path,'other branch');
 git('add','-A');
 git('commit','-qm','Other PR');
 const head=git('rev-parse','HEAD').toString().trim();
 git('switch','-qc','task','main');
 renameSync(join(directory,'原名称.txt'),join(directory,'新名称.txt'));
 git('add','-A');
 git('commit','-qm','Rename');
 write(' staged.txt ');
 git('add','--',' staged.txt ');
 write('unstaged.txt','new content');
 write('untracked\nfile.txt');
 const script=resolve('scripts/engineering-pr-conflicts.mjs');
 // The Git commands and CLI run normally. Only the external GitHub response is supplied by the test.
 const fetchStub=`globalThis.fetch=async url=>{
  const page=new URL(url).searchParams.get('page');
  const response=(data,next)=>new Response(JSON.stringify(data),{
   headers:next?{link:'<'+next+'>; rel="next"'}:{}
  });
  if(!url.includes('/pulls?'))throw new Error('Unexpected per-PR API request');
  const pr={number:12,state:'open',head:{ref:'other',sha:'${head}'},base:{sha:'${base}'}};
  return response(page?[pr]:[],page?null:url+'&page=2');
 };`;
 const args=['--import','data:text/javascript,'+encodeURIComponent(fetchStub),script,'--json'];
 assert.throws(
  ()=>execFileSync(process.execPath,args,{cwd:directory,encoding:'utf8',stdio:'pipe'}),
  error=>{
   assert.equal(error.status,2);
   const report=JSON.parse(error.stdout);
   assert.deepEqual(report.findings[0].exactPaths,[...expected].sort());
   return true;
  }
 );
 const blocked=`globalThis.fetch=async()=>new Response(null,{
  status:403,headers:{'x-ratelimit-remaining':'0'}
 });`;
 assert.throws(
  ()=>execFileSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(blocked),script,'--json'],
   {cwd:directory,encoding:'utf8',stdio:'pipe'}),
  error=>{
   assert.equal(error.status,1);
   assert.equal(error.stdout,'');
   assert.match(error.stderr,/GitHub API rate limit reached/);
   return true;
  }
 );
});


test('batch ownership audit can exclude only the PRs already selected for the candidate',()=>{
 const r=buildConflictReport({
  currentPaths:['chat/chat/detail.html'],
  ignorePullRequestNumbers:[20],
  pullRequests:[
   pull(20,'CHAT/selected',['chat/chat/detail.html']),
   pull(21,'CHAT/unselected',['chat/chat/detail.html'])
  ]
 });
 assert.equal(r.exactOverlapCount,1);
 assert.equal(r.findings[0].number,21);
});


test('candidate audit allows a same-file PR delta when Git three-way application is clean', t => {
 const directory=mkdtempSync(join(tmpdir(),'maomao-conflict-audit-clean-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:directory,encoding:'utf8',stdio:'pipe'}).trim();
 const write=(path,content)=>writeFileSync(join(directory,path),content);
 mkdirSync(join(directory,'chat','chat'),{recursive:true});
 git('init','-q','-b','main');
 git('config','user.email','test@example.invalid');
 git('config','user.name','Test');
 const lines=Array.from({length:15},(_,index)=>'line-'+(index+1));
 write('chat/chat/detail.html',lines.join('\n')+'\n');
 git('add','.');git('commit','-qm','Base');
 const base=git('rev-parse','HEAD');

 git('switch','-qc','candidate',base);
 const candidateLines=[...lines];candidateLines[1]='candidate change';
 write('chat/chat/detail.html',candidateLines.join('\n')+'\n');
 git('commit','-qam','Candidate change');
 const candidate=git('rev-parse','HEAD');

 git('switch','-qc','other-pr',base);
 const prLines=[...lines];prLines[11]='other PR change';
 write('chat/chat/detail.html',prLines.join('\n')+'\n');
 git('commit','-qam','Other PR change');
 const prHead=git('rev-parse','HEAD');
 git('switch','-q','candidate');

 const payload=JSON.stringify([{
  number:77,state:'open',title:'Other task',html_url:'https://github.com/Bella0960/q7v2k9n4x6r8/pull/77',
  head:{ref:'other-pr',sha:prHead,repo:{full_name:'Bella0960/q7v2k9n4x6r8'}},
  base:{sha:base}
 }]);
 const fetchStub='globalThis.fetch=async()=>new Response('+JSON.stringify(payload)+',{headers:{' +
  "'content-type':'application/json'}});";
 const moduleUrl=new URL('../scripts/engineering-pr-conflicts.mjs',import.meta.url).href;
 const runner=[
  'import {runConflictAudit} from '+JSON.stringify(moduleUrl)+';',
  'const result=await runConflictAudit({repo:"Bella0960/q7v2k9n4x6r8",base:'+JSON.stringify(base)+',head:'+JSON.stringify(candidate)+',checkContentConflicts:true});',
  'process.stdout.write(JSON.stringify(result));'
 ].join('\n');
 const result=execFileSync(process.execPath,[
  '--import','data:text/javascript,'+encodeURIComponent(fetchStub),
  '--input-type=module','-e',runner
 ],{cwd:directory,encoding:'utf8'});
 const report=JSON.parse(result);
 assert.equal(report.exactOverlapCount,1);
 assert.equal(report.contentConflictChecksPerformed,true);
 assert.equal(report.contentConflictCount,0);
 assert.equal(report.findings[0].contentMergeStatus,'three-way-clean');
 assert.equal(git('rev-parse','HEAD'),candidate);
});

test('candidate audit blocks an actual same-hunk PR content conflict', t => {
 const directory=mkdtempSync(join(tmpdir(),'maomao-conflict-audit-real-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:directory,encoding:'utf8',stdio:'pipe'}).trim();
 const write=(path,content)=>writeFileSync(join(directory,path),content);
 git('init','-q','-b','main');
 git('config','user.email','test@example.invalid');
 git('config','user.name','Test');
 const lines=['header','line-2','line-3','shared-slot','line-5','footer'];
 write('chat/chat/detail.html',lines.join('\n')+'\n');
 git('add','.');git('commit','-qm','Base');
 const base=git('rev-parse','HEAD');

 git('switch','-qc','candidate',base);
 const candidateLines=[...lines];candidateLines[3]='candidate owns the slot';
 write('chat/chat/detail.html',candidateLines.join('\n')+'\n');
 git('commit','-qam','Candidate change');
 const candidate=git('rev-parse','HEAD');

 git('switch','-qc','other-pr',base);
 const prLines=[...lines];prLines[3]='other PR owns the slot';
 write('chat/chat/detail.html',prLines.join('\n')+'\n');
 git('commit','-qam','Other PR conflicting change');
 const prHead=git('rev-parse','HEAD');
 git('switch','-q','candidate');

 const payload=JSON.stringify([{
  number:78,state:'open',title:'Conflicting task',html_url:'https://github.com/Bella0960/q7v2k9n4x6r8/pull/78',
  head:{ref:'other-pr',sha:prHead,repo:{full_name:'Bella0960/q7v2k9n4x6r8'}},
  base:{sha:base}
 }]);
 const fetchStub='globalThis.fetch=async()=>new Response('+JSON.stringify(payload)+',{headers:{' +
  "'content-type':'application/json'}});";
 const moduleUrl=new URL('../scripts/engineering-pr-conflicts.mjs',import.meta.url).href;
 const runner=[
  'import {runConflictAudit} from '+JSON.stringify(moduleUrl)+';',
  'const result=await runConflictAudit({repo:"Bella0960/q7v2k9n4x6r8",base:'+JSON.stringify(base)+',head:'+JSON.stringify(candidate)+',checkContentConflicts:true});',
  'process.stdout.write(JSON.stringify(result));'
 ].join('\n');
 const result=execFileSync(process.execPath,[
  '--import','data:text/javascript,'+encodeURIComponent(fetchStub),
  '--input-type=module','-e',runner
 ],{cwd:directory,encoding:'utf8'});
 const report=JSON.parse(result);
 assert.equal(report.exactOverlapCount,1);
 assert.equal(report.contentConflictChecksPerformed,true);
 assert.equal(report.contentConflictCount,1);
 assert.deepEqual(report.contentConflicts[0].paths,['chat/chat/detail.html']);
 assert.equal(git('rev-parse','HEAD'),candidate);
});
