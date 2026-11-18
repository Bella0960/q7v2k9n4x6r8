import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=(p)=>readFileSync(resolve(root,p),'utf8');
const detail=read('chat/chat/chat-detail.html');
const rp=read('worldbook/settings/rp-protocol.html');
const shared=read('shared/js/phone/rp-default-protocol.js');
const state={window:{}};vm.runInNewContext(shared,state);
test('默认协议由设置页与聊天页共用，空存储时聊天仍加载',()=>{
 assert.ok(state.window.MAOMAO_RP_DEFAULT_PROTOCOL.length>2500);
 assert.match(state.window.MAOMAO_RP_DEFAULT_PROTOCOL,/你就是【\{\{char\}\}】/);
 assert.match(rp,/var DEFAULT_PROTOCOL = String\(window\.MAOMAO_RP_DEFAULT_PROTOCOL \|\| ''\)/);
 assert.match(detail,/rpProtocol\.trim\(\) \|\| String\(window\.MAOMAO_RP_DEFAULT_PROTOCOL \|\| ''\)/);
 assert.match(detail,/const globalRpKey = 'chat_rp_protocol_';/);
});
test('提示词不再自称 AI 助理，回复前重申角色身份与反客服约束',()=>{
 assert.doesNotMatch(detail,/你是一个具备真实拨号能力的 AI 助理/);
 assert.match(detail,/【发送前的角色一致性核对】/);
 assert.match(detail,/不要把旧回复里跳出角色的自我介绍当成角色真实背景/);
 assert.match(detail,/不要声称自己是 AI、运行在云端/);
 assert.match(detail,/禁止 Markdown 粗体/);
});

test('单聊旧协议迁移只读取当前角色，不拿别的角色协议覆盖', () => {
  const start = detail.indexOf("            let rpProtocol = '';");
  const end = detail.indexOf('            // 设置页展示的默认协议', start);
  assert.ok(start >= 0 && end > start, '应取到真实聊天协议兼容逻辑');
  const run = new Function('localStorage', 'aliasRoleId', 'currentCharacter', 'roleId',
    detail.slice(start, end) + '\nreturn rpProtocol;');
  function storage(values) {
    const data = new Map(Object.entries(values));
    return {
      getItem: key => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
      read: key => data.get(key) ?? null
    };
  }
  const otherOnly = storage({ chat_rp_protocol_other: '其他角色私有协议' });
  assert.equal(run(otherOnly, 'current', { id: 'current' }, 'current'), '');
  assert.equal(otherOnly.read('chat_rp_protocol_'), null,
    '不能把其他角色的协议意外迁移成所有角色的全局协议');

  const own = storage({
    chat_rp_protocol_other: '其他角色私有协议',
    chat_rp_protocol_current: '当前角色旧协议'
  });
  assert.equal(run(own, 'current', { id: 'current' }, 'current'), '当前角色旧协议');
  assert.equal(own.read('chat_rp_protocol_'), '当前角色旧协议');
  assert.equal(own.read('chat_rp_protocol_other'), '其他角色私有协议',
    '其他角色原始数据不得修改');

  const global = storage({ chat_rp_protocol_: '用户明确保存的全局协议',
    chat_rp_protocol_current: '过期的旧协议' });
  assert.equal(run(global, 'current', { id: 'current' }, 'current'),
    '用户明确保存的全局协议');
});
