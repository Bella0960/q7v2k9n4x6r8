/**
 * Fail closed when publishing the app.mao520.com static asset Worker.
 * Its existing custom domain is attached to curly-dream-324c, NOT mao.
 * This service must not take over the CloudDatabase backend or create a DO.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const cfg=JSON.parse(read('wrangler.app.jsonc').replace(/^\s*\/\/.*$/gm,''));
assert.equal(cfg.name,'curly-dream-324c');
assert.equal(cfg.main,'worker-app.js');
assert.equal(cfg.compatibility_date,'2026-10-27');
assert.equal(cfg.assets?.directory,'./dist');
assert.equal(cfg.assets?.binding,'ASSETS');
assert.equal(cfg.assets?.html_handling,'none');
assert.equal(cfg.assets?.run_worker_first,true);
assert.equal(cfg.durable_objects,undefined,'Static app must not define CloudDatabase');
assert.equal(cfg.migrations,undefined,'Static app must not migrate any database');
const script=read('worker-app.js');
assert.match(script,/env\.ASSETS\.fetch/,'App must continue to serve existing assets');
assert.ok(script.length<1500,'The published app route must remain the existing static-only Worker');
assert.doesNotMatch(script,/CloudDatabase|CLOUD_DB|password|super_admin/i,'App Worker must not receive identity logic');
const setting=read('settings/settings.html');
assert.match(setting,/id="rowExportModule"/);
assert.match(setting,/id="rowImportModule"/);
assert.match(setting,/src="js\/backup-modules\.js"/);
assert.match(read('settings/js/backup-modules.js'),/MAOMAOBackupRegistry/);
console.log('app.mao520.com static Worker safe release gate passed.');
