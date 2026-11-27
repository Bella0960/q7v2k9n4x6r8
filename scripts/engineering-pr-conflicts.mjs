#!/usr/bin/env node
// Read-only scan of this branch's changed paths against open MAOMAO PRs.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const API='https://api.github.com';
const SHA=/^[0-9a-f]{40}$/;
const DIFF_PATHS=['diff','--name-only','-z','--no-renames','--no-ext-diff'];
const HOTSPOTS=new Map([
 ['package.json','build-config'],['package-lock.json','build-config'],['vite.config.js','build-config'],
 ['vite.config.mjs','build-config'],['wrangler.jsonc','worker-config'],['wrangler.qa.jsonc','worker-config'],
 ['AGENTS.md','engineering-governance'],['docs/engineering/RELEASE_POLICY.md','engineering-governance'],
 ['docs/engineering/DEVELOPMENT_GOVERNANCE.md','engineering-governance'],
 ['docs/engineering/REMEDIATION_BACKLOG.md','engineering-governance'],
 ['docs/engineering/EXECUTION_LOG.md','engineering-governance'],
 ['scripts/qa-direct-release.mjs','qa-release-core'],['scripts/qa-release-plan.mjs','qa-release-core'],
 ['scripts/qa-snapshot-policy.mjs','qa-release-core'],['scripts/qa-postupload-readiness.mjs','qa-release-core']
]);
const NON_MODULE=new Set(['shared','worker','scripts','docs','tests','.github','assets','android','perf','previews','design']);
const clean=(v,n=160)=>String(v??'').replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);

export function normalizeRepoPath(value){
 if(typeof value!=='string')return null;
 if(!value||value.startsWith('/')||value.includes('\0'))return null;
 const parts=value.split('/');
 return parts.some(part=>!part||part==='.'||part==='..')?null:value;
}
export function hotspotKey(p){
 if(p.startsWith('shared/'))return 'shared';
 if(p.startsWith('worker/'))return 'worker';
 if(p.startsWith('.github/workflows/'))return 'github-workflows';
 if(p.startsWith('docs/engineering/'))return 'engineering-governance';
 return HOTSPOTS.get(p)||null;
}
export function moduleScope(p){
 const a=p.split('/');
 if(a.length<2||NON_MODULE.has(a[0]))return null;
 return ['chat','worldbook','settings','novel'].includes(a[0])?a.slice(0,2).join('/'):a[0];
}
function pathSet(files=[]){
 const out=new Set();
 for(const f of files)for(const raw of(typeof f==='string'?[f]:[f?.filename,f?.previous_filename])){
  const p=normalizeRepoPath(raw);if(p)out.add(p);
 }
 return out;
}
function uniquePairs(items){
 const m=new Map();
 for(const x of items)m.set([x.scope,x.currentPath,x.otherPath].join('\u0000'),x);
 return [...m.values()].sort((a,b)=>[a.scope,a.currentPath,a.otherPath].join('|').localeCompare([b.scope,b.currentPath,b.otherPath].join('|'))).slice(0,40);
}
export function buildConflictReport({repository='Bella0960/q7v2k9n4x6r8',currentBranch='',currentSha='',currentPaths=[],pullRequests=[],ignorePullRequestNumbers=[]}={}){
 const ignored=new Set(ignorePullRequestNumbers.filter(Number.isSafeInteger));
 const own=pathSet(currentPaths),findings=[];
 for(const pr of pullRequests){
  if(ignored.has(pr?.number))continue;
  if(pr?.state&&pr.state!=='open')continue;
  const branch=pr?.head?.ref??pr?.branch;
  const headRepository=pr?.head?.repo?.full_name??pr?.headRepository;
  const sha=pr?.head?.sha??pr?.headSha;
  const sameRepository=headRepository?.toLowerCase()===repository.toLowerCase();
  if(sameRepository&&((currentBranch&&branch===currentBranch)||(currentSha&&sha===currentSha)))continue;
  const other=pathSet(pr?.files||pr?.changedFiles||[]),exact=[...own].filter(p=>other.has(p)).sort(),shared=[],modules=[];
  for(const a of own)for(const b of other){
   if(a===b)continue;
   const ha=hotspotKey(a),hb=hotspotKey(b);
   if(ha&&ha===hb)shared.push({scope:ha,currentPath:a,otherPath:b});
   else{const ma=moduleScope(a),mb=moduleScope(b);if(ma&&ma===mb)modules.push({scope:ma,currentPath:a,otherPath:b});}
  }
  const sh=uniquePairs(shared),mo=uniquePairs(modules);
  if(!exact.length&&!sh.length&&!mo.length)continue;
  findings.push({number:Number.isSafeInteger(pr?.number)?pr.number:null,title:clean(pr?.title),branch:clean(branch,120),
   url:typeof pr?.html_url==='string'&&pr.html_url.startsWith('https://github.com/')?pr.html_url:null,
   severity:exact.length?'file-overlap':sh.length?'shared-hotspot':'module-overlap',
   exactPaths:exact,sharedHotspots:sh,moduleOverlaps:mo});
 }
 const rank={'file-overlap':0,'shared-hotspot':1,'module-overlap':2};
 findings.sort((a,b)=>rank[a.severity]-rank[b.severity]||(a.number??999999)-(b.number??999999));
 return {repository,currentBranch:clean(currentBranch,120),currentSha:/^[0-9a-f]{40}$/.test(currentSha)?currentSha:null,
  changedPathCount:own.size,scanPerformed:own.size>0,
  openPullRequestCount:own.size?pullRequests.filter(p=>!p?.state||p.state==='open').length:null,
  exactOverlapCount:findings.reduce((n,x)=>n+x.exactPaths.length,0),
  sharedHotspotCount:findings.reduce((n,x)=>n+x.sharedHotspots.length,0),
  moduleOverlapCount:findings.reduce((n,x)=>n+x.moduleOverlaps.length,0),findings};
}
function runGit(args,{input,timeout=60000,env=process.env}={}){
 return execFileSync('git',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],
  env,timeout,maxBuffer:16*1024*1024});
}
function git(...args){return runGit(args);}
function splitPaths(output){return output.split('\0').filter(Boolean);}
function nextLink(header){return String(header||'').match(/<([^>]+)>;\s*rel="next"/)?.[1]||null;}
async function getJson(url){
 const headers={accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','user-agent':'maomao-engineering-conflict-audit'};
 const token=process.env.GITHUB_TOKEN||process.env.GH_TOKEN;if(token)headers.authorization='Bearer '+token;
 const r=await fetch(url,{headers,signal:AbortSignal.timeout(20000)});
 if((r.status===403||r.status===429)&&r.headers.get('x-ratelimit-remaining')==='0'){
  const advice=token?'Wait for the GitHub rate limit to reset.':'Set GH_TOKEN or GITHUB_TOKEN for a full scan.';
  throw new Error('GitHub API rate limit reached. '+advice);
 }
 if(!r.ok)throw new Error('GitHub API request failed ('+r.status+')');
 return {data:await r.json(),next:nextLink(r.headers.get('link'))};
}
async function openPrs(repo){
 const endpoint=API+'/repos/'+repo+'/pulls?state=open&per_page=100';
 const pullRequests=[];
 const seen=new Set();
 let url=endpoint;
 let page=1;
 while(url){
  const response=await getJson(url);
  if(!Array.isArray(response.data))throw new Error('GitHub API returned an invalid PR list');
  for(const pr of response.data){
   if(!Number.isSafeInteger(pr?.number)||seen.has(pr.number)||pr.state!=='open'||
     typeof pr.base?.ref!=='string'||!pr.base.ref||!SHA.test(pr.head?.sha??'')){
    throw new Error('GitHub returned inconsistent open PR metadata');
   }
   seen.add(pr.number);
   pullRequests.push(pr);
  }
  if(!response.next)break;
  const next=new URL(response.next);
  if(next.origin!==API||next.searchParams.get('page')!==String(++page)){
   throw new Error('GitHub returned an unexpected PR pagination link');
  }
  url=endpoint+'&page='+page;
 }
 return pullRequests;
}

function encodeRefPath(ref){
 const value=String(ref??'');
 if(!value||value.startsWith('/')||value.split('/').some(part=>!part||part==='.'||part==='..')){
  throw new Error('GitHub PR base branch ref is invalid');
 }
 return value.split('/').map(encodeURIComponent).join('/');
}
async function currentBranchSha(repo,branch){
 const path=encodeRefPath(branch);
 const response=await getJson(API+'/repos/'+repo+'/git/ref/heads/'+path);
 const sha=response.data?.object?.sha;
 if(!SHA.test(sha??''))throw new Error('Cannot resolve the current tip of PR base branch '+branch);
 return sha;
}
async function withGitPaths(repo,pullRequests){
 const refs=[...new Set(pullRequests.map(pr=>pr.base.ref))];
 const tips=await Promise.all(refs.map(async ref=>[ref,await currentBranchSha(repo,ref)]));
 const baseTips=new Map(tips);
 const current=pullRequests.map(pr=>({...pr,baseTipSha:baseTips.get(pr.base.ref)}));
 const shas=[...new Set(current.flatMap(pr=>[pr.baseTipSha,pr.head.sha]))];
 if(!shas.length)return current;
 // Keep the checkout and its refs intact. Fetch only when the live base/head commits are absent.
 const objects=runGit(['cat-file','--batch-check=%(objecttype)'],
  {input:shas.join('\n')+'\n',env:{...process.env,GIT_NO_LAZY_FETCH:'1'}});
 if(objects.trimEnd().split('\n').some(type=>type!=='commit')){
  try{
   runGit(['fetch','--quiet','--no-tags','--no-write-fetch-head','--filter=blob:none',
    '--stdin','https://github.com/'+repo+'.git'],{input:shas.join('\\n')+'\\n',timeout:120000});
  }catch{
   throw new Error('Cannot fetch the exact current GitHub PR base/head commits');
  }
 }
 return current.map(pr=>{
  try{
   const mergeBase=git('merge-base',pr.baseTipSha,pr.head.sha).trim();
   if(!SHA.test(mergeBase))throw new Error('invalid merge base');
   const files=splitPaths(git(...DIFF_PATHS,mergeBase+'...'+pr.head.sha,'--'));
   return {...pr,mergeBaseSha:mergeBase,files};
  }catch{
   throw new Error('Cannot compare the current base branch tip to PR #'+pr.number);
  }
 });
}

function changedPaths(base,head){
 let committed;
 try{committed=git(...DIFF_PATHS,base+'...'+head);}
 catch{
  if(base!=='origin/main')throw new Error('Base reference unavailable');
  try{
   git('fetch','--quiet','--no-tags','origin','main');
   committed=git(...DIFF_PATHS,base+'...'+head);
  }catch{throw new Error('Cannot compare with origin/main');}
 }
 const outputs=[committed,git(...DIFF_PATHS),git(...DIFF_PATHS,'--cached'),
  git('ls-files','-z','--others','--exclude-standard')];
 return [...new Set(outputs.flatMap(splitPaths))].sort();
}
export async function runConflictAudit({repo=process.env.GITHUB_REPOSITORY||'Bella0960/q7v2k9n4x6r8',base='origin/main',head='HEAD',ignorePullRequestNumbers=[]}={}){
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw new Error('Repository must use owner/name form');
 const branch=git('branch','--show-current').trim(),sha=git('rev-parse',head).trim();
 if(!SHA.test(sha))throw new Error('Current Git SHA invalid');
 const mine=changedPaths(base,head);
 if(!mine.length)return buildConflictReport({repository:repo,currentBranch:branch,currentSha:sha,currentPaths:mine,ignorePullRequestNumbers});
 if(git('rev-parse','--is-shallow-repository').trim()==='true'){
  throw new Error('A complete Git history is required. Fetch the full history and retry.');
 }
 const pullRequests=await withGitPaths(repo,await openPrs(repo));
 return buildConflictReport({repository:repo,currentBranch:branch,currentSha:sha,currentPaths:mine,pullRequests,ignorePullRequestNumbers});
}
function render(r){
 const displayPath=path=>/[\u0000-\u001f\u007f-\u009f]/.test(path)
  ?JSON.stringify(path).replace(/[\u007f-\u009f]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'))
  :path;
 const lines=['MAOMAO engineering ownership scan','Repository: '+r.repository,'Branch: '+(r.currentBranch||'(detached)'),
 'Changed paths: '+r.changedPathCount,'Open PRs scanned: '+(r.openPullRequestCount??'not scanned'),
 'Exact file overlaps: '+r.exactOverlapCount,'Shared hotspots: '+r.sharedHotspotCount,'Same-module overlaps: '+r.moduleOverlapCount,''];
 if(!r.scanPerformed){lines.push('No branch or working-tree changes; no ownership conclusion was made.');return lines.join('\n');}
 if(!r.findings.length)lines.push('No overlapping open PR paths were found.');
 for(const f of r.findings){
  lines.push((f.number?'#'+f.number:'Open PR')+' · '+f.severity+' · '+(f.branch||'unknown branch'));
  if(f.title)lines.push('  '+f.title);
  for(const p of f.exactPaths)lines.push('  BLOCK: '+displayPath(p));
  for(const p of f.sharedHotspots)lines.push('  SHARED '+p.scope+': '+displayPath(p.currentPath)+' ↔ '+displayPath(p.otherPath));
  for(const p of f.moduleOverlaps)lines.push('  REVIEW '+p.scope+': '+displayPath(p.currentPath)+' ↔ '+displayPath(p.otherPath));
  if(f.url)lines.push('  '+f.url);
 }
 lines.push('','Advisory only: file overlap is not a complete semantic conflict prediction or integration authorization.');
 return lines.join('\n');
}
async function main(){
 try{
  const argv=process.argv.slice(2),json=argv.includes('--json');
  if(argv.includes('--help')){console.log('Usage: npm run eng:conflicts -- [--json]');return;}
  if(argv.some(x=>x!=='--json'))throw new Error('Only --json and --help are supported');
  const r=await runConflictAudit();console.log(json?JSON.stringify(r,null,2):render(r));if(r.exactOverlapCount)process.exitCode=2;
 }catch(e){console.error('Ownership scan incomplete; do not treat this branch as conflict-free.');console.error(clean(e?.message)||'Unknown scan error');process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
