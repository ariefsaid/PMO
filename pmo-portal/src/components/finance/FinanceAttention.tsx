import React from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState } from '@/src/components/ui';
import type { FinancePosition } from '@/src/lib/finance/financePosition';
import { formatCurrencyCents } from '@/src/lib/format';
import { invoiceNumber } from '@/src/lib/revenue/nativeInvoice';

export interface FinanceAttentionProps {
  position: FinancePosition;
  scope: 'receivables' | 'all';
  canAct: boolean;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  withLayout: (path: string) => string;
}

function currencyLine(values: Record<string, number>): string {
  return Object.entries(values)
    .map(([currency, cents]) => formatCurrencyCents(cents, currency))
    .join(' · ');
}

export const FinanceAttention: React.FC<FinanceAttentionProps> = ({
  position,
  scope,
  canAct,
  isPending,
  isError,
  onRetry,
  withLayout,
}) => {
  const { t } = useTranslation();
  const location = useLocation();
  const listPath = `${location.pathname}${location.search}${location.hash}`;
  const draftsToApprove = canAct ? position.drafts.canApprove.length : position.drafts.all.length;
  const draftsWaitingForSecond = canAct ? position.drafts.awaitingOther.length : 0;
  const waiting = [
    draftsToApprove > 0 && {
      key: 'approve',
      label: t('finance:area.draftsToApprove', '{{count}} drafts to approve', { count: draftsToApprove }),
      to: '/finance/receivables?todo=approve',
    },
    draftsWaitingForSecond > 0 && {
      key: 'second',
      label: t('finance:area.draftsWaitingForSecond', '{{count}} drafts waiting for a second approver', { count: draftsWaitingForSecond }),
      to: '/finance/receivables?todo=second',
    },
    position.toSend.length > 0 && {
      key: 'send',
      label: t('finance:area.approvedNotReceived', '{{count}} approved, not yet marked received', { count: position.toSend.length }),
      to: '/finance/receivables?todo=send',
    },
    position.unappliedPayments.length > 0 && {
      key: 'unapplied',
      label: t('finance:area.paymentsNotApplied', '{{count}} payments not yet applied · {{amount}}', {
        count: position.unappliedPayments.length,
        amount: currencyLine(position.unappliedTotals),
      }),
      to: '/finance/receivables?view=payments&todo=unapplied',
    },
    scope === 'all' && position.payables.length > 0 && {
      key: 'payables',
      label: t('finance:area.supplierInvoicesWaiting', '{{count}} supplier invoices waiting to be paid · {{amount}} · oldest {{days}} days', {
        count: position.payables.length,
        amount: currencyLine(position.payablesTotals),
        days: position.payables[0]?.ageDays ?? 0,
      }),
      to: '/finance/payables',
    },
  ].filter((row): row is { key: string; label: string; to: string } => Boolean(row));

  if (isPending) return <ListState variant="loading" rows={4} testId="finance-attention-loading" />;
  if (isError) {
    return (
      <ListState
        variant="error"
        title={t('finance:area.attentionLoadError', "Couldn't load finance activity")}
        onRetry={onRetry}
      />
    );
  }

  const overdueCount = position.overdue.length;
  const total = currencyLine(position.overdueTotals);

  if (overdueCount === 0 && waiting.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">{t('finance:area.nothingWaiting', 'Nothing overdue or waiting.')}</p>;
  }

  return (
    <section aria-label={t('finance:area.attention', 'Finance attention')} className="space-y-4">
      {overdueCount > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold">
            {t('finance:area.overdueHeading', 'Overdue · {{count}} invoices{{amount}}', {
              count: overdueCount,
              amount: total ? ` · ${total}` : '',
            })}
            {position.overdueUnknownCount > 0 && (
              <span className="text-muted-foreground">{t('finance:area.unknownBalanceCount', ' · {{count}} with unknown balance', { count: position.overdueUnknownCount })}</span>
            )}
          </h2>
          <div className="divide-y divide-border border-y border-border">
            {position.overdue.slice(0, 5).map(({ invoice, daysOverdue, outstanding }) => (
              <Link
                key={invoice.id}
                to={withLayout(`/sales-invoices/${encodeURIComponent(invoice.id)}`)}
                state={{ recordContext: { listPath } }}
                aria-label={t('finance:area.openOverdueInvoice', 'Open {{client}} invoice {{number}}, {{days}} days overdue', {
                  client: invoice.customer_name ?? t('finance:area.unknownClient', 'Unknown client'),
                  number: invoiceNumber(invoice) ?? '—',
                  days: daysOverdue,
                })}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2.5 hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{invoice.customer_name ?? t('finance:area.unknownClient', 'Unknown client')}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">{invoiceNumber(invoice) ?? '—'}</span>
                </span>
                <span className="text-right">
                  <span className="block text-sm font-medium text-warning-foreground">{t('finance:area.daysOverdue', '{{count}} days overdue', { count: daysOverdue })}</span>
                  <span className={`block tabular text-sm ${outstanding == null ? 'text-muted-foreground' : ''}`}>
                    {outstanding == null
                      ? t('finance:area.balanceUnknown', 'Balance unknown')
                      : formatCurrencyCents(outstanding, invoice.currency)}
                  </span>
                </span>
              </Link>
            ))}
          </div>
          <Link className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary-text underline-offset-2 hover:underline" to={withLayout('/finance/receivables?overdue=true')}>
            {t('finance:area.showAllOverdue', 'Show all {{count}} overdue', { count: overdueCount })}
          </Link>
        </div>
      )}

      {waiting.length > 0 && (
        <div>
          <h2 className="mb-1 text-sm font-semibold">{canAct ? t('finance:area.waitingOnYou', 'Waiting on you') : t('finance:area.waitingOnFinance', 'Waiting on Finance')}</h2>
          <div className="divide-y divide-border border-y border-border">
            {waiting.map((item) => (
              <Link key={item.key} to={withLayout(item.to)} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                <span>{item.label}</span>
                <span aria-hidden="true" className="text-muted-foreground">›</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
