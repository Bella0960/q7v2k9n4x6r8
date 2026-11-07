import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../shared/js/phone/mcp-client.js', import.meta.url), 'utf8');
const context = { URL, AbortController, setTimeout, clearTimeout, fetch: async () => { throw new Error('unexpected fetch'); } };
context.window = context;
vm.runInNewContext(source, context);

test('MCP endpoint validation requires HTTPS except localhost', () => {
  assert.equal(context.MaoMcpClient.validateEndpoint('https://example.com/mcp'), 'https://example.com/mcp');
  assert.equal(context.MaoMcpClient.validateEndpoint('http://localhost:3000/mcp'), 'http://localhost:3000/mcp');
  assert.throws(() => context.MaoMcpClient.validateEndpoint('http://example.com/mcp'), /HTTPS/);
  assert.throws(() => context.MaoMcpClient.validateEndpoint('https://user:pass@example.com/mcp'), /不能包含/);
  assert.throws(() => context.MaoMcpClient.validateEndpoint('https://192.168.1.2/mcp'), /局域网/);
});

test('MCP client source does not persist bearer tokens', () => {
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
  assert.match(source, /Authorization = 'Bearer ' \+ token/);
  assert.match(source, /credentials: 'omit'/);
});

test('MCP page stores metadata only and confirms each tool call', () => {
  const html = readFileSync(new URL('../settings/mcp-connections.html', import.meta.url), 'utf8');
  assert.match(html, /maomao_mcp_connections_v1/);
  assert.match(html, /工具结果只作为文本展示/);
  assert.match(html, /window\.confirm\(confirmText\)/);
  assert.match(html, /仅本次页面会话使用/);
  assert.doesNotMatch(html, /localStorage\.setItem\([^)]*serverToken/i);
});
