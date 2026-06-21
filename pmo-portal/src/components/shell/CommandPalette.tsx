import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/src/components/ui/cn';
import { Icon, type IconName } from '@/src/components/ui/icons';
import { filterAndCap } from '@/src/hooks/useRecordSearch';

export interface PaletteItem {
  id: string;
  group: string;
  title: string;
  sub?: string;
  /** Mono record code (e.g. PRJ-0142). */
  code?: string;
  icon: IconName;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  items: PaletteItem[];
  onClose: () => void;
  /** Element to restore focus to when the palette closes (closes mockup gap). */
  returnFocusTo?: HTMLElement | null;
  /** Record lists are still fetching → show skeleton rows (not a spinner). */
  loading?: boolean;
  /** A record list query failed → show the inline retry note. */
  error?: boolean;
  /** Re-run the failed record-list queries (wired to the retry affordance). */
  onRetry?: () => void;
}

/** Skeleton rows shown while the record lists load. */
const SKELETON_COUNT = 4;
/** Debounce (ms) applied to the query before filtering (Linear/Raycast feel). */
const FILTER_DEBOUNCE_MS = 120;

interface RenderGroup {
  name: string;
  items: PaletteItem[];
  /** Matches dropped by the cap → drives the "+N more" footer. */
  overflow: number;
}

/**
 * ⌘K command palette. role=dialog aria-modal, grouped role=listbox/option,
 * ArrowUp/Down navigate the flat (capped) result order, Enter runs, Esc closes,
 * focus trapped, focus restored to the trigger on close. Records (when present)
 * are searched alongside Navigate/Actions; each group caps at RECORD_GROUP_CAP rows
 * with a "+N more" footer. Loading shows skeleton rows; an errored record list
 * shows an inline retry note while module navigation keeps working.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  items,
  onClose,
  returnFocusTo,
  loading = false,
  error = false,
  onRetry,
}) => {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Debounce the query before filtering so typing across a large record index
  // stays smooth (ui-ux-pro-max debounce-throttle).
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Build the capped, grouped result set in stable group order. "Records" rows
  // only show while the user is searching; "Navigate"/"Actions" always show.
  // Filtering, exact-code-first ranking, and the per-group cap are NOT
  // re-implemented here — they delegate to the single shared `filterAndCap`
  // (one ranking implementation, one cap constant: RECORD_GROUP_CAP).
  const groups = useMemo<RenderGroup[]>(() => {
    const q = debounced.trim().toLowerCase();
    // Preserve first-seen group order while bucketing rows by group.
    const order: string[] = [];
    const byGroup = new Map<string, PaletteItem[]>();
    for (const item of items) {
      // Records are search-only — hide them on an empty query so the default
      // palette is the (always-present) module Navigate group, never blank.
      if (item.group === 'Records' && !q) continue;
      if (!byGroup.has(item.group)) {
        byGroup.set(item.group, []);
        order.push(item.group);
      }
      byGroup.get(item.group)!.push(item);
    }
    return order.map((name) => {
      // Records rank exact codes first; on an empty query the group items pass
      // through unfiltered (q === '' matches everything in filterAndCap).
      const { items: capped, overflow } = filterAndCap(byGroup.get(name)!, q, {
        exactCodeFirst: name === 'Records',
      });
      return { name, items: capped, overflow };
    });
  }, [items, debounced]);

  // Flat list of the rendered (capped) options — the roving-selection order.
  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const resultCount = flatItems.length;

  // Reset + focus the input on open.
  useEffect(() => {
    if (open) {
      setQuery('');
      setDebounced('');
      setSelected(0);
      // focus after paint
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Restore focus to the trigger when closed.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) returnFocusTo?.focus();
    wasOpen.current = open;
  }, [open, returnFocusTo]);

  // Keep the selection in range as the filter narrows.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, resultCount - 1)));
  }, [resultCount]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, resultCount - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatItems[selected];
      if (item) {
        item.run();
        onClose();
      }
    } else if (e.key === 'Tab') {
      // Trap focus inside the panel (single focusable: the input).
      e.preventDefault();
      inputRef.current?.focus();
    }
  };

  let flatIndex = -1;
  const hasResults = resultCount > 0;

  return (
    <div
      className="fixed inset-0 z-[950] flex items-start justify-center pt-[12vh]"
      onKeyDown={onKeyDown}
    >
      <div
        data-testid="cmdk-backdrop"
        className="absolute inset-0 bg-[hsl(var(--scrim)/0.4)] backdrop-blur-[3px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="cmdk-anim relative w-full max-w-[600px] overflow-hidden rounded-[12px] border border-border bg-popover shadow-[0_24px_60px_hsl(240_10%_4%/0.35)]"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 [&_svg]:size-[18px] [&_svg]:text-muted-foreground">
          <Icon name="search" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-label="Search projects, records, or run a command"
            placeholder="Search projects, PRs, customers, or run a command…"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 border-none bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          <span className="rounded-[5px] border border-border bg-secondary px-[7px] py-0.5 text-[11px] font-semibold text-muted-foreground">
            Esc
          </span>
        </div>

        {/* Polite live region: announces the result count as the filter narrows. */}
        <span data-testid="cmdk-live-count" aria-live="polite" className="sr-only">
          {hasResults ? `${resultCount} result${resultCount === 1 ? '' : 's'}` : ''}
        </span>

        <div
          id="cmdk-list"
          role="listbox"
          aria-label="Command results"
          className="max-h-[380px] overflow-y-auto p-1.5"
        >
          {/* A record list failed — keep module nav working, offer a retry. */}
          {error && (
            <div className="mx-1 mt-1 flex items-center justify-between gap-2 rounded-[7px] border border-border bg-destructive/10 px-2.5 py-2 text-[12.5px] text-destructive">
              <span>Couldn’t load records.</span>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-[5px] border border-border bg-background px-2 py-0.5 text-[12px] font-semibold text-foreground hover:bg-accent"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {/* Records still fetching — skeleton rows matching the 44px row geometry. */}
          {loading && (
            <div aria-hidden>
              <div className="px-2.5 pb-[5px] pt-2.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                Records
              </div>
              {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                <div
                  key={i}
                  data-testid="cmdk-skeleton-row"
                  className="cmdk-row flex items-center gap-[11px] rounded-[7px] px-2.5 py-[9px]"
                >
                  <span className="cmdk-skeleton size-7 shrink-0 rounded-[7px] bg-secondary" />
                  <span className="cmdk-skeleton h-3.5 flex-1 rounded-[4px] bg-secondary" />
                </div>
              ))}
            </div>
          )}

          {!hasResults && !loading ? (
            <div className="px-2.5 py-8 text-center text-[13px] text-muted-foreground">
              No results for “{query}”
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.name}>
                <div className="px-2.5 pb-[5px] pt-2.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  {group.name}
                </div>
                {group.items.map((item) => {
                  flatIndex += 1;
                  const isSel = flatIndex === selected;
                  return (
                    <div
                      key={item.id}
                      role="option"
                      aria-selected={isSel}
                      onClick={() => {
                        item.run();
                        onClose();
                      }}
                      className={cn(
                        'cmdk-row flex cursor-pointer items-center gap-[11px] rounded-[7px] px-2.5 py-[9px] text-sm',
                        isSel ? 'bg-primary/10 text-foreground' : 'hover:bg-accent'
                      )}
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-secondary text-muted-foreground [&_svg]:size-[15px]">
                        <Icon name={item.icon} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-px">
                        <span className="truncate font-medium leading-tight">{item.title}</span>
                        {item.sub && (
                          <span className="text-[11.5px] leading-tight text-muted-foreground">
                            {item.sub}
                          </span>
                        )}
                      </span>
                      {item.code && (
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                          {item.code}
                        </span>
                      )}
                    </div>
                  );
                })}
                {group.overflow > 0 && (
                  <div className="px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
                    +{group.overflow} more — refine your search
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
