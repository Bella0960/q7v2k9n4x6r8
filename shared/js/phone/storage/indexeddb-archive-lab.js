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
  // Reject data that JSON would silently omit, coerce or truncate.
  function validateJSON(value, ancestors = new Set(), depth = 0) {
    if (depth > 128) fail('INVALID_PAYLOAD');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Object.is(value,-0)) fail('INVALID_PAYLOAD');
      return;
    }
    if (typeof value !== 'object' || ancestors.has(value)) fail('INVALID_PAYLOAD');
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : (proto !== Object.prototype && proto !== null)) fail('INVALID_PAYLOAD');
    const keys = Reflect.ownKeys(value);
    if (array && keys.length !== value.length + 1) fail('INVALID_PAYLOAD');
    ancestors.add(value);
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) fail('INVALID_PAYLOAD');
      const descriptor = Object.getOwnPropertyDescriptor(value,key);
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor,'value')) fail('INVALID_PAYLOAD');
      validateJSON(descriptor.value,ancestors,depth+1);
    }
    ancestors.delete(value);
  }
  function jsonRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_PAYLOAD');
    validateJSON(value);
    let encoded;
    try { encoded = JSON.stringify(value); } catch (_) { fail('INVALID_PAYLOAD'); }
    if (typeof encoded !== 'string' || encoded.length * 2 > MAX_BYTES) fail('PAYLOAD_TOO_LARGE');
    return encoded;
  }
  function validatePartition(state, partition, lane) {
    if (!state || state.partition !== partition || !Number.isSafeInteger(state.count) || state.count < 0 || state.count >= Number.MAX_SAFE_INTEGER) fail('CORRUPT_PARTITION');
    if (lane === 'shadow') {
      if (!Number.isSafeInteger(state.total) || state.total < state.count ||
          !Number.isSafeInteger(state.verifiedCount) || state.verifiedCount < 0 || state.verifiedCount > state.count ||
          typeof state.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(state.sourceHash) ||
          !['copying','verified-shadow'].includes(state.status) ||
          (state.status === 'verified-shadow' && (state.count !== state.total || state.verifiedCount !== state.total))) fail('CORRUPT_PARTITION');
    } else if (!Number.isSafeInteger(state.revision) || state.revision < 0 || state.revision > state.count) fail('CORRUPT_PARTITION');
    return state;
  }
  function decodeRow(row, partition, count) {
    if (!row || row.partition !== partition || !Number.isSafeInteger(row.sequence) || row.sequence < 1 || row.sequence > count ||
        typeof row.encoded !== 'string' || row.encoded.length * 2 > MAX_BYTES) fail('CORRUPT_RECORD');
    let payload;
    try { id(row.id); payload = JSON.parse(row.encoded); validateJSON(payload); }
    catch (_) { fail('CORRUPT_RECORD'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('CORRUPT_RECORD');
    return {id:row.id,sequence:row.sequence,payload};
  }
  function prepareBatch(input) {
    if (!Array.isArray(input) || !input.length || input.length > MAX_BATCH) fail('INVALID_BATCH');
    const seen = new Set(); let bytes = 0;
    return Array.from(input, item => {
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
        if (settled) { req.transaction.abort(); return; }
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
              const oldState = await request(meta.get(partition));
              const state = oldState ? validatePartition(oldState,partition,'active-lab') : {partition,count:0,revision:0};
              if(!oldState && await request(records.openKeyCursor(range.bound([partition,0],[partition,Number.MAX_SAFE_INTEGER]))))fail('CORRUPT_PARTITION');
              if (state.count && !(await request(records.get([partition,state.count])))) fail('CORRUPT_PARTITION');
              if (await request(records.get([partition,state.count+1]))) fail('CORRUPT_PARTITION');
              let added=0,duplicate=0;
              const keys=[];
              for(const row of batch) {
                guard();
                const old = await request(records.index('byId').get([partition,row.id]));
                if(old) {
                  decodeRow(old,partition,state.count);
                  if(old.encoded !== row.encoded) fail('IDEMPOTENCY_CONFLICT');
                  duplicate++; keys.push(old.sequence); continue;
                }
                if(!Number.isSafeInteger(state.count+1)||state.count+1>=Number.MAX_SAFE_INTEGER) fail('SEQUENCE_EXHAUSTED');
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
            return transaction('readonly',lane==='shadow'?'shadow':'read',async(records,meta,guard)=>{
              const state=await request(meta.get(partition));
              if(state) validatePartition(state,partition,lane);
              if(!state) {
                const orphan=await request(records.openKeyCursor(range.bound([partition,0],[partition,Number.MAX_SAFE_INTEGER])));
                if(orphan)fail('CORRUPT_PARTITION');
                return {items:[],nextBefore:null,count:0};
              }
              if(before===1)return {items:[],nextBefore:null,count:state.count};
              const items=[]; let bytes=0,more=false;
              let expected=Math.min(state.count,before-1);
              await new Promise((resolve,reject)=>{
                const req=records.openCursor(range.bound([partition,1],[partition,before],false,true),'prev');
                req.onerror=()=>reject(req.error||new Error('CURSOR_FAILED'));
                req.onsuccess=()=>{
                  try {
                    guard();
                    const cursor=req.result;
                    if(!cursor) { if(expected>0) fail('CORRUPT_PARTITION'); resolve(); return; }
                    const row=cursor.value;
                    if(row.sequence!==expected) fail('CORRUPT_PARTITION');
                    const decoded=decodeRow(row,partition,state.count);
                    const rowBytes=row.encoded.length*2;
                    if(items.length>=limit || (items.length && bytes+rowBytes>MAX_BYTES)) {more=true;resolve();return;}
                    items.push(decoded);bytes+=rowBytes;expected--;
                    cursor.continue();
                  }catch(e){reject(e);}
                };
              });
              return {items,nextBefore:more?items[items.length-1].sequence:null,count:state.count};
            });
          }
          function get(recordId,options) {
            recordId=id(recordId);
            const lane=options&&options.shadow===true?'shadow':'active-lab',partition=partitionKey(scope,lane);
            return transaction('readonly',lane==='shadow'?'shadow':'read',async(records,meta,guard)=>{
              const state=await request(meta.get(partition));
              if(state) validatePartition(state,partition,lane);
              const row=await request(records.index('byId').get([partition,recordId]));
              guard();
              if(!row)return null;
              if(!state || row.id!==recordId)fail('CORRUPT_RECORD');
              return decodeRow(row,partition,state.count);
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
                validatePartition(old,partition,'shadow');
                if(old.sourceHash!==sourceHash||old.total!==rows.length) fail('SNAPSHOT_CHANGED');
                // Invalidate an earlier verification marker before re-checking content.
                if(old.status==='verified-shadow'){old.status='copying';old.verifiedCount=0;guard();await request(meta.put(old));}
                return old;
              }
              if(await request(records.openKeyCursor(range.bound([partition,0],[partition,Number.MAX_SAFE_INTEGER]))))fail('CORRUPT_PARTITION');
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
                validatePartition(current,partition,'shadow');
                if(current.sourceHash!==sourceHash||current.total!==rows.length)fail('SNAPSHOT_CHANGED');
                if(current.count<start)fail('CORRUPT_PARTITION');
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
              validatePartition(current,partition,'shadow');
              if(current.sourceHash!==sourceHash||current.total!==rows.length||current.count!==rows.length||actual!==rows.length)fail('SHADOW_VERIFY_FAILED');
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
