import React, { useEffect, useRef } from 'react';
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { cn } from './cn';
import { tabId, tabPanelId } from './tabIds';
import { scrollBehavior } from '@/src/lib/motion';

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
 * In-page tabs (`ptabs`) on Base UI Tabs: underlined active tab; arrow/Home/End roving focus with
 * activation on focus (WAI-ARIA automatic activation) comes from the library.
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
  const mounted = useRef(false);
  useEffect(() => {
    // First mount on the first tab: the strip is already at scroll 0, so skip the forced layout.
    const first = !mounted.current;
    mounted.current = true;
    if (first && value === items[0]?.value) return;
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
    list.scrollBy({ left: offset, behavior: scrollBehavior() });
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps -- items only matter on first mount

  return (
    <BaseTabs.Root value={value} onValueChange={(next) => onChange(next as V)} className="contents">
    <BaseTabs.List
      ref={listRef}
      aria-label={ariaLabel}
      activateOnFocus
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
          <BaseTabs.Tab
            key={t.value}
            value={t.value}
            id={tabId(idBase, t.value)}
            aria-label={t.count != null && t.countPresentation === 'inline'
              ? [t.label, t.count, t.detail].filter((part) => part != null && part !== '').join(' ')
              : undefined}
            aria-controls={active ? tabPanelId(idBase, t.value) : undefined}
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
              // Count badge: neutral fill + accessible neutral text, full radius, text-support
              // (DESIGN.md §5 Count badge). The number is part of the tab's accessible
              // name (a11y: count read in label, not color-only).
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-status-neutral-surface px-1.5 text-support font-medium text-count-foreground">
                {t.count}
              </span>
            )}
            {t.detail && <span className="ml-1.5 tabular text-control font-normal text-muted-foreground">{t.detail}</span>}
          </BaseTabs.Tab>
        );
      })}
    </BaseTabs.List>
    </BaseTabs.Root>
  );
}
