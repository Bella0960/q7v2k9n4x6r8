import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConflictReport,hotspotKey,moduleScope,normalizeRepoPath} from '../scripts/engineering-pr-conflicts.mjs';
const pull=(number,branch,files,extra={})=>({number,title:'Task '+number,state:'open',branch,files,...extra});

test('normalizes repository paths and rejects traversal or absolute paths',()=>{
 assert.equal(normalizeRepoPath('chat/chat/detail.html'),'chat/chat/detail.html');
 assert.equal(normalizeRepoPath('chat\\chat\\detail.html'),'chat/chat/detail.html');
 for(const x of ['/tmp/x','../x','chat/../../x','chat//x','./chat/x','C:\\temp\\x','chat/\u001b[31mx'])assert.equal(normalizeRepoPath(x),null);
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
 const r=buildConflictReport({currentBranch:'GOV/current',currentPaths:['docs/engineering/EXECUTION_LOG.md'],pullRequests:[pull(8,'GOV/current',['docs/engineering/EXECUTION_LOG.md']),pull(9,'OLD/closed',['docs/engineering/EXECUTION_LOG.md'],{state:'closed'})]});
 assert.equal(r.findings.length,0);
});
test('renamed PR files include old and new paths; empty scans are not called clean',()=>{
 const r=buildConflictReport({currentPaths:['chat/chat/old.html','chat/chat/new.html'],pullRequests:[pull(10,'CHAT/rename',[{filename:'chat/chat/new.html',previous_filename:'chat/chat/old.html'}])]});
 assert.equal(r.exactOverlapCount,2);
 const empty=buildConflictReport({currentPaths:[],pullRequests:[pull(11,'X',['chat/chat/a.html'])]});
 assert.equal(empty.scanPerformed,false);assert.equal(empty.openPullRequestCount,null);
});
