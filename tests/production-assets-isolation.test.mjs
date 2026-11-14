import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const dist=resolve(root,'dist');

test('production bundle contains backup modules and the existing settings entry',()=>{
  for(const path of ['settings/settings.html','settings/js/backup.js','settings/js/backup-modules.js']){
    assert.ok(existsSync(resolve(dist,path)), 'required web asset missing: '+path);
  }
});
test('production static site never publishes server-side Worker internals',()=>{
  const deny=['worker.js','worker-app.js','worker','scripts',
    'worker/lib/account-auth.js','worker/lib/identity-bridge.js',
    'worker/lib/store.js','worker/migrations/0012_mao_accounts.js',
    'scripts/verify-production-worker-source.mjs'];
  for(const path of deny){
    assert.equal(existsSync(resolve(dist,path)),false,
      'private backend source publicly exposed: '+path);
  }
});
test('the security gate does not remove ordinary app assets',()=>{
  for(const path of ['index.html','settings/css/settings.css']){
    assert.ok(existsSync(resolve(dist,path)), 'required application asset missing: '+path);
  }
});
