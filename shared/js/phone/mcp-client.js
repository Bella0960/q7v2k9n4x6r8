/* MAOMAO MCP Streamable HTTP client.
 * Bearer credentials exist only in this page's memory; connection metadata is stored by the UI.
 */
(function (global) {
  'use strict';

  var NS = global.MaoMcpClient = {};
  var PROTOCOL_VERSION = '2025-03-26';
  var MAX_RESPONSE_BYTES = 1024 * 1024;
  var MAX_TOOLS = 500;

  function validateEndpoint(value) {
    var url;
    try { url = new URL(String(value || '').trim()); }
    catch (error) { throw new Error('请输入完整、有效的 MCP 服务地址。'); }

    if (url.username || url.password || url.hash) {
      throw new Error('服务地址不能包含用户名、密码或片段。');
    }
    if (Array.from(url.searchParams.keys()).some(function (key) {
      return /^(?:access[_-]?token|api[_-]?key|auth(?:orization)?|credential|password|secret|token)$/i.test(key);
    })) {
      throw new Error('请勿把密钥放在服务地址参数中；请使用单独的 Bearer Token 输入框。');
    }

    var host = String(url.hostname || '').toLowerCase().replace(/\.$/, '');
    var localHost = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    var ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost)) {
      throw new Error('MCP 服务必须使用 HTTPS；仅 localhost 开发地址允许 HTTP。');
    }
    var blockedSuffixes = ['.local', '.internal', '.localhost', '.lan', '.home', '.corp', '.intranet', '.test', '.invalid', '.example', '.arpa'];
    if (blockedSuffixes.some(function (suffix) { return host.endsWith(suffix); })) {
      throw new Error('暂不允许连接局域网或内部域名。');
    }
    var isIpv6Host = host.indexOf(':') !== -1;
    if (!localHost && !ipv4 && !isIpv6Host && host.indexOf('.') === -1) {
      throw new Error('MCP 服务必须使用可公开解析的完整域名或公网 IP。');
    }
    if (ipv4) {
      var octets = ipv4.slice(1).map(Number);
      var a = octets[0], b = octets[1];
      if (octets.some(function (n) { return n < 0 || n > 255; }) ||
          a === 0 || a === 10 || a === 127 || a >= 224 ||
          (a === 100 && b >= 64 && b <= 127) ||
          (a === 169 && b === 254) ||
          (a === 172 && b >= 16 && b <= 31) ||
          (a === 192 && (b === 0 || b === 168)) ||
          (a === 198 && (b === 18 || b === 19))) {
        throw new Error('暂不允许连接本机、局域网、保留或链路本地 IP 地址。');
      }
    }
    var ipv6 = host.replace(/^\[|\]$/g, '');
    if (ipv6.indexOf(':') !== -1 &&
        (ipv6 === '::' || ipv6 === '::1' || /^(?:fc|fd|fe[89ab])/i.test(ipv6))) {
      throw new Error('暂不允许连接本机或局域网 IPv6 地址。');
    }
    return url.href;
  }

  function parseSse(text, expectedId) {
    var parsed = [];
    String(text || '').split(/\r?\n\r?\n/).forEach(function (block) {
      var data = block.split(/\r?\n/).filter(function (line) {
        return line.indexOf('data:') === 0;
      }).map(function (line) {
        return line.slice(5).replace(/^ /, '');
      }).join('\n');
      if (!data || data === '[DONE]') return;
      try { parsed.push(JSON.parse(data)); } catch (error) {}
    });
    if (expectedId == null) return parsed[parsed.length - 1] || null;
    for (var i = parsed.length - 1; i >= 0; i--) {
      if (String(parsed[i].id) === String(expectedId)) return parsed[i];
    }
    return null;
  }

  function readResponseText(response) {
    var body = response.body;
    if (body && typeof body.getReader === 'function') {
      var reader = body.getReader();
      var decoder = new TextDecoder();
      var chunks = [];
      var totalBytes = 0;
      function readNext() {
        return reader.read().then(function (part) {
          if (part.done) return decoder.decode();
          var chunk = part.value;
          totalBytes += chunk && chunk.byteLength ? chunk.byteLength : 0;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            try {
              var cancelled = reader.cancel();
              if (cancelled && typeof cancelled.catch === 'function') cancelled.catch(function () {});
            } catch (error) {}
            throw new Error('MCP 服务返回内容过大，已停止读取。');
          }
          chunks.push(decoder.decode(chunk, { stream: true }));
          return readNext();
        });
      }
      return readNext().then(function (tail) { return chunks.join('') + tail; });
    }
    // Older/mock Response implementations may not expose a readable body.
    return response.text().then(function (text) {
      if (text.length > MAX_RESPONSE_BYTES) throw new Error('MCP 服务返回内容过大，已停止读取。');
      return text;
    });
  }

  function validateToolArguments(schema, args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new Error('工具参数必须是 JSON 对象。');
    }
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      throw new Error('工具参数结构无效，已停止调用。');
    }
    function actualType(value) {
      if (value === null) return 'null';
      if (Array.isArray(value)) return 'array';
      if (Number.isInteger(value)) return 'integer';
      if (typeof value === 'number') return 'number';
      return typeof value;
    }
    function check(node, value, path, depth) {
      if (depth > 8) throw new Error(path + ' 嵌套超过 8 层。');
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      if (Array.isArray(node.enum)) {
        var encoded = JSON.stringify(value);
        if (!node.enum.some(function (item) { return JSON.stringify(item) === encoded; })) {
          throw new Error(path + ' 不符合工具声明的可选值。');
        }
      }
      var types = Array.isArray(node.type) ? node.type : (node.type ? [node.type] : []);
      if (types.length && types.indexOf(actualType(value)) === -1 &&
          !(actualType(value) === 'integer' && types.indexOf('number') !== -1)) {
        throw new Error(path + ' 类型不符合工具声明（需要 ' + types.join(' / ') + '）。');
      }
      var type = node.type;
      if (Array.isArray(type)) type = type.indexOf(actualType(value)) !== -1
        ? actualType(value) : (type.indexOf('number') !== -1 && actualType(value) === 'integer' ? 'number' : type[0]);
      if (type === 'object' || (!type && value && typeof value === 'object' && !Array.isArray(value))) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(path + ' 必须是对象。');
        var properties = node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties)
          ? node.properties : {};
        (Array.isArray(node.required) ? node.required.slice(0, 100) : []).forEach(function (key) {
          if (!Object.prototype.hasOwnProperty.call(value, key)) {
            throw new Error(path + ' 缺少必填字段：' + String(key).slice(0, 80));
          }
        });
        Object.keys(value).forEach(function (key) {
          if (!Object.prototype.hasOwnProperty.call(properties, key)) {
            if (node.additionalProperties === false) throw new Error(path + ' 含有未声明字段：' + key.slice(0, 80));
            return;
          }
          check(properties[key], value[key], path + '.' + key.slice(0, 80), depth + 1);
        });
      } else if (type === 'array') {
        if (!Array.isArray(value)) throw new Error(path + ' 必须是数组。');
        if (Number.isFinite(node.minItems) && value.length < node.minItems) throw new Error(path + ' 项数少于最小限制。');
        if (Number.isFinite(node.maxItems) && value.length > node.maxItems) throw new Error(path + ' 项数超过最大限制。');
        if (node.items && typeof node.items === 'object') {
          value.slice(0, 200).forEach(function (item, index) {
            check(node.items, item, path + '[' + index + ']', depth + 1);
          });
          if (value.length > 200) throw new Error(path + ' 数组项数超过安全检查上限。');
        }
      } else if (type === 'string') {
        if (typeof value !== 'string') throw new Error(path + ' 必须是文本。');
        if (Number.isFinite(node.minLength) && value.length < node.minLength) throw new Error(path + ' 长度不足。');
        if (Number.isFinite(node.maxLength) && value.length > node.maxLength) throw new Error(path + ' 过长。');
      } else if (type === 'integer') {
        if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(path + ' 必须是整数。');
        if (Number.isFinite(node.minimum) && value < node.minimum) throw new Error(path + ' 小于允许范围。');
        if (Number.isFinite(node.maximum) && value > node.maximum) throw new Error(path + ' 大于允许范围。');
      } else if (type === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(path + ' 必须是有效数字。');
        if (Number.isFinite(node.minimum) && value < node.minimum) throw new Error(path + ' 小于允许范围。');
        if (Number.isFinite(node.maximum) && value > node.maximum) throw new Error(path + ' 大于允许范围。');
      } else if (type === 'boolean' && typeof value !== 'boolean') {
        throw new Error(path + ' 必须是布尔值。');
      }
    }
    if (schema.type && schema.type !== 'object' && !(Array.isArray(schema.type) && schema.type.indexOf('object') !== -1)) {
      throw new Error('MCP 工具的根参数结构必须是 object。');
    }
    check(schema, args, '参数', 0);
    return true;
  }

  function parseResponse(response, expectedId) {
    return readResponseText(response).then(function (text) {
      if (!text.trim()) return null;
      var type = String(response.headers.get('content-type') || '').toLowerCase();
      if (type.indexOf('text/event-stream') !== -1 || /^\s*event:|^\s*data:/m.test(text)) {
        return parseSse(text, expectedId);
      }
      try { return JSON.parse(text); }
      catch (error) { throw new Error('MCP 服务返回的不是有效 JSON 或 SSE 消息。'); }
    });
  }

  NS.validateEndpoint = validateEndpoint;
  NS.validateToolArguments = validateToolArguments;
  NS.createClient = function (options) {
    options = options || {};
    var endpoint = validateEndpoint(options.url);
    var token = String(options.token || '').trim();
    var sessionId = '';
    var nextId = 1;
    var closed = false;

    function post(payload, timeoutMs) {
      if (closed) return Promise.reject(new Error('连接已断开。'));
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 15000);
      var headers = {
        'Accept': 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': PROTOCOL_VERSION
      };
      if (token) headers.Authorization = 'Bearer ' + token;
      if (sessionId) headers['Mcp-Session-Id'] = sessionId;

      return fetch(endpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error'
      }).then(function (response) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('MCP 服务拒绝了授权。请检查令牌或服务权限。');
        }
        if (response.status === 404 || response.status === 405) {
          throw new Error('此地址未提供可用的 MCP Streamable HTTP 入口。');
        }
        if (!response.ok && response.status !== 202) {
          throw new Error('MCP 服务返回 HTTP ' + response.status + '。');
        }
        var newSession = response.headers.get('Mcp-Session-Id');
        if (newSession) sessionId = newSession;
        if (response.status === 202) { clearTimeout(timer); return null; }
        return parseResponse(response, payload.id).then(function (message) {
          clearTimeout(timer);
          return message;
        });
      }).then(function (message) {
        if (message && message.error) {
          throw new Error(String(message.error.message || 'MCP JSON-RPC 请求失败。').slice(0, 240));
        }
        return message;
      }).catch(function (error) {
        clearTimeout(timer);
        if (error && error.name === 'AbortError') throw new Error('MCP 请求超时。');
        if (error instanceof TypeError) {
          throw new Error('无法连接 MCP 服务。请检查地址、网络和服务器 CORS 设置。');
        }
        throw error;
      });
    }

    function request(method, params, timeoutMs) {
      var id = nextId++;
      return post({ jsonrpc: '2.0', id: id, method: method, params: params || {} }, timeoutMs)
        .then(function (message) {
          if (!message || message.id == null || String(message.id) !== String(id) ||
              !Object.prototype.hasOwnProperty.call(message, 'result')) {
            throw new Error('MCP 服务没有返回匹配的请求结果。');
          }
          return message.result;
        });
    }

    function notify(method, params) {
      return post({ jsonrpc: '2.0', method: method, params: params || {} });
    }

    return {
      endpoint: endpoint,
      getSessionId: function () { return sessionId; },
      initialize: function () {
        return request('initialize', {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'MAOMAO', version: '1.0.0' }
        }).then(function (result) {
          if (!result || result.protocolVersion !== PROTOCOL_VERSION) {
            throw new Error('服务器协商的 MCP 协议版本不受支持：' +
              String(result && result.protocolVersion || '未知'));
          }
          return notify('notifications/initialized').then(function () { return result; });
        });
      },
      listTools: function () {
        var all = [];
        var seenCursors = Object.create(null);
        function page(cursor, pageCount) {
          if (pageCount >= 20 || all.length >= MAX_TOOLS) return Promise.resolve(all);
          if (cursor && seenCursors[cursor]) throw new Error('MCP 工具分页游标重复，已停止读取。');
          if (cursor) seenCursors[cursor] = true;
          return request('tools/list', cursor ? { cursor: cursor } : {}).then(function (result) {
            (Array.isArray(result.tools) ? result.tools : []).forEach(function (tool) {
              if (!tool || typeof tool.name !== 'string' || !tool.name.trim() || all.length >= MAX_TOOLS) return;
              all.push({
                name: tool.name.slice(0, 120),
                description: String(tool.description || '').slice(0, 1200),
                inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object'
                  ? tool.inputSchema : { type: 'object', properties: {} }
              });
            });
            return result.nextCursor ? page(String(result.nextCursor), pageCount + 1) : all;
          });
        }
        return page('', 0);
      },
      callTool: function (name, args) {
        if (!name || typeof name !== 'string') return Promise.reject(new Error('工具名称无效。'));
        return request('tools/call', {
          name: name,
          arguments: args && typeof args === 'object' && !Array.isArray(args) ? args : {}
        }, 30000);
      },
      disconnect: function () {
        if (closed) return Promise.resolve();
        closed = true;
        if (!sessionId) return Promise.resolve();
        var headers = {
          'MCP-Protocol-Version': PROTOCOL_VERSION,
          'Mcp-Session-Id': sessionId
        };
        if (token) headers.Authorization = 'Bearer ' + token;
        return fetch(endpoint, {
          method: 'DELETE',
          headers: headers,
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error'
        }).then(function () { return undefined; }).catch(function () { return undefined; });
      }
    };
  };
})(window);
