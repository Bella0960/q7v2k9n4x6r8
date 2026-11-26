#!/usr/bin/env node
// Read-only scan of this branch's changed paths against open MAOMAO PRs.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const API='https://api.github.com';
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
 const p=value.trim().replace(/\\/g,'/');
 if(!p||p.startsWith('/')||/^[a-zA-Z]:/.test(p)||/[\u0000-\u001f\u007f-\u009f]/.test(p))return null;
 const parts=p.split('/');
 return parts.some(x=>!x||x==='.'||x==='..')?null:parts.join('/');
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
export function buildConflictReport({repository='Bella0960/q7v2k9n4x6r8',currentBranch='',currentSha='',currentPaths=[],pullRequests=[]}={}){
 const own=pathSet(currentPaths),findings=[];
 for(const pr of pullRequests){
  if(pr?.state&&pr.state!=='open')continue;
  const branch=clean(pr?.branch||pr?.head?.ref,120),sha=clean(pr?.headSha||pr?.head?.sha,40);
  if((currentBranch&&branch===currentBranch)||(currentSha&&sha===currentSha))continue;
  const other=pathSet(pr?.files||pr?.changedFiles||[]),exact=[...own].filter(p=>other.has(p)).sort(),shared=[],modules=[];
  for(const a of own)for(const b of other){
   if(a===b)continue;
   const ha=hotspotKey(a),hb=hotspotKey(b);
   if(ha&&ha===hb)shared.push({scope:ha,currentPath:a,otherPath:b});
   else{const ma=moduleScope(a),mb=moduleScope(b);if(ma&&ma===mb)modules.push({scope:ma,currentPath:a,otherPath:b});}
  }
  const sh=uniquePairs(shared),mo=uniquePairs(modules);
  if(!exact.length&&!sh.length&&!mo.length)continue;
  findings.push({number:Number.isSafeInteger(pr?.number)?pr.number:null,title:clean(pr?.title),branch,
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
function git(...args){return execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim();}
function nextLink(h){return String(h||'').match(/<([^>]+)>;\s*rel="next"/)?.[1]||null;}
async function getJson(url){
 const headers={accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','user-agent':'maomao-engineering-conflict-audit'};
 const token=process.env.GITHUB_TOKEN||process.env.GH_TOKEN;if(token)headers.authorization='Bearer '+token;
 const r=await fetch(url,{headers,signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new Error('GitHub API request failed ('+r.status+')');
 return {data:await r.json(),next:nextLink(r.headers.get('link'))};
}
async function pages(url){const out=[];while(url){const p=await getJson(url);if(!Array.isArray(p.data))throw new Error('GitHub API returned invalid list');out.push(...p.data);url=p.next;}return out;}
async function openPrs(repo){
 const root=API+'/repos/'+repo,prs=await pages(root+'/pulls?state=open&per_page=100');
 const out=new Array(prs.length);let i=0;
 await Promise.all(Array.from({length:Math.min(4,prs.length)},async()=>{while(true){const n=i++;if(n>=prs.length)return;const p=prs[n];out[n]={number:p.number,title:p.title,state:p.state,branch:p.head?.ref,headSha:p.head?.sha,html_url:p.html_url,files:await pages(root+'/pulls/'+p.number+'/files?per_page=100')};}}));
 return out;
}
function changedPaths(base,head){
 let committed;
 try{committed=git('diff','--name-only',base+'...'+head);}
 catch{if(base!=='origin/main')throw new Error('Base reference unavailable');try{git('fetch','--quiet','--no-tags','origin','main');committed=git('diff','--name-only',base+'...'+head);}catch{throw new Error('Cannot compare with origin/main');}}
 return [...new Set([committed,git('diff','--name-only'),git('diff','--cached','--name-only'),git('ls-files','--others','--exclude-standard')].flatMap(x=>x.split(/\r?\n/)).map(normalizeRepoPath).filter(Boolean))].sort();
}
export async function runConflictAudit({repo=process.env.GITHUB_REPOSITORY||'Bella0960/q7v2k9n4x6r8',base='origin/main',head='HEAD'}={}){
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw new Error('Repository must use owner/name form');
 const branch=git('branch','--show-current'),sha=git('rev-parse',head);
 if(!/^[0-9a-f]{40}$/.test(sha))throw new Error('Current Git SHA invalid');
 const mine=changedPaths(base,head);
 if(!mine.length)return buildConflictReport({repository:repo,currentBranch:branch,currentSha:sha,currentPaths:mine});
 return buildConflictReport({repository:repo,currentBranch:branch,currentSha:sha,currentPaths:mine,pullRequests:await openPrs(repo)});
}
function render(r){
 const lines=['MAOMAO engineering ownership scan','Repository: '+r.repository,'Branch: '+(r.currentBranch||'(detached)'),
 'Changed paths: '+r.changedPathCount,'Open PRs scanned: '+(r.openPullRequestCount??'not scanned'),
 'Exact file overlaps: '+r.exactOverlapCount,'Shared hotspots: '+r.sharedHotspotCount,'Same-module overlaps: '+r.moduleOverlapCount,''];
 if(!r.scanPerformed){lines.push('No branch or working-tree changes; no ownership conclusion was made.');return lines.join('\n');}
 if(!r.findings.length)lines.push('No overlapping open PR paths were found.');
 for(const f of r.findings){
  lines.push((f.number?'#'+f.number:'Open PR')+' · '+f.severity+' · '+(f.branch||'unknown branch'));
  if(f.title)lines.push('  '+f.title);
  for(const p of f.exactPaths)lines.push('  BLOCK: '+p);
  for(const p of f.sharedHotspots)lines.push('  SHARED '+p.scope+': '+p.currentPath+' ↔ '+p.otherPath);
  for(const p of f.moduleOverlaps)lines.push('  REVIEW '+p.scope+': '+p.currentPath+' ↔ '+p.otherPath);
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
