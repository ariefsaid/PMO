import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';
import type { AllocationFacts, ContractLineFacts, EarningBasis, ProjectBillingFacts } from '@/src/lib/progressBilling';

/**
 * Progress-billing DAL (#766, migration 0250). BoQ lines are RLS-scoped table writes; an assessment goes
 * through the INVOKER `record_progress_assessment` (#765's rule); billing claims and evidence go ONLY through
 * definer RPCs (no client write grant exists); the summary is the INVOKER `get_project_billing`.
 * org_id is never sent from the client.
 */
export type BoqItemRow = Tables<'boq_items'>;
export type ProgressClaimRow = Tables<'progress_claims'>;
export type ProgressClaimLineRow = Tables<'progress_claim_lines'>;

export interface ClaimEvidenceRef {
  id: string;
  document_id: string;
  document_status: string;
  document_revision: string | null;
}

export interface ProgressClaimWithInvoice extends ProgressClaimRow {
  lines: ProgressClaimLineRow[];
  evidence: ClaimEvidenceRef[];
  /** The claim's invoice mirror (id = claim id), or null when not yet raised. */
  invoice: { si_number: string | null; status: string; amount: number | null } | null;
}

export interface BoqItemInput {
  itemCode: string;
  description: string;
  unit: string;
  quantity: number;
  rate: number;
  earningBasis: EarningBasis;
  lineNo: number | null;
}

export interface ProgressClaimInput {
  projectId: string;
  kind: 'down_payment' | 'progress';
  workOrderId: string | null;
  lines?: Array<{ boqItemId: string; quantity: number }>;
  downPaymentAmount?: number;
  recoveryPct?: number;
  recoverRemaining?: boolean;
}

export interface ProgressAssessmentInput {
  projectId: string;
  /** First day of the month, `YYYY-MM-01`. */
  month: string;
  /** Every BoQ line, with its quantity done to date (0 for none). */
  quantities: Array<{ boqItemId: string; quantityToDate: number }>;
  note: string | null;
}

/** Claims shown per project. A project bills monthly; 500 is years of claims and below PostgREST's 1000. */
const CLAIM_LIST_LIMIT = 500;

function fail(error: { message: string; code?: string }): never {
  throw new AppError(error.message, error.code);
}

export async function listBoqItems(projectId: string): Promise<BoqItemRow[]> {
  const { data, error } = await supabase.from('boq_items').select('*')
    .eq('project_id', projectId)
    .order('line_no', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) fail(error);
  return data ?? [];
}

export async function createBoqItem(projectId: string, input: BoqItemInput): Promise<BoqItemRow> {
  const { data, error } = await supabase.from('boq_items').insert({
    project_id: projectId, item_code: input.itemCode, description: input.description, unit: input.unit,
    quantity: input.quantity, rate: input.rate, earning_basis: input.earningBasis, line_no: input.lineNo,
  }).select().single();
  if (error) fail(error);
  return data as BoqItemRow;
}

export async function updateBoqItem(id: string, input: BoqItemInput): Promise<void> {
  const { data, error } = await supabase.from('boq_items').update({
    item_code: input.itemCode, description: input.description, unit: input.unit,
    quantity: input.quantity, rate: input.rate, earning_basis: input.earningBasis, line_no: input.lineNo,
  }).eq('id', id).select('id');
  if (error) fail(error);
  assertWriteLanded(data, 'Bill of quantities line not found or you do not have permission to edit it.');
}

export async function deleteBoqItem(id: string): Promise<void> {
  const { data, error } = await supabase.from('boq_items').delete().eq('id', id).select('id');
  if (error) fail(error);
  assertWriteLanded(data, 'Bill of quantities line not found or you do not have permission to delete it.');
}

export async function listProjectClaims(projectId: string): Promise<ProgressClaimWithInvoice[]> {
  const { data, error } = await supabase.from('progress_claims')
    .select('*, lines:progress_claim_lines(*), evidence:progress_claim_evidence(id,document_id,document_status,document_revision)')
    .eq('project_id', projectId).order('created_at', { ascending: false }).limit(CLAIM_LIST_LIMIT);
  if (error) fail(error);
  const claims = (data ?? []) as Array<ProgressClaimRow & { lines: ProgressClaimLineRow[]; evidence: ClaimEvidenceRef[] }>;
  if (claims.length === 0) return [];
  const { data: invoices, error: invoiceError } = await supabase.from('sales_invoices')
    .select('id,si_number,status,amount').in('id', claims.map((claim) => claim.id));
  if (invoiceError) fail(invoiceError);
  const byId = new Map((invoices ?? []).map((invoice) => [invoice.id, invoice]));
  return claims.map((claim) => {
    const invoice = byId.get(claim.id);
    return { ...claim, invoice: invoice ? { si_number: invoice.si_number, status: invoice.status, amount: invoice.amount } : null };
  });
}

/** Sends only what a person decides; the server copies rates and computes the recovery (DD-PBL-5). */
export async function createProgressClaim(input: ProgressClaimInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_progress_claim', {
    p_project_id: input.projectId,
    p_kind: input.kind,
    ...(input.workOrderId ? { p_work_order_id: input.workOrderId } : {}),
    ...(input.lines ? { p_lines: input.lines.map((line) => ({ boq_item_id: line.boqItemId, quantity: line.quantity })) } : {}),
    ...(input.downPaymentAmount !== undefined ? { p_down_payment_amount: input.downPaymentAmount } : {}),
    ...(input.recoveryPct !== undefined ? { p_recovery_pct: input.recoveryPct } : {}),
    ...(input.recoverRemaining !== undefined ? { p_recover_remaining: input.recoverRemaining } : {}),
  });
  if (error) fail(error);
  return data as string;
}

export async function withdrawProgressClaim(id: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_progress_claim', { p_id: id });
  if (error) fail(error);
}

export async function attachClaimEvidence(claimId: string, documentId: string): Promise<void> {
  const { error } = await supabase.rpc('attach_claim_evidence', { p_claim_id: claimId, p_document_id: documentId });
  if (error) fail(error);
}

/** Returns the month's derived percent complete (DD-PBL-3). */
export async function recordProgressAssessment(input: ProgressAssessmentInput): Promise<number> {
  const { data, error } = await supabase.rpc('record_progress_assessment', {
    p_project_id: input.projectId,
    p_month: input.month,
    p_quantities: input.quantities.map((line) => ({ boq_item_id: line.boqItemId, quantity_to_date: line.quantityToDate })),
    ...(input.note ? { p_note: input.note } : {}),
  });
  if (error) fail(error);
  return Number(data);
}

function malformed(what: string): never {
  throw new AppError(`billing summary has a malformed ${what}`, 'billing-malformed');
}

/** A required finite number; null, missing, blank and non-finite values are errors, never zero. */
function finite(value: unknown, what: string): number {
  const parsed = typeof value === 'string' ? (value.trim() === '' ? NaN : Number(value)) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(parsed)) malformed(what);
  return parsed;
}

function parseAllocation(raw: unknown): AllocationFacts {
  if (typeof raw !== 'object' || raw === null) malformed('allocation');
  const a = raw as Record<string, unknown>;
  if (typeof a.work_order_id !== 'string' || typeof a.boq_item_id !== 'string' || typeof a.final !== 'boolean'
    || !('accepted_quantity' in a)) malformed('allocation');
  return {
    workOrderId: a.work_order_id,
    boqItemId: a.boq_item_id,
    quantity: finite(a.quantity, 'allocation quantity'),
    claimedQuantity: finite(a.claimed_quantity, 'allocation claimed quantity'),
    // null = no confirmed BAST, which is not the same as a BAST of zero.
    acceptedQuantity: a.accepted_quantity === null ? null : finite(a.accepted_quantity, 'allocation accepted quantity'),
    final: a.final,
  };
}

function parseContractLine(line: Record<string, unknown>): ContractLineFacts {
  if (typeof line.boq_item_id !== 'string') malformed('contract line');
  if (line.earning_basis !== 'unit_rate' && line.earning_basis !== 'lump_sum') malformed('earning basis');
  if (!Array.isArray(line.allocations)) malformed('allocations list');
  return {
    boqItemId: line.boq_item_id,
    earningBasis: line.earning_basis,
    lineNo: line.line_no === null || line.line_no === undefined ? null : finite(line.line_no, 'line number'),
    orderedQuantity: finite(line.ordered_quantity, 'ordered quantity'),
    acceptedQuantity: finite(line.accepted_quantity, 'accepted quantity'),
    closedFinal: finite(line.closed_final, 'closed final quantity'),
    earnedQuantity: finite(line.earned_quantity, 'earned quantity'),
    contractBalance: finite(line.contract_balance, 'contract balance'),
    allocations: (line.allocations as unknown[]).map(parseAllocation),
  };
}

export async function getProjectBilling(projectId: string): Promise<ProjectBillingFacts | null> {
  const { data, error } = await supabase.rpc('get_project_billing', { p_project_id: projectId });
  if (error) fail(error);
  if (data === null || data === undefined) return null;
  const raw = data as Record<string, unknown>;
  const num = (key: string): number => finite(raw[key], key);
  const boq = Array.isArray(raw.boq) ? (raw.boq as Array<Record<string, unknown>>) : null;
  if (typeof raw.currency !== 'string' || boq === null) throw new AppError('billing summary is malformed', 'billing-malformed');
  const rawAssessment = raw.assessment as { month?: unknown; pct_complete?: unknown } | null | undefined;
  let assessment: ProjectBillingFacts['assessment'] = null;
  if (rawAssessment !== null && rawAssessment !== undefined) {
    const pct = Number(rawAssessment.pct_complete);
    if (typeof rawAssessment.month !== 'string' || !Number.isFinite(pct)) {
      throw new AppError('billing summary has a malformed assessment', 'billing-malformed');
    }
    assessment = { month: rawAssessment.month, pctComplete: pct };
  }
  return {
    currency: raw.currency,
    contractNet: num('contract_net'),
    workBilled: num('work_billed'),
    dpBilled: num('dp_billed'),
    dpRecovered: num('dp_recovered'),
    notSubmitted: num('not_submitted'),
    assessment,
    claimedByBoqItem: Object.fromEntries(boq.map((line) => [line.boq_item_id as string, Number(line.claimed_quantity)])),
    assessedByBoqItem: Object.fromEntries(boq
      .filter((line) => line.assessed_quantity !== null && line.assessed_quantity !== undefined)
      .map((line) => [line.boq_item_id as string, Number(line.assessed_quantity)])),
    earnedValue: num('earned_value'),
    contractLines: boq.map(parseContractLine),
  };
}
