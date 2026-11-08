import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from './helpers/cloud-helpers.mjs';
import { MIGRATIONS, splitSql } from '../worker/lib/migrations.js';

test('0009 migration keeps the earliest pending request and rejects reverse duplicates', () => {
  const db = openTestDb();
  const { exec, query } = db;
  exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');

  // Build the exact pre-0009 schema to simulate an already-provisioned Worker.
  const targetVersion = '0009_friend_request_pair_uniqueness';
  const migration = MIGRATIONS.find(item => item.version === targetVersion);
  assert.ok(migration, '0009 migration is registered');
  for (const previous of MIGRATIONS) {
    if (previous.version === targetVersion) break;
    for (const statement of splitSql(previous.sql)) exec(statement);
    exec(
      'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      previous.version,
      1
    );
  }

  exec(
    `INSERT INTO friend_requests
      (id, requester_id, recipient_id, message, status, created_at, updated_at)
     VALUES (?, ?, ?, '', 'pending', ?, ?)`,
    'request-early',
    'u_alpha',
    'u_bravo',
    100,
    100
  );
  exec(
    `INSERT INTO friend_requests
      (id, requester_id, recipient_id, message, status, created_at, updated_at)
     VALUES (?, ?, ?, '', 'pending', ?, ?)`,
    'request-reverse-late',
    'u_bravo',
    'u_alpha',
    101,
    101
  );

  for (const statement of splitSql(migration.sql)) exec(statement);
  exec(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
    migration.version,
    2
  );

  const rows = query(
    'SELECT id, status FROM friend_requests ORDER BY id'
  );
  assert.deepEqual(
    rows.map(row => [row.id, row.status]),
    [
      ['request-early', 'pending'],
      ['request-reverse-late', 'rejected']
    ]
  );

  assert.throws(() => exec(
    `INSERT INTO friend_requests
      (id, requester_id, recipient_id, message, status, created_at, updated_at)
     VALUES (?, ?, ?, '', 'pending', ?, ?)`,
    'request-reverse-third',
    'u_bravo',
    'u_alpha',
    102,
    102
  ), /UNIQUE constraint failed/);
});


test('0010 migration backfills existing friendship and message generations', () => {
  const db = openTestDb();
  const { exec, query } = db;
  exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const generationVersion = '0010_friendship_generation_isolation';
  const migration = MIGRATIONS.find(item => item.version === generationVersion);
  assert.ok(migration, '0010 migration is registered');

  for (const previous of MIGRATIONS) {
    if (previous.version === generationVersion) break;
    for (const statement of splitSql(previous.sql)) exec(statement);
    exec('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', previous.version, 1);
  }

  // Simulate an older friendship cycle followed by a re-add before 0010.
  exec(
    'INSERT INTO friendships (user_low_id, user_high_id, created_at) VALUES (?, ?, ?)',
    'u_alpha', 'u_bravo', 50
  );
  exec(
    `INSERT INTO friend_messages
      (id, sender_id, recipient_id, client_message_id, body, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
    'pre-readd-message', 'u_alpha', 'u_bravo', 'pre-readd-client-id', '上一轮关系里的消息', 100
  );
  exec('DELETE FROM friendships WHERE user_low_id = ? AND user_high_id = ?', 'u_alpha', 'u_bravo');
  exec(
    'INSERT INTO friendships (user_low_id, user_high_id, created_at) VALUES (?, ?, ?)',
    'u_alpha', 'u_bravo', 200
  );
  exec(
    `INSERT INTO friend_messages
      (id, sender_id, recipient_id, client_message_id, body, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
    'legacy-message', 'u_alpha', 'u_bravo', 'legacy-client-id', '当前关系里的消息', 201
  );

  // Simulate old per-user state whose relationship was already deleted before
  // generation-aware cleanup shipped. These rows must not affect a later re-add.
  exec(
    `INSERT INTO friend_conversation_reads
      (user_id, friend_id, last_read_created_at, last_read_message_id, updated_at)
      VALUES (?, ?, ?, ?, ?)`,
    'u_alpha', 'u_bravo', 100, 'legacy-message', 100
  );
  exec(
    `INSERT INTO friend_message_hides (user_id, friend_id, message_id, hidden_at)
      VALUES (?, ?, ?, ?)`,
    'u_alpha', 'u_bravo', 'legacy-message', 100
  );
  exec(
    `INSERT INTO friend_conversation_reads
      (user_id, friend_id, last_read_created_at, last_read_message_id, updated_at)
      VALUES (?, ?, ?, ?, ?)`,
    'u_ghost', 'u_removed', 500, 'old-read-message', 500
  );
  exec(
    `INSERT INTO friend_conversation_clears
      (user_id, friend_id, clear_before_created_at, clear_before_message_id, updated_at)
      VALUES (?, ?, ?, ?, ?)`,
    'u_ghost', 'u_removed', 500, 'old-clear-message', 500
  );
  exec(
    `INSERT INTO friend_message_hides (user_id, friend_id, message_id, hidden_at)
      VALUES (?, ?, ?, ?)`,
    'u_ghost', 'u_removed', 'old-hidden-message', 500
  );

  for (const statement of splitSql(migration.sql)) exec(statement);
  const friendship = query(
    'SELECT generation_id FROM friendships WHERE user_low_id = ? AND user_high_id = ?',
    'u_alpha', 'u_bravo'
  )[0];
  const message = query('SELECT generation_id FROM friend_messages WHERE id = ?', 'legacy-message')[0];
  const preReaddMessage = query('SELECT generation_id FROM friend_messages WHERE id = ?', 'pre-readd-message')[0];
  assert.ok(friendship.generation_id);
  assert.equal(message.generation_id, friendship.generation_id);
  assert.equal(preReaddMessage.generation_id, '', '当前关系建立之前的消息不得回填到新代际');

  exec('DELETE FROM friendships WHERE user_low_id = ? AND user_high_id = ?', 'u_alpha', 'u_bravo');
  exec(
    'INSERT INTO friendships (user_low_id, user_high_id, created_at, generation_id) VALUES (?, ?, ?, ?)',
    'u_alpha', 'u_bravo', 200, 'new-friendship-generation'
  );
  const visible = query(
    'SELECT id FROM friend_messages WHERE generation_id = ?',
    'new-friendship-generation'
  );
  assert.deepEqual(visible, []);
  assert.notEqual(message.generation_id, 'new-friendship-generation');

  assert.equal(query('SELECT COUNT(*) AS total FROM friend_conversation_reads WHERE user_id = ?', 'u_ghost')[0].total, 0);
  assert.equal(query('SELECT COUNT(*) AS total FROM friend_conversation_clears WHERE user_id = ?', 'u_ghost')[0].total, 0);
  assert.equal(query('SELECT COUNT(*) AS total FROM friend_message_hides WHERE user_id = ?', 'u_ghost')[0].total, 0);
  assert.equal(query('SELECT COUNT(*) AS total FROM friend_conversation_reads WHERE user_id = ?', 'u_alpha')[0].total, 1);
  assert.equal(query('SELECT COUNT(*) AS total FROM friend_message_hides WHERE user_id = ?', 'u_alpha')[0].total, 1);
});
