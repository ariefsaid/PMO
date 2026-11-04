/** One Odoo revenue feed pass for a verified org binding (FR-OCI-080..086, C6). */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import type { CapabilitySnapshot } from '../../../pmo-portal/src/lib/adapterSeam/odoo/discovery.ts';
import { REVENUE_FEED_DOMAINS, REVENUE_FEED_SPECS, revenueFeedReaders, type RevenueFeedDomain } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/feed.ts';
import { runCensus, runKind, type KindRunDeps } from '../../../pmo-portal/src/lib/adapterSeam/odoo/sweep.ts';

type Budget = { spend: () => boolean; left: () => boolean };

async function rpc(sc: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await sc.rpc(fn, args);
  if (error) throw new Error(`${fn} failed`);
  return data;
}

/** Revenue reads are enabled only after this org employs the Odoo revenue domain. */
export async function revenueFeedEmployed(sc: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await sc.from('external_domain_ownership').select('id')
    .eq('org_id', orgId).eq('external_tier', 'odoo').eq('domain', 'revenue').limit(1);
  if (error) throw new Error('could not read Odoo revenue ownership');
  return (data?.length ?? 0) > 0;
}

/** A missing/unreadable later model is skipped; it never advances that domain's cursor. */
export function revenueDomainsReadable(capabilities: CapabilitySnapshot | undefined): RevenueFeedDomain[] {
  const later = (capabilities as { later?: Record<string, boolean> } | undefined)?.later;
  return REVENUE_FEED_DOMAINS.filter((domain) => later?.[REVENUE_FEED_SPECS[domain].model] === true);
}

async function readCursor(sc: SupabaseClient, orgId: string, domain: RevenueFeedDomain): Promise<string> {
  const { data, error } = await sc.from('external_sync_watermarks').select('watermark_cursor')
    .eq('org_id', orgId).eq('external_tier', 'odoo').eq('domain', `revenue:${domain}`).maybeSingle();
  if (error) throw new Error('could not read Odoo revenue cursor');
  return (data?.watermark_cursor as string | undefined) ?? '';
}

export interface RevenuePassOpts { pageSize?: number; censusPageSize?: number; now?: () => Date }

/** Applies each page and its cursor through the same RPC, then runs the daily census when the feed catches up. */
export async function runRevenuePass(
  sc: SupabaseClient, orgId: string, domain: RevenueFeedDomain, call: OdooCall, companyId: number, budget: Budget, opts: RevenuePassOpts = {},
): Promise<{ skipped: number }> {
  const spec = REVENUE_FEED_SPECS[domain];
  const deps: KindRunDeps = {
    ...revenueFeedReaders(call, spec, companyId),
    apply: async (rows, cursor) => { await rpc(sc, 'apply_odoo_revenue_page', { p_org_id: orgId, p_domain: domain, p_rows: rows, p_cursor: cursor }); },
    censusSeen: async (run, ids) => { await rpc(sc, 'mark_odoo_revenue_census_seen', { p_org_id: orgId, p_domain: domain, p_run: run, p_ids: ids }); },
    censusFinish: async (run, cursor) => { await rpc(sc, 'finish_odoo_revenue_census', { p_org_id: orgId, p_domain: domain, p_run: run, p_cursor: cursor }); },
    budget,
    now: opts.now ?? (() => new Date()),
    ...(opts.pageSize ? { pageSize: opts.pageSize } : {}),
    ...(opts.censusPageSize ? { censusPageSize: opts.censusPageSize } : {}),
  };
  const run = await runKind(spec, await readCursor(sc, orgId, domain), deps);
  if (run.done) await runCensus(await readCursor(sc, orgId, domain), deps);
  return { skipped: run.skipped };
}
