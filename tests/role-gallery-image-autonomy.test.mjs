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
            { id: 'image-private', assetId: 'asset-private', sceneDescription: '私密场景', isPrivate: true },
            { id: 'image-legacy', assetId: 'asset-legacy', sceneDescription: '旧私密场景' },
            { id: 'image-a1', assetId: 'asset-a1', sceneDescription: '海边傍晚', isPrivate: false },
            { id: 'image-a2', assetId: 'asset-a2', sceneDescription: '雨天咖啡馆', isPrivate: false },
            { id: 'image-a3', assetId: 'asset-a3', sceneDescription: '窗边的书', isPrivate: false }
        ],
        'role-b': [
            { id: 'image-b1', assetId: 'asset-b1', sceneDescription: '夜晚街道', isPrivate: false }
        ]
    };
    const calls = { added: [], removed: [], assetsRemoved: [], list: [] };
    const media = {
        async addRef(assetId, ownerType, ownerId) {
            calls.added.push({ assetId, ownerType, ownerId });
            return options.failAddRef ? { ok: false } : { ok: true };
        },
        async removeRef(assetId, ownerType, ownerId) {
            calls.removed.push({ assetId, ownerType, ownerId });
            return { ok: true, value: { removed: true, refCount: 1 } };
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
            for (const [characterId, images] of Object.entries(records)) {
                const image = images.find(item => item.id === imageId);
                if (image) {
                    return { ok: true, value: {
                        ...image, characterId, ...options.latestRecords?.[imageId]
                    } };
                }
            }
            return { ok: false };
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

    assert.deepEqual(Array.from(a.images, item => item.id), ['image-a1', 'image-a2', 'image-a3']);
    assert.deepEqual(Array.from(b.images, item => item.id), ['image-b1']);
    assert.match(a.prompt, /image-a1/);
    assert.doesNotMatch(a.prompt, /asset-a1|image-b1|image-private|image-legacy|私密场景/);
    assert.match(b.prompt, /image-b1/);
    assert.doesNotMatch(b.prompt, /asset-b1|image-a1/);
    assert.deepEqual(calls.list, [
        { characterId: 'role-a', scope: 'public' },
        { characterId: 'role-b', scope: 'public' }
    ]);
});

test('only exact gallery IDs become attachments; invented and cross-character markers are stripped', async () => {
    const { api } = load();
    const catalogue = await api.prepare('role-a');
    const parsed = api.extractMarkers(
        '看这张。 [[MAOMAO_IMAGE:image-a1]] [[MAOMAO_IMAGE:image-b1]] [[MAOMAO_IMAGE:image-private]] [[MAOMAO_IMAGE:invented]]',
        catalogue
    );

    assert.equal(parsed.text, '看这张。');
    assert.deepEqual(Array.from(parsed.attachments, item => item.item.id), ['image-a1']);
});

test('duplicate markers are deduplicated and each reply is capped at two images', async () => {
    const { api } = load();
    const catalogue = await api.prepare('role-a');
    const parsed = api.extractMarkers(
        '[[MAOMAO_IMAGE:image-a1]] [[MAOMAO_IMAGE:image-a1]] [[MAOMAO_IMAGE:image-a2]] [[MAOMAO_IMAGE:image-a3]]',
        catalogue
    );

    assert.deepEqual(Array.from(parsed.attachments, item => item.item.id), ['image-a1', 'image-a2']);
});

test('a selected gallery image receives a chat-message reference using the message mid', async () => {
    const { api, calls } = load();
    const catalogue = await api.prepare('role-a');
    const parsed = api.extractMarkers('[[MAOMAO_IMAGE:image-a1]]', catalogue);
    const messages = await api.createMessages('role-a', parsed.attachments);

    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'assistant');
    assert.equal(messages[0].type, 'image');
    assert.equal(messages[0].assetId, 'asset-a1');
    assert.equal(messages[0].imageRecordId, 'image-a1');
    assert.equal(messages[0].characterId, 'role-a');
    assert.equal(calls.added.length, 1);
    assert.equal(calls.added[0].ownerType, 'chat-message');
    assert.equal(calls.added[0].ownerId, messages[0].mid);
});

test('failed reference creation never emits an orphan image message', async () => {
    const { api } = load({ failAddRef: true });
    const catalogue = await api.prepare('role-a');
    const parsed = api.extractMarkers('[[MAOMAO_IMAGE:image-a1]]', catalogue);
    const messages = await api.createMessages('role-a', parsed.attachments);

    assert.equal(messages.length, 0);
});

test('rollback releases only the message reference and preserves the gallery asset', async () => {
    const { api, calls } = load();
    const catalogue = await api.prepare('role-a');
    const parsed = api.extractMarkers('[[MAOMAO_IMAGE:image-a1]]', catalogue);
    const messages = await api.createMessages('role-a', parsed.attachments);
    await api.releaseReferences(messages);

    assert.deepEqual(calls.removed, [{
        assetId: 'asset-a1',
        ownerType: 'chat-message',
        ownerId: messages[0].mid
    }]);
    assert.deepEqual(calls.assetsRemoved, []);
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

test('a gallery image made private during generation cannot become a chat attachment', async () => {
    const { api, calls } = load({ latestRecords: { 'image-a1': { isPrivate: true } } });
    const catalogue = await api.prepare('role-a');
    const { attachments } = api.extractMarkers('[[MAOMAO_IMAGE:image-a1]]', catalogue);
    assert.equal(attachments.length, 1);

    assert.deepEqual(Array.from(await api.createMessages('role-a', attachments)), []);
    assert.deepEqual(calls.added, []);
});

test('an attachment selected for one role cannot be linked in another role', async () => {
    const { api, calls } = load();
    const catalogue = await api.prepare('role-a');
    const { attachments } = api.extractMarkers('[[MAOMAO_IMAGE:image-a1]]', catalogue);

    assert.deepEqual(Array.from(await api.createMessages('role-b', attachments)), []);
    assert.deepEqual(calls.added, []);
});
