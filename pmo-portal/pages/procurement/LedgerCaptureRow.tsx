/**
 * LedgerCaptureRow — the ONE capture affordance for the Documents ledger.
 *
 * Pre-selects the next expected record type for the current procurement stage
 * via `nextExpectedType(status)`. Wraps the existing `RecordCaptureForm` (reuse —
 * no new form primitive). Gated via the caller-supplied `canWrite` (derived from
 * `can('create','procFile',{ realRole })` at the page level — the real JWT role).
 *
 * Terminal statuses (Paid / Cancelled / Rejected) hide the row entirely (honest
 * doorway — no dead control). Multiple captures are supported: after one record is
 * saved the row remains for another (gated only by `canWrite` + stage).
 *
 * PO-less paths: `nextExpectedType` falls back to the next LEGAL type for the case's
 * actual stage, not a fixed chain. The capture form's FK selects remain optional/
 * none-default (already the case in RecordCaptureForm's [PD-5] handling).
 *
 * DESIGN.md tokens: dashed capture row uses `border-primary/35 bg-primary/[0.04]` per §6.
 */
import React, { useState } from 'react';
import { Icon } from '@/src/components/ui';
import { RecordCaptureForm, type RecordKind } from './RecordCaptureForm';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import type { ProcurementInvoiceRow } from '@/src/lib/db/procurementLifecycle';

// ---------------------------------------------------------------------------
// nextExpectedType: maps the current status to the record kind the user would
// most likely want to capture next. Falls back to 'purchase_request' when no
// specific next type is mapped (Draft: either a PR or RFQ; we offer PR first).
// Terminal statuses return null → caller hides the row.
// ---------------------------------------------------------------------------

/** Terminal statuses where capture is not available. */
const TERMINAL_STATUSES = new Set<ProcurementStatus>([
  'Paid',
  'Cancelled',
  'Rejected',
]);

function nextExpectedType(status: ProcurementStatus): RecordKind | null {
  if (TERMINAL_STATUSES.has(status)) return null;

  switch (status) {
    case 'Draft':
    case 'Requested':
    case 'Rejected': // already guarded above but TypeScript needs the case
      return 'purchase_request';
    case 'Approved':
    case 'Vendor Quoted':
      return 'rfq';
    case 'Quote Selected':
      return 'purchase_order';
    case 'Ordered':
    case 'Received':
      // M4 (design-review): at Ordered the next step is a Goods Receipt, and at
      // Received the next step is a Vendor Invoice — but neither GR nor VI is a
      // RecordKind in the ledger capture (they are handled by the action-zone
      // inline forms). Returning null here hides the ledger capture row at these
      // stages so the row doesn't mis-prompt "Capture Purchase Order" (which is
      // past that phase). The action zone remains the single source for GR/VI.
      return null;
    case 'Vendor Invoiced':
      return 'payment';
    default:
      return 'purchase_request';
  }
}

/** Human label for the capture type (shown in the dashed row label). */
const CAPTURE_LABELS: Record<RecordKind, string> = {
  purchase_request: 'Purchase Request',
  rfq: 'RFQ',
  purchase_order: 'Purchase Order',
  payment: 'Payment',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface LedgerCaptureRowProps {
  /** Current procurement status — determines which type to pre-select. */
  status: ProcurementStatus;
  /** Called when a record is saved. Refreshes the ledger via React Query's invalidation. */
  onCreate: (kind: RecordKind, input: unknown) => Promise<unknown>;
  /** Invoice rows for the payment predecessor-FK dropdown ([PD-5]). */
  invoices?: ProcurementInvoiceRow[];
  /** Whether the capture affordance is active. Derived from real JWT role. */
  canWrite: boolean;
  /** Whether any mutation is in flight (busy state). */
  busy?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const LedgerCaptureRow: React.FC<LedgerCaptureRowProps> = ({
  status,
  onCreate,
  invoices = [],
  canWrite,
  busy = false,
}) => {
  const [open, setOpen] = useState(false);
  const nextKind = nextExpectedType(status);

  // Honest doorway: hide when canWrite=false OR terminal status
  if (!canWrite || nextKind === null) return null;

  const label = CAPTURE_LABELS[nextKind];

  return (
    <div data-testid="ledger-capture-row" className="mt-3">
      {open ? (
        <RecordCaptureForm
          kind={nextKind}
          invoices={invoices}
          busy={busy}
          onCreate={(input) => onCreate(nextKind, input)}
          onClose={() => setOpen(false)}
        />
      ) : (
        /* Dashed capture prompt (DESIGN.md §6 capture row token) */
        <div
          className="flex flex-wrap items-center gap-3 rounded-[calc(var(--radius)-2px)] border-[1.5px] border-dashed border-primary/35 bg-primary/[0.04] px-4 py-3"
        >
          <span className="text-[13px] text-muted-foreground">
            + Capture{' '}
            <span className="font-semibold text-[hsl(var(--nav-active-text))]">{label}</span>
            {' '}— the next record for this phase.
          </span>
          <button
            type="button"
            data-testid="ledger-capture-open"
            onClick={() => setOpen(true)}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Icon name="plus" className="size-3.5" />
            Capture {label}
          </button>
        </div>
      )}
    </div>
  );
};

LedgerCaptureRow.displayName = 'LedgerCaptureRow';
