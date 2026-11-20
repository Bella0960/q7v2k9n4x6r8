import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { preview } from 'vite';

const previewServer = process.env.MEMORY_TEST_ORIGIN ? null : await preview({
    preview: { host: '127.0.0.1', port: 0 }
});
const base = process.env.MEMORY_TEST_ORIGIN || 'http://127.0.0.1:' + previewServer.httpServer.address().port;
let browser;
try {
    browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || undefined,
        args: ['--no-sandbox']
    });
    for (const width of [375, 390, 430, 1100]) {
        const page = await browser.newPage({ viewport: { width, height: 820 }, isMobile: width < 500, hasTouch: width < 500 });
        page.setDefaultTimeout(12000);
        page.on('dialog', dialog => dialog.accept());
        await page.addInitScript(() => {
            if (localStorage.getItem('memory-browser-seeded')) return;
            localStorage.setItem('memory-browser-seeded', '1');
            localStorage.setItem('ai_custom_characters', JSON.stringify([{ id: 'solo', name: '测试角色' }]));
            localStorage.setItem('phone_groups', JSON.stringify([{ id: 'group', name: '测试群', members: [{ id: 'solo', name: '测试角色' }] }]));
            const history = [{ id: 'one', role: 'sent', text: '待删除原文' }, { id: 'two', role: 'received', text: '保留原文' }];
            localStorage.setItem('chat_history_solo', JSON.stringify(history));
            localStorage.setItem('chat_memories_solo', JSON.stringify([
                { id: 'confirmed', content: '保留记忆', status: 'confirmed' },
                { id: 'fixed', content: '待删除记忆', status: 'fixed' }
            ]));
            localStorage.setItem('phone_data_v2', JSON.stringify({ group: { chat: { history }, memories: { items: [{ content: '群记忆' }] } } }));
        });
        await page.goto(base + '/worldbook/memory/memory.html');
        await page.locator('.memory-archive-entry').filter({ hasText: '待删除原文' }).getByRole('button', { name: '删除', exact: true }).click();
        await page.reload();
        assert.equal(await page.locator('.memory-archive-entry').count(), 1);
        await page.getByRole('button', { name: '记忆库', exact: true }).click();
        await page.locator('.lib-item').filter({ hasText: '待删除记忆' }).getByRole('button', { name: '删除', exact: true }).click();
        assert.equal(await page.locator('.lib-item').count(), 1);
        assert.match(await page.locator('.lib-item').innerText(), /保留记忆/);
        await page.getByRole('button', { name: '清空当前记忆' }).click();
        assert.equal(await page.locator('.lib-item').count(), 0);
        assert.equal(await page.evaluate(() => PhoneStorage.getChatHistory('solo').length), 2);
        assert.equal(await page.evaluate(() => PhoneStorage.getMemoryArchiveEntries('solo').length), 0);
        assert.equal(await page.evaluate(() => PhoneStorage.getMemories('group').length), 1);
        await page.getByRole('button', { name: '群聊', exact: true }).click();
        await page.locator('.group-memory-item').getByRole('button', { name: '删除', exact: true }).click();
        assert.equal(await page.locator('.group-memory-item').count(), 0);
        await page.getByRole('button', { name: '清空当前群记忆' }).click();
        assert.equal(await page.evaluate(() => PhoneStorage.getChatHistory('group').length), 2);
        assert.equal(await page.evaluate(() => PhoneStorage.getMemoryArchiveEntries('group').length), 0);
        await page.evaluate(() => PhoneStorage.saveMemories('group', [{ id: 'again', content: '群记忆' }]));
        await page.evaluate(() => PhoneStorage.saveMemories('solo', [{ id: 'again', content: '单聊记忆' }]));
        for (const [id, button] of [['solo', '#actionClear'], ['group', '#actionGpClearRecord']]) {
            await page.goto(base + '/chat/chat/chat-settings.html?roleId=' + id);
            await page.locator(button).click();
            assert.deepEqual(await page.evaluate(id => [PhoneStorage.getChatHistory(id).length, PhoneStorage.getMemories(id).length], id), [0, 0]);
        }
        console.log('Memory Space passed at ' + width + 'px');
        await page.close();
    }
} finally {
    await browser?.close();
    if (previewServer) await new Promise(resolve => previewServer.httpServer.close(resolve));
}
