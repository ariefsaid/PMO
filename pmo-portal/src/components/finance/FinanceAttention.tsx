import React from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ListState, StatusPill, Tooltip } from '@/src/components/ui';
import type { FinancePosition } from '@/src/lib/finance/financePosition';
import { deriveArDueDate } from '@/src/lib/repositories/revenueDisplay';
import { formatCurrency, formatDateOnly } from '@/src/lib/format';
import { formatCurrencyWithCode } from '@/src/lib/finance/format';
import { invoiceGross, invoiceNumber, isPartlyPaid } from '@/src/lib/revenue/nativeInvoice';
import { projectDisplayName } from '@/src/lib/projectDisplayName';

export interface FinanceAttentionProps {
  position: FinancePosition;
  scope: 'receivables' | 'all';
  canAct: boolean;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  withLayout: (path: string) => string;
  orgCurrency?: string | null;
  projects?: Map<string, { name?: string | null; short_name?: string | null; pm?: { full_name?: string | null } | null }>;
}

function currencyEntries(values: Record<string, number>, preferred?: string | null) {
  return Object.entries(values).sort(([left], [right]) => left === preferred ? -1 : right === preferred ? 1 : left.localeCompare(right));
}

function currencyLines(values: Record<string, number>, preferred?: string | null): string[] {
  return currencyEntries(values, preferred).map(([currency, cents], index) => index === 0
    ? formatCurrency(cents / 100, currency)
    : formatCurrencyWithCode(cents / 100, currency));
}

function initials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

interface WaitingItem {
  key: string;
  count: number;
  label: string;
  detail: string[];
  hint: string;
  to: string;
  action?: string;
}

export const FinanceAttention: React.FC<FinanceAttentionProps> = ({
  position, scope, canAct, isPending, isError, onRetry, withLayout, orgCurrency, projects = new Map(),
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const draftsToApprove = canAct ? position.drafts.canApprove.length : position.drafts.all.length;
  const waiting: WaitingItem[] = [
    ...(draftsToApprove > 0 ? [{
      key: 'approve', count: draftsToApprove,
      label: t('financeHub:hub.fix.waiting.draftsApprove', { defaultValue: '{{count}} draft to approve', count: draftsToApprove }),
      detail: [t('financeHub:hub.fix.waiting.draftsApproveDetail', 'Invoices waiting for your approval')],
      hint: t('financeHub:hub.fix.waiting.draftsApproveHint', 'Draft invoices that you can approve.'), to: '/finance/receivables?todo=approve', action: t('financeHub:hub.fix.waiting.review', 'Review'),
    }] : []),
    ...(canAct && position.drafts.awaitingOther.length > 0 ? [{
      key: 'second', count: position.drafts.awaitingOther.length,
      label: t('financeHub:hub.fix.waiting.draftsSecond', { defaultValue: '{{count}} draft waiting for a second approver', count: position.drafts.awaitingOther.length }),
      detail: [t('financeHub:hub.fix.waiting.draftsSecondDetail', 'Your invoices need another approver')],
      hint: t('financeHub:hub.fix.waiting.draftsSecondHint', 'Your draft invoices that need another approver.'), to: '/finance/receivables?todo=second', action: t('financeHub:hub.fix.waiting.review', 'Review'),
    }] : []),
    ...(position.toSend.length > 0 ? [{
      key: 'send', count: position.toSend.length,
      label: t('financeHub:hub.fix.waiting.toSend', { defaultValue: '{{count}} approved invoices to mark received', count: position.toSend.length }),
      detail: [t('financeHub:hub.fix.waiting.toSendDetail', 'Approved invoices without a received date')],
      hint: t('financeHub:hub.fix.waiting.toSendHint', 'Active invoices with no received date recorded.'), to: '/finance/receivables?todo=send', action: t('financeHub:hub.fix.waiting.markReceived', 'Mark received'),
    }] : []),
    ...(position.unappliedPayments.length > 0 ? [{
      key: 'unapplied', count: position.unappliedPayments.length,
      label: t('financeHub:hub.fix.waiting.unapplied', { defaultValue: '{{count}} payments not yet applied', count: position.unappliedPayments.length }),
      detail: currencyLines(position.unappliedTotals, orgCurrency),
      hint: t('financeHub:hub.fix.waiting.unappliedHint', 'Known unapplied amounts for active receipts.'), to: '/finance/receivables?view=payments&todo=unapplied', action: t('financeHub:hub.fix.waiting.apply', 'Apply'),
    }] : []),
    ...(scope === 'all' && position.payables.length > 0 ? [{
      key: 'payables', count: position.payables.length,
      label: t('financeHub:hub.fix.waiting.payables', { defaultValue: '{{count}} supplier invoices waiting to be paid', count: position.payables.length }),
      // L6: the known amount lives on the Payables figure; this row adds the age (or says the balance is unknown).
      detail: currencyLines(position.payablesTotals, orgCurrency).length > 0
        ? [t('financeHub:hub.fix.waiting.payablesOldest', { defaultValue: 'Oldest {{days}} days', days: position.payables[0]?.ageDays ?? 0 })]
        : [t('financeHub:hub.fix.waiting.payablesDetail', { defaultValue: '{{amount}} · oldest {{days}} days', amount: t('financeHub:hub.fix.finding.unknownBalance', 'Balance unknown'), days: position.payables[0]?.ageDays ?? 0 })],
      hint: t('financeHub:hub.fix.waiting.payablesHint', 'Recorded supplier invoices still waiting to be paid.'), to: '/finance/payables', action: t('financeHub:hub.fix.waiting.openPayables', 'Open payables'),
    }] : []),
  ];

  if (isPending) return <ListState variant="loading" rows={4} testId="finance-attention-loading" />;
  if (isError) return <ListState variant="error" title={t('finance:area.attentionLoadError', "Couldn't load finance activity")} onRetry={onRetry} />;

  const overdueCount = position.overdue.length;
  const overdueCurrencyLines = currencyLines(position.overdueTotals, orgCurrency);
  if (overdueCount === 0 && waiting.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">{t('finance:area.nothingWaiting', 'Nothing overdue or waiting.')}</p>;
  }

  return (
    <section aria-label={t('finance:area.attention', 'Finance attention')} className="grid min-w-0 grid-cols-1 gap-6">
      {overdueCount > 0 && (
        <div>
          <Tooltip content={t('financeHub:hub.overdueHint', 'Count of open invoices past their derived due date; total sums known outstanding balances, including tax, by currency.')}>
            <h2 tabIndex={0} className="mb-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
              {overdueCurrencyLines[0]
                ? t('financeHub:hub.fix.overdue.heading', { defaultValue: overdueCount === 1 ? 'Overdue · {{amount}} from {{count}} invoice' : 'Overdue · {{amount}} from {{count}} invoices', count: overdueCount, amount: overdueCurrencyLines[0] })
                : t('financeHub:hub.fix.overdue.headingCount', { defaultValue: overdueCount === 1 ? 'Overdue · {{count}} invoice' : 'Overdue · {{count}} invoices', count: overdueCount })}
              {/* C4: the one place an unknown overdue balance is said; the rows carry no placeholder. */}
              {position.overdueUnknownCount > 0 && <span className="font-normal text-muted-foreground">{t('financeHub:hub.fix.overdue.unknownCount', { defaultValue: position.overdueUnknownCount === 1 ? ' · {{count}} balance unknown' : ' · {{count}} balances unknown', count: position.overdueUnknownCount })}</span>}
            </h2>
          </Tooltip>
          {overdueCurrencyLines.slice(1).map((amount) => <p key={amount} className="mb-2 text-xs text-muted-foreground">{amount}</p>)}
          <div className="divide-y divide-border">
            {position.overdue.slice(0, 5).map(({ invoice, daysOverdue, outstanding }) => {
              const project = invoice.project_id ? projects.get(invoice.project_id) : undefined;
              const pm = project?.pm?.full_name?.trim();
              const client = invoice.customer_name ?? t('finance:area.unknownClient', 'Unknown client');
              const avatarLabel = pm || client;
              const dueDate = deriveArDueDate(invoice.invoice_date, invoice.erp_payment_terms_days, invoice.erp_due_date, invoice.received_date);
              const partlyPaid = isPartlyPaid(invoice);
              const gross = invoiceGross(invoice);
              const href = withLayout(`/finance/receivables?open=${encodeURIComponent(invoice.id)}`);
              return (
                <Link
                  key={invoice.id}
                  to={href}
                  aria-label={t('financeHub:hub.fix.overdue.openInvoice', { defaultValue: 'Open {{client}} invoice {{number}}', client, number: invoiceNumber(invoice) ?? '—' })}
                  className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-3 hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span role="img" aria-label={avatarLabel} title={avatarLabel} className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground">{initials(avatarLabel)}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{client}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{invoiceNumber(invoice) ?? '—'}</span>
                    <span className="block truncate text-xs text-muted-foreground">{project ? projectDisplayName(project) : t('financeHub:hub.fix.overdue.unknownProject', 'Project unavailable')}</span>
                    <span className="block text-xs text-muted-foreground">{t('financeHub:hub.fix.overdue.due', { defaultValue: 'Due {{date}}', date: dueDate ? formatDateOnly(dueDate) : '—' })}</span>
                  </span>
                  <span className="min-w-0 text-right">
                    <StatusPill variant={partlyPaid ? 'warn' : 'lost'}>{partlyPaid ? t('financeHub:hub.fix.overdue.partlyPaid', { defaultValue: 'Partly paid · {{days}} days late', days: daysOverdue }) : t('financeHub:hub.fix.overdue.overdue', { defaultValue: 'Overdue · {{days}} days', days: daysOverdue })}</StatusPill>
                    {/* C4: an unknown balance is left out here; the heading counts it once ("· 1 balance unknown"). */}
                    {outstanding != null && (
                      <>
                        <span className="mt-1 block whitespace-nowrap tabular text-sm font-semibold">{formatCurrency(outstanding / 100, invoice.currency)}</span>
                        {gross != null && <span className="block whitespace-nowrap tabular text-xs text-muted-foreground">{t('financeHub:hub.fix.overdue.ofGross', { defaultValue: 'of {{amount}}', amount: formatCurrency(gross, invoice.currency) })}</span>}
                      </>
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
          <Link className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary-text underline-offset-2 hover:underline" to={withLayout('/finance/receivables?overdue=true')}>
            {t('finance:area.showAllOverdue', 'Show all {{count}} overdue', { count: overdueCount })}
          </Link>
        </div>
      )}

      {waiting.length > 0 && (
        <div>
          {canAct && <h2 className="mb-1 text-sm font-semibold">{t('finance:area.waitingOnYou', 'Waiting on you')}</h2>}
          <div className="divide-y divide-border">
            {waiting.map((item) => (
              <div key={item.key} className="flex min-w-0 items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <Tooltip content={item.hint}><span tabIndex={0} className="block text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{item.label}</span></Tooltip>
                  {item.detail.map((line, index) => <span key={`${item.key}-${index}`} className="block truncate text-xs text-muted-foreground">{line}</span>)}
                </span>
                {item.key === 'payables' ? (
                  <Link to={withLayout(item.to)} className="inline-flex min-h-8 shrink-0 items-center rounded-md border border-input px-3 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{item.action}</Link>
                ) : canAct && <Button variant="outline" size="sm" onClick={() => navigate(withLayout(item.to))}>{item.action}</Button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
