import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
const origin='http://127.0.0.1:4193';
const vite=spawn(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4193','--strictPort'],{stdio:'ignore'});
let browser;
try {
    for(let i=0;i<120;i++) {
        if(vite.exitCode!==null) throw Error('Vite exited');
        try { if((await fetch(origin+'/index.html')).ok) break; } catch {}
        if(i===119) throw Error('Vite timeout');
        await delay(250);
    }
    browser=await chromium.launch({headless:true});
    for(const width of [375,390,430]) {
        const context=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,serviceWorkers:'block'});
        await context.addInitScript(()=>{
            if(sessionStorage.getItem('moments-test-seeded')) return;
            sessionStorage.setItem('moments-test-seeded','1');
            if(localStorage.getItem('moments-test-seeded')) return;
            localStorage.setItem('moments-test-seeded','1');
            localStorage.setItem('ai_custom_characters',JSON.stringify([{id:'A',name:'同名',persona:'A persona'},{id:'B',name:'同名',persona:'B persona'}]));
            localStorage.setItem('phone_current_contact','A');
            localStorage.setItem('myProfile',JSON.stringify({nickname:'test',cover:'legacy-profile-cover'}));
            localStorage.setItem('api_settings',JSON.stringify({apiKey:'local-test-only',model:'mock'}));
            localStorage.setItem('maomao_chat_theme_preset','wechat');
            localStorage.setItem('moments',JSON.stringify([{id:'old',authorId:'me',content:'旧动态',time:1}]));
        });
        // No paid or external API request is allowed.
        await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
        const page=await context.newPage();
        const errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        const target=origin+'/chat/moments/moments.html';
        await page.goto(target);
        await page.waitForFunction(()=>!!window.MomentsChatAction&&!!window.MomentsCoverStore);
        const momentsHeader = await page.locator('.wechat-moments-toolbar').evaluate(toolbar => {
            const rect = element => {
                const box = element.getBoundingClientRect();
                return [Math.round(box.width), Math.round(box.height)];
            };
            const back = toolbar.querySelector('.wechat-moments-back svg');
            const camera = toolbar.querySelector('#wechatMomentsCamera svg');
            const cover = toolbar.parentElement.querySelector('.cover-block');
            return {
                back: rect(back),
                camera: rect(camera),
                toolbarHeight: Math.round(toolbar.getBoundingClientRect().height),
                toolbarBottom: Math.round(toolbar.getBoundingClientRect().bottom),
                coverTop: Math.round(cover.getBoundingClientRect().top)
            };
        });
        assert.deepEqual(momentsHeader.back, [20, 20], 'back arrow must remain a compact 20px icon');
        assert.deepEqual(momentsHeader.camera, [21, 21], 'publish icon must remain compact');
        assert.equal(momentsHeader.toolbarHeight, 88, 'Moments toolbar must not expand with SVG intrinsic sizing');
        assert.equal(momentsHeader.coverTop, momentsHeader.toolbarBottom, 'cover must start directly below the toolbar');
        await page.evaluate(()=>{
            window.mockCalls=0;
            window.PhoneAPI.complete=async opts=>{
                window.mockCalls++;
                if(!opts.system.includes('B persona')) throw Error('wrong persona');
                return '[朋友圈动态:测试动态]';
            };
            document.getElementById('btnAdd').click();
        });
        await page.locator('#roleSelect').selectOption('B');
        await page.locator('#btnAiPost').click();
        await page.waitForFunction(()=>JSON.parse(localStorage.getItem('moments')).some(p=>p.authorId==='B'&&p.content==='测试动态'));
        assert.equal(await page.evaluate(()=>window.mockCalls),1);
        assert.equal(await page.evaluate(()=>localStorage.getItem('phone_current_contact')),'A');
        assert.ok(await page.evaluate(()=>JSON.parse(localStorage.moments).some(p=>p.id==='old')));
        const png=await page.evaluate(()=>{
            const c=document.createElement('canvas');c.width=3200;c.height=1600;
            const ctx=c.getContext('2d');ctx.fillStyle='#555';ctx.fillRect(0,0,c.width,c.height);
            ctx.fillStyle='#fff';ctx.fillRect(0,0,1600,800);
            return c.toDataURL('image/png').split(',')[1];
        });
        const otherBackground = await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 12;
            const dataUrl = canvas.toDataURL('image/png');
            localStorage.setItem('chat_bg_A', dataUrl);
            localStorage.setItem('home_custom_wallpaper', dataUrl);
            return dataUrl;
        });
        await page.locator('#coverInput').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
        await page.waitForFunction(()=>document.querySelector('.cover-block').style.backgroundImage.includes('data:image/jpeg'));
        await page.reload();
        await page.waitForFunction(()=>document.querySelector('.cover-block').style.backgroundImage.includes('data:image/jpeg'));
        assert.deepEqual(await page.evaluate(async()=>{
            const img=new Image();img.src=await MomentsCoverStore.get();await img.decode();
            return [img.naturalWidth,img.naturalHeight,JSON.parse(localStorage.myProfile).cover,document.getElementById('roleSelect').value];
        }),[2400,1200,'legacy-profile-cover','B']);
        const firstCover = await page.evaluate(() => MomentsCoverStore.get());
        const replacement = await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            canvas.width = 3000;
            canvas.height = 1800;
            const paint = canvas.getContext('2d');
            paint.fillStyle = '#111';
            paint.fillRect(0, 0, 3000, 1800);
            paint.fillStyle = '#eee';
            paint.fillRect(1000, 400, 1000, 1000);
            return canvas.toDataURL('image/png').split(',')[1];
        });
        await page.locator('#coverInput').setInputFiles({
            name:'replacement.png', mimeType:'image/png', buffer:Buffer.from(replacement,'base64')
        });
        await page.waitForFunction(async first => (await MomentsCoverStore.get()) !== first, firstCover);
        const beforeBackup = await page.evaluate(() => MomentsCoverStore.get());
        const coverStyle = await page.locator('.cover-block').evaluate(async (element, cover) => {
            const image = new Image();
            image.src = cover;
            await image.decode();
            const style = getComputedStyle(element);
            return [image.naturalWidth, image.naturalHeight, style.backgroundSize, style.filter, devicePixelRatio];
        }, beforeBackup);
        assert.deepEqual(coverStyle, [2400, 1440, 'cover', 'none', 3]);
        const settings = await context.newPage();
        await settings.goto(origin + '/settings/settings.html');
        await settings.locator('#backupModuleSelect').selectOption('moments');
        const [download] = await Promise.all([
            settings.waitForEvent('download'),
            settings.locator('#rowExportModule').click()
        ]);
        const backup = await readFile(await download.path());
        assert.ok(backup.toString().includes(beforeBackup));
        await page.evaluate(() => MomentsCoverStore.save('data:image/png;base64,AAAA'));
        settings.on('dialog', dialog => dialog.accept());
        await settings.locator('#importModuleFileInput').setInputFiles({
            name: 'moments.json', mimeType: 'application/json', buffer: backup
        });
        await page.waitForFunction(async expected => await MomentsCoverStore.get() === expected, beforeBackup);
        await page.reload();
        await page.waitForFunction(() => document.querySelector('.cover-block').style.backgroundSize === 'cover');

        const chat = await context.newPage();
        chat.on('pageerror', e => errors.push(e.message));
        let replies = [];
        let calls = [];
        await page.evaluate(baseUrl => {
            const config = JSON.parse(localStorage.api_settings);
            localStorage.api_settings = JSON.stringify({...config, baseUrl});
        }, origin + '/mock');
        await context.route(origin + '/mock/chat/completions', async route => {
            const request = route.request().postDataJSON();
            calls.push(request.messages);
            if (!replies.length) return route.abort();
            const content = replies.shift();
            const body = 'data: ' + JSON.stringify({choices:[{delta:{content}}]}) + '\n\ndata: [DONE]\n\n';
            return route.fulfill({contentType:'text/event-stream', body});
        });
        await chat.goto(origin + '/chat/chat/chat-detail.html?id=A');
        async function send(text, response) {
            const count = calls.length;
            replies.push(response);
            await chat.locator('#chat-input').fill(text);
            await chat.locator('#chat-input').press('Enter');
            await chat.waitForFunction(message => JSON.parse(localStorage.chat_history_A || '[]')
                .some(row => row.role === 'assistant' && row.text === message),
                response.startsWith('[朋友圈动态:') ? '朋友圈已发布。' : response.split('\n')[0]);
            assert.equal(calls.length, count + 1);
            return calls.at(-1);
        }
        const explicit = await send('你发个朋友圈吧', '[朋友圈动态:今天的读书心得]');
        assert.match(explicit[0].content, /A persona/);
        assert.match(explicit[0].content, /朋友圈发布动作/);
        await page.locator('#momentsList').getByText('今天的读书心得').waitFor();
        await send('把今天的心情发到朋友圈', '[朋友圈动态:今天心情很好]');
        await page.locator('#momentsList').getByText('今天心情很好').waitFor();
        const disabled = await send('刚刚看完一本书', '读完了。\n[自主朋友圈:关闭时不得出现]');
        assert.doesNotMatch(disabled[0].content, /可选朋友圈自主发布/);
        await page.evaluate(() => {
            const posts = JSON.parse(localStorage.moments);
            posts.forEach(post => { if (post.authorId === 'A') post.time -= 86400001; });
            localStorage.moments = JSON.stringify(posts);
        });
        await settings.goto(origin + '/chat/chat/chat-settings.html?roleId=A');
        await settings.locator('#actionAutoMoment').click();
        assert.equal(await settings.evaluate(() => localStorage.chat_auto_moment_A), 'true');
        const enabled = await send('窗边的花开了', '我也看见花开了。\n[自主朋友圈:窗边的第一朵花]');
        assert.match(enabled[0].content, /可选朋友圈自主发布/);
        await page.locator('#momentsList').getByText('窗边的第一朵花').waitFor();
        const cooled = await send('外面下雨了', '雨声很好听。\n[自主朋友圈:冷却时不得出现]');
        assert.doesNotMatch(cooled[0].content, /可选朋友圈自主发布/);
        const posts = await page.evaluate(() => JSON.parse(localStorage.moments));
        assert.deepEqual(posts.filter(post => post.authorId === 'A').map(post => post.content),
            ['窗边的第一朵花', '今天心情很好', '今天的读书心得']);
        assert.ok(posts.some(post => post.id === 'old'));
        await page.evaluate(() => {
            localStorage.chat_auto_moment_B = 'true';
            const posts = JSON.parse(localStorage.moments);
            posts.forEach(post => { if (post.authorId === 'B') post.time -= 86400001; });
            localStorage.moments = JSON.stringify(posts);
        });
        const competingPost = tab => tab.evaluate(() => MomentsChatAction.publishLocked({
            source: 'auto', roleId: 'B', requestId: 'same-turn', content: '并发动态',
            storage: localStorage, getCharacters: () => PhoneStorage.getCharacters()
        }));
        await Promise.all([competingPost(page), competingPost(chat)]);
        const matchingPosts = await page.evaluate(() => JSON.parse(localStorage.moments)
            .filter(post => post.authorId === 'B' && post.content === '并发动态'));
        assert.equal(matchingPosts.length, 1);
        assert.deepEqual(await chat.evaluate(async () => [
            JSON.parse(localStorage.myProfile).cover,
            await MAOMAOWallpaperStore.getByKey('chat_bg_A'),
            await MAOMAOWallpaperStore.getByKey('home_custom_wallpaper')
        ]), ['legacy-profile-cover', otherBackground, otherBackground]);

        await page.evaluate(() => {
            window.menuCalls = 0;
            PhoneAPI.complete = () => {
                window.menuCalls++;
                return new Promise(resolve => { window.finishMoment = resolve; });
            };
            document.getElementById('btnAdd').click();
        });
        await page.locator('#roleSelect').selectOption('A');
        await page.locator('#btnAiPost').click();
        await page.waitForFunction(() => window.menuCalls === 1);
        await page.evaluate(() => document.getElementById('btnAdd').click());
        await page.locator('#roleSelect').selectOption('B');
        await page.evaluate(() => window.finishMoment('[朋友圈动态:请求时已选定 A]'));
        await page.locator('#momentsList').getByText('请求时已选定 A').waitFor();
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.moments)[0].authorId), 'A');

        await page.locator('#btnAiPost').click();
        await page.waitForFunction(() => window.menuCalls === 2);
        await page.evaluate(() => {
            localStorage.ai_custom_characters = JSON.stringify(PhoneStorage.getCharacters().filter(role => role.id !== 'B'));
            window.finishMoment('[朋友圈动态:已删除角色不能发]');
        });
        await page.waitForFunction(() => document.getElementById('momentsToast').textContent === '动态发布失败，请检查连接或存储后重试');
        assert.equal(await page.locator('#momentsList').getByText('已删除角色不能发').count(), 0);

        await page.evaluate(() => document.getElementById('btnAdd').click());
        await page.locator('#roleSelect').selectOption('A');
        for (const failure of ['offline', 'empty', 'quota']) {
            const before = await page.evaluate(() => localStorage.moments);
            await page.evaluate(mode => {
                PhoneAPI.complete = async () => {
                    window.menuCalls++;
                    if (mode === 'offline') throw new TypeError('Failed to fetch');
                    return mode === 'empty' ? '' : '[朋友圈动态:存储失败不能发]';
                };
                if (mode === 'quota') {
                    const setItem = Storage.prototype.setItem;
                    Storage.prototype.setItem = function (key, value) {
                        if (key === 'moments') throw new DOMException('quota', 'QuotaExceededError');
                        return setItem.call(this, key, value);
                    };
                }
            }, failure);
            const count = await page.evaluate(() => window.menuCalls);
            await page.locator('#btnAiPost').click();
            await page.waitForFunction(expected => window.menuCalls === expected &&
                !document.getElementById('btnAiPost').disabled, count + 1);
            await page.waitForFunction(() => document.getElementById('momentsToast').textContent === '动态发布失败，请检查连接或存储后重试');
            assert.equal(await page.evaluate(() => localStorage.moments), before);
            await page.evaluate(() => document.getElementById('btnAdd').click());
        }
        assert.equal(await page.evaluate(() => window.menuCalls), 5);
        assert.deepEqual(errors,[]);
        await context.close();
        console.log('PASS Moments publication and cover @ '+width+'px DPR3');
    }
} finally {
    if(browser) await browser.close();
    vite.kill('SIGTERM');
}
