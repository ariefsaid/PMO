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

/**
 * Evidence on a head count (docs/specs/headcount-evidence.spec.md, migration 2131): a photo or document the recorder attaches and the
 * approver reads before approving. The file is a project document of the work order's project, created through the organisation's
 * document storage (its own policies decide who may); the database cites it on the line and decides who may attach (the recorder only).
 */
export interface HeadcountEvidence { id: string; headcountId: string; documentId: string; title: string; filePath: string | null }

const EVIDENCE_COLUMNS = 'id, headcount_id, document_id, project_documents(title, file_path)';
type EvidenceRow = { id: string; headcount_id: string; document_id: string; project_documents: { title: string; file_path: string | null } | null };

/** The files cited on the given lines, oldest first. */
export async function listHeadcountEvidence(headcountIds: string[]): Promise<HeadcountEvidence[]> {
  if (headcountIds.length === 0) return [];
  const { data, error } = await supabase.from('headcount_day_documents').select(EVIDENCE_COLUMNS)
    .in('headcount_id', headcountIds).order('attached_at', { ascending: true }).order('id', { ascending: true }).limit(500);
  if (error) throw new AppError(error.message, error.code);
  return ((data ?? []) as unknown as EvidenceRow[]).map((r) => ({
    id: r.id, headcountId: r.headcount_id, documentId: r.document_id,
    title: r.project_documents?.title ?? '', filePath: r.project_documents?.file_path ?? null,
  }));
}

/** Cite an existing project document on the line. */
export async function attachHeadcountDocument(headcountId: string, documentId: string): Promise<string> {
  const { data, error } = await supabase.rpc('attach_headcount_document', { p_headcount: headcountId, p_document: documentId });
  if (error) throw new AppError(error.message, error.code);
  return String(data);
}

export async function detachHeadcountDocument(id: string): Promise<void> {
  const { error } = await supabase.rpc('detach_headcount_document', { p_id: id });
  if (error) throw new AppError(error.message, error.code);
}

/** The project of a work order (the document register the evidence is filed in). */
export async function headcountProjectId(workOrderId: string): Promise<string> {
  const { data, error } = await supabase.from('work_orders').select('project_id').eq('id', workOrderId).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  if (!data) throw new AppError('work order not found', 'P0002');
  return data.project_id;
}
