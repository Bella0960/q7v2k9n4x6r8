import assert from 'node:assert/strict';
import fs from 'node:fs';

const baseUrl = (process.env.MAOMAO_BASE_URL || 'https://mao.miamor520000.workers.dev').replace(/\/+$/, '');
const distHome = fs.readFileSync('dist/index.html', 'utf8');
const routes = [...distHome.matchAll(/data-href="([^"]+\.html)"/g)].map(match => match[1]);
assert.ok(routes.length >= 20, `expected at least 20 built app routes, got ${routes.length}`);
assert.equal(new Set(routes).size, routes.length, 'built app routes must be unique');

const sourceSw = fs.readFileSync('sw.js', 'utf8');
const expectedCache = sourceSw.match(/const CACHE_NAME = ['"]([^'"]+)['"]/)?.[1];
assert.ok(expectedCache, 'source SW cache version is missing');

async function probe(pathname) {
  const url = new URL(pathname, baseUrl + '/');
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      headers: { 'user-agent': 'MAOMAO-production-route-check/1.0' }
    });
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    return {
      path: pathname,
      status: response.status,
      finalUrl: response.url,
      redirected: response.redirected,
      contentType,
      isHtml: /text\/html/i.test(contentType) && /<html[\s>]/i.test(text),
      sample: response.ok && /text\/html/i.test(contentType) ? (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '') : text.slice(0, 180).replace(/\s+/g, ' ')
    };
  } catch (error) {
    return { path: pathname, status: 'NETWORK_ERROR', error: error?.cause?.code || error?.message || String(error) };
  }
}

const home = await probe('/');
const index = await probe('/index.html');
const sw = await probe('/sw.js');
console.log('LIVE HOME:', JSON.stringify(home));
console.log('LIVE INDEX:', JSON.stringify(index));
console.log('LIVE SW:', JSON.stringify({ ...sw, sample: undefined }));
if (sw.status === 200) {
  const swBody = await (await fetch(new URL('/sw.js', baseUrl + '/'), { signal: AbortSignal.timeout(20000) })).text();
  console.log('LIVE SW CACHE MATCH:', swBody.includes(expectedCache), 'expected=', expectedCache);
}

const results = [];
for (let i = 0; i < routes.length; i += 5) {
  const batch = await Promise.all(routes.slice(i, i + 5).map(route => probe('/' + route)));
  results.push(...batch);
}
for (const result of results) console.log('APP ROUTE:', JSON.stringify(result));

const canonicalResults = [];
for (let i = 0; i < routes.length; i += 5) {
  const batch = await Promise.all(routes.slice(i, i + 5).map(route => probe('/' + route.replace(/\.html$/, ''))));
  canonicalResults.push(...batch);
}
for (const result of canonicalResults) console.log('CANONICAL APP ROUTE:', JSON.stringify(result));

const failures = [];
if (home.status !== 200 || !home.isHtml) failures.push('root homepage');
if (index.status !== 200 || !index.isHtml) failures.push('/index.html');
if (sw.status !== 200) failures.push('/sw.js');
for (const result of results) {
  if (result.status !== 200 || !result.isHtml) failures.push(result.path);
}
for (const result of canonicalResults) {
  if (result.status !== 200 || !result.isHtml) failures.push('canonical ' + result.path);
}
if (sw.status === 200) {
  const swBody = await (await fetch(new URL('/sw.js', baseUrl + '/'), { signal: AbortSignal.timeout(20000) })).text();
  if (!swBody.includes(expectedCache)) failures.push('deployed service worker cache version mismatch');
}
if (failures.length) {
  console.error('FAILED LIVE ROUTES:', failures.join(', '));
  process.exitCode = 1;
} else {
  console.log(`PASS: Live Worker ${baseUrl} serves homepage, sw.js (${expectedCache}), and all ${routes.length} app routes as HTTP 200 HTML.`);
}
