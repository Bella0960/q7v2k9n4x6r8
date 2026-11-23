import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../scripts/qa-direct-release.mjs', import.meta.url), 'utf8');

test('after-test diagnostic identifies each required gate by number without printing private data', () => {
  const start = script.indexOf("if (diagnoseAfterTests) {");
  const end = script.indexOf("await check('built-assets'", start);
  assert.ok(start >= 0 && end > start, 'Expected post-test diagnostics');
  const segment = script.slice(start, end);
  assert.match(segment, /TESTS\.entries\(\)/);
  assert.match(segment, /QA_GUARD_DIAG_FAIL:required-test-gate-/);
  assert.match(segment, /index \+ 1/);
  assert.match(segment, /TESTS\.length/);
  assert.match(segment, /details remain private/);
  assert.doesNotMatch(segment, /console\.(?:log|error)\([^\n]*(?:command|args|error\.(?:stack|message))/);
});

test('original QA release still requires all original safety checkpoints', () => {
  for (const call of [
    'preflightCheckout();',
    'await cloudflarePreflight()',
    'assertReadyForUpload({ allowPinned: qaOnly })',
    'liveWorkerVersion(QA)',
    'liveWorkerVersion(CORE)',
    'await verifyWorkerPublicRoutes();'
  ]) assert.ok(script.includes(call), 'Missing release safety check: '+call);
  assert.match(script,/if \(diagnoseGuards \|\| diagnoseAfterTests\)/);
  assert.match(script,/QA_GUARD_DIAG_PASS:after-full-tests/);
});
