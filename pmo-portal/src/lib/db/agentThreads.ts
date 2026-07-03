import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { Tables } from '@/src/lib/supabase/database.types';

export type AgentThreadRow = Tables<'agent_threads'>;

/** Shape of a PostgREST/Postgres error we surface (only the fields we read). */
interface PostgrestErrorLike {
  message: string;
  code?: string;
}

function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code);
}

/**
 * List the caller's own live (non-archived) threads, pinned first then by recency
 * (FR-AGP-020, AC-AGP-019). org_id/owner_id are NEVER sent — RLS (owner-only, no Admin
 * cross-owner read, FR-AGP-007/008) scopes the rows entirely; a caller never receives
 * another user's thread. Throws an `AppError` (code preserved) on a genuine query error.
 */
export async function listAgentThreads(): Promise<AgentThreadRow[]> {
  const { data, error } = await supabase
    .from('agent_threads')
    .select('*')
    .is('archived_at', null)
    .order('pinned_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false });
  if (error) throwWrite(error);
  return data ?? [];
}
