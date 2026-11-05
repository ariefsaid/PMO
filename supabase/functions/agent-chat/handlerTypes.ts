/**
 * handlerTypes — the LEAF contract module for the agent-chat handler (THEME-CROSS-93,
 * XA-003): HandlerDeps, its injected-interface types and the persistence runtime
 * contract live here so persistence.ts, the turn modules and handler.ts can all depend
 * on them WITHOUT a type-only import cycle through handler.ts. Types only — no runtime
 * behavior. handler.ts re-exports every name so existing callers/tests keep importing
 * from handler.ts.
 */
import type { ModelClient, ModelMessage } from '../_shared/modelClient.ts';
import type { CompactionOptions } from '../_shared/transcriptCompaction.ts';
import type { DeputyContext } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';
import type { AiRunTelemetry } from './aiTelemetry.ts';

// ── Injected interfaces ────────────────────────────────────────────────────────

/**
 * Minimal Supabase-like interface supporting:
 *   - profiles lookup: .from('profiles').select('org_id, role').eq().single()
 *   - entity reads: .from(t).select(cols).limit() / .eq().limit() / .in().limit()
 *   - write actions: .from(t).insert(row).select().single() / .update(patch).eq()
 *
 * Item 3 (cast cleanup): `.select().in()` is declared at the TOP level (not just nested
 * under `.eq()`) so this interface is structurally assignable to the port's `SupabaseLike`/
 * `SupabaseLikeWithWrites` (both require a top-level `.in()`) without an `as unknown as`
 * bridge — the real Supabase client supports `.select().in()` directly too, so this isn't
 * a behavior change, just a shape the type was previously missing.
 *
 * `PromiseLike` (not `Promise`): the real `@supabase/supabase-js` query builder is a
 * thenable (`.then()`/`.catch()`/`.finally()` all present at runtime) but its TS type
 * (`PostgrestBuilder`) is not nominally a `Promise` — under Deno's stricter structural
 * check (deno-check CI gate) `Promise<T>` requires `catch`/`finally`/`[Symbol.toStringTag]`
 * that `PostgrestBuilder`'s declared type omits, so the real client failed to satisfy this
 * interface (deno check TS2322, never caught before this interface was exercised outside
 * tsc's looser resolution). `PromiseLike<T>` needs only `.then()`, which both the real
 * client and every test's plain-object mock already provide — no runtime behavior change.
 */
export interface HandlerSupabaseLike {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        single(): PromiseLike<{ data: { org_id: string; role?: string } | null; error: unknown }>;
        // runExists(runId): existence probe on agent_runs — 0 rows → data:null (no error, unlike single()).
        maybeSingle(): PromiseLike<{ data: { id: string } | null; error: unknown }>;
        limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
        in(column: string, values: string[]): { limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }> };
      };
      in(column: string, values: string[]): { limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }> };
      limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
    };
    insert(row: object): {
      select(): {
        single(): PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
    update(patch: object): {
      eq(column: string, value: string): PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
  /** Invoke a Postgres function (RPC). Used by the credit-backed RateGuard (org_credit_balance). */
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

/** Injectable rate guard (AS-OD-002 — disabled by default). AMENDED by ADR-0049: the check is
 * per-ORG (orgId), not per-owner; `reason` distinguishes out_of_credits from a meter RPC failure. */
export interface RateGuard {
  /** `runId` selects the atomic reserve path (creditRateGuard); `release` drops that hold. */
  check(orgId: string, runId?: string): Promise<{ exceeded: boolean; retryAfterSeconds: number; reason: 'out_of_credits' | 'meter_error' }>;
  release?(runId: string): Promise<void>;
}

/**
 * Injectable `can()` predicate (A3 deputy re-auth — FR-AW-010).
 * Injected to avoid importing policy.ts (which has browser supabase/client deps) directly.
 * In production (index.ts): the real `can` from src/auth/policy.ts is passed here.
 * In tests: a vi.fn() mock that returns true or false as needed.
 */
export type CanFn = (
  action: string,
  entity: string,
  ctx: { realRole: string | null },
) => boolean;

export interface HandlerDeps {
  /** Vendor-neutral model client (FR-MC-016). */
  modelClient: ModelClient;
  /** Resolved model id for this call (FR-MC-015 / MC-OD-009). */
  model: string;
  /** Enables the final-answer evidence check unless explicitly false. */
  verifyAnswer?: boolean;
  supabase: HandlerSupabaseLike;
  userId: string;
  rateGuard?: RateGuard;
  now?: () => Date;
  /**
   * FR-AUC-002/004/018: optional usage-recording dep, separate from `persistence` so a
   * usage row is inserted regardless of whether the ADR-0043 persistence flag is on
   * (AC-AUC-018). In production this is the same caller-JWT client as `deps.supabase`,
   * typed/named independently so a test can enable one without the other.
   */
  usage?: { supabase?: HandlerSupabaseLike; serviceClient?: unknown };
  /**
   * A3: injectable can() predicate. If omitted, defaults to deny-all (safe default).
   * Production: pass `can` from src/auth/policy.ts.
   */
  can?: CanFn;
  /**
   * Tier-2 attachments: resolves caller-scoped attachment ids into model-readable
   * context messages under the SAME deputy context. Optional until the DB/storage
   * resolver lands; when absent, attachmentIds are ignored rather than elevated.
   * The optional `threadId` scopes the resolve to the request's conversation so an
   * attachment id replayed from a different thread resolves to zero rows.
   */
  attachmentResolver?: {
    resolveAttachmentMessages(
      attachmentIds: string[],
      deputyCtx: DeputyContext,
      threadId?: string,
    ): Promise<ModelMessage[]>;
  };
  /**
   * A4: flag-gated compose_view tool registration (FR-CV-024, D7).
   * The AND-result of (agentAssistant && aiComposer) is computed by the caller
   * (SPA → index.ts) and passed here, because Deno can't read Vite FEATURES.
   * When undefined/false, compose_view is absent from the tool catalog (AC-CV-002).
   */
  composeEnabled?: boolean;
  /**
   * ops-admin-surface S5 (FR-USE-001): which usage-summary bucket this run's agent_usage rows
   * belong to. Omitted/undefined -> 'chat' (the interactive path's default, unchanged); the
   * agent-dispatch fired-run path sets this to 'automation' so a fired automation's spend is
   * distinguishable from an interactive turn in org_usage_summary()/operator_usage_summary().
   */
  usageAction?: 'chat' | 'compose' | 'automation';
  /**
   * Token-budget transcript compaction applied to the messages sent to the model each round
   * (shrinks the replayed input; old tool-result bodies past the recency window become a marker).
   * Omitted → DEFAULT_COMPACTION. Never mutates the persisted transcript — model-call input only.
   */
  compaction?: CompactionOptions;
  /**
   * ADR-0043: optional persistence dep (thread/run/event journal, heartbeat, de-dupe).
   * Optional so flag-off / existing tests pass unchanged (FR-AGP-026 gating) — every
   * persistence call site below is guarded on `deps.persistence` being present.
   * `journaledWrites` is the run's completed tool-call journal, pre-loaded by index.ts
   * (via `loadJournaledWrites`) before the handler is invoked — used by the de-dupe gate
   * (FR-AGP-013/014/015) and resume context injection (FR-AGP-018).
   * `startSeq` (ADR-0043 §2, seq continuity): the first seq value this request's events should
   * be assigned, pre-loaded by index.ts (via `loadMaxSeq(runId) + 1`) for a resumed run —
   * omitted/undefined defaults to 0 (a genuinely fresh run, no prior persisted events).
   */
  persistence?: PersistenceDeps & { journaledWrites?: JournaledWrite[]; startSeq?: number };
  /** @internal set only by agentChatHandler (#1532 S1): per-run AI telemetry; absent => no-op. */
  ai?: AiRunTelemetry;
  /** Per-request credit holds placed by this invocation (set by agentChatHandler; released in its finally). */
  creditHolds?: string[];
}

// ── Per-request persistence runtime contract (ADR-0043 §2/§3/§4) ──────────────

/**
 * Per-request persistence bookkeeping — a monotonic seq counter and the run's journaled
 * completed writes, shared across agentChatHandler/handleDecision/runContinuation (all three feed
 * the same run's event stream on a resume/decision re-POST). Built once per call; `undefined`
 * when `deps.persistence` is absent (flag-off — FR-AGP-026), so every call site below is a
 * single `if (persist)` guard away from a no-op.
 */
export interface PersistenceRuntime {
  deps: PersistenceDeps;
  journaledWrites: JournaledWrite[];
  nextSeq(): number;
}

// ── Persistence dep shapes (moved from persistence.ts to keep this module the leaf —
// XA-003: persistence.ts imports HandlerSupabaseLike from HERE, one direction only) ──

/**
 * The single persistence-dep shape passed from index.ts (bound to callerClient) and consumed
 * by handler.ts. Constructs no client, takes no service_role parameter, by construction.
 * No owner/org fields: every write runs under the caller's JWT and RLS column defaults
 * stamp owner_id/org_id server-side — identity is never threaded through this shape.
 */
export interface PersistenceDeps {
  supabase: HandlerSupabaseLike;
  now: () => Date;
}

export interface JournaledWrite {
  toolName: string;
  argsHash: string;
  payload: unknown;
}

/**
 * Optional tool-call journal fields (FR-AGP-012), populated in the SAME insert as the event
 * row on a `type==='tool'` event.
 */
export interface ToolJournal {
  toolName: string;
  argsHash: string;
  status: 'completed' | 'errored';
}
