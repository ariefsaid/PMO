import { fetchBounded } from './fetchWithDeadline.ts';
import type { EdgeFunctionName } from './errorLog.ts';

/**
 * posthogServer — generic, fire-and-forget emitter of OPERATIONAL server events to PostHog
 * (ADR-0096, #1532). Operational events are not product analytics: no user id, synthetic
 * `edge:<fn>` distinct id, `$process_person_profile: false`, codes/counts/durations only.
 * The per-event key allowlist below is the enforcement point: a key not listed is dropped on
 * the edge and THROWN under Vitest (strict), so a smuggled prompt/record text fails a test.
 */
export type ServerEventName =
  | 'job_run' | 'erp_push_outcome' | '$ai_generation' | '$ai_span' | '$ai_trace';

const COMMON = ['org_id'] as const;
/** The ONLY keys each server event may carry. Owners: S1 `$ai_*`, S3 `job_run`, S4 `erp_push_outcome`. */
export const SERVER_EVENT_ALLOWLIST: Record<ServerEventName, ReadonlySet<string>> = {
  job_run: new Set(['job', 'status', 'items_processed', 'duration_ms', 'error_code', 'org_count',
    'recovered', 'reconcile_errors', 'org_error_count', ...COMMON]),
  erp_push_outcome: new Set(['tier', 'domain', 'operation', 'outcome', 'error_code', 'attempt_count',
    'duration_ms', 'outbox_id', 'needs_human', ...COMMON]),
  $ai_generation: new Set(['$ai_trace_id', '$ai_session_id', '$ai_span_id', '$ai_parent_id', '$ai_model',
    '$ai_provider', '$ai_input_tokens', '$ai_output_tokens', '$ai_total_cost_usd', '$ai_latency',
    '$ai_is_error', '$ai_http_status', 'action', 'cached_tokens', 'reasoning_tokens', 'error_code', ...COMMON]),
  $ai_span: new Set(['$ai_trace_id', '$ai_span_id', '$ai_parent_id', '$ai_span_name', '$ai_latency',
    '$ai_is_error', ...COMMON]),
  $ai_trace: new Set(['$ai_trace_id', '$ai_session_id', '$ai_latency', '$ai_is_error', 'error_code', ...COMMON]),
};

type Prim = string | number | boolean;
const MAX_STRING = 64; // codes, uuids, slugs; anything longer is not a code.

export function sanitizeServerProps(
  event: ServerEventName,
  props: Record<string, unknown>,
  strict: boolean,
): Record<string, Prim> {
  const allowed = SERVER_EVENT_ALLOWLIST[event];
  const out: Record<string, Prim> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (!allowed.has(k)) {
      if (strict) throw new Error(`Server event ${event}: property not allowlisted: ${k}`);
      continue;
    }
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && v.length <= MAX_STRING) out[k] = v;
    else if (strict) throw new Error(`Server event ${event}: unsafe value for ${k}`);
  }
  return out;
}

export interface EmitOptions { timeoutMs?: number; strict?: boolean }

type DenoLike = { env: { get(k: string): string | undefined } };

export function emitServerEvent(
  event: ServerEventName,
  fn: EdgeFunctionName | 'money-outbox',
  props: Record<string, unknown>,
  opts: EmitOptions = {},
): Promise<void> {
  const deno = (globalThis as { Deno?: DenoLike }).Deno;
  // Sanitize FIRST: under Vitest (no Deno) strict is true, so an allowlist breach fails the test
  // even though nothing would be sent.
  const safe = sanitizeServerProps(event, props, opts.strict ?? !deno);
  if (!deno) return Promise.resolve();
  const key = deno.env.get('POSTHOG_PROJECT_KEY');
  if (!key) return Promise.resolve();
  const host = (deno.env.get('POSTHOG_HOST') || 'https://us.i.posthog.com').replace(/\/$/, '');
  const sent = fetchBounded(undefined, `${host}/i/v0/e/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      event,
      distinct_id: `edge:${fn}`, // synthetic, no user id (OQ-2)
      properties: { ...safe, $process_person_profile: false },
    }),
  }, opts.timeoutMs).then(() => undefined, () => undefined); // fire-and-forget: never rejects
  // Supabase Edge `EdgeRuntime.waitUntil` keeps the send alive after the response (confirmed in the
  // background-tasks docs, 2026-10-31); absent runtime (Vitest, local) => the floating promise stays.
  (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(sent);
  return sent;
}
