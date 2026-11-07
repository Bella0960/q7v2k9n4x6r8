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
