import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateQaSnapshot } from '../scripts/qa-snapshot-policy.mjs';
import { readFileSync } from 'node:fs';

const candidate = 'a'.repeat(40);
const later = 'b'.repeat(40);

test('QA release uses the exact tested candidate when heads match', () => {
  assert.deepEqual(evaluateQaSnapshot({ candidateSha: candidate, remoteSha: candidate }), {
    mode: 'current', candidateSha: candidate, remoteSha: candidate
  });
});

test('QA-only may publish a fully tested candidate if remote ONLY fast-forwarded', () => {
  const result = evaluateQaSnapshot({
    candidateSha: candidate, remoteSha: later,
    allowPinned: true, remoteDescendsFromCandidate: true
  });
  assert.equal(result.mode, 'tested-snapshot');
  assert.equal(result.candidateSha, candidate);
  assert.equal(result.remoteSha, later);
});

test('normal release must reject stale snapshots even with good ancestry', () => {
  assert.throws(() => evaluateQaSnapshot({
    candidateSha: candidate, remoteSha: later,
    remoteDescendsFromCandidate: true
  }), /strict release requires the latest/);
});

test('QA-only must refuse force-push, rewritten or unrelated history', () => {
  for (const value of [undefined, false]) {
    assert.throws(() => evaluateQaSnapshot({
      candidateSha: candidate, remoteSha: later,
      allowPinned: true, remoteDescendsFromCandidate: value
    }), /history changed or diverged/);
  }
});

test('rejects invalid or missing candidate and remote SHA', () => {
  for (const args of [
    { candidateSha: 'invalid', remoteSha: later },
    { candidateSha: candidate, remoteSha: '' },
    { candidateSha: candidate, remoteSha: later.slice(1) }
  ]) {
    assert.throws(() => evaluateQaSnapshot(args), /verified commit SHAs/);
  }
});

test('QA release retains all existing gates and verifies the phone-facing domain', () => {
  const script = readFileSync(new URL('../scripts/qa-direct-release.mjs', import.meta.url), 'utf8');
  const afterTests = script.indexOf('for (const [command, args] of TESTS) run(command, args);');
  const stamp = script.indexOf('const testedCommit = stampQaBuildReceipt();');
  const publish = script.indexOf("run('npx', ['--yes', 'wrangler@4', 'deploy', '--config', 'wrangler.qa.jsonc']);");
  assert.ok(afterTests > 0 && afterTests < stamp && stamp < publish);
  assert.match(script, /assertLatestGitHead\(\);/);
  assert.match(script, /assertReadyForUpload\(\{ allowPinned: qaOnly \}\)/);
  assert.match(script, /await cloudflarePreflight\(\)/);
  assert.match(script, /await qaHttpSmoke\(coreInitialized\)/);
  assert.match(script, /await verifyOwnerQaOrigin\(testedCommit\)/);
  assert.match(script, /https:\/\/preview\.mao520\.com\/qa-build-receipt\.json\?commit=/);
  assert.match(script, /JSON\.stringify\(\{ sourceCommit \}\)/);
});

test('QA explicit confirmation and live deployment baselines run BEFORE costly tests', () => {
  const script = readFileSync(new URL('../scripts/qa-direct-release.mjs', import.meta.url), 'utf8');
  const confirm = script.indexOf('if (deploy) {\n    assert.equal(process.env.MAOMAO_QA_DEPLOY_CONFIRM');
  const baseline = script.indexOf('liveWorkerVersion(QA), liveWorkerVersion(CORE)');
  const suite = script.indexOf('for (const [command, args] of TESTS) run(command, args);');
  assert.ok(confirm >= 0 && confirm < baseline && baseline < suite);
  assert.match(script, /if \(!deploy\) \{/);
});

test('QA release refuses concurrent Worker and identity-core deployments', () => {
  const script = readFileSync(new URL('../scripts/qa-direct-release.mjs', import.meta.url), 'utf8');
  const suite = script.indexOf('for (const [command, args] of TESTS) run(command, args);');
  const baselineCheck = script.indexOf('qaPrevious.versionId, qaBaseline.versionId');
  const coreBaselineCheck = script.indexOf('corePrevious.versionId, coreBaseline.versionId');
  const beforeUploadCheck = script.indexOf('qaCurrent.versionId, qaPrevious.versionId');
  const coreBeforeUploadCheck = script.indexOf('coreCurrent.versionId, coreVersion.versionId');
  const publish = script.indexOf("run('npx', ['--yes', 'wrangler@4', 'deploy', '--config', 'wrangler.qa.jsonc']);");
  assert.ok(suite < baselineCheck && suite < coreBaselineCheck);
  assert.ok(baselineCheck < beforeUploadCheck && coreBaselineCheck < coreBeforeUploadCheck);
  assert.ok(beforeUploadCheck < publish && coreBeforeUploadCheck < publish);
  assert.match(script, /QA Worker was deployed by another release while tests ran/);
  assert.match(script, /QA identity authority changed after preflight/);
});

test('QA-only still never deploys identity core and full release does not accept pinned stale HEAD', () => {
  const script = readFileSync(new URL('../scripts/qa-direct-release.mjs', import.meta.url), 'utf8');
  assert.match(script, /if \(qaOnly\) \{/);
  assert.match(script, /if \(qaOnly\) \{[\s\S]*?\} else \{[\s\S]*?wrangler\.qa-identity-core\.jsonc/);
  assert.match(script, /assertReadyForUpload\(\{ allowPinned: qaOnly \}\)/);
  assert.match(script, /preflightCheckout\(\);/);
});
