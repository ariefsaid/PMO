/**
 * posthogError — fire-and-forget forwarder of edge-function error signals into PostHog Error
 * Tracking, so SERVER-side errors land in the SAME issues view as the frontend's captureException
 * (AnalyticsProvider window.onerror/unhandledrejection + ErrorBoundary). IG-audit P2 (2026-07-10):
 * "error monitoring via PostHog, not Sentry" — the app already runs PostHog Error Tracking on the
 * client; this closes the server-side half so client + server errors are one pane of glass.
 *
 * Fail-safe / fire-and-forget:
 *   • NO-OP unless running under Deno (in Vitest `Deno` is undefined → never fetches, so the
 *     logStructuredError choke point that calls this stays test-pure + offline).
 *   • NO-OP unless POSTHOG_PROJECT_KEY is set (an unconfigured deploy silently skips — the forward
 *     is additive to error_events/Telegram, never a hard dependency).
 *   • Swallows ALL errors — never perturbs the caller's real error path (mirrors recordErrorEvent /
 *     FR-OF-002).
 *   • Sends ONLY a stable error CODE + fn name + optional NON-secret contextId/orgId — never a
 *     secret, PII, or prompt text (same discipline as logStructuredError's narrow type).
 *
 * Uses PostHog's public capture endpoint (POST /i/v0/e/) with the phc_ PROJECT key — the same
 * client-exposed ingestion key the SPA uses, NOT the personal API key. Set it as an edge-function
 * secret: `POSTHOG_PROJECT_KEY` (+ optional `POSTHOG_HOST`, default us).
 */
export interface PosthogExceptionContext {
  fn: string;
  errorCode: string;
  contextId?: string;
  orgId?: string;
}

export async function capturePosthogException(ctx: PosthogExceptionContext): Promise<void> {
  // Deno-only: in Vitest `Deno` is undefined → no-op (keeps the logStructuredError caller offline).
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  if (!deno) return;

  const key = deno.env.get('POSTHOG_PROJECT_KEY');
  if (!key) return; // unconfigured deploy → silent skip (fail-safe; the forward is additive)

  const host = (deno.env.get('POSTHOG_HOST') || 'https://us.i.posthog.com').replace(/\/$/, '');

  // $exception_list gives PostHog Error Tracking a groupable, stackless exception keyed by the
  // stable error code (edge error CODES are not thrown JS Errors, so there is no stack — fine).
  const properties: Record<string, unknown> = {
    $exception_list: [
      {
        type: ctx.errorCode,
        value: `[${ctx.fn}] ${ctx.errorCode}`,
        mechanism: { handled: true, synthetic: true },
      },
    ],
    fn: ctx.fn,
    error_code: ctx.errorCode,
  };
  if (ctx.contextId !== undefined) properties.context_id = ctx.contextId;
  if (ctx.orgId !== undefined) properties.org_id = ctx.orgId;

  try {
    await fetch(`${host}/i/v0/e/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        event: '$exception',
        distinct_id: `edge:${ctx.fn}`, // synthetic server id — no user PII
        properties,
      }),
    });
  } catch {
    // fire-and-forget: never perturb the caller's error path.
  }
}
