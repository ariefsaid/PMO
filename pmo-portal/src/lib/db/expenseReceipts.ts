import { toStorageAppError } from '@/src/lib/storageError';
import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import { fetchAllRowsByKeyset } from '@/src/lib/pagedRead';
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
export const EXPENSE_RECEIPTS_BUCKET = BUCKET;
export const RECEIPT_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'] as const;
export const RECEIPT_INPUT_ACCEPT = RECEIPT_EXTENSIONS.join(',');

function throwWrite(error: { message: string; code?: string }): never {
  throw new AppError(error.message, error.code);
}
function throwStorage(error: { message: string; status?: number | string; statusCode?: string; code?: string }): never {
  throw toStorageAppError(error);
}

export function receiptExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
}

export function buildExpenseReceiptPath(orgId: string, claimId: string, fileId: string, fileName: string): string {
  return `${orgId}/${claimId}/${fileId}/${sanitizeFilename(fileName)}`;
}

/** Byte-wise string compare — `localeCompare` would order ids by locale, not by the value. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The instant of a PostgREST `timestamptz` in MICROSECONDS since the epoch. `Date.parse` keeps only
 * milliseconds while PostgreSQL stores microseconds (migration 0247 does not narrow precision), so
 * `…:00.000001Z` and `…:00.000999Z` would compare equal and fall through to the id tie-break, reversing
 * real chronology. The UTC offset is normalised, so `…T03:00:00.000400Z` and
 * `…T10:00:00.000400+07:00` are the same instant.
 */
function instantMicros(value: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) return Date.parse(value) * 1000;
  return Date.parse(`${m[1]}T${m[2]}${m[4]}`) * 1000 + Number((m[3] ?? '').padEnd(6, '0').slice(0, 6));
}

/**
 * Newest first by the ACTUAL instant of `created_at` (never a textual timestamp compare — offsets and
 * microseconds both matter), with `id` ascending as the deterministic tie-break.
 */
function compareReceiptsNewestFirst(a: ExpenseReceiptRow, b: ExpenseReceiptRow): number {
  const aAt = instantMicros(a.created_at);
  const bAt = instantMicros(b.created_at);
  if (aAt !== bAt) return aAt < bAt ? 1 : -1;
  return compareText(a.id, b.id);
}

/**
 * EVERY live (unarchived) receipt of one claim. A one-shot read is capped by PostgREST (`db-max-rows`) with
 * no error, so a claim with more files than one response would silently hide receipts; the scan is keyed on
 * the unique `id` (see `pagedRead`), then the newest-first order is restored in memory.
 */
export async function listExpenseReceipts(claimId: string): Promise<ExpenseReceiptRow[]> {
  const rows = await fetchAllRowsByKeyset<ExpenseReceiptRow>(async (afterId, limit) => {
    let query = supabase
      .from('expense_claim_files')
      .select('*')
      .eq('claim_id', claimId)
      .is('archived_at', null)
      .order('id', { ascending: true });
    if (afterId !== null) query = query.gt('id', afterId);
    const { data, error } = await query.limit(limit);
    return { data, error };
  });
  return rows.sort(compareReceiptsNewestFirst);
}

export async function prepareReceiptUploadWithId(
  claimId: string,
  fileId: string,
  fileName: string,
  stable: boolean,
  onPath?: (path: string) => Promise<boolean>,
): Promise<{ signedUrl: string; path: string; objectExists?: boolean; objectExistsError?: unknown }> {
  const ext = receiptExtension(fileName);
  if (!(RECEIPT_EXTENSIONS as readonly string[]).includes(ext)) throw new AppError(`File type not allowed (${ext || 'none'})`);
  if (stable && !fileId.trim()) throw new AppError('Receipt capture requires a stable file ID.', '22023');
  const { data: claim, error } = await supabase.from('expense_claims').select('org_id').eq('id', claimId).maybeSingle();
  if (error) throwWrite(error);
  if (!claim) throw new AppError('Expense claim not found');
  const path = buildExpenseReceiptPath((claim as { org_id: string }).org_id, claimId, fileId, fileName);
  const signedUpload = supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  const [signedResult, recovery] = await Promise.all([signedUpload, onPath?.(path).then(
    (objectExists) => ({ objectExists }), (objectExistsError: unknown) => ({ objectExistsError }),
  )]);
  const { data, error: storageError } = signedResult;
  if (storageError) throwStorage(storageError);
  if (stable && (!data?.signedUrl || data.path !== path)) throw new AppError('Could not create a stable receipt upload URL.');
  if (!data?.signedUrl) throw new AppError('Could not create upload URL');
  return { signedUrl: data.signedUrl, path: data.path, ...recovery };
}

export async function prepareExpenseReceiptUpload(claimId: string, fileName: string): Promise<{ signedUrl: string; path: string }> {
  return prepareReceiptUploadWithId(claimId, crypto.randomUUID(), fileName, false);
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
