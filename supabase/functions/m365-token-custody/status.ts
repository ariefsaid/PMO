// status.ts — `connection_status` handler: a READ-ONLY server-side read of the caller's own
// connection row, returning ONLY the non-sensitive metadata a client needs to render honest UI
// state (connected / active / stale / revoked / absent). A pure function taking INJECTED deps
// (ADR-0039): clients, env. No Deno.env, no client construction.
//
// Why this exists (AC-M365-150): `ms_graph_connections` is RLS-forced with ZERO client policies
// (the token store is server-only — 4 max-rigor review rounds, docs/spikes/2026-07-15-m365-phase1-
// security-audit.md). The router previously exposed only initiate_connect / graph_proxy /
// disconnect, so the FE had NO authorized path to learn whether a connection already exists — a
// fresh page load with no callback query-param rendered \"Not connected\" even for a genuinely
// connected user. This action reuses the SAME authorized read path proxy.ts already had (service
// client behind verifyCallerJwt + Admin + entitlement gates); it adds a STATUS ENDPOINT, not a new
// data path.
//
// Hard constraints honored (do NOT regress — see the audit record's round-4 closure):
//   - SAME authorization as every other user-initiated action: verified caller JWT → org resolution
//     under the caller's JWT (RLS-gated) → real-JWT Admin role → m365_integration entitlement. An
//     unentitled or non-Admin caller gets the SAME typed rejection (FORBIDDEN / NOT_ENTITLED) the
//     other actions give — via the shared `resolveOrgOrResult` gate (auth.ts). No new gate.
//   - Own-row scoped: `org_id = <resolved org>` AND `user_id = <verified sub>`. Never another
//     user's, never cross-org.
//   - READ-ONLY: no INSERT/UPDATE/DELETE, no touch of `m365_pkce_states`, no audit row (a status
//     read is not a lifecycle event), and NO parent locks — it is not a mutation and MUST NOT take
//     the global lock order established by the 0115/0116 RPCs (taking them here would be needless
//     contention on a read path).
//   - Allow-list select: select EXACTLY `status, connected_at, last_refresh_at, scopes` by name —
//     never `select('*')` and strip. A future schema column cannot leak by default.

import type { HandlerDeps, HandlerResult, ConnectionStatusResponse } from './types.ts';
import { resolveOrgOrResult } from './auth.ts';

/** The exact column allow-list the status read returns (AC-M365-150 / AC-M365-152). */
const STATUS_COLUMNS = 'status, connected_at, last_refresh_at, scopes';

/**
 * AC-M365-150/151/152. Flow:
 *   1. authorize (Admin + entitled) via the shared gate → orgId (AC-M365-151: same typed
 *      rejection as the other actions on any gate failure).
 *   2. read ONLY the caller's own row, selecting ONLY the non-sensitive metadata columns
 *      (AC-M365-152: no ciphertext / key_id / oid / tenant is ever read or returned).
 *   3. map to ConnectionStatusResponse. No row → { connected: false, status: null, … }.
 *
 * Read-only: no writes, no audit, no locks (see file header).
 */
export async function handleConnectionStatus(deps: HandlerDeps): Promise<HandlerResult> {
  const { serviceClient, userId } = deps;
  const headers = { 'Content-Type': 'application/json' };

  const resolved = await resolveOrgOrResult(deps);
  if (typeof resolved !== 'string') return resolved;
  const orgId = resolved;

  // Own-row scoped read. `maybeSingle()` (not `single()`) so an absent row resolves cleanly to
  // { data: null, error: null } → connected:false, rather than a PGRST116 error shape.
  const { data, error } = await serviceClient
    .from('ms_graph_connections')
    .select(STATUS_COLUMNS)
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'status read failed' }, headers };
  }

  const row = data as
    | { status?: string | null; connected_at?: string | null; last_refresh_at?: string | null; scopes?: unknown }
    | null;

  const body: ConnectionStatusResponse = row
    ? {
        connected: true,
        status:
          row.status === 'active' || row.status === 'stale' || row.status === 'revoked'
            ? row.status
            : null,
        connected_at: typeof row.connected_at === 'string' ? row.connected_at : null,
        last_refresh_at: typeof row.last_refresh_at === 'string' ? row.last_refresh_at : null,
        scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
      }
    : { connected: false, status: null, connected_at: null, last_refresh_at: null, scopes: [] };

  return { status: 200, body, headers };
}
