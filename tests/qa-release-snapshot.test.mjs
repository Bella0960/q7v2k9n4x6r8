import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateQaSnapshot } from '../scripts/qa-snapshot-policy.mjs';

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
