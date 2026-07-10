/**
 * agent-chat/compose-view usage recording — clamp + insert (FR-AUC-001..004, NFR-AUC-SEC-004-EXT).
 * Deputy invariant by construction: takes the already-injected caller-JWT HandlerSupabaseLike;
 * never constructs a client, never references service_role.
 */
import type { HandlerSupabaseLike } from '../agent-chat/handler.ts';
import type { ModelResponse } from './modelClient.ts';

/**
 * Clamp a single provider-reported usage value: Number.isFinite(x) && x >= 0 ? x : 0.
 * NFR-AUC-SEC-004-EXT: a non-numeric type (string/object/array/null/undefined) is treated
 * identically to a non-finite number — Number.isFinite on a non-number is always false
 * (Number.isFinite("5") === false), so this already coerces stringly/object/null/undefined
 * input to 0 without ever throwing or attempting a numeric parse.
 */
export function clampUsageValue(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0;
}

export interface UsageDeps {
  supabase: HandlerSupabaseLike;
  runId: string | null;
}

/** The three call-site kinds (ops-admin-surface S5, FR-USE-001) — matches the DB CHECK. */
export type UsageAction = 'chat' | 'compose' | 'automation';

export interface UsageFields {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost: number;
  /**
   * The USD cost reported by the provider (ops-admin-surface S5, FR-USE-001). Today captured
   * from the SAME `ModelResponse.usage.total_cost` value as `cost` — they are equal now and
   * diverge only once a pricing rate is introduced (a pricing-issue change, not this one).
   * Defaults to the clamped `cost` when omitted (interim call-sites that haven't been updated
   * to pass it explicitly still populate a sane, non-null value).
   */
  provider_cost_usd?: number;
  /** Which call-site produced this row. Defaults to 'chat' when omitted. */
  action?: UsageAction;
  /**
   * Prompt tokens served from the provider prefix cache (subset of prompt_tokens; telemetry for the
   * prompt-cache cost lever). Defaults to 0 when the provider does not report it.
   */
  cached_tokens?: number;
  /**
   * Reasoning/thinking tokens in the output (subset of completion_tokens). Defaults to 0 when the
   * model emits none or the provider does not report it.
   */
  reasoning_tokens?: number;
  /**
   * Wall-clock ms of the model call that produced this row (the edge-fn `model_ms` probe). Telemetry
   * for the cost-per-run/latency dashboard (agent-cost-dashboard). Defaults to 0 when unmeasured
   * (e.g. compose-view, which has no per-round timer).
   */
  duration_ms?: number;
}

// AUDIT-H5 (2026-07-04 audit, Reliability H-3): a PERSISTENTLY failing usage insert must not
// grant unbounded unmetered model calls. A single transient failure is still swallowed
// (NFR-AUC-SEC-006 — never blocks the turn on a blip), but after FAIL_CLOSED_THRESHOLD
// CONSECUTIVE failures insertUsageRow throws, which the handlers surface as an errored turn —
// metering stays fail-closed until an insert succeeds again. Per-isolate counter by design:
// each edge-runtime isolate self-heals independently.
const FAIL_CLOSED_THRESHOLD = 3;
let consecutiveInsertFailures = 0;

/** Test seam — reset the fail-closed counter between tests. */
export function resetUsageFailureCounter(): void {
  consecutiveInsertFailures = 0;
}

export class UsageMeteringUnavailableError extends Error {
  constructor() {
    super('usage metering unavailable');
    this.name = 'UsageMeteringUnavailableError';
  }
}

/**
 * Insert one agent_usage row from an already-flattened fields object (FR-AUC-002 grain —
 * one row per modelClient.create() resolution, or one row per compose-view invocation).
 * Every field is (re-)clamped here — the single site that constructs the insert payload
 * (NFR-AUC-SEC-004) — so a caller that forgets to clamp upstream still cannot persist an
 * unclamped value. Swallows TRANSIENT errors (NFR-AUC-SEC-006 — logs count/code only, never
 * blocks the turn), mirroring persistence.ts's discipline — but fails closed after
 * FAIL_CLOSED_THRESHOLD consecutive failures (AUDIT-H5, see above). Unconditional — NOT
 * gated on deps.persistence (FR-AUC-004/018).
 */
export async function insertUsageRow(deps: UsageDeps, fields: UsageFields): Promise<void> {
  let failed = false;
  try {
    const cost = clampUsageValue(fields.cost);
    const { error } = await deps.supabase
      .from('agent_usage')
      .insert({
        run_id: deps.runId,
        model: fields.model,
        prompt_tokens: clampUsageValue(fields.prompt_tokens),
        completion_tokens: clampUsageValue(fields.completion_tokens),
        cost,
        // fields.provider_cost_usd is independently clamped (never inherits an unclamped value);
        // omitted -> defaults to the already-clamped cost (today-equal, FR-USE-001 note above).
        provider_cost_usd: fields.provider_cost_usd === undefined ? cost : clampUsageValue(fields.provider_cost_usd),
        action: fields.action ?? 'chat',
        // Telemetry-only measures; clamped here (the single insert choke point) so a caller that
        // forgets to clamp upstream still cannot persist a negative/non-finite value. Omitted ⇒ 0.
        cached_tokens: clampUsageValue(fields.cached_tokens),
        reasoning_tokens: clampUsageValue(fields.reasoning_tokens),
        duration_ms: clampUsageValue(fields.duration_ms),
      })
      .select()
      .single();
    if (error) {
      failed = true;
      console.error('[agent-usage] USAGE_INSERT_FAILED', {
        errorCode: 'USAGE_INSERT_FAILED',
        code: (error as { code?: string }).code,
      });
    }
  } catch (err) {
    failed = true;
    console.error('[agent-usage] USAGE_INSERT_THREW', {
      errorCode: 'USAGE_INSERT_THREW',
      code: err instanceof Error ? err.name : 'unknown',
    });
  }
  if (!failed) {
    consecutiveInsertFailures = 0;
    return;
  }
  consecutiveInsertFailures++;
  if (consecutiveInsertFailures >= FAIL_CLOSED_THRESHOLD) {
    console.error('[agent-usage] USAGE_METERING_FAIL_CLOSED', {
      errorCode: 'USAGE_METERING_FAIL_CLOSED',
      consecutiveFailures: consecutiveInsertFailures,
    });
    throw new UsageMeteringUnavailableError();
  }
}

/**
 * Insert one agent_usage row for a single ModelResponse (agent-chat's model-call choke
 * point). Thin wrapper over insertUsageRow — extracts + clamps the ModelResponse.usage
 * fields into the flat shape. `action` defaults to 'chat' (agent-chat's own call-site);
 * agent-dispatch's fired-run call-site passes 'automation' explicitly.
 */
export async function recordUsage(
  deps: UsageDeps,
  resp: ModelResponse,
  action?: UsageAction,
  durationMs?: number,
): Promise<void> {
  return insertUsageRow(deps, {
    model: resp.model,
    prompt_tokens: clampUsageValue(resp.usage?.prompt_tokens),
    completion_tokens: clampUsageValue(resp.usage?.completion_tokens),
    cost: clampUsageValue(resp.usage?.total_cost),
    cached_tokens: clampUsageValue(resp.usage?.cached_tokens),
    reasoning_tokens: clampUsageValue(resp.usage?.reasoning_tokens),
    duration_ms: durationMs,
    action,
  });
}
