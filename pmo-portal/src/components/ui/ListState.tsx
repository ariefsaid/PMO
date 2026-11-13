import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { Icon, type IconName } from './icons';
import { Button, type ButtonVariant } from './Button';

interface ActionSpec {
  label: string;
  onClick: () => void;
  variant?: ButtonVariant;
}

/** Loading silhouettes shaped like the content they stand in for. */
export type SkeletonShape = 'lines' | 'table' | 'cards' | 'detail' | 'chart';

export interface ListStateProps {
  variant: 'loading' | 'empty' | 'error';
  /** Empty/error heading. */
  title?: string;
  /** Render the empty-state title as the page's h1 (a whole-page state such as no access). */
  titleAsPageHeading?: boolean;
  /** Empty/error supporting copy (≤44ch). String or ReactNode (e.g. a Link). */
  sub?: React.ReactNode;
  /** Empty-state icon (defaults to `inbox`). */
  icon?: IconName;
  /** Empty-state populating action (empty-states guideline). */
  action?: ActionSpec;
  /** Error-state retry handler (error-recovery: cause + fix + retry). */
  onRetry?: () => void;
  /** Override the retry label for the current locale. */
  retryLabel?: string;
  /** Number of skeleton rows for the loading variant. */
  rows?: number;
  /** Loading silhouette: match the page/section it stands in for (defaults to plain lines). */
  shape?: SkeletonShape;
  /** Column count for the `table` silhouette. */
  columns?: number;
  /** Screen-reader loading copy (page/section loads keep their own wording). */
  loadingLabel?: string;
  /** Use a semantic status region for loading surfaces that previously announced with role=status. */
  loadingRole?: 'status';
  /** Preserve an explicit accessible name for a status loading region. */
  loadingAriaLabel?: string;
  className?: string;
  /** Override the default `liststate-loading` testid for the loading skeleton wrapper. */
  testId?: string;
  /**
   * `empty_state_seen` analytics (2026-07-13 wiring plan) — a stable id for THIS empty
   * surface (e.g. 'companies-empty', 'projects-filtered-empty'). Fired once on mount,
   * only for `variant="empty"`, only when `stateId` + `role` + `module` are ALL given
   * (opt-in — a caller that omits them is simply not tracked).
   */
  stateId?: string;
  /** See `stateId`. The viewer's role. */
  role?: string;
  /** See `stateId`. The module this empty state belongs to (e.g. 'companies'). */
  module?: string;
}

/**
 * The loading silhouette. Every block is the shared `.skel` shimmer utility — the
 * SAME primitive KPI tiles and charts use — so a page never grows a second skeleton
 * vocabulary. The whole silhouette is aria-hidden: it is a promise of shape, not data.
 */
const SkeletonBody: React.FC<{ shape: SkeletonShape; rows: number; columns: number }> = ({
  shape,
  rows,
  columns,
}) => {
  const lines = (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skel skel-line" style={{ width: `${90 - (i % 3) * 12}%` }} />
      ))}
    </>
  );

  if (shape === 'table') {
    return (
      <div data-skeleton-shape="table" aria-hidden="true" className="space-y-2.5">
        <div className="flex items-center gap-3 border-b border-border pb-2.5">
          {Array.from({ length: columns }).map((_, i) => (
            <div key={i} className="skel h-2.5 flex-1" style={{ opacity: 0.75 }} />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-3">
            {Array.from({ length: columns }).map((_, c) => (
              <div key={c} className={c === 0 ? 'skel h-4 flex-[1.6]' : 'skel h-4 flex-1'} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (shape === 'cards') {
    return (
      <div data-skeleton-shape="cards" aria-hidden="true" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: Math.max(rows, 3) }).map((_, i) => (
          <div key={i} className="space-y-2.5 rounded-lg border border-border bg-card p-4">
            <div className="skel h-3 w-1/2" />
            <div className="skel h-6 w-2/3" />
            <div className="skel h-3 w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  if (shape === 'detail') {
    return (
      <div data-skeleton-shape="detail" aria-hidden="true" className="space-y-4">
        <div className="space-y-2 border-b border-border pb-3.5">
          <div className="skel h-5 w-1/3" />
          <div className="skel h-3 w-1/2" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: Math.max(rows, 3) }).map((_, i) => (
            <div key={i} className="space-y-2.5 rounded-lg border border-border bg-card p-4">
              <div className="skel h-3 w-1/2" />
              <div className="skel h-5 w-2/3" />
              <div className="skel h-3 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (shape === 'chart') {
    return (
      <div data-skeleton-shape="chart" aria-hidden="true" className="space-y-3">
        <div className="flex h-28 items-end gap-2 sm:h-36">
          {Array.from({ length: Math.max(rows, 6) }).map((_, i) => (
            <div
              key={i}
              className="skel flex-1"
              style={{ height: `${35 + ((i * 37) % 55)}%` }}
            />
          ))}
        </div>
        <div className="flex gap-3">
          <div className="skel h-2.5 w-16" />
          <div className="skel h-2.5 w-12" />
          <div className="skel h-2.5 w-14" />
        </div>
      </div>
    );
  }

  return (
    <div data-skeleton-shape="lines" aria-hidden="true">
      {lines}
    </div>
  );
};

/**
 * The single source of truth for the three async list states. Consumers render
 * exactly one ListState in place of their content — never hand-roll a spinner
 * or an ad-hoc empty message.
 */
export const ListState: React.FC<ListStateProps> = ({
  variant,
  title,
  titleAsPageHeading = false,
  sub,
  icon = 'inbox',
  action,
  onRetry,
  retryLabel,
  rows = 5,
  shape = 'lines',
  columns = 5,
  loadingLabel,
  loadingRole,
  loadingAriaLabel,
  className,
  testId,
  stateId,
  role,
  module,
}) => {
  // Authentication loading can render before I18nProvider finishes its first async init.
  // This shared state primitive must remain renderable during that boot window.
  const { t, ready } = useTranslation(undefined, { useSuspense: false });
  const resolvedRetryLabel = retryLabel ?? (ready ? t('ui.listState.retry', 'Retry') : 'Retry');
  // empty_state_seen (2026-07-13 wiring plan) — fired once on mount, only for the
  // rendered "empty" variant, only when the caller opted in with all three ids. Must
  // run unconditionally (Rules of Hooks) ahead of the loading/error early returns below.
  useEffect(() => {
    if (variant === 'empty' && stateId && role && module) {
      void import('@/src/lib/analytics').then(({ trackEmptyStateSeen }) => {
        trackEmptyStateSeen(stateId, role, module);
      }).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (variant === 'loading') {
    return (
      <div
        data-testid={testId ?? 'liststate-loading'}
        role={loadingRole}
        aria-busy="true"
        aria-label={loadingAriaLabel}
        aria-live="polite"
        className={cn('p-4', className)}
      >
        <span className="sr-only">{loadingLabel ?? (ready ? t('ui.listState.loading', 'Loading…') : 'Loading…')}</span>
        <SkeletonBody shape={shape} rows={rows} columns={columns} />
      </div>
    );
  }

  if (variant === 'error') {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className={cn(
          'flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/[0.07] px-4 py-3.5',
          className
        )}
      >
        <Icon name="alert" className="size-5 shrink-0 text-destructive" />
        <div className="flex-1">
          {/* O18: a page whose only content is this error keeps its level-one heading. */}
          {title && (titleAsPageHeading
            ? <h1 className="text-control font-semibold text-destructive-text">{title}</h1>
            : <div className="text-control font-semibold text-destructive-text">{title}</div>)}
          {sub && <div className="mt-px text-control text-muted-foreground">{sub}</div>}
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <Icon name="refresh" />
            {resolvedRetryLabel}
          </Button>
        )}
      </div>
    );
  }

  // empty
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-14 text-center',
        className
      )}
    >
      <Icon name={icon} aria-hidden className="size-6 text-muted-foreground" strokeWidth={1.75} />
      {title && (titleAsPageHeading ? <h1 className="text-group font-semibold">{title}</h1> : <div className="text-group font-semibold">{title}</div>)}
      {sub && <div className="max-w-[44ch] text-control text-muted-foreground">{sub}</div>}
      {action && (
        <Button variant={action.variant ?? 'primary'} size="sm" onClick={action.onClick} className="mt-1">
          {action.label}
        </Button>
      )}
    </div>
  );
};
