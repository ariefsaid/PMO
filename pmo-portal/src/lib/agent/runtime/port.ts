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
  entityId?: string;
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
  /** JSON Schema → Anthropic input_schema (D3/R1 — not ZodType) */
  inputSchema: object;
  /** A1 ships ['agent'] */
  surfaces?: ('ui' | 'agent' | 'mcp' | 'cli')[];
  /** A1 read-only actions ⇒ false */
  confirm?: boolean;
  run: (input: unknown, ctx: DeputyContext) => Promise<unknown>;
}

export interface AgentRuntime {
  createRun(input: { goal: string; context?: RunContext }): Promise<AgentRun>;
  followUp(runId: string, message: string): Promise<void>;
  control(
    runId: string,
    cmd: 'pause' | 'resume' | 'cancel' | 'approve' | 'reject',
  ): Promise<void>;
  subscribe(runId: string): AsyncIterable<AgentEvent>;
}
