/**
 * errorLog — the ONE structured-error-logging choke point for every edge function
 * (agent-chat, compose-view, agent-dispatch, admin-invite-user, telegram-notify).
 * Observability hardening (spike 2026-07-04, harden #1): every error/failure path
 * must log a STRUCTURED line carrying an error CODE + an optional context id, and
 * NEVER a secret value or prompt/PII text.
 *
 * Test-safe: takes a plain object; its own logic uses no Deno globals — importable in
 * Vitest (mirrors modelResolution.ts / usage.ts's ADR-0039 decision-7 pattern). It ALSO
 * fire-and-forget fans the same {fn, errorCode, contextId} into PostHog Error Tracking via
 * capturePosthogException (posthogError.ts), so server-side errors join the FE's captureException
 * issues view (IG-audit P2 — error monitoring via PostHog, not Sentry). That forward is a guarded
 * NO-OP outside Deno / without POSTHOG_PROJECT_KEY, so this stays offline + pure in Vitest.
 *
 * Deliberately narrow-typed context (fn/errorCode/contextId ONLY) — there is no
 * slot for an arbitrary payload, so a caller cannot accidentally thread a secret,
 * an API key, or prompt text through this function (a compile-time scrub, not
 * just a runtime discipline). The PostHog forward carries the SAME narrow fields only.
 */
import { capturePosthogException } from './posthogError.ts';

export type EdgeFunctionName =
  | 'agent-chat'
  | 'compose-view'
  | 'agent-dispatch'
  | 'admin-invite-user'
  | 'telegram-notify';

export interface StructuredErrorContext {
  /** Which edge function emitted this log line. */
  fn: EdgeFunctionName;
  /** A stable, greppable error code (e.g. MISSING_OPENROUTER_API_KEY, TICK_FAILED). */
  errorCode: string;
  /** Optional correlation id (runId / automationId / etc.) — never a secret. */
  contextId?: string;
}

/**
 * Log one structured console.error line: `[<fn>] <errorCode>` + a context object
 * carrying {fn, errorCode, contextId?}. `contextId` is omitted entirely (not a
 * stray `undefined` key) when not supplied.
 */
export function logStructuredError(ctx: StructuredErrorContext): void {
  const context: Record<string, unknown> = { fn: ctx.fn, errorCode: ctx.errorCode };
  if (ctx.contextId !== undefined) {
    context.contextId = ctx.contextId;
  }
  console.error(`[${ctx.fn}] ${ctx.errorCode}`, context);
  // Fan out to PostHog Error Tracking (guarded no-op outside Deno / without POSTHOG_PROJECT_KEY —
  // so this call adds nothing in Vitest). Floating on purpose: fire-and-forget, self-swallowing.
  void capturePosthogException(ctx);
}
