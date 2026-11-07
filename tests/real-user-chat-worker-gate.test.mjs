import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../worker.js", import.meta.url), "utf8");
const { default: worker } = await import(
  "data:text/javascript;base64," + Buffer.from(source, "utf8").toString("base64")
);

function createEnv() {
  const forwarded = [];
  return {
    forwarded,
    ASSETS: {
      async fetch(request) {
        forwarded.push({
          method: request.method,
          url: request.url,
          pathname: new URL(request.url).pathname
        });
        return new Response("static asset", {
          status: 200,
          headers: { "Content-Type": "text/plain" }
        });
      }
    }
  };
}

test("capability endpoint reports the real-user service as explicitly disabled", async () => {
  const env = createEnv();
  const response = await worker.fetch(
    new Request("https://maomao.example/api/real-user-chat/capabilities"),
    env
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.enabled, false);
  assert.equal(body.networkingEnabled, false);
  assert.equal(body.status, "disabled");
  assert.equal(body.reason, "server_authentication_and_persistence_not_configured");
  assert.deepEqual(body.policyAllowlist, ["text", "image", "file", "voice", "sticker"]);
  for (const denied of [
    "redpacket", "transfer", "payment", "collection", "wallet",
    "transaction_history", "trade_record", "gift"
  ]) {
    assert.ok(body.explicitlyDenied.includes(denied), denied);
  }
  assert.equal(body.delivery.enabled, false);
  assert.deepEqual(body.delivery.states, []);
  assert.equal(body.voiceCall.enabled, false);
  assert.equal(body.videoCall.enabled, false);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(env.forwarded.length, 0, "capability route must not fall through to static assets");
});

test("capability endpoint is read-only", async () => {
  const env = createEnv();
  const response = await worker.fetch(
    new Request("https://maomao.example/api/real-user-chat/capabilities", {
      method: "POST",
      body: JSON.stringify({ enabled: true })
    }),
    env
  );
  const body = await response.json();

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  assert.equal(body.enabled, false);
  assert.equal(body.error, "method_not_allowed");
  assert.equal(env.forwarded.length, 0);
});

test("message and conversation endpoints fail closed without accepting a send", async () => {
  const env = createEnv();
  const routes = [
    new Request("https://maomao.example/api/real-user-chat/messages", {
      method: "POST",
      body: JSON.stringify({
        clientMessageId: "m-1",
        type: "text",
        text: "hello"
      })
    }),
    new Request("https://maomao.example/api/real-user-chat/conversations/user-1/messages"),
    new Request("https://maomao.example/api/real-user-chat/conversations/user-1/read", {
      method: "POST",
      body: JSON.stringify({ readThrough: "m-1" })
    })
  ];

  for (const request of routes) {
    const response = await worker.fetch(request, env);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.equal(body.enabled, false);
    assert.equal(body.error, "real_user_chat_service_unavailable");
    assert.equal(body.retryable, false);
    assert.equal(body.reason, "server_authentication_and_persistence_not_configured");
  }
  assert.equal(env.forwarded.length, 0, "reserved API routes must never become static-file fallbacks");
});

test("near-match paths do not capture unrelated static application routes", async () => {
  const env = createEnv();
  const response = await worker.fetch(
    new Request("https://maomao.example/api/real-user-chatty/example"),
    env
  );

  assert.equal(response.status, 200);
  assert.equal(env.forwarded.length, 1);
  assert.equal(env.forwarded[0].pathname, "/api/real-user-chatty/example");
});

test("existing root and regular static asset forwarding remain unchanged", async () => {
  const env = createEnv();

  const rootResponse = await worker.fetch(
    new Request("https://maomao.example/"),
    env
  );
  const appResponse = await worker.fetch(
    new Request("https://maomao.example/chat/chat.html"),
    env
  );

  assert.equal(rootResponse.status, 200);
  assert.equal(appResponse.status, 200);
  assert.deepEqual(
    env.forwarded.map((item) => item.pathname),
    ["/index.html", "/chat/chat.html"]
  );
});
