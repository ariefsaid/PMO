/**
 * errorEvent — the fire-and-forget companion to logStructuredError (observability
 * floor, DC-OF-001 step 2). Writes one row to public.error_events via the
 * ALREADY-INJECTED service-role client (deputy invariant by construction — never
 * constructs a client itself, mirrors usage.ts/creditRateGuard.ts). Never throws,
 * so the caller's real error path is never perturbed (FR-OF-002) — but REPORTS
 * the outcome (FR-OBS-011).
 *
 * CONTEXT_ID_MAX_LEN (review round 2026-07-28): `contextId` is unbounded text on the wire. Safe
 * TODAY only because every call site passes a hardcoded literal (`err.name`, `err instanceof Error
 * ? err.name : 'unknown'`) — that is a CONVENTION, not a structural guarantee, and this file is the
 * one funnel every producer's insert goes through (both the legacy direct callers and the
 * reportEdgeError choke point via errorEventSink). One `err.name = someUpstreamResponseText` away
 * from the leak class this program has closed twice this week already. Truncated here, once, so it
 * is structurally safe rather than conventionally safe.
 */
const CONTEXT_ID_MAX_LEN = 64;
export interface ErrorEventSupabaseLike {
  from(table: 'error_events'): {
    insert(row: {
      fn: string;
      error_code: string;
      context_id?: string;
      org_id?: string;
    }): Promise<{ error: unknown }>;
  };
}

export interface ErrorEventContext {
  fn: string;
  errorCode: string;
  contextId?: string;
  orgId?: string;
}

export type RecordErrorEventResult = { ok: true } | { ok: false; code: string };

/**
 * FR-OBS-011: reports insert success or failure to its caller. It still never THROWS (the caller's
 * real error path must not be perturbed) but it no longer returns `void` regardless of outcome --
 * that made a broken recorder indistinguishable from a healthy, quiet one.
 */
export async function recordErrorEvent(
  supabase: ErrorEventSupabaseLike,
  ctx: ErrorEventContext,
): Promise<RecordErrorEventResult> {
  const row: { fn: string; error_code: string; context_id?: string; org_id?: string } = {
    fn: ctx.fn,
    error_code: ctx.errorCode,
  };
  if (ctx.contextId !== undefined) row.context_id = ctx.contextId.slice(0, CONTEXT_ID_MAX_LEN);
  if (ctx.orgId !== undefined) row.org_id = ctx.orgId;

  try {
    const { error } = await supabase.from('error_events').insert(row);
    if (error) {
      const code = (error as { code?: string }).code ?? 'unknown';
      console.error('[errorEvent] ERROR_EVENT_INSERT_FAILED', {
        errorCode: 'ERROR_EVENT_INSERT_FAILED',
        code,
      });
      return { ok: false, code };
    }
    return { ok: true };
  } catch (err) {
    const code = err instanceof Error ? err.name : 'unknown';
    console.error('[errorEvent] ERROR_EVENT_INSERT_FAILED', {
      errorCode: 'ERROR_EVENT_INSERT_FAILED',
      code,
    });
    return { ok: false, code };
  }
}
