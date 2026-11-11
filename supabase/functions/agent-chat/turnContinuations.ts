/**
 * turnContinuations — the re-POST continuation family (THEME-CROSS-93): handleAnswer
 * (ADR-0045 §2 pending-question resolution), handleDecision (A3 stateless approve/deny),
 * the shared credit-gated continuation loop (RED-2) and the trailing-unresolved tool_use
 * finder both interactions resolve through. Re-auth, denial audit, journal de-dupe and the
 * forced dispatch come from confirmedAction; the loop from toolLoop.
 */
import type { AgentChatRequest, ConversationMessage } from '../../../pmo-portal/src/lib/agent/runtime/transport.ts';
import type { ModelMessage } from '../_shared/modelClient.ts';
import { writeRefusalFor } from './featureSwitches.ts';
import { buildPlanAwarePrompt, BASE_ACTION_BY_NAME, AUTOMATIONS_ENABLED, INVOICE_DRAFTS_ENABLED, REMINDERS_ENABLED } from './actionCatalog.ts';
import { buildGroundingHint, makeId, timedSpan } from './turnPresentation.ts';
import { getPermissionCheck, auditAgentDenial, rederiveDeputyAuth, dispatchActionForced, findValidatedJournal } from './confirmedAction.ts';
import { runToolLoop } from './toolLoop.ts';
import { AGENT_READ_ROW_CAP } from './actions.ts';
import { recordErrorEvent } from '../_shared/errorEvent.ts';
import type { AgentEvent, AgentRunStatus, AgentAction } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';
import type { HandlerDeps, PersistenceRuntime, CanFn } from './handlerTypes.ts';
import { wrapUntrustedToolResult } from './untrustedEnvelope.ts';

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
 *    (AC-ATC-009) via the answer continuation loop — never a new createRun.
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
 * So the answer-continuation runs via runContinuation(..., 'answer') (allowCompose:true,
 * allowProposeConfirm:true — the SAME capabilities as the main pass), not the decision
 * continuation (which stays allowCompose:false/allowProposeConfirm:false, used only by
 * handleDecision).
 */
export async function* handleAnswer(
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
  const system = buildPlanAwarePrompt(AGENT_READ_ROW_CAP, initialRole, deputyCtx, {
    composeEnabled: deps.composeEnabled,
    automationsEnabled: AUTOMATIONS_ENABLED,
    invoiceDraftsEnabled: INVOICE_DRAFTS_ENABLED,
    remindersEnabled: REMINDERS_ENABLED,
  }, true) + buildGroundingHint(req.context?.entity);

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

  yield* runContinuation(req, deps, emit, statusEvent, deputyCtx, messages, persist, 'answer');
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
export async function* handleDecision(
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
  deps.ai?.setOrg(deputyCtx.orgId, deps.supabase);

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
  const system = buildPlanAwarePrompt(AGENT_READ_ROW_CAP, initialRole, deputyCtx, {
    composeEnabled: false,
    automationsEnabled: AUTOMATIONS_ENABLED,
    invoiceDraftsEnabled: INVOICE_DRAFTS_ENABLED,
    remindersEnabled: REMINDERS_ENABLED,
  }, false) + buildGroundingHint(req.context?.entity);

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
    yield* runContinuation(req, deps, emit, statusEvent, deputyCtx, messages, persist, 'decision');
    return;
  }

  const { toolId, toolName, toolInput } = trailingToolUse;
  const action = BASE_ACTION_BY_NAME.get(toolName);

  if (!action || !action.confirm) {
    // Action not found or not a confirm action → no-op
    yield* runContinuation(req, deps, emit, statusEvent, deputyCtx, messages, persist, 'decision');
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

    yield* runContinuation(req, deps, emit, statusEvent, deputyCtx, messages, persist, 'decision');
    return;
  }

  // ── Approve path ───────────────────────────────────────────────────────────

  // Step 1: Re-validate args (D-A3-2, defence-in-depth)
  // ADR-0079 §2: a prepared action's replayed input IS the resolved record the user saw — validate THAT
  // (allow-list rebuild), never the original model request.
  const validation: { ok: boolean; error?: string; value?: unknown } = action.validatePrepared
    ? action.validatePrepared(toolInput)
    : writeAction.validate(toolInput);
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
    yield* runContinuation(req, deps, emit, statusEvent, deputyCtx, messages, persist, 'decision');
    return;
  }

  // Step 2: Deputy re-auth — re-derive org + role (AC-AW-004). The SAME shared lookup the
  // auto-approval path runs (confirmedAction.rederiveDeputyAuth); on failure this path emits
  // its own AUTH_EXPIRED terminal event.
  const reAuth = await rederiveDeputyAuth(deps);
  if (!reAuth) {
    yield statusEvent('errored', { error: 'AUTH_EXPIRED' });
    return;
  }
  const reAuthRole = reAuth.role;
  const reAuthOrg = reAuth.orgId;

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

  // ── S4 (FR-PLN-006): a pending write re-checks its switch at execution ─────────────────────────
  // The switch can change between the chip and the approval, and the resolver read behind this request
  // can fail — a write never fails open. An off key (FEATURE_OFF) or an unverifiable plan
  // (PLAN_UNVERIFIED) refuses the write and resolves the chip as rejected, so the model tells the user
  // instead of writing into a module that is not on their plan.
  const offPlan = writeRefusalFor(toolName, deputyCtx.featureSwitches);
  if (offPlan) {
    yield emit('system', {
      text: 'rejected',
      payload: {
        event: 'write_resolved',
        decision: 'rejected',
        actionName: toolName,
        pendingId,
        reason: offPlan.code === 'FEATURE_OFF' ? 'feature_off' : 'plan_unverified',
      },
    });
    messages.push({ role: 'tool', tool_call_id: toolId, name: toolName, content: JSON.stringify(offPlan) });
    yield* runContinuation(req, deps, emit, statusEvent, deputyCtx, messages, persist, 'decision');
    return;
  }

  // ── FR-AGP-013/015: resume de-dupe gate — inside the single dispatch-forced site ──
  // A write whose (toolName, argsHash-of-VALIDATED-args) matches an already-journaled
  // COMPLETED call is hard-blocked: action.run is never re-invoked; the journaled result
  // is returned as the tool_result instead. NFR-AGP-SEC-004: the hash is computed from
  // validation.value (post-schema), never the raw toolInput.
  const journaled = findValidatedJournal(persist, toolName, validation.value);

  // Step 4: Execute under caller JWT (FR-AW-011, NFR-AW-SEC-002) — unless de-duped.
  let writeResult: unknown;
  if (journaled) {
    writeResult = journaled.payload;
  } else {
    try {
      writeResult = await timedSpan(deps, action.name, validation.value, () => dispatchActionForced(action, validation.value, deputyCtx));
    } catch {
      // DB error during write
      messages.push({
        role: 'tool',
        tool_call_id: toolId,
        name: toolName,
        content: JSON.stringify({ error: 'Write failed; database error.' }),
      });
      yield* runContinuation(req, deps, emit, statusEvent, deputyCtx, messages, persist, 'decision');
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
    content: wrapUntrustedToolResult(writeResult),
  });

  // Continue the loop so the model acknowledges
  yield* runContinuation(req, deps, emit, statusEvent, deputyCtx, messages, persist, 'decision');
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
export async function isCreditExhausted(deps: HandlerDeps, orgId: string): Promise<{ exceeded: boolean; retryAfterSeconds: number } | null> {
  if (!deps.rateGuard) return null;
  // A fresh id per model turn: reserve_credits holds against it atomically (concurrent turns cannot
  // both spend the same balance); agentChatHandler's finally releases every id registered here.
  const holdId = makeId();
  const r = await deps.rateGuard.check(orgId, holdId);
  if (r.exceeded) return r;
  deps.creditHolds?.push(holdId);
  return null;
}

// ── Shared continuation loop (decision vs answer) ─────────────────────────────

/**
 * Which interaction family the continuation resumes.
 */
export type ContinuationMode = 'decision' | 'answer';

/**
 * Inner tool-use loop for BOTH re-POST continuations (ADR-0045 §2, RED-2, correctness-
 * remediation finding 1). One credit-gated delegation to runToolLoop; the mode derives
 * the existing three loop options:
 *
 * - `'decision'` (handleDecision's approve/reject/no-op branches): the deliberately
 *   RESTRICTED pass — no compose_view (`allowCompose:false`), no re-proposing a confirm
 *   action mid-continuation (`allowProposeConfirm:false`), and a missing tool_calls[0]
 *   completes immediately rather than continuing as an unknown-action error
 *   (`onMissingToolCall:'complete'`). TERMINAL by design (correctness-remediation
 *   finding 1): a decision resolves a write (approved/rejected) — the continuation must
 *   not immediately propose a SECOND pending write, nor emit a compose_view artifact,
 *   before the model has acknowledged the first resolution. Used ONLY by handleDecision.
 * - `'answer'` (handleAnswer's continuation, ADR-0045 §2): answering a pending question
 *   RESUMES the user's original request — the model may need to immediately propose a
 *   confirm action (needs-approval) or emit a compose_view artifact to actually satisfy
 *   what the question was blocking. Runs with the SAME capabilities as the main pass
 *   (`allowCompose:true`, `allowProposeConfirm:true`); only `onMissingToolCall` stays
 *   'complete' (a missing tool_calls[0] on a continuation pass is a graceful completion,
 *   not a further "unknown action" round — orthogonal to compose/propose-confirm).
 *
 * RED-2 (handlerCreditGateInteractions.test.ts): this continuation is a genuine new
 * model call, so it is credit-gated here — whatever pure resolution (write_resolved
 * event / tool_result append / stale-decision no-op) the caller already emitted stays
 * intact; only THIS call is blocked.
 */
export async function* runContinuation(
  req: AgentChatRequest,
  deps: HandlerDeps,
  emit: (type: AgentEvent['type'], fields?: Partial<Omit<AgentEvent, 'id' | 'runId' | 'type' | 'createdAt'>>) => AgentEvent,
  statusEvent: (status: AgentRunStatus, extra?: Record<string, unknown>, text?: string) => AgentEvent,
  deputyCtx: import('../../../pmo-portal/src/lib/agent/runtime/port.ts').DeputyContext,
  messages: ModelMessage[],
  persist?: PersistenceRuntime,
  mode: ContinuationMode = 'decision',
): AsyncGenerator<AgentEvent> {
  // req.runId is always present here — a decision/answer re-POST always carries the
  // runId of the run being resumed (PmoNativeRuntime._doSubscribe always sends it).
  const runId = req.runId ?? '';

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
    allowCompose: mode === 'answer',
    allowProposeConfirm: mode === 'answer',
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
export function isConfirmToolUse(b: { name?: string }): boolean {
  return BASE_ACTION_BY_NAME.has(b.name ?? '') && BASE_ACTION_BY_NAME.get(b.name ?? '')?.confirm === true;
}

/** matchToolUse for the ask_user question interaction family (ADR-0045 §2). */
export function isAskUserToolUse(b: { name?: string }): boolean {
  return b.name === 'ask_user';
}
