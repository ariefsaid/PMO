/**
 * agentChatHandler — pure async generator for the agent-chat edge function.
 *
 * Pure: all I/O injected via HandlerDeps. No Deno globals, no process.env.
 * Importable in Vitest (Node) with Anthropic SDK + Supabase mocked.
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

/** Minimal Anthropic-like interface for messages.create. */
export interface AnthropicLike {
  messages: {
    create(params: AnthropicCreateParams): Promise<AnthropicResponse>;
  };
}

export interface AnthropicCreateParams {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string | object[] }>;
  tools: Array<{ name: string; description: string; input_schema: object }>;
}

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: unknown;
}

export interface AnthropicResponse {
  stop_reason: string;
  content: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

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
  anthropic: AnthropicLike;
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
 *   (5) 502 UPSTREAM_ERROR — SDK throws; error scrubbed (AC-AR-005)
 */
export async function* agentChatHandler(
  req: AgentChatRequest,
  deps: HandlerDeps,
): AsyncIterable<AgentEvent> {
  const now = deps.now ?? (() => new Date());
  const runId = req.runId ?? makeId();
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
    yield* handleDecision(req, deps, emit, statusEvent, canFn, deputyCtx);
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

  // The full conversation messages for the Anthropic API
  const messages: Array<{ role: 'user' | 'assistant'; content: string | object[] }> =
    req.messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === 'string'
          ? m.content
          : (m.content as object[]),
    }));

  // ── Build tool catalog (A4: flag-gated compose_view, FR-CV-024, D7) ─────────
  // compose_view is included only when deps.composeEnabled is true.
  const tools: Array<{ name: string; description: string; input_schema: object }> =
    BASE_ACTIONS.map((a) => ({
      name: a.name,
      description: a.description,
      input_schema: a.inputSchema,
    }));
  if (deps.composeEnabled) {
    tools.push({
      name: composeViewAction.name,
      description: composeViewAction.description,
      input_schema: composeViewAction.inputSchema,
    });
  }
  // Per-call action lookup map (includes compose_view when enabled)
  const actionByName = new Map<string, AgentAction>(BASE_ACTIONS.map((a) => [a.name, a]));

  // ── Tool-use loop (AC-AR-001, AC-AR-004) ──────────────────────────────────
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const resp = await deps.anthropic.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 2048,
        system,
        messages,
        tools,
      });

      // Emit any text blocks as assistant events
      for (const block of resp.content) {
        if (block.type === 'text' && block.text) {
          yield emit('assistant', { text: block.text });
        }
      }

      // Blocker 3: use the API's own sentinel — stop_reason !== 'tool_use' means
      // no tool dispatch needed, regardless of whether content happens to contain
      // a tool_use block. Also handle max_tokens explicitly.
      if (resp.stop_reason === 'max_tokens') {
        yield statusEvent('completed', {}, 'response truncated');
        return;
      }

      const toolBlock = resp.content.find((b) => b.type === 'tool_use');

      if (resp.stop_reason !== 'tool_use') {
        yield statusEvent('completed');
        return;
      }

      const toolInput = toolBlock!.input;
      const toolId = toolBlock!.id ?? 'tool-use-id';
      const toolName = toolBlock!.name ?? '';

      // ── A4: compose_view dispatch branch (ADR-0041 model-calling-action seam) ──
      // The handler owns the anthropic client; it curries it into runComposeView.
      // composeViewAction.run is a guard stub and is NEVER called here (ADR-0041).
      if (toolName === 'compose_view' && deps.composeEnabled) {
        const out = await runComposeView(
          toolInput as { prompt: string },
          { jwt: '', userId: deps.userId, orgId, supabase: deps.supabase as unknown as import('../../../pmo-portal/src/lib/agent/runtime/port').SupabaseLike },
          { anthropic: deps.anthropic },
        );

        if ('error' in out) {
          // Compose failed — emit user-facing assistant error (FR-CV-006)
          yield emit('assistant', {
            text: "I wasn't able to compose a valid view — try rephrasing your request.",
          });
          // Feed a tool_result so the conversation loop can continue/close
          messages.push({
            role: 'assistant',
            content: [{ type: 'tool_use', id: toolId, name: toolName, input: toolInput }],
          });
          messages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolId,
                content: JSON.stringify({ error: out.error, code: out.code }),
              },
            ],
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
            role: 'assistant',
            content: [{ type: 'tool_use', id: toolId, name: toolName, input: toolInput }],
          });
          messages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolId,
                content: JSON.stringify({ ok: true, panels: out.spec.panels.length }),
              },
            ],
          });
        }
        continue;
      }

      const action = actionByName.get(toolName);
      if (!action) {
        // Unknown action — return structured error to model
        messages.push({
          role: 'assistant',
          content: [{ type: 'tool_use', id: toolId, name: toolName, input: toolInput }],
        });
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolId,
              content: JSON.stringify({ error: `unknown action: ${toolName}` }),
            },
          ],
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
            role: 'assistant',
            content: [{ type: 'tool_use', id: toolId, name: toolName, input: toolInput }],
          });
          messages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolId,
                content: JSON.stringify({ error: validation.error }),
              },
            ],
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

      // Append assistant tool_use turn + user tool_result turn for the next round
      messages.push({
        role: 'assistant',
        content: [{ type: 'tool_use', id: toolId, name: toolName, input: toolInput }],
      });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolId,
            content: JSON.stringify(toolResult),
          },
        ],
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
): AsyncGenerator<AgentEvent> {
  const decision = req.decision!;
  const { pendingId, verdict } = decision;

  // Yield the last user message (may be a tool_result content in the replayed messages)
  const lastUserMsg = req.messages.filter((m) => m.role === 'user').at(-1);
  if (lastUserMsg && typeof lastUserMsg.content === 'string') {
    yield emit('user', { text: lastUserMsg.content });
  }

  const system = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP);

  const messages: Array<{ role: 'user' | 'assistant'; content: string | object[] }> =
    req.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : (m.content as object[]),
    }));

  // ── Find trailing unresolved confirm-action tool_use (positional match) ────
  // The trailing unresolved tool_use is the last assistant message's last tool_use block
  // that does NOT already have a matching tool_result in the next user message.
  const trailingToolUse = findTrailingConfirmToolUse(req.messages);

  if (!trailingToolUse) {
    // No pending confirm action — stale/duplicate decision; treat as no-op (AC-AW-003)
    // Just run the model to continue normally.
    yield* runLoop(req, deps, emit, statusEvent, deputyCtx, system, messages);
    return;
  }

  const { toolId, toolName, toolInput } = trailingToolUse;
  const action = BASE_ACTION_BY_NAME.get(toolName);

  if (!action || !action.confirm) {
    // Action not found or not a confirm action → no-op
    yield* runLoop(req, deps, emit, statusEvent, deputyCtx, system, messages);
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
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolId,
          content: JSON.stringify({ result: 'Write action declined by user.' }),
        },
      ],
    });

    yield* runLoop(req, deps, emit, statusEvent, deputyCtx, system, messages);
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
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolId,
          content: JSON.stringify({ error: `Invalid args on approval: ${validation.error}` }),
        },
      ],
    });
    yield* runLoop(req, deps, emit, statusEvent, deputyCtx, system, messages);
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
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolId,
            content: JSON.stringify({ error: 'Permission denied. You do not have access to perform this action.' }),
          },
        ],
      });
      // Run loop so model can acknowledge (NFR-AW-SEC-003 "surface friendly")
      // But we already emitted errored — stop here per AC-AW-008 assertion
      return;
    }
  }

  // Step 4: Execute under caller JWT (FR-AW-011, NFR-AW-SEC-002)
  let writeResult: unknown;
  try {
    writeResult = await dispatchActionForced(action, validation.value, deputyCtx);
  } catch {
    // DB error during write
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolId,
          content: JSON.stringify({ error: 'Write failed; database error.' }),
        },
      ],
    });
    yield* runLoop(req, deps, emit, statusEvent, deputyCtx, system, messages);
    return;
  }

  // Emit tool event with result + pendingId (AC-AW-001)
  yield emit('tool', {
    payload: {
      name: toolName,
      pendingId,
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
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: toolId,
        content: JSON.stringify(writeResult),
      },
    ],
  });

  // Continue the loop so the model acknowledges
  yield* runLoop(req, deps, emit, statusEvent, deputyCtx, system, messages);
}

// ── Inner tool-use loop (reused for the decision continuation) ────────────────

async function* runLoop(
  req: AgentChatRequest,
  deps: HandlerDeps,
  emit: (type: AgentEvent['type'], fields?: Partial<Omit<AgentEvent, 'id' | 'runId' | 'type' | 'createdAt'>>) => AgentEvent,
  statusEvent: (status: AgentRunStatus, extra?: Record<string, unknown>, text?: string) => AgentEvent,
  deputyCtx: import('../../../pmo-portal/src/lib/agent/runtime/port').DeputyContext,
  system: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string | object[] }>,
): AsyncGenerator<AgentEvent> {
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const resp = await deps.anthropic.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 2048,
        system,
        messages,
        tools: BASE_ACTIONS.map((a) => ({
          name: a.name,
          description: a.description,
          input_schema: a.inputSchema,
        })),
      });

      for (const block of resp.content) {
        if (block.type === 'text' && block.text) {
          yield emit('assistant', { text: block.text });
        }
      }

      if (resp.stop_reason === 'max_tokens') {
        yield statusEvent('completed', {}, 'response truncated');
        return;
      }

      if (resp.stop_reason !== 'tool_use') {
        yield statusEvent('completed');
        return;
      }

      const toolBlock = resp.content.find((b) => b.type === 'tool_use');
      if (!toolBlock) {
        yield statusEvent('completed');
        return;
      }

      const toolId = toolBlock.id ?? 'tool-use-id';
      const toolName = toolBlock.name ?? '';
      const toolInput = toolBlock.input;

      const action = BASE_ACTION_BY_NAME.get(toolName);
      if (!action || action.confirm) {
        // Unknown action or confirm action called from runLoop — return error to model
        messages.push({
          role: 'assistant',
          content: [{ type: 'tool_use', id: toolId, name: toolName, input: toolInput }],
        });
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolId,
              content: JSON.stringify({ error: `action '${toolName}' not available in this context` }),
            },
          ],
        });
        continue;
      }

      const toolResult = await dispatchAction(action, toolInput, deputyCtx);

      yield emit('tool', { payload: { name: toolName, input: toolInput, result: toolResult } });

      messages.push({
        role: 'assistant',
        content: [{ type: 'tool_use', id: toolId, name: toolName, input: toolInput }],
      });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolId,
            content: JSON.stringify(toolResult),
          },
        ],
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
