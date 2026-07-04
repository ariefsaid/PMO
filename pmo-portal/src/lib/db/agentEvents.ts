import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';

export type AgentEventRow = Tables<'agent_events'>;
export type DownvoteReason = NonNullable<AgentEventRow['downvote_reason']>;

/** Shape of a PostgREST/Postgres error we surface (only the fields we read). */
interface PostgrestErrorLike {
  message: string;
  code?: string;
}

function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/**
 * Fetch a run's events in transcript order (FR-AGP-005/021, AC-AGP-021) — `(run_id, seq)`
 * is the indexed hot path (NFR-AGP-PERF-001), `seq` is the ordering key, never `created_at`.
 * org_id/owner_id are never sent — owner-only RLS scopes the rows. Throws an `AppError`
 * (code preserved) on a genuine query error.
 */
export async function listRunEvents(runId: string): Promise<AgentEventRow[]> {
  const { data, error } = await supabase
    .from('agent_events')
    .select('*')
    .eq('run_id', runId)
    .order('seq', { ascending: true });
  if (error) throwWrite(error);
  return data ?? [];
}

/**
 * Persist per-assistant-event feedback (FR-AGP-024/025, AC-AGP-022) — the single narrow
 * feedback UPDATE. Sends ONLY `rating`/`downvote_reason`; the append-only-except-feedback
 * trigger (0046_agent_persistence.sql) and owner-only RLS are the enforcement authority for
 * "only these two columns, only the owner's own assistant row" — this DAL never attempts to
 * touch `payload`/`text`/`type`/`tool_*`. `downvote_reason` is nullable — omit it (thumbs-up)
 * and it is explicitly sent as `null` so a prior downvote reason is cleared. Throws an
 * `AppError` (code preserved, e.g. `42501` on a denied non-owner/non-assistant-row update).
 */
export async function rateAgentEvent(
  id: string,
  rating: 'up' | 'down',
  reason?: DownvoteReason,
): Promise<void> {
  const { error } = await supabase
    .from('agent_events')
    .update({ rating, downvote_reason: reason ?? null })
    .eq('id', id);
  if (error) throwWrite(error);
}
