import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
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
        const context=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
        await context.addInitScript(()=>{
            if(sessionStorage.getItem('moments-test-seeded')) return;
            sessionStorage.setItem('moments-test-seeded','1');
            if(localStorage.getItem('moments-test-seeded')) return;
            localStorage.setItem('moments-test-seeded','1');
            localStorage.setItem('ai_custom_characters',JSON.stringify([{id:'A',name:'同名',persona:'A persona'},{id:'B',name:'同名',persona:'B persona'}]));
            localStorage.setItem('phone_current_contact','A');
            localStorage.setItem('myProfile',JSON.stringify({nickname:'test',cover:''}));
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
        await page.locator('#coverInput').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
        await page.waitForFunction(()=>document.querySelector('.cover-block').style.backgroundImage.includes('data:image/jpeg'));
        await page.reload();
        await page.waitForFunction(()=>document.querySelector('.cover-block').style.backgroundImage.includes('data:image/jpeg'));
        assert.deepEqual(await page.evaluate(async()=>{
            const img=new Image();img.src=await MomentsCoverStore.get();await img.decode();
            return [img.naturalWidth,img.naturalHeight,JSON.parse(localStorage.myProfile).cover,document.getElementById('roleSelect').value];
        }),[2400,1200,'','B']);
        assert.deepEqual(errors,[]);
        await context.close();
        console.log('PASS Moments publication and cover @ '+width+'px DPR3');
    }
} finally {
    if(browser) await browser.close();
    vite.kill('SIGTERM');
}
