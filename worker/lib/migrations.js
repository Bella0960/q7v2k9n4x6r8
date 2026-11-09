import { SQL as INIT_SQL, VERSION as INIT_VERSION } from '../migrations/0001_init.js';
import { SQL as AUTONOMY_SQL, VERSION as AUTONOMY_VERSION } from '../migrations/0002_autonomy_metadata.js';
import { SQL as DEVICE_PAIRING_SQL, VERSION as DEVICE_PAIRING_VERSION } from '../migrations/0003_device_pairing.js';
import { SQL as CONTEXT_VERSION_SQL, VERSION as CONTEXT_VERSION_VERSION } from '../migrations/0004_character_context_version.js';
import { SQL as PUSH_DELIVERY_RETRIES_SQL, VERSION as PUSH_DELIVERY_RETRIES_VERSION } from '../migrations/0005_push_delivery_retries.js';
import { SQL as ACTIVITY_DEDUPE_SQL, VERSION as ACTIVITY_DEDUPE_VERSION } from '../migrations/0007_activity_dedupe.js';
import { SQL as CONTEXT_SOURCE_DEVICE_SQL, VERSION as CONTEXT_SOURCE_DEVICE_VERSION } from '../migrations/0008_context_source_device.js';
import { SQL as ACTIVITY_RESULT_STAGING_SQL, VERSION as ACTIVITY_RESULT_STAGING_VERSION } from '../migrations/0009_activity_result_staging.js';
import { SQL as OUTBOUND_LIFECYCLE_SQL, VERSION as OUTBOUND_LIFECYCLE_VERSION } from '../migrations/0010_outbound_lifecycle_receipts.js';
import { SQL as OUTBOUND_DEVICE_RECEIPTS_SQL, VERSION as OUTBOUND_DEVICE_RECEIPTS_VERSION } from '../migrations/0011_outbound_device_receipts.js';
import { SQL as MAO_ACCOUNTS_SQL, VERSION as MAO_ACCOUNTS_VERSION } from '../migrations/0012_mao_accounts.js';
import { SQL as MAO_ACCOUNT_RESTORE_STATE_SQL, VERSION as MAO_ACCOUNT_RESTORE_STATE_VERSION } from '../migrations/0013_mao_account_restore_state.js';
import { SQL as MAO_ADMIN_DIRECTORY_INDEXES_SQL, VERSION as MAO_ADMIN_DIRECTORY_INDEXES_VERSION } from '../migrations/0014_mao_admin_directory_indexes.js';
import { SQL as OUTBOUND_INBOX_SQL, VERSION as OUTBOUND_INBOX_VERSION } from '../migrations/0006_outbound_inbox_index.js';

/**
 * 版本化迁移。exec(sql, ...params) 与存储层（Durable Object SQLite）保持同一签名，
 * 测试里注入 node:sqlite 适配器即可跑真实 SQL。
 */
export const MIGRATIONS = [
  { version: INIT_VERSION, sql: INIT_SQL },
  { version: AUTONOMY_VERSION, sql: AUTONOMY_SQL },
  { version: DEVICE_PAIRING_VERSION, sql: DEVICE_PAIRING_SQL },
  { version: CONTEXT_VERSION_VERSION, sql: CONTEXT_VERSION_SQL },
  { version: PUSH_DELIVERY_RETRIES_VERSION, sql: PUSH_DELIVERY_RETRIES_SQL },
  { version: OUTBOUND_INBOX_VERSION, sql: OUTBOUND_INBOX_SQL },
  { version: ACTIVITY_DEDUPE_VERSION, sql: ACTIVITY_DEDUPE_SQL },
  { version: CONTEXT_SOURCE_DEVICE_VERSION, sql: CONTEXT_SOURCE_DEVICE_SQL },
  { version: ACTIVITY_RESULT_STAGING_VERSION, sql: ACTIVITY_RESULT_STAGING_SQL },
  { version: OUTBOUND_LIFECYCLE_VERSION, sql: OUTBOUND_LIFECYCLE_SQL },
  { version: OUTBOUND_DEVICE_RECEIPTS_VERSION, sql: OUTBOUND_DEVICE_RECEIPTS_SQL },
  { version: MAO_ACCOUNTS_VERSION, sql: MAO_ACCOUNTS_SQL },
  { version: MAO_ACCOUNT_RESTORE_STATE_VERSION, sql: MAO_ACCOUNT_RESTORE_STATE_SQL },
  { version: MAO_ADMIN_DIRECTORY_INDEXES_VERSION, sql: MAO_ADMIN_DIRECTORY_INDEXES_SQL }
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

export function applyMigrations(exec, now = Date.now(), transaction = null) {
  exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const rows = exec('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map(row => String(row.version)));
  const results = [];
  const runTransaction = typeof transaction === 'function'
    ? transaction
    : callback => {
        exec('BEGIN IMMEDIATE');
        try {
          const result = callback();
          exec('COMMIT');
          return result;
        } catch (error) {
          try { exec('ROLLBACK'); } catch (rollbackError) {}
          throw error;
        }
      };

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    // Use Durable Object transactionSync in production; the local SQLite test
    // adapter uses explicit BEGIN/COMMIT. The DDL and version marker commit as one.
    runTransaction(() => {
      for (const statement of splitSql(migration.sql)) exec(statement);
      exec('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', migration.version, now);
    });
    results.push(migration.version);
  }
  return results;
}
