import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stampPwaRelease } from '../scripts/stamp-pwa-release.mjs';
function fixture(root,script='const v=1;') {
  fs.mkdirSync(path.join(root,'shared/js'),{recursive:true});
  fs.mkdirSync(path.join(root,'account'),{recursive:true});
  fs.writeFileSync(path.join(root,'sw.js'), "const CACHE_NAME = 'phone-app-pwa-v311';\nconst BUILD_RELEASE = '__MAOMAO_BUILD_RELEASE__';\nconst BUILD_CORE_ASSETS = [];");
  fs.writeFileSync(path.join(root,'shared/js/app.js'),script);
  fs.writeFileSync(path.join(root,'shared/js/font-loader.js'),'const font=true;');
  fs.writeFileSync(path.join(root,'app.css'),'body{}');
  fs.writeFileSync(path.join(root,'index.html'), '<html><head><script src="shared/js/app.js?v=old"></script><script src="shared/js/font-loader.js"></script><link rel="stylesheet" href="app.css"><script>const x=\'<link href="app.css">\';</script><script src="https://example.invalid/a.js"></script></head></html>');
  fs.writeFileSync(path.join(root,'account/index.html'),'<html><head><script src="../shared/js/app.js"></script></head></html>');
}
test('same emitted bytes yield the same release; changed code yields a new release; existing query survives',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pwa-release-'));
  try {
    const a=path.join(root,'a'),b=path.join(root,'b'),c=path.join(root,'c');
    fixture(a);fixture(b);fixture(c,'const v=2;');
    const first=stampPwaRelease(a);
    assert.equal(first,stampPwaRelease(b));
    assert.notEqual(first,stampPwaRelease(c));
    const html=fs.readFileSync(path.join(a,'index.html'),'utf8');
    assert.ok(html.includes('app.js?v=old&mao_rev='+first));
    assert.ok(html.includes('font-loader.mao-'+first+'.js?mao_rev='+first));
    assert.ok(fs.existsSync(path.join(a,'shared/js/font-loader.mao-'+first+'.js')));
    assert.ok(html.includes('https://example.invalid/a.js"'));
    assert.ok(html.includes("const x='<link href=\"app.css\">';"));
    const sw=fs.readFileSync(path.join(a,'sw.js'),'utf8');
    assert.ok(sw.includes('phone-app-pwa-v311-'+first));
    assert.ok(sw.includes('./shared/js/app.js?mao_rev='+first));
    assert.ok(sw.includes('./shared/js/app.js?v=old&mao_rev='+first));
    assert.equal(JSON.parse(fs.readFileSync(path.join(a,'pwa-release.json'),'utf8')).release,first);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
