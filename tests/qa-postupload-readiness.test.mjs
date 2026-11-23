import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertPostUploadQaHttpReady } from '../scripts/qa-postupload-readiness.mjs';

test('single healthy attempt validates before returning without delay', async () => {
  let checks=0, delays=0;
  const result=await assertPostUploadQaHttpReady(async()=>{checks++;}, {
    sleep:async()=>{delays++;}
  });
  assert.deepEqual(result,{attempts:1});
  assert.equal(checks,1);
  assert.equal(delays,0);
});

test('temporary stale owner SHA is retried, never treated as success early', async () => {
  let login=0, sha=0;
  const delays=[];
  const result=await assertPostUploadQaHttpReady(async () => {
    login++;
    sha++;
    if (sha<3) throw new Error('preview.mao520.com is serving a different QA build than the tested git SHA');
  },{sleep:async ms=>{delays.push(ms);}});
  assert.equal(result.attempts,3);
  assert.equal(login,3);
  assert.equal(sha,3);
  assert.deepEqual(delays,[750,1500]);
});

test('persistent stale receipt fails closed after exactly five attempts', async () => {
  let count=0;const delays=[];
  await assert.rejects(
    assertPostUploadQaHttpReady(async()=>{
      count++;
      throw new Error('The owner QA domain did not serve the build receipt');
    },{sleep:async ms=>{delays.push(ms);}}),
    /did not serve the build receipt/
  );
  assert.equal(count,5);
  assert.deepEqual(delays,[750,1500,2500,4000]);
});

test('security, identity and unknown errors never retry or get suppressed', async () => {
  for(const message of [
    'QA identity authority changed after preflight',
    'Existing QA secrets changed during deployment',
    'QA identity core changed unexpectedly',
    'Invalid SHA signature',
    'QA account mode mismatch',
    'Cloudflare account counts are invalid or unverified',
    'QA deployed using unauthorized binding'
  ]){
    let attempts=0,delays=0;
    await assert.rejects(assertPostUploadQaHttpReady(async()=>{
      attempts++;throw new Error(message);
    },{sleep:async()=>{delays++;}}),e=>e?.message===message);
    assert.equal(attempts,1,message);
    assert.equal(delays,0,message);
  }
});

test('network fetch failure retries, but callback must fully pass again', async()=>{
  let login=0,receipt=0;
  const result=await assertPostUploadQaHttpReady(async()=>{
    login++;
    if(login===1)throw new TypeError('fetch failed');
    receipt++;
    if(receipt===1)throw new Error('QA login HTML is still referencing cached older JavaScript');
  },{sleep:async()=>{}});
  assert.equal(result.attempts,3);
  assert.equal(login,3);
  assert.equal(receipt,2);
});

test('invalid callback contracts reject before any attempt',async()=>{
  await assert.rejects(assertPostUploadQaHttpReady(null),TypeError);
  await assert.rejects(assertPostUploadQaHttpReady(()=>{}, {sleep:null}),TypeError);
});

test('real QA release keeps every sensitive guard before bounded GET retry',()=>{
  const source=readFileSync(new URL('../scripts/qa-direct-release.mjs',import.meta.url),'utf8');
  const last=source.lastIndexOf('await assertPostUploadQaHttpReady(async () => {');
  const raw=source.indexOf('  const testedCommit = stampQaBuildReceipt();');
  const deploy=source.indexOf("run('npx', ['--yes', 'wrangler@4', 'deploy', '--config', 'wrangler.qa.jsonc']);",raw);
  assert.ok(raw>0 && deploy>raw && last>deploy);
  for(const invariant of [
    'assertReadyForUpload({ allowPinned: qaOnly });',
    'assert.equal(coreAfter.versionId, coreVersion.versionId,',
    "assert.deepEqual(secretNames(qa), originalQaSecrets,",
    "verifyQaRuntimeVars(qa.bindings,",
    "assert.equal(qaBinding('CLOUD_DB')?.namespace_id, QA_DB);",
    "assert.equal(qaBinding('MAO_IDENTITY_AUTHORITY')?.service, CORE);",
    "await qaHttpSmoke(coreInitialized);",
    "await verifyOwnerQaOrigin(testedCommit);"
  ]){
    const index=source.lastIndexOf(invariant);
    assert.ok(index>0,'Missing guard: '+invariant);
    if(!invariant.startsWith('await'))assert.ok(index<last,'Guard moved after retry: '+invariant);
  }
  assert.match(source,/const ready = await assertPostUploadQaHttpReady\(async \(\) => \{/);
  assert.match(source,/qaOnly\) \{/);
});
