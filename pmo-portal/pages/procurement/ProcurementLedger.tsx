/**
 * ProcurementLedger — the Documents tab case ledger (Slice 2).
 *
 * One chronological DataTable for all 7 procurement record types:
 *   Date · Type · System # · External ref · Amount · Status · File
 *
 * Three filter chips (All / Financial / Has file) — `<button aria-pressed>` per
 * DESIGN.md §6 filter-chips spec. Mobile reflow via the existing DataTable md→card
 * branch (no bespoke table). Empty types produce no row (the de-dup contract).
 *
 * `LedgerCaptureRow` below the table provides the single capture affordance (ONE
 * per page), pre-selecting the next expected type for the active stage, gated by
 * the caller's `canWrite`. Capturing invalidates the detail query, refreshing the
 * ledger automatically.
 *
 * DESIGN.md tokens only; no raw hex/px. No horizontal bleed @390/360 (DataTable
 * md→card handles mobile). WCAG-AA: filter chips are keyboard-operable buttons
 * with aria-pressed; status pills are dot+label (never color-only); mono IDs.
 *
 * File column: zero per-row network calls on mount. File presence (fileTitle /
 * fileCount / fileHref) is pre-built from the bundle by buildLedgerRows. The cell
 * signs the URL lazily on click (try/catch — non-fatal) and shows an upload
 * affordance for canWrite rows with no file.
 */
import React, { useMemo, useState } from 'react';
import {
  CardPad,
  DataTable,
  StatusPill,
} from '@/src/components/ui';
import type { Column } from '@/src/components/ui';
import { LedgerCaptureRow } from './LedgerCaptureRow';
import { LedgerFileCell } from './LedgerFileCell';
import type { RecordKind } from './RecordCaptureForm';
import { useProcurementRecordMutations } from '@/src/hooks/useProcurementRecords';
import type { LedgerRow } from '@/src/lib/db/procurementLedger';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import type { ProcurementInvoiceRow } from '@/src/lib/db/procurementLifecycle';
import { formatCurrency } from '@/src/lib/format';

// ---------------------------------------------------------------------------
// Date formatting (UTC-safe — consistent with RecordCard's formatDate)
// ---------------------------------------------------------------------------

function formatBusinessDate(iso: string): string {
  // iso can be either a date string (YYYY-MM-DD) or a full datetime
  const datePart = iso.slice(0, 10);
  const [y, m, d] = datePart.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

// ---------------------------------------------------------------------------
// Filter chip types
// ---------------------------------------------------------------------------

type LedgerFilter = 'all' | 'financial' | 'has-file';

interface FilterChipDef {
  value: LedgerFilter;
  label: string;
}

const FILTER_CHIPS: FilterChipDef[] = [
  { value: 'all', label: 'All' },
  { value: 'financial', label: 'Financial' },
  { value: 'has-file', label: 'Has file' },
];

// ---------------------------------------------------------------------------
// Static column definitions (all except File — that one needs canWrite context)
// ---------------------------------------------------------------------------

const STATIC_COLUMNS: Column<LedgerRow>[] = [
  {
    key: 'date',
    header: 'Date',
    cell: (row) => (
      <span className="text-[13px] text-muted-foreground">
        {formatBusinessDate(row.date)}
      </span>
    ),
  },
  {
    key: 'type',
    header: 'Type',
    cell: (row) => (
      <StatusPill variant="neutral">
        {row.type}
      </StatusPill>
    ),
  },
  {
    key: 'systemNumber',
    header: 'System #',
    cell: (row) =>
      row.systemNumber ? (
        <span className="font-mono text-[12.5px] font-semibold">{row.systemNumber}</span>
      ) : (
        <span className="text-[12px] text-muted-foreground">—</span>
      ),
  },
  {
    key: 'externalRef',
    header: 'External ref',
    cell: (row) =>
      row.externalRef ? (
        <span className="font-mono text-[12.5px] text-muted-foreground">{row.externalRef}</span>
      ) : (
        <span className="text-[12px] text-muted-foreground">—</span>
      ),
  },
  {
    key: 'amount',
    header: 'Amount',
    align: 'num',
    cell: (row) =>
      row.amount != null ? (
        <span className="tabular-nums">{formatCurrency(row.amount)}</span>
      ) : (
        <span className="text-[12px] text-muted-foreground">—</span>
      ),
  },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => (
      <StatusPill variant={row.statusVariant}>{row.status}</StatusPill>
    ),
  },
];

// ---------------------------------------------------------------------------
// Filtered-empty labels per chip
// ---------------------------------------------------------------------------

const FILTERED_EMPTY_TITLE: Record<LedgerFilter, string> = {
  all: 'No records captured yet',
  financial: 'No Financial records',
  'has-file': 'No records with a file',
};

const FILTERED_EMPTY_SUB: Record<LedgerFilter, string> = {
  all: 'Capture the first record for this case below.',
  financial: 'Clear the filter to see all records.',
  'has-file': 'Clear the filter to see all records.',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ProcurementLedgerProps {
  /** The already-loaded procurement detail (for status + stage-gating). */
  detail: ProcurementDetail;
  /** Pre-built ledger rows from buildLedgerRows(detail). */
  rows: LedgerRow[];
  /** The procurement ID (for file subsection + query invalidation). */
  procurementId: string;
  /** Current user's ID (stamped onto file rows). */
  uploadedById: string | null;
  /** Whether write affordances are shown. Derived from real JWT role. */
  canWrite: boolean;
  /** Invoice rows for the payment predecessor-FK dropdown ([PD-5]). */
  invoices?: ProcurementInvoiceRow[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ProcurementLedger: React.FC<ProcurementLedgerProps> = ({
  detail,
  rows,
  procurementId,
  uploadedById,
  canWrite,
  invoices = [],
}) => {
  const [filter, setFilter] = useState<LedgerFilter>('all');

  // Mutations for the capture row (invalidate the detail query on success)
  const mutations = useProcurementRecordMutations(procurementId);

  // Build the File column with the context it needs (canWrite, procurementId, etc.).
  // useMemo: stable identity when context props don't change — avoids DataTable re-renders.
  const fileColumn = useMemo<Column<LedgerRow>>(
    () => ({
      key: 'file',
      header: 'File',
      cell: (row) => (
        <LedgerFileCell
          type={row.type}
          recordId={row.recordId}
          systemNumber={row.systemNumber}
          fileHref={row.fileHref}
          fileTitle={row.fileTitle}
          fileCount={row.fileCount}
          canWrite={canWrite}
          procurementId={procurementId}
          uploadedById={uploadedById}
        />
      ),
    }),
    [canWrite, procurementId, uploadedById],
  );

  const columns = useMemo<Column<LedgerRow>[]>(
    () => [...STATIC_COLUMNS, fileColumn],
    [fileColumn],
  );

  // Apply the active filter
  const filteredRows = rows.filter((row) => {
    if (filter === 'financial') return row.financial;
    if (filter === 'has-file') return row.fileHref !== null;
    return true;
  });

  // Determine DataTable state
  const tableState = filteredRows.length === 0 ? 'empty' : undefined;
  const isFiltered = filter !== 'all';
  const emptyTitle = isFiltered
    ? FILTERED_EMPTY_TITLE[filter]
    : FILTERED_EMPTY_TITLE.all;
  const emptySub = isFiltered ? FILTERED_EMPTY_SUB[filter] : FILTERED_EMPTY_SUB.all;

  // Handle capture onCreate dispatching to the right mutation
  const handleCreate = async (kind: RecordKind, input: unknown) => {
    switch (kind) {
      case 'purchase_request':
        await mutations.createPurchaseRequest.mutateAsync(
          input as Parameters<typeof mutations.createPurchaseRequest.mutateAsync>[0],
        );
        break;
      case 'rfq':
        await mutations.createRfq.mutateAsync(
          input as Parameters<typeof mutations.createRfq.mutateAsync>[0],
        );
        break;
      case 'purchase_order':
        await mutations.createPurchaseOrder.mutateAsync(
          input as Parameters<typeof mutations.createPurchaseOrder.mutateAsync>[0],
        );
        break;
      case 'payment':
        await mutations.createPayment.mutateAsync(
          input as Parameters<typeof mutations.createPayment.mutateAsync>[0],
        );
        break;
    }
  };

  const captureBusy =
    mutations.createPurchaseRequest.isPending ||
    mutations.createRfq.isPending ||
    mutations.createPurchaseOrder.isPending ||
    mutations.createPayment.isPending;

  return (
    <div data-testid="procurement-ledger">
      {/* Toolbar: card-head + filter chips */}
      <div className="mb-0 flex flex-wrap items-center justify-between gap-3 rounded-t-lg border border-b-0 border-border bg-card px-4 py-3">
        <span className="text-[13px] font-semibold">Case ledger</span>
        {/* Filter chips — DESIGN.md §6: seg-style 28px, rounded-full, aria-pressed */}
        <div
          role="group"
          aria-label="Filter records"
          className="flex flex-wrap gap-1.5"
        >
          {FILTER_CHIPS.map((chip) => {
            const active = filter === chip.value;
            return (
              <button
                key={chip.value}
                type="button"
                role="button"
                aria-pressed={active}
                onClick={() => setFilter(chip.value)}
                className={[
                  'inline-flex h-7 items-center rounded-full border px-[10px] text-[12px] font-medium transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  active
                    ? 'border-primary/30 bg-primary/10 text-[hsl(var(--nav-active-text))]'
                    : 'border-input bg-background text-muted-foreground hover:text-foreground',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* DataTable — reuses the shared primitive with md→card mobile reflow */}
      <DataTable<LedgerRow>
        rows={filteredRows}
        columns={columns}
        rowKey={(row) => row.id}
        state={tableState}
        emptyTitle={emptyTitle}
        emptySub={emptySub}
        className="rounded-t-none"
      />

      {/* Capture affordance + note */}
      <CardPad>
        <LedgerCaptureRow
          status={detail.status}
          canWrite={canWrite}
          invoices={invoices}
          busy={captureBusy}
          onCreate={handleCreate}
        />
        <p className="mt-3 text-[11px] text-muted-foreground">
          Every record appears once, chronological. Empty record types have no row.
        </p>
      </CardPad>
    </div>
  );
};

ProcurementLedger.displayName = 'ProcurementLedger';
