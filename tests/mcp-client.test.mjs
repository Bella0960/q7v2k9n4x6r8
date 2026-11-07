import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../shared/js/phone/mcp-client.js', import.meta.url), 'utf8');

function createContext(fetchImpl) {
  const context = { URL, AbortController, TextDecoder, Uint8Array, setTimeout, clearTimeout, fetch: fetchImpl };
  context.window = context;
  vm.runInNewContext(source, context);
  return context;
}

function createToolListClient(listHandler) {
  function response(status, payload, headers = {}) {
    const map = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get(name) { return map[String(name).toLowerCase()] || null; } },
      async text() { return payload == null ? '' : JSON.stringify(payload); }
    };
  }
  const context = createContext(async (url, init) => {
    if (init.method === 'DELETE') return response(200, null);
    const message = JSON.parse(init.body);
    if (message.method === 'initialize') {
      return response(200, {
        jsonrpc: '2.0',
        id: message.id,
        result: { protocolVersion: '2025-03-26', serverInfo: { name: 'list-test', version: '1' } }
      }, { 'Mcp-Session-Id': 'list-session' });
    }
    if (message.method === 'notifications/initialized') return response(202, null);
    if (message.method === 'tools/list') {
      return response(200, {
        jsonrpc: '2.0',
        id: message.id,
        result: listHandler(message.params || {})
      }, { 'Mcp-Session-Id': 'list-session' });
    }
    throw new Error('unexpected MCP method: ' + message.method);
  });
  return {
    context,
    client: context.MaoMcpClient.createClient({ url: 'https://example.com/mcp' })
  };
}

test('MCP endpoint validation requires HTTPS except localhost and excludes credential-bearing URLs', () => {
  const context = createContext(async () => { throw new Error('unexpected fetch'); });
  assert.equal(context.MaoMcpClient.validateEndpoint('https://example.com/mcp'), 'https://example.com/mcp');
  assert.equal(context.MaoMcpClient.validateEndpoint('http://localhost:3000/mcp'), 'http://localhost:3000/mcp');
  assert.throws(() => context.MaoMcpClient.validateEndpoint('http://example.com/mcp'), /HTTPS/);
  assert.throws(() => context.MaoMcpClient.validateEndpoint('https://user:pass@example.com/mcp'), /用户名、密码或片段/);
  assert.throws(() => context.MaoMcpClient.validateEndpoint('https://example.com/mcp?token=secret'), /密钥放在服务地址参数中/);
  assert.throws(() => context.MaoMcpClient.validateEndpoint('https://192.168.1.2/mcp'), /局域网/);
  assert.throws(() => context.MaoMcpClient.validateEndpoint('https://nas.local/mcp'), /局域网或内部域名/);
  assert.throws(() => context.MaoMcpClient.validateEndpoint('https://printer.lan/mcp'), /局域网或内部域名/);
  assert.throws(() => context.MaoMcpClient.validateEndpoint('https://mcpserver/mcp'), /完整域名或公网 IP/);
  assert.throws(() => context.MaoMcpClient.validateEndpoint('https://[::ffff:127.0.0.1]/mcp'), /IPv6/);
  assert.throws(() => context.MaoMcpClient.validateEndpoint('https://[ff02::1]/mcp'), /组播 IPv6/);
});

test('MCP initialization, tool discovery and calls use the negotiated session and ephemeral bearer token', async () => {
  const requests = [];
  function response(status, payload, headers = {}) {
    const map = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get(name) { return map[String(name).toLowerCase()] || (String(name).toLowerCase() === 'content-type' ? 'application/json' : null); } },
      async text() { return payload == null ? '' : JSON.stringify(payload); }
    };
  }
  const context = createContext(async (url, init) => {
    requests.push({ url, init });
    if (init.method === 'DELETE') return response(200, null);
    const message = JSON.parse(init.body);
    if (message.method === 'initialize') {
      return response(200, {
        jsonrpc: '2.0',
        id: message.id,
        result: { protocolVersion: '2025-03-26', serverInfo: { name: 'test-server', version: '1' } }
      }, { 'Mcp-Session-Id': 'session-1' });
    }
    if (message.method === 'notifications/initialized') return response(202, null);
    if (message.method === 'tools/list') {
      return response(200, {
        jsonrpc: '2.0',
        id: message.id,
        result: { tools: [{ name: 'hello', description: 'A harmless test tool', inputSchema: { type: 'object' } }] }
      }, { 'Mcp-Session-Id': 'session-1' });
    }
    if (message.method === 'tools/call') {
      return response(200, {
        jsonrpc: '2.0',
        id: message.id,
        result: { content: [{ type: 'text', text: 'hello world' }] }
      }, { 'Mcp-Session-Id': 'session-1' });
    }
    throw new Error('unexpected MCP method: ' + message.method);
  });

  const client = context.MaoMcpClient.createClient({ url: 'https://example.com/mcp', token: 'ephemeral-secret' });
  const initialized = await client.initialize();
  assert.equal(initialized.serverInfo.name, 'test-server');
  const tools = await client.listTools();
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'hello');
  const result = await client.callTool('hello', { who: 'MAOMAO' });
  assert.equal(result.content[0].text, 'hello world');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer ephemeral-secret');
  assert.equal(requests[2].init.headers['Mcp-Session-Id'], 'session-1');
  assert.equal(JSON.parse(requests[3].init.body).params.arguments.who, 'MAOMAO');
  await client.disconnect();
});

test('MCP client source never persists bearer tokens', () => {
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
  assert.match(source, /Authorization = 'Bearer ' \+ token/);
  assert.match(source, /credentials: 'omit'/);
});

test('MCP page stores service metadata only and requires confirmation before each tool call', () => {
  const html = readFileSync(new URL('../settings/mcp-connections.html', import.meta.url), 'utf8');
  assert.match(html, /maomao_mcp_connections_v1/);
  assert.match(html, /工具结果只作为文本展示/);
  assert.match(html, /window\.confirm\(confirmText\)/);
  assert.match(html, /仅本次页面会话使用/);
  assert.match(html, /MaoMcpClient\.validateToolArguments\(tool\.inputSchema/);
  assert.match(html, /mcp-client\.js\?v=20261108g/);
  assert.match(html, /window\.addEventListener\('pagehide'/);
  assert.match(html, /window\.addEventListener\('pageshow'/);
  assert.match(html, /页面已恢复。为保护连接凭据/);
  assert.match(html, /参数 JSON 超过 32 KB 限制/);
  assert.match(html, /activeServiceName = name\.slice\(0, 60\)/);
  assert.match(html, /MCP 服务：/);
  assert.doesNotMatch(html, /activeId\s*=\s*id/);
  assert.match(html, /validateToolArguments\(tool\.inputSchema \|\| \{ type: 'object' \}, args\)/);
  assert.doesNotMatch(html, /localStorage\.setItem\([^)]*serverToken/i);
});

test('MCP response reader cancels an oversized stream before buffering the full body', async () => {
  let cancelled = false;
  const context = createContext(async () => ({
    status: 200,
    ok: true,
    headers: { get(name) { return String(name).toLowerCase() === 'content-type' ? 'application/json' : null; } },
    body: {
      getReader() {
        return {
          read() {
            return Promise.resolve({ done: false, value: new Uint8Array(1024 * 1024 + 1) });
          },
          cancel() { cancelled = true; return Promise.resolve(); }
        };
      }
    },
    text() { throw new Error('streaming response should not use text()'); }
  }));

  const client = context.MaoMcpClient.createClient({ url: 'https://example.com/mcp' });
  await assert.rejects(client.initialize(), /返回内容过大/);
  assert.equal(cancelled, true);
});

test('MCP tool arguments follow required fields, types, ranges and additionalProperties rules', () => {
  const context = createContext(async () => { throw new Error('unexpected fetch'); });
  const validate = context.MaoMcpClient.validateToolArguments;
  const schema = {
    type: 'object',
    required: ['query', 'limit'],
    additionalProperties: false,
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 80 },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
      filters: {
        type: 'array',
        maxItems: 4,
        items: { type: 'string', maxLength: 20 }
      }
    }
  };
  assert.equal(validate(schema, { query: 'books', limit: 5, filters: ['history'] }), true);
  assert.throws(() => validate(schema, { query: 'books' }), /缺少必填字段/);
  assert.throws(() => validate(schema, { query: 'books', limit: '5' }), /类型不符合/);
  assert.throws(() => validate(schema, { query: 'books', limit: 21 }), /大于允许范围/);
  assert.throws(() => validate(schema, { query: 'books', limit: 5, unexpected: true }), /未声明字段/);
  assert.throws(() => validate(schema, { query: 'books', limit: 5, filters: ['x', 'x', 'x', 'x', 'x'] }), /超过最大限制/);
  assert.equal(validate({
    type: 'object',
    properties: { mode: { enum: [{ alpha: 1, beta: 2 }] } }
  }, { mode: { beta: 2, alpha: 1 } }), true, 'object enum comparison must not depend on property order');
});

test('MCP disconnect aborts in-flight requests before releasing its session', async () => {
  const calls = [];
  let callStarted;
  const started = new Promise(resolve => { callStarted = resolve; });
  let requestAborted = false;

  function response(status, payload, headers = {}) {
    const map = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get(name) { return map[String(name).toLowerCase()] || (String(name).toLowerCase() === 'content-type' ? 'application/json' : null); } },
      async text() { return payload == null ? '' : JSON.stringify(payload); }
    };
  }

  const context = createContext(async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'DELETE') return response(200, null);
    const message = JSON.parse(init.body);
    if (message.method === 'initialize') {
      return response(200, {
        jsonrpc: '2.0',
        id: message.id,
        result: { protocolVersion: '2025-03-26', serverInfo: { name: 'test', version: '1' } }
      }, { 'Mcp-Session-Id': 'session-cancel' });
    }
    if (message.method === 'notifications/initialized') return response(202, null);
    if (message.method === 'tools/call') {
      callStarted();
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          requestAborted = true;
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    }
    throw new Error('unexpected MCP method: ' + message.method);
  });

  const client = context.MaoMcpClient.createClient({ url: 'https://example.com/mcp' });
  await client.initialize();
  const pendingCall = client.callTool('slow-tool', {});
  await started;
  const cancelled = assert.rejects(pendingCall, /连接已断开，已取消未完成的请求/);
  await client.disconnect();
  await cancelled;
  assert.equal(requestAborted, true);
  assert.ok(calls.some(item => item.init.method === 'DELETE'), 'session DELETE should be sent');
  await client.disconnect();
  assert.equal(calls.filter(item => item.init.method === 'DELETE').length, 1, 'disconnect should be idempotent');
});


test('MCP tool listing rejects a catalog that exceeds the 500-tool limit instead of returning it partially', async () => {
  const tools = Array.from({ length: 501 }, (_, index) => ({
    name: 'tool-' + index,
    inputSchema: { type: 'object' }
  }));
  const { client } = createToolListClient(() => ({ tools }));
  await client.initialize();
  await assert.rejects(client.listTools(), /数量超过 500 个上限/);
  await client.disconnect();
});

test('MCP tool listing rejects duplicate names that would make calls ambiguous', async () => {
  const { client } = createToolListClient(() => ({
    tools: [{ name: 'duplicate-tool', inputSchema: { type: 'object' } }, { name: 'duplicate-tool', inputSchema: { type: 'object' } }]
  }));
  await client.initialize();
  await assert.rejects(client.listTools(), /工具名称重复/);
  await client.disconnect();
});

test('MCP tool listing rejects repeated pagination cursors and stops after the page limit', async () => {
  let repeatedPage = 0;
  const repeated = createToolListClient(() => ({
    tools: [{ name: 'repeat-' + (++repeatedPage), inputSchema: { type: 'object' } }],
    nextCursor: 'same-cursor'
  }));
  await repeated.client.initialize();
  await assert.rejects(repeated.client.listTools(), /分页游标重复/);
  await repeated.client.disconnect();

  let pageNumber = 0;
  const tooManyPages = createToolListClient(() => ({
    tools: [{ name: 'page-' + (++pageNumber), inputSchema: { type: 'object' } }],
    nextCursor: 'cursor-' + pageNumber
  }));
  await tooManyPages.client.initialize();
  await assert.rejects(tooManyPages.client.listTools(), /分页超过 20 页上限/);
  assert.equal(pageNumber, 20, 'the client must stop before requesting page 21');
  await tooManyPages.client.disconnect();
});


test('MCP tool listing rejects malformed entries and missing or non-object argument schemas', async () => {
  const invalidEntry = createToolListClient(() => ({
    tools: [{ name: 'valid', inputSchema: { type: 'object' } }, null]
  }));
  await invalidEntry.client.initialize();
  await assert.rejects(invalidEntry.client.listTools(), /缺少有效名称或对象结构/);
  await invalidEntry.client.disconnect();

  const missingSchema = createToolListClient(() => ({
    tools: [{ name: 'missing-schema' }]
  }));
  await missingSchema.client.initialize();
  await assert.rejects(missingSchema.client.listTools(), /缺少有效的对象参数结构/);
  await missingSchema.client.disconnect();

  const invalidSchema = createToolListClient(() => ({
    tools: [{ name: 'array-schema', inputSchema: [] }]
  }));
  await invalidSchema.client.initialize();
  await assert.rejects(invalidSchema.client.listTools(), /缺少有效的对象参数结构/);
  await invalidSchema.client.disconnect();
});

test('MCP tool listing rejects malformed pagination cursors', async () => {
  const { client } = createToolListClient(() => ({
    tools: [{ name: 'valid-tool', inputSchema: { type: 'object' } }],
    nextCursor: { unexpected: true }
  }));
  await client.initialize();
  await assert.rejects(client.listTools(), /分页游标格式无效/);
  await client.disconnect();
});
