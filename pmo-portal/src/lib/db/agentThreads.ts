import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';

export type AgentThreadRow = Tables<'agent_threads'>;

/**
 * A listed thread plus its most recent run id (FR-AGP-021) — resolved via a PostgREST
 * relational embed on `agent_runs` (FK `agent_runs.thread_id -> agent_threads.id`) ordered
 * by `created_at desc` and limited to 1, so opening a thread can call
 * `openThread(threadId, latestRunId)` without a second round trip. `null` when the thread
 * has no runs yet (a thread created but never sent).
 */
export interface AgentThreadListItem extends AgentThreadRow {
  latestRunId: string | null;
}

/** Shape of a PostgREST/Postgres error we surface (only the fields we read). */
interface PostgrestErrorLike {
  message: string;
  code?: string;
}

function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/** Row shape returned by the query before the embed is flattened. */
type AgentThreadRowWithRunsEmbed = AgentThreadRow & { agent_runs?: Array<{ id: string }> | null };

/**
 * List the caller's own live (non-archived) threads, pinned first then by recency
 * (FR-AGP-020, AC-AGP-019), each annotated with `latestRunId` (FR-AGP-021) so a caller can
 * resume the thread's most recent run without a second query. org_id/owner_id are NEVER
 * sent — RLS (owner-only, no Admin cross-owner read, FR-AGP-007/008) scopes the rows
 * entirely; a caller never receives another user's thread. Throws an `AppError` (code
 * preserved) on a genuine query error.
 */
export async function listAgentThreads(): Promise<AgentThreadListItem[]> {
  const { data, error } = await supabase
    .from('agent_threads')
    .select('*, agent_runs(id)')
    .is('archived_at', null)
    .order('pinned_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })
    .order('created_at', { referencedTable: 'agent_runs', ascending: false })
    .limit(1, { referencedTable: 'agent_runs' });
  if (error) throwWrite(error);
  return (data ?? []).map((row: AgentThreadRowWithRunsEmbed) => {
    const { agent_runs, ...thread } = row;
    return { ...thread, latestRunId: agent_runs?.[0]?.id ?? null };
  });
}
