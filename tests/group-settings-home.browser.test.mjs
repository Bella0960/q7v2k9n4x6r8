import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const origin = 'http://group-settings.local';
const root = new URL('../', import.meta.url);
const group = {id:'g-test', name:'每周碰面', ownerId:'__user', members:[
  {id:'a',name:'甲'},{id:'b',name:'乙'}
]};

test('group settings support extension tiles, member controls and persisted preferences', {timeout:60000}, async () => {
  const browser = await chromium.launch();
  try {
    for (const owner of ['__user', 'a']) {
      const page = await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
      page.setDefaultTimeout(10000);
      page.setDefaultNavigationTimeout(10000);
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        try {
          const file = await readFile(new URL('.' + url.pathname, root));
          const contentType = url.pathname.endsWith('.js') ? 'application/javascript' :
            url.pathname.endsWith('.css') ? 'text/css' : 'text/html';
          return route.fulfill({body:file,contentType});
        } catch { return route.fulfill({status:404,body:''}); }
      });
      await page.addInitScript(({group,owner}) => {
        if (localStorage.getItem('phone_groups')) return;
        localStorage.setItem('phone_groups', JSON.stringify([{...group,ownerId:owner}]));
        localStorage.setItem('ai_custom_characters', JSON.stringify([{id:'outside',name:'新角色'}]));
      },{group,owner});
      await page.goto(origin + '/chat/chat/chat-settings.html?roleId=g-test');
      await page.waitForURL('**/group-play.html?id=g-test');
      // The overview is photo-first and collapsed. Unfold before accessing the controls.
      const expand = page.locator('[data-group-action="expand"]');
      await expand.waitFor({state:'visible'});
      assert.equal(await expand.getAttribute('aria-expanded'),'false');
      await expand.click();
      assert.equal(await expand.getAttribute('aria-expanded'),'true');
      await page.getByRole('button',{name:'群组管理'}).waitFor();
      assert.equal(await page.locator('.group-home-tools button').count(),3);
      assert.equal(await page.getByRole('button',{name:'邀请成员'}).isEnabled(),owner==='__user');
      await page.getByRole('button',{name:'群组管理'}).click();
      if (owner !== '__user') {
        assert.equal(await page.getByRole('button',{name:'设为管理员'}).count(),0);
        assert.equal(await page.getByRole('button',{name:'禁言',exact:true}).count(),0);
        await page.close();
        continue;
      }
      const member=page.locator('.group-dialog-member').filter({has:page.getByText('甲',{exact:true})});
      await member.getByRole('button',{name:'设为管理员'}).click();
      await member.getByRole('button',{name:'禁言',exact:true}).click();
      let saved=await page.evaluate(()=>JSON.parse(localStorage.phone_groups)[0]);
      assert.equal(saved.members[0].memberRole,'admin');
      assert.equal(saved.members[0].isMuted,true);
      await member.getByRole('button',{name:'解除禁言'}).click();
      await member.getByRole('button',{name:'取消管理员'}).click();
      await page.getByRole('button',{name:'返回群聊设置'}).click();
      await page.getByRole('switch',{name:'保存到通讯录'}).click();
      await page.getByRole('switch',{name:'消息免打扰'}).click();
      await page.getByRole('switch',{name:'置顶聊天'}).click();
      await page.getByRole('button',{name:'邀请成员'}).click();
      await page.locator('dialog').getByRole('button',{name:'邀请',exact:true}).click();
      await page.getByRole('button',{name:'移除成员'}).click();
      await page.locator('dialog .group-dialog-member').filter({hasText:'新角色'}).getByRole('button',{name:'移除',exact:true}).click();
      await page.getByRole('button',{name:'确认移除'}).click();
      await page.reload();
      const reloadExpand = page.locator('[data-group-action="expand"]');
      await reloadExpand.waitFor({state:'visible'});
      assert.equal(await reloadExpand.getAttribute('aria-expanded'),'false',
        'page reload must default to collapsed overview');
      await reloadExpand.click();
      await page.getByRole('switch',{name:'置顶聊天',checked:true}).waitFor();
      saved=await page.evaluate(()=>JSON.parse(localStorage.phone_groups)[0]);
      assert.equal(saved.preferences.savedToContacts,true);
      assert.equal(saved.preferences.muted,true);
      assert.equal(saved.members.length,2);
      assert.equal(saved.members[0].isMuted,false);
      assert.equal(saved.members[0].isAdmin,false);
      await page.evaluate(() => {
        GroupSettingsHome.registerAction('fixture', () => document.body.dataset.fixture='called');
        GroupSettingsHome.registerTile({id:'fixture',action:'fixture',label:'扩展功能'});
      });
      await page.getByRole('switch',{name:'消息免打扰'}).click();
      await page.getByRole('button',{name:'扩展功能'}).click();
      assert.equal(await page.locator('body').getAttribute('data-fixture'),'called');
      await page.goto(origin + '/chat/chat/chat-settings.html?roleId=outside');
      assert.match(page.url(),/chat-settings\.html/);
      assert.equal(await page.locator('#groupCategoryHome').count(),0);
      await page.close();
    }
  } finally { await browser.close(); }
});
