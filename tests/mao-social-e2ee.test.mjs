import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {createMaoSocialE2EE} from '../worker/lib/mao-social-e2ee.js';
import {SQL as SOCIAL_SQL} from '../worker/migrations/0017_mao_social.js';
import {SQL as E2EE_SQL} from '../worker/migrations/0018_mao_social_e2ee.js';
import {SQL as MEDIA_SQL} from '../worker/migrations/0019_mao_social_e2ee_media.js';
import {MAX_MEDIA_BYTES,encryptMedia,decryptMedia,makeMediaMarker,parseMediaMarker} from '../chat/contacts/real-chat-media.mjs';
import {createDeviceIdentity,conversationKey,encryptText,decryptText,idForPublicKey}
  from '../chat/contacts/real-chat-crypto.mjs';

const subtle=webcrypto.subtle;
const A='MAO-AAAAAAAAAAAA',B='MAO-BBBBBBBBBBBB',C='MAO-CCCCCCCCCCCC';
const F='request_generation_0001',TIME=1794530000000;
// Modern Node exposes WebCrypto as a read-only global; browser helpers accept
// an explicit subtle object for deterministic two-device testing.

function setup({enabled=true}={}){
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('CREATE TABLE mao_accounts (id TEXT PRIMARY KEY,username TEXT,role TEXT,status TEXT,authorized_at INTEGER)');
  db.exec('CREATE TABLE mao_account_sessions (id TEXT PRIMARY KEY,account_id TEXT,expires_at INTEGER,revoked_at INTEGER)');
  db.exec('CREATE TABLE mao_account_audit (id TEXT PRIMARY KEY,actor_account_id TEXT,target_account_id TEXT,action TEXT,detail_json TEXT,created_at INTEGER)');
  for(const [id,name] of [[A,'Alice'],[B,'Bob'],[C,'Carol']]){
    db.prepare('INSERT INTO mao_accounts VALUES(?,?,?,?,?)').run(id,name,'user','active',TIME);
    db.prepare('INSERT INTO mao_account_sessions VALUES(?,?,?,NULL)').run(id+'-session',id,TIME+86400000);
  }
  db.exec(SOCIAL_SQL);db.exec(E2EE_SQL);db.exec(MEDIA_SQL);
  db.prepare("INSERT INTO mao_social_requests (id,requester_id,recipient_id,pair_low,pair_high,status,note,submitted_code_hash,created_at,updated_at) VALUES(?,?,?,?,?,'approved','','hash',?,?)").run(F,A,B,A,B,TIME,TIME);
  db.prepare("INSERT INTO mao_social_friends(pair_low,pair_high,source_request_id,status,updated_at) VALUES(?,?,?,'accepted',?)").run(A,B,F,TIME);
  const exec=(sql,...args)=>{
    const stmt=db.prepare(sql);
    if(/^\s*SELECT\b/i.test(sql)||/\bRETURNING\b/i.test(sql))return stmt.all(...args);
    stmt.run(...args);return [];
  };
  const store={exec,transaction(fn){
    db.exec('BEGIN IMMEDIATE');
    try{const value=fn();db.exec('COMMIT');return value}
    catch(e){db.exec('ROLLBACK');throw e}
  }};
  const service=createMaoSocialE2EE({store,env:{MAO_SOCIAL_E2EE_ENABLED:enabled?'true':'false'},now:()=>TIME});
  async function call(id,path,method='GET',body){
    const request=new Request('https://mao.example'+path,{method,...(body?{
      headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
    const actor={account_id:id,session_id:id+'-session',role:'user',status:'active',authorized_at:TIME};
    try{
      const response=await service.handle(request,path.split('?')[0],method,actor);
      return {status:response.status,body:await response.json()};
    }catch(error){return {status:error.status||500,body:{error:{code:error.code||'INTERNAL',message:error.message}}}}
  }
  return {db,exec,call,close:()=>db.close()};
}
const K='/api/social/e2ee/keys',M='/api/social/e2ee/chats/'+B+'/messages';

test('WebCrypto supports nonexportable two-device ECDH/HKDF/AES-GCM and binds message to friendship',async()=>{
  const alice=await createDeviceIdentity(subtle),bob=await createDeviceIdentity(subtle);
  assert.equal(alice.privateKey.extractable,false);
  assert.equal(bob.privateKey.extractable,false);
  assert.equal(alice.keyId,await idForPublicKey(alice.publicKey,subtle));
  const a=await conversationKey(alice.privateKey,bob.publicKey,F,A,B,subtle);
  const b=await conversationKey(bob.privateKey,alice.publicKey,F,B,A,subtle);
  const data={friendshipId:F,senderId:A,recipientId:B,clientMessageId:'msg_persisted_v1',
    sk:alice.keyId,rk:bob.keyId};
  const envelope=await encryptText('晚上好，小鱼！',a,data,subtle,webcrypto.getRandomValues.bind(webcrypto));
  assert.equal(envelope.v,1);
  assert.ok(!JSON.stringify(envelope).includes('小鱼'));
  assert.equal(await decryptText(envelope,b,data,subtle),'晚上好，小鱼！');
  await assert.rejects(decryptText(envelope,b,{...data,clientMessageId:'wrong'},subtle));
  await assert.rejects(decryptText(envelope,b,{...data,friendshipId:'new_approval'},subtle));
  await assert.rejects(decryptText({...envelope,ct:envelope.ct.slice(0,-2)+'00'},b,data,subtle));
});

test('service stores ciphertext only, enforces exact device identities and supports deduplicated retry',async t=>{
  const x=setup();t.after(x.close);
  const alice=await createDeviceIdentity(subtle),bob=await createDeviceIdentity(subtle);
  assert.equal((await x.call(C,K+'/'+A)).status,403,'unapproved stranger cannot inspect keys');
  assert.equal((await x.call(A,K,'POST',{publicKey:alice.publicKey})).status,200);
  assert.equal((await x.call(B,K,'POST',{publicKey:bob.publicKey})).status,200);
  assert.equal((await x.call(A,K,'POST',{publicKey:alice.publicKey})).body.replay,true);
  assert.equal((await x.call(B,K+'/'+A)).body.key.keyId,alice.keyId);
  assert.equal((await x.call(A,K,'POST',{publicKey:bob.publicKey})).status,409);
  const key=await conversationKey(alice.privateKey,bob.publicKey,F,A,B,subtle);
  const clientMessageId='msg_e2ee_first_message_001';
  const meta={friendshipId:F,senderId:A,recipientId:B,clientMessageId,sk:alice.keyId,rk:bob.keyId};
  const envelope=await encryptText('中文双机互发，服务器不能读到明文',key,meta,subtle,webcrypto.getRandomValues.bind(webcrypto));
  const posted=await x.call(A,M,'POST',{friendshipId:F,clientMessageId,envelope});
  assert.equal(posted.status,200,JSON.stringify(posted.body));
  assert.equal(posted.body.message.senderId,A);
  assert.equal(posted.body.message.clientMessageId,clientMessageId);
  assert.ok(!JSON.stringify(posted.body).includes('中文双机互发'));
  const stored=x.db.prepare('SELECT body FROM mao_social_messages').get().body;
  assert.equal(stored,JSON.stringify(envelope));
  assert.ok(!stored.includes('中文'));
  const reply=await x.call(B,'/api/social/e2ee/chats/'+A+'/messages?after=0');
  assert.equal(reply.status,200);
  assert.equal(reply.body.messages.length,1);
  assert.equal(reply.body.messages[0].text,undefined);
  const bobKey=await conversationKey(bob.privateKey,alice.publicKey,F,B,A,subtle);
  assert.equal(await decryptText(reply.body.messages[0].envelope,bobKey,{...meta},subtle),
    '中文双机互发，服务器不能读到明文');
  assert.equal((await x.call(A,M,'POST',{friendshipId:F,clientMessageId,envelope})).body.replay,true);
  assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM mao_social_messages').get().n,1);
  const plain=await x.call(A,M,'POST',{friendshipId:F,clientMessageId:'msg_plaintext_001',
    text:'SHOULD_NOT_STORE',envelope});
  assert.equal(plain.status,400);
  assert.equal(plain.body.error.code,'E2EE_PLAINTEXT_REJECTED');
  const changed=await x.call(A,M,'POST',{friendshipId:F,clientMessageId,
    envelope:{...envelope,iv:'AAAAAAAAAAAAAAAA'}});
  assert.equal(changed.status,409);
  const wrong=await x.call(A,M,'POST',{friendshipId:F,clientMessageId:'msg_bad_sender_key',
    envelope:{...envelope,sk:'f'.repeat(32)}});
  assert.equal(wrong.status,409);
  x.exec("UPDATE mao_social_friends SET status='removed' WHERE pair_low=? AND pair_high=?",A,B);
  assert.equal((await x.call(A,M)).status,403);
  assert.equal((await x.call(B,K+'/'+A)).status,403);
});

test('E2EE feature remains server-disabled by default, rejects invalid point and never reuses plaintext',async t=>{
  const blocked=setup({enabled:false});t.after(blocked.close);
  assert.equal((await blocked.call(A,K)).status,503);
  assert.equal(blocked.exec('SELECT COUNT(*) AS n FROM mao_social_e2ee_keys')[0].n,0);
  const x=setup();t.after(x.close);
  const bad=await x.call(A,K,'POST',{publicKey:'B'+'A'.repeat(86)});
  assert.equal(bad.status,400);
  const invalid=await x.call(A,M,'POST',{friendshipId:F,clientMessageId:'msg_invalid_payload',
    envelope:{v:1,iv:'AAAAAAAAAAAAAAAA',ct:'hello',sk:'0'.repeat(32),rk:'1'.repeat(32)}});
  assert.equal(invalid.status,400);
  assert.equal(x.exec('SELECT COUNT(*) AS n FROM mao_social_messages')[0].n,0);
});

test('one new independent chat page is wired into approved friends, without AI APIs or plaintext transport',async()=>{
  const {readFileSync}=await import('node:fs');
  const page=readFileSync(new URL('../chat/contacts/real-chat.html',import.meta.url),'utf8');
  const friends=readFileSync(new URL('../chat/contacts/real-friends.html',import.meta.url),'utf8');
  const backend=readFileSync(new URL('../worker/lib/mao-social-e2ee.js',import.meta.url),'utf8');
  assert.match(friends,/real-chat\.html\?peer=/);
  assert.match(page,/real-chat-crypto\.mjs/);
  assert.match(page,/encryptText\(/);
  assert.match(page,/decryptText\(/);
  assert.match(page,/setInterval\(/);
  assert.match(page,/3000/);
  assert.match(page,/x-mao-account-context/);
  assert.match(page,/清除网站数据/);
  assert.match(backend,/E2EE_PLAINTEXT_REJECTED/);
  assert.doesNotMatch(page,/\/api\/ai\//);
});


test('image and recorded voice travel as separate ciphertext blobs scoped to approved E2EE friendship',async t=>{
  const x=setup();t.after(x.close);
  const alice=await createDeviceIdentity(subtle),bob=await createDeviceIdentity(subtle);
  assert.equal((await x.call(A,K,'POST',{publicKey:alice.publicKey})).status,200);
  assert.equal((await x.call(B,K,'POST',{publicKey:bob.publicKey})).status,200);
  const outbound=await conversationKey(alice.privateKey,bob.publicKey,F,A,B,subtle);
  const inbound=await conversationKey(bob.privateKey,alice.publicKey,F,B,A,subtle);
  const cases=[
    {kind:'image',mime:'image/jpeg',bytes:new TextEncoder().encode('SYNTHETIC_JPEG_PRIVATE_IMAGE_BYTES')},
    {kind:'voice',mime:'audio/mp4',bytes:new TextEncoder().encode('SYNTHETIC_M4A_VOICE_PRIVATE_BYTES')},
    {kind:'voice',mime:'audio/webm',bytes:new TextEncoder().encode('SYNTHETIC_WEBM_VOICE_PRIVATE_BYTES')}
  ];
  for(let i=0;i<cases.length;i++){
    const item=cases[i];
    const mediaId='med_example_attachment_'+String(i).padStart(16,'0');
    const clientMessageId='msg_media_unit_test_'+String(i).padStart(8,'0');
    const meta={friendshipId:F,senderId:A,recipientId:B,clientMessageId,
      mediaId,kind:item.kind,mime:item.mime,sk:alice.keyId,rk:bob.keyId};
    const attachment=await encryptMedia(item.bytes,outbound,meta,subtle,webcrypto.getRandomValues.bind(webcrypto));
    const envelope=await encryptText(makeMediaMarker(mediaId,item.kind),outbound,meta,subtle,webcrypto.getRandomValues.bind(webcrypto));
    const path='/api/social/e2ee/chats/'+B+'/media';
    const body={clientMessageId,friendshipId:F,envelope,attachment};
    const accepted=await x.call(A,path,'POST',body);
    assert.equal(accepted.status,200,JSON.stringify(accepted.body));
    assert.equal(accepted.body.mediaId,mediaId);
    const received=await x.call(B,'/api/social/e2ee/chats/'+A+'/media/'+mediaId);
    assert.equal(received.status,200,JSON.stringify(received.body));
    assert.equal(received.body.friendshipId,F);
    assert.equal(received.body.clientMessageId,clientMessageId);
    const decoded=await decryptMedia(received.body.attachment,inbound,meta,subtle);
    assert.deepEqual(decoded,item.bytes);
    const stored=x.db.prepare('SELECT ciphertext FROM mao_social_e2ee_media WHERE id=?').get(mediaId);
    assert.equal(stored.ciphertext,attachment.ct);
    assert.ok(!stored.ciphertext.includes('PRIVATE'));
    const repeat=await x.call(A,path,'POST',body);
    assert.equal(repeat.status,200);
    assert.equal(repeat.body.replay,true);
    const forged=await x.call(A,path,'POST',{...body,attachment:{...attachment,iv:'AAAAAAAAAAAAAAAA'}});
    assert.equal(forged.status,409,'same message ID must not accept different encrypted media');
    const unauthorized=await x.call(C,'/api/social/e2ee/chats/'+A+'/media/'+mediaId);
    assert.equal(unauthorized.status,403);
    await assert.rejects(decryptMedia(received.body.attachment,inbound,{...meta,recipientId:C},subtle));
    assert.equal(parseMediaMarker(await decryptText(envelope,inbound,meta,subtle)).id,mediaId);
  }
  assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM mao_social_e2ee_media').get().n,3);
  assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM mao_social_messages').get().n,3);
  const history=await x.call(B,'/api/social/e2ee/chats/'+A+'/messages?after=0');
  assert.equal(history.body.messages.length,3);
  assert.ok(history.body.messages.every(m=>!('attachment' in m) && !('text' in m)),
    'regular conversation polling must not carry large ciphertext blobs');

  x.exec("UPDATE mao_social_friends SET status='removed' WHERE pair_low=? AND pair_high=?",A,B);
  assert.equal((await x.call(B,'/api/social/e2ee/chats/'+A+'/media/'+
    'med_example_attachment_0000000000000000')).status,403);
});

test('media upload rejects plaintext, unsupported types, invalid size and stolen ciphertext identity',async t=>{
  const x=setup();t.after(x.close);
  const alice=await createDeviceIdentity(subtle),bob=await createDeviceIdentity(subtle);
  await x.call(A,K,'POST',{publicKey:alice.publicKey});
  await x.call(B,K,'POST',{publicKey:bob.publicKey});
  const key=await conversationKey(alice.privateKey,bob.publicKey,F,A,B,subtle);
  const meta={friendshipId:F,senderId:A,recipientId:B,clientMessageId:'msg_bad_media_payload_0001',
    mediaId:'med_invalid_file_0000000000000001',kind:'image',mime:'image/jpeg',
    sk:alice.keyId,rk:bob.keyId};
  const attachment=await encryptMedia(new Uint8Array([1,2,3,4,5]),key,meta,
    subtle,webcrypto.getRandomValues.bind(webcrypto));
  const envelope=await encryptText(makeMediaMarker(meta.mediaId,'image'),key,meta,subtle,
    webcrypto.getRandomValues.bind(webcrypto));
  const path='/api/social/e2ee/chats/'+B+'/media';
  const plain=await x.call(A,path,'POST',{clientMessageId:meta.clientMessageId,friendshipId:F,
    envelope,attachment,bytes:'rawPhoto'});
  assert.equal(plain.status,400);
  assert.equal(plain.body.error.code,'E2EE_PLAINTEXT_REJECTED');
  const badMime=await x.call(A,path,'POST',{clientMessageId:meta.clientMessageId,friendshipId:F,
    envelope,attachment:{...attachment,mime:'image/svg+xml'}});
  assert.equal(badMime.status,400);
  const badKeys=await x.call(A,path,'POST',{clientMessageId:meta.clientMessageId,friendshipId:F,
    envelope,attachment:{...attachment,sk:'0'.repeat(32)}});
  assert.equal(badKeys.status,409);
  await assert.rejects(encryptMedia(new Uint8Array(MAX_MEDIA_BYTES+1),key,meta,
    subtle,webcrypto.getRandomValues.bind(webcrypto)));
  assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM mao_social_e2ee_media').get().n,0);
});

test('only two compact image and microphone controls are added to the existing private chat footer',async()=>{
  const {readFileSync}=await import('node:fs');
  const source=readFileSync(new URL('../chat/contacts/real-chat.html',import.meta.url),'utf8');
  const server=readFileSync(new URL('../worker/lib/mao-social-e2ee.js',import.meta.url),'utf8');
  for(const id of ['photoBtn','voiceBtn','photoInput'])assert.match(source,new RegExp('id="'+id+'"'));
  assert.match(source,/getUserMedia/);
  assert.match(source,/MediaRecorder/);
  assert.match(source,/encryptMedia/);
  assert.match(source,/decryptMedia/);
  assert.match(source,/image\/jpeg/);
  assert.match(source,/recorder\.start/);
  assert.match(source,/MAX_MEDIA_BYTES/);
  assert.doesNotMatch(source,/\/api\/ai\//);
  assert.match(server,/E2EE_PLAINTEXT_REJECTED/);
});


test('home chat list is scoped to approved friends, sorted by latest encrypted-message metadata only',async t=>{
  const x=setup();t.after(x.close);
  const route='/api/social/e2ee/conversations';
  const first=await x.call(A,route);
  assert.equal(first.status,200,JSON.stringify(first.body));
  assert.equal(first.body.ownerAccountId,A);
  assert.deepEqual(first.body.conversations.map(r=>r.id),[B]);
  assert.equal(first.body.conversations[0].lastMessageAt,null);
  assert.deepEqual((await x.call(C,route)).body.conversations,[],
    'stranger may not see approved conversations');
  const a=await createDeviceIdentity(subtle);
  const b=await createDeviceIdentity(subtle);
  await x.call(A,K,'POST',{publicKey:a.publicKey});
  await x.call(B,K,'POST',{publicKey:b.publicKey});
  const key=await conversationKey(a.privateKey,b.publicKey,F,A,B,subtle);
  const mid='msg_home_chat_list_0000001';
  const envelope=await encryptText('不应出现在列表里的真实消息明文',key,{
    friendshipId:F,senderId:A,recipientId:B,clientMessageId:mid,sk:a.keyId,rk:b.keyId
  },subtle,webcrypto.getRandomValues.bind(webcrypto));
  const posted=await x.call(A,M,'POST',{friendshipId:F,clientMessageId:mid,envelope});
  assert.equal(posted.status,200);
  const updated=await x.call(B,route);
  assert.equal(updated.status,200);
  assert.equal(updated.body.ownerAccountId,B);
  assert.deepEqual(updated.body.conversations.map(r=>r.id),[A]);
  assert.equal(updated.body.conversations[0].lastMessageAt,TIME);
  const payload=JSON.stringify(updated.body);
  assert.ok(!payload.includes('不应出现在列表里'));
  assert.ok(!payload.includes(envelope.ct));
  assert.ok(!payload.includes('publicKey'));
  assert.equal((await x.call(C,route)).body.conversations.length,0);
  x.exec('UPDATE mao_social_friends SET status=? WHERE pair_low=? AND pair_high=?','removed',A,B);
  assert.deepEqual((await x.call(B,route)).body.conversations,[],
    'removed friendship must disappear regardless of old messages');
  x.exec('UPDATE mao_social_friends SET status=? WHERE pair_low=? AND pair_high=?','accepted',A,B);
  x.exec('INSERT INTO mao_social_blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)',A,B,TIME);
  assert.deepEqual((await x.call(B,route)).body.conversations,[],
    'blocked peer must not remain visible');
  x.exec('DELETE FROM mao_social_blocks');
  x.exec('UPDATE mao_accounts SET status=? WHERE id=?','disabled',B);
  assert.deepEqual((await x.call(A,route)).body.conversations,[],
    'disabled friend must not remain visible');
  x.exec('UPDATE mao_accounts SET status=? WHERE id=?','active',B);
  x.exec('UPDATE mao_accounts SET status=? WHERE id=?','disabled',A);
  const off=await x.call(A,route);
  assert.equal(off.status,401,'disabled account must not enumerate former friendships');
});


test('new voice durations are encrypted inside marker; all historical media markers remain readable',async()=>{
  const id='med_test_duration_0000000000000001';
  const oldVoice=makeMediaMarker(id,'voice');
  const oldImage=makeMediaMarker(id,'image');
  assert.deepEqual(parseMediaMarker(oldVoice),{kind:'voice',id});
  assert.deepEqual(parseMediaMarker(oldImage),{kind:'image',id});
  const marker=makeMediaMarker(id,'voice',2);
  assert.equal(marker,'MAO_MEDIA:voice:'+id+':2');
  assert.deepEqual(parseMediaMarker(marker),{kind:'voice',id,durationSeconds:2});
  assert.deepEqual(parseMediaMarker(makeMediaMarker(id,'voice',20)),{kind:'voice',id,durationSeconds:20});
  assert.throws(()=>makeMediaMarker(id,'image',2));
  assert.throws(()=>makeMediaMarker(id,'voice',0));
  assert.throws(()=>makeMediaMarker(id,'voice',2.3));
  assert.equal(parseMediaMarker('MAO_MEDIA:image:'+id+':2'),null);
  assert.equal(parseMediaMarker('MAO_MEDIA:voice:'+id+':999'),null);
  const alice=await createDeviceIdentity(subtle);
  const bob=await createDeviceIdentity(subtle);
  const shared=await conversationKey(alice.privateKey,bob.publicKey,F,A,B,subtle);
  const idempotency='voice_recording_seconds_000001';
  const meta={friendshipId:F,senderId:A,recipientId:B,clientMessageId:idempotency,
    sk:alice.keyId,rk:bob.keyId};
  const encrypted=await encryptText(marker,shared,meta,subtle,webcrypto.getRandomValues.bind(webcrypto));
  assert.ok(!JSON.stringify(encrypted).includes('MAO_MEDIA:'));
  const received=await conversationKey(bob.privateKey,alice.publicKey,F,B,A,subtle);
  const decoded=parseMediaMarker(await decryptText(encrypted,received,meta,subtle));
  assert.equal(decoded.durationSeconds,2);
  assert.equal(decoded.id,id);
});
