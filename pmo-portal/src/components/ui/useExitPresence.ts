import { useEffect, useState } from 'react';

/**
 * Keeps an overlay mounted for its exit animation (#1970). `closing` is true while the
 * exit plays; the duration is read from the `--motion-*` token so CSS stays the single
 * source. Under reduced motion (or a zero token) it unmounts immediately.
 */
export function useExitPresence(open: boolean, durationVar: string): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open || !mounted) return;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ms = reduced ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue(durationVar)) || 0;
    if (ms <= 0) {
      setMounted(false);
      return;
    }
    const timer = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(timer);
  }, [open, mounted, durationVar]);

  return { mounted: open || mounted, closing: !open && mounted };
}
