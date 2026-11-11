/**
 * useRunHeartbeat — the polling/staleness seam of the assistant panel (extracted from
 * useAssistantPanel, THEME-CROSS-84 / FR-AGP-022). Owns the last-progress stamp, the
 * server-heartbeat poll, the staleness render tick and the isStuck derivation.
 *
 * The SPEC's staleness authority is `agent_runs.last_progress_at` (the server heartbeat),
 * NOT client-observed SSE liveness — a live SSE can be silently wedged server-side, and a
 * dropped SSE can be genuinely still progressing. The stamp is a coarse, OPPORTUNISTIC
 * client-side proxy (advanced via noteProgress() on every drained event, for a snappy UI
 * between polls); while a run is active the server value is polled on the 5s cadence and,
 * whenever the poll returns a value, treated as authoritative — overwriting the
 * SSE-derived stamp so the server value always wins when it is fresher. A failed poll
 * keeps the current stamp (fail-open) and retries on the next tick.
 */
import { useState, useEffect, useCallback } from 'react';
import { repositories } from '../../lib/repositories';
import { STUCK_RUN_STALE_MS } from '../../components/panel/stuckRun.constants';

/** FR-AGP-022 poll cadence — the SAME 5s tick that re-evaluates staleness (no second timer). */
const HEARTBEAT_POLL_MS = 5_000;

export interface UseRunHeartbeatOptions {
  /**
   * The hook-level run phase. The poll runs only while the run is genuinely in flight
   * ('running' | 'needs-approval') — and, keyed on phase like the pre-extraction effect
   * (deps [phase, runId]), it RESTARTS on the running→needs-approval transition, so a
   * re-POST continuations's approval lands a fresh server stamp immediately.
   */
  phase: 'idle' | 'running' | 'needs-approval' | 'error' | 'out-of-credits';
  /** The active run id, or null between runs. */
  runId: string | null;
  /** True while a pending ask_user question awaits the user's answer. */
  hasPendingQuestion: boolean;
}

export interface UseRunHeartbeatResult {
  lastProgressAt: string | null;
  isStuck: boolean;
  /** Advance the client-side stamp (call on every drained event). */
  noteProgress(): void;
  /** Adopt an explicit stamp (thread history reload) or clear it (new conversation). */
  setLastProgressAt(value: string | null): void;
}

export function useRunHeartbeat({ phase, runId, hasPendingQuestion }: UseRunHeartbeatOptions): UseRunHeartbeatResult {
  const [lastProgressAt, setLastProgressAt] = useState<string | null>(null);

  // ── Server-heartbeat poll (FR-AGP-022) ────────────────────────────────────────
  // Runs only while a run is genuinely active; the server value overwrites the
  // SSE-derived stamp whenever a poll lands (see module doc). Keyed on PHASE (not a
  // boolean activity flag) so the running→needs-approval transition restarts the poll.
  useEffect(() => {
    if (phase !== 'running' && phase !== 'needs-approval') return;
    if (!runId) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const heartbeat = await repositories.agentRun.getHeartbeat(runId);
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

  const noteProgress = useCallback(() => {
    setLastProgressAt(new Date().toISOString());
  }, []);

  // ── isStuck — heartbeat-staleness derivation (FR-AGP-022) ────────────────────
  // Active only while a run is genuinely in flight; keyed on elapsed wall-clock time
  // since the last observed progress signal (the SERVER heartbeat, once the poll above
  // has landed at least once — an SSE-derived stamp may still be the value between
  // polls, but the server value overwrites it whenever a fresher poll resolves).
  // A pending ask_user question is EXCLUDED — the run is legitimately paused waiting on
  // the human, not wedged, even past STUCK_RUN_STALE_MS with no fresh heartbeat (the
  // server has no more work to do until the user answers, so its heartbeat genuinely
  // stops advancing — that is expected, not a symptom of being stuck).
  // A wedged run's heartbeat stops changing, so no state update re-renders the hook: schedule one
  // render for the moment the stale window is crossed.
  const [, setStaleTick] = useState(0);
  const runActive = phase === 'running' || phase === 'needs-approval';
  useEffect(() => {
    if (!runActive || lastProgressAt === null) return;
    const remaining = STUCK_RUN_STALE_MS - (Date.now() - new Date(lastProgressAt).getTime());
    if (remaining <= 0) return;
    const id = window.setTimeout(() => setStaleTick((n) => n + 1), remaining + 1);
    return () => window.clearTimeout(id);
  }, [runActive, lastProgressAt]);

  const isStuck =
    !hasPendingQuestion &&
    runActive &&
    lastProgressAt !== null &&
    Date.now() - new Date(lastProgressAt).getTime() > STUCK_RUN_STALE_MS;

  return { lastProgressAt, isStuck, noteProgress, setLastProgressAt };
}
