import React from 'react';
import { cn } from './cn';

export interface ApprovalRowProps {
  /** Owner full name (drives the avatar initial). */
  name: string;
  /** Week label, e.g. "Week of Jun 2". */
  week: React.ReactNode;
  /** Total hours for the week (tabular). */
  hours: number;
  /** Status pill node. */
  status?: React.ReactNode;
  /** Action buttons (Approve / Return). */
  children?: React.ReactNode;
  className?: string;
}

/**
 * A single submitted-timesheet row in the manager approval queue: avatar +
 * owner + week·hours + status pill + actions. Avatar is decorative (the name is
 * the accessible label). Dashed bottom rule separates rows.
 */
export const ApprovalRow: React.FC<ApprovalRowProps> = ({
  name,
  week,
  hours,
  status,
  children,
  className,
}) => {
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  return (
    <div
      data-approval-row
      className={cn(
        'flex flex-wrap items-center gap-3 border-b border-dashed border-border py-[11px] last:border-b-0',
        className
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-[12px] font-bold text-muted-foreground"
      >
        {initial}
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="text-[12px] text-muted-foreground">
          {week} · <span className="tabular">{hours.toFixed(1)}</span> h
        </div>
      </div>
      <span className="flex-1" />
      {status && <div className="shrink-0">{status}</div>}
      {children}
    </div>
  );
};
