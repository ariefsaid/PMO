import React, { useCallback, useState } from 'react';
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
  type ComboboxOption,
} from '@/src/components/ui';
import { useVendorOptions } from '@/src/hooks/useFkOptions';
import { formatCurrency, formatDate, parseMoneyInput } from '@/src/lib/format';
import type { Tables } from '@/src/lib/supabase/database.types';
import { ProcurementFilesSubsection } from './ProcurementFilesSubsection';

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

type QuotationRow = Tables<'procurement_quotations'>;

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
  onAdd: (input: { vendorId: string; totalAmount: number; receivedDate: string }) => Promise<unknown>;
  onSelect: (quotationId: string) => Promise<unknown>;
  onError: (err: unknown) => void;
  addBusy?: boolean;
  selectBusy?: boolean;
  /** The owning procurement id — threaded to each quotation's file sub-section. */
  procurementId: string;
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
}) => {
  const [adding, setAdding] = useState(false);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [total, setTotal] = useState('');
  const [totalError, setTotalError] = useState<string | undefined>(undefined);
  const [selectTarget, setSelectTarget] = useState<QuotationRow | null>(null);

  const { data: vendorOptions } = useVendorOptions();
  const loadVendors = useCallback(
    async (): Promise<ComboboxOption[]> => vendorOptions ?? [],
    [vendorOptions],
  );

  const resetAdd = () => {
    setAdding(false);
    setVendorId(null);
    setTotal('');
    setTotalError(undefined);
  };

  const submitAdd = async () => {
    if (!vendorId) return;
    const parsed = parseMoneyInput(total);
    if (parsed === null || parsed <= 0) {
      setTotalError('Quoted total must be a number greater than 0.');
      return;
    }
    setTotalError(undefined);
    try {
      await onAdd({
        vendorId,
        totalAmount: parsed,
        receivedDate: new Date().toISOString().slice(0, 10),
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
          title="No vendor quotes yet"
          sub="Quotes are captured after the RFQ is sent. Selecting one with rationale advances the case to Ordered."
        />
      )}

      {/* ── Bid comparison rows ─────────────────────────────────────────── */}
      {/* A11y note: no role="table"/"row"/"cell" — CSS grid is used for visual
          alignment only. The attachment sub-section renders inside each item
          without breaking an ARIA grid contract (C1 fix). */}
      {quotations.length > 0 && (
        <div aria-label="Vendor bid comparison">
          {/* Column header strip — visual only (sr-only for AT column context) */}
          <div
            aria-hidden="true"
            className="hidden min-[768px]:grid border-b border-border"
            style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) auto' }}
          >
            <div className="h-[38px] px-3 text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground flex items-center">
              Vendor / Quote #
            </div>
            <div className="h-[38px] px-3 text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground flex items-center justify-end">
              Amount
            </div>
            <div className="h-[38px] px-3 text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground flex items-center">
              Valid until
            </div>
            <div className="h-[38px] px-3 text-[11.5px] font-semibold uppercase tracking-[0.03em] text-muted-foreground flex items-center">
              {/* Action column — no visible label */}
            </div>
          </div>

          {sorted.map((q) => {
            const selected = isRowSelected(q, selectedId);
            const selectable = canSelect && !selected;
            const isBestValue = bestId === q.id;
            const vendorName = vendorMap[q.vendor_id] ?? null;

            return (
              <div
                key={q.id}
                className={[
                  'border-b border-border/70 last:border-b-0',
                  selected ? 'bg-success/[0.06]' : 'hover:bg-accent/60',
                ].join(' ')}
              >
                {/* ── Desktop row (≥768px) — pure CSS grid, no ARIA roles ── */}
                <div
                  className="hidden min-[768px]:grid items-start min-h-[54px]"
                  style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) auto' }}
                >
                  {/* Vendor / VQ# column */}
                  <div className="flex flex-col gap-0.5 px-3 py-2.5">
                    {/* Vendor name — primary axis for comparison */}
                    {vendorName ? (
                      <span className="text-[13.5px] font-semibold">{vendorName}</span>
                    ) : (
                      q.vq_number && (
                        <span className="font-mono text-[13.5px] font-semibold">{q.vq_number}</span>
                      )
                    )}
                    {/* VQ# as mono sub-text when vendor name is shown */}
                    {vendorName && q.vq_number && (
                      <span className="font-mono text-[11.5px] text-muted-foreground">{q.vq_number}</span>
                    )}
                    {/* External reference if present */}
                    {q.reference && (
                      <span className="text-[11px] text-muted-foreground">{q.reference}</span>
                    )}
                    {/* Status pills — selected OR best-value during decision */}
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      {selected && (
                        <StatusPill variant="won">Selected · best value</StatusPill>
                      )}
                      {!selected && isBestValue && (
                        <StatusPill variant="won">Best value</StatusPill>
                      )}
                    </div>
                  </div>

                  {/* Amount column */}
                  <div className="px-3 py-2.5 text-right">
                    <span className="text-[13.5px] font-semibold tabular-nums">
                      {formatCurrency(Number(q.total_amount))}
                    </span>
                  </div>

                  {/* Valid until column */}
                  <div className="px-3 py-2.5 text-[13.5px] text-muted-foreground">
                    {formatDate(q.valid_until)}
                  </div>

                  {/* Action column */}
                  <div className="px-3 py-2.5">
                    {selectable && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectTarget(q)}
                        aria-label={`Select quote ${vendorName ?? q.vq_number ?? ''}`.trim()}
                      >
                        Select
                      </Button>
                    )}
                  </div>
                </div>

                {/* ── Mobile card (< 768px) ── */}
                <dl className="flex flex-col gap-2 px-3 py-3 min-[768px]:hidden">
                  {/* Header: vendor name + amount prominent */}
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex flex-col gap-0.5">
                      {/* Vendor name — primary on mobile too */}
                      {vendorName ? (
                        <span className="text-[13.5px] font-semibold">{vendorName}</span>
                      ) : (
                        q.vq_number && (
                          <span className="font-mono text-[13.5px] font-semibold">{q.vq_number}</span>
                        )
                      )}
                      {vendorName && q.vq_number && (
                        <span className="font-mono text-[11px] text-muted-foreground">{q.vq_number}</span>
                      )}
                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                        {selected && (
                          <StatusPill variant="won">Selected · best value</StatusPill>
                        )}
                        {!selected && isBestValue && (
                          <StatusPill variant="won">Best value</StatusPill>
                        )}
                      </div>
                    </div>
                    {selectable && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectTarget(q)}
                        aria-label={`Select quote ${vendorName ?? q.vq_number ?? ''}`.trim()}
                      >
                        Select
                      </Button>
                    )}
                  </div>
                  <div className="flex justify-between items-center">
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                      Amount
                    </dt>
                    <dd className="text-[13.5px] font-semibold tabular-nums">
                      {formatCurrency(Number(q.total_amount))}
                    </dd>
                  </div>
                  <div className="flex justify-between items-center">
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                      Valid until
                    </dt>
                    <dd className="text-[13.5px] text-muted-foreground">
                      {formatDate(q.valid_until)}
                    </dd>
                  </div>
                </dl>

                {/* Per-quotation file attachments (ADR-0023) — outside any ARIA
                    grid/row context so attachment DOM doesn't violate grid contract */}
                <div className="px-3 pb-2">
                  <ProcurementFilesSubsection
                    phase="quotation"
                    parentId={q.id}
                    procurementId={procurementId}
                    canWrite={canManageFiles}
                    uploadedById={currentUserId}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

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
                prefix="$"
                value={total}
                onChange={(v) => {
                  setTotal(v);
                  setTotalError(undefined);
                }}
                error={totalError}
                placeholder="0.00"
              />
            </div>
            <span
              title="File upload coming soon"
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
