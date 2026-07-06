/**
 * errorEvent — the fire-and-forget companion to logStructuredError (observability
 * floor, DC-OF-001 step 2). Writes one row to public.error_events via the
 * ALREADY-INJECTED service-role client (deputy invariant by construction — never
 * constructs a client itself, mirrors usage.ts/creditRateGuard.ts). Swallows its
 * own failure so the caller's real error path is never perturbed (FR-OF-002).
 */
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

export async function recordErrorEvent(
  supabase: ErrorEventSupabaseLike,
  ctx: ErrorEventContext,
): Promise<void> {
  const row: { fn: string; error_code: string; context_id?: string; org_id?: string } = {
    fn: ctx.fn,
    error_code: ctx.errorCode,
  };
  if (ctx.contextId !== undefined) row.context_id = ctx.contextId;
  if (ctx.orgId !== undefined) row.org_id = ctx.orgId;

  try {
    const { error } = await supabase.from('error_events').insert(row);
    if (error) {
      console.error('[errorEvent] ERROR_EVENT_INSERT_FAILED', {
        errorCode: 'ERROR_EVENT_INSERT_FAILED',
        code: (error as { code?: string }).code,
      });
    }
  } catch (err) {
    console.error('[errorEvent] ERROR_EVENT_INSERT_FAILED', {
      errorCode: 'ERROR_EVENT_INSERT_FAILED',
      code: err instanceof Error ? err.name : 'unknown',
    });
  }
}
