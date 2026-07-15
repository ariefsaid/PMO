// stateStore.ts — m365_pkce_states CRUD via the injected service-role client.
// Pure functions, importable in Vitest (ADR-0039). No Deno globals, no client construction.

import type { M365SupabaseLike, PkceStateRow } from './types.ts';

export type { PkceStateRow };

export interface StorePkceStateParams {
  orgId: string;
  userId: string;
  codeVerifier: string;
  state: string;
  scopes: string[];
}

export interface ConsumePkceStateResult {
  codeVerifier: string;
  scopes: string[];
  orgId: string;
  userId: string;
}

/** Insert a new single-use PKCE state row (service-role write). TTL = 10 minutes (AC-M365-101). */
export async function storePkceState(
  serviceClient: M365SupabaseLike,
  params: StorePkceStateParams,
  now: () => Date = () => new Date(),
): Promise<void> {
  const expiresAt = new Date(now().getTime() + 10 * 60 * 1000).toISOString();
  const { error } = await serviceClient
    .from('m365_pkce_states')
    .insert({
      org_id: params.orgId,
      user_id: params.userId,
      code_verifier: params.codeVerifier,
      state: params.state,
      scopes: params.scopes,
      expires_at: expiresAt,
    });
  if (error) throw new Error(`storePkceState failed: ${(error as { message: string }).message}`);
}

/**
 * Atomically consume (delete + read) a PKCE state row by state. Single-use is race-free under
 * concurrency: one round-trip `delete … returning *` removes the row AND returns it, so two
 * concurrent callbacks carrying the same state cannot both pass the read before either deletes
 * (MEDIUM-1 TOCTOU fix; AC-M365-142). Returns null for missing or expired rows (AC-M365-104). `now`
 * is injectable for deterministic expiry tests.
 */
export async function consumePkceState(
  serviceClient: M365SupabaseLike,
  state: string,
  now: () => Date = () => new Date(),
): Promise<ConsumePkceStateResult | null> {
  // One statement: delete + return the deleted row (`.delete().eq('state').select().maybeSingle()`).
  // maybeSingle (not single) so a missing state resolves { data: null } instead of erroring.
  const { data, error } = await serviceClient
    .from('m365_pkce_states')
    .delete()
    .eq('state', state)
    .select('*')
    .maybeSingle();

  if (error || !data) return null;

  const row = data as PkceStateRow;
  // Expired — reject (the row was already atomically deleted above; no second round-trip needed).
  if (new Date(row.expires_at) < now()) return null;

  return {
    codeVerifier: row.code_verifier,
    scopes: row.scopes,
    orgId: row.org_id,
    userId: row.user_id,
  };
}
