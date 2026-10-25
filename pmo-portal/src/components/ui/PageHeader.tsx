import React from 'react';
import { cn } from './cn';
import { PageHeading } from './PageHeading';

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
}

/** Detail-page header card (`phead`): shared record heading + stats + actions. */
export const PageHeader: React.FC<PageHeaderProps> = ({
  icon,
  iconColor,
  name,
  meta,
  status,
  stats,
  actions,
  className,
  'data-testid': dataTestId,
  surface = 'card',
}) => (
  <div
    data-testid={dataTestId}
    className={cn(
      surface === 'card' && 'mb-4 rounded-lg border border-border bg-card px-5 py-[18px]',
      className,
    )}
  >
    <PageHeading
      kind="record"
      title={name}
      scope={meta}
      status={status}
      leading={icon ? (
        <span
          className="grid size-11 shrink-0 place-items-center rounded-[10px] text-[17px] font-bold text-white [&_svg]:size-5"
          style={{ background: iconColor ?? 'hsl(var(--primary))' }}
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : undefined}
      actions={actions}
    />
    {stats && stats.length > 0 && (
      <div
        className="mt-4 grid gap-[22px] border-t border-border pt-4"
        style={{ gridTemplateColumns: `repeat(${stats.length}, 1fr)` }}
      >
        {stats.map((s, i) => (
          <div key={i}>
            <div className="mb-[3px] text-[11.5px] text-muted-foreground">{s.label}</div>
            <div className="text-[15px] font-bold tracking-[-0.01em] tabular">{s.value}</div>
          </div>
        ))}
      </div>
    )}
  </div>
);
