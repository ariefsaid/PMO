import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog } from '@/src/components/ui';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatExactMoney, normalizeLocalizedDecimal } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { formatExactCents, parseExactCents } from '@/src/lib/exactDecimal';
import {
  byDays,
  fromAmounts,
  fromPercents,
  yearsInSpan,
  type FiscalYearSpan,
  type DistributionResult,
} from '@/src/lib/budget/budgetDistribution';
import type {
  BudgetCategoryOverride,
  BudgetDistributionMethod,
  BudgetDistributionPlan,
  BudgetDistributionPlanRow,
  BudgetLineItemRow,
} from '@/src/lib/db/budgets';

type SourceLine = Pick<BudgetLineItemRow, 'id' | 'category' | 'description' | 'budgeted_amount' | 'fiscal_year'>;

interface DistributionGridProps {
  versionId: string;
  lines: readonly SourceLine[];
  projectStart: string | null;
  projectEnd: string | null;
  /** Full server-resolved external calendar; this component derives the actual project-span years. */
  fiscalYears: readonly FiscalYearSpan[] | null;
  currency: string;
  editorIdentity: string;
  savedPlan: BudgetDistributionPlan | null;
  savedPlanLoading?: boolean;
  saving?: boolean;
  /** False means the server write committed but the post-save read did not reconcile. */
  onSave: (plan: BudgetDistributionPlan) => Promise<boolean>;
}

interface CategoryTotal {
  category: SourceLine['category'];
  cents: bigint;
}

interface DistributionReview {
  contextKey: string;
  plan: BudgetDistributionPlan;
}

const METHODS: BudgetDistributionMethod[] = ['by_days', 'percent_by_year', 'amount_by_year'];

function categoryTotals(lines: readonly SourceLine[]): CategoryTotal[] {
  const totals = new Map<SourceLine['category'], bigint>();
  for (const line of lines) {
    const cents = parseExactCents(String(line.budgeted_amount));
    if (cents === null || cents < 0n) throw new Error('A budget line has an invalid exact amount.');
    totals.set(line.category, (totals.get(line.category) ?? 0n) + cents);
  }
  return [...totals.entries()]
    .map(([category, cents]) => ({ category, cents }))
    .sort((left, right) => String(left.category).localeCompare(String(right.category)));
}

function inputObject(years: readonly FiscalYearSpan[], values: Record<string, string>, scale: 2 | 4): Record<string, string> | null {
  const result: Record<string, string> = {};
  for (const year of years) {
    const value = normalizeLocalizedDecimal(values[year.name] ?? '', scale);
    if (value === null) return null;
    result[year.name] = value;
  }
  return result;
}

function resolvedRows(
  total: bigint,
  method: BudgetDistributionMethod,
  inputs: Record<string, string>,
  years: readonly FiscalYearSpan[],
  projectStart: string,
  projectEnd: string | null,
  proportionalAmounts: boolean,
): DistributionResult | null {
  const totalText = formatExactCents(total);
  if (method === 'by_days') {
    try {
      return { ok: true, rows: byDays(totalText, projectStart, projectEnd, years) };
    } catch {
      return { ok: false, errors: [{ code: 'invalid' }] };
    }
  }
  if (method === 'percent_by_year') {
    const normalized = inputObject(years, inputs, 4);
    return normalized === null ? null : fromPercents(totalText, years.map((year) => normalized[year.name]), years);
  }
  const normalized = inputObject(years, inputs, 2);
  return normalized === null
    ? null
    : fromAmounts(totalText, years.map((year) => normalized[year.name]), years, { proportional: proportionalAmounts });
}

function planFor(
  categories: readonly CategoryTotal[],
  years: readonly FiscalYearSpan[],
  projectStart: string,
  projectEnd: string | null,
  method: BudgetDistributionMethod,
  globalValues: Record<string, string>,
  overrideValues: Record<string, BudgetCategoryOverride>,
): BudgetDistributionPlan {
  const globalInputs = method === 'by_days' ? {} : inputObject(years, globalValues, method === 'percent_by_year' ? 4 : 2);
  if (globalInputs === null) throw new Error('Enter a valid value for every fiscal year before previewing.');
  const rows: BudgetDistributionPlanRow[] = [];
  const categoryOverrides: Record<string, BudgetCategoryOverride> = {};

  for (const category of categories) {
    const override = overrideValues[category.category];
    const selectedMethod = override?.method ?? method;
    const values = override?.inputs ?? globalValues;
    const normalized = selectedMethod === 'by_days'
      ? {}
      : inputObject(years, values, selectedMethod === 'percent_by_year' ? 4 : 2);
    if (normalized === null) {
      throw new Error('Enter a valid value for every fiscal year in each custom distribution.');
    }
    if (override) categoryOverrides[category.category] = { method: selectedMethod, inputs: normalized };
    const distribution = resolvedRows(
      category.cents,
      selectedMethod,
      normalized,
      years,
      projectStart,
      projectEnd,
      !override && selectedMethod === 'amount_by_year',
    );
    if (!distribution || !distribution.ok) {
      const error = distribution && !distribution.ok ? distribution.errors[0]?.code : 'invalid';
      throw new Error(`${budgetCategoryLabel(category.category, (key) => key)}: ${error ?? 'invalid'} distribution inputs.`);
    }
    if (distribution.rows.length !== years.length) throw new Error('The fiscal-year preview is incomplete.');
    distribution.rows.forEach((row, ordinal) => rows.push({
      category: category.category,
      fiscal_year: row.year,
      ordinal,
      amount: row.amount,
      method: selectedMethod,
      is_override: Boolean(override),
    }));
  }

  return {
    method,
    inputs: globalInputs,
    categoryOverrides,
    basis: {
      projectStart,
      projectEnd,
      years: years.map(({ name, start, end }) => ({ name, start, end })),
    },
    rows,
  };
}

function isSavedPlanCurrent(
  plan: BudgetDistributionPlan,
  categories: readonly CategoryTotal[],
  years: readonly FiscalYearSpan[],
  projectStart: string,
  projectEnd: string | null,
): boolean {
  if (plan.basis.projectStart !== projectStart || plan.basis.projectEnd !== projectEnd) return false;
  if (plan.basis.years.length !== years.length || plan.basis.years.some((year, index) =>
    year.name !== years[index].name || year.start !== years[index].start || year.end !== years[index].end)) return false;
  if (plan.rows.length !== categories.length * years.length) return false;
  return categories.every((category) => {
    const categoryRows = plan.rows.filter((row) => row.category === category.category);
    if (categoryRows.length !== years.length) return false;
    let cents = 0n;
    for (const [index, row] of categoryRows.entries()) {
      const amount = parseExactCents(row.amount);
      if (amount === null || row.fiscal_year !== years[index].name || row.ordinal !== index) return false;
      cents += amount;
    }
    return cents === category.cents;
  });
}

const DistributionGrid: React.FC<DistributionGridProps> = ({
  versionId,
  lines,
  projectStart,
  projectEnd,
  fiscalYears,
  currency,
  editorIdentity,
  savedPlan,
  savedPlanLoading = false,
  saving = false,
  onSave,
}) => {
  const { t } = useTranslation('finance');
  const [method, setMethod] = useState<BudgetDistributionMethod>('by_days');
  const [globalValues, setGlobalValues] = useState<Record<string, string>>({});
  const [overrideValues, setOverrideValues] = useState<Record<string, BudgetCategoryOverride>>({});
  const [review, setReview] = useState<DistributionReview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [staleReview, setStaleReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedInputsInitialized, setSavedInputsInitialized] = useState(false);
  const priorContext = useRef<string | null>(null);

  const sourceKey = useMemo(() => JSON.stringify(lines.map((line) => [
    line.id, line.category, String(line.budgeted_amount), line.fiscal_year,
  ]).sort((left, right) => String(left[0]).localeCompare(String(right[0])))), [lines]);
  const calendarKey = useMemo(() => JSON.stringify(fiscalYears), [fiscalYears]);
  const contextKey = JSON.stringify([versionId, editorIdentity, projectStart, projectEnd, calendarKey, sourceKey]);

  const resolved = useMemo(() => {
    try {
      if (!projectStart) throw new Error('Add a project start date before distributing this budget.');
      if (!fiscalYears) throw new Error('The current fiscal-year calendar is unavailable.');
      const years = yearsInSpan(projectStart, projectEnd, fiscalYears);
      return { categories: categoryTotals(lines), years, error: null };
    } catch (cause) {
      return { categories: [] as CategoryTotal[], years: [] as FiscalYearSpan[], error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [fiscalYears, lines, projectEnd, projectStart]);

  useEffect(() => {
    if (priorContext.current === null) {
      priorContext.current = contextKey;
      return;
    }
    if (priorContext.current !== contextKey) {
      priorContext.current = contextKey;
      setReview(null);
      setConfirmOpen(false);
      setStaleReview(true);
      setError(null);
    }
  }, [contextKey]);

  useEffect(() => {
    if (savedInputsInitialized || savedPlanLoading) return;
    if (savedPlan) {
      setMethod(savedPlan.method);
      setGlobalValues(savedPlan.inputs);
      setOverrideValues(savedPlan.categoryOverrides);
    }
    setSavedInputsInitialized(true);
  }, [savedInputsInitialized, savedPlan, savedPlanLoading]);

  const savedPlanIsCurrent = savedPlan !== null && !resolved.error && projectStart !== null &&
    isSavedPlanCurrent(savedPlan, resolved.categories, resolved.years, projectStart, projectEnd);

  const invalidatePreview = () => {
    if (review) setStaleReview(true);
    setReview(null);
    setConfirmOpen(false);
    setError(null);
  };

  const setGlobalInput = (year: string, value: string) => {
    setGlobalValues((previous) => ({ ...previous, [year]: value }));
    invalidatePreview();
  };

  const setOverride = (category: string, next: BudgetCategoryOverride | null) => {
    setOverrideValues((previous) => {
      const updated = { ...previous };
      if (next === null) delete updated[category];
      else updated[category] = next;
      return updated;
    });
    invalidatePreview();
  };

  const preview = () => {
    if (resolved.error || !projectStart) return;
    try {
      const plan = planFor(resolved.categories, resolved.years, projectStart, projectEnd, method, globalValues, overrideValues);
      setReview({ contextKey, plan });
      setStaleReview(false);
      setError(null);
    } catch (cause) {
      setReview(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const saveReviewed = async () => {
    if (!review || review.contextKey !== contextKey || staleReview) return;
    try {
      const refreshed = await onSave(review.plan);
      if (!refreshed) return;
      setConfirmOpen(false);
      setReview(null);
      setStaleReview(false);
    } catch {
      // The owner surface reports the mutation error; retain the exact entered values and preview.
    }
  };

  const formatMoney = (amount: string) =>
    formatExactMoney(amount, currency, getNumberLocale(), { trimZeroFraction: false }) ?? `${currency} ${amount}`;
  const previewAmounts = new Map(review?.plan.rows.map((row) => [`${row.category}\u0000${row.fiscal_year}`, row.amount]) ?? []);
  const previewTotals = new Map<string, bigint>();
  for (const row of review?.plan.rows ?? []) {
    const cents = parseExactCents(row.amount);
    if (cents !== null) previewTotals.set(row.fiscal_year, (previewTotals.get(row.fiscal_year) ?? 0n) + cents);
  }

  return (
    <section aria-label={t('projectDetail.budget.distributionTitle', 'Fiscal-year distribution')} className="min-w-0 space-y-3 rounded-md border border-border bg-card p-[var(--panel-inset)]" data-testid="budget-distribution-grid">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-foreground">{t('projectDetail.budget.distributionTitle', 'Fiscal-year distribution')}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{t('projectDetail.budget.distributionIntro', 'Review how each category total is allocated across the project fiscal years. Saving changes only this Draft distribution.')}</p>
        </div>
        {savedPlan && (
          <span role="status" className={savedPlanIsCurrent ? 'text-xs text-muted-foreground' : 'text-xs font-medium text-warning-foreground'}>
            {savedPlanIsCurrent
              ? t('projectDetail.budget.distributionSaved', 'Saved distribution')
              : t('projectDetail.budget.distributionStale', 'Saved distribution needs review')}
          </span>
        )}
      </div>

      {resolved.error ? (
        <p role="status" className="rounded-md border border-warning/40 bg-warning/12 px-3 py-2 text-sm text-warning-foreground">{resolved.error}</p>
      ) : (
        <>
          {staleReview && (
            <p role="status" className="rounded-md border border-warning/40 bg-warning/12 px-3 py-2 text-sm text-warning-foreground">
              {t('projectDetail.budget.distributionPreviewStale', 'The source lines, your role, project dates, or fiscal-year calendar changed. Review a new preview before saving.')}
            </p>
          )}
          <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(14rem,20rem)_1fr] sm:items-end">
            <div className="min-w-0 space-y-1.5">
              <label htmlFor={`distribution-method-${versionId}`} className="text-sm font-medium text-foreground">
                {t('projectDetail.budget.distributionMethod', 'Distribution method')}
              </label>
              <select
                id={`distribution-method-${versionId}`}
                aria-label={t('projectDetail.budget.distributionMethod', 'Distribution method')}
                value={method}
                onChange={(event) => { setMethod(event.target.value as BudgetDistributionMethod); invalidatePreview(); }}
                className="touch-target h-11 w-full rounded-md border border-input bg-background px-3 text-control text-foreground"
              >
                {METHODS.map((value) => <option key={value} value={value}>{t(`projectDetail.budget.distributionMethod_${value}`, value.replaceAll('_', ' '))}</option>)}
              </select>
            </div>
            {method !== 'by_days' && (
              <p className="text-sm text-muted-foreground">
                {method === 'percent_by_year'
                  ? t('projectDetail.budget.distributionPercentHint', 'Enter percentages that add up to 100%. Each category uses these proportions unless it has a custom allocation.')
                  : t('projectDetail.budget.distributionAmountHint', 'Enter non-zero weights for the full budget. Each category is allocated proportionally unless it has a custom allocation.')}
              </p>
            )}
          </div>

          {method !== 'by_days' && (
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={t('projectDetail.budget.sharedYearWeights', 'Shared fiscal-year weights')}>
              {resolved.years.map((year) => (
                <div key={year.name} className="min-w-0 space-y-1.5">
                  <label htmlFor={`distribution-shared-${versionId}-${year.name}`} className="text-sm font-medium text-foreground">{year.name}</label>
                  <input
                    id={`distribution-shared-${versionId}-${year.name}`}
                    aria-label={t('projectDetail.budget.sharedInputForYear', 'Shared input for {{year}}', { year: year.name })}
                    type="text"
                    inputMode="decimal"
                    value={globalValues[year.name] ?? ''}
                    onChange={(event) => setGlobalInput(year.name, event.target.value)}
                    className="h-11 w-full rounded-md border border-input bg-background px-3 text-right text-control tabular-nums text-foreground"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="max-w-full overflow-x-auto rounded-md border border-border">
            <table className="min-w-[42rem] w-full border-collapse text-sm" aria-label={t('projectDetail.budget.distributionGridLabel', 'Category fiscal-year distribution')}>
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="sticky left-0 z-[1] bg-muted px-3 py-2 text-left">{t('financeCopy.category', 'Category')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t('financeCopy.total', 'Total')}</th>
                  <th scope="col" className="min-w-48 px-3 py-2 text-left">{t('projectDetail.budget.customDistribution', 'Custom distribution')}</th>
                  {resolved.years.map((year) => <th key={year.name} scope="col" className="min-w-32 px-3 py-2 text-right">{year.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {resolved.categories.map((category) => {
                  const override = overrideValues[category.category];
                  const rowMethod = override?.method ?? method;
                  return (
                    <tr key={category.category} className="border-t border-border align-top">
                      <th scope="row" className="sticky left-0 z-[1] bg-card px-3 py-2 text-left font-medium text-foreground">{budgetCategoryLabel(category.category, t)}</th>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(formatExactCents(category.cents))}</td>
                      <td className="min-w-48 px-3 py-2">
                        <label className="inline-flex min-h-11 items-center gap-2.5">
                          <input
                            type="checkbox"
                            aria-label={t('projectDetail.budget.customForCategory', 'Use custom distribution for {{category}}', { category: budgetCategoryLabel(category.category, t) })}
                            checked={Boolean(override)}
                            onChange={(event) => setOverride(category.category, event.target.checked
                              ? { method, inputs: {} }
                              : null)}
                            className="size-4 accent-[hsl(var(--primary))]"
                          />
                          <span>{t('projectDetail.budget.customForCategoryLabel', 'Custom')}</span>
                        </label>
                        {override && (
                          <select
                            aria-label={t('projectDetail.budget.customMethodForCategory', 'Custom method for {{category}}', { category: budgetCategoryLabel(category.category, t) })}
                            value={rowMethod}
                            onChange={(event) => setOverride(category.category, { method: event.target.value as BudgetDistributionMethod, inputs: override.inputs })}
                            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                          >
                            {METHODS.map((value) => <option key={value} value={value}>{t(`projectDetail.budget.distributionMethod_${value}`, value.replaceAll('_', ' '))}</option>)}
                          </select>
                        )}
                      </td>
                      {resolved.years.map((year) => {
                        const amount = previewAmounts.get(`${category.category}\u0000${year.name}`);
                        if (review) return <td key={year.name} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{amount ? formatMoney(amount) : '—'}</td>;
                        if (override && rowMethod !== 'by_days') {
                          return (
                            <td key={year.name} className="min-w-32 px-3 py-2">
                              <label className="sr-only" htmlFor={`distribution-override-${versionId}-${category.category}-${year.name}`}>
                                {t('projectDetail.budget.customInputForYear', '{{category}} input for {{year}}', { category: budgetCategoryLabel(category.category, t), year: year.name })}
                              </label>
                              <input
                                id={`distribution-override-${versionId}-${category.category}-${year.name}`}
                                aria-label={t('projectDetail.budget.customInputForYear', '{{category}} input for {{year}}', { category: budgetCategoryLabel(category.category, t), year: year.name })}
                                type="text"
                                inputMode="decimal"
                                value={override.inputs[year.name] ?? ''}
                                onChange={(event) => setOverride(category.category, { ...override, inputs: { ...override.inputs, [year.name]: event.target.value } })}
                                className="h-11 w-full rounded-md border border-input bg-background px-2 text-right text-control tabular-nums text-foreground"
                              />
                            </td>
                          );
                        }
                        return <td key={year.name} className="px-3 py-2 text-right text-muted-foreground">{override ? t('projectDetail.budget.usesDays', 'By days') : t('projectDetail.budget.sharedMethod', 'Shared method')}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
              {review && (
                <tfoot className="border-t border-border bg-muted/50 font-semibold">
                  <tr>
                    <th scope="row" className="sticky left-0 bg-muted px-3 py-2 text-left">{t('financeCopy.total', 'Total')}</th>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(formatExactCents(resolved.categories.reduce((sum, category) => sum + category.cents, 0n)))}</td>
                    <td className="px-3 py-2">{t('projectDetail.budget.previewReconciled', 'Reconciled')}</td>
                    {resolved.years.map((year) => <td key={year.name} className="px-3 py-2 text-right tabular-nums">{formatMoney(formatExactCents(previewTotals.get(year.name) ?? 0n))}</td>)}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive-text">{error}</p>}
          {review && (
            <p role="status" className="text-sm text-muted-foreground" data-testid="budget-distribution-preview-status">
              {t('projectDetail.budget.distributionPreviewReady', 'Preview ready. The displayed row and column totals reconcile to the source budget.')}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={preview} disabled={saving || Boolean(resolved.error)}>
              {t('projectDetail.budget.previewDistribution', 'Preview distribution')}
            </Button>
            {review && (
              <Button variant="primary" onClick={() => setConfirmOpen(true)} disabled={saving || review.contextKey !== contextKey || staleReview}>
                {t('projectDetail.budget.saveReviewedDistribution', 'Save reviewed distribution')}
              </Button>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t('projectDetail.budget.confirmDistributionTitle', 'Save this distribution?')}
        description={t('projectDetail.budget.confirmDistributionBody', 'This saves the reviewed exact fiscal-year amounts to the current Draft. Source line amounts stay unchanged.')}
        confirmLabel={t('projectDetail.budget.confirmDistributionSave', 'Save distribution')}
        loading={saving}
        confirmDisabled={!review || review.contextKey !== contextKey || staleReview}
        onConfirm={() => { void saveReviewed(); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
};

export default DistributionGrid;
