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
  let expectedTotalCount = null;
  for (let page = 1; page <= maxPages; page++) {
    const url = 'https://api.cloudflare.com/client/v4/accounts/' + accountId +
      '/workers/durable_objects/namespaces?per_page=100&page=' + page;
    const response = await requestJson(url, token);
    const rows = response?.result;
    const info = response?.result_info;
    // The Cloudflare endpoint reports total_count but may omit total_pages.
    // Derive pages from the actual response, not a guessed API field.
    const totalCount = Number(info?.total_count);
    const perPage = Number(info?.per_page);
    const declaredCount = Number(info?.count);
    const currentPage = Number(info?.page);
    const totalPages = Number.isSafeInteger(totalCount) && perPage === 100
      ? Math.max(1, Math.ceil(totalCount / perPage))
      : NaN;
    const declaredTotalPages = info?.total_pages == null ? totalPages : Number(info.total_pages);
    const expectedCount = page < totalPages ? perPage : totalCount - perPage * (page - 1);
    if (response?.success !== true || !Array.isArray(rows) ||
        !Number.isSafeInteger(totalCount) || totalCount < 0 ||
        perPage !== 100 || !Number.isSafeInteger(declaredCount) ||
        declaredCount !== rows.length ||
        !Number.isSafeInteger(totalPages) || totalPages < 1 ||
        totalPages !== declaredTotalPages || totalPages > maxPages ||
        currentPage !== page ||
        (expectedPages !== null && totalPages !== expectedPages) ||
        (expectedTotalCount !== null && totalCount !== expectedTotalCount) ||
        rows.length !== expectedCount) {
      throw new Error('Incomplete or inconsistent Durable Object namespace inventory');
    }
    expectedPages = totalPages;
    expectedTotalCount = totalCount;
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
