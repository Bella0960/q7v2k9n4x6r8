import { ApiError, ok, readJsonBody } from './http.js';
import { randomToken, sha256Hex } from './crypto.js';

const ID = /^MAO-[A-Z0-9]{12,24}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,96}$/;
const FRIEND_CODE = /^[a-f0-9]{64}$/;
const codeLifetime = 15 * 60 * 1000;
const pair = (a, b) => a < b ? [a, b] : [b, a];

function valid(value, pattern, code) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new ApiError(400, code, '参数格式不正确');
  }
  return value;
}

export function createMaoSocial({ store, accountAuth, env = {}, now = () => Date.now() }) {
  const rows = (sql, ...args) => store.exec(sql, ...args);
  const one = (sql, ...args) => rows(sql, ...args)[0] || null;
  const transaction = fn => store.transaction(fn);

  function assertSession(actor, time) {
    if (!one("SELECT s.id FROM mao_account_sessions s JOIN mao_accounts a ON a.id = s.account_id " +
      "WHERE s.id = ? AND s.account_id = ? AND s.revoked_at IS NULL AND s.expires_at > ? " +
      "AND a.status = 'active' AND (a.role = 'super_admin' OR a.authorized_at IS NOT NULL) LIMIT 1",
      actor.session_id, actor.account_id, time)) {
      throw new ApiError(401, 'SOCIAL_SESSION_EXPIRED', '登录状态已变化，请重新进入');
    }
  }
  function assertAdmin(actor, time) {
    if (actor.role !== 'super_admin' ||
        !store.isActiveMaoSuperAdminSession(actor.account_id, actor.session_id, time)) {
      throw new ApiError(403, 'SOCIAL_ADMIN_ONLY', '仅 001 管理员有审批权限');
    }
  }
  function eligible(id) {
    if (!one("SELECT id FROM mao_accounts WHERE id = ? AND status = 'active' " +
      "AND (role = 'super_admin' OR authorized_at IS NOT NULL)", id)) {
      throw new ApiError(403, 'SOCIAL_ACCOUNT_NOT_ACTIVE', '对方账号尚未授权或已停用');
    }
  }
  function notBlocked(a, b) {
    if (one("SELECT blocker_id FROM mao_social_blocks WHERE " +
      "(blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1",
      a, b, b, a)) throw new ApiError(403, 'SOCIAL_BLOCKED', '双方无法联系');
  }
  function friendship(a, b) {
    if (a === b) throw new ApiError(400, 'SOCIAL_SELF', '不能添加自己');
    eligible(a); eligible(b); notBlocked(a, b);
    const [low, high] = pair(a, b);
    const relation = one("SELECT source_request_id FROM mao_social_friends " +
      "WHERE pair_low = ? AND pair_high = ? AND status = 'accepted' LIMIT 1", low, high);
    if (!relation) {
      throw new ApiError(403, 'SOCIAL_NOT_APPROVED', '尚未通过 001 管理员好友审批');
    }
    return [low, high, relation.source_request_id];
  }

  async function actorOf(request) {
    const actor = await accountAuth.getAuthenticatedAccount(request);
    if (!actor) throw new ApiError(401, 'SOCIAL_LOGIN_REQUIRED', '请登录正式 MAO 账号');
    if (actor.status !== 'active' || (actor.role !== 'super_admin' && !actor.authorized_at)) {
      throw new ApiError(403, 'SOCIAL_INVITE_REQUIRED', '请先完成一人一码授权');
    }
    return actor;
  }
  const requestView = row => ({
    id: row.id, requesterId: row.requester_id, recipientId: row.recipient_id,
    status: row.status, note: row.note || '', createdAt: Number(row.created_at)
  });

  async function rotate(actor) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const code = Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
    const hash = await sha256Hex(code);
    return transaction(() => {
      const time = now();
      assertSession(actor, time);
      const recent = one("SELECT COUNT(*) AS n FROM mao_social_codes WHERE owner_id = ? AND created_at > ?",
        actor.account_id, time - 3600000);
      if (Number(recent.n) >= 10) throw new ApiError(429, 'SOCIAL_CODE_LIMIT', '生成次数过多');
      rows("UPDATE mao_social_codes SET revoked_at = ? WHERE owner_id = ? " +
        "AND revoked_at IS NULL AND used_at IS NULL", time, actor.account_id);
      rows("INSERT INTO mao_social_codes (code_hash,owner_id,created_at,expires_at) VALUES (?,?,?,?)",
        hash, actor.account_id, time, time + codeLifetime);
      return ok({ ownerAccountId: actor.account_id, code, expiresAt: time + codeLifetime });
    });
  }

  async function apply(request, actor) {
    const body = await readJsonBody(request, 2048);
    const code = valid(body.code, FRIEND_CODE, 'SOCIAL_INVALID_CODE');
    const requestId = valid(body.requestId, REQUEST_ID, 'SOCIAL_INVALID_REQUEST_ID');
    const note = String(body.note || '').trim();
    if (Array.from(note).length > 160) throw new ApiError(400, 'SOCIAL_NOTE_LIMIT', '申请备注过长');
    const hash = await sha256Hex(code);
    const time = now();
    return transaction(() => {
      assertSession(actor, time);
      const existingId = one("SELECT * FROM mao_social_requests WHERE id = ?", requestId);
      if (existingId) {
        if (existingId.requester_id !== actor.account_id ||
            existingId.submitted_code_hash !== hash || existingId.note !== note) {
          throw new ApiError(409, 'SOCIAL_ID_REUSED', '申请编号已绑定另一条申请，不得重复使用');
        }
        return ok({ request: requestView(existingId), replay: true });
      }
      const issued = one("SELECT owner_id FROM mao_social_codes WHERE code_hash = ? " +
        "AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?", hash, time);
      if (!issued) throw new ApiError(404, 'SOCIAL_CODE_EXPIRED', '好友码无效或已过期');
      if (issued.owner_id === actor.account_id) throw new ApiError(400, 'SOCIAL_SELF', '不能添加自己');
      eligible(actor.account_id); eligible(issued.owner_id); notBlocked(actor.account_id, issued.owner_id);
      const [low, high] = pair(actor.account_id, issued.owner_id);
      if (one("SELECT pair_low FROM mao_social_friends WHERE pair_low = ? AND pair_high = ? " +
        "AND status = 'accepted'", low, high)) {
        throw new ApiError(409, 'SOCIAL_ALREADY_FRIENDS', '双方已经是好友');
      }
      if (one("SELECT id FROM mao_social_requests WHERE pair_low = ? AND pair_high = ? " +
        "AND status IN ('pending_peer','pending_admin')", low, high)) {
        throw new ApiError(409, 'SOCIAL_PENDING', '已有待处理申请');
      }
      const pending = one("SELECT COUNT(*) AS n FROM mao_social_requests WHERE requester_id = ? " +
        "AND status IN ('pending_peer','pending_admin')", actor.account_id);
      if (Number(pending.n) >= 20) throw new ApiError(429, 'SOCIAL_PENDING_LIMIT', '待处理申请过多');
      const consumed = rows("UPDATE mao_social_codes SET used_at = ? WHERE code_hash = ? " +
        "AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? RETURNING code_hash",
        time, hash, time);
      if (consumed.length !== 1) throw new ApiError(409, 'SOCIAL_CODE_REUSED', '好友码已被使用');
      rows("INSERT INTO mao_social_requests " +
        "(id,requester_id,recipient_id,pair_low,pair_high,status,note,submitted_code_hash,created_at,updated_at) " +
        "VALUES (?,?,?,?,?,'pending_peer',?,?,?,?)",
        requestId, actor.account_id, issued.owner_id, low, high, note, hash, time, time);
      return ok({ request: { id: requestId, status: 'pending_peer',
        recipientId: issued.owner_id, adminApprovalRequired: true } });
    });
  }

  function listRequests(actor, direction) {
    if (!['incoming', 'outgoing'].includes(direction)) {
      throw new ApiError(400, 'SOCIAL_DIRECTION_INVALID', '申请列表方向无效');
    }
    const field = direction === 'incoming' ? 'recipient_id' : 'requester_id';
    return transaction(() => {
      assertSession(actor, now());
      const list = rows("SELECT * FROM mao_social_requests WHERE " + field +
        " = ? ORDER BY created_at DESC LIMIT 100", actor.account_id);
      return ok({ ownerAccountId: actor.account_id, direction, requests: list.map(requestView) });
    });
  }

  function respond(actor, id, action) {
    const time = now();
    return transaction(() => {
      assertSession(actor, time);
      const request = one("SELECT * FROM mao_social_requests WHERE id = ?", id);
      if (!request) throw new ApiError(404, 'SOCIAL_REQUEST_MISSING', '申请不存在');
      if (action === 'cancel' ? request.requester_id !== actor.account_id :
          request.recipient_id !== actor.account_id) {
        throw new ApiError(403, 'SOCIAL_NOT_OWNER', '无权处理该申请');
      }
      if (request.status !== 'pending_peer' &&
          !(action === 'cancel' && request.status === 'pending_admin')) {
        throw new ApiError(409, 'SOCIAL_ALREADY_HANDLED', '申请已处理');
      }
      if (action === 'accept') {
        eligible(request.requester_id); eligible(request.recipient_id);
        notBlocked(request.requester_id, request.recipient_id);
      }
      const status = action === 'accept' ? 'pending_admin' : action === 'decline' ? 'declined' : 'cancelled';
      const updated = rows("UPDATE mao_social_requests SET status = ?, updated_at = ?, responded_at = ? " +
        "WHERE id = ? AND status = ? RETURNING id",
        status, time, time, id, request.status);
      if (updated.length !== 1) throw new ApiError(409, 'SOCIAL_CONCURRENT_UPDATE', '状态发生变化');
      return ok({ request: { id, status, adminApprovalRequired: status === 'pending_admin' } });
    });
  }

  function queue(actor) {
    assertAdmin(actor, now());
    return ok({ approvals: rows("SELECT r.id,r.requester_id,r.recipient_id,r.note,r.responded_at, " +
      "a.username AS requester_name,b.username AS recipient_name FROM mao_social_requests r " +
      "JOIN mao_accounts a ON a.id = r.requester_id " +
      "JOIN mao_accounts b ON b.id = r.recipient_id " +
      "WHERE r.status = 'pending_admin' ORDER BY r.responded_at ASC LIMIT 100")
      .map(row => ({ id: row.id, requesterId: row.requester_id,
        recipientId: row.recipient_id, requesterName: row.requester_name,
        recipientName: row.recipient_name, note: row.note || '' })) });
  }

  function review(actor, id, action) {
    const time = now();
    return transaction(() => {
      assertAdmin(actor, time);
      const request = one("SELECT * FROM mao_social_requests " +
        "WHERE id = ? AND status = 'pending_admin'", id);
      if (!request) throw new ApiError(409, 'SOCIAL_NOT_AWAITING_ADMIN', '不在待审核列表');
      if (action === 'approve') {
        eligible(request.requester_id); eligible(request.recipient_id);
        notBlocked(request.requester_id, request.recipient_id);
        rows("INSERT INTO mao_social_friends (pair_low,pair_high,source_request_id,status,updated_at) " +
          "VALUES (?,?,?,'accepted',?) ON CONFLICT(pair_low,pair_high) DO UPDATE " +
          "SET source_request_id=excluded.source_request_id,status='accepted',updated_at=excluded.updated_at",
          request.pair_low, request.pair_high, id, time);
      }
      const status = action === 'approve' ? 'approved' : 'rejected';
      const changed = rows("UPDATE mao_social_requests SET status = ?,reviewed_at = ?," +
        "reviewed_by = ?,updated_at = ? WHERE id = ? AND status = 'pending_admin' RETURNING id",
        status, time, actor.account_id, time, id);
      if (changed.length !== 1) throw new ApiError(409, 'SOCIAL_ALREADY_HANDLED', '审核已处理');
      rows("INSERT INTO mao_account_audit " +
        "(id,actor_account_id,target_account_id,action,detail_json,created_at) VALUES (?,?,?,?,?,?)",
        'audit_' + randomToken(16), actor.account_id, request.requester_id,
        'social_friend_' + status,
        JSON.stringify({ requestId: id, recipientId: request.recipient_id }), time);
      return ok({ request: { id, status, reviewedBy: actor.account_id } });
    });
  }

  function listFriends(actor) {
    return transaction(() => {
      assertSession(actor, now());
      const list = rows("SELECT a.id,a.username FROM mao_social_friends f " +
      "JOIN mao_accounts a ON a.id = CASE WHEN f.pair_low = ? THEN f.pair_high ELSE f.pair_low END " +
      "WHERE (f.pair_low = ? OR f.pair_high = ?) AND f.status = 'accepted' " +
      "AND a.status = 'active' AND (a.role = 'super_admin' OR a.authorized_at IS NOT NULL) " +
      "AND NOT EXISTS (SELECT 1 FROM mao_social_blocks b WHERE " +
      "(b.blocker_id=f.pair_low AND b.blocked_id=f.pair_high) OR " +
      "(b.blocker_id=f.pair_high AND b.blocked_id=f.pair_low)) " +
      "ORDER BY a.username COLLATE NOCASE LIMIT 100",
      actor.account_id, actor.account_id, actor.account_id);
      return ok({ ownerAccountId: actor.account_id,
        friends: list.map(row => ({ id: row.id, displayName: row.username })) });
    });
  }

  function manageFriend(actor, peer, action) {
    const time = now();
    return transaction(() => {
      assertSession(actor, time);
      if (actor.account_id === peer) throw new ApiError(400, 'SOCIAL_SELF', '不能操作自己');
      const [low, high] = pair(actor.account_id, peer);
      if (action === 'remove') {
        const changed = rows("UPDATE mao_social_friends SET status='removed', updated_at=? " +
          "WHERE pair_low=? AND pair_high=? AND status='accepted' RETURNING pair_low",
          time, low, high);
        return ok({ removed: changed.length === 1 });
      }
      if (action === 'block') {
        rows("INSERT OR IGNORE INTO mao_social_blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)",
          actor.account_id, peer, time);
        rows("UPDATE mao_social_friends SET status='removed',updated_at=? " +
          "WHERE pair_low=? AND pair_high=? AND status='accepted'", time, low, high);
        rows("UPDATE mao_social_requests SET status='cancelled',updated_at=? " +
          "WHERE pair_low=? AND pair_high=? AND status IN ('pending_peer','pending_admin')", time, low, high);
      } else {
        rows("DELETE FROM mao_social_blocks WHERE blocker_id=? AND blocked_id=?", actor.account_id, peer);
      }
      return ok({ blocked: action === 'block' });
    });
  }

  async function chat(request, actor, peer, method) {
    if (method === 'GET') {
      const after = Number(new URL(request.url).searchParams.get('after') || 0);
      if (!Number.isSafeInteger(after) || after < 0) {
        throw new ApiError(400, 'SOCIAL_CURSOR_INVALID', '消息游标不合法');
      }
      return transaction(() => {
        const time = now();
        assertSession(actor, time);
        const [low, high, sourceRequestId] = friendship(actor.account_id, peer);
        const list = rows("SELECT seq,id,sender_id,recipient_id,body,created_at FROM mao_social_messages " +
          "WHERE pair_low=? AND pair_high=? AND source_request_id=? AND seq>? ORDER BY seq ASC LIMIT 50",
          low, high, sourceRequestId, after);
        return ok({ ownerAccountId: actor.account_id, peerId: peer, friendshipId: sourceRequestId,
          messages: list.map(m => ({ seq: Number(m.seq), id: m.id, senderId: m.sender_id,
            recipientId: m.recipient_id, text: m.body, createdAt: Number(m.created_at) })),
          nextCursor: list.length ? Number(list[list.length - 1].seq) : after });
      });
    }
    const body = await readJsonBody(request, 5000);
    const text = String(body.text || '').trim();
    const clientMessageId = valid(body.clientMessageId, REQUEST_ID, 'SOCIAL_MESSAGE_ID_INVALID');
    if (!text || Array.from(text).length > 2000) {
      throw new ApiError(400, 'SOCIAL_MESSAGE_INVALID', '消息内容长度不符合要求');
    }
    return transaction(() => {
      const time = now();
      assertSession(actor, time);
      const [low, high, sourceRequestId] = friendship(actor.account_id, peer);
      const old = one("SELECT * FROM mao_social_messages WHERE sender_id=? AND client_message_id=?",
        actor.account_id, clientMessageId);
      if (old) {
        if (old.recipient_id !== peer || old.body !== text ||
            old.source_request_id !== sourceRequestId) {
          throw new ApiError(409, 'SOCIAL_MESSAGE_ID_REUSED', '消息编号已经使用');
        }
        return ok({ friendshipId: sourceRequestId, message: { id: old.id, seq: Number(old.seq),
          senderId: actor.account_id, recipientId: peer, text, createdAt: Number(old.created_at) },
          replay: true });
      }
      // Per-account abuse boundary is checked in the same SQLite transaction as the insert.
      const recent = one("SELECT COUNT(*) AS n FROM mao_social_messages WHERE sender_id = ? AND created_at > ?",
        actor.account_id, time - 60000);
      if (Number(recent.n) >= 60) throw new ApiError(429, 'SOCIAL_MESSAGE_RATE_LIMIT', '发送过于频繁，请稍后再试');
      const id = 'msg_' + randomToken(18);
      const result = rows("INSERT INTO mao_social_messages " +
        "(id,pair_low,pair_high,source_request_id,sender_id,recipient_id,client_message_id,body,created_at) " +
        "VALUES (?,?,?,?,?,?,?,?,?) RETURNING seq",
        id, low, high, sourceRequestId, actor.account_id, peer, clientMessageId, text, time);
      return ok({ friendshipId: sourceRequestId, message: { id, seq: Number(result[0].seq),
        senderId: actor.account_id, recipientId: peer, text, createdAt: time } });
    });
  }

  return { handle: async (request, path, method) => {
    if (!path.startsWith('/api/social/') && !path.startsWith('/api/admin/social/')) return null;
    if (env.MAO_SOCIAL_ENABLED !== 'true') {
      throw new ApiError(503, 'SOCIAL_NOT_ENABLED', '真人好友服务尚未通过完整验收');
    }
    const actor = await actorOf(request);
    if (path === '/api/social/friend-codes' && method === 'POST') return rotate(actor);
    if (path === '/api/social/friend-requests' && method === 'POST') return apply(request, actor);
    if (path === '/api/social/friend-requests' && method === 'GET') {
      return listRequests(actor, new URL(request.url).searchParams.get('direction') || 'incoming');
    }
    const transition = /^\/api\/social\/friend-requests\/([A-Za-z0-9_-]{8,96})\/(accept|decline|cancel)$/.exec(path);
    if (transition && method === 'POST') return respond(actor, transition[1], transition[2]);
    if (path === '/api/admin/social/friend-approvals' && method === 'GET') return queue(actor);
    const approval = /^\/api\/admin\/social\/friend-approvals\/([A-Za-z0-9_-]{8,96})\/(approve|reject)$/.exec(path);
    if (approval && method === 'POST') return review(actor, approval[1], approval[2]);
    if (path === '/api/social/friends' && method === 'GET') return listFriends(actor);
    const remove = /^\/api\/social\/friends\/(MAO-[A-Z0-9]{12,24})$/.exec(path);
    if (remove && method === 'DELETE') return manageFriend(actor, remove[1], 'remove');
    const block = /^\/api\/social\/friends\/(MAO-[A-Z0-9]{12,24})\/block$/.exec(path);
    if (block && (method === 'POST' || method === 'DELETE')) {
      return manageFriend(actor, block[1], method === 'POST' ? 'block' : 'unblock');
    }
    const messages = /^\/api\/social\/chats\/(MAO-[A-Z0-9]{12,24})\/messages$/.exec(path);
    if (messages && (method === 'GET' || method === 'POST')) {
      // Isolated QA-only plaintext transport. Do not enable before key exchange,
      // end-to-end encryption and cross-device recovery have passed acceptance.
      if (env.MAO_SOCIAL_CHAT_ENABLED !== 'true') {
        throw new ApiError(503, 'SOCIAL_CHAT_NOT_ENABLED', '真人私聊尚未完成端到端加密验收');
      }
      return chat(request, actor, messages[1], method);
    }
    throw new ApiError(404, 'SOCIAL_ROUTE_NOT_FOUND', '真人好友接口不存在');
  } };
}
