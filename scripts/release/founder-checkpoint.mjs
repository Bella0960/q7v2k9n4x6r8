// Invoke from the authorized operator path inside the target Durable Object.
// The bookmark stays in that object's storage and is never returned to callers.
export async function recordFounderCheckpoint({ storage, now = Date.now }) {
  const bookmark = await storage.getCurrentBookmark();
  if (typeof bookmark !== 'string' || !/^[0-9a-f-]{20,128}$/i.test(bookmark)) {
    throw new Error('Recovery checkpoint unavailable');
  }
  const recordedAt = now();
  await storage.put('release:founder-cutover:checkpoint', { bookmark, recordedAt });
  await storage.sync();
  return { recorded: true, recordedAt };
}
