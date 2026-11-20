import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Json } from '@/src/lib/supabase/database.types';

/**
 * Subcontractor progress certificates, the rate card and backcharges (#2584, migrations 1135 to 1138).
 *
 * The database derives, freezes and approves; this module only carries the request. org_id is never sent (RLS and
 * triggers stamp it); no quantity or amount is ever sent (the server derives them, FR-SPC-005). A refusal keeps its
 * Postgres code (`42501` not allowed or a separation-of-duties refusal, `23514` rule, `23505` already certified or
 * billed, `SC001` the cap) so `certificateErrorKey` can name it.
 */

export type CertificateStatus = 'draft' | 'submitted' | 'returned' | 'approved' | 'billed' | 'cancelled';

export interface CertificateRow {
  id: string;
  po_id: string;
  procurement_id: string;
  project_id: string;
  work_order_id: string;
  vendor_company_id: string;
  currency: string;
  period_start: string;
  period_end: string;
  status: CertificateStatus;
  prepared_by: string;
  submitted_by: string | null;
  approved_by: string | null;
  gross: number | null;
  backcharge_total: number | null;
  net: number | null;
  invoice_id: string | null;
  bill_refusal: string | null;
  acceptance_id: string | null;
  returned_reason: string | null;
  cancel_reason: string | null;
  created_at: string;
}

export type ExcludedReason =
  | 'report_superseded' | 'report_not_validated' | 'not_vendor_crew' | 'item_not_on_po' | 'already_certified' | 'deselected'
  | 'unrated_no_rate' | 'unrated_currency' | 'unrated_unit' | 'unrated_above_po_rate';

export interface CertificateLine {
  boq_item_id: string;
  item_code: string;
  unit: string;
  measured_quantity: number;
  rate: number;
  po_rate: number;
  amount: number;
  po_qty?: number;
  verified?: number;
  billed?: number;
  certified_to_date?: number;
  cap_ok?: boolean;
  verified_short?: boolean;
}

export interface ExcludedSource {
  work_date: string;
  work_order_line_id: string;
  crew_id: string | null;
  boq_item_id: string;
  item_code: string;
  quantity: number;
  reason: ExcludedReason;
  certificate_id?: string | null;
  period_start?: string | null;
}

export interface CertificateBackcharge { id: string; amount: number; reason_code: string; reason_text: string | null; held: boolean }

export interface MeasuredDay { work_date: string; work_order_line_id: string; crew_id: string; boq_item_id: string; quantity: number }

export interface CertificateDerived {
  lines: CertificateLine[];
  /** Draft and returned only: the measured days behind the lines, each of which can be set aside. */
  tuples?: MeasuredDay[];
  excluded: ExcludedSource[];
  unrated: Array<{ boq_item_id: string; item_code: string; measured_quantity: number; reason: ExcludedReason }>;
  backcharges: CertificateBackcharge[];
  gross: number;
  backcharge_total: number;
  net: number;
}

export interface CertificateView { certificate: CertificateRow; derived: CertificateDerived }

export interface BillResult { status: 'billed' | 'refused'; invoice_id?: string; payable?: number; code?: string; message?: string }

export interface RateLineRow {
  id: string;
  vendor_company_id: string;
  boq_item_id: string;
  unit: string;
  rate: number;
  currency: string;
  effective_from: string;
  effective_to: string | null;
  version: number;
}

export interface BackchargeRow {
  id: string;
  vendor_company_id: string;
  project_id: string;
  work_order_id: string | null;
  currency: string;
  amount: number;
  reason_code: string;
  reason_text: string | null;
  claimed_by_certificate_id: string | null;
  archived_at: string | null;
}

export interface SubcontractPoOption { po_id: string; po_number: string | null; title: string; project_id: string | null; vendor_id: string | null; work_order_id: string | null; currency: string }

export interface CertificateFilters { status?: CertificateStatus | ''; offset?: number }
export const CERTIFICATE_PAGE_SIZE = 50;

interface RpcErrorLike { message: string; code?: string; details?: string | null }
function throwRpc(error: RpcErrorLike): never {
  throw new AppError(error.message, error.code, error.details ?? undefined);
}

const CERT_COLUMNS = 'id, po_id, procurement_id, project_id, work_order_id, vendor_company_id, currency, period_start, period_end, status, prepared_by, submitted_by, approved_by, gross, backcharge_total, net, invoice_id, bill_refusal, acceptance_id, returned_reason, cancel_reason, created_at';

/** One bounded page (stable order, newest period first); `hasMore` tells the screen to offer the next page. */
export async function listCertificates(filters: CertificateFilters = {}): Promise<{ rows: CertificateRow[]; hasMore: boolean }> {
  const offset = filters.offset ?? 0;
  let query = supabase.from('subcontract_certificates').select(CERT_COLUMNS);
  if (filters.status) query = query.eq('status', filters.status);
  const { data, error } = await query
    .order('period_start', { ascending: false }).order('id', { ascending: false })
    .range(offset, offset + CERTIFICATE_PAGE_SIZE);
  if (error) throwRpc(error);
  const rows = (data ?? []) as unknown as CertificateRow[];
  return { rows: rows.slice(0, CERTIFICATE_PAGE_SIZE), hasMore: rows.length > CERTIFICATE_PAGE_SIZE };
}

export async function getCertificateView(id: string): Promise<CertificateView> {
  const { data, error } = await supabase.rpc('subcontract_certificate_view', { p_certificate: id });
  if (error) throwRpc(error);
  return data as unknown as CertificateView;
}

export async function prepareCertificate(poId: string, periodStart: string): Promise<string> {
  const { data, error } = await supabase.rpc('prepare_subcontract_certificate', { p_po_id: poId, p_period_start: periodStart });
  if (error) throwRpc(error);
  return String(data);
}

export async function submitCertificate(id: string): Promise<void> {
  const { error } = await supabase.rpc('submit_subcontract_certificate', { p_certificate: id });
  if (error) throwRpc(error);
}

export async function returnCertificate(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('return_subcontract_certificate', { p_certificate: id, p_reason: reason });
  if (error) throwRpc(error);
}

export async function approveCertificate(id: string): Promise<void> {
  const { error } = await supabase.rpc('approve_subcontract_certificate', { p_certificate: id });
  if (error) throwRpc(error);
}

export async function cancelCertificate(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_subcontract_certificate', { p_certificate: id, p_reason: reason });
  if (error) throwRpc(error);
}

export interface BillCertificateInput { certificateId: string; invoiceDate: string; referenceNumber?: string | null }
export async function billCertificate(input: BillCertificateInput): Promise<BillResult> {
  const { data, error } = await supabase.rpc('bill_subcontract_certificate', {
    p_certificate: input.certificateId, p_invoice_date: input.invoiceDate,
    ...(input.referenceNumber ? { p_reference_number: input.referenceNumber } : {}),
  });
  if (error) throwRpc(error);
  return data as unknown as BillResult;
}

export async function setDeselection(input: {
  certificateId: string; workDate: string; workOrderLineId: string; crewId: string; deselect: boolean; reason?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('set_certificate_deselection', {
    p_certificate: input.certificateId, p_work_date: input.workDate, p_work_order_line: input.workOrderLineId, p_crew: input.crewId,
    p_deselect: input.deselect, ...(input.reason ? { p_reason: input.reason } : {}),
  });
  if (error) throwRpc(error);
}

export async function prepareCertificateAcceptance(certificateId: string): Promise<string> {
  const { data, error } = await supabase.rpc('prepare_certificate_acceptance', { p_certificate: certificateId });
  if (error) throwRpc(error);
  return String(data);
}

export interface RecordBackchargeInput {
  vendorId: string; projectId: string; workOrderId?: string | null; amount: number; currency: string; reasonCode: string; reasonText?: string | null;
}
export async function recordBackcharge(input: RecordBackchargeInput): Promise<string> {
  const { data, error } = await supabase.rpc('record_subcontract_backcharge', {
    p_vendor: input.vendorId, p_project: input.projectId, p_amount: input.amount, p_currency: input.currency, p_reason_code: input.reasonCode,
    ...(input.workOrderId ? { p_work_order: input.workOrderId } : {}), ...(input.reasonText ? { p_reason_text: input.reasonText } : {}),
  });
  if (error) throwRpc(error);
  return String(data);
}

export async function setCertificateBackcharge(certificateId: string, backchargeId: string, include: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_certificate_backcharge', { p_certificate: certificateId, p_backcharge: backchargeId, p_include: include });
  if (error) throwRpc(error);
}

/** Unclaimed, unarchived backcharges against the certificate's vendor and project (the ones that can still be included). */
export async function listOpenBackcharges(vendorId: string, projectId: string): Promise<BackchargeRow[]> {
  const { data, error } = await supabase.from('subcontract_backcharges')
    .select('id, vendor_company_id, project_id, work_order_id, currency, amount, reason_code, reason_text, claimed_by_certificate_id, archived_at')
    .eq('vendor_company_id', vendorId).eq('project_id', projectId).is('archived_at', null).order('created_at', { ascending: false }).limit(200);
  if (error) throwRpc(error);
  return (data ?? []) as unknown as BackchargeRow[];
}

/** The rate card (FR-SPC-001/003): RLS decides which vendors a role sees. */
export async function listRateLines(vendorId?: string): Promise<RateLineRow[]> {
  let query = supabase.from('subcontractor_rate_lines')
    .select('id, vendor_company_id, boq_item_id, unit, rate, currency, effective_from, effective_to, version');
  if (vendorId) query = query.eq('vendor_company_id', vendorId);
  const { data, error } = await query.order('vendor_company_id').order('boq_item_id').order('version', { ascending: false }).limit(500);
  if (error) throwRpc(error);
  return (data ?? []) as unknown as RateLineRow[];
}

export interface SetRateInput { vendorId: string; boqItemId: string; unit: string; rate: number; currency: string; effectiveFrom: string; effectiveTo?: string | null }
export async function setRate(input: SetRateInput): Promise<string> {
  const { data, error } = await supabase.rpc('set_subcontractor_rate', {
    p_vendor: input.vendorId, p_boq_item: input.boqItemId, p_unit: input.unit, p_rate: input.rate, p_currency: input.currency,
    p_effective_from: input.effectiveFrom, ...(input.effectiveTo ? { p_effective_to: input.effectiveTo } : {}),
  });
  if (error) throwRpc(error);
  return String(data);
}

/** Subcontract purchases that have an issued PO, for the "new certificate" picker. */
export async function listSubcontractPos(): Promise<SubcontractPoOption[]> {
  const { data, error } = await supabase.from('purchase_orders')
    
    .select('id, po_number, work_order_id, currency, procurements!inner(title, project_id, vendor_id, is_subcontract)')
    .eq('procurements.is_subcontract', true).order('created_at', { ascending: false }).limit(200);
  if (error) throwRpc(error);
  type Raw = { id: string; po_number: string | null; work_order_id: string | null; currency: string; procurements: { title: string; project_id: string | null; vendor_id: string | null } | Array<{ title: string; project_id: string | null; vendor_id: string | null }> };
  return ((data ?? []) as unknown as Raw[]).map((r) => {
    const p = Array.isArray(r.procurements) ? r.procurements[0] : r.procurements;
    return { po_id: r.id, po_number: r.po_number, title: p?.title ?? '', project_id: p?.project_id ?? null, vendor_id: p?.vendor_id ?? null, work_order_id: r.work_order_id, currency: r.currency };
  });
}

/** Re-export for callers that need the raw JSON type. */
export type { Json };
