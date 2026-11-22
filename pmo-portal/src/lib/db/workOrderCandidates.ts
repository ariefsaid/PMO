import { supabase } from '@/src/lib/supabase/client';
import { nullableArg } from './nullableArg';
import { AppError } from '@/src/lib/appError';
import { sanitizeFilename } from '@/src/lib/storageKey';
import { SIGNED_URL_EXPIRY_SECONDS } from '@/src/lib/fileConstants';
import type { AssessmentStatus } from '@/src/lib/candidateAssessment';
import type { TablesUpdate } from '@/src/lib/supabase/database.types';

/**
 * Candidate work order DAL (#2595, migrations 1405 to 1408). Reads are RLS-scoped selects. A candidate is created
 * and decided only through RPCs; assessment items and proof rows are written by RLS-gated updates and inserts (the
 * assessors). org_id is never sent: the RPCs and the stamp trigger set it, and a proof path takes the org from the
 * candidate row. Every enum-ish column is `text` with a CHECK, so a read validates it rather than trusting it.
 */
export type CandidateStatus = 'assessing' | 'accepted' | 'rejected';
export const CANDIDATE_PROOFS_BUCKET = 'work-order-candidate-proofs';

export interface CandidateProof { id: string; file_path: string; file_name: string | null; archived_at: string | null }
export interface CandidateItem {
  id: string;
  candidate_id: string;
  label: string;
  position: number;
  required: boolean;
  status: AssessmentStatus;
  owner_id: string | null;
  owner_name: string | null;
  target_date: string | null;
  note: string | null;
  proofs: CandidateProof[];
}
export interface WorkOrderCandidate {
  id: string;
  org_id: string;
  project_id: string;
  title: string;
  description: string | null;
  client_reference: string | null;
  offered_on: string;
  status: CandidateStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  work_order_id: string | null;
  replaces_id: string | null;
  items: CandidateItem[];
}
export interface ChecklistTemplateItem { id: string; label: string; position: number; required: boolean }
export interface TemplateItemInput { id?: string | null; label: string; required: boolean }
export interface CandidateInput {
  projectId: string;
  title: string;
  description?: string | null;
  clientReference?: string | null;
  offeredOn?: string | null;
  replacesId?: string | null;
}
export interface DecisionResult { status: 'accepted' | 'rejected'; work_order_id: string | null }
export interface ItemPatch { status?: AssessmentStatus; note?: string | null; ownerId?: string | null; targetDate?: string | null }

const fail = (error: { message: string; code?: string }): never => { throw new AppError(error.message, error.code); };

const STATUSES: readonly AssessmentStatus[] = ['open', 'passed', 'failed', 'not_applicable'];
const CANDIDATE_STATUSES: readonly CandidateStatus[] = ['assessing', 'accepted', 'rejected'];

const CANDIDATE_SELECT =
  'id, org_id, project_id, title, description, client_reference, offered_on, status, decided_by, decided_at, decision_reason, work_order_id, replaces_id, ' +
  'items:work_order_candidate_items(id, candidate_id, label, position, required, status, owner_id, target_date, note, ' +
  'owner:profiles!work_order_candidate_items_owner_id_fkey(full_name), proofs:work_order_candidate_proofs(id, file_path, file_name, archived_at))';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function toItem(raw: unknown): CandidateItem {
  if (!isObj(raw)) throw new AppError('Unknown assessment row');
  if (typeof raw.status !== 'string' || !STATUSES.includes(raw.status as AssessmentStatus)) {
    throw new AppError(`Unknown assessment status "${String(raw.status)}"`);
  }
  const status = raw.status as AssessmentStatus;
  const ownerName = isObj(raw.owner) ? ((raw.owner.full_name as string | null) ?? null) : null;
  return {
    id: raw.id as string, candidate_id: raw.candidate_id as string, label: raw.label as string, position: raw.position as number, required: raw.required === true,
    status, owner_id: (raw.owner_id as string | null) ?? null, owner_name: ownerName,
    target_date: (raw.target_date as string | null) ?? null, note: (raw.note as string | null) ?? null,
    proofs: (Array.isArray(raw.proofs) ? raw.proofs : []).filter(isObj).filter((p) => p.archived_at === null).map((p) => ({
      id: p.id as string, file_path: p.file_path as string, file_name: (p.file_name as string | null) ?? null, archived_at: null,
    })),
  };
}
function toCandidate(raw: unknown): WorkOrderCandidate {
  if (!isObj(raw)) throw new AppError('Unknown candidate row');
  if (typeof raw.status !== 'string' || !CANDIDATE_STATUSES.includes(raw.status as CandidateStatus)) {
    throw new AppError(`Unknown candidate status "${String(raw.status)}"`);
  }
  return {
    id: raw.id as string, org_id: raw.org_id as string, project_id: raw.project_id as string, title: raw.title as string,
    description: (raw.description as string | null) ?? null, client_reference: (raw.client_reference as string | null) ?? null,
    offered_on: raw.offered_on as string, status: raw.status as CandidateStatus,
    decided_by: (raw.decided_by as string | null) ?? null, decided_at: (raw.decided_at as string | null) ?? null,
    decision_reason: (raw.decision_reason as string | null) ?? null, work_order_id: (raw.work_order_id as string | null) ?? null,
    replaces_id: (raw.replaces_id as string | null) ?? null,
    items: (Array.isArray(raw.items) ? raw.items : []).map(toItem).sort((a, b) => a.position - b.position),
  };
}

/** The project's candidates, newest first. RLS scopes the rows; archived proofs are dropped. */
export async function listCandidates(projectId: string): Promise<WorkOrderCandidate[]> {
  const { data, error } = await supabase.from('work_order_candidates').select(CANDIDATE_SELECT)
    .eq('project_id', projectId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(200);
  if (error) fail(error);
  return (data ?? []).map(toCandidate);
}

/** The organisation's live checklist template, in order. Any member reads it; only an Admin saves it. */
export async function listTemplate(): Promise<ChecklistTemplateItem[]> {
  const { data, error } = await supabase.from('work_order_checklist_items').select('id, label, position, required')
    .is('archived_at', null).order('position', { ascending: true }).order('id', { ascending: true }).limit(50);
  if (error) fail(error);
  return data ?? [];
}

/** Save the whole ordered list (Admin). Items without an id are new; live items left out are archived. */
export async function saveTemplate(items: TemplateItemInput[]): Promise<number> {
  const { data, error } = await supabase.rpc('set_work_order_candidate_template', {
    p_items: items.map((i) => ({ ...(i.id ? { id: i.id } : {}), label: i.label.trim(), required: i.required })),
  });
  if (error) fail(error);
  return Number(data);
}

export async function createCandidate(input: CandidateInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_work_order_candidate', {
    p_project_id: input.projectId,
    p_title: input.title.trim(),
    p_description: nullableArg(input.description?.trim() || null),
    p_client_reference: nullableArg(input.clientReference?.trim() || null),
    p_offered_on: nullableArg(input.offeredOn || null),
    p_replaces_id: nullableArg(input.replacesId ?? null),
  });
  if (error) fail(error);
  return String(data);
}

/** Accept or reject, with a reason. Accepting creates the Draft work order and returns its id. */
export async function decideCandidate(candidateId: string, decision: 'accepted' | 'rejected', reason: string): Promise<DecisionResult> {
  const { data, error } = await supabase.rpc('decide_work_order_candidate', { p_candidate_id: candidateId, p_decision: decision, p_reason: reason.trim() });
  if (error) fail(error);
  // `decide_work_order_candidate` is declared `returns jsonb`: the result is checked field by field, never trusted.
  if (!isObj(data) || (data.status !== 'accepted' && data.status !== 'rejected')) throw new AppError('The decision was not recorded');
  return { status: data.status, work_order_id: (data.work_order_id as string | null) ?? null };
}

export async function updateItem(itemId: string, patch: ItemPatch): Promise<void> {
  const body: TablesUpdate<'work_order_candidate_items'> = {};
  if (patch.status !== undefined) body.status = patch.status;
  if (patch.note !== undefined) body.note = patch.note;
  if (patch.ownerId !== undefined) body.owner_id = patch.ownerId;
  if (patch.targetDate !== undefined) body.target_date = patch.targetDate;
  const { data, error } = await supabase.from('work_order_candidate_items').update(body).eq('id', itemId).select('id');
  if (error) fail(error);
  // RLS filters a row the caller may not edit (or a decided candidate) to zero rows rather than an error.
  if (!data || data.length === 0) throw new AppError('You cannot change this item', '42501');
}

export async function addItem(candidateId: string, label: string, required: boolean): Promise<void> {
  const { error } = await supabase.from('work_order_candidate_items').insert({ candidate_id: candidateId, label: label.trim(), required });
  if (error) fail(error);
}

/** Upload one proof file and record it. The path is {org}/{candidate}/{proof}/{name}; a failed row removes the file. */
export async function uploadProof(candidate: Pick<WorkOrderCandidate, 'id' | 'org_id'>, itemId: string, file: File): Promise<void> {
  const id = crypto.randomUUID();
  const name = sanitizeFilename(file.name || 'proof');
  const path = `${candidate.org_id}/${candidate.id}/${id}/${name}`;
  const bucket = supabase.storage.from(CANDIDATE_PROOFS_BUCKET);
  const { error: upErr } = await bucket.upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (upErr) throw new AppError(upErr.message);
  const { error } = await supabase.from('work_order_candidate_proofs').insert({ id, item_id: itemId, file_path: path, file_name: file.name || name });
  if (error) {
    await bucket.remove([path]);
    fail(error);
  }
}

export async function archiveProof(proofId: string): Promise<void> {
  const { error } = await supabase.from('work_order_candidate_proofs').update({ archived_at: new Date().toISOString() }).eq('id', proofId);
  if (error) fail(error);
}

export async function proofUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(CANDIDATE_PROOFS_BUCKET).createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
  if (error || !data?.signedUrl) throw new AppError(error?.message ?? 'Could not open the proof');
  return data.signedUrl;
}
