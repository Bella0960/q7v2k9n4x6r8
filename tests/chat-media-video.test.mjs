/**
 * CHAT-002 单元测试：聊天附件媒体层（chat-media.js）+ 接入契约
 *
 * 运行：node --test tests/chat-media-video.test.mjs
 * 说明：chat-media.js 是纯 IIFE，这里用 vm 沙箱注入最小 window 环境，
 *      不依赖真实浏览器；渲染/播放/存储端到端由 chat-media-video.browser.mjs 覆盖。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const MEDIA_SRC = read('chat/js/chat-media.js');
const EXTRAS_SRC = read('chat/chat/js/chat-extras.js');
const DETAIL_SRC = read('chat/chat/chat-detail.html');
const SW_SRC = read('sw.js');

function makeLocalStorage(entries) {
    const data = Object.assign({}, entries || {});
    return {
        get length() { return Object.keys(data).length; },
        key(i) { return Object.keys(data)[i]; },
        getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
        setItem(k, v) { data[k] = String(v); },
        removeItem(k) { delete data[k]; }
    };
}

/**
 * 加载 chat-media.js：可注入 PhoneStorage（含 mock MediaRepository）与 localStorage。
 */
function loadChatMedia(opts) {
    opts = opts || {};
    const win = {
        console,
        Promise,
        setTimeout,
        clearTimeout,
        URL: { createObjectURL: () => 'blob:fake', revokeObjectURL() {} },
        document: { createElement: () => ({ getContext: () => null, toDataURL: () => '' }) },
        PhoneStorage: opts.PhoneStorage || {},
        localStorage: opts.localStorage || makeLocalStorage()
    };
    win.window = win;
    vm.createContext(win);
    vm.runInContext(MEDIA_SRC, win);
    return win;
}

function mockRepo(calls) {
    function Repo() {
        this.removeRef = function (assetId, ownerType, ownerId) {
            calls.push(['removeRef', assetId, ownerType, ownerId]);
            return Promise.resolve({ ok: true, value: { removed: true } });
        };
        this.removeAsset = function (assetId) {
            calls.push(['removeAsset', assetId]);
            return Promise.resolve({ ok: true, value: { removed: true } });
        };
    }
    return Repo;
}

/* ---------------- 纯函数 ---------------- */

test('mmss 输出 mm:ss，非法值回 00:00', () => {
    const { ChatMedia } = loadChatMedia();
    assert.equal(ChatMedia.mmss(0), '00:00');
    assert.equal(ChatMedia.mmss(-3), '00:00');
    assert.equal(ChatMedia.mmss(NaN), '00:00');
    assert.equal(ChatMedia.mmss(1.046), '00:01');
    assert.equal(ChatMedia.mmss(61), '01:01');
    assert.equal(ChatMedia.mmss(599.9), '09:59');
});

test('formatSize 体积文案', () => {
    const { ChatMedia } = loadChatMedia();
    assert.equal(ChatMedia.formatSize(0), '0 KB');
    assert.equal(ChatMedia.formatSize(512), '512 B');
    assert.equal(ChatMedia.formatSize(3693), '4 KB');
    assert.equal(ChatMedia.formatSize(2.5 * 1024 * 1024), '2.5 MB');
});

test('fileKind 识别图片 / 视频 / 其它（含扩展名兜底）', () => {
    const { ChatMedia } = loadChatMedia();
    assert.equal(ChatMedia.fileKind({ type: 'image/jpeg', name: 'a.jpg' }), 'image');
    assert.equal(ChatMedia.fileKind({ type: 'image/png', name: 'a' }), 'image');
    assert.equal(ChatMedia.fileKind({ type: 'image/webp', name: 'a.webp' }), 'image');
    assert.equal(ChatMedia.fileKind({ type: 'video/mp4', name: 'a.mp4' }), 'video');
    assert.equal(ChatMedia.fileKind({ type: 'video/quicktime', name: 'IMG_0001.MOV' }), 'video');
    // iOS 导出常见空 mime，只能靠扩展名
    assert.equal(ChatMedia.fileKind({ type: '', name: 'IMG_0001.mov' }), 'video');
    assert.equal(ChatMedia.fileKind({ type: '', name: 'photo.JPEG' }), 'image');
    assert.equal(ChatMedia.fileKind({ type: '', name: 'clip.m4v' }), 'video');
    assert.equal(ChatMedia.fileKind({ type: 'application/pdf', name: 'a.pdf' }), 'other');
    assert.equal(ChatMedia.fileKind(null), 'other');
});

test('ACCEPT 同时覆盖图片与 MP4/MOV', () => {
    const { ChatMedia } = loadChatMedia();
    for (const t of ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']) {
        assert.ok(ChatMedia.ACCEPT.includes(t), 'ACCEPT 缺少 ' + t);
    }
});

test('assetIdsOfMessage 只收集引用，不含 data:/blob:', () => {
    const { ChatMedia } = loadChatMedia();
    assert.deepEqual(
        Array.from(ChatMedia.assetIdsOfMessage({ type: 'video', assetId: 'as_A', posterId: 'as_B' })).sort(),
        ['as_A', 'as_B']
    );
    assert.deepEqual(Array.from(ChatMedia.assetIdsOfMessage({ type: 'live_photo', img: 'data:image/jpeg;base64,xx', liveVideoId: 'as_V' })), ['as_V']);
    assert.deepEqual(Array.from(ChatMedia.assetIdsOfMessage({ type: 'image', img: 'data:image/jpeg;base64,xx' })), []);
    assert.deepEqual(Array.from(ChatMedia.assetIdsOfMessage(null)), []);
});

test('errorMessage 把配额/占用/安全上下文映射成可读文案', () => {
    const { ChatMedia } = loadChatMedia();
    assert.match(ChatMedia.errorMessage({ code: 'QUOTA_EXCEEDED' }), /空间不足/);
    assert.match(ChatMedia.errorMessage({ code: 'DB_BLOCKED' }), /占用/);
    assert.match(ChatMedia.errorMessage({ message: 'crypto.subtle.digest is unavailable' }), /https/);
});

/* ---------------- 引用计数 ---------------- */

test('releaseIfUnused：当前会话仍有引用 → 保留，不碰仓储', async () => {
    const calls = [];
    const win = loadChatMedia({ PhoneStorage: { MediaRepository: mockRepo(calls) } });
    const refs = [{ type: 'video', assetId: 'as_KEEP' }];
    const res = await win.ChatMedia.releaseIfUnused('as_KEEP', {
        ownerId: 'role-a', remainingMessages: refs, historyKey: 'chat_history_role-a'
    });
    assert.equal(res.ok, true);
    assert.equal(res.value.kept, true);
    assert.deepEqual(calls, []);
});

test('releaseIfUnused：其它会话仍引用同一 assetId → 保留', async () => {
    const calls = [];
    const ls = makeLocalStorage({ 'chat_history_role-b': JSON.stringify([{ type: 'video', assetId: 'as_SHARED' }]) });
    const win = loadChatMedia({ PhoneStorage: { MediaRepository: mockRepo(calls) }, localStorage: ls });
    const res = await win.ChatMedia.releaseIfUnused('as_SHARED', {
        ownerId: 'role-a', remainingMessages: [], historyKey: 'chat_history_role-a'
    });
    assert.equal(res.value.kept, true);
    assert.equal(res.value.reason, 'other-conversation');
    assert.deepEqual(calls, []);
});

test('releaseIfUnused：无任何引用 → 先 removeRef 再 removeAsset', async () => {
    const calls = [];
    const win = loadChatMedia({ PhoneStorage: { MediaRepository: mockRepo(calls) } });
    const res = await win.ChatMedia.releaseIfUnused('as_DROP', {
        ownerId: 'role-a', remainingMessages: [{ type: 'text', text: 'hi' }], historyKey: 'chat_history_role-a'
    });
    assert.equal(res.ok, true);
    assert.deepEqual(calls, [
        ['removeRef', 'as_DROP', 'chat', 'role-a'],
        ['removeAsset', 'as_DROP']
    ]);
});

test('releaseIfUnused：仓储未加载 → 明确失败，不抛异常', async () => {
    const win = loadChatMedia();
    const res = await win.ChatMedia.releaseIfUnused('as_DROP', { ownerId: 'role-a', remainingMessages: [] });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'DB_UNAVAILABLE');
});

test('cleanupDeletedMessages：同一 assetId 在多条被删消息里只处理一次', async () => {
    const calls = [];
    const win = loadChatMedia({ PhoneStorage: { MediaRepository: mockRepo(calls) } });
    const res = await win.ChatMedia.cleanupDeletedMessages(
        [{ type: 'video', assetId: 'as_X', posterId: 'as_P' }, { type: 'video', assetId: 'as_X', posterId: 'as_P' }],
        [], 'role-a', 'chat_history_role-a'
    );
    assert.equal(res.value.checked, 2);
    // as_X / as_P 各一次
    assert.deepEqual(calls.filter((c) => c[0] === 'removeAsset').map((c) => c[1]).sort(), ['as_P', 'as_X']);
});

/* ---------------- 接入契约（静态断言） ---------------- */

test('chat-detail.html 按依赖顺序加载仓储与 chat-media，且带版本参数', () => {
    const lines = DETAIL_SRC.split('\n');
    const idx = (needle) => lines.findIndex((l) => l.includes(needle));
    const storage = idx('phone_storage.js');
    const repo = idx('storage/repository.js');
    const mediaRepo = idx('storage/media-repository.js');
    const chatMedia = idx('js/chat-media.js');
    assert.ok(storage > -1 && repo > -1 && mediaRepo > -1 && chatMedia > -1, '脚本引用缺失');
    assert.ok(chatMedia > mediaRepo && mediaRepo > repo && repo > storage, '加载顺序不符合依赖');
    assert.match(lines[chatMedia], /chat-media\.js\?v=\d{8}v\d+/, '新增模块必须带 ?v= 版本参数');
    assert.match(DETAIL_SRC, /chat-extras\.js\?t=20261104media1/, 'chat-extras.js 需要刷新缓存版本');
});

test('sw.js 缓存版本与预缓存同步', () => {
    assert.match(SW_SRC, /CACHE_NAME\s*=\s*'phone-app-pwa-v16\d'/, 'CACHE_NAME 未升级');
    assert.match(SW_SRC, /'\.\/chat\/js\/chat-media\.js\?v=\d{8}v\d+'/, 'PRECACHE 缺少 chat-media.js');
});

test('消息写入路径不含 blob: 字面量，视频不以 data:video 入消息', () => {
    assert.equal(/['"]blob:/.test(MEDIA_SRC), false, 'chat-media.js 出现了 blob: 字面量');
    assert.equal(/['"]blob:/.test(EXTRAS_SRC), false, 'chat-extras.js 出现了 blob: 字面量');
    // 视频消息只写引用与元数据
    assert.match(EXTRAS_SRC, /type:\s*'video'[^}]*assetId/, '视频消息缺少 assetId 引用');
    assert.equal(/img:\s*['"]data:video/.test(EXTRAS_SRC), false, '不允许把视频 base64 塞进消息');
});

test('实况照片降级：无伴生视频不添加 LIVE 标识', () => {
    const start = MEDIA_SRC.indexOf('function buildLiveBubble');
    assert.ok(start > -1, 'buildLiveBubble 缺失');
    const body = MEDIA_SRC.slice(start, MEDIA_SRC.indexOf('function releaseIfUnused'));
    const earlyReturn = body.indexOf('if (!msg.liveVideoId)');
    const tagCreate = body.indexOf("tag.className = 'mv-live-tag'");
    assert.ok(earlyReturn > -1, '缺少无伴生视频的提前返回');
    assert.ok(earlyReturn < tagCreate, 'LIVE 标识必须在无伴生视频分支之前被跳过');
});

test('关键帧提取仅为预留接口，未在本次自动调用', () => {
    assert.match(MEDIA_SRC, /extractKeyFrames:\s*extractKeyFrames/, '未导出预留接口');
    assert.equal(EXTRAS_SRC.includes('extractKeyFrames('), false, 'chat-extras 不得调用关键帧提取');
    assert.equal(DETAIL_SRC.includes('extractKeyFrames('), false, 'chat-detail 不得调用关键帧提取');
});

test('保护范围内的文件未被本次改动触碰', () => {
    const protectedFiles = [
        'settings/js/backup.js',
        'shared/js/phone/phone_storage.js',
        'shared/js/phone/storage/repository.js',
        'shared/js/phone/storage/media-repository.js',
        'diary/diary.html',
        'library/library.html',
        'music/music.html',
        'poster/poster.html',
        'shared/js/wallpaper-store.js'
    ];
    for (const rel of protectedFiles) {
        const src = read(rel);
        assert.equal(/ChatMedia|chat-media/.test(src), false, rel + ' 被意外修改');
    }
});

test('新增样式遵循视觉与滚动条约束', () => {
    assert.match(MEDIA_SRC, /setAttribute\('stroke-width',\s*'1\.5'\)/, '播放图标必须是 1.5px 细线');
    assert.match(DETAIL_SRC, /\.cm-sheet::-webkit-scrollbar\{display:none\}/, '预览层必须隐藏滚动条');
    assert.match(DETAIL_SRC, /\.msg-video\{[^}]*width/, '.msg-video 宽度约束缺失');
    assert.match(DETAIL_SRC, /\.cm-sheet\{[^}]*border-radius:8px 8px 0 0/, '预览层圆角不得超过 8px');
});
