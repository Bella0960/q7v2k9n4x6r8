// Keep scanned invitations on the currently authenticated MAO origin.
// This file has no network, camera, DOM or storage side effects.
const CODE = /^[a-f0-9]{64}$/i;
const ROUTE = '/chat/contacts/real-friends.html';

export function parseFriendQr(value, pageOrigin) {
  const raw = String(value ?? '').trim();
  if (CODE.test(raw)) return raw.toLowerCase();
  if (!/^https:\/\//i.test(raw)) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.origin !== pageOrigin || url.pathname !== ROUTE ||
      url.username || url.password || url.search ||
      !/^#mao-friend=[a-f0-9]{64}$/i.test(url.hash)) return null;
  return url.hash.slice('#mao-friend='.length).toLowerCase();
}

export function friendRequestUrl(code) {
  if (!CODE.test(code)) throw new TypeError('Invalid MAO friendship code');
  return ROUTE + '#mao-friend=' + String(code).toLowerCase();
}
