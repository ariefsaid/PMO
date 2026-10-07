/**
 * AC-EXP-132 — client reads of the expense posting side mirror and the account map (#775 phase B, FR-EXP-116/117).
 * The supabase client is mocked at the module seam; the assertions are on the query each read issues and on the
 * row mapping the UI consumes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const calls: Array<[string, unknown[]]> = [];
  let result: { data: unknown; error: unknown } = { data: [], error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit']) {
    chain[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return {
    calls,
    from: vi.fn((table: string) => {
      calls.push(['from', [table]]);
      return chain;
    }),
    set: (r: typeof result) => {
      result = r;
    },
  };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listExpenseAccountMap, listExpensePostings } from './expensePostings';

beforeEach(() => {
  h.calls.length = 0;
  h.set({ data: [], error: null });
});

describe('expense posting reads (AC-EXP-132)', () => {
  it("AC-EXP-132 reads a claim's postings oldest first, bounded, and maps them", async () => {
    h.set({
      data: [{ id: 'm1', posting: 'approval', push_state: 'pushed', push_error: null, erp_name: 'ACC-JV-2026-00002',
        erp_cancelled_at: null, created_at: '2026-10-07T10:00:00Z' }],
      error: null,
    });
    expect(await listExpensePostings('claim-1')).toEqual([{ id: 'm1', posting: 'approval', pushState: 'pushed', pushError: null,
      erpName: 'ACC-JV-2026-00002', erpCancelledAt: null, createdAt: '2026-10-07T10:00:00Z' }]);
    expect(h.calls).toContainEqual(['from', ['expense_posting_erp_mirror']]);
    expect(h.calls).toContainEqual(['eq', ['claim_id', 'claim-1']]);
    expect(h.calls).toContainEqual(['order', ['created_at', { ascending: true }]]);
    expect(h.calls).toContainEqual(['limit', [50]]);
  });

  it('AC-EXP-132 reads the account map in key order', async () => {
    h.set({ data: [{ account_key: 'employee_payable', erp_account: 'Employee Payable - PSC', updated_at: 't' }], error: null });
    expect(await listExpenseAccountMap()).toEqual([{ accountKey: 'employee_payable', erpAccount: 'Employee Payable - PSC', updatedAt: 't' }]);
    expect(h.calls).toContainEqual(['from', ['expense_account_map']]);
    expect(h.calls).toContainEqual(['order', ['account_key', { ascending: true }]]);
  });

  it('AC-EXP-132 a null result is an empty list', async () => {
    h.set({ data: null, error: null });
    expect(await listExpensePostings('claim-1')).toEqual([]);
    expect(await listExpenseAccountMap()).toEqual([]);
  });

  it('AC-EXP-132 a read error throws with its code', async () => {
    h.set({ data: null, error: { message: 'permission denied', code: '42501' } });
    await expect(listExpensePostings('claim-1')).rejects.toMatchObject({ code: '42501' });
    await expect(listExpenseAccountMap()).rejects.toMatchObject({ code: '42501' });
  });
});
