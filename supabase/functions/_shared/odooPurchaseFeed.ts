/**
 * One Odoo purchase pass for one org (FR-OPP-080..085, plan P7): orders, incoming transfers, vendor bills and outbound supplier
 * payments ride the same resumable scan / keyset / overlap / census machinery as the O1 directory kinds (`runKind`,
 * `runCensus`), with two differences: the rows go to `apply_odoo_purchase_page` (which refreshes PMO's linked mirror rows and
 * lists the rest once; it creates no PMO row) and the cursor lives under `purchase:<domain>`. Cursors move only inside
 * `apply_odoo_purchase_page` / `finish_odoo_purchase_census`, so any failure leaves them in place and a replay is identical.
 * The org is the caller's verified binding; nothing here reads an org from Odoo or from a payload.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import type { CapabilitySnapshot } from '../../../pmo-portal/src/lib/adapterSeam/odoo/discovery.ts';
import { PURCHASE_DOMAINS, PURCHASE_SPECS, purchaseReaders, type PurchaseDomain } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/feed.ts';
import { runCensus, runKind, type KindRunDeps } from '../../../pmo-portal/src/lib/adapterSeam/odoo/sweep.ts';

type Budget = { spend: () => boolean; left: () => boolean };

async function rpc(sc: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await sc.rpc(fn, args);
  if (error) throw new Error(`${fn} failed`);
  return data;
}

/** The org has employed `procurement` under Odoo (migration 0505): only then does PMO mirror purchase documents from it. */
export async function purchaseFeedEmployed(sc: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await sc.from('external_domain_ownership').select('id').eq('org_id', orgId).eq('external_tier', 'odoo').eq('domain', 'procurement').limit(1);
  if (error) throw new Error('could not read the Odoo domain ownership');
  return (data?.length ?? 0) > 0;
}

/** A domain whose model discovery did not find present and readable is skipped (the connection is already degraded), never a failed tick. */
export function purchaseDomainsReadable(capabilities: CapabilitySnapshot | undefined): PurchaseDomain[] {
  const later = (capabilities as { later?: Record<string, boolean> } | undefined)?.later;
  return PURCHASE_DOMAINS.filter((d) => later?.[PURCHASE_SPECS[d].model] === true);
}

async function readCursor(sc: SupabaseClient, orgId: string, domain: PurchaseDomain): Promise<string> {
  const { data, error } = await sc.from('external_sync_watermarks').select('watermark_cursor')
    .eq('org_id', orgId).eq('external_tier', 'odoo').eq('domain', `purchase:${domain}`).maybeSingle();
  if (error) throw new Error('could not read the Odoo purchase cursor');
  return (data?.watermark_cursor as string | undefined) ?? '';
}

export interface PurchasePassOpts { pageSize?: number; censusPageSize?: number; now?: () => Date }

/** Feed pages until caught up or the budget is spent, then (when caught up) the daily census. Returns the rows skipped as unparseable. */
export async function runPurchasePass(
  sc: SupabaseClient, orgId: string, domain: PurchaseDomain, call: OdooCall, companyId: number, budget: Budget, opts: PurchasePassOpts = {},
): Promise<{ skipped: number }> {
  const spec = PURCHASE_SPECS[domain];
  const deps: KindRunDeps = {
    ...purchaseReaders(call, spec, companyId),
    apply: async (rows, cursor) => { await rpc(sc, 'apply_odoo_purchase_page', { p_org_id: orgId, p_domain: domain, p_rows: rows, p_cursor: cursor }); },
    censusSeen: async (run, ids) => { await rpc(sc, 'mark_odoo_purchase_census_seen', { p_org_id: orgId, p_domain: domain, p_run: run, p_ids: ids }); },
    censusFinish: async (run, cursor) => { await rpc(sc, 'finish_odoo_purchase_census', { p_org_id: orgId, p_domain: domain, p_run: run, p_cursor: cursor }); },
    budget,
    now: opts.now ?? (() => new Date()),
    ...(opts.pageSize ? { pageSize: opts.pageSize } : {}),
    ...(opts.censusPageSize ? { censusPageSize: opts.censusPageSize } : {}),
  };
  const run = await runKind(spec, await readCursor(sc, orgId, domain), deps);
  if (run.done) await runCensus(await readCursor(sc, orgId, domain), deps);
  return { skipped: run.skipped };
}
