import { isDeepStrictEqual } from 'node:util';
import { base64UrlToBytes, bytesToBase64Url, sha256Hex, utf8 } from '../../worker/lib/crypto.js';

export const FOUNDER_BACKUP_FORMAT = 'maomao-do-sql-kv-v1';
const objectIdPattern = /^[a-f0-9]{64}$/;
const namespaceIdPattern = /^[a-f0-9]{32}$/;
const sqlCasts = { integer: 'CAST(? AS INTEGER)', real: 'CAST(? AS REAL)', text: 'CAST(? AS TEXT)' };

function identifier(value) {
  return '"' + value.replaceAll('"', '""') + '"';
}

function rows(storage, sql, ...bindings) {
  return Array.from(storage.sql.exec(sql, ...bindings).raw());
}

function encodeKv(value) {
  // Existing MAOMAO KV records are JSON values. Reject unsupported structured
  // clone payloads instead of silently dropping or converting any of them.
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error('unsupported_kv_value');
  }
  if (encoded === undefined || !isDeepStrictEqual(value, JSON.parse(encoded))) {
    throw new Error('unsupported_kv_value');
  }
  return encoded;
}

function readTable(storage, name) {
  const columns = storage.sql.exec('SELECT * FROM ' + identifier(name) + ' LIMIT 0').columnNames;
  if (!columns.length) {
    throw new Error('unsupported_sql_columns');
  }
  const projection = columns.flatMap(column => {
    const name = identifier(column);
    const type = 'typeof(' + name + ')';
    return [type, 'CASE ' + type + " WHEN 'integer' THEN CAST(" + name +
      " AS TEXT) WHEN 'text' THEN hex(CAST(" + name + " AS BLOB)) WHEN 'blob' THEN hex(" +
      name + ') ELSE ' + name + ' END'];
  });
  const tableRows = rows(storage, 'SELECT ' + projection.join(', ') + ' FROM ' + identifier(name));
  // Row order has no semantic meaning here. Sort the encoded rows so a second
  // read of a restored database can be compared byte-for-byte.
  const encodedRows = tableRows.map(row => {
    if (row.some(value => typeof value === 'number' && !Number.isFinite(value))) {
      throw new Error('unsupported_sql_real');
    }
    return JSON.stringify(row);
  }).sort();
  return { name, columns, rows: encodedRows };
}

function readSnapshot(storage) {
  const schema = storage.sql.exec(
    "SELECT type, name, sql FROM sqlite_schema WHERE sql IS NOT NULL " +
    "AND substr(name, 1, 7) != 'sqlite_' " +
    "AND lower(substr(name, 1, 4)) != '_cf_' " +
    "AND lower(substr(name, 1, 5)) != '__cf_' ORDER BY type, name"
  ).toArray().map(({ type, name, sql }) => ({ type, name, sql }));
  if (schema.some(entry => !['table', 'index', 'view', 'trigger'].includes(entry.type) ||
      /^CREATE VIRTUAL TABLE/i.test(entry.sql))) {
    throw new Error('unsupported_sql_schema');
  }
  const tables = schema.filter(entry => entry.type === 'table')
    .map(entry => readTable(storage, entry.name));
  const sequence = rows(storage, "SELECT 1 FROM sqlite_schema WHERE name = 'sqlite_sequence'").length
    ? readTable(storage, 'sqlite_sequence') : null;
  const kv = Array.from(storage.kv.list(), ([key, value]) => [key, encodeKv(value)]);
  return { schema, tables, sequence, kv };
}

function assertIntegrity(storage) {
  const checks = rows(storage, 'PRAGMA quick_check');
  if (checks.length !== 1 || checks[0][0] !== 'ok' || rows(storage, 'PRAGMA foreign_key_check').length) {
    throw new Error('database_integrity_failed');
  }
}

async function importKey(key, usages) {
  const raw = base64UrlToBytes(key);
  if (raw?.length !== 32) throw new Error('backup_key_invalid');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usages);
}

function storageIdentity(state, namespaceId) {
  const objectId = state?.id?.toString();
  if (!objectIdPattern.test(objectId || '') || !namespaceIdPattern.test(namespaceId || '')) {
    throw new Error('backup_storage_identity_invalid');
  }
  return objectId;
}

// Caller must be a reviewed private operator in the source Durable Object.
// Return only a sealed artifact and its digest, never plaintext or credentials.
export async function sealFounderBackup({ state, sourceNamespaceId, key }) {
  const sourceObjectId = storageIdentity(state, sourceNamespaceId);
  const encryptionKey = await importKey(key, ['encrypt']);
  const { storage } = state;
  const snapshot = storage.transactionSync(() => {
    assertIntegrity(storage);
    return readSnapshot(storage);
  });
  if (!snapshot.tables.some(table => table.name === 'schema_migrations') ||
      !snapshot.tables.some(table => table.name === 'mao_accounts') ||
      !snapshot.tables.some(table => table.name === 'mao_account_sessions')) {
    throw new Error('account_schema_missing');
  }
  const header = { format: FOUNDER_BACKUP_FORMAT, sourceNamespaceId, sourceObjectId, createdAt: Date.now() };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(JSON.stringify(header)) },
    encryptionKey, utf8(JSON.stringify(snapshot))
  );
  const artifact = JSON.stringify({
    ...header, iv: bytesToBase64Url(iv), ciphertext: bytesToBase64Url(ciphertext)
  });
  return { artifact, ciphertextSha256: await sha256Hex(artifact), ...header };
}

function insertRows(storage, table) {
  const columns = table.columns.map(identifier).join(', ');
  for (const encodedRow of table.rows) {
    const row = JSON.parse(encodedRow);
    const placeholders = [];
    const values = [];
    for (let i = 0; i < row.length; i += 2) {
      const [type, value] = [row[i], row[i + 1]];
      placeholders.push(sqlCasts[type] || '?');
      values.push(type === 'blob' || type === 'text'
        ? Uint8Array.from(value.match(/../g) ?? [], pair => parseInt(pair, 16)).buffer : value);
    }
    storage.sql.exec('INSERT INTO ' + identifier(table.name) + ' (' + columns +
      ') VALUES (' + placeholders.join(', ') + ')', ...values);
  }
}

// No production route calls this helper. The independently provisioned
// disposable target must match the object's runtime identity and be empty.
export async function restoreFounderBackup({
  state, targetNamespaceId, disposableObjectId, expectedSourceNamespaceId,
  expectedSourceObjectId, artifact, ciphertextSha256, key
}) {
  const targetObjectId = storageIdentity(state, targetNamespaceId);
  if (targetObjectId !== disposableObjectId || targetObjectId === expectedSourceObjectId ||
      targetNamespaceId === expectedSourceNamespaceId) throw new Error('restore_target_not_isolated');
  if (await sha256Hex(artifact) !== ciphertextSha256) throw new Error('backup_digest_mismatch');
  const { format, sourceNamespaceId, sourceObjectId, createdAt, iv, ciphertext } = JSON.parse(artifact);
  const header = { format, sourceNamespaceId, sourceObjectId, createdAt };
  if (format !== FOUNDER_BACKUP_FORMAT || sourceNamespaceId !== expectedSourceNamespaceId ||
      sourceObjectId !== expectedSourceObjectId || !Number.isSafeInteger(createdAt) ||
      createdAt <= 0 || createdAt > Date.now()) throw new Error('backup_source_mismatch');
  const encryptionKey = await importKey(key, ['decrypt']);
  let cleartext;
  try {
    cleartext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlToBytes(iv), additionalData: utf8(JSON.stringify(header)) },
      encryptionKey, base64UrlToBytes(ciphertext)
    );
  } catch {
    throw new Error('backup_authentication_failed');
  }
  const snapshot = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(cleartext));
  const { storage } = state;
  storage.transactionSync(() => {
    const existing = readSnapshot(storage);
    if (existing.schema.length || existing.kv.length || existing.sequence) {
      throw new Error('restore_target_not_empty');
    }
    storage.sql.exec('PRAGMA defer_foreign_keys = ON');
    for (const entry of snapshot.schema.filter(entry => entry.type === 'table')) {
      storage.sql.exec(entry.sql);
    }
    for (const table of snapshot.tables) insertRows(storage, table);
    if (snapshot.sequence) {
      storage.sql.exec('DELETE FROM sqlite_sequence');
      insertRows(storage, snapshot.sequence);
    }
    for (const entry of snapshot.schema.filter(entry => entry.type !== 'table')) {
      storage.sql.exec(entry.sql);
    }
    for (const [kvKey, encoded] of snapshot.kv) storage.kv.put(kvKey, JSON.parse(encoded));
    assertIntegrity(storage);
    if (JSON.stringify(readSnapshot(storage)) !== JSON.stringify(snapshot)) {
      throw new Error('restore_roundtrip_mismatch');
    }
  });
  await storage.sync();
  return { ok: true, code: 'isolated_restore_verified', ciphertextSha256,
    targetNamespaceId, targetObjectId, verifiedAt: Date.now() };
}
