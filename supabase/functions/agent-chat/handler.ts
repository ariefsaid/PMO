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

// Turn-module seams (THEME-CROSS-93): the handler composes these; each turn concern
// (types, persistence, presentation, catalog, loop, continuations, confirmed-action
// mechanics) lives in its own module. Every public name this module historically
// exported is re-exported below, so callers and tests keep importing from handler.ts.
import { runExists, createThreadAndRun } from './persistence.ts';
import { makePersistenceRuntime, withPersistence } from './turnPersistence.ts';
import { makeId, mkEvent, narrowEntityScope, buildGroundingHint } from './turnPresentation.ts';
import {
  buildPlanAwarePrompt,
  AUTOMATIONS_ENABLED,
  INVOICE_DRAFTS_ENABLED,
  REMINDERS_ENABLED,
} from './actionCatalog.ts';
import { AGENT_READ_ROW_CAP } from './actions.ts';
import { runToolLoop, MAX_TOOL_ROUNDS, DEFAULT_AGENT_TEMPERATURE, ANSWER_CHECK_TIMEOUT_MS, MAX_PARALLEL_READS } from './toolLoop.ts';
import { handleAnswer, handleDecision, isCreditExhausted } from './turnContinuations.ts';
import { loadOrgFeatureSwitches } from './featureResolution.ts';
import { isAssistantEnabled } from './featureSwitches.ts';
import { createAiRunTelemetry, type AiRunTelemetry } from './aiTelemetry.ts';
import type { AgentEvent, AgentRunStatus } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';
import type { AgentChatRequest } from '../../../pmo-portal/src/lib/agent/runtime/transport.ts';
import type { ModelMessage } from '../_shared/modelClient.ts';
import type { HandlerDeps, CanFn } from './handlerTypes.ts';
import type { PersistenceRuntime } from './handlerTypes.ts';

// ── Constants (D7) ────────────────────────────────────────────────────────────
// MAX_TOOL_ROUNDS / DEFAULT_AGENT_TEMPERATURE / ANSWER_CHECK_TIMEOUT_MS /
// MAX_PARALLEL_READS live in toolLoop.ts (their only consumers) and are re-exported below.

/** Final-answer verification is on unless explicitly disabled (answerVerificationEnabled). */
export const answerVerificationEnabled = (value: string | undefined): boolean => value !== 'false';

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

  const ai = createAiRunTelemetry({
    runId, threadId: req.threadId, action: deps.usageAction ?? 'chat', userId: deps.userId,
    analytics: req.analytics, modelClient: deps.modelClient, model: deps.model,
    // S4 (FR-PLN-009): the route the turn came from rides along for the missing-tool signal (templated
    // before it is sent). ADR-0045 §3 already carries it on the wire; it is a grouping hint only.
    ...(req.context?.route ? { route: req.context.route } : {}),
  });
  const creditHolds: string[] = [];
  const aiDeps = { ...deps, ai, creditHolds };
  try {
    yield* withAiTrace(withPersistence(agentChatHandlerInner(req, aiDeps, runId, persist), persist, runId), ai);
  } finally {
    // Every exit path (completed, errored, abandoned stream) drops this request's holds; the usage
    // rows that replace them have landed by now, so the spend is counted once.
    for (const id of creditHolds) await deps.rateGuard?.release?.(id);
  }
}

/** Feeds the per-run AI telemetry from the event stream; emits the `$ai_trace` at terminal status. */
async function* withAiTrace(inner: AsyncGenerator<AgentEvent>, ai: AiRunTelemetry): AsyncGenerator<AgentEvent> {
  for await (const ev of inner) {
    ai.observe(ev);
    if (ev.type === 'status') {
      const p = ev.payload as { status?: AgentRunStatus; error?: string } | undefined;
      if (p?.status === 'completed' || p?.status === 'errored') ai.trace(p.status, p.status === 'errored' ? p.error : undefined);
    }
    yield ev;
  }
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
  //
  // S4 (FR-PLN-008): resolve the caller org's plan switches ONCE for this request, under the caller's
  // own JWT (never service role). Every loop and action below reads this one snapshot, so a switch
  // change mid-turn cannot half-apply. `null` (resolver unavailable) means nothing is known to be off.
  const featureSwitches = await loadOrgFeatureSwitches(deps.supabase);

  // ── S4 (FR-PLN-006 / D6): `agent_assistant` off is a REFUSAL, not just a hidden tool ──────────
  // This is the ONE enforcement point on the edge for the assistant capability itself. Every assistant
  // run reaches it: interactive chat, the decision/answer continuations, and the fired-automation
  // runner (agent-dispatch drives this same handler under a minted owner client). Refused BEFORE any
  // model call or write, so an off key cannot spend a token or touch a row. Explicit `false` only: an
  // unresolved snapshot keeps the read assistant available (the offering filter's fail-open rule).
  if (!isAssistantEnabled(featureSwitches)) {
    yield statusEvent('errored', { error: 'FEATURE_OFF', detail: 'assistant' });
    return;
  }

  const deputyCtx: import('../../../pmo-portal/src/lib/agent/runtime/port.ts').DeputyContext = {
    jwt: '',
    userId: deps.userId,
    orgId,
    role: initialRole,
    supabase: deps.supabase as unknown as import('../../../pmo-portal/src/lib/agent/runtime/port.ts').SupabaseLike,
    featureSwitches,
  };

  // ── A3: Decision branch (req.decision present → approve/reject a pending write) ──
  // Correctness-remediation (finding 2): routed BEFORE the credit gate below — resolving
  // a pending decision (the write_resolved audit event + tool_result injection for
  // reject/approve) never itself costs a model call, so it must never be credit-blocked.
  // The SUBSEQUENT model turn inside handleDecision's own continuation call IS a genuine new
  // model call and is NOT exempted — RED-2 (gpt-5.5 red-team audit) hardened this: runContinuation
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
  // runContinuation call) IS a genuine new model call — RED-2 hardened this the same
  // way as the decision branch: runContinuation now gates itself on deps.rateGuard
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
  const blocked = await isCreditExhausted(deps, orgId);
  if (blocked) {
    yield statusEvent('errored', {
      error: 'RATE_LIMITED',
      retryAfterSeconds: blocked.retryAfterSeconds,
    });
    return;
  }

  // ── Yield the last user message ────────────────────────────────────────────
  const lastUserMsg = req.messages.filter((m) => m.role === 'user').at(-1);
  if (lastUserMsg) {
    yield emit('user', {
      text: typeof lastUserMsg.content === 'string' ? lastUserMsg.content : undefined,
    });
  }

  // ── Build system prompt (+ ADR-0045 §3 untrusted grounding hint) ──────────
  const system = buildPlanAwarePrompt(AGENT_READ_ROW_CAP, initialRole, deputyCtx, {
    composeEnabled: deps.composeEnabled,
    automationsEnabled: AUTOMATIONS_ENABLED,
    invoiceDraftsEnabled: INVOICE_DRAFTS_ENABLED,
    remindersEnabled: REMINDERS_ENABLED,
  }, true) + buildGroundingHint(req.context?.entity);

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

// ── Public surface (compatibility re-exports) ─────────────────────────────────
// The turn modules own these definitions now; handler.ts remains the import seam
// for every name it exported before the split (tests and callers unchanged).
export type {
  HandlerDeps,
  HandlerSupabaseLike,
  RateGuard,
  CanFn,
  PersistenceRuntime,
} from './handlerTypes.ts';
export type { PersistenceDeps, JournaledWrite, ToolJournal } from './persistence.ts';
export {
  stepLabel,
  isRenderedAnswer,
  makeId,
  mkEvent,
  buildGroundingHint,
  narrowEntityScope,
  timedSpan,
} from './turnPresentation.ts';
export {
  BASE_ACTIONS,
  buildTools,
  AUTOMATIONS_ENABLED,
  INVOICE_DRAFTS_ENABLED,
  REMINDERS_ENABLED,
} from './actionCatalog.ts';
export {
  runToolLoop,
  MAX_TOOL_ROUNDS,
  DEFAULT_AGENT_TEMPERATURE,
  ANSWER_CHECK_TIMEOUT_MS,
  MAX_PARALLEL_READS,
} from './toolLoop.ts';
export {
  handleAnswer,
  handleDecision,
  isCreditExhausted,
  findTrailingUnresolvedToolUse,
  runContinuation,
} from './turnContinuations.ts';
export {
  dispatchAction,
  dispatchActionForced,
  resolveNeedsApproval,
  getPermissionCheck,
  auditAgentDenial,
  rederiveDeputyAuth,
  findValidatedJournal,
} from './confirmedAction.ts';
export {
  makePersistenceRuntime,
  findJournaledWrite,
  withPersistence,
} from './turnPersistence.ts';
