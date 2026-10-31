/**
 * "Refresh now" (FR-ODC-047: Admin/Finance, once per minute per org) and "resync one kind from scratch" (FR-ODC-048:
 * Admin/Operator, enforced again inside reset_odoo_sync_kind, audited there). Both act on the caller's own org only.
 */
import { DIRECTORY_KINDS, type DirectoryKind } from '../../../../pmo-portal/src/lib/adapterSeam/odoo/kinds.ts';
import { sweepOdooOrg } from '../../_shared/odooSweep.ts';
import { checkRequestRate } from '../../_shared/requestRateGuard.ts';
import { odooError, type OdooCtx } from './router.ts';

export const REFRESH_WINDOW_SECS = 60;

export async function refresh(c: OdooCtx): Promise<Response> {
  const rate = await checkRequestRate(c.sc as never, { key: `odoo-refresh:${c.orgId}`, limit: 1, windowSecs: REFRESH_WINDOW_SECS });
  if (rate.exceeded) return c.respond({ error: 'RATE_LIMITED', message: 'Refresh runs once a minute', retryAfterSeconds: rate.retryAfterSeconds }, 429);
  try {
    return c.respond(await sweepOdooOrg(c.sc, c.orgId));
  } catch {
    return odooError(c, 'The refresh could not save its results', 'STORE_FAILED', 500);
  }
}

export async function resetKind(c: OdooCtx): Promise<Response> {
  const kind = c.body.kind;
  if (typeof kind !== 'string' || !DIRECTORY_KINDS.includes(kind as DirectoryKind)) return odooError(c, 'Unknown kind', 'BAD_REQUEST', 400);
  // Held around the delete: a sweep mid-kind would otherwise write the old cursor straight back with its next page.
  const holder = crypto.randomUUID();
  const { data: claimed, error: claimError } = await c.sc.rpc('claim_erp_sweep_lock', { p_org_id: c.orgId, p_holder: holder, p_ttl: '1 minute' });
  if (claimError || claimed !== true) return odooError(c, 'A sync is running; retry in a minute', 'SYNC_RUNNING', 409);
  let error;
  try {
    ({ error } = await c.sc.rpc('reset_odoo_sync_kind', { p_org_id: c.orgId, p_kind: kind, p_actor_id: c.userId }));
  } finally {
    const { error: releaseError } = await c.sc.rpc('release_erp_sweep_lock', { p_org_id: c.orgId, p_holder: holder });
    if (releaseError) console.error('release_erp_sweep_lock failed');
  }
  if (error) return error.code === '42501' ? odooError(c, 'Not allowed for your role', 'FORBIDDEN', 403) : odooError(c, 'The reset could not be saved', 'STORE_FAILED', 500);
  return c.respond({ reset: kind });
}
