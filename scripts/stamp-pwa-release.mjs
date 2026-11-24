import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// A release is derived from the emitted public files, not a manually bumped
// version number or wall-clock timestamp. The same build gets the same token.
export function stampPwaRelease(outputDir) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  walk(outputDir);
  const rel = file => path.relative(outputDir, file).split(path.sep).join('/');
  files.sort((a,b) => rel(a).localeCompare(rel(b), 'en'));
  const swPath = path.join(outputDir, 'sw.js');
  const sw = fs.readFileSync(swPath, 'utf8');
  if (!sw.includes("const BUILD_RELEASE = '__MAOMAO_BUILD_RELEASE__';")) {
    throw new Error('PWA release stamp requires a fresh build');
  }
  const hash = createHash('sha256');
  for (const file of files) {
    if (rel(file) === 'pwa-release.json') continue;
    const content = fs.readFileSync(file);
    hash.update(rel(file) + '\0' + content.length + '\0');
    hash.update(content);
  }
  const release = hash.digest('hex').slice(0, 24);
  const coreAssets = new Set();
  // Scope to actual opening script/link elements in HTML, never alter inline
  // scripts, user content, remote libraries, data/blob URLs or app navigation.
  function stampUrl(url, htmlPath) {
    if (!url || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) return url;
    const parts = url.match(/^([^?#]+)(\?[^#]*)?(#.*)?$/);
    if (!parts || !/\.(?:js|mjs|css)$/i.test(parts[1])) return url;
    const absolute = path.resolve(parts[1].startsWith('/') ? outputDir : path.dirname(htmlPath), parts[1].replace(/^\//,''));
    if (!absolute.startsWith(path.resolve(outputDir)+path.sep) || !fs.existsSync(absolute)) return url;
    return parts[1] + (parts[2] ? parts[2] + '&' : '?') + 'mao_rev=' + release + (parts[3] || '');
  }
  for (const file of files.filter(file => file.endsWith('.html'))) {
    let html = fs.readFileSync(file, 'utf8');
    // Skip script bodies and HTML comments so template strings stay untouched.
    html = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<link\b[^>]*>/gi, block => {
      if (block.startsWith('<!--')) return block;
      const close = block.indexOf('>');
      if (close < 0) return block;
      const opening = block.slice(0,close+1);
      const attribute = /^<script\b/i.test(opening) ? 'src' : 'href';
      const updated = opening.replace(new RegExp('\\b'+attribute+'\\s*=\\s*(["\\\'])(.*?)\\1','i'), (match, quote, url) => {
        // The pre-existing legacy SW aliases font-loader.js regardless of query.
        // A physically distinct filename avoids that first-upgrade exception.
        let requested = url;
        if (attribute === 'src' && /(?:^|\/)font-loader\.js(?:[?#]|$)/.test(url)) {
          const original = url.split(/[?#]/)[0];
          const source = path.resolve(original.startsWith('/')?outputDir:path.dirname(file), original.replace(/^\//,''));
          if (source.startsWith(path.resolve(outputDir)+path.sep) && fs.existsSync(source)) {
            const alias = source.replace(/\.js$/, '.mao-'+release+'.js');
            if (!fs.existsSync(alias)) fs.copyFileSync(source,alias);
            requested = url.replace(/font-loader\.js(?=[?#]|$)/,'font-loader.mao-'+release+'.js');
          }
        }
        const stamped = stampUrl(requested,file);
        if (stamped.includes('mao_rev='+release) &&
            ['index.html','account/index.html','account/bootstrap.html'].includes(rel(file))) {
          const asset = new URL(stamped, 'https://local.invalid/'+rel(file));
          coreAssets.add('.'+asset.pathname+asset.search);
        }
        return match.replace(quote+url+quote,quote+stamped+quote);
      });
      return updated + block.slice(close+1);
    });
    html = html.replace(/<head\b[^>]*>/i, match=>match+'<meta name="mao-build-release" content="'+release+'">');
    fs.writeFileSync(file,html);
  }
  fs.writeFileSync(swPath,sw
    .replace('const BUILD_CORE_ASSETS = [];','const BUILD_CORE_ASSETS = '+JSON.stringify([...coreAssets].sort())+';')
    .replace("const BUILD_RELEASE = '__MAOMAO_BUILD_RELEASE__';","const BUILD_RELEASE = '"+release+"';")
    .replace(/const CACHE_NAME = '(phone-app-pwa-v\d+)';/,"const CACHE_NAME = '$1-"+release+"';"));
  fs.writeFileSync(path.join(outputDir,'pwa-release.json'),JSON.stringify({release, schema:1}));
  return release;
}
