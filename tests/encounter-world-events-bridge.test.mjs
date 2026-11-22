import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const manager = fs.readFileSync(new URL('../worldbook/characters/js/characters-manager.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../worldbook/characters/characters.html', import.meta.url), 'utf8');

function getHook() {
  const begin = manager.indexOf('const createdEncounter = !roleId && activeEncounterDraftId');
  const end = manager.indexOf('    const oldDraftKey = currentDraftKey;', begin);
  assert.ok(begin > 0 && end > begin, 'encounter event hook exists');
  return manager.slice(begin, end);
}

async function runHook({ formalRole = false, success = true, missing = false } = {}) {
  const records = [];
  const statuses = [];
  const ctx = {
    roleId: formalRole ? 'role-7' : '',
    activeEncounterDraftId: 'enc_111',
    savedRoleId: 'role-7',
    roles: [{
      id: 'role-7',
      name: '林某',
      encounterOrigin: {
        version: 1,
        sourceCandidateId: 'enc_111',
        linkedAt: '2026-11-23T09:00:00.000Z'
      }
    }],
    window: {
      WorldEvents: missing ? null : {
        append: async (entry) => {
          records.push(entry);
          return { ok: success };
        }
      }
    },
    document: { getElementById: () => ({ value: 'role-7' }) },
    setSaveStatus: (...args) => statuses.push(args)
  };
  vm.runInNewContext(getHook(), vm.createContext(ctx), { filename: 'encounter-first-met-hook.js' });
  await new Promise(resolve => setImmediate(resolve));
  return { records, statuses };
}

test('shared ledger script loads before character save handler', () => {
  const ledger = html.indexOf('shared/js/phone/world-events.js');
  const managerScript = html.indexOf('js/characters-manager.js');
  assert.ok(ledger > 0 && managerScript > ledger);
});

test('event hook is strictly placed after the verified role save gate', () => {
  const saved = manager.indexOf('if (!saveRoles(roles))', manager.indexOf('function handleSaveRole()'));
  const hook = manager.indexOf('const createdEncounter = !roleId && activeEncounterDraftId', saved);
  assert.ok(saved > 0 && hook > saved);
  assert.ok(manager.slice(saved, hook).includes('return;'));
  assert.match(manager, /linkedAt: new Date\(\)\.toISOString\(\)/);
});

test('confirmed role creation emits exactly one stable first-met reference without AI opt-in', async () => {
  const result = await runHook();
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].type, 'encounter.first_met');
  assert.equal(result.records[0].roleId, 'role-7');
  assert.equal(result.records[0].source.recordId, 'enc_111');
  assert.equal(result.records[0].occurredAt, '2026-11-23T09:00:00.000Z');
  assert.equal(result.records[0].provenance, 'user-confirmed');
  assert.equal(result.records[0].allowAI, false);
});

test('editing a formal role does not create a first encounter', async () => {
  const result = await runHook({ formalRole: true });
  assert.equal(result.records.length, 0);
});

test('failed ledger write never claims successful event persistence or discards role', async () => {
  const result = await runHook({ success: false });
  assert.equal(result.records.length, 1);
  assert.ok(result.statuses.some(args => args[0].includes('角色已保存') && args[0].includes('相遇记录未能写入')));
});

test('unavailable ledger surfaces incomplete linkage without harming the formal role', async () => {
  const result = await runHook({ missing: true });
  assert.equal(result.records.length, 0);
  assert.ok(result.statuses.some(args => args[0].includes('相遇记录模块未加载')));
});
