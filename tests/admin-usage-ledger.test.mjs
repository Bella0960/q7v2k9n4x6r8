import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProviderUsage,
  normalizeUsageAttempt,
  summarizeUsageAttempts
} from '../shared/js/ai-usage-ledger.mjs';

const owner = 'MAO-AAAAAAAAAAAA';
const other = 'MAO-BBBBBBBBBBBB';
const base = {
  ownerAccountId: owner,
  logicalRequestId: 'req-001',
  attemptId: 'try-001',
  provider: 'openai',
  model: 'gpt-example',
  requestType: 'chat',
  status: 'success',
  startedAt: 1763910000000,
  finishedAt: 1763910000200
};
const receipt = extra => ({ ...base, ...extra });

test('zero is actual reported usage; missing tokens are not invented', () => {
  assert.deepEqual(normalizeProviderUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }), {
    inputTokens: 0, outputTokens: 0, totalTokens: 0, source: 'provider_reported'
  });
  assert.deepEqual(normalizeProviderUsage({total_tokens: 123}), {
    inputTokens: null, outputTokens: null, totalTokens: 123, source: 'provider_reported'
  });
  assert.equal(normalizeProviderUsage(null).source, 'unreported');
  assert.deepEqual(normalizeProviderUsage({}), {
    inputTokens: null, outputTokens: null, totalTokens: null, source: 'unreported'
  });
});

test('OpenAI, Gemini and Anthropic usage shapes are recognized only from numeric fields', () => {
  const a = normalizeProviderUsage({prompt_tokens: 6,completion_tokens: 9,total_tokens: 15});
  const b = normalizeProviderUsage({promptTokenCount: 7,candidatesTokenCount: 8,totalTokenCount: 15});
  const c = normalizeProviderUsage({input_tokens: 1,output_tokens: 2});
  assert.deepEqual([a.inputTokens,a.outputTokens,a.totalTokens],[6,9,15]);
  assert.deepEqual([b.inputTokens,b.outputTokens,b.totalTokens],[7,8,15]);
  assert.deepEqual([c.inputTokens,c.outputTokens,c.totalTokens],[1,2,null]);
  assert.throws(() => normalizeProviderUsage({input_tokens:'10'}), /Invalid token count/);
  assert.throws(() => normalizeProviderUsage({prompt_tokens:2,completion_tokens:3,total_tokens:4}), /Inconsistent/);
  assert.throws(() => normalizeProviderUsage({prompt_tokens:-1}), /Invalid/);
  assert.throws(() => normalizeProviderUsage({prompt_tokens:0.5}), /Invalid/);
});

test('unknown price and unreported usage remain UNKNOWN, never free or zero', () => {
  const a=normalizeUsageAttempt(receipt({status:'network_unknown'}));
  assert.equal(a.estimatedCostMicros,null);
  assert.equal(a.actualChargedMicros,null);
  assert.equal(a.costKind,'unknown');
  const b=normalizeUsageAttempt(receipt({
    providerUsage:{total_tokens:250},
    pricing:{version:'price-2026',currency:'USD',inputPerMillionMicros:2000000,outputPerMillionMicros:8000000}
  }));
  assert.equal(b.estimatedCostMicros,null);
  assert.equal(b.usage.totalTokens,250);
  assert.equal(b.costKind,'unknown');
  assert.equal(b.actualChargedMicros,null);
});

test('quoted estimated costs use BigInt, separate estimate from actual invoice', () => {
  const a=normalizeUsageAttempt(receipt({
    providerUsage:{input_tokens:1000,output_tokens:250,total_tokens:1250},
    pricing:{version:'price-2026',currency:'USD',inputPerMillionMicros:2000000,outputPerMillionMicros:8000000}
  }));
  assert.equal(a.estimatedCostMicros,4000);
  assert.equal(a.costKind,'estimate');
  assert.equal(a.actualChargedMicros,null);
  assert.equal(a.currency,'USD');
  assert.equal(a.priceVersion,'price-2026');
  assert.throws(() => normalizeUsageAttempt(receipt({
    providerUsage:{input_tokens:2,output_tokens:1},
    pricing:{version:'price-2026',currency:'USD',inputPerMillionMicros:0,outputPerMillionMicros:-1}
  })), /Invalid output unit price/);
});

test('secret fields are never spread into normalized receipt', () => {
  const a=normalizeUsageAttempt(receipt({
    apiKey:'sk-should-not-be-stored',
    prompt:'private chat',
    image:'private image',
    deviceId:'private device',
    providerErrorBody:'secret',
    providerUsage:{input_tokens:1,output_tokens:1}
  }));
  const all=JSON.stringify(a);
  for(const secret of ['sk-should-not-be-stored','private chat','private image','private device','secret']) {
    assert.ok(!all.includes(secret),'leaked field '+secret);
  }
  assert.ok(Object.isFrozen(a));
  assert.ok(Object.isFrozen(a.usage));
});

test('one logical request can contain several provider attempts; exact duplicate is idempotent', () => {
  const a=receipt({providerUsage:{input_tokens:10,output_tokens:2}});
  const retry=receipt({attemptId:'try-002',status:'provider_error',providerUsage:null});
  const sum=summarizeUsageAttempts([a,a,retry],owner);
  assert.equal(sum.logicalRequests,1);
  assert.equal(sum.actualAttempts,2);
  assert.equal(sum.statusCounts.success,1);
  assert.equal(sum.statusCounts.provider_error,1);
  assert.equal(sum.confirmedInputTokens,10);
  assert.equal(sum.inputCoverage,1);
  assert.equal(sum.unknownCostAttempts,2);
  assert.equal(sum.estimatedCostMicros,null);
  assert.throws(() => summarizeUsageAttempts([a,{...a,status:'cancelled'}],owner), /Conflicting/);
});

test('cross-account data rejected even when both accounts have syntactically valid IDs',()=>{
  assert.throws(()=>summarizeUsageAttempts([receipt({ownerAccountId:other})],owner),/Cross-account/);
  assert.throws(()=>normalizeUsageAttempt(receipt({ownerAccountId:'any-user'})),/Invalid account/);
});

test('estimated sums must not mix currencies or report actual charges', () => {
  const price=(currency)=>({version:'v1',currency,inputPerMillionMicros:1000000,outputPerMillionMicros:2000000});
  const a=receipt({pricing:price('USD'),providerUsage:{input_tokens:200,output_tokens:100}});
  const b=receipt({attemptId:'try-002',pricing:price('USD'),providerUsage:{input_tokens:100,output_tokens:200}});
  const sum=summarizeUsageAttempts([a,b],owner);
  assert.equal(sum.estimatedCostMicros,900);
  assert.equal(sum.actualChargedMicros,null);
  assert.equal(sum.unknownCostAttempts,0);
  assert.equal(sum.estimatedCurrency,'USD');
  assert.throws(()=>summarizeUsageAttempts([a,{...b,pricing:price('EUR')}],owner),/Mixed currencies/);
});

test('image requests and cancellation do not automatically imply zero cost', () => {
  const a=receipt({requestType:'image',status:'cancelled',providerUsage:null});
  const sum=summarizeUsageAttempts([a],owner);
  assert.equal(sum.statusCounts.cancelled,1);
  assert.equal(sum.unknownCostAttempts,1);
  assert.equal(sum.confirmedTotalTokens,null);
  assert.equal(sum.actualChargedMicros,null);
});

test('reject malformed statuses, IDs, price definitions and timestamps', () => {
  for(const input of [
    {status:'paid'},
    {logicalRequestId:''},
    {attemptId:'../path'},
    {provider:'unknown provider'},
    {requestType:'wire_transfer'},
    {startedAt:0},
    {finishedAt:base.startedAt-1},
    {pricing:{version:'v1',currency:'US',inputPerMillionMicros:1,outputPerMillionMicros:1}}
  ]) assert.throws(()=>normalizeUsageAttempt(receipt(input)));
});
