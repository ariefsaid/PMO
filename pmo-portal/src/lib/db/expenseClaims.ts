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
