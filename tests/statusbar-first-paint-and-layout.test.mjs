import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const native = read('shared/js/native-feel.js');
const wallet = read('wallet/wallet.html');
const family = read('wallet/family-cards.html');
const travel = read('travel/dream-travel.html');
const desktop = read('index.html');

const start = native.indexOf('    (function prepaintStatusbarVisibility() {');
const end = native.indexOf('    /* ---------- Theme layer:', start);
assert.ok(start > 0 && end > start, 'first-paint bootstrap must remain in head script');
const prepaint = native.slice(start,end);

function simulate(value) {
  const attributes = new Map(), styles = [];
  const doc = {
    documentElement: {
      setAttribute(k,v) { attributes.set(k,v); },
      removeAttribute(k) { attributes.delete(k); }
    },
    head: { appendChild(el) { styles.push(el); } },
    getElementById(id) { return styles.find(x=>x.id===id) || null; },
    createElement(tag) { assert.equal(tag,'style'); return {}; }
  };
  const context = {document:doc, window:{localStorage:{
    getItem(k) { assert.equal(k, 'settings_statusbar'); return value; }
  }}};
  runInNewContext(prepaint, context);
  runInNewContext(prepaint, context); // Duplicate navigation startup must be idempotent.
  return {hidden:attributes.has('data-maomao-statusbar-hidden'),styles};
}

test('global statusbar preference is applied before first paint without inserting a fake bar', () => {
  const hidden=simulate('0'), visible=simulate('1'), defaults=simulate(null);
  assert.equal(hidden.hidden,true);
  assert.equal(visible.hidden,false);
  assert.equal(defaults.hidden,false);
  assert.equal(hidden.styles.length,1);
  assert.match(hidden.styles[0].textContent,/data-maomao-statusbar-hidden/);
  assert.match(hidden.styles[0].textContent,/display:none!important/);
  assert.doesNotMatch(prepaint, /<div[^>]*class=.status-bar/);
});

test('wallet header is flush, keeps wallet contents, and never renders a fake 4:41 clock', () => {
  assert.doesNotMatch(wallet, /<div class="status-bar"><span>4:41<\/span><\/div>/);
  assert.doesNotMatch(wallet, /padding: calc\(50px \+ env\(safe-area-inset-top/);
  assert.match(wallet, /padding: calc\(12px \+ env\(safe-area-inset-top/);
  assert.match(wallet, /viewport-fit=cover/);
  assert.match(wallet, /id="wlDeckWrap"/);
  assert.match(wallet, /renderBalance\(\)/);
  assert.match(wallet, /renderHistory\(\)/);
});

test('family cards and travel respect actual device safe area without adding a synthetic statusbar', () => {
  assert.doesNotMatch(family,/padding:calc\(42px \+ env\(safe-area-inset-top/);
  assert.match(family,/padding:calc\(12px \+ env\(safe-area-inset-top/);
  assert.match(family,/\.topbar\{padding-top:calc\(8px \+ env\(safe-area-inset-top,0px\)\)\}/);
  assert.match(family,/id="refreshBtn"/);
  assert.match(travel,/\.topbar\{padding-top:calc\(8px \+ env\(safe-area-inset-top,0px\)\)\}/);
  assert.doesNotMatch(travel, /(?:4:41|09:41)/);
  assert.match(travel,/id="backHome"/);
  assert.match(travel,/id="mainView"/);
});

test('each affected entry uses the new early bootstrap; desktop edit controls are preserved', () => {
  for (const page of [wallet,family,travel,desktop])
    assert.match(page,/native-feel\.js\?v=20261118statusbar1/);
  assert.match(desktop,/id="editModeIndicator"/);
  assert.match(desktop,/id="editDoneBtn"/);
  assert.match(desktop,/shared\/js\/statusbar-control\.js/);
});
