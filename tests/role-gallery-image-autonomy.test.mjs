import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const source = readFileSync(
    resolve(process.cwd(), 'shared/js/phone/role-gallery-image-autonomy.js'),
    'utf8'
);

function load(options = {}) {
    const roles = options.roles || [{ id: 'role-a' }, { id: 'role-b' }];
    const records = options.records || {
        'role-a': [
            { id: 'image-a1', assetId: 'asset-a1', sceneDescription: '海边傍晚', isPrivate: true },
            { id: 'image-a2', assetId: 'asset-a2', sceneDescription: '雨天咖啡馆', isPrivate: false },
            { id: 'image-a3', assetId: 'asset-a3', sceneDescription: '窗边的书', isPrivate: true },
            { id: 'image-a4', assetId: 'asset-a4', sceneDescription: '海边散步', isPrivate: false },
            { id: 'image-a5', assetId: 'asset-a5', sceneDescription: '清晨早餐', isPrivate: false }
        ],
        'role-b': [
            { id: 'image-b1', assetId: 'asset-b1', sceneDescription: '夜晚街道', isPrivate: true }
        ]
    };
    const calls = { added: [], removed: [], assetsRemoved: [], list: [], get: [] };
    const media = {
        async addRef(assetId, ownerType, ownerId) {
            calls.added.push({ assetId, ownerType, ownerId });
            return options.failAddRef ? { ok: false } : { ok: true };
        },
        async removeRef(assetId, ownerType, ownerId) {
            calls.removed.push({ assetId, ownerType, ownerId });
            return { ok: true, value: { removed: true } };
        },
        async removeAsset(assetId) {
            calls.assetsRemoved.push(assetId);
            return { ok: true };
        }
    };
    class MediaRepository {
        constructor() { return media; }
    }
    class ImageRepository {
        async listByCharacter(characterId, scope) {
            calls.list.push({ characterId, scope });
            if (options.failList) throw new Error('gallery unavailable');
            return { ok: true, value: records[String(characterId)] || [] };
        }
        async get(imageId) {
            calls.get.push(String(imageId));
            if (options.failGet) return { ok: false };
            const found = Object.entries(records).flatMap(([characterId, items]) =>
                items.map(item => ({ ownerCharacterId: characterId, item }))
            ).find(entry => String(entry.item.id) === String(imageId));
            if (!found) return { ok: false };
            const next = Object.assign({ characterId: found.ownerCharacterId }, found.item);
            if (options.privacyOverrides && Object.prototype.hasOwnProperty.call(options.privacyOverrides, imageId)) {
                next.isPrivate = options.privacyOverrides[imageId];
            }
            if (options.characterOverrides && Object.prototype.hasOwnProperty.call(options.characterOverrides, imageId)) {
                next.characterId = options.characterOverrides[imageId];
            }
            return { ok: true, value: next };
        }
    }
    const window = {
        PhoneStorage: {
            getCharacters: () => roles,
            MediaRepository,
            ImageRepository
        }
    };
    runInNewContext(source, { window, Date, Math, Promise, Object, String, Array, RegExp });
    return { api: window.RoleGalleryImageAutonomy, calls };
}

test('gallery catalogue is scoped to the active character and hides asset identifiers', async () => {
    const { api, calls } = load();
    const a = await api.prepare('role-a');
    const b = await api.prepare('role-b');

    assert.deepEqual(Array.from(a.images, item => item.id), ['image-a2', 'image-a4', 'image-a5']);
    assert.deepEqual(Array.from(b.images, item => item.id), []);
    assert.match(a.prompt, /image-a2/);
    assert.doesNotMatch(a.prompt, /image-a1|image-a3|asset-a2|image-b1/);
    assert.match(b.prompt, /没有可发送图片/);
    assert.doesNotMatch(b.prompt, /image-b1|asset-b1/);
    assert.deepEqual(calls.list, [
        { characterId: 'role-a', scope: 'public' },
        { characterId: 'role-b', scope: 'public' }
    ]);
});

test('only exact gallery IDs become attachments; invented and cross-character markers are stripped', async () => {
    const { api } = load();
    const catalogue = await api.prepare('role-a');
    const parsed = api.extractMarkers(
        '看这张。 [[MAOMAO_IMAGE:image-a1]] [[MAOMAO_IMAGE:image-a2]] [[MAOMAO_IMAGE:image-b1]] [[MAOMAO_IMAGE:invented]]',
        catalogue
    );

    assert.equal(parsed.text, '看这张。');
    assert.deepEqual(Array.from(parsed.attachments, item => item.item.id), ['image-a2']);
});

test('duplicate markers are deduplicated and each reply is capped at two images', async () => {
    const { api } = load();
    const catalogue = await api.prepare('role-a');
    const parsed = api.extractMarkers(
        '[[MAOMAO_IMAGE:image-a2]] [[MAOMAO_IMAGE:image-a2]] [[MAOMAO_IMAGE:image-a4]] [[MAOMAO_IMAGE:image-a5]]',
        catalogue
    );

    assert.deepEqual(Array.from(parsed.attachments, item => item.item.id), ['image-a2', 'image-a4']);
});

test('a selected gallery image receives a chat-message reference using the message mid', async () => {
    const { api, calls } = load();
    const catalogue = await api.prepare('role-a');
    const parsed = api.extractMarkers('[[MAOMAO_IMAGE:image-a2]]', catalogue);
    const messages = await api.createMessages('role-a', parsed.attachments);

    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'assistant');
    assert.equal(messages[0].type, 'image');
    assert.equal(messages[0].assetId, 'asset-a2');
    assert.equal(messages[0].imageRecordId, 'image-a2');
    assert.equal(messages[0].isPrivate, false);
    assert.equal(messages[0].characterId, 'role-a');
    assert.equal(calls.added.length, 1);
    assert.deepEqual(calls.get, ['image-a2']);
    assert.equal(calls.added[0].ownerType, 'chat-message');
    assert.equal(calls.added[0].ownerId, messages[0].mid);
});

test('failed reference creation never emits an orphan image message', async () => {
    const { api } = load({ failAddRef: true });
    const catalogue = await api.prepare('role-a');
    const parsed = api.extractMarkers('[[MAOMAO_IMAGE:image-a2]]', catalogue);
    const messages = await api.createMessages('role-a', parsed.attachments);

    assert.equal(messages.length, 0);
});

test('rollback releases only the message reference and preserves the gallery asset', async () => {
    const { api, calls } = load();
    const catalogue = await api.prepare('role-a');
    const parsed = api.extractMarkers('[[MAOMAO_IMAGE:image-a2]]', catalogue);
    const messages = await api.createMessages('role-a', parsed.attachments);
    await api.releaseReferences(messages);

    assert.deepEqual(calls.removed, [{
        assetId: 'asset-a1',
        ownerType: 'chat-message',
        ownerId: messages[0].mid
    }]);
    assert.deepEqual(calls.assetsRemoved, []);
});

test('a private flag changed after prompt preparation prevents sending the stale candidate', async () => {
    const { api, calls } = load({ privacyOverrides: { 'image-a2': true } });
    const catalogue = await api.prepare('role-a');
    const parsed = api.extractMarkers('[[MAOMAO_IMAGE:image-a2]]', catalogue);
    assert.equal(parsed.attachments.length, 1, 'catalogue was public at selection time');
    const messages = await api.createMessages('role-a', parsed.attachments);
    assert.equal(messages.length, 0);
    assert.equal(calls.added.length, 0, 'privacy is rechecked immediately before creating the chat reference');
});

test('forged private and cross-role image candidates are rejected before media references are created', async () => {
    const { api, calls } = load();
    const messages = await api.createMessages('role-a', [
        { type: 'image', item: { id: 'image-a1', assetId: 'asset-a1', characterId: 'role-a', isPrivate: false } },
        { type: 'image', item: { id: 'image-b1', assetId: 'asset-b1', characterId: 'role-a', isPrivate: false } }
    ]);
    assert.equal(messages.length, 0);
    assert.equal(calls.added.length, 0);
});

test('stream marker stripping removes complete and incomplete gallery markers from previews', () => {
    const { api } = load();
    assert.equal(api.stripStreamMarker('你好 [[MAOMAO_IMAGE:image-a2]]'), '你好 ');
    assert.equal(api.stripStreamMarker('你好 [[MAOMAO_IMAGE:ima'), '你好 ');
});

test('missing roles and gallery errors fail closed without preventing text replies', async () => {
    const missingRole = load({ roles: [{ id: 'other' }] });
    const missing = await missingRole.api.prepare('role-a');
    assert.equal(missing.prompt, '');
    assert.equal(missing.images.length, 0);

    const unavailable = load({ failList: true });
    const catalogue = await unavailable.api.prepare('role-a');
    assert.equal(catalogue.images.length, 0);
    const parsed = unavailable.api.extractMarkers('普通文字 [[MAOMAO_IMAGE:unknown]]', catalogue);
    assert.equal(parsed.text, '普通文字');
    assert.equal(parsed.attachments.length, 0);
});
