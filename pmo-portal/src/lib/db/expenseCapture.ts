import { AppError } from '@/src/lib/appError';
import { supabase } from '@/src/lib/supabase/client';
import type { ExpenseClaimInput, ExpenseLineInput } from './expenseClaims';
import {
  EXPENSE_RECEIPTS_BUCKET, prepareReceiptUploadWithId,
  type ExpenseReceiptRow,
} from './expenseReceipts';

export interface ExpenseCaptureCommand {
  claimId: string;
  lineId: string | null;
  header: ExpenseClaimInput;
  firstLine: ExpenseLineInput | null;
}

interface ExpenseCaptureRpcArgs {
  p_claim_id: string;
  p_line_id: string | null;
  p_header: {
    title: string;
    purpose: string | null;
    projectId: string | null;
    budgetCategory: ExpenseClaimInput['budgetCategory'];
    advanceId: string | null;
  };
  p_first_line: ExpenseLineInput | null;
}

interface ExpenseCaptureRpcResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

type ExpenseCaptureRpc = (name: 'create_expense_capture', args: ExpenseCaptureRpcArgs) => PromiseLike<ExpenseCaptureRpcResult>;

/** Atomically creates a Draft claim and optional first line. Server-owned stamps and the claim total stay server-side. */
export async function createExpenseCapture(input: ExpenseCaptureCommand): Promise<string> {
  const { claimId, lineId, header, firstLine } = input;
  if (!claimId.trim() || header.kind !== 'claim') throw new AppError('Expense capture requires a claim and stable claim ID.', '22023');
  if (Boolean(firstLine) !== Boolean(lineId?.trim())) {
    throw new AppError('Expense capture line and stable line ID must be supplied together.', '22023');
  }

  const client = supabase as unknown as { rpc: ExpenseCaptureRpc };
  const { data, error } = await client.rpc('create_expense_capture', {
    p_claim_id: claimId,
    p_line_id: lineId,
    p_header: {
      title: header.title,
      purpose: header.purpose,
      projectId: header.projectId,
      budgetCategory: header.budgetCategory,
      advanceId: header.advanceId ?? null,
    },
    p_first_line: firstLine,
  });
  if (error) throw new AppError(error.message, error.code);
  if (data !== claimId) throw new AppError('Expense capture returned an unexpected claim identity.', 'P0002');
  return claimId;
}

export type ExpenseCaptureReceiptMetadata = Pick<ExpenseReceiptRow, 'id' | 'claim_id' | 'file_path'>;

/** Uses the existing claim RLS read to derive org scope and a caller-stable file ID to keep the path retryable. */
export async function prepareExpenseCaptureReceiptUpload(
  claimId: string,
  fileId: string,
  fileName: string,
): Promise<{ signedUrl: string; path: string }> {
  return prepareReceiptUploadWithId(claimId, fileId, fileName, true);
}

/** The stable file ID makes a lost metadata response reconcilable without creating a second receipt row. */
export async function confirmExpenseCaptureReceiptUpload(
  claimId: string,
  fileId: string,
  path: string,
  title: string | null = null,
): Promise<ExpenseReceiptRow> {
  const { data, error } = await supabase.from('expense_claim_files')
    .insert({ id: fileId, claim_id: claimId, file_path: path, title: title?.trim() || null })
    .select()
    .single();
  if (error) throw new AppError(error.message, error.code);
  return data as ExpenseReceiptRow;
}

export async function getExpenseCaptureReceipt(fileId: string): Promise<ExpenseCaptureReceiptMetadata | null> {
  const { data, error } = await supabase.from('expense_claim_files')
    .select('id, claim_id, file_path')
    .eq('id', fileId)
    .maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  return data as ExpenseCaptureReceiptMetadata | null;
}

export async function expenseCaptureReceiptObjectExists(path: string): Promise<boolean> {
  const slash = path.lastIndexOf('/');
  if (slash <= 0 || slash === path.length - 1) throw new AppError('Receipt upload path is invalid.', '22023');
  const folder = path.slice(0, slash);
  const fileName = path.slice(slash + 1);
  const { data, error } = await supabase.storage.from(EXPENSE_RECEIPTS_BUCKET).list(folder, { search: fileName });
  if (error) throw new AppError(error.message, error.name === 'StorageError' ? '42501' : undefined);
  return (data ?? []).some((item) => item.name === fileName);
}

export async function cleanupExpenseCaptureReceiptObject(path: string): Promise<void> {
  if (!path) return;
  const { error } = await supabase.storage.from(EXPENSE_RECEIPTS_BUCKET).remove([path]);
  if (error) throw new AppError(error.message, error.name === 'StorageError' ? '42501' : undefined);
}
