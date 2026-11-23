/**
 * ADMIN-CLOUD-001 — read-only SQL gate.
 *
 * Every query issued by this module passes through here. Anything that is not
 * a single SELECT/WITH statement is refused before it reaches SQLite, so a
 * future edit cannot silently turn a diagnostics endpoint into a writer.
 */

const WRITE_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|PRAGMA|ATTACH|DETACH|VACUUM|REINDEX|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|TRUNCATE)\b/i;

export class ReadOnlyViolation extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'ReadOnlyViolation';
  }
}

function stripStringLiterals(sql) {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

export function assertReadOnlySql(sql) {
  const text = String(sql || '').trim();
  if (!/^(SELECT|WITH)\b/i.test(text)) {
    throw new ReadOnlyViolation('only SELECT/WITH statements are allowed');
  }
  const code = stripStringLiterals(text).replace(/;\s*$/, '');
  if (code.includes(';')) {
    throw new ReadOnlyViolation('multiple statements are not allowed');
  }
  if (WRITE_KEYWORDS.test(code)) {
    throw new ReadOnlyViolation('write or schema keyword in query');
  }
  return text;
}

/** Wrap a synchronous exec(sql, ...params) so it can only read. */
export function createReadOnlyDb(exec) {
  if (typeof exec !== 'function') throw new TypeError('createReadOnlyDb requires an exec function');
  return function query(sql, ...params) {
    return exec(assertReadOnlySql(sql), ...params);
  };
}
