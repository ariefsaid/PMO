import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField, cn } from '@/src/components/ui';
import { scrollBehavior } from '@/src/lib/motion';

export interface PageIndexEntry { id: string; label: string }

/** Jump to a group: scroll it to the top of the page pane, focus it, and keep the place in the address for Back and sharing. */
function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
  el.focus({ preventScroll: true });
  window.history.replaceState(window.history.state, '', `#${id}`);
}

/**
 * The work-order page's index (walk T-G1): one long record page, so its groups are named in a bar that stays in view.
 * Every panel stays on the page (find-in-page, print and deep links still reach it); the bar only moves the reader.
 * Wide screens: a row of links that wraps, never clipping its last entry. Phone: one picker, like the project page's areas.
 */
export const PageIndex: React.FC<{ entries: PageIndexEntry[] }> = ({ entries }) => {
  const { t } = useTranslation('workOrders');
  const [active, setActive] = useState(entries[0]?.id ?? '');
  const ids = entries.map((e) => e.id).join('|');

  // A shared link to a group (`#wo-billing`) lands on it once the page has rendered.
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (!hash || !ids.split('|').includes(hash)) return;
    const frame = window.requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ block: 'start' }));
    return () => window.cancelAnimationFrame(frame);
  }, [ids]);

  // The group nearest the top of the pane is the current one.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const groups = ids.split('|').map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    if (groups.length === 0) return;
    const root = groups[0].closest<HTMLElement>('.main-scroll');
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver((records) => {
      records.forEach((r) => seen.set(r.target.id, r.isIntersecting));
      const first = groups.find((g) => seen.get(g.id));
      if (first) setActive(first.id);
    }, { root, rootMargin: '-72px 0px -55% 0px' });
    groups.forEach((g) => observer.observe(g));
    return () => observer.disconnect();
  }, [ids]);

  if (entries.length < 2) return null;
  const label = t('pageIndex.label', 'Sections of this work order');
  return (
    <nav aria-label={label} data-testid="wo-page-index"
      className="sticky top-0 z-10 -mx-[var(--space-page-gutter)] mb-[var(--space-section)] border-b border-border bg-[hsl(var(--surface-canvas))] px-[var(--space-page-gutter)]">
      <div className="py-2 md:hidden">
        <SelectField label={label} hideLabel value={active} onChange={(id) => { setActive(id); jumpTo(id); }}
          options={entries.map((e) => ({ value: e.id, label: e.label }))} className="touch-target w-full" />
      </div>
      <ul className="hidden flex-wrap gap-x-0.5 md:flex [&>li:first-child>a]:ps-0">
        {entries.map((e) => (
          <li key={e.id}>
            <a href={`#${e.id}`} aria-current={active === e.id ? 'location' : undefined}
              onClick={(event) => { event.preventDefault(); setActive(e.id); jumpTo(e.id); }}
              className={cn('relative flex h-11 items-center px-3 text-control',
                active === e.id ? 'ptab-active text-primary-text' : 'text-muted-foreground hover:text-foreground')}>
              {e.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
};

/** One group of the page: the index's jump target. Renders nothing visible of its own; an empty group takes no gap. */
export const PageGroup: React.FC<{ id: string; label: string; children: React.ReactNode }> = ({ id, label, children }) => (
  <div id={id} tabIndex={-1} aria-label={label} role="group" className="flex scroll-mt-16 flex-col gap-[var(--space-section)] outline-none empty:hidden">
    {children}
  </div>
);
