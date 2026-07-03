/**
 * STUCK_RUN_STALE_MS — the heartbeat-staleness threshold for the stuck-run banner
 * (FR-AGP-022). A normal tool round + model turn under MAX_TOOL_ROUNDS=8 completes well
 * inside this window; 45s is long enough to avoid false-positives on a slow-but-live model
 * turn, short enough that a genuinely wedged run surfaces before the user gives up.
 * Sits in the spec's suggested 30–60s band (docs/plans/2026-07-03-agent-persistence.md §0).
 */
export const STUCK_RUN_STALE_MS = 45_000;
