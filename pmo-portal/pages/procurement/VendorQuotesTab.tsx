import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
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
import { currencySymbol, formatCurrencyAuto, formatDateOnly, formatNumber, parseMoneyInputAtScale } from '@/src/lib/format';
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
function bestValueIds(quotes: QuotationRow[]): Set<string> {
  const minimumByCurrency = new Map<string, number>();
  for (const quote of quotes) {
    if (!quote.currency || quote.total_amount == null) continue;
    const amount = Number(quote.total_amount);
    const minimum = minimumByCurrency.get(quote.currency);
    if (minimum === undefined || amount < minimum) minimumByCurrency.set(quote.currency, amount);
  }
  return new Set(quotes
    .filter((quote) => quote.currency && quote.total_amount != null && Number(quote.total_amount) === minimumByCurrency.get(quote.currency))
    .map((quote) => quote.id));
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
      setTotalError(t('procurement:quotes.capture.invalidAmount', 'Enter a quoted total greater than zero with no more than two decimal places.'));
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

  // Different currencies cannot be ranked against one another. Mark every lowest
  // quote within its own currency group while the buyer is deciding.
  const bestIds = canSelect ? bestValueIds(quotations) : new Set<string>();

  return (
    <section data-testid="vendor-quotes" aria-labelledby="vendor-quotes-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="vendor-quotes-heading" className="text-xl font-bold leading-tight text-foreground">
          {t('procurement:quotes.heading', 'Bid comparison')}
        </h2>
        {canAdd && !adding && (
          <Button size="sm" variant="outline" className="min-h-11 text-xs font-semibold" onClick={() => setAdding(true)} data-testid="add-quotation">
            <Icon name="plus" width="1em" height="1em" />
            {t('procurement:quotes.add', 'Add quotation')}
          </Button>
        )}
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────── */}
      {quotations.length === 0 && (
        <ListState
          variant="empty"
          title={t('procurement:quotes.emptyTitle', 'No quotes recorded. Add a vendor quote to compare bids.')}
        />
      )}

      {/* ── Bid comparison rows ─────────────────────────────────────────── */}
      {quotations.length > 0 && (() => {
        const columns: Column<QuotationRow>[] = [
          {
            key: 'vendor', header: t('procurement:quotes.columns.vendor', 'Vendor / reference'), kind: 'primary', fullIdentity: true, size: 320, minSize: 240,
            primaryTitle: (q) => vendorMap[q.vendor_id] ?? q.vq_number ?? t('procurement:quotes.vendorFallback', 'Vendor quote'),
            cell: (q) => vendorMap[q.vendor_id] ?? q.vq_number ?? t('procurement:quotes.vendorFallback', 'Vendor quote'),
            secondaryCell: (q) => <span>{q.reference && <span className="mr-1">{q.reference}</span>}{q.vq_number}</span>,
          },
          { key: 'valueStatus', header: t('procurement:quotes.columns.selection', 'Selection status'), kind: 'status', size: 160, cell: (q) => isRowSelected(q, selectedId) ? <StatusPill variant="won">{t('procurement:quotes.selected', 'Selected')}</StatusPill> : bestIds.has(q.id) ? <StatusPill variant="won">{t('procurement:quotes.bestValueInCurrency', 'Best in currency')}</StatusPill> : null },
          { key: 'validUntil', header: t('procurement:quotes.columns.validUntil', 'Valid until'), kind: 'date', size: 160, cell: (q) => <span className="text-muted-foreground">{formatDateOnly(q.valid_until)}</span> },
          { key: 'amount', header: t('procurement:quotes.columns.amount', 'Amount'), kind: 'money', align: 'num', size: 184, minSize: 152, cell: (q) => <span className="text-sm font-normal">{q.total_amount == null || !q.currency ? t('procurement:shared.notAvailable', 'Not available') : formatNumber(Number(q.total_amount))}</span> },
          { key: 'attachments', header: t('procurement:quotes.columns.attachments', 'Evidence'), kind: 'text', size: 240, minSize: 180, cell: (q) => <ProcurementFilesSubsection phase="quotation" parentId={q.id} procurementId={procurementId} canWrite={canManageFiles} uploadedById={currentUserId} files={q.files} /> },
          { key: 'select', header: t('procurement:quotes.columns.select', 'Select'), kind: 'select', size: 88, minSize: 88, maxSize: 120, cell: (q) => {
            const selectable = canSelect && !isRowSelected(q, selectedId);
            const vendor = vendorMap[q.vendor_id] ?? q.vq_number ?? '';
            return selectable ? <Button size="sm" variant="outline" className="min-h-11 min-[921px]:min-h-8" onClick={() => setSelectTarget(q)} aria-label={t('procurement:quotes.selectAria', 'Select quote {{vendor}}', { vendor })}>{t('procurement:quotes.select', 'Select')}</Button> : null;
          } },
        ];
        const mobileRow = (q: QuotationRow) => {
          const vendor = vendorMap[q.vendor_id] ?? q.vq_number ?? t('procurement:quotes.vendorFallback', 'Vendor quote');
          const selected = isRowSelected(q, selectedId);
          const selectable = canSelect && !selected;
          const status = selected
            ? t('procurement:quotes.selected', 'Selected')
            : bestIds.has(q.id) ? t('procurement:quotes.bestValueInCurrency', 'Best in currency') : t('procurement:quotes.notSelected', 'Not selected');
          return (
            <div className="grid gap-3 p-3">
              <div className="min-w-0">
                <div className="break-words text-sm text-foreground">{vendor}</div>
                <div className="mt-1 break-words text-xs font-semibold text-muted-foreground">
                  {q.reference ? `${q.reference} · ` : ''}{q.vq_number}
                </div>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <StatusPill variant={selected || bestIds.has(q.id) ? 'won' : 'neutral'}>{status}</StatusPill>
                <span className="text-xs font-semibold text-muted-foreground">{t('procurement:quotes.columns.validUntil', 'Valid until')}</span>
                <time dateTime={q.valid_until ?? undefined} className="text-sm text-muted-foreground">{formatDateOnly(q.valid_until)}</time>
              </div>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <span className="whitespace-nowrap text-sm tabular text-foreground">{q.total_amount == null || !q.currency ? t('procurement:shared.notAvailable', 'Not available') : formatNumber(Number(q.total_amount))}</span>
                {selectable && <Button size="sm" variant="outline" className="min-h-11 text-xs font-semibold" onClick={() => setSelectTarget(q)} aria-label={t('procurement:quotes.selectAria', 'Select quote {{vendor}}', { vendor })}>{t('procurement:quotes.select', 'Select')}</Button>}
              </div>
              <ProcurementFilesSubsection phase="quotation" parentId={q.id} procurementId={procurementId} canWrite={canManageFiles} uploadedById={currentUserId} files={q.files} />
            </div>
          );
        };
        return <>
          <DataTable rows={sorted} columns={columns} mobileRow={mobileRow} rowKey={(q) => q.id} tableId="procurement-vendor-quotes" accessibleName={t('procurement:quotes.tableLabel', 'Vendor bid comparison')} selectedKey={selectedId ?? undefined} groupBy={(q) => q.currency || t('procurement:shared.notAvailable', 'Not available')} groupHeadingClassName="text-xl font-bold leading-tight" />
        </>;
      })()}

      {/* ── Inline-add quotation entry ───────────────────────────────────── */}
      {adding && (
        <div className="mt-4">
          <div
            className="flex flex-wrap items-end gap-3 rounded-[calc(var(--radius)-2px)] border border-border bg-secondary/35 p-3"
            data-testid="add-quotation-form"
          >
            <div className="min-w-[200px] flex-1">
              <Combobox
                label={t('procurement:quotes.capture.vendor', 'Vendor')}
                noun="vendor"
                required
                placeholder={t('procurement:quotes.capture.selectVendor', 'Select a vendor…')}
                value={vendorId}
                onChange={(v) => setVendorId(v)}
                loadOptions={loadVendors}
              />
            </div>
            <div className="w-[150px]">
              <NumberField
                label={t('procurement:quotes.capture.quotedTotal', 'Quoted total')}
                required
                prefix={currencySymbol(currency)}
                value={total}
                onChange={(v) => {
                  setTotal(v);
                  setTotalError(undefined);
                }}
                error={totalError}
                localeAware
                placeholder={t('procurement:quotes.capture.amountPlaceholder', '0.00')}
              />
            </div>
            <span
              title={t('procurement:quotes.capture.fileUploadUnavailable', 'File upload is not available yet')}
              // coming_soon_clicked (2026-07-13 wiring plan — demand signal): the
              // control itself stays genuinely disabled (D13 honest-affordance —
              // never a fake-working CTA); the wrapping span's own click still
              // reports intent, since a `disabled` element cannot dispatch one.
              onClick={() => trackComingSoonClicked('vendor-quote-file-upload', 'procurement')}
              className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-md border border-dashed border-input bg-secondary/50 px-2.5 text-sm text-muted-foreground"
            >
              <Icon name="doc" width="1em" height="1em" />
              {t('procurement:quotes.capture.attachFileUnavailable', 'Attach file unavailable')}
            </span>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" className="min-h-11 min-[921px]:min-h-8" onClick={resetAdd}>
              {t('procurement:quotes.capture.cancel', 'Cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              className="min-h-11 min-[921px]:min-h-8"
              disabled={!vendorId || !total.trim()}
              loading={addBusy}
              onClick={() => void submitAdd()}
            >
              {t('procurement:quotes.add', 'Add quotation')}
            </Button>
          </div>
        </div>
      )}

      {/* ── Select-quote confirm dialog ──────────────────────────────────── */}
      <ConfirmDialog
        open={!!selectTarget}
        tone="default"
        title={t('procurement:quotes.selectionTitle', 'Select this quote?')}
        description={selectTarget ? t(
          'procurement:quotes.selectionDescription',
          'The {{vendor}} quote for {{amount}} will set the request value and vendor. If it exceeds the approved amount, the request returns for approval.',
          {
            vendor: vendorMap[selectTarget.vendor_id] ?? selectTarget.vq_number ?? t('procurement:quotes.vendorFallback', 'Vendor quote'),
            amount: formatCurrencyAuto(Number(selectTarget.total_amount), selectTarget.currency),
          },
        ) : ''}
        confirmLabel={t('procurement:quotes.selectConfirm', 'Select quote')}
        loading={selectBusy}
        onConfirm={() => void confirmSelect()}
        onCancel={() => setSelectTarget(null)}
      />
    </section>
  );
};

VendorQuotesTab.displayName = 'VendorQuotesTab';
