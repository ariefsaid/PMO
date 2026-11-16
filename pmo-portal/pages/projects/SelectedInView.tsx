import { useEffect, useRef, type ReactNode } from 'react';

/** Phone: the scrolling status segment keeps its selected item in view (a chosen "At risk" never sits off-screen). */
export function SelectedInView({ value, className, children }: { value: string; className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = ref.current;
    const selected = scroller?.querySelector<HTMLElement>('[aria-selected="true"], [aria-pressed="true"], [aria-checked="true"]');
    if (!scroller || !selected) return;
    const left = selected.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
    if (left < scroller.scrollLeft || left + selected.offsetWidth > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollLeft = Math.max(0, left - (scroller.clientWidth - selected.offsetWidth) / 2);
    }
  }, [value]);
  return <div ref={ref} data-testid="status-filter-scroll" className={className}>{children}</div>;
}
