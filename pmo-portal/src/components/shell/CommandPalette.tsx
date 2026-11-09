import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Command, defaultFilter, useCommandState } from 'cmdk';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { cn } from '@/src/components/ui/cn';
import { acquireBackgroundInert } from '@/src/components/ui/backgroundInert';
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

interface CommandPaletteProps {
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
/** Debounce (ms) applied to the query before the record/reference search reacts. */
const FILTER_DEBOUNCE_MS = 120;

/** Record rows are pre-filtered + ranked by the app's own search — cmdk must not re-rank them. */
const RECORD_VALUE_PREFIX = 'record:';
/** The Ask AI fallback row is offered verbatim, never filtered. */
const ASK_AI_VALUE_PREFIX = 'ask-ai:';

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

/**
 * ⌘K command palette, built on cmdk (`Command`) inside the Base UI dialog engine.
 * Base UI owns the modal behaviour (focus trap, Escape/scrim dismissal, initial/final
 * focus); cmdk owns the combobox semantics (roving-aria selection, ArrowUp/Down/Home/End,
 * Enter-to-run) and the fuzzy ranking of the static Navigate/Views commands. Record rows
 * (cached lists + the server reference query) carry a `record:` value and bypass cmdk's
 * filter — they are pre-filtered, exact-code-first ranked, and capped by the shared
 * `filterAndCap`. Loading shows skeleton rows; an errored record list shows an inline
 * retry note while module navigation keeps working.
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
  // cmdk-controlled roving selection (controlled API): the Ask AI fallback row takes the
  // selection when it is the only result, since cmdk does not auto-select a score-0 row.
  const [selectedValue, setSelectedValue] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const referenceSearch = useReferenceRecordSearch(debounced, { enabled: open });
  const currentQuery = query.trim().toLowerCase();
  const debouncedQuery = debounced.trim().toLowerCase();
  // The debounced query gates the record/reference work; static commands filter live.
  const searchSettled = currentQuery === debouncedQuery;
  const referenceHits = debouncedQuery.length >= 2 && searchSettled ? referenceSearch.data?.items : undefined;

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
  const referenceError = searchSettled && debouncedQuery.length >= 2 && referenceSearch.isError;
  const showError = error || referenceError;
  const showLoading = loading || (searchSettled && debouncedQuery.length >= 2 && referenceSearch.isFetching);

  // Debounce the query before the record/reference search reacts so typing across a large
  // record index stays smooth (ui-ux-pro-max debounce-throttle). Static commands filter live.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // AC-A11Y-MODAL-001 / CMP-009: background inert while open (DESIGN.md modal rule).
  useEffect(() => {
    if (!open) return;
    return acquireBackgroundInert();
  }, [open]);

  // A reopened palette starts from an empty query. The cmdk store remounts with the
  // dialog, so only this debounce pipeline needs resetting.
  useEffect(() => {
    if (open) {
      setQuery('');
      setDebounced('');
      setSelectedValue(undefined);
    }
  }, [open]);

  // Navigate/View labels stay searchable by their localized route label (UXS-006).
  const searchableItems = useMemo(() => [...items, ...referenceItems].map((item) => {
    if (item.group !== 'Navigate') return item;
    const route = MODULES.find((module) => `nav-${module.module}` === item.id);
    if (!route || route.label === item.title) return item;
    return { ...item, searchCodes: [...new Set([...(item.searchCodes ?? []), route.label])] };
  }), [items, referenceItems]);

  // Records rank exact codes first (AC-CMDK-002) and cap at RECORD_GROUP_CAP with an
  // overflow count (AC-CMDK-006) — delegated to the shared `filterAndCap`, the ONE
  // ranking implementation. Records show only while the user is searching.
  const recordResults = useMemo(() => {
    if (!debouncedQuery) return { items: [] as PaletteItem[], overflow: 0 };
    const recordPool = [...items.filter((item) => item.group === 'Records'), ...referenceItems];
    return filterAndCap(recordPool, debouncedQuery, { exactCodeFirst: true });
  }, [items, referenceItems, debouncedQuery]);

  // Static commands (Navigate/Views/Actions) render unfiltered; cmdk fuzzy-ranks and
  // hides the non-matches. Groups keep first-seen order for the unfiltered default view.
  const staticGroups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, PaletteItem[]>();
    for (const item of searchableItems) {
      if (item.group === 'Records') continue;
      if (!byGroup.has(item.group)) {
        byGroup.set(item.group, []);
        order.push(item.group);
      }
      byGroup.get(item.group)!.push(item);
    }
    return order.map((name) => ({ name, items: byGroup.get(name)! }));
  }, [searchableItems]);

  // Selection dispatch: cmdk hands back the item's `value`; resolve it to its run().
  const itemByValue = useMemo(() => {
    const map = new Map<string, PaletteItem>();
    for (const item of searchableItems) map.set(item.id, item);
    for (const item of recordResults.items) map.set(`${RECORD_VALUE_PREFIX}${item.id}`, item);
    return map;
  }, [searchableItems, recordResults]);

  const handleSelect = (value: string) => {
    if (value.startsWith(ASK_AI_VALUE_PREFIX)) {
      onAskAi?.(value.slice(ASK_AI_VALUE_PREFIX.length));
      onClose();
      return;
    }
    const item = itemByValue.get(value);
    if (item) {
      item.run();
      onClose();
    }
  };

  // Static commands are scored by cmdk's fuzzy matcher; record rows are already
  // filtered/ranked above (filterAndCap) so cmdk passes them through and counts them;
  // the Ask AI and note rows are offered verbatim (forceMount) and are never results.
  const commandFilter = useMemo(() => (value: string, search: string, keywords?: string[]) => {
    if (value.startsWith(RECORD_VALUE_PREFIX)) return 1;
    if (value.startsWith(ASK_AI_VALUE_PREFIX) || value.startsWith('note:')) return 0;
    return defaultFilter(value, search, keywords);
  }, []);

  const groupLabel = (name: string) => {
    if (name === 'Navigate') return t('shell.palette.navigateGroup', 'Navigate');
    if (name === 'Actions') return t('shell.palette.actionsGroup', 'Actions');
    if (name === 'Records') return t('shell.palette.recordsGroup', 'Records');
    return name;
  };

  const groupHeading = (label: string) => (
    <span className="block px-2.5 pb-[5px] pt-2.5 text-[10.5px] font-bold text-muted-foreground">{label}</span>
  );

  const rowClassName = cn(
    'cmdk-row flex cursor-pointer items-center gap-3 rounded-[7px] px-3 py-2 text-sm',
    'hover:bg-accent',
    'data-[selected=true]:bg-primary/10 data-[selected=true]:text-foreground',
  );

  const renderRow = (item: PaletteItem, value: string, keywords?: string[]) => (
    <Command.Item
      key={item.id}
      value={value}
      keywords={keywords}
      onSelect={handleSelect}
      className={rowClassName}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-secondary text-muted-foreground [&_svg]:size-[15px]">
        <Icon name={item.icon} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate font-medium leading-tight">{item.title}</span>
        {item.sub && (
          <span title={item.sub} className="truncate text-[11.5px] leading-tight text-muted-foreground">
            {item.sub}
          </span>
        )}
      </span>
      {item.code && (
        <span title={item.code} className="min-w-0 max-w-[45%] break-words text-right font-mono text-[11px] text-muted-foreground">
          {renderCodeLabel(item.code, item.codeTokens)}
        </span>
      )}
    </Command.Item>
  );

  const askAiQuery = debouncedQuery;
  const showAskAi = !!onAskAi && !showLoading && searchSettled && askAiQuery.length > 0;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <div className="fixed inset-0 z-[950] flex items-start justify-center pt-[12vh]">
          <Dialog.Backdrop
            data-testid="cmdk-backdrop"
            aria-hidden
            className="confirm-scrim-anim absolute inset-0"
            style={{ backgroundColor: 'hsl(var(--scrim) / var(--scrim-alpha))' }}
          />
          <Dialog.Popup
            initialFocus={inputRef}
            finalFocus={returnFocusTo ? () => returnFocusTo : undefined}
            role="dialog"
            aria-modal="true"
            aria-label={t('shell.palette.dialogLabel', 'Command palette')}
            className="cmdk-anim relative w-full max-w-[600px] overflow-hidden rounded-overlay border border-border bg-popover shadow-[var(--shadow-lg)] motion-reduce:animate-none"
          >
            <Command
              filter={commandFilter}
              vimBindings={false}
              value={selectedValue}
              onValueChange={setSelectedValue}
            >
              {/* Polite live region: announces the result count as the filter narrows. */}
              <LiveResultCount askAiOffered={showAskAi} />
              <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 [&_svg]:size-[18px] [&_svg]:text-muted-foreground">
                <Icon name="search" />
                <Command.Input
                  ref={inputRef}
                  aria-label={t('shell.palette.inputLabel', 'Search projects, records, or run a command')}
                  placeholder={t(
                    'shell.palette.inputPlaceholder',
                    'Search projects, PRs, customers, or run a command…',
                  )}
                  onValueChange={setQuery}
                  className="flex-1 border-none bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
                />
                <span className="rounded-[5px] border border-border bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  Esc
                </span>
              </div>
              <Command.List
                label={t('shell.palette.resultsLabel', 'Command results')}
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
                    <span className="block px-2.5 pb-[5px] pt-2.5 text-[10.5px] font-bold text-muted-foreground">
                      {t('shell.palette.recordsGroup', 'Records')}
                    </span>
                    {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                      <div
                        key={i}
                        data-testid="cmdk-skeleton-row"
                        className="cmdk-row flex items-center gap-3 rounded-[7px] px-3 py-2"
                      >
                        <span className="cmdk-skeleton size-7 shrink-0 rounded-[7px] bg-secondary" />
                        <span className="cmdk-skeleton h-3.5 flex-1 rounded-[4px] bg-secondary" />
                      </div>
                    ))}
                  </div>
                )}

                <Command.Empty>
                  {!showAskAi && !showLoading && searchSettled && (
                    <div className="px-2.5 py-8 text-center text-[13px] text-muted-foreground">
                      {t('shell.palette.noResults', 'No results for “{{query}}”', { query })}
                    </div>
                  )}
                </Command.Empty>

                {staticGroups.map((group) => (
                  <Command.Group
                    key={group.name}
                    value={group.name}
                    heading={groupHeading(groupLabel(group.name))}
                  >
                    {group.items.map((item) => renderRow(item, item.id, [...new Set([item.title, ...(item.searchCodes ?? [])].filter(Boolean))]))}
                  </Command.Group>
                ))}

                {recordResults.items.length > 0 && (
                  <Command.Group
                    value="Records"
                    heading={groupHeading(groupLabel('Records'))}
                  >
                    {recordResults.items.map((item) => renderRow(item, `${RECORD_VALUE_PREFIX}${item.id}`))}
                    {recordResults.overflow > 0 && (
                      <Command.Item
                        forceMount
                        disabled
                        value="note:records-overflow"
                        className="px-2.5 py-1.5 text-[11.5px] text-muted-foreground"
                      >
                        {t('shell.palette.moreResults', '+{{count}} more: refine your search', { count: recordResults.overflow })}
                      </Command.Item>
                    )}
                    {searchSettled && debouncedQuery.length >= 2 && referenceSearch.data?.hasMore && (
                      <Command.Item
                        forceMount
                        disabled
                        value="note:records-hasmore"
                        className="px-2.5 py-1.5 text-[11.5px] text-muted-foreground"
                      >
                        {t('shell.palette.uxs40.moreReferenceMatches', 'More reference matches; refine your search')}
                      </Command.Item>
                    )}
                  </Command.Group>
                )}

                {/* Zero-result Ask AI fallback (when the agent assistant is enabled). It must sit
                    at the LIST level (not inside a group or Empty): cmdk's result sorting can
                    only move items that are a group member or a direct list child. It scores 0
                    and mounts only when the visible result count is zero. */}
                <AskAiRow
                  offered={showAskAi}
                  query={askAiQuery}
                  onSelect={handleSelect}
                  rowClassName={rowClassName}
                  subLabel={t('shell.palette.askAiSub', 'Open the assistant with this draft')}
                  takeSelection={setSelectedValue}
                />
              </Command.List>
            </Command>
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

/**
 * Zero-result Ask AI fallback row (when the agent assistant is enabled). Scores 0 in
 * cmdk's filter, so it never counts as a result and never displaces a matched command;
 * it mounts only while the visible result count is zero.
 */

const AskAiRow: React.FC<{
  offered: boolean;
  query: string;
  onSelect: (value: string) => void;
  rowClassName: string;
  subLabel: string;
  takeSelection: (value: string | undefined) => void;
}> = ({ offered, query, onSelect, rowClassName, subLabel, takeSelection }) => {
  const count = useCommandState((state) => state.filtered.count);
  const selected = useCommandState((state) => state.value);
  const askAiValue = `${ASK_AI_VALUE_PREFIX}${query}`;
  useEffect(() => {
    // cmdk does not auto-select a late-mounted score-0 row; take the selection when
    // this row is the only result so Enter (and the screen reader) reach it.
    if (offered && count === 0 && selected !== askAiValue) takeSelection(askAiValue);
  }, [askAiValue, count, offered, selected, takeSelection]);
  if (!offered || count > 0) return null;
  return (
    <Command.Item forceMount value={`${ASK_AI_VALUE_PREFIX}${query}`} onSelect={onSelect} className={rowClassName}>
      <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-secondary text-muted-foreground [&_svg]:size-[15px]">
        <Icon name="search" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate font-medium leading-tight">Ask AI: &quot;{query}&quot;</span>
        <span className="text-[11.5px] leading-tight text-muted-foreground">{subLabel}</span>
      </span>
    </Command.Item>
  );
};

/**
 * Polite live region announcing the visible result count as the filter narrows.
 * Must render inside the `Command` root to read its store. The Ask AI fallback row
 * only exists while there are zero results, so it counts exactly then.
 */
const LiveResultCount: React.FC<{ askAiOffered: boolean }> = ({ askAiOffered }) => {
  const count = useCommandState((state) => state.filtered.count);
  const total = count + (count === 0 && askAiOffered ? 1 : 0);
  return (
    <span data-testid="cmdk-live-count" aria-live="polite" className="sr-only">
      {total > 0 ? `${total} result${total === 1 ? '' : 's'}` : ''}
    </span>
  );
};
