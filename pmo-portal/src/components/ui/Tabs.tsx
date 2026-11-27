import { useTranslation } from 'react-i18next';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { cn } from './cn';
import { Icon } from './icons';
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
  /** Record pages: the heading sits inside the bordered record header, so the first label starts on that inset instead of the page edge. */
  insetFirstTab?: boolean | 'panel';
  items: TabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  ariaLabel: string;
  /** Namespace for the generated tab/panel ids so they're unique + stable per surface. */
  idBase: string;
  /** @deprecated Retained for caller compatibility; the selected tab is always revealed. */
  startAtFirst?: boolean;
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
 * The first tab has no left padding, so its label starts on the same edge as the page heading above it.
 *
 * Tokens: `primary` underline (`.ptab-active::after`), `muted-foreground` inactive
 * text, `border` bottom divider. Overflow fades use the foreground and content-inset tokens.
 */
export function Tabs<V extends string = string>({
  items,
  value,
  onChange,
  ariaLabel,
  idBase,
  className,
  insetFirstTab = false,
}: TabsProps<V>) {
  const { t } = useTranslation('common');
  const listRef = useRef<HTMLDivElement>(null);
  const [stripWidth, setStripWidth] = useState(0);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  const syncOverflow = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const left = list.scrollLeft > 2;
    const right = list.scrollLeft + list.clientWidth < list.scrollWidth - 2;
    setOverflow((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const resize = () => {
      syncOverflow();
      setStripWidth(list.clientWidth);
    };
    resize();
    list.addEventListener('scroll', syncOverflow, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    ro?.observe(list);
    return () => {
      list.removeEventListener('scroll', syncOverflow);
      ro?.disconnect();
    };
  }, [syncOverflow, items.length]);

  // Scroll only the tab strip: scrollIntoView also scrolls the page vertically,
  // which can move the record header out of view on arrival.
  const mounted = useRef(false);
  // Counts arriving after mount widen the tabs, so the selected one is brought back into view then too.
  const widths = items.map((item) => `${item.count ?? ''}${item.detail ?? ''}`).join('|');
  useEffect(() => {
    syncOverflow();
    // First mount on the first tab: the strip is already at scroll 0, so skip the forced layout.
    const first = !mounted.current;
    mounted.current = true;
    if (first && value === items[0]?.value) return;
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!active) return;
    const strip = list.getBoundingClientRect();
    if (strip.right <= strip.left) return;
    const tab = active.getBoundingClientRect();
    const style = getComputedStyle(active);
    const left = tab.left - (parseFloat(style.scrollMarginLeft) || 0);
    const right = tab.right + (parseFloat(style.scrollMarginRight) || 0);
    // Keep the active tab outside the edge fades as well as inside the physical track.
    const fadeInset = parseFloat(getComputedStyle(list).scrollPaddingInlineStart) || 0;
    const safeLeft = strip.left + (list.scrollLeft > 2 ? fadeInset : 0);
    const safeRight = strip.right - (list.scrollLeft + list.clientWidth < list.scrollWidth - 2 ? fadeInset : 0);
    const offset = left < safeLeft ? left - safeLeft : right > safeRight ? right - safeRight : 0;
    if (!offset) return;
    list.scrollBy({ left: offset, behavior: scrollBehavior() });
  }, [value, widths, stripWidth, syncOverflow]); // eslint-disable-line react-hooks/exhaustive-deps -- items only matter on first mount

  const nudge = (dir: -1 | 1) => {
    const list = listRef.current;
    if (!list) return;
    const start = list.scrollLeft;
    const trackLeft = list.getBoundingClientRect().left;
    const inset = parseFloat(getComputedStyle(list).scrollPaddingInlineStart) || 0;
    const maximum = Math.max(0, list.scrollWidth - list.clientWidth);
    const boundaries = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'))
      .map((tab) => Math.min(maximum, Math.max(0, start + tab.getBoundingClientRect().left - trackLeft - inset)));
    const next = dir > 0
      ? boundaries.find((boundary) => boundary > start + 2) ?? maximum
      : boundaries.reverse().find((boundary) => boundary < start - 2) ?? 0;
    list.scrollBy({ left: next - start, behavior: scrollBehavior() });
  };

  const ink = 'hsl(var(--foreground))';
  const fade = 'var(--space-content-inset)';
  const edgeMask = overflow.left && overflow.right
    ? `linear-gradient(to right, transparent, ${ink} ${fade}, ${ink} calc(100% - ${fade}), transparent)`
    : overflow.left
      ? `linear-gradient(to right, transparent, ${ink} ${fade})`
      : overflow.right
        ? `linear-gradient(to right, ${ink} calc(100% - ${fade}), transparent)`
        : undefined;

  return (
    <BaseTabs.Root value={value} onValueChange={(next) => onChange(next as V)} className="contents">
    <div className="relative flex min-w-0 items-center gap-1">
    {(overflow.left || overflow.right) && (
      <button
        type="button"
        aria-label={t('ui:tabs.scrollLeft', 'Scroll tabs left')}
        disabled={!overflow.left}
        onClick={() => nudge(-1)}
        className="mb-4 flex size-8 shrink-0 disabled:invisible items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-xs hover:bg-surface-hover hover:text-foreground [&_svg]:size-4"
      >
        <span className="rotate-180"><Icon name="chev" /></span>
      </button>
    )}
    <BaseTabs.List
      ref={listRef}
      aria-label={ariaLabel}
      activateOnFocus
      style={{ maskImage: edgeMask, scrollPaddingInline: 'var(--space-content-inset)' }}
      className={cn(
        // Layout: flex strip, no wrap, gap between tabs
        'mb-4 flex min-w-0 flex-1 flex-nowrap whitespace-nowrap gap-0.5 border-b border-border',
        // Horizontal scroll-snap strip when tabs exceed container width
        'overflow-x-auto snap-x snap-mandatory',
        // Scrollbar-free (aesthetic — chromeless thin scrollbar on macOS; no layout impact)
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
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
              'relative inline-flex h-[var(--table-head-height)] max-w-[calc(100%-2*var(--space-content-inset))] shrink-0 snap-start items-center px-4 text-control font-normal',
              insetFirstTab === 'panel'
                ? 'first:ps-[calc(var(--panel-inset)+1px)]'
                : insetFirstTab
                  ? 'first:ps-[calc(var(--space-content-inset)+1px)]'
                  : 'first:ps-0 first:pe-0',
              active
                // AC-RAM-004 (#688): raw text-primary as small text is ~3.5:1 on the dark canvas
                // (sub-AA, DESIGN.md accessibility posture). text-primary-text is the AA on-canvas
                // variant; the underline (::after, decorative, non-text) keeps --primary.
                ? 'ptab-active text-primary-text'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="min-w-0 truncate">{t.label}</span>
            {t.count != null && t.countPresentation === 'inline' && (
              <span className="ml-1.5 shrink-0 tabular text-support font-normal text-muted-foreground">
                {t.count}
              </span>
            )}
            {t.count != null && t.countPresentation !== 'inline' && (
              // Count badge: neutral fill + accessible neutral text, full radius, text-support
              // (DESIGN.md §5 Count badge). The number is part of the tab's accessible
              // name (a11y: count read in label, not color-only).
              <span className="ml-1.5 inline-flex h-5 shrink-0 min-w-5 items-center justify-center rounded-full bg-status-neutral-surface px-1.5 text-support font-medium text-count-foreground">
                {t.count}
              </span>
            )}
            {t.detail && <span className="ml-1.5 shrink-0 tabular text-control font-normal text-muted-foreground">{t.detail}</span>}
          </BaseTabs.Tab>
        );
      })}
    </BaseTabs.List>
    {(overflow.left || overflow.right) && (
      <button
        type="button"
        aria-label={t('ui:tabs.scrollRight', 'Scroll tabs right')}
        disabled={!overflow.right}
        onClick={() => nudge(1)}
        className="mb-4 flex size-8 shrink-0 disabled:invisible items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-xs hover:bg-surface-hover hover:text-foreground [&_svg]:size-4"
      >
        <Icon name="chev" />
      </button>
    )}
    </div>
    </BaseTabs.Root>
  );
}
