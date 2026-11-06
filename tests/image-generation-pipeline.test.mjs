import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = process.cwd();
const serviceSource = readFileSync(resolve(root, 'shared/js/phone/image-generation.js'), 'utf8');
const mediaSource = readFileSync(resolve(root, 'shared/js/phone/storage/media-repository.js'), 'utf8');
const backupSource = readFileSync(resolve(root, 'settings/js/backup.js'), 'utf8');
const settingsSource = readFileSync(resolve(root, 'settings/settings.html'), 'utf8');
const imagePageSource = readFileSync(resolve(root, 'settings/image-generation.html'), 'utf8');
const chatSource = readFileSync(resolve(root, 'chat/chat/chat-detail.html'), 'utf8');

const ASSET_ID = 'as_ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function loadService(options = {}) {
    const calls = { complete: [], generate: [], putBlob: [], addRef: [], saveRecord: [], cleanup: [] };
    const role = options.role || {
        id: 'character_01',
        name: 'Mao',
        appearanceDescription: 'silver short hair, amber eyes, a small silver hoop earring',
        styleKeywords: ['anime', 'soft lighting']
    };
    const recordStore = [];
    const blob = new Blob(['mock-image-bytes'], { type: 'image/png' });

    const media = {
        async putBlob(value, meta) {
            calls.putBlob.push({ value, meta });
            return { ok: true, value: { assetId: ASSET_ID, size: value.size, reused: false } };
        },
        async addRef(assetId, ownerType, ownerId) {
            calls.addRef.push({ assetId, ownerType, ownerId });
            return options.addRefFailure
                ? { ok: false, error: { code: 'DB_UNAVAILABLE', message: 'reference unavailable' } }
                : { ok: true, value: { assetId, ownerType, ownerId } };
        },
        async removeRef(assetId, ownerType, ownerId) {
            calls.cleanup.push({ kind: 'removeRef', assetId, ownerType, ownerId });
            return { ok: true };
        },
        async removeAsset(assetId) {
            calls.cleanup.push({ kind: 'removeAsset', assetId });
            return { ok: true };
        }
    };
    const images = {
        async save(record) {
            calls.saveRecord.push(record);
            if (options.saveFailure) return { ok: false, error: { message: 'write failed' } };
            recordStore.push(record);
            return { ok: true, value: record };
        }
    };

    class MediaRepository { constructor() { return media; } }
    class ImageRepository { constructor() { return images; } }
    const storage = {
        getCharacters: () => [role],
        getApiConfig: () => ({ apiKey: 'test-key', imageModel: 'test-image-model' }),
        MediaRepository,
        ImageRepository
    };
    const api = {
        async complete(request) {
            calls.complete.push(request);
            return options.sceneResult || 'A quiet cafe by the window at dusk, warm reflections on the table, candid portrait framing.';
        },
        async generateImage(request) {
            calls.generate.push(request);
            return { blob, mimeType: 'image/png' };
        }
    };

    const window = { PhoneStorage: storage, PhoneAPI: api };
    runInNewContext(serviceSource, { window, Date, Math, Promise, console });
    return { service: window.PhoneImageGeneration, calls, role, recordStore, blob };
}

test('generate uses fixed role appearance, style, conversation context and saves a private image record', async () => {
    const { service, calls, recordStore, blob } = loadService();
    const result = await service.generate({
        characterId: 'character_01',
        sceneHint: 'sitting near a cafe window after work',
        conversationContext: 'User: Are you still at the cafe?\nMao: I am by the window.',
        chatMessageId: 'message_001'
    });

    assert.equal(calls.complete.length, 1);
    assert.match(calls.complete[0].user, /silver short hair, amber eyes/);
    assert.match(calls.complete[0].user, /sitting near a cafe window/);
    assert.match(calls.complete[0].user, /Mao: I am by the window/);
    assert.equal(calls.generate.length, 1);
    assert.match(calls.generate[0].prompt, /silver short hair, amber eyes/);
    assert.match(calls.generate[0].prompt, /anime, soft lighting/);
    assert.match(calls.generate[0].prompt, /quiet cafe by the window at dusk/);
    assert.equal(calls.putBlob[0].value, blob);
    assert.equal(calls.putBlob[0].meta.ownerType, 'generated-image');
    assert.equal(calls.saveRecord.length, 1);
    assert.equal(recordStore.length, 1);
    assert.equal(recordStore[0].assetId, ASSET_ID);
    assert.equal(recordStore[0].characterId, 'character_01');
    assert.equal(recordStore[0].isPrivate, true);
    assert.equal(result.chatReferenceAdded, true);
    assert.equal(calls.addRef[0].ownerType, 'chat-message');
    assert.equal(calls.addRef[0].ownerId, 'character_01:message_001');
});

test('generate can explicitly save a public gallery record', async () => {
    const { service, recordStore } = loadService();
    const result = await service.generate({
        characterId: 'character_01',
        sceneHint: 'a quiet garden',
        isPrivate: false
    });
    assert.equal(result.record.isPrivate, false);
    assert.equal(recordStore[0].isPrivate, false);
});

test('generation stops before either API call when a role has no stable appearance description', async () => {
    const { service, calls } = loadService({ role: { id: 'character_01', name: 'Mao' } });
    await assert.rejects(
        service.generate({ characterId: 'character_01', sceneHint: 'a cafe' }),
        /固定的外貌描述|外貌描述/
    );
    assert.equal(calls.complete.length, 0);
    assert.equal(calls.generate.length, 0);
    assert.equal(calls.putBlob.length, 0);
});

test('if the image metadata write fails, the media asset reference is cleaned up', async () => {
    const { service, calls } = loadService({ saveFailure: true });
    await assert.rejects(
        service.generate({ characterId: 'character_01', sceneHint: 'a cafe' }),
        /图库记录保存失败/
    );
    assert.deepEqual(calls.cleanup.map(item => item.kind), ['removeRef', 'removeAsset']);
});

test('chat reference failure does not create a chat message attachment', async () => {
    const { service, calls } = loadService({ addRefFailure: true });
    const result = await service.generate({
        characterId: 'character_01',
        sceneHint: 'a cafe',
        chatMessageId: 'message_002'
    });
    assert.equal(result.chatReferenceAdded, false);
    assert.equal(result.record.chatReferenceWarning, true);
    assert.equal(calls.saveRecord.length, 1, 'the image remains safely available in its gallery');
});

test('settings, backup, and chat are connected to the assetId-based image record contract', () => {
    assert.match(settingsSource, /image-generation\.html/);
    assert.match(imagePageSource, /角色图库/);
    assert.match(imagePageSource, /data-filter="private"/);
    assert.match(mediaSource, /var DB_VERSION = 2/);
    assert.match(mediaSource, /IMAGES: 'image_records'/);
    assert.match(backupSource, /db: 'maomao-assets',[\s\S]*?version: 2,[\s\S]*?store: 'image_records'/);
    assert.match(chatSource, /type: 'image-pending'/);
    assert.ok(chatSource.includes("match(/^\\/photo"), 'the chat trigger is the explicit /photo command');
    assert.match(chatSource, /assetId: result\.assetId/);
    assert.match(chatSource, /resolveGeneratedImage\(bubble, String\(msg\.assetId\)/);
    assert.match(chatSource, /image-action-button/);
    assert.match(chatSource, /maomao-character-image\.png/);
});
