import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Combobox, EntityFormModal, FieldError, NumberField, type ComboboxOption, type SubmitError } from '@/src/components/ui';
import { useCommandIntent } from '@/src/hooks/useCommandIntent';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { currencySymbol, formatCurrencyCents, formatMoneyInputValue, parseMoneyInputAtScale } from '@/src/lib/format';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';
import { invoiceNumber } from '@/src/lib/revenue/nativeInvoice';
import { nativeRevenueHeadlines } from '@/src/lib/revenue/nativeRevenueErrors';
import { applicableInvoices } from './applicableInvoices';

/** #1415: one line of the apply form — an invoice and what to put on it (a money draft, parsed at scale 2). */
interface Row { key: number; invoiceId: string; amount: string }

export interface ApplyReceiptFormProps {
  receipt: IncomingPaymentRow;
  /** What the receipt has left to apply (from the live allocations). */
  unapplied: number;
  /** Every invoice the page has loaded; the form picks this receipt's candidates from it. */
  invoices: SalesInvoiceRow[];
  /** Runs the apply. `requestId` is this form session's identity: the same on every retry. */
  onApply: (allocations: Array<{ invoiceId: string; amount: number }>, requestId: string) => Promise<void>;
  onClose: () => void;
}

const cents = (n: number): number => Math.round(n * 100);

/**
 * Apply a PMO receipt across one or more invoices (org without an ERP). The checks here are UX only — the server refuses an
 * over-allocation regardless; a refusal keeps every entry and shows its headline in the dialog.
 */
export const ApplyReceiptForm: React.FC<ApplyReceiptFormProps> = ({ receipt, unapplied, invoices, onApply, onClose }) => {
  const { t } = useTranslation();
  // One identity per form session (this component is mounted only while the form is open): a retry replays, never doubles.
  const intent = useCommandIntent();
  const candidates = useMemo(() => applicableInvoices(receipt, invoices), [receipt, invoices]);
  const [rows, setRows] = useState<Row[]>([{ key: 0, invoiceId: '', amount: '' }]);
  const [nextKey, setNextKey] = useState(1);
  const [attempted, setAttempted] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const [saving, setSaving] = useState(false);

  const balanceOf = (invoiceId: string): number | null =>
    candidates.find((inv) => inv.id === invoiceId)?.erp_outstanding_amount ?? null;
  const parsed = rows.map((r) => (r.amount.trim() ? parseMoneyInputAtScale(r.amount, 2) : null));
  const rowError = (i: number): string | undefined => {
    const r = rows[i];
    const amount = parsed[i];
    if (!r.invoiceId && amount === null && !r.amount.trim()) return undefined;
    if (!r.invoiceId) return t('finance:receipts.apply.pickInvoice', 'Choose an invoice.');
    if (amount === null || amount <= 0) return t('finance:receipts.apply.amountPositive', 'Enter an amount above zero, with no more than 2 decimals.');
    const balance = balanceOf(r.invoiceId);
    if (balance !== null && cents(amount) > cents(balance)) {
      return t('finance:receipts.apply.exceedsBalance', 'This is more than the invoice still owes ({{amount}}).', { amount: formatCurrencyCents(balance, receipt.currency) });
    }
    return undefined;
  };
  const total = parsed.reduce<number>((sum, a) => sum + (a !== null && a > 0 ? cents(a) : 0), 0);
  const left = cents(unapplied) - total;
  const filled = rows.filter((r, i) => r.invoiceId && parsed[i] !== null && (parsed[i] as number) > 0);
  const invalid = rows.some((_, i) => rowError(i) !== undefined) || left < 0 || filled.length === 0;
  const prefix = currencySymbol(receipt.currency);

  const setRow = (key: number, patch: Partial<Row>) => setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const optionsFor = useCallback((rowKey: number): ComboboxOption[] => {
    const takenElsewhere = new Set(rows.filter((r) => r.key !== rowKey).map((r) => r.invoiceId));
    return candidates
      .filter((inv) => !takenElsewhere.has(inv.id))
      .map((inv) => ({
        value: inv.id,
        label: invoiceNumber(inv) ?? inv.id,
        sub: t('financeCopy.amountOutstanding', '{{amount}} outstanding', { amount: formatCurrencyCents(inv.erp_outstanding_amount ?? 0, inv.currency) }),
      }));
  }, [candidates, rows, t]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (invalid || saving) return;
    setSaving(true);
    setSaveError(null);
    const allocations = rows.flatMap((r, i) => (r.invoiceId && parsed[i] ? [{ invoiceId: r.invoiceId, amount: parsed[i] as number }] : []));
    onApply(allocations, intent.id)
      .catch((err: unknown) => {
        const { headline, detail } = classifyMutationError(err, nativeRevenueHeadlines(t), { module: 'sales' });
        setSaveError({ headline, detail });
      })
      .finally(() => setSaving(false));
  };

  return (
    <EntityFormModal
      open
      title={t('finance:receipts.apply.title', 'Apply to invoices')}
      subtitle={t('finance:receipts.apply.subtitle', '{{amount}} not yet applied', { amount: formatCurrencyCents(unapplied, receipt.currency) })}
      submitLabel={t('finance:receipts.apply.submit', 'Apply')}
      cancelLabel={t('financeCopy.cancel', 'Cancel')}
      onSubmit={submit}
      submitError={saveError}
      onClose={onClose}
      loading={saving}
      dirty={rows.some((r) => r.invoiceId || r.amount)}
      submitDisabled={invalid}
    >
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('finance:receipts.apply.noOpenInvoices', 'This customer has no approved invoice in {{currency}} that still owes money.', { currency: receipt.currency })}</p>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-3" aria-label={t('finance:receipts.apply.title', 'Apply to invoices')}>
            {rows.map((r, i) => {
              const error = attempted || r.amount ? rowError(i) : undefined;
              const balance = balanceOf(r.invoiceId);
              return (
                <li key={r.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_11rem_auto] sm:items-end">
                  <Combobox
                    id={`apply-invoice-${r.key}`}
                    label={t('finance:receipts.apply.invoiceCol', 'Invoice')}
                    value={r.invoiceId || null}
                    onChange={(value) => setRow(r.key, { invoiceId: value })}
                    placeholder={t('finance:receipts.apply.invoicePlaceholder', 'Choose an invoice…')}
                    loadOptions={async () => optionsFor(r.key)}
                    noun="invoice"
                  />
                  <NumberField
                    id={`apply-amount-${r.key}`}
                    label={t('finance:receipts.apply.amountCol', 'Amount')}
                    value={r.amount}
                    onChange={(v) => setRow(r.key, { amount: v })}
                    prefix={prefix}
                    localeAware
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={balance === null}
                      onClick={() => balance !== null && setRow(r.key, {
                        // The invoice's balance, or what is left of the receipt, whichever is smaller.
                        amount: formatMoneyInputValue(Math.min(balance, Math.max(0, (left + (parsed[i] !== null ? cents(parsed[i] as number) : 0)) / 100))),
                      })}
                    >
                      {t('finance:receipts.apply.fillBalance', 'Fill balance')}
                    </Button>
                    {rows.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t('finance:receipts.apply.removeRow', 'Remove this invoice')}
                        onClick={() => setRows((current) => current.filter((x) => x.key !== r.key))}
                      >
                        {t('finance:receipts.apply.removeRow', 'Remove this invoice')}
                      </Button>
                    )}
                  </div>
                  {error && <div className="sm:col-span-3"><FieldError id={`apply-error-${r.key}`}>{error}</FieldError></div>}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={rows.length >= Math.min(50, candidates.length)}
              onClick={() => { setRows((current) => [...current, { key: nextKey, invoiceId: '', amount: '' }]); setNextKey((k) => k + 1); }}
            >
              {t('finance:receipts.apply.addInvoice', 'Add another invoice')}
            </Button>
            <p role="status" className={left < 0 ? 'text-sm font-medium text-destructive tabular' : 'text-sm tabular'}>
              {t('finance:receipts.apply.leftToApply', 'Left to apply: {{amount}}', { amount: formatCurrencyCents(left / 100, receipt.currency) })}
            </p>
          </div>
          {left < 0 && <FieldError id="apply-total-error">{t('finance:receipts.apply.exceedsReceipt', 'This is more than the payment has left to apply.')}</FieldError>}
        </div>
      )}
    </EntityFormModal>
  );
};
