import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useDashboard, useSalesPipeline } from '@/src/hooks/useDashboard';
import { BoardPackAction } from '@/src/components/reports/BoardPackAction';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { formatNumber, formatNumberExact } from '@/src/lib/format';
import { moneyFigure } from '@/src/lib/dashboardMoney';
import type { ExecutiveDashboard as ExecutiveDashboardData, PipelineStage } from '@/src/lib/db/dashboard';
import { WinRateCard } from '@/src/components/dashboard/WinRateCard';
import { BvACard } from '@/src/components/dashboard/BvACard';
import { executiveRiskState } from '@/src/components/dashboard/executiveProjectOrder';
import { ProjectedMarginBars } from '@/src/components/dashboard/ProjectedMarginBars';
import { DashPageHead } from '@/src/components/dashboard/layout';
import { PMDashboard } from '@/src/components/dashboard/PMDashboard';
import { FinanceDashboard } from '@/src/components/dashboard/FinanceDashboard';
import { EngineerDashboard } from '@/src/components/dashboard/EngineerDashboard';
import { StillToInvoiceCard } from '@/src/components/dashboard/StillToInvoiceCard';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useTimesheetsAwaitingApproval } from '@/src/hooks/useTimesheetApproval';
import { useAuth } from '@/src/auth/useAuth';
import { can } from '@/src/auth/policy';
import { pendingProcurementApprovals } from '@/src/lib/selectors/approvals';
import { ListState } from '@/src/components/ui/ListState';
import { buttonClasses } from '@/src/components/ui/buttonClasses';
import { useProcurementStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { isActualComplete } from '@/src/lib/projectFinances';

type CurrencyValue = { currency: string; value: number | null };

function onHandRows(data: ExecutiveDashboardData, orgCurrency: string): CurrencyValue[] {
  const rows = data.on_hand_value_by_currency ?? [];
  return rows.length
    ? rows.map((row) => ({ currency: row.currency, value: row.contract_value }))
    : [{ currency: orgCurrency, value: data.on_hand_value }];
}

function activeContractRows(data: ExecutiveDashboardData, orgCurrency: string): CurrencyValue[] {
  const rows = Object.entries(data.total_contract_value_by_currency ?? {});
  return rows.length
    ? rows.map(([currency, value]) => ({ currency, value }))
    : [{ currency: orgCurrency, value: data.total_contract_value }];
}

function actualRows(data: ExecutiveDashboardData, orgCurrency: string): CurrencyValue[] {
  const rows = data.on_hand_value_by_currency ?? [];
  return rows.length
    ? rows.map((row) => ({ currency: row.currency, value: row.actual_known }))
    : [{ currency: orgCurrency, value: data.on_hand_actual_known }];
}

function remainingRows(data: ExecutiveDashboardData, orgCurrency: string): CurrencyValue[] {
  const rows = data.on_hand_value_by_currency ?? [];
  return rows.length
    ? rows.map((row) => ({ currency: row.currency, value: row.contract_remaining }))
    : [{ currency: orgCurrency, value: data.on_hand_contract_remaining }];
}

function marginRows(data: ExecutiveDashboardData, orgCurrency: string): CurrencyValue[] {
  const rows = data.on_hand_realized_margin_by_currency ?? [];
  return rows.length
    ? rows.map((row) => ({ currency: row.currency, value: row.known_amount }))
    : [{ currency: orgCurrency, value: data.on_hand_realized_margin }];
}

const ExecutiveAttention: React.FC<{
  data?: ExecutiveDashboardData;
  dashboardPending: boolean;
  dashboardError: boolean;
  approvalCount: number;
  approvalPending: boolean;
  approvalError: boolean;
}> = ({ data, dashboardPending, dashboardError, approvalCount, approvalPending, approvalError }) => {
  const { t } = useTranslation('dashboard');
  const atRisk = data?.projects_at_risk ?? 0;
  const activeDelivery = data?.active_delivery_projects;
  const unchecked = data?.risk_unchecked_projects ?? 0;
  const riskText = dashboardPending && !data
    ? t('exec.riskLoading', 'Checking project risk…')
    : (dashboardError || !data)
      ? t('exec.riskUnavailable', 'Project risk status is unavailable')
      : atRisk > 0
        ? atRisk === 1
          ? t('exec.atRiskOne', '1 project at risk')
          : t('exec.atRiskCount', '{{count}} projects at risk', { count: atRisk })
        : activeDelivery === 0
          ? t('exec.noDeliveryProjects', 'No active delivery projects')
          : activeDelivery !== undefined && unchecked === 0
            ? t('exec.noKnownRisk', 'No projects at risk')
            : activeDelivery !== undefined
              ? t('exec.riskNotChecked', 'Risk is not checked for {{count}} delivery projects', { count: unchecked || activeDelivery })
              : t('exec.riskUnavailable', 'Project risk status is unavailable');
  const approvalText = approvalError
    ? t('exec.approvalsUnavailable', 'Approval status is unavailable')
    : approvalPending
      ? t('exec.approvalsLoading', 'Checking approval requests…')
      : approvalCount > 0
        ? approvalCount === 1
          ? t('exec.pendingApprovalOne', '1 approval request needs a decision')
          : t('exec.pendingApprovals', '{{count}} approval requests need a decision', { count: approvalCount })
        : t('exec.noPendingApprovals', 'No approval requests need a decision');
  const primaryAction = !approvalPending && !approvalError && approvalCount > 0
    ? { label: t('exec.reviewRequests', 'Review requests'), to: '/approvals' }
    : atRisk > 0
      ? { label: t('exec.reviewAtRisk', 'Review at-risk projects'), to: '/projects?filter=at-risk' }
      : null;

  return (
    <section aria-labelledby="executive-attention-title" className="border-b border-border pb-4" data-testid="dashboard-attention">
      <h2 id="executive-attention-title" className="mb-2 text-xl font-bold">
        {t('uxs03.attentionAndApprovals', 'Attention and approvals')}
      </h2>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-start sm:gap-6">
        <div className="min-w-0 space-y-1 text-sm">
          <p>{riskText}</p>
          <p className={approvalError ? 'text-muted-foreground' : ''}>{approvalText}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
          {primaryAction && (
            <Link to={primaryAction.to} className={buttonClasses('primary', 'default', 'min-h-11 px-4 text-xs font-semibold')}>
              {primaryAction.label}
            </Link>
          )}
          {approvalError && (
            <Link to="/approvals" className="inline-flex min-h-11 items-center text-xs font-semibold text-primary-text underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {t('exec.openApprovals', 'Open approvals')}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
};

const DeliveryBook: React.FC<{
  data?: ExecutiveDashboardData;
  currency: string;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  canManageAccounting: boolean;
}> = ({ data, currency, isPending, isError, onRetry, canManageAccounting }) => {
  const { t } = useTranslation('dashboard');
  const actual = data ? actualRows(data, currency) : [];
  const onHand = data ? onHandRows(data, currency) : [];
  const activeContracts = data ? activeContractRows(data, currency) : [];
  const remaining = data ? remainingRows(data, currency) : [];
  const margin = data ? marginRows(data, currency) : [];
  const unknownActual = data?.top_projects?.filter((project) => !isActualComplete({
    basis: 'erp',
    readSucceeded: project.spent !== null,
    complete: project.actual_complete,
    coverageCount: project.actual_coverage_count,
    coverageTotal: project.actual_coverage_total,
  })).length ?? 0;
  const unknownRisk = Math.max(
    data?.risk_unchecked_projects ?? 0,
    data?.top_projects?.filter((project) => executiveRiskState(project) === 'unchecked').length ?? 0,
  );
  const actualIncomplete = actual.some((row) => row.value === null || !Number.isFinite(row.value))
    || (data?.on_hand_value_by_currency ?? []).some((row) => row.unknown_projects > 0)
    || unknownActual > 0;
  const contractUnavailable = [...onHand, ...activeContracts]
    .some((row) => row.value === null || !Number.isFinite(row.value));
  const remainingUnavailable = remaining.some((row) => row.value === null || !Number.isFinite(row.value));
  const marginUnavailable = margin.some((row) => row.value === null || !Number.isFinite(row.value));
  const incompleteMargin = (data?.on_hand_realized_margin_by_currency ?? []).some((row) => row.unknown_projects > 0)
    || (data?.pipeline_total_value_by_currency ?? []).some((row) => row.forecast_margin === null || row.no_active_budget > 0);
  const mapNote = canManageAccounting
    ? <Link to="/administration/accounting#budget-account-map" className="inline-flex min-h-11 items-center text-xs font-semibold text-primary-text underline-offset-2 hover:underline">{t('uxs03.openAccountingMap', 'Review accounting mappings')}</Link>
    : <span>{t('exec.askAdministrator', 'Ask an administrator to complete missing budget or accounting data.')}</span>;
  const abnormalReasons: string[] = data ? [
    contractUnavailable
      ? t('exec.contractUnavailableNote', 'Contract value is unavailable for one or more currencies.')
      : null,
    unknownRisk > 0
      ? t('exec.uncheckedRiskNote', 'Risk is not checked where active budgets or complete same-currency Actual are missing.')
      : null,
    remainingUnavailable
      ? t('exec.remainingUnavailableNote', 'Contract remaining needs complete Actual in the same currency.')
      : null,
    incompleteMargin || marginUnavailable
      ? t('exec.incompleteMarginNote', 'Margin on billed work excludes projects whose Actual, billing, or budget basis is incomplete.')
      : null,
  ].filter((reason): reason is string => reason !== null) : [];
  const hasNoProjects = Boolean(data
    && data.top_projects.length === 0
    && data.projects_by_status.every((row) => row.count === 0)
    && data.procurements_by_status.every((row) => row.count === 0));
  const currencyRows = [...new Map(
    [...onHand, ...activeContracts, ...actual, ...remaining, ...margin]
      .map((row) => [row.currency, row] as const),
  ).keys()].sort((left, right) => left === currency ? -1 : right === currency ? 1 : left.localeCompare(right));
  const exactValue = (value: number | null | undefined, reason: string, href = '#executive-data-note') =>
    value === null || value === undefined || !Number.isFinite(value)
      ? <a className="inline-flex min-h-11 min-w-11 items-center justify-end underline underline-offset-2" href={href} title={reason} aria-label={reason}>—</a>
      : <span>{formatNumberExact(value)}</span>;
  const fact = (label: string, value: number | null | undefined, reason: string, href?: string) => (
    <div key={label} className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="min-w-0 text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm tabular">{exactValue(value, reason, href)}</dd>
    </div>
  );

  return (
    <section aria-labelledby="executive-delivery-title" className="space-y-4" data-testid="dashboard-delivery-book">
      <h2 id="executive-delivery-title" className="text-xl font-bold">{t('exec.deliveryBook', 'Delivery book')}</h2>
      {isPending && !data ? (
        <ListState variant="loading" rows={5} />
      ) : isError && !data ? (
        <ListState variant="error" title={t('dashboard.error.title', "Couldn't load the dashboard")} onRetry={onRetry} />
      ) : data ? (
        <>
          {isError && (
            <ListState
              variant="error"
              title={t('dashboard.error.title', "Couldn't load the dashboard")}
              onRetry={onRetry}
            />
          )}
          <div className="space-y-8 border-y border-border py-4">
            {currencyRows.map((currencyCode, index) => {
              const valueFor = (rows: CurrencyValue[]) => rows.find((row) => row.currency === currencyCode)?.value;
              const primary = valueFor(onHand);
              const compact = moneyFigure(primary ?? null, currencyCode, t('exec.valueUnavailable', 'Unavailable value; see portfolio data note'), { code: true });
              const groupId = `dashboard-position-${currencyCode.toLowerCase()}`;
              const hasActive = activeContracts.some((row) => row.currency === currencyCode);
              return (
                <section key={currencyCode} aria-labelledby={groupId} data-testid={`dashboard-delivery-position-${currencyCode}`}>
                  <h3 id={groupId} className={`mb-3 text-xl font-bold tabular ${index === 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {t('dashboard:exec.contractValueOnHandCompact', 'Contract value on hand · {{figure}}', { figure: compact.value })}
                  </h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                    {fact(t('dashboard:exec.exactContractValueOnHand', 'Exact on-hand value'), primary, t('exec.valueUnavailable', 'Unavailable value; see portfolio data note'))}
                    {hasActive && <div className="contents">
                      {fact(t('uxs03.activeContractValue', 'Active contract value'), valueFor(activeContracts), t('exec.valueUnavailable', 'Unavailable value; see portfolio data note'))}
                      <dt className="text-xs font-semibold text-muted-foreground">{t('dashboard:kpi.activeProjectsCount', 'Active projects')}</dt>
                      <dd className="text-right text-sm tabular">{formatNumber(data.active_projects)}</dd>
                    </div>}
                    <div className="contents" data-testid={currencyCode === 'IDR' ? 'dashboard-known-actual' : undefined}>
                      {fact(t('dashboard:exec.knownActual', 'Known Actual'), valueFor(actual), t('exec.actualUnavailable', 'Actual unavailable; see coverage note'), '#executive-actual-note')}
                    </div>
                    {fact(t('uxs03.contractRemaining', 'Contract remaining after known Actual'), valueFor(remaining), t('exec.valueUnavailable', 'Unavailable value; see portfolio data note'))}
                    {fact(
                      (data.on_hand_realized_margin_by_currency ?? []).some((row) => row.currency === currencyCode && row.unknown_projects > 0)
                        ? t('uxs03.realizedMarginKnown', 'Known margin on billed work')
                        : t('uxs03.realizedMargin', 'Margin on billed work'),
                      valueFor(margin),
                      t('exec.valueUnavailable', 'Unavailable value; see portfolio data note'),
                    )}
                  </dl>
                </section>
              );
            })}
          </div>
          {actualIncomplete && (
            <aside id="executive-actual-note" data-testid="dashboard-actual-coverage-note" className="pt-3 text-sm text-muted-foreground">
              <p className="text-xs font-semibold text-foreground">{t('dashboard:exec.actualCoverageHead', 'Actual coverage')}</p>
              <p className="mt-1">
                {t('uxs03.coverage', 'Actual available for {{known}} of {{total}} delivery projects', { known: data.on_hand_actual_project_count, total: data.on_hand_actual_project_total })}
                {' · '}
                {t('uxs03.coverageCategories', 'Actual coverage: {{known}} of {{total}} mapped cost categories', { known: data.on_hand_actual_coverage_count, total: data.on_hand_actual_coverage_total })}
                {' · '}{mapNote}
              </p>
            </aside>
          )}

          {hasNoProjects && (
            <p data-testid="dashboard-empty" className="text-sm text-muted-foreground">
              {t('dashboard.empty.title', 'No data yet')} · <Link className="underline underline-offset-2" to="/projects">{t('exec.openProjects', 'Open projects')}</Link>
            </p>
          )}

          {!hasNoProjects && <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-xl font-bold">{t('dashboard:exec.spendingComparison', 'Spending comparison')}</h3>
              <p className="text-xs font-semibold text-muted-foreground">{t('dashboard:exec.sortAtRiskFirst', 'At-risk projects first, then project name')}</p>
            </div>
            <BvACard
              projects={data.top_projects}
              currency={currency}
              isPending={isPending && !data}
              isError={isError && !data}
              onRetry={onRetry}
            />
          </div>}

          <details className="group border-t border-border pt-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-xl font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {t('dashboard:exec.howFiguresMeasured', 'How figures are measured')}
            </summary>
            <dl className="grid gap-x-6 gap-y-3 py-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs font-semibold">{t('uxs03.contractValueOnHand', 'Contract value on hand')}</dt><dd className="mt-1 text-sm text-muted-foreground">{t('dashboard:exec.onHandDefinition', 'Contract value for won, on-hold, delivery, and closed-out work, shown by currency.')}</dd></div>
              <div><dt className="text-xs font-semibold">{t('uxs03.activeContractValue', 'Active contract value')}</dt><dd className="mt-1 text-sm text-muted-foreground">{t('dashboard:exec.activeDefinition', 'Contract value for active delivery projects only.')}</dd></div>
              <div><dt className="text-xs font-semibold">{t('dashboard:exec.knownActual', 'Known Actual')}</dt><dd className="mt-1 text-sm text-muted-foreground">{t('dashboard:exec.actualDefinition', 'Recorded ERP-ledger Actual with its project and mapped-category coverage.')}</dd></div>
              <div><dt className="text-xs font-semibold">{t('uxs03.contractRemaining', 'Contract remaining after known Actual')}</dt><dd className="mt-1 text-sm text-muted-foreground">{t('dashboard:exec.remainingDefinition', 'Contract value less complete, same-currency Actual.')}</dd></div>
              <div><dt className="text-xs font-semibold">{t('uxs03.realizedMargin', 'Margin on billed work')}</dt><dd className="mt-1 text-sm text-muted-foreground">{t('dashboard:exec.marginDefinition', 'Billed-work revenue less recorded Actual; it is not cash received.')}</dd></div>
              <div><dt className="text-xs font-semibold">{t('dashboard:winRate.title', 'Win rate')}</dt><dd className="mt-1 text-sm text-muted-foreground">{t('dashboard:exec.winRateDefinition', 'Wins divided by won plus lost closed project outcomes.')}</dd></div>
            </dl>
          </details>
          {abnormalReasons.length > 0 && (
            <aside id="executive-data-note" className="border-t border-border pt-3 text-sm text-muted-foreground">
              <p className="text-xs font-semibold text-foreground">{t('dashboard:exec.dataNoteTitle', 'Some portfolio values are unavailable')}</p>
              <ul className="mt-1 list-inside list-disc space-y-1">
                {abnormalReasons.map((reason, index) => <li key={index}>{reason}</li>)}
              </ul>
              {!actualIncomplete && <p className="mt-1">{mapNote}</p>}
            </aside>
          )}
        </>
      ) : null}
    </section>
  );
};

const PipelineSection: React.FC<{
  data?: ExecutiveDashboardData;
  dashboardPending: boolean;
  dashboardError: boolean;
  onDashboardRetry: () => void;
  pipeline?: { stages: PipelineStage[] };
  pipelinePending: boolean;
  pipelineError: boolean;
  onPipelineRetry: () => void;
  currency: string;
}> = ({ data, dashboardPending, dashboardError, onDashboardRetry, pipeline, pipelinePending, pipelineError, onPipelineRetry, currency }) => {
  const { t } = useTranslation('dashboard');
  const currencyTotals = (data?.pipeline_total_value_by_currency ?? []).map((row) => ({
    currency: row.currency,
    weightedValue: row.weighted_value,
    grossValue: row.total_value,
    forecastMargin: row.forecast_margin,
  }));
  const mixedCurrency = currencyTotals.length > 1;

  return (
    <section aria-labelledby="executive-pipeline-title" className="space-y-4" data-testid="dashboard-pipeline">
      <h2 id="executive-pipeline-title" className="text-xl font-bold">{t('exec.pipeline', 'Pipeline')}</h2>
      {dashboardPending && !data ? (
        <ListState variant="loading" rows={4} />
      ) : dashboardError && !data ? (
        <ListState variant="error" title={t('exec.pipelineTotalsError', "Couldn't load pipeline totals")} onRetry={onDashboardRetry} />
      ) : (
        <>
          {pipelineError ? (
            <ListState variant="error" title={t('dashboard.chart.pipelineMargin.error', "Couldn't load the pipeline")} onRetry={onPipelineRetry} />
          ) : pipelinePending ? (
            <ListState variant="loading" rows={4} />
          ) : pipeline ? (
            <ProjectedMarginBars
              projectedMargin={mixedCurrency ? null : data?.pipeline_projected_margin ?? null}
              stages={pipeline.stages}
              currency={currency}
              currencyTotals={currencyTotals}
              allowStageBars={!mixedCurrency}
            />
          ) : (
            <ListState variant="empty" icon="pipe" title={t('dashboard.chart.pipelineMargin.empty', 'No open pipeline')} />
          )}
        </>
      )}
      <WinRateCard currency={currency} />
    </section>
  );
};

const PurchasingRequests: React.FC<{
  data?: ExecutiveDashboardData;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
}> = ({ data, isPending, isError, onRetry }) => {
  const { t } = useTranslation('dashboard');
  const statusLabel = useProcurementStatusLabel();
  const statusRows = useMemo(() => (data?.procurements_by_status ?? [])
    .filter((row) => row.count > 0)
    .slice()
    .sort((left, right) => left.status.localeCompare(right.status)), [data?.procurements_by_status]);

  return (
    <details data-testid="dashboard-purchasing" className="group border-t border-border pt-2">
      <summary className="flex min-h-11 cursor-pointer items-center text-xl font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {t('dashboard:exec.purchasingRequests', 'Purchasing requests')}
      </summary>
      <div className="pt-2">
        {isPending && !data ? (
          <ListState variant="loading" rows={2} />
        ) : isError && !data ? (
          <ListState variant="error" title={t('dashboard:exec.purchasingLoadError', "Couldn't load purchasing requests")} onRetry={onRetry} />
        ) : statusRows.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t('uxs19.dashboardEmpty', 'No PMO requests to show')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {statusRows.map((row) => (
              <li key={row.status}>
                <Link
                  to={`/procurement?status=${encodeURIComponent(row.status)}`}
                  className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:bg-secondary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="min-w-0">{statusLabel(row.status)}</span>
                  <span className="shrink-0 tabular text-muted-foreground">{formatNumber(row.count)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
};

const ExecutiveDashboard: React.FC = () => {
  const { t } = useTranslation('dashboard');
  const { effectiveRole, realRole } = useEffectiveRole();
  const { data, isPending, isError, refetch } = useDashboard();
  const { data: pipeline, isPending: pipePending, isError: pipeError, refetch: refetchPipe } = useSalesPipeline();
  const { currentUser } = useAuth();
  const { data: procurements, isPending: procPending, isError: procError } = useProcurements();
  const { data: timesheets, isPending: tsPending, isError: tsError } = useTimesheetsAwaitingApproval();
  const orgCurrency = useOrgCurrency();
  const canManageAccounting = can('edit', 'budgetLine', { realRole });
  const canApproveProcurement = can('transition', 'procurement', { realRole });
  const approvalsError = procError || tsError;
  const approvalsPending = procPending || tsPending;
  const approvalCount = useMemo(() => {
    const procurementCount = canApproveProcurement
      ? pendingProcurementApprovals(procurements, currentUser?.id, realRole === 'Admin').length
      : 0;
    return procurementCount + (timesheets?.length ?? 0);
  }, [canApproveProcurement, currentUser?.id, procurements, realRole, timesheets]);

  const projectData = data as ExecutiveDashboardData | undefined;
  const pipelineData = pipeline as { stages: PipelineStage[] } | undefined;

  const renderExecutiveView = () => (
    <div className="space-y-6">
      <DashPageHead
        title={t('dashboard.title', 'Executive Dashboard')}
        sub={t('exec.scope', 'Portfolio · delivery and sales evidence')}
        actions={<span className="[&>button]:min-h-11 [&>span>button]:min-h-11"><BoardPackAction /></span>}
      />
      <ExecutiveAttention
        data={projectData}
        dashboardPending={isPending}
        dashboardError={isError}
        approvalCount={approvalCount}
        approvalPending={approvalsPending}
        approvalError={approvalsError}
      />
      <DeliveryBook
        data={projectData}
        currency={orgCurrency}
        isPending={isPending}
        isError={isError}
        onRetry={() => { void refetch(); }}
        canManageAccounting={canManageAccounting}
      />
      <StillToInvoiceCard />
      <PipelineSection
        data={projectData}
        dashboardPending={isPending}
        dashboardError={isError}
        onDashboardRetry={() => { void refetch(); }}
        pipeline={pipelineData}
        pipelinePending={pipePending}
        pipelineError={pipeError}
        onPipelineRetry={() => { void refetchPipe(); }}
        currency={orgCurrency}
      />
      <PurchasingRequests
        data={projectData}
        isPending={isPending}
        isError={isError}
        onRetry={() => { void refetch(); }}
      />
    </div>
  );

  switch (effectiveRole) {
    case 'Engineer':
      return <EngineerDashboard />;
    case 'Project Manager':
      return <PMDashboard />;
    case 'Finance':
      return <FinanceDashboard />;
    default:
      return renderExecutiveView();
  }
};

export default ExecutiveDashboard;
