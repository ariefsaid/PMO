/**
 * agent-runtime port — the PMO-owned seam.
 *
 * This file contains ONLY type/interface exports (no runtime values).
 * No concrete adapter (PmoNativeRuntime, AgentNativeRuntime) may be imported here.
 * All callers depend on this port; the adapter is resolved by the factory/provider (A2).
 *
 * ADR-0040 Option A — the B-shaped seam.
 * NFR-AR-SEC-007: port is pure types; no adapter leakage.
 * D3/R1: inputSchema is a JSON Schema object (NOT ZodType).
 */

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'needs-approval'
  | 'completed'
  | 'errored';

export interface AgentRun {
  id: string;
  title: string;
  status: AgentRunStatus;
  progress?: number;
}

export type AgentEventType =
  | 'user'
  | 'assistant'
  | 'tool'
  | 'artifact'
  | 'status'
  | 'system';

export interface AgentEvent {
  id: string;
  runId: string;
  type: AgentEventType;
  text?: string;
  /** tool input/result, terminal { status: AgentRunStatus } — narrowed by type */
  payload?: unknown;
  /** ISO-8601 */
  createdAt: string;
}

export interface RunContext {
  route?: string;
  /** @deprecated use entity.id — retained dormant (no caller populates it, DEC-4). */
  entityId?: string;
  /** ADR-0045 §2/§3 — the entity currently in view; a grounding hint, never an authorization signal. */
  entity?: { type: string; id: string; label: string };
  /** Reserved — not populated in v1 (ADR-0045, plan §5 "selection deferred"). */
  selection?: unknown;
}

/**
 * Minimal Supabase-like interface for query_entity action.
 * ALWAYS the verified caller JWT-scoped client (deputy auth). NEVER service_role.
 * NFR-AR-SEC-002: no service-role member by construction.
 *
 * Shaped to support:
 *   .select().limit()
 *   .select().eq().limit()
 *   .select().in().limit()
 */
export interface SupabaseLike {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): PromiseLike<{ data: unknown[] | null; error: unknown }> & {
        limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
      };
      /** Direct .in() on the select builder — correct path for in-filter (not .eq().in()). */
      in(
        column: string,
        values: string[],
      ): { limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }> };
      limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
    };
  };
}

/** Deputy context — always carries the caller-JWT supabase client. NEVER service_role. */
export interface DeputyContext {
  jwt: string;
  userId: string;
  orgId: string;
  supabase: SupabaseLike;
}

export interface AgentAction {
  name: string;
  description: string;
  /** JSON Schema → model tool parameters (D3/R1 — not ZodType) */
  inputSchema: object;
  /** A1 ships ['agent'] */
  surfaces?: ('ui' | 'agent' | 'mcp' | 'cli')[];
  /** A1 read-only actions ⇒ false */
  confirm?: boolean;
  /**
   * ADR-0051: optional materiality predicate. Returns true when this specific
   * validated input should surface the human approval chip; false auto-approves
   * through the handler's forced dispatch path. UX-only: RLS/RPCs remain the
   * enforcement authority.
   */
  needsApproval?: (input: unknown, ctx: DeputyContext) => boolean;
  run: (input: unknown, ctx: DeputyContext) => Promise<unknown>;
}

export interface AgentRuntime {
  createRun(input: { goal: string; context?: RunContext }): Promise<AgentRun>;
  followUp(runId: string, message: string): Promise<void>;
  control(
    runId: string,
    cmd: 'pause' | 'resume' | 'cancel' | 'approve' | 'reject' | 'answer',
    payload?: AgentAnswer,
  ): Promise<void>;
  subscribe(runId: string): AsyncIterable<AgentEvent>;
}

/**
 * Payload shape for AgentEvent{type:'status'} — the general run-lifecycle status
 * frame (queued/running/paused/completed/errored). `status` is narrowed to the
 * SAME closed union as `AgentRun.status` (`AgentRunStatus`) so a typo or a new,
 * un-plumbed status value is a compile error at every call site that switches on
 * it, not just a silent `string` mismatch. `error` stays a loose `string` by
 * design (docs/specs/agent-posthog-events.spec.md: "the existing enum-like
 * `payload.error` value" — the server can add new error codes without a client
 * type change; `error_code` on `agent_run_errored` is intentionally `string`).
 */
export interface RunStatusPayload {
  status: AgentRunStatus;
  error?: string;
}

// ── A3: needs-approval / write_resolved event payload types ──────────────────

/** Payload shape for AgentEvent{type:'status', payload:NeedsApprovalPayload} (FR-AW-012). */
export interface NeedsApprovalPayload {
  status: 'needs-approval';
  pendingId: string;
  actionName: string;
  /** Server-composed human-readable summary — NOT model-generated (D-A3-5). */
  humanSummary: string;
  /** Validated tool input (the args the model supplied, post-schema check). */
  structuredArgs: object;
}

/** Payload shape for AgentEvent{type:'system', payload:WriteResolvedPayload} (FR-AW-013). */
export interface WriteResolvedPayload {
  event: 'write_resolved';
  decision: 'approved' | 'rejected';
  actionName: string;
  /** Echo of the pendingId from the chip for UI correlation. */
  pendingId: string;
}

// ── ADR-0045: ask-user question / answer payload types ───────────────────────

/** Payload shape for AgentEvent{type:'status', payload:QuestionPayload} (FR-ATC-008). */
export interface QuestionPayload {
  kind: 'question';
  questionId: string;
  prompt: string;
  options: { id: string; label: string }[];
  allowFreeText?: boolean;
}

/** The answer wire shape carried on a re-POST resolving a pending question (DEC-1). */
export interface AgentAnswer {
  questionId: string;
  optionId?: string;
  freeText?: string;
}

/** Extended SupabaseLike that also supports write operations (A3 write actions). */
export interface SupabaseLikeWithWrites extends SupabaseLike {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): PromiseLike<{ data: unknown[] | null; error: unknown }> & {
        limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
      };
      in(column: string, values: string[]): { limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }> };
      limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
    };
    insert(row: object): {
      select(): { single(): PromiseLike<{ data: unknown; error: unknown }> };
    };
    update(patch: object): {
      eq(column: string, value: string): PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
}
