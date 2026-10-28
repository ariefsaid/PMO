import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { Column } from '@/src/components/ui';
import { Button, DataTable, Drawer, Icon, ListState, NumberField, ProgressBar, StatusPill, Tooltip } from '@/src/components/ui';
import type { BudgetProjectionCellRow } from '@/src/lib/repositories/budgetProjection';
import { fetchActiveBudgetCategoryPhasing, fetchBudgetProjection, listBudgetFiscalYears, upsertBudgetProjectionEtc } from '@/src/lib/repositories/budgetProjection';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatCurrencyAuto, formatInstantDate, parseMoneyInputAtScale } from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

interface BudgetProjectionProps {
  projectId: string;
  currency: string;
  canEdit: boolean;
  committedByCategory: Record<string, number | null>;
  canReadCommitments: boolean;
  onAdjustInDraft: () => void;
  onExport: (rows: BudgetProjectionCellRow[]) => void;
}

const moneyText = (value: number | null, currency: string) => value === null ? '—' : formatCurrencyAuto(value, currency);

function projectionTone(row: BudgetProjectionCellRow): 'neutral' | 'won' | 'warn' | 'lost' {
  if (row.projectedUtilization === null) return 'neutral';
  if (row.projectedVariance !== null && row.projectedVariance < 0) return 'lost';
  if (row.projectedUtilization >= 90) return 'lost';
  if (row.projectedUtilization >= 70) return 'warn';
  return 'won';
}

export default function BudgetProjection({ projectId, currency, canEdit, committedByCategory, canReadCommitments, onAdjustInDraft, onExport }: BudgetProjectionProps) {
  const { t } = useTranslation('finance');
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [requestedYear, setRequestedYear] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [etcDraft, setEtcDraft] = useState<Record<string, string>>({});
  const [etcErrors, setEtcErrors] = useState<Record<string, string>>({});
  const yearsQuery = useQuery({
    queryKey: ['budget-fiscal-years', projectId],
    queryFn: () => listBudgetFiscalYears(projectId),
    enabled: Boolean(projectId),
  });
  const years = yearsQuery.data ?? [];
  const defaultYear = years.find((row) => row.isActivePush)?.fiscalYear ?? years[0]?.fiscalYear ?? '';
  const fiscalYear = requestedYear === undefined ? defaultYear : requestedYear;
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
  const rows = projectionQuery.data ?? [];
  const selected = rows.find((row) => row.category === searchParams.get('open')) ?? null;
  const phasing = phasingQuery.data;
  const budgetYearOnRecord = Object.values(phasing?.years ?? {}).some((years) => years.includes(fiscalYear));
  const hasLinesForCategory = (category: BudgetProjectionCellRow['category']) => Boolean((phasing?.years[category]?.length ?? 0) || phasing?.unphased[category]);
  const budgetReasonFor = (row: BudgetProjectionCellRow): string | null => {
    if (row.pmoBudgetAmount !== null) return null;
    const years = phasing?.years[row.category] ?? [];
    const unphased = phasing?.unphased[row.category] === true;
    const otherYears = years.filter((year) => year !== fiscalYear);
    if (otherYears.length && !unphased) return t('projectDetail.budget.reasonBudgetedOtherYear', 'Budgeted in another fiscal year: {{years}}', { years: otherYears.join(', ') });
    if (hasLinesForCategory(row.category) && unphased) return t('projectDetail.budget.reasonStaleAttribution', 'Budget attribution is stale or incomplete. Review the line phasing.');
    if (row.attributionKnown === false) return t('projectDetail.budget.reasonPartialAttribution', 'Some budget lines cannot be attributed to this fiscal year. Review the line phasing.');
    if (!budgetYearOnRecord) return t('projectDetail.budget.reasonNoBudgetYear', 'No budget is recorded for this fiscal year.');
    return t('projectDetail.budget.reasonNoBudgetLine', 'No budget line is recorded for this category.');
  };
  const rowReasonFor = (row: BudgetProjectionCellRow): string | null => row.actualsToDate === null
    ? row.actualsAsOf === null
      ? t('projectDetail.budget.reasonNoLedger', 'No ledger reading is available for this fiscal year.')
      : t('projectDetail.budget.reasonNoAccount', 'No accounting ledger account is mapped for this category.')
    : budgetReasonFor(row);
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
      if (failed.length === 0) setEditing(false);
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
      if (entries.length === 0 && Object.keys(errors).length === 0) setEditing(false);
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
      cell: (row) => <Tooltip content={t('projectDetail.budget.forecastBudgetSource', 'Source: the active budget version, phased to this fiscal year.')}><span tabIndex={0}>{moneyText(row.pmoBudgetAmount, currency)}</span></Tooltip>,
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
      header: t('projectDetail.budget.forecastRemaining', 'Forecast remaining'),
      kind: 'money',
      align: 'num',
      cell: (row) => <Tooltip content={t('projectDetail.budget.forecastRemainingFormula', 'Calculated as fiscal-year budget minus forecast final. Negative values are an overrun.')}><span tabIndex={0} className={row.projectedVariance !== null && row.projectedVariance < 0 ? 'text-destructive-text' : undefined}>{moneyText(row.projectedVariance, currency)}</span></Tooltip>,
    },
    {
      key: 'status',
      header: t('projectDetail.budget.status', 'Status'),
      kind: 'status',
      cell: (row) => row.projectedUtilization === null
        ? <StatusPill variant="neutral">{t('projectDetail.budget.unavailable', 'Unavailable')}</StatusPill>
        : <span className="flex min-w-28 flex-col gap-1">
          <StatusPill variant={projectionTone(row)}>{row.projectedVariance !== null && row.projectedVariance < 0 ? t('projectDetail.budget.overBudget', 'Over budget') : row.projectedUtilization >= 90 ? t('projectDetail.budget.atRisk', 'At risk') : row.projectedUtilization >= 70 ? t('projectDetail.budget.watch', 'Watch') : t('projectDetail.budget.onTrack', 'On track')}</StatusPill>
          <Tooltip content={t('projectDetail.budget.forecastUtilizationFormula', 'Forecast final divided by fiscal-year budget.')}><span tabIndex={0}><ProgressBar compact value={Math.round(row.projectedUtilization)} showValue aria-label={`${budgetCategoryLabel(row.category, t)} ${t('projectDetail.budget.forecastUtilization', 'forecast utilization')}`} /></span></Tooltip>
        </span>,
    },
  ], [canReadCommitments, committedByCategory, currency, editing, etcDraft, etcErrors, t]);

  const totalCommitted = canReadCommitments
    ? rows.reduce((sum, row) => sum + (committedByCategory[row.category] ?? 0), 0)
    : null;
  const totals = rows.length ? [{
    key: 'total',
    label: t('financeCopy.total', 'Total'),
    values: {
      budget: moneyText(rows.every((row) => row.pmoBudgetAmount !== null) ? rows.reduce((sum, row) => sum + (row.pmoBudgetAmount ?? 0), 0) : null, currency),
      spent: <span className="inline-flex flex-col items-end"><span>{moneyText(rows.every((row) => row.actualsToDate !== null) ? rows.reduce((sum, row) => sum + (row.actualsToDate ?? 0), 0) : null, currency)}</span><span className="text-xs font-normal text-muted-foreground">{t('projectDetail.budget.projectCommitmentsShort', 'Committed · project-wide')}: {moneyText(totalCommitted, currency)}</span></span>,
      etc: formatCurrencyAuto(rows.reduce((sum, row) => sum + row.pmoEtc, 0), currency),
      final: moneyText(rows.every((row) => row.projectedFinalCost !== null) ? rows.reduce((sum, row) => sum + (row.projectedFinalCost ?? 0), 0) : null, currency),
      remaining: moneyText(rows.every((row) => row.projectedVariance !== null) ? rows.reduce((sum, row) => sum + (row.projectedVariance ?? 0), 0) : null, currency),
    },
  }] : [];

  if (yearsQuery.isError) return <ListState variant="error" title={t('projectDetail.budget.fiscalYearsError', 'Fiscal years could not be loaded')} onRetry={() => void yearsQuery.refetch()} />;

  return (
    <section className="min-w-0 space-y-3" aria-label={t('projectDetail.budget.forecast', 'Forecast')} data-testid="budget-forecast-view">
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <label className="flex min-w-44 flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('projectDetail.budget.fiscalYear', 'Fiscal year')}
          <select aria-label={t('projectDetail.budget.fiscalYear', 'Fiscal year')} value={fiscalYear} onChange={(event) => setRequestedYear(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground">
            <option value="">{t('projectDetail.budget.wholeProject', 'Whole project')}</option>
            {years.map((year) => <option key={year.fiscalYear} value={year.fiscalYear}>{year.fiscalYear}{year.isActivePush ? ` · ${t('projectDetail.budget.activePushYear', 'active push')}` : ''}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {rows.length > 0 && <Button variant="outline" size="sm" onClick={() => onExport(rows)}>{t('projectDetail.budget.export', 'Export')}</Button>}
          {canEdit && rows.length > 0 && (editing ? <>
            <Button variant="primary" size="sm" loading={saveEtc.isPending} onClick={saveEdits}>{saveEtc.data?.failed.length ? t('projectDetail.budget.retryFailedEtc', 'Retry failed edits') : t('common.save', 'Save')}</Button>
            <Button variant="outline" size="sm" onClick={() => { setEditing(false); setEtcErrors({}); setEtcDraft({}); }}>{t('common.cancel', 'Cancel')}</Button>
          </> : <Button variant="outline" size="sm" onClick={beginEdit}>{t('projectDetail.budget.editCostToFinish', 'Edit cost to finish')}</Button>)}
        </div>
      </div>
      {fiscalYear === '' ? (
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
                totals={totals}
              />
              <p className="text-xs text-muted-foreground">{t('projectDetail.budget.forecastCommitmentScope', 'Committed amounts are project-wide; the current source does not assign them to a fiscal year. They are shown separately and are not included in the fiscal-year forecast final.')}</p>
              {rows.some((row) => row.actualsToDate === null || row.pmoBudgetAmount === null) && <div role="status" data-testid="forecast-incomplete" className="space-y-1 text-sm text-muted-foreground">
                <p>{t('projectDetail.budget.forecastIncompleteCategories', 'Incomplete categories: {{categories}}', { categories: rows.filter((row) => row.actualsToDate === null || row.pmoBudgetAmount === null).map((row) => budgetCategoryLabel(row.category, t)).join(', ') })}</p>
                {rows.filter((row) => row.actualsToDate === null || row.pmoBudgetAmount === null).map((row) => <p key={`reason-${row.category}`}>{budgetCategoryLabel(row.category, t)}: {rowReasonFor(row)}</p>)}
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
              [t('financeCopy.budget', 'Budget'), moneyText(selected.pmoBudgetAmount, currency), t('projectDetail.budget.forecastBudgetSource', 'Source: the active budget version, phased to this fiscal year.')],
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
