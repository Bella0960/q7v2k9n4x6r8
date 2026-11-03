const API_PREFIX = '/v1';
const MODEL_PREFIX = 'maomao-free:';

// Only model IDs listed here are exposed. This prevents the gateway from
// accidentally routing a free-tier account to an unverified paid model.
const PROVIDERS = [
  {
    slug: 'google-gemini',
    name: 'Google Gemini',
    envKey: 'FREE_GOOGLE_GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    freeType: 'renewing-quota',
    notice: 'Free-tier prompts may be used by Google to improve its products. Review the current data terms before sending private conversations.',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro']
  },
  {
    slug: 'groq',
    name: 'Groq',
    envKey: 'FREE_GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    freeType: 'renewing-quota',
    notice: 'Free quotas are shared at organization level and vary by model. Inference data is not retained by default; limited reliability/abuse logs may be kept.',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']
  },
  {
    slug: 'cloudflare-workers-ai',
    name: 'Cloudflare Workers AI',
    envKey: 'FREE_CLOUDFLARE_API_TOKEN',
    accountIdEnvKey: 'FREE_CLOUDFLARE_ACCOUNT_ID',
    baseUrl: null,
    freeType: 'renewing-quota',
    notice: 'Free allocation is measured in Neurons and resets daily; some models may require a paid Workers plan.',
    models: [
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/meta/llama-3.1-8b-instruct',
      '@cf/mistralai/mistral-small-3.1-24b-instruct',
      '@cf/qwen/qwen2.5-coder-32b-instruct',
      '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
      '@cf/google/gemma-3-12b-it'
    ]
  },
  {
    slug: 'cohere',
    name: 'Cohere',
    envKey: 'FREE_COHERE_API_KEY',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    freeType: 'evaluation',
    notice: 'Trial API keys are for evaluation only and are not licensed for production/commercial use.',
    models: ['command-a-03-2025', 'command-r-plus-08-2024', 'command-r-08-2024', 'command-r7b-12-2024']
  },
  {
    slug: 'cerebras',
    name: 'Cerebras',
    envKey: 'FREE_CEREBRAS_API_KEY',
    baseUrl: 'https://api.cerebras.ai/v1',
    freeType: 'trial-credit',
    notice: 'The listed free access is a time-limited signup credit; a verified payment method is required to activate API access. Check billing controls before use.',
    models: ['gpt-oss-120b', 'qwen-3.8-27b']
  },
  {
    slug: 'zai-glm',
    name: 'Z.ai / GLM',
    envKey: 'FREE_ZAI_GLM_API_KEY',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    freeType: 'perpetual',
    notice: 'The listed Flash models were marked $0 on a permanent basis in the source dataset; provider terms and model availability can change.',
    models: ['glm-4.7-flash', 'glm-4.5-flash', 'glm-4.6v-flash']
  },
  {
    slug: 'sambanova',
    name: 'SambaNova Cloud',
    envKey: 'FREE_SAMBANOVA_API_KEY',
    baseUrl: 'https://api.sambanova.ai/v1',
    freeType: 'renewing-quota',
    notice: 'The provider publishes a rate-limited free tier, but its own signup pages differ on whether a payment method is needed. Verify account billing settings.',
    models: ['DeepSeek-V3.1', 'Meta-Llama-3.3-70B-Instruct', 'gpt-oss-120b']
  },
  {
    slug: 'modelscope',
    name: 'ModelScope API-Inference',
    envKey: 'FREE_MODELSCOPE_API_KEY',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    freeType: 'renewing-quota',
    notice: 'Daily Magicubes are limited; Alibaba account binding and real-name verification may be required. The source lists this tier as non-commercial.',
    models: ['MiniMax/MiniMax-M1-80k', 'OpenGVLab/InternVL3_5-241B-A28B', 'Tencent-Hunyuan/Hy3']
  },
  {
    slug: 'scaleway',
    name: 'Scaleway Generative APIs',
    envKey: 'FREE_SCALEWAY_API_KEY',
    baseUrl: 'https://api.scaleway.ai/v1',
    freeType: 'trial-credit',
    notice: 'The source lists a one-time free token allowance. Check payment method and overage settings so usage cannot unexpectedly become paid.',
    models: [
      'llama-3.3-70b-instruct',
      'qwen3-235b-a22b-instruct-2507',
      'mistral-small-3.2-24b-instruct-2506',
      'gpt-oss-120b',
      'gemma-4-26b-a4b-it',
      'qwen3-coder-30b-a3b-instruct'
    ]
  },
  {
    slug: 'nvidia-nim',
    name: 'NVIDIA NIM',
    envKey: 'FREE_NVIDIA_NIM_API_KEY',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    freeType: 'evaluation',
    notice: 'NVIDIA trial terms describe this access as evaluation-only, not production. Phone verification is required.',
    models: [
      '01-ai/yi-large',
      'ai21labs/jamba-1.5-large-instruct',
      'databricks/dbrx-instruct',
      'deepseek-ai/deepseek-coder-6.7b-instruct'
    ]
  },
  {
    slug: 'typhoon',
    name: 'Typhoon / SCB 10X',
    envKey: 'FREE_TYPHOON_API_KEY',
    baseUrl: 'https://api.opentyphoon.ai/v1',
    freeType: 'perpetual',
    notice: 'The research showcase API is listed as free, but its usage data may be collected to improve the service and models.',
    models: ['typhoon-v2.5-30b-a3b-instruct']
  }
];

function resolveBaseUrl(provider, env) {
  if (provider.slug === 'cloudflare-workers-ai') {
    const accountId = String(env[provider.accountIdEnvKey] || '').trim();
    if (!accountId) return '';
    return 'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(accountId) + '/ai/v1';
  }
  return provider.baseUrl || '';
}

function enabledProviders(env) {
  return PROVIDERS.filter(function (provider) {
    return Boolean(String(env[provider.envKey] || '').trim() && resolveBaseUrl(provider, env));
  });
}

function makeCorsHeaders(request, env) {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  });
  const origin = request.headers.get('Origin');
  if (origin) {
    const requestOrigin = new URL(request.url).origin;
    const configured = String(env.MAOMAO_CORS_ORIGINS || '')
      .split(',')
      .map(function (value) { return value.trim(); })
      .filter(Boolean);
    if (origin === requestOrigin || configured.includes(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
    }
  }
  return headers;
}

function jsonResponse(request, env, payload, status) {
  const headers = makeCorsHeaders(request, env);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(payload), { status: status || 200, headers: headers });
}

function errorPayload(message, type, code) {
  return { error: { message: message, type: type || 'api_error', code: code || null } };
}

function isAuthorized(request, env) {
  const expected = String(env.GATEWAY_API_KEY || '').trim();
  if (!expected) return false;
  return request.headers.get('Authorization') === 'Bearer ' + expected;
}

function buildModelId(provider, model) {
  return MODEL_PREFIX + provider.slug + ':' + model;
}

function listModels(request, env) {
  const data = [];
  enabledProviders(env).forEach(function (provider) {
    provider.models.forEach(function (model) {
      data.push({
        id: buildModelId(provider, model),
        object: 'model',
        created: 1792281600,
        owned_by: provider.slug,
        display_name: provider.name + ' · ' + model,
        description: provider.freeType + ' — ' + provider.notice
      });
    });
  });
  return jsonResponse(request, env, { object: 'list', data: data }, 200);
}

function resolveModel(modelId, env) {
  if (typeof modelId !== 'string' || !modelId.startsWith(MODEL_PREFIX)) return null;
  const remainder = modelId.slice(MODEL_PREFIX.length);
  const splitAt = remainder.indexOf(':');
  if (splitAt < 1) return null;
  const slug = remainder.slice(0, splitAt);
  const upstreamModel = remainder.slice(splitAt + 1);
  if (!upstreamModel) return null;
  const provider = enabledProviders(env).find(function (item) { return item.slug === slug; });
  if (!provider || !provider.models.includes(upstreamModel)) return null;
  return { provider: provider, upstreamModel: upstreamModel, baseUrl: resolveBaseUrl(provider, env) };
}

async function proxyChatCompletion(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return jsonResponse(request, env, errorPayload('请求体不是有效 JSON', 'invalid_request_error'), 400);
  }

  const resolved = resolveModel(payload && payload.model, env);
  if (!resolved) {
    return jsonResponse(
      request,
      env,
      errorPayload('模型不存在、未启用，或对应平台 Key 尚未配置。请先拉取可用模型列表。', 'invalid_request_error', 'model_not_found'),
      404
    );
  }

  payload.model = resolved.upstreamModel;
  const targetUrl = resolved.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers = new Headers({
    'Authorization': 'Bearer ' + String(env[resolved.provider.envKey]).trim(),
    'Content-Type': 'application/json'
  });
  const accept = request.headers.get('Accept');
  if (accept) headers.set('Accept', accept);

  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
      redirect: 'manual'
    });
  } catch (error) {
    return jsonResponse(request, env, errorPayload('上游服务连接失败：' + resolved.provider.name, 'upstream_error'), 502);
  }

  const responseHeaders = makeCorsHeaders(request, env);
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-MAOMAO-Provider', resolved.provider.slug);
  const contentType = upstream.headers.get('Content-Type');
  if (contentType) responseHeaders.set('Content-Type', contentType);
  const retryAfter = upstream.headers.get('Retry-After');
  if (retryAfter) responseHeaders.set('Retry-After', retryAfter);

  // Pass the response body through unchanged so server-sent event streaming works.
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const cors = makeCorsHeaders(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (path === API_PREFIX + '/health' && request.method === 'GET') {
    return jsonResponse(request, env, { ok: true, service: 'MAOMAO Free Model Gateway' }, 200);
  }

  if (!env.GATEWAY_API_KEY) {
    return jsonResponse(request, env, errorPayload('网关尚未配置 GATEWAY_API_KEY', 'configuration_error'), 503);
  }
  if (!isAuthorized(request, env)) {
    return jsonResponse(request, env, errorPayload('网关 API Key 无效', 'authentication_error'), 401);
  }

  if (path === API_PREFIX + '/models' && request.method === 'GET') {
    return listModels(request, env);
  }
  if (path === API_PREFIX + '/chat/completions' && request.method === 'POST') {
    return proxyChatCompletion(request, env);
  }

  return jsonResponse(request, env, errorPayload('不支持的网关路径或请求方法', 'invalid_request_error'), 404);
}

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname === API_PREFIX || pathname.startsWith(API_PREFIX + '/')) {
      return handleApi(request, env || {});
    }
    if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }
    return new Response('Not Found', { status: 404 });
  }
};
