import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const planner = new URL('../scripts/qa-release-plan.mjs', import.meta.url).href;
const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 30000
}).trim();
function plan(cwd, base, head) {
  return execFileSync(process.execPath, ['--input-type=module', '-e',
    'import {getReleasePlan} from '+JSON.stringify(planner)+'; console.log(JSON.stringify(getReleasePlan(process.argv[1],process.argv[2])))',
    base, head], {cwd, encoding:'utf8', stdio:['ignore','pipe','pipe'],timeout:90000});
}
test('shallow QA checkout obtains ancestry evidence and still rejects divergent or older candidates', {timeout:120000}, () => {
  const root = mkdtempSync(join(tmpdir(),'mao-qa-ancestry-'));
  try {
    git(root,'init','-q','-b','main','origin');
    const origin=join(root,'origin');
    git(origin,'config','user.name','QA Fixture');
    git(origin,'config','user.email','qa@example.invalid');
    git(origin,'commit','-q','--allow-empty','-m','baseline');
    const base=git(origin,'rev-parse','HEAD');
    for(let i=0;i<72;i++) git(origin,'commit','-q','--allow-empty','-m','candidate '+i);
    const head=git(origin,'rev-parse','HEAD');
    git(origin,'switch','-q','-c','divergent',base);
    git(origin,'commit','-q','--allow-empty','-m','unrelated branch');
    const divergent=git(origin,'rev-parse','HEAD');
    git(origin,'switch','-q','main');
    const clone=join(root,'candidate');
    git(root,'clone','-q','--depth','64',pathToFileURL(origin).href,clone);
    git(clone,'fetch','-q','--no-tags','origin',base);
    assert.throws(()=>git(clone,'merge-base','--is-ancestor',base,head));
    assert.equal(JSON.parse(plan(clone,base,head)).mode,'standard');
    assert.equal(git(clone,'rev-parse','--is-shallow-repository'),'false');
    assert.throws(()=>plan(clone,divergent,head),/Candidate must include the currently deployed QA source/);
    assert.throws(()=>plan(clone,head,base),/Candidate must include the currently deployed QA source/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
