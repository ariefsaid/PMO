/**
 * useAssistantPanel — orchestration hook over the AgentRuntime port.
 * Reads runtime + open state from AgentRuntimeContext (D-A2-5/R-OPEN-STATE).
 * NFR-AP-SEC-003: imports only from port.ts and AgentRuntimeContext (no PmoNativeRuntime).
 * FR-AP-009/021/022/023.
 */
import { useState, useCallback, useRef } from 'react';
import type { AgentEvent } from '../lib/agent/runtime/port';
import { useAgentRuntimeContext } from '../lib/agent/runtime/AgentRuntimeContext';

export type RunPhase = 'idle' | 'running' | 'needs-approval' | 'error';

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
}

function makeKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
      try {
        for await (const ev of iterable) {
          // Guard: if the runId has changed (newConversation reset it), stop
          // draining — the current run is no longer the active conversation.
          // This prevents events from a stale/cancelled run from polluting a
          // fresh transcript after newConversation() is called.
          if (drainRunId !== runIdRef.current) break;

          if (ev.type === 'assistant') {
            setTranscript((prev) => mergeAssistantEvent(prev, ev));
            continue;
          }

          if (ev.type === 'status') {
            const payload = ev.payload as { status?: string; error?: string } | undefined;

            if (payload?.status === 'completed') {
              setPhase('idle');
              // No extra transcript entry for a clean completion.
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
              // Append the event so TranscriptItem renders the ApprovalChip.
              setTranscript((prev) => [...prev, { key: makeKey(), event: ev }]);
              // The stream ends here (handler returned after emitting needs-approval).
              // Don't break — let the for-await loop finish naturally.
              continue;
            }

            if (payload?.status === 'errored') {
              setPhase('idle');
              if (payload.error === 'TURN_CAP') {
                // Step-cap notice: informational, not an error state.
                setTranscript((prev) => [...prev, { key: makeKey(), event: ev }]);
              } else {
                // Other errors → error state (FR-AP-018 / AC-AP-015).
                setTranscript((prev) => [...prev, { key: makeKey(), event: ev }]);
                setPhase('error');
              }
              continue;
            }

            // Queued/running/paused status events appended as-is.
            setTranscript((prev) => [...prev, { key: makeKey(), event: ev }]);
            continue;
          }

          // A3: tool event with pendingId → write was approved and executed.
          if (ev.type === 'tool') {
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
    setPhase('running');
    const iterable = runtime.subscribe(activeRunId);
    await drain(iterable, activeRunId);
  }, [runtime, lastGoal, drain]);

  // ── newConversation ──────────────────────────────────────────────────────────
  const newConversation = useCallback(() => {
    // Cancel any in-flight run so the drain loop stops producing events.
    // The drain guard (drainRunId !== runIdRef.current) will then break the loop.
    if (runIdRef.current && runtime) {
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
  };
}
