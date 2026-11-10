import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readAutonomyModelConfig,
  generateAutonomousMessages,
  parseModelResult,
  validateMessages
} from '../worker/lib/model-executor.js';

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
