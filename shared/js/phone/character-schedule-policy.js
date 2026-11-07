/* MAOMAO Character Schedule Policy (M2.1)
 * Pure logic for IANA time zones, wall-clock windows, character state,
 * presence aggregation and multi-device foreground leases.
 *
 * No DOM access, no Worker API, no persistence, no network.
 * This module is NOT wired into the current chat pages. The existing
 * chat-presence-policy.js and chat-followup-policy.js stay untouched.
 */
(function (global) {
  'use strict';

  var MINUTE_MS = 60 * 1000;
  var HOUR_MS = 60 * MINUTE_MS;

  /* Existing front-end windows. Values are copied verbatim so tests can
   * assert that the new module did not change them.
   * proactive: chat-presence-policy.js quietStartHour=9 / quietEndHour=22
   * followUp:  chat-followup-policy.js QUIET_START_HOUR=9 / QUIET_END_HOUR=23
   */
  var LEGACY_WINDOWS = Object.freeze({
    proactive: Object.freeze({ start: '09:00', end: '22:00' }),
    followUp: Object.freeze({ start: '09:00', end: '23:00' })
  });

  var CHARACTER_STATES = Object.freeze({
    ACTIVE: 'active',
    BUSY: 'busy',
    ASLEEP: 'asleep',
    AWAY: 'away',
    INACTIVE: 'inactive'
  });

  var PRESENCE_STATES = Object.freeze({
    FOREGROUND_ACTIVE: 'foreground_active',
    BACKGROUND_OR_OFFLINE: 'background_or_offline'
  });

  var EXECUTION_OWNERS = Object.freeze({
    FOREGROUND: 'foreground',
    CLOUD: 'cloud',
    NONE: 'none'
  });

  var formatterCache = Object.create(null);

  function parseClock(value) {
    var text = String(value == null ? '' : value).trim();
    var match = /^(\d{1,2}):(\d{2})$/.exec(text);
    if (!match) return null;
    var hour = Number(match[1]);
    var minute = Number(match[2]);
    if (!isFinite(hour) || !isFinite(minute)) return null;
    if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
    if (hour === 24 && minute !== 0) return null;
    return hour * 60 + minute;
  }

  function normalizeWindow(value) {
    if (!value || typeof value !== 'object') return null;
    var startMinute;
    var endMinute;
    if (value.start != null || value.end != null) {
      startMinute = parseClock(value.start);
      endMinute = parseClock(value.end);
    } else if (value.startMinute != null || value.endMinute != null) {
      startMinute = Number(value.startMinute);
      endMinute = Number(value.endMinute);
    } else if (value.startHour != null || value.endHour != null) {
      var startHour = Number(value.startHour);
      var endHour = Number(value.endHour);
      startMinute = isFinite(startHour) ? startHour * 60 : NaN;
      endMinute = isFinite(endHour) ? endHour * 60 : NaN;
    } else {
      return null;
    }
    if (!isFinite(startMinute) || !isFinite(endMinute)) return null;
    if (startMinute < 0 || startMinute > 1439) return null;
    if (endMinute < 0 || endMinute > 1440) return null;
    return { startMinute: startMinute, endMinute: endMinute };
  }

  function normalizeWindows(list) {
    if (!Array.isArray(list)) return [];
    var windows = [];
    for (var i = 0; i < list.length; i += 1) {
      var normalized = normalizeWindow(list[i]);
      if (normalized) windows.push(normalized);
    }
    return windows;
  }

  /* Wall-clock minute matching. End is exclusive. Cross-midnight windows
   * (start > end) are real: 23:00-07:00 means >= 23:00 OR < 07:00.
   * start === end is treated as a full-day window.
   */
  function matchesMinuteOfDay(minuteOfDay, startMinute, endMinute) {
    var minute = Number(minuteOfDay);
    var start = Number(startMinute);
    var end = Number(endMinute);
    if (!isFinite(minute) || !isFinite(start) || !isFinite(end)) return false;
    if (start === end) return true;
    if (start < end) return minute >= start && minute < end;
    return minute >= start || minute < end;
  }

  function windowMatches(parts, windowValue) {
    if (!parts || !windowValue) return false;
    return matchesMinuteOfDay(parts.minutesOfDay, windowValue.startMinute, windowValue.endMinute);
  }

  function isValidTimeZone(timeZone) {
    if (!timeZone || typeof timeZone !== 'string') return false;
    if (formatterCache[timeZone]) return true;
    try {
      formatterCache[timeZone] = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  function getFormatter(timeZone) {
    if (!isValidTimeZone(timeZone)) return null;
    return formatterCache[timeZone];
  }

  /* Returns explicit local calendar fields for an absolute instant.
   * Never relies on the host machine time zone.
   */
  function getTimeZoneParts(nowMs, timeZone) {
    var timestamp = Number(nowMs);
    if (!isFinite(timestamp)) return { ok: false, reason: 'invalid-timestamp' };
    var formatter = getFormatter(timeZone);
    if (!formatter) return { ok: false, reason: 'invalid-time-zone' };

    var rawParts;
    try {
      rawParts = formatter.formatToParts(new Date(timestamp));
    } catch (error) {
      return { ok: false, reason: 'invalid-time-zone' };
    }

    var fields = Object.create(null);
    for (var i = 0; i < rawParts.length; i += 1) {
      var part = rawParts[i];
      if (part && part.type && part.type !== 'literal') fields[part.type] = part.value;
    }

    var year = Number(fields.year);
    var month = Number(fields.month);
    var day = Number(fields.day);
    var hour = Number(fields.hour);
    var minute = Number(fields.minute);
    var second = Number(fields.second);
    if (!isFinite(year) || !isFinite(month) || !isFinite(day) ||
        !isFinite(hour) || !isFinite(minute) || !isFinite(second)) {
      return { ok: false, reason: 'invalid-time-zone' };
    }

    var wholeSecondTs = Math.floor(timestamp / 1000) * 1000;
    var wallMs = Date.UTC(year, month - 1, day, hour, minute, second);
    var offsetMinutes = Math.round((wallMs - wholeSecondTs) / MINUTE_MS);

    return {
      ok: true,
      year: year,
      month: month,
      day: day,
      hour: hour,
      minute: minute,
      second: second,
      minutesOfDay: hour * 60 + minute,
      offsetMinutes: offsetMinutes,
      timeZone: timeZone,
      timestamp: timestamp
    };
  }

  /* Resolves a local wall-clock time to absolute instants.
   * DST spring-forward: the missing wall time returns nonexistent=true,
   * timestamps=[]. DST fall-back: the repeated wall time returns
   * ambiguous=true with two timestamps. Ordinary times return one.
   */
  function resolveWallClock(wallClock, timeZone) {
    var input = wallClock || {};
    var year = Number(input.year);
    var month = Number(input.month);
    var day = Number(input.day);
    var hour = Number(input.hour);
    var minute = Number(input.minute);
    var second = Number(input.second == null ? 0 : input.second);
    if (!isFinite(year) || !isFinite(month) || !isFinite(day) ||
        !isFinite(hour) || !isFinite(minute) || !isFinite(second)) {
      return { ok: false, reason: 'invalid-wall-clock' };
    }
    if (month < 1 || month > 12 || day < 1 || day > 31 ||
        hour < 0 || hour > 23 || minute < 0 || minute > 59 ||
        second < 0 || second > 59) {
      return { ok: false, reason: 'invalid-wall-clock' };
    }
    if (!isValidTimeZone(timeZone)) return { ok: false, reason: 'invalid-time-zone' };

    var baseUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    var offsets = [];
    for (var deltaHours = -26; deltaHours <= 26; deltaHours += 1) {
      var sampleParts = getTimeZoneParts(baseUtc + deltaHours * HOUR_MS, timeZone);
      if (!sampleParts.ok) continue;
      if (offsets.indexOf(sampleParts.offsetMinutes) === -1) {
        offsets.push(sampleParts.offsetMinutes);
      }
    }

    var timestamps = [];
    for (var index = 0; index < offsets.length; index += 1) {
      var candidateTs = baseUtc - offsets[index] * MINUTE_MS;
      var back = getTimeZoneParts(candidateTs, timeZone);
      if (!back.ok) continue;
      if (back.year === year && back.month === month && back.day === day &&
          back.hour === hour && back.minute === minute && back.second === second) {
        if (timestamps.indexOf(candidateTs) === -1) timestamps.push(candidateTs);
      }
    }
    timestamps.sort(function (a, b) { return a - b; });

    return {
      ok: true,
      nonexistent: timestamps.length === 0,
      ambiguous: timestamps.length > 1,
      timestamps: timestamps,
      timestamp: timestamps.length ? timestamps[0] : null,
      timeZone: timeZone
    };
  }

  function isWithinWindow(nowMs, timeZone, windowValue) {
    var parts = getTimeZoneParts(nowMs, timeZone);
    if (!parts.ok) return { ok: false, reason: parts.reason, matches: false };
    var normalized = normalizeWindow(windowValue);
    if (!normalized) return { ok: false, reason: 'invalid-window', matches: false };
    return { ok: true, matches: windowMatches(parts, normalized), parts: parts };
  }

  /* Most restrictive wins: away > asleep > busy > active > inactive.
   * A missing or empty schedule yields inactive, never active.
   */
  function resolveCharacterState(parts, schedule) {
    var config = schedule || {};

    var away = false;
    if (config.away === true) {
      away = true;
    } else if (Array.isArray(config.away)) {
      away = normalizeWindows(config.away).some(function (windowValue) {
        return windowMatches(parts, windowValue);
      });
    } else if (config.away && typeof config.away === 'object') {
      var awayWindow = normalizeWindow(config.away);
      away = awayWindow ? windowMatches(parts, awayWindow) : false;
    }
    if (away) return { state: CHARACTER_STATES.AWAY, matched: 'away' };

    if (normalizeWindows(config.asleep).some(function (windowValue) {
      return windowMatches(parts, windowValue);
    })) {
      return { state: CHARACTER_STATES.ASLEEP, matched: 'asleep' };
    }

    if (normalizeWindows(config.busy).some(function (windowValue) {
      return windowMatches(parts, windowValue);
    })) {
      return { state: CHARACTER_STATES.BUSY, matched: 'busy' };
    }

    if (normalizeWindows(config.active).some(function (windowValue) {
      return windowMatches(parts, windowValue);
    })) {
      return { state: CHARACTER_STATES.ACTIVE, matched: 'active' };
    }

    return { state: CHARACTER_STATES.INACTIVE, matched: null };
  }

  /* Autonomy is a cloud-activity permission, not a presence value.
   * Global off always wins. Character true cannot widen a global off.
   * A missing global flag means "not allowed" (no guessed defaults).
   */
  function resolveAutonomy(authorization) {
    var auth = authorization || {};
    var globalEnabled = auth.globalAutonomyEnabled === true;
    var rawCharacter = auth.characterAutonomyEnabled;
    var inherited = rawCharacter == null;

    if (!globalEnabled) {
      return {
        allowed: false,
        reason: 'global-autonomy-off',
        globalEnabled: false,
        characterEnabled: false,
        inherited: inherited
      };
    }
    if (!inherited && rawCharacter === false) {
      return {
        allowed: false,
        reason: 'character-autonomy-off',
        globalEnabled: true,
        characterEnabled: false,
        inherited: false
      };
    }
    return {
      allowed: true,
      reason: 'allowed',
      globalEnabled: true,
      characterEnabled: true,
      inherited: inherited
    };
  }

  function readConfig(config) {
    var source = config || {};
    var names = ['heartbeatTtlMs', 'leaseDurationMs', 'graceMs'];
    var values = {};
    for (var i = 0; i < names.length; i += 1) {
      var name = names[i];
      if (source[name] == null) return { ok: false, reason: 'missing-config:' + name };
      var value = Number(source[name]);
      if (!isFinite(value) || value < 0) return { ok: false, reason: 'invalid-config:' + name };
      values[name] = value;
    }
    return {
      ok: true,
      heartbeatTtlMs: values.heartbeatTtlMs,
      leaseDurationMs: values.leaseDurationMs,
      graceMs: values.graceMs
    };
  }

  function leaseEndMs(lease, config) {
    if (lease.leaseUntil != null) {
      var until = Number(lease.leaseUntil);
      return isFinite(until) ? until : NaN;
    }
    if (lease.leaseStartedAt != null) {
      var started = Number(lease.leaseStartedAt);
      return isFinite(started) ? started + config.leaseDurationMs : NaN;
    }
    return NaN;
  }

  /* Device presence and per-character leases are aggregated separately.
   * Only explicit authorized:true devices/leases participate.
   * A lease is valid while now < leaseUntil. After leaseUntil it enters
   * a configurable grace period before it is considered expired.
   */
  function resolvePresence(input, config) {
    var source = input || {};
    var nowMs = Number(source.nowMs);
    var userId = source.userId;
    var characterId = source.characterId;
    var devices = Array.isArray(source.devices) ? source.devices : [];
    var leases = Array.isArray(source.leases) ? source.leases : [];

    var activeDeviceIds = [];
    for (var i = 0; i < devices.length; i += 1) {
      var device = devices[i];
      if (!device || device.authorized !== true) continue;
      if (device.userId != null && String(device.userId) !== String(userId)) continue;
      var heartbeatAt = Number(device.lastHeartbeatAt);
      if (!isFinite(heartbeatAt) || heartbeatAt > nowMs) continue;
      if (nowMs - heartbeatAt <= config.heartbeatTtlMs) {
        activeDeviceIds.push(String(device.deviceId));
      }
    }

    var validLeases = [];
    var graceLeases = [];
    var expiredLeases = [];
    var ignoredLeases = [];
    for (var j = 0; j < leases.length; j += 1) {
      var lease = leases[j];
      if (!lease) continue;
      if (lease.authorized !== true) {
        ignoredLeases.push(String(lease.deviceId));
        continue;
      }
      if (lease.userId != null && String(lease.userId) !== String(userId)) continue;
      if (lease.characterId != null && String(lease.characterId) !== String(characterId)) continue;

      var endMs = leaseEndMs(lease, config);
      if (!isFinite(endMs)) {
        ignoredLeases.push(String(lease.deviceId));
        continue;
      }
      var record = {
        deviceId: String(lease.deviceId),
        leaseUntil: endMs,
        source: lease.leaseUntil != null ? 'leaseUntil' : 'leaseStartedAt'
      };
      if (nowMs < endMs) {
        validLeases.push(record);
      } else if (nowMs < endMs + config.graceMs) {
        graceLeases.push(record);
      } else {
        expiredLeases.push(record);
      }
    }

    return {
      state: activeDeviceIds.length
        ? PRESENCE_STATES.FOREGROUND_ACTIVE
        : PRESENCE_STATES.BACKGROUND_OR_OFFLINE,
      activeDeviceIds: activeDeviceIds,
      hasValidForegroundLease: validLeases.length > 0,
      validLeaseDeviceIds: validLeases.map(function (item) { return item.deviceId; }),
      graceLeaseDeviceIds: graceLeases.map(function (item) { return item.deviceId; }),
      expiredLeaseDeviceIds: expiredLeases.map(function (item) { return item.deviceId; }),
      ignoredLeaseDeviceIds: ignoredLeases,
      gracePending: validLeases.length === 0 && graceLeases.length > 0
    };
  }

  /* owner=foreground whenever any authorized device holds a valid lease.
   * Cloud may claim only when no valid lease and the grace period is over.
   * Contact is allowed for cloud only while the character is active.
   */
  function resolveExecution(presence, autonomy, character) {
    var reasons = [];

    if (presence.hasValidForegroundLease) {
      reasons.push('foreground-lease-active');
      return {
        owner: EXECUTION_OWNERS.FOREGROUND,
        cloudMayClaim: false,
        contactAllowed: false,
        reasons: reasons
      };
    }

    if (!autonomy.allowed) {
      reasons.push(autonomy.reason);
      return {
        owner: EXECUTION_OWNERS.NONE,
        cloudMayClaim: false,
        contactAllowed: false,
        reasons: reasons
      };
    }

    if (presence.gracePending) {
      reasons.push('foreground-lease-grace');
      return {
        owner: EXECUTION_OWNERS.NONE,
        cloudMayClaim: false,
        contactAllowed: false,
        reasons: reasons
      };
    }

    var cloudMayClaim = true;
    if (character.state === CHARACTER_STATES.ACTIVE) {
      reasons.push('cloud-eligible');
      return {
        owner: EXECUTION_OWNERS.CLOUD,
        cloudMayClaim: true,
        contactAllowed: true,
        reasons: reasons
      };
    }

    reasons.push('character-' + character.state);
    return {
      owner: EXECUTION_OWNERS.NONE,
      cloudMayClaim: cloudMayClaim,
      contactAllowed: false,
      reasons: reasons
    };
  }

  function evaluate(input) {
    var options = input || {};
    var configResult = readConfig(options.config);
    if (!configResult.ok) return configResult;

    var nowMs = Number(options.nowMs);
    if (!isFinite(nowMs)) return { ok: false, reason: 'invalid-timestamp' };

    var parts = getTimeZoneParts(nowMs, options.timeZone);
    if (!parts.ok) return { ok: false, reason: parts.reason };

    var character = resolveCharacterState(parts, options.schedule);
    var autonomy = resolveAutonomy(options.authorization);
    var presence = resolvePresence({
      nowMs: nowMs,
      userId: options.userId,
      characterId: options.characterId,
      devices: options.presence && options.presence.devices,
      leases: options.presence && options.presence.leases
    }, configResult);
    var execution = resolveExecution(presence, autonomy, character);

    return {
      ok: true,
      nowMs: nowMs,
      timeZone: options.timeZone,
      userId: options.userId,
      characterId: options.characterId,
      local: {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: parts.hour,
        minute: parts.minute,
        minutesOfDay: parts.minutesOfDay,
        offsetMinutes: parts.offsetMinutes
      },
      character: character,
      presence: presence,
      autonomy: autonomy,
      execution: execution
    };
  }

  var api = {
    LEGACY_WINDOWS: LEGACY_WINDOWS,
    CHARACTER_STATES: CHARACTER_STATES,
    PRESENCE_STATES: PRESENCE_STATES,
    EXECUTION_OWNERS: EXECUTION_OWNERS,
    parseClock: parseClock,
    normalizeWindow: normalizeWindow,
    matchesMinuteOfDay: matchesMinuteOfDay,
    isWithinWindow: isWithinWindow,
    isValidTimeZone: isValidTimeZone,
    getTimeZoneParts: getTimeZoneParts,
    resolveWallClock: resolveWallClock,
    resolveCharacterState: resolveCharacterState,
    resolveAutonomy: resolveAutonomy,
    resolvePresence: resolvePresence,
    resolveExecution: resolveExecution,
    evaluate: evaluate
  };

  global.CharacterSchedulePolicy = api;
})(typeof window !== 'undefined' ? window : globalThis);
