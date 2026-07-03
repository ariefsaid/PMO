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
import type { AgentAction, DeputyContext, SupabaseLikeWithWrites } from '../../../pmo-portal/src/lib/agent/runtime/port';
import { QUERY_ENTITY_SCHEMA, CREATE_ACTIVITY_SCHEMA, UPDATE_TASK_STATUS_SCHEMA, COMPOSE_VIEW_INPUT_SCHEMA } from './schema';
import { composeSpec, ComposeSpecError } from '../compose-view/composeSpec';
import type { ModelClient } from '../_shared/modelClient';
import type { CompositionSpec } from '../../../pmo-portal/src/lib/viewspec/types';

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

  // ── Step 3: filter column whitelist check (Blocker 6 / NFR-AR-SEC-004) ──────
  // The SELECT projection is whitelisted in step 2. The FILTER column must also
  // be in allowedColumns — otherwise a prompt-injected tool call could filter on
  // any real column of the table (including intentionally excluded ones) and use
  // the result rowCount as a boolean oracle to probe hidden values.
  if (inp.filter && !entry.allowedColumns.has(inp.filter.column)) {
    return { error: `unknown filter column: ${inp.filter.column} on entity ${entityKey}` };
  }

  // ── Step 4: requiredFilter check (R3 / built for A3) ─────────────────────
  if (
    entry.requiredFilter &&
    (!inp.filter || inp.filter.column !== entry.requiredFilter)
  ) {
    return {
      error: `entity ${entityKey} requires a filter on column ${entry.requiredFilter}`,
    };
  }

  // ── Step 5: build the query (AC-AR-007, AC-AR-008) ───────────────────────
  const effLimit = Math.min(inp.limit ?? AGENT_READ_ROW_CAP, AGENT_READ_ROW_CAP);
  const colsStr = requestedCols.join(',');
  const builder = ctx.supabase.from(entry.table).select(colsStr);

  let query: PromiseLike<{ data: unknown[] | null; error: unknown }>;

  if (inp.filter) {
    const { column, op, value } = inp.filter;
    if (op === 'eq') {
      query = builder.eq(column, String(value)).limit(effLimit);
    } else if (op === 'in') {
      const vals = Array.isArray(value)
        ? value.map(String)
        : [String(value)];
      query = builder.in(column, vals).limit(effLimit);
    } else {
      return { error: `unsupported filter op: ${op}` };
    }
  } else {
    query = builder.limit(effLimit);
  }

  // ── Step 6: race against timeout (D6) ─────────────────────────────────────
  let result: { data: unknown[] | null; error: unknown };
  try {
    result = await Promise.race([
      // Cast to Promise since PromiseLike doesn't have .finally/.catch but is awaitable
      Promise.resolve(query),
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

// ── Write actions (A3) ────────────────────────────────────────────────────────

/** Map from the agent-facing lowercase kind to the DB title-case enum (R-A3-6). */
const ACTIVITY_KIND_MAP: Record<string, 'Call' | 'Email' | 'Meeting' | 'Note'> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note',
};

export interface CreateActivityInput {
  contactId: string;
  kind: keyof typeof ACTIVITY_KIND_MAP;
  subject: string;
  body?: string;
  occurredAt?: string;
}

function validateCreateActivity(
  input: unknown,
): { ok: true; value: CreateActivityInput } | { ok: false; error: string } {
  const i = input as Partial<CreateActivityInput>;
  if (typeof i?.contactId !== 'string' || !i.contactId)
    return { ok: false, error: 'contactId is required' };
  if (typeof i?.kind !== 'string' || !(i.kind in ACTIVITY_KIND_MAP))
    return { ok: false, error: 'kind must be call|email|meeting|note' };
  if (typeof i?.subject !== 'string' || !i.subject || i.subject.length > 200)
    return { ok: false, error: 'subject is required (max 200 chars)' };
  if (i.body !== undefined && (typeof i.body !== 'string' || i.body.length > 2000))
    return { ok: false, error: 'body must be a string (max 2000 chars)' };
  if (i.occurredAt !== undefined && typeof i.occurredAt !== 'string')
    return { ok: false, error: 'occurredAt must be an ISO-8601 string' };
  return { ok: true, value: i as CreateActivityInput };
}

export const createActivityAction: AgentAction & {
  validate: (input: unknown) => { ok: true; value: CreateActivityInput } | { ok: false; error: string };
  summarize: (input: CreateActivityInput) => string;
} = {
  name: 'create_activity',
  description: 'Log a CRM activity (call/email/meeting/note) on a contact. Requires user approval.',
  inputSchema: CREATE_ACTIVITY_SCHEMA,
  surfaces: ['agent'],
  confirm: true,
  validate: validateCreateActivity,
  summarize: (i) => `Log a ${i.kind} activity on contact ${i.contactId}: "${i.subject}"`,
  run: async (input: unknown, ctx: DeputyContext) => {
    const v = validateCreateActivity(input);
    if (v.ok === false) return { error: v.error };
    // Cast: DeputyContext.supabase is typed SupabaseLike (read-only, shared by all actions);
    // write actions need the extended SupabaseLikeWithWrites shape, which SupabaseLike is
    // structurally a strict subset of, so a single `as` (no `unknown` bridge) is sufficient —
    // the real caller-JWT client passed in at runtime always supports insert/update
    // (NFR-AW-SEC-002). DeputyContext itself is intentionally NOT widened to
    // SupabaseLikeWithWrites — that would leak write capability into read-only actions.
    const sb = ctx.supabase as SupabaseLikeWithWrites;
    const { contactId, kind, subject, body, occurredAt } = v.value;
    const { data, error } = await sb
      .from('crm_activities')
      .insert({
        contact_id: contactId,
        kind: ACTIVITY_KIND_MAP[kind],
        subject,
        body: body ?? null,
        occurred_at: occurredAt ?? new Date().toISOString(),
      })
      .select()
      .single();
    if (error) return { error: 'create_activity db error', code: (error as { code?: string }).code };
    return { id: (data as { id?: string }).id };
  },
};

const TASK_STATUSES = ['To Do', 'In Progress', 'Done', 'Blocked'] as const;
type TaskStatus = (typeof TASK_STATUSES)[number];

export interface UpdateTaskStatusInput {
  taskId: string;
  status: TaskStatus;
}

function validateUpdateTaskStatus(
  input: unknown,
): { ok: true; value: UpdateTaskStatusInput } | { ok: false; error: string } {
  const i = input as Partial<UpdateTaskStatusInput>;
  if (typeof i?.taskId !== 'string' || !i.taskId)
    return { ok: false, error: 'taskId is required' };
  if (
    typeof i?.status !== 'string' ||
    !(TASK_STATUSES as readonly string[]).includes(i.status)
  )
    return { ok: false, error: 'status must be one of To Do|In Progress|Done|Blocked' };
  return { ok: true, value: i as UpdateTaskStatusInput };
}

export const updateTaskStatusAction: AgentAction & {
  validate: (input: unknown) => { ok: true; value: UpdateTaskStatusInput } | { ok: false; error: string };
  summarize: (input: UpdateTaskStatusInput) => string;
} = {
  name: 'update_task_status',
  description: "Advance a task's status. Requires user approval; RLS restricts engineers to their own tasks.",
  inputSchema: UPDATE_TASK_STATUS_SCHEMA,
  surfaces: ['agent'],
  confirm: true,
  validate: validateUpdateTaskStatus,
  summarize: (i) => `Set task ${i.taskId} status to "${i.status}"`,
  run: async (input: unknown, ctx: DeputyContext) => {
    const v = validateUpdateTaskStatus(input);
    if (v.ok === false) return { error: v.error };
    // Cast: DeputyContext.supabase is typed SupabaseLike (read-only, shared by all actions);
    // write actions need the extended SupabaseLikeWithWrites shape, which SupabaseLike is
    // structurally a strict subset of, so a single `as` (no `unknown` bridge) is sufficient —
    // the real caller-JWT client passed in at runtime always supports insert/update
    // (NFR-AW-SEC-002). DeputyContext itself is intentionally NOT widened to
    // SupabaseLikeWithWrites — that would leak write capability into read-only actions.
    const sb = ctx.supabase as SupabaseLikeWithWrites;
    const { error } = await sb
      .from('tasks')
      .update({ status: v.value.status })
      .eq('id', v.value.taskId);
    if (error) return { error: 'update_task_status db error', code: (error as { code?: string }).code };
    return { taskId: v.value.taskId, status: v.value.status };
  },
};

// ── compose_view action (A4) ──────────────────────────────────────────────────
// ADR-0041: model-calling action seam. composeViewAction.run is a guard stub;
// the handler dispatches compose_view by calling runComposeView(input, ctx, {modelClient, model})
// directly, injecting the vendor-neutral model client as a typed ComposeActionDeps bag.

/** Extra deps for the model-calling compose action (ADR-0041). */
export interface ComposeActionDeps {
  /** The vendor-neutral model client, curried in by the handler at dispatch. */
  modelClient: ModelClient;
  /** The resolved model id for this call (FR-MC-015 / MC-OD-009). */
  model: string;
}

export type ComposeResult =
  | { spec: CompositionSpec; repairAttempts: number; tokensUsed: number; title: string }
  | { error: string; code: 'REPAIR_EXHAUSTED' | 'UPSTREAM_ERROR' };

/**
 * Derive a short, human-readable view title from the user's prompt (CV-OD-002).
 * Trims, capitalizes the first character, and truncates to ≤60 chars.
 * No model round-trip — the user's own words are the best view name.
 */
export function deriveTitle(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return '';
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return capitalized.slice(0, 60);
}

/**
 * Run the compose_view action with injected model-client deps (ADR-0041 / D1).
 * Called by the handler's dispatch branch with { modelClient: deps.modelClient, model: deps.model }.
 * Returns a structured result (never throws to the handler).
 */
export async function runComposeView(
  input: { prompt: string },
  ctx: DeputyContext,
  deps: ComposeActionDeps,
): Promise<ComposeResult> {
  try {
    const { spec, repairAttempts, tokensUsed } = await composeSpec(
      input.prompt,
      ctx.orgId,
      { modelClient: deps.modelClient, userId: ctx.userId, model: deps.model },
    );
    return { spec, repairAttempts, tokensUsed, title: deriveTitle(input.prompt) };
  } catch (e) {
    const code =
      e instanceof ComposeSpecError ? e.code : 'UPSTREAM_ERROR';
    return { error: 'compose failed', code };
  }
}

/**
 * composeViewAction — the catalog entry for the compose_view tool (FR-CV-001).
 *
 * - name: 'compose_view'
 * - inputSchema: { prompt: string } (the ACTION tool input — what the model fills)
 * - surfaces: ['agent']
 * - confirm: false (composing a spec is non-destructive; Save is the user-dispose gate)
 * - run: guard stub — the handler NEVER calls this via dispatchAction; it calls
 *        runComposeView(input, ctx, {modelClient, model}) directly (ADR-0041 model-calling seam).
 */
export const composeViewAction: AgentAction = {
  name: 'compose_view',
  description: "Compose a validated dashboard view from the user's natural-language request.",
  inputSchema: COMPOSE_VIEW_INPUT_SCHEMA,
  surfaces: ['agent'],
  confirm: false,
  run: () => {
    throw new Error(
      'compose_view is dispatched by the handler with injected modelClient deps (ADR-0041); never call run() directly',
    );
  },
};
