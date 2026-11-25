/* DATA-006 phase A: dormant IndexedDB archive laboratory.
 * This module must not be loaded by production pages or receive real user data.
 * A trusted application identity adapter and verified backup registry are prerequisites.
 */
(function (global) {
  'use strict';
  const VERSION = 1, MAX_BATCH = 200, MAX_PAGE = 100, MAX_BYTES = 8 * 1024 * 1024;
  const STORES = Object.freeze(['records', 'partitions']);
  const DOMAINS = new Set(['messages','memories']);
  function fail(code) { const e = new Error(code); e.code = code; throw e; }
  function id(value) {
    if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 256) fail('INVALID_ID');
    return value;
  }
  function normalizeScope(input) {
    if (!input || !['role','group'].includes(input.kind) || !DOMAINS.has(input.domain)) fail('INVALID_SCOPE');
    return Object.freeze({
      accountId: id(input.accountId), kind: input.kind, conversationId: id(input.conversationId),
      generation: id(input.generation), domain: input.domain
    });
  }
  function partitionKey(s, lane) {
    return JSON.stringify([s.accountId,s.kind,s.conversationId,s.generation,s.domain,lane]);
  }
  function jsonRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_PAYLOAD');
    let encoded;
    try {
      encoded = JSON.stringify(value, (key,v) => {
        if (v === undefined || typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint' ||
            (typeof v === 'number' && !Number.isFinite(v))) fail('INVALID_PAYLOAD');
        return v;
      });
    } catch (_) { fail('INVALID_PAYLOAD'); }
    if (typeof encoded !== 'string' || encoded.length * 2 > MAX_BYTES) fail('PAYLOAD_TOO_LARGE');
    const decoded = JSON.parse(encoded);
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) fail('INVALID_PAYLOAD');
    return encoded;
  }
  function prepareBatch(input) {
    if (!Array.isArray(input) || !input.length || input.length > MAX_BATCH) fail('INVALID_BATCH');
    const seen = new Set(); let bytes = 0;
    return input.map(item => {
      if (!item) fail('INVALID_PAYLOAD');
      const recordId = id(item.id);
      if (seen.has(recordId)) fail('DUPLICATE_BATCH_ID');
      seen.add(recordId);
      const encoded = jsonRecord(item.payload);
      bytes += encoded.length * 2;
      if (bytes > MAX_BYTES) fail('BATCH_TOO_LARGE');
      return { id:recordId, encoded };
    });
  }
  function request(req) {
    return new Promise((resolve,reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IDB_REQUEST_FAILED'));
    });
  }
  function completed(tx) {
    return new Promise((resolve,reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('IDB_TRANSACTION_ABORTED'));
    });
  }
  function open(options) {
    if (!options || typeof options.name !== 'string' || !/^maomao-storage-lab-[a-z0-9-]{1,80}$/.test(options.name) ||
        !options.indexedDB || !options.keyRange || typeof options.authorize !== 'function') fail('LAB_OPTIONS_REQUIRED');
    const factory = options.indexedDB, range = options.keyRange, authorize = options.authorize;
    return new Promise((resolve,reject) => {
      const req = factory.open(options.name, VERSION);
      let settled = false;
      req.onupgradeneeded = () => {
        const db = req.result;
        const records = db.createObjectStore('records',{keyPath:['partition','sequence']});
        records.createIndex('byId',['partition','id'],{unique:true});
        db.createObjectStore('partitions',{keyPath:'partition'});
      };
      req.onerror = () => { settled = true; reject(req.error || new Error('IDB_OPEN_FAILED')); };
      req.onblocked = () => { settled = true; reject(new Error('IDB_OPEN_BLOCKED')); };
      req.onsuccess = () => {
        if (settled) { req.result.close(); return; }
        settled = true;
        const db = req.result;
        let closed = false;
        const close = () => { closed = true; db.close(); };
        db.onversionchange = close;
        function bind(input) {
          const scope = normalizeScope(input);
          function allowed(operation) {
            if (closed) fail('DATABASE_CLOSED');
            if (authorize(scope,operation) !== true) fail('SCOPE_DENIED');
          }
          allowed('bind');
          async function transaction(mode,operation,work) {
            allowed(operation);
            const tx = db.transaction(STORES,mode);
            const done = completed(tx);
            // Attach an error observer immediately, even if a request fails first.
            done.catch(() => {});
            const guard = () => allowed(operation);
            try {
              const result = await work(tx.objectStore('records'),tx.objectStore('partitions'),guard);
              guard();
              await done;
              guard();
              return result;
            } catch (e) {
              try { tx.abort(); } catch (_) {}
              await done.catch(() => {});
              throw e;
            }
          }
          function append(input) {
            const batch = prepareBatch(input), partition = partitionKey(scope,'active-lab');
            return transaction('readwrite','append',async(records,meta,guard) => {
              const state = await request(meta.get(partition)) || {partition,count:0,revision:0};
              let added=0,duplicate=0;
              const keys=[];
              for(const row of batch) {
                guard();
                const old = await request(records.index('byId').get([partition,row.id]));
                if(old) {
                  if(old.encoded !== row.encoded) fail('IDEMPOTENCY_CONFLICT');
                  duplicate++; keys.push(old.sequence); continue;
                }
                if(!Number.isSafeInteger(state.count+1)) fail('SEQUENCE_EXHAUSTED');
                const sequence=++state.count;
                await request(records.add({partition,sequence,id:row.id,encoded:row.encoded}));
                added++; keys.push(sequence);
              }
              if(added) { guard(); state.revision++; await request(meta.put(state)); }
              return {added,duplicate,count:state.count,sequences:keys,revision:state.revision};
            });
          }
          function page(options) {
            options=options||{};
            const limit=options.limit===undefined?40:options.limit;
            const before=options.before===undefined||options.before===null?Number.MAX_SAFE_INTEGER:options.before;
            if(!Number.isSafeInteger(limit)||limit<1||limit>MAX_PAGE||!Number.isSafeInteger(before)||before<1) fail('INVALID_PAGE');
            const lane=options.shadow===true?'shadow':'active-lab',partition=partitionKey(scope,lane);
            return transaction('readonly','read',async(records,meta,guard)=>{
              const state=await request(meta.get(partition));
              if(before===1||!state) return {items:[],nextBefore:null,count:state?state.count:0};
              const items=[];
              await new Promise((resolve,reject)=>{
                const req=records.openCursor(range.bound([partition,1],[partition,before],false,true),'prev');
                req.onerror=()=>reject(req.error||new Error('CURSOR_FAILED'));
                req.onsuccess=()=>{
                  try {
                    guard();
                    const cursor=req.result;
                    if(!cursor||items.length===limit+1) { resolve(); return; }
                    const row=cursor.value;
                    items.push({id:row.id,sequence:row.sequence,payload:JSON.parse(row.encoded)});
                    if(items.length===limit+1) {resolve();return;}
                    cursor.continue();
                  }catch(e){reject(e);}
                };
              });
              const more=items.length>limit;
              if(more) items.pop();
              return {items,nextBefore:more?items[items.length-1].sequence:null,count:state.count};
            });
          }
          function get(recordId,options) {
            recordId=id(recordId);
            const partition=partitionKey(scope,options&&options.shadow===true?'shadow':'active-lab');
            return transaction('readonly','read',async(records,meta,guard)=>{
              const row=await request(records.index('byId').get([partition,recordId]));
              guard();
              return row?{id:row.id,sequence:row.sequence,payload:JSON.parse(row.encoded)}:null;
            });
          }
          // Shadow-only: caller supplies an immutable legacy JSON snapshot, never a storage key.
          // Hash and exact order/payload verification do not establish ownership of legacy data.
          async function copyLegacySnapshot(raw,cryptoProvider) {
            allowed('shadow');
            if(typeof raw!=='string'||raw.length*2>32*1024*1024||!cryptoProvider||!cryptoProvider.subtle) fail('INVALID_SNAPSHOT');
            let rows;
            try { rows=JSON.parse(raw); } catch(_){fail('INVALID_SNAPSHOT');}
            if(!Array.isArray(rows)) fail('INVALID_SNAPSHOT');
            // Validate every row before creating the manifest.
            rows.forEach(jsonRecord);
            const digest=await cryptoProvider.subtle.digest('SHA-256',new TextEncoder().encode(raw));
            const sourceHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
            const partition=partitionKey(scope,'shadow');
            let state=await transaction('readwrite','shadow',async(records,meta,guard)=>{
              const old=await request(meta.get(partition));
              if(old) {
                if(old.sourceHash!==sourceHash||old.total!==rows.length) fail('SNAPSHOT_CHANGED');
                return old;
              }
              const fresh={partition,count:0,verifiedCount:0,total:rows.length,sourceHash,status:'copying'};
              guard();await request(meta.add(fresh));return fresh;
            });
            // Each batch commits its checkpoint together with the records.
            while(state.count<rows.length) {
              const start=state.count;
              const end=Math.min(rows.length,start+MAX_BATCH);
              const chunk=[];let bytes=0;
              for(let i=start;i<end;i++){
                const encoded=jsonRecord(rows[i]);
                if(chunk.length&&bytes+encoded.length*2>MAX_BYTES)break;
                bytes+=encoded.length*2;
                chunk.push(encoded);
              }
              state=await transaction('readwrite','shadow',async(records,meta,guard)=>{
                const current=await request(meta.get(partition));
                if(!current||current.sourceHash!==sourceHash)fail('SNAPSHOT_CHANGED');
                // Concurrent copy of this exact snapshot may advance the checkpoint.
                if(current.count!==start)return current;
                for(let i=0;i<chunk.length;i++){
                  guard();
                  const sequence=start+i+1;
                  await request(records.add({partition,sequence,id:'legacy:'+sequence,encoded:chunk[i]}));
                }
                current.count=start+chunk.length;
                guard();await request(meta.put(current));return current;
              });
            }
            // Re-verify every row even on resume; no cached verified marker is trusted.
            for(let start=0;start<rows.length;start+=MAX_BATCH){
              const end=Math.min(rows.length,start+MAX_BATCH);
              await transaction('readonly','shadow',async(records,meta,guard)=>{
                for(let i=start;i<end;i++){
                  guard();
                  const row=await request(records.get([partition,i+1]));
                  if(!row||row.id!=='legacy:'+(i+1)||row.encoded!==jsonRecord(rows[i]))fail('SHADOW_VERIFY_FAILED');
                }
              });
            }
            return transaction('readwrite','shadow',async(records,meta,guard)=>{
              const current=await request(meta.get(partition));
              const actual=await request(records.count(range.bound([partition,1],[partition,Number.MAX_SAFE_INTEGER])));
              if(!current||current.sourceHash!==sourceHash||current.count!==rows.length||actual!==rows.length)fail('SHADOW_VERIFY_FAILED');
              current.verifiedCount=actual;current.status='verified-shadow';
              guard();await request(meta.put(current));
              return {sourceHash,count:actual,status:current.status,active:false};
            });
          }
          return Object.freeze({scope,append,page,get,copyLegacySnapshot});
        }
        resolve(Object.freeze({bind,close}));
      };
    });
  }
  global.MaoArchiveLab=Object.freeze({open,normalizeScope,prepareBatch,version:VERSION,stores:STORES});
})(typeof window !== 'undefined' ? window : globalThis);
