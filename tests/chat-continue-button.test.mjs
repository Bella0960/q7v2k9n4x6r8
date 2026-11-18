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

test('CHAT-MIC-001: manually continued replies do not show typing state or stream fragments', () => {
  assert.match(main, /if \(!isManualContinue && chatTitleEl\)/);
  assert.match(main, /if \(!isManualContinue\) \{[\s\S]*?statusDiv\.innerText = '对方正在输入\.\.\.'/);
  assert.match(main, /if \(isManualContinue\) return;[\s\S]*?if \(!tmpText\) return;/);
  assert.match(main, /isManualContinue \? 'auto' : getActiveReplyBubbleMode\(\)/);
});

test('CHAT-MIC-001: changed inline scripts are syntactically valid', () => {
  assert.ok(main && continuation);
  assert.doesNotThrow(() => new Script(main, { filename: 'chat-detail main inline script' }));
  assert.doesNotThrow(() => new Script(continuation, { filename: 'chat-detail continuation inline script' }));
});
