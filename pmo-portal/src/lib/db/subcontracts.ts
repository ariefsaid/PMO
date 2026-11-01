import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';
import type { CaptureVendorInvoiceInput, ProcurementInvoiceRow } from './procurementLifecycle';

export type PurchaseOrderRevisionRow = Tables<'purchase_order_revisions'>;
export type PurchaseOrderLineRow = Tables<'purchase_order_lines'>;
export type SubcontractAcceptanceRow = Tables<'subcontract_acceptances'>;
export type SubcontractAcceptanceLineRow = Tables<'subcontract_acceptance_lines'>;
export type PoVariationRow = Tables<'po_variations'>;
export type PoVariationLineRow = Tables<'po_variation_lines'>;

export interface SubcontractAcceptanceWithLines extends SubcontractAcceptanceRow {
  lines: SubcontractAcceptanceLineRow[];
}

export interface PoVariationWithLines extends PoVariationRow {
  lines: PoVariationLineRow[];
}

export interface SubcontractPoPositionRow {
  boq_item_id: string;
  item_code: string;
  description: string;
  unit: string;
  rate: number;
  po_qty: number;
  revision: number;
  verified: number;
  verified_not_on_po: number;
  verified_at: string | null;
  disputed: number;
  billed: number | null;
  payable: number | null;
}

export interface SetPoLinesInput {
  boqItemId: string;
  quantity: number;
  rate: number;
  unit: string;
}

export interface PrepareSubcontractAcceptanceInput {
  poId: string;
  acceptanceDate: string;
  lines: Array<{ boqItemId: string; quantity: number }>;
  documentId?: string | null;
  note?: string | null;
  acceptanceId?: string | null;
}

export interface SubcontractBillLineInput {
  boqItemId: string;
  quantity: number;
  rate: number;
}

export type CaptureSubcontractVendorInvoiceInput = CaptureVendorInvoiceInput & {
  lines: SubcontractBillLineInput[];
};

export interface RequestPoVariationInput {
  poId: string;
  origin: 'pre_work' | 'post_work';
  reason: string;
  lines: Array<{ boqItemId: string; additionalQuantity: number }>;
}

export interface VariationRouteRow {
  approver_ids: string[];
  line_budget: number;
  line_used: number;
  reason: string;
  route: string;
}

export interface ProjectSubcontractExposureRow {
  currency: string;
  verified_not_on_po_value: number;
  disputed_value: number;
  oldest_unresolved_at: string;
}

export interface WorkOrderCostVariationRow {
  id: string;
  number: string;
  po_id: string;
  amount: number;
  status: string;
}

export interface SubcontractCapExceptionRow {
  amount: number;
  erp_purchase_document_id: string;
  invoice_id: string;
  number: string;
  reason: string;
}

export interface AttributeSubcontractBillLineInput {
  boqItemId: string;
  quantity: number;
  rate: number;
}

interface RpcErrorLike {
  message: string;
  code?: string;
  details?: string | null;
}

function throwRpc(error: RpcErrorLike): never {
  throw new AppError(error.message, error.code, error.details ?? undefined);
}

/**
 * Reads the live subcontract position for one PO.
 * D6: billed and payable are null for a caller outside the four invoice-reading roles.
 */
export async function getPoPosition(poId: string): Promise<SubcontractPoPositionRow[]> {
  const { data, error } = await supabase.rpc('subcontract_po_position', { p_po_id: poId });
  if (error) throwRpc(error);
  return (data ?? []) as SubcontractPoPositionRow[];
}

export async function listPoRevisions(poId: string): Promise<PurchaseOrderRevisionRow[]> {
  const { data, error } = await supabase
    .from('purchase_order_revisions')
    .select('*')
    .eq('po_id', poId)
    .order('revision', { ascending: true });
  if (error) throwRpc(error);
  return (data ?? []) as PurchaseOrderRevisionRow[];
}

export async function listPoLines(poId: string, revision?: number): Promise<PurchaseOrderLineRow[]> {
  let query = supabase.from('purchase_order_lines').select('*').eq('po_id', poId);
  if (revision !== undefined) {
    query = query.eq('revision', revision);
  }
  const { data, error } = await query.order('created_at', { ascending: true });
  if (error) throwRpc(error);
  return (data ?? []) as PurchaseOrderLineRow[];
}

export async function setPoLines(poId: string, lines: SetPoLinesInput[]): Promise<number> {
  const { data, error } = await supabase.rpc('set_subcontract_po_lines', {
    p_po_id: poId,
    p_lines: lines.map((l) => ({
      boq_item_id: l.boqItemId,
      quantity: l.quantity,
      rate: l.rate,
      unit: l.unit,
    })),
  });
  if (error) throwRpc(error);
  return Number(data);
}

export async function issuePoLines(poId: string): Promise<number> {
  const { data, error } = await supabase.rpc('issue_subcontract_po_lines', { p_po_id: poId });
  if (error) throwRpc(error);
  return Number(data);
}

export async function listSubcontractAcceptances(poId: string): Promise<SubcontractAcceptanceWithLines[]> {
  const { data, error } = await supabase
    .from('subcontract_acceptances')
    .select('*, lines:subcontract_acceptance_lines(*)')
    .eq('po_id', poId)
    .order('confirmed_at', { ascending: false })
    .limit(200);
  if (error) throwRpc(error);
  return (data ?? []) as SubcontractAcceptanceWithLines[];
}

export async function prepareSubcontractAcceptance(input: PrepareSubcontractAcceptanceInput): Promise<string> {
  const { data, error } = await supabase.rpc('prepare_subcontract_acceptance', {
    p_po_id: input.poId,
    p_acceptance_date: input.acceptanceDate,
    p_lines: input.lines.map((l) => ({ boq_item_id: l.boqItemId, quantity: l.quantity })),
    ...(input.documentId ? { p_document_id: input.documentId } : {}),
    ...(input.note ? { p_note: input.note } : {}),
    ...(input.acceptanceId ? { p_acceptance_id: input.acceptanceId } : {}),
  });
  if (error) throwRpc(error);
  if (typeof data !== 'string' || !data) {
    throw new AppError('acceptance was not created', 'acceptance-malformed');
  }
  return data;
}

export async function confirmSubcontractAcceptance(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('confirm_subcontract_acceptance', { p_id: id });
  if (error) throwRpc(error);
  return String(data);
}

export async function withdrawSubcontractAcceptance(id: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_subcontract_acceptance', { p_id: id });
  if (error) throwRpc(error);
}

export async function captureSubcontractVendorInvoice(
  input: CaptureSubcontractVendorInvoiceInput,
): Promise<ProcurementInvoiceRow> {
  const { data, error } = await supabase.rpc('capture_subcontract_vendor_invoice', {
    p_procurement_id: input.procurementId,
    p_status: input.status,
    p_invoice_date: input.invoiceDate,
    ...(input.referenceNumber != null ? { p_reference_number: input.referenceNumber } : {}),
    ...(input.amount != null ? { p_amount: input.amount } : {}),
    ...(input.notes != null ? { p_notes: input.notes } : {}),
    p_tax_treatment: input.taxTreatment,
    p_tax_amount: input.taxAmount,
    ...(input.taxRate != null ? { p_tax_rate: input.taxRate } : {}),
    ...(input.taxTemplate != null ? { p_tax_template: input.taxTemplate } : {}),
    ...(input.taxBaseNumerator !== undefined ? { p_tax_base_numerator: input.taxBaseNumerator } : {}),
    ...(input.taxBaseDenominator !== undefined ? { p_tax_base_denominator: input.taxBaseDenominator } : {}),
    ...(input.externalRef ? { p_external_ref: input.externalRef } : {}),
    ...(input.withheldAmount
      ? { p_withheld_amount: input.withheldAmount, ...(input.withheldPphType ? { p_withheld_pph_type: input.withheldPphType } : {}) }
      : {}),
    p_lines: input.lines.map((l) => ({
      boq_item_id: l.boqItemId,
      quantity: l.quantity,
      rate: l.rate,
    })),
  });
  if (error) throwRpc(error);
  return data as unknown as ProcurementInvoiceRow;
}

export async function listPoVariations(poId: string): Promise<PoVariationWithLines[]> {
  const { data, error } = await supabase
    .from('po_variations')
    .select('*, lines:po_variation_lines(*)')
    .eq('po_id', poId)
    .order('requested_at', { ascending: false });
  if (error) throwRpc(error);
  return (data ?? []) as PoVariationWithLines[];
}

export async function requestPoVariation(input: RequestPoVariationInput): Promise<string> {
  const { data, error } = await supabase.rpc('request_po_variation', {
    p_po_id: input.poId,
    p_origin: input.origin,
    p_reason: input.reason,
    p_lines: input.lines.map((l) => ({
      boq_item_id: l.boqItemId,
      additional_quantity: l.additionalQuantity,
    })),
  });
  if (error) throwRpc(error);
  return String(data);
}

export async function decidePoVariation(id: string, approve: boolean, notes?: string | null): Promise<void> {
  const { error } = await supabase.rpc('decide_po_variation', {
    p_id: id,
    p_approve: approve,
    ...(notes ? { p_notes: notes } : {}),
  });
  if (error) throwRpc(error);
}

export async function issuePoRevision(variationId: string): Promise<number> {
  const { data, error } = await supabase.rpc('issue_po_revision', { p_variation_id: variationId });
  if (error) throwRpc(error);
  return Number(data);
}

export async function linkPoVariation(
  variationId: string,
  workOrderId: string | null,
  reason: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('link_po_variation', {
    p_variation_id: variationId,
    p_work_order_id: workOrderId as string,
    p_not_passed_reason: reason as string,
  });
  if (error) throwRpc(error);
}

export async function getVariationRoute(variationId: string): Promise<VariationRouteRow | null> {
  const { data, error } = await supabase.rpc('po_variation_route', { p_id: variationId });
  if (error) throwRpc(error);
  return (data?.[0] as VariationRouteRow) ?? null;
}

export async function getProjectSubcontractExposure(projectId: string): Promise<ProjectSubcontractExposureRow[]> {
  const { data, error } = await supabase.rpc('project_subcontract_exposure', { p_project_id: projectId });
  if (error) throwRpc(error);
  return (data ?? []) as ProjectSubcontractExposureRow[];
}

export async function listWorkOrderCostVariations(workOrderId: string): Promise<WorkOrderCostVariationRow[]> {
  const { data, error } = await supabase.rpc('work_order_cost_variations', { p_work_order_id: workOrderId });
  if (error) throwRpc(error);
  return (data ?? []) as WorkOrderCostVariationRow[];
}

export async function listSubcontractCapExceptions(procurementId: string): Promise<SubcontractCapExceptionRow[]> {
  const { data, error } = await supabase.rpc('subcontract_cap_exceptions', { p_procurement_id: procurementId });
  if (error) throwRpc(error);
  return (data ?? []) as SubcontractCapExceptionRow[];
}

export async function attributeSubcontractBillLines(
  invoiceId: string,
  lines: AttributeSubcontractBillLineInput[],
): Promise<void> {
  const { error } = await supabase.rpc('attribute_subcontract_bill_lines', {
    p_invoice_id: invoiceId,
    p_lines: lines.map((l) => ({
      boq_item_id: l.boqItemId,
      quantity: l.quantity,
      rate: l.rate,
    })),
  });
  if (error) throwRpc(error);
}
