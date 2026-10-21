import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';

/**
 * Contract-quantity DAL (migration 0337, ADR-0090). Allocations (`work_order_lines`) are RLS-scoped table
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
  const { data, error } = await supabase.from('work_order_lines').insert({
    work_order_id: input.workOrderId, boq_item_id: input.boqItemId, quantity: input.quantity,
  }).select().single();
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
  if (typeof data !== 'string' || data === '') throw new AppError('acceptance was not created', 'acceptance-malformed');
  return data;
}

export async function withdrawWorkOrderAcceptance(id: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_work_order_acceptance', { p_id: id });
  if (error) fail(error);
}

function finiteOrNull(value: unknown): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) throw new AppError('confirmation response is malformed', 'acceptance-malformed');
  return parsed;
}

/** Closing figures are shown only from this authoritative response, so a malformed one is an error, never zero. */
export async function confirmWorkOrderAcceptance(id: string): Promise<ConfirmWorkOrderAcceptanceResult> {
  const { data, error } = await supabase.rpc('confirm_work_order_acceptance', { p_id: id });
  if (error) fail(error);
  const raw = data as Record<string, unknown> | null;
  if (typeof raw !== 'object' || raw === null || !('closing_value' in raw) || !('dp_held' in raw)) {
    throw new AppError('confirmation response is malformed', 'acceptance-malformed');
  }
  const dpHeld = finiteOrNull(raw.dp_held);
  if (dpHeld === null) throw new AppError('confirmation response is malformed', 'acceptance-malformed');
  return { closingValue: finiteOrNull(raw.closing_value), dpHeld };
}
