import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';

const root=process.cwd();
const provider=readFileSync(resolve(root,'shared/js/social-chat-list.js'),'utf8');
const chatHome=readFileSync(resolve(root,'chat/chat/chat.html'),'utf8');
const contacts=readFileSync(resolve(root,'chat/contacts/contacts.html'),'utf8');
const A='MAO-AAAAAAAAAAAA',B='MAO-BBBBBBBBBBBB',C='MAO-CCCCCCCCCCCC';

function sandbox(getResponse) {
  const window={};
  const calls=[];
  const fetch=async(url,options)=>{
    calls.push({url,options});
    const response=await getResponse(url,options);
    if(response?.status===403)return {ok:false,status:403};
    return {ok:true,status:200,json:async()=>({ok:true,...response})};
  };
  runInNewContext(provider,{window,fetch,console});
  return {registry:window.MAOMAORealChatList,calls};
}

test('approved real chat has one unobtrusive row in the EXISTING chat list, not contacts',()=>{
  assert.match(chatHome,/social-chat-list\.js\?v=/);
  assert.match(chatHome,/MAOMAORealChatList\.getRows\(\)/);
  assert.match(chatHome,/MAOMAORealChatList\.subscribe\(renderChatList\)/);
  assert.match(chatHome,/chat-slim-card chat-real-card/);
  assert.match(chatHome,/container\.innerHTML = realHTML \+ groupsHTML \+ rolesHTML/);
  assert.match(chatHome,/chat-slim-card:not\(\.chat-group-card\):not\(\.chat-real-card\)/);
  assert.match(chatHome,/window\.location\.href = '\.\.\/contacts\/real-chat\.html\?peer='/);
  assert.match(chatHome,/真人 · 加密聊天/);
  assert.match(chatHome,/document\.visibilityState === 'visible'/);
  assert.doesNotMatch(contacts,/id="goRealFriends"/);
});

test('provider fetches approved conversations from server without local cache or cross-site requests',async()=>{
  const {registry,calls}=sandbox(url=>{
    if(url==='/api/accounts/me')return {account:{id:A,status:'active'}};
    if(url==='/api/social/e2ee/conversations')return {
      ownerAccountId:A,conversations:[
        {id:B,displayName:'小鱼',lastMessageAt:1794530000000},
        {id:'MAO-INVALID!',displayName:'spoof',lastMessageAt:null},
        {id:C,displayName:'  ',lastMessageAt:null},
        {id:A,displayName:'self',lastMessageAt:null},
        {id:B,displayName:'duplicate',lastMessageAt:null}
      ]
    };
  });
  let updates=0;
  registry.subscribe(()=>updates++);
  await registry.refresh();
  const rows=registry.getRows();
  assert.equal(rows.length,1);
  assert.equal(rows[0].id,B);
  assert.equal(rows[0].displayName,'小鱼');
  assert.equal(rows[0].lastMessageAt,1794530000000);
  assert.equal(registry.owner(),A);
  assert.equal(updates,1);
  assert.equal(calls.length,3);
  assert.equal(calls[1].options.headers['x-mao-account-context'],A);
  assert.equal(calls[2].options.headers['x-mao-account-context'],A);
  assert.ok(calls.every(c=>c.options.cache==='no-store'));
  assert.ok(calls.every(c=>c.options.credentials==='same-origin'&&c.options.redirect==='error'));
  assert.doesNotMatch(provider,/localStorage|sessionStorage|caches\.|indexedDB/);
  // No caller may mutate the internal snapshot.
  rows[0].displayName='tampered';
  assert.equal(registry.getRows()[0].displayName,'小鱼');
});

test('switching accounts discards old real chat rows, even when late requests arrive',async()=>{
  let active=A, slowResolve;
  const {registry}=sandbox(async url=>{
    if(url==='/api/accounts/me')return {account:{id:active,status:'active'}};
    if(url==='/api/social/e2ee/conversations'){
      if(active===A)return {ownerAccountId:A,conversations:[{id:B,displayName:'小鱼',lastMessageAt:null}]};
      if(active===C)return new Promise(resolve=>{slowResolve=resolve;});
      return {ownerAccountId:B,conversations:[]};
    }
  });
  await registry.refresh();
  assert.equal(registry.getRows().length,1);
  active=C;
  const stale=registry.refresh();
  // The old account is erased before loading C, not merely hidden on error.
  assert.equal(registry.getRows().length,0);
  active=B;
  await registry.refresh();
  assert.equal(registry.owner(),B);
  slowResolve({ownerAccountId:C,conversations:[{id:A,displayName:'wrong',lastMessageAt:null}]});
  await stale;
  assert.equal(registry.getRows().length,0);
  assert.equal(registry.owner(),B);
});

test('mismatched response owner, expired session or unauthenticated account never displays strangers',async()=>{
  let stage=0;
  const {registry}=sandbox(url=>{
    if(url==='/api/accounts/me')return stage===2?{status:403}:{account:{id:A,status:'active'}};
    return stage===0
      ? {ownerAccountId:A,conversations:[{id:B,displayName:'小鱼',lastMessageAt:null}]}
      : {ownerAccountId:C,conversations:[{id:B,displayName:'wrong account',lastMessageAt:null}]};
  });
  await registry.refresh();assert.equal(registry.getRows().length,1);
  stage=1;
  await registry.refresh();assert.equal(registry.getRows().length,0);
  stage=2;
  await registry.refresh();assert.equal(registry.getRows().length,0);
  assert.equal(registry.owner(),null);
});
