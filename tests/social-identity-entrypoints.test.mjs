import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
for (const path of ['forum/forum.html','forum/forum-detail.html','forum/forum-profile.html','forum/forum-my-content.html']) {
 const source=fs.readFileSync(path,'utf8');
 const line=source.split('\n').find(x=>x.includes('function isOwn(c)'));
 const ctx=vm.createContext({});vm.runInContext(line,ctx);
 test(path+' owner must be explicit and non-conflicting',()=>{
 assert.equal(ctx.isOwn({name:'我'}),false);assert.equal(ctx.isOwn({owner:'me',residentId:'npc',name:'我'}),false);assert.equal(ctx.isOwn({owner:'me',roleId:'ai'}),false);assert.equal(ctx.isOwn({tag:'me',id:'user_fake'}),false);assert.equal(ctx.isOwn({owner:'me',name:'another'}),true);assert.equal(ctx.isOwn({owner:'me',generatedBy:'community-ai'}),false);
 });
}
const src=fs.readFileSync('forum/forum.html','utf8');const begin=src.indexOf('function forumMakeAIComment('),end=src.indexOf('function forumWorldbook(',begin);const ctx=vm.createContext({forumResident:(id)=>({id:id==='r1'||id==='r2'?id:'r1',name:id==='r2'?'我':'甲'})});vm.runInContext(src.slice(begin,end),ctx);
test('community reply cannot use fake speaker or model-specified target',()=>{assert.equal(ctx.forumMakeAIComment({residentId:'fake',text:'x'},0),null);const r=ctx.forumMakeAIComment({residentId:'r1',text:'a',replies:[null,{residentId:'r2',text:'b',replyTo:'我'}]},0);assert.equal(r.replies[0].replyTo,'甲');assert.equal(r.replies[0].replyToActorId,'r1');assert.equal(r.replies[0].replyToType,'NPC');});
