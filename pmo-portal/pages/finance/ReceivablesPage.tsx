import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Icon, Tooltip, ViewToggle } from '@/src/components/ui';
import { AgeingStrip } from '@/src/components/finance/AgeingStrip';
import { useFinancePosition } from '@/src/hooks/useFinancePosition';
import { useSalesInvoices, useIncomingPayments } from '@/src/hooks/useRevenue';
import { usePermission } from '@/src/auth/usePermission';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { formatCurrencyCents, formatDateOnly } from '@/src/lib/format';
import { deriveArDueDate } from '@/src/lib/repositories/revenueDisplay';
import type { CurrencyTotals } from '@/src/lib/finance/financePosition';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';
import SalesInvoices from '@/pages/SalesInvoices';
import IncomingPayments from '@/pages/IncomingPayments';

type ReceivablesView = 'invoices' | 'payments';

const OPEN_STATUSES = new Set<SalesInvoiceRow['status']>(['Submitted', 'Unpaid']);

function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function previousMonthStart(day: string): string {
  const date = new Date(`${monthStart(day)}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 10);
}

function nextMonthStart(day: string): string {
  const date = new Date(`${monthStart(day)}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function totalCurrencyLines(values: CurrencyTotals): string {
  return Object.entries(values)
    .filter(([, amount]) => amount !== 0)
    .map(([currency, cents]) => formatCurrencyCents(cents / 100, currency))
    .join(' · ');
}

function owedTotals(position: ReturnType<typeof useFinancePosition>['position']): CurrencyTotals {
  const totals: CurrencyTotals = {};
  for (const [currency, buckets] of Object.entries(position.receivablesAgeing)) {
    totals[currency] = Object.values(buckets).reduce((sum, cents) => sum + cents, 0);
  }
  return totals;
}

function monthlyCash(payments: IncomingPaymentRow[], from: string, to: string): CurrencyTotals {
  const totals: CurrencyTotals = {};
  for (const payment of payments) {
    const date = payment.date?.slice(0, 10);
    if (!date || date < from || date >= to || payment.status !== 'Paid' || payment.cancelled_at || payment.erp_cancelled_at) continue;
    // `amount` includes withheld tax; this figure is cash actually received.
    if (payment.received_amount == null || !Number.isFinite(payment.received_amount)) continue;
    totals[payment.currency] = (totals[payment.currency] ?? 0) + Math.round(payment.received_amount * 100);
  }
  return totals;
}

function Figure({
  title,
  value,
  detail,
  help,
  tone,
}: {
  title: string;
  value: string;
  detail: string;
  help: string;
  tone?: 'good' | 'bad';
}) {
  const { t } = useTranslation();
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4" aria-label={title}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-xs font-semibold text-muted-foreground">{title}</h2>
        <Tooltip content={help}>
          <button type="button" aria-label={t('finance:receivables.calculation', 'How this figure is calculated')} className="inline-grid size-5 shrink-0 place-items-center rounded-full text-xs font-semibold text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">?</button>
        </Tooltip>
      </div>
      <p className="mt-2 break-words text-[20px] font-semibold leading-tight tabular sm:text-[23px]">{value}</p>
      <p className={`mt-1 min-h-5 text-xs ${tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-destructive-text' : 'text-muted-foreground'}`}>{detail}</p>
    </section>
  );
}

export default function ReceivablesPage() {
  const { t } = useTranslation();
  const may = usePermission();
  const orgCurrency = useOrgCurrency();
  const [searchParams, setSearchParams] = useSearchParams();
  const finance = useFinancePosition();
  const { data: invoices = [], isPending: invoicesPending } = useSalesInvoices();
  const { data: payments = [], isPending: paymentsPending } = useIncomingPayments();
  const dataPending = finance.isPending || invoicesPending || paymentsPending;
  const view: ReceivablesView = searchParams.get('view') === 'payments' ? 'payments' : 'invoices';
  const canCreateInvoice = may('create', 'salesInvoice');
  const owed = useMemo(() => owedTotals(finance.position), [finance.position]);
  const openInvoices = useMemo(() => invoices.filter((invoice) => OPEN_STATUSES.has(invoice.status) && (invoice.erp_outstanding_amount == null || invoice.erp_outstanding_amount > 0)), [invoices]);
  const clientsCount = new Set(openInvoices.map((invoice) => invoice.customer_id).filter(Boolean)).size;
  const owedValue = totalCurrencyLines(owed) || formatCurrencyCents(0, orgCurrency);
  const overdueValue = totalCurrencyLines(finance.position.overdueTotals) || formatCurrencyCents(0, orgCurrency);
  const overduePercent = Object.entries(finance.position.overdueTotals).flatMap(([currency, cents]) => {
    const total = owed[currency] ?? 0;
    return total > 0 ? [`${Math.round((cents / total) * 100)}% ${currency}`] : [];
  }).join(' · ') || '0%';
  const oldestOverdueDays = finance.position.overdue[0]?.daysOverdue ?? 0;
  const today = finance.today;
  const dueSoon = useMemo(() => {
    if (!today) return [];
    const end = addDays(today, 30);
    return openInvoices.flatMap((invoice) => {
      const due = deriveArDueDate(invoice.invoice_date, invoice.erp_payment_terms_days, invoice.erp_due_date, invoice.received_date);
      return due && due >= today && due <= end ? [{ invoice, due }] : [];
    }).sort((a, b) => a.due.localeCompare(b.due));
  }, [openInvoices, today]);
  const thisMonthCash = useMemo(() => today ? monthlyCash(payments, monthStart(today), nextMonthStart(today)) : {}, [payments, today]);
  const lastMonthCash = useMemo(() => today ? monthlyCash(payments, previousMonthStart(today), monthStart(today)) : {}, [payments, today]);
  const cashValue = totalCurrencyLines(thisMonthCash) || formatCurrencyCents(0, orgCurrency);
  const cashDelta = Object.keys({ ...thisMonthCash, ...lastMonthCash }).map((currency) => {
    const current = thisMonthCash[currency] ?? 0;
    const previous = lastMonthCash[currency] ?? 0;
    const delta = current - previous;
    const amount = formatCurrencyCents(Math.abs(delta) / 100, currency);
    return `${delta >= 0 ? '+' : '−'}${amount}`;
  }).join(' · ') || formatCurrencyCents(0, orgCurrency);
  const cashCurrencies = Object.keys({ ...thisMonthCash, ...lastMonthCash });
  const cashIsGood = cashCurrencies.length === 0 || cashCurrencies.every((currency) => (thisMonthCash[currency] ?? 0) >= (lastMonthCash[currency] ?? 0));
  const cashIsBad = Object.keys({ ...thisMonthCash, ...lastMonthCash }).some((currency) => (thisMonthCash[currency] ?? 0) < (lastMonthCash[currency] ?? 0));

  const changeView = (nextView: ReceivablesView) => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    if (nextView === 'invoices') next.delete('view');
    else next.set('view', nextView);
    next.delete('open');
    return next;
  }, { replace: true });
  const openNewInvoice = () => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    next.delete('view');
    next.delete('open');
    next.set('create', '1');
    return next;
  }, { replace: true });
  const recordPayment = (invoice: SalesInvoiceRow) => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    next.set('view', 'payments');
    next.set('invoice', invoice.id);
    next.set('create', '1');
    next.delete('open');
    return next;
  }, { replace: true });

  return (
    <main className="mx-auto w-full max-w-[1440px] px-4 py-5 pb-24 sm:px-6 sm:pb-8">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-0.02em]">{t('finance:receivables.title', 'Receivables')}</h1>
        </div>
        {canCreateInvoice && <Button type="button" variant="primary" onClick={openNewInvoice} className="hidden sm:inline-flex">
          <Icon name="plus" />{t('finance:area.newInvoice', 'New invoice')}
        </Button>}
      </header>

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Figure
          title={t('finance:receivables.owed', 'Owed to you')}
          value={dataPending ? '—' : owedValue}
          detail={dataPending ? t('finance:receivables.loading', 'Loading finance figures…') : t('finance:receivables.invoiceClients', '{{invoices}} invoices · {{clients}} clients', { invoices: openInvoices.length, clients: clientsCount })}
          help={t('finance:receivables.owedHelp', 'Known outstanding balances on submitted and unpaid client invoices, including tax.')}
        />
        <Figure
          title={t('finance:receivables.overdue', 'Overdue')}
          value={dataPending ? '—' : overdueValue}
          detail={dataPending ? t('finance:receivables.loading', 'Loading finance figures…') : t('finance:receivables.overdueDetails', '{{percent}} of owed · {{count}} invoices · oldest {{days}} days', { percent: overduePercent, count: finance.position.overdue.length, days: oldestOverdueDays })}
          help={t('finance:receivables.overdueHelp', 'Known overdue balances divided by known owed balances in the same currency. Invoice count includes invoices with an unknown balance.')}
        />
        <Figure
          title={t('finance:receivables.dueNext30', 'Due in next 30 days')}
          value={dataPending ? '—' : String(dueSoon.length)}
          detail={dataPending ? t('finance:receivables.loading', 'Loading finance figures…') : dueSoon[0]
            ? t('finance:receivables.dueDetails', '{{count}} invoices · next due {{date}}', { count: dueSoon.length, date: formatDateOnly(dueSoon[0].due) })
            : t('finance:receivables.noneDue', 'No invoices due in the next 30 days')}
          help={t('finance:receivables.dueHelp', 'Open invoices with a due date from today through 30 days from today, using the invoice date, client terms, and ERP due date.')}
        />
        <Figure
          title={t('finance:receivables.receivedThisMonth', 'Received this month')}
          value={dataPending ? '—' : cashValue}
          detail={dataPending ? t('finance:receivables.loading', 'Loading finance figures…') : `${cashDelta} ${t('finance:receivables.receivedVsLastMonth', 'vs last month')}`}
          help={t('finance:receivables.receivedHelp', 'Cash received on non-cancelled payments dated in this calendar month, compared with the previous calendar month.')}
          tone={dataPending ? undefined : cashIsGood ? 'good' : cashIsBad ? 'bad' : undefined}
        />
      </div>

      <AgeingStrip kind="receivables" values={finance.position.receivablesAgeing} />

      {finance.isError && <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-sm">
        <span>{t('finance:area.attentionLoadError', "Couldn't load finance activity")}</span>
        <Button type="button" variant="outline" size="sm" onClick={finance.retry}>{t('ui.listState.retry', 'Retry')}</Button>
      </div>}

      <section aria-label={t('finance:area.viewInvoicesOrPayments', 'Receivables list')} className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-3 pt-3 sm:px-4">
          <ViewToggle<ReceivablesView>
            options={[
              { value: 'invoices', label: `${t('finance:area.invoicesList', 'Invoices')} · ${invoices.length}` },
              { value: 'payments', label: `${t('finance:area.paymentsList', 'Payments received')} · ${payments.length}` },
            ]}
            value={view}
            onChange={changeView}
            ariaLabel={t('finance:area.viewInvoicesOrPayments', 'Receivables list')}
          />
        </div>
        <div className="p-3 sm:p-4">
          {view === 'invoices'
            ? <SalesInvoices embedded onRecordPayment={recordPayment} />
            : <IncomingPayments embedded />}
        </div>
      </section>

      {canCreateInvoice && <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden">
        <Button type="button" variant="primary" onClick={openNewInvoice} className="w-full">
          <Icon name="plus" />{t('finance:area.newInvoice', 'New invoice')}
        </Button>
      </div>}
    </main>
  );
}
