import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const at = (p) => resolve(import.meta.dirname, '..', p);
const read = p => readFileSync(at(p),'utf8');

test('QA login assets remain present and cache-distinct',()=>{
  const html=read('account/index.html');
  const v='20261121-login-recovery1';
  for(const resource of ['/account/account.css','/account/ivory-entry.css','/account/account.js',
    '/assets/ivory-mao/hero.webp']){
    assert.ok(html.includes(resource+'?v='+v),resource+' missing cache version');
  }
  for(const path of ['account/account.css','account/ivory-entry.css','account/account.js','assets/ivory-mao/hero.webp']){
    assert.ok(existsSync(at(path)),path+' missing');
    if(existsSync(at('dist'))) assert.ok(existsSync(at('dist/'+path)),path+' absent after Vite build');
  }
});

test('sign in keeps full-width fields when mobile CSS is slow',()=>{
  const html=read('account/index.html');
  const css=read('account/ivory-entry.css');
  assert.match(html,/#loginPanel \.password-field input \{[^}]*min-width:0;/);
  assert.match(css,/\.ivory-entry #loginForm>label>input\{[^}]*width:100%;min-width:0/);
  assert.match(css,/\.ivory-entry #loginForm \.password-field input\{[^}]*min-width:0;width:0;flex:1 1 0/);
});

test('QA auth remains fail closed but retries on mobile page restore',()=>{
  const js=read('account/account.js');
  assert.ok(js.includes('delegatedSignInReady = status.signInReady === true'));
  assert.ok(js.includes('authBusy || (delegatedIdentity && !delegatedSignInReady)'));
  assert.ok(js.includes("addEventListener('pageshow', retryQaIdentityOnForeground)"));
  assert.ok(js.includes("addEventListener('focus', retryQaIdentityOnForeground)"));
});