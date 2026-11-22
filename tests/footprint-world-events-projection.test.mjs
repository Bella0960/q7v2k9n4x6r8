import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../chat/footprint/footprint.html', import.meta.url), 'utf8');

function snippet() {
  const begin = html.indexOf('function worldEventsBetween(start, end)');
  const end = html.indexOf('  // ================= 日历页 =================', begin);
  assert.ok(begin > 0 && end > begin);
  return html.slice(begin, end);
}
function render({ fail = false, includeLegacy = true, role = 'role-A' } = {}) {
  const calls = [];
  const timeline = { innerHTML: '' };
  const count = { textContent: '' };
  const storage = { writes: [] };
  const context = vm.createContext({
    currentRoleId: role, currentRole: '人物A', currentDate: '2026-11-23',
    window: {
      WorldEvents: {
        listForRole: (id, options) => {
          calls.push({ id, options });
          if (fail) return { ok: false, error: 'corrupt' };
          return { ok: true, value: [{
            schemaVersion: 1, roleId: id, eventId: 'event-1',
            occurredAt: '2026-11-23T09:00:00.000Z',
            type: 'encounter.first_met', summary: '<script>危险文字</script>'
          }] };
        }
      }
    },
    document: { querySelector: selector => selector === '.timeline' ? timeline : { querySelector: () => count } },
    itemsOf: () => includeLegacy ? [{
      id: 'fp-1', time: '08:00', action: '整理书架', status: '平静', thought: '记录本'
    }] : [],
    periodOf: () => '上午',
    pad: number => String(number).padStart(2, '0'),
    escapeFootprintHtml: s => String(s ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;'),
    Number, Date, Set, String,
    localStorage: { setItem: (...args) => storage.writes.push(args) }
  });
  vm.runInContext(snippet(), context, { filename: 'footprint-projection.js' });
  vm.runInContext('renderTimeline()', context);
  return { timeline: timeline.innerHTML, calls, writes: storage.writes, context };
}

test('footprint loads ecosystem ledger and keeps original JSON AI module', () => {
  assert.ok(html.indexOf('world-events.js') > 0);
  assert.ok(html.includes('footprint-ai.js'));
  assert.ok(html.includes("model.writeDay(localStorage,requestRoleId,requestDate,entries,originalFootprintRaw)"));
});

test('actual timeline projection displays existing footprint plus event without rewriting either store', () => {
  const r = render();
  assert.match(r.timeline, /整理书架/);
  assert.match(r.timeline, /初次相识/);
  assert.match(r.timeline, /相遇/);
  assert.equal(r.writes.length, 0);
});

test('event queries are scoped to the currently selected immutable role ID', () => {
  const r = render({ role: 'role-B' });
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].id, 'role-B');
  assert.ok(r.calls[0].options.from.endsWith('Z'));
  assert.ok(r.calls[0].options.to.endsWith('Z'));
});

test('unsafe event descriptions are escaped and event cards do not masquerade as editable footprint items', () => {
  const r = render({ includeLegacy: false });
  assert.match(r.timeline, /&lt;script&gt;/);
  assert.doesNotMatch(r.timeline, /<script>/);
  assert.match(r.timeline, /class="t-eco-item"/);
  assert.doesNotMatch(r.timeline, /data-id="event-1"/);
});

test('corrupt or inaccessible world events never wipe existing footprint UI', () => {
  const r = render({ fail: true });
  assert.match(r.timeline, /整理书架/);
  assert.match(r.timeline, /暂时无法读取/);
  assert.equal(r.writes.length, 0);
});

test('calendar includes event-only days and count is a non-persistent projection', () => {
  assert.match(html, /eventDays\.has\(key\)/);
  assert.match(html, /worldEventsForDay\(currentDate\)/);
  assert.match(html, /const n = itemsOf\(currentRole, currentDate\)\.length \+/);
  assert.match(html, /new Date\(year, month - 1, day \+ 1\)/);
});
