import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import { fetchAllPages } from '@/src/lib/pagedRead';
import type { DatabaseListedKind } from '@/src/lib/approvals/waitingKinds';

export interface WaitingDecisionRow {
  kind: DatabaseListedKind;
  recordId: string;
  projectId: string | null;
  title: string;
  createdAt: string;
}

/** `my_waiting_decisions()` (1560): what the caller may decide now among the kinds that had no per-person read. The database is the authority. */
export async function listWaitingDecisions(): Promise<WaitingDecisionRow[]> {
  const data = await fetchAllPages((from, to) => supabase.rpc('my_waiting_decisions').range(from, to));
  return data.map((r) => ({ kind: r.kind as DatabaseListedKind, recordId: r.record_id, projectId: r.project_id, title: r.title, createdAt: r.created_at }));
}

/** `my_decision_standing()` (1560): true when the caller can decide anything at all, so the Approvals entry is offered. */
export async function hasDecisionStanding(): Promise<boolean> {
  const { data, error } = await supabase.rpc('my_decision_standing');
  if (error) throw new AppError(error.message, error.code);
  return data === true;
}
