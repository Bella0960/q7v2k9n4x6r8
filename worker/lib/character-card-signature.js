/**
 * Signed MAOMAO character cards (v2).
 *
 * Only a trusted Worker can issue a signature. A format label or a client-side
 * checksum is never treated as proof that a card originated from MAOMAO.
 * Signatures are scoped to the authenticated MAO account; neither JWTs nor
 * account sessions are embedded in exported files.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const ACCOUNT_ID = /^MAO-[A-Z0-9]{12,24}$/;
const SIGNATURE = /^[0-9a-f]{64}$/;
const KEY_NAMES = ['name', 'persona', 'tone', 'appearanceDescription', 'styleKeywords'];
const ENVELOPE_KEYS = ['format', 'version', 'ownerId', 'issuedAt', 'character', 'proof'];
const FORMAT = 'maomao-character';
const VERSION = 2;
const CONTEXT = 'MAOMAO-CHARACTER-CARD-V2\n';

function cardError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function exactlyKnownKeys(value, keys) {
  return record(value) && Object.keys(value).every(key => keys.includes(key));
}

export function normalizeCharacterCard(value) {
  if (!exactlyKnownKeys(value, KEY_NAMES)) throw cardError('INVALID_CHARACTER_CARD');
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const persona = typeof value.persona === 'string' ? value.persona : '';
  const tone = value.tone == null ? '' : value.tone;
  const appearanceDescription = value.appearanceDescription == null ? '' : value.appearanceDescription;
  const styleKeywords = value.styleKeywords == null ? [] : value.styleKeywords;
  if (!name || name.length > 30 || typeof persona !== 'string' ||
      !persona.trim() || persona.length > 30000 ||
      typeof tone !== 'string' || tone.length > 12000 ||
      typeof appearanceDescription !== 'string' || appearanceDescription.length > 12000 ||
      !Array.isArray(styleKeywords) || styleKeywords.length > 40 ||
      !styleKeywords.every(word => typeof word === 'string' && word.length <= 100)) {
    throw cardError('INVALID_CHARACTER_CARD');
  }
  return { name, persona, tone, appearanceDescription, styleKeywords: [...styleKeywords] };
}

function safeSigningKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw cardError('CHARACTER_CARD_SIGNING_NOT_CONFIGURED');
  }
  return secret;
}

function canonical(card) {
  return CONTEXT + JSON.stringify({
    format: FORMAT,
    version: VERSION,
    ownerId: card.ownerId,
    issuedAt: card.issuedAt,
    character: card.character
  });
}

function mac(card, secret) {
  return createHmac('sha256', safeSigningKey(secret)).update(canonical(card), 'utf8').digest('hex');
}

export function issueCharacterCard(character, accountId, secret, issuedAt = Date.now()) {
  if (!ACCOUNT_ID.test(String(accountId))) throw cardError('INVALID_CARD_OWNER');
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 1577836800000) throw cardError('INVALID_CARD_ISSUED_AT');
  const card = {
    format: FORMAT,
    version: VERSION,
    ownerId: accountId,
    issuedAt,
    character: normalizeCharacterCard(character)
  };
  return { ...card, proof: { algorithm: 'HMAC-SHA256', signature: mac(card, secret) } };
}

export function verifyCharacterCard(raw, accountId, secret, now = Date.now()) {
  if (!ACCOUNT_ID.test(String(accountId)) || !exactlyKnownKeys(raw, ENVELOPE_KEYS) ||
      raw.format !== FORMAT || raw.version !== VERSION || raw.ownerId !== accountId ||
      !Number.isSafeInteger(raw.issuedAt) || raw.issuedAt < 1577836800000 ||
      raw.issuedAt > now + 5 * 60 * 1000 ||
      !exactlyKnownKeys(raw.proof, ['algorithm', 'signature']) ||
      raw.proof.algorithm !== 'HMAC-SHA256' || !SIGNATURE.test(raw.proof.signature)) {
    throw cardError('CHARACTER_CARD_SIGNATURE_INVALID');
  }
  const character = normalizeCharacterCard(raw.character);
  const expected = mac({ ...raw, character }, secret);
  const actualBuffer = Buffer.from(raw.proof.signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw cardError('CHARACTER_CARD_SIGNATURE_INVALID');
  }
  return character;
}
