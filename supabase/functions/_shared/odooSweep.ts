/**
 * One org's Odoo sweep tick (FR-ODC-042..047, plan §2.7): single-flight on `erp_sweep_lock`, the client from the one
 * resolver, every directory kind and (when procurement is employed and its switch is on) every purchase domain within one
 * call/time budget (and, once the org reads its ledger, the Odoo ledger feed and actuals refresh), the daily census and re-discovery, then the connection state. Cursors move only inside
 * apply_odoo_master_page / finish_odoo_census, so any failure leaves them in place.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { bindCall, OdooError, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { fetchOdooVersionMajor } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connect.ts';
import { discoverCapabilities, DISCOVERY_BUDGET_MS, type CapabilitySnapshot } from '../../../pmo-portal/src/lib/adapterSeam/odoo/discovery.ts';
import { KIND_SPECS, type DirectoryKind, type DirectoryRow, type KindSpec } from '../../../pmo-portal/src/lib/adapterSeam/odoo/kinds.ts';
import { ASSET_KINDS, ASSET_KIND_SPECS, type AssetKind } from '../../../pmo-portal/src/lib/adapterSeam/odoo/assets/kinds.ts';
import { odooKindReaders, runCensus, runKind, type KindRunDeps } from '../../../pmo-portal/src/lib/adapterSeam/odoo/sweep.ts';
import { advanceConnectRuns } from './connectRun.ts';
import { matchNewPartners } from './odooPartyFeed.ts';
import { ledgerFeedEmployed, runLedgerPass, type LedgerPassResult } from './odooLedgerFeed.ts';
import { purchaseDomainsReadable, purchaseFeedEmployed, runPurchasePass } from './odooPurchaseFeed.ts';
import { revenueDomainsReadable, revenueFeedEmployed, runRevenuePass } from './odooRevenueFeed.ts';
import { reconcileOdooRevenueOutbox } from '../adapter-dispatch/odooRevenueRecovery.ts';
import { reconcileOdooProcurementOutbox } from '../adapter-dispatch/odooProcurementRecovery.ts';
import { odooClientForOrg, recordOdooProbe, type OdooClientRefusal } from './odooClientForOrg.ts';
import { parseOdooOutboxRecoveryCandidates } from './odooOutboxRecovery.ts';
import { sendAcceptedOdoo } from './odooConnectSends.ts';

export const ODOO_KIND_ORDER: DirectoryKind[] = ['company', 'analytic_plan', 'analytic_account', 'account', 'tax', 'journal', 'uom', 'product', 'warehouse', 'location', 'partner'];
export const ODOO_SWEEP_TICK_MAX_CALLS = 60;
export const ODOO_SWEEP_TICK_TIME_BUDGET_MS = 100_000;
export const ODOO_SWEEP_RECOVERY_TIME_BUDGET_MS = 60_000;
const LOCK_TTL = '15 minutes';
/** Calls held back for each kind still to run (its feed page and census), so one kind's backlog never starves the rest. */
const RESERVE_PER_KIND = 2;
const DAY_MS = 86_400_000;

type MirrorKind = DirectoryKind | AssetKind;
const SPECS: Record<MirrorKind, KindSpec> = { ...KIND_SPECS, ...ASSET_KIND_SPECS };

type Resolved = Extract<Awaited<ReturnType<typeof odooClientForOrg>>, { client: unknown }>;
type Budget = { spend: (calls?: number) => boolean; left: () => boolean; canSpend?: (calls?: number) => boolean; refund?: (calls?: number) => void };
/** Extension seams: S6 matches new partners after `partner` pages; S7 reconciles links after the sweep; S8 adds accepted sends. */
export const AFTER_APPLY: Partial<Record<DirectoryKind, (sc: SupabaseClient, orgId: string, rows: DirectoryRow[], deadlineAt: number, call: OdooCall) => Promise<void>>> = {
  partner: matchNewPartners,
};
/** S6: one bounded step of the org's open setup run (census staging, proposals), the same loop ERPNext's sweep runs. It has its
 *  own ERP-call cap (`CONNECT_CALLS_PER_TICK`), so a long initial scan cannot starve it, and it never fails the tick; it also runs when the sweep failed, so an unreachable Odoo counts. */
const advanceSetupRun = async (sc: SupabaseClient, orgId: string, r: Resolved) => {
  try {
    await advanceConnectRuns(sc, { orgId, bindingId: r.bindingId }, 'odoo');
  } catch {
    console.error('odoo setup run step failed');   // the run counts its own failures; a store outage is retried next tick
  }
};
/** S7 (AC-ODC-054): a linked cost account that was archived, deleted or moved company in Odoo marks its project link "needs attention"
 *  (and clears the mark when fixed). It reads the mirror only, so it runs on a failed tick too, and never fails the tick. */
const reconcileLinks = async (sc: SupabaseClient, orgId: string) => {
  const { error } = await sc.rpc('reconcile_odoo_links', { p_org_id: orgId });
  if (error) console.error('odoo link reconciliation failed');
};
export const AFTER_SWEEP: Array<(sc: SupabaseClient, orgId: string, r: Resolved, budget: Budget) => Promise<void>> = [advanceSetupRun, reconcileLinks, sendAcceptedOdoo];

export type OdooSweepResult =
  | { skipped: 'lock-held' | OdooClientRefusal }
  | {
    ok: true; calls: number; skipped_rows: number; outbox_reconciled: number; outbox_errors: Array<{ id: string; error: string }>;
    outbox_procurement_reconciled: number; outbox_procurement_skipped: number; outbox_procurement_budget_exhausted: boolean;
    outbox_procurement_errors: Array<{ id: string; error: string }>;
    failed?: string; purchase_hold?: PurchaseHold;
    /** Counts only (#1507): lines applied this tick, whether the feed caught up, lines skipped as unparseable. */
    ledger?: LedgerPassResult;
  };

/** Why this tick mirrors no purchase document (FR-PLN-006 at pass start, #1783 item 4). Reported, never logged with data. */
export type PurchaseHold = 'feature-off:procurement' | 'feature-switch-unreadable:procurement';

/** The org's `procurement` entitlement, read ONCE per tick at pass start (0534's service-only twin). Only a literal `true`
 *  admits the purchase feed; false is the switch off, and an error, a rejected read, a null or a non-boolean body is an
 *  unreadable switch. Both hold purchase for this tick and leave the cursor where it was — never the directory, revenue,
 *  setup or probe paths. The read is deliberately not repeated inside a pass: work admitted here always finishes, so a
 *  switch flip can never interrupt a half-applied page. */
async function procurementHold(sc: SupabaseClient, orgId: string): Promise<PurchaseHold | null> {
  try {
    const { data, error } = await sc.rpc('service_feature_enabled', { p_org_id: orgId, p_key: 'procurement' });
    if (error) return 'feature-switch-unreadable:procurement';
    if (data === true) return null;
    return data === false ? 'feature-off:procurement' : 'feature-switch-unreadable:procurement';
  } catch {
    return 'feature-switch-unreadable:procurement';
  }
}

async function rpc(sc: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await sc.rpc(fn, args);
  if (error) throw new Error(`${fn} failed`);
  return data;
}

async function readCursor(sc: SupabaseClient, orgId: string, kind: MirrorKind): Promise<string> {
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

/** An asset model counts as readable only when the snapshot shows it; absent means not read (unlike `readable`, which trusts an old snapshot). */
function assetReadable(capabilities: CapabilitySnapshot | undefined, model: string): boolean {
  const p = capabilities?.assets?.[model];
  return !!p && p.exists && p.read && p.fields_missing.length === 0;
}

/** FR-OFM-010/011: the fleet and maintenance kinds are read only for an org that employs `equipment` under Odoo. An error is "not employed" for this tick. */
async function equipmentFeedEmployed(sc: SupabaseClient, orgId: string): Promise<boolean> {
  try {
    const { data, error } = await sc.rpc('org_employs_odoo_equipment', { p_org: orgId });
    if (error) { console.error('could not read the Odoo equipment ownership'); return false; }
    return data === true;
  } catch {
    console.error('could not read the Odoo equipment ownership');
    return false;
  }
}

function kindDeps(sc: SupabaseClient, orgId: string, kind: MirrorKind, call: OdooCall, companyId: number, budget: Budget): KindRunDeps {
  return {
    ...odooKindReaders(call, SPECS[kind], companyId),
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
    const budget: Budget = {
      left,
      canSpend: (units = 1) => Number.isInteger(units) && units >= 0 && calls + units <= maxCalls && Date.now() - started < timeBudget,
      spend: (units = 1) => {
        if (!Number.isInteger(units) || units < 0 || calls + units > maxCalls || Date.now() - started >= timeBudget) return false;
        calls += units;
        return true;
      },
      refund: (units = 1) => { if (Number.isInteger(units) && units > 0) calls = Math.max(0, calls - units); },
    };
    const call = bindCall(r.client);
    const capabilities = r.config.capabilities as CapabilitySnapshot | undefined;
    let skippedRows = 0;
    // The setup run's step runs once per tick, whether the kind reads finished or Odoo failed: a tick that cannot reach Odoo
    // must still count against the run (ECA-2: three failed ticks end it), or the run would sit open while Odoo is down.
    let stepsRun = false;
    const runAfterSweep = async () => {
      if (stepsRun) return;
      stepsRun = true;
      for (const step of AFTER_SWEEP) await step(sc, orgId, r, budget);
    };
    let outboxReconciled = 0;
    let outboxErrors: Array<{ id: string; error: string }> = [];
    let procurementOutboxReconciled = 0;
    let procurementOutboxSkipped = 0;
    let procurementOutboxBudgetExhausted = false;
    let procurementOutboxErrors: Array<{ id: string; error: string }> = [];
    let hold: PurchaseHold | null = null;
    let ledgerResult: LedgerPassResult | undefined;
    try {
      const assetKinds: AssetKind[] = (await equipmentFeedEmployed(sc, orgId)) ? ASSET_KINDS.filter((k) => assetReadable(capabilities, ASSET_KIND_SPECS[k].model)) : [];
      const kinds: MirrorKind[] = [...ODOO_KIND_ORDER.filter((kind) => readable(capabilities, KIND_SPECS[kind].model)), ...assetKinds];
      // Document feeds run after the directory (they map through it) and reserve a share of the tick, so the initial directory
      // scan cannot starve purchase or revenue reconciliation. The procurement switch is read here, once, before the purchase
      // domains are chosen: a held feed is simply absent from this tick's list, so it reserves no calls and its cursors stay put.
      hold = await procurementHold(sc, orgId);
      const procurementEmployed = !hold && await purchaseFeedEmployed(sc, orgId);
      const purchase = hold || !procurementEmployed ? [] : purchaseDomainsReadable(capabilities);
      const revenue = (await revenueFeedEmployed(sc, orgId)) ? revenueDomainsReadable(capabilities) : [];
      // The ledger pass runs last and keeps its share of the tick, so a purchase or revenue backlog cannot starve it either.
      const ledger = (await ledgerFeedEmployed(sc, orgId)) ? 1 : 0;
      // Outbound recovery runs before the bounded inbound walk, so a long backfill cannot leave a
      // committed money document unconfirmed. Procurement runs first to guarantee room for a
      // payment candidate's 20-call reservation; unused calls are refunded for revenue to use.
      const recoveryCap = maxCalls - RESERVE_PER_KIND * (kinds.length + purchase.length + revenue.length + ledger);
      const recoveryBudget: Budget = {
        left: () => calls < recoveryCap && left(),
        canSpend: (units = 1) => Number.isInteger(units) && units >= 0 && calls + units <= recoveryCap && left(),
        spend: (units = 1) => calls + units <= recoveryCap && budget.spend(units),
        refund: (units = 1) => budget.refund?.(units),
      };
      const recoveryDeadlineAt = Date.now() + Math.max(0, Math.min(
        ODOO_SWEEP_RECOVERY_TIME_BUDGET_MS,
        timeBudget - (Date.now() - started),
      ));
      const recoverRevenue = revenue.includes('sales-invoice');
      const recoverProcurement = purchase.length > 0;
      let recoveryCandidates: ReturnType<typeof parseOdooOutboxRecoveryCandidates> | undefined;
      if (recoverRevenue || recoverProcurement) {
        try {
          const { data, error } = await sc.rpc('outbox_reconcile_candidates', { p_org_id: orgId });
          if (error) throw error;
          recoveryCandidates = parseOdooOutboxRecoveryCandidates(data);
        } catch {
          if (recoverRevenue) outboxErrors = [{ id: 'revenue', error: 'recovery-unavailable' }];
          if (recoverProcurement) procurementOutboxErrors = [{ id: 'procurement', error: 'recovery-unavailable' }];
        }
      }
      if (recoverProcurement && recoveryCandidates) {
        try {
          const recovery = await reconcileOdooProcurementOutbox(sc, orgId, {
            timeBudgetMs: Math.max(0, recoveryDeadlineAt - Date.now()),
            callBudget: recoveryBudget,
            candidates: recoveryCandidates,
          });
          procurementOutboxReconciled = recovery.reconciled;
          procurementOutboxSkipped = recovery.skipped;
          procurementOutboxBudgetExhausted = recovery.budgetExhausted;
          procurementOutboxErrors = recovery.errors;
        } catch {
          procurementOutboxErrors = [{ id: 'procurement', error: 'recovery-unavailable' }];
        }
      } else if (recoverProcurement) {
        // Candidate read failed above; the per-pass error is already populated.
      } else if (hold) {
        procurementOutboxErrors = [{ id: 'procurement', error: 'procurement-feed-held' }];
      } else if (procurementEmployed) {
        procurementOutboxErrors = [{ id: 'procurement', error: 'procurement-feed-unreadable' }];
      } else {
        procurementOutboxErrors = [{ id: 'procurement', error: 'procurement-feed-not-employed' }];
      }
      if (recoverRevenue && recoveryCandidates) {
        try {
          const recovery = await reconcileOdooRevenueOutbox(sc, orgId, {
            timeBudgetMs: Math.max(0, recoveryDeadlineAt - Date.now()),
            callBudget: recoveryBudget,
            candidates: recoveryCandidates,
          });
          outboxReconciled = recovery.reconciled;
          outboxErrors = recovery.errors;
        } catch {
          outboxErrors = [{ id: 'revenue', error: 'recovery-unavailable' }];
        }
      }
      for (const [i, kind] of kinds.entries()) {
        const cap = maxCalls - RESERVE_PER_KIND * (kinds.length - 1 - i + purchase.length + revenue.length + ledger);
        const kindBudget: Budget = {
          left: () => calls < cap && left(),
          spend: (units = 1) => calls + units <= cap && budget.spend(units),
        };
        const deps = kindDeps(sc, orgId, kind, call, r.companyId!, kindBudget);
        const run = await runKind(SPECS[kind], await readCursor(sc, orgId, kind), deps);
        skippedRows += run.skipped;
        await AFTER_APPLY[kind as DirectoryKind]?.(sc, orgId, run.applied, started + timeBudget, call);
        if (run.done) await runCensus(await readCursor(sc, orgId, kind), deps);
      }
      for (const [i, domain] of purchase.entries()) {
        const cap = maxCalls - RESERVE_PER_KIND * (purchase.length - 1 - i + revenue.length + ledger);
        const passBudget: Budget = { left: () => calls < cap && left(), spend: () => calls < cap && budget.spend() };
        try {
          skippedRows += (await runPurchasePass(sc, orgId, domain, call, r.companyId!, passBudget)).skipped;
        } catch (err) {
          // One domain the database refuses (its cursor stays, so it is retried) must not starve the domains after it, the setup
          // run's step or the probe record. Odoo's own errors still end the tick through the catch below.
          if (err instanceof OdooError) throw err;
          console.error(`odoo purchase pass ${domain} failed`);
        }
      }
      for (const [i, domain] of revenue.entries()) {
        const cap = maxCalls - RESERVE_PER_KIND * (revenue.length - 1 - i + ledger);
        const passBudget: Budget = { left: () => calls < cap && left(), spend: () => calls < cap && budget.spend() };
        try {
          skippedRows += (await runRevenuePass(sc, orgId, domain, call, r.companyId!, passBudget)).skipped;
        } catch (err) {
          if (err instanceof OdooError) throw err;
          console.error(`odoo revenue pass ${domain} failed`);
        }
      }
      if (ledger) {
        const passBudget: Budget = { left: () => calls < maxCalls && left(), spend: () => calls < maxCalls && budget.spend() };   // last pass: takes what the others left, capped like them
        try {
          ledgerResult = await runLedgerPass(sc, orgId, call, r.companyId!, passBudget);
        } catch (err) {
          // Fails only this pass, never the tick: the other passes already ran, re-discovery below still runs, the cursor stays and the next tick retries.
          console.error('odoo ledger pass failed');
          if (err instanceof OdooError) ledgerResult = { rows: 0, caughtUp: false, skipped: 0, failed: err.errorClass };
        }
      }
      await runAfterSweep();
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
      return {
        ok: true, calls, skipped_rows: skippedRows, outbox_reconciled: outboxReconciled, outbox_errors: outboxErrors,
        outbox_procurement_reconciled: procurementOutboxReconciled, outbox_procurement_skipped: procurementOutboxSkipped,
        outbox_procurement_budget_exhausted: procurementOutboxBudgetExhausted,
        outbox_procurement_errors: procurementOutboxErrors, ...(hold ? { purchase_hold: hold } : {}), ...(ledgerResult ? { ledger: ledgerResult } : {}),
      };
    } catch (err) {
      if (!(err instanceof OdooError)) throw err;
      await runAfterSweep();
      await recordOdooProbe(sc, orgId, r.config, { ok: false, errorClass: err.errorClass });
      return {
        ok: true, calls, skipped_rows: skippedRows, outbox_reconciled: outboxReconciled, outbox_errors: outboxErrors,
        outbox_procurement_reconciled: procurementOutboxReconciled, outbox_procurement_skipped: procurementOutboxSkipped,
        outbox_procurement_budget_exhausted: procurementOutboxBudgetExhausted,
        outbox_procurement_errors: procurementOutboxErrors, failed: err.errorClass, ...(hold ? { purchase_hold: hold } : {}), ...(ledgerResult ? { ledger: ledgerResult } : {}),
      };
    }
  } finally {
    const { error } = await sc.rpc('release_erp_sweep_lock', { p_org_id: orgId, p_holder: holder });
    if (error) console.error('release_erp_sweep_lock failed');
  }
}
