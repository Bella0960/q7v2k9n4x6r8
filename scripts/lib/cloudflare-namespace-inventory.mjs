/**
 * Read-only, fail-closed Cloudflare Durable Object namespace inventory.
 *
 * Do not assume the first 100 entries are all namespaces: many QA branches
 * have created a CloudDatabase namespace. Missing/inconsistent pagination
 * must NOT turn into a successful production readiness decision.
 */
export async function listAllDurableObjectNamespaces({ accountId, token, requestJson, maxPages = 50 }) {
  if (!/^[a-f0-9]{32}$/.test(String(accountId || '')) ||
      !token || typeof requestJson !== 'function' ||
      !Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new Error('Namespace inventory parameters are invalid');
  }
  const inventory = [];
  const ids = new Set();
  let expectedPages = null;
  for (let page = 1; page <= maxPages; page++) {
    const url = 'https://api.cloudflare.com/client/v4/accounts/' + accountId +
      '/workers/durable_objects/namespaces?per_page=100&page=' + page;
    const response = await requestJson(url, token);
    const rows = response?.result;
    const info = response?.result_info;
    const totalPages = Number(info?.total_pages);
    const currentPage = Number(info?.page);
    if (response?.success !== true || !Array.isArray(rows) ||
        !Number.isSafeInteger(totalPages) || totalPages < 1 ||
        totalPages > maxPages || currentPage !== page ||
        (expectedPages !== null && totalPages !== expectedPages) ||
        (page < totalPages && rows.length === 0)) {
      throw new Error('Incomplete or inconsistent Durable Object namespace inventory');
    }
    expectedPages = totalPages;
    for (const entry of rows) {
      if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) {
        throw new Error('Invalid or duplicated Durable Object namespace ID');
      }
      ids.add(entry.id);
      inventory.push(entry);
    }
    if (page === expectedPages) return inventory;
  }
  throw new Error('Durable Object namespace inventory exceeded the safe pagination limit');
}

export function isCanonicalWorkerNamespace(inventory, namespaceId, script) {
  if (!Array.isArray(inventory) || typeof namespaceId !== 'string' ||
      !namespaceId || typeof script !== 'string' || !script) return false;
  const name = script + '_CloudDatabase';
  const matching = inventory.filter(item => item?.name === name && item?.class === 'CloudDatabase');
  return matching.length === 1 &&
    matching[0].id === namespaceId &&
    matching[0].script === script;
}
