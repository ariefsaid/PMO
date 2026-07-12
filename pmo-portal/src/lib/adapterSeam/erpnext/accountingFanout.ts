/**
 * erpnext/accountingFanout.ts (task 7.5): the per-org accounting-snapshot fan-out the slice-8 sweep
 * calls AFTER the ledger-mirror feed (8.x) has refreshed erp_gl_entry_mirror / erp_payment_ledger_mirror.
 *
 * Per employing org: refreshActuals (reads the freshly-fed GL mirror) + refreshAging for AP + AR
 * (report-RPC primary, mirrored-ledger fallback). No cross-org state — each org reads only its own
 * mirror rows (RLS org_id) and a failure in one org is recorded WITHOUT blocking the others (sweep
 * resilience: one client's bench hiccup must not kill every org's refresh).
 *
 * The refreshers are INJECTED (deps) so this module is a thin orchestration seam; slice 8 wires the
 * real refreshActuals/refreshAging (and the ledger-mirror feed that runs before this). Importable by
 * Vitest (app) and the slice-8 sweep edge fn (Deno) — relative imports only.
 */
import type { ErpClientDeps } from './client.ts';
import type { ActualsScope, SnapshotServiceClient } from './actualsSnapshot.ts';
import type { AgingScope } from './agingSnapshot.ts';
import { refreshActuals } from './actualsSnapshot.ts';
import { refreshAging } from './agingSnapshot.ts';

export interface AccountingRefreshDeps {
  refreshActuals: typeof refreshActuals;
  refreshAging: typeof refreshAging;
}

export interface OrgAccountingScope {
  orgId: string;
  /** Per-org ERP client (site URL + creds) for the aging report RPC. */
  client: ErpClientDeps;
  actualsScope: ActualsScope;
  /** AP aging config (Accounts Payable → erp_ap_aging_snapshot). */
  apAgingScope: AgingScope;
  /** AR aging config (Accounts Receivable → erp_ar_aging_snapshot). */
  arAgingScope: AgingScope;
}

export interface OrgRefreshResult {
  orgId: string;
  /** Populated if ANY refresher for this org threw (the others still ran for the NEXT orgs). */
  error?: string;
}

/** Default deps: the real refreshers. Tests inject spies. */
const DEFAULT_DEPS: AccountingRefreshDeps = { refreshActuals, refreshAging };

/**
 * Fan out accounting-snapshot refresh across the employing orgs. Per org (sequentially, isolated):
 * refreshActuals → refreshAging(AP) → refreshAging(AR). An org's failure is recorded in its result and
 * does NOT abort the loop. Slice 8 runs this AFTER the ledger-mirror feed so the refreshers read the
 * freshly-fed mirrored rows.
 */
export async function refreshAccountingSnapshots(
  serviceClient: SnapshotServiceClient,
  orgs: OrgAccountingScope[],
  deps: AccountingRefreshDeps = DEFAULT_DEPS,
): Promise<OrgRefreshResult[]> {
  const results: OrgRefreshResult[] = [];
  for (const org of orgs) {
    try {
      await deps.refreshActuals(serviceClient, org.orgId, org.actualsScope);
      await deps.refreshAging(serviceClient, org.client, org.orgId, org.apAgingScope);
      await deps.refreshAging(serviceClient, org.client, org.orgId, org.arAgingScope);
      results.push({ orgId: org.orgId });
    } catch (err) {
      results.push({ orgId: org.orgId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
