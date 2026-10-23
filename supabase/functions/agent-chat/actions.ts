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
import type { AgentAction, DeputyContext, ReadQueryBuilder, SupabaseLikeWithWrites } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';
import { resolveAgentEntity } from './entityCatalog.ts';
import {
  QUERY_ENTITY_SCHEMA,
  CREATE_ACTIVITY_SCHEMA,
  UPDATE_TASK_STATUS_SCHEMA,
  COMPOSE_VIEW_INPUT_SCHEMA,
  NOTIFY_SCHEMA,
  CREATE_AUTOMATION_SCHEMA,
  ASK_USER_SCHEMA,
} from './schema.ts';
import { cronMatches } from '../agent-dispatch/cron.ts';
import { TRIGGER_SOURCES, isAllowedTriggerSource } from '../agent-dispatch/triggerSources.ts';
import { composeSpec, ComposeSpecError } from '../compose-view/composeSpec.ts';
import type { ModelClient } from '../_shared/modelClient.ts';
import type { CompositionSpec } from '../../../pmo-portal/src/lib/viewspec/types.ts';

// ── Constants (D5, D6) ────────────────────────────────────────────────────────

// AGENT_READ_ENTITIES / AgentReadEntity / AGENT_READ_ROW_CAP live in the leaf module readEntities.ts
// to break the actions.ts ↔ schema.ts cycle that TDZ-crashed the deployed worker (see its header).
// Imported for local use AND re-exported so existing importers (handler.ts, etc.) still resolve them
// from actions.ts without change.
import { AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP, AGENT_AGGREGATE_ROW_CAP, AGENT_AGGREGATE_PAGE_SIZE, AGENT_AGGREGATE_GROUP_CAP, AGENT_MONEY_READ_ENTITIES } from './readEntities.ts';
import { AGENT_MONEY_READ_ROLES } from '../../../pmo-portal/src/auth/agentRoles.ts';
import type { AgentReadEntity } from './readEntities.ts';
export { AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP };
export type { AgentReadEntity };

/** Wall-clock timeout for each DB read. D6. */
export const READ_TIMEOUT_MS = 5000;

/**
 * ADR-0051: money-value writes at/above this amount require an approval chip.
 * Server-side only; never client/model supplied.
 */
export const AGENT_APPROVAL_MONEY_THRESHOLD = 10_000;

/** ADR-0051 / FR-AT2-APR-005: destructive deletes always require the approval chip. */
export function isDestructiveDeleteAction(name: string): boolean {
  return name.startsWith('delete_') || name.endsWith('_delete');
}

// ── Validated input shape (runtime) ──────────────────────────────────────────

type QueryFilterOp = 'eq' | 'in' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte';
type QueryEntityResult =
  | { rowCount: number; rows: unknown[] }
  | { groups: Array<{ key: unknown; count: number; sum?: number }>; rowCount: number; truncated: boolean; groupsTruncated?: boolean; note?: string }
  | { error: string; code?: string; detail?: string };
interface QueryEntityFilter { column: string; op: QueryFilterOp; value: unknown }
interface QueryEntityInput {
  entity: string; columns?: string[]; filter?: QueryEntityFilter | QueryEntityFilter[]; limit?: number;
  order_by?: { column: string; direction: 'asc' | 'desc' }; group_by?: string; sum?: string; as?: 'table';
}

// ── runQueryEntity (the action logic, pure + DI) ──────────────────────────────

/**
 * Execute a whitelisted, row-capped read through the caller-JWT supabase client.
 * Returns a structured result (never throws to the handler).
 *
 * Validation is completed before opening the caller-JWT read: entity, columns/operators,
 * aggregate compatibility, and required scope are checked before any query is constructed.
 */
export async function runQueryEntity(input: unknown, ctx: DeputyContext): Promise<
  | { rowCount: number; rows: unknown[] }
  | { groups: Array<{ key: unknown; count: number; sum?: number }>; rowCount: number; truncated: boolean; groupsTruncated?: boolean; note?: string }
  | { error: string; code?: string; detail?: string }
> {
  const inp = input as QueryEntityInput;
  const entityKey = inp?.entity as AgentReadEntity;
  if (!(AGENT_READ_ENTITIES as readonly string[]).includes(entityKey)) return { error: `unknown entity: ${inp?.entity}` };
  const entry = resolveAgentEntity(entityKey);
  if (!entry) return { error: `unknown entity: ${inp?.entity}` };
  // Migration 0350: only the four money roles read bills and payments. Say so rather than return RLS's empty list,
  // which the model would report as "there are none". An unknown role is refused too (allow-list).
  if (AGENT_MONEY_READ_ENTITIES.has(entityKey) && !AGENT_MONEY_READ_ROLES.includes(ctx.role ?? '')) {
    return { error: `${entityKey} is not available for your role`, code: 'NOT_AVAILABLE_FOR_ROLE' };
  }
  const filters = inp.filter === undefined
    ? []
    : Array.isArray(inp.filter) ? inp.filter : [inp.filter];
  if (filters.length > 3 || (Array.isArray(inp.filter) && filters.length === 0)) {
    return { error: 'filter must contain 1 to 3 filters' };
  }

  // Column whitelists keep untrusted model-selected names out of the PostgREST query.
  const requestedCols = inp.columns ?? [...entry.allowedColumns];
  for (const column of requestedCols) {
    if (!entry.allowedColumns.has(column)) return { error: `unknown column: ${column} on entity ${entityKey}` };
  }

  const validOps: QueryFilterOp[] = ['eq', 'in', 'neq', 'lt', 'lte', 'gt', 'gte'];
  for (const filter of filters) {
    if (!filter || !entry.allowedColumns.has(filter.column)) {
      return { error: `unknown filter column: ${filter?.column} on entity ${entityKey}` };
    }
    if (!validOps.includes(filter.op)) return { error: `unsupported filter op: ${filter.op}` };
    if (filter.op === 'in') {
      if (!Array.isArray(filter.value) || !filter.value.length) {
        return { error: 'in filter value must be a non-empty array' };
      }
    } else if (filter.op === 'eq') {
      if (filter.value === null || filter.value === undefined || typeof filter.value === 'object') {
        return { error: 'filter value must be scalar' };
      }
    } else if (!(typeof filter.value === 'number' && Number.isFinite(filter.value)) &&
      !(typeof filter.value === 'string' && filter.value.trim())) {
      return { error: 'comparison value must be a finite number or non-empty date string' };
    }
  }

  if (inp.order_by && (!entry.allowedColumns.has(inp.order_by.column) || !['asc', 'desc'].includes(inp.order_by.direction))) {
    return { error: 'invalid order_by column or direction' };
  }
  if (inp.group_by && !entry.allowedColumns.has(inp.group_by)) {
    return { error: `unknown group_by column: ${inp.group_by}` };
  }
  if (inp.group_by && entry.groupableColumns && !entry.groupableColumns.has(inp.group_by)) {
    return { error: `column is not groupable: ${inp.group_by}` };
  }
  if (inp.sum && !entry.allowedColumns.has(inp.sum)) return { error: `unknown sum column: ${inp.sum}` };
  if (inp.sum && !entry.numericColumns.has(inp.sum)) return { error: `sum column is not numeric: ${inp.sum}` };
  if (inp.sum && !inp.group_by) return { error: 'sum requires group_by' };
  if (entry.requiredFilter && !filters.some((filter) =>
    filter.column === entry.requiredFilter && ['eq', 'in'].includes(filter.op))) {
    return { error: `entity ${entityKey} requires a filter on column ${entry.requiredFilter}` };
  }

  const aggregate = Boolean(inp.group_by);
  const projection = aggregate ? [...new Set(['id', inp.group_by!, ...(inp.sum ? [inp.sum] : [])])] : requestedCols;
  const groups = new Map<unknown, { key: unknown; count: number; sum?: number; hasSumValue?: boolean }>();
  let rowCount = 0, offset = 0, truncated = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error('query_entity read timeout')); }, READ_TIMEOUT_MS); });
  const query = async (): Promise<QueryEntityResult> => {
    do {
      const size = aggregate
        ? Math.min(AGENT_AGGREGATE_PAGE_SIZE, AGENT_AGGREGATE_ROW_CAP - rowCount)
        : Math.min(inp.limit ?? AGENT_READ_ROW_CAP, AGENT_READ_ROW_CAP);
      let q: ReadQueryBuilder = ctx.supabase.from(entry.table).select(projection.join(','));
      for (const internalFilter of entry.internalFilters ?? []) {
        q = q.is(internalFilter.column, internalFilter.value);
      }
      for (const filter of filters) {
        if (filter.op === 'in') q = q.in(filter.column, (filter.value as unknown[]).map(String));
        else q = q[filter.op](filter.column, filter.value as string | number);
      }
      if (inp.order_by) {
        q = q.order(inp.order_by.column, { ascending: inp.order_by.direction === 'asc' });
      }
      if (aggregate) q = q.order('id', { ascending: true });
      const result = await (aggregate
        ? q.range(offset, offset + size - 1)
        : q.limit(size));
      if (result.error) {
        const error = result.error as { code?: string; message?: string };
        return {
          error: 'query_entity db error',
          ...(error.code ? { code: error.code } : {}),
          ...(error.message ? { detail: error.message } : {}),
        };
      }
      const rows = result.data ?? [];
      if (!aggregate) return { rowCount: rows.length, rows };
      for (const value of rows) {
        const row = value as Record<string, unknown>, key = row[inp.group_by!];
        let group = groups.get(key);
        if (!group) { group = { key, count: 0, ...(inp.sum ? { sum: 0, hasSumValue: false } : {}) }; groups.set(key, group); }
        group.count++;
        if (inp.sum && row[inp.sum] !== null) {
          const v = row[inp.sum], n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
          if (!Number.isFinite(n) || !Number.isFinite((group.sum ?? 0) + n)) return { error: `non-numeric value in sum column: ${inp.sum}` };
          group.sum = (group.sum ?? 0) + n;
          group.hasSumValue = true;
        }
      }
      rowCount += rows.length; offset += rows.length;
      if (rowCount >= AGENT_AGGREGATE_ROW_CAP) { truncated = true; break; }
      if (rows.length === 0) break;
    } while (aggregate && !timedOut);
    const rankedGroups = [...groups.values()].map(({ hasSumValue, ...group }) => {
      if (inp.sum && hasSumValue) group.sum = Math.round((group.sum ?? 0) * 100) / 100;
      else if (inp.sum) delete group.sum;
      return group;
    });
    const groupsTruncated = rankedGroups.length > AGENT_AGGREGATE_GROUP_CAP;
    rankedGroups.sort((a, b) => inp.sum
      ? (b.sum ?? -Infinity) - (a.sum ?? -Infinity) || b.count - a.count
      : b.count - a.count);
    const resultGroups = rankedGroups.slice(0, AGENT_AGGREGATE_GROUP_CAP);
    const notes = [
      ...(truncated ? [`Totals are partial: query_entity aggregated the first ${AGENT_AGGREGATE_ROW_CAP} matching caller-visible rows.`] : []),
      ...(groupsTruncated ? [`Only the ${AGENT_AGGREGATE_GROUP_CAP} largest groups are returned.`] : []),
    ];
    return aggregate ? {
      groups: resultGroups,
      rowCount,
      truncated,
      ...(groupsTruncated ? { groupsTruncated: true } : {}),
      ...(notes.length ? { note: notes.join(' ') } : {}),
    } : { rowCount: 0, rows: [] };
  };
  try { return await Promise.race([query(), timeout]); }
  catch (e) { return { error: e instanceof Error ? e.message : 'query_entity read failed' }; }
  finally { if (timer !== undefined) clearTimeout(timer); }
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
  description: "Advance a task's status. Requires user approval; RLS restricts engineers and finance to their own tasks.",
  inputSchema: UPDATE_TASK_STATUS_SCHEMA,
  surfaces: ['agent'],
  confirm: true,
  needsApproval: () => false,
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

// ── notify action (ADR-0044 §5, FR-AAN-026/027/028) ───────────────────────────

export interface NotifyInput {
  title: string;
  body?: string;
  severity?: 'info' | 'warning' | 'critical';
  metadata?: Record<string, unknown>;
}

export const notifyAction: AgentAction = {
  name: 'notify',
  description:
    "Create an in-app notification for the caller's own inbox. Not a business write — no approval needed.",
  inputSchema: NOTIFY_SCHEMA,
  surfaces: ['agent'],
  confirm: false,
  run: async (input: unknown, ctx: DeputyContext) => {
    const i = input as Partial<NotifyInput>;
    if (typeof i?.title !== 'string' || !i.title) {
      return { error: 'title is required' };
    }
    // Cast: see the write-action comment on createActivityAction — DeputyContext.supabase is
    // read-only typed; the real caller-JWT (or minted-owner-JWT, background path) client always
    // supports insert (NFR-AW-SEC-002).
    const sb = ctx.supabase as SupabaseLikeWithWrites;
    // Never sends owner_id/org_id (FR-AAN-027) — RLS column DEFAULTs (owner_id default
    // auth.uid(), org_id default seed-org) pin the row to the CALLING identity's own uid,
    // whether that identity is an interactive caller JWT or a minted owner JWT (background
    // automation run) — v1 has no cross-user notify path (ADR-0044 §5).
    const { error } = await sb
      .from('notifications')
      .insert({
        title: i.title,
        body: i.body ?? null,
        severity: i.severity ?? 'info',
        metadata: i.metadata ?? null,
      })
      .select()
      .single();
    if (error) return { error: 'notify db error', code: (error as { code?: string }).code };
    return { ok: true };
  },
};

// ── create_automation action (ADR-0044 §1, FR-AAN-029/030/031) ────────────────

export interface CreateAutomationInput {
  kind: 'schedule' | 'trigger';
  prompt: string;
  schedule?: string;
  trigger_on?: { source: string; event: string };
  condition?: string;
  timeout_s?: number;
}

/**
 * Structural cron validity — the 5-field-count + per-field grammar `cronMatches` (the Phase B
 * dispatcher cron module, `supabase/functions/agent-dispatch/cron.ts`) itself parses (`*`,
 * `N`, `N-M`, `N/M`, comma lists). `cronMatches(expr, at)` never throws on malformed input — it
 * fails closed to `false` for ANY input, so it alone cannot distinguish "malformed expression"
 * from "syntactically valid but doesn't match this instant." The field-count + character-class
 * regex below is the actual structural gate (the sole source of truth for "is this syntactically
 * a valid cron string"); `cronMatches` is run ONCE, against `new Date()`, purely as a defense-in-
 * depth smoke check that it does not throw for a structurally-valid expression — its return value
 * (true/false for THIS instant) is deliberately NOT part of the accept/reject decision, since a
 * syntactically valid expression can legitimately not match the current moment.
 */
function isValidCronExpression(expr: string): boolean {
  if (typeof expr !== 'string' || !expr.trim()) return false;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const fieldRe = /^(\*(\/\d+)?|\d+(-\d+)?(\/\d+)?)(,(\*(\/\d+)?|\d+(-\d+)?(\/\d+)?))*$/;
  if (!parts.every((p) => fieldRe.test(p))) return false;
  // Defense-in-depth: cronMatches must not throw for a structurally valid expression (it never
  // throws by contract, but this guards against a future contract change silently regressing).
  // Its boolean result is intentionally ignored — see the doc comment above.
  try {
    cronMatches(expr, new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Restrict schedules to the three shapes we support + verify (owner directive 2026-07-09): daily,
 * weekly, and day-of-month — each at a specific hour, minute 0. The dispatcher tick runs HOURLY
 * (migration 0082, `0 * * * *`), so only minute-0 schedules ever fire; coarse cadence also keeps the
 * feature simple and quota-lean. Rejects per-minute / hourly-wildcard / ranges / lists / steps.
 *   daily        : 0 H * * *   (H = 0-23)
 *   weekly       : 0 H * * D    (D = 0-6, Sun..Sat)
 *   day-of-month : 0 H DOM * *  (DOM = 1-31)
 */
function isAllowedScheduleShape(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, month, dow] = parts;
  const inRange = (s: string, lo: number, hi: number) => /^\d+$/.test(s) && Number(s) >= lo && Number(s) <= hi;
  if (min !== '0') return false; // top of the hour only (the tick is hourly)
  if (!inRange(hour, 0, 23)) return false; // a single specific hour
  if (month !== '*') return false; // every month
  const daily = dom === '*' && dow === '*';
  const weekly = dom === '*' && inRange(dow, 0, 6);
  const dayOfMonth = inRange(dom, 1, 31) && dow === '*';
  return daily || weekly || dayOfMonth;
}

function validateCreateAutomation(
  input: unknown,
): { ok: true; value: CreateAutomationInput } | { ok: false; error: string } {
  const i = input as Partial<CreateAutomationInput>;
  if (typeof i?.kind !== 'string' || (i.kind !== 'schedule' && i.kind !== 'trigger')) {
    return { ok: false, error: "kind must be 'schedule' or 'trigger'" };
  }
  if (typeof i?.prompt !== 'string' || !i.prompt) {
    return { ok: false, error: 'prompt is required' };
  }
  // AUDIT-M1: mirrors migration 0059's agent_automations_prompt_len CHECK (DB is the authority).
  if (i.prompt.length > 4000) {
    return { ok: false, error: 'prompt must be 4000 characters or fewer' };
  }
  if (i.kind === 'schedule') {
    if (typeof i.schedule !== 'string' || !i.schedule.trim()) {
      return { ok: false, error: "schedule is required when kind='schedule'" };
    }
    if (!isValidCronExpression(i.schedule)) {
      return { ok: false, error: `invalid cron expression: ${i.schedule}` };
    }
    if (!isAllowedScheduleShape(i.schedule)) {
      return {
        ok: false,
        error:
          'schedule must be daily, weekly, or day-of-month at a specific hour — e.g. "0 9 * * *" (daily 9am), "0 9 * * 1" (Mondays 9am), or "0 9 1 * *" (the 1st at 9am). Sub-daily/hourly schedules are not supported.',
      };
    }
  }
  if (i.kind === 'trigger') {
    if (
      !i.trigger_on ||
      typeof i.trigger_on !== 'object' ||
      typeof i.trigger_on.source !== 'string' ||
      !i.trigger_on.source ||
      typeof i.trigger_on.event !== 'string' ||
      !i.trigger_on.event
    ) {
      return { ok: false, error: "trigger_on requires source and event when kind='trigger'" };
    }
    // SECURITY HIGH-1: trigger_on.source is user-authored input that ultimately reaches
    // serviceClient.from(source) in the dispatcher's selection query — allowlist it here (layer 1
    // of 2; layer 2 is the dispatcher's own hard-gate in dispatcher.ts/watermark.ts).
    if (!isAllowedTriggerSource(i.trigger_on.source)) {
      return { ok: false, error: `trigger_on.source must be one of: ${TRIGGER_SOURCES.join(', ')}` };
    }
  }
  // AUDIT-M1: mirrors migration 0059's agent_automations_timeout_bounds CHECK ([10, 900]).
  if (i.timeout_s !== undefined && (typeof i.timeout_s !== 'number' || i.timeout_s < 10 || i.timeout_s > 900)) {
    return { ok: false, error: 'timeout_s must be between 10 and 900 seconds' };
  }
  return { ok: true, value: i as CreateAutomationInput };
}

export const createAutomationAction: AgentAction & {
  validate: (input: unknown) => { ok: true; value: CreateAutomationInput } | { ok: false; error: string };
  summarize: (input: CreateAutomationInput) => string;
} = {
  name: 'create_automation',
  description:
    'Create a scheduled or event-triggered automation that fires the agent with a prompt. Requires user approval.',
  inputSchema: CREATE_AUTOMATION_SCHEMA,
  surfaces: ['agent'],
  confirm: true,
  validate: validateCreateAutomation,
  summarize: (i) =>
    `Watch: ${i.prompt} (${i.kind === 'schedule' ? `on schedule ${i.schedule}` : `when ${i.trigger_on?.event}`})`,
  run: async (input: unknown, ctx: DeputyContext) => {
    const v = validateCreateAutomation(input);
    if (v.ok === false) return { error: v.error };
    // Cast: see the write-action comment on createActivityAction.
    const sb = ctx.supabase as SupabaseLikeWithWrites;
    const { kind, prompt, schedule, trigger_on, condition, timeout_s } = v.value;
    // Never sends owner_id/org_id (mirrors create_activity/update_task_status) — RLS column
    // DEFAULTs pin the row to the caller's own uid; writes ALWAYS go via dispatchActionForced
    // under the caller JWT, never service_role (FR-AAN-031).
    const { data, error } = await sb
      .from('agent_automations')
      .insert({
        kind,
        prompt,
        schedule: schedule ?? null,
        trigger_on: trigger_on ?? null,
        condition: condition ?? null,
        timeout_s: timeout_s ?? 120,
      })
      .select()
      .single();
    if (error) return { error: 'create_automation db error', code: (error as { code?: string }).code };
    return { id: (data as { id?: string }).id };
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

// ── ask_user action (ADR-0045 §2) ─────────────────────────────────────────────
// Guard stub — the handler NEVER calls this via dispatchAction; runToolLoop
// special-cases `toolName === 'ask_user'` and emits a status{kind:'question'}
// event, ending the stream (same shape as the A3 propose branch).

export const askUserAction: AgentAction = {
  name: 'ask_user',
  description:
    'Ask the user a structured clarifying question with tappable options (and optionally a free-text box) when their request is ambiguous.',
  inputSchema: ASK_USER_SCHEMA,
  surfaces: ['agent'],
  confirm: false,
  run: () => {
    throw new Error(
      'ask_user is dispatched by the handler directly (ADR-0045 §2); never call run() directly',
    );
  },
};
