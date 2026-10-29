import React from 'react';
import { cn } from './cn';

export interface PageStat {
  label: string;
  value: React.ReactNode;
}

export interface PageHeaderProps {
  /** Optional leading icon tile (color via iconColor). */
  icon?: React.ReactNode;
  iconColor?: string;
  name: React.ReactNode;
  meta?: React.ReactNode;
  /** Status pill or other badge node. */
  status?: React.ReactNode;
  /** Keep a record's status in the title row at every width. */
  statusInline?: boolean;
  /** Place status below metadata on narrow screens, then beside the title from sm up. */
  statusBelowMetaOnMobile?: boolean;
  /** Optional stat strip below the title. */
  stats?: PageStat[];
  /** Trailing action buttons. */
  actions?: React.ReactNode;
  className?: string;
  /** Optional test hook forwarded to the header root. */
  'data-testid'?: string;
  /**
   * `card` (default) wraps the header in the bordered `card` chrome used on detail pages.
   * `bare` drops that chrome so a host surface (e.g. a Drawer with its own border seam)
   * supplies the framing — the inner icon + name + status + actions anatomy is unchanged.
   */
  surface?: 'card' | 'bare';
  /** Put the actions on their own row under the name (narrow hosts such as a drawer), so the name is never truncated by them. */
  actionsBelow?: boolean;
}

/** Detail-page header card (`phead`): icon + name + status + meta + stats + actions. */
export const PageHeader: React.FC<PageHeaderProps> = ({
  icon,
  iconColor,
  name,
  meta,
  status,
  statusInline = false,
  statusBelowMetaOnMobile = false,
  stats,
  actions,
  className,
  'data-testid': dataTestId,
  surface = 'card',
  actionsBelow = false,
}) => (
  <div
    data-testid={dataTestId}
    className={cn(
      surface === 'card' && 'mb-[var(--space-section)] rounded-lg border border-border bg-card px-[var(--space-content-inset)] py-[var(--space-content-inset)]',
      className,
    )}
  >
    {/* Narrow widths: the record name gets width priority; the action zone can wrap below. */}
    <div className="flex flex-wrap items-start gap-[var(--space-group)]">
      {icon && (
        <span
          className="grid size-11 shrink-0 place-items-center rounded-[10px] text-[17px] font-bold text-primary-foreground [&_svg]:size-5"
          style={{ background: iconColor ?? 'hsl(var(--primary))' }}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className={cn(
          'min-w-0 gap-2',
          statusBelowMetaOnMobile
            ? 'grid grid-cols-[minmax(0,1fr)_auto] items-baseline sm:flex sm:flex-wrap'
            : cn('flex items-baseline', statusInline ? 'flex-nowrap' : 'flex-wrap'),
        )}>
          <h1 className={cn(
            'min-w-0 text-page font-semibold',
            statusBelowMetaOnMobile
              ? 'col-span-2 row-start-1 break-words sm:col-span-1 sm:row-start-auto sm:flex-[0_1_auto]'
              : statusInline ? 'flex-[0_1_auto] truncate' : 'flex-1 break-words',
            !actionsBelow && 'sm:truncate',
          )}>{name}</h1>
          {status && <span className={cn(
            'self-baseline',
            statusInline && 'shrink-0',
            statusBelowMetaOnMobile && 'col-span-2 row-start-3 justify-self-start sm:col-span-1 sm:row-start-auto',
          )}>{status}</span>}
        </div>
        {meta && <div className={cn(
          'mt-0.5 text-support text-muted-foreground',
          statusBelowMetaOnMobile && 'col-span-2 row-start-2 sm:row-start-auto',
        )}>{meta}</div>}
      </div>
      {actions && <div className={cn('flex w-full shrink-0 items-center gap-2', !actionsBelow && 'ml-auto sm:w-auto')}>{actions}</div>}
    </div>
    {stats && stats.length > 0 && (
      <div
        className="mt-4 grid gap-4 border-t border-border pt-4"
        style={{ gridTemplateColumns: `repeat(${stats.length}, 1fr)` }}
      >
        {stats.map((s, i) => (
          <div key={i}>
            <div className="mb-1 text-support text-muted-foreground">{s.label}</div>
            <div className="text-group font-semibold tabular">{s.value}</div>
          </div>
        ))}
      </div>
    )}
  </div>
);
