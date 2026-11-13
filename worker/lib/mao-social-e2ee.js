import {ApiError, ok, readJsonBody} from './http.js';
import {randomToken, sha256Hex} from './crypto.js';

const ACCOUNT = /^MAO-[A-Z0-9]{12,24}$/;
const CLIENT_MESSAGE_ID = /^[A-Za-z0-9_-]{8,96}$/;
const PUBLIC_KEY = /^B[A-Za-z0-9_-]{86}$/;
const KEY_ID = /^[a-f0-9]{32}$/;
const IV = /^[A-Za-z0-9_-]{16}$/;
const CIPHER = /^[A-Za-z0-9_-]{22,1800}$/;
const MEDIA_ID = /^med_[A-Za-z0-9_-]{16,64}$/;
const MEDIA_CIPHER = /^[A-Za-z0-9_-]{24,560000}$/;
const MEDIA_MIME = {
  image: new Set(['image/jpeg']),
  voice: new Set(['audio/mp4','audio/webm','audio/ogg','audio/aac','audio/wav'])
};

const one = (store, sql, ...args) => store.exec(sql, ...args)[0] || null;
const pair = (a,b) => a < b ? [a,b] : [b,a];
const reject = (code,msg='参数格式不正确') => {throw new ApiError(400,code,msg)};
const requireString = (value,pattern,code) => {
  if(typeof value!=='string' || !pattern.test(value)) reject(code);
  return value;
};

async function verifyP256PublicKey(value) {
  requireString(value,PUBLIC_KEY,'E2EE_PUBLIC_KEY_INVALID');
  let raw;
  try {
    const bytes = atob(value.replace(/-/g,'+').replace(/_/g,'/'));
    raw = Uint8Array.from(bytes, x => x.charCodeAt(0));
    if (raw.length!==65 || raw[0]!==4) throw Error('bad point');
    await crypto.subtle.importKey('raw',raw,{name:'ECDH',namedCurve:'P-256'},true,[]);
  } catch {
    throw new ApiError(400,'E2EE_PUBLIC_KEY_INVALID','设备加密公钥无效');
  }
  return value;
}

function validateEnvelope(value) {
  if (!value || typeof value!=='object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',')!=='ct,iv,rk,sk,v' ||
      value.v!==1) reject('E2EE_PAYLOAD_INVALID','只接受加密消息，不允许明文');
  requireString(value.iv,IV,'E2EE_IV_INVALID');
  requireString(value.ct,CIPHER,'E2EE_CIPHERTEXT_INVALID');
  requireString(value.sk,KEY_ID,'E2EE_SENDER_KEY_INVALID');
  requireString(value.rk,KEY_ID,'E2EE_RECIPIENT_KEY_INVALID');
  const data=JSON.stringify(value);
  if(data.length>1900) throw new ApiError(413,'E2EE_MESSAGE_TOO_LONG','加密消息过长，请拆分发送');
  return data;
}

function validateMedia(value) {
  if (!value || typeof value!=='object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',')!=='ct,id,iv,kind,mime,rk,sk,v' ||
      value.v!==1) reject('E2EE_MEDIA_INVALID','仅接受加密图片和语音');
  requireString(value.id,MEDIA_ID,'E2EE_MEDIA_ID_INVALID');
  requireString(value.iv,IV,'E2EE_MEDIA_IV_INVALID');
  requireString(value.ct,MEDIA_CIPHER,'E2EE_MEDIA_CIPHERTEXT_INVALID');
  requireString(value.sk,KEY_ID,'E2EE_MEDIA_SENDER_KEY_INVALID');
  requireString(value.rk,KEY_ID,'E2EE_MEDIA_RECIPIENT_KEY_INVALID');
  if(!MEDIA_MIME[value.kind]?.has(value.mime)) {
    reject('E2EE_MEDIA_TYPE_INVALID','只允许加密 JPEG 图片和语音文件');
  }
  return value;
}

export function createMaoSocialE2EE({store,env={},now=()=>Date.now()}) {
  const rows=(sql,...args)=>store.exec(sql,...args);
  const query=(sql,...args)=>one(store,sql,...args);
  const transaction=(fn)=>store.transaction(fn);

  function assertSession(actor, time) {
    if (!query("SELECT s.id FROM mao_account_sessions s JOIN mao_accounts a ON a.id = s.account_id "+
      "WHERE s.id=? AND s.account_id=? AND s.revoked_at IS NULL AND s.expires_at>? "+
      "AND a.status='active' AND (a.role='super_admin' OR a.authorized_at IS NOT NULL) LIMIT 1",
      actor.session_id,actor.account_id,time)) {
      throw new ApiError(401,'SOCIAL_SESSION_EXPIRED','当前账号已退出或授权过期');
    }
  }

  function relation(actor,peer) {
    if (!ACCOUNT.test(peer) || peer===actor.account_id) {
      throw new ApiError(400,'SOCIAL_PEER_INVALID','好友账号无效');
    }
    const eligible=(id)=>query("SELECT id FROM mao_accounts WHERE id=? AND status='active' "+
      "AND (role='super_admin' OR authorized_at IS NOT NULL)",id);
    if (!eligible(actor.account_id) || !eligible(peer)) {
      throw new ApiError(403,'SOCIAL_ACCOUNT_NOT_ACTIVE','好友账号已停用或未授权');
    }
    const [low,high]=pair(actor.account_id,peer);
    if (query("SELECT 1 AS found FROM mao_social_blocks WHERE "+
      "(blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?) LIMIT 1",
      low,high,high,low)) {
      throw new ApiError(403,'SOCIAL_BLOCKED','无法与该账号联系');
    }
    const friend=query("SELECT source_request_id FROM mao_social_friends "+
      "WHERE pair_low=? AND pair_high=? AND status='accepted'",low,high);
    if (!friend) throw new ApiError(403,'SOCIAL_NOT_APPROVED','未通过双方同意和 001 审批');
    return {low,high,friendshipId:friend.source_request_id};
  }

  function publicKey(actor,id) {
    const record=query('SELECT account_id,public_key,key_id,created_at FROM mao_social_e2ee_keys WHERE account_id=?',id);
    return ok({ownerAccountId:actor.account_id,accountId:id,
      key:record?{publicKey:record.public_key,keyId:record.key_id,createdAt:Number(record.created_at)}:null});
  }

  async function register(request,actor) {
    const body=await readJsonBody(request,1024);
    const key=await verifyP256PublicKey(body.publicKey);
    const id=(await sha256Hex(key)).slice(0,32);
    return transaction(()=>{
      const time=now();
      assertSession(actor,time);
      const old=query('SELECT public_key,key_id FROM mao_social_e2ee_keys WHERE account_id=?',actor.account_id);
      if(old) {
        if(old.public_key!==key)throw new ApiError(409,'E2EE_DEVICE_EXISTS',
          '此账号已经绑定另一台设备的聊天密钥。为保护旧聊天，不会直接覆盖。');
        return ok({ownerAccountId:actor.account_id,keyId:old.key_id,registered:true,replay:true});
      }
      // Fail closed: an account cannot silently reuse a different account's key.
      if(query('SELECT account_id FROM mao_social_e2ee_keys WHERE public_key=?',key)){
        throw new ApiError(409,'E2EE_KEY_ALREADY_USED','设备密钥已被其他账号使用');
      }
      rows('INSERT INTO mao_social_e2ee_keys(account_id,public_key,key_id,created_at) VALUES(?,?,?,?)',
        actor.account_id,key,id,time);
      return ok({ownerAccountId:actor.account_id,keyId:id,registered:true});
    });
  }

  function messages(request,actor,peer,method) {
    if(method==='GET') {
      const after=Number(new URL(request.url).searchParams.get('after')||0);
      if(!Number.isSafeInteger(after)||after<0)reject('SOCIAL_CURSOR_INVALID');
      return transaction(()=>{
        assertSession(actor,now());
        const {low,high,friendshipId}=relation(actor,peer);
        const list=rows("SELECT seq,id,sender_id,recipient_id,client_message_id,body,created_at "+
          "FROM mao_social_messages WHERE pair_low=? AND pair_high=? "+
          "AND source_request_id=? AND seq>? ORDER BY seq LIMIT 50",low,high,friendshipId,after);
        return ok({ownerAccountId:actor.account_id,peerId:peer,friendshipId,
          messages:list.map(row=>{
            let envelope;
            try{envelope=JSON.parse(row.body);validateEnvelope(envelope)}
            catch{throw new ApiError(503,'E2EE_MESSAGE_FORMAT_ERROR','聊天记录含无法验证的旧消息格式');}
            return {seq:Number(row.seq),id:row.id,senderId:row.sender_id,
              recipientId:row.recipient_id,clientMessageId:row.client_message_id,
              envelope,createdAt:Number(row.created_at)};
          }),nextCursor:list.length?Number(list[list.length-1].seq):after});
      });
    }
    throw new Error('Encrypted POST requires prevalidated JSON');
  }

  async function send(request,actor,peer) {
    const body=await readJsonBody(request,3400);
    const clientMessageId=requireString(body.clientMessageId,CLIENT_MESSAGE_ID,'SOCIAL_MESSAGE_ID_INVALID');
    const expectedFriendshipId=requireString(body.friendshipId,CLIENT_MESSAGE_ID,'SOCIAL_FRIENDSHIP_ID_REQUIRED');
    if('text' in body || 'plaintext' in body)reject('E2EE_PLAINTEXT_REJECTED','服务端拒绝明文消息');
    const serialized=validateEnvelope(body.envelope);
    return transaction(()=>{
      const time=now();
      assertSession(actor,time);
      const {low,high,friendshipId}=relation(actor,peer);
      if(friendshipId!==expectedFriendshipId){
        throw new ApiError(409,'SOCIAL_FRIENDSHIP_CHANGED','好友关系已更新，请重新打开聊天');
      }
      const sender=query('SELECT key_id FROM mao_social_e2ee_keys WHERE account_id=?',actor.account_id);
      const recipient=query('SELECT key_id FROM mao_social_e2ee_keys WHERE account_id=?',peer);
      if(!sender||!recipient)throw new ApiError(409,'E2EE_PEER_NOT_READY','请双方先打开聊天，完成设备加密准备');
      if(body.envelope.sk!==sender.key_id||body.envelope.rk!==recipient.key_id){
        throw new ApiError(409,'E2EE_KEY_CHANGED','双方设备密钥与消息不一致，请重新进入聊天');
      }
      const old=query('SELECT * FROM mao_social_messages WHERE sender_id=? AND client_message_id=?',
        actor.account_id,clientMessageId);
      if(old){
        if(old.recipient_id!==peer||old.source_request_id!==friendshipId||old.body!==serialized)
          throw new ApiError(409,'SOCIAL_MESSAGE_ID_REUSED','消息编号已绑定另一条加密消息');
        return ok({friendshipId,replay:true,message:{id:old.id,seq:Number(old.seq),
          senderId:actor.account_id,recipientId:peer,clientMessageId,
          envelope:body.envelope,createdAt:Number(old.created_at)}});
      }
      const recent=query('SELECT COUNT(*) AS n FROM mao_social_messages WHERE sender_id=? AND created_at>?',
        actor.account_id,time-60000);
      if(Number(recent.n)>=60)throw new ApiError(429,'SOCIAL_MESSAGE_RATE_LIMIT','发送过于频繁，请稍后重试');
      const id='msg_'+randomToken(18);
      const inserted=rows('INSERT INTO mao_social_messages '+
        '(id,pair_low,pair_high,source_request_id,sender_id,recipient_id,client_message_id,body,created_at) '+
        'VALUES(?,?,?,?,?,?,?,?,?) RETURNING seq',id,low,high,friendshipId,
        actor.account_id,peer,clientMessageId,serialized,time);
      return ok({friendshipId,message:{id,seq:Number(inserted[0].seq),senderId:actor.account_id,
        recipientId:peer,clientMessageId,envelope:body.envelope,createdAt:time}});
    });
  }

  // One atomic SQLite transaction creates the encrypted marker message and
  // ciphertext attachment, so failed uploads cannot publish an orphaned item.
  async function sendMedia(request,actor,peer) {
    const body=await readJsonBody(request,600000);
    if('text' in body || 'plaintext' in body || 'bytes' in body) {
      reject('E2EE_PLAINTEXT_REJECTED','服务器只接收加密后的媒体');
    }
    const clientMessageId=requireString(body.clientMessageId,CLIENT_MESSAGE_ID,'SOCIAL_MESSAGE_ID_INVALID');
    const expectedFriendshipId=requireString(body.friendshipId,CLIENT_MESSAGE_ID,'SOCIAL_FRIENDSHIP_ID_REQUIRED');
    const envelope=validateEnvelope(body.envelope);
    const attachment=validateMedia(body.attachment);
    return transaction(()=>{
      const time=now();
      assertSession(actor,time);
      const {low,high,friendshipId}=relation(actor,peer);
      if(friendshipId!==expectedFriendshipId) {
        throw new ApiError(409,'SOCIAL_FRIENDSHIP_CHANGED','好友关系已更新，请重新打开聊天');
      }
      const sender=query('SELECT key_id FROM mao_social_e2ee_keys WHERE account_id=?',actor.account_id);
      const recipient=query('SELECT key_id FROM mao_social_e2ee_keys WHERE account_id=?',peer);
      if(!sender||!recipient)throw new ApiError(409,'E2EE_PEER_NOT_READY','双方设备尚未登记加密密钥');
      if(attachment.sk!==sender.key_id||attachment.rk!==recipient.key_id||
         body.envelope.sk!==sender.key_id||body.envelope.rk!==recipient.key_id){
        throw new ApiError(409,'E2EE_KEY_CHANGED','媒体加密密钥与双方账号不一致');
      }
      const existing=query('SELECT * FROM mao_social_messages WHERE sender_id=? AND client_message_id=?',
        actor.account_id,clientMessageId);
      if(existing){
        const media=query('SELECT * FROM mao_social_e2ee_media WHERE message_id=?',existing.id);
        if(!media||existing.recipient_id!==peer||existing.source_request_id!==friendshipId||
           existing.body!==envelope||media.id!==attachment.id||media.kind!==attachment.kind||
           media.mime!==attachment.mime||media.iv!==attachment.iv||
           media.ciphertext!==attachment.ct||media.sender_key_id!==attachment.sk||
           media.recipient_key_id!==attachment.rk){
          throw new ApiError(409,'SOCIAL_MESSAGE_ID_REUSED','这条消息编号已被另一条消息占用');
        }
        return ok({friendshipId,replay:true,message:{
          id:existing.id,seq:Number(existing.seq),clientMessageId,
          senderId:actor.account_id,recipientId:peer,envelope:body.envelope,
          createdAt:Number(existing.created_at)},mediaId:attachment.id});
      }
      if(query('SELECT id FROM mao_social_e2ee_media WHERE id=?',attachment.id)){
        throw new ApiError(409,'E2EE_MEDIA_ID_REUSED','该媒体编号已经使用');
      }
      const minute=query('SELECT COUNT(*) AS n FROM mao_social_messages WHERE sender_id=? AND created_at>?',
        actor.account_id,time-60000);
      if(Number(minute.n)>=60)throw new ApiError(429,'SOCIAL_MESSAGE_RATE_LIMIT','发送过于频繁');
      const mediaMinute=query('SELECT COUNT(*) AS n FROM mao_social_e2ee_media WHERE sender_id=? AND created_at>?',
        actor.account_id,time-60000);
      if(Number(mediaMinute.n)>=8)throw new ApiError(429,'E2EE_MEDIA_RATE_LIMIT','图片或语音发送过于频繁');
      const monthly=query('SELECT COUNT(*) AS n FROM mao_social_e2ee_media WHERE sender_id=? AND created_at>?',
        actor.account_id,time-30*86400000);
      if(Number(monthly.n)>=200)throw new ApiError(429,'E2EE_MEDIA_QUOTA','当前测试版每月最多发送 200 条图片或语音');
      const id='msg_'+randomToken(18);
      const saved=rows('INSERT INTO mao_social_messages '+
        '(id,pair_low,pair_high,source_request_id,sender_id,recipient_id,client_message_id,body,created_at) '+
        'VALUES(?,?,?,?,?,?,?,?,?) RETURNING seq',
        id,low,high,friendshipId,actor.account_id,peer,clientMessageId,envelope,time);
      rows('INSERT INTO mao_social_e2ee_media '+
        '(id,message_id,pair_low,pair_high,source_request_id,sender_id,recipient_id,client_message_id,'+
        'kind,mime,iv,ciphertext,sender_key_id,recipient_key_id,created_at) '+
        'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        attachment.id,id,low,high,friendshipId,actor.account_id,peer,clientMessageId,
        attachment.kind,attachment.mime,attachment.iv,attachment.ct,attachment.sk,attachment.rk,time);
      return ok({friendshipId,mediaId:attachment.id,message:{
        id,seq:Number(saved[0].seq),clientMessageId,senderId:actor.account_id,
        recipientId:peer,envelope:body.envelope,createdAt:time}});
    });
  }

  function getMedia(actor,peer,mediaId){
    return transaction(()=>{
      assertSession(actor,now());
      const {low,high,friendshipId}=relation(actor,peer);
      const row=query('SELECT * FROM mao_social_e2ee_media WHERE id=? AND pair_low=? AND pair_high=? '+
        'AND source_request_id=?',mediaId,low,high,friendshipId);
      if(!row)throw new ApiError(404,'E2EE_MEDIA_NOT_FOUND','媒体不存在或不属于当前好友关系');
      return ok({ownerAccountId:actor.account_id,peerId:peer,friendshipId,
        senderId:row.sender_id,recipientId:row.recipient_id,
        clientMessageId:row.client_message_id,
        attachment:{v:1,id:row.id,kind:row.kind,mime:row.mime,
          iv:row.iv,ct:row.ciphertext,sk:row.sender_key_id,rk:row.recipient_key_id}});
    });
  }

  return {
    handle:async(request,path,method,actor)=>{
      if(!path.startsWith('/api/social/e2ee/'))return null;
      if(env.MAO_SOCIAL_E2EE_ENABLED!=='true'){
        throw new ApiError(503,'E2EE_CHAT_NOT_ENABLED','加密真人聊天仍处于测试关闭状态');
      }
      const k='/api/social/e2ee/keys';
      if(path===k && method==='GET')return transaction(()=>{
        assertSession(actor,now());return publicKey(actor,actor.account_id);
      });
      if(path===k && method==='POST')return register(request,actor);
      const peerKey=/^\/api\/social\/e2ee\/keys\/(MAO-[A-Z0-9]{12,24})$/.exec(path);
      if(peerKey&&method==='GET')return transaction(()=>{
        assertSession(actor,now());relation(actor,peerKey[1]);return publicKey(actor,peerKey[1]);
      });
      const upload=/^\/api\/social\/e2ee\/chats\/(MAO-[A-Z0-9]{12,24})\/media$/.exec(path);
      if(upload&&method==='POST')return sendMedia(request,actor,upload[1]);
      const media=/^\/api\/social\/e2ee\/chats\/(MAO-[A-Z0-9]{12,24})\/media\/(med_[A-Za-z0-9_-]{16,64})$/.exec(path);
      if(media&&method==='GET')return getMedia(actor,media[1],media[2]);
      const chat=/^\/api\/social\/e2ee\/chats\/(MAO-[A-Z0-9]{12,24})\/messages$/.exec(path);
      if(chat&&method==='GET')return messages(request,actor,chat[1],method);
      if(chat&&method==='POST')return send(request,actor,chat[1]);
      throw new ApiError(404,'E2EE_ROUTE_NOT_FOUND','加密聊天接口不存在');
    }
  };
}
