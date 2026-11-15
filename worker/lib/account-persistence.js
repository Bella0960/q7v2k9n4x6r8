/**
 * Read-only account persistence checks for SQLite Durable Objects.
 * Never expose identifiers, recovery bookmarks, credentials or sessions.
 */
function count(store, sql) {
  const n=Number(store.exec(sql)?.[0]?.total);
  if(!Number.isSafeInteger(n)||n<0)throw Error('ACCOUNT_PERSISTENCE_INVALID_COUNT');
  return n;
}
export function inspectAccountPersistence(store) {
  const accountCount=count(store,'SELECT COUNT(*) AS total FROM mao_accounts');
  const superAdminCount=count(store,"SELECT COUNT(*) AS total FROM mao_accounts WHERE role = 'super_admin'");
  const missingAccountAudit=count(store,"SELECT COUNT(*) AS total FROM mao_accounts a WHERE NOT EXISTS (SELECT 1 FROM mao_account_audit e WHERE e.target_account_id = a.id AND e.action IN ('account_register','admin_bootstrap','identity_authority_import'))");
  const orphanSessions=count(store,"SELECT COUNT(*) AS total FROM mao_account_sessions s WHERE NOT EXISTS (SELECT 1 FROM mao_accounts a WHERE a.id = s.account_id)");
  return {
    accountCount,superAdminCount,missingAccountAudit,orphanSessions,
    metadataHealthy:superAdminCount<=1 && missingAccountAudit===0 && orphanSessions===0
  };
}
export async function inspectPitrReadiness(storage) {
  if(typeof storage?.getCurrentBookmark!=='function')
    return {available:false,reason:'api_unavailable'};
  try {
    const bookmark=await storage.getCurrentBookmark();
    if(typeof bookmark!=='string'||bookmark.length<8)
      return {available:false,reason:'invalid_bookmark'};
    // Do not return the bookmark itself: it is sensitive recovery metadata.
    return {available:true,reason:null};
  } catch {
    // Unsupported by local Miniflare/SQLite test runtimes.
    return {available:false,reason:'probe_failed'};
  }
}
