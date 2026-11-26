import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../scripts/qa-direct-release.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function verifiedCoreAccountState(');
const end = source.indexOf('\nasync function cloudflarePreflight(', start);
assert.ok(start >= 0 && end > start);
const helpers = source.slice(start,end);
function mount(row = [3,7,1], written = 0) {
  const calls = [];
  const fn = vm.runInNewContext(helpers + '\n({verifiedCoreAccountState,verifySocialCoreReadiness})', {
    assert, QA_SETUP_OPEN:'isolated_authority', QA_SETUP_CLOSED:'disabled',
    CORE_DB:'synthetic-namespace', CORE_DO:'synthetic-object',
    cloudflare: async (path,body) => {
      calls.push({path,body});
      return {results:[{rows:[row],meta:{rows_written:written}}]};
    }
  });
  const core = {bindings:Object.entries({
    MAO_IDENTITY_MODE:'local', MAO_QA_ISOLATED_IDENTITY_CORE:'true',
    MAO_SOCIAL_ENABLED:'true', MAO_SOCIAL_E2EE_ENABLED:'true', MAO_SOCIAL_CHAT_ENABLED:'false', MAO_QA_ENROLLMENT_ENABLED:'true'
  }).map(([name,text])=>({name,text,type:'plain_text'}))};
  return {fn,calls,core,binding:(settings,name)=>settings.bindings.find(x=>x.name===name)};
}

test('initialized QA core can admit regular users but never a second active administrator or reopened setup',()=>{
  const {fn}=mount();
  assert.equal(fn.verifiedCoreAccountState({total:0,matches:0,admins:0},'isolated_authority'),false);
  assert.equal(fn.verifiedCoreAccountState({total:2,matches:1,admins:1},'disabled'),true);
  assert.equal(fn.verifiedCoreAccountState({total:100,matches:1,admins:1},'disabled'),true);
  for(const counts of [{total:2,matches:0,admins:1},{total:2,matches:1,admins:2},{total:2,matches:0,admins:0}]) {
    assert.throws(()=>fn.verifiedCoreAccountState(counts,'disabled'));
  }
  assert.throws(()=>fn.verifiedCoreAccountState({total:2,matches:1,admins:1},'isolated_authority'));
});
test('delegated social release requires live isolated core, all migrations/tables, and exactly one administrator',async()=>{
  const good=mount();
  await good.fn.verifySocialCoreReadiness(good.core,good.binding,true);
  assert.equal(good.calls.length,1);
  assert.match(good.calls[0].body.queries[0].sql,/^SELECT /);
  assert.equal(good.calls[0].body.durable_object_id,'synthetic-object');
  for(const row of [[2,7,1],[3,6,1],[3,7,2],[3,7,0],null,['3',7,1]]) {
    const bad=mount(row);
    await assert.rejects(bad.fn.verifySocialCoreReadiness(bad.core,bad.binding,true));
  }
  const writes=mount([3,7,1],1);
  await assert.rejects(writes.fn.verifySocialCoreReadiness(writes.core,writes.binding,true));
  for(const name of good.core.bindings.map(x=>x.name)) {
    const bad=mount();
    bad.core.bindings=bad.core.bindings.filter(x=>x.name!==name);
    await assert.rejects(bad.fn.verifySocialCoreReadiness(bad.core,bad.binding,true));
    assert.equal(bad.calls.length,0);
  }
  const bad=mount();
  await assert.rejects(bad.fn.verifySocialCoreReadiness(bad.core,bad.binding,false));
  assert.equal(bad.calls.length,0);
  assert.match(source,/MAO_DELEGATED_SOCIAL_ENABLED === 'true'\) \{\s*await verifySocialCoreReadiness\(core, binding, coreInitialized\)/);
});

test('core maintenance refuses active app forwarding or a production binding to the QA namespace', async () => {
  const from = source.indexOf('async function verifyCoreMaintenanceIsolation()');
  const to = source.indexOf('async function maintainQaIdentityCore()', from);
  assert.ok(from >= 0 && to > from);
  const app = {bindings: [{name:'MAO_APP_CUTOVER_ENABLED', text:'false'}, {service:'qa'}]};
  const production = {bindings: []};
  const verify = vm.runInNewContext(source.slice(from, to) + '\nverifyCoreMaintenanceIsolation', {
    assert, CORE:'core', QA:'qa', CORE_DB:'core-db', QA_DB:'qa-db',
    cloudflare: async path => {
      if (path.endsWith('/domains')) return [
        {hostname:'app.mao520.com', service:'curly-dream-324c'},
        {hostname:'preview.mao520.com', service:'qa'}
      ];
      return path.includes('curly-dream') ? app : production;
    }
  });
  await verify();
  app.bindings[0].text = 'true';
  await assert.rejects(verify(), /App forwarding must be disabled/);
  app.bindings[0].text = 'false';
  production.bindings.push({namespace_id:'core-db'});
  await assert.rejects(verify(), /Public Worker depends on QA storage/);
});
