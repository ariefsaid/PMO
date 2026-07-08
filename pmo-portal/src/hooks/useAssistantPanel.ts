/**
 * useAssistantPanel — orchestration hook over the AgentRuntime port.
 * Reads runtime + open state from AgentRuntimeContext (D-A2-5/R-OPEN-STATE).
 * NFR-AP-SEC-003: imports only from port.ts and AgentRuntimeContext (no PmoNativeRuntime).
 * FR-AP-009/021/022/023.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import type { AgentEvent, RunStatusPayload, QuestionPayload } from '../lib/agent/runtime/port';
import { useAgentRuntimeContext } from '../lib/agent/runtime/AgentRuntimeContext';
import { useAgentContext } from '../lib/agent/context/useAgentContext';
import { isFeatureEnabled } from '../lib/features';
import { listRunEvents } from '../lib/db/agentEvents';
import type { AgentEventRow } from '../lib/db/agentEvents';
import { getRunHeartbeat } from '../lib/db/agentRuns';
import { STUCK_RUN_STALE_MS } from '../components/panel/stuckRun.constants';
import {
  trackAgentRunStarted,
  trackAgentRunCompleted,
  trackAgentRunErrored,
  trackAgentApprovalShown,
  trackAgentApprovalDecided,
  trackAgentThreadResumed,
} from '../lib/analytics';
import { safeTrack } from '../lib/analytics/safeTrack';

/**
 * FR-AGP-022 poll cadence — the EXISTING 5s tick that previously lived in AssistantPanel.tsx
 * as a pure force-rerender interval; moved here so the SAME tick both re-evaluates staleness
 * AND polls the server heartbeat (no second timer, per the review round item-2 fix).
 */
const HEARTBEAT_POLL_MS = 5_000;

/**
 * 'out-of-credits' (FR-AUC-016): a distinct terminal phase from 'error' — set when a
 * RATE_LIMITED status event's retryAfterSeconds<=0 (FR-AUC-013's convention for "no wait
 * will fix this, an admin grant is needed"), so the panel can render the out-of-credits
 * composer-disabled UX instead of the generic ErrorCard.
 */
export type RunPhase = 'idle' | 'running' | 'needs-approval' | 'error' | 'out-of-credits';

export interface TranscriptEntry {
  key: string;
  event: AgentEvent;
}

/**
 * One row of the persistent activity trail (useAssistantPanel.activityTrail). `label` is the
 * raw backend step label ("Looking up projects…"); `done` flips true when the matching tool
 * event drains; `detail` carries a short result summary ("4 found") when available. The
 * trail is reset per-run and never persisted — purely a legibility affordance for a live run.
 */
export interface TrailStep {
  id: string;
  label: string;
  done: boolean;
  detail?: string;
}

/** A3: chip state for a pending write approval chip. */
export type ApprovalChipState = 'pending' | 'approving' | 'approved' | 'denied';

/**
 * A3: chip state keyed by pendingId (not a single global) to support sequential
 * proposals in one run without one chip's state corrupting another.
 * Decisions note: docs/decisions.md "A3 chip state is keyed by pendingId."
 */
export type ChipStateMap = Record<string, ApprovalChipState>;

/**
 * Review-remediation item 3 (F3, Discover finding): the resolution of a pending
 * ask-user question, keyed by questionId — mirrors the ChipStateMap pattern
 * (Blocker-8: keyed, not a single global atom) so a QuestionChips entry can
 * render itself disabled with the chosen option/free-text indicated once
 * answered, instead of looking perpetually re-clickable.
 */
export type AnsweredMap = Record<string, { optionId?: string; freeText?: string }>;

export interface UseAssistantPanel {
  open: boolean;
  transcript: TranscriptEntry[];
  phase: RunPhase;
  lastGoal: string | null;
  runId: string | null;
  /**
   * Live step-trail label for the tool currently executing ("Looking up projects…"), or
   * null when between steps / after the run ends. Surfaced in the streaming indicator in
   * place of the static "Working…". Purely cosmetic; never persisted or in the transcript.
   */
  currentStep: string | null;
  /**
   * Persistent activity trail — the legible, per-run checklist of what the agent has done
   * (done rows, ✓ + detail) and is doing (the current row, spinner). Driven from the SAME
   * step/tool events as `currentStep`, accumulated so a slow run stays transparent instead
   * of a frozen "Working…". Reset on terminal status / newConversation / a fresh createRun.
   * Purely cosmetic; never persisted or in the transcript.
   */
  activityTrail: TrailStep[];
  /**
   * A3: chip state keyed by pendingId.
   * Each needs-approval event has its own entry; resolved via the matching pendingId.
   */
  chipStateMap: ChipStateMap;
  /**
   * Review-remediation item 3 (F3): resolved ask-user answers keyed by questionId —
   * populated by answerQuestion() so a resolved question's chips render disabled
   * with the chosen option/free-text indicated (mirrors chipStateMap).
   */
  answeredMap: AnsweredMap;
  openPanel(prefill?: string): void;
  closePanel(): void;
  togglePanel(): void;
  prefillVersion: number;
  consumePrefill(): string | null;
  send(text: string, input?: { attachmentIds?: string[]; threadId?: string }): Promise<void>;
  stop(): Promise<void>;
  retry(): Promise<void>;
  newConversation(): void;
  /** A3: approve the pending write action — re-POSTs with verdict:'approve'. */
  approve(): Promise<void>;
  /** A3: deny the pending write action — re-POSTs with verdict:'reject'. */
  deny(): Promise<void>;
  /**
   * ADR-0045 §2: resolve a pending ask-user question — re-POSTs with req.answer,
   * continuing the SAME run (never a new createRun, never followUp).
   */
  answerQuestion(questionId: string, optionId?: string, freeText?: string): Promise<void>;
  /**
   * ADR-0043 (FR-AGP-021): open/resume a thread's most recent run — fetches its events
   * ordered by (run_id, seq) and restores the transcript in that exact order, reproducing
   * the original conversation sequence (including the consecutive-assistant-chunk merge).
   * The DB query is scoped by runId alone (RLS scopes ownership); `threadId` is optional
   * and used ONLY to populate `agent_thread_resumed`'s `thread_id` property (FR-APH-010) —
   * omitted, it reports `null` (NFR-APH-REL-002 posture: omit rather than fabricate).
   */
  openThread(runId: string, threadId?: string): Promise<void>;
  /**
   * ADR-0043 (FR-AGP-022): true while a run is active AND heartbeat-stale (keyed on
   * elapsed time since the last observed progress signal, independent of SSE liveness).
   * The render (StuckRunBanner, Phase D) consumes this boolean + lastProgressAt; this hook
   * only derives the flag.
   *
   * Correctness-remediation (gpt-5.5 cross-family audit, finding 3): EXCLUDES a run with
   * a pending ask_user question (`hasPendingQuestion`) — waiting on the human is a
   * legitimate paused state, not evidence the run is wedged, even past
   * STUCK_RUN_STALE_MS. See `hasPendingQuestion` below.
   */
  isStuck: boolean;
  lastProgressAt: string | null;
  /**
   * Correctness-remediation finding 3: true when the trailing status{kind:'question'}
   * transcript entry has no matching answeredMap resolution yet — a pending ask_user
   * question is awaiting the user's answer. Derived from the transcript (mirrors the
   * AssistantPanel.tsx computation this hook now centralizes) rather than `phase`,
   * because a pending question does NOT transition `phase` away from 'running' (the
   * drain loop appends a `question` status frame as-is, same as any other in-flight
   * status event — by design, since the SSE stream simply ends there).
   */
  hasPendingQuestion: boolean;
}

function makeKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * PostHog agent_run_completed/errored duration_ms source (FR-APH-006/007, NFR-APH-REL-002).
 * Module-scope (not useRef): the hook is re-instantiated per AssistantPanel mount but a
 * run's lifecycle can span the SAME mount from send() to the drain loop's terminal branch,
 * so a plain module Map is sufficient and is explicitly deleted on read (never grows
 * unbounded — bounded by concurrently in-flight run count, always small).
 */
const runStartedAt = new Map<string, number>();

/**
 * Test-only accessor for `runStartedAt`'s size — asserts the leak-prevention
 * invariant (every `.set()` is matched by a `.delete()` on stop()/newConversation()
 * in addition to the completed/errored terminal branches) without exposing the
 * Map itself. Not imported by any production code path.
 */
export function __testOnlyRunStartedAtSize(): number {
  return runStartedAt.size;
}

/**
 * Append or concatenate an assistant event into the transcript.
 * NFR-AP-PERF-002: successive assistant events in the same turn are concatenated
 * into one stable-key entry (the key stays fixed; only .event.text grows).
 */
function mergeAssistantEvent(
  prev: TranscriptEntry[],
  ev: AgentEvent,
): TranscriptEntry[] {
  // Find the last entry: if it's an assistant event with the same runId, concatenate.
  const last = prev[prev.length - 1];
  if (last && last.event.type === 'assistant' && last.event.runId === ev.runId) {
    // Mutate the text in-place (same key keeps stable reference for perf).
    const merged: TranscriptEntry = {
      key: last.key,
      event: { ...last.event, text: (last.event.text ?? '') + (ev.text ?? '') },
    };
    return [...prev.slice(0, -1), merged];
  }
  return [...prev, { key: makeKey(), event: ev }];
}

export function useAssistantPanel(): UseAssistantPanel {
  const ctx = useAgentRuntimeContext();
  const {
    runtime,
    open,
    openPanel,
    closePanel,
    togglePanel,
    prefillVersion = 0,
    consumePrefill = () => null,
  } = ctx;
  // ADR-0045 §3 (FR-ATC-015/020): live context (route/entity/selection) — a
  // no-op read outside AgentContextProvider (agentContext.getContext() → {}).
  const { getContext } = useAgentContext();

  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [lastGoal, setLastGoal] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  // Live step trail: the present-tense label of the tool currently executing (transient UI
  // hint only — never in the transcript or persisted; cleared when the tool drains or the
  // run reaches a terminal state).
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  // Persistent activity trail — the legible per-run checklist (done ✓ rows + the current
  // spinner row). Accumulated from the SAME step/tool events that drive `currentStep`, so a
  // slow or thrashing run shows what the agent has done and is doing, not a frozen mystery.
  const [activityTrail, setActivityTrail] = useState<TrailStep[]>([]);
  // FR-AGP-022: last observed progress signal for the active run — a coarse client-side
  // proxy (updated on every drained event) for the server's heartbeat, used to derive
  // isStuck. Null when no run has ever progressed.
  const [lastProgressAt, setLastProgressAt] = useState<string | null>(null);
  // A3: chip state keyed by pendingId (not a single global) to support sequential proposals.
  // docs/decisions.md: "A3 chip state is keyed by pendingId."
  const [chipStateMap, setChipStateMap] = useState<ChipStateMap>({});
  // Review-remediation item 3 (F3): resolved ask-user answers keyed by questionId
  // (mirrors chipStateMap's keyed-not-global pattern for sequential questions in one run).
  const [answeredMap, setAnsweredMap] = useState<AnsweredMap>({});
  // Track the currently active pendingId for approve/deny/approving transitions
  const activePendingIdRef = useRef<string | null>(null);

  // Ref so the drain loop can read the latest runId without stale closure
  const runIdRef = useRef<string | null>(null);
  runIdRef.current = runId;

  // ── drain: consume an AsyncIterable<AgentEvent> and update transcript ───────
  const drain = useCallback(
    async (iterable: AsyncIterable<AgentEvent>, drainRunId: string) => {
      // FR-APH-006/007: tool_round_count counts type='tool' events observed for THIS
      // drain call. A local counter (not a transcript-state/ref read) avoids any
      // dependency on React's render/batching timing — the drain loop is the single
      // source of truth for "how many tool events did THIS run stream," independent
      // of when setTranscript's updates are reflected back into a ref.
      let toolRoundCount = 0;
      try {
        for await (const ev of iterable) {
          // Guard: if the runId has changed (newConversation reset it), stop
          // draining — the current run is no longer the active conversation.
          // This prevents events from a stale/cancelled run from polluting a
          // fresh transcript after newConversation() is called.
          if (drainRunId !== runIdRef.current) break;

          // FR-AGP-022: any observed event is a progress signal — advance the
          // client-side staleness clock (a coarse proxy for the server heartbeat).
          setLastProgressAt(new Date().toISOString());

          if (ev.type === 'assistant') {
            // Live step trail: the model has resumed narrating/answering, so the previous step's
            // work is done — clear the label back to the neutral "Working…". Clearing HERE (not on
            // the tool event) lets a step label linger through the whole tool execution + the
            // follow-up model turn, so it is actually READABLE rather than flashing sub-second
            // between the tool call and its result (render finding 2026-07-07).
            setCurrentStep(null);
            setTranscript((prev) => mergeAssistantEvent(prev, ev));
            continue;
          }

          // Live step trail: a transient {kind:'step'} status hint — the present-tense label
          // of the tool about to run. Intercept it BEFORE the status/phase logic so it never
          // reaches the transcript or is treated as a run-lifecycle status frame; it only
          // drives the streaming indicator's copy.
          if (ev.type === 'status' && (ev.payload as { kind?: string } | undefined)?.kind === 'step') {
            const stepLabel = (ev.payload as { label?: string }).label ?? null;
            setCurrentStep(stepLabel);
            // Persistent activity trail: append the step as the new "current" (in-progress) row,
            // IN ADDITION to the transient currentStep label. The matching tool event later
            // flips this row done (with a result detail). A slow run thus accumulates a
            // legible checklist of what the agent has done and is doing.
            if (stepLabel) {
              setActivityTrail((prev) => [...prev, { id: makeKey(), label: stepLabel, done: false }]);
            }
            continue;
          }

          if (ev.type === 'status') {
            const payload = ev.payload as Partial<RunStatusPayload> | undefined;

            if (payload?.status === 'completed') {
              setPhase('idle');
              setCurrentStep(null);
              setActivityTrail([]);
              // No extra transcript entry for a clean completion.
              const startedAt = runStartedAt.get(drainRunId);
              runStartedAt.delete(drainRunId);
              safeTrack(() =>
                trackAgentRunCompleted(
                  drainRunId,
                  startedAt !== undefined ? Date.now() - startedAt : undefined,
                  toolRoundCount,
                ),
              );
              continue;
            }

            if (payload?.status === 'needs-approval') {
              // A3: pause the run — user must approve/deny before it continues.
              const naPayload = ev.payload as { status: string; pendingId?: string } | undefined;
              const pendingId = naPayload?.pendingId ?? makeKey();
              activePendingIdRef.current = pendingId;
              setPhase('needs-approval');
              setCurrentStep(null);
              setActivityTrail([]);
              // Key the chip state by pendingId (Blocker-8: not a single global atom).
              setChipStateMap((prev) => ({ ...prev, [pendingId]: 'pending' }));
              safeTrack(() => trackAgentApprovalShown(drainRunId));
              // Append the event so TranscriptItem renders the ApprovalChip.
              setTranscript((prev) => [...prev, { key: makeKey(), event: ev }]);
              // The stream ends here (handler returned after emitting needs-approval).
              // Don't break — let the for-await loop finish naturally.
              continue;
            }

            if (payload?.status === 'errored') {
              setPhase('idle');
              setCurrentStep(null);
              setActivityTrail([]);
              // RunStatusPayload (port.ts, #215) doesn't carry retryAfterSeconds — it's
              // RATE_LIMITED-specific (AgentChatError, transport.ts). Extend the shared
              // status-payload type rather than a fully ad-hoc shape, per FR-AUC-013.
              const errPayload = ev.payload as (RunStatusPayload & { retryAfterSeconds?: number }) | undefined;
              if (errPayload?.error === 'RATE_LIMITED' && (errPayload.retryAfterSeconds ?? 0) <= 0) {
                // FR-AUC-013 convention: retryAfterSeconds<=0 on RATE_LIMITED means
                // out-of-credits. No transcript entry — the composer itself carries the
                // message (FR-AUC-016), distinct from the generic ErrorCard path. Still a
                // real run failure for analytics purposes — fire agent_run_errored (same
                // as the generic error path below) so out-of-credits runs aren't invisible
                // to the PostHog funnel, and clean up runStartedAt to avoid a leak.
                setPhase('out-of-credits');
                const startedAt = runStartedAt.get(drainRunId);
                runStartedAt.delete(drainRunId);
                safeTrack(() =>
                  trackAgentRunErrored(
                    drainRunId,
                    startedAt !== undefined ? Date.now() - startedAt : undefined,
                    toolRoundCount,
                    errPayload.error ?? 'RATE_LIMITED',
                  ),
                );
                continue;
              }
              if (payload.error === 'TURN_CAP') {
                // Step-cap notice: informational, not an error state.
                setTranscript((prev) => [...prev, { key: makeKey(), event: ev }]);
              } else {
                // Other errors → error state (FR-AP-018 / AC-AP-015).
                setTranscript((prev) => [...prev, { key: makeKey(), event: ev }]);
                setPhase('error');
                const startedAt = runStartedAt.get(drainRunId);
                runStartedAt.delete(drainRunId);
                safeTrack(() =>
                  trackAgentRunErrored(
                    drainRunId,
                    startedAt !== undefined ? Date.now() - startedAt : undefined,
                    toolRoundCount,
                    payload.error ?? 'UNKNOWN',
                  ),
                );
              }
              continue;
            }

            // Queued/running/paused status events appended as-is.
            setTranscript((prev) => [...prev, { key: makeKey(), event: ev }]);
            continue;
          }

          // A3: tool event with pendingId → write was approved and executed.
          if (ev.type === 'tool') {
            toolRoundCount += 1;
            // Live step trail: do NOT clear the label here — it stays through the tool result and
            // the next model turn (cleared when the model resumes narrating, in the 'assistant'
            // branch above, or on a terminal status). Keeps the step readable, not a sub-second flash.
            const toolPayload = ev.payload as { pendingId?: string } | undefined;
            if (toolPayload?.pendingId) {
              const pid = toolPayload.pendingId;
              setChipStateMap((prev) => ({ ...prev, [pid]: 'approved' }));
            }
            // Persistent activity trail: mark the most recent not-yet-done step done, and attach
            // a short result summary ("4 found") when the tool carried a rowCount. The matching
            // step is always the last not-done row (step emits before its tool runs), so we walk
            // back from the end to find it. Read tools without a rowCount (writes, etc.) still mark
            // done but leave detail undefined.
            const result = (ev.payload as { result?: { rowCount?: unknown } } | undefined)?.result;
            const rowCount = result?.rowCount;
            const detail = typeof rowCount === 'number' ? `${rowCount} found` : undefined;
            setActivityTrail((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                if (!next[i].done) {
                  next[i] = { ...next[i], done: true, detail: detail ?? next[i].detail };
                  break;
                }
              }
              return next;
            });
          }

          // A3: system write_resolved → update chip state for the specific pendingId.
          if (ev.type === 'system') {
            const sysPayload = ev.payload as { event?: string; decision?: string; pendingId?: string } | undefined;
            if (sysPayload?.event === 'write_resolved' && sysPayload.pendingId) {
              const pid = sysPayload.pendingId;
              const newState: ApprovalChipState = sysPayload.decision === 'approved' ? 'approved' : 'denied';
              setChipStateMap((prev) => ({ ...prev, [pid]: newState }));
              safeTrack(() =>
                trackAgentApprovalDecided(drainRunId, sysPayload.decision === 'approved' ? 'approved' : 'denied'),
              );
            }
          }

          // All other event types (tool, system, artifact, user echo) append directly —
          // EXCEPT a 'user' echo that duplicates send()'s optimistic append. send() appends
          // the user's message locally immediately; the stream then re-delivers the SAME
          // message as a server-echoed type:'user' event, which would otherwise render a
          // second, identical bubble (mirrors mergeAssistantEvent's de-dupe spirit). Skip the
          // echo only when the most recent existing user entry already has identical text
          // (that entry IS the optimistic add this echo mirrors); otherwise append it,
          // preserving any user event not already shown — a repeated identical message is
          // still exactly one optimistic entry ahead of its own echo, so this rule never
          // suppresses a genuinely new turn.
          setTranscript((prev) => {
            if (ev.type === 'user') {
              const lastUser = [...prev].reverse().find((e) => e.event.type === 'user');
              if (lastUser && lastUser.event.text === ev.text) return prev;
            }
            return [...prev, { key: makeKey(), event: ev }];
          });
        }
      } catch {
        // Stream aborted (e.g. via stop()) — handled by stop().
      }
    },
    [],
  );

  // ── send ────────────────────────────────────────────────────────────────────
  const send = useCallback(
    async (text: string, input?: { attachmentIds?: string[]; threadId?: string }) => {
      if (!runtime) return;

      // Append the user's message locally immediately.
      const userEvent: AgentEvent = {
        id: makeKey(),
        runId: runIdRef.current ?? 'pending',
        type: 'user',
        text,
        createdAt: new Date().toISOString(),
      };
      setTranscript((prev) => [...prev, { key: makeKey(), event: userEvent }]);

      let activeRunId: string;

      if (!runIdRef.current) {
        // First message in this conversation: create a new run.
        setLastGoal(text);
        // Persistent activity trail: a fresh turn starts clean — drop any trail left over
        // from a prior run (a terminal status / newConversation already cleared it, but a
        // createRun after a non-terminal reset, e.g. a follow-up that became a new run, must
        // not inherit the previous run's steps).
        setActivityTrail([]);
        // FR-ATC-015/020: thread live context only when the flag is on — flag-off,
        // getContext() is never called and no context is sent.
        // Only attach optional keys when present, so the no-attachment path (the
        // common case) keeps its exact { goal } / { goal, context } shape.
        const run = await runtime.createRun({
          goal: text,
          ...(isFeatureEnabled('agentAssistant') ? { context: getContext() } : {}),
          ...(input?.attachmentIds?.length ? { attachmentIds: input.attachmentIds } : {}),
          ...(input?.threadId ? { threadId: input.threadId } : {}),
        });
        activeRunId = run.id;
        setRunId(activeRunId);
        runIdRef.current = activeRunId;
        runStartedAt.set(activeRunId, Date.now());
        safeTrack(() => trackAgentRunStarted(activeRunId, false));
        // Update the user event's runId in transcript
        setTranscript((prev) =>
          prev.map((e) =>
            e.event === userEvent ? { ...e, event: { ...e.event, runId: activeRunId } } : e,
          ),
        );
      } else {
        // Follow-up: append to the existing run.
        activeRunId = runIdRef.current;
        const turnInput = input?.attachmentIds?.length || input?.threadId
          ? { attachmentIds: input?.attachmentIds, threadId: input?.threadId }
          : undefined;
        if (turnInput) {
          await runtime.followUp(activeRunId, text, turnInput);
        } else {
          await runtime.followUp(activeRunId, text);
        }
      }

      setPhase('running');
      const iterable = runtime.subscribe(activeRunId);
      await drain(iterable, activeRunId);
    },
    [runtime, drain, getContext],
  );

  // ── stop ────────────────────────────────────────────────────────────────────
  const stop = useCallback(async () => {
    if (!runtime || !runIdRef.current) return;
    // Capture the runId BEFORE any state churn — dispose + the "Stopped" transcript
    // entry both need the outgoing id, and runIdRef can be reset elsewhere.
    const stoppedRunId = runIdRef.current;
    // Review round item 1: stop() exits the drain loop via the abort-triggered
    // exception (drain's catch{} — "Stream aborted"), never reaching the
    // completed/errored terminal branches that normally clean up runStartedAt.
    // Delete it here so a stopped run cannot leak an entry.
    runStartedAt.delete(stoppedRunId);
    await runtime.control(stoppedRunId, 'cancel');
    // Blocker-4 reconciled (multi-turn money-path fix): a stop PERMANENTLY ends this
    // run, so release its client-side state (accumulated transcript) now — keeps the
    // adapter's _runs Map bounded. Safe no-op if the runtime port doesn't implement
    // dispose (optional method). NOT done on a plain 'completed' (a follow-up may
    // still continue that run), only on this terminal cancel path.
    runtime.dispose?.(stoppedRunId);
    const stoppedEvent: AgentEvent = {
      id: makeKey(),
      runId: stoppedRunId,
      type: 'system',
      text: 'Stopped',
      createdAt: new Date().toISOString(),
    };
    setTranscript((prev) => [...prev, { key: makeKey(), event: stoppedEvent }]);
    setPhase('idle');
  }, [runtime]);

  // ── approve / deny (A3) ─────────────────────────────────────────────────────
  // Called by the ApprovalChip. Signals the adapter, transitions to 'running',
  // and re-subscribes so the decision re-POST flows through _doSubscribe.
  const approve = useCallback(async () => {
    if (!runtime || !runIdRef.current) return;
    const activeRunId = runIdRef.current;
    const pid = activePendingIdRef.current;
    if (pid) setChipStateMap((prev) => ({ ...prev, [pid]: 'approving' }));
    await runtime.control(activeRunId, 'approve');
    setPhase('running');
    const iterable = runtime.subscribe(activeRunId);
    await drain(iterable, activeRunId);
  }, [runtime, drain]);

  const deny = useCallback(async () => {
    if (!runtime || !runIdRef.current) return;
    const activeRunId = runIdRef.current;
    const pid = activePendingIdRef.current;
    if (pid) setChipStateMap((prev) => ({ ...prev, [pid]: 'approving' }));
    await runtime.control(activeRunId, 'reject');
    setPhase('running');
    const iterable = runtime.subscribe(activeRunId);
    await drain(iterable, activeRunId);
  }, [runtime, drain]);

  // ── answerQuestion (ADR-0045 §2) ─────────────────────────────────────────────
  // Called by QuestionChips. Resolves via control('answer', ...) — the SAME
  // in-run resolution family as approve/deny — and NEVER via followUp
  // (FR-ATC-011, OBS-ATC-004: an answer is not a new user turn).
  const answerQuestion = useCallback(
    async (questionId: string, optionId?: string, freeText?: string) => {
      if (!runtime || !runIdRef.current) return;
      const activeRunId = runIdRef.current;
      // Review-remediation item 3 (F3): record the resolution BEFORE the re-POST
      // so the question's chips render disabled + the chosen answer indicated
      // immediately, mirroring the A3 chipStateMap 'approving'-set-before-control pattern.
      setAnsweredMap((prev) => ({ ...prev, [questionId]: { optionId, freeText } }));
      await runtime.control(activeRunId, 'answer', { questionId, optionId, freeText });
      setPhase('running');
      const iterable = runtime.subscribe(activeRunId);
      await drain(iterable, activeRunId);
    },
    [runtime, drain],
  );

  // ── retry ───────────────────────────────────────────────────────────────────
  const retry = useCallback(async () => {
    if (!runtime || !lastGoal) return;
    setPhase('idle');
    // Release the errored run's client-side state before abandoning it — retry mints a
    // fresh run via createRun, so the old entry would otherwise leak (Blocker-4 reconcile).
    if (runIdRef.current) runtime.dispose?.(runIdRef.current);
    // Reset runId so createRun is called, not followUp.
    setRunId(null);
    runIdRef.current = null;
    // Remove error entry from transcript before retry
    setTranscript((prev) =>
      prev.filter(
        (e) =>
          !(
            e.event.type === 'status' &&
            (e.event.payload as { status?: string } | undefined)?.status === 'errored'
          ),
      ),
    );

    // FR-ATC-015/020: thread live context only when the flag is on (mirrors send()).
    const run = await runtime.createRun(
      isFeatureEnabled('agentAssistant') ? { goal: lastGoal, context: getContext() } : { goal: lastGoal },
    );
    const activeRunId = run.id;
    setRunId(activeRunId);
    runIdRef.current = activeRunId;
    runStartedAt.set(activeRunId, Date.now());
    safeTrack(() => trackAgentRunStarted(activeRunId, true));
    setPhase('running');
    const iterable = runtime.subscribe(activeRunId);
    await drain(iterable, activeRunId);
  }, [runtime, lastGoal, drain, getContext]);

  // ── newConversation ──────────────────────────────────────────────────────────
  const newConversation = useCallback(() => {
    // Cancel any in-flight run so the drain loop stops producing events.
    // The drain guard (drainRunId !== runIdRef.current) will then break the loop.
    if (runIdRef.current && runtime) {
      // Review round item 1: neither the guard-break nor the abort-triggered
      // exception reaches the drain loop's completed/errored cleanup branches —
      // delete the entry here so a cancelled run cannot leak one.
      runStartedAt.delete(runIdRef.current);
      void runtime.control(runIdRef.current, 'cancel');
      // Blocker-4 reconciled (multi-turn money-path fix): release the OUTGOING
      // conversation's client-side state (its accumulated transcript) now that the
      // user is starting fresh. newConversation is the ONLY path that mints a new run,
      // so it is the natural release point — it bounds the adapter's _runs Map without
      // deleting on a plain 'completed' (a follow-up must still be able to reuse that
      // state). Called BEFORE runIdRef is nulled below. Safe no-op if the runtime port
      // doesn't implement dispose (optional method).
      runtime.dispose?.(runIdRef.current);
    }
    // Reset runIdRef BEFORE state updates so the drain loop sees the change immediately.
    runIdRef.current = null;
    activePendingIdRef.current = null;
    setRunId(null);
    setTranscript([]);
    setPhase('idle');
    setLastGoal(null);
    setChipStateMap({});
    setAnsweredMap({});
    setCurrentStep(null);
    setActivityTrail([]);
  }, [runtime]);

  // ── openThread — resume-on-open (FR-AGP-021, AC-AGP-021) ─────────────────────
  // Fetches the thread's most recent run's events ordered by (run_id, seq) and rebuilds
  // the transcript in that exact order — folding consecutive assistant rows through the
  // SAME mergeAssistantEvent reducer `drain` uses, so a reload reproduces the original
  // live-merge behavior. The DB query is scoped by runId alone (RLS scopes ownership) —
  // threadId was never used for the query (review round item 6, dead param dropped); it
  // is now accepted as an OPTIONAL second param solely to populate agent_thread_resumed's
  // thread_id property (FR-APH-010) — callers that don't have it get `thread_id: null`.
  const openThread = useCallback(
    async (targetRunId: string, threadId?: string) => {
      const rows: AgentEventRow[] = await listRunEvents(targetRunId);
      const ordered = [...rows].sort((a, b) => a.seq - b.seq);
      const events: AgentEvent[] = ordered.map((row) => ({
        id: row.id,
        runId: row.run_id,
        type: row.type as AgentEvent['type'],
        text: row.text ?? undefined,
        payload: row.payload ?? undefined,
        createdAt: row.created_at,
      }));

      let nextTranscript: TranscriptEntry[] = [];
      for (const ev of events) {
        nextTranscript = ev.type === 'assistant' ? mergeAssistantEvent(nextTranscript, ev) : [...nextTranscript, { key: makeKey(), event: ev }];
      }

      // Adopt the loaded run into the runtime so a FOLLOW-UP continues THIS conversation
      // rather than hanging (openThread otherwise sets runId but leaves the adapter with no
      // per-run state → the next message early-returns with zero model calls). Seed the
      // accumulated transcript (user + assistant turns, in seq order) so the next turn
      // replays full context (D8/R5).
      const priorMessages = events
        .filter((e): e is AgentEvent & { text: string } => (e.type === 'user' || e.type === 'assistant') && !!e.text)
        .map((e) => ({ role: e.type as 'user' | 'assistant', content: e.text }));
      runtime.adoptRun?.(targetRunId, priorMessages, threadId ? { threadId } : undefined);

      runIdRef.current = targetRunId;
      setRunId(targetRunId);
      setTranscript(nextTranscript);
      setPhase('idle');
      setLastProgressAt(events.length > 0 ? events[events.length - 1].createdAt : null);
      safeTrack(() => trackAgentThreadResumed(threadId ?? null, targetRunId, events.length));
    },
    [runtime],
  );

  // ── Server-heartbeat poll (FR-AGP-022, review round item 2) ──────────────────
  // The SPEC's staleness authority is `agent_runs.last_progress_at` (the server heartbeat),
  // NOT client-observed SSE liveness — a live SSE can be silently wedged server-side, and a
  // dropped SSE can be genuinely still progressing. `lastProgressAt` above is only a coarse,
  // OPPORTUNISTIC client-side proxy (updated on every drained event, for a snappy UI between
  // polls); this effect polls the real DB value on the SAME 5s cadence AssistantPanel.tsx used
  // to force a bare re-render (no second timer) and, whenever the poll returns a value, treats
  // it as authoritative — overwriting the SSE-derived stamp so the server value always wins
  // when it is fresher. Runs only while a run is genuinely active.
  useEffect(() => {
    if (phase !== 'running' && phase !== 'needs-approval') return;
    const activeRunId = runIdRef.current;
    if (!activeRunId) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const heartbeat = await getRunHeartbeat(activeRunId);
        if (cancelled) return;
        if (heartbeat?.last_progress_at) {
          setLastProgressAt(heartbeat.last_progress_at);
        }
      } catch {
        // Transient read failure — the next poll retries; the opportunistic SSE-derived
        // stamp (if any) remains in effect until then (fail-open, mirrors server-side
        // heartbeat/journal error handling — NFR-AGP-SEC-005 style).
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), HEARTBEAT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [phase, runId]);

  // ── hasPendingQuestion (correctness-remediation finding 3) ───────────────────
  // Derived from the transcript, not `phase` — a pending question does NOT transition
  // `phase` away from 'running' (the drain loop appends a `question` status frame as-is;
  // the SSE stream simply ends there). Centralizes the computation AssistantPanel.tsx
  // previously duplicated locally (review-remediation item 6) so the hook's own isStuck
  // derivation can also consume it.
  const hasPendingQuestion = (() => {
    for (let i = transcript.length - 1; i >= 0; i--) {
      const ev = transcript[i].event;
      if (ev.type !== 'status') continue;
      const payload = ev.payload as { kind?: string } | undefined;
      if (payload?.kind !== 'question') continue;
      const q = ev.payload as QuestionPayload;
      return answeredMap[q.questionId] === undefined;
    }
    return false;
  })();

  // ── isStuck — heartbeat-staleness derivation (FR-AGP-022) ────────────────────
  // Active only while a run is genuinely in flight ('running'/'needs-approval' are both
  // "the run has not reached a terminal state" per AgentRunStatus); keyed on elapsed
  // wall-clock time since the last observed progress signal (the SERVER heartbeat, once the
  // poll above has landed at least once — an SSE-derived stamp may still be the value between
  // polls, but the server value overwrites it whenever a fresher poll resolves).
  // Correctness-remediation finding 3: a pending ask_user question is EXCLUDED — the run
  // is legitimately paused waiting on the human, not wedged, even past
  // STUCK_RUN_STALE_MS with no fresh heartbeat (the server has no more work to do until
  // the user answers, so its heartbeat genuinely stops advancing — that is expected, not
  // a symptom of being stuck).
  const isStuck =
    !hasPendingQuestion &&
    (phase === 'running' || phase === 'needs-approval') &&
    lastProgressAt !== null &&
    Date.now() - new Date(lastProgressAt).getTime() > STUCK_RUN_STALE_MS;

  return {
    open,
    transcript,
    phase,
    lastGoal,
    runId,
    currentStep,
    activityTrail,
    chipStateMap,
    answeredMap,
    openPanel,
    closePanel,
    togglePanel,
    prefillVersion,
    consumePrefill,
    send,
    stop,
    retry,
    newConversation,
    approve,
    deny,
    answerQuestion,
    openThread,
    isStuck,
    lastProgressAt,
    hasPendingQuestion,
  };
}
