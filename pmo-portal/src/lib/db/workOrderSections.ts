import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { fetchAllPages } from '@/src/lib/pagedRead';
import type { ReadinessCounts } from '@/src/lib/workOrderSections';
import type { TablesInsert } from '@/src/lib/supabase/database.types';

/**
 * Work-order sections (#2576, migrations 1095..1098). The database decides everything that matters — the
 * composite key that keeps a child on its own work order, the foreman's column limit, the frozen states, the
 * archive blockers — so this module only carries the request. org_id and project_id are never sent: the org is
 * stamped by default/trigger and the project is the work order's, set by the guard trigger.
 *
 *   • `listSectionRollup` — the ONE roll-up read (`work_order_section_rollup`, security invoker): one row per
 *     section plus the unsectioned remainder, so sum(sections) + remainder = the work-order total by construction.
 *   • `getReadinessCounts` — the readiness roll-up view (live sections only).
 *   • plan figures per section are written through `set_work_order_plan` (`setWorkOrderPlan` in `workOrderFinance`).
 */

export type Readiness = 'not_ready' | 'ready' | 'blocked';
export const READINESS_VALUES: readonly Readiness[] = ['not_ready', 'ready', 'blocked'];

export interface SectionRollupRow {
  /** null = the unsectioned remainder ("Not in a section"). */
  sectionId: string | null;
  code: string | null;
  name: string | null;
  locationNote: string | null;
  foremanId: string | null;
  readiness: Readiness | null;
  readinessNote: string | null;
  sortOrder: number | null;
  archivedAt: string | null;
  /** Plan figures as exact scale-two text (hours too); null = no figure for the kind, or the caller may not read plans. */
  directBudget: string | null;
  indirectBudget: string | null;
  equipmentHours: string | null;
  crewHours: string | null;
  tasksTotal: number;
  tasksDone: number;
  crewsToday: number;
}

const MALFORMED = 'PMO_MALFORMED';
const fixed2 = (v: number | string | null): string | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new AppError('Section roll-up: unreadable figure', MALFORMED);
  return n.toFixed(2);
};

export async function listSectionRollup(workOrderId: string): Promise<SectionRollupRow[]> {
  const { data, error } = await supabase.rpc('work_order_section_rollup', { p_work_order_id: workOrderId });
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).map((r) => {
    if (r.readiness !== null && !READINESS_VALUES.includes(r.readiness as Readiness)) throw new AppError('Section roll-up: unexpected readiness', MALFORMED);
    return {
      sectionId: r.section_id, code: r.code, name: r.name, locationNote: r.location_note, foremanId: r.foreman_id,
      readiness: r.readiness as Readiness | null, readinessNote: r.readiness_note, sortOrder: r.sort_order, archivedAt: r.archived_at,
      directBudget: fixed2(r.direct_budget), indirectBudget: fixed2(r.indirect_budget),
      equipmentHours: fixed2(r.equipment_hours), crewHours: fixed2(r.crew_hours),
      tasksTotal: r.tasks_total, tasksDone: r.tasks_done, crewsToday: r.crews_today,
    };
  });
}

export interface SectionProgressRow {
  /** null = the unsectioned remainder. */
  sectionId: string | null;
  workOrderLineId: string;
  unit: string;
  /** Validated daily-report quantity as an exact scale-three string. */
  quantity: string;
}

/** Validated daily-report quantities per section and contract item (FR-WOS-016). Empty until a report is validated: absent, not zero. */
export async function listSectionProgress(workOrderId: string): Promise<SectionProgressRow[]> {
  const { data, error } = await supabase.rpc('work_order_section_progress', { p_work_order_id: workOrderId });
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).map((r) => {
    const n = Number(r.quantity);
    if (!Number.isFinite(n)) throw new AppError('Section progress: unreadable quantity', MALFORMED);
    return { sectionId: r.section_id, workOrderLineId: r.work_order_line_id, unit: r.unit, quantity: n.toFixed(3) };
  });
}

export async function getReadinessCounts(workOrderId: string): Promise<ReadinessCounts | null> {
  const { data, error } = await supabase.from('work_order_section_readiness')
    .select('live_sections, not_ready, ready, blocked, all_ready').eq('work_order_id', workOrderId).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  if (!data) return null;
  return {
    live_sections: data.live_sections ?? 0, not_ready: data.not_ready ?? 0, ready: data.ready ?? 0,
    blocked: data.blocked ?? 0, all_ready: data.all_ready === true,
  };
}

export interface ReadinessEvent {
  id: string;
  readiness: Readiness;
  note: string | null;
  setBy: string | null;
  setAt: string;
}

export async function listReadinessEvents(sectionId: string): Promise<ReadinessEvent[]> {
  const rows = await fetchAllPages<{ id: string; readiness: string; note: string | null; set_by: string | null; set_at: string }>((from, to) =>
    supabase.from('work_order_section_readiness_events').select('id, readiness, note, set_by, set_at')
      .eq('section_id', sectionId).order('set_at', { ascending: false }).order('id', { ascending: false }).range(from, to));
  return rows.map((r) => ({ id: r.id, readiness: r.readiness as Readiness, note: r.note, setBy: r.set_by, setAt: r.set_at }));
}

export interface SectionInput {
  code: string;
  name: string;
  locationNote: string | null;
  foremanId: string | null;
  sortOrder: number;
}

export async function createSection(workOrderId: string, input: SectionInput): Promise<string> {
  // `project_id` is copied from the work order by the guard_work_order_section trigger (migration 1169), which
  // introspection cannot see, so the generated Insert type asks for a column the client must not send.
  const row = {
    work_order_id: workOrderId, code: input.code.trim(), name: input.name.trim(),
    location_note: input.locationNote?.trim() || null, foreman_id: input.foremanId, sort_order: input.sortOrder,
  } satisfies Omit<TablesInsert<'work_order_sections'>, 'project_id'>;
  const { data, error } = await supabase.from('work_order_sections').insert(row as TablesInsert<'work_order_sections'>).select('id').single();
  if (error) throw new AppError(error.message, error.code);
  return data.id;
}

export async function updateSection(id: string, input: SectionInput): Promise<void> {
  const { error } = await supabase.from('work_order_sections').update({
    code: input.code.trim(), name: input.name.trim(), location_note: input.locationNote?.trim() || null,
    foreman_id: input.foremanId, sort_order: input.sortOrder,
  }).eq('id', id);
  if (error) throw new AppError(error.message, error.code);
}

/** Readiness and its note; the author and time are stamped by the database. A foreman may call this on their own section. */
export async function setSectionReadiness(id: string, readiness: Readiness, note: string | null): Promise<void> {
  const { data, error } = await supabase.from('work_order_sections')
    .update({ readiness, readiness_note: note?.trim() || null }).eq('id', id).select('id');
  if (error) throw new AppError(error.message, error.code);
  if (!data || data.length === 0) throw new AppError('You cannot change this section\'s readiness.', '42501');
}

export async function setSectionArchived(id: string, archived: boolean): Promise<void> {
  const { data, error } = await supabase.from('work_order_sections')
    .update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id).select('id');
  if (error) throw new AppError(error.message, error.code);
  if (!data?.length) throw new AppError('You cannot archive this section.', '42501');
}

export async function deleteSection(id: string): Promise<void> {
  const { data, error } = await supabase.from('work_order_sections').delete().eq('id', id).select('id');
  if (error) throw new AppError(error.message, error.code);
  if (!data || data.length === 0) throw new AppError('Only an Admin can delete a section.', '42501');
}
