import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui';
import { useSalesInvoiceEvidence, useIncomingPayments } from '@/src/hooks/useRevenue';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { displayAllocations } from '@/src/lib/revenue/receiptAllocation';
import { formatCurrencyCents, formatDateOnly } from '@/src/lib/format';

export const SalesInvoiceEvidenceSection: React.FC<{ invoice: SalesInvoiceRow }> = ({ invoice }) => {
  const { t } = useTranslation();
  const canFetchEvidence = !invoice.pmo_native && invoice.erp_docstatus !== null;
  const evidence = useSalesInvoiceEvidence(invoice.id, canFetchEvidence);
  const [pendingTimedOut, setPendingTimedOut] = useState(false);
  const payments = useIncomingPayments(undefined, true, invoice.id);
  useEffect(() => {
    if (!canFetchEvidence || !evidence.isPending) {
      setPendingTimedOut(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setPendingTimedOut(true), 3000);
    return () => window.clearTimeout(timer);
  }, [canFetchEvidence, evidence.isPending, invoice.id]);
  const paymentEvidence = useMemo(() => {
    const rows = (payments.data ?? []).filter((payment) =>
      payment.status !== 'Scheduled' && !payment.erp_cancelled_at && !payment.cancelled_at,
    );
    const allocations = rows.flatMap((payment) => {
      const reported = displayAllocations(payment, (id) => id === invoice.id ? invoice.si_number : null);
      return (reported ?? []).filter((allocation) =>
        allocation.invoice_id === invoice.id || Boolean(invoice.si_number && allocation.invoice_number === invoice.si_number),
      ).map((allocation) => ({ payment, allocation }));
    });
    return {
      allocations,
      hasUnknown: rows.some((payment) =>
        (payment.sales_invoice_id === invoice.id || (payment.allocation_details ?? []).some((allocation) => allocation.invoice_id === invoice.id))
        && displayAllocations(payment, (id) => id === invoice.id ? invoice.si_number : null) === null,
      ),
    };
  }, [invoice.id, invoice.si_number, payments.data]);

  const hasReceipts = payments.isError || paymentEvidence.allocations.length > 0 || paymentEvidence.hasUnknown;
  // The ONE lines render on the record page: native lines come from the invoice row, ERP lines from
  // the accounting-system evidence read. The approval preview below passes hideLines so the same
  // lines are not announced twice (the approvals panel keeps the preview as its own lines surface).
  const lines = invoice.pmo_native ? invoice.native_lines : canFetchEvidence ? evidence.data?.lines : null;
  return (
    <section aria-labelledby="invoice-evidence-heading" className="mb-5 border-b border-border pb-4">
      <h2 id="invoice-evidence-heading" className="mb-3 text-base font-semibold">{t('uxs17.billEvidence', 'Bill evidence')}</h2>
      {canFetchEvidence && evidence.isPending && !pendingTimedOut ? (
        <p className="text-sm text-muted-foreground">{t('uxs17.evidenceLoading', 'Loading invoice evidence…')}</p>
      ) : canFetchEvidence && (evidence.isError || pendingTimedOut) ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">{t('finance:receivables.evidenceLoadError', "Couldn't load the invoice lines from the accounting system.")}</p>
          <Button variant="outline" size="sm" onClick={() => void evidence.refetch()}>{t('uxs17.evidenceRetry', 'Retry invoice evidence')}</Button>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(12rem,1fr)]">
          <div>
            {/* AC-991-001: the record's line list keeps its accessible "Line items" naming for a
                PMO-native invoice; an ERP invoice's accounting-system lines stay "Invoice lines". */}
            {invoice.pmo_native ? (
              <>
                <h3 className="text-sm font-medium">{t('financeCopy.lineItemsSection', 'Line items')}</h3>
                <ul className="mt-2 divide-y divide-border/70" aria-label={t('financeCopy.lineItemsSection', 'Line items')}>
                  {(lines ?? []).map((line, index) => (
                    <li key={`${line.item_code ?? 'line'}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
                      <span className="min-w-0 flex-1 break-words">
                        <span className="block">{line.description ?? line.item_code ?? t('uxs17.lineDescriptionUnavailable', 'Description not available')}</span>
                        {line.item_code && line.description && <span className="font-mono text-xs text-muted-foreground">{line.item_code}</span>}
                      </span>
                      <span className="tabular text-right text-muted-foreground">
                        {line.qty == null ? '—' : line.qty}{' × '}{line.rate == null ? '—' : formatCurrencyCents(line.rate, invoice.currency)}{' = '}
                        <span className="font-medium text-foreground">{line.amount == null ? '—' : formatCurrencyCents(line.amount, invoice.currency)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                {lines != null && lines.length === 0 ? null : <h3 className="text-sm font-medium">{t('uxs17.invoiceLines', 'Invoice lines')}</h3>}
                {lines == null ? (
                  <p className="mt-1 text-sm text-muted-foreground">{t('uxs17.linesUnknown', 'Line details are not available.')}</p>
                ) : lines.length === 0 ? null : (
                  <ul className="mt-2 divide-y divide-border/70">
                    {lines.map((line, index) => (
                      <li key={`${line.item_code ?? 'line'}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
                        <span className="min-w-0 flex-1 break-words">
                          <span className="block">{line.description ?? line.item_code ?? t('uxs17.lineDescriptionUnavailable', 'Description not available')}</span>
                          {line.item_code && line.description && <span className="font-mono text-xs text-muted-foreground">{line.item_code}</span>}
                        </span>
                        <span className="tabular text-right text-muted-foreground">
                          {line.qty == null ? '—' : line.qty}{' × '}{line.rate == null ? '—' : formatCurrencyCents(line.rate, invoice.currency)}{' = '}
                          <span className="font-medium text-foreground">{line.amount == null ? '—' : formatCurrencyCents(line.amount, invoice.currency)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          {canFetchEvidence && evidence.data?.contact ? (
            <div>
              <h3 className="text-sm font-medium">{t('uxs17.billingContact', 'Billing contact')}</h3>
              <address className="mt-1 space-y-1 text-sm not-italic">
                {evidence.data.contact.name && <p>{evidence.data.contact.name}</p>}
                {evidence.data.contact.email && <p><a className="underline underline-offset-2" href={`mailto:${evidence.data.contact.email}`}>{evidence.data.contact.email}</a></p>}
                {evidence.data.contact.phone && <p><a className="underline underline-offset-2" href={`tel:${evidence.data.contact.phone}`}>{evidence.data.contact.phone}</a></p>}
              </address>
            </div>
          ) : null}
        </div>
      )}
      {hasReceipts && (
      <div className="mt-5 border-t border-border/70 pt-3">
        <h3 className="mb-1 text-sm font-medium">{t('uxs17.appliedReceipts', 'Applied receipts')}</h3>
        {payments.isError ? (
          <p className="text-sm text-muted-foreground">{t('uxs17.receiptsUnavailable', 'Applied receipt details are unavailable.')}</p>
        ) : paymentEvidence.allocations.length ? (
          <>
            <ul className="divide-y divide-border/70">
              {paymentEvidence.allocations.map(({ payment, allocation }, index) => {
                const amount = allocation.amount == null ? null : Number(allocation.amount);
                return (
                  <li key={`${payment.id}-${index}`} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-sm">
                    <span>{payment.ip_number ?? payment.reference_number ?? t('uxs17.receiptReferenceUnavailable', 'Receipt reference not recorded')}
                      {payment.date && <span className="ml-2 text-muted-foreground">{formatDateOnly(payment.date)}</span>}
                    </span>
                    <span className="tabular">{amount == null || !Number.isFinite(amount) || !allocation.currency
                      ? t('uxs17.allocationAmountUnavailable', 'Applied amount not available')
                      : formatCurrencyCents(amount, allocation.currency)}</span>
                  </li>
                );
              })}
            </ul>
            {paymentEvidence.hasUnknown && <p className="mt-2 text-sm text-muted-foreground">{t('uxs17.receiptsCoverageUnknown', 'Receipt allocations have not all been reported.')}</p>}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('uxs17.receiptsCoverageUnknown', 'Receipt allocations have not all been reported.')}</p>
        )}
      </div>
      )}
    </section>
  );
};
