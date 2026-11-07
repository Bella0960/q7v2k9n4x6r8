import { handleRealUserAuth, isRealUserAuthConfigured } from "./worker/real-user-auth.js";
import { handleRealUserFriends, isRealUserFriendsConfigured } from "./worker/real-user-friends.js";

const REAL_USER_CHAT_PREFIX = "/api/real-user-chat";
const REAL_USER_CHAT_CAPABILITIES_PATH = REAL_USER_CHAT_PREFIX + "/capabilities";
const REAL_USER_AUTH_PREFIX = REAL_USER_CHAT_PREFIX + "/v1/auth";
const REAL_USER_FRIENDS_PREFIX = REAL_USER_CHAT_PREFIX + "/v1/friends";

function jsonResponse(payload, status, extraHeaders) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  });
  Object.entries(extraHeaders || {}).forEach(([key, value]) => headers.set(key, value));
  return new Response(JSON.stringify(payload), { status, headers });
}

async function realUserChatCapabilities(env) {
  const accountAuthEnabled = await isRealUserAuthConfigured(env);
  const friendsEnabled = await isRealUserFriendsConfigured(env);
  return {
    ok: true,
    service: "maomao-real-user-chat",
    protocolVersion: 1,
    enabled: false,
    status: "disabled",
    reason: "real_user_message_delivery_not_configured",
    accountAuth: {
      enabled: accountAuthEnabled,
      status: accountAuthEnabled ? "enabled" : "disabled",
      endpoints: accountAuthEnabled
        ? ["register", "login", "me", "logout"]
        : [],
      reason: accountAuthEnabled ? "" : "database_or_auth_rate_limiter_not_configured"
    },
    friends: {
      enabled: friendsEnabled,
      status: friendsEnabled ? "enabled" : "disabled",
      endpoints: friendsEnabled
        ? ["friend-code-rotate", "friend-code-revoke", "request-send", "request-inbox", "request-accept", "request-decline", "request-cancel", "friends-list", "friend-remove", "friend-block", "friend-unblock"]
        : [],
      reason: friendsEnabled ? "" : "database_or_friend_service_not_configured"
    },
    networkingEnabled: false,
    policyAllowlist: ["text", "image", "file", "voice", "sticker"],
    explicitlyDenied: [
      "redpacket",
      "transfer",
      "payment",
      "collection",
      "wallet",
      "transaction_history",
      "trade_record",
      "top_up",
      "withdraw",
      "gift",
      "family_card",
      "intimate_pay"
    ],
    delivery: {
      enabled: false,
      serverAcknowledgements: false,
      states: []
    },
    voiceCall: {
      enabled: false,
      reason: "separate_real_time_communication_service_not_configured"
    },
    videoCall: {
      enabled: false
    },
    requirements: [
      "authenticated_account_identity",
      "server_authoritative_friend_relationship",
      "durable_message_persistence",
      "recipient_delivery_and_read_receipts"
    ]
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === REAL_USER_CHAT_CAPABILITIES_PATH) {
      if (request.method !== "GET") {
        return jsonResponse({
          ok: false,
          enabled: false,
          error: "method_not_allowed"
        }, 405, { Allow: "GET" });
      }
      return jsonResponse(await realUserChatCapabilities(env), 200);
    }

    if (url.pathname.startsWith(REAL_USER_AUTH_PREFIX + "/")) {
      return handleRealUserAuth(request, env);
    }

    if (url.pathname === REAL_USER_FRIENDS_PREFIX ||
        url.pathname.startsWith(REAL_USER_FRIENDS_PREFIX + "/")) {
      return handleRealUserFriends(request, env);
    }

    // Keep the rest of the real-user chat namespace fail-closed until
    // authoritative friendships and durable message handling are configured.
    if (url.pathname === REAL_USER_CHAT_PREFIX ||
        url.pathname.startsWith(REAL_USER_CHAT_PREFIX + "/")) {
      return jsonResponse({
        ok: false,
        enabled: false,
        error: "real_user_chat_service_unavailable",
        reason: "server_authentication_and_persistence_not_configured",
        retryable: false
      }, 503);
    }

    if (url.pathname === "/" && request.method === "GET") {
      const indexUrl = new URL("/index.html", url);
      return env.ASSETS.fetch(new Request(indexUrl, request));
    }
    return env.ASSETS.fetch(request);
  }
};
