/**
 * ApprovalChip — approve/deny UI for a pending write action proposed by the agent.
 *
 * Renders the server-composed humanSummary and Approve/Deny buttons.
 * Mirrors ToolCallCard/ErrorCard class conventions (DESIGN.md tokens).
 *
 * FR-AW-017/018/019; NFR-AW-A11Y-001/002/003; AC-AW-013..017.
 *
 * State machine:
 *   pending   → Approve + Deny buttons active
 *   approving → buttons disabled (in-flight)
 *   approved  → "Approved ✓" notice; no buttons
 *   denied    → "Denied" notice; no buttons
 */
import React from 'react';

export interface ApprovalChipProps {
  /** Server-composed summary (NOT model-generated). Truncated to 120 chars if needed. */
  humanSummary: string;
  /** Current resolution state of this chip. */
  state: 'pending' | 'approving' | 'approved' | 'denied';
  /** Called when the user clicks Approve. */
  onApprove: () => void;
  /** Called when the user clicks Deny. */
  onDeny: () => void;
}

/** Truncate to 120 chars (FR-AW-017). */
function truncate(s: string, max = 120): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export const ApprovalChip: React.FC<ApprovalChipProps> = ({
  humanSummary,
  state,
  onApprove,
  onDeny,
}) => {
  const summary = truncate(humanSummary);
  const isResolved = state === 'approved' || state === 'denied';
  const isInFlight = state === 'approving';
  const disabled = isInFlight || isResolved;

  return (
    <div
      role="group"
      aria-label="Action approval required"
      aria-live="assertive"
      className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm"
    >
      {/* Summary line */}
      <p className="mb-2 text-xs text-foreground">{summary}</p>

      {/* Resolved states */}
      {state === 'approved' && (
        <p className="text-xs font-medium text-green-600">Approved ✓</p>
      )}
      {state === 'denied' && (
        <p className="text-xs font-medium text-muted-foreground">Denied</p>
      )}

      {/* Approving in-flight state */}
      {state === 'approving' && (
        <p
          aria-live="polite"
          className="text-xs text-muted-foreground motion-reduce:animate-none"
        >
          Approving…
        </p>
      )}

      {/* Action buttons — shown in pending and approving states */}
      {!isResolved && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onApprove}
            disabled={disabled}
            aria-label="Approve"
            className={[
              'rounded-md border border-transparent px-3 py-1 text-xs font-medium',
              'bg-primary text-primary-foreground',
              'hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50',
            ].join(' ')}
          >
            Approve
          </button>
          <button
            type="button"
            onClick={onDeny}
            disabled={disabled}
            aria-label="Deny"
            className={[
              'rounded-md border border-border px-3 py-1 text-xs font-medium',
              'text-foreground',
              'hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50',
            ].join(' ')}
          >
            Deny
          </button>
        </div>
      )}
    </div>
  );
};
