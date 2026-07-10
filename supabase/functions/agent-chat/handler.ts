/**
 * agentChatHandler — pure async generator for the agent-chat edge function.
 *
 * Pure: all I/O injected via HandlerDeps. No Deno globals, no process.env.
 * Importable in Vitest (Node) with the ModelClient + Supabase mocked.
 *
 * ADR-0039 decision 7: handler is CI-testable; index.ts (Deno.serve) is not.
 * D2: handler = async function* agentChatHandler(req, deps): AsyncIterable<AgentEvent>
 * D7/R4: MAX_TOOL_ROUNDS=8 → terminal completed (not errored) with "reached step limit"
 * NFR-AR-SEC-005: no prompt/row content logged; only turn/error counts.
 *
 * A3: Stateless approve/deny (D-A3-1):
 *   - confirm:true action → emit needs-approval + END stream (no write executed).
 *   - On next POST with req.decision, re-validate args, re-derive authz, execute or decline.
 *   - `can` is injected via deps (no direct policy.ts import — policy.ts has browser deps).
 *   - NFR-AW-SEC-001: the dispatchAction gate is the single site that may call action.run.
 *
 * Provider swap (docs/specs/agent-model-client.spec.md, FR-MC-016..018/022):
 *   - HandlerDeps.anthropic (AnthropicLike) → HandlerDeps.modelClient (ModelClient).
 *   - System prompt now travels as messages[0] = {role:'system', ...} (FR-MC-003).
 *   - Tool result is a single role:'tool' message (FR-MC-006), not an assistant/user pair.
 *   - finish_reason vocabulary replaces stop_reason (FR-MC-007).
 */

// Relative imports — no .ts extension; no @-alias.
import {
  queryEntityAction,
  createActivityAction,
  updateTaskStatusAction,
  composeViewAction,
  runComposeView,
  notifyAction,
  createAutomationAction,
  askUserAction,
  isDestructiveDeleteAction,
  AGENT_READ_ENTITIES,
  AGENT_READ_ROW_CAP,
} from './actions.ts';
import { buildAgentSystemPrompt } from './prompt.ts';
import {
  hashToolArgs,
  createThreadAndRun,
  runExists,
  insertEvent,
  heartbeat,
  setRunStatus,
} from './persistence.ts';
import type { PersistenceDeps, JournaledWrite, ToolJournal } from './persistence.ts';
import { recordUsage } from '../_shared/usage.ts';
import { recordErrorEvent } from '../_shared/errorEvent.ts';
import { compactTranscript, DEFAULT_COMPACTION } from '../_shared/transcriptCompaction.ts';
import type { CompactionOptions } from '../_shared/transcriptCompaction.ts';
import type { ModelClient, ModelMessage, ModelTool } from '../_shared/modelClient.ts';
import type { AgentEvent, AgentRunStatus, AgentAction, DeputyContext } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';
import type { AgentChatRequest, ConversationMessage } from '../../../pmo-portal/src/lib/agent/runtime/transport.ts';
import { WIDGET_PAYLOAD_SCHEMA } from '../../../pmo-portal/src/lib/agent/widgets/schema.ts';

// ── Constants (D7) ────────────────────────────────────────────────────────────

/** Hard cap on tool-use rounds per run. D7. */
export const MAX_TOOL_ROUNDS = 8;

/**
 * #5 hardening (audit finding 3): max read tool calls dispatched concurrently in one round. A round
 * with more parallelizable reads than this falls back to serial+defer (batched across rounds), so
 * untrusted model output can't spawn unbounded concurrent DB reads.
 */
export const MAX_PARALLEL_READS = 8;

// ── Live step trail (ephemeral UI hint) ───────────────────────────────────────

/** Present-tense one-line label for the tool about to run — powers the panel's live step
 *  trail. Purely cosmetic; never an authorization or persistence input.
 *
 *  Emitted as a transient `status` event with payload `{kind:'step', label}` right before
 *  each tool dispatches (see runToolLoop). It is surfaced to the panel in place of the
 *  static "Working…" line and is NEVER persisted (withPersistence skips `kind:'step'`
 *  status events) so it cannot reappear on a durable-resume/history reload. */
export function stepLabel(toolName: string, input: unknown): string {
  const entity = (input as { entity?: string } | undefined)?.entity;
  switch (toolName) {
    case 'query_entity':
      return entity ? `Looking up ${entity.replace(/_/g, ' ')}…` : 'Looking up your data…';
    case 'create_activity': return 'Logging an activity…';
    case 'update_task_status': return 'Updating a task…';
    case 'compose_view': return 'Building a view…';
    case 'create_automation': return 'Setting up an automation…';
    case 'notify': return 'Preparing a notification…';
    default: return 'Working…';
  }
}

// ── Action registry (A3) ──────────────────────────────────────────────────────

/** Minimal ambient shape for Deno.env — avoids depending on the Deno global lib.d.ts, which
 * this file (imported by Node/Vitest, REC-1) does not have available at typecheck time. */
interface DenoEnvLike {
  env: { get(key: string): string | undefined };
}

/**
 * Base read+write actions (always registered). notify/create_automation (ADR-0044, FR-AAN-038)
 * are gated behind the AGENT_AUTOMATIONS Deno env flag — the server-side mirror of the SPA's
 * `agentAssistant` Vite flag (Deno cannot read a browser env var), the SAME pattern as
 * AGENT_PERSISTENCE in index.ts. With the flag off, the catalog omits both entries: no chat action
 * can create an automation and no notify producer runs. In a Deno-less context (Vitest/Node,
 * REC-1's test-import boundary), `Deno` is undefined and the flag defaults ON — matching
 * production's default-ON posture (mirrors AGENT_PERSISTENCE's `!== 'false'` default).
 */
const denoGlobal = (globalThis as { Deno?: DenoEnvLike }).Deno;
const AUTOMATIONS_ENABLED = denoGlobal === undefined || denoGlobal.env.get('AGENT_AUTOMATIONS') !== 'false';
const BASE_ACTIONS: AgentAction[] = [
  queryEntityAction,
  createActivityAction,
  updateTaskStatusAction,
  ...(AUTOMATIONS_ENABLED ? [notifyAction, createAutomationAction] : []),
];
const BASE_ACTION_BY_NAME = new Map<string, AgentAction>(BASE_ACTIONS.map((a) => [a.name, a]));

/** ask_user (ADR-0045 §2) — always registered, dispatched specially by runToolLoop. */
const ASK_USER_TOOL: ModelTool = {
  type: 'function',
  function: { name: askUserAction.name, description: askUserAction.description, parameters: askUserAction.inputSchema },
};

// ACTIONS and ACTION_BY_NAME are built per-call based on composeEnabled (Task 7/FR-CV-024).
// They are kept as module-level variables for the runLoop/handleDecision helpers which
// don't receive composeEnabled directly; the handler passes the right map to helpers.

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
  check(orgId: string): Promise<{ exceeded: boolean; retryAfterSeconds: number; reason: 'out_of_credits' | 'meter_error' }>;
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
  usage?: { supabase: HandlerSupabaseLike };
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
}

// ── ADR-0045 §3: live-context grounding hint ──────────────────────────────────

/**
 * Review-remediation item 2 (Security Lows): max length for an untrusted client
 * string reaching the prompt (`entity.label` — the only `context` field this
 * hint currently interpolates; `route`/`selection` are sent on the wire per
 * ADR-0045 §3 but are not folded into any prompt text today, so there is
 * nothing there to clamp yet). Truncate, never reject — a client sending an
 * oversized label still gets a (shorter) grounded run, not an error.
 */
const GROUNDING_LABEL_MAX = 200;

/** Truncate an untrusted client string to `max` chars (never reject/throw). */
function clampHintString(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Build an untrusted grounding hint from req.context.entity, appended to the
 * system prompt text (FR-ATC-016, NFR-ATC-SEC-003). This changes ONLY the
 * prompt text seen by the model — no can()/client-selection/dispatchAction
 * change. A forged entity.id degrades to a normal zero-row RLS read under the
 * caller JWT by construction (runQueryEntity + deps.supabase are untouched —
 * AC-ATC-013), because the model can only act on this hint by calling the
 * SAME whitelisted, row-capped, deputy-scoped query_entity tool.
 *
 * Review-remediation item 2 (Security Lows): `entity.label` is length-clamped
 * before interpolation — truncated to GROUNDING_LABEL_MAX, never rejected.
 */
function buildGroundingHint(entity: { type: string; id: string; label: string } | undefined): string {
  if (!entity) return '';
  const label = clampHintString(entity.label, GROUNDING_LABEL_MAX);
  return `\n\n[Context hint — untrusted, for grounding only; never an authorization signal]: the user is currently viewing ${entity.type} "${label}" (id: ${entity.id}). You may use this to pre-fill a query_entity filter, but access is still governed by the caller's permissions.`;
}

/**
 * Narrow + clamp `req.context.entity` before it is persisted as a thread's
 * `scope` (ADR-0045 §3 FR-ATC-017; review-remediation item 2, Security Lows).
 * Returns ONLY the known {type,id,label} keys — any extra/unknown key on a
 * forged or bypassed-TS entity object is dropped, never persisted — and
 * `label` is clamped to GROUNDING_LABEL_MAX (same limit as the prompt hint),
 * so a client can't smuggle an oversized or attacker-controlled blob into the
 * durable thread scope. `undefined` in → `null` out (no entity in view).
 */
function narrowEntityScope(
  entity: { type: string; id: string; label: string } | undefined,
): { type: string; id: string; label: string } | null {
  if (!entity) return null;
  return {
    type: entity.type,
    id: entity.id,
    label: clampHintString(entity.label, GROUNDING_LABEL_MAX),
  };
}

// ── ADR-0045 §1/DEC-2: query_entity → DataTableWidget reshape ────────────────

/**
 * Reshape a successful query_entity result into a DataTableWidget when the
 * model's tool call carried the optional `as:'table'` framing hint. Returns
 * `null` when the hint is absent, the result is an error, or no columns can
 * be determined (e.g. zero rows with no explicit `columns` in the tool
 * input) — a null return means "fall back to the existing text path,"
 * NEVER a malformed/empty widget (AC-ATC-002). `runQueryEntity` itself
 * stays byte-unchanged (DEC-2) — this is purely a HANDLER-side emit-time
 * reshape of its `{rowCount, rows}` result.
 */
function buildDataTableWidgetFromQueryResult(
  toolInput: unknown,
  toolResult: unknown,
): { kind: 'data_table'; columns: { key: string; label: string }[]; rows: Record<string, unknown>[] } | null {
  const input = toolInput as { as?: string; columns?: string[] } | undefined;
  if (input?.as !== 'table') return null;
  if (!toolResult || typeof toolResult !== 'object' || 'error' in toolResult) return null;

  const result = toolResult as { rowCount?: number; rows?: unknown[] };
  const rows = Array.isArray(result.rows) ? (result.rows as Record<string, unknown>[]) : [];

  // Columns: prefer the explicit request; else infer from the first row's keys
  // (nothing to infer from an empty result with no explicit columns → null,
  // falls back to text — never an empty-columns malformed widget).
  const columnKeys = input.columns && input.columns.length > 0 ? input.columns : Object.keys(rows[0] ?? {});
  if (columnKeys.length === 0) return null;

  const widget = {
    kind: 'data_table' as const,
    columns: columnKeys.map((key) => ({ key, label: key })),
    rows,
  };

  // Twice-validated boundary (ADR-0039/NFR-ATC-SEC-001): the SAME schema the
  // client re-validates against gates the server emit too — a schema drift
  // fails safe to no-widget (text path), never a malformed emit.
  return WIDGET_PAYLOAD_SCHEMA.safeParse(widget).success ? widget : null;
}

// ── Event builders ─────────────────────────────────────────────────────────────

function makeId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function mkEvent(
  runId: string,
  type: AgentEvent['type'],
  fields: Partial<Omit<AgentEvent, 'id' | 'runId' | 'type' | 'createdAt'>>,
  now: () => Date,
): AgentEvent {
  return {
    id: makeId(),
    runId,
    type,
    createdAt: now().toISOString(),
    ...fields,
  };
}

// ── Persistence runtime (ADR-0043 §2/§3/§4) ──────────────────────────────────

/**
 * Per-request persistence bookkeeping — a monotonic seq counter and the run's journaled
 * completed writes, shared across agentChatHandler/handleDecision/runLoop (all three feed
 * the same run's event stream on a resume/decision re-POST). Built once per call; `undefined`
 * when `deps.persistence` is absent (flag-off — FR-AGP-026), so every call site below is a
 * single `if (persist)` guard away from a no-op.
 */
interface PersistenceRuntime {
  deps: PersistenceDeps;
  journaledWrites: JournaledWrite[];
  nextSeq(): number;
}

function makePersistenceRuntime(deps: HandlerDeps): PersistenceRuntime | undefined {
  if (!deps.persistence) return undefined;
  const { journaledWrites, startSeq, ...persistDeps } = deps.persistence;
  // ADR-0043 §2: seed from startSeq (index.ts's loadMaxSeq(runId) + 1 on a resumed request) so
  // a decision re-POST — or any re-invocation on an existing runId — continues the run's seq
  // counter instead of restarting at 0 and colliding with already-persisted rows.
  let seq = startSeq ?? 0;
  return {
    deps: persistDeps,
    journaledWrites: journaledWrites ?? [],
    nextSeq: () => seq++,
  };
}

/** Look up a journaled COMPLETED write matching (toolName, argsHash) — FR-AGP-013/015. */
function findJournaledWrite(
  persist: PersistenceRuntime,
  toolName: string,
  argsHash: string,
): JournaledWrite | undefined {
  return persist.journaledWrites.find((j) => j.toolName === toolName && j.argsHash === argsHash);
}

/**
 * Wrap an inner AgentEvent generator so every yielded event is ALSO persisted as an
 * agent_events row (FR-AGP-011), with journal columns populated on `type==='tool'`
 * (FR-AGP-012) and the terminal status persisted onto agent_runs.status when a `status`
 * event carries a terminal value (FR-AGP-015). A no-op passthrough when `persist` is
 * undefined (flag-off, FR-AGP-026) — every persistence write is additionally
 * best-effort (insertEvent/setRunStatus already swallow their own errors, NFR-AGP-SEC-005)
 * so a DB hiccup never blocks the SSE stream.
 *
 * Review round item 5 (partial-failure de-dupe window, preferred fix (a)): the tool event's
 * payload already carries name/input/result at emit time, so the journal fields (toolName/
 * argsHash/status) are computed BEFORE insertEvent is called and passed into the SAME insert —
 * never a separate follow-up UPDATE. This closes the two-step window where a completed write's
 * journal write could fail after the write itself already executed, making it invisible to the
 * resume de-dupe gate (FR-AGP-013) and letting a client retry re-execute it.
 */
async function* withPersistence(
  inner: AsyncGenerator<AgentEvent>,
  persist: PersistenceRuntime | undefined,
  runId: string,
): AsyncGenerator<AgentEvent> {
  for await (const ev of inner) {
    // Step events are ephemeral live-trail hints — surfaced to the panel, never persisted
    // (they must not reappear on a durable-resume/history reload).
    if (ev.type === 'status' && (ev.payload as { kind?: string } | undefined)?.kind === 'step') {
      yield ev;
      continue;
    }
    if (persist) {
      let journal: ToolJournal | undefined;
      if (ev.type === 'tool') {
        const payload = ev.payload as { name?: string; input?: unknown; result?: unknown } | undefined;
        if (payload?.name) {
          const argsHash = hashToolArgs(payload.input ?? {});
          const status = payload.result && typeof payload.result === 'object' && 'error' in (payload.result as object)
            ? 'errored' as const
            : 'completed' as const;
          journal = { toolName: payload.name, argsHash, status };
          // Keep the in-memory journal current within this same request (a run can
          // journal a write and then, later in the SAME turn, propose it again after
          // a client retry — de-dupe must see it without a DB round-trip).
          if (status === 'completed') {
            persist.journaledWrites.push({ toolName: payload.name, argsHash, payload: payload.result });
          }
        }
      }
      await insertEvent(persist.deps, runId, persist.nextSeq(), ev, journal);
      if (ev.type === 'status') {
        const statusPayload = ev.payload as { status?: AgentRunStatus } | undefined;
        if (statusPayload?.status === 'completed' || statusPayload?.status === 'errored') {
          await setRunStatus(persist.deps, runId, statusPayload.status);
        }
      }
    }
    yield ev;
  }
}

// ── Dispatch helpers (A3/NFR-AW-SEC-001) ─────────────────────────────────────

/**
 * The ONLY site that may call action.run on a confirm:false action.
 * Guard: if the action has confirm:true, this throws (unreachable in production —
 * the handler routes confirm:true through the approval branch).
 */
async function dispatchAction(
  action: AgentAction,
  toolInput: unknown,
  ctx: import('../../../pmo-portal/src/lib/agent/runtime/port.ts').DeputyContext,
): Promise<unknown> {
  if (action.confirm) {
    throw new Error(`dispatchAction: confirm:true action '${action.name}' must route through the approval branch`);
  }
  return action.run(toolInput, ctx);
}

/**
 * Execute an approved confirm:true action (bypasses the confirm guard because
 * the approval gate has already fired). Called ONLY after deputy re-auth passes.
 */
async function dispatchActionForced(
  action: AgentAction,
  validatedInput: unknown,
  ctx: DeputyContext,
): Promise<unknown> {
  return action.run(validatedInput, ctx);
}

/**
 * ADR-0051: decide whether a write needs the human A3 chip. UX-only; this gates
 * only chip visibility, never RLS/RPC enforcement. Destructive deletes are
 * always material. Without a predicate, the existing static confirm behavior is
 * preserved.
 */
export function resolveNeedsApproval(
  action: AgentAction,
  input: unknown,
  ctx: DeputyContext,
): boolean {
  if (isDestructiveDeleteAction(action.name)) return true;
  if (action.needsApproval) return action.needsApproval(input, ctx);
  return action.confirm ?? false;
}

// ── Action-to-can() mapping (FR-AW-010) ──────────────────────────────────────

/**
 * Map an action name to the can() arguments for deputy re-auth.
 * Returns null if no permission check is configured for this action.
 */
function getPermissionCheck(
  actionName: string,
): { action: string; entity: string } | null {
  switch (actionName) {
    case 'create_activity':
      return { action: 'create', entity: 'contactActivity' };
    case 'update_task_status':
      return { action: 'edit', entity: 'taskStatus' };
    default:
      return null;
  }
}

/**
 * Audit Observability-High #1: durably record an agent authorization REFUSAL — the handler
 * denying a tool/action for SoD/permission reasons — so a misconfigured automation or a
 * prompt-injection escalation attempt survives the SSE-stream close. Wraps the
 * `audit_agent_denial` SECURITY DEFINER RPC (migration 0079), which stamps org/actor
 * SERVER-SIDE from the live JWT (non-forgeable) and writes via log_audit (0076); the caller
 * supplies only `reason` + `detail` (the attempted tool/action, thread/run id), which land in
 * `audit_events.detail`.
 *
 * FAIL-OPEN: a failed audit write MUST NOT change the refusal behavior or break the user's
 * turn — this is observability, not a gate. Errors are swallowed + console.error'd (same
 * posture as recordErrorEvent's self-swallowing, but awaited so the row lands before the
 * stream closes when possible).
 */
async function auditAgentDenial(
  supabase: HandlerSupabaseLike,
  reason: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.rpc('audit_agent_denial', { p_reason: reason, p_detail: detail });
  } catch (err) {
    console.error('audit_agent_denial_failed', err);
  }
}

// ── Tool catalog builder (FR-MC-017) ──────────────────────────────────────────

function buildTools(composeEnabled: boolean | undefined): ModelTool[] {
  const tools: ModelTool[] = BASE_ACTIONS.map((a) => ({
    type: 'function',
    function: { name: a.name, description: a.description, parameters: a.inputSchema },
  }));
  tools.push(ASK_USER_TOOL);
  if (composeEnabled) {
    tools.push({
      type: 'function',
      function: { name: composeViewAction.name, description: composeViewAction.description, parameters: composeViewAction.inputSchema },
    });
  }
  return tools;
}

// ── Shared tool-use loop (item 1 — deferred-debt refactor) ────────────────────

/**
 * runToolLoop — the single tool-use round loop shared by the main pass
 * (agentChatHandlerInner) and the decision-continuation pass (formerly a second,
 * near-identical `runLoop`). Both call sites drive the SAME model-call/tool-dispatch
 * cycle; their only real differences are parameterized below rather than silently
 * unified, per the refactor brief:
 *
 * Divergences enumerated (main pass vs decision-continuation pass, pre-refactor):
 *   1. compose_view availability — the main pass builds its tool catalog with
 *      `buildTools(deps.composeEnabled)` and has a full compose_view dispatch branch
 *      (model-calling-action seam, ADR-0041). The continuation pass never registered
 *      compose_view in its tools (base-actions-only) and had no dispatch branch for it.
 *      → parameterized as `allowCompose: boolean`.
 *   2. Confirm (A3 propose) actions — the main pass has a full validate/summarize/
 *      needs-approval branch for `action.confirm === true` (an approval can be proposed
 *      mid-run). The continuation pass treated ANY confirm action (or missing action) as
 *      unavailable ("action '<name>' not available in this context") and continued —
 *      by design: a decision-continuation turn must not re-propose a second pending write
 *      before the first is resolved.
 *      → parameterized as `allowProposeConfirm: boolean`.
 *   3. Missing tool_calls handling — when `resp.finish_reason === 'tool_calls'` but the
 *      response carries no actual tool_calls[0] (a malformed/empty upstream response),
 *      the main pass fell through with toolName='' into the "unknown action" branch and
 *      CONTINUED the loop (another round). The continuation pass instead treated a missing
 *      toolCall as an immediate graceful completion (same shape as a non-tool finish_reason).
 *      → parameterized as `onMissingToolCall: 'continue-as-unknown' | 'complete'`.
 *
 * Both loops otherwise dispatch identically: heartbeat → model call → text emit →
 * length/non-tool-call completion → assistant tool-call push → action lookup →
 * confirm/read dispatch → tool-result push, capped at MAX_TOOL_ROUNDS with the same
 * graceful "reached step limit" completion and the same UPSTREAM_ERROR catch.
 */
interface RunToolLoopOptions {
  deps: HandlerDeps;
  emit: (type: AgentEvent['type'], fields?: Partial<Omit<AgentEvent, 'id' | 'runId' | 'type' | 'createdAt'>>) => AgentEvent;
  statusEvent: (status: AgentRunStatus, extra?: Record<string, unknown>, text?: string) => AgentEvent;
  deputyCtx: import('../../../pmo-portal/src/lib/agent/runtime/port.ts').DeputyContext;
  messages: ModelMessage[];
  persist: PersistenceRuntime | undefined;
  runId: string;
  /** Divergence 1: whether compose_view is in the tool catalog + has a dispatch branch. */
  allowCompose: boolean;
  /** Divergence 2: whether a confirm:true action may be proposed (needs-approval) from this loop. */
  allowProposeConfirm: boolean;
  /** Divergence 3: behavior when finish_reason==='tool_calls' but tool_calls[0] is absent. */
  onMissingToolCall: 'continue-as-unknown' | 'complete';
}

async function* runToolLoop(opts: RunToolLoopOptions): AsyncGenerator<AgentEvent> {
  const { deps, emit, statusEvent, deputyCtx, messages, persist, runId, allowCompose, allowProposeConfirm, onMissingToolCall } = opts;
  // compose_view dispatch (divergence 1) needs orgId — deputyCtx already carries it
  // (every call site builds deputyCtx with orgId set), so no separate param is needed.
  const orgId = deputyCtx.orgId;

  const tools = buildTools(allowCompose ? deps.composeEnabled : false);
  const actionByName = new Map<string, AgentAction>(BASE_ACTIONS.map((a) => [a.name, a]));

  /** Safe JSON parse for tool args — undefined signals a parse failure (JSON.parse never yields undefined). */
  const parseArgs = (raw: string): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  };
  /**
   * POSITIVE allow-list of pure-read actions safe to run concurrently (audit finding 2). Deliberately
   * NOT `!action.confirm` — `notify` is also confirm:false but WRITES (own inbox), so a `!confirm`
   * gate would let it (and any future confirm:false side-effecting action) inherit parallelizability.
   * An action must be on THIS list to parallelize; everything else stays serial.
   */
  const PARALLELIZABLE_READ_ACTIONS = new Set<string>(['query_entity']);
  /**
   * #5: a tool call safe to execute CONCURRENTLY with the other reads in the same round — a
   * whitelisted pure-READ action with parseable args. Writes are NEVER parallelized: they go through
   * the approval chip + SoD re-auth and stay serial.
   */
  const isParallelizableRead = (tc: { function: { name: string; arguments: string } }): boolean =>
    PARALLELIZABLE_READ_ACTIONS.has(tc.function.name) &&
    actionByName.has(tc.function.name) &&
    parseArgs(tc.function.arguments) !== undefined;

  // Item 2 (MALFORMED_TOOL_CALL): tracks whether the LAST round's tool call was malformed
  // JSON, so a step-cap fallthrough after a malformed final attempt reports the distinct
  // MALFORMED_TOOL_CALL error code rather than the generic "reached step limit" completion.
  // Reset to false on any round that produces a valid parse (a later valid attempt "heals"
  // a prior malformed one — only the trailing state at loop-exit matters).
  let lastRoundMalformed = false;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // FR-AGP-014: heartbeat once per model turn (round), before the model call.
      if (persist) await heartbeat(persist.deps, runId, `round-${round}`);

      const _t0 = Date.now();
      // Token-budget compaction of the REPLAYED transcript (input-only; `messages` — the persisted/
      // in-loop array — is never mutated, so tool_call pairing + durable resume are untouched).
      // Old tool-result bodies past the recency window shrink to a marker; the system prefix (cache)
      // and all reasoning text are preserved. Under budget this returns `messages` unchanged.
      const modelMessages = compactTranscript(messages, deps.compaction ?? DEFAULT_COMPACTION);
      const resp = await deps.modelClient.create({
        model: deps.model,
        max_tokens: 2048,
        // 0.8 (was provider-default ~1.0) — steadier tool routing, fewer thrash rounds on
        // multi-intent follow-ups. Latency lever tracked alongside the throughput provider sort.
        temperature: 0.8,
        messages: modelMessages,
        tools,
      });
      // Round-latency probe (diagnosing the follow-up-hang: rounds × per-round latency vs the
      // ~150s isolate wall-clock). Structured, no user data — safe to keep.
      console.log(`[agent-chat] round=${round} model_ms=${Date.now() - _t0} finish=${resp.finish_reason} out_tokens=${resp.usage?.completion_tokens ?? '?'}`);

      // FR-AUC-002/004/018: one agent_usage row per modelClient.create() resolution — the
      // single per-round choke point (unified by the runToolLoop refactor, so both the main
      // pass and the decision-continuation pass hit this exactly once per round). Independent
      // of `persist` (persistence flag) — usage recording is unconditional; `run_id` is set
      // only when a run row exists (persist truthy), else null (FR-AUC-004).
      if (deps.usage) {
        await recordUsage({ supabase: deps.usage.supabase, runId: persist ? runId : null }, resp, deps.usageAction ?? 'chat');
      }

      // Emit any text content as an assistant event.
      if (resp.message.content) {
        yield emit('assistant', { text: resp.message.content });
      }

      // Blocker 3: use the API's own sentinel — finish_reason !== 'tool_calls' means
      // no tool dispatch needed. Also handle length (truncation) explicitly.
      if (resp.finish_reason === 'length') {
        yield statusEvent(
          'completed',
          { model: resp.model, prompt_tokens: resp.usage?.prompt_tokens, completion_tokens: resp.usage?.completion_tokens, ...(resp.usage?.total_cost !== undefined ? { total_cost: resp.usage.total_cost } : {}) },
          'response truncated',
        );
        return;
      }

      if (resp.finish_reason !== 'tool_calls') {
        yield statusEvent('completed', {
          model: resp.model,
          prompt_tokens: resp.usage?.prompt_tokens,
          completion_tokens: resp.usage?.completion_tokens,
          ...(resp.usage?.total_cost !== undefined ? { total_cost: resp.usage.total_cost } : {}),
        });
        return;
      }

      const toolCall = resp.message.tool_calls?.[0];

      // Divergence 3: a missing tool_calls[0] despite finish_reason==='tool_calls'.
      if (!toolCall && onMissingToolCall === 'complete') {
        yield statusEvent('completed', {
          model: resp.model,
          prompt_tokens: resp.usage?.prompt_tokens,
          completion_tokens: resp.usage?.completion_tokens,
          ...(resp.usage?.total_cost !== undefined ? { total_cost: resp.usage.total_cost } : {}),
        });
        return;
      }

      let toolInput: unknown;
      const toolId = toolCall?.id ?? 'tool-use-id';
      const toolName = toolCall?.function.name ?? '';

      // Push the assistant's tool-call turn (FR-MC-006 — the assistant message
      // with tool_calls IS the turn; no separate echo needed).
      messages.push({ role: 'assistant', content: resp.message.content, tool_calls: resp.message.tool_calls });

      // ── #5: parallel reads / serial writes ─────────────────────────────────────
      // The model may request MULTIPLE tool calls in one round. READS (query_entity, confirm:false)
      // are independent → run them CONCURRENTLY (a real latency win on multi-intent asks). Anything
      // else (writes/compose/ask_user/unknown/malformed) is NEVER parallelized — those go through the
      // approval chip + SoD re-auth and MUST stay serialized one at a time (the write-safety rule).
      const toolCalls = resp.message.tool_calls ?? [];
      // Cap fan-out (audit finding 3): the model output is untrusted, so a round with a huge
      // tool_calls array must not spawn unbounded concurrent DB reads. Above the cap, fall through to
      // the serial+defer path (process the first, defer the rest → the model re-requests them next
      // round), which naturally batches an oversized set across rounds.
      if (toolCalls.length > 1 && toolCalls.length <= MAX_PARALLEL_READS && toolCalls.every(isParallelizableRead)) {
        lastRoundMalformed = false;
        // Announce every read up-front (present-tense step trail), then dispatch all concurrently.
        for (const tc of toolCalls) {
          yield emit('status', { payload: { kind: 'step', label: stepLabel(tc.function.name, parseArgs(tc.function.arguments)) } });
        }
        const settled = await Promise.all(
          toolCalls.map(async (tc) => {
            const input = parseArgs(tc.function.arguments);
            const action = actionByName.get(tc.function.name)!; // guaranteed non-null by isParallelizableRead
            const result = await dispatchAction(action, input, deputyCtx);
            return { tc, input, result };
          }),
        );
        // Emit widget/tool events + append every tool result IN ORDER (deterministic transcript;
        // each tool_call_id in the assistant message gets exactly one matching result).
        for (const { tc, input, result } of settled) {
          if (tc.function.name === 'query_entity') {
            const widget = buildDataTableWidgetFromQueryResult(input, result);
            if (widget) yield emit('artifact', { payload: { kind: 'widget', widget } });
          }
          yield emit('tool', { payload: { name: tc.function.name, input, result } });
          messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(result) });
        }
        continue;
      }

      // Non-parallelizable multi-call set: only the FIRST call is processed below (writes serialized).
      // Every EXTRA call gets a deferred marker so the assistant(tool_calls)→tool(result) pairing the
      // API requires stays valid — otherwise an unanswered tool_call_id errors the next model call
      // (the latent bug when the model emitted >1 call and only [0] was handled). The model re-requests
      // a deferred call next round if it still needs it. Pushed BEFORE the first call is processed so a
      // stream-ending write (needs-approval/ask_user) leaves only its OWN id pending for the resume.
      if (toolCalls.length > 1) {
        for (const extra of toolCalls.slice(1)) {
          messages.push({
            role: 'tool',
            tool_call_id: extra.id,
            name: extra.function.name,
            content: JSON.stringify({ _deferred: true, note: 'Not executed this round; call again if still needed.' }),
          });
        }
      }

      // Item 2 (MALFORMED_TOOL_CALL): a SyntaxError here must NOT fail the run as
      // UPSTREAM_ERROR — append a role:'tool' error result and let the model retry.
      if (toolCall) {
        try {
          toolInput = JSON.parse(toolCall.function.arguments);
          lastRoundMalformed = false;
        } catch (e) {
          if (e instanceof SyntaxError) {
            lastRoundMalformed = true;
            messages.push({
              role: 'tool',
              tool_call_id: toolId,
              name: toolName,
              content: JSON.stringify({ error: 'malformed tool arguments' }),
            });
            continue;
          }
          throw e;
        }
      } else {
        toolInput = {};
        // Item 2 (MALFORMED_TOOL_CALL): a missing toolCall round is not a malformed-JSON
        // round — reset the flag so a prior malformed round doesn't misreport exhaustion
        // as MALFORMED_TOOL_CALL when later rounds are merely missing a tool call.
        lastRoundMalformed = false;
      }

      // Live step trail: announce the tool about to run as a present-tense status hint
      // (purely cosmetic — see stepLabel). Emitted BEFORE dispatch so the panel swaps the
      // static "Working…" for the current action while it executes. {kind:'step'} rides the
      // existing `status` channel (mirrors {kind:'question'}) and is NEVER persisted
      // (withPersistence skips it) — it must not reappear on a durable-resume reload.
      yield emit('status', { payload: { kind: 'step', label: stepLabel(toolName, toolInput) } });

      // ── A4: compose_view dispatch branch (ADR-0041 model-calling-action seam) ──
      // Divergence 1: only reachable when allowCompose (main pass).
      if (allowCompose && toolName === 'compose_view' && deps.composeEnabled) {
        const out = await runComposeView(
          toolInput as { prompt: string },
          // Cast: HandlerSupabaseLike's `.eq()` returns a plain object (`.single()`/`.limit()`/
          // `.in()`), while the port's SupabaseLike requires `.eq()` itself to be PromiseLike —
          // a genuine shape mismatch between two independently-evolved minimal interfaces, not
          // a missing member (fixed the missing top-level `.in()` above; this one is structural
          // and out of scope for a cast-only cleanup). True external boundary: deps.supabase is
          // always the real (richer) Supabase client at runtime — never a mock without .eq().then.
          { jwt: '', userId: deps.userId, orgId, supabase: deps.supabase as unknown as import('../../../pmo-portal/src/lib/agent/runtime/port.ts').SupabaseLike },
          { modelClient: deps.modelClient, model: deps.model },
        );

        if ('error' in out) {
          // Compose failed — emit user-facing assistant error (FR-CV-006)
          yield emit('assistant', {
            text: "I wasn't able to compose a valid view — try rephrasing your request.",
          });
          messages.push({
            role: 'tool',
            tool_call_id: toolId,
            name: toolName,
            content: JSON.stringify({ error: out.error, code: out.code }),
          });
        } else {
          // Compose succeeded — emit artifact event (FR-CV-007/008)
          yield emit('artifact', {
            payload: {
              kind: 'compose_view',
              spec: out.spec,
              repairAttempts: out.repairAttempts,
              title: out.title,
              tokensUsed: out.tokensUsed,
            },
          });
          yield emit('tool', {
            payload: {
              name: toolName,
              input: toolInput,
              result: { ok: true, panels: out.spec.panels.length },
            },
          });
          messages.push({
            role: 'tool',
            tool_call_id: toolId,
            name: toolName,
            content: JSON.stringify({ ok: true, panels: out.spec.panels.length }),
          });
        }
        continue;
      }

      // ── ADR-0045 §2: ask_user dispatch branch ────────────────────────────
      // Same interaction family as the A3 propose branch (needs-approval): a
      // structured question pauses the run; the client resolves it via
      // control('answer',...), which continues the SAME run (handleAnswer,
      // below). Gated by allowProposeConfirm so the decision-continuation pass
      // cannot propose a SECOND pending question before the first resolves
      // (mirrors divergence 2's confirm-action guard).
      if (toolName === 'ask_user' && allowProposeConfirm) {
        const input = toolInput as { prompt?: string; options?: { id: string; label: string }[]; allowFreeText?: boolean };
        const questionId = makeId();
        // ADR-0045 §2 payload shape: {kind:'question', questionId, prompt, options,
        // allowFreeText?} — carried on `status` so it rides the same run-lifecycle
        // channel as needs-approval, but WITHOUT a `status` field of its own (it is
        // not an AgentRunStatus value; `useAssistantPanel`'s drain distinguishes it
        // by `payload.kind`, not `payload.status`).
        yield emit('status', {
          payload: {
            kind: 'question',
            questionId,
            prompt: input.prompt ?? '',
            options: input.options ?? [],
            ...(input.allowFreeText !== undefined ? { allowFreeText: input.allowFreeText } : {}),
          },
        });
        // End the stream — the client re-POSTs with `answer` on the next turn
        // (mirrors the A3 confirm-propose branch ending the stream on needs-approval).
        return;
      }

      const action = actionByName.get(toolName);

      // Divergence 2: the continuation pass (allowProposeConfirm===false) treats a
      // confirm:true action the same as "not found" — a second pending write must not
      // be proposed before the first is resolved.
      if (!action || (action.confirm && !allowProposeConfirm)) {
        const errorMessage = !action
          ? `unknown action: ${toolName}`
          : `action '${toolName}' not available in this context`;
        messages.push({
          role: 'tool',
          tool_call_id: toolId,
          name: toolName,
          content: JSON.stringify({ error: errorMessage }),
        });
        continue;
      }

      // ── A3: Propose branch (confirm:true action in the normal loop) ─────────
      if (action.confirm) {
        // Validate args before proposing (AC-AW-005 / NFR-AW-SEC-005)
        const writeAction = action as AgentAction & {
          validate: (i: unknown) => { ok: boolean; error?: string; value?: unknown };
          summarize: (i: unknown) => string;
        };

        const validation = writeAction.validate(toolInput);
        if (!validation.ok) {
          // Invalid args → error tool_result to model; NO needs-approval event (AC-AW-005)
          messages.push({
            role: 'tool',
            tool_call_id: toolId,
            name: toolName,
            content: JSON.stringify({ error: validation.error }),
          });
          continue;
        }

        const requiresApproval = resolveNeedsApproval(action, validation.value, deputyCtx);
        if (requiresApproval) {
          // Valid material args → emit needs-approval and END the stream (D-A3-1)
          const pendingId = makeId();
          const humanSummary = writeAction.summarize(validation.value);

          yield statusEvent('needs-approval', {
            pendingId,
            actionName: action.name,
            humanSummary,
            structuredArgs: validation.value as object,
          });
          // End the stream — the client re-POSTs with decision on the next turn
          return;
        }

        // ADR-0051: low-materiality write → auto-approve, but still execute
        // only through the forced confirmed-write path under the caller JWT.
        const permCheck = getPermissionCheck(toolName);
        if (permCheck) {
          let reAuthRole: string | null = null;
          let reAuthOrg: string | null = null;
          try {
            const { data, error } = await deps.supabase
              .from('profiles')
              .select('org_id, role')
              .eq('id', deps.userId)
              .single();

            if (error || !data) {
              yield statusEvent('errored', { error: 'AUTH_EXPIRED' });
              return;
            }
            reAuthRole = data.role ?? null;
            reAuthOrg = data.org_id ?? null;
          } catch {
            yield statusEvent('errored', { error: 'AUTH_EXPIRED' });
            return;
          }

          const canFn = deps.can ?? (() => false);
          const allowed = canFn(permCheck.action, permCheck.entity, { realRole: reAuthRole });
          if (!allowed) {
            // Audit Obs-High #1: durably record the SoD refusal (survives the SSE-stream close)
            // via the 0079 RPC before returning the denial. FAIL-OPEN: a failed write must not
            // change the refusal behavior or break the turn. Identity (org/actor) is stamped
            // server-side by the RPC — non-forgeable; only the annotation below is caller-supplied.
            await auditAgentDenial(deps.supabase, 'permission_denied', {
              tool: toolName,
              action: permCheck.action,
              entity: permCheck.entity,
              run_id: runId,
            });
            // Observability floor (audit Obs-High): the SoD refusal is a security signal that
            // must survive the SSE-stream close. recordErrorEvent is fire-and-forget (never
            // awaited, swallows its own failure) — same mechanism as index.ts:95.
            void recordErrorEvent(deps.supabase as never, {
              fn: 'agent-chat',
              errorCode: 'AGENT_PERMISSION_DENIED',
              contextId: toolName,
              orgId: reAuthOrg ?? undefined,
            });
            yield statusEvent('errored', { error: 'PERMISSION_DENIED' });
            messages.push({
              role: 'tool',
              tool_call_id: toolId,
              name: toolName,
              content: JSON.stringify({ error: 'Permission denied. You do not have access to perform this action.' }),
            });
            return;
          }
        }

        const journaled = persist ? findJournaledWrite(persist, toolName, hashToolArgs(validation.value)) : undefined;
        let toolResult: unknown;
        if (journaled) {
          toolResult = journaled.payload;
        } else {
          try {
            toolResult = await dispatchActionForced(action, validation.value, deputyCtx);
          } catch {
            messages.push({
              role: 'tool',
              tool_call_id: toolId,
              name: toolName,
              content: JSON.stringify({ error: 'Write failed; database error.' }),
            });
            continue;
          }
        }

        yield emit('tool', {
          payload: {
            name: toolName,
            input: validation.value,
            result: toolResult,
          },
        });
        messages.push({
          role: 'tool',
          tool_call_id: toolId,
          name: toolName,
          content: JSON.stringify(toolResult),
        });
        continue;
      }

      // ── Read action (confirm:false) — dispatch immediately ─────────────────
      const toolResult = await dispatchAction(action, toolInput, deputyCtx);

      // ADR-0045 §1/DEC-2: query_entity's `as:'table'` hint → an inline
      // data_table widget artifact, ALONGSIDE the normal tool event (never
      // instead of it — the model still needs the tool_result to continue).
      if (toolName === 'query_entity') {
        const widget = buildDataTableWidgetFromQueryResult(toolInput, toolResult);
        if (widget) {
          yield emit('artifact', { payload: { kind: 'widget', widget } });
        }
      }

      yield emit('tool', {
        payload: {
          name: toolName,
          input: toolInput,
          result: toolResult,
        },
      });

      // Append the single tool-result message for the next round (FR-MC-006).
      messages.push({
        role: 'tool',
        tool_call_id: toolId,
        name: toolName,
        content: JSON.stringify(toolResult),
      });
    }

    // Loop fell through — step cap reached (D7/R4: graceful completed, not errored).
    // Item 2: EXCEPT when the step cap was reached because the model never recovered
    // from malformed tool-call JSON — that terminates as errored/MALFORMED_TOOL_CALL,
    // a distinct code from both the graceful step-cap completion and UPSTREAM_ERROR.
    if (lastRoundMalformed) {
      yield statusEvent('errored', { error: 'MALFORMED_TOOL_CALL' });
      return;
    }
    yield statusEvent('completed', {}, 'reached step limit');
  } catch {
    // ── Upstream error → scrub, never echo raw error (AC-AR-005, NFR-AR-SEC-005)
    console.error('[agent-chat] UPSTREAM_ERROR', {
      errorCode: 'UPSTREAM_ERROR',
      round: 'unknown',
    });
    yield statusEvent('errored', { error: 'UPSTREAM_ERROR' });
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * agentChatHandler — the pure business-logic generator.
 *
 * Gate order (each gate yields terminal status and returns):
 *   (1) 401 UNAUTHORIZED — userId empty (AC-AR-002)
 *   (2) 400 BAD_REQUEST(orgId) — profiles lookup fails (AC-AR-003)
 *   (ADR-0043 §4 cancel) server-side abort branch — when req.cancel is present.
 *       Correctness-remediation finding 4: no model call, no deputy context needed;
 *       emits a terminal errored/CANCELLED status event, persisted via the same
 *       withPersistence -> setRunStatus call site every other terminal status uses.
 *   (A3-decision) approve/deny branch — when req.decision is present. Correctness-
 *       remediation finding 2: routed BEFORE gate (3) — a reject/approve resolution
 *       (the write_resolved audit event) never itself costs a model call and must
 *       never be credit-blocked.
 *   (ADR-0045 §2 answer) resolve-question branch — when req.answer is present. Same
 *       ordering rationale as the decision branch (finding 2): resolving the pending
 *       question is not itself a model call.
 *   (3) 429 RATE_LIMITED — rate guard exceeded (D9/AR-OD-002), fresh-send path only
 *       (only reached when neither req.decision nor req.answer is present — a fresh
 *       user turn always costs a model call, so gating it here is unchanged from the
 *       pre-remediation behavior for this path).
 *   (4) tool-use loop — up to MAX_TOOL_ROUNDS (AC-AR-001, AC-AR-004)
 *   (5) 502 UPSTREAM_ERROR — model call throws; error scrubbed (AC-AR-005)
 */
export async function* agentChatHandler(
  req: AgentChatRequest,
  deps: HandlerDeps,
): AsyncIterable<AgentEvent> {
  const runId = req.runId ?? makeId();
  const persist = makePersistenceRuntime(deps);

  // FR-AGP-010 (contract fix 2026-07-08): a fresh run gets a new agent_threads + agent_runs row,
  // created BEFORE any event is persisted (insertEvent's run_id FK requires the run to exist first).
  // We gate on whether the RUN ROW already exists — NOT on `!req.runId`. The FE adapter
  // (pmoNativeRuntime.ts) mints the runId client-side and sends it on EVERY POST (so client + server
  // share the id for followUp/cancel/History), so a fresh createRun ALSO carries req.runId; the old
  // `!req.runId` gate therefore never created the row for a real browser run → every downstream
  // agent_events/agent_usage insert 42501'd (short runs silently unpersisted; ≥3-round runs tripped
  // the usage fail-closed breaker → errored). Create-iff-not-exists is idempotent: a resume/decision
  // re-POST finds the run already exists and skips.
  if (persist && !(await runExists(persist.deps, runId))) {
    const lastUserMsgForTitle = req.messages.filter((m) => m.role === 'user').at(-1);
    const title =
      lastUserMsgForTitle && typeof lastUserMsgForTitle.content === 'string'
        ? lastUserMsgForTitle.content.slice(0, 60)
        : 'New conversation';
    // ADR-0045 §3 (FR-ATC-017): narrow the persisted scope to JUST the entity
    // {type,id,label} — not the whole context (route/selection are UI-local,
    // never durably scoped to the thread). Review-remediation item 2 (Security
    // Lows): narrowScope also clamps label and drops any unknown keys, so a
    // forged/oversized entity object can't widen or bloat the persisted scope.
    await createThreadAndRun(persist.deps, {
      runId,
      title,
      scope: narrowEntityScope(req.context?.entity),
      threadId: req.threadId,
    });
  }

  yield* withPersistence(agentChatHandlerInner(req, deps, runId, persist), persist, runId);
}

async function* agentChatHandlerInner(
  req: AgentChatRequest,
  deps: HandlerDeps,
  runId: string,
  persist: PersistenceRuntime | undefined,
): AsyncGenerator<AgentEvent> {
  const now = deps.now ?? (() => new Date());
  const canFn: CanFn = deps.can ?? (() => false);

  const emit = (
    type: AgentEvent['type'],
    fields: Partial<Omit<AgentEvent, 'id' | 'runId' | 'type' | 'createdAt'>> = {},
  ): AgentEvent => mkEvent(runId, type, fields, now);

  const statusEvent = (
    status: AgentRunStatus,
    extra: Record<string, unknown> = {},
    text?: string,
  ): AgentEvent =>
    emit('status', { payload: { status, ...extra }, text });

  // ── Gate (1): userId present (AC-AR-002) ──────────────────────────────────
  if (!deps.userId) {
    yield statusEvent('errored', { error: 'UNAUTHORIZED' });
    return;
  }

  // ── Gate (2): org + role lookup via caller JWT (AC-AR-003, FR-AW-010) ─────
  let orgId: string;
  let initialRole: string | null = null;
  try {
    const { data, error } = await deps.supabase
      .from('profiles')
      .select('org_id, role')
      .eq('id', deps.userId)
      .single();

    if (error || !data) {
      yield statusEvent('errored', { error: 'BAD_REQUEST', detail: 'orgId' });
      return;
    }
    orgId = data.org_id;
    initialRole = data.role ?? null;
  } catch {
    yield statusEvent('errored', { error: 'BAD_REQUEST', detail: 'orgId' });
    return;
  }

  // ── ADR-0043 §4: Cancel branch (req.cancel present → server-side abort) ──────
  // Correctness-remediation (finding 4): control('cancel') previously only aborted the
  // client-side fetch — agent_runs.status never reached a persisted terminal state
  // server-side. This branch makes NO model call (a cancel is a pure status write, not
  // a continuation) and emits a terminal errored/CANCELLED status event; withPersistence
  // (the SAME wrapper every other terminal status already flows through) persists it via
  // setRunStatus — no new persistence code needed. Routed before the credit gate for the
  // same reason as decision/answer (finding 2): a cancel never costs a model call and
  // must never be credit-blocked.
  if (req.cancel) {
    yield statusEvent('errored', { error: 'CANCELLED' });
    return;
  }

  // ── Build deputy context ───────────────────────────────────────────────────
  // Cast: HandlerSupabaseLike vs the port's SupabaseLike is a genuine structural mismatch
  // (see the identical cast + comment in the compose_view dispatch branch above) — deps.supabase
  // is always the real Supabase client at runtime, which does satisfy SupabaseLike's shape.
  const deputyCtx: import('../../../pmo-portal/src/lib/agent/runtime/port.ts').DeputyContext = {
    jwt: '',
    userId: deps.userId,
    orgId,
    supabase: deps.supabase as unknown as import('../../../pmo-portal/src/lib/agent/runtime/port.ts').SupabaseLike,
  };

  // ── A3: Decision branch (req.decision present → approve/reject a pending write) ──
  // Correctness-remediation (finding 2): routed BEFORE the credit gate below — resolving
  // a pending decision (the write_resolved audit event + tool_result injection for
  // reject/approve) never itself costs a model call, so it must never be credit-blocked.
  // The SUBSEQUENT model turn inside handleDecision's own runLoop call IS a genuine new
  // model call and is NOT exempted — RED-2 (gpt-5.5 red-team audit) hardened this: runLoop
  // now gates itself on deps.rateGuard (isCreditExhausted) before making that call, so a
  // fabricated/stale decision (no real pending item — previously an un-gated free model
  // call) is now blocked identically to a genuine decision's continuation.
  if (req.decision) {
    yield* handleDecision(req, deps, emit, statusEvent, canFn, deputyCtx, initialRole, persist);
    return;
  }

  // ── ADR-0045 §2: Answer branch (req.answer present → resolve a pending question) ──
  // Correctness-remediation (finding 2): routed BEFORE the credit gate below, for the
  // same reason as the decision branch — resolving a pending question (finding the
  // trailing tool_use + injecting the answer as its tool_result) never itself costs a
  // model call. The trailing model turn that follows (inside handleAnswer's own
  // runLoopAfterAnswer call) IS a genuine new model call — RED-2 hardened this the same
  // way as the decision branch: runLoopAfterAnswer now gates itself on deps.rateGuard
  // before making that call (a fabricated/stale answer, or a genuine one, both correctly
  // credit-blocked at zero balance; only the resolution write that already happened is
  // exempt).
  if (req.answer) {
    yield* handleAnswer(req, deps, emit, statusEvent, deputyCtx, initialRole, persist);
    return;
  }

  // ── Gate (3): rate guard (AR-OD-002, D9) — fresh-send path only ──────────
  // Reached only when neither req.decision nor req.answer is present (both branches
  // above already returned). A fresh user turn always costs at least one model call,
  // so gating it here (before even echoing the user event) is correct and unchanged
  // from the pre-remediation behavior for this path.
  if (deps.rateGuard) {
    const r = await deps.rateGuard.check(orgId);
    if (r.exceeded) {
      yield statusEvent('errored', {
        error: 'RATE_LIMITED',
        retryAfterSeconds: r.retryAfterSeconds,
      });
      return;
    }
  }

  // ── Yield the last user message ────────────────────────────────────────────
  const lastUserMsg = req.messages.filter((m) => m.role === 'user').at(-1);
  if (lastUserMsg) {
    yield emit('user', {
      text: typeof lastUserMsg.content === 'string' ? lastUserMsg.content : undefined,
    });
  }

  // ── Build system prompt (+ ADR-0045 §3 untrusted grounding hint) ──────────
  const system = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP, initialRole, {
    composeEnabled: deps.composeEnabled,
    automationsEnabled: AUTOMATIONS_ENABLED,
  }) + buildGroundingHint(req.context?.entity);

  // The full conversation messages for the model call — system prompt is
  // messages[0] (FR-MC-003), replacing Anthropic's top-level `system` field.
  const attachmentMessages =
    req.attachmentIds && req.attachmentIds.length > 0 && deps.attachmentResolver
      ? await deps.attachmentResolver.resolveAttachmentMessages(req.attachmentIds, deputyCtx, req.threadId)
      : [];
  const messages: ModelMessage[] = [
    { role: 'system', content: system },
    ...req.messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === 'string'
          ? m.content
          : null,
    })),
    ...attachmentMessages,
  ];

  // ── Tool-use loop (AC-AR-001, AC-AR-004) — shared helper, see runToolLoop's
  // divergence-enumeration doc comment for what's parameterized vs identical. ──
  yield* runToolLoop({
    deps,
    emit,
    statusEvent,
    deputyCtx,
    messages,
    persist,
    runId,
    allowCompose: true,
    allowProposeConfirm: true,
    onMissingToolCall: 'continue-as-unknown',
  });
}

// ── ADR-0045 §2: Answer handler (resolve a pending ask_user question) ─────────

/**
 * Handle a re-POST with req.answer (resolve a pending ask_user question).
 *
 * Protocol (mirrors handleDecision/D-A3-1, generalized per ADR-0045 §2 — the
 * "question" and "needs-approval" interactions share one resolution family):
 * 1. Find the trailing unresolved ask_user tool_use in the replayed transcript
 *    (findTrailingUnresolvedToolUse + isAskUserToolUse). If none (stale/duplicate
 *    re-POST — AC-ATC-010), it is a no-op: just continue the model with the SAME
 *    messages, no re-injection.
 * 2. Otherwise, append the answer as the tool_result resolving that tool_use
 *    (the chosen option's label, or the free text) and continue the SAME run
 *    (AC-ATC-009) via runLoopAfterAnswer — never a new createRun.
 * NFR-ATC-SEC-004: no new deputy bypass — this re-POST never re-derives org/role
 * itself (unlike handleDecision's approve path, there is no write to authorize;
 * ask_user is read-only UX, so the caller-JWT deputy context already governs
 * anything the continuation subsequently does through the shared runToolLoop).
 *
 * Correctness-remediation (gpt-5.5 cross-family audit, finding 1): an answer RESUMES
 * the user's original request — unlike a decision (which is terminal: a write was
 * either executed or declined, and the continuation must not immediately propose a
 * SECOND write before the model acknowledges the first), answering a clarifying
 * question is not itself a resolution of anything write-shaped. The model may need
 * to immediately propose a confirm action (e.g. create_activity) or emit a
 * compose_view artifact to actually satisfy the request the question was blocking.
 * So the answer-continuation runs via runLoopAfterAnswer (allowCompose:true,
 * allowProposeConfirm:true — the SAME capabilities as the main pass), not runLoop
 * (which stays allowCompose:false/allowProposeConfirm:false, used only by
 * handleDecision's continuation).
 */
async function* handleAnswer(
  req: AgentChatRequest,
  deps: HandlerDeps,
  emit: (type: AgentEvent['type'], fields?: Partial<Omit<AgentEvent, 'id' | 'runId' | 'type' | 'createdAt'>>) => AgentEvent,
  statusEvent: (status: AgentRunStatus, extra?: Record<string, unknown>, text?: string) => AgentEvent,
  deputyCtx: import('../../../pmo-portal/src/lib/agent/runtime/port.ts').DeputyContext,
  initialRole: string | null,
  persist?: PersistenceRuntime,
): AsyncGenerator<AgentEvent> {
  const answer = req.answer!;

  // Track C (DEC-5): the initial-run build site appends buildGroundingHint so the
  // model keeps the live-context grounding across a follow-up turn — match it here.
  const system = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP, initialRole, {
    composeEnabled: deps.composeEnabled,
    automationsEnabled: AUTOMATIONS_ENABLED,
  }) + buildGroundingHint(req.context?.entity);

  const messages: ModelMessage[] = [
    { role: 'system', content: system },
    ...req.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : null,
    })),
  ];

  const trailingQuestion = findTrailingUnresolvedToolUse(req.messages, isAskUserToolUse);

  if (trailingQuestion) {
    const { toolId, toolName, toolInput } = trailingQuestion;
    // Prefer the option's human-readable label (the model asked with labels, not
    // ids) — fall back to the raw optionId if the option isn't found, then freeText.
    const questionInput = toolInput as { options?: { id: string; label: string }[] } | undefined;
    const matchedOption = questionInput?.options?.find((o) => o.id === answer.optionId);
    const answerText = answer.freeText ?? matchedOption?.label ?? answer.optionId ?? '';
    messages.push({
      role: 'tool',
      tool_call_id: toolId,
      name: toolName,
      content: JSON.stringify({ answer: answerText }),
    });
  }
  // No trailingQuestion found → stale/duplicate answer (AC-ATC-010): fall through
  // and simply continue the model with the messages as replayed (no re-injection).

  yield* runLoopAfterAnswer(req, deps, emit, statusEvent, deputyCtx, messages, persist);
}

// ── A3: Decision handler (stateless approve/deny re-POST) ─────────────────────

/**
 * Handle a re-POST with req.decision (approve or reject a pending write).
 *
 * Protocol (D-A3-1):
 * 1. Find the trailing unresolved confirm-action tool_use in the replayed transcript.
 *    If none, it is a no-op (stale/duplicate) → treat as rejected (AC-AW-003).
 * 2. Re-validate the action args against the action's inputSchema (D-A3-2).
 * 3. Re-derive org + role from profiles (AC-AW-004).
 * 4. Run can() preflight (AC-AW-008).
 * 5a. If verdict === 'reject' OR any check fails → rejection tool_result + model continues.
 * 5b. If verdict === 'approve' → execute via dispatchActionForced under caller JWT.
 *    Emit tool event + write_resolved system event; model continues and completes.
 */
async function* handleDecision(
  req: AgentChatRequest,
  deps: HandlerDeps,
  emit: (type: AgentEvent['type'], fields?: Partial<Omit<AgentEvent, 'id' | 'runId' | 'type' | 'createdAt'>>) => AgentEvent,
  statusEvent: (status: AgentRunStatus, extra?: Record<string, unknown>, text?: string) => AgentEvent,
  canFn: CanFn,
  deputyCtx: import('../../../pmo-portal/src/lib/agent/runtime/port.ts').DeputyContext,
  initialRole: string | null,
  persist?: PersistenceRuntime,
): AsyncGenerator<AgentEvent> {
  const decision = req.decision!;
  const { pendingId, verdict } = decision;

  // Yield the last user message (may be a tool_result content in the replayed messages)
  const lastUserMsg = req.messages.filter((m) => m.role === 'user').at(-1);
  if (lastUserMsg && typeof lastUserMsg.content === 'string') {
    yield emit('user', { text: lastUserMsg.content });
  }

  // Track C (DEC-5): the initial-run build site appends buildGroundingHint so the
  // model keeps the live-context grounding across a follow-up turn — match it here.
  // composeEnabled:false — this decision-continuation pass runs runToolLoop with
  // allowCompose:false (see :1403), so compose_view is NOT registered here; advertising
  // it would be a dangling affordance (FR-AXP-010). (Wave-1 code-quality review fix.)
  const system = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP, initialRole, {
    composeEnabled: false,
    automationsEnabled: AUTOMATIONS_ENABLED,
  }) + buildGroundingHint(req.context?.entity);

  const messages: ModelMessage[] = [
    { role: 'system', content: system },
    ...req.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : null,
    })),
  ];

  // ── Find trailing unresolved confirm-action tool_use (positional match) ────
  // The trailing unresolved tool_use is the last assistant message's last tool_use block
  // that does NOT already have a matching tool_result in the next user message.
  const trailingToolUse = findTrailingUnresolvedToolUse(req.messages, isConfirmToolUse);

  if (!trailingToolUse) {
    // No pending confirm action — stale/duplicate decision; treat as no-op (AC-AW-003)
    // Just run the model to continue normally.
    yield* runLoop(req, deps, emit, statusEvent, deputyCtx, messages, persist);
    return;
  }

  const { toolId, toolName, toolInput } = trailingToolUse;
  const action = BASE_ACTION_BY_NAME.get(toolName);

  if (!action || !action.confirm) {
    // Action not found or not a confirm action → no-op
    yield* runLoop(req, deps, emit, statusEvent, deputyCtx, messages, persist);
    return;
  }

  const writeAction = action as AgentAction & {
    validate: (i: unknown) => { ok: boolean; error?: string; value?: unknown };
    summarize: (i: unknown) => string;
  };

  if (verdict === 'reject') {
    // Deny path (AC-AW-002)
    yield emit('system', {
      text: 'rejected',
      payload: {
        event: 'write_resolved',
        decision: 'rejected',
        actionName: toolName,
        pendingId,
      },
    });

    // Append rejection tool_result so the model acknowledges
    messages.push({
      role: 'tool',
      tool_call_id: toolId,
      name: toolName,
      content: JSON.stringify({ result: 'Write action declined by user.' }),
    });

    yield* runLoop(req, deps, emit, statusEvent, deputyCtx, messages, persist);
    return;
  }

  // ── Approve path ───────────────────────────────────────────────────────────

  // Step 1: Re-validate args (D-A3-2, defence-in-depth)
  const validation = writeAction.validate(toolInput);
  if (!validation.ok) {
    // Malformed args on re-POST — reject
    yield emit('system', {
      text: 'rejected',
      payload: { event: 'write_resolved', decision: 'rejected', actionName: toolName, pendingId },
    });
    messages.push({
      role: 'tool',
      tool_call_id: toolId,
      name: toolName,
      content: JSON.stringify({ error: `Invalid args on approval: ${validation.error}` }),
    });
    yield* runLoop(req, deps, emit, statusEvent, deputyCtx, messages, persist);
    return;
  }

  // Step 2: Deputy re-auth — re-derive org + role (AC-AW-004)
  let reAuthRole: string | null = null;
  let reAuthOrg: string | null = null;
  try {
    const { data, error } = await deps.supabase
      .from('profiles')
      .select('org_id, role')
      .eq('id', deps.userId)
      .single();

    if (error || !data) {
      yield statusEvent('errored', { error: 'AUTH_EXPIRED' });
      return;
    }
    reAuthRole = data.role ?? null;
    reAuthOrg = data.org_id ?? null;
  } catch {
    yield statusEvent('errored', { error: 'AUTH_EXPIRED' });
    return;
  }

  // Step 3: can() preflight (AC-AW-008, FR-AW-010)
  const permCheck = getPermissionCheck(toolName);
  if (permCheck) {
    const allowed = canFn(permCheck.action, permCheck.entity, { realRole: reAuthRole });
    if (!allowed) {
      // Audit Obs-High #1: durably record the SoD refusal (survives the SSE-stream close)
      // via the 0079 RPC before returning the denial. FAIL-OPEN: a failed write must not
      // change the refusal behavior or break the turn. Identity (org/actor) is stamped
      // server-side by the RPC — non-forgeable; only the annotation below is caller-supplied.
      // `pending_id` marks this as the stateless approve/deny re-POST path (vs runToolLoop).
      await auditAgentDenial(deps.supabase, 'permission_denied', {
        tool: toolName,
        action: permCheck.action,
        entity: permCheck.entity,
        run_id: req.runId ?? null,
        thread_id: req.threadId ?? null,
        pending_id: pendingId,
      });
      // Observability floor (audit Obs-High): the SoD refusal is a security signal that
      // must survive the SSE-stream close. recordErrorEvent is fire-and-forget (never
      // awaited, swallows its own failure) — same mechanism as index.ts:95.
      void recordErrorEvent(deps.supabase as never, {
        fn: 'agent-chat',
        errorCode: 'AGENT_PERMISSION_DENIED',
        contextId: toolName,
        orgId: reAuthOrg ?? undefined,
      });
      yield statusEvent('errored', { error: 'PERMISSION_DENIED' });
      // Also append a model-readable tool_result so the model can explain
      messages.push({
        role: 'tool',
        tool_call_id: toolId,
        name: toolName,
        content: JSON.stringify({ error: 'Permission denied. You do not have access to perform this action.' }),
      });
      // Run loop so model can acknowledge (NFR-AW-SEC-003 "surface friendly")
      // But we already emitted errored — stop here per AC-AW-008 assertion
      return;
    }
  }

  // ── FR-AGP-013/015: resume de-dupe gate — inside the single dispatch-forced site ──
  // A write whose (toolName, argsHash-of-VALIDATED-args) matches an already-journaled
  // COMPLETED call is hard-blocked: action.run is never re-invoked; the journaled result
  // is returned as the tool_result instead. NFR-AGP-SEC-004: the hash is computed from
  // validation.value (post-schema), never the raw toolInput.
  const journaled = persist ? findJournaledWrite(persist, toolName, hashToolArgs(validation.value)) : undefined;

  // Step 4: Execute under caller JWT (FR-AW-011, NFR-AW-SEC-002) — unless de-duped.
  let writeResult: unknown;
  if (journaled) {
    writeResult = journaled.payload;
  } else {
    try {
      writeResult = await dispatchActionForced(action, validation.value, deputyCtx);
    } catch {
      // DB error during write
      messages.push({
        role: 'tool',
        tool_call_id: toolId,
        name: toolName,
        content: JSON.stringify({ error: 'Write failed; database error.' }),
      });
      yield* runLoop(req, deps, emit, statusEvent, deputyCtx, messages, persist);
      return;
    }
  }

  // Emit tool event with result + pendingId (AC-AW-001). `input` carries the VALIDATED args
  // (not raw toolInput) so the persistence wrapper's journal hash (FR-AGP-012, NFR-AGP-SEC-004)
  // is computed from the same value dispatchActionForced executed against.
  yield emit('tool', {
    payload: {
      name: toolName,
      pendingId,
      input: validation.value,
      result: writeResult,
    },
  });

  // Emit write_resolved audit event (FR-AW-013, AC-AW-001)
  yield emit('system', {
    text: 'approved',
    payload: {
      event: 'write_resolved',
      decision: 'approved',
      actionName: toolName,
      pendingId,
    },
  });

  // Append write result as tool_result so the model can acknowledge
  messages.push({
    role: 'tool',
    tool_call_id: toolId,
    name: toolName,
    content: JSON.stringify(writeResult),
  });

  // Continue the loop so the model acknowledges
  yield* runLoop(req, deps, emit, statusEvent, deputyCtx, messages, persist);
}

// ── RED-2 remediation (gpt-5.5 red-team audit, HIGH): credit-gate every ────────
// decision/answer CONTINUATION that makes a model call ─────────────────────────

/**
 * True when deps.rateGuard is configured AND the caller is out of credits.
 *
 * Correctness-remediation (finding 2, handlerCreditGateInteractions.test.ts) routes
 * req.decision/req.answer BEFORE the top-level credit gate (3) — correct, because the
 * PURE resolution write (the write_resolved audit event / an answer's tool_result
 * append) never itself costs a model call and must never be credit-blocked at zero
 * balance. But every decision/answer branch ends by calling `runLoop` or
 * `runLoopAfterAnswer` to let the model continue the conversation — and THAT call is a
 * genuine new model turn, indistinguishable in cost from a fresh-send turn. Before this
 * fix, that continuation call was never gated at all (RED-2): a zero-credit user could
 * send a fabricated/stale decision or answer (no real pending item to resolve) and still
 * force a free model call via the un-gated `runLoop`/`runLoopAfterAnswer` fallthrough.
 *
 * This single check, called at the top of both continuation loops, closes that gap for
 * all three shapes uniformly: the stale/absent-pending no-op, a genuine reject (whose
 * OWN resolution — the write_resolved event — already fired in the caller before this
 * check runs), and a genuine answer (whose tool_result append already fired). Only the
 * model-call continuation itself is gated; the resolution that already happened is
 * never rolled back or hidden.
 */
async function isCreditExhausted(deps: HandlerDeps, orgId: string): Promise<{ exceeded: boolean; retryAfterSeconds: number } | null> {
  if (!deps.rateGuard) return null;
  const r = await deps.rateGuard.check(orgId);
  return r.exceeded ? r : null;
}

// ── Inner tool-use loop (reused for the decision continuation) ────────────────

async function* runLoop(
  req: AgentChatRequest,
  deps: HandlerDeps,
  emit: (type: AgentEvent['type'], fields?: Partial<Omit<AgentEvent, 'id' | 'runId' | 'type' | 'createdAt'>>) => AgentEvent,
  statusEvent: (status: AgentRunStatus, extra?: Record<string, unknown>, text?: string) => AgentEvent,
  deputyCtx: import('../../../pmo-portal/src/lib/agent/runtime/port.ts').DeputyContext,
  messages: ModelMessage[],
  persist?: PersistenceRuntime,
): AsyncGenerator<AgentEvent> {
  // req.runId is always present here — runLoop is only reached from handleDecision's
  // branches, and a decision re-POST always carries the runId of the run being resumed.
  const runId = req.runId ?? '';

  // RED-2: this continuation is a genuine new model call — gate it. Whatever pure
  // resolution (write_resolved event / stale-decision no-op) the caller already emitted
  // stays intact; only THIS call is blocked.
  const exhausted = await isCreditExhausted(deps, deputyCtx.orgId);
  if (exhausted) {
    yield statusEvent('errored', { error: 'RATE_LIMITED', retryAfterSeconds: exhausted.retryAfterSeconds });
    return;
  }

  // Decision-continuation pass — see runToolLoop's doc comment for the three enumerated
  // divergences from the main pass: no compose_view (allowCompose:false), no re-proposing
  // a confirm action mid-continuation (allowProposeConfirm:false), and a missing tool_calls[0]
  // completes immediately rather than continuing as an unknown-action error (onMissingToolCall:'complete').
  // TERMINAL by design (correctness-remediation finding 1): a decision resolves a write
  // (approved/rejected) — the continuation must not immediately propose a SECOND pending
  // write, nor emit a compose_view artifact, before the model has acknowledged the first
  // resolution. Used ONLY by handleDecision's approve/reject/no-op branches.
  yield* runToolLoop({
    deps,
    emit,
    statusEvent,
    deputyCtx,
    messages,
    persist,
    runId,
    allowCompose: false,
    allowProposeConfirm: false,
    onMissingToolCall: 'complete',
  });
}

/**
 * Inner tool-use loop for the answer continuation (ADR-0045 §2, correctness-remediation
 * finding 1). Unlike `runLoop` (handleDecision's continuation, deliberately restricted —
 * see its doc comment), answering a pending question RESUMES the user's original request:
 * the model may need to immediately propose a confirm action (needs-approval) or emit a
 * compose_view artifact to actually satisfy what the question was blocking. Runs with the
 * SAME capabilities as the main pass (allowCompose:true, allowProposeConfirm:true) — only
 * `onMissingToolCall` stays 'complete' (a missing tool_calls[0] on a continuation pass is a
 * graceful completion, not a further "unknown action" round — this divergence is orthogonal
 * to compose/propose-confirm and unrelated to the bug being fixed here).
 */
async function* runLoopAfterAnswer(
  req: AgentChatRequest,
  deps: HandlerDeps,
  emit: (type: AgentEvent['type'], fields?: Partial<Omit<AgentEvent, 'id' | 'runId' | 'type' | 'createdAt'>>) => AgentEvent,
  statusEvent: (status: AgentRunStatus, extra?: Record<string, unknown>, text?: string) => AgentEvent,
  deputyCtx: import('../../../pmo-portal/src/lib/agent/runtime/port.ts').DeputyContext,
  messages: ModelMessage[],
  persist?: PersistenceRuntime,
): AsyncGenerator<AgentEvent> {
  // req.runId is always present here — an answer re-POST always carries the runId of the
  // run being resumed (PmoNativeRuntime._doSubscribe always sends the existing runId).
  const runId = req.runId ?? '';

  // RED-2: this continuation is a genuine new model call — gate it. The answer's own
  // resolution (the tool_result append the caller already did, if a real pending question
  // existed) stays intact; only THIS call is blocked.
  const exhausted = await isCreditExhausted(deps, deputyCtx.orgId);
  if (exhausted) {
    yield statusEvent('errored', { error: 'RATE_LIMITED', retryAfterSeconds: exhausted.retryAfterSeconds });
    return;
  }

  yield* runToolLoop({
    deps,
    emit,
    statusEvent,
    deputyCtx,
    messages,
    persist,
    runId,
    allowCompose: true,
    allowProposeConfirm: true,
    onMissingToolCall: 'complete',
  });
}

// ── Trailing unresolved tool_use finder (shared) ───────────────────────────────

interface TrailingToolUse {
  toolId: string;
  toolName: string;
  toolInput: unknown;
}

/**
 * Find the trailing unresolved tool_use in the replayed messages whose block
 * matches `matchToolUse` (D-A3-1's positional idempotency check, generalized —
 * review-remediation item 1 dedupes the former findTrailingConfirmToolUse and
 * findTrailingQuestion, which differed only in which tool_use block they matched).
 *
 * "Unresolved" means: the last assistant message contains a tool_use block
 * satisfying `matchToolUse`, AND the subsequent messages do NOT already contain
 * a matching tool_result for that tool_use_id. If the transcript already has a
 * tool_result for the last matching tool_use, the request is stale/duplicate →
 * return null (AC-AW-003 / AC-ATC-010).
 *
 * NOTE: req.messages (ConversationMessage[]) is the SPA transport shape (Anthropic
 * content-block array), unrelated to ModelClient's wire shape — it is replayed
 * verbatim by the client on the approve/deny/answer re-POST and is NOT touched by
 * the provider swap (FR-MC-006 only changes the model-facing wire representation).
 */
export function findTrailingUnresolvedToolUse(
  messages: ConversationMessage[],
  matchToolUse: (block: { type?: string; name?: string }) => boolean,
): TrailingToolUse | null {
  // Walk backwards to find the last assistant message with a matching tool_use block
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;

    const content = msg.content;
    if (!Array.isArray(content)) continue;

    const toolUseBlock = [...content].reverse().find(
      (b: { type?: string; name?: string }) => b.type === 'tool_use' && matchToolUse(b),
    ) as { type: string; id?: string; name: string; input?: unknown } | undefined;

    if (!toolUseBlock) continue;

    const toolId = toolUseBlock.id ?? 'tool-use-id';
    const toolName = toolUseBlock.name;

    // Check if there's already a tool_result for this tool_use in a subsequent message
    const isAlreadyResolved = messages.slice(i + 1).some((laterMsg) => {
      if (laterMsg.role !== 'user') return false;
      const lContent = laterMsg.content;
      if (!Array.isArray(lContent)) return false;
      return (lContent as Array<{ type?: string; tool_use_id?: string }>).some(
        (b) => b.type === 'tool_result' && b.tool_use_id === toolId,
      );
    });

    if (isAlreadyResolved) return null;

    return { toolId, toolName, toolInput: toolUseBlock.input ?? {} };
  }

  return null;
}

/** matchToolUse for the confirm-action interaction family (D-A3-1). */
function isConfirmToolUse(b: { name?: string }): boolean {
  return BASE_ACTION_BY_NAME.has(b.name ?? '') && BASE_ACTION_BY_NAME.get(b.name ?? '')?.confirm === true;
}

/** matchToolUse for the ask_user question interaction family (ADR-0045 §2). */
function isAskUserToolUse(b: { name?: string }): boolean {
  return b.name === 'ask_user';
}
