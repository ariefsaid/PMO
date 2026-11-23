import { supabase } from '@/src/lib/supabase/client';
import { nullableArg } from './nullableArg';
import { AppError } from '@/src/lib/appError';

/**
 * Billing steps per claim, templates and the viewer's waiting steps (#2680; migrations 1365-1369). A claim's step is the existing
 * `claim_billing_stages` row; every write is a SECURITY DEFINER RPC (no client write grant exists) and every rule lives there. A
 * database refusal names its reason in `details` (e.g. `stage-not-editable`, `claim-invoiced`); that becomes the AppError code.
 */


/** A template has at most 20 steps, each with at most 20 checklist items (the tables' checks). */
const STEP_LIMIT = 20;
const TEMPLATE_LIMIT = 200;
const WAITING_LIMIT = 200;

function fail(error: { message: string; code?: string; details?: string | null }): never {
  const detail = typeof error.details === 'string' && /^[a-z][a-z-]*$/.test(error.details) ? error.details : undefined;
  throw new AppError(error.message, detail ?? error.code);
}

export interface StepInput {
  name: string;
  /** A role from the organisation's role set; null/absent = nobody in particular. */
  ownerRole?: string | null;
  /** Whole days, 1 to 365; null = none. */
  targetDays?: number | null;
  /** The step's own target date (ISO day); wins over target days. Claim steps only. */
  targetOn?: string | null;
  clientSide?: boolean;
  optional?: boolean;
  documents?: Array<{ name: string; required: boolean }>;
}

export interface StepTemplate {
  id: string;
  name: string;
  steps: Array<StepInput & { position: number }>;
}

export interface StepPatch {
  name?: string;
  ownerRole?: string | null;
  targetDays?: number | null;
  targetOn?: string | null;
  clientSide?: boolean;
  optional?: boolean;
}

export interface WaitingStep {
  stageId: string;
  claimId: string;
  projectId: string;
  projectName: string;
  stepName: string;
  dueOn: string | null;
  daysOver: number;
}

export interface OverdueClaimStep {
  claimId: string;
  stepName: string;
  daysOver: number;
}

const stepPayload = (s: StepInput) => ({
  name: s.name,
  ...(s.ownerRole !== undefined ? { owner_role: s.ownerRole } : {}),
  ...(s.targetDays !== undefined ? { target_days: s.targetDays } : {}),
  ...(s.targetOn !== undefined ? { target_on: s.targetOn } : {}),
  ...(s.clientSide ? { client_side: true } : {}),
  ...(s.optional ? { optional: true } : {}),
  ...(s.documents ? { documents: s.documents.map((d) => ({ name: d.name, required: d.required })) } : {}),
});

function patchPayload(p: StepPatch) {
  const out: Record<string, string | number | boolean | null> = {};
  if (p.name !== undefined) out.name = p.name;
  if (p.ownerRole !== undefined) out.owner_role = p.ownerRole;
  if (p.targetDays !== undefined) out.target_days = p.targetDays;
  if (p.targetOn !== undefined) out.target_on = p.targetOn;
  if (p.clientSide !== undefined) out.client_side = p.clientSide;
  if (p.optional !== undefined) out.optional = p.optional;
  return out;
}

export async function listStepTemplates(): Promise<StepTemplate[]> {
  const { data, error } = await supabase.from('billing_step_templates')
    .select('id,name,steps:billing_step_template_steps(position,name,owner_role,target_days,client_side,optional,documents:billing_step_template_documents(position,name,required))')
    .is('archived_at', null).order('name').limit(TEMPLATE_LIMIT);
  if (error) fail(error);
  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    steps: [...(t.steps ?? [])].sort((a, b) => a.position - b.position).slice(0, STEP_LIMIT).map((s) => ({
      position: s.position,
      name: s.name,
      ownerRole: s.owner_role,
      targetDays: s.target_days,
      clientSide: s.client_side,
      optional: s.optional,
      documents: [...(s.documents ?? [])].sort((a, b) => a.position - b.position).map((d) => ({ name: d.name, required: d.required })),
    })),
  }));
}

export async function saveStepTemplate(templateId: string | null, name: string, steps: StepInput[]): Promise<string> {
  const { data, error } = await supabase.rpc('save_billing_step_template', {
    // The function has no default for p_template: a new template sends null.
    p_template: nullableArg(templateId), p_name: name, p_steps: steps.map(stepPayload),
  });
  if (error) fail(error);
  return String(data);
}

export async function archiveStepTemplate(templateId: string): Promise<void> {
  const { error } = await supabase.rpc('archive_billing_step_template', { p_template: templateId });
  if (error) fail(error);
}

export async function loadStepTemplateOntoProject(projectId: string, templateId: string): Promise<number> {
  const { data, error } = await supabase.rpc('load_billing_step_template_onto_project', { p_project: projectId, p_template: templateId });
  if (error) fail(error);
  return Number(data);
}

export async function loadStepTemplateOntoClaim(claimId: string, templateId: string): Promise<number> {
  const { data, error } = await supabase.rpc('load_billing_step_template_onto_claim', { p_claim: claimId, p_template: templateId });
  if (error) fail(error);
  return Number(data);
}

export async function updateClaimStep(stageId: string, patch: StepPatch): Promise<void> {
  const { error } = await supabase.rpc('update_claim_billing_step', { p_stage: stageId, p_patch: patchPayload(patch) });
  if (error) fail(error);
}

export async function addClaimStep(claimId: string, afterPosition: number, step: StepInput): Promise<string> {
  const { data, error } = await supabase.rpc('add_claim_billing_step', { p_claim: claimId, p_after_position: afterPosition, p_step: stepPayload(step) });
  if (error) fail(error);
  return String(data);
}

export async function removeClaimStep(stageId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('remove_claim_billing_step', { p_stage: stageId, p_reason: reason });
  if (error) fail(error);
}

export async function moveClaimStep(stageId: string, newPosition: number): Promise<void> {
  const { error } = await supabase.rpc('move_claim_billing_step', { p_stage: stageId, p_new_position: newPosition });
  if (error) fail(error);
}

/** The viewer's waiting steps (current steps owned by their role); the server scopes and caps the list. */
export async function getWaitingSteps(): Promise<WaitingStep[]> {
  const { data, error } = await supabase.rpc('my_waiting_billing_steps');
  if (error) fail(error);
  return (data ?? []).slice(0, WAITING_LIMIT).map((r) => ({
    stageId: r.stage_id, claimId: r.claim_id, projectId: r.project_id, projectName: r.project_name,
    stepName: r.step_name, dueOn: r.due_on, daysOver: Number(r.days_over),
  }));
}

/** One overdue current step per claim of a project (the claim list marker). */
export async function getOverdueStepsByClaim(projectId: string): Promise<OverdueClaimStep[]> {
  const { data, error } = await supabase.rpc('overdue_billing_steps_by_claim', { p_project: projectId });
  if (error) fail(error);
  return (data ?? []).slice(0, WAITING_LIMIT).map((r) => ({ claimId: r.claim_id, stepName: r.step_name, daysOver: Number(r.days_over) }));
}

