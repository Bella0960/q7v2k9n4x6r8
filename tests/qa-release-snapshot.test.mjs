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
