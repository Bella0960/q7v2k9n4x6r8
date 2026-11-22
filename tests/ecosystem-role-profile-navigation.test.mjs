import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const manager = fs.readFileSync(new URL('../worldbook/characters/js/characters-manager.js', import.meta.url), 'utf8');
const encounter = fs.readFileSync(new URL('../encounter/encounter.html', import.meta.url), 'utf8');
const profilePage = fs.readFileSync(new URL('../worldbook/characters/characters.html', import.meta.url), 'utf8');

function render(role, ledger) {
  const start = manager.indexOf('function renderRoleEncounterHistory(role) {');
  const stop = manager.indexOf('\nfunction renderRoleProfile() {', start);
  assert.ok(start > 0 && stop > start);
  const ctx = {
    window: { WorldEvents: ledger },
    Date, Number, String, encodeURIComponent,
    escapeHtml: input => String(input ?? '').replaceAll('&','&amp;')
      .replaceAll('<','&lt;').replaceAll('>','&gt;')
      .replaceAll('"','&quot;').replaceAll("'",'&#39;')
  };
  const script = manager.slice(start, stop) + '\nresult = renderRoleEncounterHistory(role);';
  ctx.role = role;
  vm.runInNewContext(script, ctx, { filename: 'role-eco-history.js' });
  return String(ctx.result);
}

const role = {
  id: 'role_enc_123', name: '原有角色',
  encounterOrigin: { version: 1, sourceCandidateId: 'enc_123' }
};

test('non-encounter legacy roles have no extra UI or invented history', () => {
  const html = render({id:'legacy-1', name:'旧角色'}, {
    listForRole(){ throw new Error('should not read'); }
  });
  assert.equal(html, '');
});

test('profile shows only real formal role ID events and local date deep link', () => {
  const asked = [];
  const html = render(role, {
    listForRole(id, opts) {
      asked.push({id,opts});
      return {ok:true, value:[{
        eventId:'role_enc_123:encounter.first_met', roleId:'role_enc_123',
        type:'encounter.first_met', summary:'在邂逅中认识',
        occurredAt:'2026-11-23T08:00:00.000Z'
      }]};
    }
  });
  assert.equal(asked[0].id,'role_enc_123');
  assert.equal(asked[0].opts.limit,30);
  assert.match(html,/初次相识/);
  assert.match(html,/1 条记录/);
  assert.match(html,/reunionRole=role_enc_123/);
  assert.match(html,/roleId=role_enc_123/);
  assert.match(html,/date=\d{4}-\d{2}-\d{2}/);
  assert.match(html,/<details/);
});

test('unreadable ledger explicitly reports error and keeps role profile links', () => {
  const html = render(role,{listForRole:()=>({ok:false,error:'damaged'})});
  assert.match(html,/相遇记录暂时无法读取/);
  assert.match(html,/0 条记录/);
});

test('event text escapes markup and only shows encounter first-met and reunion', () => {
  const html = render(role,{listForRole:()=>({ok:true,value:[
    {type:'encounter.reunion',summary:'<img src=x onerror=alert(1)>',
      occurredAt:'2026-11-23T08:00:00.000Z'},
    {type:'unrelated.secret',summary:'private leak',
      occurredAt:'2026-11-23T08:00:00.000Z'}
  ]})});
  assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/<img src=x/);
  assert.doesNotMatch(html,/private leak/);
  assert.match(html,/再次相遇/);
});

test('profile history is placed after original social branches and collapsed by default', () => {
  assert.ok(manager.indexOf("renderRoleEncounterHistory(role) +") > manager.indexOf('data-profile-action="life"'));
  assert.match(profilePage, /\.eco-profile-history/);
  assert.match(profilePage,/world-events\.js/);
});

test('encounter role deep-link uses existing role lookup and never saves candidate or role', () => {
  const start = encounter.indexOf('var requestedRole=new URLSearchParams');
  assert.ok(start>0);
  const code = encounter.slice(start, encounter.indexOf('\n})();', start));
  assert.match(code,/engine\.getEncounteredRoles\(\)/);
  assert.match(code,/openReunion\(requestedRole\)/);
  assert.doesNotMatch(code,/saveCandidate|saveRoles|setItem/);
});


test('verified encounter with missing first-meet event offers explicit recovery, not an automatic write', () => {
  let scanned = 0;
  const confirmed = {...role, encounterOrigin:{
    ...role.encounterOrigin, linkedAt:'2026-11-21T09:00:00.000Z'
  }};
  const html = render(confirmed,{
    listForRole(id, opts) {
      assert.equal(id, 'role_enc_123');
      scanned++;
      return {ok:true,value:[]};
    },
    append() { throw new Error('render must remain read-only'); }
  });
  assert.equal(scanned, 2);
  assert.match(html,/data-eco-restore-first/);
  assert.match(html,/<details/);
});

test('successful first-meet lookup hides recovery and links to the actual first date', () => {
  const confirmed = {...role, encounterOrigin:{
    ...role.encounterOrigin, linkedAt:'2026-11-21T09:00:00.000Z'
  }};
  const first = {
    roleId:'role_enc_123',
    type:'encounter.first_met',
    source:{appId:'encounter', recordId:'enc_123'},
    summary:'通过邂逅正式认识',occurredAt:'2026-11-21T09:00:00.000Z'
  };
  const html = render(confirmed,{
    listForRole(id,opts) {
      return {ok:true,value:opts.type === 'encounter.first_met' ? [first] :
        [{type:'encounter.reunion',summary:'再遇',occurredAt:'2026-11-22T12:00:00.000Z'},first]};
    }
  });
  assert.doesNotMatch(html,/data-eco-restore-first/);
  assert.match(html,/date=\d{4}-\d{2}-\d{2}/);
  assert.match(html,/初次相识/);
});

test('corrupt first-meet lookup prohibits recovery rather than inventing history', () => {
  const confirmed={...role,encounterOrigin:{
    ...role.encounterOrigin,linkedAt:'2026-11-21T09:00:00.000Z'
  }};
  const html=render(confirmed,{
    listForRole(id,opts) {
      if (opts.type === 'encounter.first_met') return {ok:false,error:'corrupt'};
      return {ok:true,value:[]};
    }
  });
  assert.doesNotMatch(html,/data-eco-restore-first/);
  assert.match(html,/初次相遇记录暂时无法核验/);
});

test('manual recovery handler uses the same formal role and preserved linkedAt', () => {
  assert.match(manager,/data-eco-restore-first/);
  assert.match(manager,/typeof events\.append !== 'function'/);
  assert.match(manager,/occurredAt: linked\.linkedAt/);
  assert.match(manager,/roleId: roleIdAtClick, type: 'encounter\.first_met'/);
  assert.match(manager,/allowAI: false/);
});
