import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../shared/js/phone/mcp-client.js', import.meta.url), 'utf8');
function loadClient(fetchImpl) {
  const context = { URL, AbortController, setTimeout, clearTimeout, fetch: fetchImpl };
  context.window = context;
  vm.runInNewContext(source, context);
  return context.MaoMcpClient;
}
function response(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get(name) { return headers[String(name).toLowerCase()] || null; } },
    async text() { return body == null ? '' : JSON.stringify(body); }
  };
}

test('MCP endpoint validation requires HTTPS except localhost and rejects private destinations/secrets in URL', () => {
  const client = loadClient(async () => { throw new Error('unexpected fetch'); });
  assert.equal(client.validateEndpoint('https://example.com/mcp'), 'https://example.com/mcp');
  assert.equal(client.validateEndpoint('http://localhost:3000/mcp'), 'http://localhost:3000/mcp');
  assert.throws(() => client.validateEndpoint('http://example.com/mcp'), /HTTPS/);
  assert.throws(() => client.validateEndpoint('https://user:pass@example.com/mcp'), /用户名/);
  assert.throws(() => client.validateEndpoint('https://192.168.1.2/mcp'), /IP 地址/);
  assert.throws(() => client.validateEndpoint('https://[fd00::1]/mcp'), /IPv6/);
  assert.throws(() => client.validateEndpoint('https://example.com/mcp?token=secret'), /密钥/);
});

test('MCP bearer token is never written to browser persistence and redirects are rejected', () => {
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
  assert.match(source, /headers\.Authorization = 'Bearer '/);
  assert.match(source, /credentials: 'omit'/);
  assert.match(source, /redirect: 'error'/);
});

test('MCP connection negotiates a session, lists paginated tools, calls only the requested tool and disconnects', async () => {
  const calls = [];
  const client = loadClient(async (url, init) => {
    const payload = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, init, payload });
    const method = payload && payload.method;
    if (method === 'initialize') return response(200, {
      jsonrpc: '2.0', id: 1, result: {
        protocolVersion: '2025-03-26',
        serverInfo: { name: 'test-server', version: '1' },
        capabilities: { tools: {} }
      }
    }, { 'content-type': 'application/json', 'mcp-session-id': 'test-session' });
    if (method === 'notifications/initialized') return response(202, null, { 'mcp-session-id': 'test-session' });
    if (method === 'tools/list' && calls.filter(x => x.payload && x.payload.method === 'tools/list').length === 1) {
      return response(200, { jsonrpc: '2.0', id: payload.id, result: {
        tools: [{ name: 'lookup', description: 'Read one record', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } }],
        nextCursor: 'page-2'
      } }, { 'content-type': 'application/json', 'mcp-session-id': 'test-session' });
    }
    if (method === 'tools/list') return response(200, { jsonrpc: '2.0', id: payload.id, result: {
      tools: [{ name: 'search', description: 'Search records' }]
    } }, { 'content-type': 'application/json', 'mcp-session-id': 'test-session' });
    if (method === 'tools/call') return response(200, { jsonrpc: '2.0', id: payload.id, result: { content: [{ type: 'text', text: 'ok' }] } }, { 'content-type': 'application/json' });
    throw new Error('unexpected method ' + method);
  });

  const connection = client.createClient({ url: 'https://example.com/mcp', token: 'ephemeral-token' });
  const initialized = await connection.initialize();
  assert.equal(initialized.serverInfo.name, 'test-server');
  assert.equal(connection.getSessionId(), 'test-session');
  const tools = await connection.listTools();
  assert.equal(tools.length, 2);
  assert.equal(tools[0].name, 'lookup');
  assert.equal(tools[1].name, 'search');
  const result = await connection.callTool('lookup', { id: 'abc' });
  assert.equal(result.content[0].text, 'ok');
  const postCalls = calls.filter(x => x.init.method === 'POST');
  assert.ok(postCalls.every(x => x.init.credentials === 'omit'));
  assert.ok(postCalls.every(x => x.init.redirect === 'error'));
  assert.ok(postCalls.every(x => x.init.headers.Authorization === 'Bearer ephemeral-token'));
  assert.ok(postCalls.slice(1).every(x => x.init.headers['Mcp-Session-Id'] === 'test-session'));
  await connection.disconnect();
  assert.equal(calls[calls.length - 1].init.method, 'DELETE');
});

test('MCP connection page stores metadata only and confirms every tool call', () => {
  const html = readFileSync(new URL('../settings/mcp-connections.html', import.meta.url), 'utf8');
  assert.match(html, /maomao_mcp_connections_v1/);
  assert.match(html, /工具结果只作为文本展示/);
  assert.match(html, /window\.confirm\(confirmText\)/);
  assert.match(html, /仅本次页面会话使用/);
  assert.doesNotMatch(html, /localStorage\.setItem\([^)]*serverToken/i);
});
