/**
 * Fail closed before updating the production Worker.
 * The live production Worker has a Durable Object SQLite backend. Shipping
 * only a static ASSETS.fetch entry would destroy account, push and wallet APIs.
 * This test intentionally contains no tokens and never reads user records.
 */
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=path=>readFileSync(resolve(root,path),'utf8');
const config=JSON.parse(read('wrangler.jsonc').replace(/^\s*\/\/[^\n]*$/gm,''));
assert.equal(config.name,'mao','Unexpected Worker name: do not deploy to another service');
assert.equal(config.main,'worker.js');
assert.equal(config.compatibility_date,'2026-10-27','Compatibility change requires separate review');
assert.ok(config.compatibility_flags?.includes('nodejs_compat'));
assert.equal(config.keep_vars,true,'Deploy must preserve dashboard variables/secrets');
assert.equal(config.assets?.binding,'ASSETS');
assert.equal(config.assets?.run_worker_first,true);
assert.equal(config.assets?.html_handling,'none');
assert.deepEqual(config.durable_objects?.bindings,[{name:'CLOUD_DB',class_name:'CloudDatabase'}]);
assert.deepEqual(config.migrations,[{tag:'v1',new_sqlite_classes:['CloudDatabase']}]);

const source=read('worker.js');
assert.match(source,/export class CloudDatabase\b/,'The backend SQLite Durable Object class is required');
assert.match(source,/async scheduled\s*\(/,'The existing scheduled handler must remain');
assert.match(source,/env\.ASSETS\.fetch\(/,'Static assets must still work');
assert.match(source,/CLOUD_DB/,'Cloud database binding must stay connected');
assert.match(source,/\/api\//,'Account and API routing must not disappear');
assert.ok(source.length>9000,'Do not deploy a shortened/static-only Worker');

const required=[
  'worker/lib/account-auth.js','worker/lib/app.js','worker/lib/crypto.js',
  'worker/lib/http.js','worker/lib/identity-bridge.js','worker/lib/migrations.js',
  'worker/lib/scheduler-gate.js','worker/lib/scheduler-policy.js',
  'worker/lib/scheduler.js','worker/lib/store.js','worker/lib/webpush.js',
  'shared/js/phone/character-schedule-policy.js',
  ...Array.from({length:16},(_,i)=>
    'worker/migrations/'+String(i+1).padStart(4,'0')+'_'
  )
];
for(const item of required) {
  if(item.includes('worker/migrations/')) {
    // Migration file suffixes may evolve, but each prior migration index must exist.
    const {readdirSync}=await import('node:fs');
    const all=readdirSync(resolve(root,'worker/migrations'));
    assert.ok(all.some(f=>f.startsWith(item.split('/').at(-1))),
      'Existing account/DO schema migration missing: '+item);
  } else {
    assert.ok(statSync(resolve(root,item)).size>100,
      'Existing Worker backend dependency missing: '+item);
  }
}
console.log('Production Worker source parity gate passed. No secrets or user data accessed.');
