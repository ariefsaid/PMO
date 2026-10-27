import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { useFeature } from '@/src/auth/useFeature';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { AccessDenied, Button, Icon, ListState, Tooltip } from '@/src/components/ui';
import { AgeingStrip } from '@/src/components/finance/AgeingStrip';
import { FinanceAttention } from '@/src/components/finance/FinanceAttention';
import { useFinancePosition } from '@/src/hooks/useFinancePosition';
import { useManagementPack } from '@/src/hooks/useManagementPack';
import { useFinancialStatement, useFinancialStatementCatalogue } from '@/src/hooks/useFinancialStatements';
import { formatCurrencyAuto, formatCurrencyCents, formatMonthYear } from '@/src/lib/format';
import type { FinancialStatementNativePayload } from '@/src/lib/financialStatements';

function currencyLine(values: Record<string, number>): string {
  return Object.entries(values)
    .map(([currency, cents]) => formatCurrencyCents(cents / 100, currency))
    .join(' · ');
}

function monthLabel(date: string): string {
  return formatMonthYear(new Date(`${date.slice(0, 10)}T12:00:00Z`));
}

function netProfit(payload: FinancialStatementNativePayload): number | null {
  const current = payload.current;
  const row = current.rows.find((item) => {
    const label = typeof item.account_name === 'string' ? item.account_name : item.account;
    return typeof label === 'string' && /profit for the period/i.test(label.replaceAll("'", ''));
  });
  const amountColumn = current.columns.find((column) => column.type === 'currency' && column.fieldname !== 'total' && !column.hidden);
  if (!row || !amountColumn) return null;
  const value = row[amountColumn.fieldname];
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

interface AreaCardProps {
  title: string;
  to: string;
  detail: string;
  hint: string;
  loading?: boolean;
  error?: boolean;
  retry?: () => void;
}

const AreaCard: React.FC<AreaCardProps> = ({ title, to, detail, hint, loading = false, error = false, retry }) => {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 border-b border-border py-3 first:border-t sm:border-t">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to={to} className="font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            {title}
          </Link>
          {loading ? (
            <div role="status" aria-label={t('financeHub:hub.loadingFigure', 'Loading figure')} className="mt-1 h-5 w-32 animate-pulse rounded bg-muted" />
          ) : error ? (
            <button type="button" onClick={retry} className="mt-1 min-h-11 text-left text-sm text-destructive underline underline-offset-2">
              {t('financeHub:hub.retry', 'Retry')}
            </button>
          ) : (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm">
              <span className="tabular font-medium">{detail}</span>
              <Tooltip content={hint}>
                <button type="button" aria-label={t('financeHub:hub.figureHelp', 'How this figure is calculated')} className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">?</button>
              </Tooltip>
            </div>
          )}
        </div>
        <Icon name="chev" className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </div>
    </div>
  );
};

const FinanceHub: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const navigate = useNavigate();
  const { realRole } = useEffectiveRole();
  const canView = may('view', 'finance');
  const canAct = may('act', 'finance');
  const hasRevenue = useFeature('revenue');
  const hasProcurement = useFeature('procurement');
  const finance = useFinancePosition(canView);
  const report = useManagementPack({}, canView && hasRevenue);
  const statementCatalogue = useFinancialStatementCatalogue({ kind: 'company' }, canView);
  const latestStatementPeriod = useMemo(() => (statementCatalogue.data?.periods ?? [])
    .filter((period) => period.kind === 'month' && period.currentStart <= (finance.today ?? '9999-12-31'))
    .slice()
    .sort((a, b) => b.currentStart.localeCompare(a.currentStart))[0], [finance.today, statementCatalogue.data?.periods]);
  const statement = useFinancialStatement(latestStatementPeriod ? {
    periodKind: latestStatementPeriod.kind,
    periodStart: latestStatementPeriod.currentStart,
    statement: 'profit_and_loss',
  } : null, canView && Boolean(latestStatementPeriod));

  if (!canView) {
    return (
      <AccessDenied
        title={t('financeHub:hub.noAccessTitle', 'Finance')}
        sub={t('financeHub:hub.noAccessDescription', 'Finance is available to Finance, Executive and Admin roles.')}
        onBack={() => navigate('/')}
      />
    );
  }

  const overdueCount = finance.position.overdue.length;
  const overdueTotal = currencyLine(finance.position.overdueTotals);
  const oldestOverdue = finance.position.overdue[0];
  const payablesTotal = currencyLine(finance.position.payablesTotals);
  const statementResult = statement.data?.state === 'complete' && statement.data.result?.viewKind === 'account_breakdown'
    ? statement.data.result
    : null;
  const net = statementResult ? netProfit(statementResult.payload) : null;
  const statementAmount = net === null || !statement.data?.generation
    ? t('financeHub:hub.notAvailable', 'Not available yet')
    : formatCurrencyAuto(net, statement.data.generation.currency);
  const reportTotals = report.data?.totals ?? [];
  const reportMonth = report.data?.to ? monthLabel(report.data.to) : null;
  const earnedNotInvoiced = reportMonth
    ? reportTotals.map((total) => {
      const month = total.months[total.months.length - 1];
      return month ? formatCurrencyCents(month.unbilled / 100, total.currency) : null;
    }).filter((value): value is string => value !== null).join(' · ')
    : '';
  const noWaiting = overdueCount === 0 && finance.position.drafts.all.length === 0 && finance.position.toSend.length === 0 &&
    finance.position.unappliedPayments.length === 0 && finance.position.payables.length === 0;
  const finding = finance.isPending
    ? t('financeHub:hub.findingLoading', 'Loading the current money position…')
    : finance.isError
      ? t('financeHub:hub.findingError', "Couldn't load the current money position.")
      : noWaiting
        ? t('financeHub:hub.findingEmpty', 'Nothing overdue or waiting.')
        : t('financeHub:hub.finding', '{{overdue}} overdue across {{count}} invoices{{oldest}} · {{payables}} to pay suppliers', {
          overdue: overdueTotal || t('financeHub:hub.unknownAmount', 'Amount unavailable'),
          count: overdueCount,
          oldest: oldestOverdue
            ? t('financeHub:hub.oldest', '; oldest is {{client}}, {{days}} days late', {
              client: oldestOverdue.invoice.customer_name ?? t('financeHub:hub.unknownClient', 'unknown client'),
              days: oldestOverdue.daysOverdue,
            })
            : '',
          payables: payablesTotal || t('financeHub:hub.noSupplierBalance', 'no supplier balance'),
        });

  const createInvoice = () => navigate('/finance/receivables?create=1');
  const areas = (
    <section aria-labelledby="finance-hub-areas">
      <h2 id="finance-hub-areas" className="mb-1 text-base font-semibold">{t('financeHub:hub.areas', 'Finance areas')}</h2>
      <div className="grid gap-x-6 sm:grid-cols-2">
        {hasRevenue && (
          <AreaCard
            title={t('financeHub:hub.receivables', 'Receivables')}
            to="/finance/receivables"
            detail={currencyLine(Object.fromEntries(Object.entries(finance.position.receivablesAgeing).map(([currency, buckets]) => [
              currency,
              buckets.notDue + buckets.d1_30 + buckets.d31_60 + buckets.d61_90 + buckets.over90,
            ]))) || t('financeHub:hub.noOpenReceivables', 'No balance outstanding')}
            hint={t('financeHub:hub.receivablesHint', 'Sum of known outstanding balances on open invoices, including tax. Draft and cancelled invoices are excluded.')}
            loading={finance.isPending}
            error={finance.isError}
            retry={finance.retry}
          />
        )}
        {hasProcurement && (
          <AreaCard
            title={t('financeHub:hub.payables', 'Payables')}
            to="/finance/payables"
            detail={payablesTotal || t('financeHub:hub.noSupplierInvoices', 'No supplier invoices waiting')}
            hint={t('financeHub:hub.payablesHint', 'Sum of recorded supplier invoices waiting for payment, grouped by currency.')}
            loading={finance.isPending}
            error={finance.isError}
            retry={finance.retry}
          />
        )}
        {hasRevenue && (
          <AreaCard
            title={t('financeHub:hub.reports', 'Reports')}
            to="/finance/reports"
            detail={report.isPending ? t('financeHub:hub.loading', 'Loading…') : earnedNotInvoiced || t('financeHub:hub.notAvailable', 'Not available yet')}
            hint={t('financeHub:hub.reportsHint', 'Earned revenue minus invoiced revenue through the latest selected month, before tax.')}
            loading={report.isPending}
            error={report.isError}
            retry={() => { void report.refetch(); }}
          />
        )}
        {may('view', 'financialStatements') && (
          <AreaCard
            title={t('financeHub:hub.statements', 'Statements')}
            to="/finance/statements"
            detail={statementAmount}
            hint={t('financeHub:hub.statementsHint', 'Net profit from the latest available company profit and loss statement period.')}
            loading={statementCatalogue.isPending || statement.isPending}
            error={statementCatalogue.isError || statement.isError}
            retry={() => {
              void statementCatalogue.refetch();
              void statement.refetch();
            }}
          />
        )}
      </div>
    </section>
  );

  const attention = (
    <section aria-labelledby="finance-hub-attention">
      <h2 id="finance-hub-attention" className="mb-2 text-base font-semibold">
        {t('financeHub:hub.attention', realRole === 'Executive' ? 'Waiting on Finance' : 'Needs you')}
      </h2>
      <FinanceAttention
        position={finance.position}
        scope="all"
        canAct={canAct}
        isPending={finance.isPending}
        isError={finance.isError}
        onRetry={finance.retry}
        withLayout={(path) => path}
      />
    </section>
  );
  const ageings = (
    <section aria-labelledby="finance-hub-ageings">
      <h2 id="finance-hub-ageings" className="mb-2 text-base font-semibold">{t('financeHub:hub.ageing', 'Balances by age')}</h2>
      {finance.isPending ? <ListState variant="loading" rows={2} /> : finance.isError ? (
        <ListState variant="error" title={t('financeHub:hub.positionError', "Couldn't load balance ageings")} onRetry={finance.retry} />
      ) : (
        <div className="grid gap-x-6 lg:grid-cols-2">
          <AgeingStrip kind="receivables" values={finance.position.receivablesAgeing} />
          <AgeingStrip kind="payables" values={finance.position.payablesAgeing} />
        </div>
      )}
    </section>
  );

  return (
    <div className="min-w-0 pb-20 sm:pb-0">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[24px] font-bold tracking-[-0.02em]">{t('financeHub:hub.title', 'Finance')}</h1>
          <Tooltip content={t('financeHub:hub.findingHint', 'Overdue count and balance use open invoices past their derived due date. The oldest value is the greatest days past due; supplier payable total uses recorded supplier invoices still waiting to be paid.')}>
            <p tabIndex={0} className="mt-1 text-sm text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" aria-live="polite">{finding}</p>
          </Tooltip>
        </div>
        {canAct && (
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background p-3 sm:static sm:inset-auto sm:z-auto sm:border-0 sm:bg-transparent sm:p-0">
            <Button variant="primary" onClick={createInvoice} className="w-full shrink-0 sm:w-auto">
              <Icon name="plus" />
              {t('financeHub:hub.newInvoice', 'New invoice')}
            </Button>
          </div>
        )}
      </header>
      <div className="space-y-5">
        {areas}
        {realRole === 'Executive' ? <>{ageings}{attention}</> : <>{attention}{ageings}</>}
      </div>
    </div>
  );
};

export default FinanceHub;
