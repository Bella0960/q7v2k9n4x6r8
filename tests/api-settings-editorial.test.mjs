import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html=readFileSync(new URL('../settings/settings.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../settings/css/api-editorial.css',import.meta.url),'utf8');
const originalJs=readFileSync(new URL('../settings/js/settings.js',import.meta.url),'utf8');
const migration=readFileSync(new URL('../settings/js/api-config-tools.js',import.meta.url),'utf8');
const api=html.slice(html.indexOf('id="api-panel"'),html.indexOf('<!-- ========== 模型选择弹窗 ========== -->'));

test('API-UI-002 preserves each API control contract once',()=>{
 const ids=[
   'api-panel','settingsForm','profilePills','presetChips','btnProfileNew',
   'btnProfileDelete','btnApiImportProfiles','btnApiExportProfiles','apiProfilesImportFile',
   'api-name','api-provider','api-url','api-key','api-model','model-list','btn-fetch-models',
   'model-fetch-msg','key-error','api-image-model','api-image-endpoint',
   'api-temperature','api-temperature-val','api-max-tokens','api-top-p','api-top-p-val',
   'api-memory','api-time-aware','btn-test-connection','test-msg'
 ];
 ids.forEach(id=>assert.equal(html.split('id="'+id+'"').length-1,1,'id '+id));
 assert.match(html,/form="settingsForm" class="btn-save"/);
 assert.match(originalJs,/settingsForm\.addEventListener\('submit'/);
 assert.match(migration,/btnApiExportProfiles/);
 assert.match(migration,/btnApiImportProfiles/);
});
test('API-UI-002 keeps migration and primary fields visible, folds optional settings',()=>{
 const top=api.split('<details')[0];
 for(const id of ['btnApiExportProfiles','btnApiImportProfiles','api-name','api-provider',
   'api-url','api-key','api-model','btn-fetch-models'])
   assert.ok(top.includes('id="'+id+'"'),'always visible: '+id);
 for(const id of ['api-image-settings','api-advanced-settings'])
   assert.ok(api.includes('id="'+id+'"'),'disclosure: '+id);
 assert.doesNotMatch(api,/<details[^>]+open(?:\s|>)/);
 assert.match(html,/href="css\/api-editorial\.css"/);
});
test('API-UI-002 keeps visual rules in API panel and accessible controls',()=>{
 assert.match(css,/#api-panel\.api-editorial-panel/);
 assert.match(css,/#api-panel \.api-editorial-footer/);
 assert.match(css,/prefers-reduced-motion/);
 assert.match(css,/overflow-x: auto/);
 assert.match(api,/<button type="button" class="eye-btn"/);
 assert.match(api,/aria-live="polite"/);
 assert.doesNotMatch(api,/[\u{1F300}-\u{1FAFF}]/u,'no decorative emoji');
});
