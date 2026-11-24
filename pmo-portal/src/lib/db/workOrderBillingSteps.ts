import { supabase } from '@/src/lib/supabase/client';
import { nullableArg } from './nullableArg';
import { AppError } from '@/src/lib/appError';
import type { StepInput } from './billingSteps';

/**
 * A work order's billing step list (migrations 1770-1774; docs/specs/billing-steps.spec.md). Advisory: nothing here reads or writes
 * the claim's own steps, and no invoice gate reads this list. Every read runs under the tables' policies (hidden-from, the see right,
 * the field-account refusal), so a step the viewer may not see is simply absent; every write is a definer function whose refusal
 * reads `WBS_CODE: sentence` (the refusals catalogue).
 */
const STEP_LIMIT = 20;
const BOARD_LIMIT = 500;

function fail(error: { message: string; code?: string }): never {
  throw new AppError(error.message, error.code);
}

export interface WorkOrderStepDocument {
  id: string;
  position: number;
  name: string;
  required: boolean;
  documentId: string | null;
}

export interface WorkOrderStep {
  id: string;
  workOrderId: string;
  projectId: string;
  position: number;
  name: string;
  ownerRoleKey: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  targetDays: number | null;
  optional: boolean;
  startedOn: string | null;
  doneOn: string | null;
  skippedOn: string | null;
  documents: WorkOrderStepDocument[];
}

export interface BoardWorkOrderStep extends WorkOrderStep {
  workOrderLabel: string;
  projectName: string;
}

export interface WaitingWorkOrderStep {
  stepId: string;
  workOrderId: string;
  projectId: string;
  projectName: string;
  workOrderLabel: string;
  stepName: string;
  startedOn: string;
  targetDays: number | null;
}

export interface TemplateStepRoles {
  position: number;
  ownerRoleKey: string | null;
  hiddenFromRoleKeys: string[];
}

interface StepRow {
  id: string; work_order_id: string; project_id: string; position: number; name: string; owner_role_key: string | null;
  assignee_id: string | null; target_days: number | null; optional: boolean; started_on: string | null; done_on: string | null;
  skipped_on: string | null; assignee: { full_name: string } | null;
  documents: Array<{ id: string; position: number; name: string; required: boolean; document_id: string | null }>;
}

function toStep(r: StepRow): WorkOrderStep {
  return {
    id: r.id, workOrderId: r.work_order_id, projectId: r.project_id, position: r.position, name: r.name, ownerRoleKey: r.owner_role_key,
    assigneeId: r.assignee_id, assigneeName: r.assignee?.full_name ?? null, targetDays: r.target_days, optional: r.optional,
    startedOn: r.started_on, doneOn: r.done_on, skippedOn: r.skipped_on,
    documents: [...r.documents].sort((a, b) => a.position - b.position)
      .map((d) => ({ id: d.id, position: d.position, name: d.name, required: d.required, documentId: d.document_id })),
  };
}

/** One work order's list, in order. Empty when the work order has none or the viewer may see none of it. */
export async function listWorkOrderSteps(workOrderId: string): Promise<WorkOrderStep[]> {
  const { data, error } = await supabase.from('work_order_billing_steps')
    .select('id,work_order_id,project_id,position,name,owner_role_key,assignee_id,target_days,optional,started_on,done_on,skipped_on,assignee:profiles!work_order_billing_steps_assignee_id_fkey(full_name),documents:work_order_billing_step_documents(id,position,name,required,document_id)')
    .eq('work_order_id', workOrderId).order('position').limit(STEP_LIMIT);
  if (error) fail(error);
  return (data ?? []).map(toStep);
}

/** The steps of every issued work order the viewer may see (the billing board rows). Optionally one project. */
export async function listBoardWorkOrderSteps(projectId?: string): Promise<BoardWorkOrderStep[]> {
  let q = supabase.from('work_orders')
    .select('id,wo_number,title,project_id,project:projects!project_id(name),steps:work_order_billing_steps(id,work_order_id,project_id,position,name,owner_role_key,assignee_id,target_days,optional,started_on,done_on,skipped_on,assignee:profiles!work_order_billing_steps_assignee_id_fkey(full_name),documents:work_order_billing_step_documents(id,position,name,required,document_id))')
    .eq('status', 'Issued');
  if (projectId) q = q.eq('project_id', projectId);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(BOARD_LIMIT);
  if (error) fail(error);
  return (data ?? []).flatMap((w) => w.steps.map((r) => ({ ...toStep(r), workOrderLabel: w.wo_number ?? w.title, projectName: w.project?.name ?? '' })));
}

export async function getWaitingWorkOrderSteps(): Promise<WaitingWorkOrderStep[]> {
  const { data, error } = await supabase.rpc('my_waiting_work_order_steps');
  if (error) fail(error);
  return (data ?? []).map((r) => ({
    stepId: r.step_id, workOrderId: r.work_order_id, projectId: r.project_id, projectName: r.project_name,
    workOrderLabel: r.work_order_label, stepName: r.step_name, startedOn: r.started_on, targetDays: r.target_days,
  }));
}

export async function completeWorkOrderStep(stepId: string, doneOn: string): Promise<void> {
  const { error } = await supabase.rpc('complete_work_order_step', { p_step: stepId, p_done_on: doneOn });
  if (error) fail(error);
}

export async function skipWorkOrderStep(stepId: string): Promise<void> {
  const { error } = await supabase.rpc('skip_work_order_step', { p_step: stepId });
  if (error) fail(error);
}

/**
 * Add a step to one work order's own checklist after the step at `afterPosition` (0 = first), for a person who runs billing steps
 * (migration 2180). The database stamps the organisation and the project, and opens the step itself on a list that has no current step.
 */
export async function addWorkOrderStep(
  workOrderId: string, afterPosition: number | null, step: Pick<StepInput, 'name' | 'ownerRoleKey' | 'targetDays' | 'optional'>,
): Promise<string> {
  const { data, error } = await supabase.rpc('add_work_order_step', {
    p_work_order: workOrderId, p_after_position: afterPosition,
    p_step: {
      name: step.name,
      ...(step.ownerRoleKey ? { owner_role_key: step.ownerRoleKey } : {}),
      ...(step.targetDays != null ? { target_days: step.targetDays } : {}),
      ...(step.optional ? { optional: true } : {}),
    },
  });
  if (error) fail(error);
  return String(data);
}

/** The per-organisation gate for editing an issued work order's checklist (migration 2181); a missing row is off. */
export async function getWorkOrderChecklistEnabled(): Promise<boolean> {
  const { data, error } = await supabase.from('organizations').select('work_order_checklist_enabled').limit(1);
  if (error) fail(error);
  return data?.[0]?.work_order_checklist_enabled === true;
}

/** Only an Admin may change the checklist-edit switch; the database writes and audits the organisation setting. */
export async function setWorkOrderChecklistEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_org_work_order_checklist_edit', { p_enabled: enabled });
  if (error) fail(error);
}

/** Whether work-order billing-step documents are automatically reused as claim evidence (migration 2600); default true. */
export async function getWorkOrderEvidenceReuseEnabled(): Promise<boolean> {
  const { data, error } = await supabase.from('organizations').select('work_order_evidence_reuse_enabled').limit(1);
  if (error) fail(error);
  return data?.[0]?.work_order_evidence_reuse_enabled === true;
}

/** Only an Admin may change the work-order evidence reuse switch; the database writes and audits the organisation setting. */
export async function setWorkOrderEvidenceReuseEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_org_work_order_evidence_reuse', { p_enabled: enabled });
  if (error) fail(error);
}

/** Saves the complete checklist, including steps the caller cannot see, through the database copy function (migration 2181). */
export async function saveWorkOrderChecklistAsTemplate(workOrderId: string, name: string): Promise<string> {
  const { data, error } = await supabase.rpc('save_work_order_steps_as_template', { p_work_order: workOrderId, p_name: name });
  if (error) fail(error);
  return String(data);
}

export async function assignWorkOrderStep(stepId: string, personId: string | null): Promise<void> {
  const { error } = await supabase.rpc('assign_work_order_step', { p_step: stepId, p_person: nullableArg(personId) });
  if (error) fail(error);
}

/** Attach a project document to a checklist slot, or (no slot) as an extra attachment. */
export async function attachWorkOrderStepDocument(stepId: string, slotId: string | null, documentId: string): Promise<void> {
  const { error } = await supabase.rpc('attach_work_order_step_document', { p_step: stepId, p_slot: nullableArg(slotId), p_document: documentId });
  if (error) fail(error);
}

/** The organisation's default billing step template id, or null when none is chosen (then no work order gets a list). */
export async function getDefaultStepTemplateId(): Promise<string | null> {
  const { data, error } = await supabase.from('org_billing_step_settings').select('default_template_id').maybeSingle();
  if (error) fail(error);
  return data?.default_template_id ?? null;
}

export async function setDefaultStepTemplate(templateId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_default_billing_step_template', { p_template: nullableArg(templateId) });
  if (error) fail(error);
}

export async function setTemplateStepRoles(templateId: string, roles: TemplateStepRoles[]): Promise<void> {
  const { error } = await supabase.rpc('set_billing_step_template_roles', {
    p_template: templateId,
    p_roles: roles.map((r) => ({ position: r.position, owner_role_key: r.ownerRoleKey, hidden_from_role_keys: r.hiddenFromRoleKeys })),
  });
  if (error) fail(error);
}
