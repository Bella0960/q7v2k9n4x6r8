import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from './helpers/cloud-helpers.mjs';
import { MIGRATIONS, splitSql } from '../worker/lib/migrations.js';

test('0009 migration keeps the earliest pending request and rejects reverse duplicates', () => {
  const db = openTestDb();
  const { exec, query } = db;
  exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');

  // Build the exact pre-0009 schema to simulate an already-provisioned Worker.
  for (const migration of MIGRATIONS.slice(0, -1)) {
    for (const statement of splitSql(migration.sql)) exec(statement);
    exec(
      'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      migration.version,
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

  const migration = MIGRATIONS[MIGRATIONS.length - 1];
  assert.equal(migration.version, '0009_friend_request_pair_uniqueness');
  for (const statement of splitSql(migration.sql)) exec(statement);
  exec(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
    migration.version,
    2
  );

  const rows = query(
    'SELECT id, status FROM friend_requests ORDER BY id'
  );
  assert.deepEqual(rows, [
    { id: 'request-early', status: 'pending' },
    { id: 'request-reverse-late', status: 'rejected' }
  ]);

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
