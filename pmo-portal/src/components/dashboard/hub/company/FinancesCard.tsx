import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHead } from '@/src/components/ui/Card';
import { cn } from '@/src/components/ui/cn';
import { ListState } from '@/src/components/ui/ListState';
import { formatTileMoney } from '@/src/lib/format';
import { moneyTileValue } from '@/src/components/dashboard/dashMoney';
import { BarList } from '@/src/components/dashboard/charts';
import { orderByCurrency } from '@/src/components/dashboard/restructure/currencyOrder';
import type { OwedSplit } from '@/src/components/dashboard/restructure/useCompanyFigures';
import { CardLink } from './OverviewCards';
import { owedShares, owedTotals } from './owedSplit';

const money = (amount: number, currency: string) => formatTileMoney(amount, currency) ?? '';

/**
 * One side of what is owed: the known total (one currency per line), one bar split into not yet due and overdue
 * (overdue in the exception colour, widths by share, each part named with its amount), and one line of counts.
 * An unknown balance is named on its own line per currency with the amount invoiced behind it, never drawn and never
 * added as zero.
 */
const OwedFigure: React.FC<{
  testId: string;
  title: string;
  split: OwedSplit | undefined;
  pending: boolean;
  error: boolean;
  retry: () => void;
  currency: string;
  countLine: (split: OwedSplit) => string;
  errorTitle: string;
}> = ({ testId, title, split, pending, error, retry, currency, countLine, errorTitle }) => {
  const { t } = useTranslation('dashboard');
  const totals = split ? owedTotals(split) : [];
  const figure = moneyTileValue(totals.length > 0 ? totals : split && split.unknownBalances === 0 ? [{ currency, amount: 0 }] : null, currency);
  const barCurrency = totals.find((row) => row.currency === currency) ? currency : totals[0]?.currency ?? currency;
  const shares = split ? owedShares(split, barCurrency) : null;
  return (
    <section data-testid={testId} aria-label={title} className="grid min-w-0 content-start gap-2 px-[var(--panel-inset)] py-4">
      <h3 className="text-control font-medium">{title}</h3>
      {pending ? <ListState variant="loading" rows={2} />
        : error || !split ? <ListState variant="error" title={errorTitle} onRetry={retry} />
          : (
            <>
              {figure && <div className="text-metric font-semibold tracking-[-0.02em] tabular" title={figure.exact}>{figure.value}</div>}
              <div data-testid={`${testId}-bar`} aria-hidden className={cn('flex h-2.5 gap-0.5 overflow-hidden rounded-full', !shares && 'bg-muted')}>
                {shares && shares.notDue > 0 && <span data-testid={`${testId}-not-due`} className="h-full bg-primary" style={{ flexGrow: shares.notDue, flexBasis: 0 }} />}
                {shares && shares.overdue > 0 && <span data-testid={`${testId}-overdue`} className="h-full bg-destructive" style={{ flexGrow: shares.overdue, flexBasis: 0 }} />}
              </div>
              {shares && (
                <div className="flex flex-wrap justify-between gap-x-4 text-control tabular">
                  {shares.notDueAmount > 0 && <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px] bg-primary" />{t('home.notYetDue', 'Not yet due')} {money(shares.notDueAmount, barCurrency)}</span>}
                  {shares.overdueAmount > 0 && <span className="inline-flex items-center gap-1.5 text-destructive-text"><span aria-hidden className="size-2.5 rounded-[3px] bg-destructive" />{t('home.overdueShort', 'Overdue')} {money(shares.overdueAmount, barCurrency)}</span>}
                </div>
              )}
              <p className="text-control text-muted-foreground">{countLine(split)}</p>
              {/* One line per currency behind an unknown balance, the organisation currency first: the count and what is
                  invoiced behind it, so a large unknown cannot hide behind a small known total. */}
              {split.unknownLines.length > 0 && (
                <div data-testid={`${testId}-unknown`} className="-mt-2 grid gap-0.5 text-control text-muted-foreground">
                  {orderByCurrency(split.unknownLines, currency).map((line) => (
                    <p key={line.currency} data-testid={`${testId}-unknown-line`}>
                      {line.invoiced === null
                        ? t('home.balancesUnknown', { count: line.count, defaultValue_one: '{{count}} invoice, balance not reported', defaultValue_other: '{{count}} invoices, balance not reported' })
                        : t('home.balancesUnknownInvoiced', {
                          count: line.count,
                          amount: formatTileMoney(line.invoiced, line.currency, { code: line.currency !== currency }) ?? '',
                          defaultValue_one: '{{count}} invoice, {{amount}} invoiced, balance not reported',
                          defaultValue_other: '{{count}} invoices, {{amount}} invoiced, balance not reported',
                        })}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
    </section>
  );
};

/**
 * Finances: what is owed each way, money in by month, and what is still to bill (or, for finance, owed by age).
 * The pair of owed figures sits at the top so a later cash forecast can take the block's top without a rebuild.
 */
export const FinancesCard: React.FC<{
  className?: string;
  currency: string;
  receivables: OwedSplit | undefined;
  receivablesPending: boolean;
  receivablesError: boolean;
  payables: OwedSplit | undefined;
  payablesPending: boolean;
  payablesError: boolean;
  retry: () => void;
  chart: React.ReactNode;
  leftToBill?: { rows: Array<{ id: string; name: string; amount: number }> | undefined; pending: boolean; error: boolean };
  extra?: React.ReactNode;
}> = ({ className, currency, receivables, receivablesPending, receivablesError, payables, payablesPending, payablesError, retry, chart, leftToBill, extra }) => {
  const { t } = useTranslation('dashboard');
  const receivableLine = (split: OwedSplit) => split.count === 0 ? t('home.noOpenInvoices', 'No open client invoices') : [
    t('home.openInvoiceCount', { count: split.count, defaultValue_one: '{{count}} invoice', defaultValue_other: '{{count}} invoices' }),
    split.oldestDays !== null ? t('home.oldestOverdueDays', 'oldest {{days}} days overdue', { days: split.oldestDays }) : null,
  ].filter(Boolean).join(' · ');
  const payableLine = (split: OwedSplit) => split.count === 0 ? t('home.noSupplierInvoices', 'No supplier invoice to pay') : [
    t('home.supplierInvoiceCount', { count: split.count, defaultValue_one: '{{count}} supplier invoice', defaultValue_other: '{{count}} supplier invoices' }),
    split.oldestDays !== null ? t('home.oldestDaysOld', 'oldest {{days}} days', { days: split.oldestDays }) : null,
  ].filter(Boolean).join(' · ');
  const topProjects = leftToBill?.rows?.slice(0, 3) ?? [];
  const leftTitle = t('home.leftToBillByProject', 'Left to bill by project');
  return (
    <Card data-testid="finances" className={cn('flex flex-col', className)}>
      <CardHead level={2} className="max-[479px]:flex-wrap max-[479px]:[&>div:last-child]:ml-0 max-[479px]:[&>div:last-child]:basis-full" actions={<span className="flex flex-wrap gap-x-4"><CardLink to="/finance/receivables">{t('home.openReceivables', 'Open receivables')}</CardLink><CardLink to="/finance/payables">{t('home.openPayables', 'Open payables')}</CardLink></span>}>{t('home.finances', 'Finances')}</CardHead>
      <div className="grid border-y border-border min-[480px]:grid-cols-2 min-[480px]:divide-x max-[479px]:divide-y divide-border">
        <OwedFigure testId="owed-to-us" title={t('home.owedToUs', 'Owed to us')}
          split={receivables} pending={receivablesPending} error={receivablesError} retry={retry} currency={currency} countLine={receivableLine}
          errorTitle={t('home.receivablesError', "Couldn't load client invoices")} />
        <OwedFigure testId="owed-to-suppliers" title={t('home.owedToSuppliers', 'Owed to suppliers')}
          split={payables} pending={payablesPending} error={payablesError} retry={retry} currency={currency} countLine={payableLine}
          errorTitle={t('home.payablesError', "Couldn't load supplier invoices")} />
      </div>
      <div className="flex flex-col gap-5 px-[var(--panel-inset)] pb-4 pt-4">
        {chart}
        {extra}
        {leftToBill && (leftToBill.pending || leftToBill.error || topProjects.length > 0) && (
          <section data-testid="left-to-bill-projects" aria-label={leftTitle}>
            <div className="mb-2 flex items-baseline justify-between gap-3"><h3 className="text-control font-semibold">{leftTitle}</h3><CardLink to="/finance/reports">{t('home.openReports', 'Open reports')}</CardLink></div>
            {leftToBill.pending ? <ListState variant="loading" shape="chart" rows={2} />
              : leftToBill.error ? <ListState variant="error" title={t('home.leftToBillError', "Couldn't load what is left to bill")} onRetry={retry} />
                : <BarList rows={topProjects.map((row) => ({ id: row.id, name: row.name, value: row.amount, label: money(row.amount, currency), tone: 'neutral' }))} ariaLabel={leftTitle} />}
          </section>
        )}
      </div>
    </Card>
  );
};
