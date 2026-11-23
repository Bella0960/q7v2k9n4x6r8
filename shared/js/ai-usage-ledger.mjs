/**
 * ADMIN-USAGE-001 / phase A — PURE accounting contract, no network or storage.
 *
 * Not an invoice and not a billing subsystem. A receipt is one provider
 * *attempt* rather than one user click; multiple attempts may be charged.
 * Unknown usage/cost stays null. No prompts, images, keys, response bodies,
 * device IDs, raw error text or IPs are accepted or retained.
 *
 * Source adapters must validate account authorization, provider authenticity,
 * price provenance and durable storage before calling this module.
 */
const ALLOWED_KINDS = new Set(['chat', 'image', 'model_test', 'other']);
const ALLOWED_STATUSES = new Set([
  'success', 'provider_error', 'network_unknown', 'cancelled', 'usage_unknown'
]);
const ACCOUNT_ID = /^MAO-[A-Z0-9]{12,24}$/;
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,99}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const MAX_COUNT = Number.MAX_SAFE_INTEGER;

function requiredString(value, label, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TypeError('Invalid ' + label);
  }
  return value;
}
function counter(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_COUNT) {
    throw new TypeError('Invalid ' + label);
  }
  return value;
}
function timestamp(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 8640000000000000) {
    throw new TypeError('Invalid ' + label);
  }
  return value;
}
function tokenField(source, name) {
  if (source[name] === undefined || source[name] === null) return null;
  return counter(source[name], 'token count ' + name);
}
function pickCount(source, fieldNames) {
  for (const key of fieldNames) {
    const count = tokenField(source, key);
    if (count !== null) return count;
  }
  return null;
}

/**
 * Return only signed-off numeric usage, never a guessed token count.
 * Supported named fields: OpenAI compatible, Gemini native and Anthropic.
 * Does not look inside a response's text, model output or pricing metadata.
 */
export function normalizeProviderUsage(providerUsage) {
  if (providerUsage == null) {
    return Object.freeze({ inputTokens: null, outputTokens: null, totalTokens: null, source: 'unreported' });
  }
  if (typeof providerUsage !== 'object' || Array.isArray(providerUsage)) {
    throw new TypeError('Provider usage must be an object');
  }
  const input = pickCount(providerUsage, [
    'prompt_tokens', 'input_tokens', 'promptTokenCount'
  ]);
  const output = pickCount(providerUsage, [
    'completion_tokens', 'output_tokens', 'candidatesTokenCount'
  ]);
  const total = pickCount(providerUsage, [
    'total_tokens', 'totalTokenCount'
  ]);
  // Missing fields must remain unknown even when a total is available.
  if (total !== null && input !== null && output !== null &&
      BigInt(input) + BigInt(output) > BigInt(total)) {
    throw new TypeError('Inconsistent provider usage counters');
  }
  const known = input !== null || output !== null || total !== null;
  return Object.freeze({
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    source: known ? 'provider_reported' : 'unreported'
  });
}

function estimatedMicros(usage, pricing) {
  if (!pricing || usage.inputTokens === null || usage.outputTokens === null) return null;
  const inputPrice = counter(pricing.inputPerMillionMicros, 'input unit price');
  const outputPrice = counter(pricing.outputPerMillionMicros, 'output unit price');
  // Rate is in currency micro-units per one million tokens. Amount remains
  // an ESTIMATE — actual provider invoicing may differ.
  const total = BigInt(usage.inputTokens) * BigInt(inputPrice) +
    BigInt(usage.outputTokens) * BigInt(outputPrice);
  const rounded = (total + 500000n) / 1000000n;
  return rounded <= BigInt(MAX_COUNT) ? Number(rounded) : null;
}

/**
 * No spread of the input record. The narrow allowlist prevents accidentally
 * persisting secret prompt text or provider error bodies.
 */
export function normalizeUsageAttempt(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Usage attempt must be an object');
  }
  const ownerAccountId = requiredString(input.ownerAccountId, 'account', ACCOUNT_ID);
  const logicalRequestId = requiredString(input.logicalRequestId, 'logical request ID', ID);
  const attemptId = requiredString(input.attemptId, 'attempt ID', ID);
  const provider = requiredString(input.provider, 'provider', NAME);
  const model = requiredString(input.model, 'model', NAME);
  if (!ALLOWED_KINDS.has(input.requestType)) throw new TypeError('Invalid request type');
  if (!ALLOWED_STATUSES.has(input.status)) throw new TypeError('Invalid request status');
  const startedAt = timestamp(input.startedAt, 'start timestamp');
  const finishedAt = timestamp(input.finishedAt, 'finish timestamp');
  if (finishedAt < startedAt) throw new TypeError('Finish precedes start');
  const usage = normalizeProviderUsage(input.providerUsage);
  let estimate = null;
  let currency = null;
  let priceVersion = null;
  if (input.pricing != null) {
    if (!input.pricing || typeof input.pricing !== 'object' || Array.isArray(input.pricing)) {
      throw new TypeError('Invalid price definition');
    }
    currency = requiredString(input.pricing.currency, 'currency', /^[A-Z]{3}$/);
    priceVersion = requiredString(input.pricing.version, 'price version', ID);
    estimate = estimatedMicros(usage, input.pricing);
  }
  return Object.freeze({
    ownerAccountId,
    logicalRequestId,
    attemptId,
    provider,
    model,
    requestType: input.requestType,
    status: input.status,
    startedAt,
    finishedAt,
    usage,
    estimatedCostMicros: estimate,
    currency,
    priceVersion,
    // Actual billed cost can only come from reconciled provider invoices.
    actualChargedMicros: null,
    costKind: estimate === null ? 'unknown' : 'estimate'
  });
}

/**
 * Aggregate exactly one record per actual attempt. A retry with a different
 * attemptId remains separate. A conflicting duplicate is an error, NOT a
 * silent last-write-wins or a made-up billing adjustment.
 *
 * Aggregation rejects multi-account data even for administrator views.
 */
export function summarizeUsageAttempts(receipts, ownerAccountId) {
  requiredString(ownerAccountId, 'account', ACCOUNT_ID);
  if (!Array.isArray(receipts)) throw new TypeError('Receipts must be an array');
  const seen = new Map();
  const logicalRequests = new Set();
  let reportedInputTokens = 0n;
  let reportedOutputTokens = 0n;
  let reportedTotalTokens = 0n;
  let knownInputAttempts = 0;
  let knownOutputAttempts = 0;
  let knownTotalAttempts = 0;
  let unknownCostAttempts = 0;
  let estimatedCostMicros = 0n;
  let estimatedCostAttempts = 0;
  let priceCurrency = null;
  const statuses = Object.fromEntries([...ALLOWED_STATUSES].map(s => [s, 0]));
  for (const item of receipts) {
    // Normalize independently, so passing an untrusted raw object cannot
    // sneak arbitrary metadata into the resulting ledger.
    const r = normalizeUsageAttempt({
      ...item,
      providerUsage: item?.usage?.source === 'provider_reported'
        ? {
          input_tokens: item.usage.inputTokens,
          output_tokens: item.usage.outputTokens,
          total_tokens: item.usage.totalTokens
        }
        : item?.providerUsage,
      pricing: item?.pricing ?? (
        item?.costKind === 'estimate' && item?.priceVersion
          ? null : undefined
      )
    });
    if (r.ownerAccountId !== ownerAccountId) throw new Error('Cross-account usage is forbidden');
    const key = r.logicalRequestId + '\u0000' + r.attemptId;
    const old = seen.get(key);
    // Caller-supplied pre-normalized receipts are revalidated separately
    // below: no conflicting duplicates may silently overwrite each other.
    const signature = JSON.stringify({
      account: r.ownerAccountId, provider: r.provider, model: r.model,
      kind: r.requestType, status: r.status, started: r.startedAt,
      finished: r.finishedAt, usage: r.usage,
      priceVersion: item?.priceVersion ?? r.priceVersion,
      estimated: item?.estimatedCostMicros ?? r.estimatedCostMicros
    });
    if (old !== undefined) {
      if (old !== signature) throw new Error('Conflicting usage attempt receipt');
      continue;
    }
    seen.set(key, signature);
    logicalRequests.add(r.logicalRequestId);
    statuses[r.status]++;
    const u = r.usage;
    if (u.inputTokens !== null) { reportedInputTokens += BigInt(u.inputTokens); knownInputAttempts++; }
    if (u.outputTokens !== null) { reportedOutputTokens += BigInt(u.outputTokens); knownOutputAttempts++; }
    if (u.totalTokens !== null) { reportedTotalTokens += BigInt(u.totalTokens); knownTotalAttempts++; }
    const cost = item?.costKind === 'estimate' ? item.estimatedCostMicros : r.estimatedCostMicros;
    const ccy = item?.costKind === 'estimate' ? item.currency : r.currency;
    if (cost === null || cost === undefined) {
      unknownCostAttempts++;
    } else {
      counter(cost, 'estimated cost');
      if (!ccy || !/^[A-Z]{3}$/.test(ccy)) throw new TypeError('Invalid currency');
      if (priceCurrency !== null && priceCurrency !== ccy) {
        throw new Error('Mixed currencies cannot be summed');
      }
      priceCurrency = ccy;
      estimatedCostMicros += BigInt(cost);
      estimatedCostAttempts++;
    }
  }
  const safe = n => n <= BigInt(MAX_COUNT) ? Number(n) : null;
  return Object.freeze({
    ownerAccountId,
    logicalRequests: logicalRequests.size,
    actualAttempts: seen.size,
    statusCounts: Object.freeze(statuses),
    confirmedInputTokens: knownInputAttempts ? safe(reportedInputTokens) : null,
    confirmedOutputTokens: knownOutputAttempts ? safe(reportedOutputTokens) : null,
    confirmedTotalTokens: knownTotalAttempts ? safe(reportedTotalTokens) : null,
    inputCoverage: knownInputAttempts,
    outputCoverage: knownOutputAttempts,
    totalCoverage: knownTotalAttempts,
    unknownCostAttempts,
    estimatedCostAttempts,
    estimatedCostMicros: estimatedCostAttempts ? safe(estimatedCostMicros) : null,
    estimatedCurrency: priceCurrency,
    actualChargedMicros: null
  });
}
