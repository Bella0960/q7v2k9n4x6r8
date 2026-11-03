# MAOMAO Free Model Gateway

## What this adds

MAOMAO's existing API consumers continue to use the same OpenAI-compatible contract:

- Base URL: `https://<your-maomao-host>/v1`
- API Key: the gateway's own `GATEWAY_API_KEY`
- Model: select an ID returned by `GET /v1/models`

The Worker routes each namespaced model ID to one fixed upstream provider. The provider's own API key stays in Cloudflare Worker Secrets and is never sent to the browser. The browser stores only the single gateway key in the existing local API profile.

This is a router, not a source of free credits: each provider still requires the account and key issued to you by that provider. The gateway does not scrape, share, or manufacture API keys.

## Why the catalog is deliberately allow-listed

The discovery references are:

- [open-free-llm-api/awesome-freellm-apis](https://github.com/open-free-llm-api/awesome-freellm-apis), whose README advertises 513+ models across 30 providers and supplies provider signup links.
- [pacocartones/free-llm-api-hub](https://github.com/pacocartones/free-llm-api-hub), an MIT-licensed, structured catalog. The reviewed dataset was v2.11.0, generated 2026-10-18. It contains 68 provider records; 31 were marked as verified OpenAI-compatible text APIs, but many did not have a confirmed free model ID.

The gateway exposes only explicit model IDs from the reviewed catalog. Providers with missing/uncertain model IDs are not queried for their full paid model list: doing that could make a paid model appear free and unexpectedly consume a billable balance. OpenRouter is not routed through this proxy because the catalog records terms that prohibit reselling API access or building a competing service. It can still be configured separately as a normal direct API profile.

The model IDs and free-plan rules can change. The list is a curated snapshot, not a guarantee of future free availability. Check the provider's own terms and billing console before adding a key.

## Providers currently included

| Provider | Access type | Notes |
|---|---|---|
| Google Gemini | Renewable free quota | Free-tier prompts may be used to improve Google's products. |
| Groq | Renewable free quota | Model-specific limits; free quota is shared at organization level. |
| Cloudflare Workers AI | Daily Neurons allocation | Requires account ID and API token; some models may require a paid plan. |
| Cohere | Evaluation tier | Trial terms are evaluation-only, not production/commercial. |
| Cerebras | Trial credits | Payment verification required; credits are time-limited. |
| Z.ai / GLM | Perpetual $0 Flash models | Availability and terms can change. |
| SambaNova | Rate-limited free tier | Its own pages differ on payment-method requirements; verify billing controls. |
| ModelScope | Daily free quota | Real-name/account binding may be required; source marks the free tier non-commercial. |
| Scaleway | One-time free allowance | Check payment and overage settings. |
| NVIDIA NIM | Evaluation tier | Phone verification; trial terms say evaluation-only. |
| Typhoon / SCB 10X | Perpetual free showcase API | Usage data may be collected to improve the service/models. |

Providers whose current free model IDs could not be confirmed are intentionally left out of the routable list until they can be verified. This avoids silently routing to paid models.

## Configure Cloudflare secrets

Add the following as **Worker Secrets** (not GitHub source files and not plaintext variables in the frontend). The gateway only lists a provider's models after its corresponding secret is present.

Required gateway secret:

- `GATEWAY_API_KEY`: a long random value used by MAOMAO as the one API Key.

Optional provider secrets:

- `FREE_GOOGLE_GEMINI_API_KEY`
- `FREE_GROQ_API_KEY`
- `FREE_CLOUDFLARE_API_TOKEN`
- `FREE_CLOUDFLARE_ACCOUNT_ID` (required alongside the Cloudflare token)
- `FREE_COHERE_API_KEY`
- `FREE_CEREBRAS_API_KEY`
- `FREE_ZAI_GLM_API_KEY`
- `FREE_SAMBANOVA_API_KEY`
- `FREE_MODELSCOPE_API_KEY`
- `FREE_SCALEWAY_API_KEY`
- `FREE_NVIDIA_NIM_API_KEY`
- `FREE_TYPHOON_API_KEY`

You can add them in Cloudflare Dashboard → Workers & Pages → MAOMAO Worker → Settings → Variables and Secrets, or with Wrangler:

```bash
npx wrangler secret put GATEWAY_API_KEY
npx wrangler secret put FREE_GROQ_API_KEY
npx wrangler secret put FREE_GOOGLE_GEMINI_API_KEY
npx wrangler secret put FREE_CLOUDFLARE_API_TOKEN
npx wrangler secret put FREE_CLOUDFLARE_ACCOUNT_ID
```

Repeat `wrangler secret put` for each provider you choose to enable. Do not commit real keys, put them in `wrangler.jsonc`, or send them in issue/PR comments. You do not have to enable every provider.

## Configure MAOMAO

In Settings → API:

1. Choose **MAOMAO 免费模型网关**.
2. Keep the auto-filled Base URL (the same MAOMAO origin plus `/v1`).
3. Enter the one `GATEWAY_API_KEY` value.
4. Click **拉取模型** and choose any model returned by the enabled providers.
5. Save and test the connection.

Model IDs are namespaced as `maomao-free:<provider-slug>:<upstream-model-id>`. The Worker removes the namespace before forwarding the request.

## Safety and limitations

- The gateway does not implement automatic cross-provider failover. A silent fallback could send private chat content to a provider with different data-use terms, or route into a paid/expired tier. Select the model/provider explicitly.
- Provider secrets remain on the Worker. MAOMAO's existing local API profile stores only the gateway key and URL; the provider keys are never placed in localStorage or backups.
- The Worker rejects model IDs not in its allow-list and returns only models for providers with configured secrets.
- It forwards OpenAI-compatible `/chat/completions` responses unchanged, including streaming response bodies. Other provider-specific APIs (audio, image, embeddings, rerank, and native non-OpenAI protocols) are not exposed by this initial chat gateway.
- A quota-exhausted response is passed back to MAOMAO; it does not retry against a different provider.
- If the frontend is hosted on a separate origin, add that exact origin to the Worker `MAOMAO_CORS_ORIGINS` setting. Do not use a wildcard origin for a private gateway.
