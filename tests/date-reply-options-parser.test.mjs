import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Run the actual in-page parser without executing the rest of the offline UI.
const page = readFileSync(new URL('../chat/date/date.html', import.meta.url), 'utf8');
const begin = page.indexOf('    function parseReplyOptions(rawText, expectedStyles) {');
const end = page.indexOf('    function renderReplyOptions(options) {', begin);
assert.ok(begin >= 0 && end > begin, 'Offline response parser is present');
const shared = readFileSync(new URL('../shared/js/phone/ai-response-parser.js', import.meta.url), 'utf8');
const window = {};
runInNewContext(shared, { window });
const parse = runInNewContext(page.slice(begin, end) + '\nparseReplyOptions;', { window });
const styles = [{ name: '平静' }, { name: '随性' }, { name: '简短' }];
const fence = String.fromCharCode(96).repeat(3);

const cases = [
    ['single object', '{"text":"单独一句","style":"自定"}', '单独一句'],
    ['options array', '{"options":[{"text":"第一句"},{"text":"第二句"}]}', '第一句'],
    ['replies array', '{"replies":[{"reply":"其他字段"}]}', '其他字段'],
    ['choices array', '{"choices":[{"content":"选项"}]}', '选项'],
    ['top-level array', '[{"text":"数组"}]', '数组'],
    ['string array', '["纯字符串"]', '纯字符串'],
    ['markdown fence', fence + 'json\n{"options":[{"text":"围栏"}]}\n' + fence, '围栏'],
    ['mixed explanation and fence', '说明\n' + fence + 'json\n{"text":"成功"}\n' + fence + '\n其他文字', '成功'],
    ['braces inside JSON strings', '说明: {"text":"包含{大括号}"} 结尾', '包含{大括号}'],
    ['several JSON objects', '{"broken":true} 还有 {"text":"能识别的第二段"}', '能识别的第二段'],
    ['plain markdown text', '**你好**，今天怎么样', '你好，今天怎么样'],
    ['heading and list markdown', '# 标题\n- 第一段\n- 第二段', '标题\n第一段\n第二段'],
    ['malformed JSON fallback', '{"text":不合法}', '{"text":不合法}'],
    ['empty response fallback', '', '模型未返回可用文本，请重试。'],
    ['unrecognized JSON fallback', '{"unknown":"值"}', '{"unknown":"值"}']
];

for (const [name, input, expected] of cases) {
    test('offline reply-options parser: ' + name, () => {
        const options = parse(input, styles);
        assert.ok(Array.isArray(options) && options.length >= 1, 'must retain a visible option');
        assert.equal(options[0].text, expected);
    });
}

test('offline reply-options parser retains selected style and count cap', () => {
    const single = parse('{"text":"内容","style":"自定"}', styles);
    assert.equal(single[0].style, '自定');
    const multiple = parse('{"options":[{"text":"1"},{"text":"2"},{"text":"3"},{"text":"4"}]}', styles);
    assert.equal(multiple.length, styles.length);
    assert.equal(multiple[0].style, '平静');
});

test('offline reply-options parser preserves legacy text length limit', () => {
    const result = parse(JSON.stringify({ text: '甲'.repeat(2000) }), styles);
    assert.equal(result[0].text.length, 1400);
});
