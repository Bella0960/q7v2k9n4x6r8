/**
 * MAOMAO Cloud Model Adapter (isolated Worker).
 * A narrow OpenAI-compatible HTTP adapter backed by Cloudflare Workers AI.
 * It has no access to user accounts, Durable Objects, static assets or chat
 * state. Only a server-authenticated Cloud Worker may call it.
 */
const WORKERS_AI_MODEL = '@cf/zai-org/glm-4.7-flash';
const COMPAT_MODEL_NAME = 'glm-4.7-flash';
const MAX_BODY_LENGTH = 20000;
const MAX_MESSAGE_LENGTH = 10000;

function reject(status, code) {
  return Response.json({ error: { code } }, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  });
}

function sameSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' ||
      left.length < 32 || right.length !== left.length) return false;
  let delta = 0;
  for (let i = 0; i < left.length; i++) delta |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return delta === 0;
}

function validatedInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      input.model !== COMPAT_MODEL_NAME ||
      !Array.isArray(input.messages) || input.messages.length !== 2) return null;
  const messages = input.messages.map((entry, index) => {
    if (!entry || typeof entry !== 'object' ||
        entry.role !== (index ? 'user' : 'system') ||
        typeof entry.content !== 'string' ||
        !entry.content.trim() || entry.content.length > MAX_MESSAGE_LENGTH) return null;
    return { role: entry.role, content: entry.content };
  });
  if (messages.some(item => !item)) return null;
  const maxTokens = Number(input.max_tokens ?? 700);
  const temperature = Number(input.temperature ?? 0.78);
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 64 || maxTokens > 700 ||
      !Number.isFinite(temperature) || temperature < 0 || temperature > 1.5) return null;
  return { messages, max_tokens: maxTokens, temperature };
}

export default {
  async fetch(request, env) {
    let url;
    try { url = new URL(request.url); } catch { return reject(400, 'BAD_URL'); }
    if (url.pathname !== '/v1/chat/completions') return reject(404, 'NOT_FOUND');
    if (request.method !== 'POST') return reject(405, 'METHOD_NOT_ALLOWED');
    const expected = String(env?.MODEL_PROXY_SHARED_SECRET || '');
    const auth = String(request.headers.get('Authorization') || '');
    if (!sameSecret(expected, auth.startsWith('Bearer ') ? auth.slice(7) : '')) {
      return reject(401, 'UNAUTHORIZED');
    }
    if (!env?.AI || typeof env.AI.run !== 'function') return reject(503, 'MODEL_UNAVAILABLE');
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) {
      return reject(415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    const claimedLength = Number(request.headers.get('Content-Length') || 0);
    if (!Number.isFinite(claimedLength) || claimedLength > MAX_BODY_LENGTH) {
      return reject(413, 'REQUEST_TOO_LARGE');
    }
    let input;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY_LENGTH) return reject(413, 'REQUEST_TOO_LARGE');
      input = validatedInput(JSON.parse(raw));
    } catch {
      return reject(400, 'INVALID_JSON');
    }
    if (!input) return reject(400, 'INVALID_MODEL_INPUT');
    try {
      const result = await env.AI.run(WORKERS_AI_MODEL, {
        messages: input.messages,
        max_tokens: input.max_tokens,
        temperature: input.temperature,
        stream: false
      });
      const content = typeof result?.response === 'string' ? result.response
        : result?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.length || content.length > 6000) {
        return reject(502, 'INVALID_PROVIDER_RESPONSE');
      }
      return Response.json({
        choices: [{ message: { role: 'assistant', content } }]
      }, {
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
      });
    } catch {
      // Never log/return prompts, provider details, shared secret or account data.
      return reject(502, 'MODEL_REQUEST_FAILED');
    }
  }
};
