/**
 * Chat — the scrollable conversation: user messages, assistant rows and runs of tool chips.
 * role="log" aria-live="polite": AT announces new additions without refocusing.
 * Auto-scrolls to the latest entry unless the user has scrolled up.
 * NFR-AP-PERF-002: keyed entries prevent full-list re-render on each token; each row is memoised
 * (#2047 performance audit), so a streamed frame re-renders only the streaming row.
 * Adapted from MIT-licensed sources; notice in ./THIRD_PARTY_NOTICE.md.
 * NFR-AP-PERF-003: capped at TRANSCRIPT_CAP visible entries; a "Show earlier"
 *   affordance expands to show all when the cap is exceeded.
 * FR-AP-013.
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { TranscriptEntry, ChipStateMap, AnsweredMap, RunPhase } from '@/src/hooks/useAssistantPanel';
import type { DownvoteReason } from '@/src/lib/db/agentEvents';
import { TranscriptItem } from './TranscriptItem';
import { ToolChips } from './ToolChips';

/** NFR-AP-PERF-003: maximum number of visible transcript entries before the cap kicks in. */
const TRANSCRIPT_CAP = 200;

interface ChatProps {
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
  /**
   * Review-remediation item 3 (F3): resolved ask-user answers keyed by
   * questionId, threaded down to TranscriptItem/QuestionChips.
   */
  answeredMap?: AnsweredMap;
  /**
   * Review-remediation item 3 (F3): the panel's run phase — threaded down so a
   * pending question can hard-disable itself while phase==='out-of-credits'.
   */
  phase?: RunPhase;
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

/** Consecutive tool events read as one run of chips, not a stack of separate rows. */
type Row = { key: string; entry: TranscriptEntry } | { key: string; tools: TranscriptEntry[] };

function toRows(entries: TranscriptEntry[]): Row[] {
  const rows: Row[] = [];
  for (const entry of entries) {
    const last = rows[rows.length - 1];
    if (entry.event.type !== 'tool') rows.push({ key: entry.key, entry });
    else if (last && 'tools' in last) last.tools.push(entry);
    else rows.push({ key: entry.key, tools: [entry] });
  }
  return rows;
}

// A row re-renders only when one of its entries changed identity (the streaming one does).
const ToolRun = React.memo(
  ({ tools }: { tools: TranscriptEntry[] }) => <ToolChips payloads={tools.map((t) => t.event.payload)} />,
  (a, b) => a.tools.length === b.tools.length && a.tools.every((t, i) => t === b.tools[i]),
);
ToolRun.displayName = 'ToolRun';

export const Chat: React.FC<ChatProps> = ({ transcript, emptySlot, chipStateMap, answeredMap, phase, onApprove, onDeny, onAnswer, onRate }) => {
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

  // Auto-scroll to bottom when new entries arrive (unless user scrolled up).
  // 'instant', deliberately (#2126): a new chunk used to re-start a smooth tween that
  // interrupted the previous one, so the panel kept moving for the whole response.
  useEffect(() => {
    if (atBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
    }
  }, [transcript, atBottom]);

  // NFR-AP-PERF-003: apply the cap unless the user has expanded ("Show earlier")
  const isCapped = !showAll && transcript.length > TRANSCRIPT_CAP;
  const visibleEntries = useMemo(
    () => (isCapped ? transcript.slice(-TRANSCRIPT_CAP) : transcript),
    [isCapped, transcript],
  );
  const hiddenCount = transcript.length - visibleEntries.length;
  const rows = useMemo(() => toRows(visibleEntries), [visibleEntries]);
  // The answer is streaming while the run is live and the newest entry is assistant text.
  const newest = transcript[transcript.length - 1];
  const streamingKey = phase === 'running' && newest?.event.type === 'assistant' ? newest.key : null;

  return (
    <div
      ref={containerRef}
      role="log"
      aria-label="Conversation"
      aria-live="polite"
      aria-relevant="additions"
      className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
      onScroll={handleScroll}
    >
      {transcript.length === 0 && emptySlot}

      {/* "Show earlier" affordance — appears at the top when entries are hidden */}
      {isCapped && (
        <div className="text-center text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="rounded px-2 py-1 underline hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Show earlier ({hiddenCount} hidden)
          </button>
        </div>
      )}

      {rows.map((row) =>
        'tools' in row ? (
          <ToolRun key={row.key} tools={row.tools} />
        ) : (
          <TranscriptItem
            key={row.key}
            entry={row.entry}
            streaming={row.key === streamingKey}
            chipStateMap={chipStateMap}
            answeredMap={answeredMap}
            phase={phase}
            onApprove={onApprove}
            onDeny={onDeny}
            onAnswer={onAnswer}
            onRate={onRate}
          />
        ),
      )}
      <div ref={bottomRef} aria-hidden />
    </div>
  );
};
