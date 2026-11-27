import { useMaySeePrices } from '@/src/hooks/useHidePrices';
/**
 * ProcurementLedger — the Documents tab case ledger (Slice 2).
 *
 * One chronological DataTable for all 7 procurement record types:
 *   Date · Type · System # · External ref · Group ref · e-Faktur · Amount · Status · File
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
 * with aria-pressed; status pills are dot+label (never color-only); record-id reference lines.
 *
 * File column: zero per-row network calls on mount. File presence (fileTitle /
 * fileCount / fileHref) is pre-built from the bundle by buildLedgerRows. The cell
 * signs the URL lazily on click (try/catch — non-fatal) and shows an upload
 * affordance for canWrite rows with no file.
 */
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button,
  DataTable,
  ReasonDialog,
  RecordSection,
  StatusPill,
  TaxBasisLabel,
} from '@/src/components/ui';
import type { Column, RowMenuItem } from '@/src/components/ui';
import { EfakturModal, type EfakturSaveValues } from '@/src/components/EfakturModal';
import { EfakturCell } from '@/src/components/EfakturCell';
import { LedgerCaptureRow } from './LedgerCaptureRow';
import type { CreatePOInput, CreatePRInput } from './RecordCaptureForm';
import { purchaseAttribution } from './purchaseAttribution';
import { workOrderCostRepository } from '@/src/lib/repositories/workOrderCosts';
import { LedgerFileCell } from './LedgerFileCell';
import { WithholdingBreakdown } from './WithholdingBreakdown';
import { OdooOutcome } from '@/src/components/procurement/OdooOutcome';
import { odooOutcome } from '@/src/lib/procurement/odooOutcome';
import type { RecordKind, StagedRecord } from './RecordCaptureForm';
import type { TFunction } from 'i18next';
import type { ProcurementGates } from '@/src/lib/db/orgs';
import { useProcurementRecordMutations } from '@/src/hooks/useProcurementRecords';
import { useSubcontractMutations } from '@/src/hooks/useSubcontract';
import { usePermission } from '@/src/auth/usePermission';
import type { LedgerRow } from '@/src/lib/db/procurementLedger';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import type { ProcurementInvoiceRow } from '@/src/lib/db/procurementLifecycle';
import { formatCurrency, formatDay } from '@/src/lib/format';
import { withholdingFigures } from '@/src/lib/vendorWithholding';
import { TaskPushBadge } from '@/src/components/tasks/TaskPushBadge';
import { IDLE_PENDING_PUSH } from '@/src/lib/adapterSeam/pendingPush';
import { useVendorWithholdingCoverage } from '@/src/hooks/useVendorWithholdingSlips';
import { VendorWithholdingSlipCell } from './VendorWithholdingSlipCell';
import { VendorInvoiceIdentity } from '@/src/components/procurement/VendorInvoiceIdentity';
import { voidBillErrorText } from './subcontractBillError';
import { BillMatchDrawer } from './BillMatchDrawer';
import { MatchLinesEditor } from './MatchLinesEditor';
import { useBillMatches, useThreeWayMatchOn } from '@/src/hooks/useThreeWayMatch';
import type { VendorInvoiceContext } from '@/src/components/procurement/vendorInvoiceIdentityLabels';
import { recordStatusLabel } from '@/src/lib/procurement/recordStatusLabel';
import { usePurchaseOrderSettings } from '@/src/hooks/usePurchaseOrderSettings';

// ---------------------------------------------------------------------------
// Date formatting — a ledger row's date is a BUSINESS DATE: its calendar day never moves with the
// viewer's timezone (#684, FR-PLC-006).
// ---------------------------------------------------------------------------

function formatBusinessDate(iso: string): string {
  // iso can be either a date string (YYYY-MM-DD) or a full datetime; the date part is the value.
  return formatDay(iso.slice(0, 10));
}

// ---------------------------------------------------------------------------
// Filter chip types
// ---------------------------------------------------------------------------

type LedgerFilter = 'all' | 'financial' | 'has-file';

interface FilterChipDef {
  value: LedgerFilter;
}

const FILTER_CHIPS: FilterChipDef[] = [
  { value: 'all' },
  { value: 'financial' },
  { value: 'has-file' },
];
const LedgerHeader: React.FC<{ translationKey: string; fallback: string }> = ({ translationKey, fallback }) => {
  const { t } = useTranslation();
  const value = translationKey === 'procurementLedger.date' ? t('procurementLedger.date', 'Date')
    : translationKey === 'procurementLedger.typeHeader' ? t('procurementLedger.typeHeader', 'Type')
      : translationKey === 'procurementLedger.systemNumber' ? t('procurementLedger.systemNumber', 'System #')
        : translationKey === 'procurementLedger.externalRef' ? t('procurementLedger.externalRef', 'External ref')
          : translationKey === 'procurementLedger.amount' ? t('procurementLedger.amount', 'Amount')
            : translationKey === 'procurementLedger.status' ? t('procurementLedger.status', 'Status')
              : t('procurementLedger.file', 'File');
  return <>{value || fallback}</>;
};
const LedgerTypeLabel: React.FC<{ type: LedgerRow['type'] }> = ({ type }) => {
  const { t } = useTranslation();
  const label = type === 'PR' ? t('procurementLedger.types.purchaseRequest', 'Purchase Request')
    : type === 'PO' ? t('procurementLedger.types.purchaseOrder', 'Purchase Order')
      : type === 'Quote' ? t('procurement:progression.quote', 'Quote')
      : type === 'Payment' ? t('procurementLedger.types.payment', 'Payment') : type;
  return <>{label}</>;
};

// ---------------------------------------------------------------------------
// Static column definitions (all except File — that one needs canWrite context)
// ---------------------------------------------------------------------------

/** Column header via t() — STATIC_COLUMNS is module-level (no hook), so the one translated header is a tiny component. */
const GroupRefHeader: React.FC = () => {
  const { t } = useTranslation();
  return <>{t('procurementDetail.groupRef.label', 'Group ref')}</>;
};
const EfakturHeader: React.FC = () => {
  const { t } = useTranslation();
  return <>{t('efaktur.column', 'e-Faktur')}</>;
};

/** The record's stored status in the reader's language; the stored value is never translated. */
const RecordStatusPill: React.FC<{ row: LedgerRow }> = ({ row }) => {
  const { t } = useTranslation('procurementRecord');
  return <StatusPill variant={row.statusVariant}>{recordStatusLabel(t, row.status)}</StatusPill>;
};

/** #1505 P8: the record's own status, then what Odoo last said about it and, for a receipt, the quantity Odoo booked (FR-OPP-034/090). */
const OdooRowStatus: React.FC<{ row: LedgerRow }> = ({ row }) => {
  const { t } = useTranslation(['common', 'procurement']);
  const facts = row.odoo!;
  const outcome = odooOutcome({ erpState: facts.erpState, erpAttention: facts.erpAttention, erpReadAt: facts.erpReadAt });
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <RecordStatusPill row={row} />
      {outcome && <OdooOutcome outcome={outcome} quiet />}
      {facts.paymentView === 'awaiting-odoo' && <span data-testid="odoo-payment-awaiting" className="text-sm text-muted-foreground">{t('procurement:odoo.paymentAwaiting', 'Payment sent, awaiting Odoo')}</span>}
      {facts.booked !== null && (
        <span data-testid="odoo-quantities" className="text-sm text-muted-foreground tabular-nums">
          {t('procurement:odoo.booked', 'Received in Odoo: {{qty}}', { qty: facts.booked })}
          {facts.entered !== null && facts.entered !== facts.booked ? ` · ${t('procurement:odoo.entered', 'entered {{qty}}', { qty: facts.entered })}` : ''}
        </span>
      )}
    </div>
  );
};

const STATIC_COLUMNS: Column<LedgerRow>[] = [
  {
    key: 'date',
    size: 76,
    // First column: its text starts on the panel inset (the other columns keep 16px between them).
    colClassName: 'md:pl-[var(--panel-inset)]',
    header: <LedgerHeader translationKey="procurementLedger.date" fallback="Date" />,
    cell: (row) => (
      <span className="whitespace-nowrap text-sm text-muted-foreground">
        {formatBusinessDate(row.date)}
      </span>
    ),
  },
  {
    key: 'type',
    size: 96,
    colClassName: 'hidden xl:table-cell',
    header: <LedgerHeader translationKey="procurementLedger.typeHeader" fallback="Type" />,
    cell: (row) => (
      <StatusPill variant="neutral">
        <LedgerTypeLabel type={row.type} />
      </StatusPill>
    ),
  },
  {
    key: 'systemNumber',
    size: 112,
    header: <LedgerHeader translationKey="procurementLedger.systemNumber" fallback="System #" />,
    cell: (row) => (
      <div className="flex flex-col items-start gap-0.5">
        {row.systemNumber ? (
          <span className="record-id font-semibold text-foreground">{row.systemNumber}</span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
        <span className="text-sm font-normal text-muted-foreground xl:hidden">
          <LedgerTypeLabel type={row.type} />
        </span>
      </div>
    ),
  },
  {
    key: 'externalRef',
    size: 120,
    header: <LedgerHeader translationKey="procurementLedger.externalRef" fallback="External ref" />,
    cell: (row) =>
      // The bare marker lets the table drop the column when no record carries one (screen rules: no all-blank column).
      row.externalRef ? <span className="record-id">{row.externalRef}</span> : '—',
  },
  {
    key: 'groupRef',
    size: 96,
    header: <GroupRefHeader />,
    cell: (row) =>
      // The bare marker lets the table drop the column when no record carries one (screen rules: no all-blank column).
      row.groupRef ? <span className="record-id">{row.groupRef}</span> : '—',
  },
  {
    // One cell for the pair (number over a muted date): two columns pushed the row ⋯ off the 1440 view.
    // Omit when empty so DataTable drops the all-blank column.
    key: 'efaktur',
    size: 92,
    header: <EfakturHeader />,
    cell: (row) => row.type === 'Invoice'
      ? <EfakturCell number={row.efakturNumber ?? null} date={row.efakturDate ?? null} />
      : null,
  },
  {
    key: 'status',
    size: 108,
    header: <LedgerHeader translationKey="procurementLedger.status" fallback="Status" />,
    cell: (row) => (row.voided ? <VoidedBillStatus voided={row.voided} />
      : row.odoo ? <OdooRowStatus row={row} /> : <RecordStatusPill row={row} />),
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

/** The empty ledger says what to do for THIS status, not a generic "capture the first record below". */
function ledgerEmptyCopy(status: string, canApprove: boolean, t: TFunction): { title: string; sub: string } | null {
  const title = t('procurement:ledger.emptyTitle', 'No documents yet');
  if (status === 'Requested') {
    return { title, sub: canApprove
      ? t('procurement:ledger.approveToStart', 'Approve to start recording documents.')
      : t('procurement:ledger.waitingApproval', 'Waiting for approval.') };
  }
  if (status === 'Draft') return { title, sub: t('procurement:ledger.recordFirst', 'Record the first document below.') };
  if (status === 'Paid' || status === 'Cancelled' || status === 'Rejected') {
    return { title, sub: t('procurement:ledger.nothingRecorded', 'Nothing was recorded for this purchase.') };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** #1671: a voided vendor bill keeps its row; the status says so, with why, who and when beneath. */
const VoidedBillStatus: React.FC<{ voided: NonNullable<LedgerRow['voided']> }> = ({ voided }) => {
  const { t } = useTranslation(['common', 'procurement']);
  return (
    <div className="inline-flex flex-col items-start gap-1" data-testid="ledger-voided-bill">
      <StatusPill variant="lost">{t('procurement:voidBill.voided', 'Voided')}</StatusPill>
      <span className="text-sm text-muted-foreground">{voided.reason}</span>
      <span className="text-sm text-muted-foreground">
        {voided.byName
          ? t('procurement:voidBill.byOn', '{{name}} · {{date}}', { name: voided.byName, date: formatDay(voided.at) })
          : formatDay(voided.at)}
      </span>
    </div>
  );
};

/**
 * #1671: the void confirm for one bill. Mounted only while open, so the ledger takes on no mutation of its own;
 * void_subcontract_bill owns role, author separation and the cap, and the hook refreshes the purchase and its PO.
 */
const VoidBillDialog: React.FC<{ row: LedgerRow; poId: string; procurementId: string; onClose: () => void }> = ({
  row, poId, procurementId, onClose,
}) => {
  const { t } = useTranslation(['common', 'procurement']);
  const { voidBill } = useSubcontractMutations(poId, procurementId);
  const [error, setError] = useState<string | null>(null);
  return (
    <ReasonDialog
      open
      kind="reject"
      title={t('procurement:voidBill.title', 'Void this bill?')}
      label={t('procurement:voidBill.reason', 'Why is this bill being voided?')}
      helper={t('procurement:voidBill.helper', 'Kept with the bill and its history.')}
      confirmLabel={t('procurement:voidBill.confirm', 'Void bill')}
      context={(
        <p className="text-sm text-muted-foreground">
          {t('procurement:voidBill.context', '{{number}} stays on the ledger as voided and stops counting against the PO, so the corrected bill can be captured.', { number: row.systemNumber ?? '' })}
        </p>
      )}
      maxLength={1000}
      loading={voidBill.isPending}
      error={error ?? undefined}
      onCancel={onClose}
      onConfirm={async (reason) => {
        setError(null);
        try {
          await voidBill.mutateAsync({ invoiceId: row.recordId, reason });
          onClose();
        } catch (err) {
          setError(voidBillErrorText(err, t));
        }
      }}
    />
  );
};

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
  /** Admin/Finance may edit PMO-owned e-Faktur facts on non-cancelled vendor invoices. */
  canRecordEfaktur?: boolean;
  /** PMO-only setter; the parent hook owns the query invalidation. */
  onSetEfaktur?: (invoiceId: string, values: EfakturSaveValues) => Promise<void>;
  /** Whether the setter is currently pending. */
  efakturSaving?: boolean;
  /** #1671: the viewer may void a mistyped PMO-native subcontract bill (Admin/Finance, no ERP). UX only. */
  canVoidBill?: boolean;
  /** Invoice rows for the payment predecessor-FK dropdown ([PD-5]). */
  invoices?: ProcurementInvoiceRow[];
  canWriteWithholdingSlip?: boolean;
  onRecordWithholdingSlip?: (invoice: ProcurementInvoiceRow) => void;
  vendorMissing?: boolean;
  onSetVendor?: () => void;
  onViewWithholdingSlip?: (slipId: string) => void;
  onWithholdingHistory?: (invoiceId: string) => void;
  /** Invoice to scroll to after opening this case from a withholding slip detail. */
  targetInvoiceId?: string;
  /** Current user is the case approver; server SoD prevents them from paying an ERP-owned case. */
  isApprover?: boolean;
  /** FR-PFE-001: the kinds the viewer's role may record as the first document of an empty Draft. */
  firstDocumentKinds?: RecordKind[];
  /** One-shot arrival handoff from intake; uses the same Draft first-document capture row. */
  autoOpenFirstDocument?: RecordKind | null;
  onAutoOpenFirstDocumentConsumed?: () => void;
  /** The viewer may approve this purchase (worded into the Requested empty state). */
  canApprove?: boolean;
  /** Goods receipt / vendor invoice stage a confirm-before-commit on the page instead of writing here. */
  onStageRecord?: (staged: StagedRecord) => void;
  /** #876: forwarded to the vendor-invoice capture's tax pre-fill. */
  vendorId?: string | null;
  itemsNet?: number | null;
  /** The org's purchase rules, to hold back first-document choices they forbid. */
  gates?: ProcurementGates;
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
  canRecordEfaktur = false,
  onSetEfaktur,
  efakturSaving = false,
  canVoidBill = false,
  invoices = [],
  canWriteWithholdingSlip = false,
  onRecordWithholdingSlip,
  vendorMissing = false,
  onSetVendor,
  onViewWithholdingSlip,
  onWithholdingHistory,
  targetInvoiceId,
  isApprover = false,
  firstDocumentKinds,
  autoOpenFirstDocument,
  onAutoOpenFirstDocumentConsumed,
  canApprove = false,
  onStageRecord,
  vendorId: invoiceVendorId,
  itemsNet,
  gates,
}) => {
  const navigate = useNavigate();
  const poSettingsQuery = usePurchaseOrderSettings();
  const poPrintEnabled = poSettingsQuery.data?.enabled ?? false;
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [efakturTarget, setEfakturTarget] = useState<LedgerRow | null>(null);
  const [voidTarget, setVoidTarget] = useState<LedgerRow | null>(null);
  const focusedInvoiceTarget = useRef<HTMLElement | null>(null);
  const { t } = useTranslation(['common', 'procurement']);
  const maySeePrices = useMaySeePrices();
  const may = usePermission();
  // Migration 0350: a role that reads no vendor bills or payments must not read their absence as "none exist".
  // Said once, only where a bill is expected (the case has reached Vendor Invoiced).
  const billsHiddenForRole = !may('view', 'procurementInvoice')
    && (detail.status === 'Vendor Invoiced' || detail.status === 'Paid');
  const invoiceIdentityContext = useMemo<VendorInvoiceContext>(() => ({
    state: 'ready',
    caseTitle: detail.title,
    projectState: detail.project_id ? (detail.project ? 'ready' : 'unavailable') : 'ready',
    projectName: detail.project?.name,
    pmoProjectNumber: detail.project?.pmo_project_number,
  }), [detail.project, detail.project_id, detail.title]);
  // The slip coverage IS the coverage query: the ledger consumes the hook directly and derives
  // the map and retry from it (the hook keeps its query disabled while there are no invoices).
  const coverageQuery = useVendorWithholdingCoverage(invoices.map((invoice) => invoice.id));
  // #2622: with the organisation's three-way match on, each live bill's match is read (the database decides scope and
  // reports a bill outside it as not_applicable); a held bill is named in the ledger foot and its match opens a drawer.
  const canViewMatch = may('view', 'billMatch');
  const matchOn = useThreeWayMatchOn(canViewMatch).on;
  const matchedBills = useMemo(() => invoices.filter((invoice) => !invoice.voided_at), [invoices]);
  const billMatches = useBillMatches(matchedBills.map((invoice) => invoice.id), canViewMatch && matchOn);
  const heldBills = matchedBills.filter((_, i) => billMatches[i]?.data?.status === 'held');
  const [matchFor, setMatchFor] = useState<{ id: string; label: string } | null>(null);
  // #2634: the receipt-lines and bill-lines editors (mounted only when opened). The database decides who may write and
  // which bills and purchases are still editable; this only offers the editor where a person could use it.
  const [linesFor, setLinesFor] = useState<{ kind: 'receipt' | 'bill'; id: string; label: string } | null>(null);
  const canEditLines = may('edit', 'billMatch') && matchOn;
  const purchaseOpen = detail.status !== 'Paid' && detail.status !== 'Cancelled';
  const billLinesEditable = (invoice: ProcurementInvoiceRow | undefined, index: number) => {
    const status = billMatches[index]?.data?.status;
    return canEditLines && !!invoice && !invoice.voided_at && invoice.status !== 'Paid' && (status === 'held' || status === 'matched');
  };
  const billLabel = (invoice: Pick<ProcurementInvoiceRow, 'vi_number' | 'reference_number'>) => invoice.vi_number ?? invoice.reference_number ?? t('procurement:threeWayMatch.menu', 'Three-way match');
  const withholdingCoverage = useMemo(
    () => Object.fromEntries((coverageQuery.data ?? []).map((row) => [row.invoice_id, row])),
    [coverageQuery.data],
  );
  const filterLabels: Record<LedgerFilter, string> = {
    all: t('procurementLedger.filter.all', 'All'),
    financial: t('procurementLedger.filter.financial', 'Financial'),
    'has-file': t('procurementLedger.filter.hasFile', 'Has file'),
  };

  // Mutations for the capture row (invalidate the detail query on success)
  const mutations = useProcurementRecordMutations(procurementId);

  // Build the File column with the context it needs (canWrite, procurementId, etc.).
  // useMemo: stable identity when context props don't change — avoids DataTable re-renders.
  const fileColumn = useMemo<Column<LedgerRow>>(
    () => ({
      key: 'file',
      size: 84,
      header: <LedgerHeader translationKey="procurementLedger.file" fallback="File" />,
      cell: (row) => (
        <LedgerFileCell
          type={row.type}
          recordId={row.recordId}
          systemNumber={row.systemNumber}
          fileHref={row.fileHref}
          fileTitle={row.fileTitle}
          fileCount={row.fileCount}
          fileRef={row.fileRef}
          canWrite={canWrite}
          procurementId={procurementId}
          uploadedById={uploadedById}
        />
      ),
    }),
    [canWrite, procurementId, uploadedById],
  );

  const amountColumn = useMemo<Column<LedgerRow>>(() => ({
    key: 'amount', size: 136, header: <LedgerHeader translationKey="procurementLedger.amount" fallback="Amount" />, align: 'num',
    cell: (row) => {
      if (!maySeePrices) return <span className="text-muted-foreground">—</span>;
      if (row.amount == null && row.valueFromLines !== undefined) {
        return <span className="inline-flex flex-col items-end"><span className="whitespace-nowrap tabular-nums" data-testid="receipt-value">{formatCurrency(row.valueFromLines, row.currency)}</span><span className="text-xs text-muted-foreground">{t('procurement:ledger.valueFromLines', 'From the order lines')}</span></span>;
      }
      if (row.amount == null && row.valueUnknown) return <span className="text-sm text-muted-foreground" data-testid="receipt-value-unknown">{t('procurement:ledger.valueNotRecorded', 'Value not recorded for this receipt')}</span>;
      if (row.amount == null) return <span className="text-sm text-muted-foreground">—</span>;
      // The amount answers "how much": the figure, with its tax basis under it on the same right edge.
      return <span className="inline-flex min-w-0 max-w-full flex-col items-end gap-0.5 text-right max-sm:items-start max-sm:text-left"><span className="whitespace-nowrap tabular-nums">{formatCurrency(row.amount, row.currency)}</span><TaxBasisLabel treatment={row.taxTreatment} taxBaseUnknown={row.taxBaseUnknown} taxRate={row.taxRate} taxBaseNumerator={row.taxBaseNumerator} taxBaseDenominator={row.taxBaseDenominator} /></span>;
    },
  }), [t, maySeePrices]);

  // A bill's withholding answers its own question (what is withheld, what the supplier nets, is the slip on file) in its
  // own column, so the amount cell carries one figure. Only bills fill it; with no bill the column is not drawn.
  const withholdingColumn = useMemo<Column<LedgerRow>>(() => ({
    key: 'withholding', size: 128, header: t('procurement:ledger.withholding', 'Withholding'),
    cell: (row) => {
      if (row.type !== 'Invoice' || row.amount == null) return null;
      const figures = withholdingFigures(row.amount, row.taxAmount, row.withheldAmount, row.taxTreatment);
      const invoice = invoices.find((item) => item.id === row.recordId);
      const slipCell = <VendorWithholdingSlipCell row={withholdingCoverage[row.recordId]} isLoading={coverageQuery.isLoading} isError={coverageQuery.isError} canWrite={canWriteWithholdingSlip} onRetry={() => void coverageQuery.refetch()} onRecord={() => invoice && onRecordWithholdingSlip?.(invoice)} vendorMissing={vendorMissing} onSetVendor={onSetVendor} onView={onViewWithholdingSlip} onHistory={() => onWithholdingHistory?.(row.recordId)} />;
      return <div className="flex w-full flex-col items-start gap-1 text-left">{figures && <WithholdingBreakdown figures={figures} currency={row.currency} />}{slipCell}</div>;
    },
  }), [t, canWriteWithholdingSlip, coverageQuery, invoices, onRecordWithholdingSlip, onSetVendor, onViewWithholdingSlip, onWithholdingHistory, withholdingCoverage, vendorMissing]);

  const columns = useMemo<Column<LedgerRow>[]>(
    () => [...STATIC_COLUMNS.slice(0, 6).map((column) => column.key === 'efaktur' && !rows.some((row) => row.efakturNumber || row.efakturDate) ? { ...column, colClassName: 'hidden' } : column), amountColumn, withholdingColumn, ...STATIC_COLUMNS.slice(6), fileColumn],
    [amountColumn, withholdingColumn, fileColumn, rows],
  );

  // The set of record types already present in the ledger — drives the capture
  // row's data-driven gating so it never offers a kind that already exists
  // (the over-prompt fix). Derived from the full row set, not the filtered view.
  const existingTypes = useMemo(
    () => new Set(rows.map((row) => row.type)),
    [rows],
  );

  // Apply the active filter
  const filteredRows = rows.filter((row) => {
    if (filter === 'financial') return row.financial;
    if (filter === 'has-file') return row.fileHref !== null;
    return true;
  });

  useLayoutEffect(() => {
    if (!targetInvoiceId) {
      focusedInvoiceTarget.current = null;
      return;
    }
    if (!filteredRows.some((row) => row.type === 'Invoice' && row.recordId === targetInvoiceId)) return;
    const target = document.getElementById(`invoice-${targetInvoiceId}`);
    if (!target || target === focusedInvoiceTarget.current) return;
    target.scrollIntoView({ block: 'nearest' });
    target.focus({ preventScroll: true });
    focusedInvoiceTarget.current = target;
  }, [targetInvoiceId, filteredRows]);

  // Determine DataTable state
  const tableState = filteredRows.length === 0 ? 'empty' : undefined;
  const isFiltered = filter !== 'all';
  const emptyCopy = ledgerEmptyCopy(detail.status, canApprove, t);
  const emptyTitle = isFiltered ? FILTERED_EMPTY_TITLE[filter] : (emptyCopy?.title ?? FILTERED_EMPTY_TITLE.all);
  const emptySub = isFiltered ? FILTERED_EMPTY_SUB[filter] : (emptyCopy ? emptyCopy.sub : FILTERED_EMPTY_SUB.all);

  // Handle capture onCreate dispatching to the right mutation
  const handleCreate = async (kind: RecordKind, input: unknown) => {
    switch (kind) {
      case 'purchase_request': {
        const row = await mutations.createPurchaseRequest.mutateAsync(
          input as Parameters<typeof mutations.createPurchaseRequest.mutateAsync>[0],
        );
        // #2517: the work order / discipline goes on right after the record exists (a refusal says "saved, but…").
        await workOrderCostRepository.attributeOrRefuse('purchase_request', row, (input as CreatePRInput).attribution);
        break;
      }
      case 'rfq':
        await mutations.createRfq.mutateAsync(
          input as Parameters<typeof mutations.createRfq.mutateAsync>[0],
        );
        break;
      case 'purchase_order': {
        const row = await mutations.createPurchaseOrder.mutateAsync(
          input as Parameters<typeof mutations.createPurchaseOrder.mutateAsync>[0],
        );
        await workOrderCostRepository.attributeOrRefuse('purchase_order', row, (input as CreatePOInput).attribution);
        break;
      }
      case 'payment':
        await mutations.createPayment.mutateAsync(
          input as Parameters<typeof mutations.createPayment.mutateAsync>[0],
        );
        break;
      default:
        // Goods receipt and vendor invoice are written through the page's confirm (`onStageRecord`), never here.
        // Throwing keeps the form from ever reporting "recorded" for a kind that wrote nothing.
        throw new Error(`No ledger writer for ${kind}`);
    }
  };

  const captureBusy =
    mutations.createPurchaseRequest.isPending ||
    mutations.createRfq.isPending ||
    mutations.createPurchaseOrder.isPending ||
    mutations.createPayment.isPending;

  // Discover CRITICAL 1 (task FIX-1): surfaces the record-creation write's pending-push state
  // (idle for PMO-owned orgs; existing hook mocks predate this field, hence the fallback).
  const pendingPush = mutations.pendingPush ?? IDLE_PENDING_PUSH;

  return (
    // One panel: the heading with its filter on the right, the table flush, the capture row and notes at its foot,
    // all on the panel inset (the record's one left edge).
    <RecordSection
      data-testid="procurement-ledger"
      title={t('procurementLedger.title', 'Case documents')}
      flush
      actions={
        /* Filter chips — DESIGN.md §6: seg-style 28px, rounded-full, aria-pressed */
        <div
          data-actions-wide
          role="group"
          aria-label={t('procurementLedger.filter.label', 'Filter records')}
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
                  'inline-flex h-7 items-center rounded-full border px-[10px] text-sm font-medium transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  active
                    ? 'border-primary/30 bg-primary/10 text-[hsl(var(--nav-active-text))]'
                    : 'border-input bg-background text-muted-foreground hover:text-foreground',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {filterLabels[chip.value]}
              </button>
            );
          })}
        </div>
      }
    >
      {/* DataTable — reuses the shared primitive with md→card mobile reflow. 16px between columns so the
          headers stay on one line at 1440; the first column carries the panel inset (its colClassName). */}
      <div className="[--table-cell-inset:var(--space-content-inset)]">
      <DataTable<LedgerRow>
        embedded
        rows={filteredRows}
        columns={columns}
        rowKey={(row) => row.id}
        rowTarget={(row) => row.type === 'Invoice' && row.recordId === targetInvoiceId ? `invoice-${row.recordId}` : undefined}
        rowMenu={(row): RowMenuItem[] | undefined => {
          if (row.type === 'GR') {
            if (!canEditLines || !purchaseOpen || detail.is_subcontract) return undefined;
            return [{ label: t('procurement:threeWayMatch.lines.receiptAction', 'Record received quantities'), onClick: () => setLinesFor({ kind: 'receipt', id: row.recordId, label: row.systemNumber ?? t('procurement:threeWayMatch.lines.receiptFallback', 'Goods receipt') }) }];
          }
          const items: RowMenuItem[] = [];
          if (row.type === 'PO' && poPrintEnabled) {
            items.push({
              label: t('procurement:purchaseOrderPrint.printAction', 'Print purchase order'),
              onClick: () => navigate(`/procurement/${procurementId}/purchase-orders/${row.recordId}/print`),
            });
          }
          if (row.type === 'Invoice') {
            if (canRecordEfaktur && onSetEfaktur && !row.efakturLocked) items.push({ label: t('efaktur.record', 'Record e-Faktur'), onClick: () => setEfakturTarget(row) });
            if (canVoidBill && row.voidable) items.push({ label: t('procurement:voidBill.action', 'Void bill'), onClick: () => setVoidTarget(row) });
            const coverage = withholdingCoverage[row.recordId];
            const invoice = invoices.find((item) => item.id === row.recordId);
            if (coverage?.active_slip_id) items.push({ label: t('bupot.view', 'View bukti potong'), onClick: () => onViewWithholdingSlip?.(coverage.active_slip_id!) });
            else if (coverage?.coverage_state === 'not-recorded' && invoice && vendorMissing && onSetVendor) items.push({ label: t('bupot.setVendor', 'Set supplier'), onClick: onSetVendor });
            else if (canWriteWithholdingSlip && coverage?.coverage_state === 'not-recorded' && invoice && !vendorMissing) items.push({ label: t('bupot.record', 'Record bukti potong'), onClick: () => onRecordWithholdingSlip?.(invoice) });
            items.push({ label: t('bupot.history', 'Bukti potong history'), onClick: () => onWithholdingHistory?.(row.recordId) });
            if (canViewMatch && matchOn && invoice && !invoice.voided_at) items.push({ label: t('procurement:threeWayMatch.menu', 'Three-way match'), onClick: () => setMatchFor({ id: invoice.id, label: billLabel(invoice) }) });
            if (invoice && billLinesEditable(invoice, matchedBills.indexOf(invoice))) items.push({ label: t('procurement:threeWayMatch.lines.billAction', 'Edit bill lines'), onClick: () => setLinesFor({ kind: 'bill', id: invoice.id, label: billLabel(invoice) }) });
          }
          return items.length ? items : undefined;
        }}
        state={tableState}
        emptyTitle={emptyTitle}
        emptySub={emptySub}
      tableId="procurement-procurementledger-table" />
      </div>

      {efakturTarget && onSetEfaktur && (
        <EfakturModal
          recordContext={(
            <VendorInvoiceIdentity
              referenceNumber={efakturTarget.externalRef}
              viNumber={efakturTarget.systemNumber}
              invoiceDate={efakturTarget.date.slice(0, 10)}
              context={invoiceIdentityContext}
            />
          )}
          number={efakturTarget.efakturNumber ?? null}
          date={efakturTarget.efakturDate ?? null}
          loading={efakturSaving}
          onClose={() => setEfakturTarget(null)}
          onSave={async (values) => {
            await onSetEfaktur(efakturTarget.recordId, values);
            setEfakturTarget(null);
          }}
        />
      )}

      {matchFor && <BillMatchDrawer invoiceId={matchFor.id} billLabel={matchFor.label} onClose={() => setMatchFor(null)} />}
      {linesFor && <MatchLinesEditor kind={linesFor.kind} targetId={linesFor.id} procurementId={procurementId} label={linesFor.label} onClose={() => setLinesFor(null)} />}

      {canVoidBill && voidTarget && (
        <VoidBillDialog
          row={voidTarget}
          poId={voidTarget.poId ?? ''}
          procurementId={procurementId}
          onClose={() => setVoidTarget(null)}
        />
      )}

      {/* Capture affordance + notes: the panel's foot, on the panel inset. */}
      <div className="border-t border-border px-[var(--panel-inset)] pb-[var(--panel-inset)] pt-4 [&>:first-child]:mt-0">
        {detail.pre_cutover && (
          // FR-ECA-030: ordered before the ERP connection, so receipts, bills and payments stay in PMO. Information, not an alert.
          <p data-testid="ledger-pre-cutover" className="mb-2.5 text-sm text-muted-foreground">
            {t('procurement:ledger.preCutover', 'Recorded before the ERP connection, not sent')}
          </p>
        )}
        {pendingPush.status !== 'idle' && (
          <div className="mb-2.5 flex justify-end">
            <TaskPushBadge state={pendingPush} />
          </div>
        )}
        <LedgerCaptureRow
          status={detail.status}
          existingTypes={existingTypes}
          canWrite={canWrite}
          invoices={invoices}
          invoiceIdentityContext={invoiceIdentityContext}
          isApprover={isApprover}
          firstDocumentKinds={firstDocumentKinds}
          autoOpenFirstDocument={autoOpenFirstDocument}
          onAutoOpenFirstDocumentConsumed={onAutoOpenFirstDocumentConsumed}
          canApprove={canApprove}
          emptyLedger={rows.length === 0}
          onStage={onStageRecord}
          resetKey={rows.length}
          vendorId={invoiceVendorId}
          itemsNet={itemsNet}
          currency={detail.currency}
          projectId={detail.project_id}
          defaultAttribution={purchaseAttribution(detail)}
          gates={gates}
          busy={captureBusy}
          onCreate={handleCreate}
        />
        {heldBills.map((invoice) => (
          <div key={invoice.id} role="status" data-testid={`bill-match-held-${invoice.id}`} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-destructive-text">{t('procurement:threeWayMatch.heldNotice', '{{bill}} is held by the three-way match, so payments wait.', { bill: billLabel(invoice) })}</span>
            <Button variant="outline" size="sm" onClick={() => setMatchFor({ id: invoice.id, label: billLabel(invoice) })}>{t('procurement:threeWayMatch.review', 'Review match')}</Button>
            {billLinesEditable(invoice, matchedBills.indexOf(invoice)) && <Button variant="outline" size="sm" onClick={() => setLinesFor({ kind: 'bill', id: invoice.id, label: billLabel(invoice) })}>{t('procurement:threeWayMatch.lines.billAction', 'Edit bill lines')}</Button>}
          </div>
        ))}
        {billsHiddenForRole && (
          <p className="mt-3 text-sm text-muted-foreground" data-testid="ledger-bills-hidden-note">
            {t('procurement:ledger.billsHiddenForRole', 'Supplier invoices and payments are not shown for your role.')}
          </p>
        )}
      </div>
    </RecordSection>
  );
};

ProcurementLedger.displayName = 'ProcurementLedger';
