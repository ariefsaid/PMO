import React from 'react';
import { cn } from './cn';

export interface ApprovalRowProps {
  /** Owner full name (drives the avatar initial). */
  name: string;
  /**
   * Week label, e.g. "Week of Jun 2". Required when `subtitle` is not provided
   * (the default timesheet subtitle is `{week} · {hours} h`).
   */
  week?: React.ReactNode;
  /**
   * Total hours for the week (tabular). Required when `subtitle` is not provided.
   */
  hours?: number;
  /**
   * B (AC-JR-W3B-03): optional fully-custom subtitle that overrides the default
   * `{week} · {hours} h` line. When provided, `week` and `hours` are ignored.
   * Used by ProcurementApprovalRow to render request-meta (code · amount · age)
   * in the unified shell without being tied to the timesheet format.
   */
  subtitle?: React.ReactNode;
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
  /**
   * AC-ROWCLICK-APPROVAL: whole-row pointer affordance. When provided, clicking
   * anywhere on the row body (outside a nested interactive control) fires this
   * callback — used by the /approvals action queue to TOGGLE the in-place expand
   * (NOT navigate), so an approver can open the budget-impact panel by clicking
   * the row, not just the disclosure chevron.
   *
   * The keyboard/AT affordance stays the existing focusable `disclosure` chevron
   * (which carries aria-expanded/aria-controls) — the row click is a pointer
   * convenience layered on top, so no nested-interactive a11y violation is
   * introduced. Nested controls (chevron, status links, action buttons,
   * checkboxes) are guarded via a `closest()` interactive-element check.
   */
  onActivate?: () => void;
}

/**
 * A single submitted-approval row (timesheet or procurement): optional leading
 * disclosure affordance + avatar + owner/title + subtitle + status pill + actions.
 * Avatar is decorative (the name is the accessible label). Solid bottom rule
 * separates rows (consistent across both approval types — census violation B fix).
 *
 * The `subtitle` prop allows procurement rows to supply custom meta (code · amount
 * · age) while sharing the identical container shell (gap-3/py-[11px]/items-center
 * /avatar) that timesheet rows use. Switching the scope tab no longer shifts row
 * metrics (B — the owner's chevron-order complaint, root cause addressed).
 */
export const ApprovalRow: React.FC<ApprovalRowProps> = ({
  name,
  week,
  hours,
  subtitle,
  status,
  disclosure,
  children,
  className,
  onActivate,
}) => {
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  const subtitleNode = subtitle ?? (
    <span>
      {week} · <span className="tabular">{hours !== undefined ? hours.toFixed(1) : '0.0'}</span> h
    </span>
  );
  return (
    <div
      data-approval-row
      onClick={
        onActivate
          ? (e) => {
              // Guard: ignore clicks originating from interactive controls inside
              // the row (the disclosure chevron, status pill links, action
              // buttons, checkboxes, etc.) so they never double-fire the row
              // toggle. Mirrors the DataTable row-activation guard.
              if (
                (e.target as HTMLElement).closest(
                  'button, a, select, input, textarea, label, [role="menuitem"], [contenteditable]'
                )
              )
                return;
              onActivate();
            }
          : undefined
      }
      className={cn(
        'flex flex-wrap items-center gap-3 border-b border-border py-[11px] last:border-b-0',
        onActivate && 'cursor-pointer transition-colors hover:bg-accent/60',
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
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="text-[12px] text-muted-foreground">
          {subtitleNode}
        </div>
      </div>
      {status && <div className="shrink-0">{status}</div>}
      {children}
    </div>
  );
};
