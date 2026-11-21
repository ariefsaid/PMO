import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Json } from '@/src/lib/supabase/database.types';
import type { Role } from '@/src/auth/AuthContext';

/**
 * Material requests against a work order (#2524, migrations 1000 + 1001; spec docs/specs/material-requests.spec.md).
 *
 * The database is the authority for every rule — steps decided in order, the requester never decides, one person
 * decides one step, a stand-in acts only inside their dated window, an over-plan line carries a reason, the
 * cut-off. Every write is one security-definer RPC; this module only carries the call and keeps the refusal's
 * Postgres code. org_id is never sent.
 */

export type MaterialRequestStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled' | 'fulfilled';
export type StepStatus = 'waiting' | 'open' | 'approved' | 'returned' | 'rejected' | 'superseded';
export type StepDecision = 'approve' | 'return' | 'reject';

export interface MaterialRequestHeader {
  workOrderId: string;
  neededBy: string;
  toWarehouseId: string | null;
  note: string | null;
}

export interface MaterialRequestLineInput {
  itemId: string;
  quantity: number;
  overPlanReason: string | null;
}

export interface MaterialRequestRow {
  id: string;
  number: string;
  workOrderId: string;
  projectId: string;
  toWarehouseId: string | null;
  neededBy: string;
  note: string | null;
  status: MaterialRequestStatus;
  round: number;
  createdBy: string;
  createdAt: string;
  submittedAt: string | null;
  transferDocumentId: string | null;
  transferCancelled: boolean;
}

export interface MaterialRequestLine {
  id: string;
  lineNo: number;
  itemId: string;
  quantity: number;
  planQty: number | null;
  priorQty: number | null;
  overPlanReason: string | null;
}

export interface MaterialRequestStep {
  id: string;
  round: number;
  position: number;
  role: Role;
  label: string;
  status: StepStatus;
  decidedBy: string | null;
  actedFor: string | null;
  decidedAt: string | null;
  reason: string | null;
}

export interface MaterialRequestEvent {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  stepPosition: number | null;
  actorId: string | null;
  actedFor: string | null;
  reason: string | null;
  createdAt: string;
}

export interface MaterialRequestDetail extends MaterialRequestRow {
  lines: MaterialRequestLine[];
  steps: MaterialRequestStep[];
  events: MaterialRequestEvent[];
}

export interface WaitingStep {
  requestId: string;
  stepPosition: number;
  role: Role;
  label: string;
  /** The person this caller stands in for on this step; null when the caller holds the role. */
  actingFor: string | null;
  submittedAt: string;
}

export interface ChainStepInput {
  role: Role;
  label: string;
  onlyOverPlan: boolean;
}

export interface ChainStep extends ChainStepInput {
  id: string;
  position: number;
}

export interface StandIn {
  id: string;
  delegatorId: string;
  standInId: string;
  startsOn: string;
  endsOn: string;
  revokedAt: string | null;
}

/** A project's named approver for one chain position (#2598). No row = the step is role-level on that project. */
export interface StepPin {
  position: number;
  role: Role;
  approverId: string;
}

export interface LinePlan {
  itemId: string;
  planQty: number;
  priorQty: number;
}

// ── pure helpers ──────────────────────────────────────────────────────────────────────────────────────────────

/** Quantities are numeric(14,3) in the database; compare in thousandths so 0.1 + 0.2 is 0.3. */
const milli = (n: number): number => Math.round(n * 1000);

/** FR-MRQ-002: the line's new total and whether it exceeds plan. Advisory: the server re-checks at submit. */
export function linePlanStatus(l: { planQty: number; priorQty: number; quantity: number }): { newTotal: number; overPlan: boolean } {
  const total = milli(l.priorQty) + milli(l.quantity);
  return { newTotal: total / 1000, overPlan: total > milli(l.planQty) };
}

export type DraftLineError = 'quantityRequired' | 'reasonRequired' | 'reasonTooLong';

/** Per-line form errors keyed by line index (AC-MRQ-001): an over-plan line needs a 1–500 character reason. */
export function draftLineErrors(
  lines: Array<MaterialRequestLineInput & { planQty: number; priorQty: number }>,
): Record<number, DraftLineError> {
  const out: Record<number, DraftLineError> = {};
  lines.forEach((l, i) => {
    const reason = (l.overPlanReason ?? '').trim();
    if (!(l.quantity > 0)) out[i] = 'quantityRequired';
    else if (reason.length > 500) out[i] = 'reasonTooLong';
    else if (linePlanStatus(l).overPlan && reason.length === 0) out[i] = 'reasonRequired';
  });
  return out;
}

export type MaterialRequestRefusal =
  | 'sodAuthor' | 'sodTwice' | 'outOfOrder' | 'notApprover' | 'reasonRequired' | 'overPlanReason' | 'cutoff'
  | 'neededBy' | 'noChain' | 'sourceRequired' | 'noDestination' | 'notKeeper' | 'notPending' | 'notDraft'
  | 'notAuthor' | 'workOrder' | 'standIn' | 'adminOnly' | 'notPinned' | 'pinForbidden' | 'pinInvalid' | 'invalid' | 'notFound' | 'destination' | 'manyDestinations' | 'unknown';

const REFUSALS: Array<[string, MaterialRequestRefusal]> = [
  ['MRQ_SOD_AUTHOR', 'sodAuthor'], ['MRQ_SOD_TWICE', 'sodTwice'], ['MRQ_OUT_OF_ORDER', 'outOfOrder'],
  ['MRQ_NOT_APPROVER', 'notApprover'], ['MRQ_REASON_REQUIRED', 'reasonRequired'], ['MRQ_OVER_PLAN_REASON', 'overPlanReason'],
  ['MRQ_CUTOFF', 'cutoff'], ['MRQ_NEEDED_BY', 'neededBy'], ['MRQ_NO_CHAIN', 'noChain'], ['MRQ_SOURCE_REQUIRED', 'sourceRequired'],
  ['MRQ_NO_DESTINATION', 'noDestination'], ['MRQ_MANY_DESTINATIONS', 'manyDestinations'], ['STK_NOT_KEEPER', 'notKeeper'], ['MRQ_NOT_PENDING', 'notPending'],
  ['MRQ_NOT_DRAFT', 'notDraft'], ['MRQ_NOT_AUTHOR', 'notAuthor'], ['MRQ_WORK_ORDER', 'workOrder'], ['MRQ_STAND_IN', 'standIn'],
  ['MRQ_ADMIN_ONLY', 'adminOnly'], ['MRQ_NOT_PINNED', 'notPinned'], ['MRQ_PIN_FORBIDDEN', 'pinForbidden'], ['MRQ_PIN_INVALID', 'pinInvalid'],
  ['MRQ_INVALID', 'invalid'], ['MRQ_NOT_FOUND', 'notFound'], ['MRQ_DESTINATION', 'destination'],
];

/** Maps a database refusal to a stable key the screen translates. The message prefix is the contract. */
export function materialRequestRefusal(err: unknown): MaterialRequestRefusal {
  const msg = String((err as { message?: unknown } | null)?.message ?? '');
  return REFUSALS.find(([prefix]) => msg.startsWith(prefix))?.[1] ?? 'unknown';
}

// ── reads ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface RequestDbRow {
  id: string; number: string; work_order_id: string; project_id: string; to_warehouse_id: string | null; needed_by: string;
  note: string | null; status: string; round: number; created_by: string; created_at: string; submitted_at: string | null;
  transfer_document_id: string | null; transfer_cancelled: boolean;
}

const REQUEST_COLUMNS =
  'id, number, work_order_id, project_id, to_warehouse_id, needed_by, note, status, round, created_by, created_at, submitted_at, transfer_document_id, transfer_cancelled';

const toRow = (r: RequestDbRow): MaterialRequestRow => ({
  id: r.id, number: r.number, workOrderId: r.work_order_id, projectId: r.project_id, toWarehouseId: r.to_warehouse_id,
  neededBy: r.needed_by, note: r.note, status: r.status as MaterialRequestStatus, round: r.round, createdBy: r.created_by,
  createdAt: r.created_at, submittedAt: r.submitted_at, transferDocumentId: r.transfer_document_id, transferCancelled: r.transfer_cancelled,
});

type DbResult<T> = PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>;
const fail = (error: { message: string; code?: string }): never => { throw new AppError(error.message, error.code); };

export const MATERIAL_REQUEST_PAGE_SIZE = 50;

export interface MaterialRequestFilter {
  workOrderId?: string;
  statuses?: MaterialRequestStatus[];
  neededFrom?: string;
  neededTo?: string;
  cursor?: { createdAt: string; id: string } | null;
}

/** FR-MRQ-019: newest first, stable on (created_at, id), one bounded page plus a keyset cursor. */
export async function listMaterialRequests(f: MaterialRequestFilter): Promise<{ rows: MaterialRequestRow[]; nextCursor: { createdAt: string; id: string } | null }> {
  let q = supabase.from('material_requests').select(REQUEST_COLUMNS);
  if (f.workOrderId) q = q.eq('work_order_id', f.workOrderId);
  if (f.statuses?.length) q = q.in('status', f.statuses);
  if (f.neededFrom) q = q.gte('needed_by', f.neededFrom);
  if (f.neededTo) q = q.lte('needed_by', f.neededTo);
  if (f.cursor) q = q.or(`created_at.lt.${f.cursor.createdAt},and(created_at.eq.${f.cursor.createdAt},id.lt.${f.cursor.id})`);
  const { data, error } = await (q.order('created_at', { ascending: false }).order('id', { ascending: false })
    .limit(MATERIAL_REQUEST_PAGE_SIZE + 1) as unknown as DbResult<RequestDbRow[]>);
  if (error) fail(error);
  const all = (data ?? []).map(toRow);
  const rows = all.slice(0, MATERIAL_REQUEST_PAGE_SIZE);
  const last = rows[rows.length - 1];
  return { rows, nextCursor: all.length > MATERIAL_REQUEST_PAGE_SIZE && last ? { createdAt: last.createdAt, id: last.id } : null };
}

/** One request with its lines, every step of every round and its history. */
export async function getMaterialRequest(id: string): Promise<MaterialRequestDetail | null> {
  const [req, lines, steps, events] = await Promise.all([
    supabase.from('material_requests').select(REQUEST_COLUMNS).eq('id', id).limit(1) as unknown as DbResult<RequestDbRow[]>,
    supabase.from('material_request_lines').select('id, line_no, item_id, quantity, plan_qty, prior_qty, over_plan_reason')
      .eq('request_id', id).order('line_no', { ascending: true }).limit(200) as unknown as DbResult<Array<Record<string, unknown>>>,
    supabase.from('material_request_steps').select('id, round, position, role, label, status, decided_by, acted_for, decided_at, reason')
      .eq('request_id', id).order('round', { ascending: true }).order('position', { ascending: true }).limit(500) as unknown as DbResult<Array<Record<string, unknown>>>,
    supabase.from('material_request_events').select('id, action, from_status, to_status, step_position, actor_id, acted_for, reason, created_at')
      .eq('request_id', id).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1000) as unknown as DbResult<Array<Record<string, unknown>>>,
  ]);
  for (const r of [req, lines, steps, events]) if (r.error) fail(r.error);
  const head = req.data?.[0];
  if (!head) return null;
  return {
    ...toRow(head),
    lines: (lines.data ?? []).map((l) => ({
      id: String(l.id), lineNo: Number(l.line_no), itemId: String(l.item_id), quantity: Number(l.quantity),
      planQty: l.plan_qty == null ? null : Number(l.plan_qty), priorQty: l.prior_qty == null ? null : Number(l.prior_qty),
      overPlanReason: (l.over_plan_reason as string | null) ?? null,
    })),
    steps: (steps.data ?? []).map((s) => ({
      id: String(s.id), round: Number(s.round), position: Number(s.position), role: s.role as Role, label: String(s.label),
      status: s.status as StepStatus, decidedBy: (s.decided_by as string | null) ?? null, actedFor: (s.acted_for as string | null) ?? null,
      decidedAt: (s.decided_at as string | null) ?? null, reason: (s.reason as string | null) ?? null,
    })),
    events: (events.data ?? []).map((e) => ({
      id: String(e.id), action: String(e.action), fromStatus: (e.from_status as string | null) ?? null, toStatus: (e.to_status as string | null) ?? null,
      stepPosition: e.step_position == null ? null : Number(e.step_position), actorId: (e.actor_id as string | null) ?? null,
      actedFor: (e.acted_for as string | null) ?? null, reason: (e.reason as string | null) ?? null, createdAt: String(e.created_at),
    })),
  };
}

/** FR-MRQ-017: open steps the caller may decide now (directly or as a stand-in), oldest first. */
export async function listWaitingForMe(): Promise<WaitingStep[]> {
  const { data, error } = await supabase.rpc('mrq_waiting_for_me');
  if (error) fail(error);
  return (data ?? [])
    .map((w) => ({
      requestId: w.request_id, stepPosition: w.step_position, role: w.role as Role, label: w.label,
      actingFor: w.acting_for, submittedAt: w.submitted_at,
    }))
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.requestId.localeCompare(b.requestId));
}

/** FR-MRQ-002: plan and already-requested per item on a work order (the figures submit snapshots). */
export async function getLinePlans(workOrderId: string, itemIds: string[], excludeRequestId?: string | null): Promise<LinePlan[]> {
  if (itemIds.length === 0) return [];
  const { data, error } = await supabase.rpc('mrq_plan_for', {
    p_work_order_id: workOrderId, p_item_ids: itemIds, ...(excludeRequestId ? { p_exclude_request: excludeRequestId } : {}),
  });
  if (error) fail(error);
  return (data ?? []).map((p) => ({ itemId: p.item_id, planQty: Number(p.plan_qty), priorQty: Number(p.prior_qty) }));
}

export async function listApprovalChain(): Promise<ChainStep[]> {
  const { data, error } = await (supabase.from('approval_chain_steps').select('id, position, role, label, only_over_plan')
    .order('position', { ascending: true }).limit(10) as unknown as DbResult<Array<{ id: string; position: number; role: Role; label: string; only_over_plan: boolean }>>);
  if (error) fail(error);
  return (data ?? []).map((s) => ({ id: s.id, position: s.position, role: s.role, label: s.label, onlyOverPlan: s.only_over_plan }));
}

export async function getMaterialRequestCutoff(): Promise<string | null> {
  const { data, error } = await (supabase.from('material_request_settings').select('cutoff_time').limit(1) as unknown as DbResult<Array<{ cutoff_time: string | null }>>);
  if (error) fail(error);
  return data?.[0]?.cutoff_time ?? null;
}

export interface DeliveryNoteSettings {
  enabled: boolean;
  signatureBlocks: string[];
}

export const DEFAULT_DELIVERY_NOTE_SIGNATURE_BLOCKS = ['Dispatched by', 'Delivered by', 'Received by'];

export async function getDeliveryNoteSettings(): Promise<DeliveryNoteSettings> {
  const { data, error } = await (supabase
    .from('material_request_settings')
    .select('delivery_note_enabled, delivery_note_signature_blocks')
    .limit(1) as unknown as DbResult<Array<{ delivery_note_enabled: boolean | null; delivery_note_signature_blocks: string[] | null }>>);
  if (error) fail(error);
  return {
    enabled: Boolean(data?.[0]?.delivery_note_enabled),
    signatureBlocks: data?.[0]?.delivery_note_signature_blocks?.length ? data[0].delivery_note_signature_blocks : DEFAULT_DELIVERY_NOTE_SIGNATURE_BLOCKS,
  };
}

export async function listStandIns(): Promise<StandIn[]> {
  const { data, error } = await (supabase.from('approval_stand_ins').select('id, delegator_id, stand_in_id, starts_on, ends_on, revoked_at')
    .order('starts_on', { ascending: false }).order('id', { ascending: true }).limit(200) as unknown as DbResult<Array<Record<string, string | null>>>);
  if (error) fail(error);
  return (data ?? []).map((s) => ({
    id: String(s.id), delegatorId: String(s.delegator_id), standInId: String(s.stand_in_id), startsOn: String(s.starts_on),
    endsOn: String(s.ends_on), revokedAt: s.revoked_at ?? null,
  }));
}

/** #2598: the pins set on one project, by chain position. */
export async function listStepPins(projectId: string): Promise<StepPin[]> {
  const { data, error } = await (supabase.from('approval_step_pins').select('position, role, approver_id').eq('project_id', projectId)
    .order('position', { ascending: true }).limit(10) as unknown as DbResult<Array<{ position: number; role: Role; approver_id: string }>>);
  if (error) fail(error);
  return (data ?? []).map((p) => ({ position: p.position, role: p.role, approverId: p.approver_id }));
}

// ── writes (one RPC each) ─────────────────────────────────────────────────────────────────────────────────────

const toLinesJson = (lines: MaterialRequestLineInput[]): Json =>
  lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, over_plan_reason: l.overPlanReason }));

/** FR-MRQ-001/004: create (id null) or edit a draft; a replayed create with the same client id returns the first. */
export async function saveMaterialRequestDraft(id: string | null, header: MaterialRequestHeader, lines: MaterialRequestLineInput[], clientRequestId?: string): Promise<string> {
  const { data, error } = await supabase.rpc('mrq_save_draft', {
    p_request_id: id,
    p_header: { work_order_id: header.workOrderId, needed_by: header.neededBy, to_warehouse_id: header.toWarehouseId, note: header.note },
    p_lines: toLinesJson(lines),
    p_client_request_id: clientRequestId,
  });
  if (error) fail(error);
  return String(data);
}

export async function submitMaterialRequest(id: string, clientRequestId?: string): Promise<void> {
  const { error } = await supabase.rpc('mrq_submit', { p_request_id: id, p_client_request_id: clientRequestId });
  if (error) fail(error);
}

export async function decideMaterialRequestStep(
  id: string, stepPosition: number, decision: StepDecision, opts: { reason?: string | null; sourceWarehouseId?: string | null } = {},
): Promise<void> {
  const { error } = await supabase.rpc('mrq_decide_step', {
    p_request_id: id, p_step_position: stepPosition, p_decision: decision,
    p_reason: opts.reason ?? null, p_source_warehouse_id: opts.sourceWarehouseId ?? null,
  });
  if (error) fail(error);
}

export async function cancelMaterialRequest(id: string, reason?: string | null): Promise<void> {
  const { error } = await supabase.rpc('mrq_cancel', { p_request_id: id, p_reason: reason ?? undefined });
  if (error) fail(error);
}

export async function retryMaterialRequestTransfer(id: string, sourceWarehouseId: string): Promise<string> {
  const { data, error } = await supabase.rpc('mrq_retry_transfer', { p_request_id: id, p_source_warehouse_id: sourceWarehouseId });
  if (error) fail(error);
  return String(data);
}

export async function setApprovalChain(steps: ChainStepInput[]): Promise<void> {
  const { error } = await supabase.rpc('mrq_set_chain', {
    p_steps: steps.map((s) => ({ role: s.role, label: s.label, only_over_plan: s.onlyOverPlan })),
  });
  if (error) fail(error);
}

export async function setMaterialRequestCutoff(cutoff: string | null): Promise<void> {
  const { error } = await supabase.rpc('mrq_set_cutoff', { p_cutoff: cutoff });
  if (error) fail(error);
}

export async function setDeliveryNoteSettings(enabled: boolean, signatureBlocks: string[]): Promise<void> {
  const { error } = await supabase.rpc('mrq_set_delivery_note_settings', {
    p_enabled: enabled,
    p_signature_blocks: signatureBlocks,
  });
  if (error) fail(error);
}

export async function setStandIn(s: { delegatorId: string; standInId: string; startsOn: string; endsOn: string }): Promise<string> {
  const { data, error } = await supabase.rpc('mrq_set_stand_in', {
    p_delegator_id: s.delegatorId, p_stand_in_id: s.standInId, p_starts_on: s.startsOn, p_ends_on: s.endsOn,
  });
  if (error) fail(error);
  return String(data);
}

export async function revokeStandIn(id: string): Promise<void> {
  const { error } = await supabase.rpc('mrq_revoke_stand_in', { p_id: id });
  if (error) fail(error);
}

/** #2598: pin one chain step on a project to a named person, or clear it with a null approver. */
export async function setStepPin(projectId: string, position: number, approverId: string | null): Promise<void> {
  const { error } = await supabase.rpc('mrq_set_step_pin', {
    p_project_id: projectId, p_position: position, p_approver_id: approverId as string,
  });
  if (error) fail(error);
}
