import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const detail = readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');
const markerStart = detail.indexOf('        function _locateUserMessageIndex(');
const markerEnd = detail.indexOf('        // Retry is a read-only', markerStart);
const helperStart = detail.indexOf('            function stopForMissingRoleSource(');
const helperEnd = detail.indexOf('            if (retryTarget && !visionImageMids.length)', helperStart);
assert.ok(markerStart > 0 && markerEnd > markerStart, 'real failure marker must exist');
assert.ok(helperStart > 0 && helperEnd > helperStart, 'real source-stop handler must exist');
const actualMark = detail.slice(markerStart, markerEnd);
const actualStop = detail.slice(helperStart, helperEnd);
const setup = new Function(
  'sourceGateUser', 'historyList', 'saveMessages', '_vl', 'vlRefresh',
  'renderAllMessages', 'showToast', 'retryTarget',
  actualMark + '\n' + actualStop + '\nreturn stopForMissingRoleSource;'
);

function fixture(opts={}) {
  const user = {
    role:'user', mid:'u-001',time:1732110000000,
    text:'深圳今晚有没有下雨？',quote:{mid:'ref-001',text:'上次的回复'}
  };
  const previous = {role:'assistant',mid:'a-000',text:'前一条完整的角色回复'};
  const list = [previous, user];
  let saved = structuredClone(list);
  const notices = [];
  let renderCount=0,saveCount=0;
  const onSave = next => {
    saveCount++;
    if(opts.failSave) return false;
    saved=structuredClone(next);
    return true;
  };
  const target=opts.newUser === false ? null : {mid:user.mid,time:user.time};
  const retry=opts.retry ? {mid:user.mid,time:user.time} : null;
  const stop=setup(target,list,onSave,null,()=>renderCount++,()=>renderCount++,
    text=>notices.push(text),retry);
  return {stop, list, user, previous, notices, get saved(){return saved;},
    get rendered(){return renderCount;}, get saves(){return saveCount;}};
}

test('source failure updates exact original user message, without duplicating history', () => {
  const h=fixture();
  h.stop('worldbook-read','世界书读取失败');
  assert.equal(h.saves,1);
  assert.equal(h.saved.length,2);
  assert.equal(h.saved[0].mid,h.previous.mid);
  assert.equal(h.saved[0].text,h.previous.text);
  assert.equal(h.saved[1].mid,'u-001');
  assert.equal(h.saved[1].text,'深圳今晚有没有下雨？');
  assert.deepEqual(h.saved[1].quote,{mid:'ref-001',text:'上次的回复'});
  assert.equal(h.saved[1].sendFailed,true);
  assert.equal(h.saved[1].sendFailedReason,'worldbook-read');
  assert.equal(h.rendered,1);
  assert.match(h.notices[0],/感叹号重试/);
});

test('failed storage write rolls marker back, preserves original role dialogue, and warns', () => {
  const h=fixture({failSave:true});
  h.stop('persona-sources-incomplete','设定校验失败');
  assert.equal(h.saves,1);
  assert.equal(h.saved.length,2);
  assert.equal(h.saved[1].sendFailed,undefined);
  assert.equal(h.list[1].sendFailed,undefined);
  assert.equal(h.rendered,0);
  assert.match(h.notices[0],/重试状态未能保存/);
  assert.doesNotMatch(h.notices[0],/感叹号重试/);
});

test('retry and regeneration without new message never generate a duplicate or clear failure state', () => {
  const retry=fixture({newUser:false,retry:true});
  retry.user.sendFailed=true;
  retry.user.sendFailedReason='protocol-read';
  retry.stop('protocol-missing','协议不存在');
  assert.equal(retry.saves,0);
  assert.equal(retry.saved.length,2);
  assert.equal(retry.list[1].sendFailed,true);
  assert.match(retry.notices[0],/原失败消息已保留/);
  const regen=fixture({newUser:false});
  regen.stop('persona-sources-incomplete','身份资料错误');
  assert.equal(regen.saves,0);
  assert.equal(regen.list.length,2);
  assert.doesNotMatch(regen.notices[0],/感叹号/);
});

test('all required-source aborts invoke one guarded failure handler, not a fake AI request', () => {
  for(const [reason,excerpt] of [
    ['group-persona-too-long','群成员人设合计过长'],
    ['protocol-read','人设协议读取失败'],
    ['protocol-missing','人设协议未加载'],
    ['worldbook-read','世界书读取失败'],
    ['worldbook-too-long','世界书过长'],
    ['persona-sources-incomplete','角色人设、世界书或设置协议未完整载入']
  ]) {
    assert.match(detail,new RegExp("stopForMissingRoleSource\\('"+reason+"'"));
    assert.ok(detail.includes(excerpt),reason);
  }
  const sent=detail.indexOf('historyList = loadMessages();\n                    if (_chatHistoryUnreadable');
  const marked=detail.indexOf('sourceGateUser = { mid: userMsg.mid, time: userMsg.time };',sent);
  const earlyReturn=detail.indexOf('消息已保存，但会话更新未确认',sent);
  assert.ok(sent>=0 && marked>earlyReturn,'only successfully confirmed user sends are marked');
  assert.match(detail,/let sourceGateUser = null/);
  assert.match(detail,/_markUserSendFailed\(\s*historyList, sourceGateUser\.mid, sourceGateUser\.time, reason/);
});

test('no old history or API config is mutated when the source is unavailable', () => {
  const h=fixture();
  const initial=structuredClone(h.saved[0]);
  h.stop('worldbook-too-long','世界书过长');
  assert.deepEqual(h.saved[0],initial);
  assert.equal(h.saved.filter(x=>x.role==='user').length,1);
});
