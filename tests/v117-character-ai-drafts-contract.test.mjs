import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html=readFileSync(new URL('../worldbook/characters/characters.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../worldbook/characters/js/character-ai-drafts.js',import.meta.url),'utf8');
test('three character-world AI tools have text-only controls and per-page feedback',()=>{
  for(const id of ['btnAiNpc','btnAiRelationships','btnAiLife']) assert.match(html,new RegExp('id="'+id+'"'));
  for(const id of ['npcAiStatus','relationshipsAiStatus','lifeAiStatus']) assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/phone_api\.js/);
  assert.doesNotMatch(js,/[✨🎉🤖]/u);
});
test('AI generation requires opt-in, has cooldown and explicit persistence',()=>{
  assert.match(js,/COOLDOWN_MS = 30000/);
  assert.match(js,/global\.confirm\(warning \+ ' 确认生成/);
  assert.match(js,/if \(busy\) return/);
  assert.match(js,/PhoneAPI\.completeJSON/);
  assert.match(js,/saveActiveRoleMutation/);
  assert.match(js,/character_ai_last_request_/);
  assert.match(js,/boundWorldBooks/);
  assert.match(js,/currentNpcDraft/);
  assert.match(js,/applyNpc\(normalizeNpc\(decoded\.data\)\)/);
});
