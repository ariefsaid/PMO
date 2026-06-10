import React, { useEffect, useRef } from 'react';
import { cn } from './cn';
import { tabId, tabPanelId } from './tabIds';

export interface TabItem<V extends string = string> {
  value: V;
  label: string;
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
 * changes (using `scrollIntoView`). A right-edge fade affordance (mask-image gradient)
 * signals "scroll for more" — the same pattern as StatTiles. Desktop tab bar is
 * unchanged (the CSS cascade keeps the desktop look; the snap-x/overflow-x-auto
 * are harmless no-ops on desktop because the tabs fit without scrolling).
 *
 * Each tab is ≥44px tall (h-11 = 44px) to meet the WCAG 2.5.5 touch-target floor on
 * coarse pointers. On desktop 44px looks fine with the underline indicator.
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

  // Scroll the active tab into view on value change (mobile: keeps the active tab
  // visible in the snap strip). `block:'nearest'` avoids vertical scroll on desktop.
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!active) return;
    // scrollIntoView must be gated on reduced-motion: if it would otherwise be smooth,
    // check the global prefers-reduced-motion media query and degrade to instant.
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    active.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: prefersReduced ? 'instant' : 'smooth',
    });
  }, [value]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const idx = items.findIndex((t) => t.value === value);
    const next =
      e.key === 'ArrowRight'
        ? items[(idx + 1) % items.length]
        : items[(idx - 1 + items.length) % items.length];
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
            aria-selected={active}
            aria-controls={tabPanelId(idBase, t.value)}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={cn(
              // h-11 = 44px — WCAG 2.5.5 touch-target floor; looks fine on desktop too.
              // snap-start: this tab is the snap destination when scrolling the strip.
              // shrink-0: prevents tabs from squishing (needed for proper snap behaviour).
              'relative h-11 shrink-0 snap-start px-3.5 text-[13.5px] font-medium',
              active
                ? 'ptab-active font-semibold text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
