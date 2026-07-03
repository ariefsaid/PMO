/**
 * ThreadList — the caller's own recent conversation threads (FR-AGP-020, AC-AGP-019).
 * Semantic <ul aria-label="Recent conversations">; each row a keyboard-operable
 * <button> (NFR-AGP-A11Y-003). Props arrive already ordered (pinned-first, then
 * recency — DAL owns the order, listAgentThreads) — this component renders as given.
 * Scope safety: the DAL only returns the caller's own live rows (RLS) — this
 * component never receives another user's thread.
 */
import React from 'react';
import type { AgentThreadRow } from '@/src/lib/db/agentThreads';

interface ThreadListProps {
  threads: AgentThreadRow[];
  onOpen: (threadId: string) => void;
}

export const ThreadList: React.FC<ThreadListProps> = ({ threads, onOpen }) => {
  return (
    <div className="border-b border-border px-2 py-2">
      <ul aria-label="Recent conversations" className="flex flex-col gap-0.5">
        {threads.map((thread) => (
          <li key={thread.id}>
            <button
              type="button"
              onClick={() => onOpen(thread.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {thread.pinned_at !== null && (
                <span
                  data-pinned-marker
                  className="shrink-0 text-xs font-medium text-muted-foreground"
                >
                  Pinned
                </span>
              )}
              <span className="truncate">{thread.title}</span>
            </button>
          </li>
        ))}
      </ul>
      {threads.length === 0 && (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">No conversations yet.</p>
      )}
    </div>
  );
};
