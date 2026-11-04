import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const detail = read('../chat/chat/chat-detail.html');
const extras = read('../chat/chat/js/chat-extras.js');
const overlay = read('../chat/call/call-overlay.js');
const styles = read('../chat/call/call-overlay.css');

test('chat detail loads the call experience stylesheet and script', () => {
  assert.match(detail, /call\/call-overlay\.css\?v=20261105v1/);
  assert.match(detail, /call\/call-overlay\.js\?v=20261105v1/);
  assert.ok(detail.indexOf('js/chat-extras.js') < detail.indexOf('../call/call-overlay.js'));
});

test('voice and video actions open the shared in-chat call layer', () => {
  assert.match(extras, /MAOMAOCallExperience\.start\(mode,\s*currentCharacter\)/);
  assert.match(extras, /call-ui\.html/);
  assert.match(extras, /call\.html\?id=/);
});

test('call messages go through the existing chat send pipeline and are recorded', () => {
  assert.match(overlay, /global\.sendMsg\(\{\s*text:\s*text\s*\}\)/);
  assert.match(overlay, /type:\s*'call'/);
  assert.match(overlay, /saveMessages\(history\)/);
  assert.match(overlay, /appendMessageToDOM\(record\)/);
  assert.match(overlay, /聊天服务暂不可用，消息已保留[\s\S]*?input\.value = text/);
});

test('the simulated call does not request real microphone or camera access', () => {
  assert.doesNotMatch(overlay, /getUserMedia|MediaRecorder|mediaDevices|getDisplayMedia/i);
  assert.match(overlay, /同步保存到当前聊天/);
  assert.match(styles, /\.maomao-call-mini/);
  assert.match(styles, /\.maomao-call-layer\.is-video/);
});

test('group calls render real group members and keep their speaker identities', () => {
  assert.match(extras, /case 'group-call': featCall\('group'\)/);
  assert.match(overlay, /resolveGroupParticipants/);
  assert.match(overlay, /maomao-call-group-grid/);
  assert.match(overlay, /message\.memberId/);
  assert.match(overlay, /group:\s*!!isGroupCall/);
  assert.match(overlay, /群视频通话/);
});
