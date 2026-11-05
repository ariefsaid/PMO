import { describe, it, expect, vi, beforeEach } from 'vitest';

/** AC-EXP-050 — the claims DAL builds only what the 0247 grants admit, and never a silently trimmed list. */
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const rpcResult = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as string[], rpc: [] as Array<[string, unknown]>, insert: [] as unknown[], update: [] as unknown[],
    eq: [] as unknown[], order: [] as unknown[], range: [] as unknown[], select: [] as unknown[],
    gt: [] as unknown[], limit: [] as unknown[],
    delete: 0, single: 0, maybeSingle: 0,
  };
  /**
   * AC-DATA28 — an OPT-IN table-backed read fake, off unless a test sets `query.table`. It stands in for
   * PostgREST for ONE table: `.eq`/`.is` filters apply BEFORE the response cap, `.gt('id', cursor)` resumes
   * after the named row, and one request never returns more than `cap` rows (the real server truncates
   * silently there). Only the id order is modelled: a keyset scan of a claim's rows is by unique id, and the
   * DAL's own date ordering must be proven in memory — a fake that also sorted by date would hide the very
   * sort under test. Every request is recorded, so a test can prove the read is a keyset scan and not one
   * un-paged, capped one-shot.
   */
  const query = {
    table: null as string | null,
    rows: [] as Array<Record<string, unknown>>,
    cap: 1000,
    failAtCursor: null as string | null,
    error: { message: 'statement timeout', code: '57014' },
    reads: [] as Array<{
      table: string; eq: Array<[string, unknown]>; isNull: string[]; cursor: string | null;
      orders: Array<[string, unknown]>; limit: number | null;
    }>,
  };
  const state = {
    table: '', eq: [] as Array<[string, unknown]>, isNull: [] as string[], cursor: null as string | null,
    orders: [] as Array<[string, unknown]>, limit: null as number | null,
  };
  const resetState = (table: string) => {
    state.table = table; state.eq = []; state.isNull = []; state.cursor = null; state.orders = []; state.limit = null;
  };
  const serveTable = () => {
    query.reads.push({
      table: state.table, eq: [...state.eq], isNull: [...state.isNull], cursor: state.cursor,
      orders: [...state.orders], limit: state.limit,
    });
    if (query.failAtCursor !== null && state.cursor === query.failAtCursor) return { data: null, error: query.error };
    const rows = query.rows
      .filter((r) => state.eq.every(([c, v]) => r[c] === v) && state.isNull.every((c) => r[c] == null))
      .filter((r) => state.cursor === null || String(r.id) > state.cursor)
      .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
    const take = Math.min(state.limit ?? query.cap, query.cap);
    return { data: rows.slice(0, take), error: null };
  };
  const builder: Record<string, unknown> = {};
  const rec = (name: 'insert' | 'update' | 'eq' | 'order' | 'range' | 'select' | 'gt' | 'limit') => (...args: unknown[]) => {
    calls[name].push(args.length === 1 ? args[0] : args);
    return builder;
  };
  builder.select = rec('select'); builder.range = rec('range');
  builder.eq = (...args: unknown[]) => { rec('eq')(...args); state.eq.push(args as [string, unknown]); return builder; };
  builder.order = (...args: unknown[]) => { rec('order')(...args); state.orders.push(args as [string, unknown]); return builder; };
  builder.gt = (...args: unknown[]) => { rec('gt')(...args); state.cursor = String(args[1]); return builder; };
  builder.limit = (...args: unknown[]) => { rec('limit')(...args); state.limit = Number(args[0]); return builder; };
  builder.insert = rec('insert'); builder.update = rec('update');
  builder.delete = () => { calls.delete++; return builder; };
  builder.single = () => { calls.single++; return builder; };
  builder.maybeSingle = () => { calls.maybeSingle++; return builder; };
  builder.then = (resolve: (v: unknown) => unknown) => {
    if (query.table !== null && state.table === query.table) return resolve(serveTable());
    return resolve(result.value);
  };
  // `table` (when set) stands in for the server: PostgREST applies `.eq` filters BEFORE `.range` on a set-returning rpc.
  const rpcServer = { table: null as Array<Record<string, unknown>> | null, eq: [] as Array<[string, unknown]>, range: null as [number, number] | null };
  const rpcBuilder: Record<string, unknown> = {};
  rpcBuilder.range = (...args: unknown[]) => { calls.range.push(args); rpcServer.range = args as [number, number]; return rpcBuilder; };
  rpcBuilder.eq = (col: string, val: unknown) => { rpcServer.eq.push([col, val]); return rpcBuilder; };
  rpcBuilder.then = (resolve: (v: unknown) => unknown) => {
    if (!rpcServer.table) return resolve(rpcResult.value);
    let rows = rpcServer.table.filter((r) => rpcServer.eq.every(([c, v]) => r[c] === v));
    if (rpcServer.range) rows = rows.slice(rpcServer.range[0], rpcServer.range[1] + 1);
    return resolve({ data: rows, error: null });
  };
  const from = vi.fn((table: string) => { calls.from.push(table); resetState(table); return builder; });
  const rpc = vi.fn((name: string, args?: unknown) => { calls.rpc.push([name, args]); return rpcBuilder; });
  return { from, rpc, calls, result, rpcResult, rpcServer, query };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  listExpenseClaims, listExpenseClaimLines, createExpenseClaim, updateExpenseClaim, removeExpenseLine, transitionExpenseClaim,
  getExpenseClaimRoutes, getExpenseAdvanceAging, getExpenseAdvanceAgingTotals, recordExpenseAdvanceReturn, EXPENSE_LIST_LIMIT,
} from './expenseClaims';

beforeEach(() => {
  h.from.mockClear(); h.rpc.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    if (typeof h.calls[k] === 'number') (h.calls[k] as unknown) = 0;
    else (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
  h.rpcResult.value = { data: null, error: null };
  h.rpcServer.table = null; h.rpcServer.eq.length = 0; h.rpcServer.range = null;
  h.query.table = null; h.query.rows = []; h.query.failAtCursor = null; h.query.reads.length = 0;
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
  it('AC-IMP-084 a claim or an advance charged to a float sends imprest_float_id; none chosen sends none', async () => {
    h.result.value = { data: { id: 'c3' }, error: null };
    await createExpenseClaim({ kind: 'claim', title: 'T', purpose: null, projectId: 'p1', budgetCategory: 'Vehicle', imprestFloatId: 'f1' });
    expect(h.calls.insert[0]).toMatchObject({ imprest_float_id: 'f1' });
    await createExpenseClaim({ kind: 'advance', title: 'T', purpose: null, projectId: 'p1', budgetCategory: null, amount: 1, imprestFloatId: 'f1' });
    expect(h.calls.insert[1]).toMatchObject({ kind: 'advance', imprest_float_id: 'f1' });
    await createExpenseClaim({ kind: 'advance', title: 'T', purpose: null, projectId: 'p1', budgetCategory: null, amount: 1 });
    expect(h.calls.insert[2]).not.toHaveProperty('imprest_float_id');
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
  it('AC-IMP-084 an edit leaves imprest_float_id alone unless the patch names it', async () => {
    h.result.value = { data: [{ id: 'c1' }], error: null };
    await updateExpenseClaim('c1', 'claim', { title: 'T', purpose: null, projectId: null, budgetCategory: null, advanceId: null });
    expect(h.calls.update[0]).not.toHaveProperty('imprest_float_id');
    await updateExpenseClaim('c1', 'claim', { title: 'T', purpose: null, projectId: 'p1', budgetCategory: null, advanceId: null, imprestFloatId: null });
    expect(h.calls.update[1]).toMatchObject({ imprest_float_id: null });
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
    h.rpcResult.value = { data: [{ claim_id: 'c1', route: 'project', reason: 'within_budget', approvers: [{ id: 'u2', full_name: 'Ayu' }], request_amount: '400.00', line_budget: '1000.00', line_used: '0', is_exception: false }], error: null };
    await expect(getExpenseClaimRoutes(['c1'])).resolves.toEqual([
      { claimId: 'c1', route: 'project', reason: 'within_budget', approvers: [{ id: 'u2', fullName: 'Ayu' }], requestAmount: 400, lineBudget: 1000, lineUsed: 0, isException: false },
    ]);
  });
  it('AC-IMP-023 is_exception from the route read maps to isException', async () => {
    h.rpcResult.value = { data: [{ claim_id: 'c1', route: 'org', reason: 'within_budget', approvers: [], request_amount: '700', line_budget: null, line_used: null, is_exception: true }], error: null };
    await expect(getExpenseClaimRoutes(['c1'])).resolves.toMatchObject([{ claimId: 'c1', route: 'org', isException: true }]);
  });
  it('AC-EXP-050 aging numerics become numbers and the read is bounded', async () => {
    h.rpcResult.value = { data: [{ advance_id: 'a1', claim_number: 'ADV-1', claimant_id: 'u1', claimant_name: 'Eng', project_id: null, project_name: null, currency: 'IDR', amount: '500.00', settled: '0', returned: '100.00', outstanding: '400.00', paid_on: '2026-08-22', age_days: 45, bucket: '31-60' }], error: null };
    const out = await getExpenseAdvanceAging();
    expect(h.calls.range).toEqual([[0, 500]]);
    expect(out.rows[0]).toMatchObject({ advanceId: 'a1', outstanding: 400, returned: 100, ageDays: 45, bucket: '31-60' });
    expect(out.truncated).toBe(false);
  });
});

describe('AC-EXP-062 advance aging beyond the page cap', () => {
  const agingRow = (i: number, claimantId: string) => ({
    advance_id: `a${i}`, claim_number: `ADV-${i}`, claimant_id: claimantId, claimant_name: null, project_id: null, project_name: null,
    currency: 'IDR', amount: '100', settled: '0', returned: '0', outstanding: '100', paid_on: '2026-01-01', age_days: 10, bucket: '0-30',
  });
  it('AC-EXP-062 the own-advance read filters by claimant before the cap, so the claimant\'s 601st-oldest advance is returned', async () => {
    h.rpcServer.table = [...Array.from({ length: 600 }, (_, i) => agingRow(i, 'someone-else')), agingRow(600, 'me')];
    const out = await getExpenseAdvanceAging({ claimantId: 'me' });
    expect(out.rows.map((r) => r.advanceId)).toEqual(['a600']);
    expect(out.truncated).toBe(false);
  });
  it('AC-EXP-062 the unfiltered read stays capped and flags truncation', async () => {
    h.rpcServer.table = Array.from({ length: 600 }, (_, i) => agingRow(i, 'someone-else'));
    const out = await getExpenseAdvanceAging();
    expect(out.rows).toHaveLength(500);
    expect(out.truncated).toBe(true);
  });
  it('AC-EXP-062 bucket totals come from the aggregate rpc as numbers, not from the capped rows', async () => {
    h.rpcResult.value = { data: [
      { currency: 'IDR', bucket: '0-30', outstanding: '1250000.50', advance_count: 3 },
      { currency: 'IDR', bucket: '90+', outstanding: '40', advance_count: 1 },
    ], error: null };
    const out = await getExpenseAdvanceAgingTotals();
    expect(h.calls.rpc.at(-1)?.[0]).toBe('get_expense_advance_aging_totals');
    expect(out).toEqual({ IDR: { '0-30': 1250000.5, '31-60': 0, '61-90': 0, '90+': 40 } });
  });
  it('AC-EXP-062 a failed totals read throws instead of returning zeros', async () => {
    h.rpcResult.value = { data: null, error: { message: 'boom', code: '57014' } };
    await expect(getExpenseAdvanceAgingTotals()).rejects.toThrow('boom');
  });
});

/** AC-DATA28 — the claim-detail line read is a whole-set read, never a silently capped page. */
const uid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const CLAIM = 'claim-a';

function line(i: number, over: Record<string, unknown> = {}) {
  return {
    id: uid(i), org_id: 'org-1', claim_id: CLAIM, expense_date: '2026-03-01',
    expense_type: 'Travel', description: `Line ${i}`, amount: 1000 + i,
    created_at: '2026-03-01T00:00:00+00:00', ...over,
  };
}

describe('AC-DATA28 complete claim detail lines', () => {
  it('AC-DATA28 reads all 1001 visible lines once and excludes another claim', async () => {
    const visible = Array.from({ length: 1001 }, (_, i) => line(i));
    h.query.table = 'expense_claim_lines';
    h.query.rows = [...visible, line(2000, { claim_id: 'claim-b' })];
    const out = await listExpenseClaimLines(CLAIM);
    expect(out).toHaveLength(1001);
    expect(new Set(out.map((r) => r.id)).size).toBe(1001);
    for (const row of out) expect(row.claim_id).toBe(CLAIM);
    const byId = new Map(visible.map((r) => [r.id, r]));
    // Every field (amount, type, description, org, dates) survives exactly as stored.
    for (const row of out) expect(row).toEqual(byId.get(row.id));
  });

  it('AC-DATA28 scans by unique id keyset with the claim filter, a cursor and the page limit', async () => {
    h.query.table = 'expense_claim_lines';
    h.query.rows = Array.from({ length: 1001 }, (_, i) => line(i));
    await listExpenseClaimLines(CLAIM);
    expect(h.query.reads).toHaveLength(2);
    expect(h.query.reads[0]).toMatchObject({ table: 'expense_claim_lines', eq: [['claim_id', CLAIM]], cursor: null, limit: 1000 });
    expect(h.query.reads[0]!.orders).toEqual([['id', { ascending: true }]]);
    expect(h.query.reads[1]).toMatchObject({ eq: [['claim_id', CLAIM]], cursor: uid(999), limit: 1000 });
  });

  it('AC-DATA28 orders by expense date, then the actual timestamp instant, then id', async () => {
    // Fixture ids are scrambled against the intended order, and two pairs are chosen so a plain
    // lexicographic timestamp compare would sort them wrongly (offset text vs the real instant).
    const fixtures = [
      line(9, { expense_date: '2026-03-02', created_at: '2026-01-01T00:00:00+00:00' }),
      line(4, { created_at: '2026-03-01T02:30:00Z' }),
      line(7, { created_at: '2026-03-01T10:00:00+07:00' }), // = 03:00Z, ties with id 8
      line(2, { expense_date: '2026-02-28', created_at: '2026-12-31T23:59:59Z' }),
      line(8, { created_at: '2026-03-01T03:00:00Z' }),     // = 03:00Z, ties with id 7
      line(5, { created_at: '2026-03-01T09:00:00+07:00' }), // = 02:00Z, earlier than 02:30Z
    ];
    h.query.table = 'expense_claim_lines';
    h.query.rows = fixtures;
    const out = await listExpenseClaimLines(CLAIM);
    expect(out.map((r) => r.id)).toEqual([uid(2), uid(5), uid(4), uid(7), uid(8), uid(9)]);
    expect(out[0]).toEqual(fixtures[3]);
  });

  it('AC-DATA28 keeps microsecond chronology when the millisecond is identical', async () => {
    // PostgreSQL `timestamptz` stores microseconds. The earlier instant deliberately carries the HIGHER
    // id, so a millisecond-only compare would fall through to the id tie-break and reverse chronology.
    const fixtures = [
      line(10, { created_at: '2026-03-01T03:00:00.000999+00:00' }), // later instant, lower id
      line(20, { created_at: '2026-03-01T03:00:00.000001+00:00' }), // earlier instant, higher id
      line(30, { created_at: '2026-03-01T10:00:00.000400+07:00' }), // = 03:00:00.000400Z
      line(25, { created_at: '2026-03-01T03:00:00.000400Z' }),     // same instant as id 30 — tie by id
    ];
    h.query.table = 'expense_claim_lines';
    h.query.rows = fixtures;
    const out = await listExpenseClaimLines(CLAIM);
    expect(out.map((r) => r.id)).toEqual([uid(20), uid(25), uid(30), uid(10)]);
  });

  it('AC-DATA28 a claim with no lines returns an empty array', async () => {    h.query.table = 'expense_claim_lines';
    h.query.rows = [line(1, { claim_id: 'claim-b' })];
    await expect(listExpenseClaimLines(CLAIM)).resolves.toEqual([]);
  });

  it('AC-DATA28 exactly 1000 lines needs the extra empty read and returns them all once', async () => {
    h.query.table = 'expense_claim_lines';
    h.query.rows = Array.from({ length: 1000 }, (_, i) => line(i));
    const out = await listExpenseClaimLines(CLAIM);
    expect(out).toHaveLength(1000);
    expect(new Set(out.map((r) => r.id)).size).toBe(1000);
    expect(h.query.reads).toHaveLength(2);
    expect(h.query.reads[1]!.cursor).toBe(uid(999));
  });

  it('AC-DATA28 a page-2 error rejects with the real code instead of returning a partial list', async () => {
    h.query.table = 'expense_claim_lines';
    h.query.rows = Array.from({ length: 1001 }, (_, i) => line(i));
    h.query.failAtCursor = uid(999);
    await expect(listExpenseClaimLines(CLAIM)).rejects.toMatchObject({
      name: 'AppError', message: 'statement timeout', code: '57014',
    });
  });
});
