import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card,
  CardHead,
  CardPad,
  Button,
  Icon,
  StatusPill,
  Combobox,
  NumberField,
  ConfirmDialog,
  ListState,
  DataTable,
  type Column,
  type ComboboxOption,
} from '@/src/components/ui';
import { useVendorOptions } from '@/src/hooks/useFkOptions';
import { trackComingSoonClicked } from '@/src/lib/analytics';
import { currencySymbol, formatCurrencyAuto, formatDateOnly, parseMoneyInputAtScale } from '@/src/lib/format';
import type { Tables } from '@/src/lib/supabase/database.types';
import { ProcurementFilesSubsection, type EmbeddedProcurementFile } from './ProcurementFilesSubsection';
import { useCommandIntentMap } from '@/src/hooks/useCommandIntent';
import type { CommandIntent } from '@/src/lib/repositories/types';

/** The single add-quotation session key (BLOCK 2 — one intent per open form, not per submit). */
const ADD_QUOTE_INTENT_KEY = 'add-quotation';

// ---------------------------------------------------------------------------
// VendorQuotesTab — side-by-side bid comparison (Slice 3 / JTBD P2).
// Refactors QuotationsSection into a comparison view:
//   Vendor (VQ#) · Amount · Valid until · Select (gated)
//
// A11y: The attachment sub-section (ProcurementFilesSubsection) is rendered
// OUTSIDE any ARIA grid/table role — the component uses CSS grid for visual
// alignment only (no role="table"/role="row"/role="cell") to avoid the
// aria-required-children violation that arises when non-cell content is nested
// inside role="row" (C1 fix, axe critical).
//
// DB shape: procurement_quotations (snake_case rows consumed directly).
// Columns present:  vq_number, total_amount, valid_until, is_selected, vendor_id.
// Columns absent:   lead_time, payment_terms → omitted per plan.
// ---------------------------------------------------------------------------

type QuotationRow = Tables<'procurement_quotations'> & { files?: EmbeddedProcurementFile[] };

export interface VendorQuotesTabProps {
  quotations: QuotationRow[];
  /**
   * Id of the chosen quotation (PROC-004) — resolved centrally by the page.
   * Falls back to each row's own `is_selected` when null/omitted.
   */
  selectedId?: string | null;
  /** Add-quotation entry shown (sourcing role). */
  canAdd: boolean;
  /** Select-quote action offered (sourcing role AND PR is Vendor Quoted). */
  canSelect: boolean;
  onAdd: (input: {
    vendorId: string;
    totalAmount: number;
    receivedDate: string;
    /** BLOCK 2 (ADR-0058): the add-quote session's command identity — the SAME on every retry. */
    intent: CommandIntent;
  }) => Promise<unknown>;
  onSelect: (quotationId: string) => Promise<unknown>;
  onError: (err: unknown) => void;
  addBusy?: boolean;
  selectBusy?: boolean;
  /** The owning procurement id — threaded to each quotation's file sub-section. */
  procurementId: string;
  /** The owning procurement's ISO-4217 currency (FR-L10N-020) — the new-quotation
   *  form has no quote row of its own yet, so it takes the parent's. */
  currency: string;
  /** Whether file upload/archive affordances show on each quotation row (UX gate). */
  canManageFiles: boolean;
  /** Current user id stamped onto new file rows. */
  currentUserId: string | null;
  /**
   * Vendor name lookup (vendor_id → display name). Sourced from useVendorOptions
   * in the parent and passed down so no duplicate fetch. When a vendor_id is absent
   * from the map the VQ number is used as fallback primary text.
   */
  vendorMap?: Record<string, string>;
}

// ── Derived helpers ───────────────────────────────────────────────────────────

/** Resolve whether this row is the selected quote. Prefers the page-level
 *  resolved `selectedId`; falls back to the row's own `is_selected` flag. */
function isRowSelected(q: QuotationRow, selectedId: string | null | undefined): boolean {
  return selectedId != null ? q.id === selectedId : q.is_selected;
}

/** Sort quotations: selected first, then ascending total_amount (best value
 *  at the top of the non-selected rows). Stable across re-renders. */
function sortedQuotes(quotes: QuotationRow[], selectedId: string | null | undefined): QuotationRow[] {
  return [...quotes].sort((a, b) => {
    const aSelected = isRowSelected(a, selectedId);
    const bSelected = isRowSelected(b, selectedId);
    if (aSelected !== bSelected) return aSelected ? -1 : 1;
    return (a.total_amount ?? 0) - (b.total_amount ?? 0);
  });
}

/**
 * Find the id of the lowest-amount quote among all quotes (the "best value"
 * candidate shown WHILE the buyer is deciding, i.e. when canSelect=true).
 * Returns null when there are no quotes.
 */
function bestValueId(quotes: QuotationRow[]): string | null {
  if (quotes.length === 0) return null;
  return quotes.reduce((best, q) =>
    (q.total_amount ?? 0) < (best.total_amount ?? 0) ? q : best,
  ).id;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const VendorQuotesTab: React.FC<VendorQuotesTabProps> = ({
  quotations,
  selectedId,
  canAdd,
  canSelect,
  onAdd,
  onSelect,
  onError,
  addBusy,
  selectBusy,
  procurementId,
  canManageFiles,
  currentUserId,
  vendorMap = {},
  currency,
}) => {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [total, setTotal] = useState('');
  const [totalError, setTotalError] = useState<string | undefined>(undefined);
  const [selectTarget, setSelectTarget] = useState<QuotationRow | null>(null);
  // BLOCK 2 (ADR-0058): ONE command identity per add-quote session. This component does not unmount
  // when the inline form closes, so the identity is keyed and released by `resetAdd` (the only exit
  // — a success or a deliberate Cancel). A failed submit leaves the form open and the SAME identity
  // in place, so the retry reconciles instead of creating a second quotation.
  const quoteIntents = useCommandIntentMap();

  const { data: vendorOptions } = useVendorOptions();
  const loadVendors = useCallback(
    async (): Promise<ComboboxOption[]> => vendorOptions ?? [],
    [vendorOptions],
  );

  const resetAdd = () => {
    quoteIntents.release(ADD_QUOTE_INTENT_KEY);
    setAdding(false);
    setVendorId(null);
    setTotal('');
    setTotalError(undefined);
  };

  const submitAdd = async () => {
    if (!vendorId) return;
    // #684 (AC-PLC-009): the quote total is stored as numeric(14,2); one locale-aware scale-2 parse
    // both validates and produces the persisted number, so excess precision is refused, not rounded.
    const parsed = parseMoneyInputAtScale(total, 2);
    if (parsed === null || parsed <= 0) {
      setTotalError('Quoted total must be greater than 0 with no more than 2 decimal places.');
      return;
    }
    setTotalError(undefined);
    try {
      await onAdd({
        vendorId,
        totalAmount: parsed,
        receivedDate: new Date().toISOString().slice(0, 10),
        intent: quoteIntents.intentFor(ADD_QUOTE_INTENT_KEY),
      });
      resetAdd();
    } catch (err) {
      onError(err);
    }
  };

  const confirmSelect = async () => {
    if (!selectTarget) return;
    const target = selectTarget;
    try {
      await onSelect(target.id);
      setSelectTarget(null);
    } catch (err) {
      onError(err);
      setSelectTarget(null);
    }
  };

  const sorted = sortedQuotes(quotations, selectedId);

  // Best-value id: shown as a "Best value" pill while the buyer is deciding
  // (canSelect=true / Vendor Quoted status). Once a quote is selected, the
  // "Selected · best value" pill on the chosen row serves the same role.
  const bestId = canSelect ? bestValueId(quotations) : null;

  return (
    <Card data-testid="vendor-quotes">
      <CardHead>
        Bid comparison
        <span className="ml-2 text-[13px] font-normal text-muted-foreground">
          Compare and select a vendor quote
        </span>
        <span className="flex-1" />
        {canAdd && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} data-testid="add-quotation">
            <Icon name="plus" width="1em" height="1em" />
            Add quotation
          </Button>
        )}
      </CardHead>

      {/* ── Empty state ─────────────────────────────────────────────────── */}
      {quotations.length === 0 && (
        <ListState
          variant="empty"
          title={t('procurementDetail.quotes.emptyTitle', 'No quotes recorded. Add a vendor quote to compare bids.')}
        />
      )}

      {/* ── Bid comparison rows ─────────────────────────────────────────── */}
      {quotations.length > 0 && (() => {
        const columns: Column<QuotationRow>[] = [
          {
            key: 'vendor', header: 'Vendor / Quote #', kind: 'primary', size: 320, minSize: 240,
            primaryTitle: (q) => vendorMap[q.vendor_id] ?? q.vq_number ?? 'Vendor quote',
            cell: (q) => vendorMap[q.vendor_id] ?? q.vq_number ?? 'Vendor quote',
            secondaryCell: (q) => <span>{q.reference && <span className="mr-1">{q.reference}</span>}{q.vq_number}</span>,
          },
          { key: 'valueStatus', header: 'Value status', kind: 'status', size: 160, cell: (q) => isRowSelected(q, selectedId) ? <StatusPill variant="won">Selected · best value</StatusPill> : bestId === q.id ? <StatusPill variant="won">Best value</StatusPill> : null },
          { key: 'amount', header: 'Amount', kind: 'money', align: 'num', size: 184, minSize: 152, cell: (q) => <span className="font-semibold">{formatCurrencyAuto(Number(q.total_amount), q.currency)}</span> },
          { key: 'validUntil', header: 'Valid until', kind: 'date', size: 160, cell: (q) => <span className="text-muted-foreground">{formatDateOnly(q.valid_until)}</span> },
          { key: 'attachments', header: 'Attachments', kind: 'text', size: 240, minSize: 180, cell: (q) => <ProcurementFilesSubsection phase="quotation" parentId={q.id} procurementId={procurementId} canWrite={canManageFiles} uploadedById={currentUserId} files={q.files} /> }, 
          { key: 'select', header: '', kind: 'select', size: 40, minSize: 40, maxSize: 40, cell: (q) => {
            const selectable = canSelect && !isRowSelected(q, selectedId);
            return selectable ? <Button size="sm" variant="outline" onClick={() => setSelectTarget(q)} aria-label={`Select quote ${vendorMap[q.vendor_id] ?? q.vq_number ?? ''}`.trim()}>Select</Button> : null;
          } },
        ];
        return <>
          <DataTable rows={sorted} columns={columns} rowKey={(q) => q.id} tableId="procurement-vendor-quotes" accessibleName="Vendor bid comparison" selectedKey={selectedId ?? undefined} />
        </>;
      })()}

      {/* ── Inline-add quotation entry ───────────────────────────────────── */}
      {adding && (
        <CardPad>
          <div
            className="flex flex-wrap items-end gap-3 rounded-[calc(var(--radius)-2px)] border border-border bg-secondary/35 p-3"
            data-testid="add-quotation-form"
          >
            <div className="min-w-[200px] flex-1">
              <Combobox
                label="Vendor"
                noun="vendor"
                required
                placeholder="Select a vendor…"
                value={vendorId}
                onChange={(v) => setVendorId(v)}
                loadOptions={loadVendors}
              />
            </div>
            <div className="w-[150px]">
              <NumberField
                label="Quoted total"
                required
                prefix={currencySymbol(currency)}
                value={total}
                onChange={(v) => {
                  setTotal(v);
                  setTotalError(undefined);
                }}
                error={totalError}
                localeAware
                placeholder="0.00"
              />
            </div>
            <span
              title="File upload coming soon"
              // coming_soon_clicked (2026-07-13 wiring plan — demand signal): the
              // control itself stays genuinely disabled (D13 honest-affordance —
              // never a fake-working CTA); the wrapping span's own click still
              // reports intent, since a `disabled` element cannot dispatch one.
              onClick={() => trackComingSoonClicked('vendor-quote-file-upload', 'procurement')}
              className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-md border border-dashed border-input bg-secondary/50 px-2.5 text-[12.5px] text-muted-foreground"
            >
              <Icon name="doc" width="1em" height="1em" />
              Attach file (coming soon)
            </span>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={resetAdd}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!vendorId || !total.trim()}
              loading={addBusy}
              onClick={() => void submitAdd()}
            >
              Add quotation
            </Button>
          </div>
        </CardPad>
      )}

      {/* ── Select-quote confirm dialog ──────────────────────────────────── */}
      <ConfirmDialog
        open={!!selectTarget}
        tone="default"
        title="Select this quote?"
        description="The selected quote sets the purchase-request value and vendor, and advances the request to Quote Selected."
        confirmLabel="Select quote"
        loading={selectBusy}
        onConfirm={() => void confirmSelect()}
        onCancel={() => setSelectTarget(null)}
      />
    </Card>
  );
};

VendorQuotesTab.displayName = 'VendorQuotesTab';
