import React, { useCallback, useEffect, useRef } from 'react';
import { cn } from './cn';
import { Icon } from './icons';
import { trackSearchUsed } from '@/src/lib/analytics';

const SEARCH_USED_DEBOUNCE_MS = 500;

/** Toolbar seamed to the table top (or `standalone` fully rounded). */
export const Toolbar: React.FC<
  React.HTMLAttributes<HTMLDivElement> & { standalone?: boolean }
> = ({ standalone = false, className, children, ...rest }) => (
  <div
    className={cn(
      'flex flex-wrap items-center gap-2 border border-border bg-card px-[var(--space-content-inset)] py-2',
      standalone ? 'mb-[var(--space-group)] rounded-lg' : 'rounded-t-lg border-b-0',
      className
    )}
    {...rest}
  >
    {children}
  </div>
);

export interface SearchMiniProps extends React.InputHTMLAttributes<HTMLInputElement> {
  containerClassName?: string;
  /**
   * `search_used` analytics (2026-07-13 wiring plan) — a stable id for this search
   * surface (e.g. 'companies-list'). Tracking is opt-in: omit `searchSurface` or
   * `module` to skip it entirely. Fires once per search intent (500ms idle, or
   * immediately on Enter) — never per keystroke, and NEVER the query text itself.
   */
  searchSurface?: string;
  /** See `searchSurface`. The module this search surface belongs to. */
  module?: string;
  /** The current result count AFTER filtering by `value` — read only at fire time. */
  resultCount?: number;
}

/** Borderless search field shell. */
export const SearchMini: React.FC<SearchMiniProps> = ({
  containerClassName,
  className,
  searchSurface,
  module,
  resultCount,
  value,
  onKeyDown,
  ...rest
}) => {
  // `resultCount` changes every keystroke (the parent's filtered list recomputes) but
  // must never itself restart/duplicate the debounce — read the latest value via a ref
  // at fire time instead of putting it in the effect's dependency list.
  const resultCountRef = useRef(resultCount);
  resultCountRef.current = resultCount;
  const timerRef = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  const fire = useCallback(() => {
    if (!searchSurface || !module) return;
    trackSearchUsed(searchSurface, resultCountRef.current ?? 0, module);
  }, [searchSurface, module]);

  useEffect(() => {
    if (!searchSurface || !module) return undefined;
    const str = typeof value === 'string' ? value : '';
    if (!str.trim()) return undefined;
    timerRef.current = window.setTimeout(() => {
      fire();
      timerRef.current = undefined;
    }, SEARCH_USED_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `fire` reads searchSurface/module/resultCountRef; only `value` should restart the debounce.
  }, [value, searchSurface, module]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
      const str = typeof value === 'string' ? value : '';
      if (str.trim()) fire();
    }
    onKeyDown?.(e);
  };

  return (
    <div
      className={cn(
        'touch-target relative flex h-[var(--control-height)] min-w-[190px] items-center gap-2 rounded-md border border-border hover:border-input bg-card px-3 text-control [&_svg]:size-[15px] [&_svg]:text-muted-foreground',
        containerClassName
      )}
      onClick={() => inputRef.current?.focus()}
    >
      <Icon name="search" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onKeyDown={handleKeyDown}
        className={cn(
          'w-full border-none bg-transparent text-control outline-none placeholder:text-muted-foreground',
          className
        )}
        {...rest}
      />
    </div>
  );
};
