/**
 * agent-chat actions — the query_entity AgentAction.
 *
 * Pure: all I/O is injected via DeputyContext (the caller-JWT supabase client).
 * No Deno globals; importable in Vitest (Node) with Supabase mocked.
 *
 * D4: slim whitelisted read — NOT compileCompositionSpec, NOT FE repositories.
 * D5: ships projects + companies (no requiredFilter, happy path).
 * D6: AGENT_READ_ROW_CAP=50, READ_TIMEOUT_MS=5000.
 * FR-AR-010/011/012: entity whitelist, row cap, deputy context only.
 */

// Relative imports — no .ts extension (Deno + Node/Vitest both resolve these).
// No @-alias (Deno has no Vite alias).
import { ENTITY_WHITELIST } from '../../../pmo-portal/src/lib/viewspec/types';
import type { AgentAction, DeputyContext } from '../../../pmo-portal/src/lib/agent/runtime/port';
import { QUERY_ENTITY_SCHEMA } from './schema';

// ── Constants (D5, D6) ────────────────────────────────────────────────────────

/** Whitelisted entities available to the agent in A1 (D5/R3). */
export const AGENT_READ_ENTITIES = ['projects', 'companies'] as const;
export type AgentReadEntity = (typeof AGENT_READ_ENTITIES)[number];

/** Hard row cap — the effective limit is min(input.limit ?? CAP, CAP). D6. */
export const AGENT_READ_ROW_CAP = 50;

/** Wall-clock timeout for each DB read. D6. */
export const READ_TIMEOUT_MS = 5000;

// ── Validated input shape (runtime) ──────────────────────────────────────────

interface QueryEntityFilter {
  column: string;
  op: 'eq' | 'in';
  value: unknown;
}

interface QueryEntityInput {
  entity: string;
  columns?: string[];
  filter?: QueryEntityFilter;
  limit?: number;
}

// ── Helper: AbortController timeout ───────────────────────────────────────────

function timeoutPromise<T>(ms: number): Promise<T> {
  return new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error('query_entity read timeout')), ms),
  );
}

// ── runQueryEntity (the action logic, pure + DI) ──────────────────────────────

/**
 * Execute a whitelisted, row-capped read through the caller-JWT supabase client.
 * Returns a structured result (never throws to the handler).
 *
 * Validation order (FR-AR-010):
 *   1. entity ∈ AGENT_READ_ENTITIES → structured error if not (AC-AR-006)
 *   2. columns ⊆ entry.allowedColumns → structured error if any unknown (AC-AR-006)
 *   3. requiredFilter check → structured error if missing (R3 / A3 entities)
 *   4. apply row cap, filter, call ctx.supabase (AC-AR-007, AC-AR-008)
 */
export async function runQueryEntity(
  input: unknown,
  ctx: DeputyContext,
): Promise<{ rowCount: number; rows: unknown[] } | { error: string }> {
  const inp = input as QueryEntityInput;

  // ── Step 1: entity whitelist check (AC-AR-006) ────────────────────────────
  const entityKey = inp.entity as AgentReadEntity;
  if (!(AGENT_READ_ENTITIES as readonly string[]).includes(entityKey)) {
    return { error: `unknown entity: ${inp.entity}` };
  }

  const entry = ENTITY_WHITELIST[entityKey];

  // ── Step 2: column whitelist check (AC-AR-006) ────────────────────────────
  const requestedCols = inp.columns ?? [...entry.allowedColumns];
  for (const col of requestedCols) {
    if (!entry.allowedColumns.has(col)) {
      return { error: `unknown column: ${col} on entity ${entityKey}` };
    }
  }

  // ── Step 3: requiredFilter check (R3 / built for A3) ─────────────────────
  if (
    entry.requiredFilter &&
    (!inp.filter || inp.filter.column !== entry.requiredFilter)
  ) {
    return {
      error: `entity ${entityKey} requires a filter on column ${entry.requiredFilter}`,
    };
  }

  // ── Step 4: build the query (AC-AR-007, AC-AR-008) ───────────────────────
  const effLimit = Math.min(inp.limit ?? AGENT_READ_ROW_CAP, AGENT_READ_ROW_CAP);
  const colsStr = requestedCols.join(',');
  const builder = ctx.supabase.from(entry.table).select(colsStr);

  let query: Promise<{ data: unknown[] | null; error: unknown }>;

  if (inp.filter) {
    const { column, op, value } = inp.filter;
    if (op === 'eq') {
      query = (builder.eq(column, String(value)) as { limit(n: number): Promise<{ data: unknown[] | null; error: unknown }> }).limit(effLimit);
    } else if (op === 'in') {
      const vals = Array.isArray(value)
        ? value.map(String)
        : [String(value)];
      query = builder.eq(column, vals[0]).in(column, vals).limit(effLimit);
    } else {
      return { error: `unsupported filter op: ${op}` };
    }
  } else {
    query = builder.limit(effLimit);
  }

  // ── Step 5: race against timeout (D6) ─────────────────────────────────────
  let result: { data: unknown[] | null; error: unknown };
  try {
    result = await Promise.race([
      query,
      timeoutPromise<{ data: unknown[] | null; error: unknown }>(READ_TIMEOUT_MS),
    ]);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'query_entity read failed',
    };
  }

  if (result.error) {
    return { error: 'query_entity db error' };
  }

  const rows = result.data ?? [];
  return { rowCount: rows.length, rows };
}

// ── queryEntityAction — the AgentAction (FR-AR-006/008/009) ──────────────────

export const queryEntityAction: AgentAction = {
  name: 'query_entity',
  description:
    "Read the caller's own rows from a whitelisted entity. RLS-scoped; row-capped; read-only.",
  inputSchema: QUERY_ENTITY_SCHEMA,
  surfaces: ['agent'],
  confirm: false,
  run: (input: unknown, ctx: DeputyContext) => runQueryEntity(input, ctx),
};
