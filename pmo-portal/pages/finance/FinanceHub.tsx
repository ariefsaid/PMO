import React from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { useFeature } from '@/src/auth/useFeature';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { InvoicePairReview } from '@/src/components/integrations/InvoicePairReview';
import { BudgetDraftReview } from '@/src/components/finance/BudgetDraftReview';
import { Button, Card, CardHead, CardPad, Icon, ListState, PageHeader } from '@/src/components/ui';
import { KPIRow, KPITile } from '@/src/components/ui/KPITile';
import { FigureHiddenLine, FigureScope } from '@/src/components/ui/FigureScope';
import { moneyTileProps } from '@/src/components/finance/moneyTile';
import { AgeingStrip } from '@/src/components/finance/AgeingStrip';
import FinanceRevenueTrend from '@/src/components/finance/FinanceRevenueTrend';
import { FinanceAttention } from '@/src/components/finance/FinanceAttention';
import { FinanceAccessDenied } from '@/src/components/finance/FinanceAccessDenied';
import { useFinanceAccess } from '@/src/components/finance/useFinanceAccess';
import { useFinancePosition } from '@/src/hooks/useFinancePosition';
import { useFinanceHubFigures } from '@/src/hooks/useFinanceHubFigures';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import { useProjects } from '@/src/hooks/useProjects';
import { formatMonthYearShort } from '@/src/lib/format';
import { groupUnknownOverdueReceivablesByAge } from '@/src/lib/finance/financePosition';
import { usePayablesPosition } from '@/src/lib/finance/payablesPosition';

const FinanceHub: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { realRole } = useEffectiveRole();
  const { canView, canAct } = useFinanceAccess();
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
  // #1988: the Reports and Statements figures arrive from ONE narrow read, not the whole pack + P&L.
  const figures = useFinanceHubFigures(canView);
  const projects = useProjects({ enabled: canView });

  if (!canView) return <FinanceAccessDenied />;

  const home = orgCurrency ?? 'IDR';
  const receivableValues = Object.fromEntries(Object.entries(finance.position.receivablesAgeing).map(([currency, buckets]) => [
    currency, buckets.notDue + buckets.noDueDate + buckets.d1_30 + buckets.d31_60 + buckets.d61_90 + buckets.over90,
  ]));
  const pack = figures.data?.pack;
  const unbilled = Object.fromEntries((pack?.unbilled ?? []).map(({ currency, cents }) => [currency, cents]));
  const statement = figures.data?.statement;
  const statementUnavailable = figures.data !== undefined && statement?.unpublished === true;
  const net = statement?.netProfit ?? null;
  const statementPeriod = statement?.periodStart ?? null;
  const retryFigures = () => { void figures.refetch(); };
  const manageIntegration = may('manage', 'integration');
  const figuresFailed = finance.isError || figures.isError;

  const owed = moneyTileProps(finance.position.receivablesCount === 0 ? { [home]: 0 } : receivableValues, home);
  const toPay = moneyTileProps(finance.position.payables.length === 0 ? { [home]: 0 } : finance.position.payablesTotals, home);
  const toInvoice = pack ? moneyTileProps(
    Object.keys(unbilled).length === 0 && pack.invoicedBasisRows === pack.contractRows ? { [home]: 0 } : unbilled,
    home,
  ) : null;
  const profit = statement?.currency && net !== null && !statementUnavailable ? moneyTileProps({ [statement.currency]: Math.round(net * 100) }, statement.currency) : null;
  const shownTiles = [
    hasRevenue && (finance.isPending || finance.isError || !owed.unknown),
    hasProcurement && (finance.isPending || finance.isError || !toPay.unknown),
    hasRevenue && (figures.isPending || figures.isError || Boolean(toInvoice && !toInvoice.unknown)),
    may('view', 'financialStatements') && ((figures.isPending && !statementUnavailable) || figures.isError || Boolean(profit && !profit.unknown)),
  ].filter(Boolean).length;
  const tiles = (
    <KPIRow
      aria-label={t('financeHub:hub.areas', 'Finance areas')}
      className={shownTiles <= 1 ? 'grid-cols-1' : shownTiles === 2 ? 'grid-cols-2' : 'grid-cols-2 min-[900px]:grid-cols-3'}
    >
      {hasRevenue && <KPITile
        icon="grid" tone="blue" to="/finance/receivables" linkLabel={t('financeHub:hub.fix.area.open', { defaultValue: 'Open {{area}}', area: t('financeHub:hub.receivables', 'Receivables') })}
        label={t('financeHub:hub.owed', 'Receivables')}
        value={owed.value} exactValue={owed.exactValue}
        caption={finance.position.receivablesUnknownCount > 0
          ? t('financeHub:hub.owedUnknownCaption', { count: finance.position.receivablesUnknownCount, defaultValue_one: '{{count}} balance unknown', defaultValue_other: '{{count}} balances unknown' })
          : t('financeHub:hub.taxIncluded', 'tax included')}
        unavailableReason={owed.unknown ? t('financeHub:hub.owedUnknown', 'invoice balances unknown') : undefined}
        hiddenLink={{ to: '/finance/receivables', label: t('financeHub:hub.seeInvoices', 'See invoices') }}
        help={t('financeHub:hub.receivablesHint', 'Sum of known outstanding balances on open invoices, including tax. Draft and cancelled invoices are excluded.')}
        loading={finance.isPending} error={finance.isError}
      />}
      {hasProcurement && <KPITile
        icon="grid" tone="blue" to="/finance/payables" linkLabel={t('financeHub:hub.fix.area.open', { defaultValue: 'Open {{area}}', area: t('financeHub:hub.payables', 'Payables') })}
        label={t('financeHub:hub.toPay', 'Owed to suppliers')} caption={t('financeHub:hub.waitingToPay', 'unpaid')}
        value={toPay.value} exactValue={toPay.exactValue}
        unavailableReason={toPay.unknown ? t('financeHub:hub.payablesUnknown', 'supplier balances are unknown') : undefined}
        hiddenLink={{ to: '/finance/payables', label: t('financeHub:hub.seePayables', 'See payables') }}
        help={t('financeHub:hub.payablesHint', 'Unpaid supplier invoice balances (invoice amount less payments made), grouped by currency. Unknown balances are counted, not added.')}
        loading={finance.isPending} error={finance.isError}
      />}
      {hasRevenue && <KPITile
        icon="grid" tone="blue" to="/finance/reports" linkLabel={t('financeHub:hub.fix.area.open', { defaultValue: 'Open {{area}}', area: t('financeHub:hub.reports', 'Reports') })}
        label={t('financeHub:hub.doneNotYetBilled', 'Done, not yet billed')} caption={pack?.asAt ? t('financeHub:hub.through', 'through {{month}}', { month: formatMonthYearShort(pack.asAt) }) : undefined}
        value={toInvoice?.value ?? null} exactValue={toInvoice?.exactValue}
        unavailableReason={!toInvoice || toInvoice.unknown ? t('financeHub:hub.reportsUnknown', 'report figures are not available') : undefined}
        hiddenLink={{ to: '/finance/reports', label: t('financeHub:hub.openReports', 'Open reports') }}
        help={t('financeHub:hub.reportsHint', 'Earned revenue minus invoiced revenue through the latest selected month, before tax.')}
        loading={figures.isPending} error={figures.isError}
      />}
      {may('view', 'financialStatements') && <KPITile
        icon="grid" tone="blue" to="/finance/statements" linkLabel={t('financeHub:hub.fix.area.open', { defaultValue: 'Open {{area}}', area: t('financeHub:hub.statements', 'Statements') })}
        label={t('financeHub:hub.netProfit', 'Net profit')} caption={statementPeriod ? formatMonthYearShort(statementPeriod) : undefined}
        value={profit?.value ?? null} exactValue={profit?.exactValue}
        unavailableReason={profit ? undefined : statementUnavailable
          ? t('financeHub:hub.fix.statements.notConnected', 'accounting disconnected')
          : t('financeHub:hub.fix.statements.noStatement', 'no statement period yet')}
        hiddenLink={statementUnavailable && manageIntegration ? { to: '/administration/integrations', label: t('financeHub:hub.fix.statements.setUp', 'Set up') } : undefined}
        help={t('financeHub:hub.statementsHint', 'Net profit from the latest available company profit and loss statement period.')}
        loading={figures.isPending && !statementUnavailable} error={figures.isError}
      />}
    </KPIRow>
  );

  const attention = (
    <Card role="region" aria-labelledby="finance-hub-attention">
      <CardHead id="finance-hub-attention">{realRole === 'Executive' ? t('financeHub:hub.fix.attention.executive', 'Waiting on Finance') : t('financeHub:hub.fix.attention.finance', 'Needs attention')}</CardHead>
      <CardPad>
        <FinanceAttention
        position={finance.position} scope="all" canAct={canAct} isPending={finance.isPending} isError={finance.isError}
        onRetry={finance.retry} withLayout={(path) => path} orgCurrency={orgCurrency} showOverdueUnknownCount={false}
        projects={new Map((projects.data ?? []).map((project) => [project.id, project]))}
      />
      </CardPad>
    </Card>
  );
  const receivablesUnknownAgeing = groupUnknownOverdueReceivablesByAge(finance.position.overdue);
  const receivablesUnknownWithoutAge = Math.max(0, finance.position.receivablesUnknownCount - receivablesUnknownAgeing.total);
  const ageings = (
    <Card role="region" aria-labelledby="finance-hub-ageings">
      <CardHead id="finance-hub-ageings">{t('financeHub:hub.ageing', 'Ageing')}</CardHead>
      <CardPad>
        {finance.isPending ? <ListState variant="loading" rows={2} /> : finance.isError ? (
        <ListState variant="error" title={t('financeHub:hub.positionError', "Couldn't load balance ageings")} onRetry={finance.retry} />
        ) : <div className="grid gap-[var(--space-panel-gap)] min-[1280px]:grid-cols-2"><AgeingStrip kind="receivables" heading={t('financeHub:hub.receivables', 'Receivables')} values={finance.position.receivablesAgeing} unknownCounts={receivablesUnknownAgeing.counts} noDueDateCounts={finance.position.receivablesNoDueDateCounts} unknownTotal={receivablesUnknownWithoutAge} /><AgeingStrip kind="payables" heading={t('financeHub:hub.payables', 'Payables')} values={finance.position.payablesAgeing} unknownCounts={payablesUnknownAgeing} /></div>}
      </CardPad>
    </Card>
  );

  return (
    <FigureScope>
    <div className="min-w-0 pb-20 sm:pb-0">
      <PageHeader
        title={t('financeHub:hub.title', 'Finance')}
        help={<>
          <p>{t('financeHub:hub.helpAges', 'Client balances by age count days past due, tax included. Waiting to pay counts days since the supplier invoice was recorded, or last updated.')}</p>
        </>}
        helpSubject={t('financeHub:hub.title', 'Finance')}
        action={canAct ? <div className="fixed inset-x-0 bottom-[var(--phone-nav-height)] z-20 border-t border-border bg-background p-3 sm:static sm:inset-auto sm:z-auto sm:border-0 sm:bg-transparent sm:p-0"><Button variant="primary" onClick={() => navigate('/finance/receivables?create=1')} className="w-full shrink-0 sm:w-auto"><Icon name="plus" />{t('financeHub:hub.newInvoice', 'New invoice')}</Button></div> : undefined}
      />
      <div className="mb-3"><FigureHiddenLine /></div>
      {/* ECA-5: Finance accepts invoice pairs here. Receivables is hidden while an ERP owns revenue, so this is the page Finance can always reach; self-hides when there is nothing to review. */}
      <InvoicePairReview orgId={currentUser?.org_id} />
      <BudgetDraftReview />
      <div className="space-y-[var(--space-panel-gap)]">
        {figuresFailed && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-control">
          <span>{t('financeHub:hub.positionError', "Couldn't load finance figures")}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => { if (finance.isError) finance.retry(); if (figures.isError) retryFigures(); }}>{t('financeHub:hub.retry', 'Retry')}</Button>
        </div>}
        {/* Waiting stays left; company figures, monthly totals and ageing use the wider right column. */}
        <div data-testid="finance-hub-first-row" className="grid min-w-0 items-start gap-[var(--space-panel-gap)] min-[1100px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="min-w-0 space-y-[var(--space-panel-gap)]">
            {attention}
          </div>
          <div className="min-w-0 space-y-[var(--space-panel-gap)]">
            {tiles}
            <FinanceRevenueTrend today={finance.today} enabled={hasRevenue} />
          </div>
        </div>
        {ageings}
      </div>
    </div>
    </FigureScope>
  );
};

export default FinanceHub;
