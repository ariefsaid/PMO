import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import { fetchAllPages } from '@/src/lib/pagedRead';
import { wireValidator } from '@/src/lib/wireDoc';
import type { Tables, TablesInsert } from '@/src/lib/supabase/database.types';

/**
 * Contract-quantity DAL (migration 0337, ADR-0091). Allocations (`work_order_lines`) are RLS-scoped table
 * writes by the BoQ writer roles; BAST acceptances are written ONLY through the three definer RPCs (no client
 * DML grant exists). org_id is never sent from the client.
 */
export type WorkOrderLineRow = Tables<'work_order_lines'>;
export type WorkOrderAcceptanceRow = Tables<'work_order_acceptances'>;
export type WorkOrderAcceptanceLineRow = Tables<'work_order_acceptance_lines'>;

export interface WorkOrderAcceptanceWithLines extends WorkOrderAcceptanceRow {
  lines: WorkOrderAcceptanceLineRow[];
}

export interface WorkOrderLineInput {
  workOrderId: string;
  boqItemId: string;
  quantity: number;
}

export interface PrepareWorkOrderAcceptanceInput {
  workOrderId: string;
  acceptanceDate: string;
  isFinal: boolean;
  lines: Array<{ boqItemId: string; quantity: number }>;
  documentId: string | null;
  note: string | null;
  /** Present to replace an existing Draft. */
  acceptanceId?: string;
}

export interface ConfirmWorkOrderAcceptanceResult {
  /** Null for a stage acceptance; the net closing value for a final one. */
  closingValue: number | null;
  /** Project down payment invoiced − recovered. */
  dpHeld: number;
}

/**
 * One BAST the caller may confirm, from `acceptances_awaiting_my_confirmation()` (migration 1570):
 * a Draft acceptance on an Issued work order, for Admin/Finance, with the author excluded unless they
 * are the only active member. Eligibility is a READ of who can confirm — never a promise the write
 * succeeds: the document/prerequisite checks and the separation-of-duties refusal stay in
 * `confirm_work_order_acceptance`.
 */
export interface AcceptanceAwaitingConfirmationRow {
  id: string;
  project_id: string;
  /** The order to open: the acceptance id is never a work order id. */
  work_order_id: string;
  acceptance_date: string;
  is_final: boolean;
  prepared_by: string;
  prepared_at: string;
}

/** Rows read per list. PostgREST caps a response at 1000, so reaching the limit means the list may be cut. */
const LIST_LIMIT = 1000;

function fail(error: { message: string; code?: string }): never {
  throw new AppError(error.message, error.code);
}

function refuseSaturated(rows: readonly unknown[], what: string): void {
  if (rows.length >= LIST_LIMIT) throw new AppError(`Too many ${what} to list safely.`, 'list-saturated');
}

export async function listProjectAcceptances(projectId: string): Promise<WorkOrderAcceptanceWithLines[]> {
  const { data, error } = await supabase.from('work_order_acceptances')
    .select('*, lines:work_order_acceptance_lines(*)')
    .eq('project_id', projectId)
    .order('prepared_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(LIST_LIMIT);
  if (error) fail(error);
  const rows = (data ?? []) as WorkOrderAcceptanceWithLines[];
  refuseSaturated(rows, 'acceptances');
  return rows;
}

/** The acceptances of ONE work order with their lines, newest first; the same row shape and order as the project read. */
export async function listWorkOrderAcceptances(projectId: string, workOrderId: string): Promise<WorkOrderAcceptanceWithLines[]> {
  const { data, error } = await supabase.from('work_order_acceptances')
    .select('*, lines:work_order_acceptance_lines(*)')
    .eq('project_id', projectId)
    .eq('work_order_id', workOrderId)
    .order('prepared_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(LIST_LIMIT);
  if (error) fail(error);
  const rows = (data ?? []) as WorkOrderAcceptanceWithLines[];
  refuseSaturated(rows, 'acceptances');
  return rows;
}

export async function listWorkOrderLines(workOrderId: string): Promise<WorkOrderLineRow[]> {
  const { data, error } = await supabase.from('work_order_lines').select('*')
    .eq('work_order_id', workOrderId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(LIST_LIMIT);
  if (error) fail(error);
  const rows = data ?? [];
  refuseSaturated(rows, 'allocations');
  return rows;
}

/**
 * Every BAST waiting for the signed-in Admin/Finance user to confirm (migration 1570's caller-filtered read).
 *
 * This is a WAITING LIST, so a partial answer would be a wrong count, not merely a short page: PostgREST
 * silently truncates at `db-max-rows`, so the whole set is read page by page and a page error rejects the
 * read rather than returning what arrived. The function itself has no row cap and orders by
 * `prepared_at, id`; the re-sort here keeps the caller's order determinate when the pages are stitched.
 */
export async function listAcceptancesAwaitingConfirmation(): Promise<AcceptanceAwaitingConfirmationRow[]> {
  const rows = await fetchAllPages<AcceptanceAwaitingConfirmationRow>((from, to) =>
    supabase.rpc('acceptances_awaiting_my_confirmation').range(from, to));
  return [...rows].sort((a, b) => a.prepared_at.localeCompare(b.prepared_at) || a.id.localeCompare(b.id));
}

/** Every allocation on a project's work orders in ONE query (the tab groups them by work order). */
export async function listProjectWorkOrderLines(projectId: string): Promise<WorkOrderLineRow[]> {
  const { data, error } = await supabase.from('work_order_lines').select('*, work_orders!inner(project_id)')
    .eq('work_orders.project_id', projectId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(LIST_LIMIT);
  if (error) fail(error);
  const rows = (data ?? []).map(({ work_orders: _wo, ...row }) => row) as WorkOrderLineRow[];
  refuseSaturated(rows, 'allocations');
  return rows;
}

export async function createWorkOrderLine(input: WorkOrderLineInput): Promise<WorkOrderLineRow> {
  // `org_id` is stamped by the org_id before-insert trigger (migration 0074) and the client never sends it (ADR-0017), but
  // the generated Insert type requires it because introspection cannot see the trigger.
  const row = {
    work_order_id: input.workOrderId, boq_item_id: input.boqItemId, quantity: input.quantity,
  } satisfies Omit<TablesInsert<'work_order_lines'>, 'org_id'>;
  const { data, error } = await supabase.from('work_order_lines').insert(row as TablesInsert<'work_order_lines'>).select().single();
  if (error) fail(error);
  return data as WorkOrderLineRow;
}

export async function updateWorkOrderLine(id: string, quantity: number): Promise<void> {
  const { data, error } = await supabase.from('work_order_lines').update({ quantity }).eq('id', id).select('id');
  if (error) fail(error);
  assertWriteLanded(data, 'Allocation not found or you do not have permission to edit it.');
}

export async function deleteWorkOrderLine(id: string): Promise<void> {
  const { data, error } = await supabase.from('work_order_lines').delete().eq('id', id).select('id');
  if (error) fail(error);
  assertWriteLanded(data, 'Allocation not found or you do not have permission to delete it.');
}

/** Creates a Draft, or replaces the Draft named by `acceptanceId`; returns the acceptance id. */
export async function prepareWorkOrderAcceptance(input: PrepareWorkOrderAcceptanceInput): Promise<string> {
  const { data, error } = await supabase.rpc('prepare_work_order_acceptance', {
    p_work_order_id: input.workOrderId,
    p_acceptance_date: input.acceptanceDate,
    p_is_final: input.isFinal,
    p_lines: input.lines.map((line) => ({ boq_item_id: line.boqItemId, quantity: line.quantity })),
    ...(input.documentId ? { p_document_id: input.documentId } : {}),
    ...(input.note ? { p_note: input.note } : {}),
    ...(input.acceptanceId ? { p_acceptance_id: input.acceptanceId } : {}),
  });
  if (error) fail(error);
  return acceptanceValidator.str(data, 'acceptance_id');
}

export async function withdrawWorkOrderAcceptance(id: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_work_order_acceptance', { p_id: id });
  if (error) fail(error);
}

const acceptanceValidator = wireValidator('Work order acceptance', 'acceptance-malformed');

/** Closing figures are shown only from this authoritative response, so a malformed one is an error, never zero. */
export async function confirmWorkOrderAcceptance(id: string): Promise<ConfirmWorkOrderAcceptanceResult> {
  const { data, error } = await supabase.rpc('confirm_work_order_acceptance', { p_id: id });
  if (error) fail(error);
  const raw = acceptanceValidator.rec(data, 'response');
  if (!('closing_value' in raw)) acceptanceValidator.fail('closing_value');
  return {
    closingValue: acceptanceValidator.numOrNull(raw.closing_value, 'closing_value'),
    dpHeld: acceptanceValidator.num(raw.dp_held, 'dp_held'),
  };
}
