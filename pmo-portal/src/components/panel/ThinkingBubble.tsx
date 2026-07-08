/**
 * ThinkingBubble — a prominent, in-conversation "the assistant is working" presence.
 *
 * Replaces the tiny bottom-of-panel "Working…" line that read as a frozen/stuck box (the
 * user couldn't tell if the conversation was alive or hung). This renders where the answer
 * will appear — a left-aligned assistant bubble with an animated typing indicator, the live
 * friendly step label ("Checking your projects…"), and a ticking elapsed-seconds counter so
 * the user can SEE it is actively progressing. UX-only; driven by the same step events the
 * panel already consumes. Strictly DESIGN.md tokens.
 */
import React, { useEffect, useState } from 'react';
import { friendlyActivity } from '@/src/lib/agent/activityLabel';

/** Three bouncing dots — a familiar "typing…" cue. Staggered for a wave; motion-reduce safe. */
const TypingDots: React.FC = () => (
  <span aria-hidden className="inline-flex items-center gap-1">
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        className="size-1.5 rounded-full bg-muted-foreground/70 motion-safe:animate-bounce"
        style={{ animationDelay: `${i * 160}ms`, animationDuration: '1s' }}
      />
    ))}
  </span>
);

export const ThinkingBubble: React.FC<{ label?: string | null }> = ({ label }) => {
  // Live elapsed counter — the single clearest "not stuck" signal. Starts when the run
  // starts (this component mounts on phase==='running') and ticks every second.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const text = label ? friendlyActivity(label) : 'Working on your answer';

  return (
    <div className="px-4 py-2" role="status" aria-live="polite" aria-atomic="true">
      <div className="inline-flex max-w-[85%] items-center gap-2.5 rounded-2xl rounded-tl-sm bg-secondary/60 px-3.5 py-2.5 text-sm">
        <TypingDots />
        <span className="text-muted-foreground">{text}</span>
        {/* Only after a few seconds — avoids clutter on a fast reply, reassures on a slow one. */}
        {elapsed >= 3 && (
          <span className="tabular-nums text-xs text-muted-foreground/60">· {elapsed}s</span>
        )}
      </div>
    </div>
  );
};
