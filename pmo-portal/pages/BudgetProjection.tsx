import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { Column } from '@/src/components/ui';
import { Button, DataTable, Drawer, Icon, ListState, NumberField, ProgressBar, StatusPill, Tooltip } from '@/src/components/ui';
import type { BudgetProjectionCellRow } from '@/src/lib/repositories/budgetProjection';
import { fetchActiveBudgetCategoryPhasing, fetchBudgetProjection, fetchFirstSpendingYear, listBudgetFiscalYears, upsertBudgetProjectionEtc } from '@/src/lib/repositories/budgetProjection';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { chooseDefaultBudgetFiscalYear } from '@/src/lib/budget/budgetProjection';
import { formatCurrencyAuto, formatInstantDate, parseMoneyInputAtScale } from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { interpretForecast } from './budget-projection/forecastInterpretation';

interface BudgetProjectionProps {
  projectId: string;
  currency: string;
  budgetCurrency: string;
  canEdit: boolean;
  committedByCategory: Record<string, number | null>;
  canReadCommitments: boolean;
  onAdjustInDraft: () => void;
  onExport: (rows: BudgetProjectionCellRow[]) => void;
}

const moneyText = (value: number | null, currency: string) => value === null ? '—' : formatCurrencyAuto(value, currency);

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

export default function BudgetProjection({ projectId, currency, budgetCurrency, canEdit, committedByCategory, canReadCommitments, onAdjustInDraft, onExport }: BudgetProjectionProps) {
  const { t } = useTranslation('finance');
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [requestedYear, setRequestedYear] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [etcDraft, setEtcDraft] = useState<Record<string, string>>({});
  const [etcErrors, setEtcErrors] = useState<Record<string, string>>({});
  // I-3: focus goes into the editor on open and returns to the Edit button on every exit.
  const sectionRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (editing) { sectionRef.current?.querySelector<HTMLInputElement>('tbody input, [role="rowgroup"] input')?.focus(); return; }
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    triggerRef.current?.focus();
  }, [editing]);
  const closeEdit = () => { restoreFocus.current = true; setEditing(false); };
  const yearsQuery = useQuery({
    queryKey: ['budget-fiscal-years', projectId],
    queryFn: () => listBudgetFiscalYears(projectId),
    enabled: Boolean(projectId),
  });
  const years = yearsQuery.data ?? [];
  const defaultYearQuery = useQuery<string | null>({
    queryKey: ['budget-default-fiscal-year', projectId, years.map(({ fiscalYear, isActivePush }) => ({ fiscalYear, isActivePush }))],
    queryFn: async () => {
      const firstSpendingYear = years.length ? await fetchFirstSpendingYear(projectId, years.map((year) => year.fiscalYear)) : null;
      const yearsWithSpending = new Set(firstSpendingYear === null ? [] : [firstSpendingYear]);
      return chooseDefaultBudgetFiscalYear(years, yearsWithSpending);
    },
    enabled: yearsQuery.isSuccess,
  });
  const fiscalYear = requestedYear === undefined ? defaultYearQuery.data ?? '' : requestedYear;
  const projectionQuery = useQuery({
    queryKey: ['budget-projection', projectId, fiscalYear],
    queryFn: () => fetchBudgetProjection(projectId, fiscalYear),
    enabled: Boolean(projectId && fiscalYear),
  });
  const phasingQuery = useQuery({
    queryKey: ['active-budget-category-phasing', projectId],
    queryFn: () => fetchActiveBudgetCategoryPhasing(projectId),
    enabled: Boolean(projectId && fiscalYear),
  });
  const compatibleBasis = budgetCurrency === currency;
  const rows = useMemo(() => (projectionQuery.data ?? []).map((row) => compatibleBasis ? row : { ...row, projectedVariance: null, projectedUtilization: null }), [projectionQuery.data, compatibleBasis]);
  const hasForecastRows = Boolean(fiscalYear && !projectionQuery.isPending && !projectionQuery.isError && rows.length > 0);
  const selected = rows.find((row) => row.category === searchParams.get('open')) ?? null;
  const interpretation = interpretForecast(rows, fiscalYear, phasingQuery.data, committedByCategory, canReadCommitments);
  const incompleteRows = interpretation.rows.filter((item) => item.incomplete);
  const reasonText = (reason: (typeof interpretation.rows)[number]['reason']): string | null => {
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
  const openForecastRow = (row: BudgetProjectionCellRow) => {
    const next = new URLSearchParams(searchParams);
    next.set('open', row.category);
    setSearchParams(next);
  };
  const closeForecast = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  };
  const saveEtc = useMutation({
    mutationFn: async (entries: Array<{ category: BudgetProjectionCellRow['category']; amount: number }>) => {
      const failed: Array<{ category: BudgetProjectionCellRow['category']; amount: number; reason: string }> = [];
      const saved: BudgetProjectionCellRow['category'][] = [];
      for (const entry of entries) {
        try {
          await upsertBudgetProjectionEtc(projectId, fiscalYear, entry.category, entry.amount);
          saved.push(entry.category);
        } catch (error) {
          failed.push({ ...entry, reason: classifyMutationError(error).headline });
        }
      }
      return { failed, saved };
    },
    onSuccess: ({ failed }) => {
      void queryClient.invalidateQueries({ queryKey: ['budget-projection', projectId, fiscalYear] });
      setEtcDraft(Object.fromEntries(failed.map((item) => [item.category, String(item.amount)])));
      setEtcErrors(Object.fromEntries(failed.map((item) => [item.category, t('projectDetail.budget.etcRowNotSaved', 'Not saved. {{reason}}', { reason: item.reason })])));
      if (failed.length === 0) closeEdit();
    },
  });

  const beginEdit = () => {
    setEtcDraft(Object.fromEntries(rows.map((row) => [row.category, String(row.pmoEtc)])));
    setEtcErrors({});
    setEditing(true);
  };
  const saveEdits = () => {
    const entries: Array<{ category: BudgetProjectionCellRow['category']; amount: number }> = [];
    const errors: Record<string, string> = {};
    for (const row of rows) {
      const raw = etcDraft[row.category] ?? String(row.pmoEtc);
      const parsed = parseMoneyInputAtScale(raw, 2);
      if (parsed === null || parsed < 0) {
        errors[row.category] = t('projectDetail.budget.etcValidation', 'Enter a non-negative amount with up to 2 decimal places.');
      } else if (parsed !== row.pmoEtc) {
        entries.push({ category: row.category, amount: parsed });
      }
    }
    setEtcErrors(errors);
    if (Object.keys(errors).length > 0 || entries.length === 0) {
      if (entries.length === 0 && Object.keys(errors).length === 0) closeEdit();
      return;
    }
    saveEtc.mutate(entries);
  };

  const columns: Column<BudgetProjectionCellRow>[] = useMemo(() => [
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
        ? <div className="min-w-28" onClick={(event) => event.stopPropagation()}>
          <NumberField
            label={t('projectDetail.budget.costToFinishFor', 'Cost to finish for {{category}}', { category: budgetCategoryLabel(row.category, t) })}
            hideLabel
            value={etcDraft[row.category] ?? String(row.pmoEtc)}
            onChange={(value) => setEtcDraft((current) => ({ ...current, [row.category]: value }))}
            error={etcErrors[row.category]}
            aria-label={t('projectDetail.budget.costToFinishFor', 'Cost to finish for {{category}}', { category: budgetCategoryLabel(row.category, t) })}
          />
        </div>
        : <Tooltip content={t('projectDetail.budget.etcSource', 'PM estimate to complete, saved for this fiscal year.')}><span tabIndex={0}>{formatCurrencyAuto(row.pmoEtc, currency)}</span></Tooltip>,
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
  ], [budgetCurrency, canReadCommitments, committedByCategory, currency, editing, etcDraft, etcErrors, t]);

  const { budget: totalBudget, remaining: totalForecastRemaining, committed: totalCommitted } = interpretation.summary;
  const totals = rows.length ? [{
    key: 'total',
    label: t('financeCopy.total', 'Total'),
    values: {
      budget: moneyText(totalBudget, budgetCurrency),
      spent: <span className="inline-flex flex-col items-end"><span>{moneyText(interpretation.summary.actuals, currency)}</span><span className="text-xs font-normal text-muted-foreground">{t('projectDetail.budget.projectCommitmentsShort', 'Committed · project-wide')}: {moneyText(totalCommitted, currency)}</span></span>,
      etc: formatCurrencyAuto(interpretation.summary.etc, currency),
      final: moneyText(interpretation.summary.final, currency),
      remaining: moneyText(totalForecastRemaining, currency),
    },
  }] : [];

  if (yearsQuery.isError || defaultYearQuery.isError) {
    return <ListState
      variant="error"
      title={t('projectDetail.budget.fiscalYearsError', 'Fiscal years could not be loaded')}
      onRetry={() => void (yearsQuery.isError ? yearsQuery.refetch() : defaultYearQuery.refetch())}
    />;
  }

  return (
    <section ref={sectionRef} className="min-w-0 space-y-3" aria-label={t('projectDetail.budget.forecast', 'Forecast')} data-testid="budget-forecast-view">
      {!compatibleBasis && <p role="status" className="text-sm text-muted-foreground">{t('projectDetail.budget.currencyBasisNotice', 'Budget: {{budgetCurrency}}. Spending and commitments: {{projectCurrency}}. Comparisons are unavailable across currencies.', { budgetCurrency, projectCurrency: currency })}</p>}
      {hasForecastRows && <dl className="grid grid-cols-2 gap-x-3 gap-y-3 border-y border-border/70 py-3 text-sm sm:max-w-2xl sm:gap-x-6">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t('financeCopy.total', 'Total')} {t('financeCopy.budget', 'Budget')}</dt>
          <dd className="mt-1 whitespace-nowrap font-semibold tabular-nums">{moneyText(totalBudget, budgetCurrency)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t('projectDetail.budget.forecastRemaining', 'Forecast remaining')}</dt>
          <dd className="mt-1 whitespace-nowrap font-semibold tabular-nums">{moneyText(totalForecastRemaining, currency)}</dd>
        </div>
      </dl>}
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <label className="flex min-w-44 flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('projectDetail.budget.fiscalYear', 'Fiscal year')}
          <select aria-label={t('projectDetail.budget.fiscalYear', 'Fiscal year')} value={fiscalYear} disabled={editing || saveEtc.isPending} onChange={(event) => setRequestedYear(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground">
            <option value="">{t('projectDetail.budget.wholeProject', 'Whole project')}</option>
            {years.map((year) => <option key={year.fiscalYear} value={year.fiscalYear}>{year.fiscalYear}{year.isActivePush ? ` · ${t('projectDetail.budget.activePushYear', 'active push')}` : ''}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {rows.length > 0 && <Button variant="outline" size="sm" onClick={() => onExport(rows)}>{t('projectDetail.budget.export', 'Export')}</Button>}
          {canEdit && rows.length > 0 && (editing ? <>
            <Button variant="primary" size="sm" loading={saveEtc.isPending} onClick={saveEdits}>{saveEtc.data?.failed.length ? t('projectDetail.budget.retryFailedEtc', 'Retry failed edits') : t('common.save', 'Save')}</Button>
            <Button variant="outline" size="sm" onClick={() => { setEtcErrors({}); setEtcDraft({}); closeEdit(); }}>{t('common.cancel', 'Cancel')}</Button>
          </> : <Button ref={triggerRef} variant="outline" size="sm" onClick={beginEdit}>{t('projectDetail.budget.editCostToFinish', 'Edit cost to finish')}</Button>)}
        </div>
      </div>
      {yearsQuery.isPending || defaultYearQuery.isPending ? <ListState variant="loading" rows={4} /> : fiscalYear === '' ? (
        <ListState variant="empty" title={t('projectDetail.budget.chooseFiscalYear', 'Choose a fiscal year to view the ERP forecast')} sub={t('projectDetail.budget.chooseFiscalYearSub', 'Activate and push a budget version, then choose its fiscal year. If no ledger rows have arrived yet, wait for the first posting to sync.')} />
      ) : projectionQuery.isPending ? <ListState variant="loading" rows={4} />
        : projectionQuery.isError ? <ListState variant="error" title={t('projectDetail.budget.forecastError', 'Forecast could not be loaded')} onRetry={() => void projectionQuery.refetch()} />
          : rows.length === 0 ? <ListState variant="empty" title={t('projectDetail.budget.noForecastRows', 'No forecast categories for this fiscal year')} sub={t('projectDetail.budget.noForecastRowsSub', 'Activate and push a budget version for this fiscal year. If it is already active and pushed, wait for the first ERP ledger posting to sync.')} />
            : <>
              {saveEtc.data?.failed.length ? <p role="status" className="text-sm text-warning-foreground">{t('projectDetail.budget.etcPartialSaveNamed', 'Saved: {{saved}}. Not saved: {{failed}}. The failed values remain here so you can retry.', { saved: saveEtc.data.saved.map((category) => budgetCategoryLabel(category, t)).join(', ') || t('projectDetail.budget.none', 'none'), failed: saveEtc.data.failed.map((item) => budgetCategoryLabel(item.category, t)).join(', ') })}</p> : null}
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
            </>}
      <Drawer
        open={Boolean(selected)}
        title={selected ? budgetCategoryLabel(selected.category, t) : ''}
        icon={<Icon name="dollar" />}
        status={<StatusPill variant={selected ? projectionTone(selected) : 'neutral'}>{t('projectDetail.budget.forecast', 'Forecast')}</StatusPill>}
        onClose={closeForecast}
        width="lg"
        headerActions={selected && <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {canEdit && <Button variant="primary" size="sm" onClick={onAdjustInDraft}>{t('projectDetail.budget.adjustInDraft', 'Adjust in a draft')}</Button>}
          <Link className="touch-target inline-flex min-h-9 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-accent" to={`/projects/${encodeURIComponent(projectId)}/budget?${new URLSearchParams({ budgetView: 'forecast' })}`}>{t('projectDetail.budget.openFullPage', 'Open full page')}</Link>
        </div>}
        footer={selected && <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onExport([selected])}>{t('projectDetail.budget.export', 'Export')}</Button>
        </div>}
      >
        {selected && <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              [t('financeCopy.budget', 'Budget'), moneyText(selected.pmoBudgetAmount, budgetCurrency), t('projectDetail.budget.forecastBudgetSource', 'Source: the active budget version, phased to this fiscal year.')],
              [t('projectDetail.budget.spent', 'Spent'), moneyText(selected.actualsToDate, currency), t('projectDetail.budget.forecastActualsAsOf', 'Source: ERP ledger through the recorded as-of date.')],
              [t('projectDetail.budget.projectCommitmentsShort', 'Committed · project-wide'), canReadCommitments ? moneyText(committedByCategory[selected.category] ?? 0, currency) : '—', t('projectDetail.budget.forecastCommitmentSummary', 'Committed amounts are project-wide and not assigned to a fiscal year.')],
              [t('projectDetail.budget.costToFinish', 'Cost to finish'), formatCurrencyAuto(selected.pmoEtc, currency), t('projectDetail.budget.etcSource', 'PM estimate to complete, saved for this fiscal year.')],
              [t('projectDetail.budget.forecastFinal', 'Forecast final'), moneyText(selected.projectedFinalCost, currency), t('projectDetail.budget.forecastFinalFormula', 'Calculated as ERP spending to date plus cost to finish.')],
              [t('projectDetail.budget.forecastRemaining', 'Forecast remaining'), moneyText(selected.projectedVariance, currency), t('projectDetail.budget.forecastRemainingFormula', 'Calculated as fiscal-year budget minus forecast final. Negative values are an overrun.')],
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
      </Drawer>
    </section>
  );
}
