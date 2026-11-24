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
  /** Optional link to a crew, or to a named person when no crew applies (migration 2130); null on older reports. */
  crew_id: string | null;
  person_id: string | null;
  /** Optional area that overrides the work order's area for the rate (migration 2132). */
  area_id: string | null;
}
/** A list row: the header plus the work order, author and safe directory label of its optional person link. */
export interface DsrReportListRow extends DsrReport { work_order_label: string; author_name: string | null; crew_name: string | null; person_name: string | null }
export interface DsrProgressLine { id: string; position: number; work_order_line_id: string; sub_stage: string | null; quantity: number; unit: string; section_id?: string | null }
export interface DsrIdlePeriod { id: string; position: number; minutes: number; reason_id: string }
export interface DsrConsumable { id: string; position: number; stock_item_id: string; quantity: number; unit: string; work_order_line_id?: string | null }
export interface DsrPhoto { id: string; kind: 'paper_form' | 'other'; file_path: string; created_at: string }
export interface DsrEvent { id: string; action: string; actor_id: string | null; reason: string | null; at: string }
export interface DsrWorkOrderRef { label: string; currency: string; orderValue: number }
export interface DsrReportDetail {
  report: DsrReport;
  workOrder: DsrWorkOrderRef | null;
  progress: DsrProgressLine[];
  idle: DsrIdlePeriod[];
  consumables: DsrConsumable[];
  photos: DsrPhoto[];
  events: DsrEvent[];
}
export interface DsrListOption { id: string; label: string }
export interface DsrContractItem { id: string; boq_item_id: string; item_code: string; description: string; unit: string; catalogue_item_id: string | null }
export interface DsrEquipmentHours { id: string; asset_name: string; quantity: number; unit: string; kind: string; status: string }
export interface DsrReportHours { peopleHours: string; equipment: DsrEquipmentHours[] }

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
  /** Link keys are sent only when given: leave them out and the stored link stays; null clears it. */
  crewId?: string | null;
  personId?: string | null;
  areaId?: string | null;
  progress: { workOrderLineId: string; subStage?: string | null; quantity: string; sectionId?: string | null }[];
  idle: { minutes: number; reasonId: string }[];
  consumables: { stockItemId: string; quantity: string; workOrderLineId?: string }[];
}

export interface DsrListFilter { projectId?: string; workOrderId?: string; crewId?: string; from?: string; to?: string; status?: DsrStatus }
export interface DsrRevenueLineRow { line_id: string; rate: number | null; rate_source: string | null; amount: number | null; frozen: boolean }
export interface DsrQueueRow {
  report_id: string; project_id: string; work_order_id: string; work_order_label: string; work_date: string; author_id: string;
  author_name: string | null; submitted_at: string; total_revenue: number | null; unrated_lines: number; age_days: number; waiting_for_validator: boolean;
}

export const DSR_PAGE_SIZE = 50;
export const SITE_REPORT_PHOTOS_BUCKET = 'site-report-photos';
const HEADER = 'id, org_id, project_id, work_order_id, work_date, status, version, supersedes_id, superseded_at, correction_reason, author_id, submitted_at, validated_by, validated_at, returned_reason, variant_id, start_time, end_time, total_minutes, weather_id, weather_note, note, crew_id, person_id, area_id';

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
export async function listReports(filter: DsrListFilter, page = 0): Promise<{ rows: DsrReportListRow[]; hasMore: boolean }> {
  let q = db.from('daily_site_reports')
    .select(`${HEADER}, work_orders(title, wo_number), author:profiles!daily_site_reports_author_id_fkey(full_name), crew:crews(name)`).is('archived_at', null);
  if (filter.projectId) q = q.eq('project_id', filter.projectId);
  if (filter.workOrderId) q = q.eq('work_order_id', filter.workOrderId);
  if (filter.crewId) q = q.eq('crew_id', filter.crewId);
  if (filter.status) q = q.eq('status', filter.status);
  if (filter.from) q = q.gte('work_date', filter.from);
  if (filter.to) q = q.lte('work_date', filter.to);
  const from = page * DSR_PAGE_SIZE;
  type Raw = DsrReport & { work_orders: { title: string; wo_number: string | null } | null; author: { full_name: string | null } | null; crew: { name: string } | null };
  const data = await rows<Raw>(q.order('work_date', { ascending: false }).order('id', { ascending: false }).range(from, from + DSR_PAGE_SIZE));
  const pageRows = data.slice(0, DSR_PAGE_SIZE);
  const personIds = [...new Set(pageRows.flatMap((r) => r.person_id ? [r.person_id] : []))];
  const people = personIds.length > 0
    ? await rows<{ id: string; name: string }>(db.from('people_directory').select('id, name').in('id', personIds).limit(DSR_PAGE_SIZE))
    : [];
  const personNames = new Map(people.map((p) => [p.id, p.name]));
  const list = pageRows.map(({ work_orders: wo, author, crew, ...r }) => ({
    ...r, work_order_label: wo ? [wo.wo_number, wo.title].filter(Boolean).join(' · ') : '', author_name: author?.full_name ?? null,
    crew_name: crew?.name ?? null, person_name: r.person_id ? personNames.get(r.person_id) ?? null : null,
  }));
  return { rows: list, hasMore: data.length > DSR_PAGE_SIZE };
}

export async function getReport(id: string): Promise<DsrReportDetail | null> {
  const { data, error } = await db.from('daily_site_reports')
    .select(`${HEADER}, work_orders(title, wo_number, currency, order_value)`).eq('id', id).maybeSingle();
  if (error) fail(error);
  if (!data) return null;
  const { work_orders: wo, ...report } = data as DsrReport & { work_orders: { title: string; wo_number: string | null; currency: string; order_value: number } | null };
  const [progress, idle, consumables, photos, events] = await Promise.all([
    fetchAllPages<DsrProgressLine>((f, t) => db.from('dsr_progress_lines').select('id, position, work_order_line_id, sub_stage, quantity, unit, section_id').eq('report_id', id).order('position').range(f, t)),
    fetchAllPages<DsrIdlePeriod>((f, t) => db.from('dsr_idle_periods').select('id, position, minutes, reason_id').eq('report_id', id).order('position').range(f, t)),
    fetchAllPages<DsrConsumable>((f, t) => db.from('dsr_consumables').select('id, position, stock_item_id, quantity, unit, work_order_line_id').eq('report_id', id).order('position').range(f, t)),
    fetchAllPages<DsrPhoto>((f, t) => db.from('dsr_photos').select('id, kind, file_path, created_at').eq('report_id', id).order('created_at').order('id').range(f, t)),
    fetchAllPages<DsrEvent>((f, t) => db.from('dsr_events').select('id, action, actor_id, reason, at').eq('report_id', id).order('at').order('id').range(f, t)),
  ]);
  const workOrder = wo ? { label: [wo.wo_number, wo.title].filter(Boolean).join(' · '), currency: wo.currency, orderValue: Number(wo.order_value) } : null;
  return { report, workOrder, progress, idle, consumables, photos, events };
}

async function listOptions(table: 'dsr_idle_reasons' | 'dsr_weather_conditions'): Promise<DsrListOption[]> {
  return fetchAllPages<DsrListOption>((f, t) => db.from(table).select('id, label').is('archived_at', null).order('label').order('id').range(f, t));
}
export const listIdleReasons = () => listOptions('dsr_idle_reasons');
export const listWeatherConditions = () => listOptions('dsr_weather_conditions');

/** #2621 FR-DSR-003/004: the Admin-kept pick lists (idle reasons, weather). RLS lets only an Admin write; org_id is stamped. */
export type DsrListKind = 'idle' | 'weather';
export interface DsrListAdminOption { id: string; label: string; archived_at: string | null }
const listTable = (kind: DsrListKind) => (kind === 'idle' ? 'dsr_idle_reasons' : 'dsr_weather_conditions') as 'dsr_idle_reasons' | 'dsr_weather_conditions';

/** Every item including archived ones, so an archived item can be restored. */
export async function listListItems(kind: DsrListKind): Promise<DsrListAdminOption[]> {
  return fetchAllPages<DsrListAdminOption>((f, t) => db.from(listTable(kind)).select('id, label, archived_at').order('label').order('id').range(f, t));
}
export async function addListItem(kind: DsrListKind, label: string): Promise<void> {
  const { error } = await db.from(listTable(kind)).insert({ label: label.trim() });
  if (error) fail(error);
}
export async function renameListItem(kind: DsrListKind, id: string, label: string): Promise<void> {
  const { error } = await db.from(listTable(kind)).update({ label: label.trim() }).eq('id', id);
  if (error) fail(error);
}
/** Archive hides the item from the report pickers; reports that already used it keep it. */
export async function setListItemArchived(kind: DsrListKind, id: string, archived: boolean): Promise<void> {
  const { error } = await db.from(listTable(kind)).update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id);
  if (error) fail(error);
}

/** The people a report may name when no crew applies: the member-readable directory (no pay, no documents). */
export interface DsrPersonOption { id: string; name: string; code: string }
export async function listLinkPeople(): Promise<DsrPersonOption[]> {
  return fetchAllPages<DsrPersonOption>((f, t) => db.from('people_directory').select('id, name, code').is('archived_at', null).order('name').order('id').range(f, t));
}
/** One person's name for a report that names them (the directory keeps archived people too). */
export async function personName(id: string): Promise<string | null> {
  const { data, error } = await db.from('people_directory').select('name').eq('id', id).maybeSingle();
  if (error) fail(error);
  return (data as { name: string } | null)?.name ?? null;
}

/** The work order's contract items (work_order_lines + their BOQ line). */
export async function listContractItems(workOrderId: string): Promise<DsrContractItem[]> {
  const data = await fetchAllPages<{ id: string; boq_item_id: string; boq_items: { item_code: string; description: string; unit: string; catalogue_item_id: string | null } | null }>((from, to) =>
    db.from('work_order_lines').select('id, boq_item_id, boq_items(item_code, description, unit, catalogue_item_id)').eq('work_order_id', workOrderId).order('id').range(from, to));
  return data.map((r) => ({ id: r.id, boq_item_id: r.boq_item_id, item_code: r.boq_items?.item_code ?? '', description: r.boq_items?.description ?? '', unit: r.boq_items?.unit ?? '', catalogue_item_id: r.boq_items?.catalogue_item_id ?? null }))
    .sort((a, b) => a.item_code.localeCompare(b.item_code) || (a.id < b.id ? -1 : 1));
}

/**
 * FR-DSR-006/007: the hours for the report's work order and date, read through one org-scoped RPC (#2619) so an
 * Engineer sees the whole crew, not only their own rows. Timesheet lines, attendance not yet on a timesheet and
 * equipment usage; read-only, it never creates hours. `peopleHours` stays an exact decimal string.
 */
export async function reportHours(reportId: string): Promise<DsrReportHours> {
  const { data, error } = await db.rpc('dsr_report_hours', { p_report: reportId });
  if (error) fail(error);
  const r = (data ?? {}) as { people_hours?: number | string | null; equipment?: Array<{ id: string; asset_name: string; quantity: number | string; unit: string; kind: string; status: string }> | null };
  return {
    peopleHours: String(r.people_hours ?? '0'),
    equipment: (r.equipment ?? []).map((e) => ({ id: e.id, asset_name: e.asset_name ?? '', quantity: Number(e.quantity), unit: e.unit, kind: e.kind, status: e.status })),
  };
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
      ...(input.crewId !== undefined ? { crew_id: input.crewId } : {}),
      ...(input.personId !== undefined ? { person_id: input.personId } : {}),
      ...(input.areaId !== undefined ? { area_id: input.areaId } : {}),
      progress: input.progress.map((l) => ({ work_order_line_id: l.workOrderLineId, sub_stage: l.subStage || null, quantity: l.quantity, ...(l.sectionId !== undefined ? { section_id: l.sectionId || null } : {}) })),
      idle: input.idle.map((l) => ({ minutes: l.minutes, reason_id: l.reasonId })),
      consumables: input.consumables.map((l) => ({ stock_item_id: l.stockItemId, quantity: l.quantity, ...(l.workOrderLineId ? { work_order_line_id: l.workOrderLineId } : {}) })),
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
export async function withdrawReport(id: string): Promise<void> { await call('dsr_withdraw', { p_report: id }); }
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
