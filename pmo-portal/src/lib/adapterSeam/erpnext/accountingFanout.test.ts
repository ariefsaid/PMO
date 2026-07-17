/**
 * erpnext/accountingFanout.ts (task 7.5): the per-org accounting-snapshot fan-out the slice-8 sweep
 * calls AFTER the ledger-mirror feed (8.x) has refreshed erp_gl_entry_mirror / erp_payment_ledger_mirror.
 * Per employing org: refreshActuals (reads the freshly-fed GL mirror) + refreshAging for AP + AR
 * (report-RPC primary, mirrored-ledger fallback). No cross-org state; each org reads only its own
 * mirror rows (RLS org_id). One org's failure does NOT block the others (sweep resilience).
 *
 * RED until accountingFanout.ts exists. The refreshers are INJECTED (deps) so the unit test spies them
 * — slice 8 wires the real refreshActuals/refreshAging.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshAccountingSnapshots, type OrgAccountingScope } from './accountingFanout.ts';

const refreshActuals = vi.fn(async () => {});
const refreshAging = vi.fn(async () => {});
const deps = { refreshActuals, refreshAging };

function org(orgId: string): OrgAccountingScope {
  return {
    orgId,
    client: { fetchImpl: async () => new Response('{}'), apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' },
    actualsScope: {},
    apAgingScope: { reportName: 'Accounts Payable', snapshotTable: 'erp_ap_aging_snapshot', filters: {}, reportVersion: 'v' },
    arAgingScope: { reportName: 'Accounts Receivable', snapshotTable: 'erp_ar_aging_snapshot', filters: {}, reportVersion: 'v' },
  };
}

describe('erpnext/accountingFanout — refreshAccountingSnapshots (task 7.5)', () => {
  beforeEach(() => {
    refreshActuals.mockClear();
    refreshAging.mockClear();
  });

  it('per employing org, calls refreshActuals ONCE + refreshAging TWICE (AP + AR)', async () => {
    const results = await refreshAccountingSnapshots({ from: async () => {} } as never, [org('org-1'), org('org-2')], deps);
    expect(refreshActuals).toHaveBeenCalledTimes(2); // once per org
    expect(refreshAging).toHaveBeenCalledTimes(4);   // AP + AR per org
    // args: refreshActuals(svc, orgId, actualsScope)
    expect(refreshActuals).toHaveBeenCalledWith(expect.anything(), 'org-1', {});
    expect(refreshActuals).toHaveBeenCalledWith(expect.anything(), 'org-2', {});
    // refreshAging(svc, client, orgId, agingScope) — AP then AR per org
    const agingCalls = refreshAging.mock.calls;
    expect(agingCalls[0]).toEqual([expect.anything(), expect.anything(), 'org-1', expect.objectContaining({ reportName: 'Accounts Payable' })]);
    expect(agingCalls[1]).toEqual([expect.anything(), expect.anything(), 'org-1', expect.objectContaining({ reportName: 'Accounts Receivable' })]);
    expect(agingCalls[2]).toEqual([expect.anything(), expect.anything(), 'org-2', expect.objectContaining({ reportName: 'Accounts Payable' })]);
    expect(agingCalls[3]).toEqual([expect.anything(), expect.anything(), 'org-2', expect.objectContaining({ reportName: 'Accounts Receivable' })]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => !r.error)).toBe(true); // all orgs clean
  });

  it('isolates failures — one org throwing does NOT block the next org (sweep resilience, no cross-org state)', async () => {
    refreshActuals.mockImplementationOnce(async () => { throw new Error('org-1 GL down'); });
    const results = await refreshAccountingSnapshots({ from: async () => {} } as never, [org('org-1'), org('org-2')], deps);
    // org-2 still fully refreshed despite org-1 failing
    expect(refreshActuals).toHaveBeenCalledWith(expect.anything(), 'org-2', {});
    expect(refreshAging).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'org-2', expect.objectContaining({ reportName: 'Accounts Receivable' }));
    // org-1's failure recorded, org-2 clean
    const org1 = results.find((r) => r.orgId === 'org-1');
    const org2 = results.find((r) => r.orgId === 'org-2');
    expect(org1?.error).toContain('org-1 GL down');
    expect(org2?.error).toBeUndefined();
  });

  it('an empty employing-orgs list is a no-op (returns [])', async () => {
    const results = await refreshAccountingSnapshots({ from: async () => {} } as never, [], deps);
    expect(results).toEqual([]);
    expect(refreshActuals).not.toHaveBeenCalled();
    expect(refreshAging).not.toHaveBeenCalled();
  });
});
