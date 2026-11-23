import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { fetchAllRowsByKeyset } from '@/src/lib/pagedRead';

/**
 * Daily head count of people with no name on the roster (docs/specs/guard-headcount.spec.md, migration 1710).
 * Data access only: the database enforces who may enter (the crew's foreman or a crew manager, never a field account),
 * the date window, the roster, separation of duties and the final lock. `org_id` is never sent (ADR-0017). A line has
 * no money on it; its cost is priced server side from the labour class rate and read through the work-order cost read.
 */
export interface HeadcountLine {
  id: string; crewId: string; classId: string; headCount: number; workDate: string; approvedAt: string | null; recordedByIds: string[];
}
export interface HeadcountInput { workOrderId: string; crewId: string; workDate: string; classId: string; count: number }

const COLUMNS = 'id, crew_id, class_id, head_count, work_date, approved_at, recorded_by_ids';

/** The lines of a work order on a date, oldest first. Embeds are never used (two profile references live on the table). */
export async function listHeadcountDay(workOrderId: string, workDate: string): Promise<HeadcountLine[]> {
  const rows = await fetchAllRowsByKeyset(async (afterId, limit) => {
    let q = supabase.from('headcount_days').select(COLUMNS).eq('work_order_id', workOrderId).eq('work_date', workDate).order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    return q.limit(limit);
  });
  return rows.map((r) => ({
    id: r.id, crewId: r.crew_id, classId: r.class_id, headCount: r.head_count, workDate: r.work_date,
    approvedAt: r.approved_at, recordedByIds: r.recorded_by_ids,
  }));
}

/** Enter a line, or replace its number while it is not approved. Resolves to the line id. */
export async function recordHeadcount(i: HeadcountInput): Promise<string> {
  if (!Number.isInteger(i.count) || i.count < 1 || i.count > 500) throw new AppError('validation', 'validation');
  const { data, error } = await supabase.rpc('record_headcount_day', {
    p_work_order_id: i.workOrderId, p_crew_id: i.crewId, p_work_date: i.workDate, p_class_id: i.classId, p_count: i.count,
  });
  if (error) throw new AppError(error.message, error.code);
  return String(data);
}

export async function approveHeadcount(id: string): Promise<void> {
  const { error } = await supabase.rpc('approve_headcount_day', { p_id: id });
  if (error) throw new AppError(error.message, error.code);
}

export async function clearHeadcount(id: string): Promise<void> {
  const { error } = await supabase.rpc('clear_headcount_day', { p_id: id });
  if (error) throw new AppError(error.message, error.code);
}
