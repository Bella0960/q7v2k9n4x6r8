/**
 * E2EE v1: WebCrypto ECDH(P-256) -> HKDF-SHA256 -> AES-256-GCM.
 * This is a single-device beta. Private CryptoKey is NON-EXTRACTABLE and
 * is stored only by the browser's IndexedDB; it is never sent to a Worker.
 * The Worker sees P-256 public keys and authenticated ciphertext only.
 * No automatic key overwrite/recovery. No claim against a malicious server
 * substituting first-use public keys (see in-app safety notice).
 */
const coder = new TextEncoder(), reader = new TextDecoder('utf-8',{fatal:true});
const pattern=/^[A-Za-z0-9_-]+$/;
const encode = bytes => {
  let binary='';
  for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
const decode = text => {
  if(typeof text!=='string'||!pattern.test(text))throw new Error('加密字段格式错误');
  const bytes=atob(text.replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(bytes,ch=>ch.charCodeAt(0));
};
const hex = bytes => Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');

export async function idForPublicKey(publicKey,subtle=crypto.subtle){
  return hex(new Uint8Array(await subtle.digest('SHA-256',coder.encode(publicKey)))).slice(0,32);
}

export async function createDeviceIdentity(subtle=crypto.subtle){
  const keyPair=await subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
  const raw=new Uint8Array(await subtle.exportKey('raw',keyPair.publicKey));
  if(raw.length!==65||raw[0]!==4)throw new Error('无法生成支持的本机聊天密钥');
  const publicKey=encode(raw);
  return {privateKey:keyPair.privateKey,publicKey,keyId:await idForPublicKey(publicKey,subtle)};
}

export async function conversationKey(privateKey,peerPublicKey,friendshipId,accountId,peerId,subtle=crypto.subtle){
  const imported=await subtle.importKey('raw',decode(peerPublicKey),
    {name:'ECDH',namedCurve:'P-256'},false,[]);
  const bits=await subtle.deriveBits({name:'ECDH',public:imported},privateKey,256);
  const source=await subtle.importKey('raw',bits,'HKDF',false,['deriveKey']);
  const parties=[accountId,peerId].sort().join('|');
  return subtle.deriveKey({name:'HKDF',hash:'SHA-256',
    salt:coder.encode('MAO-E2EE-v1|'+friendshipId+'|'+parties),
    info:coder.encode('MAO real friendship authenticated chat v1')},
  source,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}

function aad(friendshipId,senderId,recipientId,clientMessageId,sk,rk){
  return coder.encode(JSON.stringify(['MAO-E2EE-v1',friendshipId,senderId,recipientId,clientMessageId,sk,rk]));
}

export async function encryptText(text,key,{friendshipId,senderId,recipientId,clientMessageId,sk,rk},
  subtle=crypto.subtle,random=crypto.getRandomValues.bind(crypto)) {
  if(typeof text!=='string'||!text.trim()||Array.from(text).length>280){
    throw new Error('每条消息最多 280 字，请拆成多条发送');
  }
  const iv=random(new Uint8Array(12));
  const cipher=new Uint8Array(await subtle.encrypt({name:'AES-GCM',iv,
    additionalData:aad(friendshipId,senderId,recipientId,clientMessageId,sk,rk),
    tagLength:128},key,coder.encode(text)));
  return {v:1,iv:encode(iv),ct:encode(cipher),sk,rk};
}

export async function decryptText(envelope,key,{friendshipId,senderId,recipientId,clientMessageId},
  subtle=crypto.subtle) {
  if(!envelope||envelope.v!==1||typeof envelope.sk!=='string'||typeof envelope.rk!=='string'){
    throw new Error('未知加密消息格式');
  }
  const iv=decode(envelope.iv),ct=decode(envelope.ct);
  if(iv.length!==12||ct.length<16)throw new Error('消息加密字段损坏');
  const plain=await subtle.decrypt({name:'AES-GCM',iv,
    additionalData:aad(friendshipId,senderId,recipientId,clientMessageId,
      envelope.sk,envelope.rk),tagLength:128},key,ct);
  return reader.decode(plain);
}

export function serializeDeviceKey(accountId,identity){
  return {accountId,privateKey:identity.privateKey,publicKey:identity.publicKey,keyId:identity.keyId};
}

export async function openDeviceKeyStore(){
  if(!globalThis.indexedDB)throw new Error('当前浏览器不支持安全保存聊天密钥');
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('maomao-real-chat-keys-v1',1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('keys'))
      req.result.createObjectStore('keys',{keyPath:'accountId'});};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(new Error('无法打开设备聊天密钥存储'));
  });
}

export async function loadDeviceIdentity(db,accountId){
  return new Promise((resolve,reject)=>{
    const req=db.transaction('keys','readonly').objectStore('keys').get(accountId);
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(new Error('读取聊天密钥失败'));
  });
}

export async function saveDeviceIdentity(db,accountId,identity){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('keys','readwrite');
    tx.objectStore('keys').put(serializeDeviceKey(accountId,identity));
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(new Error('本机无法持久保存聊天密钥，已停止发送'));
    tx.onabort=()=>reject(new Error('设备密钥存储被取消'));
  });
}
