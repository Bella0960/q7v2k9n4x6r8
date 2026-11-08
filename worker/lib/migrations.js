import { SQL as INIT_SQL, VERSION as INIT_VERSION } from '../migrations/0001_init.js';
import { SQL as AUTONOMY_SQL, VERSION as AUTONOMY_VERSION } from '../migrations/0002_autonomy_metadata.js';
import { SQL as DEVICE_PAIRING_SQL, VERSION as DEVICE_PAIRING_VERSION } from '../migrations/0003_device_pairing.js';
import { SQL as CONTEXT_VERSION_SQL, VERSION as CONTEXT_VERSION_VERSION } from '../migrations/0004_character_context_version.js';
import { SQL as FRIEND_ACCOUNTS_SQL, VERSION as FRIEND_ACCOUNTS_VERSION } from '../migrations/0005_friend_accounts.js';
import { SQL as FRIEND_MESSAGES_SQL, VERSION as FRIEND_MESSAGES_VERSION } from '../migrations/0006_friend_messages.js';
import { SQL as FRIEND_READS_SQL, VERSION as FRIEND_READS_VERSION } from '../migrations/0007_friend_conversation_reads.js';
import { SQL as FRIEND_VISIBILITY_SQL, VERSION as FRIEND_VISIBILITY_VERSION } from '../migrations/0008_friend_message_visibility.js';
import { SQL as FRIEND_REQUEST_PAIR_SQL, VERSION as FRIEND_REQUEST_PAIR_VERSION } from '../migrations/0009_friend_request_pair_uniqueness.js';

/**
 * 版本化迁移。exec(sql, ...params) 与存储层（Durable Object SQLite）保持同一签名，
 * 测试里注入 node:sqlite 适配器即可跑真实 SQL。
 */
export const MIGRATIONS = [
  { version: INIT_VERSION, sql: INIT_SQL },
  { version: AUTONOMY_VERSION, sql: AUTONOMY_SQL },
  { version: DEVICE_PAIRING_VERSION, sql: DEVICE_PAIRING_SQL },
  { version: CONTEXT_VERSION_VERSION, sql: CONTEXT_VERSION_SQL },
  { version: FRIEND_ACCOUNTS_VERSION, sql: FRIEND_ACCOUNTS_SQL },
  { version: FRIEND_MESSAGES_VERSION, sql: FRIEND_MESSAGES_SQL },
  { version: FRIEND_READS_VERSION, sql: FRIEND_READS_SQL },
  { version: FRIEND_VISIBILITY_VERSION, sql: FRIEND_VISIBILITY_SQL },
  { version: FRIEND_REQUEST_PAIR_VERSION, sql: FRIEND_REQUEST_PAIR_SQL }
];

/** 以单引号感知的方式拆分多条语句，避免把字符串里的分号切坏。 */
export function splitSql(sql) {
  const statements = [];
  let buffer = '';
  let inString = false;
  for (const char of String(sql || '')) {
    if (char === "'") inString = !inString;
    if (char === ';' && !inString) {
      const statement = buffer.trim();
      if (statement) statements.push(statement);
      buffer = '';
      continue;
    }
    buffer += char;
  }
  const tail = buffer.trim();
  if (tail) statements.push(tail);
  return statements;
}

export function applyMigrations(exec, now = Date.now()) {
  exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const rows = exec('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map(row => String(row.version)));
  const results = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    for (const statement of splitSql(migration.sql)) exec(statement);
    exec('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', migration.version, now);
    results.push(migration.version);
  }
  return results;
}
