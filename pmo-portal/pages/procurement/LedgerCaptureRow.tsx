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
import type { RecordType } from '@/src/lib/db/procurementLedger';
// nextExpectedType is the DATA-DRIVEN capture gate (status-unlock AND not-already-
// present). Extracted to a sibling module so it stays unit-testable directly (no
// mirror → no drift) without a react-refresh component-export lint violation.
import { nextExpectedType } from './ledgerCapture';

/** Human label for the capture type (shown in the dashed row label).
 *  GR/VI are NOT capturable here (handled by the action-zone forms — see
 *  nextExpectedType's M4 note), so they are absent from this ledger-only map. */
const CAPTURE_LABELS: Record<RecordKind, string> = {
  purchase_request: 'Purchase Request',
  rfq: 'RFQ',
  purchase_order: 'Purchase Order',
  payment: 'Payment',
  goods_receipt: 'Goods Receipt',
  vendor_invoice: 'Vendor Invoice',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface LedgerCaptureRowProps {
  /** Current procurement status — determines which type is unlocked. */
  status: ProcurementStatus;
  /**
   * The set of ledger RecordTypes already captured for this case. Used to gate
   * the capture offer: a kind that already exists is never re-offered (the
   * over-prompt fix — e.g. a submitted PR at Requested → await approval).
   */
  existingTypes: ReadonlySet<RecordType>;
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
  existingTypes,
  onCreate,
  invoices = [],
  canWrite,
  busy = false,
}) => {
  const [open, setOpen] = useState(false);
  const nextKind = nextExpectedType(status, existingTypes);

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
