import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { DatabaseListedKind } from '@/src/lib/approvals/waitingKinds';

export interface WaitingDecisionRow {
  kind: DatabaseListedKind;
  recordId: string;
  projectId: string | null;
  title: string;
  createdAt: string;
}

type Err = { message: string; code?: string } | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated types predate 1560
const db = supabase as unknown as { rpc(fn: string): PromiseLike<{ data: any; error: Err }> };

/** `my_waiting_decisions()` (1560): what the caller may decide now among the kinds that had no per-person read. The database is the authority. */
export async function listWaitingDecisions(): Promise<WaitingDecisionRow[]> {
  const { data, error } = await db.rpc('my_waiting_decisions');
  if (error) throw new AppError(error.message, error.code);
  return ((data ?? []) as Array<{ kind: DatabaseListedKind; record_id: string; project_id: string | null; title: string; created_at: string }>)
    .map((r) => ({ kind: r.kind, recordId: r.record_id, projectId: r.project_id, title: r.title, createdAt: r.created_at }));
}

/** `my_decision_standing()` (1560): true when the caller can decide anything at all, so the Approvals entry is offered. */
export async function hasDecisionStanding(): Promise<boolean> {
  const { data, error } = await db.rpc('my_decision_standing');
  if (error) throw new AppError(error.message, error.code);
  return data === true;
}
