import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';
import { ProcurementError } from './procurementLifecycle';

// ERROR-TYPE NOTE (intentional ProcurementError reuse, not a divergence): the
// other CRUD DAL modules (companies / documents / projects / incidents) throw the
// shared `AppError`. This module deliberately reuses `ProcurementError` so the
// lifecycle DAL (procurementLifecycle.ts) and the CRUD DAL throw ONE error type
// across the whole procurement surface — a caller that catches the DAL directly
// (e.g. useProcurementDetail) handles a single class. It is behaviourally
// equivalent: `ProcurementError extends Error` and carries a string `.code`, which
// the repository seam (`toAppError`, appError.ts) reads structurally and normalizes
// to `AppError` (code preserved) for every consumer that goes through `repositories`.
// So the seam-level contract ("callers catch AppError with a preserved code") holds
// regardless. If procurement is ever migrated fully behind the seam, swap this for
// `AppError` with no behaviour change.

// ---------------------------------------------------------------------------
// Procurement CRUD DAL (CRUD+RBAC program, Procurement slice). Sits beside the
// lifecycle DAL (procurementLifecycle.ts) and owns the *editing* paths the
// lifecycle module never had: New PR header, header edit (Draft), line items
// CRUD, the select-quote RPC, and document-metadata CRUD.
//
// CONTRACT (mirrors companies.ts / procurementLifecycle.ts):
//   • org_id is NEVER sent — RLS (org_id = auth_org_id()) + the column default
//     are the authority. Sending it would let a client spoof tenancy.
//   • Every write rethrows a ProcurementError preserving the Postgres/PostgREST
//     `.code` (P0001 illegal-stage, 42501 RLS/SoD, 23503 FK, …) so the UI can
//     classify the toast via classifyMutationError instead of dropping it.
//   • procurement_items.amount is a GENERATED STORED column (quantity * rate) —
//     never written; the FE derives the line total for display only.
// ---------------------------------------------------------------------------

export type ProcurementItemRow = Tables<'procurement_items'>;
export type ProcurementDocumentRow = Tables<'procurement_documents'>;
export type ProcurementDocStatus = ProcurementDocumentRow['status'];

/** Shape of a Supabase/PostgREST error we surface (only the fields we read). */
interface RpcErrorLike {
  message: string;
  code?: string;
}

/** Rethrows preserving both message and Postgres code (for classifyMutationError). */
function throwWrite(error: RpcErrorLike): never {
  throw new ProcurementError(error.message, error.code);
}

// ---------------------------------------------------------------------------
// PR header — create + edit (FR-PROC-CRUD: New PR, Draft-header edit)
// ---------------------------------------------------------------------------

/** Fields the New-PR form supplies. org_id is NEVER among them — RLS stamps it. */
export interface NewProcurementInput {
  title: string;
  projectId: string | null;
  vendorId: string | null;
  /** Import provenance (Deliverable 2/3) — undefined for every non-import caller. */
  importKey?: string;
  importBatchId?: string;
  importedAt?: string;
}

/**
 * Creates a Purchase Request landing in Draft (AC-PROC-001). The requester is
 * stamped from the caller's auth identity (`requestedById = currentUser.id`,
 * passed by the hook from the auth context) — `procurements.requested_by_id`
 * references the caller's own profile, so this is the caller stamping itself,
 * and the requester widening RLS (migration 0015) keys off this exact id. ANY
 * member (incl. Engineer) may raise (procurements_insert: org_id = auth_org_id()).
 * org_id is NEVER sent — the column default + RLS WITH CHECK are the authority.
 */
export async function createProcurement(
  input: NewProcurementInput,
  requestedById: string,
): Promise<Tables<'procurements'>> {
  const { data, error } = await supabase
    .from('procurements')
    .insert({
      title: input.title,
      status: 'Draft',
      requested_by_id: requestedById,
      project_id: input.projectId,
      vendor_id: input.vendorId,
      ...(input.importKey !== undefined ? { import_key: input.importKey } : {}),
      ...(input.importBatchId !== undefined ? { import_batch_id: input.importBatchId } : {}),
      ...(input.importedAt !== undefined ? { imported_at: input.importedAt } : {}),
    })
    .select()
    .single();
  if (error) throwWrite(error);
  return data as Tables<'procurements'>;
}

/** Editable header fields (requester while Draft/Rejected). Excludes the
 *  RPC-only state-machine columns (status / pr_number / approver / notes). */
export interface ProcurementHeaderPatch {
  title: string;
  projectId: string | null;
  vendorId: string | null;
}

/**
 * Updates the editable PR header fields (AC-PROC-002). org_id is NEVER sent —
 * RLS (procurements_update + the 0010 column grants) scopes the write to the
 * caller's org and the client-writable columns. Status and document numbers are
 * unreachable here (revoked by 0010 → minter/transition RPCs only).
 */
export async function updateProcurementHeader(
  id: string,
  patch: ProcurementHeaderPatch,
): Promise<void> {
  const { error } = await supabase
    .from('procurements')
    .update({
      title: patch.title,
      project_id: patch.projectId,
      vendor_id: patch.vendorId,
    })
    .eq('id', id);
  if (error) throwWrite(error);
}

// ---------------------------------------------------------------------------
// Line items — create / update / delete (FR-PROC-CRUD line items, Draft-gated by RLS)
// ---------------------------------------------------------------------------

/** A line item the form supplies. `amount` is server-generated, never sent. */
export interface ProcurementItemInput {
  name: string;
  quantity: number;
  rate: number;
  description?: string | null;
}

/**
 * Inserts a line item on a PR (AC-PROC-003). org_id is NEVER sent (RLS default +
 * the requester/4-role write policy + the Draft-only restrictive freeze, 0015).
 * `amount` is a generated stored column — never written.
 */
export async function createProcurementItem(
  procurementId: string,
  input: ProcurementItemInput,
): Promise<ProcurementItemRow> {
  const { data, error } = await supabase
    .from('procurement_items')
    .insert({
      procurement_id: procurementId,
      name: input.name,
      quantity: input.quantity,
      rate: input.rate,
      ...(input.description !== undefined ? { description: input.description } : {}),
    })
    .select()
    .single();
  if (error) throwWrite(error);
  return data as ProcurementItemRow;
}

/** Patch for an existing line item — name/quantity/rate (+ optional description). */
export type ProcurementItemPatch = Partial<ProcurementItemInput>;

/**
 * Updates a line item by id (AC-PROC-003). org_id / amount are NEVER written.
 * RLS scopes the write; the Draft-only freeze (0015) hides items once the PR
 * leaves Draft (→ a silent no-op the UI never offers).
 */
export async function updateProcurementItem(
  id: string,
  patch: ProcurementItemPatch,
): Promise<void> {
  const set: Partial<Pick<ProcurementItemRow, 'name' | 'quantity' | 'rate' | 'description'>> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.quantity !== undefined) set.quantity = patch.quantity;
  if (patch.rate !== undefined) set.rate = patch.rate;
  if (patch.description !== undefined) set.description = patch.description;

  const { error } = await supabase.from('procurement_items').update(set).eq('id', id);
  if (error) throwWrite(error);
}

/**
 * Deletes a line item by id (AC-PROC-003). org_id is NEVER sent — RLS scopes it.
 */
export async function deleteProcurementItem(id: string): Promise<void> {
  const { error } = await supabase.from('procurement_items').delete().eq('id', id);
  if (error) throwWrite(error);
}

// ---------------------------------------------------------------------------
// Select quote — the previously-missing select-quote authority (RPC, migration 0015)
// ---------------------------------------------------------------------------

/**
 * Selects a quotation via the security-definer RPC (AC-PROC-004). The RPC sets
 * `is_selected` (clearing any prior selection), syncs the header total/vendor,
 * and advances Vendor Quoted → Quote Selected — all in one txn. org_id is NEVER
 * sent; the RPC re-asserts org + role + stage internally. Errors preserve the
 * code (P0001 wrong stage / 42501 not-permitted) for a classified toast.
 */
export async function selectProcurementQuote(quotationId: string): Promise<void> {
  const { error } = (await supabase.rpc('select_procurement_quote', {
    p_quotation_id: quotationId,
  })) as unknown as { data: null; error: RpcErrorLike | null };
  if (error) throwWrite(error);
}

// ---------------------------------------------------------------------------
// Documents — metadata register over the (previously dead) procurement_documents table
// ---------------------------------------------------------------------------

/** Metadata a document-register row supplies. Files are DEFERRED (Storage off). */
export interface ProcurementDocumentInput {
  type: string;
  referenceNumber: string | null;
  status: ProcurementDocStatus;
}

/**
 * Lists the document-metadata register for a PR (AC-PROC-005). org_id is NEVER
 * sent — RLS scopes rows. Ordered by type for a stable, scannable list.
 */
export async function listProcurementDocuments(
  procurementId: string,
): Promise<ProcurementDocumentRow[]> {
  const { data, error } = await supabase
    .from('procurement_documents')
    .select('*')
    .eq('procurement_id', procurementId)
    .order('type');
  if (error) throwWrite(error);
  return data ?? [];
}

/**
 * Adds a document-metadata row to a PR (AC-PROC-005). org_id is NEVER sent —
 * the column default + the procurement_documents_write parent-org guard + role
 * gate are the authority. File upload is deferred (Storage off); `link` is unset.
 */
export async function createProcurementDocument(
  procurementId: string,
  input: ProcurementDocumentInput,
): Promise<ProcurementDocumentRow> {
  const { data, error } = await supabase
    .from('procurement_documents')
    .insert({
      procurement_id: procurementId,
      type: input.type,
      status: input.status,
      ...(input.referenceNumber ? { reference_number: input.referenceNumber } : {}),
    })
    .select()
    .single();
  if (error) throwWrite(error);
  return data as ProcurementDocumentRow;
}

/**
 * Removes a document-metadata row by id (AC-PROC-005). org_id is NEVER sent.
 */
export async function deleteProcurementDocument(id: string): Promise<void> {
  const { error } = await supabase.from('procurement_documents').delete().eq('id', id);
  if (error) throwWrite(error);
}
