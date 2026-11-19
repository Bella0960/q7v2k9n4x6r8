import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, 'chat/chat');
const pageSource = fs.readFileSync(path.join(base, 'chat-settings.html'), 'utf8');
const groupSource = fs.readFileSync(path.join(base, 'group-profile-ui.js'), 'utf8');
const groupPlaySource = fs.readFileSync(path.join(base, 'group-play.html'), 'utf8');
const groupCss = fs.readFileSync(path.join(base, 'group-profile-ui.css'), 'utf8');
let server, browser, origin;

const person = (id, name) => ({
  id, name, avatar:'', nickname:'', title:'', isAdmin:false, muted:false,
  activeFrom:'08:00', activeTo:'23:00', talkativeness:.5, replyThreshold:55,
  interests:[], interestTags:[], expertiseTags:[], backgroundTags:[]
});
const group = (id, name) => ({
  id, name, members:[person('c1','晨'),person('c2','月')],
  avatar:'', relationships:{}, settings:{}, ownerId:'__user'
});
const MIME = {
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg'
};

before(async () => {
  server = http.createServer((req,res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.resolve(root, '.' + url);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file,(error,content) => {
      if (error) { res.writeHead(404);res.end('not found');return; }
      res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream'});
      res.end(content);
    });
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({headless:true});
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
async function setup(page, seed) {
  await page.goto(origin+'/chat/chat/chat-settings.html?roleId=__seed__');
  await page.evaluate(data => {
    localStorage.clear();
    Object.entries(data).forEach(([key,value]) => localStorage.setItem(key,JSON.stringify(value)));
  }, seed);
}
test('contract: group-only script, existing controls and valid JavaScript', () => {
  new vm.Script(groupSource);
  assert.match(pageSource, /group-profile-ui\.css\?v=20261119/);
  assert.match(pageSource, /group-profile-ui\.js\?v=20261119/);
  assert.match(groupSource, /!isGroupSetting\) return/);
  for (const id of ['gpInviteToggle','gpManageCard','gpNoticeCard','gpAdvancedCard','actionGpDismiss']) {
    assert.match(pageSource, new RegExp('id="' + id + '"'), id + ' must remain');
  }
  assert.match(groupSource, /chat_group_profile_cover_v1_/);
  assert.match(groupSource, /indexedDB\.open\('maomao-media-store',2\)/);
  assert.doesNotMatch(groupSource, /localStorage\.setItem\(coverKey/);
  assert.match(groupCss, /\.group-profile-page/);
  assert.match(groupCss, /\.group-profile-view \.phone-mockup > \.status-bar\{display:none!important\}/);
  assert.match(groupSource, /function setCoverBusy\(busy\)/);
  assert.match(groupSource, /coverTouched=true/);
  assert.match(groupSource, /reloadSavedCover\(\)/);
  assert.match(groupSource, /function viewMember\(memberId\)/);
  assert.match(groupPlaySource, /if\(fromSettings && history\.length>1\)\{\s*history\.back\(\)/);
  assert.match(groupPlaySource, /location\.replace\('chat-settings\.html\?roleId='/);
  assert.match(pageSource, /fromChatDetail && priorId === String\(roleId\)/);
  assert.doesNotMatch(pageSource, /\(\?:chat-detail\|group-play\|chat-search\|chat\)/);
  assert.match(groupCss, /\.gp-cover-emblem/);
  assert.match(groupSource, /emblem\.appendChild\(profileImage\)/);
  assert.doesNotMatch(groupCss, /#(?:aliasCard|actionAlias)\s*\{/);
});

test('group shell is visually distinct, collapsed and remains operable on phone widths', async () => {
  for (const width of [375,390,430]) {
    const ctx = await browser.newContext({viewport:{width,height:844}});
    const page = await ctx.newPage();
    try {
      await setup(page, {phone_groups:[group('g1','夜航')],ai_custom_characters:[person('c1','晨'),person('c2','月'),person('c3','云')]});
      await page.goto(origin+'/chat/chat/chat-settings.html?roleId=g1');
      assert.equal(await page.locator('#gpCoverName').innerText(),'夜航');
      assert.equal(await page.locator('#gpCoverCount').innerText(),'2 位成员');
      assert.equal((await page.locator('#gpCoverEmblem').innerText()).trim(),'夜');
      assert.equal(await page.locator('#gpCoverChoose').innerText(),'上传封面');
      assert.equal(await page.locator('#gpProfileSettings').evaluate(e=>e.open),false);
      assert.equal(await page.locator('#gpManageCard').isVisible(),false);
      assert.equal(await page.locator('.status-bar').isVisible(),false, 'group page must not display a fake phone status bar');
      const headerTop=await page.locator('.cs-topbar').boundingBox();
      assert.ok(headerTop.y < 80, 'group topbar must not have an oversized blank header');
      const size=await page.locator('.gp-cover-hero').boundingBox();
      assert.ok(size.width>260 && size.width<=width && size.height>=200);
      const beforeClick = await page.evaluate(() => localStorage.getItem('phone_groups'));
      await page.locator('.gp-preview-person').first().click();
      assert.equal(await page.locator('#gpProfileSettings').evaluate(e=>e.open),true);
      assert.equal(await page.locator('#gpManageCard').isVisible(),true);
      assert.equal(await page.locator('.gp-member-row[data-mid="c1"]').isVisible(),true);
      assert.equal(await page.evaluate(() => localStorage.getItem('phone_groups')),beforeClick, 'viewing a member must not edit group data');
      await page.locator('.gp-add').click();
      await page.locator('.gp-invite-row').first().waitFor({state:'visible'});
      assert.equal((await page.locator('#gpInviteCount').innerText()).trim(),'1 位可邀请');
      await page.locator('.gp-invite-row[data-role-id="c3"] .gp-invite-add').click();
      assert.equal(await page.locator('#gpCoverCount').innerText(),'3 位成员');
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('phone_groups')));
      assert.equal(saved[0].members.length,3);
    } finally {await ctx.close();}
  }
});

test('private settings remain the original page, with no group cover UI', async () => {
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  try {
    await setup(page,{ai_custom_characters:[person('c1','晨')],phone_groups:[group('g1','夜航')]});
    await page.goto(origin+'/chat/chat/chat-settings.html?roleId=c1');
    assert.equal(await page.locator('.gp-cover-hero').count(),0);
    assert.equal(await page.locator('.cs-stage.group-profile-page').count(),0);
    assert.equal(await page.locator('#aliasCard').isVisible(),true);
    assert.equal(await page.locator('.cs-title').innerText(),'Chat Settings');
  } finally {await ctx.close();}
});

test('imported group data is escaped without changing stored role names or IDs', async () => {
  const ctx = await browser.newContext({viewport:{width:390,height:844}});
  const page = await ctx.newPage();
  try {
    const source = group('g1','夜航');
    source.avatar='https://example.org/cover.png" data-injected="true';
    source.members[0].id='c1" data-injected="true';
    source.members[0].name='<strong data-injected="true">晨</strong>';
    source.members[0].avatar='https://example.org/member.png" data-injected="true';
    await setup(page,{phone_groups:[source],ai_custom_characters:[person('c3','云')]});
    await page.goto(origin+'/chat/chat/chat-settings.html?roleId=g1');
    await page.locator('#gpProfileSettings > summary').click();
    await page.locator('#actionGroupManage').click();
    const name = await page.locator('.gp-member-name').first().innerText();
    assert.equal(name,source.members[0].name,'imported names remain visible as literal text');
    assert.equal(await page.locator('[data-injected]').count(),0,'imported attributes are never parsed as markup');
    assert.equal(await page.locator('#gpMembersList .gp-member-row').first().getAttribute('data-mid'),source.members[0].id);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('phone_groups'))[0]),source,'display-only security patch must not rewrite group data');
  } finally {await ctx.close();}
});

test('member removal requires confirmation and leaves other group data untouched', async () => {
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  try {
    const original=group('g1','夜航');
    original.members[0].nickname='已保存的专属称呼';
    original.members[0].title='管理中';
    await setup(page,{phone_groups:[original],ai_custom_characters:[person('c1','晨'),person('c2','月')]});
    await page.goto(origin+'/chat/chat/chat-settings.html?roleId=g1');
    await page.locator('#gpProfileSettings > summary').click();
    await page.locator('#actionGroupManage').click();
    page.once('dialog', async dialog => {assert.match(dialog.message(),/晨/);await dialog.dismiss();});
    await page.locator('.gp-member-row[data-mid="c1"] .gp-member-remove').click();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('phone_groups'))[0]),original,
      'cancel must preserve the original member profile and role list');
    page.once('dialog', async dialog => {assert.match(dialog.message(),/晨/);await dialog.accept();});
    await page.locator('.gp-member-row[data-mid="c1"] .gp-member-remove').click();
    const saved=await page.evaluate(() => JSON.parse(localStorage.getItem('phone_groups'))[0]);
    assert.deepEqual(saved.members.map(m=>m.id),['c2']);
    assert.equal(saved.name,'夜航');
    assert.equal(await page.locator('#gpCoverCount').innerText(),'1 位成员');
  } finally {await ctx.close();}
});

test('role-owned groups are read-only: no edit, member removal or invite shortcut', async () => {
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  try {
    const original=group('g1','夜航');
    original.ownerId='c1';
    original.members[0].isAdmin=true;
    await setup(page,{phone_groups:[original],ai_custom_characters:[person('c3','云')]});
    await page.goto(origin+'/chat/chat/chat-settings.html?roleId=g1');
    assert.equal(await page.locator('.gp-add').count(),0,'no fake invitation affordance');
    await page.locator('#gpProfileSettings > summary').click();
    assert.equal(await page.locator('#gpInfoSaveBtn').isDisabled(),true);
    assert.equal(await page.locator('#gpNoticeSaveBtn').isDisabled(),true);
    assert.equal(await page.locator('#gpInviteBlock').isVisible(),false);
    assert.equal(await page.locator('.gp-member-remove').count(),0);
    await page.evaluate(() => {
      window.confirm=()=>true;
      document.getElementById('actionGpDismiss').click();
    });
    assert.match(await page.locator('#csToast').innerText(),/只有当前群主/);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('phone_groups'))[0]),original,
      'non-owner cannot edit or dissolve group');
  } finally {await ctx.close();}
});

test('the last member cannot be accidentally removed', async () => {
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  try {
    const original=group('g1','夜航');
    original.members=original.members.slice(0,1);
    await setup(page,{phone_groups:[original]});
    await page.goto(origin+'/chat/chat/chat-settings.html?roleId=g1');
    await page.locator('#gpProfileSettings > summary').click();
    await page.locator('#actionGroupManage').click();
    assert.equal(await page.locator('.gp-member-remove').count(),0);
    assert.equal(await page.locator('.gp-add').count(),1);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('phone_groups'))[0]),original);
  } finally {await ctx.close();}
});

test('ownership change during the remove confirmation cannot delete another owner member', async () => {
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  try {
    const original=group('g1','夜航');
    await setup(page,{phone_groups:[original]});
    await page.goto(origin+'/chat/chat/chat-settings.html?roleId=g1');
    await page.locator('#gpProfileSettings > summary').click();
    await page.locator('#actionGroupManage').click();
    await page.evaluate(() => {
      window.confirm=() => {
        const groups=JSON.parse(localStorage.getItem('phone_groups'));
        groups[0].ownerId='c1';
        localStorage.setItem('phone_groups',JSON.stringify(groups));
        return true;
      };
      document.querySelector('.gp-member-row[data-mid="c1"] .gp-member-remove').click();
    });
    const saved=await page.evaluate(() => JSON.parse(localStorage.getItem('phone_groups'))[0]);
    assert.equal(saved.ownerId,'c1');
    assert.deepEqual(saved.members.map(m=>m.id),['c1','c2']);
    assert.match(await page.locator('#csToast').innerText(),/只有当前群主/);
  } finally {await ctx.close();}
});

test('oversized group avatar fails before decoding and does not overwrite saved group', async () => {
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  try {
    const original=group('g1','夜航');
    await setup(page,{phone_groups:[original]});
    await page.goto(origin+'/chat/chat/chat-settings.html?roleId=g1');
    await page.locator('#gpProfileSettings > summary').click();
    await page.locator('#actionGroupInfo').click();
    await page.locator('#gpAvatarInput').setInputFiles({
      name:'too-large.png',mimeType:'image/png',buffer:Buffer.alloc(10*1024*1024+1)
    });
    assert.match(await page.locator('#csToast').innerText(),/10MB/);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('phone_groups'))[0]),original);
  } finally {await ctx.close();}
});

test('group-play back chain returns settings -> current chat, never loops', async () => {
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  try {
    await setup(page,{phone_groups:[group('g1','夜航')]});
    await page.goto(origin+'/chat/chat/chat-settings.html?roleId=g1');
    // Directly opened group settings should return to its group, not another page.
    await page.locator('#btnBack').click();
    await page.waitForURL('**/chat/chat/chat-detail.html?id=g1');
    // Real interaction: profile -> group-play -> profile -> group chat.
    await page.goto(origin+'/chat/chat/chat-settings.html?roleId=g1');
    await page.locator('#gpProfileSettings > summary').click();
    await page.locator('#gpAdvancedEntry').click();
    await page.waitForURL('**/chat/chat/group-play.html?id=g1');
    await page.locator('#backBtn').click();
    await page.waitForURL('**/chat/chat/chat-settings.html?roleId=g1');
    await page.locator('#btnBack').click();
    await page.waitForURL('**/chat/chat/chat-detail.html?id=g1');
    // Deep link into group-play does not leave another group-play page in history.
    await page.goto(origin+'/chat/chat/group-play.html?id=g1');
    await page.locator('#backBtn').click();
    await page.waitForURL('**/chat/chat/chat-settings.html?roleId=g1');
    await page.locator('#btnBack').click();
    await page.waitForURL('**/chat/chat/chat-detail.html?id=g1');
  } finally {await ctx.close();}
});

test('failed chat clearing never falsely reports success or removes data', async () => {
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  try {
    const oldHistory=[{role:'user',text:'这是之前的聊天'}];
    await setup(page,{phone_groups:[group('g1','夜航')],chat_history_g1:oldHistory});
    await page.goto(origin+'/chat/chat/chat-settings.html?roleId=g1');
    await page.evaluate(() => {
      window.confirm=()=>true;
      const remove=Storage.prototype.removeItem;
      Storage.prototype.removeItem=function(key){
        if(key==='chat_history_g1') throw new Error('storage blocked');
        return remove.call(this,key);
      };
      document.getElementById('actionGpClearRecord').click();
    });
    assert.match(await page.locator('#csToast').innerText(),/清理失败/);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('chat_history_g1'))),oldHistory);
  } finally {await ctx.close();}
});

test('failed group removal leaves the group intact instead of navigating away', async () => {
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  try {
    const original=group('g1','夜航');
    await setup(page,{phone_groups:[original]});
    await page.goto(origin+'/chat/chat/chat-settings.html?roleId=g1');
    const currentUrl=page.url();
    await page.evaluate(() => {
      window.confirm=()=>true;
      const set=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){
        if(key==='phone_groups') throw new Error('write denied');
        return set.call(this,key,value);
      };
      document.getElementById('actionGpDismiss').click();
    });
    assert.equal(page.url(),currentUrl);
    assert.match(await page.locator('#csToast').innerText(),/解散失败/);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('phone_groups'))[0]),original);
  } finally {await ctx.close();}
});

test('group dissolution clears its dedicated cover and does not remove another group', async () => {
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  try {
    await setup(page,{phone_groups:[group('g1','夜航'),group('g2','另一群')]});
    await page.goto(origin+'/chat/chat/chat-settings.html?roleId=g1');
    await page.evaluate(async () => {
      await new Promise((resolve,reject) => {
        const req=indexedDB.open('maomao-media-store',2);
        req.onupgradeneeded=() => {
          if(!req.result.objectStoreNames.contains('wallpapers')) req.result.createObjectStore('wallpapers');
          if(!req.result.objectStoreNames.contains('audio')) req.result.createObjectStore('audio',{keyPath:'id'});
        };
        req.onerror=() => reject(req.error);
        req.onsuccess=() => {
          const db=req.result;
          const tx=db.transaction('wallpapers','readwrite');
          tx.objectStore('wallpapers').put({dataUrl:'data:image/png;base64,AA=='},'chat_group_profile_cover_v1_g1');
          tx.oncomplete=() => {db.close();resolve();};
          tx.onerror=() => reject(tx.error);
        };
      });
      window.confirm=()=>true;
      document.getElementById('actionGpDismiss').click();
    });
    await page.waitForURL('**/chat/chat/chat.html',{timeout:5000});
    const state=await page.evaluate(async () => {
      const db=await new Promise((resolve,reject) => {
        const r=indexedDB.open('maomao-media-store',2);
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
      });
      const value=await new Promise((resolve,reject) => {
        const r=db.transaction('wallpapers','readonly').objectStore('wallpapers').get('chat_group_profile_cover_v1_g1');
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
      });
      db.close();
      return {cover:value,groups:JSON.parse(localStorage.getItem('phone_groups'))};
    });
    assert.equal(state.cover,undefined);
    assert.deepEqual(state.groups.map(g=>g.id),['g2']);
  } finally {await ctx.close();}
});

test('broken member portraits and group avatar display names rather than broken-image icons', async () => {
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  try {
    const g=group('g1','夜航');
    g.avatar='data:image/png;base64,not-a-real-image';
    g.members[0].avatar='data:image/png;base64,not-a-real-image';
    await setup(page,{phone_groups:[g],ai_custom_characters:[person('c1','晨'),person('c2','月')]});
    await page.goto(origin+'/chat/chat/chat-settings.html?roleId=g1');
    await page.waitForFunction(() => document.querySelector('#gpCoverEmblem').textContent === '夜');
    await page.waitForFunction(() => document.querySelector('.gp-preview-avatar').textContent === '晨');
    assert.equal((await page.locator('#gpCoverEmblem').innerText()).trim(),'夜');
    assert.equal((await page.locator('.gp-preview-person').first().locator('.gp-preview-avatar').innerText()).trim(),'晨');
    assert.equal(await page.locator('.gp-cover-hero').isVisible(),true);
  } finally {await ctx.close();}
});

test('cover persists per group in IndexedDB without polluting chat backgrounds', async () => {
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  try {
    await setup(page,{phone_groups:[group('g1','夜航'),group('g2','另一群')],ai_custom_characters:[person('c1','晨')]});
    await page.goto(origin+'/chat/chat/chat-settings.html?roleId=g1');
    // A tiny generated image; no third-party artwork or private data.
    const buffer=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVkQAAAAASUVORK5CYII=','base64');
    await page.locator('#gpCoverFile').setInputFiles({name:'cover.png',mimeType:'image/png',buffer});
    await page.waitForFunction(() => document.querySelector('.gp-cover-hero').classList.contains('has-photo'));
    assert.equal(await page.locator('#gpCoverChoose').innerText(),'更换封面');
    const state=await page.evaluate(async () => {
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('maomao-media-store',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const value=await new Promise((resolve,reject)=>{const r=db.transaction('wallpapers','readonly').objectStore('wallpapers').get('chat_group_profile_cover_v1_g1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      db.close();
      return {inDB:Boolean(value&&value.dataUrl), inLocalStorage:localStorage.getItem('chat_group_profile_cover_v1_g1'),background:localStorage.getItem('chat_background_g1')};
    });
    assert.equal(state.inDB,true);
    assert.equal(state.inLocalStorage,null);
    assert.equal(state.background,null);
    await page.goto(origin+'/chat/chat/chat-settings.html?roleId=g2');
    assert.equal(await page.locator('.gp-cover-hero.has-photo').count(),0);
    await page.goto(origin+'/chat/chat/chat-settings.html?roleId=g1');
    await page.locator('.gp-cover-hero.has-photo').waitFor({state:'visible'});
    assert.equal(await page.locator('#gpCoverChoose').innerText(),'更换封面');
    await page.locator('#gpCoverReset').click();
    await page.waitForFunction(() => !document.querySelector('.gp-cover-hero').classList.contains('has-photo'));
    assert.equal(await page.locator('#gpCoverChoose').innerText(),'上传封面');
    const afterReset=await page.evaluate(async () => {
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('maomao-media-store',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const key=await new Promise((resolve,reject)=>{const r=db.transaction('wallpapers','readonly').objectStore('wallpapers').get('chat_group_profile_cover_v1_g1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      db.close();
      return key;
    });
    assert.equal(afterReset,undefined,'reset should delete only the group cover IDB record');
  } finally {await ctx.close();}
});
