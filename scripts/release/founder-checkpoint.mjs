// A stored checkpoint alone is not an authorization to change a founder.
// Proofs are opaque, in-process and bound to the exact Durable Object storage
// instance. They expire quickly and cannot be forged by an HTTP JSON request.
const CHECKPOINT_KEY = 'release:founder-cutover:checkpoint';
const MAX_CHECKPOINT_AGE_MS = 15 * 60 * 1000;
const issuedProofs = new WeakMap();

function validBookmark(value) {
  return typeof value === 'string' && /^[0-9a-f-]{20,128}$/i.test(value);
}

function validNow(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function requireStorage(storage) {
  if (!storage || typeof storage.get !== 'function') {
    throw new Error('Target Durable Object storage is required');
  }
}

export async function recordFounderCheckpoint({ storage, now = Date.now }) {
  requireStorage(storage);
  if (typeof storage.getCurrentBookmark !== 'function' ||
      typeof storage.put !== 'function' || typeof storage.sync !== 'function') {
    throw new Error('Durable recovery checkpoint API unavailable');
  }
  const recordedAt = now();
  if (!validNow(recordedAt)) throw new Error('Invalid checkpoint clock');
  const bookmark = await storage.getCurrentBookmark();
  if (!validBookmark(bookmark)) throw new Error('Recovery checkpoint unavailable');
  await storage.put(CHECKPOINT_KEY, { bookmark, recordedAt });
  await storage.sync();
  // Never return the bookmark to callers, build logs, or public endpoints.
  return { recorded: true, recordedAt };
}

export async function verifyFounderCheckpoint({ storage, now = Date.now }) {
  requireStorage(storage);
  const currentTime = now();
  if (!validNow(currentTime)) throw new Error('Invalid checkpoint clock');
  const saved = await storage.get(CHECKPOINT_KEY);
  if (!validBookmark(saved?.bookmark) || !validNow(saved?.recordedAt) ||
      saved.recordedAt > currentTime ||
      currentTime - saved.recordedAt > MAX_CHECKPOINT_AGE_MS) {
    throw new Error('Valid recent recovery checkpoint required');
  }
  // A frozen proof has no serialized credential or bookmark.
  const proof = Object.freeze({});
  issuedProofs.set(proof, { storage, recordedAt: saved.recordedAt });
  return proof;
}

export function consumeFounderCheckpointProof({ storage, proof, now }) {
  const record = proof && typeof proof === 'object' ? issuedProofs.get(proof) : null;
  if (!record || record.storage !== storage || !validNow(now) ||
      record.recordedAt > now || now - record.recordedAt > MAX_CHECKPOINT_AGE_MS) {
    throw new Error('Verified recovery checkpoint proof required');
  }
  issuedProofs.delete(proof);
}
