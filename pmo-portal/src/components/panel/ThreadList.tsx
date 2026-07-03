/**
 * ThreadList — the caller's own recent conversation threads (FR-AGP-020, AC-AGP-019).
 * Semantic <ul aria-label="Recent conversations">; each row a keyboard-operable
 * <button> (NFR-AGP-A11Y-003). Props arrive already ordered (pinned-first, then
 * recency — DAL owns the order, listAgentThreads) — this component renders as given.
 * Scope safety: the DAL only returns the caller's own live rows (RLS) — this
 * component never receives another user's thread.
 */
import React from 'react';
import type { AgentThreadListItem } from '@/src/lib/db/agentThreads';

interface ThreadListProps {
  threads: AgentThreadListItem[];
  /** ADR-0043 (FR-AGP-021): resume-on-open needs the thread's latest run id (null when
   * the thread has no runs yet). */
  onOpen: (threadId: string, latestRunId: string | null) => void;
}

/** Shape of `agent_threads.scope` (ADR-0043 §1) — `{type, id, label}`, a UI-only hint
 * (FR-AGP-002), never an authorization input. `scope` is untyped jsonb on the DB row, so
 * this narrows defensively rather than trusting the column's static type. */
function scopeLabel(scope: AgentThreadListItem['scope']): string | null {
  if (scope !== null && typeof scope === 'object' && !Array.isArray(scope)) {
    const label = (scope as Record<string, unknown>).label;
    if (typeof label === 'string' && label.length > 0) {
      return label;
    }
  }
  return null;
}

export const ThreadList: React.FC<ThreadListProps> = ({ threads, onOpen }) => {
  return (
    <div className="border-b border-border px-2 py-2">
      <ul aria-label="Recent conversations" className="flex flex-col gap-0.5">
        {threads.map((thread) => {
          const label = scopeLabel(thread.scope);
          return (
            <li key={thread.id}>
              <button
                type="button"
                onClick={() => onOpen(thread.id, thread.latestRunId)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {thread.pinned_at !== null && (
                  <span
                    data-pinned-marker
                    className="shrink-0 text-xs font-medium text-muted-foreground"
                  >
                    Pinned
                    {/* Separator so the accessible name reads "Pinned. <title>" instead of
                        concatenating directly onto the title (F2, NFR-AGP-A11Y-003). */}
                    <span className="sr-only">. </span>
                  </span>
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{thread.title}</span>
                  {label !== null && (
                    <span className="truncate text-xs text-muted-foreground">{label}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {threads.length === 0 && (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">No conversations yet.</p>
      )}
    </div>
  );
};
