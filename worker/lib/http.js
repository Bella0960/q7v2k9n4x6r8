/** 基础错误与 JSON 响应工具。所有失败都返回明确的 code，便于前端诊断。 */

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export function ok(data = {}) {
  return json({ ok: true, ...data });
}

export function fail(status, code, message) {
  return json({ ok: false, error: { code, message } }, status);
}

export async function readJsonBody(request, limit = 8192) {
  const text = await request.text();
  if (!text) return {};
  if (text.length > limit) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '请求体过大');
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ApiError(400, 'INVALID_JSON', '请求体必须是 JSON 对象');
    }
    return parsed;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'INVALID_JSON', '请求体不是合法 JSON');
  }
}
