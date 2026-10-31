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
  | 'job_run' | 'erp_push_outcome' | '$ai_generation' | '$ai_span' | '$ai_trace' | 'ai_eval';

const COMMON = ['org_id'] as const;
/** Present only when the user's analytics consent flag reached the server (S1 owner scope):
 *  `$session_id` links the event to the browser's session replay, `user_id` is the opaque auth id. */
const LINK = ['$session_id', 'user_id'] as const;
/** The ONLY keys each server event may carry. Owners: S1 `$ai_*`, S3 `job_run`, S4 `erp_push_outcome`. */
export const SERVER_EVENT_ALLOWLIST: Record<ServerEventName, ReadonlySet<string>> = {
  job_run: new Set(['job', 'status', 'items_processed', 'duration_ms', 'error_code', 'org_count',
    'recovered', 'reconcile_errors', 'org_error_count', ...COMMON]),
  erp_push_outcome: new Set(['tier', 'domain', 'operation', 'outcome', 'error_code', 'attempt_count',
    'duration_ms', 'outbox_id', 'needs_human', ...COMMON]),
  $ai_generation: new Set(['$ai_trace_id', '$ai_session_id', '$ai_span_id', '$ai_parent_id', '$ai_model',
    '$ai_provider', '$ai_input_tokens', '$ai_output_tokens', '$ai_total_cost_usd', '$ai_latency',
    '$ai_is_error', '$ai_http_status', 'action', 'cached_tokens', 'reasoning_tokens', 'error_code', ...COMMON, ...LINK]),
  $ai_span: new Set(['$ai_trace_id', '$ai_span_id', '$ai_parent_id', '$ai_span_name', '$ai_latency',
    '$ai_is_error', ...COMMON, ...LINK]),
  $ai_trace: new Set(['$ai_trace_id', '$ai_session_id', '$ai_latency', '$ai_is_error', 'error_code', 'action', ...COMMON, ...LINK]),
  // Online-eval verdict (LLM judge run in the edge function): a name and a boolean, never text.
  ai_eval: new Set(['$ai_trace_id', '$ai_session_id', 'eval_name', 'eval_pass', 'judge_model', 'action', ...COMMON, ...LINK]),
};

/**
 * Keys that carry prompt/response/tool text. Accepted ONLY when the caller passes `allowText`, which
 * the AI telemetry sets only for an org whose `lifecycle_state` is exactly 'demo' AND whose user sent
 * the analytics-consent flag. For any other call these keys are "not allowlisted" (dropped / thrown).
 */
export const SERVER_TEXT_ALLOWLIST: Partial<Record<ServerEventName, ReadonlySet<string>>> = {
  $ai_generation: new Set(['$ai_input', '$ai_output_choices']),
  $ai_span: new Set(['$ai_input_state', '$ai_output_state']),
  $ai_trace: new Set(['$ai_input_state', '$ai_output_state']),
};

const MAX_TEXT = 4000;
const MAX_MESSAGES = 50;
type TextMessage = { role: string; content: string };

/** Returns the safe form of a text value, or undefined when malformed. */
function safeText(key: string, v: unknown): string | TextMessage[] | undefined {
  if (key === '$ai_input' || key === '$ai_output_choices') {
    if (!Array.isArray(v) || v.length > MAX_MESSAGES) return undefined;
    const out: TextMessage[] = [];
    for (const m of v) {
      const o = m as { role?: unknown; content?: unknown };
      if (!o || typeof o.role !== 'string' || typeof o.content !== 'string') return undefined;
      out.push({ role: o.role.slice(0, 16), content: o.content.slice(0, MAX_TEXT) });
    }
    return out;
  }
  return typeof v === 'string' ? v.slice(0, MAX_TEXT) : undefined;
}

type Prim = string | number | boolean | TextMessage[];
const MAX_STRING = 64; // codes, uuids, slugs; anything longer is not a code.

export function sanitizeServerProps(
  event: ServerEventName,
  props: Record<string, unknown>,
  strict: boolean,
  allowText = false,
): Record<string, Prim> {
  const allowed = SERVER_EVENT_ALLOWLIST[event];
  const textKeys = allowText ? SERVER_TEXT_ALLOWLIST[event] : undefined;
  const out: Record<string, Prim> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (textKeys?.has(k)) {
      const t = safeText(k, v);
      if (t !== undefined) out[k] = t;
      else if (strict) throw new Error(`Server event ${event}: unsafe value for ${k}`);
      continue;
    }
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

export interface EmitOptions { timeoutMs?: number; strict?: boolean; allowText?: boolean }

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
  const safe = sanitizeServerProps(event, props, opts.strict ?? !deno, opts.allowText);
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
