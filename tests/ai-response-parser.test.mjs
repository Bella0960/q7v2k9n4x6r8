import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../shared/js/phone/ai-response-parser.js', import.meta.url), 'utf8');
const root = {};
runInNewContext(source, { window: root });
const parser = root.AIResponseParser;

test('shared parser exposes three contract-specific entrypoints', () => {
    assert.equal(typeof parser.parseJSON, 'function');
    assert.equal(typeof parser.replyOptions, 'function');
    assert.equal(typeof parser.chatText, 'function');
});

const FENCE = String.fromCharCode(96).repeat(3);
const styles = [{ name: '平静' }, { name: '随性' }, { name: '简短' }];

for (const [name, input, expected] of [
    ['single object', '{"text":"单条回复","style":"自定"}', '单条回复'],
    ['options array', '{"options":[{"text":"第一"},{"text":"第二"}]}', '第一'],
    ['replies', '{"replies":[{"reply":"第二种"}]}', '第二种'],
    ['choices', '{"choices":[{"content":"第三种"}]}', '第三种'],
    ['string array', '["你好"]', '你好'],
    ['fenced', FENCE + 'json\n{"text":"围栏"}\n' + FENCE, '围栏'],
    ['mixed explanation', '说明如下\n' + FENCE + 'json\n{"text":"提取内容"}\n' + FENCE + '\n结束', '提取内容'],
    ['nested brackets', '回复：{"text":"今天 [继续] {走吧}"} 结束', '今天 [继续] {走吧}'],
    ['multiple objects', '{"irrelevant":true} 然后 {"text":"有效"}', '有效'],
    ['Markdown fallback', '**你好**，你今天怎么样？', '你好，你今天怎么样？'],
    ['paragraph fallback', '# 标题\n- 第一段\n- 第二段', '标题\n第一段\n第二段'],
    ['malformed JSON fallback', '{"text":不合法}', '{"text":不合法}'],
    ['empty fallback', '', '模型未返回可用文本，请重试。']
]) {
    test('shared reply-options: ' + name, () => {
        const actual = parser.replyOptions(input, styles);
        assert.ok(Array.isArray(actual) && actual.length >= 1);
        assert.equal(actual[0].text, expected);
    });
}

test('shared options retain style, select count and character limit', () => {
    const actual = parser.replyOptions(JSON.stringify({
        options: [{ text: '甲'.repeat(2000), style: '自定义' }, { text: '乙' }, { text: '丙' }, { text: '丁' }]
    }), styles);
    assert.equal(actual.length, 3);
    assert.equal(actual[0].style, '自定义');
    assert.equal(actual[0].text.length, 1400);
});

test('shared parseJSON returns strict failure instead of fabricating business records', () => {
    const result = parser.parseJSON('这是一段普通文字');
    assert.equal(result.ok, false);
    assert.equal(result.data, null);
    const invalid = parser.parseJSON('说明：{"not":"a valid option"}', value => Array.isArray(value.options));
    assert.equal(invalid.ok, false);
});

test('shared parseJSON extracts valid nested data without greedy bracket slicing', () => {
    const raw = '解释 {"broken":true} 中间 ' + FENCE + 'json\n' +
        '{"posts":[{"text":"包含 } 和 ] 标记"}]}' + '\n' + FENCE + ' 尾声';
    const result = parser.parseJSON(raw, value => !!value.posts);
    assert.equal(result.ok, true);
    assert.equal(result.data.posts[0].text, '包含 } 和 ] 标记');
});

test('chatText unwraps single structured chat object, preserving invisible markers', () => {
    const raw = '{"text":"<narratage>回头</narratage>在吗？\\n\\n我有话说。 [记住:早睡]"}';
    const out = parser.chatText(raw);
    assert.equal(out, '<narratage>回头</narratage>在吗？\n\n我有话说。 [记住:早睡]');
});

test('chatText unwraps structured multi-bubble array, without imposing bubble caps', () => {
    const raw = JSON.stringify({ replies: [{ text: '第一条' }, { text: '第二条' }, { text: '第三条' }] });
    assert.equal(parser.chatText(raw), '第一条\n\n第二条\n\n第三条');
});

test('chatText leaves normal prose, Markdown, inline JSON and half-complete stream unchanged', () => {
    const texts = [
        '正常对白\n\n第二条对白',
        '**加粗**的自然语言',
        '这是示例 JSON：{"text":"内容"}，请别把它改掉。',
        '<narratage>坐下</narratage>我到了。',
        '{"text":"流式半包',
        ''
    ];
    for (const raw of texts) assert.equal(parser.chatText(raw), raw);
});

test('chatText does not turn malformed provider output or unrelated object into a success', () => {
    for (const raw of ['{"error":"bad request"}', '{"unknown":23}', '[]']) {
        assert.equal(parser.chatText(raw), raw);
    }
});


test('all relevant PhoneAPI page imports load the shared adapter before phone_api.js', () => {
    const pages = [
        'chat/chat/chat-detail.html', 'chat/moments/moments.html',
        'chat/footprint/footprint.html', 'chat/shake/shake.html',
        'games/cooking.html', 'cafe/cafe.html', 'wallet/finance.html',
        'forum/forum.html', 'forum/forum-detail.html', 'diary/diary.html',
        'games/games.html', 'library/library.html',
        'settings/image-generation.html', 'inspect-phone/phone.html',
        'envelope/envelope.html'
    ];
    for (const path of pages) {
        const page = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
        const shared = page.indexOf('ai-response-parser.js?v=20261120parser1');
        const api = page.indexOf('phone_api.js');
        assert.ok(shared >= 0 && api > shared, path + ' must load the shared adapter first');
    }
});

test('model reply paths share one adapter without migrating stored history', () => {
    const chat = readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');
    const date = readFileSync(new URL('../chat/date/date.html', import.meta.url), 'utf8');
    const journey = readFileSync(new URL('../chat/date/journey.html', import.meta.url), 'utf8');
    const api = readFileSync(new URL('../shared/js/phone/phone_api.js', import.meta.url), 'utf8');
    const notifier = readFileSync(new URL('../shared/js/chat-notifier.js', import.meta.url), 'utf8');
    assert.match(chat, /fullText = window\.AIResponseParser\.chatText\(fullText\)/);
    assert.match(date, /window\.AIResponseParser\.replyOptions\(rawText, expectedStyles\)/);
    assert.match(journey, /window\.AIResponseParser\.parseJSON\(raw,/);
    assert.match(api, /global\.AIResponseParser\.parseJSON\(raw\)/);
    assert.match(notifier, /ai-response-parser\.js\?v=20261120parser1/);
    assert.match(chat, /parseReplyContent\(raw, 'legacy'\)/);
    assert.match(chat, /sendMsg\(\{ isRegenerate: true/);
    assert.match(chat, /removeTurnFromHistory\(historyList, regenTargetId\)/);
});

test('PhoneAPI.completeJSON uses the shared parser but does not accept prose as business data', async () => {
    const code = readFileSync(new URL('../shared/js/phone/phone_api.js', import.meta.url), 'utf8');
    let responseText = '说明如下：{"items":[{"id":1}]} 多余文字';
    const fake = {
        AIResponseParser: parser,
        PhoneStorage: {
            getApiConfig() { return { apiKey: 'synthetic-only', baseUrl: 'https://example.invalid/v1', model: 'test' }; },
            pushApiLog() {}
        }
    };
    const ctx = {
        window: fake,
        AbortController,
        setTimeout,
        clearTimeout,
        URL,
        console,
        fetch: async () => ({
            ok: true,
            json: async () => ({ choices: [{ message: { content: responseText } }] })
        })
    };
    runInNewContext(code, ctx);
    const good = await fake.PhoneAPI.completeJSON({ user: 'synthetic example' });
    assert.equal(good.ok, true);
    assert.equal(good.data.items[0].id, 1);
    responseText = 'this is just text';
    const bad = await fake.PhoneAPI.completeJSON({ user: 'synthetic example' });
    assert.equal(bad.ok, false);
    assert.equal(bad.data, null);
});
