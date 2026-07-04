import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';

export type AgentRunRow = Tables<'agent_runs'>;

/** The heartbeat fields the stuck-run banner needs — a narrow projection of agent_runs. */
export type RunHeartbeat = Pick<AgentRunRow, 'last_progress_at' | 'status'>;

/** Shape of a PostgREST/Postgres error we surface (only the fields we read). */
interface PostgrestErrorLike {
  message: string;
  code?: string;
}

function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/**
 * Read the SERVER heartbeat for a run — `agent_runs.last_progress_at`/`status` (FR-AGP-022) —
 * the authority for stuck-run staleness, per the spec: `now() - last_progress_at` exceeding the
 * threshold, NOT client-observed SSE liveness (a live SSE can be silently wedged; a dropped SSE
 * can be genuinely still progressing server-side). org_id/owner_id are never sent — owner-only
 * RLS (0046_agent_persistence.sql) scopes the row. Returns `null` when the row is absent or
 * RLS-hidden (not this caller's run) — the caller treats that as "no heartbeat signal yet",
 * mirroring `loadJournaledWrites`'s fail-open style server-side. Throws an `AppError` (code
 * preserved) on a genuine query error.
 */
export async function getRunHeartbeat(runId: string): Promise<RunHeartbeat | null> {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('last_progress_at, status')
    .eq('id', runId)
    .maybeSingle();
  if (error) throwWrite(error);
  return data ?? null;
}
