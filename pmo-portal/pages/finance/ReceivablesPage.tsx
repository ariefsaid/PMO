import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Icon, PageHeader, ViewToggle } from '@/src/components/ui';
import { KPIRow, KPITile } from '@/src/components/ui/KPITile';
import { FigureHiddenLine, FigureScope } from '@/src/components/ui/FigureScope';
import { figureCols, moneyTileProps } from '@/src/components/finance/moneyTile';
import { AgeingStrip } from '@/src/components/finance/AgeingStrip';
import { useFinancePosition } from '@/src/hooks/useFinancePosition';
import { useSalesInvoices, useIncomingPayments } from '@/src/hooks/useRevenue';
import { usePermission } from '@/src/auth/usePermission';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { deriveArDueDate } from '@/src/lib/repositories/revenueDisplay';
import type { CurrencyTotals } from '@/src/lib/finance/financePosition';
import { formatDay, formatTileMoney } from '@/src/lib/format';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';
import { isOpenClientInvoiceStatus } from '@/src/lib/revenue/clientInvoiceStatus';
import SalesInvoices from '@/pages/SalesInvoices';
import IncomingPayments from '@/pages/IncomingPayments';

type ReceivablesView = 'invoices' | 'payments';

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
  const canCreatePayment = may('create', 'incomingPayment');
  const owed = useMemo(() => owedTotals(finance.position), [finance.position]);
  const openInvoices = useMemo(() => invoices.filter((invoice) => isOpenClientInvoiceStatus(invoice.status) && (invoice.erp_outstanding_amount == null || invoice.erp_outstanding_amount > 0)), [invoices]);
  const owedUnknown = finance.position.receivablesUnknownCount;
  const overdueUnknown = finance.position.overdueUnknownCount;
  const overduePercent = owedUnknown || overdueUnknown ? null : owed[orgCurrency] ? Math.round(((finance.position.overdueTotals[orgCurrency] ?? 0) / owed[orgCurrency]) * 100) : 0;
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
  const thisMonthCash = useMemo(() => today ? monthlyCash(payments, monthStart(today), nextMonthStart(today)) : {}, [payments, today]);
  const lastMonthCash = useMemo(() => today ? monthlyCash(payments, previousMonthStart(today), monthStart(today)) : {}, [payments, today]);
  const cashDeltaCents = (thisMonthCash[orgCurrency] ?? 0) - (lastMonthCash[orgCurrency] ?? 0);
  const cashDelta = (() => {
    const amount = formatTileMoney(Math.abs(cashDeltaCents) / 100, orgCurrency);
    return amount === null ? undefined : cashDeltaCents > 0 ? `+${amount}` : cashDeltaCents < 0 ? `−${amount}` : amount;
  })();
  const owedTile = dataPending || (owedUnknown > 0 && !owed[orgCurrency]) ? null : moneyTileProps(finance.position.receivablesCount === 0 ? { [orgCurrency]: 0 } : owed, orgCurrency);
  const overdueTile = dataPending || (overdueUnknown > 0 && !finance.position.overdueTotals[orgCurrency]) ? null : moneyTileProps(finance.position.overdue.length === 0 ? { [orgCurrency]: 0 } : finance.position.overdueTotals, orgCurrency);

  const dueSoonTile = moneyTileProps(dueSoon.length === 0 && today ? { [orgCurrency]: 0 } : dueSoonByCurrency, orgCurrency);
  const hasCurrentPayments = today && payments.some((payment) => {
    const date = payment.date?.slice(0, 10);
    return date && date >= monthStart(today) && date < nextMonthStart(today) && payment.status === 'Paid' && !payment.cancelled_at && !payment.erp_cancelled_at;
  });
  const cashTile = moneyTileProps(today && !hasCurrentPayments ? { [orgCurrency]: 0 } : thisMonthCash, orgCurrency);

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
  const openNewPayment = () => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    next.set('view', 'payments');
    next.set('create', '1');
    next.delete('open');
    next.delete('invoice');
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

  const unknownReason = (count: number) => t('finance:area.ageingUnknownCount', { defaultValue: count === 1 ? '{{count}} invoice has no balance reported by the accounting system' : '{{count}} invoices have no balance reported by the accounting system', count });
  const seeInvoices = { to: '/finance/receivables?status=Unpaid', label: t('financeHub:hub.seeInvoices', 'See invoices') };

  return (
    <FigureScope>
    <div className="flex min-w-0 flex-col">
      <PageHeader
        title={t('finance:receivables.title', 'Receivables')}
        help={<p>{t('finance:receivables.helpAges', 'Client balances by age count days past due, tax included. Overdue shows known balances only; invoices with an unknown balance are listed, not added.')}</p>}
        helpSubject={t('finance:receivables.title', 'Receivables')}
        className="order-1"
        action={<div className="flex flex-wrap items-center gap-2">
          {canCreateInvoice && <div data-testid="receivables-header-new-invoice"><Button type="button" variant="primary" onClick={openNewInvoice}><Icon name="plus" />{t('finance:area.newInvoice', 'New invoice')}</Button></div>}
          {canCreatePayment && <div data-testid="receivables-header-receive-payment"><Button type="button" variant="outline" onClick={openNewPayment}><Icon name="plus" />{t('financeCopy.receivePayment', 'Receive payment')}</Button></div>}
        </div>}
      />

      <div className="order-2 mb-3"><FigureHiddenLine /></div>

      <div className="order-4 max-sm:order-5 min-w-0">
        <KPIRow aria-label={t('finance:receivables.figures', 'Receivables figures')} className={`mb-5 ${figureCols((owedTile || dataPending ? 1 : 0) + (overdueTile || dataPending ? 1 : 0) + 2)}`}>
          <KPITile
            icon="grid" tone="blue" label={t('finance:receivables.owed', 'Owed to you')} caption={t('financeHub:hub.taxIncluded', 'tax included')}
            value={owedTile?.value ?? null} exactValue={owedTile?.exactValue} loading={dataPending}
            unavailableReason={owedTile || dataPending ? undefined : unknownReason(owedUnknown)} hiddenLink={seeInvoices}
            help={t('finance:receivables.owedHelp', 'Known outstanding balances on submitted and unpaid client invoices, including tax.')}
          />
          <KPITile
            icon="grid" tone="red" label={t('finance:receivables.overdue', 'Overdue')} caption={overduePercent == null ? undefined : t('finance:receivables.overduePercent', '{{percent}}% of owed', { percent: overduePercent })}
            value={overdueTile?.value ?? null} exactValue={overdueTile?.exactValue} loading={dataPending}
            unavailableReason={overdueTile || dataPending ? undefined : unknownReason(overdueUnknown)} hiddenLink={seeInvoices}
            help={t('finance:receivables.overdueHelp', 'Known overdue balances divided by known owed balances in the same currency. Invoice count includes invoices with an unknown balance.')}
          />
          <KPITile
            icon="grid" tone="amber" label={t('finance:receivables.dueNext30', 'Due in next 30 days')}
            caption={dueSoon[0] ? t('finance:receivables.nextDue', 'next due {{date}}', { date: formatDay(dueSoon[0].due) }) : undefined}
            value={dataPending ? null : dueSoonTile.value} exactValue={dataPending ? undefined : dueSoonTile.exactValue} loading={dataPending}
            help={t('finance:receivables.dueHelp', 'Open invoices with a due date from today through 30 days from today, using the invoice date, client terms, and ERP due date.')}
          />
          <KPITile
            icon="grid" tone="green" label={t('finance:receivables.receivedThisMonth', 'Received this month')}
            caption={cashDelta ? t('finance:receivables.vsLastMonth', '{{delta}} vs last month', { delta: cashDelta }) : undefined}
            value={dataPending ? null : cashTile.value} exactValue={dataPending ? undefined : cashTile.exactValue} loading={dataPending}
            help={t('finance:receivables.receivedHelp', 'Cash received on non-cancelled payments dated in this calendar month, compared with the previous calendar month.')}
          />
        </KPIRow>
        <AgeingStrip kind="receivables" values={finance.position.receivablesAgeing} unknownTotal={owedUnknown} />
      </div>

      {finance.isError && <div role="alert" className="order-4 mb-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-control">
        <span>{t('finance:area.attentionLoadError', "Couldn't load finance activity")}</span>
        <Button type="button" variant="outline" size="sm" onClick={finance.retry}>{t('ui.listState.retry', 'Retry')}</Button>
      </div>}

      <section aria-label={t('finance:area.viewInvoicesOrPayments', 'Receivables list')} className="order-3 min-w-0 sm:order-5">
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
            ? <SalesInvoices embedded onRecordPayment={recordPayment} secondaryAction={canCreatePayment ? { label: t('financeCopy.receivePayment', 'Receive payment'), onSelect: openNewPayment } : undefined} />
            : <IncomingPayments embedded secondaryAction={canCreateInvoice ? { label: t('finance:area.newInvoice', 'New invoice'), onSelect: openNewInvoice } : undefined} />}
        </div>
      </section>
    </div>
    </FigureScope>
  );
}
