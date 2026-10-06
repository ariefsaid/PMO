# Plan part 3 — Expense claims (#775): data layer, rules, hooks, policy (Tasks 14–25)

Part of `docs/plans/2026-10-06-expense-claims.md`. Requires Task 12 (regenerated `database.types.ts`).
Vitest: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run <files>`.

### Task 14 — Widen `approvalRoute.ts` parameter types (no behaviour change)

In `pmo-portal/src/lib/procurement/approvalRoute.ts`:
- `mayDecideRoutedApproval(route: ApprovalRoute | null | undefined, …)` →
  `mayDecideRoutedApproval(route: Pick<ApprovalRoute, 'route' | 'approvers'> | null | undefined, …)`
- `approvalRouteNote(route: ApprovalRoute, …)` →
  `approvalRouteNote(route: Pick<ApprovalRoute, 'route' | 'reason' | 'approvers'>, …)`

Neither function reads `procurementId`, so expense routes can use both unchanged.
**Verify:** `cd "$WT/pmo-portal" && npm run typecheck && ../scripts/with-test-lock.sh npx vitest run src/lib/procurement/approvalRoute.test.ts` → 0 errors, all green.

### Task 15 — RED: claims DAL (AC-EXP-050)

Create `pmo-portal/src/lib/db/expenseClaims.test.ts`:

```ts
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
```

**Verify (RED):** `…npx vitest run src/lib/db/expenseClaims.test.ts` → fails: cannot resolve `./expenseClaims`.

### Task 16 — GREEN: `pmo-portal/src/lib/db/expenseClaims.ts`

```ts
import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import type { Database, Tables } from '@/src/lib/supabase/database.types';
import type { ApprovalRoute } from '@/src/lib/procurement/approvalRoute';

/**
 * Expense claims + cash advances DAL (#775, migration 0247, ADR-0078).
 *
 * The write topology is asymmetric on purpose:
 *  • header create/edit are table writes over GRANTED columns only. A claim's `amount` is the sum of its lines
 *    (a server trigger), so it is sent only for an advance; `org_id`, claimant, status, number, currency and every
 *    stamp are server-owned and never sent.
 *  • lines are plain writes, allowed only to the claimant while Draft/Rejected (RLS).
 *  • status moves only through `transition_expense_claim`; a cash return only through
 *    `record_expense_advance_return`.
 * Lists are bounded and report truncation — never a silently trimmed money list (money-path primer bucket 5).
 */

export type ExpenseClaimRow = Tables<'expense_claims'>;
export type ExpenseClaimLineRow = Tables<'expense_claim_lines'>;
export type ExpenseClaimStatus = Database['public']['Enums']['expense_claim_status'];
export type ExpenseKind = Database['public']['Enums']['expense_kind'];
export type ExpenseType = Database['public']['Enums']['expense_type'];
export type BudgetCategory = Database['public']['Enums']['budget_category'];

export type ExpenseClaimWithRefs = ExpenseClaimRow & {
  claimant: { full_name: string } | null;
  project: { name: string } | null;
};

export interface ExpenseClaimFilters {
  status?: ExpenseClaimStatus;
  kind?: ExpenseKind;
  budgetCategory?: BudgetCategory;
  projectId?: string;
}

export interface ExpenseClaimInput {
  kind: ExpenseKind;
  title: string;
  purpose: string | null;
  projectId: string | null;
  budgetCategory: BudgetCategory | null;
  /** Advances only. */
  amount?: number;
  /** Claims only — one of the claimant's own paid advances (DD-EXP-6). */
  advanceId?: string | null;
}
export type ExpenseClaimPatch = Omit<ExpenseClaimInput, 'kind'>;

export interface ExpenseLineInput {
  expenseDate: string;
  expenseType: ExpenseType;
  description: string;
  amount: number;
}

export type ExpenseClaimRoute = Omit<ApprovalRoute, 'procurementId'> & { claimId: string };

export type AgingBucket = '0-30' | '31-60' | '61-90' | '90+';
export interface ExpenseAdvanceAgingRow {
  advanceId: string;
  claimNumber: string | null;
  claimantId: string;
  claimantName: string | null;
  projectId: string | null;
  projectName: string | null;
  currency: string;
  amount: number;
  settled: number;
  returned: number;
  outstanding: number;
  paidOn: string | null;
  ageDays: number | null;
  bucket: AgingBucket;
}

export const EXPENSE_LIST_LIMIT = 200;
export const AGING_LIMIT = 500;

const SELECT = '*, claimant:profiles!expense_claims_claimant_id_fkey(full_name), project:projects(name)';

interface PostgrestErrorLike { message: string; code?: string }
function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

export async function listExpenseClaims(
  filters: ExpenseClaimFilters = {},
): Promise<{ rows: ExpenseClaimWithRefs[]; truncated: boolean }> {
  let q = supabase.from('expense_claims').select(SELECT);
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.kind) q = q.eq('kind', filters.kind);
  if (filters.budgetCategory) q = q.eq('budget_category', filters.budgetCategory);
  if (filters.projectId) q = q.eq('project_id', filters.projectId);
  // range is inclusive: 0..LIMIT reads LIMIT + 1 rows, the extra one only to detect truncation.
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(0, EXPENSE_LIST_LIMIT);
  if (error) throwWrite(error);
  const rows = (data ?? []) as unknown as ExpenseClaimWithRefs[];
  return { rows: rows.slice(0, EXPENSE_LIST_LIMIT), truncated: rows.length > EXPENSE_LIST_LIMIT };
}

export async function getExpenseClaim(id: string): Promise<ExpenseClaimWithRefs | null> {
  const { data, error } = await supabase.from('expense_claims').select(SELECT).eq('id', id).maybeSingle();
  if (error) throwWrite(error);
  return (data ?? null) as unknown as ExpenseClaimWithRefs | null;
}

export async function listExpenseClaimLines(claimId: string): Promise<ExpenseClaimLineRow[]> {
  const { data, error } = await supabase
    .from('expense_claim_lines')
    .select('*')
    .eq('claim_id', claimId)
    .order('expense_date', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throwWrite(error);
  return data ?? [];
}

export async function createExpenseClaim(input: ExpenseClaimInput): Promise<ExpenseClaimWithRefs> {
  const body: Record<string, unknown> = {
    kind: input.kind,
    title: input.title,
    purpose: input.purpose,
    project_id: input.projectId,
    budget_category: input.budgetCategory,
  };
  if (input.kind === 'advance') body.amount = input.amount ?? 0;
  if (input.kind === 'claim' && input.advanceId) body.advance_id = input.advanceId;
  const { data, error } = await supabase.from('expense_claims').insert(body as never).select(SELECT).single();
  if (error) throwWrite(error);
  return data as unknown as ExpenseClaimWithRefs;
}

export async function updateExpenseClaim(id: string, kind: ExpenseKind, patch: ExpenseClaimPatch): Promise<void> {
  const body: Record<string, unknown> = {
    title: patch.title,
    purpose: patch.purpose,
    project_id: patch.projectId,
    budget_category: patch.budgetCategory,
  };
  if (kind === 'advance') body.amount = patch.amount ?? 0;
  else body.advance_id = patch.advanceId ?? null;
  const { data, error } = await supabase.from('expense_claims').update(body as never).eq('id', id).select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Expense claim not found, or it can no longer be edited.');
}

export async function addExpenseLine(claimId: string, input: ExpenseLineInput): Promise<ExpenseClaimLineRow> {
  const { data, error } = await supabase
    .from('expense_claim_lines')
    .insert({ claim_id: claimId, expense_date: input.expenseDate, expense_type: input.expenseType, description: input.description, amount: input.amount })
    .select()
    .single();
  if (error) throwWrite(error);
  return data as ExpenseClaimLineRow;
}

export async function updateExpenseLine(id: string, input: ExpenseLineInput): Promise<void> {
  const { data, error } = await supabase
    .from('expense_claim_lines')
    .update({ expense_date: input.expenseDate, expense_type: input.expenseType, description: input.description, amount: input.amount })
    .eq('id', id)
    .select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Line not found, or the claim can no longer be edited.');
}

export async function removeExpenseLine(id: string): Promise<void> {
  const { data, error } = await supabase.from('expense_claim_lines').delete().eq('id', id).select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Line not found, or the claim can no longer be edited.');
}

export async function transitionExpenseClaim(
  id: string,
  to: ExpenseClaimStatus,
  opts?: { notes?: string | null; paymentReference?: string | null },
): Promise<void> {
  const { error } = await supabase.rpc('transition_expense_claim', {
    p_id: id,
    p_to: to,
    ...(opts?.notes ? { p_notes: opts.notes } : {}),
    ...(opts?.paymentReference ? { p_payment_reference: opts.paymentReference } : {}),
  });
  if (error) throwWrite(error);
}

export async function recordExpenseAdvanceReturn(id: string, amount: number, reference: string | null): Promise<void> {
  const { error } = await supabase.rpc('record_expense_advance_return', {
    p_id: id,
    p_amount: amount,
    ...(reference ? { p_reference: reference } : {}),
  });
  if (error) throwWrite(error);
}

export async function getExpenseAdvanceOutstanding(advanceId: string): Promise<number | null> {
  const { data, error } = await supabase.rpc('expense_advance_outstanding', { p_id: advanceId });
  if (error) throwWrite(error);
  return data == null ? null : Number(data);
}

interface RouteRpcRow {
  claim_id: string; route: string; reason: string; approvers: { id: string; full_name: string }[] | null;
  request_amount: number | string; line_budget: number | string | null; line_used: number | string | null;
}

export async function getExpenseClaimRoutes(ids: string[]): Promise<ExpenseClaimRoute[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.rpc('get_expense_claim_approval_routes', { p_ids: ids });
  if (error) throwWrite(error);
  return ((data ?? []) as unknown as RouteRpcRow[]).map((r) => ({
    claimId: r.claim_id,
    route: r.route as ExpenseClaimRoute['route'],
    reason: r.reason as ExpenseClaimRoute['reason'],
    approvers: (r.approvers ?? []).map((a) => ({ id: a.id, fullName: a.full_name })),
    requestAmount: Number(r.request_amount),
    lineBudget: r.line_budget == null ? null : Number(r.line_budget),
    lineUsed: r.line_used == null ? null : Number(r.line_used),
  }));
}

interface AgingRpcRow {
  advance_id: string; claim_number: string | null; claimant_id: string; claimant_name: string | null;
  project_id: string | null; project_name: string | null; currency: string; amount: number | string;
  settled: number | string; returned: number | string; outstanding: number | string; paid_on: string | null;
  age_days: number | null; bucket: AgingBucket;
}

export async function getExpenseAdvanceAging(): Promise<{ rows: ExpenseAdvanceAgingRow[]; truncated: boolean }> {
  const { data, error } = await supabase.rpc('get_expense_advance_aging').range(0, AGING_LIMIT);
  if (error) throwWrite(error);
  const raw = (data ?? []) as unknown as AgingRpcRow[];
  return {
    truncated: raw.length > AGING_LIMIT,
    rows: raw.slice(0, AGING_LIMIT).map((r) => ({
      advanceId: r.advance_id,
      claimNumber: r.claim_number,
      claimantId: r.claimant_id,
      claimantName: r.claimant_name,
      projectId: r.project_id,
      projectName: r.project_name,
      currency: r.currency,
      amount: Number(r.amount),
      settled: Number(r.settled),
      returned: Number(r.returned),
      outstanding: Number(r.outstanding),
      paidOn: r.paid_on,
      ageDays: r.age_days,
      bucket: r.bucket,
    })),
  };
}
```

**Verify (GREEN):** `…npx vitest run src/lib/db/expenseClaims.test.ts && npm run typecheck` → green, 0 errors.

### Task 17 — RED: receipts DAL (AC-EXP-051)

Create `pmo-portal/src/lib/db/expenseReceipts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** AC-EXP-051 — receipt objects land under the claim's org (read from the row, never the caller). */
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = { from: [] as string[], insert: [] as unknown[], update: [] as unknown[], signed: [] as string[] };
  const builder: Record<string, unknown> = {};
  const pass = () => builder;
  builder.select = pass; builder.eq = pass; builder.is = pass; builder.order = pass;
  builder.single = pass; builder.maybeSingle = pass;
  builder.insert = (b: unknown) => { calls.insert.push(b); return builder; };
  builder.update = (b: unknown) => { calls.update.push(b); return builder; };
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const storageFrom = vi.fn(() => ({
    createSignedUploadUrl: async (p: string) => { calls.signed.push(p); return { data: { signedUrl: 'https://signed', path: p }, error: null }; },
    createSignedUrl: async () => ({ data: { signedUrl: 'https://dl' }, error: null }),
    remove: async () => ({ data: null, error: null }),
  }));
  return { from, storageFrom, calls, result };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, storage: { from: h.storageFrom } } }));

import { prepareExpenseReceiptUpload, confirmExpenseReceiptUpload, archiveExpenseReceipt } from './expenseReceipts';

beforeEach(() => {
  h.from.mockClear(); h.storageFrom.mockClear();
  h.calls.from.length = 0; h.calls.insert.length = 0; h.calls.update.length = 0; h.calls.signed.length = 0;
  h.result.value = { data: null, error: null };
});

describe('AC-EXP-051 receipts', () => {
  it('AC-EXP-051 the object path is org/claim/file/name with the org read from the claim row', async () => {
    h.result.value = { data: { org_id: 'org-9' }, error: null };
    const out = await prepareExpenseReceiptUpload('claim-1', 'taxi receipt.pdf');
    expect(h.calls.from).toEqual(['expense_claims']);
    expect(h.storageFrom).toHaveBeenCalledWith('expense-receipts');
    const segments = out.path.split('/');
    expect(segments).toHaveLength(4);
    expect(segments[0]).toBe('org-9');
    expect(segments[1]).toBe('claim-1');
  });
  it('AC-EXP-051 a disallowed extension is refused before any call', async () => {
    await expect(prepareExpenseReceiptUpload('claim-1', 'evil.exe')).rejects.toThrow('File type not allowed (.exe)');
    expect(h.from).not.toHaveBeenCalled();
  });
  it('AC-EXP-051 confirm inserts only claim_id, file_path and title', async () => {
    h.result.value = { data: { id: 'f1' }, error: null };
    await confirmExpenseReceiptUpload('claim-1', 'org/claim-1/f/r.pdf', '  ');
    expect(h.calls.insert[0]).toEqual({ claim_id: 'claim-1', file_path: 'org/claim-1/f/r.pdf', title: null });
  });
  it('AC-EXP-051 an archive that lands nothing is a 42501', async () => {
    h.result.value = { data: [], error: null };
    await expect(archiveExpenseReceipt('f1')).rejects.toMatchObject({ code: '42501' });
  });
});
```

**Verify (RED):** `…npx vitest run src/lib/db/expenseReceipts.test.ts` → cannot resolve `./expenseReceipts`.

### Task 18 — GREEN: `pmo-portal/src/lib/db/expenseReceipts.ts`

```ts
import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import { sanitizeFilename } from '@/src/lib/storageKey';
import { SIGNED_URL_EXPIRY_SECONDS } from '@/src/lib/fileConstants';
import type { Tables } from '@/src/lib/supabase/database.types';

/**
 * Expense receipts (#775, migration 0247 §2/§5): rows in `expense_claim_files`, objects in the private
 * `expense-receipts` bucket at {org}/{claim}/{file}/{filename}. The org segment is read from the claim row,
 * never accepted from the caller (the procurementFiles/documents pattern). Storage RLS is the authority.
 */
export type ExpenseReceiptRow = Tables<'expense_claim_files'>;

const BUCKET = 'expense-receipts';
export const RECEIPT_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'] as const;
export const RECEIPT_INPUT_ACCEPT = RECEIPT_EXTENSIONS.join(',');

function throwWrite(error: { message: string; code?: string }): never {
  throw new AppError(error.message, error.code);
}
function throwStorage(error: { message: string; name?: string }): never {
  throwWrite({ message: error.message, code: error.name === 'StorageError' ? '42501' : undefined });
}

export function receiptExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
}

export function buildExpenseReceiptPath(orgId: string, claimId: string, fileId: string, fileName: string): string {
  return `${orgId}/${claimId}/${fileId}/${sanitizeFilename(fileName)}`;
}

export async function listExpenseReceipts(claimId: string): Promise<ExpenseReceiptRow[]> {
  const { data, error } = await supabase
    .from('expense_claim_files')
    .select('*')
    .eq('claim_id', claimId)
    .is('archived_at', null)
    .order('created_at', { ascending: false });
  if (error) throwWrite(error);
  return data ?? [];
}

export async function prepareExpenseReceiptUpload(claimId: string, fileName: string): Promise<{ signedUrl: string; path: string }> {
  const ext = receiptExtension(fileName);
  if (!(RECEIPT_EXTENSIONS as readonly string[]).includes(ext)) throw new AppError(`File type not allowed (${ext || 'none'})`);
  const { data: claim, error } = await supabase.from('expense_claims').select('org_id').eq('id', claimId).maybeSingle();
  if (error) throwWrite(error);
  if (!claim) throw new AppError('Expense claim not found');
  const path = buildExpenseReceiptPath((claim as { org_id: string }).org_id, claimId, crypto.randomUUID(), fileName);
  const { data, error: storageError } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (storageError) throwStorage(storageError);
  if (!data?.signedUrl) throw new AppError('Could not create upload URL');
  return { signedUrl: data.signedUrl, path: data.path };
}

export async function confirmExpenseReceiptUpload(claimId: string, path: string, title: string | null): Promise<ExpenseReceiptRow> {
  const { data, error } = await supabase
    .from('expense_claim_files')
    .insert({ claim_id: claimId, file_path: path, title: title?.trim() || null })
    .select()
    .single();
  if (error) throwWrite(error);
  return data as ExpenseReceiptRow;
}

export async function archiveExpenseReceipt(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('expense_claim_files')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throwWrite(error);
  assertWriteLanded(data, 'Receipt not found, or the claim can no longer be edited.');
}

export async function getExpenseReceiptUrl(path: string, opts?: { download?: boolean }): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS, opts?.download ? { download: path.split('/').pop() || 'receipt' } : undefined);
  if (error) throwStorage(error);
  if (!data?.signedUrl) throw new AppError('Could not generate download link');
  return data.signedUrl;
}

export async function cleanupExpenseReceiptObject(path: string): Promise<void> {
  if (!path) return;
  await supabase.storage.from(BUCKET).remove([path]);
}
```

**Verify (GREEN):** `…npx vitest run src/lib/db/expenseReceipts.test.ts && npm run typecheck` → green.

### Task 19 — Repository seam (AC-EXP-055)

**RED:** in `pmo-portal/src/lib/repositories/index.test.ts`, in the `'exposes one repository per entity'` key list add
`'expenseClaim', 'expenseReceipts',` (the list is `.sort()`ed, position is free) and append to its comment:
`// 'expenseClaim' + 'expenseReceipts' from #775 (migration 0247).`
`…npx vitest run src/lib/repositories/index.test.ts` → fails (two keys missing).

**GREEN:**
1. `pmo-portal/src/lib/repositories/types.ts` — add to the imports:
   ```ts
   import type {
     ExpenseClaimWithRefs, ExpenseClaimLineRow, ExpenseClaimFilters, ExpenseClaimInput, ExpenseClaimPatch,
     ExpenseLineInput, ExpenseClaimStatus, ExpenseKind, ExpenseClaimRoute, ExpenseAdvanceAgingRow,
   } from '@/src/lib/db/expenseClaims';
   import type { ExpenseReceiptRow } from '@/src/lib/db/expenseReceipts';
   ```
   add, next to `WorkOrderRepository`:
   ```ts
   /**
    * Expense claims and cash advances (#775, migration 0247). One-to-one with the DAL: header writes over granted
    * columns, lines as plain writes, every status move through the transition RPC, a cash return through its own
    * RPC — collapsing any pair would hide a control behind a convenience.
    */
   export interface ExpenseClaimRepository {
     list(filters?: ExpenseClaimFilters): Promise<{ rows: ExpenseClaimWithRefs[]; truncated: boolean }>;
     get(id: string): Promise<ExpenseClaimWithRefs | null>;
     lines(claimId: string): Promise<ExpenseClaimLineRow[]>;
     create(input: ExpenseClaimInput): Promise<ExpenseClaimWithRefs>;
     update(id: string, kind: ExpenseKind, patch: ExpenseClaimPatch): Promise<void>;
     addLine(claimId: string, input: ExpenseLineInput): Promise<ExpenseClaimLineRow>;
     updateLine(id: string, input: ExpenseLineInput): Promise<void>;
     removeLine(id: string): Promise<void>;
     transition(id: string, to: ExpenseClaimStatus, opts?: { notes?: string | null; paymentReference?: string | null }): Promise<void>;
     recordReturn(id: string, amount: number, reference: string | null): Promise<void>;
     outstanding(advanceId: string): Promise<number | null>;
     routes(ids: string[]): Promise<ExpenseClaimRoute[]>;
     aging(): Promise<{ rows: ExpenseAdvanceAgingRow[]; truncated: boolean }>;
   }

   export interface ExpenseReceiptRepository {
     list(claimId: string): Promise<ExpenseReceiptRow[]>;
     prepareUpload(claimId: string, fileName: string): Promise<{ signedUrl: string; path: string }>;
     confirmUpload(claimId: string, path: string, title: string | null): Promise<ExpenseReceiptRow>;
     archive(id: string): Promise<void>;
     getSignedUrl(path: string, opts?: { download?: boolean }): Promise<string>;
     cleanupObject(path: string): Promise<void>;
   }
   ```
   and in `interface Repositories` add `expenseClaim: ExpenseClaimRepository;` and
   `expenseReceipts: ExpenseReceiptRepository;`.
2. `pmo-portal/src/lib/repositories/index.ts` — after the `@/src/lib/db/workOrders` import block add:
   ```ts
   import {
     listExpenseClaims, getExpenseClaim, listExpenseClaimLines, createExpenseClaim, updateExpenseClaim,
     addExpenseLine, updateExpenseLine, removeExpenseLine, transitionExpenseClaim, recordExpenseAdvanceReturn,
     getExpenseAdvanceOutstanding, getExpenseClaimRoutes, getExpenseAdvanceAging,
   } from '@/src/lib/db/expenseClaims';
   import {
     listExpenseReceipts, prepareExpenseReceiptUpload, confirmExpenseReceiptUpload, archiveExpenseReceipt,
     getExpenseReceiptUrl, cleanupExpenseReceiptObject,
   } from '@/src/lib/db/expenseReceipts';
   ```
   add `ExpenseClaimRepository, ExpenseReceiptRepository,` to both `from './types'` type lists (the import one and
   the `export type { … }` one); after `const procurementFiles: ProcurementFileRepository = { … };` add:
   ```ts
   const expenseClaim: ExpenseClaimRepository = {
     list: (filters) => wrap(() => listExpenseClaims(filters)),
     get: (id) => wrap(() => getExpenseClaim(id)),
     lines: (claimId) => wrap(() => listExpenseClaimLines(claimId)),
     create: (input) => wrap(() => createExpenseClaim(input)),
     update: (id, kind, patch) => wrap(() => updateExpenseClaim(id, kind, patch)),
     addLine: (claimId, input) => wrap(() => addExpenseLine(claimId, input)),
     updateLine: (id, input) => wrap(() => updateExpenseLine(id, input)),
     removeLine: (id) => wrap(() => removeExpenseLine(id)),
     transition: (id, to, opts) => wrap(() => transitionExpenseClaim(id, to, opts)),
     recordReturn: (id, amount, reference) => wrap(() => recordExpenseAdvanceReturn(id, amount, reference)),
     outstanding: (advanceId) => wrap(() => getExpenseAdvanceOutstanding(advanceId)),
     routes: (ids) => wrap(() => getExpenseClaimRoutes(ids)),
     aging: () => wrap(() => getExpenseAdvanceAging()),
   };

   const expenseReceipts: ExpenseReceiptRepository = {
     list: (claimId) => wrap(() => listExpenseReceipts(claimId)),
     prepareUpload: (claimId, fileName) => wrap(() => prepareExpenseReceiptUpload(claimId, fileName)),
     confirmUpload: (claimId, path, title) => wrap(() => confirmExpenseReceiptUpload(claimId, path, title)),
     archive: (id) => wrap(() => archiveExpenseReceipt(id)),
     getSignedUrl: (path, opts) => wrap(() => getExpenseReceiptUrl(path, opts)),
     cleanupObject: (path) => wrap(() => cleanupExpenseReceiptObject(path)),
   };
   ```
   and add `expenseClaim,` and `expenseReceipts,` to `export const repositories: Repositories = { … }` after
   `procurementFiles,`.

**Verify:** `…npx vitest run src/lib/repositories/index.test.ts && npm run typecheck` → green.

### Task 20 — RED: pure rules (AC-EXP-052)

Create `pmo-portal/src/lib/expenses/expenseRules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { availableExpenseActions, settlementPreview, claimsAwaitingViewer, agingTotals } from './expenseRules';

const claim = (o: Partial<{ kind: 'claim' | 'advance'; status: string; claimant_id: string; approved_by_id: string | null }> = {}) =>
  ({ kind: 'claim', status: 'Draft', claimant_id: 'eng', approved_by_id: null, ...o }) as never;
const named = (id: string) => ({ route: 'project' as const, approvers: [{ id, fullName: 'N' }] });

describe('AC-EXP-052 availableExpenseActions mirrors transition_expense_claim', () => {
  it('AC-EXP-052 the claimant submits a Draft and cancels it; nobody else submits', () => {
    expect(availableExpenseActions({ claim: claim(), userId: 'eng', realRole: 'Engineer' })).toEqual(['submit', 'cancel']);
    expect(availableExpenseActions({ claim: claim(), userId: 'pm', realRole: 'Project Manager' })).toEqual([]);
  });
  it('AC-EXP-052 approve/reject: approval rank, not the claimant, and allowed by the route', () => {
    const submitted = claim({ status: 'Submitted' });
    expect(availableExpenseActions({ claim: submitted, userId: 'pm', realRole: 'Project Manager', route: null })).toEqual(['approve', 'reject']);
    expect(availableExpenseActions({ claim: submitted, userId: 'pm', realRole: 'Project Manager', route: named('other') })).toEqual([]);
    expect(availableExpenseActions({ claim: submitted, userId: 'pm', realRole: 'Project Manager', route: named('pm') })).toEqual(['approve', 'reject']);
    expect(availableExpenseActions({ claim: submitted, userId: 'e2', realRole: 'Engineer', route: null })).toEqual([]);
    expect(availableExpenseActions({ claim: claim({ status: 'Submitted', claimant_id: 'ad' }), userId: 'ad', realRole: 'Admin', route: null })).toEqual(['cancel']);
  });
  it('AC-EXP-052 pay: Finance or Admin, never the claimant or the approver', () => {
    const approved = claim({ status: 'Approved', approved_by_id: 'f1' });
    expect(availableExpenseActions({ claim: approved, userId: 'f2', realRole: 'Finance' })).toEqual(['pay', 'cancel']);
    expect(availableExpenseActions({ claim: approved, userId: 'f1', realRole: 'Finance' })).toEqual(['cancel']);
    expect(availableExpenseActions({ claim: approved, userId: 'eng', realRole: 'Engineer' })).toEqual([]);
  });
  it("AC-EXP-052 reopen is the claimant's; a paid advance with money out takes a return from Finance", () => {
    expect(availableExpenseActions({ claim: claim({ status: 'Rejected' }), userId: 'eng', realRole: 'Engineer' })).toEqual(['reopen']);
    const paidAdvance = claim({ kind: 'advance', status: 'Paid' });
    expect(availableExpenseActions({ claim: paidAdvance, userId: 'f1', realRole: 'Finance', advanceOutstanding: 400 })).toEqual(['recordReturn']);
    expect(availableExpenseActions({ claim: paidAdvance, userId: 'f1', realRole: 'Finance', advanceOutstanding: 0 })).toEqual([]);
  });
});

describe('AC-EXP-052 money is cent-exact', () => {
  it('AC-EXP-052 the advance pays first, the rest is cash', () => {
    expect(settlementPreview(300, 1000)).toEqual({ applied: 300, cash: 0 });
    expect(settlementPreview(900, 700)).toEqual({ applied: 700, cash: 200 });
    expect(settlementPreview(0.3, 0.1)).toEqual({ applied: 0.1, cash: 0.2 });
    expect(settlementPreview(50, null)).toEqual({ applied: 0, cash: 50 });
  });
  it('AC-EXP-052 aging totals sum per currency per bucket in cents', () => {
    expect(agingTotals([
      { currency: 'IDR', bucket: '0-30', outstanding: 0.1 },
      { currency: 'IDR', bucket: '0-30', outstanding: 0.2 },
      { currency: 'USD', bucket: '90+', outstanding: 5 },
    ])).toEqual({
      IDR: { '0-30': 0.3, '31-60': 0, '61-90': 0, '90+': 0 },
      USD: { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 5 },
    });
  });
});

describe('AC-EXP-052 claimsAwaitingViewer', () => {
  it('AC-EXP-052 keeps unrouted, flat and named rows; drops own and routed-elsewhere rows', () => {
    const row = (id: string, claimant: string, route: unknown) => ({ id, claim: { status: 'Submitted', claimant_id: claimant }, route }) as never;
    const rows = [
      row('own', 'pm', null), row('unrouted', 'e', null), row('flat', 'e', { route: 'flat', approvers: [] }),
      row('named', 'e', named('pm')), row('elsewhere', 'e', named('x')), row('adminOnly', 'e', { route: 'admin', approvers: [] }),
    ];
    expect(claimsAwaitingViewer(rows, 'pm', 'Project Manager').map((r: { id: string }) => r.id)).toEqual(['unrouted', 'flat', 'named']);
  });
});
```

**Verify (RED):** `…npx vitest run src/lib/expenses/expenseRules.test.ts` → cannot resolve `./expenseRules`.

### Task 21 — GREEN: `pmo-portal/src/lib/expenses/expenseRules.ts`

```ts
import type { Role } from '@/src/auth/AuthContext';
import { mayDecideRoutedApproval, type ApprovalRoute } from '@/src/lib/procurement/approvalRoute';
import type { AgingBucket, ExpenseAdvanceAgingRow, ExpenseClaimRow } from '@/src/lib/db/expenseClaims';

/**
 * #775 — the FE projection of `transition_expense_claim` / `record_expense_advance_return` (0247 §7/§9).
 * UX ONLY (ADR-0016): the RPCs decide. Pure — no I/O, no React. Money is computed in integer cents.
 */
export type ExpenseAction = 'submit' | 'reopen' | 'approve' | 'reject' | 'pay' | 'cancel' | 'recordReturn';

/** `holds_spend_approval_authority`: rank ≥ Project Manager (ADR-0070). */
const APPROVAL_RANK: readonly Role[] = ['Admin', 'Executive', 'Finance', 'Project Manager'];
/** Pay, cancel an approved record, record a return. */
const FINANCE_OR_ADMIN: readonly Role[] = ['Admin', 'Finance'];

type RouteShape = Pick<ApprovalRoute, 'route' | 'approvers'>;

export interface ExpenseActionContext {
  claim: Pick<ExpenseClaimRow, 'kind' | 'status' | 'claimant_id' | 'approved_by_id'>;
  userId: string | null | undefined;
  realRole: Role | null | undefined;
  route?: RouteShape | null;
  /** The advance's own outstanding (only read for a paid advance). */
  advanceOutstanding?: number | null;
}

export function availableExpenseActions(ctx: ExpenseActionContext): ExpenseAction[] {
  const { claim, userId, realRole } = ctx;
  if (!userId || !realRole) return [];
  const out: ExpenseAction[] = [];
  const isClaimant = claim.claimant_id === userId;
  const isAdmin = realRole === 'Admin';
  const financeOrAdmin = FINANCE_OR_ADMIN.includes(realRole);
  const s = claim.status;
  if (s === 'Draft' && isClaimant) out.push('submit');
  if (s === 'Rejected' && isClaimant) out.push('reopen');
  if (s === 'Submitted' && !isClaimant && APPROVAL_RANK.includes(realRole) && mayDecideRoutedApproval(ctx.route, userId, isAdmin)) {
    out.push('approve', 'reject');
  }
  if (s === 'Approved' && financeOrAdmin && !isClaimant && claim.approved_by_id !== userId) out.push('pay');
  if (((s === 'Draft' || s === 'Submitted') && (isClaimant || financeOrAdmin)) || (s === 'Approved' && financeOrAdmin)) {
    out.push('cancel');
  }
  if (claim.kind === 'advance' && s === 'Paid' && financeOrAdmin && !isClaimant && (ctx.advanceOutstanding ?? 0) > 0) {
    out.push('recordReturn');
  }
  return out;
}

const toCents = (v: number): number => Math.round(v * 100);

/** DD-EXP-6 at payment: the advance pays first, the rest is cash. */
export function settlementPreview(amount: number, advanceOutstanding: number | null | undefined): { applied: number; cash: number } {
  const amountC = toCents(amount);
  const outC = advanceOutstanding == null ? 0 : Math.max(toCents(advanceOutstanding), 0);
  const appliedC = Math.min(amountC, outC);
  return { applied: appliedC / 100, cash: (amountC - appliedC) / 100 };
}

interface AwaitingRow {
  claim: Pick<ExpenseClaimRow, 'status' | 'claimant_id'>;
  route: RouteShape | null;
}

/** The approvals inbox: an un-named Admin is not shown routed claims (the DD-APR-5 inbox rule), only `admin` ones. */
export function isAwaitingViewer(row: AwaitingRow, userId: string | null | undefined, realRole: Role | null | undefined): boolean {
  if (!userId || !realRole) return false;
  if (row.claim.status !== 'Submitted' || row.claim.claimant_id === userId) return false;
  if (!APPROVAL_RANK.includes(realRole)) return false;
  const route = row.route;
  if (!route || route.route === 'flat') return true;
  if (route.route === 'admin') return realRole === 'Admin';
  return route.approvers.some((a) => a.id === userId);
}

export function claimsAwaitingViewer<T extends AwaitingRow>(rows: T[], userId: string | null | undefined, realRole: Role | null | undefined): T[] {
  return rows.filter((r) => isAwaitingViewer(r, userId, realRole));
}

export const AGING_BUCKETS: readonly AgingBucket[] = ['0-30', '31-60', '61-90', '90+'];

export function agingTotals(
  rows: Pick<ExpenseAdvanceAgingRow, 'currency' | 'bucket' | 'outstanding'>[],
): Record<string, Record<AgingBucket, number>> {
  const cents: Record<string, Record<AgingBucket, number>> = {};
  for (const r of rows) {
    if (!cents[r.currency]) cents[r.currency] = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    cents[r.currency][r.bucket] += toCents(r.outstanding);
  }
  const out: Record<string, Record<AgingBucket, number>> = {};
  for (const [currency, b] of Object.entries(cents)) {
    out[currency] = { '0-30': b['0-30'] / 100, '31-60': b['31-60'] / 100, '61-90': b['61-90'] / 100, '90+': b['90+'] / 100 };
  }
  return out;
}
```

**Verify (GREEN):** `…npx vitest run src/lib/expenses/expenseRules.test.ts` → green.

### Task 22 — RED: hooks (AC-EXP-053)

Create `pmo-portal/src/hooks/useExpenseClaims.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { expenseClaim } = vi.hoisted(() => ({
  expenseClaim: {
    list: vi.fn(), get: vi.fn(), lines: vi.fn(), create: vi.fn(), update: vi.fn(), addLine: vi.fn(),
    updateLine: vi.fn(), removeLine: vi.fn(), transition: vi.fn(), recordReturn: vi.fn(), outstanding: vi.fn(),
    routes: vi.fn(), aging: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { expenseClaim } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));

import { useExpenseClaims, useExpenseClaimMutations, useExpenseClaimsAwaitingDecision, EXPENSE_QUERY_ROOTS } from './useExpenseClaims';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const fresh = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  for (const fn of Object.values(expenseClaim)) fn.mockReset();
  expenseClaim.list.mockResolvedValue({ rows: [{ id: 'c1', status: 'Submitted' }], truncated: false });
  expenseClaim.routes.mockResolvedValue([{ claimId: 'c1', route: 'flat', reason: 'no_project', approvers: [] }]);
  expenseClaim.transition.mockResolvedValue(undefined);
});

describe('AC-EXP-053 useExpenseClaims', () => {
  it('AC-EXP-053 the list is keyed by org and filters', async () => {
    const client = fresh();
    const { result } = renderHook(() => useExpenseClaims({ kind: 'claim' }), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(expenseClaim.list).toHaveBeenCalledWith({ kind: 'claim' });
    expect(client.getQueryData(['expense-claims', 'org-1', { kind: 'claim' }])).toBeTruthy();
  });

  it('AC-EXP-053 awaiting = Submitted rows plus ONE routes call', async () => {
    const client = fresh();
    const { result } = renderHook(() => useExpenseClaimsAwaitingDecision(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(expenseClaim.list).toHaveBeenCalledWith({ status: 'Submitted' });
    expect(expenseClaim.routes).toHaveBeenCalledTimes(1);
    expect(expenseClaim.routes).toHaveBeenCalledWith(['c1']);
    expect(result.current.data?.[0].route?.route).toBe('flat');
  });

  it('AC-EXP-053 a failed routes read leaves rows unrouted (the server still enforces)', async () => {
    expenseClaim.routes.mockRejectedValue(new Error('boom'));
    const client = fresh();
    const { result } = renderHook(() => useExpenseClaimsAwaitingDecision(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].route).toBeNull();
  });

  it('AC-EXP-053 a write invalidates every expense read', async () => {
    const client = fresh();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useExpenseClaimMutations(), { wrapper: wrap(client) });
    await act(async () => { await result.current.transition.mutateAsync({ id: 'c1', to: 'Submitted' }); });
    expect(expenseClaim.transition).toHaveBeenCalledWith('c1', 'Submitted', { notes: null, paymentReference: null });
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    for (const root of EXPENSE_QUERY_ROOTS) expect(keys).toContain(JSON.stringify([root]));
  });
});
```

**Verify (RED):** `…npx vitest run src/hooks/useExpenseClaims.test.tsx` → cannot resolve `./useExpenseClaims`.

### Task 23 — GREEN: `useExpenseClaims.ts` and `useExpenseReceipts.ts`

`pmo-portal/src/hooks/useExpenseClaims.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type {
  ExpenseClaimFilters, ExpenseClaimInput, ExpenseClaimPatch, ExpenseClaimRoute, ExpenseClaimStatus,
  ExpenseClaimWithRefs, ExpenseKind, ExpenseLineInput,
} from '@/src/lib/db/expenseClaims';

/** Expense claims (#775) over the repository seam (ADR-0017). Keys carry org_id (tenant scope). */
export const EXPENSE_QUERY_ROOTS = [
  'expense-claims', 'expense-claim', 'expense-claim-lines', 'expense-claim-route',
  'expense-advance-outstanding', 'expense-advance-aging', 'expense-claims-awaiting',
] as const;

export interface ExpenseClaimAwaiting {
  claim: ExpenseClaimWithRefs;
  route: ExpenseClaimRoute | null;
}

function useOrgId(): string | undefined {
  return useAuth().currentUser?.org_id;
}

export function useExpenseClaims(filters: ExpenseClaimFilters = {}) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['expense-claims', orgId, filters],
    queryFn: () => repositories.expenseClaim.list(filters),
    enabled: Boolean(orgId),
  });
}

export function useExpenseClaim(id: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['expense-claim', orgId, id],
    queryFn: () => repositories.expenseClaim.get(id as string),
    enabled: Boolean(orgId) && Boolean(id),
  });
}

export function useExpenseClaimLines(id: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['expense-claim-lines', orgId, id],
    queryFn: () => repositories.expenseClaim.lines(id as string),
    enabled: Boolean(orgId) && Boolean(id),
  });
}

/** The route of ONE Submitted record (detail page). */
export function useExpenseClaimRoute(id: string | undefined, status: ExpenseClaimStatus | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['expense-claim-route', orgId, id],
    queryFn: async () => (await repositories.expenseClaim.routes([id as string]))[0] ?? null,
    enabled: Boolean(orgId) && Boolean(id) && status === 'Submitted',
  });
}

export function useExpenseAdvanceOutstanding(advanceId: string | null | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['expense-advance-outstanding', orgId, advanceId],
    queryFn: () => repositories.expenseClaim.outstanding(advanceId as string),
    enabled: Boolean(orgId) && Boolean(advanceId),
  });
}

export function useExpenseAdvanceAging() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['expense-advance-aging', orgId],
    queryFn: () => repositories.expenseClaim.aging(),
    enabled: Boolean(orgId),
  });
}

/**
 * Submitted records with their routes: one list read + ONE routes call. A failed routes read leaves the rows
 * unrouted (the FR-APR-035 fallback): the inbox then shows them to every approval-rank viewer and the RPC still
 * refuses anyone the route excludes.
 */
export function useExpenseClaimsAwaitingDecision() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['expense-claims-awaiting', orgId],
    queryFn: async (): Promise<ExpenseClaimAwaiting[]> => {
      const { rows } = await repositories.expenseClaim.list({ status: 'Submitted' });
      const routes = await repositories.expenseClaim.routes(rows.map((r) => r.id)).catch(() => [] as ExpenseClaimRoute[]);
      const byId = new Map(routes.map((r) => [r.claimId, r]));
      return rows.map((claim) => ({ claim, route: byId.get(claim.id) ?? null }));
    },
    enabled: Boolean(orgId),
  });
}

interface UpdateArgs { id: string; kind: ExpenseKind; patch: ExpenseClaimPatch }
interface AddLineArgs { claimId: string; input: ExpenseLineInput }
interface UpdateLineArgs { id: string; input: ExpenseLineInput }
interface TransitionArgs { id: string; to: ExpenseClaimStatus; notes?: string | null; paymentReference?: string | null }
interface ReturnArgs { id: string; amount: number; reference: string | null }

/** Every write refreshes every expense read: list, record, lines, route, outstanding, aging and the inbox are
 *  views of one set of facts on screens that sit side by side. */
export function useExpenseClaimMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    for (const root of EXPENSE_QUERY_ROOTS) void qc.invalidateQueries({ queryKey: [root] });
  };
  const create = useMutation({ mutationFn: (input: ExpenseClaimInput) => repositories.expenseClaim.create(input), onSuccess: invalidate });
  const update = useMutation({ mutationFn: ({ id, kind, patch }: UpdateArgs) => repositories.expenseClaim.update(id, kind, patch), onSuccess: invalidate });
  const addLine = useMutation({ mutationFn: ({ claimId, input }: AddLineArgs) => repositories.expenseClaim.addLine(claimId, input), onSuccess: invalidate });
  const updateLine = useMutation({ mutationFn: ({ id, input }: UpdateLineArgs) => repositories.expenseClaim.updateLine(id, input), onSuccess: invalidate });
  const removeLine = useMutation({ mutationFn: (id: string) => repositories.expenseClaim.removeLine(id), onSuccess: invalidate });
  const transition = useMutation({
    mutationFn: ({ id, to, notes, paymentReference }: TransitionArgs) =>
      repositories.expenseClaim.transition(id, to, { notes: notes ?? null, paymentReference: paymentReference ?? null }),
    onSuccess: invalidate,
  });
  const recordReturn = useMutation({
    mutationFn: ({ id, amount, reference }: ReturnArgs) => repositories.expenseClaim.recordReturn(id, amount, reference),
    onSuccess: invalidate,
  });
  return { create, update, addLine, updateLine, removeLine, transition, recordReturn };
}
```

`pmo-portal/src/hooks/useExpenseReceipts.ts`:

```ts
import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { uploadWithProgress, classifyUploadError, type ClassifiedUploadError } from '@/src/lib/uploadTransport';
import { FILE_MIME_BY_EXT, MAX_FILE_SIZE_MB } from '@/src/lib/fileConstants';
import { receiptExtension } from '@/src/lib/db/expenseReceipts';

/** Receipts on one claim (#775) — the useProcurementFiles shape, bound to the `expense-receipts` bucket. */
export function useExpenseReceipts(claimId: string) {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const queryKey = ['expense-receipts', orgId, claimId] as const;
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<ClassifiedUploadError | null>(null);

  const list = useQuery({
    queryKey,
    queryFn: () => repositories.expenseReceipts.list(claimId),
    enabled: Boolean(orgId) && Boolean(claimId),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setProgress(0);
      setUploadError(null);
      const { signedUrl, path } = await repositories.expenseReceipts.prepareUpload(claimId, file.name);
      const contentType = FILE_MIME_BY_EXT[receiptExtension(file.name)] || file.type || 'application/octet-stream';
      await uploadWithProgress(signedUrl, file, { contentType, upsert: false, onProgress: (p) => setProgress(p) });
      try {
        return await repositories.expenseReceipts.confirmUpload(claimId, path, null);
      } catch (err) {
        // The object is in the bucket but its row was refused — remove the orphan, best effort (#78 pattern).
        repositories.expenseReceipts.cleanupObject(path).catch(() => {});
        throw err;
      }
    },
    onSuccess: () => {
      setProgress(null);
      void qc.invalidateQueries({ queryKey });
    },
    onError: (error: unknown) => {
      const classified = classifyUploadError(error, MAX_FILE_SIZE_MB);
      if (classified.type !== 'cancel') setUploadError(classified);
      setProgress(null);
    },
  });

  const archive = useMutation({
    mutationFn: (id: string) => repositories.expenseReceipts.archive(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey }),
  });

  const download = useCallback(
    (path: string, opts?: { download?: boolean }) => repositories.expenseReceipts.getSignedUrl(path, opts),
    [],
  );
  const clearUploadError = useCallback(() => setUploadError(null), []);

  return { list, upload, archive, download, progress, uploadError, clearUploadError };
}
```

**Verify (GREEN):** `…npx vitest run src/hooks/useExpenseClaims.test.tsx && npm run typecheck` → green.

### Task 24 — RED: policy (AC-EXP-054)

Append to `pmo-portal/src/auth/policy.test.ts`:

```ts
describe('can() — expenseClaim (#775; migration 0247 is the enforcement authority)', () => {
  it('AC-EXP-054 every role may view and raise their own claims', () => {
    expect(allowedRoles('view', 'expenseClaim')).toEqual(ALL_ROLES);
    expect(allowedRoles('create', 'expenseClaim')).toEqual(ALL_ROLES);
  });
  it('AC-EXP-054 only the claimant edits, and only while Draft or Rejected', () => {
    const own = (status: string) => ({ currentUserId: 'u1', record: { claimant_id: 'u1', status } });
    expect(allowedRoles('edit', 'expenseClaim', own('Draft'))).toEqual(ALL_ROLES);
    expect(allowedRoles('edit', 'expenseClaim', own('Rejected'))).toEqual(ALL_ROLES);
    expect(allowedRoles('edit', 'expenseClaim', own('Submitted'))).toEqual([]);
    expect(allowedRoles('edit', 'expenseClaim', { currentUserId: 'u2', record: { claimant_id: 'u1', status: 'Draft' } })).toEqual([]);
  });
});
```

**Verify (RED):** `…npx vitest run src/auth/policy.test.ts` → typecheck/assertion failure: `'expenseClaim'` is not an `Entity`.

### Task 25 — GREEN: `pmo-portal/src/auth/policy.ts`

Add `| 'expenseClaim'` to the `Entity` union (after `'workOrder'`), and in `POLICY` after the `workOrder` entry:

```ts
  /**
   * Expense claims and cash advances (#775, migration 0247). Mirrors the server:
   *   view/create ← every active member raises their own (RLS insert: claimant = auth.uid()); reads are RLS-scoped
   *                 to own ∪ approval rank, so the page is safe for every role.
   *   edit        ← the claimant only, while Draft/Rejected (RLS update policy + the 0247 §2 freeze).
   * Status moves are NOT modelled here — who may approve/pay/cancel/return depends on identity, route and SoD;
   * `availableExpenseActions` (src/lib/expenses/expenseRules.ts) projects that and the RPC decides.
   */
  expenseClaim: {
    view: allow(ALL),
    create: allow(ALL),
    edit: (role, ctx) =>
      has(ALL, role) &&
      !!ctx.currentUserId &&
      ctx.record?.claimant_id === ctx.currentUserId &&
      (ctx.record?.status === 'Draft' || ctx.record?.status === 'Rejected'),
  },
```

**Verify (GREEN):** `…npx vitest run src/auth/policy.test.ts && npm run typecheck` → green.

**Continue with `docs/plans/2026-10-06-expense-claims.part4-fe-ui.md`.**
