/* MAOMAO role-scoped MCP permissions.
 * Stores only role ID, normalized service endpoint, tool name and a SHA-256
 * fingerprint of the tool input schema. Never stores credentials or arguments.
 */
(function (global) {
  'use strict';
  var NS = global.MaoMcpRolePermissions = {};
  var KEY_PREFIX = 'maomao_mcp_role_permissions_v1_';
  var MAX_GRANTS_PER_ROLE = 100;
  var MAX_ROLE_ID_CHARS = 160;
  var MAX_TOOL_NAME_CHARS = 120;
  var MAX_ENDPOINT_CHARS = 2048;
  var MAX_SCHEMA_BYTES = 24 * 1024;
  var MAX_ROLE_STORE_BYTES = 64 * 1024;

  function utf8ByteLength(value) {
    return new TextEncoder().encode(String(value)).byteLength;
  }
  function normalizeRoleId(value) {
    var id = String(value == null ? '' : value).trim();
    if (!id || id.length > MAX_ROLE_ID_CHARS) throw new Error('角色 ID 无效，无法保存 MCP 授权。');
    return id;
  }
  function normalizeEndpoint(value) {
    if (!global.MaoMcpClient || typeof global.MaoMcpClient.validateEndpoint !== 'function') {
      throw new Error('MCP 地址校验器不可用，已拒绝授权操作。');
    }
    var endpoint = global.MaoMcpClient.validateEndpoint(value);
    if (endpoint.length > MAX_ENDPOINT_CHARS) throw new Error('MCP 服务地址过长，无法保存授权。');
    return endpoint;
  }
  function stableJson(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + stableJson(value[key]);
    }).join(',') + '}';
  }
  function normalizeTool(tool) {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) throw new Error('MCP 工具授权对象无效。');
    var name = String(tool.name || '').trim();
    var schema = tool.inputSchema;
    if (!name || name.length > MAX_TOOL_NAME_CHARS || !schema || typeof schema !== 'object' || Array.isArray(schema)) {
      throw new Error('MCP 工具名称或参数结构无效，已拒绝授权。');
    }
    var canonical;
    try { canonical = stableJson(JSON.parse(JSON.stringify(schema))); }
    catch (error) { throw new Error('MCP 工具参数结构无法安全读取。'); }
    if (utf8ByteLength(canonical) > MAX_SCHEMA_BYTES) throw new Error('MCP 工具参数结构超过 24 KB 限制。');
    return { name: name, canonicalSchema: canonical };
  }
  function schemaFingerprint(canonicalSchema) {
    if (!global.crypto || !global.crypto.subtle || typeof global.crypto.subtle.digest !== 'function') {
      return Promise.reject(new Error('当前环境不支持安全的 SHA-256 授权指纹，已拒绝保存或使用授权。'));
    }
    return global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalSchema))
      .then(function (digest) {
        return Array.from(new Uint8Array(digest)).map(function (byte) {
          return byte.toString(16).padStart(2, '0');
        }).join('');
      });
  }
  function storageKey(roleId) {
    return KEY_PREFIX + encodeURIComponent(normalizeRoleId(roleId));
  }
  function validateRecord(record) {
    return !!record && typeof record === 'object' && !Array.isArray(record) &&
      typeof record.endpoint === 'string' && record.endpoint.length <= MAX_ENDPOINT_CHARS &&
      typeof record.toolName === 'string' && record.toolName.length > 0 &&
      record.toolName.length <= MAX_TOOL_NAME_CHARS &&
      typeof record.schemaSha256 === 'string' && /^[a-f0-9]{64}$/.test(record.schemaSha256) &&
      Number.isFinite(record.updatedAt) && record.updatedAt > 0;
  }
  function readRole(roleId) {
    var raw = global.localStorage.getItem(storageKey(roleId));
    if (!raw) return { version: 1, grants: [] };
    if (utf8ByteLength(raw) > MAX_ROLE_STORE_BYTES) throw new Error('角色 MCP 授权记录超过安全存储上限，已拒绝读取。');
    var parsed;
    try { parsed = JSON.parse(raw); }
    catch (error) { throw new Error('角色 MCP 授权记录损坏，已拒绝操作；原记录未被覆盖。'); }
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.grants) ||
        parsed.grants.length > MAX_GRANTS_PER_ROLE || !parsed.grants.every(validateRecord)) {
      throw new Error('角色 MCP 授权记录格式无效，已拒绝操作；原记录未被覆盖。');
    }
    return parsed;
  }
  function writeRole(roleId, state) {
    var raw = JSON.stringify(state);
    if (utf8ByteLength(raw) > MAX_ROLE_STORE_BYTES) throw new Error('角色 MCP 授权数量超过本地安全存储上限。');
    global.localStorage.setItem(storageKey(roleId), raw);
  }
  function publicGrant(record) {
    return { endpoint: record.endpoint, toolName: record.toolName, updatedAt: record.updatedAt };
  }

  NS.listForRole = function (roleId) { return readRole(roleId).grants.map(publicGrant); };
  NS.isAllowed = function (roleId, endpoint, tool) {
    var id, url, normalized;
    try {
      id = normalizeRoleId(roleId);
      url = normalizeEndpoint(endpoint);
      normalized = normalizeTool(tool);
    } catch (error) { return Promise.reject(error); }
    return schemaFingerprint(normalized.canonicalSchema).then(function (fingerprint) {
      return readRole(id).grants.some(function (grant) {
        return grant.endpoint === url && grant.toolName === normalized.name && grant.schemaSha256 === fingerprint;
      });
    });
  };
  NS.grantTool = function (roleId, endpoint, tool) {
    var id, url, normalized;
    try {
      id = normalizeRoleId(roleId);
      url = normalizeEndpoint(endpoint);
      normalized = normalizeTool(tool);
    } catch (error) { return Promise.reject(error); }
    return schemaFingerprint(normalized.canonicalSchema).then(function (fingerprint) {
      var state = readRole(id);
      var next = state.grants.filter(function (grant) {
        return !(grant.endpoint === url && grant.toolName === normalized.name);
      });
      if (next.length >= MAX_GRANTS_PER_ROLE) throw new Error('单个角色最多保存 100 项 MCP 工具授权。');
      next.push({ endpoint: url, toolName: normalized.name, schemaSha256: fingerprint, updatedAt: Date.now() });
      writeRole(id, { version: 1, grants: next });
      return publicGrant(next[next.length - 1]);
    });
  };
  NS.revokeTool = function (roleId, endpoint, toolName) {
    try {
      var id = normalizeRoleId(roleId);
      var url = normalizeEndpoint(endpoint);
      var name = String(toolName || '').trim();
      if (!name || name.length > MAX_TOOL_NAME_CHARS) throw new Error('MCP 工具名称无效。');
      var state = readRole(id);
      var next = state.grants.filter(function (grant) {
        return !(grant.endpoint === url && grant.toolName === name);
      });
      writeRole(id, { version: 1, grants: next });
      return Promise.resolve(next.length !== state.grants.length);
    } catch (error) { return Promise.reject(error); }
  };
  NS.revokeRole = function (roleId) {
    try {
      global.localStorage.removeItem(storageKey(roleId));
      return Promise.resolve(true);
    } catch (error) { return Promise.reject(error); }
  };
})(window);
