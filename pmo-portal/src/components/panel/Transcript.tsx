/**
 * Transcript — the scrollable list of conversation entries.
 * role="log" aria-live="polite": AT announces new additions without refocusing.
 * Auto-scrolls to the latest entry unless the user has scrolled up.
 * NFR-AP-PERF-002: keyed entries prevent full-list re-render on each token.
 * NFR-AP-PERF-003: capped at TRANSCRIPT_CAP visible entries; a "Show earlier"
 *   affordance expands to show all when the cap is exceeded.
 * FR-AP-013.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { TranscriptEntry, ChipStateMap } from '@/src/hooks/useAssistantPanel';
import type { DownvoteReason } from '@/src/lib/db/agentEvents';
import { TranscriptItem } from './TranscriptItem';

/** NFR-AP-PERF-003: maximum number of visible transcript entries before the cap kicks in. */
export const TRANSCRIPT_CAP = 200;

interface TranscriptProps {
  transcript: TranscriptEntry[];
  /**
   * Optional slot rendered when transcript is empty (e.g. EmptyState).
   * Lives inside the role="log" container so the live region is always present
   * in the DOM regardless of transcript state (AC-AP-021).
   */
  emptySlot?: React.ReactNode;
  /**
   * A3: chip state keyed by pendingId — each needs-approval chip has its own state.
   * Blocker-8 fix: not a single global atom; supports sequential proposals in one run.
   */
  chipStateMap?: ChipStateMap;
  /** A3: approve callback threaded down. */
  onApprove?: () => void;
  /** A3: deny callback threaded down. */
  onDeny?: () => void;
  /**
   * ADR-0045 §2: called with (questionId, optionId?, freeText?) when the user
   * resolves a pending ask-user question via QuestionChips.
   */
  onAnswer?: (questionId: string, optionId?: string, freeText?: string) => void;
  /**
   * ADR-0043 (FR-AGP-024/025): rate-feedback callback threaded down to
   * assistant rows. Thumbs render only when this is provided.
   */
  onRate?: (eventId: string, rating: 'up' | 'down', reason?: DownvoteReason) => void;
}

export const Transcript: React.FC<TranscriptProps> = ({ transcript, emptySlot, chipStateMap, onApprove, onDeny, onAnswer, onRate }) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  // NFR-AP-PERF-003: when true, all entries are shown (user clicked "Show earlier")
  const [showAll, setShowAll] = useState(false);

  // Reset showAll when a new conversation clears the transcript
  useEffect(() => {
    if (transcript.length === 0) setShowAll(false);
  }, [transcript.length]);

  // Track whether the user has scrolled up manually
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(distanceFromBottom < 40);
  }, []);

  // Auto-scroll to bottom when new entries arrive (unless user scrolled up)
  useEffect(() => {
    if (atBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [transcript, atBottom]);

  // NFR-AP-PERF-003: apply the cap unless the user has expanded ("Show earlier")
  const isCapped = !showAll && transcript.length > TRANSCRIPT_CAP;
  const visibleEntries = isCapped ? transcript.slice(-TRANSCRIPT_CAP) : transcript;
  const hiddenCount = transcript.length - visibleEntries.length;

  return (
    <div
      ref={containerRef}
      role="log"
      aria-label="Conversation"
      aria-live="polite"
      aria-relevant="additions"
      className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
      onScroll={handleScroll}
    >
      {transcript.length === 0 && emptySlot}

      {/* "Show earlier" affordance — appears at the top when entries are hidden */}
      {isCapped && (
        <div className="text-center text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="rounded px-2 py-1 underline hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Show earlier ({hiddenCount} hidden)
          </button>
        </div>
      )}

      {visibleEntries.map((entry) => (
        <TranscriptItem
          key={entry.key}
          entry={entry}
          chipStateMap={chipStateMap}
          onApprove={onApprove}
          onDeny={onDeny}
          onAnswer={onAnswer}
          onRate={onRate}
        />
      ))}
      <div ref={bottomRef} aria-hidden />
    </div>
  );
};
