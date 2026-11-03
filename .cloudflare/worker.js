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
    models: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash']
  },
  {
    slug: 'groq',
    name: 'Groq',
    envKey: 'FREE_GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    freeType: 'renewing-quota',
    notice: 'Free quotas are shared at organization level and vary by model. Inference data is not retained by default; limited reliability/abuse logs may be kept.',
    models: ['moonshotai/kimi-k2-instruct', 'moonshotai/kimi-k2-instruct-0905', 'groq/compound', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']
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
      '@cf/mistral/mistral-7b-instruct-v0.1',
      '@cf/qwen/qwen1.5-7b-chat',
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
    models: ['command-a-218b', 'command-a-111b', 'command-r']
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
    models: ['glm-4.7-flash', 'glm-4.6v-flash']
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
    models: ['MiniMax/MiniMax-M2.5', 'MiniMax/MiniMax-M1-80k', 'OpenGVLab/InternVL3_5-241B-A28B', 'Tencent-Hunyuan/Hy3']
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
      'z-ai/glm-5.2',
      'z-ai/glm-5.1',
      'poolside/laguna-xs-2.1',
      '01-ai/yi-large',
      'ai21labs/jamba-1.5-large-instruct',
      'databricks/dbrx-instruct',
      'deepseek-ai/deepseek-coder-6.7b-instruct'
    ]
  },
  {
    slug: 'vercel-ai-gateway',
    name: 'Vercel AI Gateway',
    envKey: 'FREE_VERCEL_AI_GATEWAY_API_KEY',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    freeType: 'recurring-credit',
    notice: 'The source lists a monthly free credit, but does not publish the amount. Confirm a model is marked Free Tier eligible and set spending controls before use.',
    models: [
      'alibaba/qwen-3-14b',
      'amazon/nova-2-lite',
      'anthropic/claude-3-haiku',
      'arcee-ai/trinity-large-thinking',
      'bytedance/seed-1.6',
      'cohere/command-a',
      'deepseek/deepseek-r1'
    ]
  },
  {
    slug: 'opencode-zen',
    name: 'OpenCode Zen',
    envKey: 'FREE_OPENCODE_ZEN_API_KEY',
    baseUrl: 'https://opencode.ai/zen/v1',
    freeType: 'free-tier',
    notice: 'The free model set and per-model limits can change. Select only models marked free in the provider catalog.',
    models: ['big-pickle', 'deepseek-v4-flash-free', 'mimo-v2.5-free']
  },
  {
    slug: 'llm7',
    name: 'LLM7.io',
    envKey: 'FREE_LLM7_API_KEY',
    baseUrl: 'https://api.llm7.io/v1',
    freeType: 'rate-limited-free',
    notice: 'Free access is rate-limited; current directory examples show 60 RPM and 250 requests/hour. Confirm the account limits.',
    models: ['gpt-oss-20b', 'mistral-Nemo-Instruct-2407', 'minimax-m2.7']
  },
  {
    slug: 'kilo-code',
    name: 'Kilo Code',
    envKey: 'FREE_KILO_CODE_API_KEY',
    baseUrl: 'https://api.kilo.ai/api/gateway',
    freeType: 'rate-limited-free',
    notice: 'The directory lists free models with a request-rate allowance. Use only IDs currently marked free in the Kilo catalog.',
    models: [
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'stepfun/step-3.7-flash',
      'nvidia/nemotron-3-super-120b-a12b:free'
    ]
  },
  {
    slug: 'ollama-cloud',
    name: 'Ollama Cloud',
    envKey: 'FREE_OLLAMA_CLOUD_API_KEY',
    baseUrl: 'https://ollama.com/v1',
    freeType: 'monthly-free-allocation',
    notice: 'The free plan has a limited starter allocation and one concurrent request. Cloud prompts are not used for model training according to the provider page.',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash', 'minimax-m3']
  },
  {
    slug: 'mistral',
    name: 'Mistral AI',
    envKey: 'FREE_MISTRAL_API_KEY',
    baseUrl: 'https://api.mistral.ai/v1',
    freeType: 'evaluation-free-tier',
    notice: 'Mistral Free mode is intended for evaluation and prototyping. Free-tier inputs/outputs may be used for training unless opted out in the provider console.',
    models: ['open-mistral-7b', 'open-mixtral-8x7b', 'mistral-medium-3-5-128b']
  },
  {
    slug: 'ovhcloud',
    name: 'OVHcloud AI Endpoints',
    envKey: 'FREE_OVHCLOUD_API_KEY',
    baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
    freeType: 'anonymous-or-trial-free',
    notice: 'The directory lists a very low anonymous request allowance for some endpoints. Limits and availability vary by model and account.',
    models: ['qwen3.5-397b-a17b', 'meta-llama-3_3-70b-instruct', 'qwen3.8-27b']
  },
  {
    slug: 'aion-labs',
    name: 'Aion Labs',
    envKey: 'FREE_AION_LABS_API_KEY',
    baseUrl: 'https://api.aionlabs.ai/v1',
    freeType: 'rate-limited-free',
    notice: 'Directory examples show a low-volume free allowance. Confirm model IDs and daily token limits in the provider console.',
    models: ['aion-labs/aion-2.0', 'aion-labs/aion-rp-llama-3.1-8b', 'aion-labs/aion-3.0']
  },
  {
    slug: 'huggingface',
    name: 'Hugging Face Inference Providers',
    envKey: 'FREE_HUGGINGFACE_API_KEY',
    baseUrl: 'https://router.huggingface.co/v1',
    freeType: 'credit-metered-free',
    notice: 'Free inference is credit-metered and model/provider availability varies. A free account balance is not unlimited usage.',
    models: ['meta-llama/Llama-3.1-8B-Instruct', 'google/gemma-3-4b-it', 'microsoft/phi-4']
  },
  {
    slug: 'agnes-ai',
    name: 'Agnes AI',
    envKey: 'FREE_AGNES_AI_API_KEY',
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    freeType: 'rate-limited-free',
    notice: 'The directory lists free Flash models with request limits. Confirm each model remains free before relying on it.',
    models: ['agnes-1.5-flash', 'agnes-2.0-flash']
  },
  {
    slug: 'alibaba-model-studio',
    name: 'Alibaba Cloud Model Studio',
    envKey: 'FREE_ALIBABA_MODELS_API_KEY',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    freeType: 'trial-credit',
    notice: 'The free token quota is new-account and region dependent. Check the model-specific quota and enable stop-on-quota-exhaustion.',
    models: ['qwen3-max', 'qwen3-plus', 'qwen3-vl-plus']
  },
  {
    slug: 'siliconflow',
    name: 'SiliconFlow',
    envKey: 'FREE_SILICONFLOW_API_KEY',
    baseUrl: 'https://api.siliconflow.cn/v1',
    freeType: 'perpetual-models-and-trial-credit',
    notice: 'Some models are priced at zero on the China platform; real-name verification may be required. Verify each model price and usage terms.',
    models: ['Qwen/Qwen3-8B', 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B']
  },
  {
    slug: 'xai',
    name: 'xAI',
    envKey: 'FREE_XAI_API_KEY',
    baseUrl: 'https://api.x.ai/v1',
    freeType: 'credit-based',
    notice: 'Access is credit-based and may be a promotional or account-specific allocation. Confirm current free balance and billing safeguards.',
    models: ['grok-4.3', 'grok-4.1-fast', 'grok-3-mini']
  },
  {
    slug: 'chutes',
    name: 'Chutes.ai',
    envKey: 'FREE_CHUTES_API_KEY',
    baseUrl: 'https://api.chutes.ai/v1',
    freeType: 'community-free-models',
    notice: 'Free model capacity is community-powered and may be limited by availability. Model licenses still apply.',
    models: ['deepseek-ai/DeepSeek-R1', 'meta-llama/Meta-Llama-3.1-70B-Instruct']
  },
  {
    slug: 'glhf',
    name: 'Glhf.chat',
    envKey: 'FREE_GLHF_API_KEY',
    baseUrl: 'https://glhf.chat/api/openai/v1',
    freeType: 'free-model-pool',
    notice: 'The directory lists unlimited use for selected free models, subject to availability and the provider’s current fair-use rules.',
    models: ['meta-llama/Meta-Llama-3.1-70B-Instruct', 'mistralai/Mixtral-8x7B-Instruct-v0.1']
  },
  {
    slug: 'ai21',
    name: 'AI21 Labs',
    envKey: 'FREE_AI21_API_KEY',
    baseUrl: 'https://api.ai21.com/studio/v1',
    freeType: 'trial-credit',
    notice: 'Signup credits are time-limited; usage may require a payment method after credits expire. Confirm billing settings.',
    models: ['jamba-large-1.7', 'jamba-mini-2']
  },
  {
    slug: 'deepseek',
    name: 'DeepSeek',
    envKey: 'FREE_DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com/v1',
    freeType: 'trial-or-promotional-quota',
    notice: 'Promotional free quota and eligible model IDs can change. Check the DeepSeek console before each usage period.',
    models: ['deepseek-chat', 'deepseek-reasoner']
  },
  {
    slug: 'nscale',
    name: 'Nscale',
    envKey: 'FREE_NSCALE_API_KEY',
    baseUrl: 'https://inference.api.nscale.com/v1',
    freeType: 'fair-use-free',
    notice: 'The directory lists fair-use access; availability, concurrency and model eligibility are provider-controlled.',
    models: ['meta-llama/Llama-3.3-70B-Instruct', 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B']
  },
  {
    slug: 'nebius',
    name: 'Nebius AI Studio',
    envKey: 'FREE_NEBIUS_API_KEY',
    baseUrl: 'https://api.studio.nebius.com/v1',
    freeType: 'trial-credit',
    notice: 'The directory lists a limited signup credit. A bank card is required to set up billing; check spending controls.',
    models: ['Qwen/Qwen3-235B-A22B']
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
