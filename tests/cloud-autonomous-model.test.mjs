import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  readAutonomyModelConfig,
  generateAutonomousMessages,
  parseModelResult,
  validateMessages
} from '../worker/lib/model-executor.js';
import { runCloudModelTick } from '../worker/lib/cloud-model-scheduler.js';

const MODEL_ENV = Object.freeze({
  AUTONOMY_MODEL_API_KEY: 'server-only-test-key-1234567890',
  AUTONOMY_MODEL_NAME: 'gpt-4.1-mini',
  AUTONOMY_MODEL_API_URL: 'https://api.openai.com/v1/chat/completions',
  AUTONOMY_MODEL_TIMEOUT_MS: '5000'
});

test('服务端模型配置只接受 HTTPS 白名单地址与服务端凭据', () => {
  const config = readAutonomyModelConfig(MODEL_ENV);
  assert.ok(config);
  assert.equal(config.model, 'gpt-4.1-mini');
  assert.equal(config.endpoint, MODEL_ENV.AUTONOMY_MODEL_API_URL);
  assert.equal(config.apiKey, MODEL_ENV.AUTONOMY_MODEL_API_KEY);

  assert.equal(readAutonomyModelConfig({
    ...MODEL_ENV,
    AUTONOMY_MODEL_API_URL: 'http://api.openai.com/v1/chat/completions'
  }), null);
  assert.equal(readAutonomyModelConfig({
    ...MODEL_ENV,
    AUTONOMY_MODEL_API_URL: 'https://evil.example/v1/chat/completions'
  }), null);
  assert.equal(readAutonomyModelConfig({
    ...MODEL_ENV,
    AUTONOMY_MODEL_API_URL: 'https://user:pass@api.openai.com/v1/chat/completions'
  }), null);
  assert.equal(readAutonomyModelConfig({
    ...MODEL_ENV,
    AUTONOMY_MODEL_API_URL: 'https://api.openai.com/v1/chat/completions?redirect=https://evil.example'
  }), null);
  assert.equal(readAutonomyModelConfig({
    ...MODEL_ENV,
    AUTONOMY_MODEL_API_ALLOWED_HOSTS: 'evil.example'
  }).endpoint, MODEL_ENV.AUTONOMY_MODEL_API_URL,
  '未知环境变量不能替代显式 endpoint host allowlist');
  assert.equal(readAutonomyModelConfig({
    ...MODEL_ENV,
    AUTONOMY_MODEL_ALLOWED_HOSTS: 'evil.example'
  }), null);
});

test('模型输出只允许 1–4 条独立、短文本气泡并拦截越界内容', () => {
  assert.deepEqual(validateMessages(['第一条消息。', '还有一条。']), ['第一条消息。', '还有一条。']);
  assert.equal(validateMessages([]), null);
  assert.equal(validateMessages(['可以', '可以', '可以', '可以', '第五条']), null);
  assert.equal(validateMessages(['https://example.com']), null);
  assert.equal(validateMessages(['请把你的验证码发给我']), null);
  assert.equal(validateMessages(['我们谈恋爱吧']), null);
  assert.equal(validateMessages(['我喜欢你']), null);
  assert.equal(validateMessages(['把定位发我']), null);
  assert.equal(validateMessages(['我可以帮你自残']), null);
  assert.equal(parseModelResult('{"send":false}').send, false);
  assert.equal(parseModelResult('{"send":true,"messages":["第一条"]}').ok, true);
  assert.equal(parseModelResult('{"send":true,"messages":"不是数组"}').ok, false);
  assert.equal(parseModelResult('not-json').ok, false);
});

test('服务端模型只接收限量角色快照，密钥只放在 Authorization header', async () => {
  let request;
  const fetchMock = async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            send: true,
            messages: ['今天有件事想和你分享。', '还有一个小发现。']
          })
        }
      }]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const result = await generateAutonomousMessages({
    env: MODEL_ENV,
    fetchImpl: fetchMock,
    snapshot: {
      character_name: '测试角色',
      persona_text: '温和、理性、擅长分享日常。',
      recent_messages_json: JSON.stringify([
        { role: 'user', content: '今天过得怎么样？' },
        { role: 'assistant', content: '今天还不错。' }
      ])
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.send, true);
  assert.deepEqual(result.messages, ['今天有件事想和你分享。', '还有一个小发现。']);
  assert.equal(request.url, MODEL_ENV.AUTONOMY_MODEL_API_URL);
  assert.equal(request.init.headers.Authorization, 'Bearer ' + MODEL_ENV.AUTONOMY_MODEL_API_KEY);
  assert.equal(request.init.redirect, 'error');

  const serializedBody = request.init.body;
  assert.equal(serializedBody.includes(MODEL_ENV.AUTONOMY_MODEL_API_KEY), false);
  assert.equal(serializedBody.includes('今天过得怎么样？'), true);
  assert.equal(serializedBody.includes('完整聊天记录'), false);
  assert.equal(serializedBody.includes('recentMessages'), true);
});

test('没有服务端凭据时模型执行器 fail-closed，不发起网络请求', async () => {
  let fetchCalls = 0;
  const result = await generateAutonomousMessages({
    env: {},
    snapshot: { character_name: '测试角色', persona_text: '', recent_messages_json: '[]' },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('不应调用网络');
    }
  });
  assert.deepEqual(result, { ok: false, reason: 'model_not_configured' });
  assert.equal(fetchCalls, 0);
});


test('云端模型首次开场只读取空历史并明确禁止虚构过往互动', async () => {
  let request;
  const fetchMock = async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({ send: true, messages: ['你好，今天想聊点什么？'] })
        }
      }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const result = await generateAutonomousMessages({
    env: MODEL_ENV,
    fetchImpl: fetchMock,
    initialContact: true,
    snapshot: {
      character_name: '测试角色',
      persona_text: '喜欢阅读',
      recent_messages_json: '[]',
      last_user_message_at: 0
    }
  });
  assert.equal(result.ok, true);
  const body = JSON.parse(request.init.body);
  assert.match(body.messages[0].content, /Never claim you have chatted, met/);
  assert.match(body.messages[0].content, /non-romantic opening/);
  assert.deepEqual(JSON.parse(body.messages[1].content).recentMessages, []);
  assert.equal(JSON.parse(body.messages[1].content).initialContact, true);

  let invalidCalls = 0;
  const invalid = await generateAutonomousMessages({
    env: MODEL_ENV,
    initialContact: true,
    snapshot: {
      character_name: '测试角色',
      persona_text: '',
      recent_messages_json: JSON.stringify([{ role: 'user', content: '已有聊天' }]),
      last_user_message_at: 12345
    },
    fetchImpl: async () => { invalidCalls += 1; throw new Error('must not call model'); }
  });
  assert.deepEqual(invalid, { ok: false, reason: 'initial_contact_context_invalid' });
  assert.equal(invalidCalls, 0);
});

test('云端模型响应超过执行租约后，提交必须使用新的真实时间并被拒绝', async () => {
  const env = {
    ...MODEL_ENV,
    AUTONOMY_LEASE_MS: '60000',
    AUTONOMY_TICK_LIMIT: '10',
    AUTONOMY_RETRY_BACKOFF_MS: '60000,300000',
    AUTONOMY_HEARTBEAT_TTL_MS: '60000',
    AUTONOMY_DEVICE_LEASE_MS: '60000',
    AUTONOMY_DEVICE_GRACE_MS: '0'
  };
  const base = 1_800_000_000_000;
  let clockNow = base;
  let claimedLeaseUntil = 0;
  let commitNow = 0;
  const logs = [];
  const task = {
    id: 'cloud-task-0001',
    device_id: 'device-1',
    user_id: 'owner',
    character_id: 'char-1',
    kind: 'contact',
    payload_json: JSON.stringify({
      contextVersion: 1,
      sourceDeviceId: 'device-1',
      executionMode: 'cloud'
    }),
    status: 'waiting',
    scheduled_at: base - 1000,
    next_attempt_at: null,
    locked_until: null,
    attempt_count: 0,
    max_attempts: 3
  };
  const store = {
    listDueCloudActivities(now, limit) {
      assert.equal(now, base);
      assert.equal(limit, 10);
      return [task];
    },
    listDueActivities() {
      throw new Error('云端调度器不得先查询混合队列再在内存中过滤');
    },
    getSchedulerGateSnapshot({ userId, characterId }) {
      assert.equal(userId, 'owner');
      assert.equal(characterId, 'char-1');
      return {
        userId,
        characterId,
        timeZone: 'UTC',
        schedule: { active: [{ start: '00:00', end: '24:00' }] },
        authorization: {
          globalAutonomyEnabled: true,
          characterAutonomyEnabled: null
        },
        presence: {
          devices: [{
            deviceId: 'device-1',
            userId: 'owner',
            authorized: true,
            foregroundActive: false,
            lastHeartbeatAt: 0
          }],
          leases: []
        },
        contextVersion: 1,
        contextSourceDeviceId: 'device-1'
      };
    },
    claimActivity(args) {
      claimedLeaseUntil = args.leaseUntil;
      return {
        ...task,
        status: 'running',
        locked_by: args.owner,
        locked_until: args.leaseUntil,
        attempt_count: 1
      };
    },
    getCharacterContextSnapshot() {
      return {
        source_device_id: 'device-1',
        character_name: '测试角色',
        persona_text: '日常、自然地分享生活。',
        last_user_message_at: base - 30 * 60_000,
        recent_messages_json: JSON.stringify([
          { role: 'user', content: '最近怎么样？' }
        ])
      };
    },
    getCharacterContextVersion() {
      return { version: 1, updated_by_device_id: 'device-1' };
    },
    getUserContextSharing() {
      return { enabled: 1 };
    },
    completeCloudActivityWithOutboundGroup(args) {
      commitNow = args.now;
      return args.now < claimedLeaseUntil ? { completed: true } : null;
    },
    supersedeActivity() {
      return false;
    },
    logExecution(entry) {
      logs.push(entry);
    }
  };
  const fetchImpl = async () => {
    // Simulate a provider response arriving after the 60-second executor lease.
    clockNow = base + 60_001;
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            send: true,
            messages: ['今天有件小事想和你分享。']
          })
        }
      }]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const summary = await runCloudModelTick({
    store,
    env,
    now: () => clockNow,
    fetchImpl
  });

  assert.equal(claimedLeaseUntil, base + 60_000);
  assert.ok(commitNow > claimedLeaseUntil);
  assert.equal(summary.generatedGroups, 0);
  assert.equal(summary.deferred, 1);
  assert.ok(logs.some(entry => entry.reasonCode === 'outbound_group_commit_fenced'));
  assert.ok(logs.some(entry => entry.kind === 'autonomy_cloud_tick' && entry.status === 'success'));
});


test('Workers AI is dormant unless explicitly selected and bound', () => {
  const AI = { run: async () => ({ response: '{"send":false}' }) };
  assert.equal(readAutonomyModelConfig({ AI }), null,
    'binding alone must never incur inference charges');
  assert.equal(readAutonomyModelConfig({ AUTONOMY_MODEL_BACKEND: 'workers_ai' }), null);
  assert.equal(readAutonomyModelConfig({ AUTONOMY_MODEL_BACKEND: 'unrecognized', AI }), null);
  const config = readAutonomyModelConfig({ AUTONOMY_MODEL_BACKEND: 'workers_ai', AI });
  assert.ok(config);
  assert.equal(config.backend, 'workers_ai');
  assert.equal(config.model, '@cf/zai-org/glm-4.7-flash');
  assert.equal(config.timeoutMs, 20000);
  assert.equal(config.apiKey, undefined);
});

test('Workers AI runs under explicit selection without another API token or HTTP fetch', async () => {
  const calls = [];
  const env = {
    AUTONOMY_MODEL_BACKEND: 'workers_ai',
    AI: {
      async run(model, options) {
        calls.push({ model, options });
        return { response: JSON.stringify({ send: true, messages: ['今天想分享一个小发现。', '你那边还好吗？'] }) };
      }
    }
  };
  const snapshot = {
    character_name: '测试角色',
    persona_text: '安静、有好奇心。',
    recent_messages_json: '[{"role":"user","content":"你今天忙吗？"}]'
  };
  const reply = await generateAutonomousMessages({
    env, snapshot,
    fetchImpl: async () => { throw new Error('Workers AI must not call external HTTP'); }
  });
  assert.equal(reply.ok, true);
  assert.equal(reply.send, true);
  assert.deepEqual(reply.messages, ['今天想分享一个小发现。', '你那边还好吗？']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, '@cf/zai-org/glm-4.7-flash');
  assert.equal(calls[0].options.stream, false);
  assert.equal(calls[0].options.messages[0].role, 'system');
  assert.equal(calls[0].options.messages[1].role, 'user');
  assert.ok(calls[0].options.messages[1].content.includes('你今天忙吗？'));
  assert.equal(JSON.stringify(calls).includes('AUTONOMY_MODEL_API_KEY'), false);
});

test('invalid Workers AI output fails closed and never sends messages', async () => {
  const env = {
    AUTONOMY_MODEL_BACKEND: 'workers_ai',
    AI: { run: async () => ({ response: 'not JSON' }) }
  };
  const snapshot = { character_name: '测试角色', persona_text: '', recent_messages_json: '[]' };
  const invalid = await generateAutonomousMessages({
    env, snapshot,
    fetchImpl: async () => { throw new Error('HTTP fallback forbidden'); }
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid_model_json');
  env.AI.run = async () => { throw new Error('provider unavailable'); };
  const failure = await generateAutonomousMessages({ env, snapshot });
  assert.equal(failure.ok, false);
  assert.equal(failure.reason, 'model_network_error');
});

test('Workers AI respects explicit timeout configuration and never auto-enables', () => {
  const AI = { run: async () => ({ response: '{"send":false}' }) };
  assert.equal(readAutonomyModelConfig({
    AUTONOMY_MODEL_BACKEND: 'workers_ai', AI, AUTONOMY_MODEL_TIMEOUT_MS: 'not-a-timeout'
  }), null);
  assert.equal(readAutonomyModelConfig({
    AUTONOMY_MODEL_BACKEND: 'workers_ai', AI, AUTONOMY_MODEL_TIMEOUT_MS: '70000'
  }), null);
  const legacy = readAutonomyModelConfig(MODEL_ENV);
  assert.equal(legacy.backend, 'openai_compatible');
  assert.equal(legacy.model, MODEL_ENV.AUTONOMY_MODEL_NAME);
});


test('Wrangler config explicitly sets pairing TTL but does not auto-enable AI spending', () => {
  const config = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(config, /"DEVICE_PAIRING_TOKEN_TTL_MS"\s*:\s*"300000"/);
  assert.match(config, /"ai"\s*:\s*\{\s*"binding"\s*:\s*"AI"\s*\}/);
  assert.doesNotMatch(config, /"AUTONOMY_MODEL_BACKEND"\s*:\s*"workers_ai"/,
    'AI inference must require an explicit, separately approved activation');
});
