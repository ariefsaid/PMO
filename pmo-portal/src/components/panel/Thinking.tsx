/**
 * Thinking — the in-conversation "the assistant is working" presence: where the answer will
 * appear, a pixel-grid loader with the live step label and, after a few seconds, a ticking
 * elapsed counter so a slow run is visibly alive. UX-only; driven by the step events the panel
 * already consumes. Strictly DESIGN.md tokens.
 *
 * Announcement: the status region holds the step label only, so a screen reader hears "working"
 * once per label change. The elapsed counter ticks every second OUTSIDE the live region and is
 * hidden from assistive tech (#2047 accessibility audit).
 * Adapted from MIT-licensed sources; notice in ./THIRD_PARTY_NOTICE.md.
 */
import React, { useEffect, useState } from 'react';
import { friendlyActivity } from '@/src/lib/agent/activityLabel';
import { LoadingState } from './LoadingState';

export const Thinking: React.FC<{ label?: string | null }> = ({ label }) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const text = label ? friendlyActivity(label) : 'Working on your answer';

  return (
    <div className="flex items-center gap-2.5 px-4 py-2">
      <div role="status" aria-live="polite" aria-atomic="true">
        <LoadingState label={text} />
      </div>
      {/* Only after a few seconds: no clutter on a fast reply, reassurance on a slow one. */}
      {elapsed >= 3 && (
        <span aria-hidden className="text-sm tabular-nums text-muted-foreground">
          {elapsed}s
        </span>
      )}
    </div>
  );
};
