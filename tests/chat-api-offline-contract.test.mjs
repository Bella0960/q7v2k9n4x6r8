import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../shared/js/phone/phone_stream.js',import.meta.url),'utf8');
const detail=readFileSync(new URL('../chat/chat/chat-detail.html',import.meta.url),'utf8');
const policy=readFileSync(new URL('../shared/js/phone/chat-context-policy.js',import.meta.url),'utf8');

function client(mockFetch) {
  const window={};
  const FakeDecoder=class {
    decode(bytes) {return String.fromCharCode(...bytes);}
  };
  let id=0;
  const noTimer=()=>++id;
  new Function('window','fetch','setTimeout','clearTimeout','AbortController','TextDecoder','requestAnimationFrame',
    source)(window,mockFetch,noTimer,()=>{},AbortController,FakeDecoder,callback=>callback());
  return window.PhoneStream.chat;
}
function response(status, body) {
  const text=body || '';
  if(status!==200)return {
    ok:false,status,statusText:'HTTP Error',
    text:async()=>text,
    body:null
  };
  const chunks=Array.isArray(body)?body:[text];
  let i=0;
  return {ok:true,status:200,body:{getReader(){return {read:async()=>{
    if(i>=chunks.length)return {done:true};
    const bytes=Uint8Array.from(Array.from(chunks[i++]).map(ch=>ch.charCodeAt(0)));
    return {done:false,value:bytes};
  }};}}};
}
const sse=text=>'data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\n';

test('API transport retains final role system and recent history; no real model call',async()=>{
  let calls=0,body=null;
  const send=client(async (_url,options)=>{
    calls++;
    body=JSON.parse(options.body);
    return response(200,[sse('Hello'),sse(' there'),'data: [DONE]\n\n']);
  });
  const messages=[{role:'system',content:'Saved persona + global protocol + activated worldbook'},
    {role:'user',content:'Are you still working?'}];
  const result=await send({baseUrl:'https://example.invalid/v1',apiKey:'NOT_A_REAL_KEY',
    model:'test-model',messages,temperature:0.7});
  assert.equal(calls,1);
  assert.equal(result.ok,true);
  assert.equal(result.fullText,'Hello there');
  assert.equal(body.messages.length,2);
  assert.equal(body.messages[0].content,messages[0].content);
  assert.equal(body.stream,true);
  assert.equal(body.model,'test-model');
});

test('401 / 429 / 400 context-length failures remain errors, never become blank successful replies',async()=>{
  for(const status of [401,429,400]){
    const run=client(async()=>response(status,JSON.stringify({error:{message:'Mock HTTP failure'}})));
    const result=await run({baseUrl:'https://example.invalid/v1',apiKey:'FAKE',model:'mock',messages:[]});
    assert.equal(result.ok,false, String(status));
    assert.equal(result.error.kind,'http');
    assert.equal(result.error.status,status);
    assert.equal(result.fullText,'');
  }
});

test('HTTP 200 with empty SSE or heartbeats is a stream failure, not successful empty text',async()=>{
  for(const value of ['',': heartbeat\n\n','data: [DONE]\n\n']){
    const run=client(async()=>response(200,value));
    const result=await run({baseUrl:'https://example.invalid/v1',apiKey:'FAKE'});
    assert.equal(result.ok,false);
    assert.equal(result.error.kind,'stream');
    assert.match(result.error.detail,/没有返回可用/);
  }
});

test('server stream errors preserve received partial text and never silently count as success',async()=>{
  const run=client(async()=>response(200,[sse('partial'),'data: {"error":{"message":"stream stopped"}}\n\n']));
  const result=await run({baseUrl:'https://example.invalid/v1',apiKey:'FAKE'});
  assert.equal(result.ok,false);
  assert.equal(result.error.kind,'stream');
  assert.equal(result.fullText,'partial');
});

test('missing API configuration never invokes fetch',async()=>{
  let calls=0;
  const run=client(async()=>{calls++;throw Error('Should not fetch');});
  const result=await run({baseUrl:'',apiKey:'',messages:[]});
  assert.equal(calls,0);
  assert.equal(result.ok,false);
  assert.equal(result.error.kind,'config');
});

test('long chat requests preserve saved persona and select model-only bounded history',()=>{
  assert.match(detail,/budgetRecentHistory\(recentHistory, 9000\)/);
  assert.match(detail,/validateFinalApiMessages\(/);
  assert.match(policy,/function budgetRecentHistory\(/);
});


test('premature HTTP-200 SSE EOF is NOT a successful short reply; partial text is retained',async()=>{
  const run=client(async()=>response(200,[sse('partial reply without completion')]));
  const result=await run({baseUrl:'https://example.invalid/v1',apiKey:'FAKE'});
  assert.equal(result.ok,false);
  assert.equal(result.error.kind,'stream');
  assert.match(result.error.detail,/提前中断/);
  assert.equal(result.fullText,'partial reply without completion');
});

test('provider finish_reason stop is a valid completion even without [DONE]',async()=>{
  const content=sse('complete answer');
  const finish='data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\n';
  const run=client(async()=>response(200,[content,finish]));
  const result=await run({baseUrl:'https://example.invalid/v1',apiKey:'FAKE'});
  assert.equal(result.ok,true);
  assert.equal(result.error,null);
  assert.equal(result.fullText,'complete answer');
});

test('finish_reason length and content_filter remain explicit errors even with [DONE]',async()=>{
  for(const reason of ['length','content_filter']){
    const finish='data: '+JSON.stringify({choices:[{delta:{},finish_reason:reason}]})+'\n\n';
    const run=client(async()=>response(200,[sse('partial retained'),finish,'data: [DONE]\n\n']));
    const result=await run({baseUrl:'https://example.invalid/v1',apiKey:'FAKE'});
    assert.equal(result.ok,false);
    assert.equal(result.error.kind,'stream');
    assert.equal(result.fullText,'partial retained');
  }
});
