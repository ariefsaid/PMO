import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { sanitizeFilename } from '@/src/lib/storageKey';
import {
  ALLOWED_FILE_TYPES,
  DENIED_EXTENSIONS,
  SIGNED_URL_EXPIRY_SECONDS,
} from '@/src/lib/fileConstants';
import type { Tables } from '@/src/lib/supabase/database.types';

/**
 * Procurement attachments DAL — many files per procurement PHASE row (ADR-0023).
 *
 * Three typed per-phase child tables: procurement_quotation_files /
 * procurement_receipt_files / procurement_invoice_files. Each row points at its phase
 * parent (quotation / receipt / invoice) and carries a `file_path` into the private
 * `procurement-files` storage bucket (path: {org}/{proc}/{phase}/{file_id}/{filename}).
 *
 * org_id is NEVER sent from the client — the column default + the *_write RLS policy
 * (org = auth_org_id() AND the 4 writer roles AND the parent is in-org) are the authority
 * (migration 0028). Every write throws an `AppError` preserving the Postgres `code` so the
 * UI can classify the toast via `classifyMutationError`. Deletes are SOFT (archived_at).
 */

export type ProcPhase = 'quotation' | 'receipt' | 'invoice';

export type ProcurementQuotationFileRow = Tables<'procurement_quotation_files'>;
export type ProcurementReceiptFileRow = Tables<'procurement_receipt_files'>;
export type ProcurementInvoiceFileRow = Tables<'procurement_invoice_files'>;

/** The shared row shape returned to the UI (all three tables share these columns). */
export interface ProcurementFileRow {
  id: string;
  org_id: string;
  title: string | null;
  file_path: string | null;
  uploaded_by_id: string | null;
  created_at: string;
  archived_at: string | null;
  /** The owning parent id (quotation_id | receipt_id | invoice_id), normalized. */
  parent_id: string;
}

/** Phase → the parent FK column on its child table (used to normalize rows). */
const PARENT_COL_BY_PHASE: Record<ProcPhase, 'quotation_id' | 'receipt_id' | 'invoice_id'> = {
  quotation: 'quotation_id',
  receipt: 'receipt_id',
  invoice: 'invoice_id',
};

const BUCKET = 'procurement-files';

/** Shape of a PostgREST/Postgres/Storage error we surface (only the fields we read). */
interface PostgrestErrorLike {
  message: string;
  code?: string;
  name?: string;
}

/**
 * Throws an `AppError` preserving the verbatim message AND the Postgres error `code`
 * (e.g. `42501` RLS-rejected) so the UI can classify the toast.
 */
function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/** Normalize a Supabase StorageError into a code-bearing throw (42501 for access errors). */
function throwStorage(error: { message: string; name?: string }): never {
  throwWrite({ message: error.message, code: error.name === 'StorageError' ? '42501' : undefined });
}

const nullable = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot >= 0 ? fileName.slice(lastDot).toLowerCase() : '';
}

function validateUploadExtension(fileName: string): void {
  const ext = getFileExtension(fileName);
  if (DENIED_EXTENSIONS.includes(ext) || !ALLOWED_FILE_TYPES.includes(ext)) {
    throw new AppError(`File type not allowed (${ext})`);
  }
}

/**
 * Build the full storage object path for a procurement phase file (FR-PF-003).
 * Pattern: {org_id}/{procurement_id}/{phase}/{file_id}/{sanitized_filename} — 5 segments.
 * The filename is sanitized (path-traversal stripped) before becoming the last segment.
 */
export function buildProcurementFilePath(
  orgId: string,
  procurementId: string,
  phase: ProcPhase,
  fileId: string,
  filename: string,
): string {
  return `${orgId}/${procurementId}/${phase}/${fileId}/${sanitizeFilename(filename)}`;
}

/** Map a raw child row to the normalized `ProcurementFileRow` (parent FK → parent_id). */
function normalizeRow(phase: ProcPhase, row: Record<string, unknown>): ProcurementFileRow {
  const parentCol = PARENT_COL_BY_PHASE[phase];
  return {
    id: row.id as string,
    org_id: row.org_id as string,
    title: (row.title as string | null) ?? null,
    file_path: (row.file_path as string | null) ?? null,
    uploaded_by_id: (row.uploaded_by_id as string | null) ?? null,
    created_at: row.created_at as string,
    archived_at: (row.archived_at as string | null) ?? null,
    parent_id: row[parentCol] as string,
  };
}

/**
 * List the non-archived files for a phase parent (FR-PF-004), newest first. org_id is
 * NEVER sent — RLS (*_select: org_id = auth_org_id()) scopes the rows. Throws on failure.
 */
export async function listProcurementFiles(
  phase: ProcPhase,
  parentId: string,
): Promise<ProcurementFileRow[]> {
  // The three child tables share an identical column shape; the only difference is the
  // parent-FK column. We branch per-phase so each `.from('<literal>')` resolves to a single
  // concrete PostgREST table type (a union table collapses chained column args to `never`),
  // then normalize the rows to the shared `ProcurementFileRow`.
  const base = (rows: unknown) =>
    ((rows ?? []) as Record<string, unknown>[]).map((r) => normalizeRow(phase, r));

  if (phase === 'quotation') {
    const { data, error } = await supabase
      .from('procurement_quotation_files')
      .select('*')
      .eq('quotation_id', parentId)
      .is('archived_at', null)
      .order('created_at', { ascending: false });
    if (error) throwWrite(error);
    return base(data);
  }
  if (phase === 'receipt') {
    const { data, error } = await supabase
      .from('procurement_receipt_files')
      .select('*')
      .eq('receipt_id', parentId)
      .is('archived_at', null)
      .order('created_at', { ascending: false });
    if (error) throwWrite(error);
    return base(data);
  }
  const { data, error } = await supabase
    .from('procurement_invoice_files')
    .select('*')
    .eq('invoice_id', parentId)
    .is('archived_at', null)
    .order('created_at', { ascending: false });
  if (error) throwWrite(error);
  return base(data);
}

/**
 * Prepare a signed upload URL for a procurement phase file (FR-PF-003). Mints a fresh
 * `file_id` and builds the 5-segment path; org_id/procurement_id come from the caller's
 * already-known context (the UI threads procurementId from the loaded record — the storage
 * RLS re-verifies segment-1 = caller org AND segment-2 = an in-org procurement). Validates
 * the extension before touching storage. Returns { signedUrl, path, fileId }.
 */
export async function prepareUpload(
  phase: ProcPhase,
  _parentId: string,
  procurementId: string,
  orgId: string,
  fileName: string,
): Promise<{ signedUrl: string; path: string; fileId: string }> {
  validateUploadExtension(fileName);
  const fileId = crypto.randomUUID();
  const path = buildProcurementFilePath(orgId, procurementId, phase, fileId, fileName);
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throwStorage(error);
  if (!data?.signedUrl) throw new AppError('Could not create upload URL');
  return { signedUrl: data.signedUrl, path: data.path, fileId };
}

/**
 * Confirm an upload by inserting the child file row (FR-PF-003). org_id is NEVER sent — the
 * column default + the *_write WITH CHECK (incl. the parent-org guard) are the authority.
 * `uploaded_by_id` is stamped from the current user (passed by the hook).
 */
export async function confirmUpload(
  phase: ProcPhase,
  parentId: string,
  path: string,
  title: string | null,
  uploadedById: string | null,
): Promise<ProcurementFileRow> {
  const common = { file_path: path, title: nullable(title), uploaded_by_id: uploadedById };
  if (phase === 'quotation') {
    const { data, error } = await supabase
      .from('procurement_quotation_files')
      .insert({ quotation_id: parentId, ...common })
      .select()
      .single();
    if (error) throwWrite(error);
    return normalizeRow(phase, data as Record<string, unknown>);
  }
  if (phase === 'receipt') {
    const { data, error } = await supabase
      .from('procurement_receipt_files')
      .insert({ receipt_id: parentId, ...common })
      .select()
      .single();
    if (error) throwWrite(error);
    return normalizeRow(phase, data as Record<string, unknown>);
  }
  const { data, error } = await supabase
    .from('procurement_invoice_files')
    .insert({ invoice_id: parentId, ...common })
    .select()
    .single();
  if (error) throwWrite(error);
  return normalizeRow(phase, data as Record<string, unknown>);
}

/**
 * Soft-archive a procurement file (FR-PF-005, ADR-0018) — sets archived_at = now() so the
 * row drops out of the default list. org_id is NEVER sent — RLS scopes the update.
 */
export async function archiveProcurementFile(phase: ProcPhase, id: string): Promise<void> {
  const patch = { archived_at: new Date().toISOString() };
  if (phase === 'quotation') {
    const { error } = await supabase.from('procurement_quotation_files').update(patch).eq('id', id);
    if (error) throwWrite(error);
    return;
  }
  if (phase === 'receipt') {
    const { error } = await supabase.from('procurement_receipt_files').update(patch).eq('id', id);
    if (error) throwWrite(error);
    return;
  }
  const { error } = await supabase.from('procurement_invoice_files').update(patch).eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Generate a signed URL for downloading/previewing a procurement file (FR-PF-006).
 * Uses SIGNED_URL_EXPIRY_SECONDS. `opts.download` forces an attachment download
 * (cross-origin storage host ignores the anchor `download` attribute).
 */
export async function getSignedDownloadUrl(
  filePath: string,
  opts?: { download?: boolean },
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(
      filePath,
      SIGNED_URL_EXPIRY_SECONDS,
      opts?.download ? { download: filePath.split('/').pop() || 'file' } : undefined,
    );
  if (error) throwStorage(error);
  if (!data?.signedUrl) throw new AppError('Could not generate download link');
  return data.signedUrl;
}

/**
 * Delete a storage object (non-fatal — used to clean up an orphan after a failed confirm).
 * Orphan-new is acceptable; cleanup is best-effort.
 */
export async function cleanupStorageObject(filePath: string): Promise<void> {
  if (!filePath) return;
  await supabase.storage.from(BUCKET).remove([filePath]);
}
