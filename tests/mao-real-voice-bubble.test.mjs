import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';

const page=readFileSync(resolve('chat/contacts/real-chat.html'),'utf8');
const begin=page.indexOf('// Voice messages share the existing text/photo bubble pipeline');
const end=page.indexOf('// The attachment fetch is authorized again',begin);
assert.ok(begin>=0 && end>begin,'voice UI implementation must exist');
const voice=page.slice(begin,end);

function node(tag) {
  const classes=new Set();
  const target={
    tagName:tag,children:[],attributes:{},dataset:{},style:{values:{},setProperty(k,v){this.values[k]=v}},
    hidden:false,disabled:false,paused:true,duration:2,
    classList:{add(...names){names.forEach(x=>classes.add(x))},contains(x){return classes.has(x)}},
    append(...items){target.children.push(...items)},
    appendChild(item){target.children.push(item)},
    replaceChildren(...items){target.children=items},
    setAttribute(k,v){target.attributes[k]=String(v)},
    removeAttribute(k){delete target.attributes[k]},
    addEventListener(k,fn){(target.handlers[k]??=[]).push(fn)},
    handlers:{},
    emit(event){for(const cb of target.handlers[event]||[])cb()},
    remove(){target.removed=true},
    contains(child){return target.children.includes(child)},
    play(){target.paused=false;target.emit('play');return Promise.resolve()},
    pause(){target.paused=true;target.emit('pause')},
    load(){target.emit('loadedmetadata')},
    scrollTop:0,scrollHeight:200
  };
  return target;
}
function session(){
  const nodes={log:node('div')},all=[];
  const document={
    createElement(tag){const result=node(tag);all.push(result);return result},
    createElementNS(_ns,tag){return node(tag)}
  };
  const sandbox={document,console,
    owner:{id:'MAO-AAAAAAAAAAAA'},voicePlayed:new Set(),
    activeVoicePlayers:new Set(),playingVoice:null,closed:false,
    pendingVoiceWrap:null,pendingMedia:null,
    $:id=>nodes[id],transmitMedia(){sandbox.retries++},
    retries:0,setStatus(message){sandbox.lastStatus=message}
  };
  runInNewContext(voice+'\nglobalThis.exposed={voiceSeconds,setVoiceLength,makeVoicePill,mountVoicePlayer,showPendingVoice,pendingVoiceStatus};',sandbox);
  return {sandbox,all,nodes,api:sandbox.exposed};
}

test('voice bubbles are black when mine, white when incoming, and native controls never display',()=>{
  assert.match(page,/\.bubble-wrap\.mine \.bubble\.media-voice\{background:#111;color:#fff/);
  assert.match(page,/\.bubble\.media-voice\{[^}]*background:#fff/);
  assert.match(page,/\.bubble-wrap\.mine \.voice-play\{flex-direction:row-reverse\}/);
  assert.match(page,/\.voice-play\[data-state="playing"\] \.voice-arc-middle/);
  assert.match(page,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(page,/audio\.controls=false/);
  assert.doesNotMatch(page,/element\.controls=true|<audio[^>]*controls|audio\.controls=true/);
  assert.match(page,/makeVoicePill\(\{mine:true,sending:true\}\)/);
  assert.match(page,/if\(kind==='voice'\)showPendingVoice\(clientMessageId\)/);
  // Existing composer stays visible and unchanged; no press-and-hold or keyboard switch.
  for(const original of ['id="photoBtn"','id="voiceBtn"','id="photoInput"','id="input"',
    'id="send"','id="compose"','id="voiceState"'])
    assert.ok(page.includes(original),original+' composer must remain');
  assert.doesNotMatch(page,/按住说话|松开发送/);
});

test('actual audio codec is hidden; tapping the bubble plays, pauses and clears unread dot',async()=>{
  const {api,sandbox}=session();
  const bubble=node('div');
  const message={id:'msg1',senderId:'MAO-BBBBBBBBBBBB'};
  api.mountVoicePlayer(bubble,'blob:https://mao.test/private',message);
  assert.equal(bubble.children.length,3);
  const [button,dot,audio]=bubble.children;
  assert.equal(button.tagName,'button');
  assert.equal(button.dataset.state,'unplayed');
  assert.equal(dot.hidden,false,'incoming unplayed message should have subtle dot');
  assert.equal(audio.controls,false);
  assert.equal(audio.hidden,true);
  assert.equal(button.children[1].textContent,'00:02');
  assert.equal(button.style.values['--voice-width'],'107px');
  await button.handlers.click[0]();
  assert.equal(button.dataset.state,'playing');
  assert.equal(button.attributes['aria-pressed'],'true');
  assert.equal(dot.hidden,true);
  assert.ok(sandbox.voicePlayed.has('msg1'));
  assert.equal(sandbox.playingVoice,audio);
  await button.handlers.click[0]();
  assert.equal(button.dataset.state,'unplayed');
  assert.equal(sandbox.playingVoice,null);
  assert.equal(dot.hidden,true,'already played voice should not show unread dot again');
});

test('playing next voice pauses previous message; own messages have no unread dots',async()=>{
  const {api,sandbox}=session();
  const a=node('div'),b=node('div');
  api.mountVoicePlayer(a,'blob:https://mao.test/a',{id:'a',senderId:'MAO-BBBBBBBBBBBB'});
  api.mountVoicePlayer(b,'blob:https://mao.test/b',{id:'b',senderId:'MAO-AAAAAAAAAAAA'});
  const audioA=a.children[2],audioB=b.children[2];
  assert.equal(b.children[1].hidden,true);
  await a.children[0].handlers.click[0]();
  await b.children[0].handlers.click[0]();
  assert.equal(audioA.paused,true);
  assert.equal(a.children[0].dataset.state,'unplayed');
  assert.equal(audioB.paused,false);
  audioB.emit('ended');
  assert.equal(b.children[0].dataset.state,'unplayed');
  assert.equal(sandbox.playingVoice,null);
});

test('sending bubble has loading state, failed state can retry, successful ack removes pending',()=>{
  const {api,sandbox,nodes}=session();
  const id='e2e_deduplicated_test_message';
  api.showPendingVoice(id);
  assert.equal(nodes.log.children.length,1);
  const wrap=nodes.log.children[0];
  const bubble=wrap.children[0];
  const pill=bubble.children[0];
  assert.equal(pill.dataset.state,'sending');
  assert.equal(pill.disabled,true);
  assert.equal(pill.attributes['aria-busy'],'true');
  api.pendingVoiceStatus('failed');
  assert.equal(pill.dataset.state,'failed');
  assert.equal(pill.disabled,false);
  assert.equal(wrap.children[1].textContent,'发送失败');
  sandbox.pendingMedia={clientMessageId:id};
  pill.onclick();
  assert.equal(sandbox.retries,1);
  api.pendingVoiceStatus('sending');
  assert.equal(pill.dataset.state,'sending');
  api.pendingVoiceStatus('sent');
  assert.equal(wrap.removed,true);
  assert.equal(sandbox.pendingVoiceWrap,null);
});

test('voice length grows naturally but is capped, with safe fallback when metadata is absent',()=>{
  const {api}=session();
  assert.equal(api.voiceSeconds(2),'00:02');
  assert.equal(api.voiceSeconds(20),'00:20');
  assert.equal(api.voiceSeconds(Number.POSITIVE_INFINITY),'00:00');
  const {pill,seconds}=api.makeVoicePill();
  api.setVoiceLength(pill,seconds,20);
  assert.equal(seconds.textContent,'00:20');
  assert.equal(pill.style.values['--voice-width'],'179px');
  api.setVoiceLength(pill,seconds,100);
  assert.equal(pill.style.values['--voice-width'],'219px');
});


test('trusted encrypted recording duration displays immediately when Safari reports Infinity',async()=>{
  const {api}=session();
  const bubble=node('div');
  const message={id:'voice_inf',senderId:'MAO-AAAAAAAAAAAA'};
  api.mountVoicePlayer(bubble,'blob:https://mao.test/voice',message,2);
  const [button,,audio]=bubble.children;
  assert.equal(button.children[1].textContent,'00:02');
  audio.duration=Infinity;
  audio.emit('durationchange');
  assert.equal(button.children[1].textContent,'00:02','browser Infinity must not erase real recorded seconds');
  audio.duration=NaN;
  audio.emit('loadedmetadata');
  assert.equal(button.children[1].textContent,'00:02');
});

test('unknown-duration historical voice no longer displays a literal voice label',()=>{
  const {api}=session();
  const bubble=node('div');
  api.mountVoicePlayer(bubble,'blob:https://mao.test/oldvoice',{
    id:'oldvoice',senderId:'MAO-BBBBBBBBBBBB'
  });
  const [button,,audio]=bubble.children;
  audio.duration=Infinity;
  audio.emit('durationchange');
  assert.equal(button.children[1].textContent,'00:00');
  audio.duration=2;
  audio.emit('durationchange');
  assert.equal(button.children[1].textContent,'00:02');
  audio.duration=Infinity;
  audio.currentTime=2;
  audio.emit('timeupdate');
  audio.emit('ended');
  assert.equal(button.children[1].textContent,'00:02');
});

test('real client records elapsed seconds and stores them inside encrypted media marker',()=>{
  assert.match(page,/const recordedSeconds=Math\.max\(\.01,\(Date\.now\(\)-state\.start\)\/1000\)/);
  assert.match(page,/sendMediaBlob\(captured,'voice',type,recordedSeconds\)/);
  assert.match(page,/makeMediaMarker\(mediaId,kind,seconds\)/);
  assert.match(page,/mountVoicePlayer\(bubble,url,message,marker\.durationSeconds/);
  assert.match(page,/recoverLegacyVoiceDuration\(legacyBytes\)/);
  assert.doesNotMatch(page,/seconds\.textContent=sending\?'发送中':'语音'/);
});
