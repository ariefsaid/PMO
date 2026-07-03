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
  AGENT_READ_ENTITIES,
  AGENT_READ_ROW_CAP,
} from './actions';
import { buildAgentSystemPrompt } from './prompt';
import {
  hashToolArgs,
  createThreadAndRun,
  insertEvent,
  heartbeat,
  setRunStatus,
} from './persistence';
import type { PersistenceDeps, JournaledWrite, ToolJournal } from './persistence';
import type { ModelClient, ModelMessage, ModelTool } from '../_shared/modelClient';
import type { AgentEvent, AgentRunStatus, AgentAction } from '../../../pmo-portal/src/lib/agent/runtime/port';
import type { AgentChatRequest, ConversationMessage } from '../../../pmo-portal/src/lib/agent/runtime/transport';

// ── Constants (D7) ────────────────────────────────────────────────────────────

/** Hard cap on tool-use rounds per run. D7. */
export const MAX_TOOL_ROUNDS = 8;

// ── Action registry (A3) ──────────────────────────────────────────────────────

/** Base read+write actions (always registered). */
const BASE_ACTIONS: AgentAction[] = [queryEntityAction, createActivityAction, updateTaskStatusAction];
const BASE_ACTION_BY_NAME = new Map<string, AgentAction>(BASE_ACTIONS.map((a) => [a.name, a]));

// ACTIONS and ACTION_BY_NAME are built per-call based on composeEnabled (Task 7/FR-CV-024).
// They are kept as module-level variables for the runLoop/handleDecision helpers which
// don't receive composeEnabled directly; the handler passes the right map to helpers.

// ── Injected interfaces ────────────────────────────────────────────────────────

/**
 * Minimal Supabase-like interface supporting:
 *   - profiles lookup: .from('profiles').select('org_id, role').eq().single()
 *   - entity reads: .from(t).select(cols).limit() / .eq().limit() / .in().limit()
 *   - write actions: .from(t).insert(row).select().single() / .update(patch).eq()
 */
export interface HandlerSupabaseLike {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        single(): Promise<{ data: { org_id: string; role?: string } | null; error: unknown }>;
        limit(n: number): Promise<{ data: unknown[] | null; error: unknown }>;
        in(column: string, values: string[]): { limit(n: number): Promise<{ data: unknown[] | null; error: unknown }> };
      };
      limit(n: number): Promise<{ data: unknown[] | null; error: unknown }>;
    };
    insert(row: object): {
      select(): {
        single(): Promise<{ data: unknown; error: unknown }>;
      };
    };
    update(patch: object): {
      eq(column: string, value: string): Promise<{ data: unknown; error: unknown }>;
    };
  };
}

/** Injectable rate guard (AS-OD-002 — disabled by default). */
export interface RateGuard {
  check(userId: string): Promise<{ exceeded: boolean; retryAfterSeconds: number }>;
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
   * A3: injectable can() predicate. If omitted, defaults to deny-all (safe default).
   * Production: pass `can` from src/auth/policy.ts.
   */
  can?: CanFn;
  /**
   * A4: flag-gated compose_view tool registration (FR-CV-024, D7).
   * The AND-result of (agentAssistant && aiComposer) is computed by the caller
   * (SPA → index.ts) and passed here, because Deno can't read Vite FEATURES.
   * When undefined/false, compose_view is absent from the tool catalog (AC-CV-002).
   */
  composeEnabled?: boolean;
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
  ctx: import('../../../pmo-portal/src/lib/agent/runtime/port').DeputyContext,
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
  ctx: import('../../../pmo-portal/src/lib/agent/runtime/port').DeputyContext,
): Promise<unknown> {
  return action.run(validatedInput, ctx);
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

// ── Tool catalog builder (FR-MC-017) ──────────────────────────────────────────

function buildTools(composeEnabled: boolean | undefined): ModelTool[] {
  const tools: ModelTool[] = BASE_ACTIONS.map((a) => ({
    type: 'function',
    function: { name: a.name, description: a.description, parameters: a.inputSchema },
  }));
  if (composeEnabled) {
    tools.push({
      type: 'function',
      function: { name: composeViewAction.name, description: composeViewAction.description, parameters: composeViewAction.inputSchema },
    });
  }
  return tools;
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * agentChatHandler — the pure business-logic generator.
 *
 * Gate order (each gate yields terminal status and returns):
 *   (1) 401 UNAUTHORIZED — userId empty (AC-AR-002)
 *   (2) 400 BAD_REQUEST(orgId) — profiles lookup fails (AC-AR-003)
 *   (3) 429 RATE_LIMITED — rate guard exceeded (D9/AR-OD-002)
 *   (A3-decision) approve/deny branch — when req.decision is present
 *   (4) tool-use loop — up to MAX_TOOL_ROUNDS (AC-AR-001, AC-AR-004)
 *   (5) 502 UPSTREAM_ERROR — model call throws; error scrubbed (AC-AR-005)
 */
export async function* agentChatHandler(
  req: AgentChatRequest,
  deps: HandlerDeps,
): AsyncIterable<AgentEvent> {
  const runId = req.runId ?? makeId();
  const persist = makePersistenceRuntime(deps);

  // FR-AGP-010: a fresh run (no req.runId on the wire) gets a new agent_threads + agent_runs
  // row, created BEFORE any event is persisted (insertEvent's run_id FK requires the run to
  // exist first). Only on a genuinely new run — a resume/decision re-POST already carries
  // req.runId and its thread/run rows already exist.
  if (persist && !req.runId) {
    const lastUserMsgForTitle = req.messages.filter((m) => m.role === 'user').at(-1);
    const title =
      lastUserMsgForTitle && typeof lastUserMsgForTitle.content === 'string'
        ? lastUserMsgForTitle.content.slice(0, 60)
        : 'New conversation';
    await createThreadAndRun(persist.deps, { runId, title, scope: req.context ?? null });
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

  // ── Gate (3): rate guard (AR-OD-002, D9) ─────────────────────────────────
  if (deps.rateGuard) {
    const r = await deps.rateGuard.check(deps.userId);
    if (r.exceeded) {
      yield statusEvent('errored', {
        error: 'RATE_LIMITED',
        retryAfterSeconds: r.retryAfterSeconds,
      });
      return;
    }
  }

  // ── Build deputy context ───────────────────────────────────────────────────
  const deputyCtx: import('../../../pmo-portal/src/lib/agent/runtime/port').DeputyContext = {
    jwt: '',
    userId: deps.userId,
    orgId,
    supabase: deps.supabase as unknown as import('../../../pmo-portal/src/lib/agent/runtime/port').SupabaseLike,
  };

  // ── A3: Decision branch (req.decision present → approve/reject a pending write) ──
  if (req.decision) {
    yield* handleDecision(req, deps, emit, statusEvent, canFn, deputyCtx, persist);
    return;
  }

  // ── Yield the last user message ────────────────────────────────────────────
  const lastUserMsg = req.messages.filter((m) => m.role === 'user').at(-1);
  if (lastUserMsg) {
    yield emit('user', {
      text: typeof lastUserMsg.content === 'string' ? lastUserMsg.content : undefined,
    });
  }

  // ── Build system prompt ────────────────────────────────────────────────────
  const system = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP);

  // The full conversation messages for the model call — system prompt is
  // messages[0] (FR-MC-003), replacing Anthropic's top-level `system` field.
  const messages: ModelMessage[] = [
    { role: 'system', content: system },
    ...req.messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === 'string'
          ? m.content
          : null,
    })),
  ];

  // ── Build tool catalog (A4: flag-gated compose_view, FR-CV-024, D7) ─────────
  const tools = buildTools(deps.composeEnabled);
  // Per-call action lookup map (includes compose_view when enabled)
  const actionByName = new Map<string, AgentAction>(BASE_ACTIONS.map((a) => [a.name, a]));

  // ── Tool-use loop (AC-AR-001, AC-AR-004) ──────────────────────────────────
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // FR-AGP-014: heartbeat once per model turn (round), before the model call.
      if (persist) await heartbeat(persist.deps, runId, `round-${round}`);

      const resp = await deps.modelClient.create({
        model: deps.model,
        max_tokens: 2048,
        messages,
        tools,
      });

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
      const toolInput = toolCall ? JSON.parse(toolCall.function.arguments) : {};
      const toolId = toolCall?.id ?? 'tool-use-id';
      const toolName = toolCall?.function.name ?? '';

      // Push the assistant's tool-call turn (FR-MC-006 — the assistant message
      // with tool_calls IS the turn; no separate echo needed).
      messages.push({ role: 'assistant', content: resp.message.content, tool_calls: resp.message.tool_calls });

      // ── A4: compose_view dispatch branch (ADR-0041 model-calling-action seam) ──
      // The handler owns the model client; it curries it into runComposeView.
      // composeViewAction.run is a guard stub and is NEVER called here (ADR-0041).
      if (toolName === 'compose_view' && deps.composeEnabled) {
        const out = await runComposeView(
          toolInput as { prompt: string },
          { jwt: '', userId: deps.userId, orgId, supabase: deps.supabase as unknown as import('../../../pmo-portal/src/lib/agent/runtime/port').SupabaseLike },
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

      const action = actionByName.get(toolName);
      if (!action) {
        // Unknown action — return structured error to model
        messages.push({
          role: 'tool',
          tool_call_id: toolId,
          name: toolName,
          content: JSON.stringify({ error: `unknown action: ${toolName}` }),
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

        // Valid args → emit needs-approval and END the stream (D-A3-1)
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

      // ── Read action (confirm:false) — dispatch immediately ─────────────────
      const toolResult = await dispatchAction(action, toolInput, deputyCtx);

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

    // Loop fell through — step cap reached (D7/R4: graceful completed, not errored)
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
  deputyCtx: import('../../../pmo-portal/src/lib/agent/runtime/port').DeputyContext,
  persist?: PersistenceRuntime,
): AsyncGenerator<AgentEvent> {
  const decision = req.decision!;
  const { pendingId, verdict } = decision;

  // Yield the last user message (may be a tool_result content in the replayed messages)
  const lastUserMsg = req.messages.filter((m) => m.role === 'user').at(-1);
  if (lastUserMsg && typeof lastUserMsg.content === 'string') {
    yield emit('user', { text: lastUserMsg.content });
  }

  const system = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP);

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
  const trailingToolUse = findTrailingConfirmToolUse(req.messages);

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
  } catch {
    yield statusEvent('errored', { error: 'AUTH_EXPIRED' });
    return;
  }

  // Step 3: can() preflight (AC-AW-008, FR-AW-010)
  const permCheck = getPermissionCheck(toolName);
  if (permCheck) {
    const allowed = canFn(permCheck.action, permCheck.entity, { realRole: reAuthRole });
    if (!allowed) {
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

// ── Inner tool-use loop (reused for the decision continuation) ────────────────

async function* runLoop(
  req: AgentChatRequest,
  deps: HandlerDeps,
  emit: (type: AgentEvent['type'], fields?: Partial<Omit<AgentEvent, 'id' | 'runId' | 'type' | 'createdAt'>>) => AgentEvent,
  statusEvent: (status: AgentRunStatus, extra?: Record<string, unknown>, text?: string) => AgentEvent,
  deputyCtx: import('../../../pmo-portal/src/lib/agent/runtime/port').DeputyContext,
  messages: ModelMessage[],
  persist?: PersistenceRuntime,
): AsyncGenerator<AgentEvent> {
  // req.runId is always present here — runLoop is only reached from handleDecision's
  // branches, and a decision re-POST always carries the runId of the run being resumed.
  const runId = req.runId ?? '';
  try {
    const tools: ModelTool[] = BASE_ACTIONS.map((a) => ({
      type: 'function',
      function: { name: a.name, description: a.description, parameters: a.inputSchema },
    }));

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // FR-AGP-014: heartbeat once per model turn (round), before the model call.
      if (persist) await heartbeat(persist.deps, runId, `round-${round}`);

      const resp = await deps.modelClient.create({
        model: deps.model,
        max_tokens: 2048,
        messages,
        tools,
      });

      if (resp.message.content) {
        yield emit('assistant', { text: resp.message.content });
      }

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
      if (!toolCall) {
        yield statusEvent('completed', {
          model: resp.model,
          prompt_tokens: resp.usage?.prompt_tokens,
          completion_tokens: resp.usage?.completion_tokens,
          ...(resp.usage?.total_cost !== undefined ? { total_cost: resp.usage.total_cost } : {}),
        });
        return;
      }

      const toolId = toolCall.id;
      const toolName = toolCall.function.name;
      const toolInput = JSON.parse(toolCall.function.arguments);

      messages.push({ role: 'assistant', content: resp.message.content, tool_calls: resp.message.tool_calls });

      const action = BASE_ACTION_BY_NAME.get(toolName);
      if (!action || action.confirm) {
        // Unknown action or confirm action called from runLoop — return error to model
        messages.push({
          role: 'tool',
          tool_call_id: toolId,
          name: toolName,
          content: JSON.stringify({ error: `action '${toolName}' not available in this context` }),
        });
        continue;
      }

      const toolResult = await dispatchAction(action, toolInput, deputyCtx);

      yield emit('tool', { payload: { name: toolName, input: toolInput, result: toolResult } });

      messages.push({
        role: 'tool',
        tool_call_id: toolId,
        name: toolName,
        content: JSON.stringify(toolResult),
      });
    }

    yield statusEvent('completed', {}, 'reached step limit');
  } catch {
    console.error('[agent-chat] UPSTREAM_ERROR', { errorCode: 'UPSTREAM_ERROR', round: 'unknown' });
    yield statusEvent('errored', { error: 'UPSTREAM_ERROR' });
  }
}

// ── Trailing unresolved confirm tool_use finder ────────────────────────────────

interface TrailingToolUse {
  toolId: string;
  toolName: string;
  toolInput: unknown;
}

/**
 * Find the trailing unresolved confirm-action tool_use in the replayed messages.
 *
 * "Unresolved" means: the last assistant message contains a tool_use block for a
 * confirm:true action, AND the subsequent messages do NOT already contain a matching
 * tool_result for that tool_use_id.
 *
 * This is the positional idempotency check (D-A3-1 / AC-AW-003):
 * if the transcript already has a tool_result for the last tool_use, the decision
 * is stale/duplicate → return null.
 *
 * NOTE: req.messages (ConversationMessage[]) is the SPA transport shape (Anthropic
 * content-block array), unrelated to ModelClient's wire shape — it is replayed
 * verbatim by the client on the approve/deny re-POST and is NOT touched by the
 * provider swap (FR-MC-006 only changes the model-facing wire representation).
 */
function findTrailingConfirmToolUse(
  messages: ConversationMessage[],
): TrailingToolUse | null {
  // Walk backwards to find the last assistant message with a tool_use content block
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;

    const content = msg.content;
    if (!Array.isArray(content)) continue;

    // Find a tool_use block for a confirm action
    const toolUseBlock = [...content].reverse().find(
      (b: { type?: string; name?: string }) =>
        b.type === 'tool_use' &&
        BASE_ACTION_BY_NAME.has(b.name ?? '') &&
        (BASE_ACTION_BY_NAME.get(b.name ?? '')?.confirm === true),
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
