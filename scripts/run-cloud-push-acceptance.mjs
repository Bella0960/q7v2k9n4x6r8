import { spawnSync } from 'node:child_process';
import process from 'node:process';

// Local acceptance gate for the Cloud Shell workflow when hosted CI is unavailable.
// It reuses the project's existing test scripts and stops at the first failure.
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const steps = [
  ['JavaScript syntax', 'check:syntax'],
  ['MAO account, build, Cloud Push and baseline gates', 'test:accounts:all'],
  ['Character schedule policy', 'test:schedule'],
  ['Autonomy scheduler', 'test:autonomy'],
  ['Chat regression contract', 'test:chat:contract'],
  ['Media backup and restore', 'test:media:backup'],
  ['Clock palette and long-press regression', 'test:clock:palette']
];

console.log('MAOMAO local Cloud Push acceptance');
console.log('Hosted GitHub Actions is not used by this runner.');

for (let index = 0; index < steps.length; index += 1) {
  const [label, script] = steps[index];
  console.log('\\n[' + (index + 1) + '/' + steps.length + '] ' + label + ' (' + script + ')');
  const result = spawnSync(npm, ['run', script], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (result.error) {
    console.error('FAILED: ' + label + ': ' + result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    const reason = result.signal ? 'signal ' + result.signal : 'exit code ' + result.status;
    console.error('FAILED: ' + label + ' (' + reason + ')');
    console.error('Acceptance stopped. Later checks were not run.');
    process.exit(result.status || 1);
  }
  console.log('PASSED: ' + label);
}

console.log('\\nALL LOCAL ACCEPTANCE CHECKS PASSED');
