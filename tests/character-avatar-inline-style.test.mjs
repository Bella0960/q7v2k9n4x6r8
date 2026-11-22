import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const manager=readFileSync(new URL('../worldbook/characters/js/characters-manager.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../worldbook/characters/characters.html',import.meta.url),'utf8');
test('archive shares row hierarchy with settings 01 and 02',()=>{
 const profile=manager.slice(manager.indexOf('function renderRoleProfile()'),manager.indexOf('content.onclick = function',manager.indexOf('function renderRoleProfile()')));
 assert.ok(profile.indexOf('CHARACTER SETTINGS')<profile.indexOf('avatar-library-section'));
 assert.ok(profile.indexOf('avatar-library-section')<profile.indexOf('SOCIAL WORLD'));
 assert.match(profile,/<summary class="profile-branch avatar-library-trigger">/);
 assert.match(profile,/<span class="profile-branch-index">03<\/span>/);
 assert.match(profile,/class="profile-branch-index">04<\/span>/);
 assert.match(profile,/class="profile-branch-index">05<\/span>/);
 assert.equal((profile.match(/id="avatarLibraryTitle"/g)||[]).length,1);
 assert.match(profile,/id="avatarPairBuilder"/);
 assert.match(profile,/id="avatarPairList"/);
 assert.match(profile,/avatar-autonomy/);
});
test('no boxed portrait archive override and no embedded project mark',()=>{
 const part=html.slice(html.indexOf('/* Portrait collection is the third plain editorial settings row'),html.indexOf('/* Text-only opt-in AI actions'));
 assert.match(part,/background:transparent/);
 assert.match(part,/border-radius:0/);
 assert.doesNotMatch(part,/background:\s*#FAFAF9|border-radius:\s*12px|box-shadow:\s*0 2px/);
 assert.match(part,/grid-template-columns:34px minmax\(0,1fr\) 18px/);
});
