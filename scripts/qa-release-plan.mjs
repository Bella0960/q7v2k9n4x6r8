import { execFileSync } from 'node:child_process';

// Start with modules that already have dedicated browser coverage. All other
// changes fall back to the standard release suite, without another workflow.
export const MODULE_TESTS = Object.freeze({
  library: ['reading-coreading-mobile.browser.mjs', 'library-storage.browser.mjs'],
  diary: ['diary-storage.browser.mjs'],
  music: ['music-mobile-browser.mjs', 'music-storage.browser.mjs'],
  travel: ['travel-storage.browser.mjs'],
  cafe: ['cafe-partner-decision.browser.mjs'],
  games: ['games-storage.browser.mjs', 'cooking-interaction.browser.mjs'],
  chat: ['chat-light-surfaces-browser.mjs', 'chat-reply-bubbles-browser.mjs', 'chat-avatar-manager-browser.mjs'],
  desktop: ['desktop-app-navigation.browser.mjs', 'desktop-icon-geometry.browser.mjs', 'desktop-personalization.browser.mjs'],
  companion: ['companion-calendar.browser.mjs'],
  couple: ['couple-growth.browser.mjs'],
  envelope: ['envelope-draft.browser.mjs'],
  encounter: ['encounter-browser.mjs'],
  'theme-studio': ['theme-studio-browser.mjs']
});
const safeSha = /^[0-9a-f]{40}$/;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 60000 });

// Compare HTML after masking only plain visible text in a simple element.
// Raw-text elements, scripts, comments, attributes, nesting and event handlers
// must remain exactly unchanged. Inline CSS is accepted only if the CSS
// contains no newly changed resource-loading/executable constructs.
function cssResources(css) {
  return (css.match(/url\s*\([^)]*\)|@import[^;]*;|@font-face\s*\{[^}]*\}|(?:expression|behavior|-moz-binding)\s*[:(][^;}]*|javascript\s*:/gi) || []).join('\n');
}
function cssCompatible(before, after) {
  return cssResources(before) === cssResources(after) &&
    !/[\\\u0000]/.test(after.replace(/\/\*[\s\S]*?\*\//g, ''));
}
function htmlShape(html) {
  const raw = [];
  // Keep executable and special raw text sections byte-for-byte. Preserve
  // opening/closing tags for the stylesheet and compare its contents separately.
  const protectedHtml = html.replace(/<!--[\s\S]*?-->|<(script|style|textarea|title|pre|template|noscript|svg|xmp|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, block => {
    const index = raw.length;
    raw.push(block);
    return '\u0000' + index + '\u0000';
  });
  // Unclosed or ambiguous special elements are never eligible.
  if (/<(?:script|style|textarea|title|pre|template|noscript|svg|xmp|iframe|object)\b|<!--/i.test(protectedHtml)) return null;
  if (html.includes('\u0000')) return null;
  const shape = protectedHtml.replace(/(<(h[1-6]|p|span|small|label|button|div|strong|em)\b[^<>]*>)([^<>&\u0000`{}]*)(<\/\2\s*>)/gi,
    (_, open, tag, content, close) => open + '\u0000TEXT\u0000' + close);
  return { shape, raw };
}
function htmlCompatible(before, after) {
  const a = htmlShape(before), b = htmlShape(after);
  if (!a || !b || a.shape !== b.shape || a.raw.length !== b.raw.length) return false;
  return a.raw.every((old, i) => {
    if (old === b.raw[i]) return true;
    const x = old.match(/^(<style\b[^>]*>)([\s\S]*)(<\/style\s*>)$/i);
    const y = b.raw[i].match(/^(<style\b[^>]*>)([\s\S]*)(<\/style\s*>)$/i);
    return !!(x && y && x[1] === y[1] && x[3] === y[3] && cssCompatible(x[2], y[2]));
  });
}
export function classifyPresentationChanges(changes) {
  const full = { mode: 'standard', tests: [] };
  if (!Array.isArray(changes) || !changes.length || changes.length > 12) return full;
  const modules = new Set();
  const selectedTests = new Set();
  for (const { status, path, before, after } of changes) {
    if (status !== 'M' || typeof path !== 'string' || typeof before !== 'string' ||
        typeof after !== 'string' || !/^[a-zA-Z0-9/_-]+\.(css|html)$/.test(path)) return full;
    const module = path.split('/')[0];
    const moduleTests = MODULE_TESTS[module];
    if (!moduleTests) return full;
    if (path.endsWith('.html') ? !htmlCompatible(before, after) : !cssCompatible(before, after)) return full;
    modules.add(module);
    for (const file of moduleTests) selectedTests.add(file);
    // Keep the fast lane bounded. Large batches or too many independent
    // modules use the standard plan rather than silently under-testing.
    if (modules.size > 4 || selectedTests.size > 12) return full;
  }
  return { mode: 'presentation', tests: [...selectedTests] };
}
export function getReleasePlan(base, head) {
  if (!safeSha.test(base) || !safeSha.test(head)) throw new Error('Invalid release baseline or candidate');
  // An unrelated or older candidate may not replace the current QA version.
  try {
    try { git('cat-file', '-e', base + '^{commit}'); }
    catch { git('fetch', '--quiet', '--no-tags', 'origin', base); }
    git('merge-base', '--is-ancestor', base, head);
  }
  catch { throw new Error('Candidate must include the currently deployed QA source'); }
  const changes = git('diff','--name-status','--no-renames',base,head).split('\n').filter(Boolean).map(line => {
    const [status,path] = line.split('\t');
    if (status !== 'M' || !path || !/\.(html|css)$/.test(path)) return {status,path};
    const before = git('show',base+':'+path), after = git('show',head+':'+path);
    return {status,path,before,after};
  });
  return classifyPresentationChanges(changes);
}
