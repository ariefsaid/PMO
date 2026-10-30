import React, { useEffect, useRef } from 'react';
import { cn } from './cn';
import { tabId, tabPanelId } from './tabIds';

export interface TabItem<V extends string = string> {
  value: V;
  label: string;
  /**
   * Optional count badge rendered after the label (e.g. "Documents 7"). The count is
   * appended to the tab's accessible name as text — never color-only (DESIGN.md §5
   * Count badge). Omit (or pass null/undefined) for tabs that carry no count.
   */
  count?: number | null;
  /** Display a project-section count as a quiet inline value instead of a badge. */
  countPresentation?: 'badge' | 'inline';
  /** Optional secondary tab detail (e.g. a money total), still exposed in the tab name. */
  detail?: string;
}

export interface TabsProps<V extends string = string> {
  items: TabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  ariaLabel: string;
  /** Namespace for the generated tab/panel ids so they're unique + stable per surface. */
  idBase: string;
  className?: string;
}

/**
 * In-page tabs (`ptabs`): underlined active tab, arrow-key navigation.
 *
 * Mobile (PR-3, AC-IXD-MOBILE-W4-PR3-C2): at narrow widths the tab list becomes a
 * horizontally-scrollable scroll-snap strip — `overflow-x-auto snap-x snap-mandatory`
 * with each tab `snap-start`. The active tab is scrolled into view whenever `value`
 * changes by scrolling the strip horizontally. A right-edge fade affordance (mask-image gradient)
 * signals "scroll for more" — the same pattern as StatTiles. The strip stays
 * horizontal at desktop widths; overflow and snap are harmless when the tabs fit.
 *
 * Each tab follows the 52px shared rhythm and exceeds the WCAG 2.5.5 44px
 * touch-target floor on coarse pointers.
 *
 * Tokens: `primary` underline (`.ptab-active::after`), `muted-foreground` inactive
 * text, `border` bottom divider. No new tokens; the mask-image gradient uses #000
 * (opaque mask, not a color) to transparent — compositor-only, no repaint.
 */
export function Tabs<V extends string = string>({
  items,
  value,
  onChange,
  ariaLabel,
  idBase,
  className,
}: TabsProps<V>) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll only the tab strip: scrollIntoView also scrolls the page vertically,
  // which can move the record header out of view on arrival.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!active) return;
    const strip = list.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    const style = getComputedStyle(active);
    const left = tab.left - (parseFloat(style.scrollMarginLeft) || 0);
    const right = tab.right + (parseFloat(style.scrollMarginRight) || 0);
    const offset = left < strip.left ? left - strip.left : right > strip.right ? right - strip.right : 0;
    if (!offset) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollBy({ left: offset, behavior: prefersReduced ? 'instant' : 'smooth' });
  }, [value]);

  // Roving focus (WAI-ARIA tabs pattern): DOM focus moves to the newly-activated tab
  // (synchronously, before onChange → navigate commits). #879: the AppShell route-focus
  // effect runs after commit; tab-switch navigations carry the `pmoTabSwitch` marker so
  // it skips its <main> yank and this focus survives (WCAG 2.4.3).
  const focusTab = (v: V) => {
    const root = listRef.current;
    if (!root) return;
    const id = tabId(idBase, v);
    const tabs = root.querySelectorAll<HTMLElement>('[role="tab"]');
    for (const t of tabs) {
      if (t.id === id) {
        t.focus();
        return;
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const isNext = e.key === 'ArrowRight';
    const isPrev = e.key === 'ArrowLeft';
    const isHome = e.key === 'Home';
    const isEnd = e.key === 'End';
    if (!isNext && !isPrev && !isHome && !isEnd) return;
    e.preventDefault();
    const idx = items.findIndex((t) => t.value === value);
    const next = isNext
      ? items[(idx + 1) % items.length]
      : isPrev
        ? items[(idx - 1 + items.length) % items.length]
        : isHome
          ? items[0]
          : items[items.length - 1];
    focusTab(next.value);
    onChange(next.value);
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        // Layout: flex strip, no wrap, gap between tabs
        'mb-4 flex whitespace-nowrap gap-0.5 border-b border-border',
        // Mobile scroll-snap strip (OD-W4-2, C2):
        // overflow-x-auto: allows horizontal scrolling when tabs exceed viewport
        // snap-x snap-mandatory: each tab snaps cleanly
        // The right-edge fade (mask-image) makes it clear more tabs exist
        'overflow-x-auto snap-x snap-mandatory',
        // Scrollbar-free (aesthetic — chromeless thin scrollbar on macOS; no layout impact)
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        // Right-edge fade: linear gradient mask signals "scroll for more"
        // Uses #000 (opaque mask) to transparent — compositor only, no repaint.
        // Reduced-motion: the mask is CSS, no animation; always-on is correct.
        '[mask-image:linear-gradient(to_right,#000_calc(100%-28px),transparent_100%)]',
        className,
      )}
    >
      {items.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            id={tabId(idBase, t.value)}
            aria-label={t.count != null && t.countPresentation === 'inline'
              ? [t.label, t.count, t.detail].filter((part) => part != null && part !== '').join(' ')
              : undefined}
            aria-selected={active}
            aria-controls={active ? tabPanelId(idBase, t.value) : undefined}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={cn(
              // 52px tab rhythm; remains above the WCAG 2.5.5 coarse-pointer target floor.
              // snap-start: this tab is the snap destination when scrolling the strip.
              // shrink-0: prevents tabs from squishing (needed for proper snap behaviour).
              'relative h-[var(--table-head-height)] shrink-0 snap-start px-4 text-control font-normal',
              active
                // AC-RAM-004 (#688): raw text-primary as small text is ~3.5:1 on the dark canvas
                // (sub-AA, DESIGN.md accessibility posture). text-primary-text is the AA on-canvas
                // variant; the underline (::after, decorative, non-text) keeps --primary.
                ? 'ptab-active text-primary-text'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {t.count != null && t.countPresentation === 'inline' && (
              <span className="ml-1.5 tabular text-support font-normal text-muted-foreground">
                {t.count}
              </span>
            )}
            {t.count != null && t.countPresentation !== 'inline' && (
              // Count badge: neutral fill + accessible neutral text, full radius, text-[11px]
              // (DESIGN.md §5 Count badge). The number is part of the tab's accessible
              // name (a11y: count read in label, not color-only).
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-status-neutral-surface px-1.5 text-[11px] font-medium text-count-foreground">
                {t.count}
              </span>
            )}
            {t.detail && <span className="ml-1.5 tabular text-[12px] font-normal text-muted-foreground">{t.detail}</span>}
          </button>
        );
      })}
    </div>
  );
}
