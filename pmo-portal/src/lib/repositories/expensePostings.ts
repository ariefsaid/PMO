/**
 * #775 phase B — client reads of the expense posting side mirror (0263 §3) and the account map (0263 §2). Both
 * are SELECT-only for clients; RLS scopes them (the claim's audience / the org). Writes to the map go through
 * `repositories.integrations.saveExpenseAccount` (the validating edge action), never a table write.
 */
import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { ExpenseAccountKey } from '@/src/lib/adapterSeam/erpnext/expenseAccountRules';
import type { ExpensePosting } from '@/src/lib/adapterSeam/erpnext/expensePostingKey';

export type ExpensePostingKind = ExpensePosting;
export type ExpensePushState = 'pending' | 'failed' | 'held' | 'pushed';

export interface ExpensePostingRow {
  id: string;
  posting: ExpensePostingKind;
  pushState: ExpensePushState;
  pushError: string | null;
  erpName: string | null;
  erpCancelledAt: string | null;
  createdAt: string;
}

export interface ExpenseAccountMapRow {
  accountKey: ExpenseAccountKey;
  erpAccount: string;
  updatedAt: string;
}

/** A claim has at most 4 postings (an advance one per cash return) — 50 is a generous, bounded read. */
export async function listExpensePostings(claimId: string): Promise<ExpensePostingRow[]> {
  const { data, error } = await supabase
    .from('expense_posting_erp_mirror')
    .select('id, posting, push_state, push_error, erp_name, erp_cancelled_at, created_at')
    .eq('claim_id', claimId)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).map((r) => ({
    id: r.id,
    posting: r.posting as ExpensePostingKind,
    pushState: r.push_state as ExpensePushState,
    pushError: r.push_error,
    erpName: r.erp_name,
    erpCancelledAt: r.erp_cancelled_at,
    createdAt: r.created_at,
  }));
}

export async function listExpenseAccountMap(): Promise<ExpenseAccountMapRow[]> {
  const { data, error } = await supabase
    .from('expense_account_map')
    .select('account_key, erp_account, updated_at')
    .order('account_key', { ascending: true });
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).map((r) => ({ accountKey: r.account_key as ExpenseAccountKey, erpAccount: r.erp_account, updatedAt: r.updated_at }));
}
