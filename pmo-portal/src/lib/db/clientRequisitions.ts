import { fetchAllPages } from '@/src/lib/pagedRead';
import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Json } from '@/src/lib/supabase/database.types';
import { uploadStockDocumentFile } from './stockSiteWork';
import type { CsrEvent, CsrEventKind, CsrLine } from '@/src/lib/clientRequisitionRollup';

/**
 * Client material requisitions per work order (#2585, migrations 1086 + 1087; spec
 * docs/specs/client-material-requisitions.spec.md).
 *
 * The database is the authority for every rule: reserved never exceeds requested, a release never takes reserved below
 * collected, a pickup never exceeds what is still to collect and posts one zero-cost receipt, nothing is accepted on a
 * cancelled requisition. Every write is one security-definer RPC; this module carries the call and keeps the refusal's
 * Postgres code. `org_id`, the project and any cost are never sent. Figures are derived at read time (FR-CSR-019).
 */

export type ClientRequisitionStatus = 'draft' | 'open' | 'cancelled';

export interface ClientRequisitionRow {
  id: string;
  number: string;
  workOrderId: string;
  projectId: string;
  clientReference: string | null;
  status: ClientRequisitionStatus;
  createdBy: string;
  createdAt: string;
  sentAt: string | null;
}

export interface ClientRequisitionLineInput {
  stockItemId: string;
  takeoffQuantity: string;
  requestedQuantity?: string;
  workOrderLineId?: string | null;
}

export interface ClientRequisitionPickup {
  id: string;
  requisitionId: string;
  lineId: string;
  quantity: string;
  pickedUpOn: string;
  collector: string | null;
  paperReference: string | null;
  warehouseId: string;
  stockDocumentId: string;
}

export interface ClientRequisitionEvent extends CsrEvent {
  id: string;
  requisitionId: string;
  clientReference: string | null;
  eventOn: string | null;
  reason: string | null;
  recordedBy: string | null;
  createdAt: string;
}

/** One rollup row (csr_work_order_rollup) as the screen reads it, plus the requisition status it belongs to. */
export interface ClientRequisitionLineRow extends CsrLine {
  workOrderLineId?: string | null;
  requisitionNumber: string;
  requisitionStatus: ClientRequisitionStatus;
  itemCode: string;
}

export interface WorkOrderClientMaterial {
  requisitions: ClientRequisitionRow[];
  lines: ClientRequisitionLineRow[];
  events: ClientRequisitionEvent[];
  pickups: ClientRequisitionPickup[];
}

// ── reads ─────────────────────────────────────────────────────────────────────────────────────────────────────

const fail = (error: { message: string; code?: string }): never => { throw new AppError(error.message, error.code); };


const num = (v: unknown): string => String(v);

/**
 * Everything the work order's "Client material" section shows (FR-CSR-018): the requisitions, the per-line rows (the
 * rollup RPC supplies item names and units), the append-only event log and the posted pickups. Quantities are carried as
 * strings so the pure rollup stays exact.
 */
export async function getWorkOrderClientMaterial(workOrderId: string): Promise<WorkOrderClientMaterial> {
  const reqRows = await fetchAllPages((from, to) => supabase.from('client_requisitions')
    .select('id, number, work_order_id, project_id, client_reference, status, created_by, created_at, sent_at')
    .eq('work_order_id', workOrderId).order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(from, to));
  const requisitions = reqRows.map((r): ClientRequisitionRow => ({
    id: String(r.id), number: String(r.number), workOrderId: String(r.work_order_id), projectId: String(r.project_id),
    clientReference: (r.client_reference as string | null) ?? null, status: r.status as ClientRequisitionStatus,
    createdBy: String(r.created_by), createdAt: String(r.created_at), sentAt: (r.sent_at as string | null) ?? null,
  }));
  if (requisitions.length === 0) return { requisitions, lines: [], events: [], pickups: [] };
  const ids = requisitions.map((r) => r.id);
  const [rollup, events, pickups] = await Promise.all([
    fetchAllPages((from, to) => supabase.rpc('csr_work_order_rollup', { p_work_order_id: workOrderId }).range(from, to)),
    fetchAllPages((from, to) => supabase.from('client_requisition_events')
      .select('id, requisition_id, line_id, kind, quantity, client_reference, event_on, reason, recorded_by, created_at')
      .in('requisition_id', ids).order('seq', { ascending: true }).order('id').range(from, to)),
    fetchAllPages((from, to) => supabase.from('client_requisition_pickups')
      .select('id, requisition_id, line_id, quantity, picked_up_on, collector, paper_reference, warehouse_id, stock_document_id')
      .in('requisition_id', ids).order('picked_up_on', { ascending: true }).order('created_at', { ascending: true })
      .order('id').range(from, to)),
  ]);
  const allocations = await fetchAllPages((from, to) => supabase.from('client_requisition_lines')
    .select('id, work_order_line_id').in('requisition_id', ids).order('id').range(from, to));
  const allocationByLine = new Map(allocations.map((l) => [l.id, l.work_order_line_id]));
  return {
    requisitions,
    lines: rollup.map((l): ClientRequisitionLineRow => ({
      id: l.line_id, requisitionId: l.requisition_id, requisitionNumber: l.requisition_number,
      workOrderLineId: allocationByLine.get(l.line_id) ?? null,
      requisitionStatus: l.requisition_status as ClientRequisitionStatus, itemId: l.stock_item_id, itemCode: l.item_code,
      itemName: l.item_name, unit: l.unit_code, takeoffQuantity: num(l.takeoff_quantity), requestedQuantity: num(l.requested_quantity),
    })),
    events: events.map((e): ClientRequisitionEvent => ({
      id: String(e.id), requisitionId: String(e.requisition_id), lineId: (e.line_id as string | null) ?? null,
      kind: e.kind as CsrEventKind, quantity: e.quantity == null ? null : num(e.quantity),
      clientReference: (e.client_reference as string | null) ?? null, eventOn: (e.event_on as string | null) ?? null,
      reason: (e.reason as string | null) ?? null, recordedBy: (e.recorded_by as string | null) ?? null, createdAt: String(e.created_at),
    })),
    pickups: pickups.map((p): ClientRequisitionPickup => ({
      id: String(p.id), requisitionId: String(p.requisition_id), lineId: String(p.line_id), quantity: num(p.quantity),
      pickedUpOn: String(p.picked_up_on), collector: (p.collector as string | null) ?? null,
      paperReference: (p.paper_reference as string | null) ?? null, warehouseId: String(p.warehouse_id),
      stockDocumentId: String(p.stock_document_id),
    })),
  };
}

// ── writes (one RPC each) ─────────────────────────────────────────────────────────────────────────────────────

const toLinesJson = (lines: ClientRequisitionLineInput[]): Json =>
  lines.map((l) => ({
    stock_item_id: l.stockItemId, takeoff_quantity: Number(l.takeoffQuantity),
    ...(l.requestedQuantity ? { requested_quantity: Number(l.requestedQuantity) } : {}),
    ...(l.workOrderLineId ? { work_order_line_id: l.workOrderLineId } : {}),
  }));

/** FR-CSR-001/005: a draft requisition; a replayed create with the same client id returns the first. */
export async function createClientRequisition(
  header: { workOrderId: string; clientReference?: string | null }, lines: ClientRequisitionLineInput[], clientRequestId?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('csr_create', {
    p_header: { work_order_id: header.workOrderId, client_reference: header.clientReference ?? null },
    p_lines: toLinesJson(lines), p_client_request_id: clientRequestId,
  });
  if (error) fail(error);
  return String(data);
}

export async function updateClientRequisitionDraft(id: string, header: { clientReference?: string | null }, lines: ClientRequisitionLineInput[]): Promise<void> {
  const { error } = await supabase.rpc('csr_update_draft', {
    p_requisition_id: id, p_header: { client_reference: header.clientReference ?? null }, p_lines: toLinesJson(lines),
  });
  if (error) fail(error);
}

export async function sendClientRequisition(id: string, clientRequestId?: string): Promise<void> {
  const { error } = await supabase.rpc('csr_send', { p_requisition_id: id, p_client_request_id: clientRequestId });
  if (error) fail(error);
}

export async function cancelClientRequisition(id: string, reason?: string | null): Promise<void> {
  const { error } = await supabase.rpc('csr_cancel', { p_requisition_id: id, p_reason: reason ?? undefined });
  if (error) fail(error);
}

export async function recordClientReservation(
  lineId: string, input: { quantity: string; clientReference: string; reservedOn?: string | null; note?: string | null }, clientRequestId?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('csr_record_reservation', {
    p_line_id: lineId, p_quantity: Number(input.quantity), p_client_reference: input.clientReference,
    p_reserved_on: input.reservedOn ?? undefined, p_note: input.note ?? undefined, p_client_request_id: clientRequestId,
  });
  if (error) fail(error);
  return String(data);
}

export async function recordClientRelease(lineId: string, input: { quantity: string; reason: string }, clientRequestId?: string): Promise<string> {
  const { data, error } = await supabase.rpc('csr_record_release', {
    p_line_id: lineId, p_quantity: Number(input.quantity), p_reason: input.reason, p_client_request_id: clientRequestId,
  });
  if (error) fail(error);
  return String(data);
}

/** FR-CSR-010: one pickup, one posted zero-cost receipt. No cost is sent: the RPC takes none. */
export async function recordClientPickup(
  lineId: string,
  input: { quantity: string; warehouseId: string; pickedUpOn?: string | null; collector?: string | null; paperReference?: string | null },
  clientRequestId?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('csr_record_pickup', {
    p_line_id: lineId, p_quantity: Number(input.quantity), p_warehouse_id: input.warehouseId,
    p_picked_up_on: input.pickedUpOn ?? undefined, p_collector: input.collector ?? undefined,
    p_paper_reference: input.paperReference ?? undefined, p_client_request_id: clientRequestId,
  });
  if (error) fail(error);
  return String(data);
}

/** The slip photo of a pickup: an attachment on the receipt that pickup posted (the same file store the receipt's own Attachments panel uses). */
export async function attachClientPickupSlip(pickupId: string, file: File): Promise<void> {
  const { data, error } = await supabase.from('client_requisition_pickups').select('org_id, stock_document_id').eq('id', pickupId).limit(1);
  if (error) fail(error);
  const row = data?.[0];
  if (!row) throw new AppError('The pickup receipt could not be found.', 'PGRST116');
  await uploadStockDocumentFile(row.org_id, row.stock_document_id, file, 'Delivery slip');
}
