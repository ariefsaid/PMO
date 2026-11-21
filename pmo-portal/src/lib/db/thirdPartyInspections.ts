import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { toStorageAppError } from '@/src/lib/storageError';
import { sanitizeFilename } from '@/src/lib/storageKey';
import { SIGNED_URL_EXPIRY_SECONDS } from '@/src/lib/fileConstants';
import type { Tables } from '@/src/lib/supabase/database.types';

/**
 * Third-party inspections (#2580, migrations 1130-1134). One row per external test of a work order. Every write is an RPC
 * (the table has no client write grant) and every state rule is a database trigger: this module only calls them. The cost read
 * returns null amounts to a caller outside Admin/Executive/Finance/Project Manager (server-side), so the screen is not the fence.
 */
export type InspectionRow = Tables<'third_party_inspections'>;
export type InspectionFileRow = Tables<'third_party_inspection_files'>;
export type InspectionStatus = 'requested' | 'purchase_raised' | 'invited' | 'executed' | 'reported' | 'cancelled';
export type InspectionResult = 'pending' | 'pass' | 'fail' | 'conditional';
export type InspectionGate = 'readiness' | 'billing';

export const INSPECTION_GATES: readonly InspectionGate[] = ['readiness', 'billing'];
export const INSPECTION_FILE_MAX_COUNT = 10;
export const INSPECTION_FILE_MAX_BYTES = 15 * 1024 * 1024;
export const INSPECTION_FILE_ALLOWED_MIME = [
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

export type InspectionFileRefusal = 'count' | 'size' | 'type';

/** FR-TPI-013: why a report file may not be attached (null = fine). Mirrors the bucket and the database cap. */
export function inspectionFileRefusal(file: { size: number; type: string }, liveCount: number): InspectionFileRefusal | null {
  if (liveCount >= INSPECTION_FILE_MAX_COUNT) return 'count';
  if (file.size > INSPECTION_FILE_MAX_BYTES) return 'size';
  if (!(INSPECTION_FILE_ALLOWED_MIME as readonly string[]).includes(file.type)) return 'type';
  return null;
}

/**
 * The one meaning of "complete" (FR-TPI-016, OD-TPI-2): reported with pass or conditional, or waived. `fail` and `pending` are
 * not complete; a cancelled inspection is never complete. Mirrors `tpi_is_complete` in the database, which decides.
 */
export function isInspectionComplete(row: Pick<InspectionRow, 'status' | 'result' | 'waived_at'>): boolean {
  if (row.status === 'cancelled') return false;
  if (row.waived_at) return true;
  return row.status === 'reported' && (row.result === 'pass' || row.result === 'conditional');
}

/** A required inspection that is not complete blocks its gate. */
export function isInspectionBlocking(row: Pick<InspectionRow, 'status' | 'result' | 'waived_at' | 'required_for'>): boolean {
  return row.status !== 'cancelled' && row.required_for.length > 0 && !isInspectionComplete(row);
}

/** Overdue: past its planned calendar date and not reported or cancelled (compared as dates, never as instants). */
export function isInspectionOverdue(row: Pick<InspectionRow, 'status' | 'planned_date'>, today: string): boolean {
  return row.status !== 'reported' && row.status !== 'cancelled' && row.planned_date < today;
}

export interface InspectionCostRow {
  inspection_id: string;
  currency: string | null;
  committed: number | null;
  billed: number | null;
  estimate: number | null;
  estimate_currency: string | null;
}

export interface InspectionPrerequisite {
  id: string;
  title: string;
  status: InspectionStatus;
  result: InspectionResult;
  waived_at: string | null;
  waiver_reason: string | null;
  complete: boolean;
}
export interface InspectionPrerequisites { complete: boolean; inspections: InspectionPrerequisite[] }

export interface InspectionInput {
  workOrderId: string;
  title: string;
  testKind: string | null;
  plannedDate: string;
  vendorId: string | null;
  estimate: number | null;
  estimateCurrency: string | null;
  note: string | null;
  requiredFor: InspectionGate[];
}

// Everything but the planning estimate: that column is not readable by the client (money roles read it through tpi_costs).
const COLUMNS = 'id, org_id, work_order_id, project_id, title, test_kind, planned_date, vendor_id, note, required_for, section_id, status, result, procurement_id, purchase_raised_at, purchase_raised_by, invited_on, invited_who, invited_how, invited_by, executed_on, executed_by, reported_at, reported_by, waived_at, waived_by, waiver_reason, cancelled_at, cancelled_by, cancel_reason, overdue_notified_at, created_by, created_at, updated_at';
const LIST_LIMIT = 200;

/** The inspections of one work order, oldest first. RLS scopes rows to the caller's organisation. */
export async function listWorkOrderInspections(workOrderId: string): Promise<InspectionRow[]> {
  const { data, error } = await supabase
    .from('third_party_inspections')
    .select(COLUMNS)
    .eq('work_order_id', workOrderId)
    .order('created_at', { ascending: true })
    .limit(LIST_LIMIT);
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []) as unknown as InspectionRow[];
}

export async function getInspectionCosts(workOrderId: string): Promise<InspectionCostRow[]> {
  const { data, error } = await supabase.rpc('tpi_costs', { p_work_order_id: workOrderId });
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []) as InspectionCostRow[];
}

export async function getInspectionPrerequisites(workOrderId: string, gate: InspectionGate): Promise<InspectionPrerequisites> {
  const { data, error } = await supabase.rpc('work_order_inspection_prerequisites', {
    p_work_order_id: workOrderId, p_section_id: null, p_gate: gate,
  });
  if (error) throw new AppError(error.message, error.code);
  return data as unknown as InspectionPrerequisites;
}

async function call<T>(p: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>): Promise<T | null> {
  const { data, error } = await p;
  if (error) throw new AppError(error.message, error.code);
  return data;
}

export async function createInspection(input: InspectionInput): Promise<string> {
  const id = await call(supabase.rpc('tpi_create', {
    p_work_order_id: input.workOrderId, p_title: input.title, p_test_kind: input.testKind, p_planned_date: input.plannedDate,
    p_vendor_id: input.vendorId, p_estimate: input.estimate, p_estimate_currency: input.estimateCurrency,
    p_note: input.note, p_required_for: input.requiredFor,
  }));
  return id as string;
}

export const raiseInspectionPurchase = (id: string, procurementId?: string | null) =>
  call(supabase.rpc('tpi_raise_purchase', { p_id: id, p_procurement_id: procurementId ?? null })).then((v) => v as string);
export const recordInspectionInvitation = (id: string, on: string, who: string | null, how: string | null) =>
  call(supabase.rpc('tpi_record_invitation', { p_id: id, p_invited_on: on, p_invited_who: who, p_invited_how: how })).then(() => undefined);
export const recordInspectionExecution = (id: string, on: string) =>
  call(supabase.rpc('tpi_record_execution', { p_id: id, p_executed_on: on })).then(() => undefined);
export const recordInspectionReport = (id: string, result: InspectionResult) =>
  call(supabase.rpc('tpi_record_report', { p_id: id, p_result: result })).then(() => undefined);
export const waiveInspection = (id: string, reason: string) =>
  call(supabase.rpc('tpi_waive', { p_id: id, p_reason: reason })).then(() => undefined);
export const cancelInspection = (id: string, reason: string) =>
  call(supabase.rpc('tpi_cancel', { p_id: id, p_reason: reason })).then(() => undefined);

export function buildInspectionFilePath(orgId: string, inspectionId: string, fileId: string, filename: string): string {
  return `${orgId}/${inspectionId}/${fileId}/${sanitizeFilename(filename)}`;
}

/** Live report files of an inspection, newest first. */
export async function listInspectionFiles(inspectionId: string): Promise<InspectionFileRow[]> {
  const { data, error } = await supabase
    .from('third_party_inspection_files')
    .select('*')
    .eq('inspection_id', inspectionId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(INSPECTION_FILE_MAX_COUNT);
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []) as InspectionFileRow[];
}

/** Upload the object, then record it. The org segment comes from the inspection row, never from the caller. */
export async function addInspectionFile(inspection: Pick<InspectionRow, 'id' | 'org_id'>, file: File, liveCount: number): Promise<InspectionFileRow> {
  const refusal = inspectionFileRefusal(file, liveCount);
  if (refusal) throw new AppError(`report file refused: ${refusal}`, 'inspection-file-' + refusal);
  const fileId = crypto.randomUUID();
  const path = buildInspectionFilePath(inspection.org_id, inspection.id, fileId, file.name);
  const up = await supabase.storage.from('inspection-reports').upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw toStorageAppError(up.error);
  const { data, error } = await supabase
    .from('third_party_inspection_files')
    .insert({ id: fileId, inspection_id: inspection.id, file_path: path, title: file.name })
    .select()
    .single();
  if (error) {
    await supabase.storage.from('inspection-reports').remove([path]); // no orphan object behind a refused row
    throw new AppError(error.message, error.code);
  }
  return data as InspectionFileRow;
}

export async function getInspectionFileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('inspection-reports').createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
  if (error || !data) throw toStorageAppError(error ?? new Error('no signed url'));
  return data.signedUrl;
}
