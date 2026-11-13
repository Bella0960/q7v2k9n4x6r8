/**
 * Small, one-attachment-per-message E2EE media transport.
 * Encrypt bytes with a fresh AES-GCM IV and bind them to the approved
 * friendship, both accounts, message ID, media ID, kind, MIME and key IDs.
 * The server stores only encoded ciphertext. No AI / image-generation API.
 */
export const MAX_MEDIA_BYTES = 400 * 1024;
const encoder = new TextEncoder();
const MIME = Object.freeze({
  image: new Set(['image/jpeg']),
  voice: new Set(['audio/mp4','audio/webm','audio/ogg','audio/aac','audio/wav'])
});
const ID = /^med_[A-Za-z0-9_-]{16,64}$/;

function b64(bytes) {
  let raw='';
  for(let i=0;i<bytes.length;i+=8192){
    raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
  }
  return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function unb64(text) {
  if(typeof text!=='string'||!text||!/^[A-Za-z0-9_-]+$/.test(text))
    throw new Error('媒体密文格式不正确');
  const raw=atob(text.replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}

export function validateMediaKind(kind,mime) {
  return !!MIME[kind]?.has(mime);
}

function binding(meta) {
  return encoder.encode(JSON.stringify([
    'MAO-E2EE-media-v1',
    meta.friendshipId,
    meta.senderId,
    meta.recipientId,
    meta.clientMessageId,
    meta.mediaId,
    meta.kind,
    meta.mime,
    meta.sk,
    meta.rk
  ]));
}

function validateMeta(meta){
  if(!ID.test(meta?.mediaId)||!validateMediaKind(meta?.kind,meta?.mime)||
      !/^[a-f0-9]{32}$/.test(meta?.sk||'')||!/^[a-f0-9]{32}$/.test(meta?.rk||'')){
    throw new Error('媒体加密身份或格式不正确');
  }
}

export async function encryptMedia(bytes,key,meta,
    subtle=crypto.subtle,random=crypto.getRandomValues.bind(crypto)) {
  validateMeta(meta);
  const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  if(!data.length||data.byteLength>MAX_MEDIA_BYTES)
    throw new Error('语音或图片超过加密传输限制，请缩短录音或选择更小的图片');
  const iv=random(new Uint8Array(12));
  const cipher=new Uint8Array(await subtle.encrypt({
    name:'AES-GCM',iv,additionalData:binding(meta),tagLength:128
  },key,data));
  return {v:1,id:meta.mediaId,kind:meta.kind,mime:meta.mime,
    iv:b64(iv),ct:b64(cipher),sk:meta.sk,rk:meta.rk};
}

export async function decryptMedia(attachment,key,meta,subtle=crypto.subtle){
  validateMeta(meta);
  if(!attachment||attachment.v!==1||attachment.id!==meta.mediaId||
     attachment.kind!==meta.kind||attachment.mime!==meta.mime||
     attachment.sk!==meta.sk||attachment.rk!==meta.rk)
    throw new Error('媒体消息的身份校验失败');
  const iv=unb64(attachment.iv),cipher=unb64(attachment.ct);
  if(iv.length!==12||cipher.length<=16||cipher.length>MAX_MEDIA_BYTES+16)
    throw new Error('媒体密文长度或随机数不合法');
  const bytes=new Uint8Array(await subtle.decrypt({
    name:'AES-GCM',iv,additionalData:binding(meta),tagLength:128
  },key,cipher));
  if(!bytes.length||bytes.length>MAX_MEDIA_BYTES)throw new Error('媒体解密长度无效');
  return bytes;
}

export const MEDIA_MARKER = 'MAO_MEDIA:';
// Voice duration travels inside the existing encrypted message marker.
 // Previous markers without a duration remain readable; nothing changes on
 // the Worker or to the media ciphertext/authorization protocol.
export function makeMediaMarker(id,kind,durationSeconds=null) {
  if(!ID.test(id)||!['image','voice'].includes(kind))throw new Error('媒体编号无效');
  if(durationSeconds===null||durationSeconds===undefined)return MEDIA_MARKER+kind+':'+id;
  if(kind!=='voice'||!Number.isInteger(durationSeconds)||
     durationSeconds<1||durationSeconds>60)throw new Error('语音时长无效');
  return MEDIA_MARKER+kind+':'+id+':'+durationSeconds;
}
export function parseMediaMarker(text) {
  if(typeof text!=='string'||!text.startsWith(MEDIA_MARKER))return null;
  const match=/^MAO_MEDIA:(image|voice):(med_[A-Za-z0-9_-]{16,64})(?::([1-9][0-9]?))?$/.exec(text);
  if(!match)return null;
  if(match[3]&& (match[1]!=='voice'||Number(match[3])>60))return null;
  return match[3]
    ? {kind:match[1],id:match[2],durationSeconds:Number(match[3])}
    : {kind:match[1],id:match[2]};
}
