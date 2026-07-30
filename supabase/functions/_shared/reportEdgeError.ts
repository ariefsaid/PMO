/**
 * reportEdgeError — the ONE call every edge function makes when something fails (ADR-0066).
 * Fans one failure into all three surfaces:
 *   1. a structured console line (greppable in function logs),
 *   2. a PostHog $exception (triage surface, via logStructuredError -> capturePosthogException),
 *   3. an error_events row (the SYSTEM OF RECORD -- tenant-joinable, retained on our terms).
 *
 * The error_events client is injected when the caller already has a service-role client (preserving
 * the deputy invariant for agent-dispatch et al.); otherwise a fetch-based service-role sink is
 * built lazily. An UNAVAILABLE sink is reported, never silently skipped.
 */
import { logStructuredError, type EdgeFunctionName } from './errorLog.ts';
import { recordErrorEvent, type ErrorEventSupabaseLike } from './errorEvent.ts';
import { createServiceRoleErrorEventSink } from './errorEventSink.ts';

export interface ReportEdgeErrorContext {
  fn: EdgeFunctionName;
  errorCode: string;
  contextId?: string;
  orgId?: string;
}

let cachedSink: ErrorEventSupabaseLike | null | undefined;

export async function reportEdgeError(
  ctx: ReportEdgeErrorContext,
  supabase?: ErrorEventSupabaseLike,
): Promise<void> {
  logStructuredError({ fn: ctx.fn, errorCode: ctx.errorCode, contextId: ctx.contextId });

  if (cachedSink === undefined) cachedSink = createServiceRoleErrorEventSink();
  const sink = supabase ?? cachedSink;
  if (!sink) {
    // FR-OBS-010: a missing sink is a DEPLOY-CONFIG failure, and it must be countable on a surface
    // other than the one that is missing.
    logStructuredError({ fn: ctx.fn, errorCode: 'ERROR_EVENT_SINK_UNAVAILABLE' });
    return;
  }

  const written = await recordErrorEvent(sink, ctx);
  if (!written.ok) {
    // FR-OBS-010: the pipeline reports its OWN failure to PostHog. Without this, "no rows in
    // error_events" is ambiguous between a healthy quiet system and a dead recorder.
    logStructuredError({
      fn: ctx.fn,
      errorCode: 'ERROR_EVENT_INSERT_FAILED',
      contextId: written.code,
    });
  }
}

/** @internal test seam — clears the memoized sink between tests. */
export function __resetSinkForTests(): void {
  cachedSink = undefined;
}
