import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const page = readFileSync(fileURLToPath(new URL('../chat/chat/chat-detail.html', import.meta.url)), 'utf8');
const inlineScripts = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const main = inlineScripts.find(source => source.includes('async function sendMsg(opts)'));
const continuation = inlineScripts.find(source => source.includes('manualContinue:true'));

test('CHAT-MIC-001: existing input control is a two-star continuation button', () => {
  assert.match(page, /id="voice-input-btn"[^>]*data-action="continue-chat"[^>]*aria-label="继续聊天"/);
  assert.match(page, /M9 2\.8 10\.8 8\.2/);
  assert.doesNotMatch(page, /id="maomao-voice-input"/);
  assert.doesNotMatch(page, /SpeechRecognitionCtor|voiceSvg\.innerHTML/);
});

test('CHAT-MIC-001: direct and group continuation reuse sendMsg without saving a user message', () => {
  assert.ok(main);
  assert.ok(continuation);
  assert.match(continuation, /sendMsg\(\{contextOnly:true,manualContinue:true\}\)/);
  assert.match(main, /const text = isManualContinue \? '' : sendState\.text/);
  assert.match(main, /sendState\.isGroupFollowup \|\| \(isManualContinue && isGroupChat\)/);
  assert.match(main, /buildReplyMessages\(fullText, replyBubbleMode,/);
  assert.match(main, /manualContinue: isManualContinue/);
  assert.match(main, /const continuationCue = isGroupChat/);
  assert.match(main, /isManualContinue && isBlocked\(aliasRoleId\)/);
  assert.match(main, /isManualContinue && isGroupChat && \(!currentGroup \|\| !getAvailableGroupMembers\(\)\.length\)/);
});

test('CHAT-REPLY-UX-001: direct continuation uses the single header state and no temporary message fragments', () => {
  assert.match(main, /setSingleChatTyping\(true\);[\s\S]*?await sendMsgTurn\(opts\);[\s\S]*?finally\s*\{[\s\S]*?setSingleChatTyping\(false\);/);
  assert.match(main, /if \(isGroupChat && !isManualContinue && chatTitleEl\)/);
  assert.doesNotMatch(main, /statusDiv|loading-dots|document\.getElementById\(statusId\)/, 'typing status must not create timeline placeholders');
  assert.match(main, /if \(isManualContinue\) return;[\s\S]*?if \(!tmpText\) return;/);
  assert.match(main, /if \(naturalOnlineBubbles && replyBubbleMode !== 'single'\) return;/);
  assert.match(main, /const replyBubbleMode = getActiveReplyBubbleMode\(!naturalOnlineBubbles\)/);
  assert.match(continuation, /btn\.disabled=true/);
  assert.match(continuation, /\.finally\(function\(\)\{[\s\S]*?btn\.disabled=false/);
  assert.match(page, /data-presence="online"[^>]*aria-live="polite"/);
  assert.match(page, /\[data-presence="online"\]::before\{[^}]*background:#42b96b/);
});

test('CHAT-MIC-001: changed inline scripts are syntactically valid', () => {
  assert.ok(main && continuation);
  assert.doesNotThrow(() => new Script(main, { filename: 'chat-detail main inline script' }));
  assert.doesNotThrow(() => new Script(continuation, { filename: 'chat-detail continuation inline script' }));
});


test('CHAT-REPLY-UX-001: composer plus control has no legacy left separator', () => {
  const composerRules = [...page.matchAll(/\.plus-action-btn\s*\{([^}]+)\}/g)].map(match => match[1]);
  assert.ok(composerRules.some(rule => /border-left:\s*0;/.test(rule)));
  assert.ok(composerRules.every(rule => !/border-left:\s*1px\b/.test(rule)), 'old left border must not remain');
  assert.match(page, /id="plus-action-btn"[^>]*aria-label="更多功能"/);
});


test('CHAT-REPLY-UX-001: resolve presence mode before the natural reply decision', () => {
  const start = main.indexOf("var activeChatModeForPrompt = 'online';");
  const mode = main.indexOf('var presenceMode = isGroupChat');
  const use = main.indexOf("const naturalOnlineBubbles = !isGroupChat && presenceMode === 'online' && !isRegen;");
  assert.ok(start >= 0 && start < mode && mode < use);
  const source = main.slice(start, main.indexOf(';', mode) + 1) + '\n' +
    main.slice(use, main.indexOf(';', use) + 1) + '\nresult = naturalOnlineBubbles;';
  for (const c of [
    {group:false,regen:false,stored:'online',expected:true},
    {group:false,regen:false,stored:'narration',expected:false},
    {group:true,regen:false,stored:'online',expected:false},
    {group:false,regen:true,stored:'online',expected:false}
  ]) {
    const evaluate = new Function('isGroupChat','currentGroup','isRegen','localStorage','aliasRoleId',
      'var result;'+source+'return result;');
    assert.equal(evaluate(c.group,{settings:{chatMode:'online'}},c.regen,{getItem:()=>c.stored},'synthetic'),c.expected);
  }
});
