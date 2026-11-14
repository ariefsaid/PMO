/**
 * agent-chat/compose-view usage recording — clamp + insert (FR-AUC-001..004, NFR-AUC-SEC-004-EXT).
 * Deputy invariant by construction: takes the already-injected caller-JWT HandlerSupabaseLike;
 * never constructs a client, never references service_role.
 */
export interface ModelResponse {
  model: string;
  finish_reason: string;
  message: { role: string; content: string | null };
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
    total_cost?: unknown;
    cached_tokens?: unknown;
    reasoning_tokens?: unknown;
  };
}

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
  supabase: {
    from(table: string): {
      insert(row: Record<string, unknown>): {
        select(): { single(): PromiseLike<{ data?: unknown; error: unknown }> };
      };
    };
  };
  /**
   * The caller's verified organization id — looked up server-side from the verified caller
   * identity (e.g. a profiles lookup on the caller JWT), never taken from the request body.
   * Scopes the fail-closed failure counter per organization (ADR-0101: one warm edge-runtime
   * isolate serves several client organizations).
   */
  orgId: string;
  runId: string | null;
}

/** Privileged ledger writer. Identity and tenancy are supplied only by verified function paths. */
export interface TrustedUsageDeps {
  serviceClient: unknown;
  userId: string;
  orgId: string;
  runId: string | null;
  threadId?: string | null;
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
// metering stays fail-closed until an insert succeeds again. The counter is kept PER
// ORGANIZATION (issue #2254): one warm isolate serves several client organizations (ADR-0101),
// so a single module-level counter let one org's failures be cleared by another org's
// successful insert (turns going unmetered) and unrelated blips fail a third org's turn. The
// map drops an organization's entry on success, so it holds only organizations currently
// failing (bounded per isolate; each edge-runtime isolate self-heals independently).
const FAIL_CLOSED_THRESHOLD = 3;
const failureCountsByOrg = new Map<string, number>();

/** Test seam — reset every organization's fail-closed counter between tests. */
export function resetUsageFailureCounter(): void {
  failureCountsByOrg.clear();
}

/** Test seam — how many organizations currently hold a failure count. */
export function __usageFailureScopeCountForTests(): number {
  return failureCountsByOrg.size;
}

function bumpFailureCount(orgId: string): number {
  const count = (failureCountsByOrg.get(orgId) ?? 0) + 1;
  failureCountsByOrg.set(orgId, count);
  return count;
}

function clearFailureCount(orgId: string): void {
  failureCountsByOrg.delete(orgId);
}

export class UsageMeteringUnavailableError extends Error {
  constructor() {
    super('usage metering unavailable');
    this.name = 'UsageMeteringUnavailableError';
  }
}

function recordTrustedUsageFailure(orgId: string, error: unknown): void {
  const consecutiveFailures = bumpFailureCount(orgId);
  console.error('[agent-usage] USAGE_INSERT_FAILED', {
    errorCode: 'USAGE_INSERT_FAILED',
    code: error instanceof Error ? error.name : (error as { code?: string } | null)?.code ?? 'unknown',
  });
  if (consecutiveFailures >= FAIL_CLOSED_THRESHOLD) {
    console.error('[agent-usage] USAGE_METERING_FAIL_CLOSED', {
      errorCode: 'USAGE_METERING_FAIL_CLOSED',
      orgId,
      consecutiveFailures,
    });
    throw new UsageMeteringUnavailableError();
  }
}

/**
 * Insert one agent_usage row from an already-flattened fields object (FR-AUC-002 grain —
 * one row per modelClient.create() resolution, or one row per compose-view invocation).
 * Every field is (re-)clamped here — the single site that constructs the insert payload
 * (NFR-AUC-SEC-004) — so a caller that forgets to clamp upstream still cannot persist an
 * unclamped value. Swallows TRANSIENT errors (NFR-AUC-SEC-006 — logs count/code only, never
 * blocks the turn), mirroring persistence.ts's discipline — but fails closed after
 * FAIL_CLOSED_THRESHOLD consecutive failures for the caller's organization (AUDIT-H5,
 * per-organization counter — see above). Unconditional — NOT
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
    clearFailureCount(deps.orgId);
    return;
  }
  const consecutiveFailures = bumpFailureCount(deps.orgId);
  if (consecutiveFailures >= FAIL_CLOSED_THRESHOLD) {
    console.error('[agent-usage] USAGE_METERING_FAIL_CLOSED', {
      errorCode: 'USAGE_METERING_FAIL_CLOSED',
      orgId: deps.orgId,
      consecutiveFailures,
    });
    throw new UsageMeteringUnavailableError();
  }
}

/**
 * Write provider usage through the service-role client after independently checking the
 * membership and run/thread ownership. Callers pass only provider responses, never cost fields.
 */
export async function recordTrustedUsage(
  deps: TrustedUsageDeps,
  resp: ModelResponse,
  action: UsageAction = 'chat',
  durationMs?: number,
): Promise<void> {
  const client = deps.serviceClient as {
    from(table: string): {
      select(columns: string): {
        eq(column: string, value: string): {
          single(): Promise<{ data: Record<string, unknown> | null; error: unknown }>;
        };
      };
      insert(row: Record<string, unknown>): { select(): { single(): Promise<{ error: unknown }> } };
    };
  };
  let profileResult: { data: Record<string, unknown> | null; error: unknown };
  try {
    profileResult = await client.from('profiles').select('org_id').eq('id', deps.userId).single();
  } catch (error) {
    recordTrustedUsageFailure(deps.orgId, error);
    return;
  }
  if (profileResult.error) {
    recordTrustedUsageFailure(deps.orgId, profileResult.error);
    return;
  }
  if (profileResult.data?.org_id !== deps.orgId) throw new Error('usage identity not verified');

  if (deps.runId) {
    let runResult: { data: Record<string, unknown> | null; error: unknown };
    try {
      runResult = await client.from('agent_runs').select('id, owner_id, org_id, thread_id').eq('id', deps.runId).single();
    } catch (error) {
      recordTrustedUsageFailure(deps.orgId, error);
      return;
    }
    if (runResult.error) {
      recordTrustedUsageFailure(deps.orgId, runResult.error);
      return;
    }
    const run = runResult.data;
    if (!run || run.owner_id !== deps.userId || run.org_id !== deps.orgId ||
      (deps.threadId && run.thread_id !== deps.threadId)) throw new Error('usage run not owned');
    let threadResult: { data: Record<string, unknown> | null; error: unknown };
    try {
      threadResult = await client.from('agent_threads').select('id, owner_id, org_id').eq('id', String(run.thread_id)).single();
    } catch (error) {
      recordTrustedUsageFailure(deps.orgId, error);
      return;
    }
    if (threadResult.error) {
      recordTrustedUsageFailure(deps.orgId, threadResult.error);
      return;
    }
    const thread = threadResult.data;
    if (!thread || thread.owner_id !== deps.userId || thread.org_id !== deps.orgId) throw new Error('usage thread not owned');
  }

  const cost = clampUsageValue(resp.usage?.total_cost);
  let insertFailed = false;
  let insertErrorCode: string | undefined;
  try {
    const { error } = await client.from('agent_usage').insert({
      owner_id: deps.userId,
      org_id: deps.orgId,
      run_id: deps.runId,
      model: resp.model,
      prompt_tokens: clampUsageValue(resp.usage?.prompt_tokens),
      completion_tokens: clampUsageValue(resp.usage?.completion_tokens),
      cost,
      provider_cost_usd: cost,
      action,
      cached_tokens: clampUsageValue(resp.usage?.cached_tokens),
      reasoning_tokens: clampUsageValue(resp.usage?.reasoning_tokens),
      duration_ms: clampUsageValue(durationMs),
    }).select().single();
    if (error) {
      insertFailed = true;
      insertErrorCode = (error as { code?: string }).code;
    }
  } catch (error) {
    insertFailed = true;
    insertErrorCode = error instanceof Error ? error.name : 'unknown';
  }
  if (!insertFailed) {
    clearFailureCount(deps.orgId);
    return;
  }
  recordTrustedUsageFailure(deps.orgId, { code: insertErrorCode });
}

/**
 * Insert one agent_usage row for a single ModelResponse (agent-chat's model-call choke
 * point). Thin wrapper over insertUsageRow — extracts + clamps the ModelResponse.usage
 * fields into the flat shape. `action` defaults to 'chat' (agent-chat's own call-site);
 * agent-dispatch's fired-run call-site passes 'automation' explicitly.
 */
export function recordUsage(
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
