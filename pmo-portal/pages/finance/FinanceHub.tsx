import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { useFeature } from '@/src/auth/useFeature';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { AccessDenied, Button, Card, CardHead, CardPad, Icon, ListState, Tooltip } from '@/src/components/ui';
import { AgeingStrip } from '@/src/components/finance/AgeingStrip';
import { FinanceAttention } from '@/src/components/finance/FinanceAttention';
import { useFinancePosition } from '@/src/hooks/useFinancePosition';
import { useManagementPack } from '@/src/hooks/useManagementPack';
import { useFinancialStatement, useFinancialStatementCatalogue } from '@/src/hooks/useFinancialStatements';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import { useProjects } from '@/src/hooks/useProjects';
import { formatMonthYear, formatShortMoney } from '@/src/lib/format';
import { formatCurrencyWithCode } from '@/src/lib/finance/format';
import { moneyFigure, type MoneyFigure } from '@/src/lib/dashboardMoney';
import { FigureContent } from '@/src/components/ui/FigureContent';
import type { FinancialStatementNativePayload } from '@/src/lib/financialStatements';
import { usePayablesPosition } from './payablesPosition';

function currencyEntries(values: Record<string, number>, preferred?: string | null) {
  return Object.entries(values).sort(([left], [right]) => left === preferred ? -1 : right === preferred ? 1 : left.localeCompare(right));
}

/** Area cards are figure tiles (F11): short lead amount, exact amount kept as metadata. */
function currencyLead(values: Record<string, number>, preferred?: string | null): { lead: MoneyFigure | null; others: MoneyFigure[] } {
  const entries = currencyEntries(values, preferred);
  const [primary, ...rest] = entries;
  return {
    lead: primary ? moneyFigure(primary[1] / 100, primary[0], '') : null,
    // Secondary currencies always name their ISO code, short with the exact amount as metadata.
    others: rest.filter(([, cents]) => cents !== 0).map(([currency, cents]) => ({
      value: Math.abs(cents) < 100_000 ? formatCurrencyWithCode(cents / 100, currency) : formatShortMoney(cents / 100, currency, { code: true }),
      exactValue: formatCurrencyWithCode(cents / 100, currency),
    })),
  };
}

function monthLabel(date: string): string {
  return formatMonthYear(new Date(`${date.slice(0, 10)}T12:00:00Z`));
}

function shortMonthLabel(date: string): string {
  return monthLabel(date).split(/\s+/)[0] ?? monthLabel(date);
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
  /** Omitted when the figure cannot be known; the meaning line then states why (C4). */
  amount?: MoneyFigure;
  otherCurrencies?: MoneyFigure[];
  meaning: string;
  extra?: string;
  /** C4: where the missing figure gets set up, shown under the reason. */
  fix?: React.ReactNode;
  hint: string;
  loading?: boolean;
  error?: boolean;
  retry?: () => void;
}

const AreaCard: React.FC<AreaCardProps> = ({ title, to, amount, otherCurrencies = [], meaning, extra, fix, hint, loading = false, error = false, retry }) => {
  const { t } = useTranslation();
  return (
    <article className="panel-card min-w-0 p-[var(--panel-inset)]">
      <Link to={to} aria-label={t('financeHub:hub.fix.area.open', { defaultValue: 'Open {{area}}', area: title })} className="flex min-w-0 items-center justify-between gap-3 font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        <span className="truncate">{title}</span><Icon name="chev" className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
      {loading ? (
        <div role="status" aria-label={t('financeHub:hub.loadingFigure', 'Loading figure')} className="mt-2 h-7 w-36 animate-pulse rounded bg-muted" />
      ) : error ? (
        <button type="button" onClick={retry} className="mt-2 min-h-11 text-left text-sm text-destructive underline underline-offset-2">{t('financeHub:hub.retry', 'Retry')}</button>
      ) : (
        <>
          {amount && <div className="mt-2 flex min-w-0 items-center gap-1">
            <span className="truncate text-[20px] font-bold tabular"><FigureContent value={amount.value} exactValue={amount.exactValue} /></span>
            <Tooltip content={hint}><button type="button" aria-label={t('financeHub:hub.figureHelp', 'How this figure is calculated')} className="touch-target inline-grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><Icon name="help" className="size-3.5" /></button></Tooltip>
          </div>}
          {otherCurrencies.map((other) => <div key={other.value} className="truncate text-xs text-muted-foreground" title={other.exactValue}>{t('financeHub:hub.fix.currency.other', { defaultValue: '+ {{amount}} in other currencies', amount: other.value })}</div>)}
          <div className="mt-1 text-sm text-muted-foreground">{meaning}</div>
          {extra && <div className="mt-0.5 text-sm text-muted-foreground">{extra}</div>}
          {fix && <div className="mt-1 text-sm">{fix}</div>}
        </>
      )}
    </article>
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
  const currencyState = useOrgCurrencyState();
  const orgCurrency = currencyState.isResolved ? currencyState.currency : null;
  const financePosition = useFinancePosition(canView);
  // L12: supplier invoices kept in the accounting system count here exactly as on the procurement record.
  const { isPending: payablesPending, payablesUnknownAgeing, ...payables } = usePayablesPosition(financePosition.position, canView && hasProcurement);
  const finance = {
    ...financePosition,
    position: { ...financePosition.position, ...payables },
    isPending: financePosition.isPending || payablesPending,
  };
  const report = useManagementPack({}, canView && hasRevenue);
  const projects = useProjects({ enabled: canView });
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
    return <AccessDenied title={t('financeHub:hub.noAccessTitle', 'Finance')} sub={t('financeHub:hub.noAccessDescription', 'Finance is available to Finance, Executive and Admin roles.')} onBack={() => navigate('/')} />;
  }

  const payableMoney = currencyLead(finance.position.payablesTotals, orgCurrency);
  const noBalance = { value: t('financeHub:hub.fix.area.noBalance', 'No balance') };
  const receivableValues = Object.fromEntries(Object.entries(finance.position.receivablesAgeing).map(([currency, buckets]) => [
    currency, buckets.notDue + buckets.d1_30 + buckets.d31_60 + buckets.d61_90 + buckets.over90,
  ]));
  const receivableMoney = currencyLead(receivableValues, orgCurrency);
  const supplierCount = new Set(finance.position.payables.map(({ procurement }) => procurement.vendor_id ?? procurement.id)).size;
  const reportTotals = report.data?.totals ?? [];
  const reportValues = Object.fromEntries(reportTotals.flatMap((total) => {
    const month = total.months[total.months.length - 1];
    return month ? [[total.currency, month.unbilled]] : [];
  }));
  const reportMoney = currencyLead(reportValues, orgCurrency);
  const reportContractRows = report.data?.rows.filter((row) => row.kind === 'contract') ?? [];
  const invoicedBasisCount = reportContractRows.filter((row) => row.latestProgress == null).length;
  const statementUnavailable = statementCatalogue.data !== undefined && statementCatalogue.data.periods.length === 0;
  const statementError = statementCatalogue.isError || statement.isError;
  const statementLoading = statementCatalogue.isPending || Boolean(latestStatementPeriod && statement.isPending);
  const statementResult = statement.data?.state === 'complete' && statement.data.result?.viewKind === 'account_breakdown' ? statement.data.result : null;
  const net = statementResult ? netProfit(statementResult.payload) : null;
  const statementAmount = net !== null && statement.data?.generation
    ? moneyFigure(net, statement.data.generation.currency, '')
    : undefined;

  const areas = (
    <section aria-labelledby="finance-hub-areas">
      <h2 id="finance-hub-areas" className="mb-3 text-base font-semibold">{t('financeHub:hub.areas', 'Finance areas')}</h2>
      <div className="grid grid-cols-1 gap-[var(--space-panel-gap)] min-[1280px]:grid-cols-2">
        {hasRevenue && <AreaCard
          title={t('financeHub:hub.receivables', 'Receivables')} to="/finance/receivables"
          amount={receivableMoney.lead ?? noBalance}
          otherCurrencies={receivableMoney.others}
          meaning={t('financeHub:hub.fix.area.receivablesMeaning', { defaultValue: 'owed to you · {{count}} invoices · tax included', count: finance.position.receivablesCount })}
          hint={t('financeHub:hub.receivablesHint', 'Sum of known outstanding balances on open invoices, including tax. Draft and cancelled invoices are excluded.')}
          loading={finance.isPending} error={finance.isError} retry={finance.retry}
        />}
        {hasProcurement && <AreaCard
          title={t('financeHub:hub.payables', 'Payables')} to="/finance/payables"
          // Unknown is not zero: invoices waiting with no known balance show no figure, never "No balance".
          amount={payableMoney.lead ?? (finance.position.payables.length > 0 ? undefined : noBalance)}
          otherCurrencies={payableMoney.others}
          meaning={finance.position.payables.length > 0
            ? t('financeHub:hub.fix.area.payablesSuppliers', { defaultValue: 'to pay {{count}} suppliers', count: supplierCount })
            : t('financeHub:hub.fix.area.noSuppliers', 'No supplier invoices waiting')}
          hint={t('financeHub:hub.payablesHint', 'Unpaid supplier invoice balances (invoice amount less payments made), grouped by currency. Unknown balances are counted, not added.')}
          loading={finance.isPending} error={finance.isError} retry={finance.retry}
        />}
        {hasRevenue && <AreaCard
          title={t('financeHub:hub.reports', 'Reports')} to="/finance/reports"
          amount={reportMoney.lead ?? noBalance}
          otherCurrencies={reportMoney.others}
          meaning={t('financeHub:hub.fix.area.reportsMeaning', { defaultValue: 'earned, not yet invoiced · through {{month}}', month: report.data?.to ? shortMonthLabel(report.data.to) : '—' })}
          extra={report.data && reportContractRows.length > 0 && invoicedBasisCount === reportContractRows.length
            ? t('financeHub:hub.fix.area.noProgressProjects', { defaultValue: 'No progress recorded on {{count}} projects', count: invoicedBasisCount }) : undefined}
          hint={t('financeHub:hub.reportsHint', 'Earned revenue minus invoiced revenue through the latest selected month, before tax.')}
          loading={report.isPending} error={report.isError} retry={() => { void report.refetch(); }}
        />}
        {may('view', 'financialStatements') && <AreaCard
          title={t('financeHub:hub.statements', 'Statements')} to="/finance/statements"
          amount={statementUnavailable ? undefined : statementAmount}
          meaning={latestStatementPeriod && net !== null
            ? t('financeHub:hub.fix.statements.netProfit', { defaultValue: 'net profit {{month}}', month: monthLabel(latestStatementPeriod.currentStart) })
            : t('financeHub:hub.fix.statements.noStatement', 'Net profit is not available for a period yet')}
          fix={statementUnavailable ? (may('manage', 'integration')
            ? <span className="text-muted-foreground">{t('financeHub:hub.fix.statements.source', 'Statements come from the accounting system.')}{' '}<Link to="/administration/integrations" className="font-medium text-primary-text underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{t('financeHub:hub.fix.statements.openIntegrations', 'Open integrations')}</Link></span>
            : <span className="text-muted-foreground">{t('financeHub:hub.fix.statements.askAdmin', 'Statements come from the accounting system; an Admin sets this up in Integrations.')}</span>) : undefined}
          hint={t('financeHub:hub.statementsHint', 'Net profit from the latest available company profit and loss statement period.')}
          loading={statementLoading && !statementUnavailable} error={statementError} retry={() => { void statementCatalogue.refetch(); void statement.refetch(); }}
        />}
      </div>
    </section>
  );

  const attention = (
    <Card role="region" aria-labelledby="finance-hub-attention">
      <CardHead id="finance-hub-attention">{realRole === 'Executive' ? t('financeHub:hub.fix.attention.executive', 'Waiting on Finance') : t('financeHub:hub.fix.attention.finance', 'Needs attention')}</CardHead>
      <CardPad>
        <FinanceAttention
        position={finance.position} scope="all" canAct={canAct} isPending={finance.isPending} isError={finance.isError}
        onRetry={finance.retry} withLayout={(path) => path} orgCurrency={orgCurrency}
        projects={new Map((projects.data ?? []).map((project) => [project.id, project]))}
      />
      </CardPad>
    </Card>
  );
  const ageings = (
    <Card role="region" aria-labelledby="finance-hub-ageings">
      <CardHead id="finance-hub-ageings">{t('financeHub:hub.ageing', 'Balances by age')}</CardHead>
      <CardPad>
        {finance.isPending ? <ListState variant="loading" rows={2} /> : finance.isError ? (
        <ListState variant="error" title={t('financeHub:hub.positionError', "Couldn't load balance ageings")} onRetry={finance.retry} />
        ) : <div className="grid gap-[var(--space-panel-gap)] min-[1280px]:grid-cols-2"><AgeingStrip kind="receivables" values={finance.position.receivablesAgeing} /><AgeingStrip kind="payables" values={finance.position.payablesAgeing} unknownCounts={payablesUnknownAgeing} /></div>}
      </CardPad>
    </Card>
  );

  return (
    <div className="min-w-0 pb-20 sm:pb-0">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[24px] font-bold tracking-[-0.02em]">{t('financeHub:hub.title', 'Finance')}</h1>
        </div>
        {canAct && <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background p-3 sm:static sm:inset-auto sm:z-auto sm:border-0 sm:bg-transparent sm:p-0"><Button variant="primary" onClick={() => navigate('/finance/receivables?create=1')} className="w-full shrink-0 sm:w-auto"><Icon name="plus" />{t('financeHub:hub.newInvoice', 'New invoice')}</Button></div>}
      </header>
      <div className="space-y-[var(--space-panel-gap)]">
        {areas}
        <div className="grid gap-[var(--space-panel-gap)] min-[1280px]:grid-cols-2">
          {realRole === 'Executive' ? <>{ageings}{attention}</> : <>{attention}{ageings}</>}
        </div>
      </div>
    </div>
  );
};

export default FinanceHub;
