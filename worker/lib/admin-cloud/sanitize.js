/**
 * ADMIN-CLOUD-001 — output sanitization.
 *
 * Policy is ALLOWLIST-first: database text is never copied into a response
 * unless it matches a strict shape, and free-form detail objects are rebuilt
 * from a fixed set of typed fields. scrubDeep() is a second, defence-in-depth
 * net applied to every response; it is not the primary control.
 */

import { sha256Hex } from '../crypto.js';

const CODE_RE = /^[a-z][a-z0-9_.:-]{0,63}$/;
const ERROR_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const MAX_DETAIL_JSON_CHARS = 4096;
const MAX_STRING_CHARS = 400;
const MAX_DEPTH = 8;

/** Typed fields that may be copied out of execution_log.detail_json. */
export const DETAIL_FIELDS = Object.freeze({
  httpStatus: { type: 'int', min: 0, max: 599 },
  attemptCount: { type: 'int', min: 0, max: 1000 },
  retryScheduled: { type: 'intOrBool', min: 0, max: 100000 },
  sent: { type: 'int', min: 0, max: 100000 },
  skipped: { type: 'int', min: 0, max: 100000 },
  failed: { type: 'int', min: 0, max: 100000 },
  gone: { type: 'int', min: 0, max: 100000 },
  inProgress: { type: 'int', min: 0, max: 100000 },
  retryDeferred: { type: 'int', min: 0, max: 100000 },
  retryExhausted: { type: 'int', min: 0, max: 100000 }
});

/** Returns the value only if it is a short lowercase machine code. */
export function safeCode(value, fallback = 'redacted') {
  return typeof value === 'string' && CODE_RE.test(value) ? value : fallback;
}

export function isSafeCode(value) {
  return typeof value === 'string' && CODE_RE.test(value);
}

export function safeInt(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = typeof value === 'number' ? value : (typeof value === 'bigint' ? Number(value) : NaN);
  if (!Number.isSafeInteger(number) || number < min || number > max) return null;
  return number;
}

/** Only the constructor-style name of an error, never its message. */
export function safeErrorName(error) {
  const name = error && typeof error === 'object' ? error.name : '';
  return typeof name === 'string' && ERROR_NAME_RE.test(name) ? name : 'Error';
}

/**
 * Rebuild an execution_log detail object from the allowlist. Identifiers
 * (activity, character, message, subscription ids), platform strings and any
 * unknown key are dropped by construction.
 */
export function sanitizeExecutionDetail(raw) {
  let source = raw;
  if (typeof raw === 'string') {
    if (raw.length === 0 || raw.length > MAX_DETAIL_JSON_CHARS) return {};
    try {
      source = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const out = {};
  for (const [key, rule] of Object.entries(DETAIL_FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (typeof value === 'boolean' && rule.type === 'intOrBool') {
      out[key] = value;
      continue;
    }
    const number = safeInt(value, rule.min, rule.max);
    if (number !== null) out[key] = number;
  }
  return out;
}

/**
 * Stable, non-reversible short reference so an administrator can tell whether
 * repeated failures come from one device without ever seeing a device id.
 */
export async function opaqueRef(namespace, value) {
  if (value == null || value === '') return null;
  const digest = await sha256Hex('mao-admin-cloud|' + String(namespace) + '|' + String(value));
  return digest.slice(0, 10);
}

const REDACTIONS = [
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, '[redacted]'],
  [/\bMAO_SESSION=[^;\s]+/gi, '[redacted]'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[redacted]'],
  [/\bMAO-[A-Z0-9]{12,24}\b/g, '[account]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/https?:\/\/[^\s"'<>]+/gi, '[url]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]'],
  [/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted]']
];

/** Mask token-, key-, address- and url-shaped substrings in free text. */
export function redactText(value, maxLength = MAX_STRING_CHARS) {
  let text = String(value == null ? '' : value);
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

const FORBIDDEN_KEY = /secret|password|passwd|cookie|authorization|api_?key|private_?key|session_?token|access_?token|refresh_?token|bearer/i;

/**
 * Final safety net applied to every payload: drops forbidden keys, redacts
 * token-shaped strings, bounds depth and string size, and strips values that
 * are not plain JSON.
 */
export function scrubDeep(value, depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return redactText(value);
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value)) return value.slice(0, 500).map(item => scrubDeep(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) continue;
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
      out[key] = scrubDeep(item, depth + 1);
    }
    return out;
  }
  return null;
}
