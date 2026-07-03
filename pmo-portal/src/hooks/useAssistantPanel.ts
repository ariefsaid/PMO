/**
 * useAssistantPanel — orchestration hook over the AgentRuntime port.
 * Reads runtime + open state from AgentRuntimeContext (D-A2-5/R-OPEN-STATE).
 * NFR-AP-SEC-003: imports only from port.ts and AgentRuntimeContext (no PmoNativeRuntime).
 * FR-AP-009/021/022/023.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import type { AgentEvent, RunStatusPayload } from '../lib/agent/runtime/port';
import { useAgentRuntimeContext } from '../lib/agent/runtime/AgentRuntimeContext';
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

/** A3: chip state for a pending write approval chip. */
export type ApprovalChipState = 'pending' | 'approving' | 'approved' | 'denied';

/**
 * A3: chip state keyed by pendingId (not a single global) to support sequential
 * proposals in one run without one chip's state corrupting another.
 * Decisions note: docs/decisions.md "A3 chip state is keyed by pendingId."
 */
export type ChipStateMap = Record<string, ApprovalChipState>;

export interface UseAssistantPanel {
  open: boolean;
  transcript: TranscriptEntry[];
  phase: RunPhase;
  lastGoal: string | null;
  runId: string | null;
  /**
   * A3: chip state keyed by pendingId.
   * Each needs-approval event has its own entry; resolved via the matching pendingId.
   */
  chipStateMap: ChipStateMap;
  openPanel(): void;
  closePanel(): void;
  togglePanel(): void;
  send(text: string): Promise<void>;
  stop(): Promise<void>;
  retry(): Promise<void>;
  newConversation(): void;
  /** A3: approve the pending write action — re-POSTs with verdict:'approve'. */
  approve(): Promise<void>;
  /** A3: deny the pending write action — re-POSTs with verdict:'reject'. */
  deny(): Promise<void>;
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
   */
  isStuck: boolean;
  lastProgressAt: string | null;
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
  const { runtime, open, openPanel, closePanel, togglePanel } = ctx;

  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [lastGoal, setLastGoal] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  // FR-AGP-022: last observed progress signal for the active run — a coarse client-side
  // proxy (updated on every drained event) for the server's heartbeat, used to derive
  // isStuck. Null when no run has ever progressed.
  const [lastProgressAt, setLastProgressAt] = useState<string | null>(null);
  // A3: chip state keyed by pendingId (not a single global) to support sequential proposals.
  // docs/decisions.md: "A3 chip state is keyed by pendingId."
  const [chipStateMap, setChipStateMap] = useState<ChipStateMap>({});
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
            setTranscript((prev) => mergeAssistantEvent(prev, ev));
            continue;
          }

          if (ev.type === 'status') {
            const payload = ev.payload as Partial<RunStatusPayload> | undefined;

            if (payload?.status === 'completed') {
              setPhase('idle');
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
              const errPayload = ev.payload as
                | { status: string; error?: string; retryAfterSeconds?: number }
                | undefined;
              if (errPayload?.error === 'RATE_LIMITED' && (errPayload.retryAfterSeconds ?? 0) <= 0) {
                // FR-AUC-013 convention: retryAfterSeconds<=0 on RATE_LIMITED means
                // out-of-credits. No transcript entry — the composer itself carries the
                // message (FR-AUC-016), distinct from the generic ErrorCard path.
                setPhase('out-of-credits');
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
            const toolPayload = ev.payload as { pendingId?: string } | undefined;
            if (toolPayload?.pendingId) {
              const pid = toolPayload.pendingId;
              setChipStateMap((prev) => ({ ...prev, [pid]: 'approved' }));
            }
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

          // All other event types (tool, system, artifact, user echo) append directly.
          setTranscript((prev) => [...prev, { key: makeKey(), event: ev }]);
        }
      } catch {
        // Stream aborted (e.g. via stop()) — handled by stop().
      }
    },
    [],
  );

  // ── send ────────────────────────────────────────────────────────────────────
  const send = useCallback(
    async (text: string) => {
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
        const run = await runtime.createRun({ goal: text });
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
        await runtime.followUp(activeRunId, text);
      }

      setPhase('running');
      const iterable = runtime.subscribe(activeRunId);
      await drain(iterable, activeRunId);
    },
    [runtime, drain],
  );

  // ── stop ────────────────────────────────────────────────────────────────────
  const stop = useCallback(async () => {
    if (!runtime || !runIdRef.current) return;
    // Review round item 1: stop() exits the drain loop via the abort-triggered
    // exception (drain's catch{} — "Stream aborted"), never reaching the
    // completed/errored terminal branches that normally clean up runStartedAt.
    // Delete it here so a stopped run cannot leak an entry.
    runStartedAt.delete(runIdRef.current);
    await runtime.control(runIdRef.current, 'cancel');
    const stoppedEvent: AgentEvent = {
      id: makeKey(),
      runId: runIdRef.current,
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

  // ── retry ───────────────────────────────────────────────────────────────────
  const retry = useCallback(async () => {
    if (!runtime || !lastGoal) return;
    setPhase('idle');
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

    const run = await runtime.createRun({ goal: lastGoal });
    const activeRunId = run.id;
    setRunId(activeRunId);
    runIdRef.current = activeRunId;
    runStartedAt.set(activeRunId, Date.now());
    safeTrack(() => trackAgentRunStarted(activeRunId, true));
    setPhase('running');
    const iterable = runtime.subscribe(activeRunId);
    await drain(iterable, activeRunId);
  }, [runtime, lastGoal, drain]);

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
    }
    // Reset runIdRef BEFORE state updates so the drain loop sees the change immediately.
    runIdRef.current = null;
    activePendingIdRef.current = null;
    setRunId(null);
    setTranscript([]);
    setPhase('idle');
    setLastGoal(null);
    setChipStateMap({});
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

      runIdRef.current = targetRunId;
      setRunId(targetRunId);
      setTranscript(nextTranscript);
      setPhase('idle');
      setLastProgressAt(events.length > 0 ? events[events.length - 1].createdAt : null);
      safeTrack(() => trackAgentThreadResumed(threadId ?? null, targetRunId, events.length));
    },
    [],
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

  // ── isStuck — heartbeat-staleness derivation (FR-AGP-022) ────────────────────
  // Active only while a run is genuinely in flight ('running'/'needs-approval' are both
  // "the run has not reached a terminal state" per AgentRunStatus); keyed on elapsed
  // wall-clock time since the last observed progress signal (the SERVER heartbeat, once the
  // poll above has landed at least once — an SSE-derived stamp may still be the value between
  // polls, but the server value overwrites it whenever a fresher poll resolves).
  const isStuck =
    (phase === 'running' || phase === 'needs-approval') &&
    lastProgressAt !== null &&
    Date.now() - new Date(lastProgressAt).getTime() > STUCK_RUN_STALE_MS;

  return {
    open,
    transcript,
    phase,
    lastGoal,
    runId,
    chipStateMap,
    openPanel,
    closePanel,
    togglePanel,
    send,
    stop,
    retry,
    newConversation,
    approve,
    deny,
    openThread,
    isStuck,
    lastProgressAt,
  };
}
