import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../shared/js/phone/phone_stream.js',import.meta.url),'utf8');
function mount(fetcher){
 const window={};
 new Function('window','fetch','AbortController','TextDecoder','requestAnimationFrame',source)(window,fetcher,AbortController,TextDecoder,fn=>setTimeout(fn,0));
 return window.PhoneStream.chat;
}
const opts={apiKey:'test-only',baseUrl:'https://fixture.invalid/v1',model:'a',fallbackModels:['b','c'],messages:[{role:'system',content:'synthetic'}]};
test('already cancelled call never initiates transport',async()=>{
 const controller=new AbortController();controller.abort();let requests=0;
 const chat=mount(()=>{requests++;throw Error('unexpected fetch');});
 const result=await chat({...opts,signal:controller.signal});
 assert.equal(requests,0);assert.equal(result.error.reason,'caller');
});
test('active request cancels immediately, including an unresponsive transport',async()=>{
 const controller=new AbortController();let internal,requests=0;
 const chat=mount((url,init)=>{requests++;internal=init.signal;return new Promise(()=>{});});
 const pending=chat({...opts,signal:controller.signal});controller.abort();
 const result=await pending;assert.equal(result.error.reason,'caller');assert.equal(internal.aborted,true);assert.equal(requests,1);
});
test('aborted fallback never tries another model or reports capacity failure',async()=>{
 const controller=new AbortController();let requests=0,notify;
 const second=new Promise(r=>{notify=r;});
 const chat=mount((url,init)=>{requests++;if(requests===1)return Promise.resolve({ok:false,status:503,body:null,text:async()=>''});notify(init.signal);return new Promise(()=>{});});
 const pending=chat({...opts,signal:controller.signal});const signal=await second;controller.abort();
 const result=await pending;assert.equal(signal.aborted,true);assert.equal(result.error.reason,'caller');assert.equal(requests,2);
});
test('ordinary request without signal preserves HTTP error semantics',async()=>{
 const chat=mount(async()=>({ok:false,status:401,body:null,text:async()=>'{"error":{"message":"fixture"}}'}));
 const result=await chat(opts);assert.equal(result.error.kind,'http');assert.equal(result.error.status,401);
});
test('late response and delayed paint cannot turn a cancelled stream into success',async()=>{
 const controller=new AbortController();let resume,reads=0,paints=0;
 const chat=mount(async()=>({ok:true,body:{getReader(){return {read(){reads++;return new Promise(r=>{resume=r;});}};}}}));
 const pending=chat({...opts,signal:controller.signal,onPaint:()=>paints++});
 await Promise.resolve();assert.equal(reads,1);controller.abort();
 const result=await pending;resume({done:true});await Promise.resolve();await Promise.resolve();
 assert.equal(result.error.reason,'caller');assert.equal(result.ok,false);assert.equal(paints,0);
});
