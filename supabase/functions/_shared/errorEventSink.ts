/**
 * errorEventSink — a service-role writer for public.error_events implemented over `fetch` against
 * PostgREST, satisfying the SAME structural interface `recordErrorEvent` already accepts
 * (ErrorEventSupabaseLike). ADR-0066 §4.
 *
 * Why fetch and not supabase-js: this module is reachable from EVERY edge function, including ones
 * that do not otherwise import supabase-js (e.g. `health`). Reusing recordErrorEvent verbatim keeps
 * one insert code path; the structural interface is what makes that free.
 *
 * Returns `null` when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are absent — the caller MUST treat
 * that as a visible degradation (ERROR_EVENT_SINK_UNAVAILABLE), never a silent skip.
 * Deno-only: in Vitest `Deno` is undefined, so this returns null and stays offline unless a test
 * explicitly supplies env + a stubbed fetch.
 *
 * CORRELATED-FAILURE HAZARD (review round, 2026-07-28): the sink is a plain `fetch` with no
 * deadline, and `reportEdgeError` / `serveWithErrorReporting` both await it before returning a
 * response — so this is slowest exactly when errors spike (DB degrades -> error rate rises ->
 * every FAILING request now also blocks on the DB). Bounded via `fetchWithDeadline` (the repo's
 * existing server-side hang guard, `erpnext-sweep`/`adapter-dispatch`'s pattern for the same class
 * of raw un-bounded fetch); a deadline degrades to the SAME `{ error: { code } }` shape a non-2xx
 * or thrown network error already produces (the existing `catch` below, unchanged).
 */
import type { ErrorEventSupabaseLike } from './errorEvent.ts';
import { fetchWithDeadline } from './fetchWithDeadline.ts';

/** Bounds the error_events insert POST. Short — this write must never itself become the reason a
 *  failing request's own response is slow (see CORRELATED-FAILURE HAZARD above). */
const ERROR_EVENT_SINK_TIMEOUT_MS = 2_000;

export function createServiceRoleErrorEventSink(
  env?: { url?: string; serviceRoleKey?: string },
): ErrorEventSupabaseLike | null {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  const url = env?.url ?? deno?.env.get('SUPABASE_URL');
  const key = env?.serviceRoleKey ?? deno?.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;

  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/error_events`;

  return {
    from() {
      return {
        async insert(row) {
          try {
            const res = await fetchWithDeadline(
              fetch,
              endpoint,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  apikey: key,
                  Authorization: `Bearer ${key}`,
                  Prefer: 'return=minimal',
                },
                body: JSON.stringify(row),
              },
              ERROR_EVENT_SINK_TIMEOUT_MS,
            );
            if (!res.ok) return { error: { code: String(res.status) } };
            return { error: null };
          } catch (err) {
            return { error: { code: err instanceof Error ? err.name : 'unknown' } };
          }
        },
      };
    },
  };
}
