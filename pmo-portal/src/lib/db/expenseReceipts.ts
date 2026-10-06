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
