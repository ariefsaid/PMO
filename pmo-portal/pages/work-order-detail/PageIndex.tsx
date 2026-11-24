import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField, cn } from '@/src/components/ui';
import { scrollBehavior } from '@/src/lib/motion';

export interface PageIndexEntry { id: string; label: string }

/** The page pane that scrolls (the shell's main), and the height the sticky index covers at its top. */
function pane(el: HTMLElement) {
  const root = el.closest<HTMLElement>('.main-scroll');
  const bar = document.querySelector<HTMLElement>('[data-testid="wo-page-index"]');
  return { root, offset: (bar?.offsetHeight ?? 0) + 16 };
}

/** Scroll only the page pane (never the window or the shell) so the group starts just under the index. */
function scrollToGroup(id: string, smooth: boolean) {
  const el = document.getElementById(id);
  if (!el) return null;
  const { root, offset } = pane(el);
  if (root) {
    const top = root.scrollTop + el.getBoundingClientRect().top - root.getBoundingClientRect().top - offset;
    root.scrollTo?.({ top, behavior: smooth ? scrollBehavior() : 'instant' });
  }
  return el;
}

/** Jump to a group: scroll it under the index, focus it, and keep the place in the address for Back and sharing. */
function jumpTo(id: string) {
  scrollToGroup(id, true)?.focus({ preventScroll: true });
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

  // A shared link to a group (`#wo-billing`) lands on it once the page has rendered its panels.
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (!hash || !ids.split('|').includes(hash)) return;
    // Panels above it load in their own time and push it down, so the landing is repeated while they settle, until the
    // reader scrolls on their own.
    const timers = [200, 700, 1400, 2400, 3600].map((ms) => window.setTimeout(() => { scrollToGroup(hash, false); setActive(hash); }, ms));
    const stop = () => timers.forEach((t) => window.clearTimeout(t));
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    events.forEach((e) => window.addEventListener(e, stop, { once: true, passive: true }));
    return () => { stop(); events.forEach((e) => window.removeEventListener(e, stop)); };
  }, [ids]);

  // The current group is the last one whose top has reached the index.
  useEffect(() => {
    const first = document.getElementById(ids.split('|')[0] ?? '');
    const root = first?.closest<HTMLElement>('.main-scroll');
    if (!first || !root) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const { offset } = pane(first);
      const line = root.getBoundingClientRect().top + offset + 8;
      let current = ids.split('|')[0];
      for (const id of ids.split('|')) {
        const el = document.getElementById(id);
        if (el && el.offsetHeight > 0 && el.getBoundingClientRect().top <= line) current = id;
      }
      // At the foot of the page the last groups cannot reach the index: the last one in view is current.
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) {
        const bottom = root.getBoundingClientRect().bottom;
        for (const id of ids.split('|')) {
          const el = document.getElementById(id);
          if (el && el.offsetHeight > 0 && el.getBoundingClientRect().top < bottom - 80) current = id;
        }
      }
      setActive(current);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => { root.removeEventListener('scroll', onScroll); if (frame) window.cancelAnimationFrame(frame); };
  }, [ids]);

  if (entries.length < 2) return null;
  const label = t('pageIndex.label', 'Sections of this work order');
  return (
    <nav aria-label={label} data-testid="wo-page-index"
      className="sticky top-0 z-10 -mx-[var(--space-page-gutter)] mt-4 mb-[var(--space-section)] border-b border-border bg-[hsl(var(--surface-canvas))] px-[var(--space-page-gutter)]">
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
  <div id={id} tabIndex={-1} aria-label={label} role="group" className="flex flex-col gap-[var(--space-section)] outline-none empty:hidden">
    {children}
  </div>
);
