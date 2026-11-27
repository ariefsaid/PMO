import { getVisibleOrganizationId } from './organizations';
import { supabase } from '@/src/lib/supabase/client';
import { nullableArg } from './nullableArg';
import { AppError } from '@/src/lib/appError';
import { fetchAllPages } from '@/src/lib/pagedRead';
import { sanitizeFilename } from '@/src/lib/storageKey';
import { SIGNED_URL_EXPIRY_SECONDS } from '@/src/lib/fileConstants';
import type { ProgressSource, QuantityVersion, RequestStatus, TriggerKind } from '@/src/lib/quantityChangeRules';
import { readOrgColumnsStrict } from './orgSettingsBatch';

/**
 * Quantity change request DAL (#2578, migrations 1125..1129). Reads are RLS-scoped selects; every write is a
 * security-definer RPC (`qcr_*`, `record_quantity_forecast`) that checks role, state and separation of duties, so
 * org_id, the actor and every status are decided by the server, never sent. A request file is the one direct insert
 * (the procurement-file pattern: private object first, then the typed row; a failed row removes the orphan).
 */
export interface QcrRequest {
  id: string;
  org_id: string;
  project_id: string;
  work_order_id: string;
  status: RequestStatus;
  withdrawn_from: 'draft' | 'returned' | 'approved' | null;
  note: string | null;
  author_id: string;
  editor_ids: string[];
  first_submitted_at: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  returned_by: string | null;
  returned_at: string | null;
  return_reason: string | null;
  withdrawn_by: string | null;
  withdrawn_at: string | null;
  withdraw_reason: string | null;
  sent_date: string | null;
  client_reference: string | null;
  decision_date: string | null;
  decided_by: string | null;
  decision_note: string | null;
  created_at: string;
}
export interface QcrListRow extends QcrRequest { work_order_label: string; author_name: string | null; line_count: number }
export interface QcrLine {
  id: string;
  boq_item_id: string;
  requested_quantity: number;
  reason: string;
  trigger_kind: TriggerKind;
  trigger_figure: number;
  base_quantity: number;
  base_version_no: number;
  item_code: string;
  description: string;
  unit: string;
  rate: number;
}
export interface QcrEvent { id: string; action: string; from_status: string | null; to_status: string | null; actor_id: string | null; reason: string | null; created_at: string }
export type QcrFileKind = 'supporting' | 'sent_letter' | 'client_response';
export interface QcrFile { id: string; kind: QcrFileKind; title: string | null; file_path: string; uploaded_by_id: string | null; created_at: string }
export interface QcrWorkOrderRef { id: string; label: string; status: string; currency: string; orderValue: number }
export interface QcrDetail {
  request: QcrRequest;
  workOrder: QcrWorkOrderRef | null;
  names: { author: string | null; approver: string | null };
  lines: QcrLine[];
  events: QcrEvent[];
  files: QcrFile[];
}
export interface QcrListFilter { projectId?: string; workOrderId?: string; status?: RequestStatus }
export interface OverContractRow {
  boq_item_id: string; item_code: string; description: string; unit: string; rate: number; earning_basis: 'unit_rate' | 'lump_sum';
  contract_quantity: number; progress_quantity: number; progress_source: ProgressSource | null; forecast_quantity: number | null;
  over_progress: boolean; over_forecast: boolean; open_request_id: string | null;
}
export interface QcrApprovalState { can_approve: boolean; reason: 'role' | 'author' | 'editor' | 'submitter' | 'status' | null; eligible_approver_exists: boolean }
export interface QcrRaiseInput {
  workOrderId: string;
  clientRequestId: string;
  note?: string | null;
  lines: { boqItemId: string; requestedQuantity: string; reason: string }[];
}
export interface QcrBudget { request_count: number; request_limit: number | null }

export const QCR_PAGE_SIZE = 50;
export const QCR_FILES_BUCKET = 'quantity-change-files';
const HEADER = 'id, org_id, project_id, work_order_id, status, withdrawn_from, note, author_id, editor_ids, first_submitted_at, submitted_by, submitted_at, approved_by, approved_at, returned_by, returned_at, return_reason, withdrawn_by, withdrawn_at, withdraw_reason, sent_date, client_reference, decision_date, decided_by, decision_note, created_at';

const fail = (error: { message: string; code?: string }): never => { throw new AppError(error.message, error.code); };

/** A `numeric` quantity goes on the wire as the exact decimal TEXT the caller typed, which the generated argument type
 * cannot state: it says `number`. The cast is the number's text, never a float. */
const asNumeric = (v: string) => v as unknown as number;

/** Every status column here is `text` with a CHECK, which the generated row states as `string`. */
type HeaderRow = {
  id: string; org_id: string; project_id: string; work_order_id: string; status: string; withdrawn_from: string | null;
} & Omit<QcrRequest, 'id' | 'org_id' | 'project_id' | 'work_order_id' | 'status' | 'withdrawn_from'>;
const toRequest = (r: HeaderRow): QcrRequest => ({
  ...r, status: r.status as RequestStatus, withdrawn_from: (r.withdrawn_from ?? null) as QcrRequest['withdrawn_from'],
});

const woLabel = (wo: { title: string; wo_number: string | null } | null) => (wo ? [wo.wo_number, wo.title].filter(Boolean).join(' · ') : '');

/** FR-QCR-024: newest first with id as the stable tie-break, one bounded page (one extra row says "more"). */
export async function listRequests(filter: QcrListFilter, page = 0): Promise<{ rows: QcrListRow[]; hasMore: boolean }> {
  const q = supabase.from('quantity_change_requests')
    .select(`${HEADER}, work_orders(title, wo_number), author:profiles!quantity_change_requests_author_id_fkey(full_name), quantity_change_request_lines(count)`);
  let scoped = q;
  if (filter.projectId) scoped = scoped.eq('project_id', filter.projectId);
  if (filter.workOrderId) scoped = scoped.eq('work_order_id', filter.workOrderId);
  if (filter.status) scoped = scoped.eq('status', filter.status);
  const from = page * QCR_PAGE_SIZE;
  const { data, error } = await scoped.order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, from + QCR_PAGE_SIZE);
  if (error) fail(error);
  const list = (data ?? []).slice(0, QCR_PAGE_SIZE).map(({ work_orders: wo, author, quantity_change_request_lines: lc, ...r }) => ({
    ...toRequest(r), work_order_label: woLabel(wo), author_name: author?.full_name ?? null, line_count: lc?.[0]?.count ?? 0,
  }));
  return { rows: list, hasMore: (data ?? []).length > QCR_PAGE_SIZE };
}

export async function getRequest(id: string): Promise<QcrDetail | null> {
  const { data, error } = await supabase.from('quantity_change_requests')
    .select(`${HEADER}, work_orders(id, title, wo_number, status, currency, order_value), author:profiles!quantity_change_requests_author_id_fkey(full_name), approver:profiles!quantity_change_requests_approved_by_fkey(full_name)`).eq('id', id).maybeSingle();
  if (error) fail(error);
  if (!data) return null;
  const { work_orders: wo, author, approver, ...request } = data;
  const [rawLines, events, files] = await Promise.all([
    fetchAllPages((f, t) => supabase.from('quantity_change_request_lines')
      .select('id, boq_item_id, requested_quantity, reason, trigger_kind, trigger_figure, base_quantity, base_version_no, boq_items(item_code, description, unit, rate)')
      .eq('request_id', id).order('id').range(f, t)),
    fetchAllPages((f, t) => supabase.from('quantity_change_request_events')
      .select('id, action, from_status, to_status, actor_id, reason, created_at').eq('request_id', id).order('created_at').order('id').range(f, t)),
    fetchAllPages((f, t) => supabase.from('quantity_change_request_files')
      .select('id, kind, title, file_path, uploaded_by_id, created_at').eq('request_id', id).is('archived_at', null).order('created_at').order('id').range(f, t)),
  ]);
  const lines: QcrLine[] = rawLines.map(({ boq_items: b, ...l }) => ({
    ...l,
    requested_quantity: Number(l.requested_quantity), trigger_figure: Number(l.trigger_figure), base_quantity: Number(l.base_quantity),
    trigger_kind: l.trigger_kind as TriggerKind,
    item_code: b?.item_code ?? '', description: b?.description ?? '', unit: b?.unit ?? '', rate: Number(b?.rate ?? 0),
  })).sort((a, b) => a.item_code.localeCompare(b.item_code) || (a.id < b.id ? -1 : 1));
  const workOrder = wo ? { id: wo.id, label: woLabel(wo), status: wo.status, currency: wo.currency, orderValue: Number(wo.order_value) } : null;
  return {
    request: toRequest(request),
    workOrder,
    names: { author: author?.full_name ?? null, approver: approver?.full_name ?? null },
    lines,
    events,
    files: files.map((f) => ({ ...f, kind: f.kind as QcrFileKind })),
  };
}

/** FR-QCR-001: every contract line with C, P (and the source that set it), E and the over flags; one set-based read. */
export async function overContract(projectId: string, onlyOver = false): Promise<OverContractRow[]> {
  const { data, error } = await supabase.rpc('qcr_over_contract', { p_project_id: projectId, p_only_over: onlyOver });
  if (error) fail(error);
  // `returns table` states no nullability, and its enum-ish columns are `text` with a CHECK: narrowed here.
  return (data ?? []).map((r) => ({
    ...r, rate: Number(r.rate), contract_quantity: Number(r.contract_quantity), progress_quantity: Number(r.progress_quantity),
    forecast_quantity: r.forecast_quantity === null ? null : Number(r.forecast_quantity),
    earning_basis: r.earning_basis as OverContractRow['earning_basis'],
    progress_source: (r.progress_source ?? null) as ProgressSource | null,
  }));
}

export async function workOrderBudget(workOrderId: string): Promise<QcrBudget> {
  const { data, error } = await supabase.rpc('qcr_work_order_budget', { p_work_order_id: workOrderId });
  if (error) fail(error);
  return data?.[0] ?? { request_count: 0, request_limit: null };
}

export async function approvalState(requestId: string): Promise<QcrApprovalState> {
  const { data, error } = await supabase.rpc('qcr_approval_state', { p_request_id: requestId });
  if (error) fail(error);
  const row = data?.[0];
  return row
    ? { can_approve: row.can_approve, eligible_approver_exists: row.eligible_approver_exists, reason: (row.reason ?? null) as QcrApprovalState['reason'] }
    : { can_approve: false, reason: 'role', eligible_approver_exists: false };
}

export async function listVersions(boqItemId: string): Promise<QuantityVersion[]> {
  const data = await fetchAllPages((f, t) => supabase.from('boq_quantity_versions')
    .select('version_no, quantity, source, request_id, created_by, created_at').eq('boq_item_id', boqItemId).order('version_no').range(f, t));
  // #2883: the reason lives on the request's line for this item; one read covers every request that produced a version.
  const requestIds = [...new Set(data.map((v) => v.request_id).filter((id): id is string => Boolean(id)))];
  const reasons = new Map<string, string>();
  if (requestIds.length) {
    const lines = await fetchAllPages((f, t) => supabase.from('quantity_change_request_lines')
      .select('request_id, reason').eq('boq_item_id', boqItemId).in('request_id', requestIds).order('request_id').range(f, t));
    for (const l of lines) reasons.set(l.request_id, l.reason);
  }
  return data.map((v) => {
    const reason = v.request_id ? reasons.get(v.request_id) : undefined;
    return { ...v, quantity: Number(v.quantity), source: v.source as QuantityVersion['source'], ...(reason ? { reason } : {}) };
  });
}

const lineArgs = (lines: QcrRaiseInput['lines']) => lines.map((l) => ({ boq_item_id: l.boqItemId, requested_quantity: l.requestedQuantity, reason: l.reason }));

export async function raiseRequest(input: QcrRaiseInput): Promise<string> {
  const { data, error } = await supabase.rpc('qcr_raise', {
    p_work_order_id: input.workOrderId, p_client_request_id: input.clientRequestId, p_lines: lineArgs(input.lines),
    p_note: nullableArg(input.note ?? null),
  });
  if (error) fail(error);
  return String(data);
}
export async function updateDraft(id: string, lines: QcrRaiseInput['lines'] | null, note?: string | null): Promise<void> {
  const { error } = await supabase.rpc('qcr_update_draft', {
    p_request_id: id, p_lines: lines === null ? null : lineArgs(lines), p_note: nullableArg(note ?? null),
  });
  if (error) fail(error);
}
export async function submitRequest(id: string): Promise<void> {
  const { error } = await supabase.rpc('qcr_submit', { p_request_id: id });
  if (error) fail(error);
}
export async function approveRequest(id: string): Promise<void> {
  const { error } = await supabase.rpc('qcr_approve', { p_request_id: id });
  if (error) fail(error);
}
export async function returnRequest(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('qcr_return', { p_request_id: id, p_reason: reason });
  if (error) fail(error);
}
export async function withdrawRequest(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('qcr_withdraw', { p_request_id: id, p_reason: reason });
  if (error) fail(error);
}
export async function recordSent(id: string, sentDate: string, clientReference: string): Promise<void> {
  const { error } = await supabase.rpc('qcr_record_sent', { p_request_id: id, p_sent_date: sentDate, p_client_reference: clientReference });
  if (error) fail(error);
}
export async function recordDecision(id: string, decision: 'accepted' | 'declined', decisionDate: string, note?: string | null): Promise<void> {
  const { error } = await supabase.rpc('qcr_record_decision', {
    p_request_id: id, p_decision: decision, p_decision_date: decisionDate, p_note: nullableArg(note ?? null),
  });
  if (error) fail(error);
}
export async function recordForecast(boqItemId: string, quantity: string, note?: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('record_quantity_forecast', {
    p_boq_item_id: boqItemId, p_quantity: asNumeric(quantity), p_note: nullableArg(note ?? null),
  });
  if (error) fail(error);
  return String(data);
}

/** FR-QCR-021: the organisation's request limit (null = none). The write is a column-granted, Admin-only update. */
export async function getLimit(): Promise<number | null> {
  const { data, error } = await readOrgColumnsStrict<{ quantity_change_limit: number | null }>(['quantity_change_limit']);
  if (error) fail(error);
  return data?.quantity_change_limit ?? null;
}
export async function setLimit(limit: number | null): Promise<void> {
  const refusal = 'Only an Admin can change the quantity change limit';
  const orgId = await getVisibleOrganizationId(refusal);
  const { data, error } = await supabase.from('organizations').update({ quantity_change_limit: limit }).eq('id', orgId).select('id');
  if (error) fail(error);
  if (!data || data.length === 0) throw new AppError(refusal, '42501');
}

/** FR-CHR-001: built-in role keys that may review a request in addition to the base approver levels (empty = today). Admin-only column grant. */
export async function getApproverRoles(): Promise<string[]> {
  const { data, error } = await readOrgColumnsStrict<{ quantity_change_approver_roles: string[] | null }>(['quantity_change_approver_roles']);
  if (error) fail(error);
  return data?.quantity_change_approver_roles ?? [];
}
export async function setApproverRoles(roles: string[]): Promise<void> {
  const refusal = 'Only an Admin can change who may review quantity change requests';
  const orgId = await getVisibleOrganizationId(refusal);
  const { data, error } = await supabase.from('organizations').update({ quantity_change_approver_roles: roles }).eq('id', orgId).select('id');
  if (error) fail(error);
  if (!data || data.length === 0) throw new AppError(refusal, '42501');
}

export function buildQcrFilePath(orgId: string, requestId: string, fileId: string, fileName: string): string {
  return `${orgId}/${requestId}/${fileId}/${sanitizeFilename(fileName)}`;
}

/** Upload to the private bucket, then record the typed row; a failed row removes the orphan object. */
export async function uploadFile(request: Pick<QcrRequest, 'id' | 'org_id'>, kind: QcrFileKind, file: File, title?: string | null): Promise<void> {
  const fileId = crypto.randomUUID();
  const path = buildQcrFilePath(request.org_id, request.id, fileId, file.name || 'file.pdf');
  const bucket = supabase.storage.from(QCR_FILES_BUCKET);
  const { error: upErr } = await bucket.upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (upErr) throw new AppError(upErr.message);
  const { error } = await supabase.from('quantity_change_request_files').insert({ id: fileId, request_id: request.id, kind, title: title ?? file.name ?? null, file_path: path });
  if (error) {
    await bucket.remove([path]);
    fail(error);
  }
}

export async function archiveFile(fileId: string): Promise<void> {
  const { error } = await supabase.from('quantity_change_request_files').update({ archived_at: new Date().toISOString() }).eq('id', fileId);
  if (error) fail(error);
}

export async function fileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(QCR_FILES_BUCKET).createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
  if (error || !data?.signedUrl) throw new AppError(error?.message ?? 'Could not open the file');
  return data.signedUrl;
}
