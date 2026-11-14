import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_STORES, makeAggregateQueries, parseAggregateResults,
  auditLiveContinuity } from '../scripts/release/audit-live-account-inventory.mjs';

const founder = 'MAO-TEST001SAFE0001';
function fake({accounts=0,admins=0,members=0,selected_admin=0,selected_exists=0,
  audit_events=0,sessions=0,invitations=0,migrations=20}={}) {
  const values=[
    [accounts,admins,members,selected_admin,selected_exists],
    [audit_events],[sessions],[invitations],[migrations]
  ];
  const cols=[
    ['accounts','admins','members','selected_admin','selected_exists'],
    ['audit_events'],['sessions'],['invitations'],['migrations']
  ];
  return {success:true,result:{results:cols.map((columns,i)=>({
    columns,rows:[values[i]],meta:{rows_written:0,rows_read:values[i][0]}
  }))}};
}
function stores() {
  return {
    existingMembers: parseAggregateResults(fake({accounts:2,admins:1,members:1,audit_events:4,sessions:3,migrations:17})),
    integratedBackend: parseAggregateResults(fake({migrations:16})),
    isolatedQA: parseAggregateResults(fake({accounts:1,admins:1,selected_admin:1,selected_exists:1,audit_events:1})),
    permanentIdentity: parseAggregateResults(fake({migrations:16}))
  };
}

test('fixed SQL uses only SELECT and bound founder ID; never loads a user record', () => {
  assert.deepEqual(Object.values(ACCOUNT_STORES), [
    'mao-auth-preview','mao','maomao-aw-qa-20261114','maomao-identity-core'
  ]);
  const q=makeAggregateQueries(founder);
  assert.equal(q.length,5);
  assert.deepEqual(q[0].params,[founder,founder]);
  assert.ok(q.every(v=>/^\s*SELECT\b/.test(v.sql)));
  assert.equal(q.some(v=>/\b(password_hash|password_salt|token_hash|SELECT \*)\b/i.test(v.sql)),false);
  assert.throws(()=>makeAggregateQueries('someone-else'),/EXPECTED_FOUNDER_ID_INVALID/);
});

test('actual live account state must block cutover while QA founder and live member are separated', () => {
  const state=stores();
  assert.deepEqual(state.existingMembers,{
    accounts:2,admins:1,members:1,selected_admin:0,selected_exists:0,
    audit_events:4,sessions:3,invitations:0,migrations:17
  });
  assert.deepEqual(auditLiveContinuity(state),[
    'OLD_AUTHORITY_HAS_DIFFERENT_FOUNDER',
    'INTEGRATED_BACKEND_FOUNDER_NOT_READY',
    'PERMANENT_IDENTITY_NOT_READY',
    'EXISTING_MEMBERS_NOT_CONTINUOUS_IN_BACKEND'
  ]);
});

test('even a matching account inventory is NOT a backup, a real-device check or a release approval', () => {
  const state=stores();
  state.existingMembers = parseAggregateResults(fake({accounts:2,admins:1,members:1,selected_admin:1,selected_exists:1}));
  state.integratedBackend = parseAggregateResults(fake({accounts:2,admins:1,members:1,selected_admin:1,selected_exists:1}));
  state.permanentIdentity = parseAggregateResults(fake({accounts:1,admins:1,selected_admin:1,selected_exists:1}));
  assert.deepEqual(auditLiveContinuity(state),[]);
  assert.equal('releaseApproved' in state,false,'inventory must not authorize a release');
});

test('rejects malformed API envelopes, missing read-only metadata and any indication of writes', () => {
  assert.throws(()=>parseAggregateResults({success:false,result:{}}),/RESPONSE_INVALID/);
  const writes=fake();
  writes.result.results[2].meta.rows_written=1;
  assert.throws(()=>parseAggregateResults(writes),/NOT_PROVABLY_READ_ONLY/);
  const missing=fake();
  delete missing.result.results[0].meta;
  assert.throws(()=>parseAggregateResults(missing),/NOT_PROVABLY_READ_ONLY/);
  const rows=fake();
  rows.result.results[0].rows.push([3,0,3,0,0]);
  assert.throws(()=>parseAggregateResults(rows),/NOT_PROVABLY_READ_ONLY/);
  const renamed=fake();
  renamed.result.results[0].columns[0]='user_id';
  assert.throws(()=>parseAggregateResults(renamed),/NOT_PROVABLY_READ_ONLY/);
});

test('rejects contradictory, negative, fractional, and duplicate selected-founder counts', () => {
  const cases=[
    {accounts:2,admins:2,members:1},
    {accounts:1,admins:-1,members:2},
    {accounts:2,admins:1.5,members:0.5},
    {accounts:1,admins:1,members:0,selected_admin:2,selected_exists:1},
    {accounts:0,admins:0,members:0,selected_admin:1,selected_exists:0}
  ];
  for(const sample of cases)assert.throws(()=>parseAggregateResults(fake(sample)),/INVALID_COUNT|CONTRADICTORY/);
});

test('missing one store or loss of previous real members must always block',()=>{
  const state=stores();
  delete state.permanentIdentity;
  assert.deepEqual(auditLiveContinuity(state),['ACCOUNT_STORES_INCOMPLETE']);
  state.permanentIdentity=parseAggregateResults(fake());
  state.existingMembers=parseAggregateResults(fake());
  assert.ok(auditLiveContinuity(state).includes('EXISTING_LIVE_MEMBER_NOT_VERIFIED'));
});
