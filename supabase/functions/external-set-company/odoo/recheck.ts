/**
 * Re-check the Odoo connection now (FR-ODC-031 user probe), stored like a sweep probe. A failed probe is still an answer
 * (200 with the state it produced). The card's Re-check is ONE authenticated read through the stored key: full capability
 * discovery is ~78 sequential Odoo calls, each re-resolving DNS, and ran the edge isolate into its CPU limit (#2051).
 * Discovery (FR-ODC-020) runs on connect, activation, reconnect and the daily sweep, or here with `full: true`.
 */
import { bindCall, OdooError } from '../../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { fetchOdooVersionMajor } from '../../../../pmo-portal/src/lib/adapterSeam/odoo/connect.ts';
import type { ProbeOutcome } from '../../../../pmo-portal/src/lib/adapterSeam/odoo/connectionState.ts';
import { discoverCapabilities, DISCOVERY_BUDGET_MS, type CapabilitySnapshot } from '../../../../pmo-portal/src/lib/adapterSeam/odoo/discovery.ts';
import { checkRequestRate } from '../../_shared/requestRateGuard.ts';
import { odooClientForOrg, recordOdooProbe } from '../../_shared/odooClientForOrg.ts';
import { odooError, type OdooCtx } from './router.ts';

export async function recheck(c: OdooCtx): Promise<Response> {
  // One probe per org per minute: concurrent rechecks would multiply the request rate against Odoo.
  const rate = await checkRequestRate(c.sc as never, { key: `odoo-recheck:${c.orgId}`, limit: 1, windowSecs: 60 });
  if (rate.exceeded) return odooError(c, 'A check just ran. Try again in a minute.', 'RATE_LIMITED', 429);
  const r = await odooClientForOrg(c.sc, c.orgId);
  if ('refusal' in r) return odooError(c, 'The Odoo connection is not usable', r.refusal, 422);
  let outcome: ProbeOutcome;
  let snapshot: CapabilitySnapshot | undefined;
  const stored = r.config.capabilities as CapabilitySnapshot | undefined;
  try {
    if (c.body.full === true) {
      // A failed version probe falls back to the version stored at activation; with none, it is a failure, not a healthy answer.
      const versionMajor = (await fetchOdooVersionMajor(r.client)) ?? stored?.version_major ?? null;
      if (versionMajor === null) throw new OdooError('unreachable');
      snapshot = await discoverCapabilities(bindCall(r.client), { versionMajor, now: new Date(), deadlineAt: Date.now() + DISCOVERY_BUDGET_MS });
      outcome = { ok: true, missing: snapshot.missing };
    } else {
      // Proves the key, database, company scope and JSON-2 in one request; what the last discovery found missing stands until the next one.
      await bindCall(r.client)<number>('res.company', 'search_count', { domain: [] });
      outcome = { ok: true, missing: stored?.missing ?? [] };
    }
  } catch (err) {
    outcome = { ok: false, errorClass: err instanceof OdooError ? err.errorClass : 'unreachable' };
  }
  try {
    const next = await recordOdooProbe(c.sc, c.orgId, r.config, outcome, snapshot, c.userId);
    return c.respond({ state: next.state, missing: next.missing, errorClass: next.error_class, checkedAt: next.last_checked_at });
  } catch {
    return odooError(c, 'The check ran but its result could not be saved', 'STORE_FAILED', 500);
  }
}
