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
      assert.equal(await page.locator('#gpProfileSettings').evaluate(e=>e.open),false);
      assert.equal(await page.locator('#gpManageCard').isVisible(),false);
      assert.equal(await page.locator('.status-bar').isVisible(),false, 'group page must not display a fake phone status bar');
      const headerTop=await page.locator('.cs-topbar').boundingBox();
      assert.ok(headerTop.y < 80, 'group topbar must not have an oversized blank header');
      const size=await page.locator('.gp-cover-hero').boundingBox();
      assert.ok(size.width>260 && size.width<=width && size.height>=200);
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
  } finally {await ctx.close();}
});
