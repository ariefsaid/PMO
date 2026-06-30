/**
 * Transcript — the scrollable list of conversation entries.
 * role="log" aria-live="polite": AT announces new additions without refocusing.
 * Auto-scrolls to the latest entry unless the user has scrolled up.
 * NFR-AP-PERF-002: keyed entries prevent full-list re-render on each token.
 * FR-AP-013.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { TranscriptEntry } from '@/src/hooks/useAssistantPanel';
import { TranscriptItem } from './TranscriptItem';

interface TranscriptProps {
  transcript: TranscriptEntry[];
}

export const Transcript: React.FC<TranscriptProps> = ({ transcript }) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

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
      {transcript.map((entry) => (
        <TranscriptItem key={entry.key} entry={entry} />
      ))}
      <div ref={bottomRef} aria-hidden />
    </div>
  );
};
