import { supabase } from '@/src/lib/supabase/client';
import { fetchAllPages, type PageResult } from '@/src/lib/pagedRead';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import { toStorageAppError } from '@/src/lib/storageError';
import { sanitizeFilename } from '@/src/lib/storageKey';
import { SIGNED_URL_EXPIRY_SECONDS } from '@/src/lib/fileConstants';

/**
 * Document expiry DAL (#2527, migrations 0970-0974). One read: the expiry list RPC, which is SECURITY INVOKER — RLS decides
 * what each caller sees (medical documents are Admin-only). The RPC is not in the generated types until the next
 * `supabase gen types`, so the call is typed here.
 */
export interface ExpiringDocumentRow {
  id: string;
  subject_kind: 'person' | 'equipment';
  subject_id: string;
  subject_name: string;
  type_name: string;
  is_medical: boolean;
  number: string | null;
  expires_on: string;
  days_left: number;
  medical_status: 'fit' | 'unfit' | null;
  location_note: string | null;
}

export const EXPIRY_WINDOW_DAYS = 30;

export async function listExpiringDocuments(days: number = EXPIRY_WINDOW_DAYS): Promise<ExpiringDocumentRow[]> {
  const rpc = supabase.rpc as unknown as (
    fn: string, args: { p_days: number },
  ) => { range: (from: number, to: number) => PromiseLike<PageResult<ExpiringDocumentRow>> };
  return fetchAllPages((from, to) => rpc.call(supabase, 'list_expiring_documents', { p_days: days }).range(from, to));
}

// ── Add / edit / archive (#2542, migration 0994) ────────────────────────────────────────────────────────────────
// The tables are not in the generated types until the next `supabase gen types`, so the query builder is typed here.
// org_id and is_medical are never sent: column default + trigger stamp them (ADR-0017); RLS and column grants decide who writes.
export type SubjectKind = 'person' | 'equipment';
export interface DocumentTypeRow { id: string; name: string; applies_to: SubjectKind; is_medical: boolean }
export interface ExpiryDocumentRow {
  id: string;
  subject_kind: SubjectKind;
  person_id: string | null;
  asset_id: string | null;
  type_id: string;
  number: string | null;
  issued_on: string | null;
  expires_on: string;
  location_note: string | null;
  attachment_path: string | null;
  medical_status: 'fit' | 'unfit' | null;
  is_medical: boolean;
  archived_at: string | null;
}
/** The editable columns (the 0970 update grant). Type and subject are fixed once created. */
export interface ExpiryDocumentFields {
  number: string | null;
  issued_on: string | null;
  expires_on: string;
  location_note: string | null;
  medical_status: 'fit' | 'unfit' | null;
}
export interface PersonRow { id: string; code: string; name: string; org_id: string }

const BUCKET = 'expiry-documents';
export const EXPIRY_ATTACHMENT_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'] as const;
export const EXPIRY_ATTACHMENT_ACCEPT = EXPIRY_ATTACHMENT_EXTENSIONS.join(',');
export const EXPIRY_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (name: string): any => supabase.from(name as never);
function fail(error: { message: string; code?: string }): never { throw new AppError(error.message, error.code); }

const DOC_COLUMNS = 'id, subject_kind, person_id, asset_id, type_id, number, issued_on, expires_on, location_note, attachment_path, medical_status, is_medical, archived_at';

export async function listSubjectDocuments(kind: SubjectKind, subjectId: string): Promise<ExpiryDocumentRow[]> {
  const col = kind === 'person' ? 'person_id' : 'asset_id';
  const { data, error } = await table('expiry_documents').select(DOC_COLUMNS)
    .eq(col, subjectId).is('archived_at', null).order('expires_on', { ascending: true }).order('id', { ascending: true });
  if (error) fail(error);
  return (data ?? []) as ExpiryDocumentRow[];
}

export async function listDocumentTypes(kind: SubjectKind): Promise<DocumentTypeRow[]> {
  const { data, error } = await table('document_types').select('id, name, applies_to, is_medical')
    .eq('applies_to', kind).is('archived_at', null).order('name', { ascending: true });
  if (error) fail(error);
  return (data ?? []) as DocumentTypeRow[];
}

export async function getPerson(personId: string): Promise<PersonRow | null> {
  const { data, error } = await table('people').select('id, code, name, org_id').eq('id', personId).is('archived_at', null).maybeSingle();
  if (error) fail(error);
  return (data ?? null) as PersonRow | null;
}

export function attachmentExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
}

/** Uploads under {org}/{kind}/{subject}/{file}/{filename}; the org segment is read from the subject row, never the caller. */
export async function uploadExpiryAttachment(kind: SubjectKind, subjectId: string, file: File): Promise<string> {
  const ext = attachmentExtension(file.name);
  if (!(EXPIRY_ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext)) throw new AppError(`File type not allowed (${ext || 'none'})`);
  if (file.size > EXPIRY_ATTACHMENT_MAX_BYTES) throw new AppError('File is larger than 5 MB');
  const { data: subject, error } = await table(kind === 'person' ? 'people' : 'equipment_assets').select('org_id').eq('id', subjectId).maybeSingle();
  if (error) fail(error);
  if (!subject) throw new AppError('Record not found');
  const path = `${(subject as { org_id: string }).org_id}/${kind}/${subjectId}/${crypto.randomUUID()}/${sanitizeFilename(file.name)}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (upErr) throw toStorageAppError(upErr);
  return path;
}

export async function removeExpiryAttachment(path: string | null): Promise<void> {
  if (path) await supabase.storage.from(BUCKET).remove([path]);
}

export async function getExpiryAttachmentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
  if (error) throw toStorageAppError(error);
  if (!data?.signedUrl) throw new AppError('Could not generate download link');
  return data.signedUrl;
}

export interface CreateExpiryDocumentInput extends ExpiryDocumentFields {
  subject_kind: SubjectKind;
  subject_id: string;
  type_id: string;
  attachment_path: string | null;
}
export async function createExpiryDocument(input: CreateExpiryDocumentInput): Promise<ExpiryDocumentRow> {
  const { subject_id, ...rest } = input;
  const row = { ...rest, person_id: input.subject_kind === 'person' ? subject_id : null, asset_id: input.subject_kind === 'equipment' ? subject_id : null };
  const { data, error } = await table('expiry_documents').insert(row).select(DOC_COLUMNS).single();
  if (error) fail(error);
  return data as ExpiryDocumentRow;
}

export async function updateExpiryDocument(id: string, fields: ExpiryDocumentFields & { attachment_path?: string | null }): Promise<void> {
  const { data, error } = await table('expiry_documents').update(fields).eq('id', id).select('id');
  if (error) fail(error);
  assertWriteLanded(data, 'Document not found, or you may not change it.');
}

export async function archiveExpiryDocument(id: string): Promise<void> {
  const { data, error } = await table('expiry_documents').update({ archived_at: new Date().toISOString() }).eq('id', id).select('id');
  if (error) fail(error);
  assertWriteLanded(data, 'Document not found, or you may not change it.');
}
