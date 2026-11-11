import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog } from '@/src/components/ui';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatExactMoney, numberSymbols } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { formatExactCents, parseExactCents } from '@/src/lib/exactDecimal';
import { yearsInSpan, type FiscalYearSpan } from '@/src/lib/budget/budgetDistribution';
import {
  categoryTotals,
  DistributionValidationError,
  planFor,
  savedPlanMatchesDraft,
  stablePlan,
  type CategoryTotal,
  type DistributionReadinessStatus,
  type DistributionValidationIssue,
} from '@/src/lib/budget/savedDistribution';
import type {
  BudgetCategoryOverride,
  BudgetDistributionMethod,
  BudgetDistributionPlan,
  BudgetLineItemRow,
} from '@/src/lib/db/budgets';

type SourceLine = Pick<BudgetLineItemRow, 'id' | 'category' | 'description' | 'budgeted_amount' | 'fiscal_year'>;

export type { DistributionReadinessStatus };

export interface DistributionSourceWitness {
  id: string;
  category: string;
  budgeted_amount: string;
  fiscal_year: string | null;
}

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
  savedPlanError?: boolean;
  saving?: boolean;
  writesDisabled?: boolean;
  editable?: boolean;
  onRetryRead?: () => void;
  onReadinessChange?: (readiness: { versionId: string; status: DistributionReadinessStatus }) => void;
  /** False means the server write committed but the post-save read did not reconcile. */
  onSave: (plan: BudgetDistributionPlan, source: DistributionSourceWitness[]) => Promise<boolean>;
}

interface DistributionReview {
  contextKey: string;
  plan: BudgetDistributionPlan;
  source: DistributionSourceWitness[];
}

const METHODS: BudgetDistributionMethod[] = ['by_days', 'percent_by_year', 'amount_by_year'];

function sourceWitnesses(lines: readonly SourceLine[]): DistributionSourceWitness[] {
  return lines.map((line) => {
    const cents = parseExactCents(String(line.budgeted_amount));
    if (cents === null) throw new Error('A budget line has an invalid exact amount.');
    return {
      id: line.id,
      category: line.category,
      budgeted_amount: formatExactCents(cents),
      fiscal_year: line.fiscal_year ?? null,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function localizeCanonicalInputs(inputs: Record<string, string>): Record<string, string> {
  const decimal = numberSymbols().decimal;
  return Object.fromEntries(Object.entries(inputs).map(([year, value]) => [year, decimal === '.' ? value : value.replace('.', decimal)]));
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
  savedPlanError = false,
  saving = false,
  writesDisabled = false,
  editable = true,
  onRetryRead,
  onReadinessChange,
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
  const [localEdits, setLocalEdits] = useState(false);
  const priorContext = useRef<string | null>(null);
  const priorWritesDisabled = useRef(writesDisabled);
  const validationSummaryRef = useRef<HTMLDivElement>(null);

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
    if (savedInputsInitialized || savedPlanLoading || savedPlanError) return;
    if (savedPlan) {
      setMethod(savedPlan.method);
      setGlobalValues(localizeCanonicalInputs(savedPlan.inputs));
      setOverrideValues(Object.fromEntries(Object.entries(savedPlan.categoryOverrides).map(([category, override]) => [
        category,
        { ...override, inputs: localizeCanonicalInputs(override.inputs) },
      ])));
    }
    setSavedInputsInitialized(true);
  }, [savedInputsInitialized, savedPlan, savedPlanError, savedPlanLoading]);

  const savedPlanIsCurrent = savedPlan !== null && savedPlanMatchesDraft(savedPlan, lines, projectStart, projectEnd, fiscalYears);

  const validationIssues = useMemo(() => {
    if (!projectStart || resolved.error) return [] as DistributionValidationIssue[];
    try {
      planFor(resolved.categories, resolved.years, projectStart, projectEnd, method, globalValues, overrideValues);
      return [] as DistributionValidationIssue[];
    } catch (cause) {
      return cause instanceof DistributionValidationError ? cause.issues : [] as DistributionValidationIssue[];
    }
  }, [globalValues, method, overrideValues, projectEnd, projectStart, resolved]);

  const readinessStatus: DistributionReadinessStatus = savedPlanLoading
    ? 'loading'
    : savedPlanError
      ? 'error'
      : !savedInputsInitialized
        ? 'loading'
        : saving
        ? 'saving'
        : localEdits
          ? validationIssues.length > 0 ? 'invalid' : 'dirty'
          : savedPlan
            ? savedPlanIsCurrent ? 'current' : 'stale'
            : 'absent';

  useEffect(() => {
    onReadinessChange?.({ versionId, status: readinessStatus });
  }, [onReadinessChange, readinessStatus, versionId]);

  useEffect(() => {
    if (priorWritesDisabled.current && !writesDisabled && review) {
      const refreshedMatchesReview = savedPlan !== null && stablePlan(savedPlan) === stablePlan(review.plan) &&
        JSON.stringify(sourceWitnesses(lines)) === JSON.stringify(review.source) && review.contextKey === contextKey;
      setReview(null);
      setConfirmOpen(false);
      setStaleReview(!refreshedMatchesReview);
      setLocalEdits(!refreshedMatchesReview);
    }
    priorWritesDisabled.current = writesDisabled;
  }, [contextKey, lines, review, savedPlan, writesDisabled]);

  const validationMessage = (issue: DistributionValidationIssue): string => {
    const year = issue.year ?? '';
    const category = issue.category ? budgetCategoryLabel(issue.category, t) : '';
    const suffix = { category, year };
    switch (issue.code) {
      case 'missing': return t('projectDetail.budget.distributionValidationMissing', 'Enter a value for {{year}}.', suffix);
      case 'negative': return t('projectDetail.budget.distributionValidationNegative', 'Enter zero or a positive value for {{year}}.', suffix);
      case 'out-of-range': return t('projectDetail.budget.distributionValidationPercentRange', 'Enter a percentage from 0 to 100 for {{year}}.', suffix);
      case 'sum-mismatch': return issue.method === 'percent_by_year'
        ? t('projectDetail.budget.distributionValidationPercentTotal', 'Percentages must total 100%.', suffix)
        : t('projectDetail.budget.distributionValidationAmountTotal', 'Amounts must add up to the category total.', suffix);
      case 'invalid': return t('projectDetail.budget.distributionValidationInvalid', 'Enter a valid number for {{year}}.', suffix);
    }
  };

  const fieldIssue = (scope: DistributionValidationIssue['scope'], year: string, category?: string) =>
    validationIssues.find((issue) => issue.scope === scope && issue.year === year && issue.category === category);
  const groupIssues = validationIssues.filter((issue) => !issue.year);
  const visibleGroupIssues = [...new Map(groupIssues.map((issue) => [
    `${issue.scope}:${issue.category ?? ''}:${issue.method}:${issue.code}`,
    issue,
  ])).values()];
  const controlsDisabled = !editable || saving || writesDisabled || savedPlanLoading || savedPlanError;

  const invalidatePreview = () => {
    if (review) setStaleReview(true);
    setReview(null);
    setConfirmOpen(false);
    setError(null);
  };

  const setGlobalInput = (year: string, value: string) => {
    setGlobalValues((previous) => ({ ...previous, [year]: value }));
    setLocalEdits(true);
    invalidatePreview();
  };

  const setOverride = (category: string, next: BudgetCategoryOverride | null) => {
    setOverrideValues((previous) => {
      const updated = { ...previous };
      if (next === null) delete updated[category];
      else updated[category] = next;
      return updated;
    });
    setLocalEdits(true);
    invalidatePreview();
  };

  const preview = () => {
    if (resolved.error || !projectStart || controlsDisabled) return;
    try {
      const plan = planFor(resolved.categories, resolved.years, projectStart, projectEnd, method, globalValues, overrideValues);
      setReview({ contextKey, plan, source: sourceWitnesses(lines) });
      setStaleReview(false);
      setError(null);
    } catch (cause) {
      setReview(null);
      if (cause instanceof DistributionValidationError) {
        setError(null);
        validationSummaryRef.current?.focus();
        return;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const saveReviewed = async () => {
    if (!review || review.contextKey !== contextKey || staleReview) return;
    try {
      const refreshed = await onSave(review.plan, review.source);
      if (!refreshed) return;
      setConfirmOpen(false);
      setReview(null);
      setStaleReview(false);
      setLocalEdits(false);
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
          <span role="status" className={savedPlanIsCurrent ? 'text-sm text-muted-foreground' : 'text-sm font-medium text-warning-foreground'}>
            {savedPlanIsCurrent
              ? t('projectDetail.budget.distributionSaved', 'Saved distribution')
              : t('projectDetail.budget.distributionStale', 'Saved distribution needs review')}
          </span>
        )}
      </div>

      {savedPlanError ? (
        <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-3 text-sm text-destructive-text" role="alert">
          <p>{t('projectDetail.budget.distributionReadFailed', "Couldn't load the saved distribution. Your entered values are still here; retry before editing or saving.")}</p>
          {onRetryRead && (
            <Button variant="outline" size="sm" onClick={onRetryRead}>
              {t('projectDetail.budget.retryDistributionRead', 'Retry saved distribution read')}
            </Button>
          )}
        </div>
      ) : savedPlanLoading || !savedInputsInitialized ? (
        <p role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t('projectDetail.budget.distributionLoading', 'Loading the saved distribution…')}
        </p>
      ) : resolved.error ? (
        <p role="status" className="rounded-md border border-warning/40 bg-warning/12 px-3 py-2 text-sm text-warning-foreground">{resolved.error}</p>
      ) : (
        <>
          {staleReview && (
            <p role="status" className="rounded-md border border-warning/40 bg-warning/12 px-3 py-2 text-sm text-warning-foreground">
              {t('projectDetail.budget.distributionPreviewStale', 'The source lines, your role, project dates, or fiscal-year calendar changed. Review a new preview before saving.')}
            </p>
          )}
          {validationIssues.length > 0 && (
            <div ref={validationSummaryRef} role="alert" tabIndex={-1} aria-labelledby={`distribution-validation-title-${versionId}`} data-testid="distribution-validation-summary" className="rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive-text">
              <p id={`distribution-validation-title-${versionId}`} className="font-medium">{t('projectDetail.budget.distributionValidationSummary', 'Review the distribution inputs before previewing.')}</p>
              <ul className="mt-1 list-disc pl-5">
                {validationIssues.map((issue, index) => <li key={`${issue.scope}:${issue.category ?? ''}:${issue.year ?? ''}:${issue.code}:${index}`}>{issue.category ? `${budgetCategoryLabel(issue.category, t)}: ` : ''}{validationMessage(issue)}</li>)}
              </ul>
            </div>
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
                disabled={controlsDisabled}
                onChange={(event) => { setMethod(event.target.value as BudgetDistributionMethod); setLocalEdits(true); invalidatePreview(); }}
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
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4" role="group" aria-label={t('projectDetail.budget.sharedYearWeights', 'Shared fiscal-year weights')} aria-invalid={visibleGroupIssues.some((issue) => issue.scope === 'shared') || undefined} aria-describedby={visibleGroupIssues.some((issue) => issue.scope === 'shared') ? `distribution-shared-group-error-${versionId}` : undefined}>
              {resolved.years.map((year) => (
                <div key={year.name} className="min-w-0 space-y-1.5">
                  <label htmlFor={`distribution-shared-${versionId}-${year.name}`} className="text-sm font-medium text-foreground">{year.name}</label>
                  {(() => {
                    const issue = fieldIssue('shared', year.name);
                    const errorId = `distribution-shared-error-${versionId}-${year.name}`;
                    return <>
                  <input
                    id={`distribution-shared-${versionId}-${year.name}`}
                    aria-label={t('projectDetail.budget.sharedInputForYear', 'Shared input for {{year}}', { year: year.name })}
                    aria-invalid={issue || visibleGroupIssues.some((groupIssue) => groupIssue.scope === 'shared') ? true : undefined}
                    aria-describedby={[issue ? errorId : null, visibleGroupIssues.some((groupIssue) => groupIssue.scope === 'shared') ? `distribution-shared-group-error-${versionId}` : null].filter(Boolean).join(' ') || undefined}
                    type="text"
                    inputMode="decimal"
                    value={globalValues[year.name] ?? ''}
                    disabled={controlsDisabled}
                    onChange={(event) => setGlobalInput(year.name, event.target.value)}
                    className="h-11 w-full rounded-md border border-input bg-background px-3 text-right text-control tabular-nums text-foreground"
                  />
                    {issue && <p id={errorId} className="text-sm text-destructive-text">{validationMessage(issue)}</p>}
                    </>;
                  })()}
                </div>
              ))}
            </div>
          )}
          {visibleGroupIssues.some((issue) => issue.scope === 'shared') && (
            <p id={`distribution-shared-group-error-${versionId}`} role="alert" className="text-sm text-destructive-text">
              {validationMessage(visibleGroupIssues.find((issue) => issue.scope === 'shared')!)}
            </p>
          )}

          <div className="max-w-full overflow-x-auto rounded-md border border-border">
            <table className="min-w-[42rem] w-full border-collapse text-sm" aria-label={t('projectDetail.budget.distributionGridLabel', 'Category fiscal-year distribution')}>
              <thead className="bg-muted text-sm text-muted-foreground">
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
                  const categoryGroupIssue = visibleGroupIssues.find((issue) => issue.scope === 'category' && issue.category === category.category);
                  const categoryGroupErrorId = `distribution-category-group-error-${versionId}-${category.category}`;
                  return (
                    <tr key={category.category} className="border-t border-border align-top">
                      <th scope="row" className="sticky left-0 z-[1] bg-card px-3 py-2 text-left font-medium text-foreground">{budgetCategoryLabel(category.category, t)}</th>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(formatExactCents(category.cents))}</td>
                      <td className="min-w-48 px-3 py-2">
                        <label className="inline-flex min-h-11 items-center gap-2.5">
                          <input
                            type="checkbox"
                            aria-label={t('projectDetail.budget.customForCategory', 'Use custom distribution for {{category}}', { category: budgetCategoryLabel(category.category, t) })}
                            aria-describedby={categoryGroupIssue ? categoryGroupErrorId : undefined}
                            checked={Boolean(override)}
                            disabled={controlsDisabled}
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
                            disabled={controlsDisabled}
                            onChange={(event) => setOverride(category.category, { method: event.target.value as BudgetDistributionMethod, inputs: override.inputs })}
                            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                          >
                            {METHODS.map((value) => <option key={value} value={value}>{t(`projectDetail.budget.distributionMethod_${value}`, value.replaceAll('_', ' '))}</option>)}
                          </select>
                        )}
                        {categoryGroupIssue && <p id={categoryGroupErrorId} className="mt-1 text-sm text-destructive-text">{validationMessage(categoryGroupIssue)}</p>}
                      </td>
                      {resolved.years.map((year) => {
                        const amount = previewAmounts.get(`${category.category}\u0000${year.name}`);
                        if (review) return <td key={year.name} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{amount ? formatMoney(amount) : '—'}</td>;
                        if (override && rowMethod !== 'by_days') {
                          const issue = fieldIssue('category', year.name, category.category);
                          const errorId = `distribution-override-error-${versionId}-${category.category}-${year.name}`;
                          return (
                            <td key={year.name} className="min-w-32 px-3 py-2">
                              <>
                              <label className="sr-only" htmlFor={`distribution-override-${versionId}-${category.category}-${year.name}`}>
                                {t('projectDetail.budget.customInputForYear', '{{category}} input for {{year}}', { category: budgetCategoryLabel(category.category, t), year: year.name })}
                              </label>
                              <input
                                id={`distribution-override-${versionId}-${category.category}-${year.name}`}
                                aria-label={t('projectDetail.budget.customInputForYear', '{{category}} input for {{year}}', { category: budgetCategoryLabel(category.category, t), year: year.name })}
                                aria-invalid={issue || categoryGroupIssue ? true : undefined}
                                aria-describedby={[issue ? errorId : null, categoryGroupIssue ? categoryGroupErrorId : null].filter(Boolean).join(' ') || undefined}
                                type="text"
                                inputMode="decimal"
                                value={override.inputs[year.name] ?? ''}
                                disabled={controlsDisabled}
                                onChange={(event) => setOverride(category.category, { ...override, inputs: { ...override.inputs, [year.name]: event.target.value } })}
                                className="h-11 w-full rounded-md border border-input bg-background px-2 text-right text-control tabular-nums text-foreground"
                              />
                              {issue && <p id={errorId} className="mt-1 text-sm text-destructive-text">{validationMessage(issue)}</p>}
                              </>
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
            <Button variant="outline" onClick={preview} disabled={controlsDisabled || Boolean(resolved.error)}>
              {t('projectDetail.budget.previewDistribution', 'Preview distribution')}
            </Button>
            {review && (
              <Button variant="primary" onClick={() => setConfirmOpen(true)} disabled={controlsDisabled || review.contextKey !== contextKey || staleReview}>
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
        confirmDisabled={controlsDisabled || !review || review.contextKey !== contextKey || staleReview}
        onConfirm={() => { void saveReviewed(); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
};

export default DistributionGrid;
