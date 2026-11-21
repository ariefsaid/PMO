import { supabase } from '@/src/lib/supabase/client';
import { fetchAllPages } from '@/src/lib/pagedRead';
import { AppError } from '@/src/lib/appError';

/**
 * Billing stages, per-item reconciliation and retention DAL (#2522, #1572; migrations 0960–0962). Every write is a SECURITY
 * DEFINER RPC (no client write grant exists on these tables); reads are RLS-scoped. org_id is never sent from the client.
 * A database refusal names its reason in `details` (e.g. `stage-out-of-order`, `billing-stages-incomplete`); that becomes the
 * AppError code the screen explains.
 */

/** A stage plan has at most 20 stages (the table's check), each with at most 20 checklist items. */
const STAGE_LIMIT = 20;

function fail(error: { message: string; code?: string; details?: string | null }): never {
  const detail = typeof error.details === 'string' && /^[a-z][a-z-]*$/.test(error.details) ? error.details : undefined;
  throw new AppError(error.message, detail ?? error.code);
}

export interface StageTemplateInput {
  name: string;
  clientSide: boolean;
  /** Target whole days, 1 to 365 (#2592); null = no target, never overdue. */
  targetDays?: number | null;
  /** An optional stage may be marked not needed (#2592). */
  optional?: boolean;
  documents: Array<{ name: string; required: boolean }>;
}

export interface StageChecklistItem {
  id: string;
  position: number;
  name: string;
  required: boolean;
  documentId: string | null;
}

export interface ClaimBillingStage {
  id: string;
  position: number;
  name: string;
  clientSide: boolean;
  /** Copied from the project's list when the claim was made; null = no target (#2592). */
  targetDays?: number | null;
  optional?: boolean;
  startedOn: string | null;
  completedOn: string | null;
  /** Marked not needed on this day, with a reason (#2592); counts as complete for the invoice. */
  skippedOn?: string | null;
  skippedReason?: string | null;
  clientReference: string | null;
  note: string | null;
  documents: StageChecklistItem[];
}

export interface ClaimRetention {
  pct: number;
  amount: number;
  scheduled: number;
  released: number;
  held: number;
}

export interface ClaimBillingTrace {
  stages: ClaimBillingStage[];
  retention: ClaimRetention | null;
  deadline: { day: number | null; warnDays: number } | null;
}

export interface CompleteStageInput {
  stageId: string;
  completedOn: string;
  clientReference: string | null;
  note: string | null;
}

export type ReconciliationStatus = 'unbilled' | 'partly_billed' | 'fully_billed' | 'surplus';

export interface ReconciliationRow {
  boqItemId: string;
  itemCode: string;
  description: string;
  unit: string;
  rate: number;
  scopeQty: number;
  /** Null when the item is shared with another work order: project-level progress is never apportioned (FR-BST-042). */
  progressQty: number | null;
  measuredQty: number;
  billedQty: number;
  billedAmount: number;
  unbilledQty: number | null;
  surplusQty: number;
  status: ReconciliationStatus;
}

export interface RetentionReleaseInput {
  claimId: string;
  amount: number;
  dueOn: string;
  note: string | null;
}

export interface RetentionReleaseRow {
  id: string;
  amount: number;
  dueOn: string;
  note: string | null;
  releasedOn: string | null;
  referenceNo: string | null;
  documentId: string | null;
}

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const stagesPayload = (stages: StageTemplateInput[]) => stages.map((s) => ({
  name: s.name, client_side: s.clientSide,
  ...(s.targetDays != null ? { target_days: s.targetDays } : {}), ...(s.optional ? { optional: true } : {}),
  documents: s.documents.map((d) => ({ name: d.name, required: d.required })),
}));

export async function setBillingStageTemplate(projectId: string, stages: StageTemplateInput[]): Promise<number> {
  const { data, error } = await supabase.rpc('set_billing_stage_template', {
    p_project: projectId,
    p_stages: stagesPayload(stages),
  });
  if (error) fail(error);
  return Number(data);
}

export async function setProjectBillingTerms(projectId: string, stages: StageTemplateInput[], day: number | null, warnDays: number, pct: number): Promise<void> {
  const { error } = await supabase.rpc('set_project_billing_terms', {
    p_project: projectId,
    p_stages: stagesPayload(stages),
    p_day: day as number, p_warn_days: warnDays, p_pct: pct,
  });
  if (error) fail(error);
}

export async function getBillingStageTemplate(projectId: string): Promise<StageTemplateInput[]> {
  const { data, error } = await supabase.from('billing_stage_templates')
    .select('position,name,client_side,target_days,optional,documents:billing_stage_template_documents(position,name,required)')
    .eq('project_id', projectId).order('position').limit(STAGE_LIMIT);
  if (error) fail(error);
  return (data ?? []).map((s) => ({
    name: s.name,
    clientSide: s.client_side,
    targetDays: s.target_days,
    optional: s.optional,
    documents: [...(s.documents ?? [])].sort((a, b) => a.position - b.position).map((d) => ({ name: d.name, required: d.required })),
  }));
}

export interface ProjectBillingTerms {
  deadlineDay: number | null;
  warnDays: number;
  retentionPct: number;
}

export async function getProjectBillingTerms(projectId: string): Promise<ProjectBillingTerms | null> {
  const { data, error } = await supabase.from('projects')
    .select('invoice_deadline_day,invoice_deadline_warn_days,retention_pct').eq('id', projectId).maybeSingle();
  if (error) fail(error);
  return data ? { deadlineDay: data.invoice_deadline_day, warnDays: data.invoice_deadline_warn_days, retentionPct: num(data.retention_pct) } : null;
}

export async function setProjectInvoiceDeadline(projectId: string, day: number | null, warnDays: number): Promise<void> {
  const { error } = await supabase.rpc('set_project_invoice_deadline', { p_project: projectId, p_day: day as number, p_warn_days: warnDays });
  if (error) fail(error);
}

export async function setProjectRetention(projectId: string, pct: number): Promise<void> {
  const { error } = await supabase.rpc('set_project_retention', { p_project: projectId, p_pct: pct });
  if (error) fail(error);
}

/** One claim's stages with their checklists, its retention and the project's monthly invoice deadline. */
export async function getClaimBillingTrace(claimId: string, projectId: string): Promise<ClaimBillingTrace> {
  const [stagesRes, retentionRes, projectRes] = await Promise.all([
    supabase.from('claim_billing_stages')
      .select('id,position,name,client_side,target_days,optional,started_on,completed_on,skipped_on,skipped_reason,client_reference,note,documents:claim_billing_stage_documents(id,position,name,required,document_id)')
      .eq('claim_id', claimId).order('position').limit(STAGE_LIMIT),
    supabase.from('claim_retention').select('retention_pct,retention_amount,scheduled,released,held').eq('claim_id', claimId).maybeSingle(),
    supabase.from('projects').select('invoice_deadline_day,invoice_deadline_warn_days').eq('id', projectId).maybeSingle(),
  ]);
  if (stagesRes.error) fail(stagesRes.error);
  if (retentionRes.error) fail(retentionRes.error);
  if (projectRes.error) fail(projectRes.error);
  const stages = [...(stagesRes.data ?? [])].sort((a, b) => a.position - b.position).map((s) => ({
    id: s.id,
    position: s.position,
    name: s.name,
    clientSide: s.client_side,
    targetDays: s.target_days,
    optional: s.optional,
    startedOn: s.started_on,
    completedOn: s.completed_on,
    skippedOn: s.skipped_on,
    skippedReason: s.skipped_reason,
    clientReference: s.client_reference,
    note: s.note,
    documents: [...(s.documents ?? [])].sort((a, b) => a.position - b.position).map((d) => ({
      id: d.id, position: d.position, name: d.name, required: d.required, documentId: d.document_id,
    })),
  }));
  const r = retentionRes.data;
  const p = projectRes.data;
  return {
    stages,
    retention: r ? { pct: num(r.retention_pct), amount: num(r.retention_amount), scheduled: num(r.scheduled), released: num(r.released), held: num(r.held) } : null,
    deadline: p ? { day: p.invoice_deadline_day, warnDays: p.invoice_deadline_warn_days } : null,
  };
}

export async function attachBillingStageDocument(itemId: string, documentId: string): Promise<void> {
  const { error } = await supabase.rpc('attach_billing_stage_document', { p_item: itemId, p_document: documentId });
  if (error) fail(error);
}

export async function completeBillingStage(input: CompleteStageInput): Promise<void> {
  const { error } = await supabase.rpc('complete_billing_stage', {
    p_stage: input.stageId,
    p_completed_on: input.completedOn,
    p_client_reference: input.clientReference as string,
    p_note: input.note as string,
  });
  if (error) fail(error);
}

/** Marks an optional current stage not needed, with a reason (#2592). Finance or an Admin; the database refuses anyone else. */
export async function skipBillingStage(stageId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('skip_billing_stage', { p_stage: stageId, p_reason: reason });
  if (error) fail(error);
}

export async function noteBillingStage(stageId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('note_billing_stage', { p_stage: stageId, p_note: note });
  if (error) fail(error);
}

/** The one server derivation (FR-BST-040, NFR-BST-003); every page, since a bill of quantities can pass 1,000 lines. */
export async function getBillingReconciliation(projectId: string, workOrderId: string | null): Promise<ReconciliationRow[]> {
  const rows = await fetchAllPages((from, to) =>
    supabase.rpc('billing_reconciliation', { p_project: projectId, ...(workOrderId ? { p_work_order: workOrderId } : {}) }).range(from, to));
  return rows.map((r) => ({
    boqItemId: r.boq_item_id,
    itemCode: r.item_code,
    description: r.description,
    unit: r.unit,
    rate: num(r.rate),
    scopeQty: num(r.scope_qty),
    progressQty: numOrNull(r.progress_qty),
    measuredQty: num(r.measured_qty),
    billedQty: num(r.billed_qty),
    billedAmount: num(r.billed_amount),
    unbilledQty: numOrNull(r.unbilled_qty),
    surplusQty: num(r.surplus_qty),
    status: r.status as ReconciliationStatus,
  }));
}

export async function listRetentionReleases(claimId: string): Promise<RetentionReleaseRow[]> {
  const rows = await fetchAllPages((from, to) => supabase.from('retention_releases')
    .select('id,amount,due_on,note,released_on,reference_no,document_id')
    .eq('claim_id', claimId).order('due_on').order('id').range(from, to));
  return rows.map((r) => ({
    id: r.id, amount: num(r.amount), dueOn: r.due_on, note: r.note, releasedOn: r.released_on, referenceNo: r.reference_no, documentId: r.document_id,
  }));
}

export async function scheduleRetentionRelease(input: RetentionReleaseInput): Promise<string> {
  const { data, error } = await supabase.rpc('schedule_retention_release', {
    p_claim: input.claimId, p_amount: input.amount, p_due_on: input.dueOn, ...(input.note ? { p_note: input.note } : {}),
  });
  if (error) fail(error);
  return data as string;
}

export async function releaseRetention(releaseId: string, releasedOn: string, reference: string | null, documentId: string | null): Promise<void> {
  const { error } = await supabase.rpc('release_retention', {
    p_release: releaseId, p_released_on: releasedOn,
    ...(reference ? { p_reference: reference } : {}), ...(documentId ? { p_document: documentId } : {}),
  });
  if (error) fail(error);
}

export async function cancelRetentionRelease(releaseId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_retention_release', { p_release: releaseId });
  if (error) fail(error);
}
