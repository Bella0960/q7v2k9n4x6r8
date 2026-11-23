/**
 * ADMIN-CLOUD-001 — shared state vocabulary.
 *
 * The module never invents operational data. Every observation is one of:
 *   ok              verified by a live probe or a satisfied check
 *   degraded        observed, but something needs attention
 *   error           observed failure
 *   not_configured  the required Worker configuration is absent (not an outage)
 *   unavailable     no data source exists to observe this (explicit, never guessed)
 */

export const STATES = Object.freeze(['ok', 'degraded', 'error', 'not_configured', 'unavailable']);

const STATE_SET = new Set(STATES);

export function normalizeState(value) {
  return STATE_SET.has(value) ? value : 'unavailable';
}

/**
 * Roll several item states up into one. Only observed states (ok, degraded,
 * error) decide the headline; items that could not be observed are counted
 * separately so "ok" can never hide blind spots.
 */
export function rollup(states) {
  const summary = { ok: 0, degraded: 0, error: 0, not_configured: 0, unavailable: 0 };
  for (const state of states) summary[normalizeState(state)] += 1;
  const observed = summary.ok + summary.degraded + summary.error;
  let state = 'unavailable';
  if (summary.error > 0) state = 'error';
  else if (summary.degraded > 0) state = 'degraded';
  else if (summary.ok > 0) state = 'ok';
  return {
    state,
    summary: {
      ...summary,
      observed,
      unobserved: summary.not_configured + summary.unavailable
    }
  };
}