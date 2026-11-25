/* Synthetic-only DATA-006 browser acceptance. */
async function runArchiveLabTests(report=()=>{},total=100000){
 const results=[]; const assert=(v,m)=>{if(!v)throw Error(m)};
 const rejects=async(fn,code)=>{try{await fn()}catch(e){assert(e.code===code||e.message===code,'expected '+code+' got '+e.message);return}throw Error('expected '+code)};
 const test=async(name,fn)=>{const start=performance.now();await fn();const r={name,ms:Math.round(performance.now()-start)};results.push(r);report(r)};
 const name='maomao-storage-lab-browser-'+Date.now().toString(36);
 const base={accountId:'synthetic-a',kind:'role',conversationId:'same-id',generation:'first',domain:'messages'};
 let revoked=false,interrupt=false,shadowCalls=0;
 const options={name,indexedDB,keyRange:IDBKeyRange,authorize:(s,op)=>!(revoked&&s.accountId===base.accountId)&&!(interrupt&&op==='shadow'&&++shadowCalls>350)};
 let db=await MaoArchiveLab.open(options),other=await MaoArchiveLab.open(options);
 let a=db.bind(base);const peer=other.bind(base);
 const payload={mid:'legacy-mid',role:'received',text:'synthetic',mode:'date',scene:{id:7},memberId:'synthetic-member',custom:{unknown:[1,false,null]},assetId:'synthetic-asset'};
 try{
 await test('scope validation and denial',async()=>{await rejects(()=>db.bind({...base,accountId:''}),'INVALID_ID');await rejects(()=>db.bind({...base,kind:'npc'}),'INVALID_SCOPE');revoked=true;await rejects(()=>a.page(),'SCOPE_DENIED');revoked=false});
 await test('atomic append, rich payload, replay, rollback, invalid JSON',async()=>{
  assert((await a.append([{id:'msg1',payload}])).count===1,'append');assert(JSON.stringify((await a.get('msg1')).payload)===JSON.stringify(payload),'rich fields changed');
  assert((await a.append([{id:'msg1',payload}])).duplicate===1,'replay');await rejects(()=>a.append([{id:'rollback',payload:{x:1}},{id:'msg1',payload:{x:2}}]),'IDEMPOTENCY_CONFLICT');assert(await a.get('rollback')===null&&(await a.page()).count===1,'partial commit');
  for(const [id,value] of [['map',new Map()],['date',new Date()],['undefined',undefined]])await rejects(()=>a.append([{id,payload:{value}}]),'INVALID_PAYLOAD');
 });
 await test('account, conversation, group, generation and domain isolation',async()=>{
  for(const patch of [{accountId:'synthetic-b'},{conversationId:'different'},{kind:'group'},{generation:'second'},{domain:'memories'}]){const h=db.bind({...base,...patch});assert(await h.get('msg1')===null,'cross-scope read');await h.append([{id:'msg1',payload:{x:2}}]);assert((await h.page()).count===1,'scope count')}
  assert((await a.get('msg1')).payload.text===payload.text,'cross-scope write');
 });
 await test('concurrent handles serialize writes',async()=>{await Promise.all(Array.from({length:20},(_,i)=>(i%2?a:peer).append([{id:'parallel-'+i,payload:{i}}])));const p=await a.page({limit:100});assert(p.count===21&&new Set(p.items.map(x=>x.sequence)).size===21,'lost or duplicate sequence')});
 await test('mid-transaction revocation rolls back',async()=>{let calls=0;const special=await MaoArchiveLab.open({...options,authorize:(s,op)=>op!=='append'||++calls<5});try{await rejects(()=>special.bind(base).append([{id:'revoked1',payload:{x:1}},{id:'revoked2',payload:{x:2}}]),'SCOPE_DENIED')}finally{special.close()}assert(await a.get('revoked1')===null&&await a.get('revoked2')===null,'revoked write survived')});
 await test('10000-row shadow copy, interrupt, resume, verify, replay',async()=>{
  const rows=Array.from({length:10000},(_,i)=>({mid:i%2===0?'duplicate-legacy-mid':undefined,role:i%2?'sent':'received',text:'synthetic '+i,mode:i%3?'online':'date',extra:{i}}));const raw=JSON.stringify(rows),snapshot=JSON.parse(raw);
  interrupt=true;shadowCalls=0;await rejects(()=>a.copyLegacySnapshot(raw,crypto),'SCOPE_DENIED');interrupt=false;const checkpoint=(await a.page({shadow:true,limit:1})).count;assert(checkpoint>0&&checkpoint<10000,'checkpoint');db.close();db=await MaoArchiveLab.open(options);a=db.bind(base);
  const r=await a.copyLegacySnapshot(raw,crypto);assert(r.status==='verified-shadow'&&r.active===false&&r.count===10000,'verification');assert(JSON.stringify((await a.get('legacy:1',{shadow:true})).payload)===JSON.stringify(snapshot[0]),'first');assert(JSON.stringify((await a.get('legacy:10000',{shadow:true})).payload)===JSON.stringify(snapshot[9999]),'last');assert((await a.page()).count===21,'shadow became active');const again=await a.copyLegacySnapshot(raw,crypto);assert(again.count===10000&&again.sourceHash===r.sourceHash,'replay');await rejects(()=>a.copyLegacySnapshot('[{"text":"changed"}]',crypto),'SNAPSHOT_CHANGED');
 });
 await test('large archive bounded paging and indexed oldest-message lookup',async()=>{
  const h=db.bind({...base,conversationId:'large'});for(let start=0;start<total;start+=200){await h.append(Array.from({length:Math.min(200,total-start)},(_,j)=>({id:'large-'+(start+j),payload:{role:'sent',text:'synthetic '+(start+j)}})))}
  const start=performance.now(),p=await h.page({limit:40});const pageMs=Math.round(performance.now()-start);assert(p.count===total&&p.items.length===40&&p.items[0].sequence===total,'latest');const second=await h.page({limit:40,before:p.nextBefore});assert(second.items[0].sequence===total-40,'page gap');assert((await h.get('large-0')).sequence===1,'oldest');const tail=await h.page({limit:40,before:2});assert(tail.items.length===1&&tail.nextBefore===null,'tail boundary');report({name:'large archive metrics',rows:total,pageMs});
 });
 }finally{db.close();other.close();await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('cleanup blocked'))})}
 return results;
}
