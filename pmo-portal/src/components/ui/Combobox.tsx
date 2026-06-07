import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { Icon } from './icons';
import { FieldError } from './FormFields';

// ---------------------------------------------------------------------------
// Combobox — the async FK picker (crud-components §4). A searchable
// single-select for long, data-driven reference lists (client company, vendor,
// PM, project, assignee). Type-ahead filter, full keyboard nav
// (Down/Up/Enter/Esc/type-ahead), and the load states: loading / empty (+
// optional inline create) / error (+ retry).
//
// Token-pure: trigger = the `input` shell, popover = `popover` bg + 1px
// `border` + `rounded-md` + the verbatim *Overlay* shadow, portal-rendered to
// escape overflow clipping; option hover = `accent`, selected = `primary/7%`.
//
// a11y (WCAG-AA): trigger `role="combobox"` + `aria-expanded` +
// `aria-haspopup="listbox"` + `aria-controls`; list `role="listbox"`, rows
// `role="option"` + `aria-selected`; active option tracked via
// `aria-activedescendant`; `aria-required`/`aria-invalid` surfaced + a
// `role="alert"` error; the search input is `role="searchbox"`.
// ---------------------------------------------------------------------------

export interface ComboboxOption {
  value: string;
  label: string;
  /** Optional secondary line (e.g. "Client" / "Vendor"). */
  sub?: string;
  /** Optional 2-letter avatar + color for the chip/row. */
  initials?: string;
  color?: string;
}

export interface ComboboxProps {
  label: React.ReactNode;
  /** Selected option value, or null. */
  value: string | null;
  /** Pass the currently-selected option so the chip renders without a load. */
  selectedOption?: ComboboxOption | null;
  onChange: (value: string, option: ComboboxOption) => void;
  /** Async option loader (the DAL FK source). Re-invoked on retry. */
  loadOptions: () => Promise<ComboboxOption[]>;
  placeholder?: string;
  required?: boolean;
  error?: React.ReactNode;
  /** Optional inline-create from the empty state; receives the current query. */
  onCreate?: (query: string) => void;
  createLabel?: string;
  /** Search input placeholder. */
  searchPlaceholder?: string;
  /** Noun for the empty/error copy, e.g. "company". */
  noun?: string;
  disabled?: boolean;
  className?: string;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export const Combobox: React.FC<ComboboxProps> = ({
  label,
  value,
  selectedOption,
  onChange,
  loadOptions,
  placeholder = 'Select…',
  required,
  error,
  onCreate,
  createLabel = 'Create',
  searchPlaceholder,
  noun = 'option',
  disabled,
  className,
}) => {
  const baseId = useId();
  const labelId = `${baseId}-lbl`;
  const listId = `${baseId}-list`;
  const errId = `${baseId}-err`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<LoadState>('idle');
  const [options, setOptions] = useState<ComboboxOption[]>([]);
  // -1 = nothing highlighted yet; the first ArrowDown lands on index 0.
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Monotonic load token: a resolution is only honored if it is still the
  // latest in-flight load (drops a stale resolve after close / a re-load).
  const loadIdRef = useRef(0);

  const selected = useMemo(
    () => selectedOption ?? options.find((o) => o.value === value) ?? null,
    [selectedOption, options, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.sub?.toLowerCase().includes(q),
    );
  }, [options, query]);

  const load = useCallback(() => {
    const id = ++loadIdRef.current;
    setState('loading');
    loadOptions()
      .then((opts) => {
        // Drop a stale resolution: a newer load started or the picker closed.
        if (id !== loadIdRef.current) return;
        setOptions(opts);
        setState('ready');
      })
      .catch(() => {
        if (id !== loadIdRef.current) return;
        setState('error');
      });
  }, [loadOptions]);

  // Load once per open (lazy — never fetches until the picker is opened).
  useEffect(() => {
    if (open && state === 'idle') load();
  }, [open, state, load]);

  // On close, invalidate any in-flight load so its late resolution is ignored,
  // and reset a still-loading state to idle so the next open re-fetches cleanly
  // (a 'ready'/'error' result is kept as a cache for an instant reopen).
  useEffect(() => {
    if (!open) {
      loadIdRef.current++;
      setState((s) => (s === 'loading' ? 'idle' : s));
    }
  }, [open]);

  // Move focus into the search field when the popover opens.
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open, state]);

  // Reset the highlight when the visible set changes (nothing pre-highlighted).
  useEffect(() => {
    setActive(-1);
  }, [query, options]);

  // Keep the active option scrolled into view as the highlight moves with the
  // keyboard (so a long, data-driven list never highlights an off-screen row).
  // When options are showing, the list's children are exactly the option rows.
  useEffect(() => {
    if (active < 0) return;
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Position the portal popover under the trigger (escapes overflow clipping).
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 5, left: r.left, width: r.width });
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        !popRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    triggerRef.current?.focus();
  }, []);

  const select = useCallback(
    (opt: ComboboxOption) => {
      onChange(opt.value, opt);
      setOpen(false);
      setQuery('');
    },
    [onChange],
  );

  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (filtered.length) setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      if (filtered.length) setActive(filtered.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[active];
      if (opt) select(opt);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const activeId = filtered[active] ? `${baseId}-opt-${filtered[active].value}` : undefined;

  const Avatar: React.FC<{ opt: ComboboxOption; size: number }> = ({ opt, size }) =>
    opt.initials ? (
      <span
        aria-hidden
        className="grid shrink-0 place-items-center rounded-[5px] text-[9.5px] font-bold text-white"
        style={{ width: size, height: size, background: opt.color ?? 'hsl(var(--primary))' }}
      >
        {opt.initials}
      </span>
    ) : null;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <span id={labelId} className="text-[12px] font-semibold leading-[1.3] text-foreground">
        {label}
        {required && (
          <span aria-hidden className="ml-0.5 text-destructive">
            *
          </span>
        )}
      </span>

      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-labelledby={labelId}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          disabled={disabled}
          onClick={() => !disabled && setOpen((o) => !o)}
          className={cn(
            'flex h-8 w-full items-center gap-2 rounded-md border bg-background px-[10px] text-[13.5px] text-foreground',
            'hover:border-primary/50 disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground',
            error ? 'border-destructive' : 'border-input',
          )}
        >
          {selected ? (
            <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <Avatar opt={selected} size={20} />
              <span className="truncate">{selected.label}</span>
            </span>
          ) : (
            <span className="flex-1 text-left text-muted-foreground">{placeholder}</span>
          )}
          <Icon name="chev" className="size-[15px] shrink-0 rotate-90 text-muted-foreground" />
        </button>
      </div>

      <FieldError id={errId}>{error}</FieldError>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 820 }}
            className="overflow-hidden rounded-md border border-border bg-popover shadow-[0_10px_30px_hsl(240_10%_8%/0.16),0_2px_6px_hsl(240_10%_8%/0.08)]"
          >
            <div className="flex items-center gap-2 border-b border-border px-[11px] py-2.5">
              <Icon name="search" className="size-[15px] shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                role="searchbox"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
                aria-label={`Search ${noun}s`}
                aria-controls={listId}
                aria-activedescendant={activeId}
                placeholder={searchPlaceholder ?? `Search ${noun}s…`}
                className="w-full border-0 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>

            {state === 'loading' && (
              <div data-testid="combo-loading" className="px-[9px] py-1.5" aria-busy="true">
                <div className="skel skel-line" style={{ width: '72%' }} />
                <div className="skel skel-line" style={{ width: '58%' }} />
                <div className="skel skel-line" style={{ width: '65%' }} />
                <span className="sr-only">Loading {noun}s…</span>
              </div>
            )}

            {state === 'error' && (
              <div className="px-3 py-3.5 text-center text-[12.5px]" style={{ color: 'hsl(0 72% 45%)' }}>
                Couldn&apos;t load {noun}s.
                <button
                  type="button"
                  onClick={() => load()}
                  className="mt-2 inline-flex items-center gap-1.5 font-semibold text-primary"
                >
                  <Icon name="refresh" className="size-[14px]" />
                  Retry
                </button>
              </div>
            )}

            {state === 'ready' && (
              <ul ref={listRef} id={listId} role="listbox" aria-label={`${noun}s`} className="max-h-[220px] overflow-y-auto p-[5px]">
                {filtered.map((opt, i) => {
                  const isSelected = opt.value === value;
                  const isActive = i === active;
                  return (
                    <li
                      key={opt.value}
                      id={`${baseId}-opt-${opt.value}`}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => select(opt)}
                      className={cn(
                        'flex h-[34px] cursor-pointer items-center gap-2.5 rounded-sm px-[9px] text-[13.5px]',
                        isSelected && 'bg-primary/[0.07]',
                        isActive && !isSelected && 'bg-accent',
                      )}
                    >
                      <Avatar opt={opt} size={22} />
                      <span className="truncate">{opt.label}</span>
                      {opt.sub && (
                        <span className="ml-1.5 shrink-0 text-[11.5px] text-muted-foreground">{opt.sub}</span>
                      )}
                      {isSelected && (
                        <Icon name="check" className="ml-auto size-[15px] shrink-0 text-primary" />
                      )}
                    </li>
                  );
                })}

                {filtered.length === 0 && (
                  <li role="presentation" className="px-3 py-3.5 text-center text-[12.5px] text-muted-foreground">
                    No {noun} matches
                    {query ? ` "${query}"` : ''}.
                    {onCreate && query.trim() && (
                      <button
                        type="button"
                        onClick={() => onCreate(query.trim())}
                        className="mt-2 inline-flex items-center gap-1.5 font-semibold text-primary"
                      >
                        <Icon name="plus" className="size-[14px]" />
                        {createLabel}
                      </button>
                    )}
                  </li>
                )}
              </ul>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
};

Combobox.displayName = 'Combobox';
