/**
 * StuckRunBanner — surfaces when an active run's heartbeat has gone stale
 * (FR-AGP-022/023, AC-AGP-020/021, NFR-AGP-A11Y-001/002). Keyed purely on
 * `now - lastProgressAt > STUCK_RUN_STALE_MS` while `status` is an active state
 * ('running'/'paused'/'needs-approval') — independent of SSE liveness: a live
 * SSE can be silently wedged, a dropped SSE can be genuinely still working
 * server-side (the server-side heartbeat is the source of truth).
 * Reuses the ErrorCard's role="status"/card token treatment (AssistantPanel.tsx).
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
  onRetry: () => void;
  onCancel: () => void;
}

export const StuckRunBanner: React.FC<StuckRunBannerProps> = ({
  status,
  lastProgressAt,
  now,
  onRetry,
  onCancel,
}) => {
  if (!ACTIVE_STATUSES.includes(status)) return null;
  if (lastProgressAt === null) return null;

  const nowMs = now ?? Date.now();
  const elapsed = nowMs - new Date(lastProgressAt).getTime();
  if (elapsed <= STUCK_RUN_STALE_MS) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="This is taking longer than expected"
      className="mx-4 my-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm"
    >
      <p className="font-medium text-foreground">This is taking longer than expected.</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        The assistant hasn&apos;t made progress in a while. You can retry or cancel.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          aria-label="Retry"
          className="h-8 rounded-md border border-transparent bg-primary px-3 py-0 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="h-8 rounded-md border border-border px-3 py-0 text-xs font-medium text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
