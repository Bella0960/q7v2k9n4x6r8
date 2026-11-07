import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SOURCE_URL = new URL('../shared/js/phone/character-schedule-policy.js', import.meta.url);
const SOURCE = readFileSync(SOURCE_URL, 'utf8');

/* The module is a classic browser script, so evaluate it in the current
 * realm. A vm sandbox would create cross-realm arrays and make strict
 * deep equality fail on prototype identity, not on logic. */
function loadPolicy() {
  const previous = globalThis.CharacterSchedulePolicy;
  runInThisContext(SOURCE, { filename: SOURCE_URL.pathname });
  const api = globalThis.CharacterSchedulePolicy;
  if (previous === undefined) {
    delete globalThis.CharacterSchedulePolicy;
  } else {
    globalThis.CharacterSchedulePolicy = previous;
  }
  assert.ok(api, 'module must expose CharacterSchedulePolicy');
  return api;
}

const P = loadPolicy();

/* Test-only timing inputs. They are not product decisions and are always
 * passed explicitly, because the module refuses to invent defaults. */
const CONFIG = Object.freeze({
  heartbeatTtlMs: 3 * 60 * 1000,
  leaseDurationMs: 3 * 60 * 1000,
  graceMs: 60 * 1000
});
const USER = 'owner';
const CHAR = 'char-1';
const TZ_CN = 'Asia/Shanghai';

function makeInput(overrides = {}) {
  return {
    nowMs: Date.parse('2026-06-01T02:00:00Z'), // 10:00 in Asia/Shanghai
    timeZone: TZ_CN,
    userId: USER,
    characterId: CHAR,
    schedule: { active: [{ start: '09:00', end: '22:00' }] },
    authorization: { globalAutonomyEnabled: true, characterAutonomyEnabled: null },
    presence: { devices: [], leases: [] },
    config: CONFIG,
    ...overrides
  };
}

function makeLease(deviceId, leaseUntil, extra = {}) {
  return {
    deviceId,
    userId: USER,
    characterId: CHAR,
    authorized: true,
    leaseUntil,
    ...extra
  };
}

test('legacy proactive and follow-up window values are unchanged', () => {
  assert.deepEqual(P.LEGACY_WINDOWS.proactive, { start: '09:00', end: '22:00' });
  assert.deepEqual(P.LEGACY_WINDOWS.followUp, { start: '09:00', end: '23:00' });

  const proactive = P.LEGACY_WINDOWS.proactive;
  const cases = [
    ['2026-06-01T00:59:00Z', false], // 08:59 local
    ['2026-06-01T01:00:00Z', true],  // 09:00 local, start inclusive
    ['2026-06-01T13:59:00Z', true],  // 21:59 local
    ['2026-06-01T14:00:00Z', false]  // 22:00 local, end exclusive
  ];
  for (const [iso, expected] of cases) {
    const result = P.isWithinWindow(Date.parse(iso), TZ_CN, proactive);
    assert.equal(result.ok, true);
    assert.equal(result.matches, expected, iso);
  }

  // 22:59 is outside the proactive window but still inside the follow-up window.
  assert.equal(P.isWithinWindow(Date.parse('2026-06-01T14:59:00Z'), TZ_CN, proactive).matches, false);
  assert.equal(P.isWithinWindow(Date.parse('2026-06-01T14:59:00Z'), TZ_CN, P.LEGACY_WINDOWS.followUp).matches, true);
  assert.equal(P.isWithinWindow(Date.parse('2026-06-01T15:00:00Z'), TZ_CN, P.LEGACY_WINDOWS.followUp).matches, false);
});

test('cross-midnight windows match on both sides of midnight', () => {
  const window = { start: '23:00', end: '07:00' };
  const cases = [
    ['2026-06-01T15:30:00Z', true],  // 23:30 local
    ['2026-06-01T16:30:00Z', true],  // 00:30 next local day
    ['2026-06-01T22:59:00Z', true],  // 06:59 local
    ['2026-06-01T23:00:00Z', false], // 07:00 local, end exclusive
    ['2026-06-02T04:00:00Z', false]  // 12:00 local
  ];
  for (const [iso, expected] of cases) {
    const result = P.isWithinWindow(Date.parse(iso), TZ_CN, window);
    assert.equal(result.ok, true);
    assert.equal(result.matches, expected, iso);
  }
});

test('start equal to end is a full-day window', () => {
  assert.equal(P.matchesMinuteOfDay(0, 0, 0), true);
  assert.equal(P.matchesMinuteOfDay(600, 0, 0), true);
  assert.equal(P.matchesMinuteOfDay(1439, 0, 0), true);
});

test('IANA time zones are resolved from the instant, not host local time', () => {
  const instant = Date.parse('2026-01-01T02:00:00Z');
  const shanghai = P.getTimeZoneParts(instant, 'Asia/Shanghai');
  const losAngeles = P.getTimeZoneParts(instant, 'America/Los_Angeles');

  assert.equal(shanghai.ok, true);
  assert.equal(shanghai.hour, 10);
  assert.equal(shanghai.minute, 0);
  assert.equal(shanghai.day, 1);

  assert.equal(losAngeles.ok, true);
  assert.equal(losAngeles.hour, 18);
  assert.equal(losAngeles.minute, 0);
  assert.equal(losAngeles.day, 31);
  assert.equal(losAngeles.month, 12);

  const schedule = { active: [{ start: '09:00', end: '12:00' }] };
  const shanghaiResult = P.evaluate(makeInput({ nowMs: instant, timeZone: 'Asia/Shanghai', schedule }));
  const losAngelesResult = P.evaluate(makeInput({ nowMs: instant, timeZone: 'America/Los_Angeles', schedule }));
  assert.equal(shanghaiResult.character.state, 'active');
  assert.equal(losAngelesResult.character.state, 'inactive');
});

test('date-line time zones produce different local dates for the same instant', () => {
  const instant = Date.parse('2026-01-01T10:00:00Z');
  const kiritimati = P.getTimeZoneParts(instant, 'Pacific/Kiritimati');
  const honolulu = P.getTimeZoneParts(instant, 'Pacific/Honolulu');

  assert.equal(kiritimati.year, 2026);
  assert.equal(kiritimati.month, 1);
  assert.equal(kiritimati.day, 2);
  assert.equal(kiritimati.hour, 0);

  assert.equal(honolulu.year, 2026);
  assert.equal(honolulu.month, 1);
  assert.equal(honolulu.day, 1);
  assert.equal(honolulu.hour, 0);
});

test('DST spring forward: the missing local hour never matches a schedule window', () => {
  const beforeGap = Date.parse('2026-03-08T06:59:00Z');
  const afterGap = Date.parse('2026-03-08T07:00:00Z');

  const beforeParts = P.getTimeZoneParts(beforeGap, 'America/New_York');
  const afterParts = P.getTimeZoneParts(afterGap, 'America/New_York');

  assert.equal(beforeParts.hour, 1);
  assert.equal(beforeParts.minute, 59);
  assert.equal(beforeParts.offsetMinutes, -300);

  assert.equal(afterParts.hour, 3);
  assert.equal(afterParts.minute, 0);
  assert.equal(afterParts.offsetMinutes, -240);

  const window = { start: '02:00', end: '03:00' };
  assert.equal(P.isWithinWindow(beforeGap, 'America/New_York', window).matches, false);
  assert.equal(P.isWithinWindow(afterGap, 'America/New_York', window).matches, false);

  const missing = P.resolveWallClock(
    { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
    'America/New_York'
  );
  assert.equal(missing.ok, true);
  assert.equal(missing.nonexistent, true);
  assert.equal(missing.ambiguous, false);
  assert.deepEqual(missing.timestamps, []);
  assert.equal(missing.timestamp, null);
});

test('DST fall back: the repeated local hour matches in both occurrences', () => {
  const first = Date.parse('2026-11-01T05:30:00Z');  // 01:30 EDT
  const second = Date.parse('2026-11-01T06:30:00Z'); // 01:30 EST

  const firstParts = P.getTimeZoneParts(first, 'America/New_York');
  const secondParts = P.getTimeZoneParts(second, 'America/New_York');
  assert.equal(firstParts.hour, 1);
  assert.equal(firstParts.minute, 30);
  assert.equal(firstParts.offsetMinutes, -240);
  assert.equal(secondParts.hour, 1);
  assert.equal(secondParts.minute, 30);
  assert.equal(secondParts.offsetMinutes, -300);

  const window = { start: '01:00', end: '02:00' };
  assert.equal(P.isWithinWindow(first, 'America/New_York', window).matches, true);
  assert.equal(P.isWithinWindow(second, 'America/New_York', window).matches, true);

  const repeated = P.resolveWallClock(
    { year: 2026, month: 11, day: 1, hour: 1, minute: 30 },
    'America/New_York'
  );
  assert.equal(repeated.ok, true);
  assert.equal(repeated.nonexistent, false);
  assert.equal(repeated.ambiguous, true);
  assert.equal(repeated.timestamps.length, 2);
  assert.deepEqual(repeated.timestamps, [first, second]);
});

test('character state applies away > asleep > busy > active > inactive', () => {
  const at10 = Date.parse('2026-06-01T02:00:00Z');
  const stateOf = (schedule) => P.evaluate(makeInput({ nowMs: at10, schedule })).character.state;

  assert.equal(stateOf({
    away: true,
    asleep: [{ start: '09:00', end: '12:00' }],
    busy: [{ start: '09:00', end: '12:00' }],
    active: [{ start: '09:00', end: '22:00' }]
  }), 'away');

  assert.equal(stateOf({
    asleep: [{ start: '09:00', end: '12:00' }],
    busy: [{ start: '09:00', end: '12:00' }],
    active: [{ start: '09:00', end: '22:00' }]
  }), 'asleep');

  assert.equal(stateOf({
    busy: [{ start: '09:00', end: '12:00' }],
    active: [{ start: '09:00', end: '22:00' }]
  }), 'busy');

  assert.equal(stateOf({ active: [{ start: '09:00', end: '22:00' }] }), 'active');
  assert.equal(stateOf({}), 'inactive');
  assert.equal(stateOf({ active: [] }), 'inactive');
});

test('presence and character state are computed independently', () => {
  const nowMs = Date.parse('2026-06-01T02:00:00Z');
  const result = P.evaluate(makeInput({
    nowMs,
    presence: {
      devices: [{ deviceId: 'A', userId: USER, authorized: true, lastHeartbeatAt: nowMs - 10 * 60 * 1000 }],
      leases: []
    }
  }));

  assert.equal(result.ok, true);
  assert.equal(result.character.state, 'active');
  assert.equal(result.presence.state, 'background_or_offline');
  assert.equal(result.presence.hasValidForegroundLease, false);
  assert.equal(result.execution.owner, 'cloud');
  assert.equal(result.execution.contactAllowed, true);
});

test('未来时间戳不会被当作当前前台在线心跳', () => {
  const nowMs = Date.parse('2026-06-01T02:00:00Z');
  const result = P.evaluate(makeInput({
    nowMs,
    presence: {
      devices: [{ deviceId: 'future', userId: USER, authorized: true, lastHeartbeatAt: nowMs + 1000 }],
      leases: []
    }
  }));

  assert.equal(result.ok, true);
  assert.equal(result.presence.state, 'background_or_offline');
  assert.deepEqual(result.presence.activeDeviceIds, []);
});

test('an offline device never turns into away, asleep or paused', () => {
  const result = P.evaluate(makeInput({
    schedule: {},
    presence: { devices: [], leases: [] }
  }));

  assert.equal(result.character.state, 'inactive');
  assert.notEqual(result.character.state, 'away');
  assert.notEqual(result.character.state, 'asleep');
  assert.equal(result.presence.state, 'background_or_offline');
  assert.equal(result.autonomy.allowed, true);
  assert.equal(result.execution.owner, 'none');
});

test('autonomy is a separate global and per-character permission', () => {
  const globalOff = P.evaluate(makeInput({
    authorization: { globalAutonomyEnabled: false, characterAutonomyEnabled: true }
  }));
  assert.equal(globalOff.autonomy.allowed, false);
  assert.equal(globalOff.autonomy.reason, 'global-autonomy-off');
  assert.equal(globalOff.execution.owner, 'none');
  assert.equal(globalOff.execution.cloudMayClaim, false);

  const characterOff = P.evaluate(makeInput({
    authorization: { globalAutonomyEnabled: true, characterAutonomyEnabled: false }
  }));
  assert.equal(characterOff.autonomy.allowed, false);
  assert.equal(characterOff.autonomy.reason, 'character-autonomy-off');
  assert.equal(characterOff.execution.owner, 'none');

  const inherited = P.evaluate(makeInput({
    authorization: { globalAutonomyEnabled: true, characterAutonomyEnabled: null }
  }));
  assert.equal(inherited.autonomy.allowed, true);
  assert.equal(inherited.autonomy.inherited, true);
  assert.equal(inherited.execution.owner, 'cloud');

  const missingGlobal = P.evaluate(makeInput({ authorization: { characterAutonomyEnabled: true } }));
  assert.equal(missingGlobal.autonomy.allowed, false);
  assert.equal(missingGlobal.autonomy.reason, 'global-autonomy-off');
});

test('any device with a valid foreground lease keeps the cloud out', () => {
  const nowMs = Date.parse('2026-06-01T02:00:00Z');
  const result = P.evaluate(makeInput({
    nowMs,
    presence: {
      devices: [{ deviceId: 'B', userId: USER, authorized: true, lastHeartbeatAt: nowMs - 10 * 60 * 1000 }],
      leases: [makeLease('A', nowMs + 2 * 60 * 1000)]
    }
  }));

  assert.equal(result.presence.hasValidForegroundLease, true);
  assert.deepEqual(result.presence.validLeaseDeviceIds, ['A']);
  assert.equal(result.execution.owner, 'foreground');
  assert.equal(result.execution.cloudMayClaim, false);
  assert.equal(result.execution.contactAllowed, false);
  assert.deepEqual(result.execution.reasons, ['foreground-lease-active']);
});

test('multiple valid leases still never allow the cloud to double-execute', () => {
  const nowMs = Date.parse('2026-06-01T02:00:00Z');
  const result = P.evaluate(makeInput({
    nowMs,
    presence: {
      devices: [],
      leases: [
        makeLease('A', nowMs + 60 * 1000),
        makeLease('B', nowMs + 90 * 1000)
      ]
    }
  }));

  assert.equal(result.presence.hasValidForegroundLease, true);
  assert.deepEqual(result.presence.validLeaseDeviceIds, ['A', 'B']);
  assert.equal(result.execution.owner, 'foreground');
  assert.equal(result.execution.cloudMayClaim, false);
});

test('cloud waits during the foreground lease grace period', () => {
  const nowMs = Date.parse('2026-06-01T02:00:00Z');
  const result = P.evaluate(makeInput({
    nowMs,
    presence: {
      devices: [],
      leases: [makeLease('A', nowMs - 30 * 1000)]
    }
  }));

  assert.equal(result.presence.hasValidForegroundLease, false);
  assert.equal(result.presence.gracePending, true);
  assert.deepEqual(result.presence.graceLeaseDeviceIds, ['A']);
  assert.equal(result.execution.owner, 'none');
  assert.equal(result.execution.cloudMayClaim, false);
  assert.deepEqual(result.execution.reasons, ['foreground-lease-grace']);
});

test('lease end is exclusive and exactly-expired leases enter grace', () => {
  const nowMs = Date.parse('2026-06-01T02:00:00Z');
  const result = P.evaluate(makeInput({
    nowMs,
    presence: { devices: [], leases: [makeLease('A', nowMs)] }
  }));

  assert.equal(result.presence.hasValidForegroundLease, false);
  assert.equal(result.presence.gracePending, true);
  assert.equal(result.presence.expiredLeaseDeviceIds.length, 0);
});

test('cloud becomes eligible only after every lease and grace expires', () => {
  const nowMs = Date.parse('2026-06-01T02:00:00Z');
  const result = P.evaluate(makeInput({
    nowMs,
    presence: {
      devices: [],
      leases: [makeLease('A', nowMs - 5 * 60 * 1000)]
    }
  }));

  assert.equal(result.presence.hasValidForegroundLease, false);
  assert.equal(result.presence.gracePending, false);
  assert.deepEqual(result.presence.expiredLeaseDeviceIds, ['A']);
  assert.equal(result.execution.owner, 'cloud');
  assert.equal(result.execution.cloudMayClaim, true);
  assert.equal(result.execution.contactAllowed, true);
});

test('unauthorized and other-character leases cannot block the cloud', () => {
  const nowMs = Date.parse('2026-06-01T02:00:00Z');
  const result = P.evaluate(makeInput({
    nowMs,
    presence: {
      devices: [],
      leases: [
        makeLease('X', nowMs + 5 * 60 * 1000, { authorized: false }),
        makeLease('Y', nowMs + 5 * 60 * 1000, { characterId: 'another-character' })
      ]
    }
  }));

  assert.equal(result.presence.hasValidForegroundLease, false);
  assert.deepEqual(result.presence.ignoredLeaseDeviceIds, ['X']);
  assert.equal(result.execution.owner, 'cloud');
});

test('lease duration is configurable when leaseUntil is absent', () => {
  const nowMs = Date.parse('2026-06-01T02:00:00Z');

  const valid = P.evaluate(makeInput({
    nowMs,
    presence: {
      devices: [],
      leases: [{ deviceId: 'A', userId: USER, characterId: CHAR, authorized: true, leaseStartedAt: nowMs - 60 * 1000 }]
    }
  }));
  assert.equal(valid.presence.hasValidForegroundLease, true);

  const expired = P.evaluate(makeInput({
    nowMs,
    presence: {
      devices: [],
      leases: [{ deviceId: 'A', userId: USER, characterId: CHAR, authorized: true, leaseStartedAt: nowMs - 5 * 60 * 1000 }]
    }
  }));
  assert.equal(expired.presence.hasValidForegroundLease, false);
  assert.equal(expired.presence.gracePending, false);
  assert.deepEqual(expired.presence.expiredLeaseDeviceIds, ['A']);
  assert.equal(expired.execution.owner, 'cloud');
});

test('a foreground heartbeat alone is presence, not a lease', () => {
  const nowMs = Date.parse('2026-06-01T02:00:00Z');
  const result = P.evaluate(makeInput({
    nowMs,
    presence: {
      devices: [{ deviceId: 'A', userId: USER, authorized: true, lastHeartbeatAt: nowMs - 60 * 1000 }],
      leases: []
    }
  }));

  assert.equal(result.presence.state, 'foreground_active');
  assert.deepEqual(result.presence.activeDeviceIds, ['A']);
  assert.equal(result.presence.hasValidForegroundLease, false);
  assert.equal(result.execution.cloudMayClaim, true);
});

test('busy and asleep characters block cloud contact even without a lease', () => {
  const nowMs = Date.parse('2026-06-01T02:00:00Z');
  const busy = P.evaluate(makeInput({
    nowMs,
    schedule: { busy: [{ start: '09:00', end: '12:00' }] }
  }));
  assert.equal(busy.character.state, 'busy');
  assert.equal(busy.execution.owner, 'none');
  assert.equal(busy.execution.cloudMayClaim, true);
  assert.equal(busy.execution.contactAllowed, false);

  const asleep = P.evaluate(makeInput({
    nowMs,
    schedule: { asleep: [{ start: '09:00', end: '12:00' }] }
  }));
  assert.equal(asleep.character.state, 'asleep');
  assert.equal(asleep.execution.contactAllowed, false);

  const away = P.evaluate(makeInput({
    nowMs,
    schedule: { away: true, active: [{ start: '09:00', end: '22:00' }] }
  }));
  assert.equal(away.character.state, 'away');
  assert.equal(away.execution.contactAllowed, false);
});

test('config values are required inputs, not hidden product defaults', () => {
  const missingGrace = P.evaluate(makeInput({
    config: { heartbeatTtlMs: 180000, leaseDurationMs: 180000 }
  }));
  assert.equal(missingGrace.ok, false);
  assert.equal(missingGrace.reason, 'missing-config:graceMs');

  const missingHeartbeat = P.evaluate(makeInput({
    config: { leaseDurationMs: 180000, graceMs: 60000 }
  }));
  assert.equal(missingHeartbeat.ok, false);
  assert.equal(missingHeartbeat.reason, 'missing-config:heartbeatTtlMs');

  const negative = P.evaluate(makeInput({
    config: { heartbeatTtlMs: -1, leaseDurationMs: 180000, graceMs: 60000 }
  }));
  assert.equal(negative.ok, false);
  assert.equal(negative.reason, 'invalid-config:heartbeatTtlMs');
});

test('invalid time zones and timestamps fail closed', () => {
  const invalidZone = P.evaluate(makeInput({ timeZone: 'Mars/Olympus' }));
  assert.equal(invalidZone.ok, false);
  assert.equal(invalidZone.reason, 'invalid-time-zone');

  const invalidTime = P.evaluate(makeInput({ nowMs: 'not-a-date' }));
  assert.equal(invalidTime.ok, false);
  assert.equal(invalidTime.reason, 'invalid-timestamp');

  assert.equal(P.isValidTimeZone('Asia/Shanghai'), true);
  assert.equal(P.isValidTimeZone('Mars/Olympus'), false);
  assert.equal(P.isValidTimeZone(''), false);
});
