import { fetchAllPages } from '@/src/lib/pagedRead';
import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * Read-only view of the retired candidate work orders (#2595, retired by #2898). Records already made stay readable under
 * their project; nothing creates, assesses or decides one any more. RLS scopes the rows; enum-ish text is validated.
 */
export type CandidateRecordStatus = 'assessing' | 'accepted' | 'rejected';
export type CandidateCheckStatus = 'open' | 'passed' | 'failed' | 'not_applicable';
export interface CandidateRecord {
  id: string;
  title: string;
  client_reference: string | null;
  offered_on: string;
  status: CandidateRecordStatus;
  decision_reason: string | null;
  work_order_id: string | null;
  items: { label: string; status: CandidateCheckStatus; note: string | null }[];
}

const STATUSES: readonly string[] = ['assessing', 'accepted', 'rejected'];
const CHECKS: readonly string[] = ['open', 'passed', 'failed', 'not_applicable'];

export async function listCandidateRecords(projectId: string): Promise<CandidateRecord[]> {
  const rows = await fetchAllPages((from, to) => supabase.from('work_order_candidates')
    .select('id, title, client_reference, offered_on, status, decision_reason, work_order_id, items:work_order_candidate_items(label, position, status, note)')
    .eq('project_id', projectId).order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to));
  return rows.map((raw) => {
    if (!STATUSES.includes(raw.status)) throw new AppError(`Unknown candidate status "${String(raw.status)}"`);
    const items = [...(raw.items ?? [])].sort((a, b) => a.position - b.position).map((i) => {
      if (!CHECKS.includes(i.status)) throw new AppError(`Unknown assessment status "${String(i.status)}"`);
      return { label: i.label, status: i.status as CandidateCheckStatus, note: i.note };
    });
    return { id: raw.id, title: raw.title, client_reference: raw.client_reference, offered_on: raw.offered_on, status: raw.status as CandidateRecordStatus,
      decision_reason: raw.decision_reason, work_order_id: raw.work_order_id, items };
  });
}
