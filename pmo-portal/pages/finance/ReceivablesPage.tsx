import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Icon, Tooltip, ViewToggle } from '@/src/components/ui';
import { AgeingStrip } from '@/src/components/finance/AgeingStrip';
import { useFinancePosition } from '@/src/hooks/useFinancePosition';
import { useSalesInvoices, useIncomingPayments } from '@/src/hooks/useRevenue';
import { usePermission } from '@/src/auth/usePermission';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { formatDateOnly } from '@/src/lib/format';
import { moneyFigure, shortMoney, type MoneyFigure } from '@/src/lib/dashboardMoney';
import { FigureContent } from '@/src/components/ui/FigureContent';
import { KPIRow } from '@/src/components/ui/KPITile';
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

/** Figure tiles show short money (F11); the exact amount rides as hover/screen-reader metadata. */
function leadCurrencyAmount(values: CurrencyTotals, currency: string): MoneyFigure {
  return moneyFigure((values[currency] ?? 0) / 100, currency, '');
}

function otherCurrencyAmounts(values: CurrencyTotals, leadCurrency: string): string[] {
  return Object.entries(values)
    .filter(([currency, amount]) => currency !== leadCurrency && amount !== 0)
    .map(([currency, cents]) => shortMoney(cents / 100, currency, '—', { code: true }));
}

/** Signed short delta; an unchanged month carries no sign (O8). */
function signedShort(cents: number, currency: string, opts: { code?: boolean } = {}): string {
  const amount = shortMoney(Math.abs(cents) / 100, currency, '—', opts);
  return cents > 0 ? `+${amount}` : cents < 0 ? `−${amount}` : amount;
}

function dueSoonTotals(invoices: { erp_outstanding_amount: number | null; currency: string }[]): CurrencyTotals {
  const totals: CurrencyTotals = {};
  for (const invoice of invoices) {
    if (invoice.erp_outstanding_amount == null || !Number.isFinite(invoice.erp_outstanding_amount)) continue;
    totals[invoice.currency] = (totals[invoice.currency] ?? 0) + Math.round(invoice.erp_outstanding_amount * 100);
  }
  return totals;
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
  secondaryDetail,
  help,
  tone,
}: {
  title: string;
  value: MoneyFigure | null;
  detail: string;
  secondaryDetail?: string;
  help: string;
  tone?: 'good' | 'bad';
}) {
  const { t } = useTranslation();
  return (
    <section className="min-w-0 p-3 sm:p-4" aria-label={title}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-xs font-semibold text-muted-foreground">{title}</h2>
        <Tooltip content={help}>
          <button type="button" aria-label={t('finance:receivables.calculation', 'How this figure is calculated')} className="touch-target inline-grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><Icon name="help" className="size-3.5" /></button>
        </Tooltip>
      </div>
      <p data-figure-value className="mt-2 break-words text-[20px] font-semibold leading-tight tabular sm:text-[23px]">{value ? <FigureContent value={value.value} exactValue={value.exactValue} /> : '—'}</p>
      <p className={`mt-1 min-h-5 text-xs ${tone === 'good' ? 'text-[hsl(var(--success-text))]' : tone === 'bad' ? 'text-destructive-text' : 'text-muted-foreground'}`}>{detail}</p>
      {secondaryDetail && <p className="mt-1 text-xs text-muted-foreground">{secondaryDetail}</p>}
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
  const owedValue = leadCurrencyAmount(owed, orgCurrency);
  const owedOtherCurrencies = otherCurrencyAmounts(owed, orgCurrency);
  const overdueValue = leadCurrencyAmount(finance.position.overdueTotals, orgCurrency);
  const overdueOtherCurrencies = otherCurrencyAmounts(finance.position.overdueTotals, orgCurrency);
  const overdueCents = finance.position.overdueTotals[orgCurrency] ?? 0;
  const overduePercent = owed[orgCurrency] ? `${Math.round((overdueCents / owed[orgCurrency]) * 100)}%` : '0%';
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
  const dueSoonByCurrency = useMemo(() => dueSoonTotals(dueSoon.map(({ invoice }) => invoice)), [dueSoon]);
  const dueSoonOtherCurrencies = otherCurrencyAmounts(dueSoonByCurrency, orgCurrency);
  const thisMonthCash = useMemo(() => today ? monthlyCash(payments, monthStart(today), nextMonthStart(today)) : {}, [payments, today]);
  const lastMonthCash = useMemo(() => today ? monthlyCash(payments, previousMonthStart(today), monthStart(today)) : {}, [payments, today]);
  const cashValue = leadCurrencyAmount(thisMonthCash, orgCurrency);
  const cashDeltaCents = (thisMonthCash[orgCurrency] ?? 0) - (lastMonthCash[orgCurrency] ?? 0);
  const cashDelta = signedShort(cashDeltaCents, orgCurrency);
  const cashOtherDelta = Object.keys({ ...thisMonthCash, ...lastMonthCash })
    .filter((currency) => currency !== orgCurrency)
    .map((currency) => {
      const delta = (thisMonthCash[currency] ?? 0) - (lastMonthCash[currency] ?? 0);
      return delta === 0 ? null : signedShort(delta, currency, { code: true });
    })
    .filter((amount): amount is string => amount !== null);
  const cashIsGood = cashDeltaCents > 0;
  const cashIsBad = cashDeltaCents < 0;

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
    <div className="min-w-0 pb-24 sm:pb-0">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-0.02em]">{t('finance:receivables.title', 'Receivables')}</h1>
        </div>
        {canCreateInvoice && <Button type="button" variant="primary" onClick={openNewInvoice} className="hidden sm:inline-flex">
          <Icon name="plus" />{t('finance:area.newInvoice', 'New invoice')}
        </Button>}
      </header>

      <KPIRow aria-label={t('finance:receivables.figures', 'Receivables figures')} className="mb-5 grid-cols-2 xl:grid-cols-4">
        <Figure
          title={t('finance:receivables.owed', 'Owed to you')}
          value={dataPending ? null : owedValue}
          detail={dataPending ? t('finance:receivables.loading', 'Loading finance figures…') : t('finance:receivables.invoiceClients', '{{invoices}} invoices · {{clients}} {{clientLabel}}', { invoices: openInvoices.length, clients: clientsCount, clientLabel: t(clientsCount === 1 ? 'finance:receivables.clientSingular' : 'finance:receivables.clientPlural', clientsCount === 1 ? 'client' : 'clients') })}
          secondaryDetail={!dataPending && owedOtherCurrencies.length ? t('finance:receivables.otherCurrencies', '{{amounts}} in other currencies', { amounts: owedOtherCurrencies.join(' · ') }) : undefined}
          help={t('finance:receivables.owedHelp', 'Known outstanding balances on submitted and unpaid client invoices, including tax.')}
        />
        <Figure
          title={t('finance:receivables.overdue', 'Overdue')}
          value={dataPending ? null : overdueValue}
          detail={dataPending ? t('finance:receivables.loading', 'Loading finance figures…') : t('finance:receivables.overdueDetails', '{{percent}} of owed · {{count}} {{invoiceLabel}} · oldest {{days}} days', { percent: overduePercent, count: finance.position.overdue.length, days: oldestOverdueDays, invoiceLabel: t(finance.position.overdue.length === 1 ? 'finance:receivables.invoiceSingular' : 'finance:receivables.invoicePlural', finance.position.overdue.length === 1 ? 'invoice' : 'invoices') })}
          secondaryDetail={!dataPending && overdueOtherCurrencies.length ? t('finance:receivables.otherCurrencies', '{{amounts}} in other currencies', { amounts: overdueOtherCurrencies.join(' · ') }) : undefined}
          help={t('finance:receivables.overdueHelp', 'Known overdue balances divided by known owed balances in the same currency. Invoice count includes invoices with an unknown balance.')}
        />
        <Figure
          title={t('finance:receivables.dueNext30', 'Due in next 30 days')}
          value={dataPending ? null : leadCurrencyAmount(dueSoonByCurrency, orgCurrency)}
          detail={dataPending ? t('finance:receivables.loading', 'Loading finance figures…') : dueSoon[0]
            ? t('finance:receivables.dueDetails', '{{count}} invoices · next due {{date}}', { count: dueSoon.length, date: formatDateOnly(dueSoon[0].due) })
            : t('finance:receivables.noneDue', 'No invoices due in the next 30 days')}
          secondaryDetail={!dataPending && dueSoonOtherCurrencies.length ? t('finance:receivables.otherCurrencies', '{{amounts}} in other currencies', { amounts: dueSoonOtherCurrencies.join(' · ') }) : undefined}
          help={t('finance:receivables.dueHelp', 'Open invoices with a due date from today through 30 days from today, using the invoice date, client terms, and ERP due date.')}
        />
        <Figure
          title={t('finance:receivables.receivedThisMonth', 'Received this month')}
          value={dataPending ? null : cashValue}
          detail={dataPending ? t('finance:receivables.loading', 'Loading finance figures…') : `${cashDelta} ${t('finance:receivables.receivedVsLastMonth', 'vs last month')}`}
          secondaryDetail={!dataPending && cashOtherDelta.length ? t('finance:receivables.otherCurrencyDeltas', '{{amounts}} vs last month', { amounts: cashOtherDelta.join(' · ') }) : undefined}
          help={t('finance:receivables.receivedHelp', 'Cash received on non-cancelled payments dated in this calendar month, compared with the previous calendar month.')}
          tone={dataPending ? undefined : cashIsGood ? 'good' : cashIsBad ? 'bad' : undefined}
        />
      </KPIRow>

      <AgeingStrip kind="receivables" values={finance.position.receivablesAgeing} />

      {finance.isError && <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-sm">
        <span>{t('finance:area.attentionLoadError', "Couldn't load finance activity")}</span>
        <Button type="button" variant="outline" size="sm" onClick={finance.retry}>{t('ui.listState.retry', 'Retry')}</Button>
      </div>}

      <section aria-label={t('finance:area.viewInvoicesOrPayments', 'Receivables list')} className="min-w-0">
        {/* ponytail: no outer card — the DataTable frame is the one container (no card inside a card). */}
        <div className="mb-3">
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
        <div>
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
    </div>
  );
}
