/**
 * EmptyState — shown when the transcript has no messages yet.
 * Includes heading, descriptor, read-only footnote, and example chips.
 * FR-AP-020; AC-AP-017/018.
 * Clicking a chip pre-fills the composer (does NOT auto-submit).
 */
import React from 'react';
import { useAgentContext } from '@/src/lib/agent/context/useAgentContext';
import { EXAMPLE_QUESTIONS } from './emptyState.constants';
import { SUGGESTION_CHIPS } from './suggestionChips.constants';

interface EmptyStateProps {
  /** Called with the selected question text when a chip is clicked. */
  onPick: (question: string) => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onPick }) => {
  const { getContext } = useAgentContext();
  const entityType = getContext().entity?.type;
  const chips = (entityType && SUGGESTION_CHIPS[entityType]) || EXAMPLE_QUESTIONS;

  return (
    <div className="flex flex-col items-start gap-4 px-4 py-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Ask your agent</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          I only see what you can see.
        </p>
      </div>

      <div className="flex flex-col gap-2 w-full">
        {chips.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="rounded-md border border-border px-3 py-2 text-left text-sm text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {q}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">Answers are read-only for now.</p>
    </div>
  );
};
