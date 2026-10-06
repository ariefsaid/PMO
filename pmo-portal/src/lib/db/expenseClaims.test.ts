import { describe, it, expect, vi, beforeEach } from 'vitest';

/** AC-EXP-050 — the claims DAL builds only what the 0247 grants admit, and never a silently trimmed list. */
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const rpcResult = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as string[], rpc: [] as Array<[string, unknown]>, insert: [] as unknown[], update: [] as unknown[],
    eq: [] as unknown[], order: [] as unknown[], range: [] as unknown[], select: [] as unknown[],
    delete: 0, single: 0, maybeSingle: 0,
  };
  const builder: Record<string, unknown> = {};
  const rec = (name: 'insert' | 'update' | 'eq' | 'order' | 'range' | 'select') => (...args: unknown[]) => {
    calls[name].push(args.length === 1 ? args[0] : args);
    return builder;
  };
  builder.select = rec('select'); builder.eq = rec('eq'); builder.order = rec('order'); builder.range = rec('range');
  builder.insert = rec('insert'); builder.update = rec('update');
  builder.delete = () => { calls.delete++; return builder; };
  builder.single = () => { calls.single++; return builder; };
  builder.maybeSingle = () => { calls.maybeSingle++; return builder; };
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const rpcBuilder: Record<string, unknown> = {};
  rpcBuilder.range = (...args: unknown[]) => { calls.range.push(args); return rpcBuilder; };
  rpcBuilder.then = (resolve: (v: unknown) => unknown) => resolve(rpcResult.value);
  const from = vi.fn((table: string) => { calls.from.push(table); return builder; });
  const rpc = vi.fn((name: string, args?: unknown) => { calls.rpc.push([name, args]); return rpcBuilder; });
  return { from, rpc, calls, result, rpcResult };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  listExpenseClaims, createExpenseClaim, updateExpenseClaim, removeExpenseLine, transitionExpenseClaim,
  getExpenseClaimRoutes, getExpenseAdvanceAging, recordExpenseAdvanceReturn, EXPENSE_LIST_LIMIT,
} from './expenseClaims';

beforeEach(() => {
  h.from.mockClear(); h.rpc.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    if (typeof h.calls[k] === 'number') (h.calls[k] as unknown) = 0;
    else (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
  h.rpcResult.value = { data: null, error: null };
});

describe('AC-EXP-050 create', () => {
  it('AC-EXP-050 a claim sends only the granted body — no amount, org, claimant, status, number or currency', async () => {
    h.result.value = { data: { id: 'c1' }, error: null };
    await createExpenseClaim({ kind: 'claim', title: 'Site visit', purpose: null, projectId: 'p1', budgetCategory: 'Special expenses', advanceId: null });
    expect(h.calls.insert[0]).toEqual({ kind: 'claim', title: 'Site visit', purpose: null, project_id: 'p1', budget_category: 'Special expenses' });
    for (const k of ['org_id', 'claimant_id', 'status', 'claim_number', 'currency', 'amount']) {
      expect(JSON.stringify(h.calls.insert[0])).not.toContain(k);
    }
  });
  it('AC-EXP-050 an advance sends its amount and never an advance link', async () => {
    h.result.value = { data: { id: 'a1' }, error: null };
    await createExpenseClaim({ kind: 'advance', title: 'Float', purpose: null, projectId: null, budgetCategory: null, amount: 500000, advanceId: 'x' });
    expect(h.calls.insert[0]).toEqual({ kind: 'advance', title: 'Float', purpose: null, project_id: null, budget_category: null, amount: 500000 });
  });
  it('AC-EXP-050 a claim linked to an advance sends advance_id', async () => {
    h.result.value = { data: { id: 'c2' }, error: null };
    await createExpenseClaim({ kind: 'claim', title: 'T', purpose: null, projectId: null, budgetCategory: null, advanceId: 'adv-1' });
    expect(h.calls.insert[0]).toMatchObject({ advance_id: 'adv-1' });
  });
});

describe('AC-EXP-050 list', () => {
  it('AC-EXP-050 applies filters, orders newest first and reads one sentinel row past the limit', async () => {
    h.result.value = { data: [{ id: 'a' }, { id: 'b' }], error: null };
    const out = await listExpenseClaims({ status: 'Submitted', kind: 'claim', budgetCategory: 'Special expenses' });
    expect(h.calls.eq).toEqual([['status', 'Submitted'], ['kind', 'claim'], ['budget_category', 'Special expenses']]);
    expect(h.calls.order).toEqual([['created_at', { ascending: false }], ['id', { ascending: false }]]);
    expect(h.calls.range).toEqual([[0, EXPENSE_LIST_LIMIT]]);
    expect(out).toEqual({ rows: [{ id: 'a' }, { id: 'b' }], truncated: false });
  });
  it('AC-EXP-050 reports truncation instead of silently dropping rows', async () => {
    h.result.value = { data: Array.from({ length: EXPENSE_LIST_LIMIT + 1 }, (_, i) => ({ id: String(i) })), error: null };
    const out = await listExpenseClaims();
    expect(out.rows).toHaveLength(EXPENSE_LIST_LIMIT);
    expect(out.truncated).toBe(true);
  });
});

describe('AC-EXP-050 writes', () => {
  it('AC-EXP-050 a claim header edit never sends amount; an advance edit does', async () => {
    h.result.value = { data: [{ id: 'c1' }], error: null };
    await updateExpenseClaim('c1', 'claim', { title: 'T', purpose: null, projectId: null, budgetCategory: null, amount: 9, advanceId: null });
    expect(h.calls.update[0]).toEqual({ title: 'T', purpose: null, project_id: null, budget_category: null, advance_id: null });
    await updateExpenseClaim('a1', 'advance', { title: 'T', purpose: null, projectId: null, budgetCategory: null, amount: 9, advanceId: 'x' });
    expect(h.calls.update[1]).toEqual({ title: 'T', purpose: null, project_id: null, budget_category: null, amount: 9 });
  });
  it('AC-EXP-050 a write that lands nothing is a 42501, not a silent success', async () => {
    h.result.value = { data: [], error: null };
    await expect(removeExpenseLine('l1')).rejects.toMatchObject({ code: '42501' });
  });
  it('AC-EXP-050 a transition sends the payment reference only when there is one', async () => {
    await transitionExpenseClaim('c1', 'Approved');
    await transitionExpenseClaim('c1', 'Paid', { notes: null, paymentReference: 'TRF-9' });
    expect(h.calls.rpc).toEqual([
      ['transition_expense_claim', { p_id: 'c1', p_to: 'Approved' }],
      ['transition_expense_claim', { p_id: 'c1', p_to: 'Paid', p_payment_reference: 'TRF-9' }],
    ]);
  });
  it('AC-EXP-050 a cash return passes amount and reference', async () => {
    await recordExpenseAdvanceReturn('a1', 100, 'Cash back');
    expect(h.calls.rpc[0]).toEqual(['record_expense_advance_return', { p_id: 'a1', p_amount: 100, p_reference: 'Cash back' }]);
  });
});

describe('AC-EXP-050 reads through RPCs', () => {
  it('AC-EXP-050 no ids means no routes call', async () => {
    await expect(getExpenseClaimRoutes([])).resolves.toEqual([]);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('AC-EXP-050 routes map to the shared ApprovalRoute shape', async () => {
    h.rpcResult.value = { data: [{ claim_id: 'c1', route: 'project', reason: 'within_budget', approvers: [{ id: 'u2', full_name: 'Ayu' }], request_amount: '400.00', line_budget: '1000.00', line_used: '0' }], error: null };
    await expect(getExpenseClaimRoutes(['c1'])).resolves.toEqual([
      { claimId: 'c1', route: 'project', reason: 'within_budget', approvers: [{ id: 'u2', fullName: 'Ayu' }], requestAmount: 400, lineBudget: 1000, lineUsed: 0 },
    ]);
  });
  it('AC-EXP-050 aging numerics become numbers and the read is bounded', async () => {
    h.rpcResult.value = { data: [{ advance_id: 'a1', claim_number: 'ADV-1', claimant_id: 'u1', claimant_name: 'Eng', project_id: null, project_name: null, currency: 'IDR', amount: '500.00', settled: '0', returned: '100.00', outstanding: '400.00', paid_on: '2026-08-22', age_days: 45, bucket: '31-60' }], error: null };
    const out = await getExpenseAdvanceAging();
    expect(h.calls.range).toEqual([[0, 500]]);
    expect(out.rows[0]).toMatchObject({ advanceId: 'a1', outstanding: 400, returned: 100, ageDays: 45, bucket: '31-60' });
    expect(out.truncated).toBe(false);
  });
});
