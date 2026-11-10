/** Base64URL / SHA-256 / 常量时间比较等纯 WebCrypto 工具（Workers 与 Node 均可用）。 */

export function bytesToBase64Url(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value) {
  if (typeof value !== 'string' || !value) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  if (value.length % 4 === 1) return null;
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch (error) {
    return null;
  }
}

export function concatBytes(...parts) {
  let total = 0;
  for (const part of parts) total += part.length;
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function utf8(text) {
  return new TextEncoder().encode(text);
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', typeof text === 'string' ? utf8(text) : text);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

/** 逐字节比较两个等长十六进制摘要，避免按内容提前返回。 */
export function timingSafeEqualHex(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length || left.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

export function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}
