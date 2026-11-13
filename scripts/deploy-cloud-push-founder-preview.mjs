import { spawnSync } from 'node:child_process';
import process from 'node:process';

// Preview-only deploy hook. The owner-approved permanent account and original
// Durable Object stay tied to this existing preview name. NEVER deploy main.
const PREVIEW = 'qa/phone-founder-001-keyreset-20261111';
const envVars = [
  ['VAPID_PUBLIC_KEY', 'MAOMAO_PUSH_VAPID_PUBLIC_B64', /^[A-Za-z0-9_-]{87}$/],
  ['VAPID_PRIVATE_KEY', 'MAOMAO_PUSH_VAPID_PRIVATE_B64', /^[A-Za-z0-9_-]{43}$/],
  ['VAPID_SUBJECT', 'MAOMAO_PUSH_VAPID_SUBJECT', /^https:\/\/mao520\.com$/]
];
const expected = {
  name: PREVIEW,
  sourceBranch: 'fix/cloud-push-founder001-existing-account-20261114'
};
function wrangler(args, input) {
  const run = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['wrangler', ...args],
    {
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: process.platform === 'win32',
      maxBuffer: 1024 * 1024
    }
  );
  if (run.error || run.status !== 0) {
    throw new Error('Preview deployment failed at ' + args.slice(0, 3).join(' ') +
      ': ' + (run.error?.message || ('exit ' + run.status)));
  }
}
for (const [name, key, pattern] of envVars) {
  const secret = String(process.env[key] || '').trim();
  if (!pattern.test(secret)) {
    throw new Error('Required Cloudflare secret not configured: ' + key);
  }
}
console.log('MAOMAO push: guarded founder-preview deploy with existing account database');
console.log('Target preview: ' + expected.name);
wrangler(['preview', '--config', 'wrangler.jsonc', '--name', expected.name]);
for (const [name, key] of envVars) {
  // Never log secrets and do not pass them on the command line.
  wrangler(['preview', 'secret', 'put', name,
    '--config', 'wrangler.jsonc', '--name', expected.name, '--skip-confirmation'],
    process.env[key].trim() + '\n');
}
console.log('All push secrets were set on the existing founder Preview (not production).');
