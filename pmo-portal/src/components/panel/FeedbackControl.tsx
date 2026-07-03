/**
 * FeedbackControl — thumbs up/down + downvote-reason picker for one assistant
 * transcript event (FR-AGP-024/025, AC-AGP-022, NFR-AGP-A11Y-002).
 * Thumbs are keyboard-operable with programmatic aria-labels ("Good response" /
 * "Bad response") — the icon-less text-button treatment keeps the locked
 * monoline icon set unchanged (no icon exists for thumbs; DESIGN.md "text, not
 * color alone" is satisfied by the label itself). Thumbs-down reveals a
 * downvote-reason picker with the four token-styled reason buttons.
 * Optimistic UI: local rating state updates on click; the DB row (via onRate)
 * is the durable record — a denied UPDATE (non-owner) simply leaves the row
 * unchanged server-side (Error-Handling table), no destructive client effect.
 */
import React, { useState } from 'react';
import type { DownvoteReason } from '@/src/lib/db/agentEvents';
import { trackAgentFeedbackRated } from '@/src/lib/analytics';
import { safeTrack } from '@/src/lib/analytics/safeTrack';

const DOWNVOTE_REASONS: { value: DownvoteReason; label: string }[] = [
  { value: 'inaccurate', label: 'Inaccurate' },
  { value: 'not_helpful', label: 'Not helpful' },
  { value: 'wrong_tool', label: 'Wrong tool' },
  { value: 'too_slow', label: 'Too slow' },
];

interface FeedbackControlProps {
  eventId: string;
  onRate: (eventId: string, rating: 'up' | 'down', reason?: DownvoteReason) => void;
}

const thumbButtonClasses =
  'rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

export const FeedbackControl: React.FC<FeedbackControlProps> = ({ eventId, onRate }) => {
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleUp = () => {
    setRating('up');
    setPickerOpen(false);
    onRate(eventId, 'up', undefined);
    safeTrack(() => trackAgentFeedbackRated('up', undefined));
  };

  const handleDown = () => {
    setRating('down');
    setPickerOpen(true);
  };

  const handleReason = (reason: DownvoteReason) => {
    setPickerOpen(false);
    onRate(eventId, 'down', reason);
    safeTrack(() => trackAgentFeedbackRated('down', reason));
  };

  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={handleUp}
          aria-label="Good response"
          aria-pressed={rating === 'up'}
          className={thumbButtonClasses}
        >
          Good
        </button>
        <button
          type="button"
          onClick={handleDown}
          aria-label="Bad response"
          aria-pressed={rating === 'down'}
          className={thumbButtonClasses}
        >
          Bad
        </button>
      </div>

      {pickerOpen && (
        <div role="group" aria-label="What went wrong?" className="flex flex-wrap gap-1">
          {DOWNVOTE_REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => handleReason(r.value)}
              className="rounded-md border border-border px-2 py-0.5 text-xs text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
