import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function load(path,name,extra={}) { const win={...extra};vm.runInNewContext(fs.readFileSync(path,'utf8'),{window:win,localStorage:{getItem:()=>null}});return win[name]; }
const voice=load('shared/js/phone/chat-presence-policy.js','ChatPresencePolicy');
const recall=load('shared/js/phone/memory_recall.js','MemoryRecall');
const chat=load('shared/js/phone/chat-context-policy.js','ChatContextPolicy');
const members=[{id:'a',name:'我'},{id:'b',name:'乙'}];
const group={isGroupChat:true,speakerId:'a',speakerName:'我',groupMembers:members};
test('voice only learns known selected speaker, not name-only, failed or private samples',()=>{const h=[{role:'assistant',name:'我',text:'旧昵称语言习惯'},{role:'assistant',memberId:'a',text:'我在整理书架。'},{role:'assistant',memberId:'a',sendFailed:true,text:'失败内容不要学习'},{role:'assistant',memberId:'a',visibility:'private',text:'私人内容不要学习'},{role:'assistant',memberId:'b',name:'我',text:'别人的语言习惯'}];assert.deepEqual(Array.from(voice.collectVoiceSamples(h,group)),['我在整理书架。']);assert.equal(voice.collectVoiceSamples(h,{...group,speakerId:''}).length,0);});
test('recall distinguishes same text across actors and does not infer legacy aliases',()=>{const h=[{role:'assistant',memberId:'a',text:'我们昨天去老街书店买书。'},{role:'assistant',memberId:'b',text:'我们昨天去老街书店买书。'},{role:'assistant',name:'我',text:'老街书店有旧杂志和漫画。'},{role:'sent',memberId:'b',text:'老街书店还有很多画册。'}];const x=recall.buildHistoricalRecallText(h,'老街书店',{groupPublicOnly:true,groupMembers:members,maxItems:5,maxChars:1500});assert.match(x,/AI_ROLE · 群成员 我 · ID=a/);assert.match(x,/AI_ROLE · 群成员 乙 · ID=b/);assert.match(x,/UNKNOWN · 群成员/);assert.match(x,/UNKNOWN · 身份未核实/);});
test('group quote is attributed by original message ID, not snapshot nickname',()=>{const history=[{mid:'b1',role:'assistant',memberId:'b',text:'原文'},{role:'user',text:'回复',quote:{mid:'b1',authorName:'我',text:'原文'}}];const x=chat.mapHistoryToApiMessages(history,String,group);assert.match(x[1].content,/原作者身份=\{"type":"AI_ROLE","id":"b"\}/);const hidden=[{mid:'p',role:'assistant',memberId:'b',visibility:'private',text:'私密内容'},{role:'user',text:'回复',quote:{mid:'p',authorName:'我',text:'私密内容'}},{role:'user',text:'另一条',quote:{mid:'missing',authorName:'我',text:'过期引用'}}];assert.doesNotMatch(JSON.stringify(chat.mapHistoryToApiMessages(hidden,String,group)),/私密内容|过期引用/);});
