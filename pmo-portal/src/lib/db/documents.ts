import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';

/**
 * project_documents DAL — the per-project document REGISTER (metadata only).
 *
 * Storage is disabled, so this is metadata-only: there is NO file upload and the
 * `file_path` column is never written here (the "Attach file" affordance is a
 * disabled placeholder in the UI until Storage is re-enabled — crud-components §9.9/§9.6).
 *
 * org_id is NEVER sent from the client — the column default + the `project_documents_write`
 * RLS policy (org_id = auth_org_id() AND the 4 write-roles AND the parent project is in-org)
 * are the authority. Every write throws an `AppError` preserving the Postgres `code` so the UI
 * can classify the toast via `classifyMutationError`.
 */

export type ProjectDocumentRow = Tables<'project_documents'>;
export type DocStatus = ProjectDocumentRow['status'];

/** The metadata fields a create/edit form supplies. org_id / author_id / status are NOT here. */
export interface ProjectDocumentInput {
  code: string;
  category: string;
  title: string;
  revision: string;
  doc_date: string;
}

/** Shape of a PostgREST/Postgres error we surface (only the fields we read). */
interface PostgrestErrorLike {
  message: string;
  code?: string;
}

/**
 * Throws an `AppError` preserving the verbatim message AND the Postgres error `code`
 * (e.g. `42501` RLS-rejected) so the UI can classify the toast.
 */
function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/** Empty optional text → null (so a blank input never writes an empty string). */
const nullable = (v: string): string | null => {
  const t = v.trim();
  return t === '' ? null : t;
};

/**
 * List the document register for a project (AC-DOC-001). org_id is NEVER sent — RLS
 * (project_documents_select: org_id = auth_org_id()) scopes rows. Ordered by code (nulls
 * last via the DB default), then created_at, for a stable, scannable list. Throws an
 * `AppError` (code preserved) on failure.
 */
export async function listProjectDocuments(projectId: string): Promise<ProjectDocumentRow[]> {
  const { data, error } = await supabase
    .from('project_documents')
    .select('*')
    .eq('project_id', projectId)
    .order('code', { nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throwWrite(error);
  return data ?? [];
}

/**
 * Fetch a single document by id (AC-DOC-002), or null when not found / not readable.
 * org_id is NEVER sent — RLS scopes the row. Throws an `AppError` on a genuine query error.
 */
export async function getProjectDocument(id: string): Promise<ProjectDocumentRow | null> {
  const { data, error } = await supabase
    .from('project_documents')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throwWrite(error);
  return data ?? null;
}

/**
 * Create a document register entry (AC-DOC-003). org_id is NEVER sent — the column default +
 * the `project_documents_write` WITH CHECK are the authority. `author_id` is stamped from the
 * current user id (passed by the hook) for the approver-≠-author SoD; `status` defaults to
 * `Draft` server-side and `file_path` is never written (Storage off). Returns the new row.
 * Throws an `AppError` (code preserved, e.g. `42501`) on failure.
 */
export async function createProjectDocument(
  projectId: string,
  input: ProjectDocumentInput,
  authorId: string | null,
): Promise<ProjectDocumentRow> {
  const { data, error } = await supabase
    .from('project_documents')
    .insert({
      project_id: projectId,
      code: nullable(input.code),
      category: input.category.trim(),
      title: input.title.trim(),
      revision: nullable(input.revision),
      doc_date: nullable(input.doc_date),
      author_id: authorId,
    })
    .select()
    .single();
  if (error) throwWrite(error);
  return data as ProjectDocumentRow;
}

/**
 * Update a document's metadata fields by id (AC-DOC-004). org_id is NEVER sent — RLS scopes the
 * update. The status workflow (transitionProjectDocument) and `author_id` (server-stamped) are
 * intentionally NOT touched here — a metadata edit never moves the workflow or rewrites authorship.
 * Throws an `AppError` (code preserved) on failure.
 */
export async function updateProjectDocument(id: string, input: ProjectDocumentInput): Promise<void> {
  const { error } = await supabase
    .from('project_documents')
    .update({
      code: nullable(input.code),
      category: input.category.trim(),
      title: input.title.trim(),
      revision: nullable(input.revision),
      doc_date: nullable(input.doc_date),
    })
    .eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Move a document to the next workflow status (AC-DOC-005): Draft → Issued → Approved/Rejected → Closed.
 * Routes through the SECURITY DEFINER `transition_document_status` RPC (migration 0017) — the SOLE
 * writer of `project_documents.status`. The RPC re-asserts org + the master-data role gate + the legal
 * status map + the approver-≠-author SoD (the actor moving a document to Approved/Rejected may NOT be
 * its author). org_id is NEVER sent — the RPC derives it from auth context. A direct table UPDATE of
 * `status` is denied server-side (the column is no longer granted), so this RPC is the only path. The
 * error `code` is preserved (42501 not-permitted/SoD, P0001 illegal-stage) so the UI classifies the toast.
 */
export async function transitionProjectDocument(id: string, status: DocStatus): Promise<void> {
  const { error } = (await supabase.rpc('transition_document_status', {
    p_doc_id: id,
    p_to: status,
  })) as unknown as { data: null; error: PostgrestErrorLike | null };
  if (error) throwWrite(error);
}

/**
 * Hard-delete a document by id (AC-DOC-006) — Admin only. The `project_documents_delete_admin_only`
 * restrictive RLS policy (migration 0017) is the server authority; the FE gate is the clarity
 * projection. A non-Admin delete is a silent 0-row no-op. org_id is NEVER sent — RLS scopes the
 * delete. Throws an `AppError` (code preserved) on failure.
 */
export async function deleteProjectDocument(id: string): Promise<void> {
  const { error } = await supabase.from('project_documents').delete().eq('id', id);
  if (error) throwWrite(error);
}
