import React, { useEffect, useState } from 'react';

/**
 * Crossfades its child when `swapKey` changes (#1970): old and new overlap (scale + blur +
 * opacity), no blank gap. No animation on first mount; reduced motion disables it in index.css.
 */
export const Crossfade: React.FC<{ swapKey: string; children: React.ReactNode }> = ({ swapKey, children }) => {
  const [shown, setShown] = useState({ key: swapKey, node: children });
  const [leaving, setLeaving] = useState<React.ReactNode>(null);
  if (swapKey !== shown.key) {
    setLeaving(shown.node);
    setShown({ key: swapKey, node: children });
  } else if (shown.node !== children) {
    setShown({ key: swapKey, node: children });
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(null), 200);
    return () => clearTimeout(timer);
  }, [leaving]);

  return (
    <span className="icon-swap" aria-hidden>
      {leaving && <span className="icon-swap-out">{leaving}</span>}
      <span key={swapKey} className={leaving ? 'icon-swap-in' : undefined}>
        {children}
      </span>
    </span>
  );
};
