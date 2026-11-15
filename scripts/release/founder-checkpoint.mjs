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
  // A repeated operator tick must NOT slide the recovery point forward. An
  // old/invalid checkpoint also blocks silent replacement; explicit reviewed
  // maintenance is required to rotate it.
  const existing = await storage.get(CHECKPOINT_KEY);
  if (existing !== undefined) {
    if (validBookmark(existing?.bookmark) && validNow(existing?.recordedAt) &&
        existing.recordedAt <= recordedAt &&
        recordedAt - existing.recordedAt <= MAX_CHECKPOINT_AGE_MS) {
      return { recorded: true, recordedAt: existing.recordedAt };
    }
    throw new Error('Recovery checkpoint already exists; review before rotating');
  }
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

/**
 * Explicit one-time rotation of a STALE existing live checkpoint. This is not
 * called by ordinary requests, Cron retries or a generic CI deployment.
 * Retain the old bookmark in private DO KV before replacing the active lease.
 * The Cloudflare runtime itself retains PITR history; no bookmark leaves DO.
 */
export async function rotateStaleFounderCheckpoint({ storage, now = Date.now }) {
  requireStorage(storage);
  if(typeof storage.getCurrentBookmark !== 'function' ||
     typeof storage.transaction !== 'function' ||
     typeof storage.sync !== 'function') throw Error('Durable recovery rotation unavailable');
  const at=now();
  if(!validNow(at)) throw Error('Invalid recovery clock');
  const current=await storage.get(CHECKPOINT_KEY);
  if(!validBookmark(current?.bookmark)||!validNow(current?.recordedAt)||
     current.recordedAt>at) throw Error('Existing checkpoint cannot be verified');
  if(at-current.recordedAt<=MAX_CHECKPOINT_AGE_MS)
    return {recorded:true,recordedAt:current.recordedAt,rotated:false};
  if(at-current.recordedAt>27*24*60*60*1000)
    throw Error('Previous checkpoint is outside reviewable recovery window');
  const historyKey='release:founder-cutover:history:'+current.recordedAt;
  const bookmark=await storage.getCurrentBookmark();
  if(!validBookmark(bookmark)) throw Error('Fresh recovery bookmark unavailable');
  await storage.transaction(async txn=>{
    const prior=await txn.get(CHECKPOINT_KEY);
    if(prior?.bookmark!==current.bookmark||prior?.recordedAt!==current.recordedAt)
      throw Error('Checkpoint changed during private rotation');
    if(await txn.get(historyKey)!==undefined)
      throw Error('This checkpoint was already rotated');
    await txn.put(historyKey,current);
    await txn.put(CHECKPOINT_KEY,{bookmark,recordedAt:at});
  });
  await storage.sync();
  return {recorded:true,recordedAt:at,rotated:true};
}
