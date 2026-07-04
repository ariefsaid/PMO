/**
 * composeViewHandler — pure business-logic handler for the compose-view edge function.
 *
 * Pure: all I/O is injected via HandlerDeps. No Deno globals, no process.env reads.
 * Importable in Vitest (Node) with the ModelClient and Supabase client mocked.
 *
 * ADR-0039 decision 7: handler is CI-testable with the model client mocked; the
 * Deno.serve wrapper (index.ts) is integration-only and not unit-tested.
 *
 * A4 refactor (D2): the compose+repair loop is extracted to composeSpec.ts.
 * This handler is now a thin wrapper that owns the HTTP gates (401/400/429) and
 * calls composeSpec(), mapping ComposeSpecError → 422/502.
 *
 * Reconciliation #1: compileCompositionSpec THROWS (fail-fast); the loop feeds one error.
 * Reconciliation #2: CompilerContext = { userId, orgId } (subset; teamId/projectId omitted).
 * Reconciliation #4: org_id derived from profiles under caller JWT (not JWT claims).
 *
 * Provider swap (docs/specs/agent-model-client.spec.md, FR-MC-021): the only edit here
 * is the HandlerDeps.anthropic → HandlerDeps.modelClient (+model) rename threaded to
 * composeSpec(); HTTP gate order, error-code mapping, and logging discipline unchanged.
 */

// Relative imports so this module resolves under both Deno and Node/Vitest (Option B).
// No .ts extension: Vite/Node resolves TypeScript modules without extensions.
import { composeSpec, ComposeSpecError } from './composeSpec.ts';
import { insertUsageRow } from '../_shared/usage.ts';
import type { ComposeViewRequest, ComposeViewResponse, ComposeViewError } from '../../../pmo-portal/src/lib/agent/types.ts';

// Re-export MAX_REPAIR_ATTEMPTS so any external importer doesn't need to change (AC-CV-005 regression).
export { MAX_REPAIR_ATTEMPTS } from './composeSpec.ts';

// Re-export the vendor-neutral port so tests/callers can import it from this module too.
export type { ModelClient } from '../_shared/modelClient.ts';

// ── Injected interfaces ────────────────────────────────────────────────────────

/**
 * Minimal Supabase-like interface for the profiles lookup, widened (FR-AUC-002/015) to also
 * support the credit-backed RateGuard's balance query shape (`.eq(...).limit(n)`, matching
 * `HandlerSupabaseLike`'s shape in agent-chat/handler.ts) so `creditRateGuard`'s
 * `.from('credits').select('amount').eq('owner_id', userId).limit(10_000)` call compiles
 * against this interface too — the real Supabase client satisfies both shapes structurally.
 */
// `PromiseLike` (not `Promise`): mirrors agent-chat/handler.ts's HandlerSupabaseLike — the real
// supabase-js query builder is a thenable, not nominally a `Promise` (missing catch/finally/
// Symbol.toStringTag under Deno's stricter check), so `Promise<T>` here rejected the real client.
export interface SupabaseLike {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        single(): PromiseLike<{ data: { org_id: string } | null; error: unknown }>;
        limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
      };
    };
  };
}

/**
 * Per-user rate guard (AS-OD-002). Undefined in v1 production (disabled).
 * Injected as a testable interface so enabling it later is config, not a rewrite.
 */
export interface RateGuard {
  check(userId: string): Promise<{ exceeded: boolean; retryAfterSeconds: number }>;
}

export interface HandlerDeps {
  /** Injected vendor-neutral model client — mocked in tests; OpenRouterModelClient in index.ts. */
  modelClient: import('../_shared/modelClient.ts').ModelClient;
  /** Resolved model id for this call (FR-MC-015 / MC-OD-009). */
  model: string;
  /** Injected caller-JWT Supabase client — mocked in tests; real caller-JWT client in index.ts. */
  supabase: SupabaseLike;
  /** Verified caller user ID (auth.uid()); extracted by index.ts. Empty string = unauthorized. */
  userId: string;
  /** Optional rate guard — undefined disables rate limiting (AS-OD-002 default). */
  rateGuard?: RateGuard;
  /**
   * FR-AUC-002/015: optional usage-recording dep. In production this is the same
   * caller-JWT client as `deps.supabase`. Independent of any flag — usage recording
   * is unconditional when this dep is present.
   */
  usage?: { supabase: SupabaseLike };
  /** Injectable clock for testing — defaults to () => new Date(). */
  now?: () => Date;
}

// ── Handler result type ────────────────────────────────────────────────────────

type HandlerResult =
  | { status: 200; body: ComposeViewResponse }
  | { status: 400; body: ComposeViewError }
  | { status: 401; body: ComposeViewError }
  | { status: 422; body: ComposeViewError }
  | { status: 429; body: ComposeViewError }
  | { status: 502; body: ComposeViewError };

// ── Main handler ───────────────────────────────────────────────────────────────

/**
 * composeViewHandler — the pure business-logic handler.
 *
 * Gate order (each gate returns before reaching the model call):
 *   (1) 401 — userId empty (AC-AS-004)
 *   (2) 400 — prompt empty or > 2000 chars (AC-AS-006)
 *   (3) 400 — org mismatch via profiles lookup (AC-AS-005, Recon #4)
 *   (4) 429 — rate guard exceeded (AC-AS-008, optional)
 *   (5) composeSpec() → 200 / 422 (REPAIR_EXHAUSTED) (AC-AS-001,002,003)
 *   (6) 502 — upstream error, raw SDK error scrubbed (AC-AS-007)
 *
 * Logging discipline (NFR-AS-SEC-004): log only { error code, repairAttempts, tokensUsed }.
 * NEVER log req.prompt or spec contents.
 */
export async function composeViewHandler(
  req: ComposeViewRequest,
  deps: HandlerDeps,
): Promise<HandlerResult> {
  const { modelClient, model, supabase, userId, rateGuard } = deps;

  // ── Gate (1): userId present (AC-AS-004, NFR-AS-SEC-002) ──────────────────
  if (!userId) {
    return {
      status: 401,
      body: { status: 401, error: 'UNAUTHORIZED', detail: 'missing userId' },
    };
  }

  // ── Gate (2): input validation — prompt (AC-AS-006, FR-AS-012) ─────────────
  if (!req.prompt || req.prompt.length === 0) {
    return {
      status: 400,
      body: { status: 400, error: 'BAD_REQUEST', detail: 'prompt' },
    };
  }
  if (req.prompt.length > 2000) {
    return {
      status: 400,
      body: { status: 400, error: 'BAD_REQUEST', detail: 'prompt' },
    };
  }

  // ── Gate (3): org match via profiles under caller JWT (AC-AS-005, Recon #4) ─
  // NFR-AS-SEC-003: org mismatch → 400 before any LLM call.
  // Deputy auth: profiles lookup goes through the caller-JWT client (not service_role).
  let profileOrgId: string | null = null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return {
        status: 400,
        body: { status: 400, error: 'BAD_REQUEST', detail: 'orgId' },
      };
    }
    profileOrgId = data.org_id;
  } catch {
    return {
      status: 400,
      body: { status: 400, error: 'BAD_REQUEST', detail: 'orgId' },
    };
  }

  if (profileOrgId !== req.orgId) {
    return {
      status: 400,
      body: { status: 400, error: 'BAD_REQUEST', detail: 'orgId' },
    };
  }

  // ── Gate (4): rate guard (AC-AS-008, AS-OD-002 — disabled by default) ───────
  if (rateGuard) {
    const rateResult = await rateGuard.check(userId);
    if (rateResult.exceeded) {
      return {
        status: 429,
        body: {
          status: 429,
          error: 'RATE_LIMITED',
          retryAfterSeconds: rateResult.retryAfterSeconds,
        },
      };
    }
  }

  // ── Gate (5): compose+repair via composeSpec() (AC-AS-001,002,003) ──────────
  // composeSpec throws ComposeSpecError on exhaustion or upstream error.
  try {
    const { spec, repairAttempts, tokensUsed } = await composeSpec(
      req.prompt,
      req.orgId,
      { modelClient, userId, model },
    );

    // FR-AUC-002/015: one agent_usage row per compose-view invocation (the single choke
    // point — composeSpec() has already resolved, meaning at least one modelClient.create()
    // call succeeded). tokensUsed → completion_tokens is a coarse proxy: composeSpec/
    // ComposeViewResponse does not surface a prompt/completion split or a total_cost today
    // (see docs/plans/2026-07-03-agent-usage-credits.md Open Question 2) — cost stays the
    // FR-AUC-001-sanctioned default 0 when the provider does not report cost.
    if (deps.usage) {
      await insertUsageRow(
        // deps.usage.supabase (compose-view's SupabaseLike) structurally satisfies the
        // HandlerSupabaseLike shape insertUsageRow expects — both are minimal Supabase-like
        // interfaces over the same real client; a genuine structural mismatch (SupabaseLike
        // lacks .insert()) requires this bridging cast, mirroring agent-chat/handler.ts's own
        // documented SupabaseLike-vs-port cast.
        { supabase: deps.usage.supabase as unknown as import('../_shared/usage.ts').UsageDeps['supabase'], runId: null },
        { model, prompt_tokens: 0, completion_tokens: tokensUsed, cost: 0 },
      );
    }

    return {
      status: 200,
      body: { spec, repairAttempts, tokensUsed },
    };
  } catch (err) {
    if (err instanceof ComposeSpecError) {
      if (err.code === 'REPAIR_EXHAUSTED') {
        // 422 REPAIR_EXHAUSTED (AC-AS-003)
        return {
          status: 422,
          body: {
            status: 422,
            error: 'REPAIR_EXHAUSTED',
            validationError: err.validationError,
            repairAttempts: err.repairAttempts,
          },
        };
      }
    }

    // ── Gate (6): upstream error → 502 (AC-AS-007) ───────────────────────────
    // NFR-AS-SEC-004: log only error code, never req.prompt or spec contents.
    // The raw SDK error is NEVER echoed to the client (FR-AS-008).
    console.error('[compose-view] UPSTREAM_ERROR', {
      errorCode: 'UPSTREAM_ERROR',
      repairAttempts: err instanceof ComposeSpecError ? err.repairAttempts : 0,
      tokensUsed: err instanceof ComposeSpecError ? err.tokensUsed : 0,
    });

    return {
      status: 502,
      body: {
        status: 502,
        error: 'UPSTREAM_ERROR',
        detail: 'model call failed',
      },
    };
  }
}
