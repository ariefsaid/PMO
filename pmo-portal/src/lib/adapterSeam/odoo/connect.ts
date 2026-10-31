/**
 * Connect validation (FR-ODC-001/002, S2): one authenticated JSON-2 read with the supplied key and database, plus the
 * unauthenticated version probe (bed report T17). Nothing here stores anything; the caller commits only on success.
 */
import { odooCall, OdooError, type OdooClientDeps } from './client.ts';

export interface OdooCompany { id: number; name: string }
export interface ConnectInput { siteUrl: string; database: string; apiKey: string; fetchImpl: typeof fetch; allowHttp?: boolean }

/** `server_version_info[0]` from `version_info` (V17), or null when Odoo does not answer it. Never throws. */
export async function fetchOdooVersionMajor(deps: Pick<OdooClientDeps, 'baseUrl' | 'fetchImpl' | 'deadlineMs'>): Promise<number | null> {
  try {
    const res = await deps.fetchImpl(`${deps.baseUrl.replace(/\/$/, '')}/web/webclient/version_info`, {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: {} }), signal: AbortSignal.timeout(deps.deadlineMs ?? 5_000) });
    const major = (await res.json())?.result?.server_version_info?.[0];
    return Number.isInteger(major) ? major : null;
  } catch { return null; }
}

export async function validateOdooConnection(input: ConnectInput): Promise<{ companies: OdooCompany[]; versionMajor: number | null }> {
  let url: URL;
  try { url = new URL(input.siteUrl); } catch { throw new OdooError('destination-refused'); }
  if (url.protocol !== 'https:' && !(input.allowHttp && url.protocol === 'http:')) throw new OdooError('destination-refused');
  const deps: OdooClientDeps = { baseUrl: url.origin, apiKey: input.apiKey, database: input.database, fetchImpl: input.fetchImpl, deadlineMs: 5_000 };
  let companies: OdooCompany[];
  try {
    companies = await odooCall<OdooCompany[]>(deps, 'res.company', 'search_read', { domain: [], fields: ['id', 'name'], limit: 50 });
  } catch (err) {
    // A host pinned to one database answers any other database with the same HTML 404 an Odoo without JSON-2 gives
    // (bed, 2026-11-01). The unauthenticated version probe tells them apart: JSON-2 ships from Odoo 19.
    if (err instanceof OdooError && err.errorClass === 'no-json2' && ((await fetchOdooVersionMajor(deps)) ?? 0) >= 19) {
      throw new OdooError('database-not-found', err.status);
    }
    throw err;
  }
  return { companies: companies.map(({ id, name }) => ({ id, name })), versionMajor: await fetchOdooVersionMajor(deps) };
}
