/**
 * THE Odoo client resolver (FR-ODC-100, NFR-ODC-001): the only place an Odoo key leaves Vault. Every check runs
 * before the key is read, and every Odoo request goes through the host guard. No later slice builds its own.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { guardedErpFetch, isPermittedErpSiteUrl } from './erpHostGuard.ts';
import { externalConnectEnabled } from './externalConnectEnabled.ts';
import { createPacer, paceFor, type OdooClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { INITIAL_CONNECTION, nextConnection, type ConnectionRecord, type ProbeOutcome } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectionState.ts';
import type { CapabilitySnapshot } from '../../../pmo-portal/src/lib/adapterSeam/odoo/discovery.ts';

export type OdooClientRefusal = 'not-found' | 'inactive' | 'invalid-site' | 'credentials' | 'company-not-set' | 'kill-switch';
export type OdooClientForOrgResult =
  | { client: OdooClientDeps; config: Record<string, unknown>; companyId: number | null }
  | { refusal: OdooClientRefusal };

/** Requests per second for one client: `paceFor`, or lower when the deployment sets ODOO_PACE_RPS. It never raises the plan's cap. */
const paceRps = (siteUrl: string) => {
  const cap = paceFor(siteUrl);
  const set = Number(Deno.env.get('ODOO_PACE_RPS'));
  return set > 0 ? Math.min(set, cap) : cap;
};

/** Activation and company are required unless a setup step (company listing, activation) opts out. */
export async function odooClientForOrg(
  sc: SupabaseClient,
  orgId: string,
  options: { requireActivated?: boolean; requireCompany?: boolean } = {},
): Promise<OdooClientForOrgResult> {
  if (!externalConnectEnabled()) return { refusal: 'kill-switch' };
  const { data: b, error } = await sc.from('external_org_bindings').select('site_url,secret_ref,status,activated_at,config')
    .eq('org_id', orgId).eq('external_tier', 'odoo').maybeSingle();
  if (error || !b) return { refusal: 'not-found' };
  if (b.status !== 'active' || (options.requireActivated !== false && !b.activated_at)) return { refusal: 'inactive' };
  const config = (b.config ?? {}) as Record<string, unknown>;
  const companyId = Number.isInteger(config.odoo_company_id) ? (config.odoo_company_id as number) : null;
  if (options.requireCompany !== false && companyId === null) return { refusal: 'company-not-set' };
  if (!(await isPermittedErpSiteUrl(b.site_url))) return { refusal: 'invalid-site' };
  const { data: key, error: keyError } = await sc.rpc('read_vault_secret', { p_secret_ref: b.secret_ref });
  // An Odoo key is one token; a `a:b` value is some other tier's pair under this reference — refuse it.
  if (keyError || typeof key !== 'string' || key === '' || key.includes(':')) return { refusal: 'credentials' };
  return {
    client: { baseUrl: b.site_url, apiKey: key, database: String(config.database ?? ''), fetchImpl: guardedErpFetch(b.site_url), pace: createPacer(paceRps(b.site_url)) },
    config,
    companyId,
  };
}

/**
 * Store one probe's outcome (FR-ODC-021/023/030): the next connection state, plus the capability snapshot when
 * discovery ran. A change in what is missing and a newly rejected key each leave an audit row. Binding-scoped callers
 * only (activated, not disconnected): the resolver above has already refused anything else.
 */
export async function recordOdooProbe(
  sc: SupabaseClient,
  orgId: string,
  prevConfig: Record<string, unknown>,
  outcome: ProbeOutcome,
  snapshot?: CapabilitySnapshot,
  actorId: string | null = null,
): Promise<ConnectionRecord> {
  const prev = (prevConfig.connection as ConnectionRecord | undefined) ?? INITIAL_CONNECTION;
  const keyExpiresOn = typeof prevConfig.key_expires_on === 'string' ? prevConfig.key_expires_on : null;
  const next = nextConnection(prev, outcome, { now: new Date(), keyExpiresOn, activated: true, disconnected: false });
  const { error } = await sc.rpc('merge_external_org_binding_config', {
    p_org_id: orgId, p_external_tier: 'odoo', p_patch: snapshot ? { connection: next, capabilities: snapshot } : { connection: next },
  });
  if (error) throw new Error('could not store the Odoo connection state');
  const audit = (action: string, detail: Record<string, unknown>) =>
    sc.rpc('log_audit', { p_action: action, p_org_id: orgId, p_actor_id: actorId, p_entity_id: null, p_detail: { tier: 'odoo', ...detail } })
      .then(({ error: e }) => { if (e) console.error('log_audit failed', action); });
  const prevMissing = ((prevConfig.capabilities as CapabilitySnapshot | undefined)?.missing ?? []).join(',');
  if (snapshot && prevMissing !== snapshot.missing.join(',')) await audit('integration.odoo.capability_change', { missing: snapshot.missing });
  if (next.state === 'credential-rejected' && prev.state !== 'credential-rejected') await audit('integration.odoo.credential_rejected', { error_class: next.error_class });
  return next;
}
