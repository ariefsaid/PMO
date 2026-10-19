import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { cn } from '@/src/components/ui/cn';
import { Icon, type IconName } from '@/src/components/ui/icons';
import { filterAndCap } from '@/src/hooks/useRecordSearch';
import { useReferenceRecordSearch } from '@/src/hooks/useReferenceRecordSearch';
import type { ReferenceHit } from '@/src/lib/db/recordReferenceSearch';
import { MODULES } from './routeMatch';

export interface PaletteItem {
  id: string;
  group: string;
  title: string;
  sub?: string;
  /** Compact visible summary of the record's identity fields. */
  code?: string;
  /** Canonical identifiers in `code`, rendered as unbreakable tokens. */
  codeTokens?: string[];
  /** Individually searchable identifiers used for exact-match ranking. */
  searchCodes?: string[];
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
  /** Optional agent fallback for zero-result queries; App gates this behind agentAssistant. */
  onAskAi?: (query: string) => void;
}

/** Skeleton rows shown while the record lists load. */
const SKELETON_COUNT = 4;
/** Debounce (ms) applied to the query before filtering (Linear/Raycast feel). */
const FILTER_DEBOUNCE_MS = 120;

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}_]/u.test(character);
}

function renderCodeLabel(code: string, tokens: string[] | undefined): React.ReactNode {
  const candidates = [...new Set(tokens ?? [])].filter(Boolean).sort((left, right) => right.length - left.length);
  if (candidates.length === 0) return code;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  while (cursor < code.length) {
    let nextMatch: { start: number; token: string } | undefined;
    for (const candidate of candidates) {
      let searchFrom = cursor;
      while (searchFrom < code.length) {
        const start = code.indexOf(candidate, searchFrom);
        if (start < 0) break;
        const end = start + candidate.length;
        if (!isIdentifierCharacter(code[start - 1]) && !isIdentifierCharacter(code[end])) {
          if (!nextMatch || start < nextMatch.start || (start === nextMatch.start && candidate.length > nextMatch.token.length)) {
            nextMatch = { start, token: candidate };
          }
          break;
        }
        searchFrom = start + 1;
      }
    }

    if (!nextMatch) {
      parts.push(code.slice(cursor));
      break;
    }
    if (nextMatch.start > cursor) parts.push(code.slice(cursor, nextMatch.start));
    parts.push(
      <span key={`code-token-${nextMatch.start}`} className="whitespace-nowrap">
        {nextMatch.token}
      </span>,
    );
    cursor = nextMatch.start + nextMatch.token.length;
  }

  return parts.length === 1 ? parts[0] : parts;
}

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
  onAskAi,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const referenceSearch = useReferenceRecordSearch(debounced, { enabled: open });
  const currentQuery = query.trim().toLowerCase();
  const debouncedQuery = debounced.trim().toLowerCase();
  const referenceQuerySettled = debouncedQuery.length >= 2 && currentQuery === debouncedQuery;
  const referenceHits = referenceQuerySettled ? referenceSearch.data?.items : undefined;

  const referenceItems = useMemo<PaletteItem[]>(() => {
    if (!referenceHits?.length) return [];

    const existingRecordIds = new Set(items.filter((item) => item.group === 'Records').map((item) => item.id));
    const addedIds = new Set<string>();

    return referenceHits.flatMap((hit: ReferenceHit) => {
      const idPrefix = hit.kind === 'project' ? 'projects' : hit.kind === 'invoice' ? 'invoices' : 'receipts';
      const id = `${idPrefix}:${hit.id}`;
      if (
        existingRecordIds.has(id) ||
        addedIds.has(id) ||
        (hit.kind === 'project' && existingRecordIds.has(`sales:${hit.id}`))
      ) return [];
      addedIds.add(id);

      const aliases = [...new Set([hit.reference, ...hit.aliases].filter(Boolean))];
      const exactAlias = hit.exact
        ? aliases.find((alias) => alias.trim().toLowerCase() === debouncedQuery)
        : undefined;
      const displayAliases = exactAlias
        ? [exactAlias, ...aliases.filter((alias) => alias !== exactAlias)]
        : aliases;
      const recordType = hit.kind === 'project'
        ? t('shell.palette.recordProject', 'Project')
        : hit.kind === 'invoice'
          ? t('shell.palette.uxs40.salesInvoice', 'Sales invoice')
          : t('shell.palette.uxs40.incomingPayment', 'Incoming payment');
      const sub = hit.context
        ? t('shell.palette.uxs40.recordContext', '{{type}} · {{context}}', {
          type: recordType,
          context: hit.context,
        })
        : recordType;
      const path = hit.kind === 'project'
        ? `/projects/${encodeURIComponent(hit.id)}`
        : hit.kind === 'invoice'
          ? `/sales-invoices/${encodeURIComponent(hit.id)}`
          : `/incoming-payments/${encodeURIComponent(hit.id)}`;
      const icon: IconName = hit.kind === 'project' ? 'projects' : hit.kind === 'invoice' ? 'invoices' : 'payments';

      return [{
        id,
        group: 'Records',
        title: hit.title,
        sub,
        code: t('shell.palette.uxs40.referenceLabel', 'Reference: {{reference}}', {
          reference: displayAliases.join(' · '),
        }),
        codeTokens: displayAliases,
        searchCodes: aliases,
        icon,
        run: () => navigate(path),
      }];
    });
  }, [debouncedQuery, items, navigate, referenceHits, t]);
  const referenceError = referenceQuerySettled && referenceSearch.isError;
  const showError = error || referenceError;
  const showLoading = loading || (referenceQuerySettled && referenceSearch.isFetching);

  // Debounce the query before filtering so typing across a large record index
  // stays smooth (ui-ux-pro-max debounce-throttle).
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const searchableItems = useMemo(() => [...items, ...referenceItems].map((item) => {
    if (item.group !== 'Navigate') return item;
    const route = MODULES.find((module) => `nav-${module.module}` === item.id);
    if (!route || route.label === item.title) return item;
    return { ...item, searchCodes: [...new Set([...(item.searchCodes ?? []), route.label])] };
  }), [items, referenceItems]);

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
    for (const item of searchableItems) {
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
  }, [searchableItems, debounced]);

  // Flat list of the rendered (capped) options — the roving-selection order.
  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const askAiQuery = debounced.trim();
  const showAskAi = !!onAskAi && !showLoading && flatItems.length === 0 && askAiQuery.length > 0;
  const resultCount = flatItems.length + (showAskAi ? 1 : 0);

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
      } else if (showAskAi) {
        onAskAi?.(askAiQuery);
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
  const groupLabel = (name: string) => {
    if (name === 'Navigate') return t('shell.palette.navigateGroup', 'Navigate');
    if (name === 'Actions') return t('shell.palette.actionsGroup', 'Actions');
    if (name === 'Records') return t('shell.palette.recordsGroup', 'Records');
    return name;
  };

  return (
    <div
      className="fixed inset-0 z-[950] flex items-start justify-center pt-[12vh]"
      onKeyDown={onKeyDown}
    >
      <div
        data-testid="cmdk-backdrop"
        className="absolute inset-0 bg-foreground/40 backdrop-blur-[3px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('shell.palette.dialogLabel', 'Command palette')}
        className="cmdk-anim relative w-full max-w-[600px] overflow-hidden rounded-[12px] border border-border bg-popover shadow-[0_24px_60px_hsl(var(--scrim)/0.35)]"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 [&_svg]:size-[18px] [&_svg]:text-muted-foreground">
          <Icon name="search" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-label={t('shell.palette.inputLabel', 'Search projects, records, or run a command')}
            placeholder={t(
              'shell.palette.inputPlaceholder',
              'Search projects, PRs, customers, or run a command…',
            )}
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
          aria-label={t('shell.palette.resultsLabel', 'Command results')}
          className="max-h-[380px] overflow-y-auto p-1.5"
        >
          {/* A record list failed — keep module nav working, offer a retry. */}
          {showError && (
            <div className="mx-1 mt-1 flex items-center justify-between gap-2 rounded-[7px] border border-border bg-destructive/10 px-2.5 py-2 text-[12.5px] text-destructive-text">
              <span>{t('shell.palette.recordsError', "Couldn't load records.")}</span>
              {(onRetry || referenceError) && (
                <button
                  type="button"
                  onClick={() => {
                    onRetry?.();
                    if (referenceError) void referenceSearch.refetch();
                  }}
                  className="rounded-[5px] border border-border bg-background px-2 py-0.5 text-[12px] font-semibold text-foreground hover:bg-accent"
                >
                  {t('shell.palette.retry', 'Retry')}
                </button>
              )}
            </div>
          )}

          {/* Records still fetching — skeleton rows matching the 44px row geometry. */}
          {showLoading && (
            <div aria-hidden>
              <div className="px-2.5 pb-[5px] pt-2.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                {t('shell.palette.recordsGroup', 'Records')}
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

          {!hasResults && !showLoading ? (
            <div className="px-2.5 py-8 text-center text-[13px] text-muted-foreground">
              {t('shell.palette.noResults', 'No results for “{{query}}”', { query })}
            </div>
          ) : (
            <>
              {groups.map((group) => (
                <div key={group.name}>
                  <div className="px-2.5 pb-[5px] pt-2.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                    {groupLabel(group.name)}
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
                          <span title={item.code} className="min-w-0 max-w-[45%] break-words text-right font-mono text-[11px] text-muted-foreground">
                            {renderCodeLabel(item.code, item.codeTokens)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {group.overflow > 0 && (
                    <div className="px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
                      {t('shell.palette.moreResults', '+{{count}} more — refine your search', { count: group.overflow })}
                    </div>
                  )}
                  {group.name === 'Records' && referenceQuerySettled && referenceSearch.data?.hasMore && (
                    <div className="px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
                      {t('shell.palette.uxs40.moreReferenceMatches', 'More reference matches; refine your search')}
                    </div>
                  )}
                </div>
              ))}
              {showAskAi && (() => {
                flatIndex += 1;
                const isSel = flatIndex === selected;
                return (
                  <div
                    role="option"
                    aria-selected={isSel}
                    onClick={() => {
                      onAskAi(askAiQuery);
                      onClose();
                    }}
                    className={cn(
                      'cmdk-row flex cursor-pointer items-center gap-[11px] rounded-[7px] px-2.5 py-[9px] text-sm',
                      isSel ? 'bg-primary/10 text-foreground' : 'hover:bg-accent'
                    )}
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-secondary text-muted-foreground [&_svg]:size-[15px]">
                      <Icon name="search" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate font-medium leading-tight">
                        Ask AI: &quot;{askAiQuery}&quot;
                      </span>
                      <span className="text-[11.5px] leading-tight text-muted-foreground">
                        {t('shell.palette.askAiSub', 'Open the assistant with this draft')}
                      </span>
                    </span>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
