/**
 * external-connect — the Odoo branch (#1504 S2, FR-ODC-001..008): validate, stage the key, commit through
 * `finalize_odoo_connect`, compensate with `cleanup_external_connect_attempt` (the ClickUp atomic pattern, 0259/0346).
 *
 * The key exists in plaintext only in the validation request and the stage RPC's `p_secret_value` (NFR-ODC-001).
 * No response or log line carries it, an upstream body, an RPC message, or the secret reference: responses are a
 * fixed English line plus an `error` code the browser localises.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { guardedErpFetch, isLocalBenchSite, isPermittedErpSiteUrl } from '../_shared/erpHostGuard.ts';
import { OdooError } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { validateOdooConnection, type OdooCompany } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connect.ts';

export interface OdooCredential {
  siteUrl?: string;
  database?: string;
  apiKey?: string;
  keyExpiresOn?: string | null;
  confirmDiscard?: boolean;
}

const COPY: Record<string, string> = {
  'another-erp-active': 'Another accounting system is already connected; disconnect it first.',
  'destination-refused': 'That address cannot be used. Use the public https address of your Odoo.',
  unreachable: 'Odoo could not be reached.',
  timeout: 'Odoo did not answer in time.',
  tls: 'Odoo\'s security certificate could not be verified.',
  'not-odoo': 'That address does not look like an Odoo instance.',
  'no-json2': 'This Odoo does not offer the JSON-2 API (Odoo 20 or later is needed).',
  'unsupported-version': 'This Odoo version is not supported, or its version could not be read. Odoo 20 or later is needed.',
  'database-not-found': 'Odoo has no database with that name, or its JSON-2 API is not reachable at this address.',
  'key-rejected': 'Odoo rejected the API key.',
  'access-denied': 'The API key works but cannot read companies.',
  'missing-model': 'This Odoo is missing an app PMO needs.',
  validation: 'Odoo refused the request.',
  'server-error': 'Odoo answered with an error.',
  'confirm-discard': 'This is a different Odoo database. Confirm to discard what PMO mirrored from the old one.',
  'target-locked': 'Documents already reference the current Odoo connection, so it cannot be switched to another database.',
  CONNECT_NOT_COMMITTED: 'The connection could not be saved; nothing was connected. Please try again.',
};
const TRANSIENT = new Set(['unreachable', 'timeout', 'server-error']);

type Respond = (body: unknown, status?: number) => Response;

/** Maps a finalize refusal (fixed RPC texts, 0420) to a wire code; the message itself never reaches the response. */
function finalizeCode(message: string): string {
  if (/different Odoo database/.test(message)) return 'confirm-discard';
  if (/documents already reference/.test(message)) return 'target-locked';
  if (/another ERP tier is active/.test(message)) return 'another-erp-active';
  return 'CONNECT_NOT_COMMITTED';
}

export async function connectOdoo(
  sc: SupabaseClient, orgId: string, userId: string, c: OdooCredential, killSwitch: boolean, respond: Respond,
): Promise<Response> {
  const siteUrl = typeof c.siteUrl === 'string' ? c.siteUrl.trim() : '';
  const database = typeof c.database === 'string' ? c.database.trim() : '';
  const apiKey = typeof c.apiKey === 'string' ? c.apiKey.trim() : '';
  if (!siteUrl || !database || !apiKey) return respond({ error: 'BAD_REQUEST', message: 'siteUrl, database and apiKey are required' }, 400);
  // An Odoo key is one token; odooClientForOrg refuses a two-part value, so never store one.
  if (/[:\s]/.test(apiKey)) return respond({ error: 'BAD_REQUEST', message: 'That is not an Odoo API key' }, 400);
  // FR-ODC-011: a refused connect leaves an audit row with its outcome class (never the key or an upstream body).
  // Best effort: a failed audit write never changes the answer.
  const fail = async (_respond: Respond, code: string, status: number) => {
    await sc.rpc('log_audit', { p_action: 'integration.connect.refused', p_org_id: orgId, p_actor_id: userId, p_entity_id: null,
      p_detail: { tier: 'odoo', actor: userId, outcome_class: code } }).then(() => {}, () => {});
    return respond({ error: code, message: COPY[code] ?? COPY.CONNECT_NOT_COMMITTED }, status);
  };

  const { data: other, error: otherError } = await sc.from('external_org_bindings').select('external_tier')
    .eq('org_id', orgId).eq('external_tier', 'erpnext').eq('status', 'active').maybeSingle();
  if (otherError) return fail(respond, 'CONNECT_NOT_COMMITTED', 500);
  if (other) return fail(respond, 'another-erp-active', 409);
  if (!(await isPermittedErpSiteUrl(siteUrl))) return fail(respond, 'destination-refused', 422);

  let companies: OdooCompany[];
  let versionMajor: number;
  try {
    ({ companies, versionMajor } = await validateOdooConnection({
      siteUrl, database, apiKey, fetchImpl: guardedErpFetch(siteUrl), allowHttp: isLocalBenchSite(siteUrl),
    }));
  } catch (err) {
    const cls = err instanceof OdooError ? err.errorClass : 'unreachable';
    return fail(respond, cls, TRANSIENT.has(cls) ? 502 : 422);
  }

  const ref = `odoo_token_${orgId}_${Date.now()}`;
  const cleanup = () => sc.rpc('cleanup_external_connect_attempt', { p_org_id: orgId, p_external_tier: 'odoo', p_secret_ref: ref, p_actor_id: userId });
  const { error: stageError } = await sc.rpc('stage_vault_secret_for_org', {
    p_org_id: orgId, p_external_tier: 'odoo', p_secret_value: apiKey, p_secret_name: ref, p_actor_id: userId,
  });
  if (stageError) {
    await cleanup();   // a lost response may still have committed the stage; cleanup is scoped to this attempt's ref
    return fail(respond, 'CONNECT_NOT_COMMITTED', 500);
  }
  const { error: finalizeError } = await sc.rpc('finalize_odoo_connect', {
    p_org_id: orgId, p_secret_ref: ref, p_site_url: new URL(siteUrl).origin, p_database: database,
    p_key_expires_on: c.keyExpiresOn ?? null, p_discard: c.confirmDiscard === true, p_kill_switch_enabled: killSwitch, p_actor_id: userId,
  });
  if (finalizeError) {
    await cleanup();
    const code = finalizeCode(finalizeError.message ?? '');
    return fail(respond, code, code === 'CONNECT_NOT_COMMITTED' ? 500 : 409);
  }
  return respond({ ok: true, binding: { status: 'active' }, companies, versionMajor });
}
