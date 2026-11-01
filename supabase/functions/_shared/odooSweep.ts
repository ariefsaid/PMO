/**
 * One org's Odoo sweep tick (FR-ODC-042..047, plan §2.7): single-flight on `erp_sweep_lock`, the client from the one
 * resolver, every directory kind within one call/time budget, the daily census and re-discovery, then the connection
 * state. Cursors move only inside apply_odoo_master_page / finish_odoo_census, so any failure leaves them in place.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { bindCall, OdooError, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { fetchOdooVersionMajor } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connect.ts';
import { discoverCapabilities, DISCOVERY_BUDGET_MS, type CapabilitySnapshot } from '../../../pmo-portal/src/lib/adapterSeam/odoo/discovery.ts';
import { KIND_SPECS, type DirectoryKind, type DirectoryRow } from '../../../pmo-portal/src/lib/adapterSeam/odoo/kinds.ts';
import { odooKindReaders, runCensus, runKind, type KindRunDeps } from '../../../pmo-portal/src/lib/adapterSeam/odoo/sweep.ts';
import { advanceConnectRuns } from './connectRun.ts';
import { matchNewPartners } from './odooPartyFeed.ts';
import { odooClientForOrg, recordOdooProbe, type OdooClientRefusal } from './odooClientForOrg.ts';

export const ODOO_KIND_ORDER: DirectoryKind[] = ['company', 'analytic_plan', 'analytic_account', 'account', 'tax', 'uom', 'product', 'warehouse', 'location', 'partner'];
export const ODOO_SWEEP_TICK_MAX_CALLS = 60;
export const ODOO_SWEEP_TICK_TIME_BUDGET_MS = 100_000;
const LOCK_TTL = '15 minutes';
/** Calls held back for each kind still to run (its feed page and census), so one kind's backlog never starves the rest. */
const RESERVE_PER_KIND = 2;
const DAY_MS = 86_400_000;

type Resolved = Extract<Awaited<ReturnType<typeof odooClientForOrg>>, { client: unknown }>;
type Budget = { spend: () => boolean; left: () => boolean };
/** Extension seams: S6 matches new partners after `partner` pages; S7/S8 add the link reconcile and accepted sends. */
export const AFTER_APPLY: Partial<Record<DirectoryKind, (sc: SupabaseClient, orgId: string, rows: DirectoryRow[]) => Promise<void>>> = {
  partner: matchNewPartners,
};
/** S6: one bounded step of the org's open setup run (census staging, proposals), the same loop ERPNext's sweep runs. It has its
 *  own ERP-call cap (`CONNECT_CALLS_PER_TICK`), so a long initial scan cannot starve it, and it never fails the tick. */
const advanceSetupRun = async (sc: SupabaseClient, orgId: string, r: Resolved) => {
  try {
    await advanceConnectRuns(sc, { orgId, bindingId: r.bindingId }, 'odoo');
  } catch {
    console.error('odoo setup run step failed');   // the run counts its own failures; a store outage is retried next tick
  }
};
export const AFTER_SWEEP: Array<(sc: SupabaseClient, orgId: string, r: Resolved, budget: Budget) => Promise<void>> = [advanceSetupRun];

export type OdooSweepResult =
  | { skipped: 'lock-held' | OdooClientRefusal }
  | { ok: true; calls: number; skipped_rows: number; failed?: string };

async function rpc(sc: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await sc.rpc(fn, args);
  if (error) throw new Error(`${fn} failed`);
  return data;
}

async function readCursor(sc: SupabaseClient, orgId: string, kind: DirectoryKind): Promise<string> {
  const { data, error } = await sc.from('external_sync_watermarks').select('watermark_cursor')
    .eq('org_id', orgId).eq('external_tier', 'odoo').eq('domain', `master:${kind}`).maybeSingle();
  if (error) throw new Error('could not read the Odoo cursor');
  return (data?.watermark_cursor as string | undefined) ?? '';
}

/** A kind discovery found missing or unreadable is skipped (the connection is already degraded), never a failed tick. */
function readable(capabilities: CapabilitySnapshot | undefined, model: string): boolean {
  const p = capabilities?.models?.[model];
  return !p || (p.exists && p.read && p.fields_missing.length === 0);
}

function kindDeps(sc: SupabaseClient, orgId: string, kind: DirectoryKind, call: OdooCall, companyId: number, budget: Budget): KindRunDeps {
  return {
    ...odooKindReaders(call, KIND_SPECS[kind], companyId),
    apply: async (rows, cursor) => { await rpc(sc, 'apply_odoo_master_page', { p_org_id: orgId, p_kind: kind, p_rows: rows, p_cursor: cursor }); },
    censusSeen: async (run, ids) => { await rpc(sc, 'mark_odoo_census_seen', { p_org_id: orgId, p_kind: kind, p_run: run, p_ids: ids }); },
    censusFinish: async (run, cursor) => { await rpc(sc, 'finish_odoo_census', { p_org_id: orgId, p_kind: kind, p_run: run, p_cursor: cursor }); },
    budget,
    now: () => new Date(),
  };
}

export async function sweepOdooOrg(
  sc: SupabaseClient,
  orgId: string,
  opts: { maxCalls?: number; timeBudgetMs?: number } = {},
): Promise<OdooSweepResult> {
  const holder = crypto.randomUUID();
  const { data: claimed, error: claimError } = await sc.rpc('claim_erp_sweep_lock', { p_org_id: orgId, p_holder: holder, p_ttl: LOCK_TTL });
  if (claimError || claimed !== true) return { skipped: 'lock-held' };
  try {
    const r = await odooClientForOrg(sc, orgId);
    if ('refusal' in r) return { skipped: r.refusal };
    const started = Date.now();
    let calls = 0;
    const maxCalls = opts.maxCalls ?? ODOO_SWEEP_TICK_MAX_CALLS;
    const timeBudget = opts.timeBudgetMs ?? ODOO_SWEEP_TICK_TIME_BUDGET_MS;
    const left = () => calls < maxCalls && Date.now() - started < timeBudget;
    const budget: Budget = { left, spend: () => left() && ++calls > 0 };
    const call = bindCall(r.client);
    const capabilities = r.config.capabilities as CapabilitySnapshot | undefined;
    let skippedRows = 0;
    try {
      const kinds = ODOO_KIND_ORDER.filter((kind) => readable(capabilities, KIND_SPECS[kind].model));
      for (const [i, kind] of kinds.entries()) {
        const cap = maxCalls - RESERVE_PER_KIND * (kinds.length - 1 - i);
        const kindBudget: Budget = { left: () => calls < cap && left(), spend: () => calls < cap && budget.spend() };
        const deps = kindDeps(sc, orgId, kind, call, r.companyId!, kindBudget);
        const run = await runKind(KIND_SPECS[kind], await readCursor(sc, orgId, kind), deps);
        skippedRows += run.skipped;
        await AFTER_APPLY[kind]?.(sc, orgId, run.applied);
        if (run.done) await runCensus(await readCursor(sc, orgId, kind), deps);
      }
      for (const step of AFTER_SWEEP) await step(sc, orgId, r, budget);
      // Daily re-discovery (FR-ODC-021) runs outside the sweep's call budget; it is ~60 calls once a day.
      const stale = !capabilities?.observed_at || Date.now() - Date.parse(capabilities.observed_at) > DAY_MS;
      let snapshot: CapabilitySnapshot | undefined;
      if (stale && budget.left()) {
        // As recheck: a failed version probe falls back to the stored version; with none it is a failure.
        const versionMajor = (await fetchOdooVersionMajor(r.client)) ?? capabilities?.version_major ?? null;
        if (versionMajor === null) throw new OdooError('unreachable');
        snapshot = await discoverCapabilities(call, { versionMajor, now: new Date(), deadlineAt: Date.now() + Math.min(DISCOVERY_BUDGET_MS, timeBudget - (Date.now() - started)) });
      }
      await recordOdooProbe(sc, orgId, r.config, { ok: true, missing: (snapshot ?? capabilities)?.missing ?? [] }, snapshot);
      return { ok: true, calls, skipped_rows: skippedRows };
    } catch (err) {
      if (!(err instanceof OdooError)) throw err;
      await recordOdooProbe(sc, orgId, r.config, { ok: false, errorClass: err.errorClass });
      return { ok: true, calls, skipped_rows: skippedRows, failed: err.errorClass };
    }
  } finally {
    const { error } = await sc.rpc('release_erp_sweep_lock', { p_org_id: orgId, p_holder: holder });
    if (error) console.error('release_erp_sweep_lock failed');
  }
}
