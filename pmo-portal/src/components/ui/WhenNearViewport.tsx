import React, { useEffect, useRef, useState } from 'react';

export interface WhenNearViewportProps {
  children: React.ReactNode;
  /** Height reserved while waiting, so the block's arrival does not shift the page (default 240px). */
  minHeight?: number;
  /** Distance from the viewport at which children mount (IntersectionObserver rootMargin). */
  rootMargin?: string;
}

/**
 * Mounts children the first time their slot nears the viewport (IntersectionObserver with a 300px
 * approach margin — just before the block scrolls into view), so a below-the-fold block reads its
 * data only when a user could actually see it (AC-PERF-003, plan Step 1c). Once seen, children stay
 * mounted forever — scrolling away never unmounts them.
 *
 * ⚑ When IntersectionObserver is absent (older browsers, jsdom/unit tests), children render
 * IMMEDIATELY: the deferral must never hide content where it cannot be measured. This is why every
 * existing unit suite that renders below-the-fold blocks is unchanged.
 */
export function WhenNearViewport({ children, minHeight = 240, rootMargin = '300px' }: WhenNearViewportProps) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  // Initial state reads the global: no observer → nothing to wait for → children now.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (seen || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    if (slotRef.current) observer.observe(slotRef.current);
    return () => observer.disconnect();
  }, [seen, rootMargin]);
  return (
    <div
      ref={slotRef}
      data-near-viewport={seen ? 'seen' : 'waiting'}
      // The reserved height only applies while waiting; once mounted, the children size the slot.
      style={seen ? undefined : { minHeight }}
    >
      {seen ? children : null}
    </div>
  );
}
