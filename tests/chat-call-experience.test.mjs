import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

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
  assert.match(overlay, /saveMessages\(next\)/);
  assert.match(overlay, /var next = Array\.isArray\(history\) \? history\.concat\(\[record\]\)/);
  assert.match(overlay, /appendMessageToDOM\(record\)/);
  assert.match(overlay, /聊天服务暂不可用，消息已保留[\s\S]*?input\.value = text/);
});

test('the simulated call does not request real microphone or camera access', () => {
  assert.doesNotMatch(overlay, /getUserMedia|MediaRecorder|mediaDevices|getDisplayMedia/i);
  assert.match(overlay, /同步保存到当前聊天/);
  assert.match(styles, /\.maomao-call-mini/);
  assert.match(styles, /\.maomao-call-layer\.is-video/);
});

test('group calls load the saved group roster and keep participant identities', () => {
  assert.match(detail, /data-feat="group-call"/);
  assert.match(extras, /case 'group-call': featCall\('group'\)/);
  assert.match(overlay, /readGroupData\(character\.id\)/);
  assert.match(overlay, /phone_groups/);
  assert.match(overlay, /ai_custom_characters/);
  assert.match(overlay, /resolveGroupParticipants/);
  assert.match(overlay, /maomao-call-group-grid/);
  assert.match(overlay, /message\.memberId/);
  assert.match(overlay, /participants:\s*isGroupCall \? groupParticipants/);
  assert.match(overlay, /群视频通话/);
});


test('call completion does not display an unsaved record or mutate previous history', () => {
  const start = overlay.indexOf('    function addCallRecord() {');
  const end = overlay.indexOf('\n    function finish() {', start);
  assert.ok(start >= 0 && end > start, 'call completion persistence helper exists');

  const history = [{ mid: 'previous', text: '已保存的消息' }];
  const attempts = [];
  const rendered = [];
  const notices = [];
  let persist = false;
  const sandbox = {
    currentMessages: () => [{ role: 'user', text: '你好' }],
    callType: 'voice',
    isGroupCall: false,
    groupParticipants: [],
    connected: true,
    duration: 4,
    formatTime: () => '00:04',
    readHistory: () => history,
    saveMessages: (messages) => { attempts.push(messages); return persist; },
    appendMessageToDOM: (message) => rendered.push(message),
    showToast: (message) => notices.push(message),
    character: { id: 'role-one' },
    global: {
      document: { getElementById: () => ({ scrollHeight: 200, scrollTop: 0 }) },
      console: { warn: () => {} }
    }
  };
  runInNewContext(overlay.slice(start, end) + '\nglobalThis.finishCallRecord = addCallRecord;', sandbox);
  assert.equal(sandbox.finishCallRecord(), false);
  assert.equal(rendered.length, 0, 'no false delivered call card on write failure');
  assert.equal(history.length, 1, 'previous messages remain intact');
  assert.equal(attempts[0].length, 2);
  assert.match(notices[0], /通话记录保存失败/);

  persist = true;
  assert.equal(sandbox.finishCallRecord(), true);
  assert.equal(rendered.length, 1, 'a saved call card is displayed once');
  assert.equal(rendered[0].call.messageCount, 1);
  assert.equal(history.length, 1, 'writing must not mutate the original history snapshot');

  sandbox.saveMessages = () => { throw new Error('quota exceeded'); };
  assert.equal(sandbox.finishCallRecord(), false);
  assert.equal(rendered.length, 1, 'exceptions must not display phantom records');
});
