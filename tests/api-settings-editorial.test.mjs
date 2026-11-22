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
test('API-UI-003 hides management actions but preserves the complete API form',()=>{
 const root=api;
 const head=root.split('<details class="api-tools-drawer"')[0];
 assert.ok(head.includes('id="profilePills"'),'active profile remains visible');
 for(const id of ['btnApiExportProfiles','btnApiImportProfiles','btnProfileNew','btnProfileDelete','presetChips'])
   assert.ok(!head.includes('id="'+id+'"'),'secondary action not on default surface: '+id);
 const management=root.split('<details class="api-tools-drawer"')[1].split('</details>')[0];
 assert.ok(management.startsWith(' id="api-tools-drawer">'),'native disclosure element retains its unique ID');
 assert.ok(root.includes('id="api-tools-drawer"'));
 for(const id of ['btnApiExportProfiles','btnApiImportProfiles','btnProfileNew','btnProfileDelete','presetChips'])
   assert.ok(management.includes('id="'+id+'"'),'retained tool in drawer: '+id);
 assert.ok(root.includes('<summary aria-label="展开方案管理">'),'native disclosure');
 assert.ok(!root.includes('id="api-tools-drawer" open'),'must start collapsed');
 for(const id of ['api-name','api-provider','api-url','api-key','api-model','btn-fetch-models'])
   assert.ok(api.includes('id="'+id+'"'),'primary field remains visible: '+id);
 for(const id of ['api-image-settings','api-advanced-settings'])
   assert.ok(api.includes('id="'+id+'"'),'optional settings remain foldable: '+id);
 assert.match(html,/href="css\/api-editorial\.css"/);
 assert.doesNotMatch(api,/api-form-heading">连接信息/);
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
