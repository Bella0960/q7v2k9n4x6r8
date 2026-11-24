import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPresentationChanges as classify } from '../scripts/qa-release-plan.mjs';
const change = (before, after, path='library/library.html', status='M') => ({before,after,path,status});
test('local visible copy and layout-only stylesheet use the same scoped plan', () => {
  assert.equal(classify([change('<p>旧文案</p>','<p>新文案</p>')]).mode,'presentation');
  assert.equal(classify([change('<style>.a{margin:1px}</style><p>旧</p>','<style>.a{margin:2px}</style><p>新</p>')]).mode,'presentation');
  assert.equal(classify([change('.a{margin:1px}','.a{margin:2px}','music/player.css')]).mode,'presentation');
});
test('script, event, markup, sensitive module, resource and cross-module changes retain standard tests', () => {
  for (const c of [
    change('<script>const x="<p>A</p>"</script>','<script>const x="<p>B</p>"</script>'),
    change('<button onclick="save()">A</button>','<button onclick="erase()">B</button>'),
    change('<p>A</p>','<a>A</a>'),
    change('<p>A</p>','<p>B</p>','account/index.html'),
    change('a{}','a{background:url(https://example.org/a)}','library/a.css'),
    change('a{}','a{}','library/a.css','A'),
    change('a{}','b{}','shared/a.css'),
    change('x','y','library/a.js'),
    change('<script><p>A</p>','<script><p>B</p>')
  ]) assert.equal(classify([c]).mode,'standard');
  assert.equal(classify([change('a{}','b{}','library/a.css'),change('a{}','b{}','music/a.css')]).mode,'standard');
});
