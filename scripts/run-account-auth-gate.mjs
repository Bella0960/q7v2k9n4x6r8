import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [major, minor] = process.versions.node.split('.').map(Number);

if (major !== 22 || minor < 16) {
  process.stderr.write(
    '[account-auth-local] Node.js 22.16 or newer within the 22.x line is required; found ' +
    process.versions.node + '.\n'
  );
  process.exit(2);
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const steps = [
  {
    name: 'Install exact lockfile dependencies',
    args: ['ci', '--no-audit', '--no-fund']
  },
  {
    name: 'Check tracked JavaScript syntax',
    command: process.execPath,
    args: ['scripts/check-syntax.mjs']
  },
  {
    name: 'Run complete release checks and build (prebuild + postbuild)',
    args: ['run', 'build']
  },
  {
    name: 'Run real local Worker and isolated SQLite account integration',
    command: process.execPath,
    args: ['tests/account-worker-runtime-e2e.mjs']
  }
];

process.stdout.write(
  '[account-auth-local] Repository: ' + repositoryRoot + '\n' +
  '[account-auth-local] Node.js: ' + process.versions.node + '\n' +
  '[account-auth-local] GitHub Actions is not required for this local run.\n'
);

for (let index = 0; index < steps.length; index += 1) {
  const step = steps[index];
  process.stdout.write(
    '\n[account-auth-local] Step ' + (index + 1) + '/' + steps.length +
    ': ' + step.name + '\n'
  );

  const result = spawnSync(step.command || npmCommand, step.args, {
    cwd: repositoryRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32' && !step.command
  });

  if (result.error) {
    process.stderr.write(
      '[account-auth-local] Could not start command: ' + result.error.message + '\n'
    );
    process.exit(3);
  }

  if (result.status !== 0) {
    const code = Number.isInteger(result.status) ? result.status : 1;
    process.stderr.write(
      '[account-auth-local] FAILED at step ' + (index + 1) +
      ' (' + step.name + '), exit code ' + code + '.\n'
    );
    process.exit(code || 1);
  }
}

process.stdout.write(
  '\n[account-auth-local] ALL LOCAL GATES PASSED.\n' +
  '[account-auth-local] Tests use disposable credentials and isolated local SQLite.\n' +
  '[account-auth-local] Preview deployment and Android/iOS acceptance are still required.\n'
);
