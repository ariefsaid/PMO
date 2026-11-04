import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { Column } from '@/src/components/ui';
import { Button, DataTable, Drawer, Icon, ListState, NumberField, ProgressBar, StatusPill, Tooltip } from '@/src/components/ui';
import type { ActiveBudgetCategoryPhasing, BudgetComparisonRow, BudgetProjectionCellRow } from '@/src/lib/repositories/budgetProjection';
import { fetchActiveBudgetCategoryPhasing, fetchBudgetComparison, fetchBudgetProjection, fetchProjectFiscalCalendar, listBudgetFiscalYears } from '@/src/lib/repositories/budgetProjection';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import {
  deriveBudgetComparisonForecast,
  chooseDefaultBudgetProjectionScope,
  mergeBudgetProjectionYears,
  summarizeBudgetComparison,
  type BudgetProjectionScope,
} from '@/src/lib/budget/budgetProjection';
import type { BudgetProjectFiscalCalendar } from '@/src/lib/budget/budgetProjectFiscalCalendar';
import { formatCurrency, formatInstantDate } from '@/src/lib/format';
import { useForecastEditor } from './budget-projection/useForecastEditor';
import { interpretForecast } from './budget-projection/forecastInterpretation';
import { useBudgetDistribution } from '@/src/hooks/useBudget';
import type { BudgetProjectionExport } from '@/src/lib/budget/budgetProjectionExport';

type BudgetForecastCellRow = BudgetProjectionCellRow & {
  mapped: boolean | null;
  hasLedger: boolean | null;
};

interface BudgetProjectionProps {
  projectId: string;
  orgId: string | undefined;
  budgetVersionId: string;
  projectStartDate: string | null;
  projectEndDate: string | null;
  budgetMode: string;
  approvedBudgetYears: readonly string[];
  currency: string;
  budgetCurrency: string;
  canEdit: boolean;
  committedByCategory: Record<string, number | null>;
  canReadCommitments: boolean;
  onAdjustInDraft: () => void;
  onExport: (payload: BudgetProjectionExport) => void;
}

const moneyText = (value: number | null, currency: string) => value === null ? '—' : formatCurrency(value, currency);

const unavailableRecordedText = (row: BudgetComparisonRow, t: (key: string, fallback: string) => string) => {
  if (!row.mapped) return t('projectDetail.budget.recordedNoAccount', 'No ledger account is mapped');
  if (!row.hasLedger) return t('projectDetail.budget.recordedNoLedger', 'No ledger reading is available');
  return t('projectDetail.budget.recordedUnknown', 'Recorded spending is unavailable');
};

/** Forecast final over budget as a percent; the projection carries it as a fraction (0.95 = 95%). */
const utilizationPct = (row: BudgetProjectionCellRow) => row.projectedUtilization === null ? null : row.projectedUtilization * 100;

function projectionTone(row: BudgetProjectionCellRow): 'neutral' | 'won' | 'warn' | 'lost' {
  const pct = utilizationPct(row);
  if (pct === null) return 'neutral';
  if (row.projectedVariance !== null && row.projectedVariance < 0) return 'lost';
  if (pct >= 90) return 'lost';
  if (pct >= 70) return 'warn';
  return 'won';
}

const scopeToken = (scope: BudgetProjectionScope) => JSON.stringify(scope);

export default function BudgetProjection({ projectId, orgId, budgetVersionId, projectStartDate, projectEndDate, budgetMode, approvedBudgetYears, currency, budgetCurrency, canEdit, committedByCategory, canReadCommitments, onAdjustInDraft, onExport }: BudgetProjectionProps) {
  const { t } = useTranslation('finance');
  const [searchParams, setSearchParams] = useSearchParams();
  const [selection, setSelection] = useState<{ identity: string; scope: BudgetProjectionScope } | null>(null);
  const identity = JSON.stringify([orgId, projectId, budgetVersionId, projectStartDate, projectEndDate]);
  const mismatchedCalendarRefresh = useRef<string | null>(null);
  const calendarQuery = useQuery<BudgetProjectFiscalCalendar>({
    queryKey: ['budget-project-calendar', orgId, projectId, budgetVersionId, projectStartDate, projectEndDate],
    queryFn: () => fetchProjectFiscalCalendar(projectId),
    enabled: Boolean(orgId && projectId && budgetVersionId),
    staleTime: 0,
    retry: false,
  });
  const calendarData = calendarQuery.data;
  const calendarIsError = calendarQuery.isError;
  const calendarIsFetching = calendarQuery.isFetching;
  const calendarIsPending = calendarQuery.isPending;
  const calendarIsSuccess = calendarQuery.isSuccess;
  const refetchCalendar = calendarQuery.refetch;
  const yearsQuery = useQuery({
    queryKey: ['budget-fiscal-years', orgId, projectId, budgetVersionId],
    queryFn: () => listBudgetFiscalYears(projectId),
    enabled: Boolean(orgId && projectId && budgetVersionId),
  });
  const wholeProjectMode = budgetMode === 'whole_project';
  const distributionQuery = useBudgetDistribution(projectId, wholeProjectMode ? budgetVersionId : undefined);
  const yearsReady = yearsQuery.isSuccess && (!wholeProjectMode || distributionQuery.isSuccess);
  const calendarResult = calendarIsError ? null : calendarData;
  const calendarBasisMatches = calendarResult?.status === 'resolved' &&
    calendarResult.project.start === projectStartDate && calendarResult.project.end === projectEndDate;
  const calendarMatches = Boolean(calendarBasisMatches && !calendarIsFetching);
  useEffect(() => {
    if (calendarData?.status !== 'resolved' || calendarBasisMatches || calendarIsFetching) {
      if (calendarIsSuccess && calendarBasisMatches) mismatchedCalendarRefresh.current = null;
      return;
    }
    if (mismatchedCalendarRefresh.current === identity) return;
    mismatchedCalendarRefresh.current = identity;
    void refetchCalendar();
  }, [calendarBasisMatches, calendarData, calendarIsFetching, calendarIsSuccess, identity, refetchCalendar]);
  const currentCalendarYears = calendarBasisMatches && !calendarIsFetching && calendarResult?.status === 'resolved'
    ? calendarResult.years.map((year) => year.name)
    : null;
  const years = useMemo(() => mergeBudgetProjectionYears(
    currentCalendarYears,
    wholeProjectMode ? distributionQuery.data?.rows.map((row) => row.fiscal_year) ?? [] : [],
    yearsQuery.data ?? [],
    approvedBudgetYears,
  ), [approvedBudgetYears, currentCalendarYears, distributionQuery.data, wholeProjectMode, yearsQuery.data]);
  const currentYearNames = new Set(currentCalendarYears ?? []);
  const currentYearOptions = years.filter((year) => currentYearNames.has(year.fiscalYear));
  const activeSelection = selection?.identity === identity ? selection.scope : null;
  const scope = activeSelection?.kind === 'all'
    ? activeSelection
    : activeSelection?.kind === 'year' && years.some((year) => year.fiscalYear === activeSelection.year)
      ? activeSelection
      : calendarMatches && yearsReady
        ? chooseDefaultBudgetProjectionScope(currentYearOptions, new Set())
        : null;
  const allYears = scope?.kind === 'all';
  const fiscalYear = scope?.kind === 'year' ? scope.year : null;
  const scopeKey = scope ? scopeToken(scope) : 'unresolved';
  const comparisonQuery = useQuery({
    queryKey: ['budget-comparison', orgId, projectId, budgetVersionId, scopeKey],
    queryFn: () => fetchBudgetComparison(projectId, fiscalYear),
    enabled: Boolean(orgId && projectId && budgetVersionId && scope),
  });
  const projectionQuery = useQuery({
    queryKey: ['budget-projection', orgId, projectId, budgetVersionId, fiscalYear],
    queryFn: () => fetchBudgetProjection(projectId, fiscalYear!),
    enabled: Boolean(orgId && projectId && budgetVersionId && fiscalYear),
  });
  const phasingQuery = useQuery({
    queryKey: ['active-budget-category-phasing', orgId, projectId, budgetVersionId],
    queryFn: () => fetchActiveBudgetCategoryPhasing(projectId),
    enabled: Boolean(orgId && projectId && budgetVersionId && fiscalYear && budgetMode === 'per_year'),
  });
  const distributionPhasing = useMemo<ActiveBudgetCategoryPhasing | undefined>(() => {
    if (!wholeProjectMode || !distributionQuery.data) return undefined;
    const yearsByCategory: Record<string, string[]> = {};
    for (const row of distributionQuery.data.rows) {
      const yearsForCategory = yearsByCategory[row.category] ?? [];
      if (!yearsForCategory.includes(row.fiscal_year)) yearsForCategory.push(row.fiscal_year);
      yearsByCategory[row.category] = yearsForCategory;
    }
    return { years: yearsByCategory, unphased: {} };
  }, [distributionQuery.data, wholeProjectMode]);
  const phasing = wholeProjectMode ? distributionPhasing : phasingQuery.data;
  const compatibleBasis = budgetCurrency === currency;
  const comparisonRows = useMemo(() => comparisonQuery.isError ? [] : comparisonQuery.data ?? [], [comparisonQuery.data, comparisonQuery.isError]);
  const rows = useMemo<BudgetForecastCellRow[]>(() => {
    if (!fiscalYear) return [];
    const projectionByCategory = new Map((projectionQuery.isError ? [] : projectionQuery.data ?? []).map((row) => [row.category, row]));
    const categoryOrder = [...new Set([...comparisonRows.map((row) => row.category), ...projectionByCategory.keys()])];
    const forecastRows = categoryOrder.map((category) => {
      const comparison = comparisonRows.find((row) => row.category === category);
      const projection = projectionByCategory.get(category);
      const forecast = deriveBudgetComparisonForecast({
        category,
        budgetTotal: comparison?.budgetTotal ?? null,
        recorded: comparison?.recorded ?? null,
        pmoEtc: projection?.pmoEtc ?? 0,
      });
      return {
        category,
        pmoBudgetAmount: forecast.budgetTotal,
        actualsToDate: forecast.recorded,
        actualsAsOf: comparison?.recordedAsOf ?? null,
        pmoEtc: forecast.pmoEtc,
        projectedFinalCost: forecast.projectedFinalCost,
        projectedVariance: compatibleBasis ? forecast.projectedRemaining : null,
        projectedUtilization: compatibleBasis ? forecast.projectedUtilization : null,
        attributionKnown: projection?.attributionKnown ?? true,
        mapped: comparison?.mapped ?? null,
        hasLedger: comparison?.hasLedger ?? null,
      };
    });
    const budgetFacts = interpretForecast(forecastRows, fiscalYear, phasing, committedByCategory, canReadCommitments).rows;
    return forecastRows.map((row, index) => budgetFacts[index].budgetStatus === 'known-absent' && row.projectedFinalCost !== null
      ? { ...row, projectedVariance: compatibleBasis ? -row.projectedFinalCost : null }
      : row);
  }, [canReadCommitments, committedByCategory, comparisonRows, compatibleBasis, fiscalYear, phasing, projectionQuery.data, projectionQuery.isError]);
  const allYearSummary = useMemo(() => summarizeBudgetComparison(comparisonRows), [comparisonRows]);
  const hasForecastRows = Boolean(fiscalYear && !comparisonQuery.isPending && !comparisonQuery.isError && !projectionQuery.isPending && !projectionQuery.isError && rows.length > 0);
  const hasAllYearRows = Boolean(scope?.kind === 'all' && !comparisonQuery.isPending && !comparisonQuery.isError && comparisonRows.length > 0);
  const selectedYearScope = scope?.kind === 'year' ? scope : null;
  const selectedYearRow = selectedYearScope && hasForecastRows ? rows.find((row) => row.category === searchParams.get('open')) ?? null : null;
  const selectedComparisonRow = hasAllYearRows ? comparisonRows.find((row) => row.category === searchParams.get('open')) ?? null : null;
  const selected = selectedYearRow ?? selectedComparisonRow;
  const interpretation = fiscalYear ? interpretForecast(rows, fiscalYear, phasing, committedByCategory, canReadCommitments) : null;
  const incompleteRows = interpretation?.rows.filter((item) => item.incomplete) ?? [];
  const reasonText = (reason: NonNullable<typeof interpretation>['rows'][number]['reason']): string | null => {
    if (!reason) return null;
    switch (reason.kind) {
      case 'no-ledger': return t('projectDetail.budget.reasonNoLedger', 'No ledger reading is available for this fiscal year.');
      case 'no-account': return t('projectDetail.budget.reasonNoAccount', 'No accounting ledger account is mapped for this category.');
      case 'other-year': return t('projectDetail.budget.reasonBudgetedOtherYear', 'Budgeted in another fiscal year: {{years}}', { years: reason.years.join(', ') });
      case 'stale-attribution': return t('projectDetail.budget.reasonStaleAttribution', 'Budget attribution is stale or incomplete. Review the line phasing.');
      case 'partial-attribution': return t('projectDetail.budget.reasonPartialAttribution', 'Some budget lines cannot be attributed to this fiscal year. Review the line phasing.');
      case 'no-budget-year': return t('projectDetail.budget.reasonNoBudgetYear', 'No budget is recorded for this fiscal year.');
      case 'no-budget-line': return t('projectDetail.budget.reasonNoBudgetLine', 'No budget line is recorded for this category.');
    }
  };
  const openForecastRow = (row: { category: string }) => {
    const next = new URLSearchParams(searchParams);
    next.set('open', row.category);
    setSearchParams(next);
  };
  const closeForecast = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  };
  const { editing, draft: etcDraft, errors: etcErrors, sectionRef, triggerRef, beginEdit, cancelEdit, changeDraft, saveEdits, save: saveEtc } = useForecastEditor(projectId, fiscalYear ?? '', rows, orgId, budgetVersionId);

  const columns: Column<BudgetForecastCellRow>[] = useMemo(() => [
    {
      key: 'category',
      header: t('financeCopy.category', 'Category'),
      kind: 'primary',
      rowHeader: true,
      cell: (row) => budgetCategoryLabel(row.category, t),
    },
    {
      key: 'budget',
      header: t('financeCopy.budget', 'Budget'),
      kind: 'money',
      align: 'num',
      cell: (row) => <Tooltip content={t('projectDetail.budget.forecastBudgetSource', 'Source: the active budget version, phased to this fiscal year.')}><span tabIndex={0}>{moneyText(row.pmoBudgetAmount, budgetCurrency)}</span></Tooltip>,
    },
    {
      key: 'spent',
      header: t('projectDetail.budget.spentAndCommitted', 'Spent + committed'),
      kind: 'money',
      align: 'num',
      cell: (row) => <Tooltip content={row.actualsAsOf
        ? t('projectDetail.budget.forecastActualsSource', 'ERP ledger through {{date}}. Commitments are project-wide because their source does not assign a fiscal year; they are shown separately and are not included in the fiscal-year final-cost formula.', { date: row.actualsAsOf })
        : t('projectDetail.budget.forecastActualsUnknown', 'ERP ledger spending is not available for this project and fiscal year. Commitments, when available, are project-wide and not fiscal-year-attributed.')}
      ><span tabIndex={0} className="inline-flex flex-col items-end"><span>{moneyText(row.actualsToDate, currency)}</span><span className="text-xs font-normal text-muted-foreground">{t('projectDetail.budget.projectCommitmentsShort', 'Committed · project-wide')}: {canReadCommitments ? moneyText(committedByCategory[row.category] ?? 0, currency) : '—'}</span></span></Tooltip>,
    },
    {
      key: 'etc',
      header: t('projectDetail.budget.costToFinish', 'Cost to finish'),
      kind: 'money',
      align: 'num',
      cell: (row) => editing
        ? <div data-forecast-editor className="min-w-28" onClick={(event) => event.stopPropagation()}>
          <NumberField
            label={t('projectDetail.budget.costToFinishFor', 'Cost to finish for {{category}}', { category: budgetCategoryLabel(row.category, t) })}
            hideLabel
            value={etcDraft[row.category] ?? String(row.pmoEtc)}
            onChange={(value) => changeDraft(row.category, value)}
            error={etcErrors[row.category]}
            aria-label={t('projectDetail.budget.costToFinishFor', 'Cost to finish for {{category}}', { category: budgetCategoryLabel(row.category, t) })}
          />
        </div>
        : <Tooltip content={t('projectDetail.budget.etcSource', 'PM estimate to complete, saved for this fiscal year.')}><span tabIndex={0}>{formatCurrency(row.pmoEtc, currency)}</span></Tooltip>,
    },
    {
      key: 'final',
      header: t('projectDetail.budget.forecastFinal', 'Forecast final'),
      kind: 'money',
      align: 'num',
      cell: (row) => <Tooltip content={t('projectDetail.budget.forecastFinalFormula', 'Calculated as ERP spending to date plus cost to finish.')}><span tabIndex={0}>{moneyText(row.projectedFinalCost, currency)}</span></Tooltip>,
    },
    {
      key: 'remaining',
      header: <span
        title={t('projectTabs:budgetForecast.remainingFull', 'Forecast remaining / (overrun)')}
        aria-label={t('projectTabs:budgetForecast.remainingFull', 'Forecast remaining / (overrun)')}
      >{t('projectTabs:budgetForecast.remainingShort', 'Remaining')}</span>,
      kind: 'money',
      align: 'num',
      cell: (row) => <Tooltip content={t('projectDetail.budget.forecastRemainingFormula', 'Calculated as fiscal-year budget minus forecast final. Negative values are an overrun.')}><span tabIndex={0} className={row.projectedVariance !== null && row.projectedVariance < 0 ? 'text-destructive-text' : undefined}>{moneyText(row.projectedVariance, currency)}</span></Tooltip>,
    },
    {
      key: 'status',
      header: <span
        title={t('projectTabs:budgetForecast.budgetUsedFull', 'Forecast budget used')}
        aria-label={t('projectTabs:budgetForecast.budgetUsedFull', 'Forecast budget used')}
      >{t('projectTabs:budgetForecast.budgetUsedShort', '% used')}</span>,
      kind: 'status',
      cell: (row) => row.projectedUtilization === null
        ? <StatusPill variant="neutral">{t('projectDetail.budget.unavailable', 'Unavailable')}</StatusPill>
        : <span className="flex min-w-28 flex-col gap-1">
          <StatusPill variant={projectionTone(row)}>{row.projectedVariance !== null && row.projectedVariance < 0 ? t('projectDetail.budget.overBudget', 'Over budget') : utilizationPct(row)! >= 90 ? t('projectDetail.budget.atRisk', 'At risk') : utilizationPct(row)! >= 70 ? t('projectDetail.budget.watch', 'Watch') : t('projectDetail.budget.onTrack', 'On track')}</StatusPill>
          <Tooltip content={t('projectDetail.budget.forecastUtilizationFormula', 'Forecast final divided by fiscal-year budget.')}><span tabIndex={0}><ProgressBar compact value={Math.round(utilizationPct(row)!)} showValue aria-label={`${budgetCategoryLabel(row.category, t)} ${t('projectDetail.budget.forecastUtilization', 'forecast utilization')}`} /></span></Tooltip>
        </span>,
    },
  ], [budgetCurrency, canReadCommitments, committedByCategory, currency, editing, etcDraft, etcErrors, changeDraft, t]);

  const comparisonColumns: Column<BudgetComparisonRow>[] = useMemo(() => [
    {
      key: 'category',
      header: t('financeCopy.category', 'Category'),
      kind: 'primary',
      rowHeader: true,
      cell: (row) => budgetCategoryLabel(row.category, t),
    },
    {
      key: 'budget',
      header: t('projectDetail.budget.approvedTotal', 'Approved total'),
      kind: 'money',
      align: 'num',
      cell: (row) => <Tooltip content={t('projectDetail.budget.wholeBudgetSource', 'Source: the Active budget version, counted once across the project.')}><span tabIndex={0}>{moneyText(row.budgetTotal, budgetCurrency)}</span></Tooltip>,
    },
    {
      key: 'recorded',
      header: t('projectDetail.budget.recordedToDate', 'Recorded to date'),
      kind: 'money',
      align: 'num',
      cell: (row) => <Tooltip content={row.recorded === null
        ? unavailableRecordedText(row, t)
        : row.recordedAsOf
          ? t('projectDetail.budget.wholeRecordedSource', 'Source: mapped ERP ledger through {{date}}.', { date: formatInstantDate(row.recordedAsOf) })
          : t('projectDetail.budget.wholeRecordedUnknownSource', 'Source: mapped ERP ledger. The reading date is unavailable.')}
      ><span tabIndex={0} className="inline-flex flex-col items-end"><span>{moneyText(row.recorded, currency)}</span><span className="text-xs font-normal text-muted-foreground">{row.recorded === null ? unavailableRecordedText(row, t) : row.recordedAsOf ? t('projectDetail.budget.recordedAsOf', 'As of {{date}}', { date: formatInstantDate(row.recordedAsOf) }) : t('projectDetail.budget.recordedDateUnknown', 'Date unavailable')}</span></span></Tooltip>,
    },
    {
      key: 'remaining',
      header: <span title={t('projectDetail.budget.wholeRemainingFull', 'Approved total remaining after recorded spending')} aria-label={t('projectDetail.budget.wholeRemainingFull', 'Approved total remaining after recorded spending')}>{t('projectDetail.budget.remainingShort', 'Remaining')}</span>,
      kind: 'money',
      align: 'num',
      cell: (row) => <Tooltip content={t('projectDetail.budget.wholeRemainingFormula', 'Calculated as approved project budget minus recorded project spending. This does not include a forecast.') }><span tabIndex={0} className={compatibleBasis && row.remaining !== null && row.remaining < 0 ? 'text-destructive-text' : undefined}>{moneyText(compatibleBasis ? row.remaining : null, currency)}</span></Tooltip>,
    },
    {
      key: 'percent',
      header: <span title={t('projectDetail.budget.recordedUsedFull', 'Recorded spending as a share of approved budget')} aria-label={t('projectDetail.budget.recordedUsedFull', 'Recorded spending as a share of approved budget')}>{t('projectDetail.budget.percentRecordedShort', '% recorded')}</span>,
      kind: 'status',
      cell: (row) => row.percentUsed === null || !compatibleBasis
        ? <StatusPill variant="neutral">{t('projectDetail.budget.unavailable', 'Unavailable')}</StatusPill>
        : <Tooltip content={t('projectDetail.budget.wholePercentFormula', 'Recorded spending divided by the approved project budget.')}><span tabIndex={0}><ProgressBar compact value={Math.round(row.percentUsed * 100)} showValue aria-label={`${budgetCategoryLabel(row.category, t)} ${t('projectDetail.budget.recordedPercentAria', 'recorded percent of approved budget')}`} /></span></Tooltip>,
    },
  ], [budgetCurrency, compatibleBasis, currency, t]);

  const yearSummary = interpretation?.summary;
  const { budget: totalBudget, remaining: totalForecastRemaining, committed: totalCommitted } = yearSummary ?? { budget: null, remaining: null, committed: null };
  const totals = rows.length && yearSummary ? [{
    key: 'total',
    label: t('financeCopy.total', 'Total'),
    values: {
      budget: moneyText(totalBudget, budgetCurrency),
      spent: <span className="inline-flex flex-col items-end"><span>{moneyText(yearSummary.actuals, currency)}</span><span className="text-xs font-normal text-muted-foreground">{t('projectDetail.budget.projectCommitmentsShort', 'Committed · project-wide')}: {moneyText(totalCommitted, currency)}</span></span>,
      etc: formatCurrency(yearSummary.etc, currency),
      final: moneyText(yearSummary.final, currency),
      remaining: moneyText(totalForecastRemaining, currency),
    },
  }] : [];
  const viewLoading = !scope || comparisonQuery.isPending || (scope.kind === 'year' && (!yearsReady || projectionQuery.isPending));
  const viewError = Boolean(scope && (comparisonQuery.isError || (scope.kind === 'year' && projectionQuery.isError)));
  const viewRetry = () => {
    if (calendarQuery.isError) void calendarQuery.refetch();
    else if (yearsQuery.isError) void yearsQuery.refetch();
    else if (wholeProjectMode && distributionQuery.isError) void distributionQuery.refetch();
    else if (comparisonQuery.isError) void comparisonQuery.refetch();
    else if (projectionQuery.isError) void projectionQuery.refetch();
    else void calendarQuery.refetch();
  };
  const allYearsScope = { kind: 'all' as const };
  const setScopeFromToken = (value: string) => {
    const next = value === scopeToken(allYearsScope)
      ? allYearsScope
      : years.map(({ fiscalYear }) => ({ kind: 'year' as const, year: fiscalYear })).find((option) => scopeToken(option) === value);
    if (next) setSelection({ identity, scope: next });
  };
  const calendarMessage = calendarIsPending || calendarIsFetching
    ? t('projectDetail.budget.currentCalendarLoading', 'Loading the current project fiscal calendar…')
    : calendarQuery.isError || calendarResult?.status === 'unavailable'
      ? t('projectDetail.budget.currentCalendarUnavailable', 'The current project fiscal calendar is unavailable.')
      : !calendarResult || (calendarResult.status === 'resolved' && !calendarMatches) || calendarResult.status === 'unresolved'
        ? t('projectDetail.budget.currentCalendarUnresolved', 'Current fiscal calendar could not be resolved.')
        : calendarResult.status === 'bad-project-dates'
          ? t('projectDetail.budget.currentCalendarBadDates', 'Project dates are missing or invalid, so the current fiscal years cannot be determined.')
          : calendarResult.status === 'binding-unavailable'
            ? t('projectDetail.budget.currentCalendarBindingUnavailable', 'The connected ERP company fiscal calendar is unavailable.')
            : null;
  const fiscalYearLabel = (year: (typeof years)[number]) => {
    const source = currentYearNames.has(year.fiscalYear)
      ? year.hasActiveBudget ? 'currentApprovedYear' : 'currentYear'
      : year.hasActiveBudget ? 'approvedHistoricalYear' : 'observedHistoricalYear';
    const fallback = source === 'currentApprovedYear' ? 'current · approved budget'
      : source === 'currentYear' ? 'current'
        : source === 'approvedHistoricalYear' ? 'approved / historical' : 'observed / historical';
    return `${year.fiscalYear} · ${t(`projectDetail.budget.${source}`, fallback)}`;
  };

  return (
    <section ref={sectionRef} className="min-w-0 space-y-3" aria-label={t('projectDetail.budget.forecast', 'Forecast')} data-testid="budget-forecast-view">
      {calendarMessage && <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>{calendarMessage}</span>
        <Button variant="ghost" size="sm" onClick={() => void calendarQuery.refetch()}>{t('common.retry', 'Retry')}</Button>
      </p>}
      {(yearsQuery.isError || (wholeProjectMode && distributionQuery.isError)) && <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>{t('projectDetail.budget.fiscalYearsError', 'Saved fiscal-year choices could not be loaded')}</span>
        <Button variant="ghost" size="sm" onClick={() => void (yearsQuery.isError ? yearsQuery.refetch() : distributionQuery.refetch())}>{t('common.retry', 'Retry')}</Button>
      </p>}
      {!compatibleBasis && <p role="status" className="text-sm text-muted-foreground">{t('projectDetail.budget.currencyBasisNotice', 'Budget: {{budgetCurrency}}. Spending and commitments: {{projectCurrency}}. Comparisons are unavailable across currencies.', { budgetCurrency, projectCurrency: currency })}</p>}
      {hasAllYearRows && <>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3 border-y border-border/70 py-3 text-sm sm:grid-cols-4 sm:max-w-4xl sm:gap-x-6">
          <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t('projectDetail.budget.approvedTotal', 'Approved total')}</dt><dd className="mt-1 whitespace-nowrap font-semibold tabular-nums">{moneyText(allYearSummary.budget, budgetCurrency)}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t('projectDetail.budget.recordedToDate', 'Recorded to date')}</dt><dd className="mt-1 whitespace-nowrap font-semibold tabular-nums">{moneyText(allYearSummary.recorded, currency)}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t('projectDetail.budget.remainingShort', 'Remaining')}</dt><dd className="mt-1 whitespace-nowrap font-semibold tabular-nums">{moneyText(compatibleBasis ? allYearSummary.remaining : null, currency)}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t('projectDetail.budget.percentRecordedShort', '% recorded')}</dt><dd className="mt-1 whitespace-nowrap font-semibold tabular-nums">{compatibleBasis && allYearSummary.percentUsed !== null ? `${Math.round(allYearSummary.percentUsed * 100)}%` : t('projectDetail.budget.unavailable', 'Unavailable')}</dd><dd className="mt-1 text-xs text-muted-foreground">{t('projectDetail.budget.wholePercentFormula', 'Recorded spending divided by the approved project budget.')}</dd></div>
        </dl>
        {(allYearSummary.unknownBudget.length > 0 || allYearSummary.unknownRecorded.length > 0) && <p role="status" data-testid="whole-project-unknown" className="text-sm text-muted-foreground">
          {t('projectDetail.budget.comparisonUnknownCategories', 'Some figures are unavailable: approved budget for {{budgetCategories}}; recorded spending for {{recordedCategories}}.', {
            budgetCategories: allYearSummary.unknownBudget.map((category) => budgetCategoryLabel(category, t)).join(', ') || t('projectDetail.budget.none', 'none'),
            recordedCategories: allYearSummary.unknownRecorded.map((category) => budgetCategoryLabel(category, t)).join(', ') || t('projectDetail.budget.none', 'none'),
          })}
        </p>}
      </>}
      {hasForecastRows && yearSummary && <dl className="grid grid-cols-2 gap-x-3 gap-y-3 border-y border-border/70 py-3 text-sm sm:max-w-2xl sm:gap-x-6">
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t('financeCopy.total', 'Total')} {t('financeCopy.budget', 'Budget')}</dt><dd className="mt-1 whitespace-nowrap font-semibold tabular-nums">{moneyText(totalBudget, budgetCurrency)}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t('projectDetail.budget.forecastRemaining', 'Forecast remaining')}</dt><dd className="mt-1 whitespace-nowrap font-semibold tabular-nums">{moneyText(totalForecastRemaining, currency)}</dd></div>
      </dl>}
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <label className="flex min-w-44 flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('projectDetail.budget.fiscalYear', 'Fiscal year')}
          <select aria-label={t('projectDetail.budget.fiscalYear', 'Fiscal year')} value={scopeKey} disabled={editing || saveEtc.isPending} onChange={(event) => setScopeFromToken(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground">
            {!scope && <option value="unresolved" disabled>{calendarIsPending || calendarIsFetching || yearsQuery.isPending ? t('projectDetail.budget.scopeLoading', 'Loading fiscal years') : t('projectDetail.budget.scopeUnresolved', 'Current fiscal years unavailable')}</option>}
            <option value={scopeToken(allYearsScope)}>{t('projectDetail.budget.allYearsProjectToDate', 'All years (project to date)')}</option>
            {years.map((year) => <option key={year.fiscalYear} value={scopeToken({ kind: 'year', year: year.fiscalYear })}>{fiscalYearLabel(year)}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {hasAllYearRows && <Button variant="outline" size="sm" onClick={() => onExport({ scope: allYearsScope, rows: comparisonRows })}>{t('projectDetail.budget.export', 'Export')}</Button>}
          {selectedYearScope && hasForecastRows && <Button variant="outline" size="sm" onClick={() => onExport({ scope: selectedYearScope, rows })}>{t('projectDetail.budget.export', 'Export')}</Button>}
          {selectedYearScope && hasForecastRows && canEdit && rows.length > 0 && (editing ? <>
            <Button variant="primary" size="sm" loading={saveEtc.isPending} onClick={saveEdits}>{saveEtc.data?.failed.length ? t('projectDetail.budget.retryFailedEtc', 'Retry failed edits') : t('common.save', 'Save')}</Button>
            <Button variant="outline" size="sm" onClick={cancelEdit}>{t('common.cancel', 'Cancel')}</Button>
          </> : <Button ref={triggerRef} variant="outline" size="sm" onClick={beginEdit}>{t('projectDetail.budget.editCostToFinish', 'Edit cost to finish')}</Button>)}
        </div>
      </div>
      {viewLoading ? <ListState variant="loading" rows={4} />
        : viewError ? <ListState variant="error" title={t('projectDetail.budget.forecastError', 'Forecast could not be loaded')} onRetry={viewRetry} />
          : allYears && comparisonRows.length === 0 ? <ListState variant="empty" title={t('projectDetail.budget.noComparisonRows', 'No approved budget or recorded spending is available yet')} sub={t('projectDetail.budget.noComparisonRowsSub', 'All-years comparison reads the active approved budget and mapped ledger records.')} />
            : !allYears && rows.length === 0 ? <ListState variant="empty" title={t('projectDetail.budget.noForecastRows', 'No forecast categories for this fiscal year')} sub={t('projectDetail.budget.noForecastRowsSub', 'No approved budget or ledger spending is available for this fiscal year.')} />
            : allYears ? <DataTable
              rows={comparisonRows}
              columns={comparisonColumns}
              rowKey={(row) => row.category}
              rowLabel={(row) => t('projectDetail.budget.openComparisonCategory', 'Open {{category}} budget comparison', { category: budgetCategoryLabel(row.category, t) })}
              onActivate={openForecastRow}
              tableId="project-budget-whole-project-comparison"
              accessibleName={t('projectDetail.budget.comparisonTable', 'Approved budget compared with recorded spending')}
              cardBelow={600}
              embedded
            />
            : scope?.kind === 'year' ? <>
              {saveEtc.data?.failed.length ? <p role="status" className="text-sm text-warning-foreground">{t('projectDetail.budget.etcPartialSaveNamed', 'Saved: {{saved}}. Not saved: {{failed}}. The failed values remain here so you can retry.', { saved: saveEtc.data.saved.map((entry) => budgetCategoryLabel(entry.category, t)).join(', ') || t('projectDetail.budget.none', 'none'), failed: saveEtc.data.failed.map((item) => budgetCategoryLabel(item.category, t)).join(', ') })}</p> : null}
              <DataTable
                rows={rows}
                columns={columns}
                rowKey={(row) => row.category}
                rowLabel={(row) => t('projectDetail.budget.openForecastCategory', 'Open {{category}} forecast details', { category: budgetCategoryLabel(row.category, t) })}
                onActivate={openForecastRow}
                rowMenu={() => canEdit ? [{ label: t('projectDetail.budget.editCostToFinish', 'Edit cost to finish'), onClick: beginEdit }] : []}
                tableId="project-budget-forecast"
                accessibleName={t('projectDetail.budget.forecastTable', 'Budget forecast by category')}
                cardBelow={600}
                embedded
                totals={totals}
              />
              <p className="text-xs text-muted-foreground">{t('projectDetail.budget.forecastCommitmentScope', 'Committed amounts are project-wide; the current source does not assign them to a fiscal year. They are shown separately and are not included in the fiscal-year forecast final.')}</p>
              {incompleteRows.length > 0 && <div role="status" data-testid="forecast-incomplete" className="space-y-1 text-sm text-muted-foreground">
                <p>{t('projectDetail.budget.forecastIncompleteCategories', 'Incomplete categories: {{categories}}', { categories: incompleteRows.map(({ row }) => budgetCategoryLabel(row.category, t)).join(', ') })}</p>
                {incompleteRows.map(({ row, reason }) => <p key={`reason-${row.category}`}>{budgetCategoryLabel(row.category, t)}: {reasonText(reason)}</p>)}
              </div>}
              {rows.find((row) => row.actualsAsOf)?.actualsAsOf && <p className="text-xs text-muted-foreground">{t('projectDetail.budget.forecastSummaryAsOf', 'Recorded spending as of {{date}}', { date: formatInstantDate(rows.find((row) => row.actualsAsOf)!.actualsAsOf!) })}</p>}
            </> : null}
      <Drawer
        open={Boolean(selected)}
        title={selected ? budgetCategoryLabel(selected.category, t) : ''}
        icon={<Icon name="dollar" />}
        status={selectedYearRow
          ? <StatusPill variant={projectionTone(selectedYearRow)}>{t('projectDetail.budget.forecast', 'Forecast')}</StatusPill>
          : selectedComparisonRow
            ? <StatusPill variant="neutral">{t('projectDetail.budget.comparison', 'Budget comparison')}</StatusPill>
            : <StatusPill variant="neutral">{t('projectDetail.budget.forecast', 'Forecast')}</StatusPill>}
        onClose={closeForecast}
        width="lg"
        headerActions={selected && <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {canEdit && <Button variant="primary" size="sm" onClick={onAdjustInDraft}>{t('projectDetail.budget.adjustInDraft', 'Adjust in a draft')}</Button>}
          <Link className="touch-target inline-flex min-h-9 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-accent" to={`/projects/${encodeURIComponent(projectId)}/budget?${new URLSearchParams({ budgetView: 'forecast' })}`}>{t('projectDetail.budget.openFullPage', 'Open full page')}</Link>
        </div>}
        footer={selected && <div className="flex flex-wrap items-center justify-end gap-2">
          {selectedYearRow && selectedYearScope && <Button variant="ghost" size="sm" onClick={() => onExport({ scope: selectedYearScope, rows: [selectedYearRow] })}>{t('projectDetail.budget.export', 'Export')}</Button>}
          {selectedComparisonRow && <Button variant="ghost" size="sm" onClick={() => onExport({ scope: allYearsScope, rows: [selectedComparisonRow] })}>{t('projectDetail.budget.export', 'Export')}</Button>}
        </div>}
      >
        {selectedYearRow && <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              [t('financeCopy.budget', 'Budget'), moneyText(selectedYearRow.pmoBudgetAmount, budgetCurrency), t('projectDetail.budget.forecastBudgetSource', 'Source: the active budget version, phased to this fiscal year.')],
              [t('projectDetail.budget.spent', 'Spent'), moneyText(selectedYearRow.actualsToDate, currency), t('projectDetail.budget.forecastActualsAsOf', 'Source: ERP ledger through the recorded as-of date.')],
              [t('projectDetail.budget.projectCommitmentsShort', 'Committed · project-wide'), canReadCommitments ? moneyText(committedByCategory[selectedYearRow.category] ?? 0, currency) : '—', t('projectDetail.budget.forecastCommitmentSummary', 'Committed amounts are project-wide and not assigned to a fiscal year.')],
              [t('projectDetail.budget.costToFinish', 'Cost to finish'), formatCurrency(selectedYearRow.pmoEtc, currency), t('projectDetail.budget.etcSource', 'PM estimate to complete, saved for this fiscal year.')],
              [t('projectDetail.budget.forecastFinal', 'Forecast final'), moneyText(selectedYearRow.projectedFinalCost, currency), t('projectDetail.budget.forecastFinalFormula', 'Calculated as ERP spending to date plus cost to finish.')],
              [t('projectDetail.budget.forecastRemaining', 'Forecast remaining'), moneyText(selectedYearRow.projectedVariance, currency), t('projectDetail.budget.forecastRemainingFormula', 'Calculated as fiscal-year budget minus forecast final. Negative values are an overrun.')],
            ].map(([label, value, source]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold tabular-nums"><Tooltip content={source}><span tabIndex={0}>{value}</span></Tooltip></dd></div>)}
          </dl>
          <section aria-labelledby="forecast-records-heading" className="space-y-2">
            <h3 id="forecast-records-heading" className="text-sm font-semibold">{t('projectDetail.budget.recordsBehindSpending', 'Records behind the spending')}</h3>
            <p className="text-sm text-muted-foreground">{t('projectDetail.budget.ledgerRowsUnavailable', 'Transaction-level ledger records are unavailable in the project finance summary.')}</p>
          </section>
          <section aria-labelledby="forecast-notes-heading" className="space-y-2">
            <h3 id="forecast-notes-heading" className="text-sm font-semibold">{t('projectDetail.budget.notes', 'Notes')}</h3>
            <p className="text-sm text-muted-foreground">{t('projectDetail.budget.categoryNotesUnavailable', 'No category notes are recorded.')}</p>
          </section>
        </div>}
        {selectedComparisonRow && <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              [t('projectDetail.budget.approvedTotal', 'Approved total'), moneyText(selectedComparisonRow.budgetTotal, budgetCurrency), t('projectDetail.budget.wholeBudgetSource', 'Source: the Active budget version, counted once across the project.')],
              [t('projectDetail.budget.recordedToDate', 'Recorded to date'), moneyText(selectedComparisonRow.recorded, currency), selectedComparisonRow.recordedAsOf
                ? t('projectDetail.budget.wholeRecordedSource', 'Source: mapped ERP ledger through {{date}}.', { date: formatInstantDate(selectedComparisonRow.recordedAsOf) })
                : unavailableRecordedText(selectedComparisonRow, t)],
              [t('projectDetail.budget.remainingShort', 'Remaining'), moneyText(compatibleBasis ? selectedComparisonRow.remaining : null, currency), t('projectDetail.budget.wholeRemainingFormula', 'Calculated as approved project budget minus recorded project spending. This does not include a forecast.')],
              [t('projectDetail.budget.percentRecordedShort', '% recorded'), compatibleBasis && selectedComparisonRow.percentUsed !== null ? `${Math.round(selectedComparisonRow.percentUsed * 100)}%` : t('projectDetail.budget.unavailable', 'Unavailable'), t('projectDetail.budget.wholePercentFormula', 'Recorded spending divided by the approved project budget.')],
            ].map(([label, value, source]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold tabular-nums"><Tooltip content={source}><span tabIndex={0}>{value}</span></Tooltip></dd></div>)}
          </dl>
          <p className="text-sm text-muted-foreground">{selectedComparisonRow.recorded === null
            ? unavailableRecordedText(selectedComparisonRow, t)
            : selectedComparisonRow.recordedAsOf
              ? t('projectDetail.budget.recordedAsOf', 'As of {{date}}', { date: formatInstantDate(selectedComparisonRow.recordedAsOf) })
              : t('projectDetail.budget.recordedDateUnknown', 'Date unavailable')}</p>
          <p className="text-sm text-muted-foreground">{t('projectDetail.budget.wholeComparisonScope', 'This is an approved-budget comparison with recorded spending across the project. It does not include cost to finish or a forecast final.')}</p>
        </div>}
      </Drawer>
    </section>
  );
}
