import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: vi.fn() } }));
import { getProjectOverviewRead } from './projectOverview';
import { getProjectFinances } from './revenue';
import { getProjectBilling } from './progressBilling';
import { getProjectCommittedSpend } from './procurements';

const PID = '06520000-0000-0000-0000-0000000000d1';
const FINANCES = {
  project_id: PID, contract_invoiced: '0', remaining_to_invoice: '1000.00', invoices: [], budget: null,
  actuals: { currency: null, as_of: null, total: null, excludes_restricted_rows: false, categories: [] },
};
const BILLING = {
  currency: 'IDR', contract_net: 5, work_billed: 1, dp_billed: 0, dp_recovered: 0, not_submitted: 0, assessment: { month: '2026-10-01', pct_complete: 40 },
  earned_value: 2, boq: [{ boq_item_id: 'b1', claimed_quantity: 3, assessed_quantity: null, earning_basis: 'unit_rate', ordered_quantity: 1, accepted_quantity: 1, closed_final: 0, earned_quantity: 1, contract_balance: 0, allocations: [] }],
};
const MILESTONE = { id: 'm1', project_id: PID, name: 'P1', sort_order: 1, target_date: null, weight: 1, input_pct: null, task_count: 0, calculated_pct: null, effective_pct: 0 };
const COMMITTED = [{ currency: 'IDR', amount: '1000', is_project_currency: true }, { currency: 'USD', amount: '50', is_project_currency: false }];
const ROW = {
  project_id: PID, finances: FINANCES, billing: BILLING, boq_items: [{ id: 'b1' }], budget_versions: null,
  committed_spend: COMMITTED, external_domain_ownership: [{ id: 'e1', org_id: 'o1', external_tier: 'erpnext', domain: 'procurement' }],
  reads_erp_ledger: true, milestones: [MILESTONE], comment_count: 2, org_default_currency: 'IDR', org_default_timezone: null,
};
const ALL = { money: true, commitments: true, budget: true };

beforeEach(() => h.rpc.mockReset());

describe('getProjectOverviewRead', () => {
  it('AC-PERF-007 each section parses to exactly what the per-endpoint read produces from the same payload', async () => {
    h.rpc.mockResolvedValue({ data: [ROW], error: null });
    const read = await getProjectOverviewRead(PID, ALL);
    h.rpc.mockResolvedValue({ data: FINANCES, error: null });
    expect(read.finances).toEqual(await getProjectFinances(PID));
    h.rpc.mockResolvedValue({ data: BILLING, error: null });
    expect(read.billing).toEqual(await getProjectBilling(PID));
    // The per-endpoint list pages through a query builder; both go through the one shared mapper.
    expect(read.milestones).toEqual([MILESTONE]);
    h.rpc.mockResolvedValue({ data: COMMITTED, error: null });
    expect(read.committedSpend).toEqual(await getProjectCommittedSpend(PID));
    expect(read.externalDomainOwnership).toEqual([{ id: 'e1', orgId: 'o1', externalTier: 'erpnext', domain: 'procurement' }]);
    expect(read.readsErpLedger).toBe(true);
    expect(read.commentCount).toBe(2);
    expect(read.fxContext).toEqual({ currency: 'IDR', timezone: 'UTC' });
    expect(read.budgetVersions).toBeNull();
  });

  it('AC-PERF-007 sends the flags and only parses the sections it asked for', async () => {
    h.rpc.mockResolvedValue({ data: [{ ...ROW, finances: null, billing: null, boq_items: null, committed_spend: null, external_domain_ownership: null, reads_erp_ledger: null, budget_versions: null }], error: null });
    const read = await getProjectOverviewRead(PID, { money: false, commitments: false, budget: false });
    expect(h.rpc).toHaveBeenCalledWith('get_project_overview_read', { p_project_id: PID, p_include_money: false, p_include_commitments: false, p_include_budget: false });
    expect(read.finances).toBeUndefined();
    expect(read.committedSpend).toBeUndefined();
    expect(read.budgetVersions).toBeUndefined();
  });

  it('AC-PERF-008 a refusal, a wrong project and a malformed money section are errors, never zeros', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'denied', code: '42501' } });
    await expect(getProjectOverviewRead(PID, ALL)).rejects.toMatchObject({ code: '42501' });
    h.rpc.mockResolvedValue({ data: [{ ...ROW, project_id: 'other' }], error: null });
    await expect(getProjectOverviewRead(PID, ALL)).rejects.toMatchObject({ code: 'invalid-project-overview' });
    h.rpc.mockResolvedValue({ data: [{ ...ROW, finances: { project_id: PID } }], error: null });
    await expect(getProjectOverviewRead(PID, ALL)).rejects.toMatchObject({ code: 'invalid-project-finances' });
  });
});
