import { buttonClasses } from '@/src/components/ui/buttonClasses';
import React from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, LateText, ListState, isMostUrgentLateRow } from '@/src/components/ui';
import type { FinancePosition } from '@/src/lib/finance/financePosition';
import { deriveArDueDate } from '@/src/lib/repositories/revenueDisplay';
import { formatCurrency, formatDay } from '@/src/lib/format';
import { currencyLines } from '@/src/lib/finance/currencyFigures';
import { invoiceGross, invoiceNumber, isPartlyPaid } from '@/src/lib/revenue/nativeInvoice';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { payableDueState } from '@/src/lib/finance/payableDueState';

export interface FinanceAttentionProps {
  position: FinancePosition;
  scope: 'receivables' | 'all';
  canAct: boolean;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  withLayout: (path: string) => string;
  orgCurrency?: string | null;
  showOverdueUnknownCount?: boolean;
  projects?: Map<string, { name?: string | null; short_name?: string | null; pm?: { full_name?: string | null } | null }>;
}

interface WaitingItem {
  key: string;
  count: number;
  label: string;
  detail: string[];
  to: string;
  action?: string;
}

export const FinanceAttention: React.FC<FinanceAttentionProps> = ({
  position, scope, canAct, isPending, isError, onRetry, withLayout, orgCurrency, showOverdueUnknownCount = true, projects = new Map(),
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const draftsToApprove = canAct ? position.drafts.canApprove.length : position.drafts.all.length;
  const oldestAge = position.payables.find((payable) => payable.ageDays != null)?.ageDays;
  const payablesOverdue = position.payables.filter((payable) => payableDueState(payable.ageDays) === 'overdue').length;
  const payablesOverdueLine = payablesOverdue > 0 ? [t('financeHub:hub.fix.waiting.payablesOverdue', { defaultValue: '{{count}} overdue', count: payablesOverdue })] : [];
  const unknownBalance = t('financeHub:hub.fix.finding.unknownBalance', 'Balance unknown');
  const waiting: WaitingItem[] = [
    ...(draftsToApprove > 0 ? [{
      key: 'approve', count: draftsToApprove,
      label: t('financeHub:hub.fix.waiting.draftsApprove', { defaultValue: '{{count}} draft to approve', count: draftsToApprove }),
      detail: [],
      to: '/finance/receivables?todo=approve', action: t('financeHub:hub.fix.waiting.review', 'Review'),
    }] : []),
    ...(canAct && position.drafts.awaitingOther.length > 0 ? [{
      key: 'second', count: position.drafts.awaitingOther.length,
      label: t('financeHub:hub.fix.waiting.draftsSecond', { defaultValue: '{{count}} draft waiting for a second approver', count: position.drafts.awaitingOther.length }),
      detail: [],
      to: '/finance/receivables?todo=second', action: t('financeHub:hub.fix.waiting.review', 'Review'),
    }] : []),
    ...(position.toSend.length > 0 ? [{
      key: 'send', count: position.toSend.length,
      label: t('financeHub:hub.fix.waiting.toSend', { defaultValue: '{{count}} invoices not delivered yet', count: position.toSend.length }),
      detail: [],
      to: '/finance/receivables?todo=send', action: t('financeHub:hub.fix.waiting.markReceived', 'Record delivery'),
    }] : []),
    ...(position.unappliedPayments.length > 0 ? [{
      key: 'unapplied', count: position.unappliedPayments.length,
      label: t('financeHub:hub.fix.waiting.unapplied', { defaultValue: '{{count}} payments not yet applied', count: position.unappliedPayments.length }),
      detail: currencyLines(position.unappliedTotals, orgCurrency),
      to: '/finance/receivables?view=payments&todo=unapplied', action: t('financeHub:hub.fix.waiting.apply', 'Apply'),
    }] : []),
    ...(scope === 'all' && position.payables.length > 0 ? [{
      key: 'payables', count: position.payables.length,
      label: t('financeHub:hub.fix.waiting.payables', { defaultValue: '{{count}} supplier invoices to pay', count: position.payables.length }),
      // L6: the known amount lives on the Payables figure; this row adds the age (or says the balance is unknown).
      detail: oldestAge == null
        ? (currencyLines(position.payablesTotals, orgCurrency).length > 0 ? [] : [unknownBalance])
        : currencyLines(position.payablesTotals, orgCurrency).length > 0
          ? [[...payablesOverdueLine, t('financeHub:hub.fix.waiting.payablesOldest', { defaultValue: 'Oldest {{days}} days', days: oldestAge })].join(' · ')]
          : [t('financeHub:hub.fix.waiting.payablesDetail', { defaultValue: '{{amount}} · oldest {{days}} days', amount: unknownBalance, days: oldestAge })],
      to: '/finance/payables', action: t('financeHub:hub.fix.waiting.openPayables', 'Open payables'),
    }] : []),
  ];

  // Loading and failed reads keep the card's filled structure: the same rows, filling the height its neighbour gives it.
  if (isPending) {
    return (
      <div data-testid="finance-attention-loading" role="status" aria-busy="true" className="flex min-w-0 flex-1 flex-col">
        <div aria-hidden="true" className="divide-y divide-border">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex min-w-0 items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1 space-y-2"><span className="skel block h-3.5 w-3/4" /><span className="skel block h-3 w-1/2" /></span>
              <span className="skel block h-8 w-20 shrink-0" />
            </div>
          ))}
        </div>
        <p className="pt-3 text-control text-muted-foreground">{t('ui.listState.loading', 'Loading…')}</p>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex min-w-0 flex-1 flex-col justify-end">
        <ListState variant="error" quiet title={t('finance:area.attentionLoadError', "Couldn't load finance activity")} onRetry={onRetry} />
      </div>
    );
  }

  const overdueCount = position.overdue.length;
  const overdueRows = position.overdue.slice(0, 5);
  const overdueCurrencyLines = currencyLines(position.overdueTotals, orgCurrency);
  if (overdueCount === 0 && waiting.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">{t('finance:area.nothingWaiting', 'Nothing overdue or waiting.')}</p>;
  }

  return (
    <section aria-label={t('finance:area.attention', 'Finance attention')} className="@container grid min-w-0 grid-cols-1 gap-0">
      {overdueCount > 0 && (
        <div>
          <h2 className="mb-2 text-group font-semibold text-foreground">
              <span className="text-destructive-text">{t('financeHub:hub.fix.overdue.headingCount', { defaultValue: overdueCount === 1 ? 'Overdue · {{count}} invoice' : 'Overdue · {{count}} invoices', count: overdueCount })}</span>
              {/* Every currency on the one heading line: "· $640,000 · Rp 12,000,000", never a stack of lines. */}
              {overdueCurrencyLines.length > 0 && <span className="font-normal"> · {overdueCurrencyLines.join(' · ')}</span>}
              {showOverdueUnknownCount && position.overdueUnknownCount > 0 && <span className="font-normal text-muted-foreground">{t('financeHub:hub.fix.overdue.unknownCount', { defaultValue: position.overdueUnknownCount === 1 ? ' · {{count}} balance unknown' : ' · {{count}} balances unknown', count: position.overdueUnknownCount })}</span>}
          </h2>
          <div className="divide-y divide-border">
            {overdueRows.map((entry) => {
              const { invoice, daysOverdue, outstanding } = entry;
              const isUrgent = isMostUrgentLateRow(overdueRows, entry);
              const project = invoice.project_id ? projects.get(invoice.project_id) : undefined;
              const client = invoice.customer_name ?? t('finance:area.unknownClient', 'Unknown client');
              const dueDate = deriveArDueDate(invoice.invoice_date, invoice.erp_payment_terms_days, invoice.erp_due_date, invoice.received_date);
              const partlyPaid = isPartlyPaid(invoice);
              const gross = invoiceGross(invoice);
              const href = withLayout(`/finance/receivables?open=${encodeURIComponent(invoice.id)}`);
              return (
                <Link
                  key={invoice.id}
                  to={href}
                  aria-label={t('financeHub:hub.fix.overdue.openInvoice', { defaultValue: 'Open {{client}} invoice {{number}}', client, number: invoiceNumber(invoice) ?? '—' })}
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 py-3 hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {/* One row reads: who · which invoice (never broken) | what is still owed; then how late, and for what. */}
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="min-w-0 break-words font-normal">{client}</span>
                    <span data-testid="finance-attention-number" className="whitespace-nowrap font-mono text-control text-muted-foreground">{invoiceNumber(invoice) ?? '—'}</span>
                  </span>
                  <span className="text-right">
                    {/* C4: an unknown balance is left out here; the heading counts it once ("· 1 balance unknown"). */}
                    {outstanding != null && (
                      <span data-testid="finance-attention-outstanding" className="whitespace-nowrap tabular text-sm font-semibold text-foreground">{formatCurrency(outstanding / 100, invoice.currency)}</span>
                    )}
                  </span>
                  <span className="min-w-0 break-words text-control text-muted-foreground">
                    <LateText tone="destructive" emphasis={isUrgent}>{partlyPaid
                      ? t('finance:receivables.statusPartlyPaidLate', { count: daysOverdue, n: String(daysOverdue), defaultValue_one: 'Partly paid · {{n}} day overdue', defaultValue_other: 'Partly paid · {{n}} days overdue' })
                      : t('status:age.overdue', { count: daysOverdue, n: String(daysOverdue), defaultValue_one: '{{n}} day overdue', defaultValue_other: '{{n}} days overdue' })}</LateText>
                    {' · '}{project ? projectDisplayName(project) : t('financeHub:hub.fix.overdue.unknownProject', 'Project unavailable')} · {t('financeHub:hub.fix.overdue.due', { defaultValue: 'Due {{date}}', date: dueDate ? formatDay(dueDate) : '—' })}
                  </span>
                  <span className="text-right">
                    {outstanding != null && gross != null && <span className="whitespace-nowrap tabular text-control text-muted-foreground">{t('financeHub:hub.fix.overdue.ofGross', { defaultValue: 'of {{amount}}', amount: formatCurrency(gross, invoice.currency) })}</span>}
                  </span>
                </Link>
              );
            })}
          </div>
          {overdueCount > 5 && (
            <Link className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary-text underline-offset-2 hover:underline" to={withLayout('/finance/receivables?overdue=true')}>
              {t('finance:area.showAllOverdue', 'Show all {{count}} overdue', { count: overdueCount })}
            </Link>
          )}
        </div>
      )}

      {waiting.length > 0 && (
        <div className={overdueCount > 0 ? "mt-[var(--space-panel-gap)] border-t border-border pt-[var(--space-panel-gap)]" : undefined}>
          {canAct && <h2 className="mb-1 text-group font-semibold text-foreground">{t('finance:area.waitingOnYou', 'Waiting on you')}</h2>}
          <div className="divide-y divide-border">
            {waiting.map((item) => (
              <div key={item.key} className="flex min-w-0 items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-control font-normal">{item.label}</span>
                  {item.detail.map((line, index) => <span key={`${item.key}-${index}`} className="block break-words text-control text-muted-foreground">{line}</span>)}
                </span>
                {item.key === 'payables' ? (
                  <Link to={withLayout(item.to)} className={buttonClasses('outline', 'sm', 'shrink-0')}>{item.action}</Link>
                ) : canAct && <Button variant="outline" size="sm" onClick={() => navigate(withLayout(item.to))}>{item.action}</Button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
