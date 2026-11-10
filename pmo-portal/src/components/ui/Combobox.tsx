import { Avatar } from '@/src/components/ui/Avatar';
import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { Icon } from './icons';
import { FieldError } from './FormFields';

// ---------------------------------------------------------------------------
// Combobox — the async FK picker (crud-components §4). A searchable
// single-select for long, data-driven reference lists (client company, vendor,
// PM, project, assignee). Behaviour (open/close, positioning + flip, focus,
// type-ahead highlight, Arrow/Enter/Escape, aria-activedescendant, focus return)
// comes from Base UI's Combobox with the search input inside the popup; this
// file owns only the PMO facade: the trigger shell, the lazy/server option
// sources, and the load / empty / error states.
//
// Token-pure: trigger = the `input` shell, popover = `popover` bg + 1px
// `border` + `rounded-md` + the verbatim *Overlay* shadow; option highlight =
// `accent`, selected = `primary/7%`.
// ---------------------------------------------------------------------------

export interface ComboboxOption {
  value: string;
  label: string;
  /** Optional secondary line (e.g. "Client" / "Vendor"). */
  sub?: string;
  /** Render a full, wrapping label with `sub` on its own line for server results that need distinguishing details. */
  wrapLabel?: boolean;
  /** Optional non-truncating labels shown as separate badges in the option row. */
  badges?: string[];
  /** Optional 2-letter avatar for the chip/row. */
  initials?: string;
}

/** Server-search mode: the caller owns the options (searched and paged on the server); Combobox keeps the keyboard, focus and ARIA model and skips its own load and filter. */
export interface ComboboxServerSearch {
  options: ComboboxOption[];
  status: 'loading' | 'ready' | 'error';
  /** Called with the typed text on every change (and '' on close); debounce in the caller. */
  onQueryChange: (query: string) => void;
  onOpenChange?: (open: boolean) => void;
  onRetry: () => void;
  hasMore?: boolean;
  /** Next page; also fired by ArrowDown on the last option. */
  onLoadMore?: () => void;
  /** Label of the Show more button (translated by the caller's namespace). */
  moreLabel?: string;
}

export interface ComboboxProps {
  label: React.ReactNode;
  /** Selected option value, or null. */
  value: string | null;
  /** Pass the currently-selected option so the chip renders without a load. */
  selectedOption?: ComboboxOption | null;
  onChange: (value: string, option: ComboboxOption) => void;
  /** Async option loader (the DAL FK source). Re-invoked on retry. */
  loadOptions?: () => Promise<ComboboxOption[]>;
  serverSearch?: ComboboxServerSearch;
  placeholder?: string;
  required?: boolean;
  error?: React.ReactNode;
  /** Search input placeholder. */
  searchPlaceholder?: string;
  /** Noun for the empty/error copy, e.g. "company". */
  noun?: string;
  /** Show a clear (x) affordance on a selected value; `onClear` resets to null. */
  clearable?: boolean;
  onClear?: () => void;
  disabled?: boolean;
  /** Keep the clear (x) affordance usable while `disabled`, so a saved value stays removable
   *  when only BROWSING is locked (e.g. the ERPNext org settings: no active binding, choice
   *  remains clearable — AC-S11-002/AC-S11-004). Default false: a disabled picker is fully inert
   *  (no open, no select, no clear). */
  clearWhileDisabled?: boolean;
  /** Stable DOM id for form error-summary focus links. */
  id?: string;
  className?: string;
  /** Size/fill the trigger like the shared form controls (SelectField/TextField). */
  formControl?: boolean;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

// #2044 perf acceptance: "1,000 options → ≤~100 in the DOM". A long FK list must not
// mount a row per record — but the cap may never truncate the SEARCH, so the page is
// capped by the library, not by slicing the source: Base UI's `limit` scans the FULL
// filtered set and stops once it has this many matches, so option #1000 is still
// reachable by typing. Server-search mode owns its own page size, so it is not capped.
const MAX_RENDERED_OPTIONS = 100;

export const Combobox: React.FC<ComboboxProps> = ({
  label,
  value,
  selectedOption,
  onChange,
  loadOptions,
  serverSearch,
  placeholder = 'Select…',
  required,
  error,
  searchPlaceholder,
  noun = 'option',
  clearable,
  onClear,
  disabled,
  clearWhileDisabled,
  id,
  className,
  formControl,
}) => {
  const { t } = useTranslation();
  const baseId = useId();
  const labelId = `${baseId}-lbl`;
  const errId = `${baseId}-err`;

  const [open, setOpen] = useState(false);
  // #2122: a keyboard-activated open appears instantly (no 120ms menuPopIn). Base UI's Menu derives
  // this itself; its Combobox does not, so read it off the open event: a keyboard / AT activation
  // arrives as a click with `detail === 0` (or a keyboard event), a pointer click has `detail >= 1`.
  const [instant, setInstant] = useState(false);
  const [query, setQuery] = useState('');
  const [localState, setState] = useState<LoadState>('idle');
  const [localOptions, setOptions] = useState<ComboboxOption[]>([]);
  const ss = serverSearch;
  const ssRef = useRef(ss);
  ssRef.current = ss;
  const state: LoadState = ss ? ss.status : localState;
  const options = ss ? ss.options : localOptions;
  const highlightedRef = useRef<ComboboxOption | undefined>(undefined);

  const triggerRef = useRef<HTMLButtonElement>(null);
  // Monotonic load token: a resolution is only honored if it is still the
  // latest in-flight load (drops a stale resolve after close / a re-load).
  const loadIdRef = useRef(0);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useLayoutEffect(() => {
    if (disabled) {
      loadIdRef.current++;
      setOpen(false);
      setQuery('');
    }
  }, [disabled]);

  const selected = useMemo(
    () => selectedOption ?? options.find((o) => o.value === value) ?? null,
    [selectedOption, options, value],
  );

  // Underscore/space are the SAME word break to a searcher (an IANA zone's city segment is
  // underscore-joined, "America/New_York", but nobody types the underscore) — normalize both
  // sides so "new york" matches it (#684).
  const normalizeForSearch = (s: string) => s.toLowerCase().replace(/_/g, ' ');

  const filter = useCallback((o: ComboboxOption, query: string) => {
    const q = normalizeForSearch(query.trim());
    if (!q) return true;
    return normalizeForSearch(o.label).includes(q) || !!(o.sub && normalizeForSearch(o.sub).includes(q));
  }, []);

  // How many options match the query in TOTAL (not just the rendered page), so the
  // capped list can say "N more". Same predicate the library filters with, so the
  // note can never disagree with what typing actually narrows to.
  const matchCount = useMemo(() => {
    if (ss) return options.length;
    const q = query.trim();
    if (!q) return options.length;
    return options.reduce((n, o) => n + (filter(o, q) ? 1 : 0), 0);
  }, [ss, options, query, filter]);
  const hiddenCount = ss ? 0 : Math.max(0, matchCount - MAX_RENDERED_OPTIONS);

  const load = useCallback(() => {
    if (!loadOptions) return;
    const id = ++loadIdRef.current;
    setState('loading');
    loadOptions()
      .then((opts) => {
        // Drop a stale resolution: a newer load started or the picker closed.
        if (id !== loadIdRef.current || disabledRef.current) return;
        setOptions(opts);
        setState('ready');
      })
      .catch(() => {
        if (id !== loadIdRef.current || disabledRef.current) return;
        setState('error');
      });
  }, [loadOptions]);

  // Load once per open (lazy — never fetches until the picker is opened).
  useEffect(() => {
    if (open && localState === 'idle') load();
  }, [open, localState, load]);

  // Re-load when the option SOURCE changes while the picker is open (the async FK
  // source — e.g. useClientCompanies — may resolve to [] on the very first open
  // then populate; without this the picker would cache the empty result and never
  // show options). `load` identity changes iff `loadOptions` does, so this fires
  // exactly when the underlying data source changed, not on unrelated re-renders.
  const loadRef = useRef(load);
  useEffect(() => {
    if (open && localState !== 'idle' && loadRef.current !== load) load();
    loadRef.current = load;
  }, [open, localState, load]);

  useEffect(() => { ssRef.current?.onOpenChange?.(open); }, [open]);
  useEffect(() => { ssRef.current?.onQueryChange(query); }, [query]);

  // On close, invalidate any in-flight load so its late resolution is ignored,
  // and reset a still-loading state to idle so the next open re-fetches cleanly
  // (a 'ready'/'error' result is kept as a cache for an instant reopen).
  useEffect(() => {
    if (!open) {
      loadIdRef.current++;
      setState((s) => (s === 'loading' ? 'idle' : s));
    }
  }, [open]);

  return (
    <div className={cn('flex flex-col', formControl ? 'gap-2' : 'gap-1.5', className)}>
      <span id={labelId} className={cn('font-semibold text-foreground', 'text-control')}>
        {label}
        {required && (
          <span aria-hidden className="ml-0.5 text-destructive">
            *
          </span>
        )}
      </span>

      <BaseCombobox.Root<ComboboxOption>
        items={options}
        filter={ss ? null : filter}
        limit={ss ? undefined : MAX_RENDERED_OPTIONS}
        value={selected}
        isItemEqualToValue={(a, b) => a.value === b.value}
        itemToStringLabel={(o) => o.label}
        open={open && !disabled}
        onOpenChange={(next, details) => {
          if (disabledRef.current) return;
          if (next) {
            const event = details.event;
            setInstant(event instanceof KeyboardEvent || (event instanceof MouseEvent && event.detail === 0));
          }
          setOpen(next);
          if (!next) setQuery('');
        }}
        inputValue={query}
        onInputValueChange={(next, details) => {
          // Base UI echoes the picked label into the input; this input is a pure search box.
          if (details.reason === 'item-press') return;
          setQuery(next);
        }}
        onValueChange={(opt) => {
          if (!opt || disabledRef.current) return;
          onChange(opt.value, opt);
        }}
        onItemHighlighted={(opt) => { highlightedRef.current = opt; }}
        autoHighlight
        disabled={disabled}
      >
        <div className="relative">
          <BaseCombobox.Trigger
            ref={triggerRef}
            id={id}
            aria-labelledby={labelId}
            title={selected?.sub ? `${selected.label} — ${selected.sub}` : selected?.label}
            aria-required={required || undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errId : undefined}
            className={cn(
              'flex w-full items-center gap-2 rounded-md border text-foreground',
              formControl
                ? 'h-auto min-h-[var(--control-height)] bg-card px-3 py-1 text-control [@media(pointer:coarse)]:min-h-11'
                : 'h-auto min-h-8 bg-background px-[10px] py-1 text-control',
              'hover:border-primary/50 disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground',
              error ? 'border-destructive' : 'border-border hover:border-input',
            )}
          >
            {selected ? (
              <span className="flex min-w-0 flex-1 items-start gap-2 text-left">
                {selected.initials && <Avatar name={selected.label} initials={selected.initials} size="xs" decorative />}
                <span className="break-words">{selected.label}</span>
              </span>
            ) : (
              <span className="flex-1 break-words text-left text-muted-foreground">{placeholder}</span>
            )}
            {/* Reserves the clear button's 24px slot left of the chevron so the label wraps
                before it instead of running under it (the button is absolutely positioned). */}
            {clearable && value && <span aria-hidden="true" className="w-6 shrink-0" />}
            <Icon name="chev" className="size-[15px] shrink-0 rotate-90 text-muted-foreground" />
          </BaseCombobox.Trigger>
          {clearable && value && (
            <button
              type="button"
              disabled={disabled && !clearWhileDisabled}
              aria-label={t('combobox.clear', { defaultValue: 'Clear {{noun}}', noun })}
              onClick={(e) => {
                e.stopPropagation();
                onClear?.();
                setOpen(false);
                setQuery('');
                triggerRef.current?.focus();
              }}
              className="absolute right-[33px] top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Icon name="x" className="size-3" />
            </button>
          )}
        </div>

        <FieldError id={errId}>{error}</FieldError>

        <BaseCombobox.Portal>
          <BaseCombobox.Positioner sideOffset={5} collisionPadding={8} className="z-[820]">
            <BaseCombobox.Popup
              aria-labelledby={labelId}
              data-instant={instant || undefined}
              style={{ '--menu-origin': 'var(--transform-origin)' } as React.CSSProperties}
              className="menu-pop-anim motion-reduce:animate-none w-[var(--anchor-width)] max-w-[calc(100vw-16px)] overflow-hidden rounded-md border border-border bg-popover shadow-[0_10px_30px_hsl(240_10%_8%/0.16),0_2px_6px_hsl(240_10%_8%/0.08)]"
            >
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <Icon name="search" className="size-[15px] shrink-0 text-muted-foreground" />
                <BaseCombobox.Input
                  aria-label={t('combobox.search.label', { defaultValue: 'Search {{noun}}s', noun })}
                  placeholder={searchPlaceholder ?? t('combobox.search.placeholder', { defaultValue: 'Search {{noun}}s…', noun })}
                  onKeyDown={(e) => {
                    // Server paging: ArrowDown past the last loaded option asks for the next page.
                    if (e.key === 'ArrowDown' && ss?.hasMore && highlightedRef.current === options[options.length - 1]) {
                      ss.onLoadMore?.();
                    }
                  }}
                  className="w-full border-0 bg-transparent text-control text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>

              {state === 'loading' && (
                <div data-testid="combo-loading" className="px-2 py-1.5" aria-busy="true">
                  <div className="skel skel-line" style={{ width: '72%' }} />
                  <div className="skel skel-line" style={{ width: '58%' }} />
                  <div className="skel skel-line" style={{ width: '65%' }} />
                  <span className="sr-only">{t('combobox.loading', { defaultValue: 'Loading {{noun}}s…', noun })}</span>
                </div>
              )}

              {state === 'error' && (
                <div className="px-3 py-3.5 text-center text-control" style={{ color: 'hsl(0 72% 45%)' }}>
                  {t('combobox.error.title', { defaultValue: "Couldn't load {{noun}}s.", noun })}
                  <button
                    type="button"
                    onClick={() => (ss ? ss.onRetry() : load())}
                    className="mt-2 inline-flex items-center gap-1.5 font-semibold text-primary"
                  >
                    <Icon name="refresh" className="size-[14px]" />
                    {t('combobox.error.retry', 'Retry')}
                  </button>
                </div>
              )}

              {state === 'ready' && (
                <>
                  <BaseCombobox.Empty className="px-3 py-3.5 text-center text-control text-muted-foreground empty:hidden">
                    {query
                      ? t('combobox.empty.withQuery', { defaultValue: 'No {{noun}} matches "{{query}}".', noun, query })
                      : t('combobox.empty.bare', { defaultValue: 'No {{noun}} matches.', noun })}
                  </BaseCombobox.Empty>
                  <BaseCombobox.List
                    aria-label={t('combobox.listLabel', { defaultValue: '{{noun}}s', noun })}
                    className="max-h-[220px] overflow-y-auto p-1.5 empty:hidden"
                  >
                    {(opt: ComboboxOption) => (
                      <BaseCombobox.Item
                        key={opt.value}
                        value={opt}
                        className={cn(
                          'flex cursor-pointer gap-2 rounded-sm px-2 text-control data-[selected]:bg-primary/[0.07] data-[highlighted]:bg-accent data-[highlighted]:data-[selected]:bg-primary/[0.07]',
                          'min-h-[34px] items-start py-1.5',
                        )}
                      >
                        {opt.initials && <Avatar name={opt.label} initials={opt.initials} size="xs" decorative />}
                        {opt.wrapLabel ? (
                          <div className="min-w-0 flex-1">
                            <span className="block whitespace-normal break-words">{opt.label}</span>
                            {opt.sub && (
                              <span title={opt.sub} className="mt-1 block whitespace-normal break-words text-control text-muted-foreground">{opt.sub}</span>
                            )}
                          </div>
                        ) : opt.badges?.length ? (
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="min-w-0 flex-1 break-words">{opt.label}</span>
                              {opt.badges.map((badge) => (
                                <span
                                  key={badge}
                                  className="shrink-0 whitespace-nowrap rounded-full bg-warning/10 px-1.5 py-0.5 text-control font-medium leading-snug text-warning-foreground"
                                >
                                  {badge}
                                </span>
                              ))}
                            </div>
                            {opt.sub && (
                              <span title={opt.sub} className="mt-1 block min-w-0 break-words text-control text-muted-foreground">{opt.sub}</span>
                            )}
                          </div>
                        ) : (
                          <>
                            <span className="min-w-0 break-words">{opt.label}</span>
                            {opt.sub && (
                              <span title={opt.sub} className="ml-1.5 min-w-0 shrink-[3] break-words text-control text-muted-foreground">{opt.sub}</span>
                            )}
                          </>
                        )}
                        <BaseCombobox.ItemIndicator className="ml-auto shrink-0">
                          <Icon name="check" className="size-[15px] text-primary" />
                        </BaseCombobox.ItemIndicator>
                      </BaseCombobox.Item>
                    )}
                  </BaseCombobox.List>
                  {hiddenCount > 0 && (
                    <div className="border-t border-border px-3 py-2 text-control text-muted-foreground">
                      {t('combobox.moreHidden', {
                        defaultValue: 'Type to narrow ({{count}} more)',
                        count: hiddenCount,
                      })}
                    </div>
                  )}
                </>
              )}

              {state === 'ready' && ss?.hasMore && ss.onLoadMore && (
                <button type="button" onClick={ss.onLoadMore} className="w-full border-t border-border px-3 py-2 text-control font-semibold text-primary hover:bg-accent">
                  {ss.moreLabel ?? 'Show more'}
                </button>
              )}
            </BaseCombobox.Popup>
          </BaseCombobox.Positioner>
        </BaseCombobox.Portal>
      </BaseCombobox.Root>
    </div>
  );
};

Combobox.displayName = 'Combobox';
