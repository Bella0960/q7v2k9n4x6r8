/**
 * 真实 Web Push 发送实现：
 *  - RFC 8291（aes128gcm 载荷加密）
 *  - RFC 8292（VAPID ES256 JWT 鉴权）
 *
 * 只依赖 WebCrypto，Workers 与 Node 测试环境行为一致。
 * 私钥仅从 env.VAPID_PRIVATE_KEY 读取，不落库、不进日志、不回传前端。
 */

import { base64UrlToBytes, bytesToBase64Url, concatBytes, utf8 } from './crypto.js';

const encoder = new TextEncoder();

export const PUSH_TTL_SECONDS = 3600;
export const PUSH_SEND_TIMEOUT_MS = 25000;

export class PushConfigError extends Error {
  constructor(message) {
    super(message);
    this.code = 'PUSH_CONFIG_INVALID';
  }
}

export class PushSendError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = 'PUSH_SEND_FAILED';
  }
}

/** 解析 VAPID 私钥（base64url 的 raw d）与公钥（base64url 的 65 字节未压缩点）。 */
export function parseVapidKeys(env) {
  const publicKeyB64 = String(env?.VAPID_PUBLIC_KEY || '').trim();
  const privateKeyB64 = String(env?.VAPID_PRIVATE_KEY || '').trim();
  const subject = String(env?.VAPID_SUBJECT || '').trim();
  if (!publicKeyB64 || !privateKeyB64) {
    throw new PushConfigError('缺少 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 配置');
  }
  if (!subject || !/^(mailto:|https:)/.test(subject)) {
    throw new PushConfigError('VAPID_SUBJECT 必须是 mailto: 或 https: 地址');
  }
  const publicBytes = base64UrlToBytes(publicKeyB64);
  if (!publicBytes || publicBytes.length !== 65 || publicBytes[0] !== 4) {
    throw new PushConfigError('VAPID_PUBLIC_KEY 必须是 65 字节未压缩 P-256 公钥');
  }
  const privateBytes = base64UrlToBytes(privateKeyB64);
  if (!privateBytes || privateBytes.length !== 32) {
    throw new PushConfigError('VAPID_PRIVATE_KEY 必须是 32 字节 P-256 私钥');
  }
  return {
    subject,
    publicKeyB64,
    privateBytes,
    publicBytes,
    jwk: {
      kty: 'EC',
      crv: 'P-256',
      ext: true,
      d: bytesToBase64Url(privateBytes),
      x: bytesToBase64Url(publicBytes.slice(1, 33)),
      y: bytesToBase64Url(publicBytes.slice(33, 65))
    }
  };
}

function endpointAudience(endpoint) {
  const url = new URL(endpoint);
  return `${url.protocol}//${url.host}`;
}

/** 生成 VAPID Authorization 头（t=<JWT>, k=<公钥>）。 */
export async function buildVapidAuthorization(endpoint, keys, nowMs = Date.now()) {
  const header = bytesToBase64Url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToBase64Url(utf8(JSON.stringify({
    aud: endpointAudience(endpoint),
    exp: Math.floor(nowMs / 1000) + 12 * 3600,
    sub: keys.subject
  })));
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'jwk',
    keys.jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    utf8(signingInput)
  );
  return `vapid t=${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}, k=${keys.publicKeyB64}`;
}

async function hkdf(ikm, salt, info, bits) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    bits
  );
  return new Uint8Array(derived);
}

/** 按 RFC 8291 加密载荷，返回完整的 aes128gcm 请求体。 */
export async function encryptPayload(subscription, payloadText) {
  const uaPublic = base64UrlToBytes(subscription.p256dh);
  const authSecret = base64UrlToBytes(subscription.auth);
  if (!uaPublic || uaPublic.length !== 65 || uaPublic[0] !== 4) {
    throw new PushConfigError('订阅 p256dh 非法');
  }
  if (!authSecret || authSecret.length !== 16) {
    throw new PushConfigError('订阅 auth 非法');
  }

  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: uaKey },
    ephemeral.privateKey,
    256
  ));

  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const ikm = await hkdf(
    ecdhSecret,
    authSecret,
    concatBytes(utf8('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic),
    256
  );
  const cek = await hkdf(ikm, salt, concatBytes(utf8('Content-Encoding: aes128gcm'), new Uint8Array([0])), 128);
  const nonce = await hkdf(ikm, salt, concatBytes(utf8('Content-Encoding: nonce'), new Uint8Array([0])), 96);

  const plaintext = concatBytes(encoder.encode(String(payloadText || '')), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    aesKey,
    plaintext
  ));

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);

  return concatBytes(
    salt,
    recordSize,
    new Uint8Array([asPublic.length]),
    asPublic,
    ciphertext
  );
}

/**
 * 发送一条 Web Push。返回 { ok, statusCode, gone }。
 * 404/410 表示订阅已失效，由调用方负责停用。
 */
export async function sendWebPush(
  subscription,
  payloadText,
  keys,
  { nowMs = Date.now(), fetchImpl = fetch, beforeSend = null } = {}
) {
  const endpoint = subscription.endpoint;
  const authorization = await buildVapidAuthorization(endpoint, keys, nowMs);
  const body = await encryptPayload(subscription, payloadText);

  // This callback must be synchronous: it runs after asynchronous crypto work
  // and immediately before fetchImpl is invoked, with no intervening await.
  // Callers use it to close the gap where a device/subscription is revoked
  // while VAPID signing and payload encryption are in progress.
  if (typeof beforeSend === 'function' && !beforeSend()) {
    return { ok: false, statusCode: 0, gone: false, skipped: true };
  }

  let response;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timeoutId = null;
  try {
    if (controller && typeof setTimeout === 'function') {
      timeoutId = setTimeout(() => controller.abort(), PUSH_SEND_TIMEOUT_MS);
    }
    response = await fetchImpl(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: authorization,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(PUSH_TTL_SECONDS),
        Urgency: 'normal'
      },
      body,
      signal: controller?.signal
    });
  } catch (error) {
    throw new PushSendError(0, `推送网络请求失败: ${error?.message || error}`);
  } finally {
    if (timeoutId != null && typeof clearTimeout === 'function') clearTimeout(timeoutId);
  }

  const statusCode = response.status;
  return {
    ok: statusCode >= 200 && statusCode < 300,
    statusCode,
    gone: statusCode === 404 || statusCode === 410
  };
}
