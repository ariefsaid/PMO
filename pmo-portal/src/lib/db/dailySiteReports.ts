import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { fetchAllPages } from '@/src/lib/pagedRead';
import { sanitizeFilename } from '@/src/lib/storageKey';
import { SIGNED_URL_EXPIRY_SECONDS } from '@/src/lib/fileConstants';

/**
 * Daily site report DAL (#1522, migrations 1004/1005). Reads are RLS-scoped selects; every write is a
 * security-definer RPC (`dsr_*`), except a photo row, which RLS lets the author or an enterer insert while the
 * report is editable. org_id is never sent: the RPCs and the stamp trigger set it, and the photo path takes it
 * from the report row (the expense-receipts pattern). Money comes only from the revenue RPCs, which refuse
 * roles that may not read the rate catalogue. Generated types predate 1004, so this module uses a narrow shape.
 */
export type DsrStatus = 'draft' | 'submitted' | 'validated' | 'returned';

export interface DsrReport {
  id: string;
  org_id: string;
  project_id: string;
  work_order_id: string;
  work_date: string;
  status: DsrStatus;
  version: number;
  supersedes_id: string | null;
  superseded_at: string | null;
  correction_reason: string | null;
  author_id: string;
  submitted_at: string | null;
  validated_by: string | null;
  validated_at: string | null;
  returned_reason: string | null;
  variant_id: string | null;
  start_time: string | null;
  end_time: string | null;
  total_minutes: number | null;
  weather_id: string | null;
  weather_note: string | null;
  note: string | null;
}
export interface DsrProgressLine { id: string; position: number; work_order_line_id: string; sub_stage: string | null; quantity: number; unit: string }
export interface DsrIdlePeriod { id: string; position: number; minutes: number; reason_id: string }
export interface DsrConsumable { id: string; position: number; stock_item_id: string; quantity: number; unit: string }
export interface DsrPhoto { id: string; kind: 'paper_form' | 'other'; file_path: string; created_at: string }
export interface DsrEvent { id: string; action: string; actor_id: string | null; reason: string | null; at: string }
export interface DsrReportDetail {
  report: DsrReport;
  progress: DsrProgressLine[];
  idle: DsrIdlePeriod[];
  consumables: DsrConsumable[];
  photos: DsrPhoto[];
  events: DsrEvent[];
}
export interface DsrListOption { id: string; label: string }
export interface DsrContractItem { id: string; boq_item_id: string; item_code: string; description: string; unit: string }
export interface DsrEquipmentHours { id: string; asset_name: string; quantity: number; unit: string; kind: string; status: string }
export interface DsrPeopleHours { id: string; hours: number }

export interface DsrDraftInput {
  id?: string | null;
  clientRequestId?: string | null;
  workOrderId: string;
  workDate: string;
  variantId?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  weatherId?: string | null;
  weatherNote?: string | null;
  note?: string | null;
  progress: { workOrderLineId: string; subStage?: string | null; quantity: string }[];
  idle: { minutes: number; reasonId: string }[];
  consumables: { stockItemId: string; quantity: string }[];
}

export interface DsrListFilter { projectId?: string; workOrderId?: string; from?: string; to?: string; status?: DsrStatus }
export interface DsrRevenueLineRow { line_id: string; rate: number | null; rate_source: string | null; amount: number | null; frozen: boolean }
export interface DsrQueueRow {
  report_id: string; project_id: string; work_order_id: string; work_date: string; author_id: string;
  submitted_at: string; total_revenue: number; unrated_lines: number; age_days: number; waiting_for_validator: boolean;
}

export const DSR_PAGE_SIZE = 50;
export const SITE_REPORT_PHOTOS_BUCKET = 'site-report-photos';
const HEADER = 'id, org_id, project_id, work_order_id, work_date, status, version, supersedes_id, superseded_at, correction_reason, author_id, submitted_at, validated_by, validated_at, returned_reason, variant_id, start_time, end_time, total_minutes, weather_id, weather_note, note';

type Err = { message: string; code?: string } | null;
interface Loose {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the PostgREST builder chain; generated types predate 1004
  from(table: string): any;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: Err }>;
}
const db = supabase as unknown as Loose;
const fail = (error: { message: string; code?: string }): never => { throw new AppError(error.message, error.code); };

async function rows<T>(query: PromiseLike<{ data: unknown; error: Err }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) fail(error);
  return (data ?? []) as T[];
}

/** FR-DSR-021: newest first with id as the stable tie-break, one bounded page (one extra row says "more"). */
export async function listReports(filter: DsrListFilter, page = 0): Promise<{ rows: DsrReport[]; hasMore: boolean }> {
  let q = db.from('daily_site_reports').select(HEADER).is('archived_at', null);
  if (filter.projectId) q = q.eq('project_id', filter.projectId);
  if (filter.workOrderId) q = q.eq('work_order_id', filter.workOrderId);
  if (filter.status) q = q.eq('status', filter.status);
  if (filter.from) q = q.gte('work_date', filter.from);
  if (filter.to) q = q.lte('work_date', filter.to);
  const from = page * DSR_PAGE_SIZE;
  const data = await rows<DsrReport>(q.order('work_date', { ascending: false }).order('id', { ascending: false }).range(from, from + DSR_PAGE_SIZE));
  return { rows: data.slice(0, DSR_PAGE_SIZE), hasMore: data.length > DSR_PAGE_SIZE };
}

export async function getReport(id: string): Promise<DsrReportDetail | null> {
  const { data, error } = await db.from('daily_site_reports').select(HEADER).eq('id', id).maybeSingle();
  if (error) fail(error);
  if (!data) return null;
  const [progress, idle, consumables, photos, events] = await Promise.all([
    rows<DsrProgressLine>(db.from('dsr_progress_lines').select('id, position, work_order_line_id, sub_stage, quantity, unit').eq('report_id', id).order('position')),
    rows<DsrIdlePeriod>(db.from('dsr_idle_periods').select('id, position, minutes, reason_id').eq('report_id', id).order('position')),
    rows<DsrConsumable>(db.from('dsr_consumables').select('id, position, stock_item_id, quantity, unit').eq('report_id', id).order('position')),
    rows<DsrPhoto>(db.from('dsr_photos').select('id, kind, file_path, created_at').eq('report_id', id).order('created_at').order('id')),
    rows<DsrEvent>(db.from('dsr_events').select('id, action, actor_id, reason, at').eq('report_id', id).order('at').order('id')),
  ]);
  return { report: data as DsrReport, progress, idle, consumables, photos, events };
}

async function listOptions(table: 'dsr_idle_reasons' | 'dsr_weather_conditions'): Promise<DsrListOption[]> {
  return rows<DsrListOption>(db.from(table).select('id, label').is('archived_at', null).order('label').order('id'));
}
export const listIdleReasons = () => listOptions('dsr_idle_reasons');
export const listWeatherConditions = () => listOptions('dsr_weather_conditions');

/** The work order's contract items (work_order_lines + their BOQ line). */
export async function listContractItems(workOrderId: string): Promise<DsrContractItem[]> {
  const data = await fetchAllPages<{ id: string; boq_item_id: string; boq_items: { item_code: string; description: string; unit: string } | null }>((from, to) =>
    db.from('work_order_lines').select('id, boq_item_id, boq_items(item_code, description, unit)').eq('work_order_id', workOrderId).order('id').range(from, to));
  return data.map((r) => ({ id: r.id, boq_item_id: r.boq_item_id, item_code: r.boq_items?.item_code ?? '', description: r.boq_items?.description ?? '', unit: r.boq_items?.unit ?? '' }))
    .sort((a, b) => a.item_code.localeCompare(b.item_code) || (a.id < b.id ? -1 : 1));
}

/** FR-DSR-006: equipment usage already entered against this work order and date (read, never copied). */
export async function listEquipmentHours(workOrderId: string, workDate: string): Promise<DsrEquipmentHours[]> {
  const data = await rows<{ id: string; quantity: number; unit: string; kind: string; status: string; equipment_assets: { name: string } | null }>(
    db.from('equipment_usage_entries').select('id, quantity, unit, kind, status, equipment_assets(name)')
      .eq('work_order_id', workOrderId).eq('work_date', workDate).is('archived_at', null).order('id'));
  return data.map((r) => ({ id: r.id, asset_name: r.equipment_assets?.name ?? '', quantity: Number(r.quantity), unit: r.unit, kind: r.kind, status: r.status }));
}

/** FR-DSR-007: people hours from timesheets on this work order and date, read-only (RLS decides what is visible). */
export async function listPeopleHours(workOrderId: string, workDate: string): Promise<DsrPeopleHours[]> {
  const data = await rows<{ id: string; hours: number }>(
    db.from('timesheet_entries').select('id, hours').eq('work_order_id', workOrderId).eq('entry_date', workDate).order('id'));
  return data.map((r) => ({ id: r.id, hours: Number(r.hours) }));
}

export async function saveDraft(input: DsrDraftInput): Promise<string> {
  const { data, error } = await db.rpc('dsr_save_draft', {
    p: {
      id: input.id ?? null,
      client_request_id: input.clientRequestId ?? null,
      work_order_id: input.workOrderId,
      work_date: input.workDate,
      variant_id: input.variantId ?? null,
      start_time: input.startTime || null,
      end_time: input.endTime || null,
      weather_id: input.weatherId || null,
      weather_note: input.weatherNote ?? null,
      note: input.note ?? null,
      progress: input.progress.map((l) => ({ work_order_line_id: l.workOrderLineId, sub_stage: l.subStage || null, quantity: l.quantity })),
      idle: input.idle.map((l) => ({ minutes: l.minutes, reason_id: l.reasonId })),
      consumables: input.consumables.map((l) => ({ stock_item_id: l.stockItemId, quantity: l.quantity })),
    },
  });
  if (error) fail(error);
  return String(data);
}

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(fn, args);
  if (error) fail(error);
  return data;
}
export async function submitReport(id: string): Promise<void> { await call('dsr_submit', { p_report: id }); }
export async function validateReport(id: string): Promise<void> { await call('dsr_validate', { p_report: id }); }
export async function returnReport(id: string, reason: string): Promise<void> { await call('dsr_return', { p_report: id, p_reason: reason }); }
export async function correctReport(id: string, reason: string): Promise<string> { return String(await call('dsr_correct', { p_report: id, p_reason: reason })); }

export async function reportRevenue(id: string): Promise<DsrRevenueLineRow[]> {
  return ((await call('dsr_report_revenue', { p_report: id })) ?? []) as DsrRevenueLineRow[];
}
export async function workOrderValidatedRevenue(workOrderId: string): Promise<number> {
  return Number(await call('work_order_validated_revenue', { p_work_order: workOrderId }));
}
export async function validationQueue(): Promise<DsrQueueRow[]> {
  return ((await call('dsr_validation_queue', {})) ?? []) as DsrQueueRow[];
}

export function buildSiteReportPhotoPath(orgId: string, reportId: string, photoId: string, fileName: string): string {
  return `${orgId}/${reportId}/${photoId}/${sanitizeFilename(fileName)}`;
}

/** FR-DSR-008: upload to the private bucket, then record the row; a failed row removes the orphan object. */
export async function uploadPhoto(report: Pick<DsrReport, 'id' | 'org_id'>, file: File, kind: DsrPhoto['kind'] = 'paper_form'): Promise<void> {
  const path = buildSiteReportPhotoPath(report.org_id, report.id, crypto.randomUUID(), file.name || 'photo.jpg');
  const bucket = supabase.storage.from(SITE_REPORT_PHOTOS_BUCKET);
  const { error: upErr } = await bucket.upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (upErr) throw new AppError(upErr.message);
  const { error } = await db.from('dsr_photos').insert({ report_id: report.id, kind, file_path: path });
  if (error) {
    await bucket.remove([path]);
    fail(error);
  }
}

export async function photoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(SITE_REPORT_PHOTOS_BUCKET).createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
  if (error || !data?.signedUrl) throw new AppError(error?.message ?? 'Could not open the photo');
  return data.signedUrl;
}
