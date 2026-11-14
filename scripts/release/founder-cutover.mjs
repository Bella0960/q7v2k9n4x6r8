import { consumeFounderCheckpointProof } from './founder-checkpoint.mjs';

// Operator-only helper. Invoke inside the target Durable Object's SQLite
// transactionSync boundary, after taking a verified recovery checkpoint.
export function cutoverFounder({ exec, transaction, expectedCurrentId, chosen, now, storage, checkpointProof }) {
  if (typeof exec !== 'function' || typeof transaction !== 'function' ||
      !/^MAO-[A-Z0-9]{12,24}$/.test(expectedCurrentId || '') ||
      !/^MAO-[A-Z0-9]{12,24}$/.test(chosen?.id || '') ||
      chosen.id === expectedCurrentId || !chosen.username || !chosen.usernameKey ||
      !/^[a-f0-9]{64}$/.test(chosen.passwordHash || '') ||
      !/^[A-Za-z0-9_-]{22,128}$/.test(chosen.passwordSalt || '') ||
      !Number.isSafeInteger(now) || now <= 0) {
    throw new Error('Invalid founder cutover input');
  }

  // Fail closed before any identity write unless this exact DO storage has a
  // recent checkpoint. The proof is single-use, including after a failed SQL
  // transaction; an operator must re-read the stored checkpoint to retry.
  consumeFounderCheckpointProof({ storage, proof: checkpointProof, now });

  return transaction(() => {
    const founders = exec("SELECT id, status FROM mao_accounts WHERE role = 'super_admin'");
    if (founders.length !== 1 || founders[0].status !== 'active') {
      throw new Error('Expected one active founder before cutover');
    }
    if (founders[0].id === chosen.id) return { changed: false };
    if (founders[0].id !== expectedCurrentId) throw new Error('Current founder does not match');
    if (exec('SELECT id FROM mao_accounts WHERE id = ?', chosen.id).length) {
      throw new Error('Chosen founder ID already exists under a different role');
    }
    const usernameConflict = exec('SELECT id FROM mao_accounts WHERE username_key = ?', chosen.usernameKey)[0];
    if (usernameConflict && usernameConflict.id !== expectedCurrentId) {
      throw new Error('Chosen founder username belongs to another account');
    }

    // Retain the old row and its permanent ID for existing foreign keys.
    // The reserved username key is outside the login username alphabet.
    const retired = exec(
      "UPDATE mao_accounts SET username_key = ?, role = 'user', status = 'disabled', disabled_at = ?, updated_at = ?, disabled_from_status = 'active' WHERE id = ? AND role = 'super_admin' AND status = 'active' RETURNING id",
      'retired:' + expectedCurrentId, now, now, expectedCurrentId
    );
    if (retired.length !== 1) throw new Error('Founder changed during cutover');
    exec('UPDATE mao_account_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL',
      now, expectedCurrentId);
    exec('UPDATE devices SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
      now, expectedCurrentId);
    exec('UPDATE mao_invite_codes SET revoked_at = ? WHERE created_by_account_id = ? AND revoked_at IS NULL AND used_count < max_uses',
      now, expectedCurrentId);
    exec(
      "INSERT INTO mao_accounts (id, username, username_key, password_salt, password_hash, role, status, created_at, updated_at, authorized_at) VALUES (?, ?, ?, ?, ?, 'super_admin', 'active', ?, ?, ?)",
      chosen.id, chosen.username, chosen.usernameKey, chosen.passwordSalt, chosen.passwordHash, now, now, now
    );
    exec(
      "INSERT INTO mao_account_audit (id, actor_account_id, target_account_id, action, detail_json, created_at) VALUES (?, ?, ?, 'founder_cutover', ?, ?)",
      'audit_' + crypto.randomUUID(), chosen.id, expectedCurrentId, '{}', now
    );
    return { changed: true };
  });
}
