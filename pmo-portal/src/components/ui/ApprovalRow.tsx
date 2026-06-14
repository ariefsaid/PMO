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
  /**
   * Optional leading-edge disclosure affordance (AC-JR-W4-01 — ADR-0028).
   * Rendered at the very start of the row flex (before the avatar/name), so the
   * consumer can place a chevron-toggle or expand button at the left edge,
   * matching the ProcurementApprovalRow layout.
   *
   * When omitted (existing callers) the avatar remains the first child — no
   * layout change for callers that don't pass this prop.
   */
  disclosure?: React.ReactNode;
  /** Action buttons (Approve / Return). */
  children?: React.ReactNode;
  className?: string;
}

/**
 * A single submitted-timesheet row in the manager approval queue: optional
 * leading disclosure affordance + avatar + owner + week·hours + status pill +
 * actions. Avatar is decorative (the name is the accessible label). Solid bottom
 * rule separates rows (consistent with ProcurementApprovalRow — census violation B
 * fix: `border-dashed` replaced with `border-b border-border`).
 */
export const ApprovalRow: React.FC<ApprovalRowProps> = ({
  name,
  week,
  hours,
  status,
  disclosure,
  children,
  className,
}) => {
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  return (
    <div
      data-approval-row
      className={cn(
        'flex flex-wrap items-center gap-3 border-b border-border py-[11px] last:border-b-0',
        className
      )}
    >
      {disclosure}
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
