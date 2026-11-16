import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { Icon, type IconName } from './icons';
import { Button } from './Button';
import type { ButtonVariant } from './buttonClasses';

interface ActionSpec {
  label: string;
  onClick: () => void;
  loading?: boolean;
}

/** Loading silhouettes shaped like the content they stand in for. */
export type SkeletonShape = 'lines' | 'table' | 'cards' | 'detail' | 'chart' | 'rows' | 'items' | 'figure' | 'bars';

/** A loading silhouette: its shape, row count and least height. */
export interface SkeletonSpec { shape: SkeletonShape; rows?: number; columns?: number; minHeight?: number }

interface ListStateBaseProps {
  /** Table footer alignment that keeps the continuation action in the familiar centered position. */
  partialLayout?: 'row' | 'centeredAction';
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
  /** Use an outline action when the page header already carries the create action. */
  actionVariant?: ButtonVariant;
  /** Override the retry label for the current locale. */
  retryLabel?: string;
  /** Number of skeleton rows for the loading variant. */
  rows?: number;
  /** Loading silhouette: match the page/section it stands in for (defaults to plain lines). */
  shape?: SkeletonShape;
  /** Column count for the `table` silhouette. */
  columns?: number;
  /** Error: one quiet line under a panel's heading (warning icon, message, Retry text button), no tinted box.
   *  Empty: one line inside a panel section (icon, what is absent, its fix), on the section's left edge, no tall well. */
  quiet?: boolean;
  /** Loading only: the body's least height, so the silhouette matches a filled panel of that height. */
  minHeight?: number;
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

/** A failed read must always be recoverable from the state that explains it. */
export type ListStateProps = ListStateBaseProps & (
  | { variant: 'error'; onRetry: () => void }
  | { variant: 'loading' | 'empty' | 'partial'; onRetry?: never }
);

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

  // Rows the height of a filled list row (name, facts, figures, bar), so a list does not jump when it loads.
  if (shape === 'rows') {
    return (
      <div data-skeleton-shape="rows" aria-hidden="true" className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="grid gap-y-1 py-4">
            <div className="skel h-5 w-3/5" />
            <div className="skel h-5 w-2/5" />
            <div className="skel mt-1 h-5 w-4/5" />
            <div className="skel mt-1 h-2 w-full" />
          </div>
        ))}
      </div>
    );
  }

  // Two-line list rows at a filled row's pitch (name, then its supporting line; amount at the right).
  if (shape === 'items') {
    return (
      <div data-skeleton-shape="items" aria-hidden="true" className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_4rem] items-center gap-x-3 py-2.5">
            <div className="grid gap-1"><div className="skel h-5" style={{ width: `${72 - (i % 3) * 10}%` }} /><div className="skel h-4 w-2/5" /></div>
            <div className="skel h-5" />
          </div>
        ))}
      </div>
    );
  }

  // One figure: its value, a split bar and three short lines (legend and counts).
  if (shape === 'figure') {
    return (
      <div data-skeleton-shape="figure" aria-hidden="true" className="grid gap-2">
        <div className="skel h-8 w-1/2" />
        <div className="skel h-2.5 w-full" />
        <div className="skel h-5 w-2/5" />
        <div className="skel h-5 w-1/3" />
        <div className="skel h-5 w-3/4" />
      </div>
    );
  }

  // Labelled bars on one scale, one 44px row each (a ranking or a funnel).
  if (shape === 'bars') {
    return (
      <div data-skeleton-shape="bars" aria-hidden="true">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex min-h-11 items-center gap-3">
            <div className="skel h-4 w-28 shrink-0" />
            <div className="skel h-[18px]" style={{ width: `${70 - ((i * 23) % 45)}%` }} />
          </div>
        ))}
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

/** Shapes whose rows carry their own vertical padding (no extra inset around the silhouette). */
const SHAPES_WITHOUT_INSET = new Set<SkeletonShape>(['rows', 'items', 'figure', 'bars']);

/** Keep a failed read's body to renderable copy and elements, never raw service objects. */
function safeErrorBody(content: React.ReactNode): React.ReactNode {
  if (Array.isArray(content)) return content.map(safeErrorBody);
  if (
    content == null ||
    typeof content === 'string' ||
    typeof content === 'number' ||
    typeof content === 'bigint' ||
    typeof content === 'boolean' ||
    React.isValidElement(content)
  ) {
    return content;
  }
  return null;
}

/**
 * The single source of truth for the three async list states. Consumers render
 * exactly one ListState in place of their content — never hand-roll a spinner
 * or an ad-hoc empty message.
 */
/**
 * The Retry action already says "try again": a body that ends by saying it too would read it twice ("Coba lagi.
 * Coba lagi"). Drop a closing "Try again." sentence, or turn a closing "… and try again." into "…", in the active
 * language. Non-string bodies pass through.
 */
function withoutTryAgain(body: React.ReactNode, sentence: string, clause: string): React.ReactNode {
  if (typeof body !== 'string') return body;
  const text = body.trim();
  const lower = text.toLowerCase();
  const tail = clause.trim().toLowerCase();
  if (tail && lower.endsWith(` ${tail}`)) return `${text.slice(0, -tail.length).trimEnd()}.`;
  const closing = sentence.trim().toLowerCase();
  if (closing && (lower === closing || lower.endsWith(`. ${closing}`))) return text.slice(0, -closing.length).trimEnd() || null;
  return body;
}

export const ListState: React.FC<ListStateProps> = ({
  variant,
  partialLayout = 'row',
  title,
  titleAsPageHeading = false,
  sub,
  icon = 'inbox',
  action,
  actionVariant = 'primary',
  onRetry,
  retryLabel,
  rows = 5,
  shape = 'lines',
  columns = 5,
  loadingLabel,
  loadingRole,
  loadingAriaLabel,
  quiet = false,
  minHeight,
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
        className={cn(!SHAPES_WITHOUT_INSET.has(shape) && 'py-4', className)}
        style={minHeight ? { minHeight } : undefined}
      >
        <span className="sr-only">{loadingLabel ?? (ready ? t('ui.listState.loading', 'Loading…') : 'Loading…')}</span>
        <SkeletonBody shape={shape} rows={rows} columns={columns} />
      </div>
    );
  }

  if (variant === 'partial') {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          partialLayout === 'centeredAction'
            ? 'grid grid-cols-1 gap-y-2 text-center sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:text-left'
            : 'flex flex-wrap items-center gap-3',
          'text-control text-muted-foreground',
          className,
        )}
      >
        {title && <span className="min-w-0 flex-1">{title}</span>}
        {sub && <span className="min-w-0">{sub}</span>}
        {action && (
          <Button variant="outline" size="sm" loading={action.loading} onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </div>
    );
  }

  if (variant === 'error') {
    const safeSub = withoutTryAgain(safeErrorBody(sub), t('ui.listState.tryAgainSentence', 'Try again.'), t('ui.listState.andTryAgain', ' and try again.'));
    // One error treatment app-wide: a warning icon (the only red) on the first text line, then ONE text block with
    // the message (and its detail) and Retry following the text, so a long message wraps beside the icon and Retry
    // wraps under the TEXT, never alone under the icon. Retry's touch padding is cancelled by its negative margin, so
    // it never grows the line. Inside a panel (`quiet`) it is a plain line under the heading; standing alone it keeps
    // a tinted frame and a destructive headline.
    return (
      <div role="alert" aria-live="assertive" className={cn('flex items-start gap-x-2 text-control', quiet ? 'py-2' : 'rounded-lg border border-destructive/30 bg-destructive/[0.07] px-4 py-3', className)}>
        <span className="flex h-lh shrink-0 items-center"><Icon name="alert" aria-hidden className="size-5 text-destructive" /></span>
        <div className="min-w-0 flex-1 text-foreground">
          {/* O18: a page whose only content is this error keeps its level-one heading. */}
          {title && (titleAsPageHeading
            ? <h1 className={cn(safeSub ? 'block' : 'inline', !quiet && 'font-semibold text-destructive-text')}>{title}</h1>
            : <span className={cn(safeSub && 'block', !quiet && 'font-semibold text-destructive-text')}>{title}</span>)}
          {safeSub && <span className="mt-px text-muted-foreground">{safeSub}</span>}{' '}
          <button type="button" onClick={onRetry} className="-my-1.5 ms-1 inline-block whitespace-nowrap py-1.5 font-medium text-primary-text hover:underline max-[640px]:-my-3 max-[640px]:py-3 pointer-coarse:-my-3 pointer-coarse:py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {resolvedRetryLabel}
          </button>
        </div>
      </div>
    );
  }

  // empty
  if (quiet) {
    return (
      <div className={cn('flex items-start gap-2 py-2 text-left', className)}>
        <Icon name={icon} aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <div className="flex min-w-0 flex-col items-start gap-1">
          {title && <div className="text-control text-foreground">{title}</div>}
          {sub && <div className="max-w-[60ch] text-control text-muted-foreground">{sub}</div>}
          {action && (
            <Button variant={actionVariant} size="sm" onClick={action.onClick} className="mt-1">
              {action.label}
            </Button>
          )}
        </div>
      </div>
    );
  }

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
        <Button variant={actionVariant} size="sm" onClick={action.onClick} className="mt-1">
          {action.label}
        </Button>
      )}
    </div>
  );
};
