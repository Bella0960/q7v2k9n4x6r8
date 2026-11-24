import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = readFileSync(new URL('../shared/js/phone/mcp-role-permissions.js', import.meta.url), 'utf8');

function createManager() {
  const values = new Map();
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    key(index) { return Array.from(values.keys())[index] || null; },
    get length() { return values.size; }
  };
  const context = {
    URL, TextEncoder, Uint8Array, crypto: webcrypto, localStorage,
    MaoMcpClient: {
      validateEndpoint(value) {
        const url = new URL(String(value));
        if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('invalid MCP endpoint');
        if (url.searchParams.has('token')) throw new Error('credential URL rejected');
        return url.href;
      }
    }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return { manager: context.MaoMcpRolePermissions, localStorage, values };
}
const endpointA = 'https://mcp.example.com/tools';
const endpointB = 'https://other.example.com/mcp';
const toolA = {
  name: 'search_notes',
  inputSchema: {
    type: 'object', required: ['query'],
    properties: { query: { type: 'string', maxLength: 120 } }
  }
};

test('role grants are isolated by role, service endpoint and individual tool', async () => {
  const { manager, values } = createManager();
  await manager.grantTool('role-A', endpointA, toolA);
  assert.equal(await manager.isAllowed('role-A', endpointA, toolA), true);
  const listed = manager.listForRole('role-A');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].toolName, 'search_notes');
  assert.deepEqual(Object.keys(listed[0]).sort(), ['endpoint', 'toolName', 'updatedAt']);
  assert.equal(await manager.isAllowed('role-B', endpointA, toolA), false);
  assert.equal(await manager.isAllowed('role-A', endpointB, toolA), false);
  assert.equal(await manager.isAllowed('role-A', endpointA, { name: 'delete_notes', inputSchema: toolA.inputSchema }), false);
  assert.equal(values.size, 1);
  const stored = Array.from(values.values())[0];
  assert.match(stored, /search_notes/);
  assert.doesNotMatch(stored, /Bearer|token|password|arguments|secret/i);
});

test('schema changes invalidate an old role grant and property order does not', async () => {
  const { manager } = createManager();
  await manager.grantTool('role-A', endpointA, toolA);
  const reordered = {
    inputSchema: {
      properties: { query: { maxLength: 120, type: 'string' } },
      required: ['query'], type: 'object'
    },
    name: 'search_notes'
  };
  assert.equal(await manager.isAllowed('role-A', endpointA, reordered), true);
  const changed = {
    name: 'search_notes',
    inputSchema: {
      type: 'object', required: ['query'],
      properties: { query: { type: 'string', maxLength: 121 } }
    }
  };
  assert.equal(await manager.isAllowed('role-A', endpointA, changed), false);
  await manager.grantTool('role-A', endpointA, changed);
  assert.equal(await manager.isAllowed('role-A', endpointA, changed), true);
});

test('tool revocation and role revocation do not affect another role', async () => {
  const { manager, values } = createManager();
  await manager.grantTool('role-A', endpointA, toolA);
  await manager.grantTool('role-B', endpointA, toolA);
  assert.equal(await manager.revokeTool('role-A', endpointA, 'search_notes'), true);
  assert.equal(await manager.isAllowed('role-A', endpointA, toolA), false);
  assert.equal(await manager.isAllowed('role-B', endpointA, toolA), true);
  await manager.revokeRole('role-B');
  assert.equal(await manager.isAllowed('role-B', endpointA, toolA), false);
  assert.equal(values.size, 1);
});

test('corrupted role permission records fail closed without overwriting the stored value', async () => {
  const { manager, localStorage, values } = createManager();
  const key = 'maomao_mcp_role_permissions_v1_role-A';
  localStorage.setItem(key, '{broken');
  await assert.rejects(manager.isAllowed('role-A', endpointA, toolA), /记录损坏/);
  await assert.rejects(manager.grantTool('role-A', endpointA, toolA), /记录损坏/);
  assert.equal(values.get(key), '{broken');

  const injected = JSON.stringify({
    version: 1,
    grants: [{
      endpoint: endpointA,
      toolName: 'search_notes',
      schemaSha256: 'a'.repeat(64),
      updatedAt: Date.now(),
      bearerToken: 'must-not-be-preserved'
    }]
  });
  localStorage.setItem(key, injected);
  await assert.rejects(manager.listForRole('role-A'), /格式无效/);
  assert.equal(values.get(key), injected, 'unknown fields must fail closed and remain untouched');
});

test('role grant storage enforces the per-role tool cap', async () => {
  const { manager } = createManager();
  for (let index = 0; index < 100; index += 1) {
    await manager.grantTool('role-A', endpointA, {
      name: 'tool_' + index,
      inputSchema: { type: 'object', properties: { value: { type: 'integer' } } }
    });
  }
  await assert.rejects(
    manager.grantTool('role-A', endpointA, { name: 'tool_100', inputSchema: { type: 'object' } }),
    /最多 100 项/
  );
});
