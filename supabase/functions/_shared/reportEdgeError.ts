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
    logStructuredError({ fn: ctx.fn, errorCode: 'ERROR_EVENT_SINK_UNAVAILABLE' });
    return;
  }
  await recordErrorEvent(sink, ctx);
}

/** @internal test seam — clears the memoized sink between tests. */
export function __resetSinkForTests(): void {
  cachedSink = undefined;
}
