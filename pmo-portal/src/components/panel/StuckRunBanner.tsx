/**
 * StuckRunBanner — surfaces when an active run's heartbeat has gone stale
 * (FR-AGP-022/023, AC-AGP-020/021, NFR-AGP-A11Y-001/002). Keyed purely on
 * `now - lastProgressAt > STUCK_RUN_STALE_MS` while `status` is an active state
 * ('running'/'paused'/'needs-approval') — independent of SSE liveness: a live
 * SSE can be silently wedged, a dropped SSE can be genuinely still working
 * server-side (the server-side heartbeat is the source of truth).
 *
 * Copy posture: a slow-but-working run reads as REASSURANCE, not alarm. When the
 * panel can share how much the agent has already done (doneCount/lastActivity from
 * the persistent activity trail), the banner frames the wait as "this is a bigger
 * question, N steps done so far" with a clear way to stop. Reuses the ErrorCard's
 * role="status"/card token treatment (AssistantPanel.tsx).
 */
import React from 'react';
import type { AgentRunStatus } from '@/src/lib/agent/runtime/port';
import { STUCK_RUN_STALE_MS } from './stuckRun.constants';

const ACTIVE_STATUSES: readonly AgentRunStatus[] = ['running', 'paused', 'needs-approval'];

interface StuckRunBannerProps {
  status: AgentRunStatus;
  lastProgressAt: string | null;
  /** Injectable clock (ms epoch) for deterministic tests; defaults to Date.now(). */
  now?: number;
  /** How many activity-trail steps have completed so far (optional, from the panel). */
  doneCount?: number;
  /** Friendly label of the most recently completed step (optional, from the panel). */
  lastActivity?: string;
  onRetry: () => void;
  onCancel: () => void;
}

export const StuckRunBanner: React.FC<StuckRunBannerProps> = ({
  status,
  lastProgressAt,
  now,
  doneCount,
  lastActivity,
  onRetry,
  onCancel,
}) => {
  if (!ACTIVE_STATUSES.includes(status)) return null;
  if (lastProgressAt === null) return null;

  const nowMs = now ?? Date.now();
  const elapsed = nowMs - new Date(lastProgressAt).getTime();
  if (elapsed <= STUCK_RUN_STALE_MS) return null;

  const completedSteps = doneCount ?? 0;
  const body =
    completedSteps > 0
      ? `This is a bigger question — ${completedSteps} step${
          completedSteps === 1 ? '' : 's'
        } done so far${lastActivity ? ` (last: ${lastActivity})` : ''}. You can keep waiting or stop.`
      : 'This is taking a little longer than usual — you can keep waiting, or stop and try again.';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Still working"
      className="mx-4 my-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm"
    >
      <p className="font-medium text-foreground">Still working…</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Stop"
          className="h-8 rounded-md border border-transparent bg-primary px-3 py-0 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Stop
        </button>
        <button
          type="button"
          onClick={onRetry}
          aria-label="Retry"
          className="h-8 rounded-md border border-border px-3 py-0 text-xs font-medium text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Retry
        </button>
      </div>
    </div>
  );
};
